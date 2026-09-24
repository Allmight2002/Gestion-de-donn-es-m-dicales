// L72e — visibilité serveur d'un groupe répétable en sous-section, et retrait.
//
// docs/l72-groupe-repetable-sous-section.md §9.1 tests 10 à 12 ; décisions D1 à D7 de
// docs/prompts-lots.md. Schéma final, instance PostgreSQL embarquée sur loopback, données
// entièrement fictives : jamais de cloud.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let bob: string;

type Row = Record<string, unknown>;
const uuid = () => randomUUID();
const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

// --- Fixtures ------------------------------------------------------------------------------

async function newTemplate(name: string): Promise<string> {
  return (await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false) returning id`,
    [`${name} ${uuid().slice(0, 8)}`, alice],
  )).rows[0].id;
}

async function newVersion(template: string, number = 1): Promise<string> {
  return (await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, $2, 'draft', $3) returning id`,
    [template, number, alice],
  )).rows[0].id;
}

async function addSection(version: string, key: string, parentKey: string | null = null, repeatable = false) {
  await db.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3,
       (select id from public.template_section where template_version_id=$1 and section_key=$4),
       (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1),
       $5)`,
    [version, key, `Bloc ${key}`, parentKey, repeatable],
  );
}

async function addField(version: string, key: string, sectionKey: string | null, scope: 'patient' | 'encounter',
  type = 'text') {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
     values ($1, $2, $3, $4, $5,
       (select id from public.template_section where template_version_id=$1 and section_key=$5),
       $6, false,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1))`,
    [version, key, `Libellé ${key}`, scope, sectionKey, type],
  );
}

async function addRule(version: string, driver: string, operator: string, value: unknown, section: string) {
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     values ($1, $2, 'Règle fictive L72e', 'block')`,
    [version, JSON.stringify({ if: { field: driver, operator, value }, then: { section, operator: 'visible' } })],
  );
}

// Montage :
// - `diagnostic` (tronc) pilote `trauma`, qui porte `trauma_type` et le groupe enfant `lesions_g1` ;
// - `vide` n'a AUCUNE variable propre : seulement le groupe enfant `g_vide` ;
// - cascade : `diagnostic` pilote `pilote`, dont la variable `stade` pilote `suite` (groupe `g_suite`) ;
// - `score` (nombre, tronc) pilote `seuil` par `greater_than` : une règle qui n'est pas une
//   association diagnostic → bloc ;
// - `lesions` est un groupe RACINE : jamais masqué.
async function buildVersion(version: string, traumaValue = 'oui'): Promise<void> {
  await addField(version, 'diagnostic', null, 'patient');
  await addField(version, 'score', null, 'patient', 'number');
  await addSection(version, 'trauma');
  await addField(version, 'trauma_type', 'trauma', 'patient');
  await addSection(version, 'lesions_g1', 'trauma', true);
  await addField(version, 'g1_niveau', 'lesions_g1', 'encounter');
  await addSection(version, 'vide');
  await addSection(version, 'g_vide', 'vide', true);
  await addField(version, 'gv_note', 'g_vide', 'encounter');
  await addSection(version, 'pilote');
  await addField(version, 'stade', 'pilote', 'patient');
  await addSection(version, 'suite');
  await addField(version, 'suite_note', 'suite', 'patient');
  await addSection(version, 'g_suite', 'suite', true);
  await addField(version, 'gs_note', 'g_suite', 'encounter');
  await addSection(version, 'seuil');
  await addField(version, 'seuil_note', 'seuil', 'patient');
  await addSection(version, 'g_seuil', 'seuil', true);
  await addField(version, 'gse_note', 'g_seuil', 'encounter');
  await addSection(version, 'lesions', null, true);
  await addField(version, 'lesion_niveau', 'lesions', 'encounter');
  await addRule(version, 'diagnostic', 'equals', traumaValue, 'trauma');
  await addRule(version, 'diagnostic', 'equals', 'oui', 'vide');
  await addRule(version, 'diagnostic', 'equals', 'oui', 'pilote');
  await addRule(version, 'stade', 'equals', 'avance', 'suite');
  await addRule(version, 'score', 'greater_than', 10, 'seuil');
}

let template: string;
let version: string;
let base: string;

async function newBase(): Promise<string> {
  return (await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ($1, 'neurochirurgie', $2, $3, 'longitudinal') returning id`,
    [`Base L72e fictive ${uuid().slice(0, 8)}`, alice, version],
  )).rows[0].id;
}

