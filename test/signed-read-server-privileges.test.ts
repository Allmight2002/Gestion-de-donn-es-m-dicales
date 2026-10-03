import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let clientPrivileges: unknown[];
const migration = '20261003090000_signed_read_server_privileges.sql';
const clientAccess = `SELECT grantee, table_name, privilege_type
  FROM information_schema.table_privileges
  WHERE table_schema='public' AND table_name IN ('patient','audit_log')
    AND grantee IN ('anon','authenticated') ORDER BY 1,2,3`;

beforeAll(async () => {
  db = await startTestDb({ beforeMigration: migration, seed: true });
  clientPrivileges = (await db.admin.query(clientAccess)).rows;
  await db.admin.query(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
});
afterAll(async () => { await db?.stop(); });

test('server can read only the patient columns needed for signing', async () => {
  await db.admin.query('SET ROLE service_role');
  try {
    expect((await db.admin.query('SELECT id, base_id FROM public.patient LIMIT 1')).rowCount).toBe(1);
    await expect(db.admin.query('SELECT data FROM public.patient LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(db.admin.query('UPDATE public.patient SET data=data')).rejects.toMatchObject({ code: '42501' });
  } finally { await db.admin.query('RESET ROLE'); }
});

test('server can append the signing audit but cannot alter or delete it', async () => {
  const fixture = (await db.admin.query('SELECT p.id, p.base_id, b.owner_user_id FROM public.patient p JOIN public.base b ON b.id=p.base_id LIMIT 1')).rows[0];
  await db.admin.query('SET ROLE service_role');
  try {
    await db.admin.query(`INSERT INTO public.audit_log(user_id, action, entity, entity_id, base_id)
      VALUES ($1, 'attachment_read', 'attachment', $2, $3)`, [fixture.owner_user_id, fixture.id, fixture.base_id]);
    await expect(db.admin.query('DELETE FROM public.audit_log')).rejects.toMatchObject({ code: '42501' });
    await expect(db.admin.query("UPDATE public.audit_log SET action='forged'")).rejects.toMatchObject({ code: '42501' });
  } finally { await db.admin.query('RESET ROLE'); }
});

test('anonymous and authenticated grants are preserved', async () => {
  expect((await db.admin.query(clientAccess)).rows).toEqual(clientPrivileges);
});
