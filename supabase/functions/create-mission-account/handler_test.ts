import { assert, assertEquals } from '@std/assert';
import { fakeSupabaseClient, makeRequest, okResult, readResponse, type Responder } from '../_shared/testing.ts';
import { handleCreateMissionAccount, type MissionAccountDeps } from './handler.ts';

const BASE = '10000000-0000-4000-8000-000000000001';
const MEDECIN = '10000000-0000-4000-8000-000000000002';
const STUDENT = '10000000-0000-4000-8000-000000000003';
const EMAIL = 'etudiant@exemple.test';
const SERVICE_KEY = 'service-role-secret-de-test';

const inSixMonths = () => new Date(Date.now() + 182 * 86400_000).toISOString();

interface Options {
  /** null = adresse inconnue ; sinon etat renvoye par mission_account_lookup. */
  lookup?: { user_id: string; global_role: string | null; activated: boolean } | null;
  lookupFails?: boolean;
  canManage?: boolean;
  provisionFails?: boolean;
  createFails?: boolean;
  mailFails?: boolean;
  calls?: string[];
}

function deps(options: Options = {}): MissionAccountDeps {
  const calls = options.calls ?? [];
  const userResponder: Responder = (call) => {
    if (call.kind !== 'rpc') return okResult(null);
    calls.push(`user:${call.rpc}`);
    if (call.rpc === 'can_manage_access') return okResult(options.canManage !== false);
    if (call.rpc === 'provision_mission_access') {
      return options.provisionFails
        ? { data: null, error: { message: 'Un compte de mission ne peut etre rattache qu a une seule base' } }
        : okResult({ id: 'access-1', base_id: BASE, user_id: STUDENT });
    }
    return okResult(null);
  };
  const adminResponder: Responder = (call) => {
    if (call.kind !== 'rpc') return okResult(null);
    calls.push(`admin:${call.rpc}`);
    if (call.rpc === 'mission_account_lookup') {
      if (options.lookupFails) return { data: null, error: { message: 'boom' } };
      return okResult(options.lookup ? [options.lookup] : []);
    }
    return okResult(null);
  };

  return {
    buildClients: () => ({
      asUser: fakeSupabaseClient({
        role: 'authenticated',
        user: { data: { user: { id: MEDECIN } } },
        responder: userResponder,
      }),
      admin: fakeSupabaseClient({ role: 'service_role', responder: adminResponder }),
    }),
    auth: {
      createMissionUser: () => {
        calls.push('auth:createMissionUser');
        return Promise.resolve(options.createFails ? { error: 'creation refusee' } : { userId: STUDENT });
      },
      sendPasswordSetup: () => {
        calls.push('auth:sendPasswordSetup');
        return Promise.resolve(options.mailFails ? { error: 'envoi refuse' } : {});
      },
    },
  };
}

const createBody = (extra: Record<string, unknown> = {}) => ({
  baseId: BASE,
  email: EMAIL,
  expiresAt: inSixMonths(),
  ...extra,
});

Deno.test('refuse une requete sans jeton', async () => {
  const res = await handleCreateMissionAccount(makeRequest({ auth: null, body: createBody() }), deps());
  assertEquals(res.status, 401);
});

Deno.test('refuse une methode autre que POST', async () => {
  const res = await handleCreateMissionAccount(makeRequest({ method: 'GET' }), deps());
  assertEquals(res.status, 405);
});

Deno.test('refuse un appelant sans gestion des acces sur la base, AVANT toute creation', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ canManage: false, calls }),
  );
  assertEquals(res.status, 403);
  assert(!calls.includes('auth:createMissionUser'), 'aucun compte ne doit etre cree');
  assert(!calls.includes('user:provision_mission_access'));
});

Deno.test('refuse une adresse invalide', async () => {
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ email: 'pas-une-adresse' }) }),
    deps(),
  );
  assertEquals(res.status, 400);
});

Deno.test('refuse une base qui n est pas un identifiant', async () => {
  const res = await handleCreateMissionAccount(makeRequest({ body: createBody({ baseId: 'x' }) }), deps());
  assertEquals(res.status, 400);
});

Deno.test('refuse une duree hors bornes (trop courte, trop longue, absente)', async () => {
  const tooShort = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ expiresAt: new Date(Date.now() + 3600_000).toISOString() }) }),
    deps(),
  );
  assertEquals(tooShort.status, 400);

  const tooLong = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ expiresAt: new Date(Date.now() + 900 * 86400_000).toISOString() }) }),
    deps(),
  );
  assertEquals(tooLong.status, 400);

  const missing = await handleCreateMissionAccount(
    makeRequest({ body: { baseId: BASE, email: EMAIL } }),
    deps(),
  );
  assertEquals(missing.status, 400);
});

Deno.test('refuse l ouverture de l identite sans justification', async () => {
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ canViewIdentity: true }) }),
    deps(),
  );
  assertEquals(res.status, 400);
  const withBlank = await handleCreateMissionAccount(
    makeRequest({ body: createBody({ canViewIdentity: true, identityJustification: '   ' }) }),
    deps(),
  );
  assertEquals(withBlank.status, 400);
});