async function newPatient(data: Row, inBase = base): Promise<string> {
  const code = `L72E-${uuid().slice(0, 8)}`;
  const id = (await db.admin.query(
    `insert into public.patient(base_id, patient_code, template_version_id, data, validation_status, created_by)
     values ($1, $2, $3, $4, 'draft', $5) returning id`,
    [inBase, code, version, JSON.stringify(data), alice],
  )).rows[0].id;
  await db.admin.query(
    `insert into public.patient_identity(base_id, patient_code, full_name, date_of_birth, created_by)
     values ($1, $2, 'Patient fictif L72e', '1980-01-01', $3)`,
    [inBase, code, alice],
  );
  return id;
}

const createCall = `select * from public.create_encounter(
  $1::uuid, 'autre', null::date, 'draft', $2::jsonb, 'years', $3::text)`;
const createOccurrence = async (pid: string, group: string, data: Row = {}, uid = alice) =>
  (await rowsAs(uid, createCall, [pid, JSON.stringify(data), group]))[0];

async function patientRow(pid: string): Promise<Row> {
  return (await db.admin.query('select data, row_version from public.patient where id=$1', [pid])).rows[0];
}
async function liveOccurrences(pid: string, group: string): Promise<{ id: string; recordRevision: number }[]> {
  return (await db.admin.query(
    `select id, record_revision from public.encounter
      where patient_id=$1 and group_section_key=$2 and deleted_at is null order by id`,
    [pid, group],
  )).rows.map((row) => ({ id: row.id, recordRevision: Number(row.record_revision) }));
}
const declare = (group: string, occurrences: { id: string; recordRevision: number }[]) =>
  [{ sectionKey: group, occurrences }];

// Charge l'état d'un patient portant N occurrences dans `group`, bloc visible.
async function patientWithOccurrences(data: Row, group: string, n: number): Promise<string> {
  const pid = await newPatient(data);
  for (let i = 0; i < n; i++) await createOccurrence(pid, group, { [noteOf(group)]: `fictif ${i}` });
  return pid;
}
const noteOf = (group: string) => ({ lesions_g1: 'g1_niveau', g_vide: 'gv_note', g_suite: 'gs_note',
  g_seuil: 'gse_note', lesions: 'lesion_niveau' } as Record<string, string>)[group];

const legacyUpdate = (pid: string, data: Row, expected: unknown, uid = alice) => rowsAs(uid,
  'select * from public.update_patient($1,$2::jsonb,$3,$4,$5)',
  [pid, JSON.stringify(data), 'draft', null, expected]);
const declaredUpdate = (pid: string, data: Row, expected: unknown, declaration: unknown, uid = alice) => rowsAs(uid,
  'select * from public.update_patient($1,$2::jsonb,$3,$4,$5,$6::jsonb)',
  [pid, JSON.stringify(data), 'draft', null, expected, JSON.stringify(declaration)]);

/** Détail structuré d'une erreur PostgreSQL : code, action, groupes. */
async function refusal(promise: Promise<unknown>): Promise<{ message: string; detail: Row; raw: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; detail?: string };
    return { message: e.message, detail: e.detail ? JSON.parse(e.detail) : {}, raw: e.detail ?? '' };
  }
  throw new Error('Refus attendu, succès obtenu');
}

