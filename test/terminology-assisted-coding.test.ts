// Codage terminologique assiste : socle PostgreSQL (20261001090000).
//
// Le serveur reste juge du code : la provenance accompagne le couple sans l'affaiblir, et un
// texte non code est enregistrable sans jamais compter comme un code. Donnees fictives.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let ownerId: string;

const URI = 'https://id.example.test/fic/02';
const HSD = { code: 'FIC.02', label: 'Hémorragie sousdurale non traumatique' };
const HIC = { code: 'FIC.00', label: 'Hémorragie intracérébrale' };
const coding = (over: Record<string, unknown> = {}) => ({
  method: 'ai_assisted',
  status: 'automatic',
  normalized: 'Hématome sous-dural chronique spontané droit',
  release: '2026-01',
  language: 'fr',
  score: 0.95,
  ...over,
});
const NON_CODE = { raw: 'Syndrome fictif de test', coding: { method: 'ai_assisted', status: 'unmatched' } };

const validate = (value: unknown, fieldKey = 'diag_unitaire') =>
  db.admin.query('select public.assert_data_valid($1, $2, $3::jsonb)', [
    versionId,
    'encounter',
    JSON.stringify({ [fieldKey]: value }),
  ]);
const validateList = (value: unknown) => validate(value, 'diag_liste');

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const base = (await db.admin.query(
    'select owner_user_id, current_template_version_id from public.base order by created_at limit 1',
  )).rows[0];
  ownerId = base.owner_user_id;
  versionId = base.current_template_version_id;
  const release = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-codage-assiste', 'Referentiel fictif', 'test', '2026-01', true, now()) returning id`,
  )).rows[0].id;
  await db.admin.query(
    `insert into public.terminology_concept(release_id, code, label, kind, is_selectable, uri) values
       ($1, 'FIC.02', 'Hémorragie sousdurale non traumatique', 'category', true, $2),
       ($1, 'FIC.07', 'Hémorragie sousdurale non traumatique du fœtus ou du nouveau-né', 'category', true, null),
       ($1, 'FIC.00', 'Hémorragie intracérébrale', 'category', true, null),
       ($1, 'FIC.99', 'Fracture du fémur', 'category', true, null),
       ($1, 'FIC.BL', 'Hémorragies sousdurales', 'block', false, null)`,
    [release, URI],
  );
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, is_multiple, required, display_order)
     values
       ($1, 'diag_unitaire', 'Diagnostic', 'encounter', 'clinique', 'terminology', false, false, 1950),
       ($1, 'diag_liste', 'Diagnostics', 'encounter', 'clinique', 'terminology', true, false, 1951)`,
    [versionId],
  );
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('codage assiste — validation des valeurs', () => {
  test('les valeurs historiques restent valides', async () => {
    await expect(validate(HSD)).resolves.toBeDefined();
    await expect(validateList([HSD, HIC])).resolves.toBeDefined();
  });

  test('texte d origine et provenance acceptes, URI coherente avec le concept', async () => {
    await expect(validate({ ...HSD, raw: 'HSD chronique spontané droit', coding: coding({ uri: URI }) }))
      .resolves.toBeDefined();
    await expect(validateList([{ ...HSD, raw: 'HSD', coding: coding() }, NON_CODE, HIC])).resolves.toBeDefined();
    for (const status of ['suggested', 'confirmed', 'manually_modified']) {
      await expect(validate({ ...HSD, raw: 'HSD', coding: coding({ status }) })).resolves.toBeDefined();
    }
  });

  test('un texte non code est enregistrable, seul ou en liste', async () => {
    await expect(validate(NON_CODE)).resolves.toBeDefined();
    await expect(validateList([NON_CODE])).resolves.toBeDefined();
    // Deux textes identiques ne sont pas un doublon de CODE.
    await expect(validateList([NON_CODE, NON_CODE])).resolves.toBeDefined();
  });

  test('le code reste verifie : un LLM ne peut pas faire entrer un code invente', async () => {
    await expect(validate({ code: 'ZZ.99', label: 'Maladie inventee', raw: 'x', coding: coding() }))
      .rejects.toThrow(/inconnu|conforme/i);
    await expect(validate({ ...HSD, coding: coding({ uri: 'https://id.example.test/autre' }) }))
      .rejects.toThrow(/inconnu|conforme/i);
    await expect(validate({ code: 'FIC.BL', label: 'Hémorragies sousdurales', coding: coding() }))
      .rejects.toThrow(/inconnu|conforme/i);
    await expect(validateList([{ ...HSD, raw: 'a', coding: coding() }, { ...HSD, raw: 'b', coding: coding() }]))
      .rejects.toThrow(/double/i);
  });

  test('une provenance mal formee ou incoherente est refusee, sans recopier la valeur', async () => {
    const invalid = [
      { ...HSD, coding: coding({ method: 'devin' }) },
      { ...HSD, coding: coding({ status: 'unmatched' }) },
      { ...HSD, coding: coding({ score: 1.5 }) },
      { ...HSD, coding: coding({ language: 'francais' }) },
      { ...HSD, coding: coding({ patient: 'Dupont' }) },
      { ...HSD, coding: 'automatic' },
      { ...HSD, raw: '', coding: coding() },
      { ...HSD, raw: 'x'.repeat(501), coding: coding() },
      { raw: 'texte', coding: coding({ status: 'automatic' }) },
      { raw: 'texte', coding: { ...NON_CODE.coding, uri: URI } },
    ];
    for (const value of invalid) {
      const error = await validate(value).then(() => null, (e: Error) => e);
      expect(error?.message, JSON.stringify(value)).toMatch(/provenance du codage invalide/i);
      expect(error?.message).not.toContain('Dupont');
    }
    await expect(validateList([HSD, { raw: 'texte' }])).rejects.toThrow(/requis/i);
    await expect(validate({ ...HSD, note: 'x' })).rejects.toThrow(/contenu inattendu/i);
  });
});

describe('codage assiste — regles et candidats', () => {
  test('contains_any saute un texte non code sans invalider la liste', async () => {
    const apply = async (value: unknown) => (await db.admin.query(
      `select public.rule_apply_op('contains_any', $1::jsonb, '["FIC.02"]') as hit`,
      [JSON.stringify(value)],
    )).rows[0].hit;
    expect(await apply([NON_CODE, { ...HSD, raw: 'HSD', coding: coding() }])).toBe(true);
    expect(await apply([NON_CODE])).toBe(false);
    expect(await apply(NON_CODE)).toBe(false);
  });

  test('les candidats se trouvent par mots, tirets et accords ignores', async () => {
    const rows = (await db.asUser(ownerId, async (c: Client) => (await c.query(
      'select code, label, uri, release_version, hits from public.match_terminology_candidates($1)',
      [['Hémorragie sous-durale non traumatique', 'hématomes sous-duraux']],
    )).rows));
    expect(rows[0]).toMatchObject({ code: 'FIC.02', uri: URI, release_version: '2026-01' });
    const codes = rows.map((r: { code: string }) => r.code);
    expect(codes).toContain('FIC.07');
    expect(codes).not.toContain('FIC.99');
    // Un regroupement non selectionnable n'est jamais propose.
    expect(codes).not.toContain('FIC.BL');
  });

  test('les candidats sont reserves aux comptes authentifies', async () => {
    const client = await db.admin;
    await client.query('begin');
    try {
      await client.query('set local role anon');
      await expect(client.query(`select * from public.match_terminology_candidates(array['hemorragie'])`))
        .rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('rollback');
    }
  });
});
