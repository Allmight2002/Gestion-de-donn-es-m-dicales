import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;

type Definition = Record<string, unknown> & {
  sections: Array<Record<string, unknown>>;
  commonGroups: Array<Record<string, unknown>>;
  fields: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  diagnosisConfiguration: Array<Record<string, unknown>>;
};

interface Fixture {
  sourceTemplateId: string;
  sourceVersionId: string;
  baseAId: string;
  baseBId: string;
}

interface SavedPreparation {
  fixture: Fixture;
  preparationId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  payload: Definition;
  saveResult: E2Result;
}

interface E2PreparationReceipt {
  contentFingerprint: string;
  state: string;
  classification: string;
  [key: string]: unknown;
}

interface E2Impact {
  clinicalWrites: { patients: number; encounters: number; values: number };
  identityWrites: number;
  documentWrites: number;
  serverCounts: { patients: number; encounters: number };
  addedFields: unknown[];
  addedCommonGroups: unknown[];
  addedDiagnosisAssociations: unknown[];
  [key: string]: unknown;
}

interface E2Application {
  baseId: string;
  sourceTemplateVersionId: string;
  targetTemplateVersionId: string;
  newTemplate: boolean;
  targetRevision: number | string;
  [key: string]: unknown;
}

interface E2Result {
  preparation: E2PreparationReceipt;
  operationId: string;
  operationKind: string;
  impact: E2Impact;
  application: E2Application;
  error?: string;
  payloadPreserved?: boolean;
  [key: string]: unknown;
}

const DIAGNOSIS_HEADERS = `select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',true)`;

async function asAlice<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return db.asUser(aliceId, async (client) => {
    await client.query(DIAGNOSIS_HEADERS);
    return fn(client);
  });
}

async function callRpc<T>(uid: string, sql: string, params: unknown[], withDiagnosis = false): Promise<T> {
  return db.asUser(uid, async (client) => {
    if (withDiagnosis) await client.query(DIAGNOSIS_HEADERS);
    return (await client.query(sql, params)).rows[0].result as T;
  });
}

