// Tests DB du POOL DE CURATION GLOBAL (cahier v3.0) : le medecin soumet un cas (code
// opaque + documents deidentifies) ; les curateurs (role global) voient le pool, RESERVENT
// un cas (anti-collision), structurent ; les validateurs valident -> donnees VERIFIEES.
// Confidentialite : curateur/validateur ne voient JAMAIS l'identite ; l'analyste est exclu.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let adminId: string;
let aliceId: string;     // medecin proprietaire
let curator1Id: string;  // curateur global
let curator2Id: string;  // curateur global
let validatorId: string; // validateur global
let annaId: string;      // analyste (EXCLU du pool)
let baseId: string;
let seedTaskId: string;  // tache OUVERTE du seed (avec document)

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

// Cree un cas OUVERT (dans le pool) : la RPC le cree en 'preparing', puis on depose un
// document (condition cote medecin) et on le SOUMET -> 'open', reservable par un curateur.
async function openCase(target: string): Promise<{ taskId: string; subId: string; patientId: string }> {
  const pid = (await db.admin.query('select id from public.patient where base_id=$1 and patient_code=$2', [baseId, target])).rows[0].id;
  const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'REF-' + target]);
  const taskId = task[0].id as string, subId = task[0].submission_id as string;
  await db.admin.query(
    "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'doc',$3,'application/pdf')",
    [subId, baseId, `${baseId}/${subId}/d.pdf`],
  );
  await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
  return { taskId, subId, patientId: pid };
}
async function claimAndDraft(target: string, patientData: object, encounters: object[]) {
  const c = await openCase(target);
  await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]);
  const draft = await rowsAs(curator1Id,
    "insert into public.curation_draft(task_id, base_id, patient_data, encounters, status) values($1,$2,$3::jsonb,$4::jsonb,'draft') returning id",
    [c.taskId, baseId, JSON.stringify(patientData), JSON.stringify(encounters)]);
  await rowsAs(curator1Id, 'select * from public.submit_curation_draft($1)', [draft[0].id]);
  return { ...c, draftId: draft[0].id as string };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  adminId = byEmail.get('admin@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  curator1Id = byEmail.get('curator1@demo.test')!;
  curator2Id = byEmail.get('curator2@demo.test')!;
  validatorId = byEmail.get('validator@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  seedTaskId = (await db.admin.query("select id from public.curation_task where status='open' limit 1")).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('pool global : visibilite + confidentialite', () => {
  test('un curateur voit la LISTE du pool mais PAS les documents avant reservation, ni l identite', async () => {
    expect((await rowsAs(curator1Id, 'select id from public.curation_task')).length).toBeGreaterThan(0); // pool visible
    // §5.1 : un curateur NON affecte ne voit AUCUN document (acces apres reservation seulement).
    expect(await rowsAs(curator1Id, 'select id from public.raw_document')).toHaveLength(0);
    // Aucun acces base -> aucune identite.
    expect(await rowsAs(curator1Id, 'select id from public.patient_identity')).toHaveLength(0);
  });

  test('apres reservation, le curateur voit les documents de SA tache ; pas ceux d une autre', async () => {
    const a = await openCase('NCH-005'); // chaque cas porte deja 1 document (depose a la soumission)
    const b = await openCase('NCH-006');

    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [a.taskId]); // curator1 reserve A
    expect((await rowsAs(curator1Id, 'select id from public.raw_document where submission_id=$1', [a.subId])).length).toBe(1); // SA tache
    expect(await rowsAs(curator1Id, 'select id from public.raw_document where submission_id=$1', [b.subId])).toHaveLength(0); // pas l autre
  });

  test('l analyste et l admin ne voient PAS les documents bruts du pool', async () => {
    expect(await rowsAs(annaId, 'select id from public.raw_document')).toHaveLength(0);
    expect(await rowsAs(adminId, 'select id from public.raw_document')).toHaveLength(0);
  });

  test('le medecin proprietaire voit ses propres cas', async () => {
    expect((await rowsAs(aliceId, 'select id from public.curation_task where base_id=$1', [baseId])).length).toBeGreaterThan(0);
  });
});

describe('reservation (anti-collision)', () => {
  test('un curateur reserve un cas ouvert ; un 2e curateur ne peut plus le reserver', async () => {
    const { taskId } = await openCase('NCH-005');
    const claimed = await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]);
    expect(claimed[0].assigned_to).toBe(curator1Id);
    expect(claimed[0].status).toBe('in_progress');
    await expect(rowsAs(curator2Id, 'select * from public.claim_curation_task($1)', [taskId])).rejects.toThrow(/reserve|indisponible/i);
  });

  test('un non-curateur (analyste) ne peut pas reserver', async () => {
    await expect(rowsAs(annaId, 'select * from public.claim_curation_task($1)', [seedTaskId])).rejects.toThrow(/curateur/i);
  });
});