Deno.test('cree le compte puis pose l acces, et envoie le courriel de mot de passe', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(makeRequest({ body: createBody() }), deps({ lookup: null, calls }));
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(body.userId, STUDENT);
  assertEquals(body.created, true);
  assertEquals(body.mailSent, true);
  // Ordre impose : autorisation -> recherche -> creation -> acces -> courriel.
  assertEquals(calls, [
    'user:can_manage_access',
    'admin:mission_account_lookup',
    'auth:createMissionUser',
    'user:provision_mission_access',
    'auth:sendPasswordSetup',
  ]);
});

Deno.test('refuse une adresse deja rattachee a un compte non-mission, sans rien creer', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: { user_id: 'autre', global_role: 'medecin', activated: true }, calls }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 409);
  assert(!calls.includes('auth:createMissionUser'), 'aucune retrogradation silencieuse');
  assert(!calls.includes('user:provision_mission_access'));
  // Message generique : l'existence d'un compte ne doit pas etre enumerable.
  assert(!String(body.error).includes(EMAIL));
  assert(!String(body.error).toLowerCase().includes('medecin'));
});

Deno.test('rejeu : compte de mission deja cree sans acces -> reprise au provisionnement', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: { user_id: STUDENT, global_role: 'saisisseur', activated: false }, calls }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(body.created, false);
  assert(!calls.includes('auth:createMissionUser'), 'aucun second compte Auth');
  assert(calls.includes('user:provision_mission_access'));
});

Deno.test('rejeu identique : meme resultat, aucun doublon', async () => {
  const first: string[] = [];
  await handleCreateMissionAccount(makeRequest({ body: createBody() }), deps({ lookup: null, calls: first }));
  const second: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: { user_id: STUDENT, global_role: 'saisisseur', activated: false }, calls: second }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(body.userId, STUDENT);
  assertEquals(second.filter((c) => c === 'auth:createMissionUser').length, 0);
});

Deno.test('provisionnement refuse apres creation : compte inerte et invite au rejeu', async () => {
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: null, provisionFails: true }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 409);
  assert(String(body.error).includes('relancez'), 'le message doit orienter vers le rejeu');
});

Deno.test('creation Auth impossible : aucun acces pose', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: null, createFails: true, calls }),
  );
  assertEquals(res.status, 502);
  assert(!calls.includes('user:provision_mission_access'));
});

Deno.test('echec d envoi du courriel : la mission est posee, le renvoi reste possible', async () => {
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookup: null, mailFails: true }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(body.mailSent, false);
});

Deno.test('recherche indisponible : rien n est cree', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: createBody() }),
    deps({ lookupFails: true, calls }),
  );
  assertEquals(res.status, 500);
  assert(!calls.includes('auth:createMissionUser'));
});

Deno.test('renvoi d invitation : reserve a un compte de mission existant', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'resend', baseId: BASE, email: EMAIL } }),
    deps({ lookup: { user_id: STUDENT, global_role: 'saisisseur', activated: false }, calls }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(body.resent, true);
  assert(calls.includes('auth:sendPasswordSetup'));
  assert(!calls.includes('auth:createMissionUser'));
});

Deno.test('renvoi d invitation : refuse pour une adresse inconnue ou non-mission', async () => {
  const unknown = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'resend', baseId: BASE, email: EMAIL } }),
    deps({ lookup: null }),
  );
  assertEquals(unknown.status, 404);

  const other = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'resend', baseId: BASE, email: EMAIL } }),
    deps({ lookup: { user_id: 'autre', global_role: 'medecin', activated: true } }),
  );
  assertEquals(other.status, 404);
});

Deno.test('renvoi d invitation : soumis au meme controle d appelant', async () => {
  const calls: string[] = [];
  const res = await handleCreateMissionAccount(
    makeRequest({ body: { action: 'resend', baseId: BASE, email: EMAIL } }),
    deps({ canManage: false, lookup: { user_id: STUDENT, global_role: 'saisisseur', activated: false }, calls }),
  );
  assertEquals(res.status, 403);
  assert(!calls.includes('auth:sendPasswordSetup'));
});

Deno.test('aucune reponse ne laisse fuir de secret ni d erreur interne brute', async () => {
  const cases = [
    await handleCreateMissionAccount(makeRequest({ body: createBody() }), deps({ lookup: null, provisionFails: true })),
    await handleCreateMissionAccount(makeRequest({ body: createBody() }), deps({ lookupFails: true })),
    await handleCreateMissionAccount(makeRequest({ body: createBody() }), deps({ lookup: null, createFails: true })),
  ];
  for (const res of cases) {
    const { text } = await readResponse(res);
    assert(!text.includes(SERVICE_KEY));
    assert(!text.toLowerCase().includes('boom'));
    assert(!text.includes('rattache qu a une seule base'), 'pas d erreur base brute renvoyee au client');
  }
});
