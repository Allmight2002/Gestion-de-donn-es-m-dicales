// Format de la cle technique d'une variable (migration 20261011150000).
//
// L'ecran normalise la saisie ; le serveur refuse une cle nouvelle ou renommee hors format
// (`FIELD_KEY_INVALID`). Une cle existante hors format (`IMC`) reste utilisable : la
// modifier ailleurs que sur sa cle, ou recopier la version, n'est pas refuse.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';
import { normalizeFieldKey } from '../src/domain/fieldKey';

let db: TestDb;
let alice: string;
let version: string;

const as = <T = Record<string, unknown>>(uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c: Client) => {
    await c.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`);
    return (await c.query(sql, args)).rows as T[];
  });

/** Insertion directe, comme `templates.addField`. */
const insert = (key: string) => as(alice,
  `insert into public.template_field(template_version_id,field_key,label,scope,section,type,display_order)
   values ($1,$2,$2,'patient','clinique','number',10) returning field_key`, [version, key]);

/** RPC de l'editeur, attributs inchanges sauf la cle et le libelle. */
const save = (key: string, newKey: string, label?: string) => as(alice, `
  select (public.update_template_field(
    p_field_id => f.id, p_field_key => $3, p_label => coalesce($4, f.label),
    p_description => f.description, p_default_value => f.default_value, p_scope => f.scope,
    p_section => f.section, p_type => f.type, p_required => f.required, p_is_multiple => f.is_multiple,
    p_missing_reasons => f.missing_reasons, p_allowed_options => f.allowed_options,
    p_formula => f.formula, p_option_replacements => '{}'::jsonb, p_encounter_types => f.encounter_types,
    p_allowed_values => f.allowed_values, p_min_value => f.min_value, p_max_value => f.max_value,
    p_unit => f.unit)).field_key
    from public.template_field f where f.template_version_id = $1 and f.field_key = $2`,
  [version, key, newKey, label ?? null]);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  const template = (await db.admin.query(
    "insert into template(name,owner_user_id,is_global) values('Clés (fictif)',$1,false) returning id", [alice])).rows[0].id;
  version = (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
  // Cle anterieure a la regle, ecrite hors du chemin client.
  await db.admin.query(`insert into template_field(template_version_id,field_key,label,scope,section,type,display_order)
    values ($1,'IMC','IMC','patient','clinique','number',0)`, [version]);
});

afterAll(async () => { await db?.stop(); });

describe('normalizeFieldKey', () => {
  test.each([
    ['IMC', 'imc'],
    ['Date d’entrée', 'date_dentree'],
    ['  poids-kg ', 'poids_kg'],
    ['2e bilan', 'v_2e_bilan'],
    ['déjà_conforme', 'deja_conforme'],
    ['???', ''],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeFieldKey(raw)).toBe(expected);
  });

  test('la clé normalisée tient en 63 caractères', () => {
    expect(normalizeFieldKey('a'.repeat(80))).toHaveLength(63);
  });
});

describe('FIELD_KEY_INVALID', () => {
  test('une clé conforme est acceptée à la création', async () => {
    expect(await insert('taille_cm')).toEqual([{ field_key: 'taille_cm' }]);
  });

  test('une nouvelle clé hors format est refusée à la création directe', async () => {
    await expect(insert('Poids')).rejects.toThrow(/FIELD_KEY_INVALID/);
    await expect(insert('date-irm')).rejects.toThrow(/FIELD_KEY_INVALID/);
  });

  test('renommer vers une clé hors format est refusé', async () => {
    await expect(save('taille_cm', 'Taille')).rejects.toThrow(/FIELD_KEY_INVALID/);
  });

  test('une clé existante hors format reste modifiable sans être renommée', async () => {
    expect(await save('IMC', 'IMC', 'IMC (kg/m²)')).toEqual([{ field_key: 'IMC' }]);
    expect(await save('IMC', 'imc')).toEqual([{ field_key: 'imc' }]);
  });
});
