// Lot P1 : borne de requête (1 Mio) distincte de la borne de stockage (4 Mio), et
// équivalence stricte des comparaisons source/candidat réécrites en ensembliste.
// Les anciennes définitions sont recréées sous des noms de test, dans la base
// embarquée jetable uniquement, à partir du texte des migrations d'origine.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

type Json = Record<string, unknown>;
type Definition = {
  sections: Json[];
  commonGroups: Json[];
  fields: Json[];
  rules: Json[];
  diagnosisConfiguration: unknown;
  [key: string]: unknown;
};
type Outcome = { result: unknown } | { error: { message: string; code?: string; detail?: string } };

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const REQUEST_MAX_BYTES = 1_048_576;
const STORAGE_MAX_BYTES = 4_194_304;

let db: TestDb;
let aliceId: string;
let baseId: string;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Anciennes définitions extraites des migrations d'origine
// ---------------------------------------------------------------------------
const OLD_FUNCTIONS: Array<[file: string, name: string]> = [
  ['20260916110000_form_preparation_hardening.sql', 'form_preparation_normalize'],
  ['20260916110000_form_preparation_hardening.sql', 'form_preparation_classify'],
  ['20260916130000_form_preparation_apply.sql', 'form_preparation_apply_assert_definition'],
  ['20260916130000_form_preparation_apply.sql', 'form_preparation_apply_classify'],
  ['20260916130000_form_preparation_apply.sql', 'form_preparation_apply_impact'],
];

function extractFunction(file: string, name: string): string {
  const text = readFileSync(join(MIGRATIONS, file), 'utf8');
  const header = `create or replace function public.${name}(`;
  const start = text.indexOf(header);
  if (start < 0 || text.indexOf(header, start + 1) >= 0) {
    throw new Error(`Définition unique introuvable : ${name} dans ${file}`);
  }
  const open = text.indexOf('$$', start);
  const close = text.indexOf('$$', open + 2);
  return `${text.slice(start, close + 2)};`;
}

function oldDefinitionsSql(): string {
  return OLD_FUNCTIONS.map(([file, name]) => {
    let sql = extractFunction(file, name);
    for (const [, other] of OLD_FUNCTIONS) {
      sql = sql.split(`public.${other}(`).join(`public.test_old_${other}(`);
    }
    return sql;
  }).join('\n\n');
}

async function outcome(sql: string, params: unknown[]): Promise<Outcome> {
  try {
    return { result: (await db.admin.query(sql, params)).rows[0]?.result ?? null };
  } catch (err) {
    const e = err as { message: string; code?: string; detail?: string };
    return { error: { message: e.message, code: e.code, detail: e.detail } };
  }
}

const pair = (fn: string, args: string) => [
  `select public.test_old_${fn}(${args}) as result`,
  `select public.${fn}(${args}) as result`,
] as const;

// ---------------------------------------------------------------------------
// Jeux fictifs
// ---------------------------------------------------------------------------
const TYPES = ['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology'];

