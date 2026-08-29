import { assertEquals } from '@std/assert';
import { handleReconcileQuarantine, type ReconcileDeps } from './handler.ts';
import {
  errorResult,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';

interface Opts {
  user?: { data: { user: { id: string } | null }; error?: unknown };
  role?: string | null;
  candidates?: unknown;
  candidatesError?: unknown;
}

function deps(opts: Opts = {}): ReconcileDeps {
  const adminResponder: Responder = (call) => {
    if (call.kind === 'from' && call.table === 'profiles') {
      return okResult(
        'role' in opts ? (opts.role === null ? null : { global_role: opts.role }) : { global_role: 'system_admin' },
      );
    }
    if (call.kind === 'rpc' && call.rpc === 'quarantine_reconciliation_candidates') {
      return opts.candidatesError ? errorResult(opts.candidatesError) : okResult(opts.candidates ?? []);
    }
    if (call.kind === 'rpc') return okResult(null); // update_quarantine_move / complete_file_inspection
    return okResult(null);
  };
  const asUser = fakeSupabaseClient({ role: 'user', user: opts.user ?? { data: { user: { id: 'admin1' } } } });
  const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
  return { buildClients: () => ({ asUser, admin }), nowIso: () => '2026-07-12T00:00:00.000Z' };
}

Deno.test('reconcile-quarantine: auth absente -> 401', async () => {
  assertEquals(
    (await readResponse(await handleReconcileQuarantine(makeRequest({ auth: null, body: {} }), deps()))).status,
    401,
  );
});

Deno.test('reconcile-quarantine: non system_admin -> 403', async () => {
  const { status, body } = await readResponse(
    await handleReconcileQuarantine(makeRequest({ body: {} }), deps({ role: 'member' })),
  );
  assertEquals(status, 403);
  assertEquals(body.error, 'Reserve a l administrateur systeme');
});

Deno.test('reconcile-quarantine: payload invalide (limit > 100) -> 400', async () => {
  assertEquals(
    (await readResponse(await handleReconcileQuarantine(makeRequest({ body: { limit: 500 } }), deps()))).status,
    400,
  );
});

Deno.test('reconcile-quarantine: erreur dependance (candidates) -> 500', async () => {
  const { status, body } = await readResponse(
    await handleReconcileQuarantine(makeRequest({ body: {} }), deps({ candidatesError: { message: 'db' } })),
  );
  assertEquals(status, 500);
  assertEquals(body.error, 'Lecture des reconciliations impossible');
});

Deno.test('reconcile-quarantine: succes nominal (aucun candidat) -> 200 processed 0', async () => {
  const { status, body } = await readResponse(
    await handleReconcileQuarantine(makeRequest({ body: {} }), deps({ candidates: [] })),
  );
  assertEquals(status, 200);
  assertEquals(body.processed, 0);
});

Deno.test('reconcile-quarantine: candidat started -> reconcile_failed', async () => {
  const { status, body } = await readResponse(
    await handleReconcileQuarantine(makeRequest({ body: {} }), deps({ candidates: [{ id: ID, status: 'started' }] })),
  );
  assertEquals(status, 200);
  const results = body.results as Array<{ status: string }>;
  assertEquals(results[0].status, 'reconcile_failed');
});