async function snapshotOf(pid: string) {
  return {
    patient: await patientRow(pid),
    encounters: (await db.admin.query(
      'select id, deleted_at, record_revision from public.encounter where patient_id=$1 order by id', [pid])).rows,
    audit: Number((await db.admin.query(
      `select count(*)::int n from public.audit_log where entity='encounter'
         and entity_id in (select id from public.encounter where patient_id=$1)`, [pid])).rows[0].n),
  };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  alice = users.get('alice@demo.test')!;
  bob = users.get('bob@demo.test')!;
  template = await newTemplate('L72e');
  version = await newVersion(template);
  await buildVersion(version);
  base = await newBase();
}, 240_000);

afterAll(async () => { await db?.stop(); });

// --- Prédicat -------------------------------------------------------------------------------

describe('prédicat unique : la racine du groupe est-elle visible pour cette fiche ?', () => {
  const visible = async (group: string, data: Row | null) => (await db.admin.query(
    'select public.repeatable_group_root_visible($1,$2,$3::jsonb) as v',
    [version, group, data === null ? null : JSON.stringify(data)],
  )).rows[0].v as boolean;

  test('condition vérifiée, fausse, non vérifiable ; groupe racine toujours visible', async () => {
    expect(await visible('lesions_g1', { diagnostic: 'oui' })).toBe(true);
    expect(await visible('lesions_g1', { diagnostic: 'non' })).toBe(false);
    expect(await visible('lesions_g1', {})).toBe(false);
    expect(await visible('lesions_g1', null)).toBe(false);
    expect(await visible('lesions', {})).toBe(true);
    // Échec fermé : clé inconnue, section non répétable, version absente.
    expect(await visible('inconnu', { diagnostic: 'oui' })).toBe(false);
    expect(await visible('trauma', { diagnostic: 'oui' })).toBe(false);
  });

  test('bloc sans variable propre : évalué sur la SECTION, pas par clés de variables', async () => {
    expect(await visible('g_vide', { diagnostic: 'oui' })).toBe(true);
    expect(await visible('g_vide', { diagnostic: 'non' })).toBe(false);
    // visibility_hidden_fields ne peut rien en dire : le bloc n'a aucune clé à masquer.
    const hidden = (await db.admin.query(
      'select public.visibility_hidden_fields($1,$2::jsonb) as h', [version, JSON.stringify({ diagnostic: 'non' })],
    )).rows[0].h as string[];
    expect(hidden).not.toContain('gv_note');
  });

  test('cascade de deux règles : un pilote masqué vaut absent', async () => {
    expect(await visible('g_suite', { diagnostic: 'oui', stade: 'avance' })).toBe(true);
    // `stade` est présent, mais son bloc `pilote` est masqué : `suite` l'est donc aussi.
    expect(await visible('g_suite', { diagnostic: 'non', stade: 'avance' })).toBe(false);
  });

  test('règle numérique, hors association diagnostic → bloc', async () => {
    expect(await visible('g_seuil', { score: 12 })).toBe(true);
    expect(await visible('g_seuil', { score: 3 })).toBe(false);
  });

  test('le prédicat et ses aides ne sont pas exposés aux comptes', async () => {
    for (const fn of [
      'repeatable_group_root_visible(uuid,text,jsonb)',
      'patient_group_withdrawal_prepare(uuid,jsonb)',
      'patient_group_withdrawal_commit(uuid,jsonb,jsonb)',
      'patient_group_withdrawals(uuid,uuid,jsonb,uuid,jsonb)',
    ]) {
      const allowed = (await db.admin.query(
        "select has_function_privilege('authenticated', $1, 'EXECUTE') as a", [`public.${fn}`],
      )).rows[0].a;
      expect(allowed, fn).toBe(false);
    }
  });
});

// --- Test 10 : R4 ---------------------------------------------------------------------------