function syntheticDefinition(fieldCount: number, sectionCount: number, ruleCount: number): Definition {
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    sectionKey: `rubrique_${String(i).padStart(3, '0')}`,
    label: `Rubrique clinique ${i + 1} — antécédents, examen et suivi`,
    displayOrder: i,
    parentSectionKey: i > 4 && i % 7 === 0 ? 'rubrique_000' : null,
    sourceSectionKey: null,
  }));
  const fields = Array.from({ length: fieldCount }, (_, i) => {
    const type = TYPES[i % TYPES.length];
    const choices = type === 'select' || type === 'multiselect'
      ? Array.from({ length: 4 + (i % 9) }, (_, j) => `choix_${j}`)
      : null;
    return {
      fieldKey: `variable_${String(i).padStart(4, '0')}`,
      label: `Variable fictive ${i + 1} : mesure ou observation clinique standardisée`,
      scope: i % 3 === 0 ? 'patient' : 'encounter',
      sectionKey: sections[i % sectionCount].sectionKey,
      type,
      unit: type === 'number' ? 'mg/L' : null,
      allowedValues: choices,
      required: i % 11 === 0,
      minValue: type === 'number' || type === 'integer' ? 0 : null,
      maxValue: type === 'number' || type === 'integer' ? 1000 : null,
      allowMissingCodes: true,
      displayOrder: i,
      encounterTypes: i % 3 === 0 ? null : ['consultation', 'hospitalisation'],
      description: `Description fictive de la variable ${i + 1}, précisant la méthode de recueil, la source documentaire et l’unité attendue.`,
      defaultValue: null,
      missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
      allowedOptions: choices ? choices.map((code, j) => ({ code, label: `Libellé du choix ${j + 1}` })) : null,
      isMultiple: type === 'multiselect',
      formula: null,
      commonGroupKey: null,
    };
  });
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    rule: {
      kind: i % 2 === 0 ? 'range' : 'required_if',
      target: fields[i % fieldCount].fieldKey,
      when: { field: fields[(i * 7) % fieldCount].fieldKey, op: i % 3 === 0 ? 'eq' : 'gt', value: i % 50 },
    },
    message: `Contrôle fictif ${i + 1} : vérifier la cohérence de la saisie.`,
    severity: i % 4 === 0 ? 'block' : 'warn',
  }));
  return {
    sections,
    commonGroups: [
      { groupKey: 'commun_general', label: 'Informations générales', displayOrder: 0, anchorOrder: 0, isDefault: true },
      { groupKey: 'commun_suivi', label: 'Suivi', displayOrder: 1, anchorOrder: 1, isDefault: false },
    ],
    fields,
    rules,
    diagnosisConfiguration: [
      { scope: 'patient', diagnosisFieldKey: fields[1].fieldKey, commonOnlyCodes: ['code_a', 'code_b'] },
      { scope: 'encounter', diagnosisFieldKey: fields[2].fieldKey, commonOnlyCodes: [] },
    ],
  };
}

