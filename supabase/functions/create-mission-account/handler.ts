import type { SupabaseClient } from '@supabase/supabase-js';
import { readJsonObject, RequestValidationError, UUID_RE, validationResponse } from '../_shared/contracts.ts';
import {
  type CredentialCipher,
  generateMissionPassword,
  missionTechnicalEmail,
  normalizeMissionIdentifier,
  sha256Hex,
} from './credentials.ts';

export interface MissionAuthUserState {
  userId: string;
  email: string | null;
  globalRole: string | null;
  credentialGeneration: number | null;
}

export interface MissionAuthAdmin {
  getMissionUser(userId: string): Promise<{ user?: MissionAuthUserState; error?: string }>;
  createMissionUser(input: {
    userId: string;
    email: string;
    password: string;
    accountLabel: string;
    credentialGeneration: number;
  }): Promise<{ userId?: string; error?: string }>;
  updateMissionCredentials(input: {
    userId: string;
    email: string;
    password: string;
    credentialGeneration: number;
  }): Promise<{ error?: string }>;
  banMissionUser(userId: string): Promise<{ error?: string }>;
}

export interface MissionAccountDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
  auth: MissionAuthAdmin;
  cipher: CredentialCipher;
  generatePassword?: () => string;
  randomUUID?: () => string;
  fingerprint?: (value: string) => Promise<string>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const MIN_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 731 * 24 * 60 * 60 * 1000;
const MAX_JUSTIFICATION_LENGTH = 500;
const IDENTIFIER_RE = /^[a-z0-9](?:[a-z0-9.-]{1,46}[a-z0-9])?$/;

type MissionAction = 'create' | 'regenerate' | 'reveal' | 'revoke';

interface CreateRequest {
  action: 'create';
  operationId: string;
  baseId: string;
  accountLabel: string;
  loginIdentifier: string;
  expiresAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
}

interface RegenerateRequest {
  action: 'regenerate';
  accessId: string;
  operationId: string;
}

interface RevealRequest {
  action: 'reveal';
  accessId: string;
}

interface RevokeRequest {
  action: 'revoke';
  accessId: string;
}

type MissionRequest = CreateRequest | RegenerateRequest | RevealRequest | RevokeRequest;

function parseAccessId(body: Record<string, unknown>): string {
  if (typeof body.accessId !== 'string' || !UUID_RE.test(body.accessId)) {
    throw new RequestValidationError(400, 'Compte de mission invalide');
  }
  return body.accessId;
}

function parse(body: Record<string, unknown>): MissionRequest {
  const action = (body.action ?? 'create') as MissionAction;
  if (!['create', 'regenerate', 'reveal', 'revoke'].includes(action)) {
    throw new RequestValidationError(400, 'Action invalide');
  }
  if (action !== 'create') {
    const accessId = parseAccessId(body);
    if (action === 'regenerate') {
      if (typeof body.operationId !== 'string' || !UUID_RE.test(body.operationId)) {
        throw new RequestValidationError(400, 'Operation invalide');
      }
      return { action, accessId, operationId: body.operationId };
    }
    return { action, accessId };
  }

  if (typeof body.operationId !== 'string' || !UUID_RE.test(body.operationId)) {
    throw new RequestValidationError(400, 'Operation invalide');
  }
  if (typeof body.baseId !== 'string' || !UUID_RE.test(body.baseId)) {
    throw new RequestValidationError(400, 'Base invalide');
  }
  const accountLabel = typeof body.accountLabel === 'string' ? body.accountLabel.trim() : '';
  if (!accountLabel || accountLabel.length > 120) throw new RequestValidationError(400, 'Nom du compte invalide');
  const loginIdentifier = normalizeMissionIdentifier(
    typeof body.loginIdentifier === 'string' ? body.loginIdentifier : '',
  );
  if (!IDENTIFIER_RE.test(loginIdentifier)) {
    throw new RequestValidationError(
      400,
      'Identifiant invalide : 3 a 48 caracteres, lettres minuscules, chiffres, points ou tirets',
    );
  }

  if (typeof body.expiresAt !== 'string') throw new RequestValidationError(400, 'Echeance invalide');
  const expires = Date.parse(body.expiresAt);
  if (!Number.isFinite(expires)) throw new RequestValidationError(400, 'Echeance invalide');
  const delta = expires - Date.now();
  if (delta < MIN_DURATION_MS) throw new RequestValidationError(400, 'La mission doit durer au moins un jour');
  if (delta > MAX_DURATION_MS) throw new RequestValidationError(400, 'La mission ne peut depasser 24 mois');

  const canViewIdentity = body.canViewIdentity === true;
  let identityJustification: string | null = null;
  if (canViewIdentity) {
    identityJustification = typeof body.identityJustification === 'string' ? body.identityJustification.trim() : '';
    if (!identityJustification) {
      throw new RequestValidationError(400, "Justification requise pour ouvrir l'identite");
    }
    if (identityJustification.length > MAX_JUSTIFICATION_LENGTH) {
      throw new RequestValidationError(400, 'Justification trop longue');
    }
  }

  return {
    action,
    operationId: body.operationId,
    baseId: body.baseId,
    accountLabel,
    loginIdentifier,
    expiresAt: new Date(expires).toISOString(),
    canViewIdentity,
    identityJustification,
  };
}

