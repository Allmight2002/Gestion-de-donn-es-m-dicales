import { assert, assertEquals } from '@std/assert';
import {
  assertNoSecret,
  captureLogs,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';
import { handleCreateMissionAccount, type MissionAccountDeps, type MissionAuthUserState } from './handler.ts';
import type { CredentialCipher } from './credentials.ts';

const BASE = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000002';
const STUDENT = '10000000-0000-4000-8000-000000000003';
const ACCESS = '10000000-0000-4000-8000-000000000004';
const OPERATION = '10000000-0000-4000-8000-000000000005';
const IDENTIFIER = 'mission-neuro-01';
const PASSWORD = 'V7!solide-mission#2026';
const TECHNICAL_EMAIL = `${IDENTIFIER}@mission.meddata.invalid`;

const inSixMonths = () => new Date(Date.now() + 182 * 86_400_000).toISOString();

interface Options {
  owner?: boolean;
  operationStatus?: 'pending' | 'completed';
  beginError?: string;
  completeError?: boolean;
  existingUser?: MissionAuthUserState;
  lookupError?: boolean;
  createError?: boolean;
  updateError?: boolean;
  banError?: boolean;
  envelopeError?: boolean;
  revokeError?: boolean;
  calls?: string[];
  authInputs?: Array<Record<string, unknown>>;
}

const cipher: CredentialCipher = {
  encrypt(password) {
    return Promise.resolve({ ciphertext: `enc:${password}`, nonce: 'nonce-de-test' });
  },
  decrypt(envelope) {
    return Promise.resolve(envelope.ciphertext.replace(/^enc:/u, ''));
  },
};

function credentialRow(status: 'pending' | 'completed' = 'pending', generation = 1) {
  return [{
    user_id: STUDENT,
    base_id: BASE,
    account_label: 'Equipe matin',
    login_identifier: IDENTIFIER,
    password_ciphertext: `enc:${PASSWORD}`,
    password_nonce: 'nonce-de-test',
    credential_generation: generation,
    operation_status: status,
  }];
}

function dependencies(options: Options = {}): MissionAccountDeps {
  const calls = options.calls ?? [];
  const inputs = options.authInputs ?? [];
  const responder: Responder = (call) => {
    if (call.kind !== 'rpc') return okResult(null);
    calls.push(`${call.role}:${call.rpc}`);
    switch (call.rpc) {
      case 'is_base_owner':
        return okResult(options.owner !== false);
      case 'begin_mission_account_creation':
        return options.beginError
          ? { data: null, error: { message: options.beginError } }
          : okResult(credentialRow(options.operationStatus));
      case 'begin_mission_credential_regeneration':
        return options.beginError
          ? { data: null, error: { message: options.beginError } }
          : okResult(credentialRow(options.operationStatus, 2));
      case 'mission_credential_envelope':
        return options.envelopeError
          ? { data: null, error: { message: 'interdit' } }
          : okResult(credentialRow('completed'));
      case 'revoke_mission_access':
        return options.revokeError ? { data: null, error: { message: 'interdit' } } : okResult(STUDENT);
      case 'reconcile_mission_profile':
        return okResult('saisisseur');
      case 'provision_mission_access':
        return okResult({ id: ACCESS });
      case 'complete_mission_credential_operation':
        return options.completeError ? { data: null, error: { message: 'indisponible' } } : okResult(undefined);
      default:
        return okResult(null);
    }
  };

  return {
    cipher,
    generatePassword: () => PASSWORD,
    randomUUID: () => STUDENT,
    fingerprint: () => Promise.resolve('a'.repeat(64)),
    buildClients: () => ({
      asUser: fakeSupabaseClient({
        role: 'authenticated',
        user: { data: { user: { id: OWNER } } },
        responder,
      }),
      admin: fakeSupabaseClient({ role: 'service_role', responder }),
    }),
    auth: {
      getMissionUser() {
        calls.push('auth:get');
        if (options.lookupError) return Promise.resolve({ error: 'lookup refuse' });
        return Promise.resolve(options.existingUser ? { user: options.existingUser } : {});
      },
      createMissionUser(input) {
        calls.push('auth:create');
        inputs.push(input);
        return Promise.resolve(options.createError ? { error: 'creation refusee' } : { userId: STUDENT });
      },
      updateMissionCredentials(input) {
        calls.push('auth:update');
        inputs.push(input);
        return Promise.resolve(options.updateError ? { error: 'mise a jour refusee' } : {});
      },
      banMissionUser(userId) {
        calls.push('auth:ban');
        inputs.push({ userId });
        return Promise.resolve(options.banError ? { error: 'blocage refuse' } : {});
      },
    },
  };
}

const createBody = (extra: Record<string, unknown> = {}) => ({
  action: 'create',
  operationId: OPERATION,
  baseId: BASE,
  accountLabel: 'Equipe matin',
  loginIdentifier: IDENTIFIER,
  expiresAt: inSixMonths(),
  canViewIdentity: false,
  identityJustification: null,
  ...extra,
});

Deno.test('refuse une requete sans jeton ou avec une methode incorrecte', async () => {
  assertEquals(
    (await handleCreateMissionAccount(makeRequest({ auth: null, body: createBody() }), dependencies())).status,
    401,
  );
  assertEquals((await handleCreateMissionAccount(makeRequest({ method: 'GET' }), dependencies())).status, 405);
});

Deno.test('le contrat refuse email, resend et les identifiants invalides', async () => {
  const resend = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'resend', baseId: BASE, email: 'x@example.test' } }),
    dependencies(),
  );
  assertEquals(resend.status, 400);
  const emailOnly = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ loginIdentifier: undefined, email: 'x@example.test' }) }),
    dependencies(),
  );
  assertEquals(emailOnly.status, 400);
  assertEquals(
    (await handleCreateMissionAccount(
      makeRequest({ body: createBody({ loginIdentifier: 'avec espace' }) }),
      dependencies(),
    )).status,
    400,
  );
});

