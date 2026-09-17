import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let bob: string;

type Definition = Record<string, unknown> & {
  sections: Array<Record<string, unknown>>;
  commonGroups: Array<Record<string, unknown>>;
  fields: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  diagnosisConfiguration: Array<Record<string, unknown>>;
};

type ContextField = Record<string, unknown> & {
  field_key: string;
  definition: Record<string, unknown>;
};

interface Fixture {
  baseId: string;
  sourceVersionId: string;
  patientHiddenId: string;
  patientUniqueId: string;
  patientMultipleId: string;
  patientNoneId: string;
  encounterHiddenId: string;
  encounterHospitalisationId: string;
  encounterUniqueId: string;
}

interface Context {
  record_kind: 'patient' | 'encounter';
  record_id: string;
  record_revision: number;
  base_id: string;
  active_revision: number;
  record_definition_revision: string;
  historical_definition: Definition;
  active_definition: Definition;
  fields: ContextField[];
  values: Record<string, unknown>;
  current_obligations: Array<Record<string, unknown>>;
  completeness: {
    current_missing_field_keys: string[];
    current_complete: boolean;
    historical_missing_field_keys: string[];
    historical_complete: boolean;
  };
  diagnosis_coverage: {
    diagnostics: Array<{ code: string | null; status: string; blockKeys: string[] }>;
    counts: { covered: number; common_only: number; uncovered: number; unclassified: number };
  };
  validation_status: string;
  encounter_type: string | null;
  context_fingerprint: string;
}

const DIAGNOSIS_HEADERS = `select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',true)`;

async function rpc<T>(uid: string, sql: string, params: unknown[], withDiagnosis = false): Promise<T> {
  return db.asUser(uid, async (client) => {
    if (withDiagnosis) await client.query(DIAGNOSIS_HEADERS);
    return (await client.query(sql, params)).rows[0].result as T;
  });
}

function field(
  fieldKey: string,
  label: string,
  scope: 'patient' | 'encounter',
  sectionKey: string | null,
  type: string,
  displayOrder: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fieldKey,
    label,
    scope,
    sectionKey,
    type,
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: true,
    displayOrder,
    encounterTypes: null,
    description: null,
    defaultValue: null,
    missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
    allowedOptions: null,
    isMultiple: false,
    formula: null,
    commonGroupKey: null,
    ...extra,
  };
}

function addCompatibleFields(source: Definition): Definition {
  const payload = JSON.parse(JSON.stringify(source)) as Definition;
  payload.fields.push(
    field('patient_added_optional', 'Ajout patient facultatif', 'patient', 'clinique', 'text', 80, {
      defaultValue: null,
    }),
    field('patient_added_required', 'Ajout patient obligatoire', 'patient', 'clinique', 'text', 81, {
      required: true,
      defaultValue: null,
    }),
    field('encounter_added_optional', 'Ajout rencontre facultatif', 'encounter', 'clinique', 'text', 80, {
      defaultValue: null,
    }),
    field('encounter_added_required', 'Ajout rencontre obligatoire', 'encounter', 'clinique', 'text', 81, {
      required: true,
      encounterTypes: ['hospitalisation'],
      defaultValue: null,
    }),
  );
  payload.rules.push(
    {
      rule: {
        if: { field: 'diagnosis_driver', operator: 'contains_any', value: ['target'] },
        then: { section: 'diagnostic_patient', operator: 'visible' },
      },
      message: 'Bloc patient pour le diagnostic target',
      severity: 'warn',
    },
    {
      rule: {
        if: { field: 'encounter_diagnosis', operator: 'contains_any', value: ['target'] },
        then: { section: 'diagnostic_encounter', operator: 'visible' },
      },
      message: 'Bloc rencontre pour le diagnostic target',
      severity: 'warn',
    },
  );
  payload.diagnosisConfiguration.push(
    {
      scope: 'patient', diagnosisFieldKey: 'diagnosis_driver', terminologyReleaseId: null, commonOnlyCodes: [],
    },
    {
      scope: 'encounter', diagnosisFieldKey: 'encounter_diagnosis', terminologyReleaseId: null, commonOnlyCodes: [],
    },
  );
  return payload;
}