function newField(key: string, extra: Json = {}): Json {
  return {
    fieldKey: key, label: 'Variable ajoutée', scope: 'patient', sectionKey: null, type: 'text', unit: null,
    allowedValues: null, required: false, minValue: null, maxValue: null, allowMissingCodes: true,
    displayOrder: 9999, encounterTypes: null, description: null, defaultValue: null,
    missingReasons: null, allowedOptions: null, isMultiple: false, formula: null, commonGroupKey: null,
    ...extra,
  };
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

// Cas générés à partir d'une définition : [nom, source, candidat].
function generatedCases(base: Definition): Array<[string, Definition, Definition]> {
  const cases: Array<[string, Definition, Definition]> = [];
  const add = (name: string, mutate: (source: Definition, candidate: Definition) => void) => {
    const source = clone(base);
    const candidate = clone(base);
    mutate(source, candidate);
    cases.push([name, source, candidate]);
  };
  const firstSection = () => (base.sections[0]?.sectionKey as string | undefined) ?? null;

  add('identique', () => {});
  add('ajout facultatif', (_s, c) => { c.fields.push(newField('zz_ajout', { sectionKey: firstSection() })); });
  add('ajout obligatoire', (_s, c) => { c.fields.push(newField('zz_obligatoire', { required: true, sectionKey: firstSection() })); });
  add('ajout avec défaut', (_s, c) => { c.fields.push(newField('zz_defaut', { defaultValue: 'x', sectionKey: firstSection() })); });
  add('ajout obligatoire non booléen', (_s, c) => { c.fields.push(newField('zz_cast', { required: 'peut-etre' })); });
  add('suppression', (_s, c) => { c.fields.shift(); });
  add('modification sémantique', (_s, c) => { if (c.fields[0]) c.fields[0].type = c.fields[0].type === 'text' ? 'number' : 'text'; });
  add('modification de présentation', (_s, c) => {
    if (c.fields[0]) Object.assign(c.fields[0], { label: 'Nouveau libellé', description: 'Autre', displayOrder: 12345 });
  });
  add('déplacement vers une autre section', (_s, c) => {
    if (c.fields[0] && base.sections[1]) c.fields[0].sectionKey = base.sections[1].sectionKey;
  });
  add('transition UX-16 vers commun', (_s, c) => { if (c.fields[0]) c.fields[0].sectionKey = null; });
  add('transition UX-16 vers section', (s, c) => {
    if (s.fields[0]) s.fields[0].sectionKey = '';
    if (c.fields[0]) c.fields[0].sectionKey = firstSection();
  });
  add('allowedValues sur-ensemble', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedValues = ['a', 'b', 'c'];
    c.fields[0].allowedValues = ['c', 'a', 'b', 'd'];
  });
  add('allowedValues non sous-ensemble', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedValues = ['a', 'b', 'c'];
    c.fields[0].allowedValues = ['a', 'b'];
  });
  add('allowedValues null puis tableau', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedValues = null;
    c.fields[0].allowedValues = ['a'];
  });
  add('allowedValues tableau puis null', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedValues = ['a'];
    c.fields[0].allowedValues = null;
  });
  add('allowedOptions sur-ensemble', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedOptions = [{ code: 'a', label: 'A' }];
    c.fields[0].allowedOptions = [{ code: 'b', label: 'B' }, { code: 'a', label: 'A' }];
  });
  add('allowedOptions non sous-ensemble', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedOptions = [{ code: 'a', label: 'A' }];
    c.fields[0].allowedOptions = [{ code: 'a', label: 'A modifié' }];
  });
  add('allowedOptions non tableau', (s, c) => {
    if (!s.fields[0]) return;
    s.fields[0].allowedOptions = { code: 'a' };
    c.fields[0].allowedOptions = [{ code: 'a' }];
  });
  add('règle dupliquée dans le candidat', (_s, c) => { if (c.rules[0]) c.rules.push(clone(c.rules[0])); });
  add('règle dupliquée dans la source', (s) => { if (s.rules[0]) s.rules.push(clone(s.rules[0])); });
  add('règle nouvelle dupliquée', (_s, c) => {
    const rule = { rule: { kind: 'nouvelle' }, message: null, severity: 'warn' };
    c.rules.push(rule, clone(rule));
  });
  add('règle modifiée', (_s, c) => { if (c.rules[0]) c.rules[0].message = 'Message modifié'; });
  add('règle supprimée', (_s, c) => { c.rules.pop(); });
  add('règle numériquement égale', (s, c) => {
    s.rules.push({ rule: { kind: 'seuil', value: 1 }, message: null, severity: 'warn' });
    c.rules.push({ rule: { kind: 'seuil', value: 1.0 }, message: null, severity: 'warn' });
  });
  add('diagnostic non tableau (candidat)', (_s, c) => { c.diagnosisConfiguration = { scope: 'patient' }; });
  add('diagnostic non tableau (source)', (s) => { s.diagnosisConfiguration = { scope: 'patient' }; });
  add('diagnostic dupliqué et ajouté', (_s, c) => {
    const entries = asArray(c.diagnosisConfiguration);
    const key = (base.fields[0]?.fieldKey as string | undefined) ?? 'x';
    entries.push(
      { scope: 'patient', diagnosisFieldKey: key, commonOnlyCodes: ['a', 'b', 'c'] },
      { scope: 'patient', diagnosisFieldKey: key, commonOnlyCodes: ['a'] },
      { scope: 'patient', diagnosisFieldKey: key, commonOnlyCodes: ['a'] },
    );
    c.diagnosisConfiguration = entries;
  });
  add('diagnostic supprimé', (_s, c) => { c.diagnosisConfiguration = asArray(c.diagnosisConfiguration).slice(1); });
  add('clé de variable vide en tête', (_s, c) => { c.fields.unshift(newField('')); });
  add('clé de variable vide après ajouts', (_s, c) => { c.fields.push(newField('zz_obligatoire', { required: true }), newField('')); });
  add('clé de variable nulle', (_s, c) => { c.fields.push(newField('zz_x', { fieldKey: null })); });
  add('clé de section vide', (_s, c) => { c.sections.push({ sectionKey: '', label: 'Vide' }); });
  add('clé de section vide après ajout', (_s, c) => {
    c.sections.push({ sectionKey: 'zz_rubrique', label: 'Nouvelle' }, { label: 'Sans clé' });
  });
  add('clé de groupe vide', (_s, c) => { c.commonGroups.push({ groupKey: '', label: 'Vide' }); });
  add('section ajoutée, modifiée et supprimée', (_s, c) => {
    if (c.sections[0]) c.sections[0].parentSectionKey = 'autre';
    c.sections.pop();
    c.sections.push({ sectionKey: 'zz_rubrique', label: 'Nouvelle', displayOrder: 99, parentSectionKey: null });
  });
  add('section présentation seulement', (_s, c) => { if (c.sections[0]) c.sections[0].label = 'Renommée'; });
  add('groupes communs ajoutés, modifiés et supprimés', (s, c) => {
    s.commonGroups.push({ groupKey: 'g_a', label: 'A', isDefault: false }, { groupKey: 'g_b', label: 'B', isDefault: false });
    c.commonGroups.push({ groupKey: 'g_a', label: 'A renommé', isDefault: true }, { groupKey: 'g_c', label: 'C', isDefault: false });
  });
  add('clés de variable dupliquées dans la source', (s) => {
    if (!s.fields[0]) return;
    s.fields.push({ ...clone(s.fields[0]), type: 'boolean' });
    s.fields.unshift({ ...clone(s.fields[0]), label: 'Premier doublon' });
  });
  add('clés de variable dupliquées dans le candidat', (_s, c) => {
    if (!c.fields[0]) return;
    c.fields.push({ ...clone(c.fields[0]), type: 'boolean' }, newField('zz_dup'), newField('zz_dup', { scope: 'encounter' }));
  });
  add('clé source nulle', (s) => { s.fields.push(newField('zz_source', { fieldKey: null })); });
  add('élément source non objet', (s) => { s.fields.push('variable' as unknown as Json); s.rules.push(42 as unknown as Json); });
  add('tableaux candidats vides', (_s, c) => {
    c.fields = [];
    c.sections = [];
    c.commonGroups = [];
    c.rules = [];
    c.diagnosisConfiguration = [];
  });
  add('variable avec section inconnue', (_s, c) => { c.fields.push(newField('zz_inconnue', { sectionKey: 'section_inexistante' })); });
  add('variable avec groupe inconnu', (_s, c) => { c.fields.push(newField('zz_groupe', { commonGroupKey: 'groupe_inexistant' })); });
  add('variable à deux emplacements', (_s, c) => {
    c.commonGroups.push({ groupKey: 'zz_groupe', label: 'Groupe' });
    c.fields.push(newField('zz_double', { sectionKey: firstSection(), commonGroupKey: 'zz_groupe' }));
  });
  add('anomalies multiples, défaut en premier', (_s, c) => {
    c.fields.unshift(newField('aa_defaut', { defaultValue: 'x' }), newField('ab_section', { sectionKey: 'section_inexistante' }));
  });
  add('anomalies multiples, section en premier', (_s, c) => {
    c.fields.unshift(newField('aa_section', { sectionKey: 'section_inexistante' }), newField('ab_defaut', { defaultValue: 'x' }));
  });
  add('section enfant d’une section enfant', (_s, c) => {
    c.sections.push(
      { sectionKey: 'zz_parent', label: 'Parent', parentSectionKey: null },
      { sectionKey: 'zz_enfant', label: 'Enfant', parentSectionKey: 'zz_parent' },
      { sectionKey: 'zz_petit_enfant', label: 'Petit enfant', parentSectionKey: 'zz_enfant' },
    );
  });
  add('section parente inconnue', (_s, c) => { c.sections.push({ sectionKey: 'zz_orphelin', label: 'Orphelin', parentSectionKey: 'absente' }); });
  add('section parente valide', (_s, c) => {
    c.sections.push({ sectionKey: 'zz_parent', label: 'Parent' }, { sectionKey: 'zz_enfant', label: 'Enfant', parentSectionKey: 'zz_parent' });
  });
  add('règle et variable mal formées', (_s, c) => {
    c.rules.push({ rule: 'texte', severity: 'info' });
    c.fields.push(newField('zz_forme', { scope: 'inconnu' }));
  });
  add('règle mal formée seule', (_s, c) => { c.rules.push({ rule: {}, severity: 'info' }); });
  add('diagnostic mal formé', (_s, c) => {
    c.diagnosisConfiguration = [...asArray(c.diagnosisConfiguration), { scope: 'patient', diagnosisFieldKey: 'x', commonOnlyCodes: [1] }];
  });
  add('deux groupes par défaut', (_s, c) => {
    c.commonGroups.push({ groupKey: 'zz_a', label: 'A', isDefault: true }, { groupKey: 'zz_b', label: 'B', isDefault: true });
  });
  add('section dupliquée', (_s, c) => { if (c.sections[0]) c.sections.push(clone(c.sections[0])); });
  return cases;
}

