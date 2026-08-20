// D10 — purge definitive de bases supprimees logiquement.
// Toutes les fixtures sont creees dans PostgreSQL embarque puis detruites avec
// l instance de test ; aucune base distante ou donnee reelle n est visee.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let bobId: string;
let aliceId: string;
let templateVersionId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  bobId = users.get('bob@demo.test')!;
  aliceId = users.get('alice@demo.test')!;
  templateVersionId = (await db.admin.query("select id from public.template_version where status='published' limit 1")).rows[0].id;
  await db.admin.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)");
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

async function createBase(name: string): Promise<string> {
  return (await db.admin.query(
    'insert into public.base(name, owner_user_id, current_template_version_id) values($1,$2,$3) returning id',
    [name, bobId, templateVersionId],
  )).rows[0].id;
}

async function softDelete(baseId: string): Promise<void> {
  await rowsAs(bobId, "select public.soft_delete_base($1,'D10 test fictif')", [baseId]);
}

async function purge(baseId: string, operationId: string): Promise<{ prep: Record<string, unknown>; final: Record<string, unknown> }> {
  const prep = (await rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [baseId, operationId]))[0];
  const final = (await db.admin.query(
    'select * from public.finalize_base_purge($1,$2,$3)',
    [operationId, prep.manifest_hash, bobId],
  )).rows[0];
  return { prep, final };
}

async function createNonEmptyBase(): Promise<{
  baseId: string;
  patientId: string;
  encounterId: string;
  rawDocumentId: string;
  exportId: string;
  paths: string[];
}> {
  const baseId = await createBase('D10 base non vide');
  const patientId = (await db.admin.query(
    "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'D10-P',$2,'{}'::jsonb) returning id",
    [baseId, templateVersionId],
  )).rows[0].id;
  const identityId = (await db.admin.query(
    "insert into public.patient_identity(base_id, patient_code, full_name) values($1,'D10-P','Patient fictif') returning id",
    [baseId],
  )).rows[0].id;
  const encounterId = (await db.admin.query(
    "insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data) values($1,$2,'consultation','2026-08-01','{}'::jsonb) returning id",
    [patientId, templateVersionId],
  )).rows[0].id;
  const clinicalPath = `${baseId}/clinical/attachment.pdf`;
  const clinicalQuarantinePath = `${baseId}/quarantine/attachment.pdf`;
  await db.admin.query(
    "insert into public.clinical_attachment(patient_id, encounter_id, label, storage_path, mime_type, deidentification_confirmed, quarantine_bucket, quarantine_path) values($1,$2,'Pièce fictive',$3,'application/pdf',true,'quarantined-uploads',$4)",
    [patientId, encounterId, clinicalPath, clinicalQuarantinePath],
  );
  const submissionId = (await db.admin.query(
    "insert into public.raw_submission(base_id, target_patient_id, case_code, status) values($1,$2,$3,'received') returning id",
    [baseId, patientId, `D10-${baseId}`],
  )).rows[0].id;
  const rawPath = `${baseId}/raw/document.pdf`;
  const rawQuarantinePath = `${baseId}/quarantine/document.pdf`;
  const rawDocumentId = (await db.admin.query(
    "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type, quarantine_bucket, quarantine_path) values($1,$2,'Document fictif',$3,'application/pdf','quarantined-uploads',$4) returning id",
    [submissionId, baseId, rawPath, rawQuarantinePath],
  )).rows[0].id;
  const taskId = (await db.admin.query(
    "insert into public.curation_task(base_id, submission_id, status) values($1,$2,'preparing') returning id",
    [baseId, submissionId],
  )).rows[0].id;
  const draftId = (await db.admin.query(
    "insert into public.curation_draft(task_id, base_id) values($1,$2) returning id",
    [taskId, baseId],
  )).rows[0].id;
  await db.admin.query(
    "insert into public.curation_clarification(task_id, base_id, question) values($1,$2,'Question fictive')",
    [taskId, baseId],
  );
  await db.admin.query(
    "insert into public.patient_curation_idempotency(user_id, idempotency_key, request_fingerprint, patient_id, submission_id, task_id) values($1,$2,$3,$4,$5,$6)",
    [bobId, `d10-${baseId}`, 'a'.repeat(64), patientId, submissionId, taskId],
  );
  await db.admin.query(
    "insert into public.offline_encounter_operation(user_id, operation_id, encounter_id, request_fingerprint) values($1,$2,$3,$4)",
    [bobId, `d10-${baseId}`, encounterId, 'b'.repeat(64)],
  );
  await db.admin.query(
    "insert into public.field_change_log(base_id, entity, entity_id, field_key, old_value, new_value, changed_by) values($1,'patient',$2,'fictitious','null','{}'::jsonb,$3)",
    [baseId, patientId, bobId],
  );
  const cohortId = (await db.admin.query(
    "insert into public.cohort(base_id, name, cohort_type, snapshot_at) values($1,'Cohorte fictive','snapshot',now()) returning id",
    [baseId],
  )).rows[0].id;
  await db.admin.query('insert into public.cohort_member(cohort_id, patient_id) values($1,$2)', [cohortId, patientId]);
  await db.admin.query('insert into public.cohort_encounter_member(cohort_id, encounter_id) values($1,$2)', [cohortId, encounterId]);
  const exportPath = `${baseId}/exports/export.csv`;
  const exportId = (await db.admin.query(
    "insert into public.export_log(cohort_id, base_id, base_reference_id, cohort_name, exported_by, format, export_options, stored_file_path, file_hash) values($1,$2,$2,'Cohorte fictive',$3,'csv','{}'::jsonb,$4,$5) returning id",
    [cohortId, baseId, bobId, exportPath, 'c'.repeat(64)],
  )).rows[0].id;
  const ticketPath = `${baseId}/tickets/pending.pdf`;
  await db.admin.query(
    "insert into public.upload_ticket(owner_user_id, base_id, bucket, path) values($1,$2,'raw-documents',$3)",
    [bobId, baseId, ticketPath],
  );
  await db.admin.query(
    "insert into public.quarantine_move_log(entity, entity_id, base_id, run_id, inspected_by, source_bucket, source_path, quarantine_path, engine, file_hash, file_size) values('raw_document',$1,$2,$3,$4,'raw-documents',$5,$6,'clamav',$7,10)",
    [rawDocumentId, baseId, '323e4567-e89b-42d3-a456-426614174000', bobId, rawPath, `${baseId}/quarantine/move.pdf`, 'd'.repeat(64)],
  );
  await db.admin.query('insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,\'viewer\',$3)', [baseId, aliceId, bobId]);
  void identityId;
  void draftId;
  return {
    baseId,
    patientId,
    encounterId,
    rawDocumentId,
    exportId,
    paths: [clinicalPath, clinicalQuarantinePath, rawPath, rawQuarantinePath, exportPath, ticketPath],
  };
}