async function createFixture(): Promise<Fixture> {
  const baseId = randomUUID();
  const sourceTemplateId = randomUUID();
  const sourceVersionId = randomUUID();
  const clinicalSectionId = randomUUID();
  const patientBlockSectionId = randomUUID();
  const encounterBlockSectionId = randomUUID();
  const patientHiddenId = randomUUID();
  const patientUniqueId = randomUUID();
  const patientMultipleId = randomUUID();
  const patientNoneId = randomUUID();
  const encounterHiddenId = randomUUID();
  const encounterHospitalisationId = randomUUID();
  const encounterUniqueId = randomUUID();

  await db.admin.query('begin');
  try {
    await db.admin.query(`
      insert into public.template(id,name,specialty,owner_user_id,is_global)
      values($1,'E3 fixture','e3-test',$2,false)
    `, [sourceTemplateId, alice]);
    await db.admin.query(`
      insert into public.template_version(id,template_id,version_number,status,created_by)
      values($1,$2,1,'draft',$3)
    `, [sourceVersionId, sourceTemplateId, alice]);
    await db.admin.query(`
      insert into public.template_section(id,template_version_id,section_key,label,display_order)
      values
        ($1,$4,'clinique','Clinique',0),
        ($2,$4,'diagnostic_patient','Bloc diagnostique patient',1),
        ($3,$4,'diagnostic_encounter','Bloc diagnostique rencontre',2)
    `, [clinicalSectionId, patientBlockSectionId, encounterBlockSectionId, sourceVersionId]);
    await db.admin.query(`
      insert into public.template_field(
        template_version_id,field_key,label,scope,section,section_id,type,allowed_values,
        required,allow_missing_codes,display_order,min_value,max_value,encounter_types
      ) values
        ($1,'sexe','Sexe','patient','clinique',$2,'select','["M","F"]'::jsonb,true,true,0,null,null,null),
        ($1,'birth_year','Annee de naissance','patient','clinique',$2,'integer',null,true,true,1,null,null,null),
        ($1,'diagnosis_driver','Diagnostic patient','patient',null,null,'multiselect','["target","other"]'::jsonb,false,true,2,null,null,null),
        ($1,'diagnosis_driver_autre','Autre diagnostic patient','patient',null,null,'text',null,false,true,3,null,null,null),
        ($1,'patient_block_value','Valeur historique patient','patient','diagnostic_patient',$3,'text',null,false,true,4,null,null,null),
        ($1,'patient_finding','Constat patient','patient','diagnostic_patient',$3,'text',null,false,true,5,null,null,null),
        ($1,'admission_date','Date admission','encounter','clinique',$2,'date',null,true,true,10,null,null,ARRAY['hospitalisation']),
        ($1,'diagnosis','Diagnostic rencontre','encounter','clinique',$2,'text',null,true,true,11,null,null,null),
        ($1,'glasgow_score','Score Glasgow','encounter','clinique',$2,'integer',null,true,true,12,3,15,null),
        ($1,'encounter_diagnosis','Diagnostic rencontre suivi','encounter',null,null,'multiselect','["target","other"]'::jsonb,false,true,13,null,null,null),
        ($1,'encounter_diagnosis_autre','Autre diagnostic rencontre','encounter',null,null,'text',null,false,true,14,null,null,null),
        ($1,'ct_result','Resultat historique masque','encounter','diagnostic_encounter',$4,'text',null,false,true,15,null,null,null)
    `, [sourceVersionId, clinicalSectionId, patientBlockSectionId, encounterBlockSectionId]);
    await db.admin.query(`
      insert into public.base(id,name,specialty,owner_user_id,current_template_version_id)
      values($1,'Base E3','e3-test',$2,$3)
    `, [baseId, alice, sourceVersionId]);
    await db.admin.query(`
      insert into public.patient(id,base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by)
      values
        ($1,$2,'E3-HIDDEN',$3,$4::jsonb,'direct','curated',$5),
        ($6,$2,'E3-UNIQUE',$3,$7::jsonb,'direct','curated',$5),
        ($8,$2,'E3-MULTIPLE',$3,$9::jsonb,'direct','curated',$5),
        ($10,$2,'E3-NONE',$3,$11::jsonb,'direct','curated',$5)
    `, [
      patientHiddenId, baseId, sourceVersionId,
      JSON.stringify({ sexe: 'M', birth_year: 1980, diagnosis_driver: ['other'], patient_block_value: 'patient-hidden-history' }),
      alice,
      patientUniqueId,
      JSON.stringify({ sexe: 'F', birth_year: 1979, diagnosis_driver: ['target'], patient_block_value: 'patient-block-filled', patient_finding: 'constat conserve' }),
      patientMultipleId,
      JSON.stringify({ sexe: 'M', birth_year: 1978, diagnosis_driver: ['target', 'other'], patient_block_value: 'patient-multiple-block' }),
      patientNoneId,
      JSON.stringify({ sexe: 'F', birth_year: 1977 }),
    ]);
    await db.admin.query(`
      insert into public.patient_identity(base_id,patient_code,full_name,date_of_birth,phone,created_by)
      values($1,'E3-HIDDEN','Identite totalement secrete','1980-01-02','+000000000',$2)
    `, [baseId, alice]);
    await db.admin.query(`
      insert into public.encounter(
        id,patient_id,template_version_id,encounter_type,encounter_date,data,collection_mode,validation_status,created_by
      ) values
        ($1,$2,$3,'consultation','2026-09-01',$4::jsonb,'direct','curated',$5),
        ($6,$7,$3,'hospitalisation','2026-09-02',$8::jsonb,'direct','curated',$5),
        ($9,$2,$3,'consultation','2026-09-03',$10::jsonb,'direct','curated',$5)
    `, [
      encounterHiddenId, patientHiddenId, sourceVersionId,
      JSON.stringify({ diagnosis: 'ancien', glasgow_score: 10, encounter_diagnosis: ['other'], ct_result: 'encounter-hidden-history' }),
      alice,
      encounterHospitalisationId, patientUniqueId,
      JSON.stringify({ admission_date: '2026-09-02', diagnosis: 'hospitalisation', glasgow_score: 12, encounter_diagnosis: ['target'], ct_result: 'hospital-block-filled' }),
      encounterUniqueId,
      JSON.stringify({ diagnosis: 'target', glasgow_score: 11, encounter_diagnosis: ['target'], ct_result: 'encounter-block-filled' }),
    ]);
    await db.admin.query('commit');
  } catch (error) {
    await db.admin.query('rollback');
    throw error;
  }

  const opened = await rpc<{ context: { sourceRevision: number; sourceFingerprint: string; definition: Definition } }>(
    alice,
    'select public.open_or_resume_form_preparation($1) as result',
    [baseId],
    true,
  );
  const payload = addCompatibleFields(opened.context.definition);
  const preparationId = randomUUID();
  const saved = await rpc<Record<string, unknown>>(alice,
    'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
    [preparationId, baseId, 0, opened.context.sourceRevision, opened.context.sourceFingerprint, randomUUID(), JSON.stringify(payload)],
    true,
  );
  expect((saved.preparation as Record<string, unknown>).state).toBe('active');
  const previewed = await rpc<Record<string, unknown>>(alice,
    'select public.preview_form_preparation($1,$2,$3,$4,$5) as result',
    [preparationId, 1, opened.context.sourceRevision, opened.context.sourceFingerprint, randomUUID()],
    true,
  );
  expect((previewed.preparation as Record<string, unknown>).state).toBe('ready');
  const applied = await rpc<Record<string, unknown>>(alice,
    'select public.apply_form_preparation($1,$2,$3,$4,$5) as result',
    [preparationId, 1, opened.context.sourceRevision, opened.context.sourceFingerprint, randomUUID()],
    true,
  );
  expect((applied.application as Record<string, unknown>).targetTemplateVersionId).toEqual(expect.any(String));

  return {
    baseId,
    sourceVersionId,
    patientHiddenId,
    patientUniqueId,
    patientMultipleId,
    patientNoneId,
    encounterHiddenId,
    encounterHospitalisationId,
    encounterUniqueId,
  };
}

