import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let baseId: string;
let patientId: string;

const COMPLETE = `
  select public.complete_file_inspection(
    $1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13::jsonb
  ) as ok
`;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

async function scanningAttachment(runId: string): Promise<string> {
  const { rows } = await db.admin.query(
    `insert into public.clinical_attachment(
       patient_id, storage_path, mime_type, deidentification_confirmed,
       inspection_status, inspection_run_id, inspection_started_at, inspected_at
     ) values($1,$2,'image/png',true,'scanning',$3,now(),now())
     returning id`,
    [patientId, `${baseId}/inspection/${randomUUID()}.png`, runId],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  baseId = (await db.admin.query('select id from public.base where owner_user_id=$1 limit 1', [aliceId])).rows[0].id;
  patientId = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('complete_file_inspection', () => {
  test('finalise le verdict et l audit dans une seule transaction', async () => {
    const runId = randomUUID();
    const attId = await scanningAttachment(runId);

    await expect(db.admin.query(COMPLETE, [
      'clinical_attachment',
      attId,
      runId,
      randomUUID(),
      'accepted',
      new Date().toISOString(),
      'hash-ko',
      100,
      'image/png',
      'image/png',
      'clamav',
      null,
      JSON.stringify({}),
    ])).rejects.toThrow();

    const afterFailedAudit = (await db.admin.query(
      'select inspection_status, file_hash from public.clinical_attachment where id=$1',
      [attId],
    )).rows[0];
    expect(afterFailedAudit).toMatchObject({ inspection_status: 'scanning', file_hash: null });

    const ok = await db.admin.query(COMPLETE, [
      'clinical_attachment',
      attId,
      runId,
      aliceId,
      'accepted',
      new Date().toISOString(),
      'hash-ok',
      123,
      'image/png',
      'image/png',
      'clamav',
      null,
      JSON.stringify({}),
    ]);
    expect(ok.rows[0].ok).toBe(true);

    const row = (await db.admin.query(
      'select inspection_status, inspection_run_id, inspection_started_at, last_inspection_error, file_hash, file_size, detected_mime_type from public.clinical_attachment where id=$1',
      [attId],
    )).rows[0];
    expect(row).toMatchObject({
      inspection_status: 'accepted',
      inspection_run_id: runId,
      inspection_started_at: null,
      last_inspection_error: null,
      file_hash: 'hash-ok',
      file_size: '123',
      detected_mime_type: 'image/png',
    });

    const audit = (await db.admin.query(
      "select metadata from public.audit_log where action='file_inspected' and entity_id=$1",
      [attId],
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ status: 'accepted', engine: 'clamav', inspection_run_id: runId });
  });

  test('un run perime ne peut pas ecraser le verrou du run courant', async () => {
    const staleRunId = randomUUID();
    const currentRunId = randomUUID();
    const attId = await scanningAttachment(currentRunId);

    const stale = await db.admin.query(COMPLETE, [
      'clinical_attachment',
      attId,
      staleRunId,
      aliceId,
      'quarantined',
      new Date().toISOString(),
      'stale-hash',
      321,
      'image/png',
      null,
      'clamav',
      'Eicar-Test-Signature',
      JSON.stringify({}),
    ]);
    expect(stale.rows[0].ok).toBe(false);

    const row = (await db.admin.query(
      'select inspection_status, inspection_run_id, file_hash from public.clinical_attachment where id=$1',
      [attId],
    )).rows[0];
    expect(row).toMatchObject({
      inspection_status: 'scanning',
      inspection_run_id: currentRunId,
      file_hash: null,
    });
    expect((await db.admin.query(
      "select count(*)::int as n from public.audit_log where action='file_inspected' and entity_id=$1",
      [attId],
    )).rows[0].n).toBe(0);
  });

  test('la RPC serveur n est pas executable par un utilisateur authentifie', async () => {
    await expect(rowsAs(aliceId, COMPLETE, [
      'clinical_attachment',
      randomUUID(),
      randomUUID(),
      aliceId,
      'accepted',
      new Date().toISOString(),
      'hash',
      1,
      'image/png',
      'image/png',
      'clamav',
      null,
      JSON.stringify({}),
    ])).rejects.toThrow(/permission|execute/i);
  });

  test('les compteurs de tentative restent controles par le serveur', async () => {
    const rows = await rowsAs(aliceId, [
      'with ticket as (',
      "  select public.create_upload_ticket($1, 'clinical-attachments', $3)",
      ')',
      'insert into public.clinical_attachment(',
      '  patient_id, storage_path, deidentification_confirmed, inspection_status,',
      '  inspection_attempt_count, last_inspection_attempt_at, last_inspection_error',
      ") select $2,$3,true,'accepted_client',7,now(),'client forged' from ticket",
      'returning id, inspection_attempt_count, last_inspection_attempt_at, last_inspection_error',
    ].join(' '), [baseId, patientId, `${baseId}/inspection/${randomUUID()}.png`]);
    const inserted = rows[0];
    expect(inserted.inspection_attempt_count).toBe(0);
    expect(inserted.last_inspection_attempt_at).toBeNull();
    expect(inserted.last_inspection_error).toBeNull();

    await expect(rowsAs(aliceId, 'update public.clinical_attachment set inspection_attempt_count=9 where id=$1', [inserted.id]))
      .rejects.toThrow(/immuable|verrouille/i);
    await expect(rowsAs(aliceId, "update public.clinical_attachment set last_inspection_error='fake' where id=$1", [inserted.id]))
      .rejects.toThrow(/immuable|verrouille/i);
  });
});
