import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let adminId: string;
let aliceId: string;
const rowsAs = (uid: string, sql: string, params?: unknown[]) => db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const RECORD = `select public.record_client_error(now(), $1, $2, $3, $4, $5, 'test-build', $6)`;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map((await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]));
  adminId = users.get('admin@demo.test')!;
  aliceId = users.get('alice@demo.test')!;
}, 180_000);
afterAll(async () => { await db?.stop(); });

describe('journal d incidents client', () => {
  test('RPC exposees uniquement a authenticated et helpers internes fermes', async () => {
    const privileges = (await db.admin.query(`select
      has_function_privilege('anon', 'public.record_client_error(timestamptz,text,text,text,text,text,text,text)', 'execute') as anon_record,
      has_function_privilege('authenticated', 'public.record_client_error(timestamptz,text,text,text,text,text,text,text)', 'execute') as auth_record,
      has_function_privilege('authenticated', 'public.list_recent_client_errors(integer,timestamptz,text)', 'execute') as auth_list,
      has_function_privilege('authenticated', 'public.scrub_client_error_text(text,integer)', 'execute') as auth_scrub,
      has_function_privilege('authenticated', 'public.purge_client_error_log()', 'execute') as auth_purge`)).rows[0];
    expect(privileges).toEqual({ anon_record: false, auth_record: true, auth_list: true, auth_scrub: false, auth_purge: false });
  });

  test('refuse toute lecture directe hors system_admin et toute ecriture directe', async () => {
    await expect(rowsAs(aliceId, 'select * from public.client_error_log')).rejects.toThrow(/permission denied/i);
    await expect(rowsAs(aliceId, `insert into public.client_error_log(occurred_at,last_occurred_at,user_id,error_name,error_message,context,fingerprint) values(now(),now(),$1,'Error','x','auth',repeat('a',64))`, [aliceId])).rejects.toThrow();
  });

  test('enregistre via RPC, expurge le contenu libre et regroupe les doublons', async () => {
    const raw = `Patient "Alice Martin" alice@example.test token Bearer abcdefghijklmnop 12345678`;
    await rowsAs(aliceId, RECORD, ['TypeError', raw, `Error: ${raw}\n    at save (https://app.test/x?token=secret)`, '<Patient value="Alice Martin" />', 'data-save', 'error']);
    await rowsAs(aliceId, RECORD, ['TypeError', raw, `Error: ${raw}\n    at save (https://app.test/x?token=secret)`, null, 'data-save', 'error']);
    const stored = (await db.admin.query('select error_message, stack, component_stack, occurrence_count from public.client_error_log where user_id=$1', [aliceId])).rows[0];
    expect(stored.error_message).toBe('Erreur technique cote client');
    expect(JSON.stringify(stored)).not.toContain('Alice Martin');
    expect(JSON.stringify(stored)).not.toContain('alice@example.test');
    expect(JSON.stringify(stored)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(stored)).not.toContain('12345678');
    expect(JSON.stringify(stored)).not.toContain('token=secret');
    expect(Number(stored.occurrence_count)).toBe(2);
  });

  test('seul system_admin lit par RPC et les parametres hors liste sont refuses', async () => {
    await expect(rowsAs(aliceId, 'select * from public.list_recent_client_errors(20, null, null)')).rejects.toThrow(/administrateur/i);
    await expect(rowsAs(aliceId, RECORD, ['Error', 'x', null, null, 'patient:Alice', 'error'])).rejects.toThrow(/contexte/i);
    const rows = await rowsAs(adminId, 'select * from public.list_recent_client_errors(20, null, null)');
    expect(rows).toHaveLength(1);
  });
});