async function createFixture(): Promise<Fixture> {
  const sourceTemplateId = randomUUID();
  const sourceVersionId = randomUUID();
  const rootSectionId = randomUUID();
  const childSectionId = randomUUID();
  const commonGroupId = randomUUID();
  const baseAId = randomUUID();
  const baseBId = randomUUID();

  await db.admin.query('begin');
  try {
    await db.admin.query("select set_config('app.setting_common_layout','on',true)");
    await db.admin.query(`
      insert into public.template(id,name,specialty,owner_user_id,is_global)
      values($1,$2,$3,null,true)
    `, [sourceTemplateId, `E2 source ${sourceTemplateId.slice(0, 8)}`, 'e2-test']);
    await db.admin.query(`
      insert into public.template_version(id,template_id,version_number,status,created_by)
      values($1,$2,1,'draft',$3)
    `, [sourceVersionId, sourceTemplateId, aliceId]);
    await db.admin.query(`
      insert into public.template_section(id,template_version_id,section_key,label,display_order)
      values
        ($1,$3,'root','Bloc racine',0),
        ($2,$3,'child','Sous-bloc',1)
    `, [rootSectionId, childSectionId, sourceVersionId]);
    await db.admin.query(
      'update public.template_section set parent_section_id=$1 where id=$2',
      [rootSectionId, childSectionId],
    );
    await db.admin.query(`
      insert into public.template_common_group(
        id,template_version_id,group_key,label,display_order,anchor_order,is_default
      ) values($1,$2,'context','Contexte',0,0,true)
    `, [commonGroupId, sourceVersionId]);
    await db.admin.query(`
      insert into public.template_field(
        template_version_id,field_key,label,scope,section,section_id,type,
        allowed_values,required,allow_missing_codes,display_order,common_group_id
      ) values
        ($1,'diagnosis_driver','Diagnostic principal','patient',null,null,'select','["target","other"]'::jsonb,false,true,0,$2),
        ($1,'diagnosis_driver_autre','Autre diagnostic','patient',null,null,'text',null,false,true,1,$2),
        ($1,'score','Score','patient','child',$3,'integer',null,false,true,2,null),
        ($1,'finding','Constat','patient','child',$3,'text',null,false,true,3,null)
    `, [sourceVersionId, commonGroupId, childSectionId]);
    await db.admin.query(`
      insert into public.validation_rule(template_version_id,rule,message,severity)
      values($1,$2::jsonb,$3,'block')
    `, [
      sourceVersionId,
      JSON.stringify({
        if: { field: 'diagnosis_driver', operator: 'equals', value: 'target' },
        then: { field: 'finding', operator: 'required' },
      }),
      'Un constat est requis pour ce diagnostic',
    ]);
    await db.admin.query(`
      insert into public.base(id,name,specialty,owner_user_id,current_template_version_id)
      values
        ($1,'Base E2 A','e2-test',$3,$5),
        ($2,'Base E2 B','e2-test',$4,$5)
    `, [baseAId, baseBId, aliceId, bobId, sourceVersionId]);
    await db.admin.query(`
      insert into public.patient(
        id,base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by
      ) values
        ($1,$3,'E2-A-001',$5,'{"diagnosis_driver":"target","finding":"deja present"}'::jsonb,'direct','draft',$6),
        ($2,$4,'E2-B-001',$5,'{"diagnosis_driver":"other"}'::jsonb,'direct','draft',$7)
    `, [randomUUID(), randomUUID(), baseAId, baseBId, sourceVersionId, aliceId, bobId]);
    const patients = (await db.admin.query(
      'select id,base_id from public.patient where patient_code in ($1,$2) order by patient_code',
      ['E2-A-001', 'E2-B-001'],
    )).rows;
    await db.admin.query(`
      insert into public.encounter(
        patient_id,template_version_id,encounter_type,encounter_date,data,collection_mode,validation_status,created_by
      ) values
        ($1,$3,'consultation','2026-09-01','{}'::jsonb,'direct','draft',$4),
        ($2,$3,'consultation','2026-09-02','{}'::jsonb,'direct','draft',$5)
    `, [patients.find((row) => row.base_id === baseAId)!.id,
      patients.find((row) => row.base_id === baseBId)!.id, sourceVersionId, aliceId, bobId]);
    await db.admin.query('commit');
  } catch (error) {
    await db.admin.query('rollback');
    throw error;
  }
  return { sourceTemplateId, sourceVersionId, baseAId, baseBId };
}

async function readContext(fixture: Fixture): Promise<{
  sourceRevision: number;
  sourceFingerprint: string;
  definition: Definition;
}> {
  const result = await callRpc<{
    context: { sourceRevision: number; sourceFingerprint: string; definition: Definition };
  }>(aliceId,
    'select public.open_or_resume_form_preparation($1) as result', [fixture.baseAId]);
  return {
    sourceRevision: Number(result.context.sourceRevision),
    sourceFingerprint: String(result.context.sourceFingerprint),
    definition: JSON.parse(JSON.stringify(result.context.definition)) as Definition,
  };
}

