// L74a — variables permanentes, contexte d'AFFICHAGE des occurrences de groupe répétable.
//
// docs/l74-contexte-patient-occurrences.md §3.1, §5.1 et §9.1 (tests 1 à 9, 11 partie D2,
// 12). Instances PostgreSQL embarquées sur loopback, données entièrement fictives : jamais
// de cloud. Le test 1 compare deux bases, l'une arrêtée juste avant la migration L74a,
// l'autre complète, sur des fixtures aux identifiants identiques.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

const MIGRATION = '20261006120000_occurrence_patient_context.sql';
const ALICE = '22222222-2222-2222-2222-222222222222';

type Row = Record<string, unknown>;
const uuid = () => randomUUID();

let db: TestDb;
let before: TestDb;

const rowsAs = (target: TestDb, uid: string, sql: string, params: unknown[] = []) =>
  target.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

/** Détail d'une erreur PostgreSQL : message et détail JSON éventuel. */
async function refusal(promise: Promise<unknown>): Promise<{ message: string; detail: Row }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; detail?: string };
    let detail: Row = {};
    try { detail = e.detail ? JSON.parse(e.detail) : {}; } catch { /* détail non JSON */ }
    return { message: e.message, detail };
  }
  throw new Error('Refus attendu, succès obtenu');
}

// --- Fixtures ------------------------------------------------------------------------------

interface FieldSpec {
  key: string;
  scope: 'patient' | 'encounter';
  section: string | null;
  type?: string;
  required?: boolean;
  allowed?: string[];
}

async function newVersion(target: TestDb, ids: { template: string; version: string }): Promise<void> {
  await target.admin.query(
    `insert into public.template(id, name, specialty, owner_user_id, is_global)
     values ($1, $2, 'neurochirurgie', $3, false)`,
    [ids.template, `L74a ${ids.template.slice(0, 8)}`, ALICE],
  );
  await target.admin.query(
    `insert into public.template_version(id, template_id, version_number, status, created_by, created_at)
     values ($1, $2, 1, 'draft', $3, '2026-10-01T07:00:00Z')`,
    [ids.version, ids.template, ALICE],
  );
}

async function addSection(target: TestDb, version: string, key: string, repeatable = false) {
  await target.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3, null,
       (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1),
       $4)`,
    [version, key, `Bloc ${key}`, repeatable],
  );
}

async function addField(target: TestDb, version: string, f: FieldSpec) {
  await target.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required, allowed_values, display_order)
     values ($1, $2, $3, $4, $5,
       (select id from public.template_section where template_version_id=$1 and section_key=$5),
       $6, $7, $8,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1))`,
    [version, f.key, `Libellé ${f.key}`, f.scope, f.section, f.type ?? 'text', f.required ?? false,
      f.allowed ? JSON.stringify(f.allowed) : null],
  );
}

