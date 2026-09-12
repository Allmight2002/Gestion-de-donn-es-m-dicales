// UX-12(c) / L64 — recherche nominative auditee, dans une base, sans exposer l'identite.
//
// Ce que ces tests protegent : le nom ne sort jamais de l'operation — elle ne rend que des
// identifiants ; le role ET la permission sont exiges sur CETTE base ; un refus est
// indiscernable d'une recherche sans resultat ; le terme saisi n'entre pas dans le journal ;
// et une base voisine ne remonte jamais, meme pour un nom identique.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

/** Base d'Alice, deja peuplee par le seed : 10 patients « Patient Fictif N », codes NCH-00N. */
const BASE = '20000000-0000-0000-0000-000000000001';
const ALICE = '22222222-2222-2222-2222-222222222222'; // medecin, proprietaire
const EDITH = '55555555-5555-5555-5555-555555555555'; // medecin, can_view_identity = true
const ANNA = '44444444-4444-4444-4444-444444444444'; // medecin, can_view_identity = FALSE
const CURATEUR = '66666666-6666-6666-6666-666666666666'; // curateur, aucun acces
const BOB = '33333333-3333-3333-3333-333333333333'; // medecin, aucun acces a cette base

/** Base voisine de Bob, avec un homonyme : elle ne doit jamais remonter dans celle d'Alice. */
const AUTRE_BASE = '20000000-0000-0000-0000-0000000000f1';

let db: TestDb;

const as = (uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c) => (await c.query(sql, args)).rows);

const search = (uid: string, term: string, base = BASE, limit = 20, offset = 0) =>
  as(uid, 'select * from public.search_patient_ids_by_identity($1,$2,$3,$4)', [base, term, limit, offset]) as
    Promise<Array<{ patient_id: string; total: string }>>;

const codesOf = async (rows: Array<{ patient_id: string }>) => (await db.admin.query(
  'select patient_code from public.patient where id = any($1::uuid[]) order by patient_code',
  [rows.map((row) => row.patient_id)],
)).rows.map((row: { patient_code: string }) => row.patient_code);

const auditCount = async () => Number((await db.admin.query(
  "select count(*) from public.audit_log where action = 'identity_search'",
)).rows[0].count);