interface CredentialRow {
  user_id: string;
  base_id: string;
  account_label: string;
  login_identifier: string;
  password_ciphertext: string;
  password_nonce: string;
  credential_generation: number;
  operation_status: string;
}

function firstCredential(data: unknown): CredentialRow | null {
  const rows = Array.isArray(data) ? data as CredentialRow[] : [];
  return rows[0] ?? null;
}

function requestFingerprint(deps: MissionAccountDeps, payload: unknown): Promise<string> {
  return (deps.fingerprint ?? sha256Hex)(JSON.stringify(payload));
}

async function decryptCredential(deps: MissionAccountDeps, row: CredentialRow): Promise<string> {
  return await deps.cipher.decrypt({ ciphertext: row.password_ciphertext, nonce: row.password_nonce });
}

function credentialResponse(row: CredentialRow, password: string, extra: Record<string, unknown> = {}) {
  return json(200, {
    ...extra,
    userId: row.user_id,
    credential: { loginIdentifier: row.login_identifier, password },
  });
}

function isExpectedMissionUser(user: MissionAuthUserState, row: CredentialRow): boolean {
  return user.userId === row.user_id &&
    user.email?.toLowerCase() === missionTechnicalEmail(row.login_identifier) &&
    user.globalRole === 'saisisseur' &&
    user.credentialGeneration === row.credential_generation;
}

async function handleCreate(
  input: CreateRequest,
  actorId: string,
  asUser: SupabaseClient,
  admin: SupabaseClient,
  deps: MissionAccountDeps,
): Promise<Response> {
  // Pre-vol avant toute reservation/creation Auth irreversible.
  const { data: owner, error: ownerError } = await asUser.rpc('is_base_owner', { p_base: input.baseId });
  if (ownerError || owner !== true) return json(403, { error: 'Reserve au proprietaire de la base' });

  const generatedPassword = (deps.generatePassword ?? generateMissionPassword)();
  const envelope = await deps.cipher.encrypt(generatedPassword);
  const proposedUserId = deps.randomUUID ? deps.randomUUID() : crypto.randomUUID();
  const fingerprint = await requestFingerprint(deps, {
    action: input.action,
    baseId: input.baseId,
    accountLabel: input.accountLabel,
    loginIdentifier: input.loginIdentifier,
    expiresAt: input.expiresAt,
    canViewIdentity: input.canViewIdentity,
    identityJustification: input.identityJustification,
  });

  const { data, error } = await admin.rpc('begin_mission_account_creation', {
    p_operation_id: input.operationId,
    p_actor_id: actorId,
    p_base_id: input.baseId,
    p_user_id: proposedUserId,
    p_account_label: input.accountLabel,
    p_login_identifier: input.loginIdentifier,
    p_password_ciphertext: envelope.ciphertext,
    p_password_nonce: envelope.nonce,
    p_request_fingerprint: fingerprint,
  });
  if (error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (message.includes('Identifiant deja utilise')) return json(409, { error: 'Cet identifiant est deja utilise' });
    if (message.includes('Conflit d idempotence')) {
      return json(409, { error: 'Operation deja utilisee pour une autre demande' });
    }
    console.error('create-mission-account: creation reservation failed');
    return json(409, { error: 'Creation du compte refusee' });
  }
  const row = firstCredential(data);
  if (!row) return json(500, { error: 'Creation du compte impossible' });
  const password = await decryptCredential(deps, row);

  if (row.operation_status === 'completed') {
    return credentialResponse(row, password, { created: false, replayed: true });
  }

  const existing = await deps.auth.getMissionUser(row.user_id);
  if (existing.error) {
    console.error('create-mission-account: auth lookup failed');
    return json(502, { error: 'Verification du compte impossible' });
  }
  if (existing.user && !isExpectedMissionUser(existing.user, row)) {
    console.error('create-mission-account: reserved auth identity mismatch');
    return json(409, { error: 'Etat du compte incompatible' });
  }
  if (!existing.user) {
    const created = await deps.auth.createMissionUser({
      userId: row.user_id,
      email: missionTechnicalEmail(row.login_identifier),
      password,
      accountLabel: row.account_label,
      credentialGeneration: row.credential_generation,
    });
    if (!created.userId) {
      console.error('create-mission-account: auth user creation failed');
      return json(502, { error: 'Creation du compte impossible' });
    }
  }

  const { data: role, error: roleError } = await admin.rpc('reconcile_mission_profile', { p_user_id: row.user_id });
  if (roleError || role !== 'saisisseur') {
    console.error('create-mission-account: mission role could not be established');
    return json(409, { error: 'Role de mission non etabli : aucun acces pose' });
  }

  const { data: access, error: accessError } = await asUser.rpc('provision_mission_access', {
    p_base_id: input.baseId,
    p_user_id: row.user_id,
    p_expires_at: input.expiresAt,
    p_can_view_identity: input.canViewIdentity,
    p_identity_justification: input.identityJustification,
  });
  if (accessError || !access) {
    console.error('create-mission-account: access provisioning refused');
    return json(409, { error: 'Compte reserve mais acces non pose : relancez la meme demande' });
  }

  const { error: completeError } = await admin.rpc('complete_mission_credential_operation', {
    p_operation_id: input.operationId,
    p_actor_id: actorId,
  });
  if (completeError) {
    console.error('create-mission-account: completion failed');
    return json(409, { error: 'Compte cree mais operation non finalisee : relancez la meme demande' });
  }
  return credentialResponse(row, password, { created: true, accessId: (access as { id?: unknown }).id });
}