async function readPatient(fixture: Fixture, patientId: string, uid = alice): Promise<Context> {
  return rpc<Context>(uid, 'select public.read_patient_form_context($1,$2) as result', [fixture.baseId, patientId]);
}

async function readEncounter(fixture: Fixture, encounterId: string, uid = alice): Promise<Context> {
  return rpc<Context>(uid, 'select public.read_encounter_form_context($1,$2) as result', [fixture.baseId, encounterId]);
}

function item(context: Context, fieldKey: string): ContextField {
  const found = context.fields.find((candidate) => candidate.field_key === fieldKey);
  if (!found) throw new Error(`Champ absent du contexte: ${fieldKey}`);
  return found;
}

async function compatiblePatient(
  fixture: Fixture,
  patientId: string,
  context: Context,
  patch: Record<string, unknown>,
  operationId = randomUUID(),
  uid = alice,
): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>(uid,
    'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result',
    [
      fixture.baseId, patientId, JSON.stringify(patch), context.validation_status, null,
      context.record_revision, context.record_definition_revision, operationId, context.context_fingerprint,
    ],
  );
}

async function compatibleEncounter(
  fixture: Fixture,
  encounterId: string,
  context: Context,
  patch: Record<string, unknown>,
  operationId = randomUUID(),
  uid = alice,
): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>(uid,
    'select public.update_encounter_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result',
    [
      fixture.baseId, encounterId, JSON.stringify(patch), context.validation_status, null,
      context.record_revision, context.record_definition_revision, operationId, context.context_fingerprint,
    ],
  );
}