async function sourceDefinition(versionId: string): Promise<Definition> {
  return (await db.admin.query('select public.form_preparation_source_definition($1) as d', [versionId])).rows[0].d as Definition;
}

// Compare ancienne et nouvelle version des quatre fonctions sur un couple.
async function compareAll(source: unknown, candidate: unknown, normalizeCandidate: boolean) {
  const s = JSON.stringify(source);
  let c = JSON.stringify(candidate);
  if (normalizeCandidate) {
    const normalized = await outcome('select public.form_preparation_normalize($1::jsonb) as result', [c]);
    if ('result' in normalized) c = JSON.stringify(normalized.result);
  }
  const results: Array<[string, Outcome, Outcome]> = [];
  for (const [fn, args, params] of [
    ['form_preparation_classify', '$1::jsonb, $2::jsonb', [s, c]],
    ['form_preparation_apply_classify', '$1::jsonb, $2::jsonb', [s, c]],
    ['form_preparation_apply_assert_definition', '$1::jsonb, $2::jsonb', [s, c]],
  ] as const) {
    const [oldSql, newSql] = pair(fn, args);
    results.push([fn, await outcome(oldSql, [...params]), await outcome(newSql, [...params])]);
  }
  // L'impact reçoit la même classification des deux côtés (elle n'est que recopiée).
  const classification = results[1][2];
  const classificationJson = JSON.stringify('result' in classification ? classification.result : {});
  const [oldImpact, newImpact] = pair('form_preparation_apply_impact', '$1::uuid, $2::jsonb, $3::jsonb, $4::jsonb');
  results.push([
    'form_preparation_apply_impact',
    await outcome(oldImpact, [baseId, s, c, classificationJson]),
    await outcome(newImpact, [baseId, s, c, classificationJson]),
  ]);
  return results;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const ids = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = ids.get('alice@demo.test')!;
  baseId = (await db.admin.query(
    'select id from public.base where owner_user_id=$1 and deleted_at is null order by created_at limit 1', [aliceId],
  )).rows[0].id;
  await db.admin.query(oldDefinitionsSql());
}, 180_000);

