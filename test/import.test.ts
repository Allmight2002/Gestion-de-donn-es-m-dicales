// Tests DB de l'importation par lots (import_records) : eclatement identite/analytique,
// age calcule, validation serveur, apercu (dry-run) sans ecriture, rapport d'erreurs,
// permissions. Donnees ENTIEREMENT FICTIVES.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire (toutes permissions)
let bobId: string;   // editor SANS acces identite
let annaId: string;  // viewer + export seul (pas d'edition)
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const CALL = 'select public.import_records($1,$2::jsonb,$3,$4) as report';
// signature complete : base, rows, dry_run, status, conflict, file_hash, template_version_id
const CALL7 = 'select public.import_records($1,$2::jsonb,$3,$4,$5,$6,$7) as report';
// + batch_id (import par lots)
const CALL8 = 'select public.import_records($1,$2::jsonb,$3,$4,$5,$6,$7,$8) as report';
const BEGIN = 'select public.begin_import_batch($1,$2,$3,$4,$5) as id';
const BEGIN6 = 'select public.begin_import_batch($1,$2,$3,$4,$5,$6) as id'; // + expected_rows
const COMPLETE = 'select public.complete_import_batch($1)';
const CANCEL = 'select public.cancel_import_batch($1)';
const DETECT = 'select public.detect_import_duplicates($1,$2::jsonb) as result'; // §7.6
const enc = (type: string, date: string, data: object) => ({ encounter_type: type, encounter_date: date, data });
const row = (code: string | null, encounter: object | null, patient_data: object = {}, identity: object | null = null) =>
  ({ patient_code: code, identity, patient_data, encounter });