Deno.test('creation reservee au proprietaire avant Auth ou reservation', async () => {
  const calls: string[] = [];
  const response = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    dependencies({ owner: false, calls }),
  );
  assertEquals(response.status, 403);
  assertEquals(calls, ['authenticated:is_base_owner']);
});

Deno.test('cree une identite Auth technique et ne rend que identifiant et mot de passe utiles', async () => {
  const calls: string[] = [];
  const authInputs: Array<Record<string, unknown>> = [];
  const response = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ loginIdentifier: 'Mission-Neuro-01' }) }),
    dependencies({ calls, authInputs }),
  );
  const { status, body, text } = await readResponse(response);
  assertEquals(status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  assertEquals(body.credential, { loginIdentifier: IDENTIFIER, password: PASSWORD });
  assert(!text.includes('service_role'));
  assertEquals(authInputs[0], {
    userId: STUDENT,
    email: TECHNICAL_EMAIL,
    password: PASSWORD,
    accountLabel: 'Equipe matin',
    credentialGeneration: 1,
  });
  assertEquals(calls, [
    'authenticated:is_base_owner',
    'service_role:begin_mission_account_creation',
    'auth:get',
    'auth:create',
    'service_role:reconcile_mission_profile',
    'authenticated:provision_mission_access',
    'service_role:complete_mission_credential_operation',
  ]);
});

Deno.test('un rejeu termine retourne le meme secret sans creer ni modifier Auth', async () => {
  const calls: string[] = [];
  const response = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    dependencies({ operationStatus: 'completed', calls }),
  );
  const { body } = await readResponse(response);
  assertEquals(body.credential, { loginIdentifier: IDENTIFIER, password: PASSWORD });
  assertEquals(body.replayed, true);
  assert(!calls.some((call) => call.startsWith('auth:')));
  assert(!calls.includes('authenticated:provision_mission_access'));
});