afterAll(async () => { await db?.stop(); });

// ---------------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------------
const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

async function openContext() {
  const result = (await rowsAs(aliceId, 'select public.open_or_resume_form_preparation($1) as result', [baseId]))[0].result as {
    context: { sourceRevision: number; sourceFingerprint: string; definition: Definition };
  };
  return result.context;
}

function padded(definition: Definition, note: string): Definition {
  return { ...clone(definition), provenance: { note } };
}

describe('P1 bornes de requête et de stockage', () => {
  test('save accepte environ 900 Ko et refuse au-delà de 1 Mio sans écrire', async () => {
    const context = await openContext();
    const accepted = padded(context.definition, 'x'.repeat(900_000));
    const acceptedBytes = Buffer.byteLength(JSON.stringify(accepted));
    expect(acceptedBytes).toBeGreaterThan(880_000);
    expect(acceptedBytes).toBeLessThan(REQUEST_MAX_BYTES);
    const acceptedId = randomUUID();
    const saved = (await rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [acceptedId, baseId, 0, context.sourceRevision, context.sourceFingerprint, randomUUID(), JSON.stringify(accepted)]))[0].result;
    expect(saved.preparation.state).toBe('active');
    await rowsAs(aliceId, 'select public.discard_form_preparation($1,$2,$3,$4,$5)',
      [acceptedId, 1, context.sourceRevision, context.sourceFingerprint, randomUUID()]);

    const refusedId = randomUUID();
    const refused = padded(context.definition, 'x'.repeat(REQUEST_MAX_BYTES));
    const error = await rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [refusedId, baseId, 0, context.sourceRevision, context.sourceFingerprint, randomUUID(), JSON.stringify(refused)])
      .then(() => null, (err: { message: string; detail?: string }) => err);
    expect(error?.message).toBe('FORM_PREPARATION_TOO_LARGE');
    expect(JSON.parse(error?.detail ?? '{}')).toEqual({ code: 'FORM_PREPARATION_TOO_LARGE', maxBytes: REQUEST_MAX_BYTES });
    expect((await db.admin.query('select id from public.form_preparation where id=$1', [refusedId])).rows).toHaveLength(0);
    expect((await db.admin.query(
      'select 1 from public.form_preparation_operation where preparation_id=$1', [refusedId])).rows).toHaveLength(0);
  });

  test('un candidat stocké entre 1 Mio et 4 Mio passe l’aperçu ; au-delà, la table refuse', async () => {
    const context = await openContext();
    const stored = padded(context.definition, 'x'.repeat(2_000_000));
    const preparationId = randomUUID();
    await db.admin.query(`
      insert into public.form_preparation(
        id, base_id, owner_id, created_by, source_template_version_id, source_revision,
        source_fingerprint, preparation_revision, content_fingerprint, payload, classification)
      select $1, b.id, $3, $3, b.current_template_version_id, b.form_revision, $4, 1,
             public.form_preparation_fingerprint(public.form_preparation_normalize($5::jsonb)),
             public.form_preparation_normalize($5::jsonb), 'additive'
        from public.base b where b.id = $2`,
    [preparationId, baseId, aliceId, context.sourceFingerprint, JSON.stringify(stored)]);
    const size = Number((await db.admin.query(
      'select octet_length(payload::text) as n from public.form_preparation where id=$1', [preparationId])).rows[0].n);
    expect(size).toBeGreaterThan(REQUEST_MAX_BYTES);
    expect(size).toBeLessThanOrEqual(STORAGE_MAX_BYTES);

    const preview = (await rowsAs(aliceId, 'select public.preview_form_preparation($1,$2,$3,$4,$5) as result',
      [preparationId, 1, context.sourceRevision, context.sourceFingerprint, randomUUID()]))[0].result;
    expect(preview.error).toBeUndefined();
    expect(preview.preparation.state).toBe('ready');
    expect(preview.impact.classification).toBe('additive');
    await rowsAs(aliceId, 'select public.discard_form_preparation($1,$2,$3,$4,$5)',
      [preparationId, 1, context.sourceRevision, context.sourceFingerprint, randomUUID()]);

    const tooLarge = padded(context.definition, 'x'.repeat(STORAGE_MAX_BYTES));
    await expect(db.admin.query(`
      insert into public.form_preparation(
        id, base_id, owner_id, created_by, source_template_version_id, source_revision,
        source_fingerprint, content_fingerprint, payload)
      select $1, b.id, $3, $3, b.current_template_version_id, b.form_revision, $4, $4, $5::jsonb
        from public.base b where b.id = $2`,
    [randomUUID(), baseId, aliceId, context.sourceFingerprint, JSON.stringify(tooLarge)]))
      .rejects.toThrow('form_preparation_payload_size');

    const normalizeError = await outcome('select public.form_preparation_normalize($1::jsonb) as result', [JSON.stringify(tooLarge)]);
    expect('error' in normalizeError && normalizeError.error.message).toBe('FORM_PREPARATION_TOO_LARGE');
    expect('error' in normalizeError && JSON.parse(normalizeError.error.detail ?? '{}'))
      .toEqual({ code: 'FORM_PREPARATION_TOO_LARGE', maxBytes: STORAGE_MAX_BYTES });
  });

  test('les nouvelles fonctions internes restent fermées aux clients', async () => {
    const privileges = (await db.admin.query(`
      select r.rolname, p.sig, has_function_privilege(r.rolname, p.sig, 'execute') as allowed
        from (values ('public.form_preparation_normalize(jsonb,integer)'),
                     ('public.form_preparation_normalize(jsonb)'),
                     ('public.form_preparation_index_by_key(jsonb,text)'),
                     ('public.form_preparation_classify(jsonb,jsonb)'),
                     ('public.form_preparation_apply_classify(jsonb,jsonb)'),
                     ('public.form_preparation_apply_assert_definition(jsonb,jsonb)'),
                     ('public.form_preparation_apply_impact(uuid,jsonb,jsonb,jsonb)')) p(sig)
        cross join (values ('anon'), ('authenticated')) r(rolname)`)).rows;
    expect(privileges.filter((row) => row.allowed)).toEqual([]);
    const save = (await db.admin.query(`
      select p.prosecdef, p.proconfig,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p
       where p.oid = 'public.save_form_preparation(uuid,uuid,bigint,bigint,text,uuid,jsonb)'::regprocedure`)).rows[0];
    expect(save).toEqual({ prosecdef: true, proconfig: ['search_path=public, extensions, pg_temp'], anon: false, authenticated: true });
  });

  test('la normalisation paramétrée reproduit l’ancienne à 256 Kio', async () => {
    const context = await openContext();
    const payloads: unknown[] = [
      context.definition,
      padded(context.definition, 'x'.repeat(300_000)),
      { ...context.definition, values: { answer: 'fictif' } },
      { ...context.definition, unknown: 1 },
      { ...context.definition, diagnosisConfiguration: {} },
      { ...context.definition, provenance: [] },
      { ...context.definition, fields: {} },
      [],
    ];
    for (const payload of payloads) {
      const json = JSON.stringify(payload);
      const oldResult = await outcome('select public.test_old_form_preparation_normalize($1::jsonb) as result', [json]);
      const newResult = await outcome('select public.form_preparation_normalize($1::jsonb, 262144) as result', [json]);
      expect(newResult).toEqual(oldResult);
    }
  });
});

