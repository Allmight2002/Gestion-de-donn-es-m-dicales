// Tests DB du type de variable « heure » (20261003090000) : format strict HH:MM[:SS],
// distinct de la date et heure, valeur proposee, comparaison des regles et creation de gabarit.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;

const assertValid = (data: object) =>
  db.admin.query(`select public.assert_data_valid($1, 'encounter', $2::jsonb)`, [versionId, JSON.stringify(data)]);

const insertField = (fieldKey: string, defaultValue: string | null) =>
  db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, required, allow_missing_codes, display_order, default_value)
     values ($1, $2, $2, 'encounter', 'clinique', 'time', false, true, 120, $3)`,
    [versionId, fieldKey, defaultValue],
  );

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  versionId = (
    await db.admin.query('select current_template_version_id as tv from public.base where id=$1', [baseId])
  ).rows[0].tv;
  await insertField('heure_incision', null);
});

afterAll(async () => {
  await db?.stop();
});

describe('type heure', () => {
  test('format strict HH:MM ou HH:MM:SS', async () => {
    const check = async (v: string) =>
      (await db.admin.query('select public.is_strict_time_text($1) as ok', [v])).rows[0].ok;
    for (const ok of ['00:00', '08:30', '23:59', '23:59:59']) expect(await check(ok)).toBe(true);
    for (const ko of ['24:00', '8:30', '12:60', '12:30:60', '2024-01-01T10:00', '10:00Z', '']) {
      expect(await check(ko)).toBe(false);
    }
  });

  test('la validation accepte une heure et refuse une date et heure', async () => {
    await expect(assertValid({ heure_incision: '14:05' })).resolves.toBeDefined();
    await expect(assertValid({ heure_incision: '2024-06-01T14:05' })).rejects.toThrow(/Heure invalide/);
    await expect(assertValid({ heure_incision: '25:00' })).rejects.toThrow(/Heure invalide/);
    await expect(assertValid({ heure_incision: 1405 })).rejects.toThrow(/Texte JSON attendu/);
  });

  test('valeur proposee : jeton de saisie ou heure stricte', async () => {
    await expect(insertField('heure_admission', '__now__')).resolves.toBeDefined();
    await expect(insertField('heure_visite', '08:00')).resolves.toBeDefined();
    await expect(insertField('heure_bad', '8h')).rejects.toThrow(/une heure HH:MM est attendue/);
  });

  test('les regles comparent deux heures, avec ou sans secondes', async () => {
    const cmp = async (a: string, b: string) =>
      (await db.admin.query('select public.rule_cmp(to_jsonb($1::text), to_jsonb($2::text)) as c', [a, b])).rows[0].c;
    expect(await cmp('08:30', '14:00')).toBe(-1);
    expect(await cmp('14:00', '08:30')).toBe(1);
    expect(await cmp('08:30', '08:30:00')).toBe(0);
    // Inchange pour les dates et les nombres.
    expect(await cmp('2024-01-02', '2024-01-01')).toBe(1);
    expect(await cmp('10', '9')).toBe(1);
  });
});