function addCandidateChanges(definition: Definition): Definition {
  const payload = JSON.parse(JSON.stringify(definition)) as Definition;
  payload.commonGroups.push({
    groupKey: 'diagnostics',
    label: 'Diagnostics',
    displayOrder: 1,
    anchorOrder: 0,
    isDefault: false,
  });
  payload.fields.push(
    {
      fieldKey: `optional_${randomUUID().slice(0, 8)}`,
      label: 'Variable facultative E2',
      scope: 'patient',
      sectionKey: 'child',
      type: 'text',
      unit: null,
      allowedValues: null,
      required: false,
      minValue: null,
      maxValue: null,
      allowMissingCodes: true,
      displayOrder: 20,
      encounterTypes: null,
      description: 'Ajout structurel fictif',
      defaultValue: null,
      missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
      allowedOptions: null,
      isMultiple: false,
      formula: null,
      commonGroupKey: null,
    },
    {
      fieldKey: `required_${randomUUID().slice(0, 8)}`,
      label: 'Variable obligatoire E2',
      scope: 'patient',
      sectionKey: 'child',
      type: 'text',
      unit: null,
      allowedValues: null,
      required: true,
      minValue: null,
      maxValue: null,
      allowMissingCodes: true,
      displayOrder: 21,
      encounterTypes: null,
      description: 'Complétion explicite ultérieure',
      defaultValue: null,
      missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
      allowedOptions: null,
      isMultiple: false,
      formula: null,
      commonGroupKey: null,
    },
    {
      fieldKey: `common_${randomUUID().slice(0, 8)}`,
      label: 'Variable commune E2',
      scope: 'patient',
      sectionKey: null,
      type: 'text',
      unit: null,
      allowedValues: null,
      required: false,
      minValue: null,
      maxValue: null,
      allowMissingCodes: true,
      displayOrder: 22,
      encounterTypes: null,
      description: 'Ajout UX-16 fictif',
      defaultValue: null,
      missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
      allowedOptions: null,
      isMultiple: false,
      formula: null,
      commonGroupKey: 'diagnostics',
    },
  );
  payload.rules.push({
    rule: {
      if: { field: 'diagnosis_driver', operator: 'equals', value: 'target' },
      then: { field: 'score', operator: 'required' },
    },
    message: 'Le score est requis pour ce diagnostic',
    severity: 'warn',
  });
  payload.rules.push({
    rule: {
      if: { field: 'diagnosis_driver', operator: 'contains_any', value: ['other'] },
      then: { section: 'root', operator: 'visible' },
    },
    message: 'Le bloc est disponible pour ce diagnostic',
    severity: 'warn',
  });
  payload.diagnosisConfiguration.push({
    scope: 'patient',
    diagnosisFieldKey: 'diagnosis_driver',
    terminologyReleaseId: null,
    commonOnlyCodes: ['target'],
  });
  return payload;
}

async function prepare(fixture: Fixture, payloadBuilder = addCandidateChanges): Promise<SavedPreparation> {
  const context = await readContext(fixture);
  const payload = payloadBuilder(context.definition);
  const preparationId = randomUUID();
  const saveResult = await callRpc<E2Result>(aliceId,
    'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
    [preparationId, fixture.baseAId, 0, context.sourceRevision, context.sourceFingerprint, randomUUID(), JSON.stringify(payload)],
    true);
  return {
    fixture,
    preparationId,
    sourceRevision: context.sourceRevision,
    sourceFingerprint: context.sourceFingerprint,
    payload,
    saveResult,
  };
}

async function preview(prepared: SavedPreparation, operationId = randomUUID()): Promise<E2Result> {
  return callRpc<E2Result>(aliceId,
    'select public.preview_form_preparation($1,$2,$3,$4,$5) as result',
    [prepared.preparationId, 1, prepared.sourceRevision, prepared.sourceFingerprint, operationId],
    true);
}

