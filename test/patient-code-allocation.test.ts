import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let aliceId: string;
let bobId: string;
let annaId: string;
let templateVersionId: string;

const as = (uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, args)).rows);

const createPatientSql = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const createCurationSql = 'select * from public.create_patient_curation_submission($1,$2,$3,$4,$5,$6,$7,$8)';
const saveDraftSql = 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result';
const commitDraftSql = 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as result';

const createBase = async () => (
  await db.admin.query(
    `insert into public.base (name, specialty, owner_user_id, current_template_version_id)
     values ($1, 'l42-test', $2, $3)
     returning id`,
    [`L42-${randomUUID()}`, aliceId, templateVersionId],
  )
).rows[0].id as string;

const patientArgs = (baseId: string, name: string) => [
  baseId, null, name, '1990-01-01', null, null, null,
  JSON.stringify({ sexe: 'M', birth_year: 1990 }),
];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  annaId = users.get('anna.analyst@demo.test')!;
  templateVersionId = (await db.admin.query(
    'select current_template_version_id from public.base where owner_user_id=$1 limit 1',
    [aliceId],
  )).rows[0].current_template_version_id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('L42 allocation serveur des codes patients', () => {
  test('refuse l allocation a un utilisateur sans droit de creation et ne revele pas le compteur', async () => {
    const baseId = await createBase();

    await expect(as(bobId, 'select public.allocate_patient_code($1) as code', [baseId])).rejects.toThrow();
    await expect(as(annaId, 'select public.allocate_patient_code($1) as code', [baseId])).rejects.toThrow();

    const allocator = await db.admin.query(
      'select base_id, next_number from public.patient_code_allocator where base_id=$1',
      [baseId],
    );
    expect(allocator.rows).toHaveLength(0);
  });

  test('deux creations concurrentes sur la meme base obtiennent deux codes distincts', async () => {
    const baseId = await createBase();

    // Deux connexions et deux transactions distinctes sont lancees ensemble :
    // le verrou de la base doit serialiser l allocation sans collision.
    const outcomes = await Promise.all([
      as(aliceId, createPatientSql, patientArgs(baseId, 'Patient concurrent A')),
      as(aliceId, createPatientSql, patientArgs(baseId, 'Patient concurrent B')),
    ]);
    const codes = outcomes.map((rows) => rows[0].patient_code).sort();

    expect(codes).toEqual(['P-0001', 'P-0002']);
    expect((await db.admin.query(
      'select count(*)::int as count from public.patient where base_id=$1 and patient_code in ($2,$3)',
      [baseId, 'P-0001', 'P-0002'],
    )).rows[0].count).toBe(2);
    expect((await db.admin.query(
      'select count(*)::int as count from public.patient_identity where base_id=$1 and patient_code in ($2,$3)',
      [baseId, 'P-0001', 'P-0002'],
    )).rows[0].count).toBe(2);
  });

  test('une base deja peuplee reprend apres le dernier code numerique historique', async () => {
    const baseId = await createBase();
    await db.admin.query(
      `insert into public.patient_identity (base_id, patient_code, full_name, created_by)
       values ($1, 'P-0001', 'Patient historique 1', $2),
              ($1, 'P-0007', 'Patient historique 7', $2)`,
      [baseId, aliceId],
    );
    await db.admin.query(
      `insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
       values ($1, 'P-0001', $2, '{"sexe":"M","birth_year":1980}'::jsonb, 'direct', 'draft', $3),
              ($1, 'P-0007', $2, '{"sexe":"F","birth_year":1981}'::jsonb, 'direct', 'draft', $3)`,
      [baseId, templateVersionId, aliceId],
    );

    const created = await as(aliceId, createPatientSql, patientArgs(baseId, 'Patient après migration'));
    expect(created[0].patient_code).toBe('P-0008');
  });

  test('la soumission de curation utilise le meme allocateur serveur', async () => {
    const baseId = await createBase();
    const created = await as(aliceId, createCurationSql, [
      baseId, null, 'Patient curation', '1991-02-03', null, null, null, randomUUID(),
    ]);

    expect(created[0]).toMatchObject({ patient_code: 'P-0001', replayed: false });
  });

  test('le commit d un brouillon ignore un ancien code client et alloue cote serveur', async () => {
    const baseId = await createBase();
    const draftId = randomUUID();
    const saveOperationId = randomUUID();
    await as(aliceId, saveDraftSql, [
      draftId, baseId, 'patient_create', null, templateVersionId, null, 0, saveOperationId,
      JSON.stringify({ code: 'P-9999', values: { sexe: 'M', birth_year: 1990 } }),
    ]);

    const commit = await as(aliceId, commitDraftSql, [
      draftId, 1, randomUUID(), JSON.stringify({ fullName: 'Patient brouillon', dateOfBirth: '1992-03-04' }),
    ]);
    expect(commit[0].result).toMatchObject({ code: 'P-0001' });
    expect((await db.admin.query(
      'select patient_code from public.patient where base_id=$1 order by patient_code',
      [baseId],
    )).rows.map((row) => row.patient_code)).toEqual(['P-0001']);
  });
});