describe('structuration -> validation (pool)', () => {
  test('curateur structure + soumet, validateur valide -> donnees VERIFIEES (age calcule)', async () => {
    const c = await claimAndDraft('NCH-004', { blood_group: 'AB-' }, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { diagnosis: 'AVC', glasgow_score: 13 } },
    ]);
    const encBefore = Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [c.patientId])).rows[0].n);

    const review = await rowsAs(validatorId, 'select * from public.validate_curation_draft($1,$2,$3)', [c.draftId, 'approved', 'OK']);
    expect(review[0].decision).toBe('approved');

    const pat = (await db.admin.query('select data, validation_status from public.patient where id=$1', [c.patientId])).rows[0];
    expect(pat.data.blood_group).toBe('AB-');
    expect(pat.validation_status).toBe('verified');
    const enc = (await db.admin.query("select age_value, validation_status, data from public.encounter where patient_id=$1 and encounter_date='2024-05-10'", [c.patientId])).rows[0];
    expect(enc.validation_status).toBe('verified');
    expect(enc.age_value).not.toBeNull();
    expect('age_at_encounter' in enc.data).toBe(false);
    expect(Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [c.patientId])).rows[0].n)).toBe(encBefore + 1);

    // Le validateur n'a jamais eu acces a l'identite.
    expect(await rowsAs(validatorId, 'select id from public.patient_identity')).toHaveLength(0);
    // Journalisation curation.
    expect((await db.admin.query("select 1 from public.audit_log where action='curation_validated' and entity_id=$1", [c.draftId])).rows.length).toBeGreaterThan(0);
  });

  test('validation SERVEUR (§5.4) : un brouillon hors bornes (Glasgow=78) est refuse', async () => {
    const c = await claimAndDraft('NCH-010', {}, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { glasgow_score: 78 } },
    ]);
    await expect(rowsAs(validatorId, 'select * from public.validate_curation_draft($1,$2,$3)', [c.draftId, 'approved', null])).rejects.toThrow(/maximum|glasgow/i);
  });

  test('un curateur ne peut PAS valider (reserve aux validateurs)', async () => {
    const c = await claimAndDraft('NCH-006', {}, [{ encounter_type: 'suivi', encounter_date: '2024-06-01', age_unit: 'years', data: { glasgow_score: 7 } }]);
    await expect(rowsAs(curator1Id, 'select * from public.validate_curation_draft($1,$2,$3)', [c.draftId, 'approved', 'x'])).rejects.toThrow(/validateur/i);
  });

  test('un curateur non affecte ne peut pas creer de brouillon sur un cas', async () => {
    const { taskId } = await openCase('NCH-007');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]); // reserve par curator1
    await expect(
      rowsAs(curator2Id, "insert into public.curation_draft(task_id, base_id, status) values($1,$2,'draft')", [taskId, baseId]),
    ).rejects.toThrow();
  });
});

