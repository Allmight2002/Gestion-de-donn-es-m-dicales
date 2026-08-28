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

const verifiedFinalize = async (
  uid: string, ticketId: string, entity: 'attachment' | 'raw_document', metadata: object,
) => (await db.admin.query(
  'select public.complete_verified_upload_operation($1,$2,$3,$4::jsonb,t.file_hash,t.file_size,t.mime_type) as id from public.upload_ticket t where t.id=$1',
  [ticketId, uid, entity, JSON.stringify(metadata)],
)).rows;

// Connexion DEDIEE, authentifiee, laissee en transaction OUVERTE : permet d'orchestrer deux
// operations reellement concurrentes (commit/rollback pilotes manuellement par le test).
const openAuthed = async (uid: string): Promise<Client> => {
  const c = db.pg.getPgClient();
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ]);
  await c.query('set local role authenticated');
  return c;
};

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
  test('une operation idempotente retrouve le meme ticket, chemin et document', async () => {
    const operationKey = randomUUID();
    const path = `${baseId}/${patientId}/${operationKey}.jpg`;
    const hash = 'a'.repeat(64);
    const first = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, path, operationKey, hash],
    );
    const second = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, `${baseId}/${patientId}/other.jpg`, operationKey, hash],
    );
    expect(second[0]).toMatchObject({ ticket_id: first[0].ticket_id, path, document_id: null });

    const finalized = await verifiedFinalize(aliceId, first[0].ticket_id, 'attachment',
      { patient_id: patientId, kind: 'imagerie', label: 'operation test' });
    const replay = await verifiedFinalize(aliceId, first[0].ticket_id, 'attachment',
      { patient_id: patientId, kind: 'imagerie', label: 'operation test' });
    expect(replay[0].id).toBe(finalized[0].id);
    // Simule un refresh apres perte de reponse : un chemin propose a nouveau est
    // ignore et l'operation retrouve la ligne durable deja rattachee.
    const afterRefresh = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, `${baseId}/${patientId}/would-have-been-a-duplicate.jpg`, operationKey, hash],
    );
    expect(afterRefresh[0]).toMatchObject({ ticket_id: first[0].ticket_id, path, document_id: finalized[0].id });
    expect((await db.admin.query('select count(*)::int as n from public.clinical_attachment where upload_ticket_id=$1', [first[0].ticket_id])).rows[0].n).toBe(1);
  });

  // Regression 2026-08-13, vue par le preflight staging : la finalisation posait
  // 'pending' EN DUR. Hors mode strict, le client n'appelle pas `inspect-upload`,
  // donc rien ne sortait la ligne de cet etat et le document restait a jamais
  // illisible. Le statut initial doit suivre la politique serveur, pas une constante.
  test('le statut d inspection initial suit require_server_inspection()', async () => {
    const finalizeFresh = async (label: string) => {
      const key = randomUUID();
      const op = await rowsAs(aliceId,
        "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
        [baseId, `${baseId}/${patientId}/${key}.jpg`, key, randomUUID().replace(/-/g, '').padEnd(64, '0')],
      );
      const done = await verifiedFinalize(aliceId, op[0].ticket_id, 'attachment',
        { patient_id: patientId, kind: 'imagerie', label });
      return (await db.admin.query(
        'select inspection_status from public.clinical_attachment where id=$1', [done[0].id],
      )).rows[0].inspection_status;
    };
    const setPolicy = (value: 'true' | 'false') => db.admin.query(
      "update public.app_security_setting set value=$1 where key='require_server_inspection'", [value],
    );

    try {
      // Inspection suspendue : controle navigateur seul, statut honnete et LISIBLE.
      await setPolicy('false');
      expect(await finalizeFresh('inspection suspendue')).toBe('accepted_client');

      // Mode strict : aucun verdict serveur rendu, la ligne attend `inspect-upload`.
      await setPolicy('true');
      expect(await finalizeFresh('inspection stricte')).toBe('pending');
    } finally {
      await setPolicy('false');
    }
  });

  test('une cle ne peut pas etre reutilisee pour un autre fichier', async () => {
    const operationKey = randomUUID();
    await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, `${baseId}/${patientId}/${operationKey}.jpg`, operationKey, 'b'.repeat(64)],
    );
    await expect(rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 13, 'image/jpeg')",
      [baseId, `${baseId}/${patientId}/${operationKey}.jpg`, operationKey, 'c'.repeat(64)],
    )).rejects.toThrow(/idempotence/i);
  });

  test('un utilisateur authentifie ne peut pas attacher un Storage path sans ticket', async () => {
    await expect(rowsAs(
      aliceId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, `${baseId}/ticket/${randomUUID()}.jpg`],
    )).rejects.toThrow(/permission|denied/i);
  });

  test('un JWT ne peut jamais finaliser directement un ticket sans preuve Storage serveur', async () => {
    const key = randomUUID();
    const path = `${baseId}/${patientId}/${key}.jpg`;
    const op = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, path, key, '9'.repeat(64)],
    );
    await expect(rowsAs(aliceId,
      "select public.finalize_upload_operation($1, 'attachment', $2::jsonb)",
      [op[0].ticket_id, JSON.stringify({ patient_id: patientId })],
    )).rejects.toThrow(/permission|denied|serveur|rechargez/i);
    expect((await db.admin.query('select count(*)::int n from public.clinical_attachment where upload_ticket_id=$1', [op[0].ticket_id])).rows[0].n).toBe(0);
  });

  test('un JWT ne peut repointer les octets ou metadonnees physiques d une ligne pending', async () => {
    const key = randomUUID();
    const path = `${baseId}/${patientId}/${key}.jpg`;
    const op = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, path, key, '8'.repeat(64)],
    );
    const finalized = await verifiedFinalize(aliceId, op[0].ticket_id, 'attachment',
      { patient_id: patientId, kind: 'imagerie', label: 'pending immuable' });
    await expect(rowsAs(aliceId,
      'update public.clinical_attachment set storage_path=$1 where id=$2',
      [`${baseId}/${patientId}/objet-absent.jpg`, finalized[0].id],
    )).rejects.toThrow(/reserve|immuable|serveur/i);
    await expect(rowsAs(aliceId,
      'update public.clinical_attachment set file_hash=$1 where id=$2',
      ['0'.repeat(64), finalized[0].id],
    )).rejects.toThrow(/reserve|immuable|serveur/i);
    expect((await db.admin.query(
      'select storage_path,file_hash from public.clinical_attachment where id=$1', [finalized[0].id],
    )).rows[0]).toMatchObject({ storage_path: path, file_hash: '8'.repeat(64) });
  });

  test('un ticket pending ne permet plus un insert metier direct par JWT', async () => {
    const path = `${baseId}/ticket/${randomUUID()}.jpg`;
    const ticket = await rowsAs(
      aliceId,
      "select public.create_upload_ticket($1, 'clinical-attachments', $2) as id",
      [baseId, path],
    );
    const ticketId = ticket[0].id as string;

    await expect(rowsAs(
      aliceId,
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed) values($1,$2,true)",
      [patientId, path],
    )).rejects.toThrow(/permission|denied/i);

    const stored = (await db.admin.query(
      'select status, owner_user_id, base_id, bucket, path, attached_at from public.upload_ticket where id=$1',
      [ticketId],
    )).rows[0];
    expect(stored).toMatchObject({
      status: 'pending',
      owner_user_id: aliceId,
      base_id: baseId,
      bucket: 'clinical-attachments',
      path,
    });
    expect(stored.attached_at).toBeNull();
    expect((await rowsAs(aliceId, 'select public.has_pending_upload_ticket($1,$2) as ok', ['clinical-attachments', path]))[0].ok).toBe(true);
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
    )).rejects.toThrow(/permission|denied/i);
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
    )).rejects.toThrow(/permission|denied/i);
  });

  test('deux creations vraiment concurrentes avec la meme cle convergent sans unique_violation brut', async () => {
    const key = randomUUID();
    const hash = 'd'.repeat(64);
    const pathA = `${baseId}/${patientId}/${key}.jpg`;
    const pathB = `${baseId}/${patientId}/concurrent-${key}.jpg`;

    // Deux connexions INDEPENDANTES, transactions ouvertes en parallele.
    const a = await openAuthed(aliceId);
    const b = await openAuthed(aliceId);
    try {
      // A cree la ligne mais NE COMMITE PAS : elle detient l'entree d'index unique (owner, cle).
      const first = await a.query(
        "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
        [baseId, pathA, key, hash],
      );
      // B, en concurrence reelle, tente la MEME cle : son INSERT BLOQUE sur l'index unique tant
      // que A n'a pas commit. On lance la requete sans l'attendre tout de suite.
      const bPromise = b.query(
        "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
        [baseId, pathB, key, hash],
      );
      // Laisse B atteindre l'INSERT bloquant, puis commit A -> B recoit unique_violation, la
      // capture, relit la ligne de A et renvoie le MEME ticket (au lieu d'un 23505 brut).
      await new Promise((r) => setTimeout(r, 250));
      await a.query('commit');
      const second = await bPromise;
      await b.query('commit');

      expect(second.rows[0].ticket_id).toBe(first.rows[0].ticket_id);
      expect(second.rows[0].path).toBe(pathA); // la ligne du gagnant, pas le chemin propose par B
      expect(second.rows[0].document_id).toBeNull();
      // Une SEULE operation/ticket pour cette cle : aucun doublon de ticket cree par la course.
      expect((await db.admin.query('select count(*)::int as n from public.upload_ticket where idempotency_key=$1', [key])).rows[0].n).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
  });

  test('une piece jointe soft-deletee n est pas ressuscitee silencieusement par l operation rejouee', async () => {
    const key = randomUUID();
    const hash = 'e'.repeat(64);
    const path = `${baseId}/${patientId}/${key}.jpg`;
    const op = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, path, key, hash],
    );
    const finalized = await verifiedFinalize(aliceId, op[0].ticket_id, 'attachment',
      { patient_id: patientId, kind: 'imagerie', label: 'a supprimer' });
    const docId = finalized[0].id as string;
    await rowsAs(aliceId, "select public.soft_delete_attachment($1, 'nettoyage')", [docId]);

    // Rejeu de l'operation avec la meme cle : refus EXPLICITE, jamais un succes silencieux.
    await expect(rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'clinical-attachments', $2, $3, $4, 12, 'image/jpeg')",
      [baseId, path, key, hash],
    )).rejects.toThrow(/supprime/i);
    // Rejeu de la finalisation : meme refus (le ticket reste rattache a une ligne supprimee).
    await expect(verifiedFinalize(aliceId, op[0].ticket_id, 'attachment',
      { patient_id: patientId, kind: 'imagerie', label: 'a supprimer' })).rejects.toThrow(/incoherent/i);

    // La ligne reste supprimee et unique : aucune resurrection ni doublon.
    expect((await db.admin.query('select deleted_at from public.clinical_attachment where id=$1', [docId])).rows[0].deleted_at).not.toBeNull();
    expect((await db.admin.query('select count(*)::int as n from public.clinical_attachment where upload_ticket_id=$1', [op[0].ticket_id])).rows[0].n).toBe(1);
  });

  test('un document brut de curation soft-deletee suit le meme refus (mecanisme partage)', async () => {
    // Soumission minimale (via admin, hors RLS) pour rattacher un document brut.
    const subId = (await db.admin.query(
      "insert into public.raw_submission(base_id, target_patient_id, scope, case_code, status, submitted_by) values($1,$2,'patient',$3,'received',$4) returning id",
      [baseId, patientId, `RAWSD-${randomUUID().slice(0, 8)}`, aliceId],
    )).rows[0].id as string;

    const key = randomUUID();
    const hash = 'f'.repeat(64);
    const path = `${baseId}/${subId}/${key}.pdf`;
    const op = await rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'raw-documents', $2, $3, $4, 20, 'application/pdf')",
      [baseId, path, key, hash],
    );
    const finalized = await verifiedFinalize(aliceId, op[0].ticket_id, 'raw_document',
      { submission_id: subId, label: 'doc brut' });
    const docId = finalized[0].id as string;
    // Soft-delete comme delete_curation_request : deleted_at pose sur la ligne (bytes conserves).
    await db.admin.query('update public.raw_document set deleted_at=now() where id=$1', [docId]);

    await expect(rowsAs(aliceId,
      "select * from public.create_upload_operation($1, 'raw-documents', $2, $3, $4, 20, 'application/pdf')",
      [baseId, path, key, hash],
    )).rejects.toThrow(/supprime/i);
    expect((await db.admin.query('select deleted_at from public.raw_document where id=$1', [docId])).rows[0].deleted_at).not.toBeNull();
  });
});