// ---------------------------------------------------------------------------
// Équivalence
// ---------------------------------------------------------------------------
describe('P1 équivalence stricte des comparaisons source/candidat', () => {
  // apply_classify et apply_impact ne sont pas redéfinies (jointures par hachage) :
  // leur comparaison vérifie qu'elles rendent le même résultat avec le nouveau classify.
  test('les définitions actives sont celles de la migration P1', async () => {
    const rows = (await db.admin.query(`
      select p.proname, p.prosrc like '%form_preparation_index_by_key%' as indexed
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('form_preparation_classify','form_preparation_apply_assert_definition')`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.indexed)).toBe(true);
  });

  test('sorties identiques sur les jeux du seed et les cas générés', async () => {
    const versions = (await db.admin.query('select id from public.template_version order by id')).rows.map((r) => r.id as string);
    expect(versions.length).toBeGreaterThan(0);
    const definitions = await Promise.all(versions.map(sourceDefinition));
    const couples: Array<[string, unknown, unknown, boolean]> = [];
    definitions.forEach((source, i) => {
      definitions.forEach((candidate, j) => couples.push([`seed ${i}->${j}`, source, candidate, true]));
      for (const [name, s, c] of generatedCases(source)) {
        couples.push([`seed ${i} ${name}`, s, c, false]);
        couples.push([`seed ${i} ${name} (normalisé)`, s, c, true]);
      }
    });
    for (const [name, s, c] of generatedCases(syntheticDefinition(60, 8, 30))) {
      couples.push([`synthétique ${name}`, s, c, false]);
      couples.push([`synthétique ${name} (normalisé)`, s, c, true]);
      couples.push([`synthétique inverse ${name}`, c, s, false]);
    }

    let compared = 0;
    let errors = 0;
    const exercised = new Set<string>();
    for (const [name, s, c, normalize] of couples) {
      for (const [fn, oldOutcome, newOutcome] of await compareAll(s, c, normalize)) {
        expect(newOutcome, `${fn} — ${name}`).toEqual(oldOutcome);
        compared += 1;
        if ('error' in newOutcome) {
          errors += 1;
          exercised.add(`${fn}: ${newOutcome.error.message} ${newOutcome.error.detail ?? ''}`);
        } else if (fn === 'form_preparation_classify') {
          exercised.add(`classification: ${(newOutcome.result as Json).classification as string}`);
        }
      }
    }
    // Les familles de cas attendues ont bien été exercées.
    const seen = [...exercised].join('\n');
    for (const expected of ['classification: additive', 'classification: additive_required', 'classification: semantic',
      'classification: unsupported', 'unknown_section', 'field_has_two_locations',
      // Anomalie préexistante reproduite : errcode non valide pour unknown_common_group.
      'unrecognized exception condition "FORM_CHANGE_UNSUPPORTED"',
      'new_field_default_forbidden', 'section_parent_shape', 'duplicate_field_key', 'rule_shape', 'diagnosis_shape',
      'invalid input syntax for type boolean']) {
      expect(seen).toContain(expected);
    }
    console.info(`[P1] équivalence : ${couples.length} couples, ${compared} comparaisons ancien/nouveau (${errors} exceptions identiques), 0 écart`);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// Mesures (rapportées ; seule une borne large est vérifiée)
// ---------------------------------------------------------------------------
async function timed(sql: string): Promise<number> {
  const start = performance.now();
  await db.admin.query(sql);
  return performance.now() - start;
}

describe('P1 mesures', () => {
  test('taille du jeu réel fictif et temps de classification', async () => {
    const report: string[] = [];
    for (const [label, fields, sections, rules] of [
      ['491 variables / 61 sections / 319 règles', 491, 61, 319],
      ['2 000 variables / 1 000 règles', 2000, 61, 1000],
    ] as const) {
      const source = syntheticDefinition(fields, sections, rules);
      const candidate = clone(source);
      candidate.fields.push(newField('zz_ajout_texte', { sectionKey: source.sections[0].sectionKey }));
      await db.admin.query('drop table if exists pg_temp.p1_bench');
      await db.admin.query(`create temp table p1_bench as
        select $1::jsonb as source, public.form_preparation_normalize($2::jsonb) as candidate`,
      [JSON.stringify(source), JSON.stringify(candidate)]);
      const bytes = (await db.admin.query(`select octet_length(source::text) as source_bytes,
        octet_length(candidate::text) as candidate_bytes from p1_bench`)).rows[0];

      const same = (await db.admin.query(`select
          public.test_old_form_preparation_apply_classify(source, candidate)
            = public.form_preparation_apply_classify(source, candidate) as classify,
          public.test_old_form_preparation_apply_impact($1, source, candidate, '{}'::jsonb)
            = public.form_preparation_apply_impact($1, source, candidate, '{}'::jsonb) as impact
        from p1_bench`, [baseId])).rows[0];
      expect(same).toEqual({ classify: true, impact: true });

      const oldClassify = await timed('select public.test_old_form_preparation_classify(source, candidate) from p1_bench');
      const newClassify = await timed('select public.form_preparation_classify(source, candidate) from p1_bench');
      const oldApplyClassify = await timed('select public.test_old_form_preparation_apply_classify(source, candidate) from p1_bench');
      const newApplyClassify = await timed('select public.form_preparation_apply_classify(source, candidate) from p1_bench');
      const oldImpact = await timed(`select public.test_old_form_preparation_apply_impact('${baseId}', source, candidate, '{}'::jsonb) from p1_bench`);
      const newImpact = await timed(`select public.form_preparation_apply_impact('${baseId}', source, candidate, '{}'::jsonb) from p1_bench`);
      const oldAssert = await timed('select public.test_old_form_preparation_apply_assert_definition(source, candidate) from p1_bench');
      const newAssert = await timed('select public.form_preparation_apply_assert_definition(source, candidate) from p1_bench');
      report.push(`${label} : source ${bytes.source_bytes} o, candidat ${bytes.candidate_bytes} o ; `
        + `classify ${oldClassify.toFixed(0)} -> ${newClassify.toFixed(0)} ms ; `
        + `apply_classify ${oldApplyClassify.toFixed(0)} -> ${newApplyClassify.toFixed(0)} ms ; `
        + `impact (inchangée) ${oldImpact.toFixed(0)} -> ${newImpact.toFixed(0)} ms ; `
        + `assert ${oldAssert.toFixed(0)} -> ${newAssert.toFixed(0)} ms`);
      if (fields === 2000) {
        expect(newClassify).toBeLessThan(2000);
        expect(newImpact).toBeLessThan(2000);
      }
    }

    // Candidat proche de la borne de stockage : variables aux descriptions longues.
    const nearLimit = syntheticDefinition(2000, 61, 1000);
    for (const field of nearLimit.fields) field.description = `${field.description as string} ${'Précision fictive. '.repeat(55)}`;
    const nearCandidate = clone(nearLimit);
    nearCandidate.fields.push(newField('zz_ajout_texte'));
    await db.admin.query('drop table if exists pg_temp.p1_bench');
    await db.admin.query(`create temp table p1_bench as
      select $1::jsonb as source, public.form_preparation_normalize($2::jsonb) as candidate`,
    [JSON.stringify(nearLimit), JSON.stringify(nearCandidate)]);
    const nearBytes = Number((await db.admin.query('select octet_length(candidate::text) as n from p1_bench')).rows[0].n);
    expect(nearBytes).toBeGreaterThan(3_500_000);
    expect(nearBytes).toBeLessThanOrEqual(STORAGE_MAX_BYTES);
    const nearClassify = await timed('select public.form_preparation_apply_classify(source, candidate) from p1_bench');
    const nearImpact = await timed(`select public.form_preparation_apply_impact('${baseId}', source, candidate, '{}'::jsonb) from p1_bench`);
    const nearAssert = await timed('select public.form_preparation_apply_assert_definition(source, candidate) from p1_bench');
    report.push(`borne de stockage (${nearBytes} o), nouvelles définitions : apply_classify ${nearClassify.toFixed(0)} ms ; `
      + `impact ${nearImpact.toFixed(0)} ms ; assert ${nearAssert.toFixed(0)} ms`);
    expect(nearClassify).toBeLessThan(2000);
    console.info(`[P1] mesures\n${report.join('\n')}`);
  }, 900_000);
});
