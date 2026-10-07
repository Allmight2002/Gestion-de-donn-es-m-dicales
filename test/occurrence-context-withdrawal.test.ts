// L74b — effacement déclaré, atomique, des valeurs d'occurrences masquées par la fiche patient.
//
// docs/l74-contexte-patient-occurrences.md D4, §9.1 test 10 et §12.5. Instance PostgreSQL
// embarquée sur loopback, données entièrement fictives : jamais de cloud.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

type Row = Record<string, unknown>;
const uuid = () => randomUUID();

let db: TestDb;
let alice: string;
let bob: string;
let template: string;
let version: string;
let base: string;

const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

// --- Fixtures ------------------------------------------------------------------------------

async function newVersion(number: number): Promise<string> {
  return (await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, $2, 'draft', $3) returning id`,
    [template, number, alice],
  )).rows[0].id;
}

async function addSection(v: string, key: string, parentKey: string | null = null, repeatable = false) {
  await db.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3,
       (select id from public.template_section where template_version_id=$1 and section_key=$4),
       (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1),
       $5)`,
    [v, key, `Bloc ${key}`, parentKey, repeatable],
  );
}

async function addField(v: string, key: string, label: string, sectionKey: string | null,
  scope: 'patient' | 'encounter', required = false) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
     values ($1, $2, $3, $4, $5,
       (select id from public.template_section where template_version_id=$1 and section_key=$5),
       'text', $6,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1))`,
    [v, key, label, scope, sectionKey, required],
  );
}

async function addRule(v: string, rule: Row) {
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     values ($1, $2, 'Règle fictive L74b', 'block')`,
    [v, JSON.stringify(rule)],
  );
}
const showField = (driver: string, value: string, field: string) =>
  ({ if: { field: driver, operator: 'equals', value }, then: { field, operator: 'visible' } });
const showSection = (driver: string, value: string, section: string) =>
  ({ if: { field: driver, operator: 'equals', value }, then: { section, operator: 'visible' } });

// Montage :
// - `trauma` (permanent, libellé « Trauma fictif ») pilote `ao` dans le groupe racine `lesions`
//   et le bloc `bloc_t`, qui porte le groupe enfant `g_t` ;
// - cascade interne au groupe : `ao` = C fait apparaître `ao_detail` ;
// - `cote` est piloté par `lateral` (permanent) ; `note` n'est piloté par rien.
// `withContext = false` : même structure, sans règle permanent → groupe (version d'avant L74).
async function buildVersion(v: string,
  { withContext = true, aoRequired = false, internalCote = false, requiredRule = false } = {}) {
  await addField(v, 'trauma', 'Trauma fictif', null, 'patient');
  await addField(v, 'lateral', 'Latéralité fictive', null, 'patient');
  await addField(v, 'divers', 'Divers', null, 'patient');
  await addSection(v, 'lesions', null, true);
  await addField(v, 'ao', 'Gradation AO', 'lesions', 'encounter', aoRequired);
  await addField(v, 'ao_detail', 'Détail AO', 'lesions', 'encounter');
  await addField(v, 'cote', 'Côté', 'lesions', 'encounter');
  await addField(v, 'note', 'Note', 'lesions', 'encounter');
  await addSection(v, 'bloc_t');
  await addField(v, 'bloc_t_note', 'Note du bloc', 'bloc_t', 'patient');
  await addSection(v, 'g_t', 'bloc_t', true);
  await addField(v, 'gt_niveau', 'Niveau', 'g_t', 'encounter');
  await addRule(v, showField('ao', 'C', 'ao_detail'));
  await addRule(v, showSection('trauma', 'oui', 'bloc_t'));
  if (withContext) {
    await addRule(v, showField('trauma', 'oui', 'ao'));
    await addRule(v, showField('lateral', 'oui', 'cote'));
  }
  if (internalCote) await addRule(v, showField('note', 'visible', 'cote'));
  // Règle bloquante de la version : `note` = x exige `ao`.
  if (requiredRule) await addRule(v, { if: { field: 'note', operator: 'equals', value: 'x' },
    then: { field: 'ao', operator: 'required' } });
}

