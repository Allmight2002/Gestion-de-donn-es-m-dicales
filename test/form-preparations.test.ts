import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;
let editorId: string;
let annaId: string;
let baseId: string;
let templateVersionId: string;

const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const open = () => rowsAs(aliceId, 'select public.open_or_resume_form_preparation($1) as result', [baseId]);

async function freshPayload() {
  const result = (await open())[0].result as {
    context: { sourceRevision: number; sourceFingerprint: string; definition: Record<string, unknown> };
  };
  const definition = JSON.parse(JSON.stringify(result.context.definition)) as Record<string, unknown>;
  const fields = definition.fields as Array<Record<string, unknown>>;
  fields.push({
    fieldKey: `e1_added_${randomUUID().slice(0, 8)}`,
    label: 'Variable structurelle E1',
    scope: 'patient',
    sectionKey: 'clinique',
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: true,
    displayOrder: 999,
    encounterTypes: null,
    description: 'Ajout fictif de test',
    defaultValue: null,
    missingReasons: ['non_fait', 'inconnu', 'non_applicable'],
    allowedOptions: null,
    isMultiple: false,
    formula: null,
    commonGroupKey: null,
  });
  return { payload: definition, sourceRevision: result.context.sourceRevision, sourceFingerprint: result.context.sourceFingerprint };
}

async function saveNew(operationId = randomUUID()) {
  const source = await freshPayload();
  const preparationId = randomUUID();
  const result = (await rowsAs(aliceId,
    'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
    [preparationId, baseId, 0, source.sourceRevision, source.sourceFingerprint, operationId, JSON.stringify(source.payload)]))[0].result;
  return { preparationId, source, result };
}

