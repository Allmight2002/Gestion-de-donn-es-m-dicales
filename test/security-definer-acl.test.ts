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
    const { inventory, signatures, serviceRoleSignatures } = loadFunctionPrivilegeInventory();
    expect(inventory.categories).toHaveLength(8);
    // +3 (L30) : les deux RPC de conversion des options, et update_template_field portant
    // p_allowed_options. Les ANCIENNES signatures restent listees et en service — un client
    // non rafraichi doit continuer d'appeler la sienne.
    // +1 (L31) : reorder_template_sections. Le reordonnancement passe par une RPC parce que
    // la liste doit contenir EXACTEMENT les sections de la version, ce qu'une ecriture
    // directe ne saurait garantir.
    // +1 (L20) : nouvelle surcharge update_template_field avec p_is_multiple.
    // +1 (L35) : nouvelle surcharge update_template_field avec p_formula. Meme raison qu'aux
    // lots precedents -- les signatures anterieures restent listees et en service, pour qu'une
    // copie non rafraichie de l'application continue d'appeler la sienne.
    // +2 (saisie hors-ligne O1) : replay_patient_create et replay_encounter_create. Le rejeu
    // des creations hors-ligne passe par des RPC securisees pour que l'idempotence, les droits,
    // les doublons et l'integrite restent controles par le serveur.
    expect(signatures).toHaveLength(114);
    expect(serviceRoleSignatures).toHaveLength(12);
    expect(new Set([...signatures, ...serviceRoleSignatures]).size).toBe(126);
  });

  test('interdit anon, refuse les derives et fixe tous les search_path', async () => {
    const functions = await db.admin.query<{
      signature: string;
      config: string[] | null;
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
      service_role_can_execute: boolean;
    }>(`
      select
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
        p.proconfig as config,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
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

    // Supabase hébergé rend service_role exécuteur de toutes les fonctions internes.
    // Ce pouvoir d'administration ne doit pas transformer chaque trigger en commande
    // Edge inventoriée ; seules les signatures Edge attendues sont exigées et cloisonnées.
    expect(functions.rows.some((row) => row.signature === 'handle_new_user()')).toBe(true);
    const hostedRoleInheritance = functions.rows.map((row) => ({ ...row, service_role_can_execute: true }));
    expect(inspectFunctionPrivileges(hostedRoleInheritance, privileges.rows[0])).toEqual([]);
  });

  test('le controle distant en lecture seule accepte le schema reconstruit', async () => {
    await expect(verifyFunctionPrivileges(db.url)).resolves.toBeGreaterThan(85);
  });
});