async function newBase(v = version): Promise<string> {
  return (await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ($1, 'neurochirurgie', $2, $3, 'longitudinal') returning id`,
    [`Base L74b fictive ${uuid().slice(0, 8)}`, alice, v],
  )).rows[0].id;
}

async function newPatient(data: Row, inBase = base, v = version): Promise<string> {
  const code = `L74B-${uuid().slice(0, 8)}`;
  const id = (await db.admin.query(
    `insert into public.patient(base_id, patient_code, template_version_id, data, validation_status, created_by)
     values ($1, $2, $3, $4, 'draft', $5) returning id`,
    [inBase, code, v, JSON.stringify(data), alice],
  )).rows[0].id;
  await db.admin.query(
    `insert into public.patient_identity(base_id, patient_code, full_name, date_of_birth, created_by)
     values ($1, $2, 'Patient fictif L74b', '1980-01-01', $3)`,
    [inBase, code, alice],
  );
  return id;
}

const createOccurrence = async (pid: string, group: string, data: Row, status = 'draft') =>
  (await rowsAs(alice, `select * from public.create_encounter(
    $1::uuid, 'autre', null::date, $2, $3::jsonb, 'years', $4::text)`,
  [pid, status, JSON.stringify(data), group]))[0] as Row;

const patientRow = async (pid: string) =>
  (await db.admin.query('select data, row_version from public.patient where id=$1', [pid])).rows[0] as Row;
const occurrence = async (id: unknown) =>
  (await db.admin.query('select data, record_revision, deleted_at from public.encounter where id=$1', [id])).rows[0];
const revisionOf = async (id: unknown) => Number((await occurrence(id)).record_revision);

const legacyUpdate = (pid: string, data: Row, expected: unknown, uid = alice) => rowsAs(uid,
  'select * from public.update_patient($1,$2::jsonb,$3,$4,$5)',
  [pid, JSON.stringify(data), 'draft', null, expected]);
const declaredUpdate = (pid: string, data: Row, expected: unknown, declaration: unknown, uid = alice) => rowsAs(uid,
  'select * from public.update_patient($1,$2::jsonb,$3,$4,$5,$6::jsonb)',
  [pid, JSON.stringify(data), 'draft', null, expected, JSON.stringify(declaration)]);

async function refusal(promise: Promise<unknown>): Promise<{ message: string; detail: Row; raw: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; detail?: string };
    let detail: Row = {};
    try { detail = e.detail ? JSON.parse(e.detail) : {}; } catch { /* détail non JSON */ }
    return { message: e.message, detail, raw: `${e.message} ${e.detail ?? ''}` };
  }
  throw new Error('Refus attendu, succès obtenu');
}

/** Tout ce qu'un enregistrement refusé ne doit pas avoir touché. */
async function snapshotOf(pid: string) {
  return {
    patient: await patientRow(pid),
    encounters: (await db.admin.query(
      'select id, data, deleted_at, record_revision from public.encounter where patient_id=$1 order by id',
      [pid])).rows,
    log: Number((await db.admin.query(
      `select count(*)::int n from public.field_change_log
        where entity='encounter' and entity_id in (select id from public.encounter where patient_id=$1)`,
      [pid])).rows[0].n),
  };
}

const cleared = (items: { id: unknown; fieldKeys: string[] }[], revisions: number[]) =>
  items.map((item, i) => ({ id: item.id, recordRevision: revisions[i], fieldKeys: item.fieldKeys }));
const sortById = <T extends { id: unknown }>(items: T[]) =>
  [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));

const CLINICAL = ['fictif-A', 'fictif-C', 'détail-fictif', 'g-fictif', '"oui"', '"non"'];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  alice = users.get('alice@demo.test')!;
  bob = users.get('bob@demo.test')!;
  template = (await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false) returning id`,
    [`L74b ${uuid().slice(0, 8)}`, alice],
  )).rows[0].id;
  version = await newVersion(1);
  await buildVersion(version);
  base = await newBase();
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

