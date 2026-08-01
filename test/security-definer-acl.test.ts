import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  inspectFunctionPrivileges,
  loadFunctionPrivilegeInventory,
  verifyFunctionPrivileges,
} from '../scripts/verify-function-privileges.mjs';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

describe('inventaire SECURITY DEFINER', () => {
  test('classe chaque signature autorisee sans doublon', () => {
    const { inventory, signatures } = loadFunctionPrivilegeInventory();
    expect(inventory.categories).toHaveLength(7);
    expect(signatures).toHaveLength(92); // P2 : restauration et corbeille du proprietaire.
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test('interdit anon, refuse les derives et fixe tous les search_path', async () => {
    const functions = await db.admin.query<{
      signature: string;
      config: string[] | null;
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
    }>(`
      select
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
        p.proconfig as config,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
      order by 1
    `);
    const privileges = await db.admin.query<{
      anon_can_create: boolean;
      authenticated_can_create: boolean;
    }>(`
      select
        has_schema_privilege('anon', 'public', 'CREATE') as anon_can_create,
        has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_can_create
    `);

    expect(inspectFunctionPrivileges(functions.rows, privileges.rows[0])).toEqual([]);
  });

  test('le controle distant en lecture seule accepte le schema reconstruit', async () => {
    await expect(verifyFunctionPrivileges(db.url)).resolves.toBeGreaterThan(85);
  });
});