describe('soumission de cas (medecin)', () => {
  test('seul le medecin proprietaire cree un cas ; un curateur ne peut pas', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-008'", [baseId])).rows[0].id;
    await expect(rowsAs(curator1Id, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'x'])).rejects.toThrow(/proprietaire/i);
    const ok = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'x']);
    // Le cas naît en PREPARATION : il n'entre PAS encore dans le pool.
    expect(ok[0].status).toBe('preparing');
  });

  test('un cas n entre dans le pool qu apres soumission, et seulement avec >= 1 document', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-001'", [baseId])).rows[0].id;
    const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'prep']);
    const taskId = task[0].id as string, subId = task[0].submission_id as string;
    expect(task[0].status).toBe('preparing');

    // Sans document : la soumission est refusee (le staff n'aurait rien a traiter).
    await expect(rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId])).rejects.toThrow(/document/i);
    // Un cas 'preparing' n'est pas reservable par un curateur (garde au niveau RPC/DB ;
    // l'exclusion du pool cote liste est applicative, testee cote front).
    await expect(rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId])).rejects.toThrow(/reserve|indisponible/i);

    await db.admin.query("insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'d',$3,'application/pdf')", [subId, baseId, `${baseId}/${subId}/d.pdf`]);
    // Un non-proprietaire ne peut pas soumettre.
    await expect(rowsAs(curator1Id, 'select * from public.submit_curation_request($1)', [taskId])).rejects.toThrow(/proprietaire/i);
    // Proprietaire + document : le cas entre dans le pool ('open').
    const sent = await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
    expect(sent[0].status).toBe('open');
    expect((await db.admin.query('select status from public.raw_submission where id=$1', [subId])).rows[0].status).toBe('in_curation');
  });

  test('portee "rencontre" : scope=encounter ; la validation cree une rencontre', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-009'", [baseId])).rows[0].id;
    const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3,$4)', [baseId, pid, 'ENC', 'encounter']);
    expect((await db.admin.query('select scope from public.raw_submission where id=$1', [task[0].submission_id])).rows[0].scope).toBe('encounter');

    // Soumission au pool : document requis, puis envoi.
    await db.admin.query("insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'d',$3,'application/pdf')", [task[0].submission_id, baseId, `${baseId}/${task[0].submission_id}/d.pdf`]);
    await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [task[0].id]);
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [task[0].id]);
    const draft = await rowsAs(curator1Id,
      "insert into public.curation_draft(task_id, base_id, encounters, status) values($1,$2,$3::jsonb,'draft') returning id",
      [task[0].id, baseId, JSON.stringify([{ encounter_type: 'suivi', encounter_date: '2024-09-01', age_unit: 'years', data: { glasgow_score: 11 } }])]);
    await rowsAs(curator1Id, 'select * from public.submit_curation_draft($1)', [draft[0].id]);
    const before = Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [pid])).rows[0].n);
    await rowsAs(validatorId, 'select * from public.validate_curation_draft($1,$2,$3)', [draft[0].id, 'approved', null]);
    expect(Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [pid])).rows[0].n)).toBe(before + 1);
  });
});

describe('suppression d une demande (medecin)', () => {
  test('le proprietaire supprime sa demande : tache + documents passent en supprime + trace', async () => {
    const c = await openCase('NCH-005'); // cas 'open' avec 1 document
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [c.taskId, 'erreur de saisie']);

    expect((await db.admin.query('select deleted_at from public.curation_task where id=$1', [c.taskId])).rows[0].deleted_at).not.toBeNull();
    // Les documents ne sont plus lisibles (deleted_at) -> 0 actif.
    expect(Number((await db.admin.query('select count(*)::int n from public.raw_document where submission_id=$1 and deleted_at is null', [c.subId])).rows[0].n)).toBe(0);
    // Disparait de la vue du medecin (les listes filtrent deleted_at is null).
    expect(await rowsAs(aliceId, 'select id from public.curation_task where id=$1 and deleted_at is null', [c.taskId])).toHaveLength(0);
    // Journalisation.
    expect((await db.admin.query("select 1 from public.audit_log where action='curation_request_deleted' and entity_id=$1", [c.taskId])).rows.length).toBeGreaterThan(0);
  });

  test('un curateur ne peut pas supprimer la demande d un medecin', async () => {
    const c = await openCase('NCH-006');
    await expect(rowsAs(curator1Id, 'select public.delete_curation_request($1,$2)', [c.taskId, 'x'])).rejects.toThrow(/proprietaire/i);
  });

  test('une demande VALIDEE ne peut pas etre supprimee (provenance preservee)', async () => {
    const c = await claimAndDraft('NCH-004', { blood_group: 'AB-' }, []);
    await rowsAs(validatorId, 'select * from public.validate_curation_draft($1,$2,$3)', [c.draftId, 'approved', null]);
    await expect(rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [c.taskId, 'x'])).rejects.toThrow(/validee/i);
  });

  test('option "patient + demande" : le patient cible (et son identite) sont aussi supprimes', async () => {
    const c = await openCase('NCH-008'); // cas 'open' avec 1 document, patient NCH-008
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2,$3)', [c.taskId, 'cree par erreur', true]);

    expect((await db.admin.query('select deleted_at from public.curation_task where id=$1', [c.taskId])).rows[0].deleted_at).not.toBeNull();
    // Cascade soft_delete_patient : patient + identite marques supprimes.
    expect((await db.admin.query('select deleted_at from public.patient where id=$1', [c.patientId])).rows[0].deleted_at).not.toBeNull();
    expect((await db.admin.query("select deleted_at from public.patient_identity where base_id=$1 and patient_code='NCH-008'", [baseId])).rows[0].deleted_at).not.toBeNull();
    // Trace de suppression patient (en plus de celle de la demande).
    expect((await db.admin.query("select 1 from public.audit_log where action='patient_deleted' and entity_id=$1", [c.patientId])).rows.length).toBeGreaterThan(0);
  });
});