// Trois lésions avec une gradation (dont une en C, qui porte son détail), une lésion sans
// gradation : décocher `trauma` efface 3 gradations et 1 détail, rien d'autre.
async function traumaPatient(extra: Row = {}) {
  const pid = await newPatient({ trauma: 'oui', ...extra });
  const a = await createOccurrence(pid, 'lesions', { ao: 'fictif-A', note: 'n1' });
  const c = await createOccurrence(pid, 'lesions', { ao: 'C', ao_detail: 'détail-fictif' });
  const b = await createOccurrence(pid, 'lesions', { ao: 'fictif-A' });
  const plain = await createOccurrence(pid, 'lesions', { note: 'n2' });
  return { pid, a, c, b, plain };
}
async function traumaDeclaration(o: { a: Row; c: Row; b: Row }) {
  const items = sortById([
    { id: o.a.id, fieldKeys: ['ao'] },
    { id: o.c.id, fieldKeys: ['ao', 'ao_detail'] },
    { id: o.b.id, fieldKeys: ['ao'] },
  ]);
  return [{ sectionKey: 'lesions', clearedFields: cleared(items, await Promise.all(items.map((i) => revisionOf(i.id)))) }];
}

// --- Test 10 : déclaration exacte, inexacte ------------------------------------------------

describe('test 10 — décocher le pilote avec N occurrences valorisées', () => {
  test('non déclaré : refus structuré, sans valeur clinique, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    const refused = await refusal(legacyUpdate(o.pid, { trauma: 'non' }, before.patient.row_version));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    const [{ clearedFields }] = await traumaDeclaration(o);
    expect(refused.detail).toEqual({
      code: 'GROUP_WITHDRAWAL_REQUIRED', action: 'confirm_withdrawal', groups: [],
      clearedFields: [{ sectionKey: 'lesions', count: 3, clearedFields }],
    });
    for (const clinical of CLINICAL) expect(refused.raw).not.toContain(clinical);
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('déclaré exactement : fiche et effacements dans une transaction, une ligne de journal par variable', async () => {
    const o = await traumaPatient();
    const before = await patientRow(o.pid);
    const plainBefore = await occurrence(o.plain.id);
    const revisions = { a: await revisionOf(o.a.id), c: await revisionOf(o.c.id) };
    const [row] = await declaredUpdate(o.pid, { trauma: 'non' }, before.row_version, await traumaDeclaration(o));
    expect(row.data).toEqual({ trauma: 'non' });
    expect(Number(row.row_version)).toBe(Number((await patientRow(o.pid)).row_version));

    expect((await occurrence(o.a.id)).data).toEqual({ note: 'n1' });
    expect((await occurrence(o.c.id)).data).toEqual({});
    expect((await occurrence(o.b.id)).data).toEqual({});
    // La révision avance : un brouillon ou une correction lus avant sont périmés.
    expect(await revisionOf(o.a.id)).toBeGreaterThan(revisions.a);
    expect(await revisionOf(o.c.id)).toBeGreaterThan(revisions.c);
    // L'occurrence sans valeur masquée n'est pas réécrite.
    expect(await occurrence(o.plain.id)).toEqual(plainBefore);

    const log = (await db.admin.query(
      `select entity_id, field_key, old_value, new_value, changed_by, reason, source
         from public.field_change_log
        where entity='encounter' and entity_id = any($1::uuid[]) and source='visibility_withdrawal'
        order by entity_id, field_key`,
      [[o.a.id, o.b.id, o.c.id, o.plain.id]])).rows;
    expect(log.map((l) => [l.entity_id, l.field_key])).toEqual(sortById([
      { id: o.a.id, k: 'ao' }, { id: o.b.id, k: 'ao' }, { id: o.c.id, k: 'ao' }, { id: o.c.id, k: 'ao_detail' },
    ]).map((x) => [x.id, x.k]).sort((x, y) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`)));
    expect(log.find((l) => l.entity_id === o.c.id && l.field_key === 'ao_detail')).toMatchObject({
      old_value: 'détail-fictif', new_value: null, changed_by: alice,
    });
    for (const line of log) {
      expect(line.reason).toBe('Variable masquée par « Trauma fictif » : valeur effacée avec l\'enregistrement de la fiche');
      for (const clinical of CLINICAL) expect(line.reason).not.toContain(clinical.replaceAll('"', ''));
    }

    // Recocher le pilote ne restaure rien ; le journal garde les anciennes valeurs.
    await legacyUpdate(o.pid, { trauma: 'oui' }, (await patientRow(o.pid)).row_version);
    expect((await occurrence(o.a.id)).data).toEqual({ note: 'n1' });
  });

  test('déclaration inexacte : conflit, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    const exact = await traumaDeclaration(o);
    const items = exact[0].clearedFields;
    const variants: unknown[] = [
      // Cascade oubliée : `ao_detail` n'est pas déclaré.
      [{ sectionKey: 'lesions', clearedFields: items.map((i) => ({ ...i, fieldKeys: ['ao'] })) }],
      // Variable en trop.
      [{ sectionKey: 'lesions', clearedFields: items.map((i) => ({ ...i, fieldKeys: [...i.fieldKeys, 'note'] })) }],
      // Occurrence manquante.
      [{ sectionKey: 'lesions', clearedFields: items.slice(1) }],
      // Révision périmée.
      [{ sectionKey: 'lesions', clearedFields: items.map((i) => ({ ...i, recordRevision: i.recordRevision + 1 })) }],
      // Mauvais groupe.
      [{ sectionKey: 'g_t', clearedFields: items }],
      // Ancienne forme (L72e) sans les effacements.
      [],
    ];
    for (const declaration of variants) {
      const conflict = await refusal(declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version, declaration));
      expect(conflict.message).toBe('GROUP_WITHDRAWAL_CONFLICT');
      expect(conflict.detail).toMatchObject({ action: 'refresh_required', clearedFields: [{ sectionKey: 'lesions', count: 3 }] });
      for (const clinical of CLINICAL) expect(conflict.raw).not.toContain(clinical);
      expect(await snapshotOf(o.pid)).toEqual(before);
    }
    // Une déclaration d'effacement alors que rien ne se masque : conflit aussi.
    expect((await refusal(declaredUpdate(o.pid, { trauma: 'oui', divers: 'x' }, before.patient.row_version, exact)))
      .message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('occurrence corrigée entre la lecture et l\'enregistrement : conflit', async () => {
    const o = await traumaPatient();
    const read = await traumaDeclaration(o);
    await rowsAs(alice, 'select * from public.update_encounter($1,$2::jsonb,$3,$4)',
      [o.a.id, JSON.stringify({ ao: 'fictif-A', note: 'corrigée' }), 'draft', null]);
    const before = await snapshotOf(o.pid);
    expect((await refusal(declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version, read))).message)
      .toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('déclaration mal formée : refus, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    const [{ clearedFields: items }] = await traumaDeclaration(o);
    for (const invalid of [
      [{ sectionKey: 'lesions', clearedFields: [] }],
      [{ sectionKey: 'lesions', clearedFields: [{ ...items[0], fieldKeys: [] }] }],
      [{ sectionKey: 'lesions', clearedFields: [{ ...items[0], fieldKeys: ['ao', 'ao'] }] }],
      [{ sectionKey: 'lesions', clearedFields: [{ ...items[0], fieldKeys: [3] }] }],
      [{ sectionKey: 'lesions', clearedFields: items, occurrences: [{ id: items[0].id, recordRevision: 1 }] }],
      [{ sectionKey: 'lesions', clearedFields: [items[0], items[0]] }],
    ]) {
      expect((await refusal(declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version, invalid))).message)
        .toBe('GROUP_WITHDRAWAL_INVALID');
    }
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('un compte sans droit d\'écriture structurée ne peut pas déclarer d\'effacement', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    const refused = await refusal(declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version,
      await traumaDeclaration(o), bob));
    expect(refused.message).toMatch(/GROUP_WITHDRAWAL_FORBIDDEN|Acces refuse/);
    expect(await snapshotOf(o.pid)).toEqual(before);
  });
});

// --- §12.5 ---------------------------------------------------------------------------------

describe('§12.5 — retrait de bloc et effacement, cascade, valeurs déjà masquées', () => {
  test('un pilote masque un bloc (L72e) et des variables d\'un autre groupe : une déclaration, une transaction', async () => {
    const o = await traumaPatient();
    const t1 = await createOccurrence(o.pid, 'g_t', { gt_niveau: 'g-fictif' });
    const t2 = await createOccurrence(o.pid, 'g_t', { gt_niveau: 'g-fictif' });
    const before = await snapshotOf(o.pid);
    const withdrawn = sortById([t1, t2]).map((t) => ({ id: t.id, recordRevision: Number(t.record_revision) }));

    const required = await refusal(legacyUpdate(o.pid, { trauma: 'non' }, before.patient.row_version));
    expect(required.detail.groups).toEqual([
      { sectionKey: 'g_t', blockKey: 'bloc_t', count: 2, occurrences: withdrawn },
    ]);
    // Une occurrence retirée avec son bloc n'apparaît pas dans les effacements.
    expect((required.detail.clearedFields as Row[]).map((g) => g.sectionKey)).toEqual(['lesions']);

    // Retrait seul (forme L72e) : conflit, les effacements manquent.
    expect((await refusal(declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version,
      [{ sectionKey: 'g_t', occurrences: withdrawn }]))).message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(o.pid)).toEqual(before);

    const declaration = [...await traumaDeclaration(o), { sectionKey: 'g_t', occurrences: withdrawn }];
    await declaredUpdate(o.pid, { trauma: 'non' }, before.patient.row_version, declaration);
    expect((await occurrence(t1.id)).deleted_at).not.toBeNull();
    expect((await occurrence(t1.id)).data).toEqual({ gt_niveau: 'g-fictif' });
    expect((await occurrence(o.c.id)).data).toEqual({});
    expect(Number((await db.admin.query(
      `select count(*)::int n from public.field_change_log where entity_id = any($1::uuid[])`,
      [[t1.id, t2.id]])).rows[0].n)).toBe(0);
  });

  test('cascade : la variable effacée pilotait une autre variable, les deux sont déclarées', async () => {
    const pid = await newPatient({ trauma: 'oui' });
    const c = await createOccurrence(pid, 'lesions', { ao: 'C', ao_detail: 'détail-fictif', note: 'n' });
    const required = await refusal(legacyUpdate(pid, { trauma: 'non' }, (await patientRow(pid)).row_version));
    expect(required.detail.clearedFields).toEqual([{ sectionKey: 'lesions', count: 1,
      clearedFields: [{ id: c.id, recordRevision: await revisionOf(c.id), fieldKeys: ['ao', 'ao_detail'] }] }]);
  });

  test('une valeur déjà masquée avant l\'écriture n\'est ni comptée ni effacée', async () => {
    const pid = await newPatient({ trauma: 'non', lateral: 'oui' });
    // Valeur historique masquée, déposée hors des RPC.
    const id = uuid();
    await db.admin.query(
      `insert into public.encounter(id, patient_id, template_version_id, encounter_type, data, collection_mode,
         validation_status, created_by, group_section_key)
       values ($1, $2, $3, 'autre', $4, 'direct', 'draft', $5, 'lesions')`,
      [id, pid, version, JSON.stringify({ ao: 'fictif-A', cote: 'g' }), alice]);
    await legacyUpdate(pid, { trauma: 'non', lateral: 'oui', divers: 'x' }, (await patientRow(pid)).row_version);
    expect((await occurrence(id)).data).toEqual({ ao: 'fictif-A', cote: 'g' });
    // Décocher `lateral` ne vise que `cote` ; `ao`, déjà masquée, reste en place.
    const required = await refusal(legacyUpdate(pid, { trauma: 'non' }, (await patientRow(pid)).row_version));
    expect(required.detail.clearedFields).toEqual([{ sectionKey: 'lesions', count: 1,
      clearedFields: [{ id, recordRevision: await revisionOf(id), fieldKeys: ['cote'] }] }]);
    await declaredUpdate(pid, { trauma: 'non' }, (await patientRow(pid)).row_version,
      [{ sectionKey: 'lesions', clearedFields: [{ id, recordRevision: await revisionOf(id), fieldKeys: ['cote'] }] }]);
    expect((await occurrence(id)).data).toEqual({ ao: 'fictif-A' });
    const [log] = (await db.admin.query(
      `select reason from public.field_change_log where entity_id=$1 and source='visibility_withdrawal'`, [id])).rows;
    expect(log.reason).toBe('Variable masquée par « Latéralité fictive » : valeur effacée avec l\'enregistrement de la fiche');
  });

  test('voie compatible (E3) : même refus, même effacement déclaré, rejeu idempotent', async () => {
    const o = await traumaPatient();
    const read = async () => (await rowsAs(alice,
      'select public.read_patient_form_context($1,$2) as result', [base, o.pid]))[0].result as Row;
    const compatible = (context: Row, declaration?: unknown, operationId = uuid()) => {
      const args = [base, o.pid, JSON.stringify({ trauma: 'non' }), context.validation_status, null,
        context.record_revision, context.record_definition_revision, operationId, context.context_fingerprint];
      return declaration === undefined
        ? rowsAs(alice, 'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result', args)
        : rowsAs(alice, 'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10::jsonb) as result',
          [...args, JSON.stringify(declaration)]);
    };
    const context = await read();
    const before = await snapshotOf(o.pid);
    expect((await refusal(compatible(context))).message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    expect(await snapshotOf(o.pid)).toEqual(before);

    const declaration = await traumaDeclaration(o);
    const operationId = uuid();
    const [receipt] = await compatible(context, declaration, operationId);
    expect((receipt.result as Row).recordRevision).toBe(Number((await patientRow(o.pid)).row_version));
    expect((await occurrence(o.c.id)).data).toEqual({});
    const [replayed] = await compatible(context, declaration, operationId);
    expect(replayed.result).toEqual(receipt.result);
    expect(Number((await db.admin.query(
      `select count(*)::int n from public.field_change_log where entity_id=$1 and source='visibility_withdrawal'`,
      [o.c.id])).rows[0].n)).toBe(2);
  });
});

describe('§12.5 — chemins non déclarés et changement de version', () => {
  test('écriture directe de la fiche (import, curation, réparation des clés) : refus, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    // `finalize_curation_task` écrit `data = data || brouillon` : même déclencheur.
    const refused = await refusal(db.admin.query(
      `update public.patient set data = data || '{"trauma":"non"}'::jsonb where id=$1`, [o.pid]));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('import en mode écrasement : refus, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const code = (await db.admin.query('select patient_code from public.patient where id=$1', [o.pid])).rows[0].patient_code;
    const before = await snapshotOf(o.pid);
    const rows = [{ patient_code: code, identity: null, patient_data: { trauma: 'non' }, encounter: null }];
    let outcome: unknown;
    try {
      outcome = (await rowsAs(alice, 'select public.import_records($1,$2::jsonb,$3,$4,$5,$6,$7) as report',
        [base, JSON.stringify(rows), false, 'draft', 'overwrite', null, version]))[0].report;
    } catch (error) {
      outcome = (error as Error).message;
    }
    expect(JSON.stringify(outcome)).toContain('GROUP_WITHDRAWAL_REQUIRED');
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('brouillon de travail de la fiche (commit_work_draft) : refus, rien n\'est écrit', async () => {
    const o = await traumaPatient();
    const before = await snapshotOf(o.pid);
    const draft = uuid();
    await rowsAs(alice, 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result', [
      draft, base, 'patient_update', o.pid, version, String(before.patient.row_version), 0, uuid(),
      JSON.stringify({ values: { trauma: 'non' }, status: 'draft', reason: '' }),
    ]);
    expect((await refusal(rowsAs(alice, 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as result',
      [draft, 1, uuid(), null]))).message).toBe('DRAFT_VALIDATION');
    expect(await snapshotOf(o.pid)).toEqual(before);
  });

  test('changement de version qui effacerait des valeurs : refusé avec des comptes', async () => {
    const plain = await newVersion(2);
    await buildVersion(plain, { withContext: false });
    const localBase = await newBase(plain);
    const pid = await newPatient({ trauma: 'non' }, localBase, plain);
    await createOccurrence(pid, 'lesions', { ao: 'fictif-A', cote: 'g' });
    await createOccurrence(pid, 'lesions', { ao: 'C', ao_detail: 'détail-fictif' });
    await createOccurrence(pid, 'lesions', { note: 'n' });
    const contextual = await newVersion(3);
    await buildVersion(contextual);
    const before = await snapshotOf(pid);
    const refused = await refusal(rowsAs(alice, 'select * from public.set_base_template_version($1,$2)',
      [localBase, contextual]));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_VERSION_REFUSED');
    expect(refused.detail).toEqual({
      code: 'GROUP_WITHDRAWAL_VERSION_REFUSED', action: 'reject', patients: 1, occurrences: 0, sectionKeys: [],
      clearedOccurrences: 2, clearedValues: 4, clearedSectionKeys: ['lesions'],
    });
    expect((await db.admin.query('select current_template_version_id v from public.base where id=$1',
      [localBase])).rows[0].v).toBe(plain);
    expect(await snapshotOf(pid)).toEqual(before);

    // Un masquage purement interne à l'occurrence garde la tolérance d'avant L74 : la version
    // reste applicable, et la valeur historique masquée reste en place.
    const internal = await newVersion(4);
    await buildVersion(internal, { withContext: false, internalCote: true });
    await rowsAs(alice, 'select * from public.set_base_template_version($1,$2)', [localBase, internal]);
    expect(await snapshotOf(pid)).toEqual(before);
  });
});

describe('§12.3 — occurrence ancienne, brouillons', () => {
  // L'occurrence est née dans une version sans règle de contexte où `ao` est requise ; la
  // base passe ensuite à une version où `trauma` pilote `ao` (patient `trauma` coché).
  async function oldOccurrences(number: number, statuses: string[], options: { requiredRule?: boolean } = {}) {
    const strict = await newVersion(number);
    await buildVersion(strict, { withContext: false, aoRequired: true, ...options });
    const localBase = await newBase(strict);
    const pid = await newPatient({ trauma: 'oui' }, localBase, strict);
    const rows = [];
    for (const status of statuses) {
      rows.push(await createOccurrence(pid, 'lesions',
        options.requiredRule ? { ao: 'fictif-A', note: 'x' } : { ao: 'fictif-A' }, status));
    }
    const contextual = await newVersion(number + 1);
    await buildVersion(contextual, { aoRequired: true, ...options });
    await rowsAs(alice, 'select * from public.set_base_template_version($1,$2)', [localBase, contextual]);
    const items = sortById(rows.map((r) => ({ id: r.id, fieldKeys: ['ao'] })));
    const declaration = [{ sectionKey: 'lesions',
      clearedFields: cleared(items, await Promise.all(items.map((i) => revisionOf(i.id)))) }];
    return { pid, rows, declaration };
  }

  test('occurrence ancienne « complète » ou « validée » : l\'obligation historique ne bloque pas l\'effacement', async () => {
    const { pid, rows, declaration } = await oldOccurrences(5, ['complete', 'curated']);
    await declaredUpdate(pid, { trauma: 'non' }, (await patientRow(pid)).row_version, declaration);
    for (const [i, status] of ['complete', 'curated'].entries()) {
      const row = (await db.admin.query('select data, validation_status from public.encounter where id=$1',
        [rows[i].id])).rows[0];
      expect(row).toEqual({ data: {}, validation_status: status });
    }
    expect(Number((await db.admin.query(
      `select count(*)::int n from public.field_change_log where entity_id = any($1::uuid[])
          and source='visibility_withdrawal'`, [rows.map((r) => r.id)])).rows[0].n)).toBe(2);
  });

  test('occurrence qu\'un autre contrôle refuse (règle bloquante) : code qui la nomme, rien n\'est écrit', async () => {
    const { pid, rows, declaration } = await oldOccurrences(7, ['curated'], { requiredRule: true });
    const before = await snapshotOf(pid);
    const blocked = await refusal(declaredUpdate(pid, { trauma: 'non' }, before.patient.row_version, declaration));
    expect(blocked.message).toBe('GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED');
    expect(blocked.detail).toEqual({ code: 'GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED', action: 'reject',
      sectionKey: 'lesions', id: rows[0].id });
    for (const clinical of CLINICAL) expect(blocked.raw).not.toContain(clinical);
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('hors effacement déclaré, l\'obligation historique s\'applique toujours', async () => {
    const { rows } = await oldOccurrences(9, ['complete']);
    // Retirer `ao` par une correction ordinaire reste refusé.
    await expect(db.admin.query(`update public.encounter set data = data - 'ao' where id=$1`, [rows[0].id]))
      .rejects.toThrow();
    // Le réglage seul ne suffit pas pour une écriture qui modifie aussi une valeur.
    await expect(db.admin.query(
      `select set_config('app.context_erasure_encounter', $1::text, false);
       update public.encounter set data = (data - 'ao') || '{"note":"autre"}'::jsonb where id=$1`,
      [rows[0].id])).rejects.toThrow();
    await db.admin.query(`select set_config('app.context_erasure_encounter', '', false)`);
  });

  test('brouillon de travail d\'une occurrence lu avant l\'effacement : refusé comme périmé', async () => {
    const o = await traumaPatient();
    const updatedAt = (await db.admin.query(
      `select (extract(epoch from date_trunc('milliseconds', updated_at)) * 1000)::bigint::text as r
         from public.encounter where id=$1`, [o.a.id])).rows[0].r as string;
    const draft = uuid();
    await rowsAs(alice, 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as r', [
      draft, base, 'encounter_update', o.a.id, version, updatedAt, 0, uuid(),
      JSON.stringify({ values: { ao: 'fictif-A', note: 'brouillon' }, status: 'draft', reason: '' }),
    ]);
    await declaredUpdate(o.pid, { trauma: 'non' }, (await patientRow(o.pid)).row_version, await traumaDeclaration(o));
    const afterErasure = await occurrence(o.a.id);
    const stale = await refusal(rowsAs(alice, 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as r',
      [draft, 1, uuid(), null]));
    expect(stale.message).toBe('DRAFT_CONTEXT_CHANGED');
    expect(stale.detail).toMatchObject({ action: 'refresh_required' });
    expect(await occurrence(o.a.id)).toEqual(afterErasure);
  });

  test('brouillon de curation : ses rencontres sont de nouvelles rencontres, jamais une occurrence', async () => {
    // Les rencontres d'un brouillon de curation sont insérées comme rencontres ordinaires
    // (`group_section_key` nul) : elles ne peuvent pas réécrire une valeur effacée d'occurrence.
    // Seule la fiche du brouillon touche l'effacement, et elle passe par le déclencheur
    // (test « écriture directe de la fiche »).
    const source = (await db.admin.query(
      `select pg_get_functiondef('public.finalize_curation_task(uuid)'::regprocedure) as def`)).rows[0].def as string;
    expect(source).not.toMatch(/group_section_key/);
  });
});
