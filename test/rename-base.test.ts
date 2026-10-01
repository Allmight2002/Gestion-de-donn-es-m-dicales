// Renommer une base (migration 20260930140000_rename_base.sql).
//
// Ce que ces tests protegent : seul le proprietaire renomme sa base ; le nom est borne comme a
// la creation ; un renommage concurrent n'est jamais ecrase en silence ; un rejeu de la meme
// demande reussit sans reecrire ; rien d'autre que le nom ne change.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let alice: string;
let bob: string;

const renameAs = async (uid: string, baseId: string, name: string, expected: string) =>
  db.asUser(uid, async (c) => (await c.query<{ b: { name: string } }>(
    'select to_jsonb(public.rename_base($1, $2, $3)) as b', [baseId, name, expected])).rows[0].b);
const refusal = async (promise: Promise<unknown>) => {
  try { await promise; } catch (e) { return JSON.parse((e as { detail: string }).detail); }
  throw new Error('renommage accepte');
};
const baseRow = async (id: string) => (await db.admin.query(
  'select name, form_revision, current_template_version_id, observation_model from public.base where id=$1', [id])).rows[0];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = (await db.admin.query('select id, email from auth.users')).rows;
  alice = users.find((u) => u.email === 'alice@demo.test').id;
  bob = users.find((u) => u.email === 'bob@demo.test').id;
}, 240_000);

afterAll(async () => { await db?.stop(); });

const newBase = async (name: string) => (await db.admin.query(
  'insert into public.base(name, owner_user_id) values($1, $2) returning id', [name, alice])).rows[0].id as string;

describe('renommer une base', () => {
  test('le proprietaire renomme ; seul le nom change', async () => {
    const id = await newBase('Registre fictif');
    const before = await baseRow(id);
    expect((await renameAs(alice, id, '  Neurochirurgie (fictif)  ', 'Registre fictif')).name).toBe('Neurochirurgie (fictif)');
    expect(await baseRow(id)).toEqual({ ...before, name: 'Neurochirurgie (fictif)' });
  });

  test('un rejeu de la meme demande reussit sans reecrire ; un renommage concurrent est refuse', async () => {
    const id = await newBase('Avant');
    await renameAs(alice, id, 'Apres', 'Avant');
    // Rejeu : le nom demande est deja en place.
    expect((await renameAs(alice, id, 'Apres', 'Avant')).name).toBe('Apres');
    // Un autre onglet avait lu « Avant » et veut un autre nom : refus, rien d'ecrase.
    expect(await refusal(renameAs(alice, id, 'Autre', 'Avant')))
      .toEqual({ code: 'BASE_RENAME_CONFLICT', action: 'refresh_required' });
    expect((await baseRow(id)).name).toBe('Apres');
  });

  test('refus : nom vide ou trop long, autre compte, base supprimee', async () => {
    const id = await newBase('Stable');
    expect(await refusal(renameAs(alice, id, '   ', 'Stable'))).toEqual({ code: 'INVALID_BASE_NAME', field: 'name' });
    expect(await refusal(renameAs(alice, id, 'x'.repeat(121), 'Stable'))).toEqual({ code: 'INVALID_BASE_NAME', field: 'name' });
    expect(await refusal(renameAs(bob, id, 'Pirate', 'Stable'))).toEqual({ code: 'BASE_RENAME_FORBIDDEN' });
    await db.admin.query('update public.base set deleted_at = now() where id = $1', [id]);
    expect(await refusal(renameAs(alice, id, 'Tardif', 'Stable'))).toEqual({ code: 'BASE_RENAME_FORBIDDEN' });
    expect((await baseRow(id)).name).toBe('Stable');
  });
});
