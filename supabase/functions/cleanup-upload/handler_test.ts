import { assertEquals } from '@std/assert';
import { type CleanupDeps, handleCleanupUpload } from './handler.ts';
import {
  errorResult,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';

const TICKET = '123e4567-e89b-42d3-a456-426614174000';
const BASE = '223e4567-e89b-42d3-a456-426614174000';
const PATH = `${BASE}/orphan.pdf`;

interface Opts {
  user?: { data: { user: { id: string } | null }; error?: unknown };
  ticket?: unknown;
  ticketError?: unknown;
  allowed?: unknown;
  existing?: unknown;
  claimed?: unknown;
  removeError?: unknown;
}

function deps(opts: Opts = {}): CleanupDeps {
  const ticket = 'ticket' in opts ? opts.ticket : {
    id: TICKET,
    owner_user_id: 'u1',
    base_id: BASE,
    bucket: 'raw-documents',
    path: PATH,
    status: 'pending',
    expires_at: '2999-01-01T00:00:00.000Z',
  };
  const userResponder: Responder = (call) => call.kind === 'rpc' ? okResult(opts.allowed ?? true) : okResult(null);
  const adminResponder: Responder = (call) => {
    if (call.kind === 'storage') return opts.removeError ? errorResult(opts.removeError) : okResult([{}]);
    if (call.kind === 'from') {
      if (call.table === 'upload_ticket') {
        if (opts.ticketError && !call.ops.some((o) => o.m === 'update')) return errorResult(opts.ticketError);
        if (call.ops.some((o) => o.m === 'update')) return okResult('claimed' in opts ? opts.claimed : { id: TICKET });
        return okResult(ticket);
      }
      if (call.ops.some((o) => o.m === 'limit')) return okResult(opts.existing ?? null); // ligne metier existante ?
      return okResult(null);
    }
    return okResult(null);
  };
  const asUser = fakeSupabaseClient({
    role: 'user',
    user: opts.user ?? { data: { user: { id: 'u1' } } },
    responder: userResponder,
  });
  const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
  return {
    buildClients: () => ({ asUser, admin }),
    now: () => 1_700_000_000_000,
    nowIso: () => '2026-07-12T00:00:00.000Z',
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  bucket: 'raw-documents',
  path: PATH,
  ticketId: TICKET,
  ...over,
});

Deno.test('cleanup-upload: auth absente -> 401', async () => {
  assertEquals(
    (await readResponse(await handleCleanupUpload(makeRequest({ auth: null, body: body() }), deps()))).status,
    401,
  );
});

Deno.test('cleanup-upload: payload invalide -> 400', async () => {
  assertEquals(
    (await readResponse(await handleCleanupUpload(makeRequest({ body: body({ ticketId: 'nope' }) }), deps()))).status,
    400,
  );
});

Deno.test('cleanup-upload: permission refusee -> 403', async () => {
  const { status, body: b } = await readResponse(
    await handleCleanupUpload(makeRequest({ body: body() }), deps({ allowed: false })),
  );
  assertEquals(status, 403);
  assertEquals(b.error, 'Acces refuse');
});

Deno.test('cleanup-upload: ticket non proprietaire -> 403', async () => {
  const foreign = {
    id: TICKET,
    owner_user_id: 'someone-else',
    base_id: BASE,
    bucket: 'raw-documents',
    path: PATH,
    status: 'pending',
    expires_at: '2999-01-01T00:00:00.000Z',
  };
  assertEquals(
    (await readResponse(await handleCleanupUpload(makeRequest({ body: body() }), deps({ ticket: foreign })))).status,
    403,
  );
});

Deno.test('cleanup-upload: objet deja rattache -> 409', async () => {
  assertEquals(
    (await readResponse(await handleCleanupUpload(makeRequest({ body: body() }), deps({ existing: { id: 'x' } }))))
      .status,
    409,
  );
});

Deno.test('cleanup-upload: erreur dependance (remove Storage) -> 500', async () => {
  const { status, body: b } = await readResponse(
    await handleCleanupUpload(makeRequest({ body: body() }), deps({ removeError: { message: 'io' } })),
  );
  assertEquals(status, 500);
  assertEquals(b.error, 'Suppression Storage impossible');
});

Deno.test('cleanup-upload: succes nominal -> 200 removed', async () => {
  const { status, body: b } = await readResponse(await handleCleanupUpload(makeRequest({ body: body() }), deps()));
  assertEquals(status, 200);
  assertEquals(b.status, 'removed');
});