async function addPatient(base: string, code: string, fullName: string, owner: string) {
  await db.admin.query(
    'insert into public.patient_identity (base_id, patient_code, full_name, created_by) values ($1,$2,$3,$4)',
    [base, code, fullName, owner],
  );
  await db.admin.query(
    `insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values ($1,$2,'10000000-0000-0000-0000-0000000000a1','{}'::jsonb,'direct','draft',$3)`,
    [base, code, owner],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  // Un nom accentue et compose : sans normalisation, « andree » ne le trouverait pas.
  await addPatient(BASE, 'NCH-900', 'Élodie Fictive-Andrée', ALICE);
  // Un nom porteur de caracteres speciaux de motif : ils doivent rester du TEXTE.
  await addPatient(BASE, 'NCH-901', '100% Fictif_Test', ALICE);
  // Base voisine, homonyme exact : l'isolement ne doit pas dependre de l'ecran.
  await db.admin.query(
    'insert into public.base (id, name, specialty, owner_user_id, current_template_version_id) values ($1,$2,$3,$4,$5)',
    [AUTRE_BASE, 'Base voisine (fictive)', 'neurochirurgie', BOB, '10000000-0000-0000-0000-0000000000a1'],
  );
  await addPatient(AUTRE_BASE, 'VOI-001', 'Élodie Fictive-Andrée', BOB);
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('UX-12(c) — recherche nominative', () => {
  test('P05 — un medecin autorise retrouve un patient par son nom, sans recevoir ce nom', async () => {
    const rows = await search(ALICE, 'Patient Fictif');
    expect(rows.length).toBe(10);
    expect(Number(rows[0].total)).toBe(10);
    // L'operation ne rend que des identifiants : aucune colonne d'identite n'existe.
    expect(Object.keys(rows[0]).sort()).toEqual(['patient_id', 'total']);
    // L'ordre est celui du code, jamais celui du nom : la position d'une ligne ne doit pas
    // devenir un indice alphabetique sur une donnee que l'appel ne rend pas.
    expect(await codesOf(rows)).toEqual([
      'NCH-001', 'NCH-002', 'NCH-003', 'NCH-004', 'NCH-005',
      'NCH-006', 'NCH-007', 'NCH-008', 'NCH-009', 'NCH-010',
    ]);
  });

  test('la recherche ignore la casse et les accents, dans les deux sens', async () => {
    for (const terme of ['andree', 'ANDRÉE', 'élodie', 'ELODIE', 'fictive-andree']) {
      const rows = await search(ALICE, terme);
      expect(await codesOf(rows), terme).toEqual(['NCH-900']);
    }
  });

  test('le terme est du texte, jamais un motif', async () => {
    // `%` et `_` ne doivent pas se comporter comme des jokers : sinon un seul caractere
    // ramenerait toute la base, et la recherche deviendrait un listage d'identites.
    expect(await search(ALICE, '%%')).toEqual([]);
    expect(await codesOf(await search(ALICE, '100%'))).toEqual(['NCH-901']);
    expect(await codesOf(await search(ALICE, 'Fictif_Test'))).toEqual(['NCH-901']);
    expect(await search(ALICE, 'a_c')).toEqual([]);
  });

  test('un terme trop court ne declenche aucune recherche', async () => {
    const avant = await auditCount();
    expect(await search(ALICE, 'a')).toEqual([]);
    expect(await search(ALICE, '  ')).toEqual([]);
    // Ni resultat, ni ligne de journal : il ne s'est rien passe.
    expect(await auditCount()).toBe(avant);
  });

  test('P06 — role et permission sont exiges sur CETTE base, et un refus ressemble a une absence', async () => {
    const avant = await auditCount();
    // Medecin, mais sans droit d'identite sur cette base : c'est le cas que la decision vise.
    expect(await search(ANNA, 'Patient Fictif')).toEqual([]);
    // Curateur : le role ne le permet pas, quelle que soit la base.
    expect(await search(CURATEUR, 'Patient Fictif')).toEqual([]);
    // Medecin d'une autre base : aucun acces ici.
    expect(await search(BOB, 'Patient Fictif')).toEqual([]);
    // Base inexistante : meme reponse qu'un refus, pour ne pas en confirmer l'existence.
    expect(await search(ALICE, 'Patient Fictif', '20000000-0000-0000-0000-0000000000ff')).toEqual([]);
    // Aucun de ces appels n'a laisse de trace d'acces : il n'y a pas eu d'acces.
    expect(await auditCount()).toBe(avant);
  });

  test('un collaborateur medecin explicitement autorise obtient le meme resultat', async () => {
    expect(await codesOf(await search(EDITH, 'andree'))).toEqual(['NCH-900']);
  });

  test('une base voisine ne remonte jamais, meme pour un nom identique', async () => {
    const rows = await search(ALICE, 'Fictive-Andrée');
    expect(await codesOf(rows)).toEqual(['NCH-900']);
    // Et le proprietaire de la base voisine ne voit que la sienne.
    expect(await codesOf(await search(BOB, 'Fictive-Andrée', AUTRE_BASE))).toEqual(['VOI-001']);
  });

  test('la pagination est resolue par le serveur, avec un total stable', async () => {
    const premiere = await search(ALICE, 'Patient Fictif', BASE, 4, 0);
    const seconde = await search(ALICE, 'Patient Fictif', BASE, 4, 4);
    expect(premiere.length).toBe(4);
    expect(seconde.length).toBe(4);
    // Le total decrit l'ensemble, pas la page.
    expect(Number(premiere[0].total)).toBe(10);
    expect(Number(seconde[0].total)).toBe(10);
    // Aucune ligne repetee entre deux pages.
    expect(await codesOf(premiere)).toEqual(['NCH-001', 'NCH-002', 'NCH-003', 'NCH-004']);
    expect(await codesOf(seconde)).toEqual(['NCH-005', 'NCH-006', 'NCH-007', 'NCH-008']);
    // Une demande hors bornes est ramenee a un maximum, jamais honoree telle quelle.
    expect((await search(ALICE, 'Patient Fictif', BASE, 5000, 0)).length).toBe(10);
  });

  test('le journal consigne l\'acces, jamais le terme ni ce qu\'il a revele', async () => {
    const avant = await auditCount();
    await search(ALICE, 'Élodie');
    expect(await auditCount()).toBe(avant + 1);

    const ligne = (await db.admin.query(
      "select user_id, entity, entity_id, base_id, metadata from public.audit_log"
      + " where action = 'identity_search' order by created_at desc limit 1",
    )).rows[0];
    expect(ligne.user_id).toBe(ALICE);
    expect(ligne.entity).toBe('base');
    expect(ligne.base_id).toBe(BASE);
    expect(ligne.metadata).toEqual({});
    // Aucun terme, nulle part : ni dans la charge, ni dans une colonne annexe.
    const fuite = await db.admin.query(
      "select count(*) from public.audit_log where action = 'identity_search'"
      + " and (metadata::text ilike '%lodie%' or coalesce(entity,'') ilike '%lodie%')",
    );
    expect(Number(fuite.rows[0].count)).toBe(0);
  });

  test('la fonction est fermee aux visiteurs anonymes', async () => {
    const accorde = await db.admin.query(
      "select has_function_privilege('anon', $1, 'execute') as ok",
      ['public.search_patient_ids_by_identity(uuid,text,int,int)'],
    );
    expect(accorde.rows[0].ok).toBe(false);
    // L'aide de normalisation reste interne : elle n'est exposee a personne.
    const normalisation = await db.admin.query(
      "select has_function_privilege('authenticated', $1, 'execute') as ok",
      ['public.identity_search_normalize(text)'],
    );
    expect(normalisation.rows[0].ok).toBe(false);
  });
});
