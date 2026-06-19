// Tests DB de l'etape 7 cote serveur (cahier §4.1, critere 6) :
// l'age est CALCULE par le systeme depuis la DOB (zone restreinte) et n'est jamais
// saisi ; la date de naissance ne sort jamais (un editor sans acces identite obtient
// l'age sans voir la DOB).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let bobId: string; // deviendra editor SANS acces identite
let annaId: string; // analyste (lecture seule)
let staffId: string; // aucun acces base
let baseId: string;
let publishedVersionId: string;
let patientId: string;
let expectedAge: number;

const TEST_DATE = '2024-06-01';
const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const CALL = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';
const encArgs = (data: object, status = 'complete') => [patientId, 'consultation', TEST_DATE, status, JSON.stringify(data), 'years'];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  staffId = byEmail.get('admin@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  publishedVersionId = (
    await db.admin.query('select current_template_version_id as tv from public.base where id=$1', [baseId])
  ).rows[0].tv;

  const p = (await db.admin.query('select id, patient_code from public.patient where base_id=$1 limit 1', [baseId])).rows[0];
  patientId = p.id;
  expectedAge = (
    await db.admin.query(
      'select public.compute_age(date_of_birth, $2::date, $3) as age from public.patient_identity where base_id=$1 and patient_code=$4',
      [baseId, TEST_DATE, 'years', p.patient_code],
    )
  ).rows[0].age;

  // Bob devient editor SANS acces identite (peut saisir l'analytique, pas la DOB).
  await db.admin.query(
    `insert into public.base_access(base_id,user_id,access_role,can_view_identity,can_edit_structured_data,granted_by)
     values($1,$2,'editor',false,true,$3)`,
    [baseId, bobId, aliceId],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('age calcule (jamais saisi)', () => {
  test('le proprietaire cree une rencontre : age calcule, DOB absente des donnees, version par enregistrement', async () => {
    const r = await rowsAs(aliceId, CALL, encArgs({ glasgow_score: 12 }));
    expect(r).toHaveLength(1);
    // v3.0 : l'age est en COLONNE (age_value/age_unit), jamais dans data.
    expect(r[0].age_value).toBe(expectedAge);
    expect(r[0].age_unit).toBe('years');
    expect('age_at_encounter' in r[0].data).toBe(false);
    expect('date_of_birth' in r[0].data).toBe(false);
    expect(r[0].template_version_id).toBe(publishedVersionId);
    expect(r[0].validation_status).toBe('complete');
  });

  test("un editor SANS acces identite obtient l'age calcule sans voir la date de naissance (§4.1)", async () => {
    const r = await rowsAs(bobId, CALL, encArgs({ glasgow_score: 9 }));
    expect(r[0].age_value).toBe(expectedAge);
    // Preuve : Bob ne peut PAS lire la date de naissance.
    const ident = await rowsAs(bobId, 'select date_of_birth from public.patient_identity where base_id=$1', [baseId]);
    expect(ident).toHaveLength(0);
  });

  test("l'age fourni par le client est ignore (recalcule serveur, sorti des donnees)", async () => {
    const r = await rowsAs(bobId, CALL, encArgs({ age_at_encounter: 999, glasgow_score: 7 }));
    expect(r[0].age_value).toBe(expectedAge); // 999 ecrase
    expect('age_at_encounter' in r[0].data).toBe(false); // retire des donnees
    expect(r[0].data.glasgow_score).toBe(7);
  });
});

describe('validation serveur (§5.4/§5.5)', () => {
  test('une valeur hors bornes (Glasgow=78) est refusee cote serveur', async () => {
    await expect(rowsAs(aliceId, CALL, encArgs({ glasgow_score: 78 }))).rejects.toThrow(/maximum|glasgow/i);
  });
});

describe('RLS sur la saisie', () => {
  test('un analyste (lecture seule) ne peut pas creer de rencontre', async () => {
    await expect(rowsAs(annaId, CALL, encArgs({ glasgow_score: 10 }))).rejects.toThrow();
  });

  test('patient_age_at : acces analytique OK, hors base refuse', async () => {
    const age = await rowsAs(bobId, 'select public.patient_age_at($1,$2::date) as age', [patientId, TEST_DATE]);
    expect(age[0].age).toBe(expectedAge);
    await expect(rowsAs(staffId, 'select public.patient_age_at($1,$2::date) as age', [patientId, TEST_DATE])).rejects.toThrow();
  });
});