describe('test 10 — R4 : écrire une occurrence dont le bloc parent est masqué', () => {
  test('création refusée tant que le pilote est absent ou faux, acceptée une fois visible', async () => {
    const pid = await newPatient({});
    const absent = await refusal(createOccurrence(pid, 'lesions_g1', { g1_niveau: 'C5' }));
    expect(absent.message).toBe('GROUP_BLOCK_HIDDEN');
    expect(absent.detail).toEqual({
      code: 'GROUP_BLOCK_HIDDEN', action: 'refresh_required', sectionKey: 'lesions_g1', blockKey: 'trauma',
    });
    expect(absent.raw).not.toContain('C5');

    await db.admin.query(`update public.patient set data='{"diagnostic":"non"}' where id=$1`, [pid]);
    expect((await refusal(createOccurrence(pid, 'lesions_g1'))).message).toBe('GROUP_BLOCK_HIDDEN');
    // Groupe racine : jamais masqué.
    await expect(createOccurrence(pid, 'lesions', { lesion_niveau: 'T3' })).resolves.toBeTruthy();

    await db.admin.query(`update public.patient set data='{"diagnostic":"oui"}' where id=$1`, [pid]);
    await expect(createOccurrence(pid, 'lesions_g1', { g1_niveau: 'C5' })).resolves.toBeTruthy();
    expect(await liveOccurrences(pid, 'lesions_g1')).toHaveLength(1);
  });

  test('délégués de création : create_encounter_idempotent et replay_encounter_create', async () => {
    const pid = await newPatient({ diagnostic: 'non' });
    const idempotent = await refusal(rowsAs(alice,
      `select * from public.create_encounter_idempotent($1,$2,'autre',null::date,'draft','{}'::jsonb,'years',$3)`,
      [`l69-occurrence:${uuid()}`, pid, 'lesions_g1']));
    expect(idempotent.message).toBe('GROUP_BLOCK_HIDDEN');
    expect(await liveOccurrences(pid, 'lesions_g1')).toHaveLength(0);
  });

  test('correction refusée quand le bloc est masqué ; suppression permise (D1)', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 2);
    const [first, second] = await liveOccurrences(pid, 'lesions_g1');
    const firstData = (await db.admin.query('select data from public.encounter where id=$1', [first.id])).rows[0].data;
    // État D10 (données antérieures) : le bloc est masqué alors que des occurrences vivent.
    await db.admin.query('alter table public.patient disable trigger trg_patient_group_withdrawal');
    await db.admin.query(`update public.patient set data='{"diagnostic":"non"}' where id=$1`, [pid]);
    await db.admin.query('alter table public.patient enable trigger trg_patient_group_withdrawal');

    const correction = await refusal(rowsAs(alice,
      'select * from public.update_encounter($1,$2::jsonb,$3,$4)',
      [first.id, JSON.stringify({ g1_niveau: 'L1' }), 'draft', null]));
    expect(correction.message).toBe('GROUP_BLOCK_HIDDEN');
    expect((await db.admin.query('select data from public.encounter where id=$1', [first.id])).rows[0].data)
      .toEqual(firstData);

    await rowsAs(alice, 'select public.soft_delete_encounter($1,$2)', [second.id, 'Suppression fictive']);
    expect(await liveOccurrences(pid, 'lesions_g1')).toEqual([first]);
  });

  test('preuve 2 — bloc sans variable propre, masqué : R4 refuse', async () => {
    const hidden = await newPatient({ diagnostic: 'non' });
    expect((await refusal(createOccurrence(hidden, 'g_vide', { gv_note: 'x' }))).detail)
      .toMatchObject({ code: 'GROUP_BLOCK_HIDDEN', sectionKey: 'g_vide', blockKey: 'vide' });
    const shown = await newPatient({ diagnostic: 'oui' });
    await expect(createOccurrence(shown, 'g_vide', { gv_note: 'x' })).resolves.toBeTruthy();
  });
});

// --- Test 11 et preuves 3 à 5 : retrait ------------------------------------------------------