describe('D10 — purge definitive PostgreSQL', () => {
  test('une base vide est preparee puis purgee immediatement et le rejeu est idempotent', async () => {
    const baseId = await createBase('D10 base vide');
    await softDelete(baseId);
    const operationId = '123e4567-e89b-42d3-a456-426614174001';
    const { prep, final } = await purge(baseId, operationId);
    expect(prep).toMatchObject({ status: 'ready', code: 'PURGE_PREPARED', patient_count: 0, storage_object_count: 0 });
    expect(final).toMatchObject({ status: 'completed', code: 'PURGED' });
    expect((await db.admin.query('select id from public.base where id=$1', [baseId])).rows).toHaveLength(0);
    expect((await db.admin.query('select status from public.base_purge_operation where operation_id=$1', [operationId])).rows[0].status).toBe('completed');
    const retry = await rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [baseId, operationId]);
    expect(retry[0]).toMatchObject({ status: 'completed', code: 'ALREADY_PURGED' });
  });

  test('une base non vide purge explicitement toutes les dependances, conserve audit et export_log', async () => {
    const fixture = await createNonEmptyBase();
    await softDelete(fixture.baseId);
    const operationId = '123e4567-e89b-42d3-a456-426614174002';
    const { prep, final } = await purge(fixture.baseId, operationId);
    expect(prep.patient_count).toBe(1);
    expect(prep.encounter_count).toBe(1);
    expect(prep.document_count).toBe(1);
    expect(prep.attachment_count).toBe(1);
    expect(prep.export_count).toBe(1);
    expect(prep.storage_object_count).toBeGreaterThanOrEqual(fixture.paths.length);
    expect(final).toMatchObject({ status: 'completed', code: 'PURGED' });

    const directTables = [
      'base_access', 'base_invitation', 'cohort', 'curation_clarification', 'curation_draft',
      'curation_task', 'field_change_log', 'import_batch', 'import_row_hash',
      'mission_account_credential', 'mission_credential_operation', 'patient',
      'patient_identity', 'quarantine_move_log', 'raw_document', 'raw_submission', 'research_group_base',
      'upload_ticket',
    ];
    for (const table of directTables) {
      expect((await db.admin.query(`select count(*)::int as n from public.${table} where base_id=$1`, [fixture.baseId])).rows[0].n).toBe(0);
    }
    expect((await db.admin.query('select count(*)::int as n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1', [fixture.baseId])).rows[0].n).toBe(0);
    const indirectOrphans = [
      'select count(*)::int as n from public.cohort_member cm join public.cohort c on c.id=cm.cohort_id where c.base_id=$1',
      'select count(*)::int as n from public.cohort_encounter_member cem join public.cohort c on c.id=cem.cohort_id where c.base_id=$1',
      'select count(*)::int as n from public.clinical_attachment a join public.patient p on p.id=a.patient_id where p.base_id=$1',
      'select count(*)::int as n from public.offline_encounter_operation o join public.encounter e on e.id=o.encounter_id join public.patient p on p.id=e.patient_id where p.base_id=$1',
      'select count(*)::int as n from public.patient_curation_idempotency i join public.patient p on p.id=i.patient_id where p.base_id=$1',
    ];
    for (const query of indirectOrphans) {
      expect((await db.admin.query(query, [fixture.baseId])).rows[0].n).toBe(0);
    }
    expect((await db.admin.query('select base_id, base_reference_id, cohort_id from public.export_log where id=$1', [fixture.exportId])).rows[0])
      .toMatchObject({ base_id: null, base_reference_id: fixture.baseId, cohort_id: null });
    const audit = (await db.admin.query(
      "select action, base_id, entity_id, metadata->>'operation_id' as operation_id from public.audit_log where entity_id=$1 and action='base_purged'",
      [fixture.baseId],
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'base_purged', base_id: null, entity_id: fixture.baseId, operation_id: operationId });
  });

  test('owner, etats actifs/restaures, et verrou de restauration sont controles cote serveur', async () => {
    const active = await createBase('D10 base active');
    expect((await rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [active, '123e4567-e89b-42d3-a456-426614174003']))[0].code).toBe('BASE_ACTIVE');
    expect((await rowsAs(aliceId, 'select * from public.prepare_base_purge($1,$2)', [active, '123e4567-e89b-42d3-a456-426614174004']))[0].code).toBe('OWNER_REQUIRED');

    const deleted = await createBase('D10 base restauree');
    await softDelete(deleted);
    await rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [deleted, '123e4567-e89b-42d3-a456-426614174005']);
    await expect(rowsAs(bobId, 'select public.restore_deleted_base($1)', [deleted])).rejects.toThrow(/PURGE_IN_PROGRESS/);
    const pendingBase = await db.admin.query('select purge_status, deleted_at from public.base where id=$1', [deleted]);
    expect(pendingBase.rows[0]).toMatchObject({ purge_status: 'pending' });
    const operation = (await db.admin.query('select operation_id, manifest_hash from public.base_purge_operation where base_reference_id=$1', [deleted])).rows[0];
    await db.admin.query('select * from public.finalize_base_purge($1,$2,$3)', [operation.operation_id, operation.manifest_hash, bobId]);

    const restoredBaseId = await createBase('D10 base deja restauree');
    await softDelete(restoredBaseId);
    await rowsAs(bobId, 'select public.restore_deleted_base($1)', [restoredBaseId]);
    expect((await rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [restoredBaseId, '123e4567-e89b-42d3-a456-426614174009']))[0].code).toBe('BASE_ACTIVE');
  });

  test('double clic, reponse perdue et hash invalide convergent sans suppression partielle', async () => {
    const baseId = await createBase('D10 concurrence');
    await softDelete(baseId);
    const opA = '123e4567-e89b-42d3-a456-426614174006';
    const opB = '123e4567-e89b-42d3-a456-426614174007';
    const results = await Promise.all([
      rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [baseId, opA]),
      rowsAs(bobId, 'select * from public.prepare_base_purge($1,$2)', [baseId, opB]),
    ]);
    const operations = results.map((rows) => rows[0]);
    expect(operations.map((row) => row.code).sort()).toEqual(['PURGE_IN_PROGRESS', 'PURGE_PREPARED']);
    const prepared = operations.find((row) => row.code === 'PURGE_PREPARED')!;
    const operationId = prepared.operation_id;
    await expect(db.admin.query('select * from public.finalize_base_purge($1,$2,$3)', [operationId, 'e'.repeat(64), bobId])).resolves.toHaveProperty('rows.0.code', 'MANIFEST_MISMATCH');
    expect((await db.admin.query('select id from public.base where id=$1', [baseId])).rows).toHaveLength(1);
    const committed = await db.admin.query('select * from public.finalize_base_purge($1,$2,$3)', [operationId, prepared.manifest_hash, bobId]);
    expect(committed.rows[0].code).toBe('PURGED');
    const retry = await db.admin.query('select * from public.finalize_base_purge($1,$2,$3)', [operationId, prepared.manifest_hash, bobId]);
    expect(retry.rows[0].code).toBe('ALREADY_PURGED');
  });

  test('les grants et le search_path isolent la RPC service-only', async () => {
    const privileges = (await db.admin.query(`
      select
        has_function_privilege('authenticated', 'public.prepare_base_purge(uuid,uuid)', 'execute') as prepare_auth,
        has_function_privilege('authenticated', 'public.finalize_base_purge(uuid,text,uuid)', 'execute') as finalize_auth,
        has_function_privilege('service_role', 'public.finalize_base_purge(uuid,text,uuid)', 'execute') as finalize_service,
        p.prosecdef,
        p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='finalize_base_purge'
    `)).rows[0];
    expect(privileges.prepare_auth).toBe(true);
    expect(privileges.finalize_auth).toBe(false);
    expect(privileges.finalize_service).toBe(true);
    expect(privileges.prosecdef).toBe(true);
    expect(privileges.proconfig).toContain('search_path=public, pg_temp');
    await expect(rowsAs(bobId, 'select * from public.finalize_base_purge($1,$2,$3)', ['123e4567-e89b-42d3-a456-426614174008', 'f'.repeat(64), bobId])).rejects.toThrow();
    await expect(rowsAs(bobId, 'select operation_id from public.base_purge_operation')).rejects.toThrow();
  });
});
