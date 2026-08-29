import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { handlePurgeDeletedBase, type PurgeDeps } from './handler.ts';
import {
  type ClientCall,
  errorResult,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';

const BASE = '223e4567-e89b-42d3-a456-426614174000';
const OPERATION = '123e4567-e89b-42d3-a456-426614174000';
const PATH = `${BASE}/raw/document.pdf`;
const MANIFEST = { objects: [{ bucket: 'raw-documents', path: PATH }] };
const HASH = 'a'.repeat(64);

interface Opts {
  prepare?: Record<string, unknown>;
  prepareError?: unknown;
  listError?: unknown;
  removeError?: unknown;
  finalize?: Record<string, unknown>;
  finalizeError?: unknown;
  listed?: string[];
}

function deps(opts: Opts = {}): { deps: PurgeDeps; calls: ClientCall[] } {
  const calls: ClientCall[] = [];
  let removed = false;
  const prepare = opts.prepare ?? {
    status: 'ready',
    code: 'PURGE_PREPARED',
    operation_id: OPERATION,
    base_id: BASE,
    manifest: MANIFEST,
    manifest_hash: HASH,
    patient_count: 2,
    encounter_count: 1,
    document_count: 1,
    attachment_count: 0,
    export_count: 0,
    storage_object_count: 1,
  };
  const finalize = opts.finalize ?? { status: 'completed', code: 'PURGED', operation_id: OPERATION, base_id: BASE };
  const asUserResponder: Responder = (call) => {
    calls.push(call);
    if (call.kind === 'rpc' && call.rpc === 'prepare_base_purge') {
      return opts.prepareError ? errorResult(opts.prepareError) : okResult([prepare]);
    }
    return okResult(null);
  };
  const adminResponder: Responder = (call) => {
    calls.push(call);
    if (call.kind === 'rpc' && call.rpc === 'finalize_base_purge') {
      return opts.finalizeError ? errorResult(opts.finalizeError) : okResult([finalize]);
    }
    if (call.kind === 'storage' && call.method === 'list') {
      if (opts.listError) return errorResult(opts.listError);
      const prefix = call.args[0];
      const current = removed
        ? []
        : (opts.listed ?? (prefix === BASE && call.bucket === 'raw-documents' ? ['raw/document.pdf'] : []));
      return okResult(current.map((name) => ({ name, id: 'storage-id' })));
    }
    if (call.kind === 'storage' && call.method === 'remove') {
      if (opts.removeError) return errorResult(opts.removeError);
      removed = true;
      return okResult([{}]);
    }
    return okResult(null);
  };
  const asUser = fakeSupabaseClient({
    role: 'authenticated',
    user: { data: { user: { id: 'owner-1' } } },
    responder: asUserResponder,
  });
  const admin = fakeSupabaseClient({ role: 'service_role', responder: adminResponder });
  return { calls, deps: { buildClients: () => ({ asUser, admin }) } };
}

const body = (over: Record<string, unknown> = {}) => ({ baseId: BASE, operationId: OPERATION, ...over });

Deno.test('purge-deleted-base: exige POST et authentification', async () => {
  assertEquals(
    (await readResponse(await handlePurgeDeletedBase(makeRequest({ method: 'GET' }), deps().deps))).status,
    405,
  );
  assertEquals(
    (await readResponse(await handlePurgeDeletedBase(makeRequest({ auth: null, body: body() }), deps().deps))).status,
    401,
  );
});

Deno.test('purge-deleted-base: refuse un payload invalide sans toucher Storage', async () => {
  const setup = deps();
  const response = await readResponse(
    await handlePurgeDeletedBase(makeRequest({ body: body({ baseId: 'bad' }) }), setup.deps),
  );
  assertEquals(response.status, 400);
  assertEquals(setup.calls, []);
});

Deno.test('purge-deleted-base: supprime les objets connus et les objets orphelins, puis finalise', async () => {
  const setup = deps({
    prepare: {
      status: 'ready',
      code: 'PURGE_PREPARED',
      operation_id: OPERATION,
      base_id: BASE,
      manifest: { objects: [] },
      manifest_hash: HASH,
    },
  });
  const response = await readResponse(await handlePurgeDeletedBase(makeRequest({ body: body() }), setup.deps));
  assertEquals(response.status, 200);
  assertEquals(response.body.code, 'PURGED');
  const remove = setup.calls.find((call) => call.kind === 'storage' && call.method === 'remove');
  if (!remove || remove.kind !== 'storage') throw new Error('remove Storage absent');
  assertEquals(remove.bucket, 'raw-documents');
  assertEquals(remove.args[0], [PATH]);
  assert(setup.calls.some((call) => call.kind === 'rpc' && call.rpc === 'finalize_base_purge'));
});

Deno.test('purge-deleted-base: une panne Storage ne finalise jamais PostgreSQL', async () => {
  const setup = deps({ removeError: { message: 'internal storage detail' } });
  const response = await readResponse(await handlePurgeDeletedBase(makeRequest({ body: body() }), setup.deps));
  assertEquals(response.status, 503);
  assertEquals(response.body.code, 'STORAGE_DELETE_FAILED');
  assert(!setup.calls.some((call) => call.kind === 'rpc' && call.rpc === 'finalize_base_purge'));
  assertStringIncludes(response.text, 'Aucune donnée PostgreSQL');
  assert(!response.text.includes('internal storage detail'));
});

Deno.test('purge-deleted-base: le rejeu d une operation deja terminee est un succes idempotent', async () => {
  const setup = deps({
    prepare: { status: 'completed', code: 'ALREADY_PURGED', operation_id: OPERATION, base_id: BASE },
  });
  const response = await readResponse(await handlePurgeDeletedBase(makeRequest({ body: body() }), setup.deps));
  assertEquals(response.status, 200);
  assertEquals(response.body.code, 'ALREADY_PURGED');
  assert(!setup.calls.some((call) => call.kind === 'storage'));
});

Deno.test('purge-deleted-base: les refus metier sont structures et lisibles', async () => {
  const setup = deps({
    prepare: { status: 'rejected', code: 'OWNER_REQUIRED', operation_id: OPERATION, base_id: BASE },
  });
  const response = await readResponse(await handlePurgeDeletedBase(makeRequest({ body: body() }), setup.deps));
  assertEquals(response.status, 403);
  assertEquals(response.body.code, 'OWNER_REQUIRED');
  assertStringIncludes(String(response.body.error), 'propriétaire');
});