describe('test 11 — retrait avec N occurrences (D2, D4, D5 ; sans restauration, D6)', () => {
  test('non déclaré : refus structuré, sans valeur clinique, et rien n\'est écrit', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui', trauma_type: 'fermé' }, 'lesions_g1', 3);
    const before = await snapshotOf(pid);
    const live = await liveOccurrences(pid, 'lesions_g1');

    const refused = await refusal(legacyUpdate(pid, { diagnostic: 'non' }, before.patient.row_version));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    expect(refused.detail).toEqual({
      code: 'GROUP_WITHDRAWAL_REQUIRED',
      action: 'confirm_withdrawal',
      groups: [{ sectionKey: 'lesions_g1', blockKey: 'trauma', count: 3, occurrences: live }],
    });
    for (const clinical of ['fermé', 'fictif', '"non"', '"oui"']) expect(refused.raw).not.toContain(clinical);
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('déclaré : fiche écrite et occurrences supprimées dans une transaction, motif qui nomme le bloc', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui', trauma_type: 'fermé' }, 'lesions_g1', 3);
    const other = await createOccurrence(pid, 'lesions', { lesion_niveau: 'T3' });
    const before = await patientRow(pid);
    const live = await liveOccurrences(pid, 'lesions_g1');

    const [row] = await declaredUpdate(pid, { diagnostic: 'non' }, before.row_version, declare('lesions_g1', live));
    expect(row.data).toEqual({ diagnostic: 'non' });
    // Chaque suppression rafraîchit la date d'inclusion, donc la révision : la ligne rendue est
    // relue après les suppressions et annonce la révision réelle.
    expect(Number(row.row_version)).toBeGreaterThan(Number(before.row_version));
    expect(Number(row.row_version)).toBe(Number((await patientRow(pid)).row_version));

    const deleted = (await db.admin.query(
      `select id, deleted_at, deleted_by, deletion_reason from public.encounter
        where patient_id=$1 and group_section_key='lesions_g1' order by id`, [pid])).rows;
    expect(deleted.map((r) => r.id)).toEqual(live.map((o) => o.id));
    for (const occurrence of deleted) {
      expect(occurrence.deleted_at).not.toBeNull();
      expect(occurrence.deleted_by).toBe(alice);
      expect(occurrence.deletion_reason).toBe(
        'Retrait du bloc « Bloc trauma » : occurrence supprimée avec l\'enregistrement de la fiche');
      expect(occurrence.deletion_reason).not.toMatch(/oui|non|fermé/);
    }
    // Motif journalisé, une ligne par occurrence.
    const audit = (await db.admin.query(
      `select entity_id, metadata from public.audit_log
        where action='encounter_deleted' and entity_id = any($1::uuid[]) order by entity_id`,
      [live.map((o) => o.id)])).rows;
    expect(audit).toHaveLength(3);
    expect(audit[0].metadata).toMatchObject({
      withdrawal: true, group_section_key: 'lesions_g1', block_key: 'trauma', justification_status: 'generated',
    });
    // Le groupe racine du même patient n'est pas touché.
    expect((await db.admin.query('select deleted_at from public.encounter where id=$1', [other.id])).rows[0].deleted_at)
      .toBeNull();
    // D6 : ressaisir le diagnostic ne restaure rien.
    const after = await patientRow(pid);
    await legacyUpdate(pid, { diagnostic: 'oui' }, after.row_version);
    expect(await liveOccurrences(pid, 'lesions_g1')).toEqual([]);
  });

  test('voie compatible (E3) : même refus, même retrait déclaré', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 2);
    const live = await liveOccurrences(pid, 'lesions_g1');
    const read = async () => (await rowsAs(alice,
      'select public.read_patient_form_context($1,$2) as result', [base, pid]))[0].result as Row;
    const compatible = (context: Row, declaration?: unknown, operationId = uuid()) => {
      const args = [base, pid, JSON.stringify({ diagnostic: 'non' }), context.validation_status, null,
        context.record_revision, context.record_definition_revision, operationId, context.context_fingerprint];
      return declaration === undefined
        ? rowsAs(alice, 'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result', args)
        : rowsAs(alice, 'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10::jsonb) as result',
          [...args, JSON.stringify(declaration)]);
    };
    const context = await read();
    expect((await refusal(compatible(context))).message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    expect(await liveOccurrences(pid, 'lesions_g1')).toEqual(live);

    const operationId = uuid();
    const [receipt] = await compatible(context, declare('lesions_g1', live), operationId);
    expect((receipt.result as Row).recordRevision).toBe(Number((await patientRow(pid)).row_version));
    // L'empreinte rendue est celle du contexte actuel : une relecture la retrouve.
    expect((receipt.result as Row).contextFingerprint).toBe((await read()).context_fingerprint);
    expect(await liveOccurrences(pid, 'lesions_g1')).toEqual([]);
    expect((await patientRow(pid)).data).toEqual({ diagnostic: 'non' });
    // Rejeu de la même opération : le reçu, pas un conflit.
    const [replayed] = await compatible(context, declare('lesions_g1', live), operationId);
    expect(replayed.result).toEqual(receipt.result);
  });

  test('preuve 3 — retrait par cascade de deux règles', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui', stade: 'avance' }, 'g_suite', 2);
    const before = await patientRow(pid);
    // `stade` quitte la fiche avec son bloc `pilote` ; `suite` se masque par cascade.
    const refused = await refusal(legacyUpdate(pid, { diagnostic: 'non' }, before.row_version));
    expect((refused.detail.groups as Row[]).map((g) => [g.sectionKey, g.blockKey, g.count]))
      .toEqual([['g_suite', 'suite', 2]]);
    const live = await liveOccurrences(pid, 'g_suite');
    await declaredUpdate(pid, { diagnostic: 'non' }, before.row_version, declare('g_suite', live));
    expect(await liveOccurrences(pid, 'g_suite')).toEqual([]);
  });

  test('preuve 3 — retrait par une règle numérique, pas une association diagnostic → bloc', async () => {
    const pid = await patientWithOccurrences({ score: 12 }, 'g_seuil', 1);
    const before = await patientRow(pid);
    const refused = await refusal(legacyUpdate(pid, { score: 4 }, before.row_version));
    expect(refused.detail).toMatchObject({ code: 'GROUP_WITHDRAWAL_REQUIRED' });
    expect(refused.raw).not.toMatch(/\b(12|4)\b/);
    await declaredUpdate(pid, { score: 4 }, before.row_version,
      declare('g_seuil', await liveOccurrences(pid, 'g_seuil')));
    expect(await liveOccurrences(pid, 'g_seuil')).toEqual([]);
  });

  test('une écriture qui ne masque rien, ou un bloc déjà masqué, n\'exige aucune déclaration', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await patientRow(pid);
    await legacyUpdate(pid, { diagnostic: 'oui', trauma_type: 'ouvert' }, before.row_version);
    expect(await liveOccurrences(pid, 'lesions_g1')).toHaveLength(1);
  });

  test('un compte sans droit de suppression ne peut pas déclarer de retrait', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await patientRow(pid);
    const refused = await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.row_version,
      declare('lesions_g1', await liveOccurrences(pid, 'lesions_g1')), bob));
    expect(refused.message).toMatch(/GROUP_WITHDRAWAL_FORBIDDEN|Acces refuse/);
    expect(await liveOccurrences(pid, 'lesions_g1')).toHaveLength(1);
  });

  test('une déclaration mal formée est refusée sans rien écrire', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await snapshotOf(pid);
    for (const invalid of [{}, [{ sectionKey: 'lesions_g1', occurrences: [] }],
      [{ sectionKey: 'lesions_g1', occurrences: [{ id: 'x', recordRevision: 1 }] }]]) {
      expect((await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.patient.row_version, invalid))).message)
        .toBe('GROUP_WITHDRAWAL_INVALID');
    }
    expect(await snapshotOf(pid)).toEqual(before);
  });
});

