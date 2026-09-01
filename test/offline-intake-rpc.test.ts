// =============================================================================
// Tests DB du lot O1 de la feuille de route « saisie hors-ligne » :
// rejeu IDEMPOTENT des creations patient/rencontre preparees hors-ligne.
//
// Invariants exerces (feuille de route §3) :
//   * une meme cle rejouee ne cree jamais deux lignes (reponse reseau perdue) ;
//   * une meme cle avec un payload different est refusee (OFFLINE_OPERATION_MISMATCH) ;
//   * collision de code et doublon d'identite sont des rejets explicites SANS
//     laisser aucun recu residuel (tout echec est transactionnel) ;
//   * une rencontre d'un patient en attente ne part qu'apres la creation confirmee
//     du parent (OFFLINE_PARENT_NOT_SYNCED sinon) ;
//   * droits : acces base requis, authentification requise, recus server-only ;
//   * deux rejeux concurrents d'une meme intention se serialisent proprement.
// =============================================================================
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const REPLAY_PAT = 'select * from public.replay_patient_create($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)';
const REPLAY_ENC = 'select * from public.replay_encounter_create($1,$2,$3,$4,$5,$6,$7::jsonb,$8)';

let runId: string;
const patReceiptCount = async (operationId: string): Promise<number> => Number((await db.admin.query(
  'select count(*)::int n from public.offline_patient_create_operation where operation_id=$1',
  [operationId],
)).rows[0].n);
const encReceiptCount = async (operationId: string): Promise<number> => Number((await db.admin.query(
  'select count(*)::int n from public.offline_encounter_create_operation where operation_id=$1',
  [operationId],
)).rows[0].n);
const patientCountByCode = async (code: string): Promise<number> => Number((await db.admin.query(
  'select count(*)::int n from public.patient where base_id=$1 and patient_code=$2',
  [baseId, code],
)).rows[0].n);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  runId = `${Date.now()}`;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('rejeu patient idempotent', () => {
  test('un rejeu strictement identique renvoie le meme accuse sans seconde creation', async () => {
    const key = `off-intake-${runId}-replay`;
    const payload = [key, baseId, `OIN-${runId}-A`, 'Patient Fictif Un', '1980-01-01', null, null, null,
      JSON.stringify({ sexe: 'M', birth_year: 1990 })];

    const first = await rowsAs(aliceId, REPLAY_PAT, payload);
    expect(first[0]).toMatchObject({ patient_code: `OIN-${runId}-A`, replayed: false });
    expect(first[0].id).toBeTruthy();

    // Simulation d'une reponse HTTP perdue apres commit : le client rejoue la MEME intention.
    const replay = await rowsAs(aliceId, REPLAY_PAT, payload);
    expect(replay[0]).toMatchObject({ id: first[0].id, patient_code: first[0].patient_code, replayed: true });

    expect(await patientCountByCode(`OIN-${runId}-A`)).toBe(1);
    expect(await patReceiptCount(key)).toBe(1);
    const receipt = (await db.admin.query(
      'select patient_id, result_patient_code, completed_at from public.offline_patient_create_operation where user_id=$1 and operation_id=$2',
      [aliceId, key],
    )).rows[0];
    expect(receipt.patient_id).toBe(first[0].id);
    expect(receipt.result_patient_code).toBe(`OIN-${runId}-A`);
    expect(receipt.completed_at).not.toBeNull();
  });

  test('une meme cle avec un payload different est refusee sans modification partielle', async () => {
    const key = `off-intake-${runId}-mismatch`;
    await rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-B`, 'Patient Fictif Deux', '1985-05-05',
      null, null, null, JSON.stringify({ sexe: 'F', birth_year: 1985 })]);
    const before = (await db.admin.query(
      'select full_name, date_of_birth from public.patient_identity where base_id=$1 and patient_code=$2',
      [baseId, `OIN-${runId}-B`],
    )).rows[0];

    await expect(rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-B`, 'Autre Nom', '1985-05-05',
      null, null, null, JSON.stringify({ sexe: 'F', birth_year: 1985 })])).rejects.toThrow(/OFFLINE_OPERATION_MISMATCH/);

    const after = (await db.admin.query(
      'select full_name, date_of_birth from public.patient_identity where base_id=$1 and patient_code=$2',
      [baseId, `OIN-${runId}-B`],
    )).rows[0];
    expect(after.full_name).toBe(before.full_name);
    expect(await patientCountByCode(`OIN-${runId}-B`)).toBe(1);
  });

  test('une cle vide ou une charge invalide est refusee sans laisser de recu', async () => {
    await expect(rowsAs(aliceId, REPLAY_PAT, ['', baseId, `OIN-${runId}-C`, null, null, null, null, null, '{}']))
      .rejects.toThrow(/OFFLINE_OPERATION_INVALID/);
    await expect(rowsAs(aliceId, REPLAY_PAT, [`off-intake-${runId}-bad`, baseId, '   ', 'X Y', null, null, null, null, '{}']))
      .rejects.toThrow(/[Cc]ode patient requis/);
    expect(await patReceiptCount(`off-intake-${runId}-bad`)).toBe(0);
  });
});

