// Tests DB de l'etape 6 (patient) : separation identite/analytique, code unique,
// donnees permanentes, version par enregistrement, RLS (criteres 1, 5, 7).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire de la base de demo
let annaId: string; // analyste (analytique, sans identite)
let bobId: string; // membre SANS acces a la base
let baseId: string;
let publishedVersionId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const CALL = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const args = (code: string, data: object) => [
  baseId, code, 'Jean Fictif', '1980-05-15', '0102030405', 'Adresse fictive', 'EXT-' + code, JSON.stringify(data),
];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  publishedVersionId = (
    await db.admin.query('select current_template_version_id as tv from public.base where id = $1', [baseId])
  ).rows[0].tv;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('creation d un patient (proprietaire)', () => {
  test('cree identite + analytique lies par le seul code, avec version par enregistrement', async () => {
    const created = await rowsAs(aliceId, CALL, args('NEW-001', { sexe: 'M', birth_year: 1980, blood_group: 'O+' }));
    expect(created).toHaveLength(1);
    expect(created[0].patient_code).toBe('NEW-001');
    expect(created[0].template_version_id).toBe(publishedVersionId); // version par enregistrement (critere 7)
    expect(created[0].data.birth_year).toBe(1980); // donnees permanentes (critere 5)

    // Les deux zones existent, liees par le code (critere 1).
    const analytic = await rowsAs(aliceId, 'select id from public.patient where base_id=$1 and patient_code=$2', [baseId, 'NEW-001']);
    expect(analytic).toHaveLength(1);
    const ident = await rowsAs(aliceId, 'select full_name from public.get_patient_identity($1)', [analytic[0].id]);
    expect(ident).toHaveLength(1);
    expect(ident[0].full_name).toBe('Jean Fictif');
  });
});

describe('separation identite / analytique (§4)', () => {
  test("l'analyste voit l'analytique du patient mais PAS son identite", async () => {
    expect(await rowsAs(annaId, 'select id from public.patient where base_id=$1 and patient_code=$2', [baseId, 'NEW-001'])).toHaveLength(1);
    expect(await rowsAs(annaId, 'select full_name from public.patient_identity where base_id=$1 and patient_code=$2', [baseId, 'NEW-001'])).toHaveLength(0);
  });
});

describe('RLS sur la creation', () => {
  test("un analyste ne peut pas creer de patient (pas d'ecriture identite), sans ligne orpheline", async () => {
    await expect(rowsAs(annaId, CALL, args('ANALYST-X', { sexe: 'F' }))).rejects.toThrow();
    // Rollback atomique : aucune identite ni analytique creee.
    expect(await rowsAs(aliceId, 'select id from public.patient where base_id=$1 and patient_code=$2', [baseId, 'ANALYST-X'])).toHaveLength(0);
    expect((await db.admin.query('select id from public.patient_identity where base_id=$1 and patient_code=$2', [baseId, 'ANALYST-X'])).rows).toHaveLength(0);
  });

  test('un membre sans acces a la base ne peut pas creer de patient', async () => {
    await expect(rowsAs(bobId, CALL, args('BOB-X', { sexe: 'M' }))).rejects.toThrow();
  });
});

describe('code unique par base (critere 1)', () => {
  test('deux patients avec le meme code -> refus', async () => {
    await rowsAs(aliceId, CALL, args('DUP-001', { sexe: 'M' }));
    await expect(rowsAs(aliceId, CALL, args('DUP-001', { sexe: 'F' }))).rejects.toThrow();
  });
});
