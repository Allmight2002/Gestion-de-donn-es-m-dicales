import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;
let baseId: string;
let patientId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base where owner_user_id=$1 limit 1', [aliceId])).rows[0].id;
  patientId = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('upload_ticket', () => {
  test('un utilisateur authentifie ne peut pas attacher un Storage path sans ticket', async () => {
    await expect(rowsAs(
      aliceId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, `${baseId}/ticket/${randomUUID()}.jpg`],
    )).rejects.toThrow(/ticket/i);
  });

  test('un ticket pending est consomme atomiquement par la ligne metier', async () => {
    const path = `${baseId}/ticket/${randomUUID()}.jpg`;
    const ticket = await rowsAs(
      aliceId,
      "select public.create_upload_ticket($1, 'clinical-attachments', $2) as id",
      [baseId, path],
    );
    const ticketId = ticket[0].id as string;

    await rowsAs(
      aliceId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, path],
    );

    const stored = (await db.admin.query(
      'select status, owner_user_id, base_id, bucket, path, attached_at from public.upload_ticket where id=$1',
      [ticketId],
    )).rows[0];
    expect(stored).toMatchObject({
      status: 'attached',
      owner_user_id: aliceId,
      base_id: baseId,
      bucket: 'clinical-attachments',
      path,
    });
    expect(stored.attached_at).not.toBeNull();
    expect((await rowsAs(aliceId, 'select public.has_pending_upload_ticket($1,$2) as ok', ['clinical-attachments', path]))[0].ok).toBe(false);
  });

  test('un ticket expire ne peut pas etre consomme', async () => {
    const path = `${baseId}/ticket/${randomUUID()}.jpg`;
    const ticket = await rowsAs(
      aliceId,
      "select public.create_upload_ticket($1, 'clinical-attachments', $2) as id",
      [baseId, path],
    );
    await db.admin.query("update public.upload_ticket set expires_at=now()-interval '1 second' where id=$1", [ticket[0].id]);

    await expect(rowsAs(
      aliceId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, path],
    )).rejects.toThrow(/ticket/i);
  });

  test('un ticket cree par un autre utilisateur ne peut pas etre consomme', async () => {
    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,can_view_identity,can_edit_structured_data,granted_by)
       values($1,$2,'editor',true,true,$3)
       on conflict (base_id,user_id) do update set
         access_role='editor', can_view_identity=true, can_edit_structured_data=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );

    const path = `${baseId}/ticket/${randomUUID()}.jpg`;
    await rowsAs(
      aliceId,
      "select public.create_upload_ticket($1, 'clinical-attachments', $2)",
      [baseId, path],
    );

    await expect(rowsAs(
      bobId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, path],
    )).rejects.toThrow(/ticket/i);
  });
});