let fixture: Fixture;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  alice = users.get('alice@demo.test')!;
  bob = users.get('bob@demo.test')!;
  fixture = await createFixture();
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('E3 : contexte compatible patient et rencontre', () => {
  test('expose historique, additions, obligations, provenance et diagnostic sans identite', async () => {
    const context = await readPatient(fixture, fixture.patientHiddenId);
    expect(context.record_definition_revision).toBe(fixture.sourceVersionId);
    expect(context.active_revision).toBe(2);
    expect(context.record_revision).toBeGreaterThan(0);
    expect(context.context_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(context.validation_status).toBe('curated');
    expect(context.completeness.historical_complete).toBe(true);
    expect(context.completeness.current_complete).toBe(false);
    expect(context.completeness.current_missing_field_keys).toContain('patient_added_required');
    expect(context.current_obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_key: 'patient_added_required', reason: 'not_defined' }),
    ]));

    expect(item(context, 'sexe')).toMatchObject({
      definition_state: 'defined', value_state: 'present', applicability: 'applicable',
      value: 'M', provenance: expect.objectContaining({ origin: 'initial', definition_revision: fixture.sourceVersionId }),
    });
    expect(item(context, 'patient_added_required')).toMatchObject({
      definition_state: 'not_defined', value_state: 'empty', applicability: 'applicable',
    });
    expect(item(context, 'patient_added_required')).not.toHaveProperty('value');
    expect(item(context, 'patient_added_required').definition.defaultValue).toBeNull();

    // La couverture diagnostique est un resultat distinct de la completude ; le cas `other`
    // n'a pas de bloc, sans modifier le statut clinique ni creer une obligation artificielle.
    expect(context.diagnosis_coverage.counts).toEqual({ covered: 0, common_only: 0, uncovered: 1, unclassified: 0 });
    expect(context.diagnosis_coverage.diagnostics).toEqual([
      { code: 'other', status: 'uncovered', blockKeys: [] },
    ]);

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('patient-hidden-history');
    expect(serialized).not.toMatch(/full_name|date_of_birth|Nom secret/i);
  });

  test('masque une valeur historique sans la supprimer et conserve un bloc deja renseigne', async () => {
    const hiddenPatient = await readPatient(fixture, fixture.patientHiddenId);
    expect(item(hiddenPatient, 'patient_block_value')).toMatchObject({
      definition_state: 'defined', applicability: 'not_applicable', value_state: 'not_applicable',
      applicability_reason: 'rule_hidden',
    });
    expect(hiddenPatient.values).not.toHaveProperty('patient_block_value');
    await expect(compatiblePatient(fixture, fixture.patientHiddenId, hiddenPatient, {
      patient_block_value: 'tentative de modification masquee',
    })).rejects.toMatchObject({
      code: 'P0001', hint: 'refresh_required', detail: expect.stringContaining('block_hidden_value'),
    });

    const uniquePatient = await readPatient(fixture, fixture.patientUniqueId);
    expect(uniquePatient.diagnosis_coverage).toMatchObject({
      counts: { covered: 1, common_only: 0, uncovered: 0, unclassified: 0 },
    });
    expect(uniquePatient.diagnosis_coverage.diagnostics[0]).toMatchObject({
      code: 'target', status: 'covered', blockKeys: ['diagnostic_patient'],
    });
    expect(uniquePatient.values).toMatchObject({ patient_block_value: 'patient-block-filled' });
    expect(item(uniquePatient, 'patient_block_value').provenance).toMatchObject({ origin: 'initial' });

    const hiddenEncounter = await readEncounter(fixture, fixture.encounterHiddenId);
    expect(item(hiddenEncounter, 'ct_result')).toMatchObject({
      applicability: 'not_applicable', value_state: 'not_applicable', applicability_reason: 'rule_hidden',
    });
    expect(hiddenEncounter.values).not.toHaveProperty('ct_result');
    expect(JSON.stringify(hiddenEncounter)).not.toContain('encounter-hidden-history');
  });

  test('couvre diagnostic multiple, aucun diagnostic et diagnostic sans bloc', async () => {
    const multiple = await readPatient(fixture, fixture.patientMultipleId);
    expect(multiple.diagnosis_coverage.diagnostics).toEqual([
      { code: 'target', status: 'covered', blockKeys: ['diagnostic_patient'] },
      { code: 'other', status: 'uncovered', blockKeys: [] },
    ]);
    expect(multiple.diagnosis_coverage.counts).toEqual({ covered: 1, common_only: 0, uncovered: 1, unclassified: 0 });

    const none = await readPatient(fixture, fixture.patientNoneId);
    expect(item(none, 'diagnosis_driver_autre')).toMatchObject({
      definition_state: 'defined', applicability: 'applicable', value_state: 'empty',
    });
    expect(item(none, 'diagnosis_driver_autre')).not.toHaveProperty('value');
    expect(none.diagnosis_coverage.diagnostics).toEqual([]);
    expect(none.diagnosis_coverage.counts).toEqual({ covered: 0, common_only: 0, uncovered: 0, unclassified: 0 });

    const hospitalisation = await readEncounter(fixture, fixture.encounterHospitalisationId);
    expect(item(hospitalisation, 'encounter_added_required')).toMatchObject({
      applicability: 'applicable', definition_state: 'not_defined', value_state: 'empty',
    });
    expect(hospitalisation.current_obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_key: 'encounter_added_required', reason: 'not_defined' }),
    ]));
    expect(hospitalisation.completeness.historical_complete).toBe(true);
    expect(hospitalisation.completeness.current_complete).toBe(false);
    expect(hospitalisation.validation_status).toBe('curated');
  });

  test('fusionne le patch patient avec idempotence, provenance et statut conserve', async () => {
    const before = await readPatient(fixture, fixture.patientHiddenId);
    const operationId = randomUUID();
    const receipt = await compatiblePatient(fixture, fixture.patientHiddenId, before, {
      patient_added_optional: 'complément patient',
    }, operationId);
    expect(receipt).toMatchObject({
      recordKind: 'patient', recordId: fixture.patientHiddenId, recordRevision: before.record_revision + 1,
      validationStatus: 'curated', operationId, activeRevision: 2,
    });

    const replay = await compatiblePatient(fixture, fixture.patientHiddenId, before, {
      patient_added_optional: 'complément patient',
    }, operationId);
    expect(replay).toEqual(receipt);

    const row = (await db.admin.query(
      'select data,validation_status,row_version from public.patient where id=$1',
      [fixture.patientHiddenId],
    )).rows[0];
    expect(row.data).toMatchObject({
      sexe: 'M', birth_year: 1980, patient_block_value: 'patient-hidden-history', patient_added_optional: 'complément patient',
    });
    expect(row.validation_status).toBe('curated');
    expect(Number(row.row_version)).toBe(before.record_revision + 1);

    const after = await readPatient(fixture, fixture.patientHiddenId);
    expect(item(after, 'patient_added_optional')).toMatchObject({ value_state: 'present', value: 'complément patient' });
    expect(item(after, 'patient_added_optional').provenance).toMatchObject({
      origin: 'completion', operation_id: operationId,
    });
    expect(item(after, 'sexe').provenance).toMatchObject({ origin: 'initial' });
    expect(after.validation_status).toBe('curated');
  });

  test('fusionne le patch rencontre sans exposer le bloc masque et garde les champs historiques', async () => {
    const before = await readEncounter(fixture, fixture.encounterHiddenId);
    const receipt = await compatibleEncounter(fixture, fixture.encounterHiddenId, before, {
      encounter_added_optional: 'complément rencontre',
    });
    expect(receipt).toMatchObject({ recordKind: 'encounter', recordId: fixture.encounterHiddenId, recordRevision: 2 });

    const row = (await db.admin.query(
      'select data,validation_status,record_revision from public.encounter where id=$1',
      [fixture.encounterHiddenId],
    )).rows[0];
    expect(row.data).toMatchObject({
      diagnosis: 'ancien', glasgow_score: 10, encounter_diagnosis: ['other'],
      ct_result: 'encounter-hidden-history', encounter_added_optional: 'complément rencontre',
    });
    expect(row.validation_status).toBe('curated');
    expect(Number(row.record_revision)).toBe(2);
    expect((await readEncounter(fixture, fixture.encounterHiddenId)).values).not.toHaveProperty('ct_result');
  });

  test('refuse champ inconnu, portee, conversion, contexte altere et operation reutilisee', async () => {
    const patient = await readPatient(fixture, fixture.patientUniqueId);
    await expect(compatiblePatient(fixture, fixture.patientUniqueId, patient, { totally_unknown: 'x' }))
      .rejects.toThrow('FORM_FIELD_UNKNOWN');
    await expect(compatibleEncounter(fixture, fixture.encounterUniqueId, await readEncounter(fixture, fixture.encounterUniqueId), { sexe: 'F' }))
      .rejects.toThrow('FORM_SCOPE_INCOMPATIBLE');
    await expect(compatibleEncounter(fixture, fixture.encounterUniqueId, await readEncounter(fixture, fixture.encounterUniqueId), { glasgow_score: '12' }))
      .rejects.toThrow('FORM_VALUE_CONVERSION_REQUIRED');

    const current = await readPatient(fixture, fixture.patientUniqueId);
    await expect(rpc(alice,
      'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result',
      [fixture.baseId, fixture.patientUniqueId, JSON.stringify({ patient_added_optional: 'stale' }), current.validation_status, null,
        current.record_revision - 1, current.record_definition_revision, randomUUID(), current.context_fingerprint],
    )).rejects.toThrow('FORM_RECORD_CONFLICT');
    await expect(rpc(alice,
      'select public.update_patient_compatible($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as result',
      [fixture.baseId, fixture.patientUniqueId, JSON.stringify({ patient_added_optional: 'bad-context' }), current.validation_status, null,
        current.record_revision, current.record_definition_revision, randomUUID(), 'sha256:' + '0'.repeat(64)],
    )).rejects.toThrow('FORM_CONTEXT_CHANGED');

    const op = randomUUID();
    const first = await compatiblePatient(fixture, fixture.patientUniqueId, current, { patient_added_optional: 'idempotent' }, op);
    expect(first.recordRevision).toBe(current.record_revision + 1);
    await expect(compatiblePatient(fixture, fixture.patientUniqueId, current, { patient_added_optional: 'different' }, op))
      .rejects.toThrow('FORM_RECORD_CONFLICT');
  });

  test('arbitre deux complements concurrents sur la revision de la fiche', async () => {
    const current = await readPatient(fixture, fixture.patientMultipleId);
    const results = await Promise.allSettled([
      compatiblePatient(fixture, fixture.patientMultipleId, current, { patient_added_optional: 'concurrent-a' }),
      compatiblePatient(fixture, fixture.patientMultipleId, current, { patient_added_optional: 'concurrent-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason.message).toContain('FORM_RECORD_CONFLICT');
    const row = (await db.admin.query(
      'select data,row_version from public.patient where id=$1',
      [fixture.patientMultipleId],
    )).rows[0];
    expect(['concurrent-a', 'concurrent-b']).toContain(row.data.patient_added_optional);
    expect(Number(row.row_version)).toBe(2);
  });

  test('arbitre deux complements concurrents sur la revision de la rencontre', async () => {
    const current = await readEncounter(fixture, fixture.encounterUniqueId);
    const results = await Promise.allSettled([
      compatibleEncounter(fixture, fixture.encounterUniqueId, current, { encounter_added_optional: 'concurrent-a' }),
      compatibleEncounter(fixture, fixture.encounterUniqueId, current, { encounter_added_optional: 'concurrent-b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason.message).toContain('FORM_RECORD_CONFLICT');
    const row = (await db.admin.query(
      'select data,validation_status,record_revision from public.encounter where id=$1',
      [fixture.encounterUniqueId],
    )).rows[0];
    expect(['concurrent-a', 'concurrent-b']).toContain(row.data.encounter_added_optional);
    expect(row.validation_status).toBe('curated');
    expect(Number(row.record_revision)).toBe(2);
  });

  test('un ancien payload complet conserve les ajouts actifs omis par le client', async () => {
    const patientId = fixture.patientNoneId;
    const before = await readPatient(fixture, patientId);
    const oldPayload = { sexe: 'F', birth_year: 1979, diagnosis_driver: ['target'], patient_block_value: 'patient-block-filled', patient_finding: 'correction historique' };
    await rpc(alice,
      'select public.update_patient($1,$2::jsonb,$3,$4,$5) as result',
      [patientId, JSON.stringify(oldPayload), 'curated', 'payload ancien', before.record_revision],
    );
    const row = (await db.admin.query('select data from public.patient where id=$1', [patientId])).rows[0];
    expect(row.data).not.toHaveProperty('patient_added_optional');
    expect(row.data).not.toHaveProperty('patient_added_required');
    // Cette fiche n'avait pas encore de complément actif : le payload historique ne reçoit donc
    // pas de valeur inventée. Le test de conservation est fait après un complément explicite.
    const context = await readPatient(fixture, patientId);
    const receipt = await compatiblePatient(fixture, patientId, context, { patient_added_optional: 'avant payload ancien' });
    const oldAfterAddition = await readPatient(fixture, patientId);
    await rpc(alice,
      'select public.update_patient($1,$2::jsonb,$3,$4,$5) as result',
      [patientId, JSON.stringify(oldPayload), 'curated', 'ancien client apres ajout', receipt.recordRevision],
    );
    const preserved = (await db.admin.query('select data from public.patient where id=$1', [patientId])).rows[0].data;
    expect(preserved).toMatchObject({ patient_added_optional: 'avant payload ancien' });
    expect(preserved.patient_added_required).toBeUndefined();
    expect(oldAfterAddition.values.patient_added_optional).toBe('avant payload ancien');
  });

  test('un ancien payload complet de rencontre conserve les ajouts actifs omis', async () => {
    const encounterId = fixture.encounterHospitalisationId;
    const oldPayload = {
      admission_date: '2026-09-02',
      diagnosis: 'hospitalisation',
      glasgow_score: 12,
      encounter_diagnosis: ['target'],
      ct_result: 'hospital-block-filled',
    };
    await rpc(alice,
      'select public.update_encounter($1,$2::jsonb,$3,$4) as result',
      [encounterId, JSON.stringify(oldPayload), 'curated', 'payload ancien rencontre'],
    );
    const row = (await db.admin.query('select data from public.encounter where id=$1', [encounterId])).rows[0];
    expect(row.data).not.toHaveProperty('encounter_added_optional');
    expect(row.data).not.toHaveProperty('encounter_added_required');

    const context = await readEncounter(fixture, encounterId);
    const receipt = await compatibleEncounter(fixture, encounterId, context, {
      encounter_added_optional: 'avant payload ancien rencontre',
    });
    await rpc(alice,
      'select public.update_encounter($1,$2::jsonb,$3,$4) as result',
      [encounterId, JSON.stringify(oldPayload), 'curated', 'ancien client rencontre apres ajout'],
    );
    const preserved = (await db.admin.query('select data from public.encounter where id=$1', [encounterId])).rows[0].data;
    expect(preserved).toMatchObject({ encounter_added_optional: 'avant payload ancien rencontre' });
    expect(preserved.encounter_added_required).toBeUndefined();
    expect(receipt.recordKind).toBe('encounter');
  });

  test('refuse une lecture et une ecriture apres revocation sans ouvrir l identite', async () => {
    await db.admin.query(`
      insert into public.base_access(base_id,user_id,access_role,can_edit_structured_data,granted_by)
      values($1,$2,'editor',true,$3)
      on conflict (base_id,user_id) do update set revoked_at=null,can_edit_structured_data=true
    `, [fixture.baseId, bob, alice]);
    const visible = await readPatient(fixture, fixture.patientNoneId, bob);
    expect(visible.record_id).toBe(fixture.patientNoneId);
    expect(JSON.stringify(visible)).not.toMatch(/full_name|date_of_birth|E3-HIDDEN/);

    await db.admin.query('update public.base_access set revoked_at=clock_timestamp() where base_id=$1 and user_id=$2', [fixture.baseId, bob]);
    await expect(readPatient(fixture, fixture.patientNoneId, bob)).rejects.toThrow('FORM_RECORD_FORBIDDEN');
    const aliceContext = await readPatient(fixture, fixture.patientNoneId);
    await expect(compatiblePatient(fixture, fixture.patientNoneId, aliceContext, { patient_added_optional: 'bob-revoked' }, randomUUID(), bob))
      .rejects.toThrow('FORM_RECORD_FORBIDDEN');
  });
});