async function apply(prepared: SavedPreparation, operationId = randomUUID()): Promise<E2Result> {
  return callRpc<E2Result>(aliceId,
    'select public.apply_form_preparation($1,$2,$3,$4,$5) as result',
    [prepared.preparationId, 1, prepared.sourceRevision, prepared.sourceFingerprint, operationId],
    true);
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const ids = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = ids.get('alice@demo.test')!;
  bobId = ids.get('bob@demo.test')!;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('E2 application atomique des préparations', () => {
  test('recalcule l’impact, copie toute la structure et rattache uniquement A', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    const ready = await preview(prepared);
    expect(ready.preparation.state).toBe('ready');
    expect(ready.preparation.classification).toBe('additive_required');
    expect(ready.impact.serverCounts).toEqual({ patients: 1, encounters: 1 });
    expect(ready.impact.addedDiagnosisAssociations).toHaveLength(1);

    const before = (await db.admin.query(`
      select
        (select count(*) from public.patient where base_id in ($1,$2)) as patients,
        (select count(*) from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id in ($1,$2)) as encounters,
        (select count(*) from public.template_version where template_id=$3) as source_versions,
        (select count(*) from public.validation_rule where template_version_id=$4) as source_rules
    `, [fixture.baseAId, fixture.baseBId, fixture.sourceTemplateId, fixture.sourceVersionId])).rows[0];
    const sourceBefore = (await db.admin.query(`
      select
        (select count(*) from public.template_section where template_version_id=$1) as sections,
        (select count(*) from public.template_common_group where template_version_id=$1) as groups,
        (select count(*) from public.template_field where template_version_id=$1) as fields,
        (select count(*) from public.validation_rule where template_version_id=$1) as rules
    `, [fixture.sourceVersionId])).rows[0];
    const clinicalBefore = (await db.admin.query(`
      select id,base_id,patient_code,template_version_id,data from public.patient
       where base_id in ($1,$2) order by patient_code
    `, [fixture.baseAId, fixture.baseBId])).rows;
    const encountersBefore = (await db.admin.query(`
      select e.id,p.base_id,e.patient_id,e.template_version_id,e.data
        from public.encounter e join public.patient p on p.id=e.patient_id
       where p.base_id in ($1,$2) order by e.id
    `, [fixture.baseAId, fixture.baseBId])).rows;
    const draftsBefore = (await db.admin.query(
      'select id,base_id,state,payload from public.work_draft where base_id in ($1,$2) order by id',
      [fixture.baseAId, fixture.baseBId],
    )).rows;
    const attachmentsBefore = (await db.admin.query(`
      select a.id,p.base_id,a.storage_path,a.deleted_at
        from public.clinical_attachment a join public.patient p on p.id=a.patient_id
       where p.base_id in ($1,$2) order by a.id
    `, [fixture.baseAId, fixture.baseBId])).rows;

    const result = await apply(prepared);
    expect(result.operationKind).toBe('apply');
    expect(result.preparation.state).toBe('applied');
    expect(result.application).toMatchObject({
      baseId: fixture.baseAId,
      sourceTemplateVersionId: fixture.sourceVersionId,
      newTemplate: true,
      targetRevision: 2,
    });
    expect(result.impact.clinicalWrites).toEqual({ patients: 0, encounters: 0, values: 0 });
    expect(result.impact.identityWrites).toBe(0);
    expect(result.impact.documentWrites).toBe(0);
    expect(result.impact.serverCounts).toEqual({ patients: 1, encounters: 1 });
    expect(result.impact.addedFields).toHaveLength(3);
    expect(result.impact.addedCommonGroups).toEqual([{ groupKey: 'diagnostics' }]);
    expect(result.impact.addedDiagnosisAssociations[0]).toMatchObject({
      scope: 'patient', diagnosisFieldKey: 'diagnosis_driver', commonOnlyCodeCount: 1,
    });

    const targetVersionId = result.application.targetTemplateVersionId;
    const target = (await db.admin.query(`
      select tv.template_id, tv.derived_from_template_version_id, tv.derived_from_preparation_id,
             tv.derived_from_content_fingerprint, tv.applied_operation_id, t.owner_user_id, t.is_global
        from public.template_version tv join public.template t on t.id=tv.template_id
       where tv.id=$1
    `, [targetVersionId])).rows[0];
    expect(target).toMatchObject({
      derived_from_template_version_id: fixture.sourceVersionId,
      derived_from_preparation_id: prepared.preparationId,
      derived_from_content_fingerprint: prepared.saveResult.preparation.contentFingerprint,
      applied_operation_id: result.operationId,
      owner_user_id: aliceId,
      is_global: false,
    });

    const sourceSections = (await db.admin.query(
      'select id,section_key,parent_section_id from public.template_section where template_version_id=$1 order by section_key',
      [fixture.sourceVersionId],
    )).rows;
    const targetSections = (await db.admin.query(
      'select id,section_key,parent_section_id,source_template_version_id,source_section_key from public.template_section where template_version_id=$1 order by section_key',
      [targetVersionId],
    )).rows;
    expect(targetSections).toHaveLength(sourceSections.length);
    expect(new Set(targetSections.map((row) => row.id))).not.toEqual(new Set(sourceSections.map((row) => row.id)));
    const targetRoot = targetSections.find((row) => row.section_key === 'root');
    const targetChild = targetSections.find((row) => row.section_key === 'child');
    expect(targetChild.parent_section_id).toBe(targetRoot.id);
    expect(targetChild).toMatchObject({ source_template_version_id: fixture.sourceVersionId, source_section_key: 'child' });

    const targetGroups = (await db.admin.query(
      'select id,group_key,source_template_version_id,source_group_key from public.template_common_group where template_version_id=$1 order by group_key',
      [targetVersionId],
    )).rows;
    expect(targetGroups.map((row) => row.group_key)).toEqual(['context', 'diagnostics']);
    expect(targetGroups.find((row) => row.group_key === 'context')).toMatchObject({
      source_template_version_id: fixture.sourceVersionId, source_group_key: 'context',
    });

    const targetFields = (await db.admin.query(`
      select id,field_key,section,section_id,common_group_id,source_template_version_id,source_field_key,default_value
        from public.template_field where template_version_id=$1 order by field_key
    `, [targetVersionId])).rows;
    const sourceFields = (await db.admin.query(
      'select id,field_key from public.template_field where template_version_id=$1',
      [fixture.sourceVersionId],
    )).rows;
    expect(targetFields).toHaveLength(sourceFields.length + 3);
    expect(targetFields.filter((row) => row.source_template_version_id === fixture.sourceVersionId)).toHaveLength(sourceFields.length);
    expect(targetFields.find((row) => row.field_key.startsWith('common_'))).toMatchObject({
      section: null,
      section_id: null,
      default_value: null,
    });
    expect(targetFields.find((row) => row.field_key === 'score')).toMatchObject({
      section: 'child', source_template_version_id: fixture.sourceVersionId, source_field_key: 'score',
    });
    expect(targetFields.find((row) => row.field_key.startsWith('common_')).common_group_id)
      .toBe(targetGroups.find((row) => row.group_key === 'diagnostics').id);

    const sourceRule = (await db.admin.query(
      'select id from public.validation_rule where template_version_id=$1', [fixture.sourceVersionId],
    )).rows[0];
    const targetRules = (await db.admin.query(
      'select id,rule,source_validation_rule_id,source_template_version_id from public.validation_rule where template_version_id=$1',
      [targetVersionId],
    )).rows;
    expect(targetRules).toHaveLength(3);
    expect(targetRules.some((row) => row.source_validation_rule_id === sourceRule.id)).toBe(true);
    expect(targetRules.filter((row) => row.source_validation_rule_id === null)).toHaveLength(2);
    expect(targetRules.map((row) => row.id)).not.toContain(sourceRule.id);
    expect(targetRules.find((row) => row.rule.then?.section === 'root')).toMatchObject({
      source_validation_rule_id: null,
      source_template_version_id: null,
    });
    expect((await db.admin.query('select diagnosis_configuration from public.template_version where id=$1', [targetVersionId])).rows[0].diagnosis_configuration).toHaveLength(1);

    const bases = (await db.admin.query(
      'select id,current_template_version_id,form_revision from public.base where id in ($1,$2) order by id',
      [fixture.baseAId, fixture.baseBId],
    )).rows;
    expect(bases.find((row) => row.id === fixture.baseAId)).toMatchObject({ current_template_version_id: targetVersionId, form_revision: '2' });
    expect(bases.find((row) => row.id === fixture.baseBId)).toMatchObject({ current_template_version_id: fixture.sourceVersionId, form_revision: '1' });
    expect((await db.admin.query('select count(*) from public.form_preparation_application where preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('1');
    expect((await db.admin.query("select count(*) from public.audit_log where action='form_preparation_applied' and entity_id=$1", [prepared.preparationId])).rows[0].count).toBe('1');

    const after = (await db.admin.query(`
      select
        (select count(*) from public.patient where base_id in ($1,$2)) as patients,
        (select count(*) from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id in ($1,$2)) as encounters,
        (select count(*) from public.template_version where template_id=$3) as source_versions,
        (select count(*) from public.validation_rule where template_version_id=$4) as source_rules
    `, [fixture.baseAId, fixture.baseBId, fixture.sourceTemplateId, fixture.sourceVersionId])).rows[0];
    expect(after).toEqual(before);
    expect((await db.admin.query(`
      select
        (select count(*) from public.template_section where template_version_id=$1) as sections,
        (select count(*) from public.template_common_group where template_version_id=$1) as groups,
        (select count(*) from public.template_field where template_version_id=$1) as fields,
        (select count(*) from public.validation_rule where template_version_id=$1) as rules
    `, [fixture.sourceVersionId])).rows[0]).toEqual(sourceBefore);
    expect((await db.admin.query(`
      select id,base_id,patient_code,template_version_id,data from public.patient
       where base_id in ($1,$2) order by patient_code
    `, [fixture.baseAId, fixture.baseBId])).rows).toEqual(clinicalBefore);
    expect((await db.admin.query(`
      select e.id,p.base_id,e.patient_id,e.template_version_id,e.data
        from public.encounter e join public.patient p on p.id=e.patient_id
       where p.base_id in ($1,$2) order by e.id
    `, [fixture.baseAId, fixture.baseBId])).rows).toEqual(encountersBefore);
    expect((await db.admin.query(
      'select id,base_id,state,payload from public.work_draft where base_id in ($1,$2) order by id',
      [fixture.baseAId, fixture.baseBId],
    )).rows).toEqual(draftsBefore);
    expect((await db.admin.query(`
      select a.id,p.base_id,a.storage_path,a.deleted_at
        from public.clinical_attachment a join public.patient p on p.id=a.patient_id
       where p.base_id in ($1,$2) order by a.id
    `, [fixture.baseAId, fixture.baseBId])).rows).toEqual(attachmentsBefore);
  }, 120_000);

  test('rejoue exactement le reçu et refuse la réutilisation de clé', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    await preview(prepared);
    const operationId = randomUUID();
    const first = await apply(prepared, operationId);
    const countAfterFirst = (await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count;
    const replay = await apply(prepared, operationId);
    expect(replay).toEqual(first);
    expect((await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe(countAfterFirst);
    await expect(asAlice(async (client) => client.query(
      'select public.apply_form_preparation($1,$2,$3,$4,$5)',
      [prepared.preparationId, 99, prepared.sourceRevision, prepared.sourceFingerprint, operationId],
    ))).rejects.toThrow('FORM_PREPARATION_OPERATION_CONFLICT');
    expect((await db.admin.query('select count(*) from public.form_preparation_operation where preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('3');
  }, 120_000);

  test('refuse sémantiquement sans toucher la source ni créer de révision', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture, (definition) => {
      const payload = JSON.parse(JSON.stringify(definition)) as Definition;
      const driver = payload.fields.find((field) => field.fieldKey === 'diagnosis_driver')!;
      driver.type = 'text';
      return payload;
    });
    const ready = await preview(prepared);
    expect(ready.error).toBe('FORM_SEMANTIC_MIGRATION_REQUIRED');
    const refused = await apply(prepared);
    expect(refused.error).toBe('FORM_SEMANTIC_MIGRATION_REQUIRED');
    expect(refused.payloadPreserved).toBe(true);
    expect((await db.admin.query('select type from public.template_field where template_version_id=$1 and field_key=$2', [fixture.sourceVersionId, 'diagnosis_driver'])).rows[0].type).toBe('select');
    expect((await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('0');
    expect((await db.admin.query('select payload from public.form_preparation where id=$1', [prepared.preparationId])).rows[0].payload.fields.find((field: Record<string, unknown>) => field.fieldKey === 'diagnosis_driver').type).toBe('text');
  }, 120_000);

  test('reclasse en sémantique un déplacement UX-16 vers un bloc clinique', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture, (definition) => {
      const payload = JSON.parse(JSON.stringify(definition)) as Definition;
      const driver = payload.fields.find((field) => field.fieldKey === 'diagnosis_driver')!;
      driver.sectionKey = 'child';
      driver.commonGroupKey = null;
      return payload;
    });
    const previewResult = await preview(prepared);
    expect(previewResult.error).toBe('FORM_SEMANTIC_MIGRATION_REQUIRED');
    expect(previewResult.impact.classification).toBe('semantic');
    const applyResult = await apply(prepared);
    expect(applyResult.error).toBe('FORM_SEMANTIC_MIGRATION_REQUIRED');
    expect((await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('0');
    expect((await db.admin.query('select current_template_version_id,form_revision from public.base where id=$1', [fixture.baseAId])).rows[0]).toMatchObject({ current_template_version_id: fixture.sourceVersionId, form_revision: '1' });
  }, 120_000);

  test('deux applications concurrentes : une seule gagne et l’autre reçoit un conflit', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    await preview(prepared);
    const calls = [randomUUID(), randomUUID()].map((operationId) => apply(prepared, operationId));
    const outcomes = await Promise.all(calls);
    expect(outcomes.filter((outcome) => outcome?.application)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome?.error === 'FORM_PREPARATION_CONFLICT')).toHaveLength(1);
    expect((await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('1');
    expect((await db.admin.query('select state,payload from public.form_preparation where id=$1', [prepared.preparationId])).rows[0]).toMatchObject({ state: 'applied', payload: {} });
  }, 120_000);

  test('un échec après la copie logique annule toute la transaction', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    await preview(prepared);
    await db.admin.query(`
      create function public.e2_test_fail_apply()
      returns trigger language plpgsql as $$
      begin
        if new.id = '${fixture.baseAId}'::uuid then raise exception 'E2_TEST_FAIL'; end if;
        return new;
      end
      $$
    `);
    await db.admin.query('create trigger e2_test_fail_apply before update of current_template_version_id on public.base for each row execute function public.e2_test_fail_apply()');
    try {
      await expect(apply(prepared)).rejects.toThrow('FORM_PREPARATION_APPLY_FAILED');
    } finally {
      await db.admin.query('drop trigger if exists e2_test_fail_apply on public.base');
      await db.admin.query('drop function if exists public.e2_test_fail_apply()');
    }
    expect((await db.admin.query('select current_template_version_id,form_revision from public.base where id=$1', [fixture.baseAId])).rows[0]).toMatchObject({ current_template_version_id: fixture.sourceVersionId, form_revision: '1' });
    expect((await db.admin.query('select count(*) from public.template_version where derived_from_preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('0');
    expect((await db.admin.query('select count(*) from public.form_preparation_application where preparation_id=$1', [prepared.preparationId])).rows[0].count).toBe('0');
    expect((await db.admin.query('select state,payload from public.form_preparation where id=$1', [prepared.preparationId])).rows[0]).toMatchObject({ state: 'ready' });
  }, 120_000);

  test('refuse les droits croisés et ferme les tables internes', async () => {
    const fixture = await createFixture();
    const prepared = await prepare(fixture);
    await preview(prepared);
    await expect(callRpc<E2Result>(bobId,
      'select public.apply_form_preparation($1,$2,$3,$4,$5) as result',
      [prepared.preparationId, 1, prepared.sourceRevision, prepared.sourceFingerprint, randomUUID()], true,
    )).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await expect(db.asUser(bobId, (client) => client.query(
      'select * from public.form_preparation_application',
    ))).rejects.toThrow('permission denied');
    const foreign = await createFixture();
    await expect(db.asUser(aliceId, (client) => client.query(
      'update public.base set current_template_version_id=$1 where id=$2',
      [foreign.sourceVersionId, fixture.baseAId],
    ))).rejects.toThrow();
    expect((await db.admin.query('select current_template_version_id,form_revision from public.base where id=$1', [fixture.baseAId])).rows[0]).toMatchObject({ current_template_version_id: fixture.sourceVersionId, form_revision: '1' });
  }, 120_000);
});