async function discard(preparationId: string, revision: number, source: { sourceRevision: number; sourceFingerprint: string }) {
  return rowsAs(aliceId,
    'select public.discard_form_preparation($1,$2,$3,$4,$5) as result',
    [preparationId, revision, source.sourceRevision, source.sourceFingerprint, randomUUID()]);
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const ids = new Map<string, string>(
    (await db.admin.query('select email,id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = ids.get('alice@demo.test')!;
  bobId = ids.get('bob@demo.test')!;
  editorId = ids.get('editor@demo.test')!;
  annaId = ids.get('anna.analyst@demo.test')!;
  const base = (await db.admin.query(
    'select id,current_template_version_id from public.base where owner_user_id=$1 limit 1', [aliceId],
  )).rows[0];
  baseId = base.id;
  templateVersionId = base.current_template_version_id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('E1 préparations de formulaire : contrat serveur', () => {
  test('ouvre sans persister et ne touche aucune donnée clinique', async () => {
    const before = (await db.admin.query(`
      select
        (select count(*) from public.patient where base_id=$1) as patients,
        (select count(*) from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1) as encounters,
        (select count(*) from public.patient_identity where base_id=$1) as identities,
        (select count(*) from public.raw_document where base_id=$1) as documents`, [baseId])).rows[0];
    const result = (await open())[0].result;
    expect(result.persisted).toBe(false);
    expect(result.preparation).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/"fullName"\s*:|"patient_code"\s*:|"date_of_birth"\s*:|"responses"\s*:|"answers"\s*:|"values"\s*:/i);
    expect((await db.admin.query('select id from public.form_preparation where base_id=$1', [baseId])).rows).toHaveLength(0);
    const after = (await db.admin.query(`
      select
        (select count(*) from public.patient where base_id=$1) as patients,
        (select count(*) from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1) as encounters,
        (select count(*) from public.patient_identity where base_id=$1) as identities,
        (select count(*) from public.raw_document where base_id=$1) as documents`, [baseId])).rows[0];
    expect(after).toEqual(before);
  });

  test('isole les tables et expose seulement les RPC prévues', async () => {
    await expect(rowsAs(aliceId, 'select * from public.form_preparation')).rejects.toThrow('permission denied');
    await expect(rowsAs(aliceId, 'insert into public.form_preparation(base_id,owner_id,created_by,source_template_version_id,source_revision,source_fingerprint,content_fingerprint) values($1,$2,$2,$3,1,$4,$4)', [baseId, aliceId, templateVersionId, 'sha256:' + 'a'.repeat(64)])).rejects.toThrow('permission denied');
    const privileges = (await db.admin.query(`
      select
        has_function_privilege('anon','public.open_or_resume_form_preparation(uuid)','execute') as anon_open,
        has_function_privilege('authenticated','public.open_or_resume_form_preparation(uuid)','execute') as auth_open,
        has_function_privilege('anon','public.save_form_preparation(uuid,uuid,bigint,bigint,text,uuid,jsonb)','execute') as anon_save,
        has_function_privilege('authenticated','public.save_form_preparation(uuid,uuid,bigint,bigint,text,uuid,jsonb)','execute') as auth_save,
        has_function_privilege('authenticated','public.form_preparation_normalize(jsonb)','execute') as helper_auth`,)).rows[0];
    expect(privileges).toEqual({ anon_open: false, auth_open: true, anon_save: false, auth_save: true, helper_auth: false });
  });

  test('sauvegarde, double envoi et clé réutilisée restent idempotents', async () => {
    const op = randomUUID();
    const first = await saveNew(op);
    expect(first.result.preparation.state).toBe('active');
    expect(first.result.preparation.preparationRevision).toBe(1);
    const source = first.source;
    const exact = (await rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [first.preparationId, baseId, 0, source.sourceRevision, source.sourceFingerprint, op, JSON.stringify(source.payload)]))[0].result;
    expect(exact).toEqual(first.result);
    const altered = JSON.parse(JSON.stringify(source.payload));
    (altered.fields as Array<Record<string, unknown>>)[0].label = 'contenu différent';
    await expect(rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [first.preparationId, baseId, 0, source.sourceRevision, source.sourceFingerprint, op, JSON.stringify(altered)]))
      .rejects.toThrow('FORM_PREPARATION_OPERATION_CONFLICT');
    await discard(first.preparationId, 1, source);
  });

  test('refuse taille et contenu clinique avant toute écriture', async () => {
    const source = await freshPayload();
    const tooLarge = { ...source.payload, provenance: { note: 'x'.repeat(300_000) } };
    const tooLargeId = randomUUID();
    await expect(rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [tooLargeId, baseId, 0, source.sourceRevision, source.sourceFingerprint, randomUUID(), JSON.stringify(tooLarge)]))
      .rejects.toThrow('FORM_PREPARATION_TOO_LARGE');
    const clinicalId = randomUUID();
    await expect(rowsAs(aliceId,
      'select public.save_form_preparation($1,$2,$3,$4,$5,$6,$7::jsonb) as result',
      [clinicalId, baseId, 0, source.sourceRevision, source.sourceFingerprint, randomUUID(), JSON.stringify({ ...source.payload, values: { answer: 'patient' } })]))
      .rejects.toThrow('FORM_PREPARATION_INVALID');
    expect((await db.admin.query('select id from public.form_preparation where id in ($1,$2)', [tooLargeId, clinicalId])).rows).toHaveLength(0);
  });

  test('un compte voisin et un compte révoqué ne peuvent ni lire ni modifier', async () => {
    const created = await saveNew();
    await expect(rowsAs(bobId, 'select public.open_or_resume_form_preparation($1)', [baseId])).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await expect(rowsAs(bobId, 'select public.read_form_preparation($1)', [created.preparationId])).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await expect(rowsAs(editorId, 'select public.read_form_preparation($1)', [created.preparationId])).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await db.admin.query('update public.base_access set revoked_at=now() where base_id=$1 and user_id=$2', [baseId, editorId]);
    await expect(rowsAs(editorId, 'select public.open_or_resume_form_preparation($1)', [baseId])).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await expect(rowsAs(editorId, 'select public.discard_form_preparation($1,$2,$3,$4,$5)', [created.preparationId, 1, created.source.sourceRevision, created.source.sourceFingerprint, randomUUID()])).rejects.toThrow('FORM_PREPARATION_FORBIDDEN');
    await discard(created.preparationId, 1, created.source);
  });

  test('détecte une source périmée, préserve le payload et permet une reprise explicite', async () => {
    const created = await saveNew();
    const old = created.source;
    await db.admin.query('update public.base set form_revision=form_revision+1 where id=$1', [baseId]);
    const conflict = (await rowsAs(aliceId,
      'select public.preview_form_preparation($1,$2,$3,$4,$5) as result',
      [created.preparationId, 1, old.sourceRevision, old.sourceFingerprint, randomUUID()]))[0].result;
    expect(conflict.error).toBe('FORM_PREPARATION_CONFLICT');
    const conflicted = (await db.admin.query('select state,payload from public.form_preparation where id=$1', [created.preparationId])).rows[0];
    expect(conflicted.state).toBe('conflict');
    expect(JSON.stringify(conflicted.payload)).toContain('e1_added_');
    const resumed = (await rowsAs(aliceId,
      'select public.resume_form_preparation($1,$2,$3) as result',
      [created.preparationId, 1, randomUUID()]))[0].result;
    expect(resumed.preparation.state).toBe('active');
    expect(resumed.preparation.preparationRevision).toBe(2);
    await discard(created.preparationId, 2, {
      sourceRevision: resumed.preparation.sourceRevision,
      sourceFingerprint: resumed.preparation.sourceFingerprint,
    });
  });

  test('expire les préparations et efface leur payload clinique potentiel', async () => {
    const created = await saveNew();
    await db.admin.query("update public.form_preparation set expires_at=now()-interval '1 second' where id=$1", [created.preparationId]);
    const expired = (await rowsAs(aliceId, 'select public.read_form_preparation($1) as result', [created.preparationId]))[0].result;
    expect(expired.state).toBe('expired');
    expect(expired.payload).toEqual({});
    await expect(rowsAs(aliceId,
      'select public.discard_form_preparation($1,$2,$3,$4,$5)', [created.preparationId, 1, created.source.sourceRevision, created.source.sourceFingerprint, randomUUID()]))
      .rejects.toThrow('FORM_PREPARATION_CLOSED');
  });
});

