// Préférences de présentation : persistance par compte/base et cloisonnement RLS.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let bobId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  annaId = users.get('anna.analyst@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('base_view_preference', () => {
  test('le validateur SECURITY DEFINER du trigger reste inaccessible comme RPC', async () => {
    const rows = (await db.admin.query(
      `select has_function_privilege('anon', 'public.guard_base_view_preference_keys()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.guard_base_view_preference_keys()', 'execute') as authenticated`,
    )).rows;
    expect(rows).toEqual([{ anon: false, authenticated: false }]);
  });

  test('le proprietaire peut enregistrer et relire son choix, y compris un tableau vide', async () => {
    await db.asUser(aliceId, async (client) => {
      await client.query(
        `insert into public.base_view_preference (base_id, user_id, visible_patient_field_keys)
         values ($1, $2, $3::text[])`,
        [baseId, aliceId, ['sexe']],
      );
    });

    expect(await rowsAs(aliceId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([{ visible_patient_field_keys: ['sexe'] }]);

    await db.asUser(aliceId, async (client) => {
      await client.query(
        `update public.base_view_preference
            set visible_patient_field_keys = $3::text[]
          where base_id = $1 and user_id = $2`,
        [baseId, aliceId, []],
      );
    });
    expect(await rowsAs(aliceId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([{ visible_patient_field_keys: [] }]);
  });

  test('le serveur refuse les clés inconnues, dupliquées ou hors portée patient', async () => {
    const invalid = async (keys: string[]) => rowsAs(aliceId,
      `update public.base_view_preference
          set visible_patient_field_keys = $3::text[]
        where base_id = $1 and user_id = $2`, [baseId, aliceId, keys]);

    await expect(invalid(['champ_inconnu']))
      .rejects.toThrow(/préférence|preference|invalide/i);
    await expect(invalid(['sexe', 'sexe']))
      .rejects.toThrow(/préférence|preference|invalide/i);
    await expect(invalid(['glasgow_score']))
      .rejects.toThrow(/préférence|preference|invalide/i);
    await db.asUser(aliceId, async (client) => {
      await client.query(
        `update public.base_view_preference
            set visible_patient_field_keys = $3::text[]
          where base_id = $1 and user_id = $2`,
        [baseId, aliceId, []],
      );
    });
  });

  test('un collaborateur ne voit et ne modifie que sa propre préférence', async () => {
    await db.asUser(annaId, async (client) => {
      await client.query(
        `insert into public.base_view_preference (base_id, user_id, visible_patient_field_keys)
         values ($1, $2, $3::text[])`,
        [baseId, annaId, ['birth_year']],
      );
    });

    expect(await rowsAs(annaId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([{ visible_patient_field_keys: ['birth_year'] }]);
    expect(await rowsAs(aliceId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([{ visible_patient_field_keys: [] }]);

    await expect(rowsAs(annaId,
      `insert into public.base_view_preference (base_id, user_id, visible_patient_field_keys)
       values ($1, $2, $3::text[])`, [baseId, aliceId, ['sexe']]))
      .rejects.toThrow(/row-level security|policy|permission/i);
  });

  test('un utilisateur sans accès ne peut ni lire ni écrire une préférence', async () => {
    expect(await rowsAs(bobId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([]);
    await expect(rowsAs(bobId,
      `insert into public.base_view_preference (base_id, user_id, visible_patient_field_keys)
       values ($1, $2, $3::text[])`, [baseId, bobId, ['sexe']]))
      .rejects.toThrow(/row-level security|policy|permission/i);
  });

  test('la révocation masque immédiatement la préférence', async () => {
    await db.admin.query(
      `update public.base_access
          set revoked_at = now()
        where base_id = $1 and user_id = $2`,
      [baseId, annaId],
    );
    expect(await rowsAs(annaId,
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1', [baseId]))
      .toEqual([]);
    await expect(rowsAs(annaId,
      `insert into public.base_view_preference (base_id, user_id, visible_patient_field_keys)
       values ($1, $2, $3::text[])`, [baseId, annaId, ['sexe']]))
      .rejects.toThrow(/row-level security|policy|permission/i);
    // UPDATE sans ligne visible peut être un no-op PostgreSQL ; il ne doit jamais
    // modifier la ligne révoquée, contrôlé ici via la connexion admin.
    await rowsAs(annaId,
      `update public.base_view_preference
          set visible_patient_field_keys = $3::text[]
        where base_id = $1 and user_id = $2`, [baseId, annaId, ['sexe']]);
    expect((await db.admin.query(
      'select visible_patient_field_keys from public.base_view_preference where base_id = $1 and user_id = $2',
      [baseId, annaId],
    )).rows).toEqual([{ visible_patient_field_keys: ['birth_year'] }]);
  });
});