const J = (arr: unknown[]) => JSON.stringify(arr);
const sourceRow = (
  sourceRowNumber: number,
  normalizedRowHash: string,
  code: string | null,
  encounter: object | null,
  patient_data: object = {},
  identity: object | null = null,
) => ({
  ...row(code, encounter, patient_data, identity),
  source_row_number: sourceRowNumber,
  normalized_row_hash: normalizedRowHash,
});
const countPatients = async () =>
  Number((await db.admin.query('select count(*)::int n from public.patient where base_id=$1', [baseId])).rows[0].n);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  // Bob = editor SANS acces identite (peut saisir l'analytique, pas l'identite).
  await db.admin.query(
    `insert into public.base_access(base_id,user_id,access_role,can_view_identity,can_edit_structured_data,granted_by)
     values($1,$2,'editor',false,true,$3)`,
    [baseId, bobId, aliceId],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('import_records', () => {
  test('apercu (dry-run) : compte patients/rencontres SANS rien ecrire', async () => {
    const before = await countPatients();
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([
      row('IMP-001', enc('consultation', '2024-01-05', { diagnosis: 'X', glasgow_score: 12 })),
      row('IMP-001', enc('suivi', '2024-02-05', { diagnosis: 'Y', glasgow_score: 13 })),
    ]), true, 'draft']))[0].report;
    expect(rep.patients_new).toBe(1); // meme patient_code -> 1 patient
    expect(rep.encounters).toBe(2);
    expect(rep.error_count).toBe(0);
    expect(await countPatients()).toBe(before); // rien ecrit
  });

  test('commit : eclate identite/analytique, calcule l age, cree patient + rencontre', async () => {
    await rowsAs(aliceId, CALL, [baseId, J([
      row('IMP-002', enc('consultation', '2024-01-05', { diagnosis: 'X', glasgow_score: 12 }),
        { sexe: 'M', birth_year: 1980 }, { full_name: 'Imp Two', date_of_birth: '1980-01-01' }),
    ]), false, 'draft']);

    const pat = (await db.admin.query("select id, data from public.patient where base_id=$1 and patient_code='IMP-002'", [baseId])).rows[0];
    expect(pat.data.sexe).toBe('M');
    // Identite ecrite en zone restreinte (jamais en analytique).
    const idn = (await db.admin.query("select full_name, date_of_birth from public.patient_identity where base_id=$1 and patient_code='IMP-002'", [baseId])).rows[0];
    expect(idn.full_name).toBe('Imp Two');
    // Age calcule, date de naissance absente des donnees analytiques.
    const e = (await db.admin.query('select age_value, data from public.encounter where patient_id=$1', [pat.id])).rows[0];
    expect(Number(e.age_value)).toBe(44);
    expect('date_of_birth' in e.data).toBe(false);
  });

  test('une ligne invalide est rapportee ; les autres passent', async () => {
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([
      row('IMP-003', enc('consultation', '2024-01-05', { diagnosis: 'a', glasgow_score: 99 })), // hors bornes (max 15)
      row('IMP-004', enc('consultation', '2024-01-05', { diagnosis: 'ok', glasgow_score: 10 })),
    ]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(1);
    expect(rep.errors[0].patient_code).toBe('IMP-003');
    // IMP-004 a bien ete cree malgre l'erreur sur IMP-003.
    expect((await db.admin.query("select 1 from public.patient where base_id=$1 and patient_code='IMP-004'", [baseId])).rows).toHaveLength(1);
    expect((await db.admin.query("select 1 from public.patient where base_id=$1 and patient_code='IMP-003'", [baseId])).rows).toHaveLength(0);
  });

  test('code patient manquant -> erreur de ligne', async () => {
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([
      row(null, enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 9 })),
    ]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(1);
    expect(rep.errors[0].message).toMatch(/code patient/i);
  });

  test('import curated incomplet -> erreur ; complet -> OK', async () => {
    // hospitalisation sans admission_date (requis pour ce type) -> refus.
    const ko = (await rowsAs(aliceId, CALL, [baseId, J([
      row('IMP-007', enc('hospitalisation', '2024-01-05', { diagnosis: 'TC', glasgow_score: 10 }), { sexe: 'M', birth_year: 1970 }),
    ]), false, 'curated']))[0].report;
    expect(ko.error_count).toBe(1);
    // suivi (admission non requise), patient complet -> OK en curated.
    const ok = (await rowsAs(aliceId, CALL, [baseId, J([
      row('IMP-008', enc('suivi', '2024-01-05', { diagnosis: 'controle', glasgow_score: 14 }), { sexe: 'F', birth_year: 1990 }),
    ]), false, 'curated']))[0].report;
    expect(ok.error_count).toBe(0);
    expect((await db.admin.query("select validation_status from public.patient where base_id=$1 and patient_code='IMP-008'", [baseId])).rows[0].validation_status).toBe('curated');
  });

  test('un editor SANS acces identite : les colonnes d identite sont refusees (par ligne)', async () => {
    const rep = (await rowsAs(bobId, CALL, [baseId, J([
      row('IMP-009', enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 9 }), {}, { full_name: 'Interdit' }),
    ]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(1);
    expect(rep.errors[0].message).toMatch(/identite|permission/i);
  });

  test('sans permission d edition, l import entier est refuse', async () => {
    await expect(rowsAs(annaId, CALL, [baseId, J([
      row('IMP-010', enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 9 })),
    ]), false, 'draft'])).rejects.toThrow(/refuse/i);
  });

  test('§6.1 idempotence : un meme fichier (hash) n est pas importe deux fois', async () => {
    const h = 'hash-' + Date.now();
    const data = J([row('IMP-IDEM', enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 10 }))]);
    const rep = (await rowsAs(aliceId, CALL7, [baseId, data, false, 'draft', 'fill', h, null]))[0].report;
    expect(rep.error_count).toBe(0);
    // meme hash -> refus global (doublon evite).
    await expect(rowsAs(aliceId, CALL7, [baseId, data, false, 'draft', 'fill', h, null])).rejects.toThrow(/deja ete importe|doublon/i);
  });

  test('§6.2 import draft ne retrograde pas un patient curated ; fill garde l existant, overwrite journalise', async () => {
    await rowsAs(aliceId, CALL7, [baseId, J([row('IMP-CONF', null, { sexe: 'M', birth_year: 1980 })]), false, 'curated', 'fill', null, null]);
    // fill + statut draft : ni retrogradation ni ecrasement.
    await rowsAs(aliceId, CALL7, [baseId, J([row('IMP-CONF', null, { sexe: 'F' })]), false, 'draft', 'fill', null, null]);
    let p = (await db.admin.query("select data, validation_status from public.patient where base_id=$1 and patient_code='IMP-CONF'", [baseId])).rows[0];
    expect(p.validation_status).toBe('curated');
    expect(p.data.sexe).toBe('M');
    // overwrite : remplace + journalise (source='import').
    await rowsAs(aliceId, CALL7, [baseId, J([row('IMP-CONF', null, { sexe: 'F' })]), false, 'draft', 'overwrite', null, null]);
    p = (await db.admin.query("select data from public.patient where base_id=$1 and patient_code='IMP-CONF'", [baseId])).rows[0];
    expect(p.data.sexe).toBe('F');
    expect((await db.admin.query("select 1 from public.field_change_log where entity='patient' and field_key='sexe' and source='import'")).rows.length).toBeGreaterThan(0);
  });

  test('§6.4 verrou de version : un template_version_id perime est refuse', async () => {
    await expect(rowsAs(aliceId, CALL7, [baseId, J([row('IMP-VER', enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 9 }))]),
      false, 'draft', 'fill', null, '00000000-0000-0000-0000-000000000000'])).rejects.toThrow(/gabarit a change|apercu/i);
  });

  test('§6.5 import par lots : begin_import_batch (idempotence) + chunks accumulent dans UN seul lot', async () => {
    const h = 'batch-' + Date.now();
    const batchId = (await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id;
    expect(batchId).toBeTruthy();
    // §6.2 re-ouvrir le meme fichier alors que le lot est EN COURS -> REPRISE du meme lot.
    expect((await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id).toBe(batchId);
    // 2 chunks rattaches au meme lot.
    await rowsAs(aliceId, CALL8, [baseId, J([row('IMP-B1', enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 10 }))]), false, 'draft', 'fill', null, null, batchId]);
    await rowsAs(aliceId, CALL8, [baseId, J([row('IMP-B2', enc('consultation', '2024-01-06', { diagnosis: 'y', glasgow_score: 11 }))]), false, 'draft', 'fill', null, null, batchId]);
    // Les totaux du lot sont ACCUMULES, et il n'y a qu'UNE ligne de lot (pas une par chunk).
    const b = (await db.admin.query('select row_count, patients_new, encounters from public.import_batch where id=$1', [batchId])).rows[0];
    expect(Number(b.row_count)).toBe(2);
    expect(Number(b.patients_new)).toBe(2);
    expect(Number(b.encounters)).toBe(2);
    expect(Number((await db.admin.query('select count(*)::int n from public.import_batch where base_id=$1 and file_hash=$2', [baseId, h])).rows[0].n)).toBe(1);
    // Les patients ont bien ete crees.
    expect((await db.admin.query("select 1 from public.patient where base_id=$1 and patient_code in ('IMP-B1','IMP-B2')", [baseId])).rows).toHaveLength(2);
  });

  test('§6.1 un chunk incoherent avec son lot est refuse (conflit different, lot cloture)', async () => {
    const h = 'b61-' + Date.now();
    const batchId = (await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id;
    // Mode de conflit different de celui du lot -> refus global.
    await expect(
      rowsAs(aliceId, CALL8, [baseId, J([row('B61-1', null, { sexe: 'M' })]), false, 'draft', 'overwrite', null, null, batchId]),
    ).rejects.toThrow(/conflit incoherent/i);
    // Apres cloture, plus aucun chunk n'est accepte sur ce lot.
    await rowsAs(aliceId, COMPLETE, [batchId]);
    await expect(
      rowsAs(aliceId, CALL8, [baseId, J([row('B61-2', null, { sexe: 'M' })]), false, 'draft', 'fill', null, null, batchId]),
    ).rejects.toThrow(/deja cloture/i);
  });

  test('§6.2 idempotence completed-only : un lot annule ne bloque pas ; un lot complete bloque', async () => {
    const h = 'b62-' + Date.now();
    const b1 = (await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id;
    await rowsAs(aliceId, CANCEL, [b1]);
    // Lot annule -> on peut RECOMMENCER le meme fichier (nouveau lot).
    const b2 = (await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id;
    expect(b2).not.toBe(b1);
    await rowsAs(aliceId, CALL8, [baseId, J([row('B62', null, { sexe: 'M' })]), false, 'draft', 'fill', null, null, b2]);
    await rowsAs(aliceId, COMPLETE, [b2]);
    // Lot complete -> rouvrir le meme fichier est refuse.
    await expect(rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft'])).rejects.toThrow(/deja ete importe|doublon/i);
  });

  test('§6.3 doublon de rencontre DANS le fichier : la 2e ligne identique est rejetee', async () => {
    const dup = enc('consultation', '2024-01-05', { diagnosis: 'x', glasgow_score: 10 });
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([row('B63', dup), row('B63', dup)]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(1);
    expect(rep.errors[0].message).toMatch(/double/i);
    // Une seule rencontre creee pour B63.
    const n = Number((await db.admin.query(
      "select count(*)::int c from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and p.patient_code='B63'", [baseId])).rows[0].c);
    expect(n).toBe(1);
  });

  test('§7.1 skip ne modifie NI l identite NI les donnees d un patient existant', async () => {
    // Patient existant avec identite + donnees.
    await rowsAs(aliceId, CALL, [baseId, J([
      row('SKIP-ID', null, { sexe: 'M' }, { full_name: 'Nom Origine', date_of_birth: '1980-01-01' }),
    ]), false, 'draft']);
    // Re-import en `skip` avec un AUTRE nom + d autres donnees -> rien ne doit bouger.
    await rowsAs(aliceId, CALL7, [baseId, J([
      row('SKIP-ID', null, { sexe: 'F' }, { full_name: 'Nom Pirate', date_of_birth: '1999-09-09' }),
    ]), false, 'draft', 'skip', null, null]);
    const idn = (await db.admin.query("select full_name, date_of_birth::text dob from public.patient_identity where base_id=$1 and patient_code='SKIP-ID'", [baseId])).rows[0];
    expect(idn.full_name).toBe('Nom Origine'); // §7.1 : identite inchangee
    expect(idn.dob).toBe('1980-01-01');
    expect((await db.admin.query("select data from public.patient where base_id=$1 and patient_code='SKIP-ID'", [baseId])).rows[0].data.sexe).toBe('M');
  });

  test('§7.2 statut cible verrouille : un chunk d un autre statut que le lot est refuse', async () => {
    const h = 'b72-' + Date.now();
    const batchId = (await rowsAs(aliceId, BEGIN, [baseId, h, null, 'fill', 'draft']))[0].id; // lot cible=draft
    await expect(
      rowsAs(aliceId, CALL8, [baseId, J([row('B72', null, { sexe: 'M' })]), false, 'complete', 'fill', null, null, batchId]),
    ).rejects.toThrow(/statut cible/i);
  });

  test('§7.4 un lot incomplet (chunks manquants) ne peut pas etre cloture', async () => {
    const h = 'b74-' + Date.now();
    // On ANNONCE 4 lignes mais on n en envoie qu une.
    const batchId = (await rowsAs(aliceId, BEGIN6, [baseId, h, null, 'fill', 'draft', 4]))[0].id;
    await rowsAs(aliceId, CALL8, [baseId, J([row('B74-1', null, { sexe: 'M' })]), false, 'draft', 'fill', null, null, batchId]);
    await expect(rowsAs(aliceId, COMPLETE, [batchId])).rejects.toThrow(/incomplet/i);
    // En envoyant les 3 lignes manquantes, la cloture passe.
    await rowsAs(aliceId, CALL8, [baseId, J([
      row('B74-2', null, { sexe: 'M' }), row('B74-3', null, { sexe: 'M' }), row('B74-4', null, { sexe: 'M' }),
    ]), false, 'draft', 'fill', null, null, batchId]);
    await rowsAs(aliceId, COMPLETE, [batchId]); // 4/4 recues -> OK
    expect((await db.admin.query('select status from public.import_batch where id=$1', [batchId])).rows[0].status).toBe('completed');
  });

  test('§7.5 compteurs : une ligne qui echoue a l ECRITURE n est pas comptee (rapport = realite)', async () => {
    // CNT-OK : valide. CNT-BADDATE : date de rencontre invalide -> passe la validation des donnees,
    // echoue au cast ::date a l ecriture (apres le point ou l ancien code incrementait deja).
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([
      row('CNT-OK', enc('consultation', '2024-01-05', { diagnosis: 'a', glasgow_score: 10 })),
      row('CNT-BADDATE', enc('consultation', 'pas-une-date', { diagnosis: 'b', glasgow_score: 10 })),
    ]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(1);
    expect(rep.patients_new).toBe(1); // §7.5 : CNT-BADDATE non comptee
    expect(rep.encounters).toBe(1);
    // Le compteur DIT la verite : un seul des deux patients persiste.
    const n = Number((await db.admin.query(
      "select count(*)::int c from public.patient where base_id=$1 and patient_code in ('CNT-OK','CNT-BADDATE')", [baseId])).rows[0].c);
    expect(n).toBe(1);
  });

  test('§7.6 avertit quand une rencontre RESSEMBLE a une rencontre deja enregistree (sans bloquer)', async () => {
    // Enregistre une rencontre.
    await rowsAs(aliceId, CALL, [baseId, J([row('DUP-1', enc('consultation', '2024-05-01', { diagnosis: 'x', glasgow_score: 10 }))]), false, 'draft']);
    // Apercu d'un fichier : 1 ligne au MEME (patient/date/type) -> avertissement ; 1 autre date -> rien.
    const res = (await rowsAs(aliceId, DETECT, [baseId, J([
      row('DUP-1', enc('consultation', '2024-05-01', { diagnosis: 'autre', glasgow_score: 12 })),
      row('DUP-1', enc('consultation', '2024-06-01', { diagnosis: 'x', glasgow_score: 11 })),
    ])]))[0].result;
    expect(res.count).toBe(1);
    expect(res.warnings[0].patient_code).toBe('DUP-1');
    expect(res.warnings[0].encounter_date).toBe('2024-05-01');
    // C'est un AVERTISSEMENT : l'import des memes lignes reste possible (non bloque).
    const rep = (await rowsAs(aliceId, CALL, [baseId, J([row('DUP-1', enc('consultation', '2024-05-01', { diagnosis: 'autre', glasgow_score: 12 }))]), false, 'draft']))[0].report;
    expect(rep.error_count).toBe(0);
  });

  test('§4.6 lot avec des lignes en erreur -> completed_with_errors (et reimportable), pas completed', async () => {
    const h = 'b46-' + Date.now();
    const batchId = (await rowsAs(aliceId, BEGIN6, [baseId, h, null, 'fill', 'draft', 2]))[0].id; // 2 lignes attendues
    const rep = (await rowsAs(aliceId, CALL8, [baseId, J([
      row('B46-OK', enc('consultation', '2024-01-05', { diagnosis: 'a', glasgow_score: 10 })),
      row('B46-KO', enc('consultation', '2024-01-05', { diagnosis: 'b', glasgow_score: 99 })), // hors bornes
    ]), false, 'draft', 'fill', null, null, batchId]))[0].report;
    expect(rep.error_count).toBe(1);
    await rowsAs(aliceId, COMPLETE, [batchId]); // row_count=2=attendu -> cloture OK mais statut HONNETE
    expect((await db.admin.query('select status, error_count from public.import_batch where id=$1', [batchId])).rows[0])
      .toMatchObject({ status: 'completed_with_errors' });
    // completed_with_errors ne verrouille PAS le fichier : on peut corriger + rejouer.
    expect((await rowsAs(aliceId, BEGIN6, [baseId, h, null, 'fill', 'draft', 1]))[0].id).toBeTruthy();
  });

  test('§7.7 import AUTONOME (petit fichier) avec erreurs -> completed_with_errors, pas completed', async () => {
    const h = 'b77-' + Date.now();
    // Appel autonome (sans batch_id) avec file_hash : une ligne OK + une ligne KO (code manquant).
    const rep = (await rowsAs(aliceId, CALL7, [baseId, J([
      row('B77-OK', enc('consultation', '2024-01-05', { diagnosis: 'a', glasgow_score: 10 })),
      row(null, null), // code patient manquant -> erreur comptee
    ]), false, 'draft', 'fill', h, null]))[0].report;
    expect(rep.error_count).toBe(1);
    // Le bilan ne ment plus : le lot autonome est marque completed_with_errors (pas completed).
    expect((await db.admin.query('select status, error_count from public.import_batch where base_id=$1 and file_hash=$2', [baseId, h])).rows[0])
      .toMatchObject({ status: 'completed_with_errors' });
    // ...et n'est donc pas verrouille : le fichier corrige reste rejouable.
    const rep2 = (await rowsAs(aliceId, CALL7, [baseId, J([row('B77-OK2', null, { sexe: 'M' })]), false, 'draft', 'fill', h, null]))[0].report;
    expect(rep2.error_count).toBe(0);
  });

  test('audit v20 provenance source : la reprise ignore seulement les lignes deja reussies', async () => {
    const h = 'src77-' + Date.now();
    const okLine = sourceRow(1, 'src-ok-v1', 'SRC77-OK', enc('consultation', '2024-01-05', { diagnosis: 'ok', glasgow_score: 10 }));
    const badLine = sourceRow(2, 'src-bad-v1', null, enc('consultation', '2024-01-06', { diagnosis: 'ko', glasgow_score: 10 }));

    const first = (await rowsAs(aliceId, CALL7, [baseId, J([okLine, badLine]), false, 'draft', 'fill', h, null]))[0].report;
    expect(first).toMatchObject({ encounters: 1, error_count: 1, already_imported: 0 });
    expect((await db.admin.query('select status from public.import_batch where base_id=$1 and file_hash=$2', [baseId, h])).rows[0].status)
      .toBe('completed_with_errors');

    const fixedLine = sourceRow(2, 'src-fixed-v1', 'SRC77-FIX', enc('consultation', '2024-01-06', { diagnosis: 'corrige', glasgow_score: 12 }));
    const replay = (await rowsAs(aliceId, CALL7, [baseId, J([okLine, fixedLine]), false, 'draft', 'fill', h, null]))[0].report;
    expect(replay).toMatchObject({ already_imported: 1, encounters: 1, error_count: 0 });

    const sourceHashes = await db.admin.query(
      "select source_row_number, normalized_row_hash from public.import_row_hash where base_id=$1 and hash_kind='source' and source_file_hash=$2 order by source_row_number",
      [baseId, h],
    );
    expect(sourceHashes.rows).toEqual([
      { source_row_number: 1, normalized_row_hash: 'src-ok-v1' },
      { source_row_number: 2, normalized_row_hash: 'src-fixed-v1' },
    ]);

    const n = await db.admin.query(
      `select count(*)::int n from public.encounter e join public.patient p on p.id = e.patient_id
       where p.base_id = $1 and p.patient_code in ('SRC77-OK','SRC77-FIX')`,
      [baseId],
    );
    expect(n.rows[0].n).toBe(2);
  });

  test('§7.8 rejouer un fichier corrige (NOUVEAU lot) ignore les lignes deja reussies, sans doublon', async () => {
    const h1 = 'b78-' + Date.now();
    // Lot 1 : 1 ligne OK + 1 ligne KO (hors bornes) -> completed_with_errors.
    const b1 = (await rowsAs(aliceId, BEGIN6, [baseId, h1, null, 'fill', 'draft', 2]))[0].id;
    await rowsAs(aliceId, CALL8, [baseId, J([
      row('B78-OK', enc('consultation', '2024-01-05', { diagnosis: 'ok', glasgow_score: 10 })),
      row('B78-KO', enc('consultation', '2024-01-06', { diagnosis: 'ko', glasgow_score: 99 })),
    ]), false, 'draft', 'fill', null, null, b1]);
    await rowsAs(aliceId, COMPLETE, [b1]);

    // Fichier CORRIGE (nouveau hash -> nouveau lot) : ligne OK identique + ligne KO corrigee.
    const b2 = (await rowsAs(aliceId, BEGIN6, [baseId, h1 + '-corr', null, 'fill', 'draft', 2]))[0].id;
    const rep = (await rowsAs(aliceId, CALL8, [baseId, J([
      row('B78-OK', enc('consultation', '2024-01-05', { diagnosis: 'ok', glasgow_score: 10 })), // deja importee -> ignoree
      row('B78-KO', enc('consultation', '2024-01-06', { diagnosis: 'ko', glasgow_score: 12 })), // corrigee -> importee
    ]), false, 'draft', 'fill', null, null, b2]))[0].report;
    expect(rep).toMatchObject({ already_imported: 1, encounters: 1, error_count: 0 });
    await rowsAs(aliceId, COMPLETE, [b2]); // les lignes ignorees comptent dans row_count -> cloture OK
    expect((await db.admin.query('select status from public.import_batch where id=$1', [b2])).rows[0].status).toBe('completed');

    // AUCUN doublon : exactement 1 rencontre par patient (pas 3 au total).
    const n = await db.admin.query(
      `select count(*)::int n from public.encounter e join public.patient p on p.id = e.patient_id
       where p.base_id = $1 and p.patient_code in ('B78-OK','B78-KO')`, [baseId]);
    expect(n.rows[0].n).toBe(2);
  });

  test('§7.8 rejouer un import AUTONOME ne duplique pas non plus (empreintes conservees) ; l apercu l annonce', async () => {
    const h = 'b78s-' + Date.now();
    const line = () => row('B78S-1', enc('consultation', '2024-02-01', { diagnosis: 'x', glasgow_score: 11 }));
    const r1 = (await rowsAs(aliceId, CALL7, [baseId, J([line()]), false, 'draft', 'fill', h, null]))[0].report;
    expect(r1.error_count).toBe(0);
    // APERCU d'un « autre » fichier au meme contenu : annonce la ligne deja importee AVANT commit.
    const prev = (await rowsAs(aliceId, CALL7, [baseId, J([line()]), true, 'draft', 'fill', h + '-b', null]))[0].report;
    expect(prev).toMatchObject({ already_imported: 1, encounters: 0 });
    // COMMIT : rien n'est re-cree.
    const r2 = (await rowsAs(aliceId, CALL7, [baseId, J([line()]), false, 'draft', 'fill', h + '-b', null]))[0].report;
    expect(r2).toMatchObject({ already_imported: 1, encounters: 0, error_count: 0 });
    const n = await db.admin.query(
      `select count(*)::int n from public.encounter e join public.patient p on p.id = e.patient_id
       where p.base_id = $1 and p.patient_code = 'B78S-1'`, [baseId]);
    expect(n.rows[0].n).toBe(1);
  });

  test('P1 idempotence : une rencontre deja importee n empeche pas la mise a jour patient', async () => {
    const h = 'idem-patient-' + Date.now();
    const sameEncounter = enc('consultation', '2024-03-01', { diagnosis: 'stable', glasgow_score: 11 });
    await rowsAs(aliceId, CALL7, [baseId, J([
      row('IDEM-PAT', sameEncounter, { sexe: 'M', birth_year: 1980 }),
    ]), false, 'draft', 'fill', h, null]);

    const rep = (await rowsAs(aliceId, CALL7, [baseId, J([
      row('IDEM-PAT', sameEncounter, { blood_group: 'A+' }),
    ]), false, 'draft', 'fill', h + '-corr', null]))[0].report;
    expect(rep).toMatchObject({ already_imported: 1, encounters: 0, patients_updated: 1, error_count: 0 });

    const p = (await db.admin.query("select data from public.patient where base_id=$1 and patient_code='IDEM-PAT'", [baseId])).rows[0].data;
    expect(p).toMatchObject({ sexe: 'M', birth_year: 1980, blood_group: 'A+' });
    const n = await db.admin.query(
      `select count(*)::int n from public.encounter e join public.patient p on p.id = e.patient_id
       where p.base_id = $1 and p.patient_code = 'IDEM-PAT'`, [baseId]);
    expect(n.rows[0].n).toBe(1);
  });

  test('§4.7 cloture refusee si row_count depasse expected_rows (chunk en double)', async () => {
    const h = 'b47-' + Date.now();
    const batchId = (await rowsAs(aliceId, BEGIN6, [baseId, h, null, 'fill', 'draft', 1]))[0].id; // 1 ligne attendue
    await rowsAs(aliceId, CALL8, [baseId, J([row('B47-1', null, { sexe: 'M' }), row('B47-2', null, { sexe: 'M' })]), false, 'draft', 'fill', null, null, batchId]);
    await expect(rowsAs(aliceId, COMPLETE, [batchId])).rejects.toThrow(/incomplet|incoherent/i);
  });

  test('§5.2 import curated d un patient EXISTANT : completude sur les donnees FUSIONNEES', async () => {
    // Patient existant COMPLET en curated (sexe + birth_year = champs requis du gabarit).
    await rowsAs(aliceId, CALL7, [baseId, J([row('MRG-1', null, { sexe: 'M', birth_year: 1980 })]), false, 'curated', 'fill', null, null]);
    // Re-import curated SANS repeter sexe/birth_year (juste une donnee de plus) : la fusion est
    // complete -> doit passer (avant le correctif, la completude portait sur le seul fragment -> erreur).
    const rep = (await rowsAs(aliceId, CALL7, [baseId, J([row('MRG-1', null, { blood_group: 'A+' })]), false, 'curated', 'fill', null, null]))[0].report;
    expect(rep.error_count).toBe(0);
    const p = (await db.admin.query("select data from public.patient where base_id=$1 and patient_code='MRG-1'", [baseId])).rows[0].data;
    expect(p).toMatchObject({ sexe: 'M', birth_year: 1980, blood_group: 'A+' });
  });

  test('P1 idempotence atomique : une empreinte inter-lots est unique par base', async () => {
    const tv = (await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id;
    const b1 = (await db.admin.query(
      "insert into public.import_batch(base_id, file_hash, template_version_id, imported_by, status) values($1,$2,$3,$4,'processing') returning id",
      [baseId, 'uniq-a-' + Date.now(), tv, aliceId],
    )).rows[0].id;
    const b2 = (await db.admin.query(
      "insert into public.import_batch(base_id, file_hash, template_version_id, imported_by, status) values($1,$2,$3,$4,'processing') returning id",
      [baseId, 'uniq-b-' + Date.now(), tv, aliceId],
    )).rows[0].id;

    await db.admin.query('insert into public.import_row_hash(batch_id, base_id, row_hash) values($1,$2,$3)', [b1, baseId, 'same-row']);
    await expect(
      db.admin.query('insert into public.import_row_hash(batch_id, base_id, row_hash) values($1,$2,$3)', [b2, baseId, 'same-row']),
    ).rejects.toThrow(/duplicate|unique/i);
  });
});