async function addRule(target: TestDb, version: string, rule: Row) {
  await target.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     values ($1, $2, 'Règle fictive L74a', 'block')`,
    [version, JSON.stringify(rule)],
  );
}

// Socle commun aux deux bases du test 1 : groupe racine `lesions` avec règles internes,
// obligations, règle permanente pure, règle `required` permanent → groupe (dormante),
// rencontre ordinaire avec obligation. Aucune règle d'affichage permanent → groupe.
async function buildCommon(target: TestDb, version: string): Promise<void> {
  await addField(target, version, { key: 'trauma', scope: 'patient', section: null });
  await addField(target, version, { key: 'diag', scope: 'patient', section: null, type: 'multiselect',
    allowed: ['lateral', 'axial'] });
  await addField(target, version, { key: 'p_a', scope: 'patient', section: null, type: 'number' });
  await addField(target, version, { key: 'p_b', scope: 'patient', section: null, type: 'number' });
  await addField(target, version, { key: 'visite_note', scope: 'encounter', section: null, required: true });
  await addSection(target, version, 'lesions', true);
  await addField(target, version, { key: 'ao', scope: 'encounter', section: 'lesions', required: true });
  await addField(target, version, { key: 'ao_detail', scope: 'encounter', section: 'lesions' });
  await addField(target, version, { key: 'cote', scope: 'encounter', section: 'lesions' });
  await addField(target, version, { key: 'note', scope: 'encounter', section: 'lesions' });
  // Interne au groupe : `ao` = C fait apparaître `ao_detail`.
  await addRule(target, version, { if: { field: 'ao', operator: 'equals', value: 'C' },
    then: { field: 'ao_detail', operator: 'visible' } });
  // D3 : `required` permanent → groupe, acceptée aujourd'hui et dormante.
  await addRule(target, version, { if: { field: 'trauma', operator: 'equals', value: 'oui' },
    then: { field: 'note', operator: 'required' } });
  // Règle purement patient.
  await addRule(target, version, { operator: 'greater_than', left_field: 'p_a', right_field: 'p_b' });
}

// Règles L74a : la fiche commande l'affichage de variables du groupe.
async function addContextRules(target: TestDb, version: string): Promise<void> {
  await addRule(target, version, { if: { field: 'trauma', operator: 'equals', value: 'oui' },
    then: { field: 'ao', operator: 'visible' } });
  await addRule(target, version, { if: { field: 'diag', operator: 'contains_any', value: ['lateral'] },
    then: { field: 'cote', operator: 'visible' } });
}

async function newBase(target: TestDb, version: string, id = uuid()): Promise<string> {
  await target.admin.query(
    `insert into public.base(id, name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ($1, $2, 'neurochirurgie', $3, $4, 'longitudinal')`,
    [id, `Base L74a fictive ${id.slice(0, 8)}`, ALICE, version],
  );
  return id;
}

async function newPatient(target: TestDb, base: string, version: string, data: Row, id = uuid()): Promise<string> {
  const code = `L74A-${id.slice(0, 8)}`;
  await target.admin.query(
    `insert into public.patient(id, base_id, patient_code, template_version_id, data, validation_status, created_by,
       created_at)
     values ($1, $2, $3, $4, $5, 'draft', $6, '2026-10-01T08:00:00Z')`,
    [id, base, code, version, JSON.stringify(data), ALICE],
  );
  await target.admin.query(
    `insert into public.patient_identity(base_id, patient_code, full_name, date_of_birth, created_by)
     values ($1, $2, 'Patient fictif L74a', '1980-01-01', $3)`,
    [base, code, ALICE],
  );
  return id;
}

/** Occurrence (ou rencontre ordinaire si `group` est nul) insérée par l'administrateur. */
async function seedEncounter(target: TestDb, pid: string, version: string, group: string | null, data: Row,
  status = 'draft', id = uuid()): Promise<string> {
  await target.admin.query(
    `insert into public.encounter(id, patient_id, template_version_id, encounter_type, data, collection_mode,
       validation_status, created_by, group_section_key, created_at, encounter_date)
     values ($1, $2, $3, $4, $5, 'direct', $6, $7, $8, '2026-10-01T09:00:00Z',
       case when $8::text is null then date '2026-09-30' end)`,
    [id, pid, version, group ? 'autre' : 'consultation', JSON.stringify(data), status, ALICE, group],
  );
  return id;
}

const createCall = `select (public.create_encounter(
  $1::uuid, 'autre', null::date, $2, $3::jsonb, 'years', 'lesions')).*`;
const createOccurrence = async (pid: string, data: Row, status = 'draft') =>
  (await rowsAs(db, ALICE, createCall, [pid, status, JSON.stringify(data)]))[0];

const setPatient = (pid: string, data: Row) =>
  db.admin.query('update public.patient set data=$2 where id=$1', [pid, JSON.stringify(data)]);
const encounterData = async (id: string) =>
  (await db.admin.query('select data from public.encounter where id=$1', [id])).rows[0].data as Row;
const readContext = async (base: string, id: string) =>
  (await rowsAs(db, ALICE, 'select public.read_encounter_form_context($1,$2) as c', [base, id]))[0].c as Row;
const contextField = (context: Row, key: string) =>
  (context.fields as Row[]).find((f) => f.field_key === key) as Row;
const exportIncomplete = async (cohort: string) =>
  (await db.admin.query('select record_kind, record_id from public.export_incomplete_records($1)', [cohort]))
    .rows.map((r) => r.record_id as string);
const queueIds = async (base: string) =>
  ((await rowsAs(db, ALICE, 'select public.base_completion_queue_page($1,500,0) as q', [base]))[0].q as
    { items: Row[] }).items.map((i) => (i.encounterId ?? i.patientId) as string);

async function newCohort(base: string, patients: string[]): Promise<string> {
  const id = (await db.admin.query(
    `insert into public.cohort(base_id, name, cohort_type, snapshot_at, validated_only, created_by)
     values ($1, $2, 'snapshot', now(), false, $3) returning id`,
    [base, `Cohorte L74a ${uuid().slice(0, 8)}`, ALICE],
  )).rows[0].id as string;
  for (const pid of patients) {
    await db.admin.query('insert into public.cohort_member(cohort_id, patient_id) values ($1, $2)', [id, pid]);
  }
  return id;
}

let version: string;
let base: string;

beforeAll(async () => {
  [db, before] = [await startTestDb({ seed: true }), await startTestDb({ seed: true, beforeMigration: MIGRATION })];
  version = uuid();
  await newVersion(db, { template: uuid(), version });
  await buildCommon(db, version);
  await addContextRules(db, version);
  base = await newBase(db, version);
}, 360_000);

afterAll(async () => {
  await db?.stop();
  await before?.stop();
});

// --- Test 1 : non-régression stricte -------------------------------------------------------

describe('test 1 : une version sans règle permanent → groupe rend les mêmes verdicts', () => {
  test('complétude, file, compteurs, export et contexte E3 identiques avant et après L74a', async () => {
    const ids = {
      template: uuid(), version: uuid(), base: uuid(), cohort: uuid(),
      patients: [uuid(), uuid(), uuid()], encounters: [uuid(), uuid(), uuid(), uuid(), uuid()],
    };
    const outputs: Row[] = [];
    for (const target of [before, db]) {
      await newVersion(target, ids);
      await buildCommon(target, ids.version);
      await newBase(target, ids.version, ids.base);
      const [p1, p2, p3] = ids.patients;
      await newPatient(target, ids.base, ids.version, { trauma: 'oui', diag: ['lateral'], p_a: 1, p_b: 5 }, p1);
      await newPatient(target, ids.base, ids.version, { trauma: 'non' }, p2);
      await newPatient(target, ids.base, ids.version, {}, p3);
      const [e1, e2, e3, e4, e5] = ids.encounters;
      await seedEncounter(target, p1, ids.version, 'lesions', { note: 'fictif' }, 'draft', e1);
      await seedEncounter(target, p1, ids.version, 'lesions', { ao: 'C' }, 'draft', e2);
      await seedEncounter(target, p2, ids.version, 'lesions', { ao: 'A', ao_detail: 'x', cote: 'g' }, 'draft', e3);
      await seedEncounter(target, p3, ids.version, null, {}, 'draft', e4);
      await seedEncounter(target, p3, ids.version, 'lesions', { ao: 'B', note: 'n' }, 'complete', e5);
      await target.admin.query(
        `insert into public.cohort(id, base_id, name, cohort_type, snapshot_at, validated_only, created_by)
         values ($1, $2, 'Cohorte L74a', 'snapshot', '2026-10-01T10:00:00Z', false, $3)`,
        [ids.cohort, ids.base, ALICE]);
      for (const pid of ids.patients) {
        await target.admin.query('insert into public.cohort_member(cohort_id, patient_id) values ($1,$2)',
          [ids.cohort, pid]);
      }
      const contexts: Row[] = [];
      for (const eid of ids.encounters) {
        const ctx = (await rowsAs(target, ALICE, 'select public.read_encounter_form_context($1,$2) as c',
          [ids.base, eid]))[0].c as Row;
        contexts.push(ctx);
      }
      outputs.push({
        exportIncomplete: (await target.admin.query(
          'select record_kind, record_id from public.export_incomplete_records($1) order by 1, 2', [ids.cohort])).rows,
        queue: (await rowsAs(target, ALICE, 'select public.base_completion_queue_page($1,500,0) as q', [ids.base]))[0].q,
        todo: ((await rowsAs(target, ALICE, 'select public.my_todo_counts() as c'))[0].c as Row[])
          .filter((r) => r.baseId === ids.base),
        missing: (await target.admin.query(
          `select e.id, array(select public.missing_required_fields(
              e.template_version_id, 'encounter', e.data, e.encounter_type, e.group_section_key)) as m
             from public.encounter e where e.patient_id = any($1) order by e.id`, [ids.patients])).rows,
        summaries: (await target.admin.query(
          `select e.id, public.record_completion_summary(
              e.template_version_id, 'encounter', e.data, e.encounter_type, e.group_section_key) as s
             from public.encounter e where e.patient_id = any($1) order by e.id`, [ids.patients])).rows,
        contexts,
      });
    }
    expect(outputs[1]).toEqual(outputs[0]);
    // Garde-fou : la comparaison porte bien sur des verdicts non vides.
    expect((outputs[0].exportIncomplete as Row[]).length).toBeGreaterThan(0);
  });
});

// --- Tests 2 à 6 : sémantique ---------------------------------------------------------------

describe('tests 2 à 6 : le contexte commande l’affichage, et seulement l’affichage', () => {
  test('2. visible permanent → groupe : réclamée si visible, refusée si masquée', async () => {
    const shown = await newPatient(db, base, version, { trauma: 'oui' });
    expect((await refusal(createOccurrence(shown, { note: 'n' }, 'complete'))).message)
      .toMatch(/Champ requis manquant : Libellé ao/);
    const ok = await createOccurrence(shown, { ao: 'A', note: 'n' }, 'curated');
    expect(ok.validation_status).toBe('curated');

    const masked = await newPatient(db, base, version, { trauma: 'non' });
    const notRequired = await createOccurrence(masked, { note: 'n' }, 'complete');
    expect(notRequired.validation_status).toBe('complete');
    expect((await refusal(createOccurrence(masked, { ao: 'A', note: 'n' }, 'curated'))).message)
      .toMatch(/Variable masquee par une regle d'affichage : Libellé ao/);

    // Contexte E3 : la variable est réclamée, ou masquée par la règle, selon la fiche.
    const draft = await createOccurrence(shown, {}, 'draft');
    const shownCtx = await readContext(base, draft.id as string);
    expect((shownCtx.completeness as Row).current_missing_field_keys).toEqual(['ao']);
    expect(contextField(shownCtx, 'ao').applicability).toBe('applicable');
    const maskedCtx = await readContext(base, notRequired.id as string);
    expect(contextField(maskedCtx, 'ao').applicability_reason).toBe('rule_hidden');
    expect((maskedCtx.completeness as Row).current_missing_field_keys).toEqual([]);
    // Aucune valeur de la fiche n'entre dans le contexte rendu.
    expect(Object.keys(maskedCtx.values as Row)).toEqual(['note']);
    expect((maskedCtx.fields as Row[]).map((f) => f.field_key)).not.toContain('trauma');
  });

  test('3. contains_any sur le diagnostic patient : valeur refusée à tout statut sans le code', async () => {
    const without = await newPatient(db, base, version, { diag: ['axial'] });
    const refused = await refusal(createOccurrence(without, { cote: 'gauche' }, 'draft'));
    expect(refused.detail.code).toBe('contains_any_hidden_value');
    expect(refused.message).not.toMatch(/gauche|axial/);

    const withCode = await newPatient(db, base, version, { diag: ['lateral'] });
    const created = await createOccurrence(withCode, { cote: 'gauche' }, 'draft');
    // Correction par update_encounter : le contrôle anticipé lit aussi le contexte.
    await rowsAs(db, ALICE, 'select public.update_encounter($1,$2::jsonb,$3,$4)',
      [created.id, JSON.stringify({ cote: 'droit' }), 'draft', null]);
    expect(await encounterData(created.id as string)).toEqual({ cote: 'droit' });

    // La fiche perd le code : la même correction est refusée, avec le même code d'erreur.
    await setPatient(withCode, { diag: ['axial'] });
    const late = await refusal(rowsAs(db, ALICE, 'select public.update_encounter($1,$2::jsonb,$3,$4)',
      [created.id, JSON.stringify({ cote: 'gauche' }), 'draft', null]));
    expect(late.detail.code).toBe('contains_any_hidden_value');
    expect(await encounterData(created.id as string)).toEqual({ cote: 'droit' });
  });

  test('4. D3 : une règle required permanent → groupe reste inerte', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'oui' });
    const occ = await createOccurrence(pid, { ao: 'A' }, 'curated');
    expect(occ.validation_status).toBe('curated');
    const cohort = await newCohort(base, [pid]);
    expect(await exportIncomplete(cohort)).not.toContain(occ.id);
  });

  test('5. une règle bloquante purement patient, violée sur la fiche, ne bloque pas l’occurrence', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'oui', p_a: 1, p_b: 5 });
    const occ = await createOccurrence(pid, { ao: 'A' }, 'curated');
    expect(occ.validation_status).toBe('curated');
    // Témoin : la même règle bloque bien la fiche elle-même.
    expect((await refusal(db.admin.query(
      "update public.patient set validation_status='curated' where id=$1", [pid]))).message)
      .toBe('Règle fictive L74a');
  });

  test('6. cascade : le pilote permanent masque ao, qui masque ao_detail', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'non' });
    const hidden = (await db.admin.query(
      `select public.visibility_hidden_fields($1,
         public.occurrence_evaluation_data($1, $2::jsonb, $3::jsonb)) as h`,
      [version, JSON.stringify({ trauma: 'non' }), JSON.stringify({ ao: 'C' })])).rows[0].h as string[];
    expect(hidden).toEqual(expect.arrayContaining(['ao', 'ao_detail']));
    expect((await refusal(createOccurrence(pid, { ao: 'C', ao_detail: 'x' }, 'curated'))).message)
      .toMatch(/Variable masquee/);
    await setPatient(pid, { trauma: 'oui' });
    const occ = await createOccurrence(pid, { ao: 'C', ao_detail: 'x' }, 'curated');
    expect(occ.validation_status).toBe('curated');
  });
});

// --- Test 7 : le contexte n'est jamais écrit ------------------------------------------------

describe('test 7 : aucune clé permanente dans encounter.data', () => {
  test('création, correction, complément E3, brouillon de travail', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'oui', diag: ['lateral'], p_a: 1 });
    const occ = await createOccurrence(pid, { ao: 'A' }, 'draft');
    const id = occ.id as string;
    expect(await encounterData(id)).toEqual({ ao: 'A' });

    await rowsAs(db, ALICE, 'select public.update_encounter($1,$2::jsonb,$3,$4)',
      [id, JSON.stringify({ ao: 'B', cote: 'g' }), 'draft', null]);
    expect(await encounterData(id)).toEqual({ ao: 'B', cote: 'g' });

    const ctx = await readContext(base, id);
    await rowsAs(db, ALICE,
      'select public.update_encounter_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as r',
      [base, id, JSON.stringify({ note: 'n' }), 'draft', null, ctx.record_revision,
        ctx.record_definition_revision, uuid(), ctx.context_fingerprint]);
    expect(await encounterData(id)).toEqual({ ao: 'B', cote: 'g', note: 'n' });

    // Brouillon de travail : `ao` et `cote` sont révélés par la fiche ; la projection
    // serveur ne doit pas les retirer, ni écrire le contexte.
    const updatedAt = (await db.admin.query(
      `select (extract(epoch from date_trunc('milliseconds', updated_at)) * 1000)::bigint::text as r
         from public.encounter where id=$1`, [id])).rows[0].r as string;
    const draft = uuid();
    await rowsAs(db, ALICE, 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as r', [
      draft, base, 'encounter_update', id, version, updatedAt, 0, uuid(),
      JSON.stringify({ values: { ao: 'C', cote: 'd', note: 'n' }, status: 'draft', reason: '' }),
    ]);
    await rowsAs(db, ALICE, 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as r', [draft, 1, uuid(), null]);
    expect(await encounterData(id)).toEqual({ ao: 'C', cote: 'd', note: 'n' });
  });
});

// --- Test 8 : la fiche courante pilote complétude, file et export ---------------------------

describe('test 8 : complétude, file de complétion et filtre d’export suivent la fiche courante', () => {
  test('masquer le pilote retire l’occurrence des listes ; le rétablir l’y remet', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'oui' });
    const occ = await seedEncounter(db, pid, version, 'lesions', { note: 'n' });
    const cohort = await newCohort(base, [pid]);
    const todo = async () => ((await rowsAs(db, ALICE, 'select public.my_todo_counts() as c'))[0].c as Row[])
      .find((r) => r.baseId === base)?.incomplete as number | undefined;

    expect(await exportIncomplete(cohort)).toContain(occ);
    expect(await queueIds(base)).toContain(occ);
    const withPilot = await todo();

    await setPatient(pid, { trauma: 'non' });
    expect(await exportIncomplete(cohort)).not.toContain(occ);
    expect(await queueIds(base)).not.toContain(occ);
    expect((await todo()) ?? 0).toBe((withPilot ?? 0) - 1);

    await setPatient(pid, { trauma: 'oui' });
    expect(await exportIncomplete(cohort)).toContain(occ);
  });
});

// --- Test 9 : concurrence --------------------------------------------------------------------

describe('test 9 : écriture de fiche et écriture d’occurrence sont sérialisées', () => {
  test('la correction attend la fiche, puis est jugée sur le contexte engagé', async () => {
    const pid = await newPatient(db, base, version, { trauma: 'oui' });
    const occ = await seedEncounter(db, pid, version, 'lesions', { ao: 'A' });

    const writer = db.pg.getPgClient();
    await writer.connect();
    try {
      await writer.query('begin');
      await writer.query('update public.patient set data=$2 where id=$1', [pid, JSON.stringify({ trauma: 'non' })]);

      const pending = refusal(rowsAs(db, ALICE, 'select public.update_encounter($1,$2::jsonb,$3,$4)',
        [occ, JSON.stringify({ ao: 'B' }), 'draft', null]));
      // L'écriture d'occurrence attend le verrou de la fiche.
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        await new Promise((r) => setTimeout(r, 100));
        waiting = Number((await db.admin.query(
          `select count(*)::int n from pg_stat_activity
            where wait_event_type = 'Lock' and query like '%update_encounter%'`)).rows[0].n) > 0;
      }
      expect(waiting).toBe(true);
      await writer.query('commit');

      // Le contexte engagé masque `ao` : la valeur modifiée est refusée, rien n'est écrit.
      const refused = await pending;
      expect(refused.detail.code).toBe('block_hidden_value');
      expect(await encounterData(occ)).toEqual({ ao: 'A' });
    } finally {
      await writer.end();
    }
  });

  test('la garde de bloc de groupe lit la fiche sous for share', async () => {
    const source = (await db.admin.query(
      "select prosrc from pg_proc where proname = 'guard_group_occurrence_block_visible'")).rows[0].prosrc as string;
    expect(source).toMatch(/where p\.id = new\.patient_id for share/);
  });
});

// --- Test 11 (D2) : contrat des règles --------------------------------------------------------

describe('test 11 (D2) : assert_rule_structure', () => {
  test('visible permanent → variable de groupe acceptée ; les autres inter-fiches restent refusées', async () => {
    const v = uuid();
    await newVersion(db, { template: uuid(), version: v });
    await buildCommon(db, v);
    await addContextRules(db, v);
    expect(Number((await db.admin.query(
      "select count(*)::int n from public.validation_rule where template_version_id=$1 and rule #>> '{then,operator}'='visible'",
      [v])).rows[0].n)).toBe(3);
    // Permanent → variable de visite ordinaire : toujours refusée.
    await expect(addRule(db, v, { if: { field: 'trauma', operator: 'equals', value: 'oui' },
      then: { field: 'visite_note', operator: 'visible' } })).rejects.toThrow(/meme fiche/);
    // Cible permanente pilotée par une variable de groupe : refusée.
    await expect(addRule(db, v, { if: { field: 'ao', operator: 'equals', value: 'A' },
      then: { field: 'p_a', operator: 'visible' } })).rejects.toThrow(/meme fiche/);
    // Le rejeu des invariants de la version accepte la nouvelle règle.
    await db.admin.query('select public.validate_template_version_invariants($1)', [v]);
  });
});

// --- Test 12 : version historique -------------------------------------------------------------

describe('test 12 : le contexte est filtré sur les variables permanentes de la version évaluée', () => {
  test('seules les clés de portée patient de cette version entrent dans la fusion', async () => {
    const other = uuid();
    await newVersion(db, { template: uuid(), version: other });
    await addField(db, other, { key: 'trauma', scope: 'patient', section: null });
    const fused = async (v: string) => (await db.admin.query(
      'select public.occurrence_evaluation_data($1, $2::jsonb, $3::jsonb) as d',
      [v, JSON.stringify({ trauma: 'oui', p_a: 3, inconnue: 'x', note: 'fiche' }), JSON.stringify({ note: 'occ' })],
    )).rows[0].d as Row;
    // `note` est une variable de rencontre : jamais lue dans la fiche.
    expect(await fused(version)).toEqual({ note: 'occ', trauma: 'oui', p_a: 3 });
    expect(await fused(other)).toEqual({ note: 'occ', trauma: 'oui' });
  });
});
