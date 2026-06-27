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
const enc = (type: string, date: string, data: object) => ({ encounter_type: type, encounter_date: date, data });
const row = (code: string | null, encounter: object | null, patient_data: object = {}, identity: object | null = null) =>
  ({ patient_code: code, identity, patient_data, encounter });
const J = (arr: unknown[]) => JSON.stringify(arr);
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
});
