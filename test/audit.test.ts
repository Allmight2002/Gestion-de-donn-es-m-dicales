// Tests DB de l'audit renforce (§14) : trace automatique des actions sensibles dans
// audit_log + lecture ciblee (proprietaire/auteur ; jamais un tiers).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;  // proprietaire
let annaId: string;   // analyste (can_export_data)
let bobId: string;    // membre sans acces (devient collaborateur)
let baseId: string;
let cohortId: string;
let tvId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const EXPORT_INSERT = `insert into public.export_log(cohort_id, template_versions, exported_by, format, export_options, patient_count, encounter_count, stored_file_path, file_hash)
  values($1, to_jsonb(array[$2::uuid]), auth.uid(), 'csv', '{}'::jsonb, 1, 1, 'p/x.csv', 'h1') returning id`;
const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)';

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  cohortId = (await db.admin.query("select id from public.cohort where cohort_type='snapshot' limit 1")).rows[0].id;
  tvId = (await db.admin.query('select current_template_version_id tv from public.base where id=$1', [baseId])).rows[0].tv;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('trace automatique des actions sensibles', () => {
  test('un export genere une trace export_created', async () => {
    const ex = await rowsAs(annaId, EXPORT_INSERT, [cohortId, tvId]);
    const exportId = ex[0].id;
    const audit = await db.admin.query("select user_id, base_id from public.audit_log where action='export_created' and entity_id=$1", [exportId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].user_id).toBe(annaId);
    expect(audit.rows[0].base_id).toBe(baseId);
  });

  test('accorder un acces genere une trace access_granted', async () => {
    await rowsAs(aliceId, "insert into public.base_access(base_id,user_id,access_role,granted_by) values($1,$2,'viewer',$3)", [baseId, bobId, aliceId]);
    const audit = await db.admin.query("select user_id from public.audit_log where action='access_granted' and base_id=$1 and (metadata->>'user_id')=$2", [baseId, bobId]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0].user_id).toBe(aliceId);
  });

  test('une suppression logique genere une trace patient_deleted', async () => {
    const p = await rowsAs(aliceId, CREATE_PAT, [baseId, 'AUD-001', 'A Suppr', '1980-01-01', null, null, null, 'granted', null, JSON.stringify({ sexe: 'M' })]);
    await rowsAs(aliceId, 'select public.soft_delete_patient($1,$2)', [p[0].id, 'doublon']);
    const audit = await db.admin.query("select action, metadata from public.audit_log where action='patient_deleted' and entity_id=$1", [p[0].id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.reason).toBe('doublon');
  });
});

describe('lecture ciblee de l audit (RLS)', () => {
  test('le proprietaire lit l audit de sa base ; un analyste ne voit pas la trace d un tiers', async () => {
    // Trace d'octroi d'acces (action du proprietaire) : visible par le proprietaire...
    expect((await rowsAs(aliceId, "select id from public.audit_log where action='access_granted' and base_id=$1", [baseId])).length).toBeGreaterThan(0);
    // ...mais PAS par l'analyste (ni auteur, ni proprietaire).
    expect(await rowsAs(annaId, "select id from public.audit_log where action='access_granted' and base_id=$1", [baseId])).toHaveLength(0);
  });
});