async function handleRegenerate(
  input: RegenerateRequest,
  actorId: string,
  admin: SupabaseClient,
  deps: MissionAccountDeps,
) {
  const generatedPassword = (deps.generatePassword ?? generateMissionPassword)();
  const envelope = await deps.cipher.encrypt(generatedPassword);
  const fingerprint = await requestFingerprint(deps, { action: input.action, accessId: input.accessId });
  const { data, error } = await admin.rpc('begin_mission_credential_regeneration', {
    p_operation_id: input.operationId,
    p_actor_id: actorId,
    p_access_id: input.accessId,
    p_password_ciphertext: envelope.ciphertext,
    p_password_nonce: envelope.nonce,
    p_request_fingerprint: fingerprint,
  });
  if (error) {
    console.error('create-mission-account: regeneration reservation failed');
    return json(409, { error: 'Regeneration des justificatifs refusee' });
  }
  const row = firstCredential(data);
  if (!row) return json(500, { error: 'Regeneration impossible' });
  const password = await decryptCredential(deps, row);
  if (row.operation_status !== 'completed') {
    const updated = await deps.auth.updateMissionCredentials({
      userId: row.user_id,
      email: missionTechnicalEmail(row.login_identifier),
      password,
      credentialGeneration: row.credential_generation,
    });
    if (updated.error) {
      console.error('create-mission-account: auth credential update failed');
      return json(502, { error: 'Mise a jour des justificatifs impossible' });
    }
    const { error: completeError } = await admin.rpc('complete_mission_credential_operation', {
      p_operation_id: input.operationId,
      p_actor_id: actorId,
    });
    if (completeError) {
      console.error('create-mission-account: regeneration completion failed');
      return json(409, { error: 'Justificatifs modifies mais operation non finalisee : relancez la meme demande' });
    }
  }
  return credentialResponse(row, password, { regenerated: true, replayed: row.operation_status === 'completed' });
}

async function handleReveal(input: RevealRequest, asUser: SupabaseClient, deps: MissionAccountDeps) {
  const { data, error } = await asUser.rpc('mission_credential_envelope', { p_access_id: input.accessId });
  if (error) return json(403, { error: 'Justificatifs indisponibles' });
  const row = firstCredential(data);
  if (!row) return json(404, { error: 'Justificatifs indisponibles' });
  const password = await decryptCredential(deps, row);
  return credentialResponse(row, password, { revealed: true });
}

async function handleRevoke(input: RevokeRequest, asUser: SupabaseClient, deps: MissionAccountDeps) {
  const { data: userId, error } = await asUser.rpc('revoke_mission_access', { p_access_id: input.accessId });
  if (error || typeof userId !== 'string') return json(403, { error: 'Revocation refusee' });
  const banned = await deps.auth.banMissionUser(userId);
  if (banned.error) {
    console.error('create-mission-account: auth ban failed after database revocation');
    return json(502, { error: 'Acces aux donnees revoque ; fermeture Auth a relancer' });
  }
  return json(200, { revoked: true });
}

export async function handleCreateMissionAccount(req: Request, deps: MissionAccountDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Authentification requise' });

  let input: MissionRequest;
  try {
    input = parse(await readJsonObject(req));
  } catch (error) {
    return validationResponse(error);
  }

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(authHeader));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible' });
  }
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  try {
    if (input.action === 'create') return await handleCreate(input, who.user.id, asUser, admin, deps);
    if (input.action === 'regenerate') return await handleRegenerate(input, who.user.id, admin, deps);
    if (input.action === 'reveal') return await handleReveal(input, asUser, deps);
    return await handleRevoke(input, asUser, deps);
  } catch {
    console.error('create-mission-account: unexpected credential operation failure');
    return json(500, { error: 'Operation de compte indisponible' });
  }
}