describe('controles serveur explicites (collisions, doublons, cycle de vie)', () => {
  test('collision de code : rejet explicite et AUCUN recu residuel', async () => {
    await rowsAs(aliceId, REPLAY_PAT, [`off-intake-${runId}-col-1`, baseId, `OIN-${runId}-COL`,
      'Premier Coll', '1970-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);

    const loser = `off-intake-${runId}-col-2`;
    await expect(rowsAs(aliceId, REPLAY_PAT, [loser, baseId, `OIN-${runId}-COL`,
      'Second Coll', '1971-02-02', null, null, null, JSON.stringify({ sexe: 'F' })]))
      .rejects.toThrow(/duplicate key|uq_identity_base_code/i);

    expect(await patientCountByCode(`OIN-${runId}-COL`)).toBe(1);
    expect(await patReceiptCount(loser)).toBe(0); // l'echec transactionnel annule le recu
  });

  test('doublon d identite : OFFLINE_IDENTITY_DUPLICATE sans ecriture ni recu', async () => {
    const key = `off-intake-${runId}-dup-id`;
    await expect(rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-DUP`,
      'Patient Fictif Un', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'F' })]))
      .rejects.toThrow(/OFFLINE_IDENTITY_DUPLICATE/);

    expect(await patReceiptCount(key)).toBe(0);
    expect(await patientCountByCode(`OIN-${runId}-DUP`)).toBe(0);
  });

  test('base supprimee : RESOURCE_NOT_FOUND et aucun recu residuel', async () => {
    const key = `off-intake-${runId}-deleted-base`;
    try {
      await db.admin.query('update public.base set deleted_at=now() where id=$1', [baseId]);
      await expect(rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-DB`, 'N Importe', null,
        null, null, null, '{}'])).rejects.toThrow(/RESOURCE_NOT_FOUND/);
    } finally {
      await db.admin.query('update public.base set deleted_at=null where id=$1', [baseId]);
    }
    expect(await patReceiptCount(key)).toBe(0);
  });

  test('recu incomplet : le garde-fou OFFLINE_OPERATION_INCOMPLETE interdit le rejeu', async () => {
    const key = `off-intake-${runId}-incomplete`;
    const created = await rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-INC`,
      'Incomplet Test', '1999-09-09', null, null, null, JSON.stringify({ sexe: 'M' })]);
    await db.admin.query(
      'update public.offline_patient_create_operation set completed_at=null, patient_id=null, result_patient_code=null where user_id=$1 and operation_id=$2',
      [aliceId, key],
    );
    await expect(rowsAs(aliceId, REPLAY_PAT, [key, baseId, `OIN-${runId}-INC`,
      'Incomplet Test', '1999-09-09', null, null, null, JSON.stringify({ sexe: 'M' })]))
      .rejects.toThrow(/OFFLINE_OPERATION_INCOMPLETE/);
    expect(created[0].id).toBeTruthy();
  });
});

describe('dependance ordonnee patient -> rencontre', () => {
  test('la rencontre d un patient non synchronise est refusee sans recu', async () => {
    const orphanKey = `off-intake-${runId}-orphan-enc`;
    const unknownParent = `off-intake-${runId}-unknown-parent`;
    await expect(rowsAs(aliceId, REPLAY_ENC, [orphanKey, unknownParent, null, 'consultation',
      '2026-08-01', 'draft', JSON.stringify({ glasgow_score: 10 }), 'years']))
      .rejects.toThrow(/OFFLINE_PARENT_NOT_SYNCED/);
    expect(await encReceiptCount(orphanKey)).toBe(0);
  });

  test('apres la creation confirmee du parent : une seule rencontre, rejeu sans doublon', async () => {
    const parentKey = `off-intake-${runId}-parent`;
    const patient = (await rowsAs(aliceId, REPLAY_PAT, [parentKey, baseId, `OIN-${runId}-P`,
      'Parent Dependance', '1990-06-15', null, null, null, JSON.stringify({ sexe: 'M', birth_year: 1990 })]))[0];

    const encKey = `off-intake-${runId}-enc`;
    const encPayload = [encKey, parentKey, null, 'consultation', '2026-08-10', 'draft',
      JSON.stringify({ glasgow_score: 12 }), 'years'];
    const first = await rowsAs(aliceId, REPLAY_ENC, encPayload);
    expect(first[0]).toMatchObject({ patient_id: patient.id, replayed: false });

    // Reponse perdue sur la rencontre : le rejeu retrouve l'accuse, aucune seconde ligne.
    const replay = await rowsAs(aliceId, REPLAY_ENC, encPayload);
    expect(replay[0]).toMatchObject({ id: first[0].id, patient_id: patient.id, replayed: true });
    const encRows = (await db.admin.query(
      'select count(*)::int n from public.encounter where patient_id=$1', [patient.id],
    )).rows;
    expect(encRows.length).toBeGreaterThanOrEqual(1);
    expect(Number((await db.admin.query(
      "select count(*)::int n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and p.patient_code=$2",
      [baseId, `OIN-${runId}-P`],
    )).rows[0].n)).toBe(1);
    expect(await encReceiptCount(encKey)).toBe(1);

    // La cle rencontre est immuable : un payload different est refuse.
    await expect(rowsAs(aliceId, REPLAY_ENC, [encKey, parentKey, null, 'consultation', '2026-08-10',
      'draft', JSON.stringify({ glasgow_score: 13 }), 'years'])).rejects.toThrow(/OFFLINE_OPERATION_MISMATCH/);
  });

  test('rencontre rattachee a un patient serveur deja connu (sans cle parent)', async () => {
    const patient = (await rowsAs(aliceId, REPLAY_PAT, [`off-intake-${runId}-srv-pat`, baseId,
      `OIN-${runId}-S`, 'Serveur Direct', '1988-03-03', null, null, null, JSON.stringify({ sexe: 'F' })]))[0];
    const key = `off-intake-${runId}-srv-enc`;
    const created = await rowsAs(aliceId, REPLAY_ENC, [key, null, patient.id, 'suivi', '2026-08-11',
      'draft', '{}', 'years']);
    expect(created[0]).toMatchObject({ patient_id: patient.id, replayed: false });
    const replay = await rowsAs(aliceId, REPLAY_ENC, [key, null, patient.id, 'suivi', '2026-08-11',
      'draft', '{}', 'years']);
    expect(replay[0]).toMatchObject({ id: created[0].id, replayed: true });
  });
});

describe('concurrence sur les rejeux', () => {
  test('deux rejeux simultanes d une MEME intention aboutissent a UNE seule creation', async () => {
    const key = `off-intake-${runId}-race-same-key`;
    const payload = [key, baseId, `OIN-${runId}-RACE1`, 'Course Meme Cle', '1975-07-07',
      null, null, null, JSON.stringify({ sexe: 'M' })];
    const outcomes = await Promise.allSettled([
      rowsAs(aliceId, REPLAY_PAT, payload),
      rowsAs(aliceId, REPLAY_PAT, payload),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled') as PromiseFulfilledResult<Record<string, unknown>[]>[];
    expect(fulfilled).toHaveLength(2);
    const ids = new Set(fulfilled.map((o) => o.value[0].id));
    expect(ids.size).toBe(1); // la creation ET l'accuse sont les memes pour les deux appelants
    expect(await patientCountByCode(`OIN-${runId}-RACE1`)).toBe(1);
    expect(await patReceiptCount(key)).toBe(1);
  });

  test('deux operations distinctes qui visent le meme code : exactement une creation, aucun recu perdu', async () => {
    const prefix = `off-intake-${runId}-race-code`;
    const outcomes = await Promise.allSettled([
      rowsAs(aliceId, REPLAY_PAT, [`${prefix}-a`, baseId, `OIN-${runId}-RACE2`, 'Course Code A', '1961-01-01',
        null, null, null, JSON.stringify({ sexe: 'M' })]),
      rowsAs(aliceId, REPLAY_PAT, [`${prefix}-b`, baseId, `OIN-${runId}-RACE2`, 'Course Code B', '1962-02-02',
        null, null, null, JSON.stringify({ sexe: 'F' })]),
    ]);
    const statuses = outcomes.map((o) => o.status).sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected')!;
    expect(String(rejected.reason?.message ?? rejected.reason)).toMatch(/duplicate key|uq_identity_base_code|OFFLINE_IDENTITY_DUPLICATE/i);

    expect(await patientCountByCode(`OIN-${runId}-RACE2`)).toBe(1);
    // Le perdant ne laisse AUCUN recu ; le gagnant laisse le sien, complete.
    const receipts = (await db.admin.query(
      'select operation_id, completed_at from public.offline_patient_create_operation where user_id=$1 and operation_id like $2',
      [aliceId, `${prefix}%`],
    )).rows;
    expect(receipts).toHaveLength(1);
    expect(receipts[0].completed_at).not.toBeNull();
  });
});

describe('droits et cloisonnement', () => {
  test('un utilisateur sans acces a la base est refuse et ne laisse aucun recu', async () => {
    const key = `off-intake-${runId}-bob`;
    await expect(rowsAs(bobId, REPLAY_PAT, [key, baseId, `OIN-${runId}-BOB`, 'Bob Sans Acces', null,
      null, null, null, '{}'])).rejects.toThrow(/Acces refuse/i);
    expect(await patReceiptCount(key)).toBe(0);
  });

  test('les tables de recu restent server-only', async () => {
    await expect(rowsAs(aliceId, 'select * from public.offline_patient_create_operation')).rejects.toThrow(/permission denied/i);
    await expect(rowsAs(aliceId, 'select * from public.offline_encounter_create_operation')).rejects.toThrow(/permission denied/i);
  });

  test('authentification requise et privileges bornes', async () => {
    await expect(db.admin.query(REPLAY_PAT, ['no-auth', baseId, 'X-1', null, null, null, null, null, '{}']))
      .rejects.toThrow(/AUTHENTICATION_REQUIRED/);
    for (const signature of [
      'public.replay_patient_create(text,uuid,text,text,date,text,text,text,jsonb)',
      'public.replay_encounter_create(text,text,uuid,text,date,text,jsonb,text)',
    ]) {
      const metadata = (await db.admin.query(
        `select p.prosecdef, p.proconfig,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
           from pg_proc p
          where p.oid = $1::regprocedure`,
        [signature],
      )).rows[0];
      expect(metadata.prosecdef).toBe(true);
      expect(metadata.proconfig).toContain('search_path=public, extensions, pg_temp');
      expect(metadata.auth_execute).toBe(true);
      expect(metadata.anon_execute).toBe(false);
    }
  });
});
