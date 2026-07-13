// Tests DB de l'etape 11 (export_log) : trace en AJOUT SEUL (immuable), RLS
// (can_curate pour ecrire ; jamais staff), critere 9.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let bobId: string;
let staffId: string;
let baseId: string;
let cohortId: string;
let tvId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const runAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rowCount);

const INSERT = `with upload as (
    select public.base_of_cohort($1) as base_id,
           public.base_of_cohort($1)::text || '/exports/' || gen_random_uuid()::text || '.csv' as path
  )
  insert into public.export_log(cohort_id, template_versions, exported_by, format, export_options, patient_count, encounter_count, stored_file_path, file_hash)
  select $1, to_jsonb(array[$2::uuid]), auth.uid(),'csv','{}'::jsonb,5,6,upload.path,'abc123' from upload returning id`;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  staffId = byEmail.get('admin@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  cohortId = (await db.admin.query("select id from public.cohort where cohort_type='snapshot' limit 1")).rows[0].id;
  tvId = (await db.admin.query('select current_template_version_id tv from public.base where id=$1', [baseId])).rows[0].tv;
});

afterAll(async () => {
  await db?.stop();
});

describe('export_log : generation uniquement serveur', () => {
  test('un analyste autorise a exporter ne peut pas creer directement une trace', async () => {
    await expect(rowsAs(annaId, INSERT, [cohortId, tvId])).rejects.toThrow();
  });

  test('un analyste autorise a exporter ne peut pas creer de ticket export', async () => {
    const path = `${baseId}/exports/${crypto.randomUUID()}.csv`;
    await expect(rowsAs(annaId, "select public.create_upload_ticket($1, 'scientific-exports', $2)", [baseId, path])).rejects.toThrow();
  });

  test('la generation serveur (service role) reste autorisee', async () => {
    const result = await db.admin.query(INSERT, [cohortId, tvId]);
    expect(result.rows).toHaveLength(1);
  });

  test('un viewer ne peut pas tracer un export', async () => {
    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,granted_by) values($1,$2,'viewer',$3)
       on conflict (base_id,user_id) do update set access_role='viewer', can_export_data=false, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    await expect(rowsAs(bobId, INSERT, [cohortId, tvId])).rejects.toThrow();
    expect(await rowsAs(bobId, 'select id from public.export_log where cohort_id=$1', [cohortId])).toHaveLength(0);
  });

  test('le staff ne voit pas les traces d export', async () => {
    expect(await rowsAs(staffId, 'select id from public.export_log where cohort_id=$1', [cohortId])).toHaveLength(0);
    expect((await rowsAs(aliceId, 'select id from public.export_log where cohort_id=$1', [cohortId])).length).toBeGreaterThan(0);
  });
});

describe('export_log : trace immuable (ajout seul)', () => {
  test('aucune mise a jour ni suppression possible', async () => {
    const id = (await db.admin.query(INSERT, [cohortId, tvId])).rows[0].id;
    // Pas de politique UPDATE/DELETE -> 0 ligne affectee (RLS), la trace reste intacte.
    expect(await runAs(aliceId, "update public.export_log set file_hash='HACK' where id=$1", [id])).toBe(0);
    expect(await runAs(aliceId, 'delete from public.export_log where id=$1', [id])).toBe(0);
    expect((await rowsAs(aliceId, 'select file_hash from public.export_log where id=$1', [id]))[0].file_hash).toBe('abc123');
  });
});
