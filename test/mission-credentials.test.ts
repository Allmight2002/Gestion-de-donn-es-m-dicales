import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let ownerId: string;
let otherOwnerId: string;
let baseId: string;
let missionUserId: string;
let accessId: string;
const identifier = 'mission-neuro-securite';
const clearPassword = 'V7!secret-clair-interdit';
const cipherOne = 'aes-gcm-ciphertext-version-one';
const cipherTwo = 'aes-gcm-ciphertext-version-two';
const nonceOne = 'nonce-version-one';
const nonceTwo = 'nonce-version-two';
const fingerprintOne = '1'.repeat(64);
const fingerprintTwo = '2'.repeat(64);
const createOperation = randomUUID();

async function rowsAs(
  uid: string,
  sql: string,
  params: unknown[] = [],
  generation?: number,
): Promise<Record<string, unknown>[]> {
  return db.asUser(
    uid,
    async (client: Client) => (await client.query(sql, params)).rows,
    generation === undefined ? undefined : { app_metadata: { mission_credential_generation: generation } },
  );
}

async function rowsAsServer(
  actorId: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const client = db.pg.getPgClient();
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: actorId, role: 'service_role' }),
    ]);
    await client.query('set local role service_role');
    const result = await client.query(sql, params);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

async function createAuthUser(id: string, email: string, role: string, generation?: number): Promise<void> {
  const appMetadata: Record<string, unknown> = { global_role: role };
  if (generation !== undefined) appMetadata.mission_credential_generation = generation;
  await db.admin.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, 'hash-non-secret', now(), $3::jsonb, '{}'::jsonb, now(), now()
     )`,
    [id, email, JSON.stringify(appMetadata)],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = await db.admin.query('select id, email from auth.users');
  ownerId = users.rows.find((row) => row.email === 'alice@demo.test').id;
  otherOwnerId = users.rows.find((row) => row.email === 'bob@demo.test').id;
  baseId = (await db.admin.query('select id from public.base where owner_user_id = $1 limit 1', [ownerId])).rows[0].id;
  missionUserId = randomUUID();
});

afterAll(async () => {
  await db?.stop();
});

describe('creation idempotente et coffre', () => {
  test('reserve une seule identite et rejoue exactement la meme enveloppe', async () => {
    const sql = `select * from public.begin_mission_account_creation(
      $1,$2,$3,$4,$5,$6,$7,$8,$9
    )`;
    const params = [
      createOperation, ownerId, baseId, missionUserId, 'Equipe securite', identifier,
      cipherOne, nonceOne, fingerprintOne,
    ];
    const first = await rowsAsServer(ownerId, sql, params);
    const replay = await rowsAsServer(ownerId, sql, [
      createOperation, ownerId, baseId, randomUUID(), 'Equipe securite', identifier,
      'ciphertext-qui-ne-doit-pas-remplacer', 'nonce-rejeu-xx', fingerprintOne,
    ]);
    expect(first).toHaveLength(1);
    expect(replay).toHaveLength(1);
    expect(replay[0].user_id).toBe(first[0].user_id);
    expect(replay[0].password_ciphertext).toBe(cipherOne);
    expect(replay[0].password_nonce).toBe(nonceOne);
    expect((await db.admin.query(
      'select count(*)::int as n from public.mission_account_credential where login_identifier = $1',
      [identifier],
    )).rows[0].n).toBe(1);
  });

  test('refuse un meme identifiant ou une cle de reprise reutilisee pour une autre demande', async () => {
    await expect(rowsAsServer(ownerId,
      'select * from public.begin_mission_account_creation($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), ownerId, baseId, randomUUID(), 'Doublon', identifier, cipherOne, nonceOne, fingerprintOne],
    )).rejects.toThrow(/Identifiant deja utilise/i);
    await expect(rowsAsServer(ownerId,
      'select * from public.begin_mission_account_creation($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [createOperation, ownerId, baseId, missionUserId, 'Autre demande', identifier, cipherOne, nonceOne, fingerprintTwo],
    )).rejects.toThrow(/Conflit d idempotence/i);
  });

  test('n accorde aucun acces direct au coffre et ne journalise jamais le secret clair', async () => {
    await expect(rowsAs(ownerId,
      'select * from public.begin_mission_account_creation($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), ownerId, baseId, randomUUID(), 'Direct interdit', 'direct-interdit', cipherOne, nonceOne, fingerprintOne],
    )).rejects.toThrow(/permission denied|Appel serveur requis/i);
    await expect(rowsAs(ownerId, 'select * from public.mission_account_credential')).rejects.toThrow(/permission denied/i);
    await expect(rowsAs(otherOwnerId, 'select * from public.mission_credential_operation')).rejects.toThrow(/permission denied/i);
    const traces = await db.admin.query('select metadata::text as metadata from public.audit_log');
    expect(JSON.stringify(traces.rows)).not.toContain(clearPassword);
    const vault = await db.admin.query(
      'select password_ciphertext, password_nonce from public.mission_account_credential where user_id = $1',
      [missionUserId],
    );
    expect(JSON.stringify(vault.rows)).not.toContain(clearPassword);
  });
});

describe('activation, cloisonnement et revelation', () => {
  test('active le compte puis accepte uniquement un JWT portant la generation courante', async () => {
    await createAuthUser(missionUserId, `${identifier}@mission.meddata.invalid`, 'saisisseur', 1);
    const provisioned = await rowsAs(ownerId,
      "select * from public.provision_mission_access($1,$2,now() + interval '6 months',false,null)",
      [baseId, missionUserId],
    );
    accessId = provisioned[0].id as string;
    await rowsAsServer(ownerId, 'select public.complete_mission_credential_operation($1,$2)', [createOperation, ownerId]);

    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 1)).toEqual([{ ok: true }]);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 99)).toEqual([{ ok: false }]);
  });

  test('la liste globale et la revelation sont reservees au seul proprietaire et auditees', async () => {
    const owned = await rowsAs(ownerId, 'select * from public.mission_accounts_owned(null)');
    expect(owned.some((row) => row.login_identifier === identifier && row.base_id === baseId)).toBe(true);
    expect(await rowsAs(otherOwnerId, 'select * from public.mission_accounts_owned(null)')).toEqual([]);
    await expect(rowsAs(otherOwnerId, 'select * from public.mission_accounts_owned($1)', [baseId]))
      .rejects.toThrow(/proprietaire/i);
    await expect(rowsAs(otherOwnerId, 'select * from public.mission_credential_envelope($1)', [accessId]))
      .rejects.toThrow(/proprietaire/i);

    const envelope = await rowsAs(ownerId, 'select * from public.mission_credential_envelope($1)', [accessId]);
    expect(envelope[0].password_ciphertext).toBe(cipherOne);
    const audit = await db.admin.query(
      "select metadata::text from public.audit_log where action = 'mission_credentials_revealed' and entity_id = $1",
      [missionUserId],
    );
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows)).not.toContain(cipherOne);
    expect(JSON.stringify(audit.rows)).not.toContain(clearPassword);
  });

  test('un compte historique fonde sur email reste inutilisable meme avec un acces non revoque', async () => {
    const legacyUserId = randomUUID();
    await createAuthUser(legacyUserId, 'ancien-etudiant@demo.test', 'saisisseur');
    await db.admin.query(
      `insert into public.base_access (
         base_id,user_id,access_role,can_view_identity,can_view_raw_documents,
         can_edit_structured_data,can_export_data,can_manage_access,can_create_structured_data,
         expires_at,granted_by
       ) values ($1,$2,'editor',false,false,false,false,false,true,now() + interval '1 month',$3)`,
      [baseId, legacyUserId, ownerId],
    );
    expect(await rowsAs(legacyUserId, 'select public.has_base_access($1) as ok', [baseId], 1)).toEqual([{ ok: false }]);
    expect(await rowsAs(legacyUserId, 'select id from public.profiles where id = $1', [legacyUserId], 1)).toEqual([]);
  });
});

describe('regeneration, sessions, expiration et revocation', () => {
  test('regeneration atomique : supprime les sessions et refuse immediatement l ancien JWT', async () => {
    const sessionId = randomUUID();
    await db.admin.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sessionId, missionUserId]);
    const operation = randomUUID();
    const regenerated = await rowsAsServer(ownerId,
      'select * from public.begin_mission_credential_regeneration($1,$2,$3,$4,$5,$6)',
      [operation, ownerId, accessId, cipherTwo, nonceTwo, fingerprintTwo],
    );
    expect(regenerated[0].credential_generation).toBe(2);
    expect((await db.admin.query('select count(*)::int as n from auth.sessions where user_id = $1', [missionUserId])).rows[0].n)
      .toBe(0);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 1)).toEqual([{ ok: false }]);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 2)).toEqual([{ ok: true }]);

    const replay = await rowsAsServer(ownerId,
      'select * from public.begin_mission_credential_regeneration($1,$2,$3,$4,$5,$6)',
      [operation, ownerId, accessId, 'ciphertext-ne-doit-pas-remplacer', 'nonce-rejeu-xx', fingerprintTwo],
    );
    expect(replay[0].credential_generation).toBe(2);
    expect(replay[0].password_ciphertext).toBe(cipherTwo);
    await rowsAsServer(ownerId, 'select public.complete_mission_credential_operation($1,$2)', [operation, ownerId]);
  });

  test('l echeance est tranchee par la base, meme avec la bonne generation', async () => {
    await db.admin.query("update public.base_access set expires_at = now() - interval '1 minute' where id = $1", [accessId]);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 2)).toEqual([{ ok: false }]);
    const envelope = await rowsAs(ownerId, 'select * from public.mission_credential_envelope($1)', [accessId]);
    expect(envelope[0].password_ciphertext).toBe(cipherTwo);
    await db.admin.query("update public.base_access set expires_at = now() + interval '1 month' where id = $1", [accessId]);
  });

  test('la revocation supprime les sessions, invalide toute generation et est auditee sans secret', async () => {
    await db.admin.query('insert into auth.sessions(id,user_id) values ($1,$2)', [randomUUID(), missionUserId]);
    const result = await rowsAs(ownerId, 'select public.revoke_mission_access($1) as user_id', [accessId]);
    expect(result[0].user_id).toBe(missionUserId);
    expect((await db.admin.query('select status from public.mission_account_credential where user_id = $1', [missionUserId])).rows[0].status)
      .toBe('revoked');
    expect((await db.admin.query('select count(*)::int as n from auth.sessions where user_id = $1', [missionUserId])).rows[0].n)
      .toBe(0);
    expect(await rowsAs(missionUserId, 'select public.has_base_access($1) as ok', [baseId], 2)).toEqual([{ ok: false }]);
    const audit = await db.admin.query(
      "select metadata::text from public.audit_log where action = 'mission_revoked' and entity_id = $1",
      [accessId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain(clearPassword);
    expect(JSON.stringify(audit.rows)).not.toContain(cipherTwo);
  });
});