describe('preuve 4 — déclaration périmée : conflit, aucune écriture', () => {
  test('occurrence ajoutée entre la lecture et l\'enregistrement', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 2);
    const read = await liveOccurrences(pid, 'lesions_g1');
    await createOccurrence(pid, 'lesions_g1', { g1_niveau: 'ajoutée' });
    const before = await snapshotOf(pid);

    const conflict = await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.patient.row_version,
      declare('lesions_g1', read)));
    expect(conflict.message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(conflict.detail).toMatchObject({ code: 'GROUP_WITHDRAWAL_CONFLICT', action: 'refresh_required' });
    expect((conflict.detail.groups as Row[])[0]).toMatchObject({ sectionKey: 'lesions_g1', count: 3 });
    expect(conflict.raw).not.toContain('ajoutée');
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('occurrence modifiée, ou déjà supprimée, entre-temps', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 2);
    const read = await liveOccurrences(pid, 'lesions_g1');
    await rowsAs(alice, 'select * from public.update_encounter($1,$2::jsonb,$3,$4)',
      [read[0].id, JSON.stringify({ g1_niveau: 'corrigé' }), 'draft', null]);
    let before = await snapshotOf(pid);
    expect((await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.patient.row_version,
      declare('lesions_g1', read)))).message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(pid)).toEqual(before);

    const fresh = await liveOccurrences(pid, 'lesions_g1');
    await rowsAs(alice, 'select public.soft_delete_encounter($1,$2)', [fresh[1].id, null]);
    before = await snapshotOf(pid);
    expect((await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.patient.row_version,
      declare('lesions_g1', fresh)))).message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('groupe déclaré qui reste visible, ou groupe masqué non déclaré : conflit', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui', stade: 'avance' }, 'lesions_g1', 1);
    await createOccurrence(pid, 'g_suite', { gs_note: 'x' });
    const before = await snapshotOf(pid);
    // Déclare lesions_g1 mais garde le diagnostic : le bloc reste visible.
    expect((await refusal(declaredUpdate(pid, { diagnostic: 'oui', stade: 'avance' }, before.patient.row_version,
      declare('lesions_g1', await liveOccurrences(pid, 'lesions_g1'))))).message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect(await snapshotOf(pid)).toEqual(before);
    // Masque trauma ET suite, mais ne déclare que lesions_g1.
    const incomplete = await refusal(declaredUpdate(pid, { diagnostic: 'non' }, before.patient.row_version,
      declare('lesions_g1', await liveOccurrences(pid, 'lesions_g1'))));
    expect(incomplete.message).toBe('GROUP_WITHDRAWAL_CONFLICT');
    expect((incomplete.detail.groups as Row[]).map((g) => g.sectionKey)).toEqual(['g_suite', 'lesions_g1']);
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('version de fiche périmée : le conflit habituel, avant toute suppression', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await snapshotOf(pid);
    const stale = await refusal(declaredUpdate(pid, { diagnostic: 'non' }, Number(before.patient.row_version) - 1,
      declare('lesions_g1', await liveOccurrences(pid, 'lesions_g1'))));
    expect(stale.message).toMatch(/CONFLIT_VERSION/);
    expect(await snapshotOf(pid)).toEqual(before);
  });
});

