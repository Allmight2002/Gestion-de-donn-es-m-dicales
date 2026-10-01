// Formulaires de saisie d'une base : configuration partagée, cloisonnée par la RLS, sans
// aucune donnée patient. Supprimer un formulaire ne touche ni au gabarit ni aux fiches.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let bobId: string;
let editorId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

const insertForm = (uid: string, name: string, keys: string[], required: string[] = []) => rowsAs(uid,
  `insert into public.base_entry_form (base_id, name, field_keys, required_keys)
   values ($1, $2, $3::text[], $4::text[]) returning id, row_version, created_by`,
  [baseId, name, keys, required]);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  annaId = users.get('anna.analyst@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  editorId = users.get('editor@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('base_entry_form', () => {
  test('le validateur SECURITY DEFINER du trigger reste inaccessible comme RPC', async () => {
    const rows = (await db.admin.query(
      `select has_function_privilege('anon', 'public.guard_base_entry_form()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.guard_base_entry_form()', 'execute') as authenticated`,
    )).rows;
    expect(rows).toEqual([{ anon: false, authenticated: false }]);
  });

  test('le propriétaire crée un formulaire ordonné ; auteur et version ne sont pas forgeables', async () => {
    const [created] = await rowsAs(aliceId,
      `insert into public.base_entry_form (base_id, name, field_keys, required_keys, row_version, created_by)
       values ($1, 'Saisie rapide', $2::text[], $3::text[], 99, $4) returning id, row_version, created_by, field_keys`,
      [baseId, ['blood_group', 'sexe'], ['sexe'], bobId]);
    expect(created.row_version).toBe('1');
    expect(created.created_by).toBe(aliceId);
    expect(created.field_keys).toEqual(['blood_group', 'sexe']);

    const [updated] = await rowsAs(aliceId,
      `update public.base_entry_form set field_keys = $2::text[], required_keys = '{}', row_version = 1
        where id = $1 and row_version = 1 returning row_version, field_keys`,
      [created.id, ['sexe', 'birth_year', 'blood_group']]);
    expect(updated.row_version).toBe('2');
    expect(updated.field_keys).toEqual(['sexe', 'birth_year', 'blood_group']);

    // Verrou optimiste : une écriture fondée sur une version périmée ne touche aucune ligne.
    expect(await rowsAs(aliceId,
      `update public.base_entry_form set name = 'Autre' where id = $1 and row_version = 1 returning id`,
      [created.id])).toEqual([]);
  });

  test('le serveur refuse les clés inconnues, dupliquées, hors fiche ou un requis hors formulaire', async () => {
    await expect(insertForm(aliceId, 'Inconnue', ['champ_inconnu'])).rejects.toThrow(/formulaire de saisie invalide/i);
    await expect(insertForm(aliceId, 'Doublon', ['sexe', 'sexe'])).rejects.toThrow(/formulaire de saisie invalide/i);
    await expect(insertForm(aliceId, 'Rencontre', ['glasgow_score'])).rejects.toThrow(/formulaire de saisie invalide/i);
    await expect(insertForm(aliceId, 'Vide', [])).rejects.toThrow(/check constraint|base_entry_form_keys_bounded/i);
    await expect(insertForm(aliceId, 'Requis', ['sexe'], ['birth_year'])).rejects.toThrow(/base_entry_form_required_subset/i);
    await expect(insertForm(aliceId, '  ', ['sexe'])).rejects.toThrow(/base_entry_form_name_valid/i);
    await expect(insertForm(aliceId, 'saisie RAPIDE', ['sexe'])).rejects.toThrow(/duplicate key|base_entry_form_name_unique/i);
  });

  test('un collaborateur lit les formulaires mais ne peut ni les créer, ni les modifier, ni les supprimer', async () => {
    expect((await rowsAs(editorId, 'select name from public.base_entry_form where base_id = $1', [baseId])).map((r) => r.name))
      .toEqual(['Saisie rapide']);
    expect(await rowsAs(annaId, 'select name from public.base_entry_form where base_id = $1', [baseId])).toHaveLength(1);
    await expect(insertForm(editorId, 'Sortie', ['sexe'])).rejects.toThrow(/row-level security|policy/i);
    expect(await rowsAs(editorId,
      `update public.base_entry_form set name = 'Piratage' where base_id = $1 returning id`, [baseId])).toEqual([]);
    expect(await rowsAs(editorId,
      'delete from public.base_entry_form where base_id = $1 returning id', [baseId])).toEqual([]);
  });

  test('un compte sans accès ne voit ni n’écrit rien', async () => {
    expect(await rowsAs(bobId, 'select id from public.base_entry_form where base_id = $1', [baseId])).toEqual([]);
    await expect(insertForm(bobId, 'Intrus', ['sexe'])).rejects.toThrow(/row-level security|policy/i);
  });

  test('supprimer un formulaire ne touche ni aux variables ni aux fiches', async () => {
    const fieldsBefore = (await db.admin.query('select count(*)::int as n from public.template_field')).rows[0].n;
    const dataBefore = (await db.admin.query(
      'select id, data, row_version from public.patient where base_id = $1 order by id', [baseId])).rows;
    expect(await rowsAs(aliceId,
      'delete from public.base_entry_form where base_id = $1 returning id', [baseId])).toHaveLength(1);
    expect((await db.admin.query('select count(*)::int as n from public.template_field')).rows[0].n).toBe(fieldsBefore);
    expect((await db.admin.query(
      'select id, data, row_version from public.patient where base_id = $1 order by id', [baseId])).rows).toEqual(dataBefore);
  });

  test('une saisie partielle crée une fiche brouillon sans exiger les requis du formulaire complet', async () => {
    // `birth_year` est requis au gabarit : un éditeur enregistre quand même un brouillon partiel,
    // et les variables non renseignées restent absentes (jamais « non » ou « normal »).
    const [created] = await rowsAs(editorId,
      `select (p).id, (p).data, (p).validation_status from (
         select public.create_patient($1, null, null, null, null, null, null, $2::jsonb) as p) s`,
      [baseId, JSON.stringify({ sexe: 'F' })]);
    expect(created.validation_status).toBe('draft');
    expect(created.data).toEqual({ sexe: 'F' });
  });
});