Deno.test('un identifiant deja pris et un conflit de reprise restent generiques', async () => {
  for (
    const [message, expected] of [
      ['Identifiant deja utilise', 'Cet identifiant est deja utilise'],
      ['Conflit d idempotence', 'Operation deja utilisee pour une autre demande'],
    ]
  ) {
    const response = await handleCreateMissionAccount(
      makeRequest({ body: createBody() }),
      dependencies({ beginError: message }),
    );
    const { status, body, text } = await readResponse(response);
    assertEquals(status, 409);
    assertEquals(body.error, expected);
    assert(!text.includes(TECHNICAL_EMAIL));
    assert(!text.includes(PASSWORD));
  }
});

Deno.test('la regeneration change le secret Auth avec une generation superieure', async () => {
  const calls: string[] = [];
  const authInputs: Array<Record<string, unknown>> = [];
  const response = await handleCreateMissionAccount(
    makeRequest({
      body: {
        action: 'regenerate',
        accessId: ACCESS,
        operationId: OPERATION,
      },
    }),
    dependencies({ calls, authInputs }),
  );
  const { status, body } = await readResponse(response);
  assertEquals(status, 200);
  assertEquals(body.credential, { loginIdentifier: IDENTIFIER, password: PASSWORD });
  assertEquals(authInputs[0], {
    userId: STUDENT,
    email: TECHNICAL_EMAIL,
    password: PASSWORD,
    credentialGeneration: 2,
  });
  assert(calls.includes('auth:update'));
  assert(calls.includes('service_role:complete_mission_credential_operation'));
});

Deno.test('le rejeu de regeneration ne change pas le secret une seconde fois', async () => {
  const calls: string[] = [];
  const response = await handleCreateMissionAccount(
    makeRequest({
      body: {
        action: 'regenerate',
        accessId: ACCESS,
        operationId: OPERATION,
      },
    }),
    dependencies({ operationStatus: 'completed', calls }),
  );
  const { body } = await readResponse(response);
  assertEquals(body.replayed, true);
  assert(!calls.includes('auth:update'));
});

Deno.test('revelation et revocation passent par les RPC proprietaire et la revocation bannit Auth', async () => {
  const revealCalls: string[] = [];
  const reveal = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'reveal', accessId: ACCESS } }),
    dependencies({ calls: revealCalls }),
  );
  assertEquals((await readResponse(reveal)).body.credential, { loginIdentifier: IDENTIFIER, password: PASSWORD });
  assert(revealCalls.includes('authenticated:mission_credential_envelope'));

  const revokeCalls: string[] = [];
  const revoke = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'revoke', accessId: ACCESS } }),
    dependencies({ calls: revokeCalls }),
  );
  assertEquals(revoke.status, 200);
  assert(revokeCalls.includes('authenticated:revoke_mission_access'));
  assert(revokeCalls.includes('auth:ban'));
});

Deno.test('un autre compte ne peut ni reveler ni revoquer', async () => {
  assertEquals(
    (await handleCreateMissionAccount(
      makeRequest({ body: { action: 'reveal', accessId: ACCESS } }),
      dependencies({ envelopeError: true }),
    )).status,
    403,
  );
  assertEquals(
    (await handleCreateMissionAccount(
      makeRequest({ body: { action: 'revoke', accessId: ACCESS } }),
      dependencies({ revokeError: true }),
    )).status,
    403,
  );
});

Deno.test('les echecs ne divulguent ni mot de passe, ni email technique, ni erreur interne dans les logs', async () => {
  const { response, logs } = await captureLogs(() =>
    handleCreateMissionAccount(
      makeRequest({ body: createBody() }),
      dependencies({ createError: true }),
    )
  );
  const { text } = await readResponse(response);
  assertEquals(response.status, 502);
  assertNoSecret(`${text}\n${logs}`, [PASSWORD, TECHNICAL_EMAIL, 'creation refusee']);
});