describe('preuve 5 — chaque chemin d\'écriture refuse un masquage non déclaré', () => {
  test('écriture directe de la fiche (tout chemin serveur : import, curation, réparation des clés)', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await snapshotOf(pid);
    const refused = await refusal(db.admin.query(
      `update public.patient set data='{"diagnostic":"non"}' where id=$1`, [pid]));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_REQUIRED');
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('brouillon de travail : commit_work_draft (patient_update)', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const before = await snapshotOf(pid);
    const draft = uuid();
    await rowsAs(alice, 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result', [
      draft, base, 'patient_update', pid, version, String(before.patient.row_version), 0, uuid(),
      JSON.stringify({ values: { diagnostic: 'non' }, status: 'draft', reason: '' }),
    ]);
    const refused = await refusal(rowsAs(alice, 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as result',
      [draft, 1, uuid(), null]));
    // commit_work_draft rend toute erreur étrangère sous DRAFT_VALIDATION : le code se perd,
    // le refus demeure. Le témoin sans occurrence prouve que c'est bien le retrait qui bloque.
    expect(refused.message).toBe('DRAFT_VALIDATION');
    expect(await snapshotOf(pid)).toEqual(before);

    const witness = await newPatient({ diagnostic: 'oui' });
    const witnessDraft = uuid();
    await rowsAs(alice, 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result', [
      witnessDraft, base, 'patient_update', witness, version, String((await patientRow(witness)).row_version), 0,
      uuid(), JSON.stringify({ values: { diagnostic: 'non' }, status: 'draft', reason: '' }),
    ]);
    await rowsAs(alice, 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as result', [witnessDraft, 1, uuid(), null]);
    expect((await patientRow(witness)).data).toEqual({ diagnostic: 'non' });
  });

  test('import en mode écrasement', async () => {
    const pid = await patientWithOccurrences({ diagnostic: 'oui' }, 'lesions_g1', 1);
    const code = (await db.admin.query('select patient_code from public.patient where id=$1', [pid])).rows[0].patient_code;
    const before = await snapshotOf(pid);
    const rows = [{ patient_code: code, identity: null, patient_data: { diagnostic: 'non' }, encounter: null }];
    let outcome: unknown;
    try {
      outcome = (await rowsAs(alice, 'select public.import_records($1,$2::jsonb,$3,$4,$5,$6,$7) as report',
        [base, JSON.stringify(rows), false, 'draft', 'overwrite', null, version]))[0].report;
    } catch (error) {
      outcome = (error as Error).message;
    }
    expect(JSON.stringify(outcome)).toContain('GROUP_WITHDRAWAL_REQUIRED');
    expect(await snapshotOf(pid)).toEqual(before);
  });

  test('changement de version de la base : set_base_template_version', async () => {
    const localBase = await newBase();
    const pid = await newPatient({ diagnostic: 'oui' }, localBase);
    await createOccurrence(pid, 'lesions_g1', { g1_niveau: 'C5' });
    const stricter = await newVersion(template, 2);
    await buildVersion(stricter, 'confirmé');
    const refused = await refusal(rowsAs(alice, 'select * from public.set_base_template_version($1,$2)',
      [localBase, stricter]));
    expect(refused.message).toBe('GROUP_WITHDRAWAL_VERSION_REFUSED');
    expect(refused.detail).toEqual({
      code: 'GROUP_WITHDRAWAL_VERSION_REFUSED', action: 'reject', patients: 1, occurrences: 1,
      sectionKeys: ['lesions_g1'],
    });
    expect((await db.admin.query('select current_template_version_id v from public.base where id=$1',
      [localBase])).rows[0].v).toBe(version);
    // Une version qui ne masque rien reste applicable.
    const same = await newVersion(template, 3);
    await buildVersion(same);
    await rowsAs(alice, 'select * from public.set_base_template_version($1,$2)', [localBase, same]);
  });
});