describe('E1 dispense de motif et purge', () => {
  test('le propriétaire peut omettre le motif, sans élargir les droits d’identité', async () => {
    const patient = (await db.admin.query("select id,data,row_version,patient_code from public.patient where base_id=$1 and patient_code='NCH-002'", [baseId])).rows[0];
    const nextData = { ...patient.data, blood_group: patient.data.blood_group === 'A+' ? 'A-' : 'A+' };
    await rowsAs(aliceId, 'select public.update_patient($1,$2::jsonb,$3,$4,$5)', [patient.id, JSON.stringify(nextData), 'curated', null, patient.row_version]);
    const fieldAudit = (await db.admin.query('select justification_status,reason from public.field_change_log where entity=$1 and entity_id=$2 order by changed_at desc limit 1', ['patient', patient.id])).rows[0];
    expect(fieldAudit).toEqual({ justification_status: 'owner_exempt', reason: null });

    const encounter = (await db.admin.query('select e.id,e.updated_at,e.data from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 limit 1', [baseId])).rows[0];
    await rowsAs(aliceId, 'select public.update_encounter($1,$2::jsonb,$3,$4,$5)', [encounter.id, JSON.stringify(encounter.data), 'curated', null, encounter.updated_at]);
    const identity = (await db.admin.query("select p.id,p.row_version,i.full_name,i.date_of_birth,i.phone,i.address,i.external_identifier from public.patient p join public.patient_identity i on i.base_id=p.base_id and i.patient_code=p.patient_code where p.base_id=$1 and p.patient_code='NCH-003'", [baseId])).rows[0];
    await rowsAs(aliceId, 'select public.update_patient_identity($1,$2,$3,$4,$5,$6,$7,$8)', [identity.id, identity.full_name, identity.date_of_birth, `${identity.phone}9`, identity.address, identity.external_identifier, null, identity.row_version]);
    const identityAudit = (await db.admin.query("select metadata from public.audit_log where action='patient_identity_corrected' and entity_id=$1 order by created_at desc limit 1", [identity.id])).rows[0];
    expect(identityAudit.metadata.justification_status).toBe('owner_exempt');

    const attachment = (await db.admin.query('select a.id from public.clinical_attachment a join public.patient p on p.id=a.patient_id where p.base_id=$1 limit 1', [baseId])).rows[0].id;
    await rowsAs(aliceId, 'select public.soft_delete_attachment($1,$2)', [attachment, null]);
    expect((await db.admin.query('select deletion_reason from public.clinical_attachment where id=$1', [attachment])).rows[0].deletion_reason).toBeNull();

    const encounterToDelete = (await db.admin.query("select e.id from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and p.patient_code='NCH-004' and e.deleted_at is null limit 1", [baseId])).rows[0].id;
    await rowsAs(aliceId, 'select public.soft_delete_encounter($1,$2)', [encounterToDelete, null]);
    expect((await db.admin.query("select metadata from public.audit_log where action='encounter_deleted' and entity_id=$1 order by created_at desc limit 1", [encounterToDelete])).rows[0].metadata.justification_status).toBe('owner_exempt');

    const patientToDelete = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-005' and deleted_at is null", [baseId])).rows[0].id;
    await rowsAs(aliceId, 'select public.soft_delete_patient($1,$2)', [patientToDelete, null]);
    expect((await db.admin.query('select deleted_at,deletion_reason from public.patient where id=$1', [patientToDelete])).rows[0]).toMatchObject({ deletion_reason: null });
    expect((await db.admin.query("select metadata from public.audit_log where action='patient_deleted' and entity_id=$1 order by created_at desc limit 1", [patientToDelete])).rows[0].metadata.justification_status).toBe('owner_exempt');

    const curation = (await db.admin.query("select t.id from public.curation_task t join public.raw_submission s on s.id=t.submission_id join public.patient p on p.id=s.target_patient_id where t.base_id=$1 and p.patient_code='NCH-003' and t.deleted_at is null", [baseId])).rows[0];
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2,$3)', [curation.id, null, false]);
    expect((await db.admin.query("select metadata from public.audit_log where action='curation_request_deleted' and entity_id=$1 order by created_at desc limit 1", [curation.id])).rows[0].metadata.justification_status).toBe('owner_exempt');

    await db.admin.query('update public.base_access set revoked_at=null where base_id=$1 and user_id=$2', [baseId, editorId]);
    await expect(rowsAs(editorId, 'select public.update_patient($1,$2::jsonb,$3,$4,$5)', [patient.id, JSON.stringify(nextData), 'curated', null, Number(patient.row_version) + 1])).rejects.toThrow('JUSTIFICATION_REQUIRED');
    await expect(rowsAs(editorId, 'select public.update_patient_identity($1,$2,$3,$4,$5,$6,$7,$8)', [identity.id, identity.full_name, identity.date_of_birth, identity.phone, identity.address, identity.external_identifier, null, identity.row_version])).rejects.toThrow('JUSTIFICATION_REQUIRED');
    await expect(rowsAs(annaId, 'select public.update_patient_identity($1,$2,$3,$4,$5,$6,$7,$8)', [identity.id, identity.full_name, identity.date_of_birth, identity.phone, identity.address, identity.external_identifier, null, identity.row_version])).rejects.toThrow('Acces refuse');
    await expect(rowsAs(aliceId, 'select public.soft_delete_base($1,$2)', [baseId, null])).rejects.toThrow('Motif de suppression requis');
  });

  test('le challenge purge est aléatoire, distinct du nom et consommable une fois', async () => {
    const purgeBase = randomUUID();
    await db.admin.query('insert into public.base(id,name,specialty,owner_user_id,current_template_version_id) values($1,$2,$3,$4,$5)', [purgeBase, 'Base E1 purge', 'test', aliceId, templateVersionId]);
    await rowsAs(aliceId, 'select public.soft_delete_base($1,$2)', [purgeBase, 'test E1']);
    const first = (await rowsAs(aliceId, 'select public.issue_base_purge_challenge($1,$2) as result', [purgeBase, randomUUID()]))[0].result;
    expect(first.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    expect(first.code).not.toBe('Base E1 purge');
    const stored = (await db.admin.query('select o.receipt::text as receipt,c.code_hash from public.base_purge_challenge_operation o join public.base_purge_challenge c on c.challenge_id=(o.receipt->>\'challengeId\')::uuid where o.base_id=$1', [purgeBase])).rows[0];
    expect(stored.receipt).not.toContain(first.code);
    expect(stored.code_hash).not.toContain(first.code);
    const confirmed = (await rowsAs(aliceId, 'select public.confirm_base_purge_challenge($1,$2,$3,$4) as result', [purgeBase, first.challengeId, first.code.toLowerCase(), randomUUID()]))[0].result;
    expect(confirmed.confirmed).toBe(true);
    await expect(rowsAs(aliceId, 'select public.confirm_base_purge_challenge($1,$2,$3,$4)', [purgeBase, first.challengeId, first.code, randomUUID()])).rejects.toThrow('PURGE_CHALLENGE_MISMATCH');
  });

  test('le challenge accepte un code client de cinq caractères et rejoue la confirmation', async () => {
    const purgeBase = randomUUID();
    await db.admin.query('insert into public.base(id,name,specialty,owner_user_id,current_template_version_id) values($1,$2,$3,$4,$5)', [purgeBase, 'Base E1 code client', 'test', aliceId, templateVersionId]);
    await rowsAs(aliceId, 'select public.soft_delete_base($1,$2)', [purgeBase, 'test E1']);
    const challengeId = randomUUID();
    const prepareOperationId = randomUUID();
    const prepared = (await rowsAs(aliceId,
      'select public.prepare_base_purge_challenge($1,$2,$3,$4) as result',
      [purgeBase, challengeId, 'ab234', prepareOperationId]))[0].result;
    expect(prepared).toMatchObject({ challengeId, baseId: purgeBase, operationId: prepareOperationId });
    expect(JSON.stringify(prepared)).not.toContain('ab234');
    const confirmOperationId = randomUUID();
    const confirmed = (await rowsAs(aliceId,
      'select public.confirm_base_purge_challenge($1,$2,$3,$4) as result',
      [purgeBase, challengeId, 'AB234', confirmOperationId]))[0].result;
    const replay = (await rowsAs(aliceId,
      'select public.confirm_base_purge_challenge($1,$2,$3,$4) as result',
      [purgeBase, challengeId, 'ab234', confirmOperationId]))[0].result;
    expect(replay).toEqual(confirmed);
    await expect(rowsAs(aliceId,
      'select public.prepare_base_purge_challenge($1,$2,$3,$4)',
      [purgeBase, randomUUID(), 'ABCDE', prepareOperationId])).rejects.toThrow('PURGE_OPERATION_CONFLICT');
  });
});