// --- Test 12 : gardes rejouées, et rejeu hors ligne ------------------------------------------

describe('test 12 et preuve 6 — gardes et rejeux', () => {
  test('le rejeu hors ligne d\'une création heurte R4 avec un code classable', async () => {
    const pid = await newPatient({ diagnostic: 'oui' });
    await db.admin.query(`update public.patient set data='{"diagnostic":"non"}' where id=$1`, [pid]);
    const replay = await refusal(rowsAs(alice,
      `select * from public.replay_encounter_create($1,null,$2,'autre',null::date,'draft','{"g1_niveau":"C5"}'::jsonb,'years',$3)`,
      [uuid(), pid, 'lesions_g1']));
    expect(replay.message).toBe('GROUP_BLOCK_HIDDEN');
    expect(await liveOccurrences(pid, 'lesions_g1')).toHaveLength(0);
  });

  test('gardes L72a inchangées : sous-section dans un groupe, variable patient dans un groupe', async () => {
    const draft = await newVersion(await newTemplate('L72e gardes'));
    await addSection(draft, 'bloc');
    await addSection(draft, 'groupe', 'bloc', true);
    await expect(addSection(draft, 'dans_groupe', 'groupe')).rejects.toThrow();
    await expect(addField(draft, 'patient_dans_groupe', 'groupe', 'patient')).rejects.toThrow();
  });
});
