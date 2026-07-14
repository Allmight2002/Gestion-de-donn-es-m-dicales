import { assert, assertEquals } from '@std/assert';
import { handleInspectUpload, type InspectConfig, type InspectDeps, type ScanResult } from './handler.ts';
import {
  errorResult,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type Responder,
} from '../_shared/testing.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const BASE = '223e4567-e89b-42d3-a456-426614174000';
const PATH = `${BASE}/doc.pdf`;
const SERVICE_KEY = 'sb_secret_service_role_key_value';
const CLAMAV_TOKEN = 'clamav-secret-token-xyz';

const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], { type: 'application/pdf' });

const CONFIG: InspectConfig = {
  maxInspectBytes: 20 * 1024 * 1024,
  scanningStaleMs: 15 * 60 * 1000,
  maxInspectionAttempts: 5,
  inspectionRetryCooldownMs: 60000,
  quarantineBucket: 'quarantined-uploads',
};

interface State {
  doc?: Record<string, unknown> | null;
  lockRows?: unknown;
  download?: { data: unknown; error: unknown };
  completeResult?: unknown;
  recordMove?: { data: unknown; error: unknown };
  quarantineUpload?: { data: unknown; error: unknown };
  scan?: ScanResult;
  user?: { data: { user: { id: string } | null }; error?: unknown };
  throwBuild?: boolean;
  updates?: Array<Record<string, unknown>>;
}

function deps(state: State = {}): InspectDeps {
  const updates = state.updates ?? [];
  const userResponder: Responder = (call) =>
    call.kind === 'from' && call.table === 'raw_document'
      ? okResult(
        'doc' in state ? state.doc : {
          id: ID,
          base_id: BASE,
          storage_path: PATH,
          inspection_status: 'pending',
          inspection_attempt_count: 0,
          last_inspection_attempt_at: null,
        },
      )
      : okResult(null);
  const adminResponder: Responder = (call) => {
    if (call.kind === 'rpc') {
      if (call.rpc === 'complete_file_inspection') return okResult(state.completeResult ?? true);
      if (call.rpc === 'record_quarantine_move') return state.recordMove ?? okResult('move-1');
      if (call.rpc === 'update_quarantine_move') return okResult(null);
      return okResult(null);
    }
    if (call.kind === 'storage') {
      if (call.method === 'download') return state.download ?? okResult(PDF);
      if (call.method === 'upload') return state.quarantineUpload ?? okResult({ path: 'q' });
      return okResult([{}]); // remove
    }
    if (call.kind === 'from' && call.table === 'raw_document') {
      const isUpdate = call.ops.some((o) => o.m === 'update');
      if (isUpdate) {
        const payload = call.ops.find((o) => o.m === 'update')?.a[0] as Record<string, unknown>;
        updates.push(payload);
        const hasSelect = call.ops.some((o) => o.m === 'select');
        return hasSelect ? okResult(state.lockRows ?? [{ id: ID }]) : okResult(null);
      }
      return okResult({ inspected_at: null }); // lecture "scanning stale"
    }
    return okResult(null);
  };
  const asUser = fakeSupabaseClient({
    role: 'user',
    user: state.user ?? { data: { user: { id: 'u1' } } },
    responder: userResponder,
  });
  const admin = fakeSupabaseClient({ role: 'admin', responder: adminResponder });
  return {
    buildClients: () => {
      if (state.throwBuild) throw new Error(`Configuration serveur manquante: ${SERVICE_KEY}`);
      return { asUser, admin };
    },
    config: CONFIG,
    scan: () => Promise.resolve(state.scan ?? { ok: true, infected: false }),
    newId: () => 'run-1',
    now: () => 1_700_000_000_000,
    nowIso: () => '2026-07-12T00:00:00.000Z',
  };
}

const req = (over = {}) => makeRequest({ body: { entity: 'raw_document', id: ID }, ...over });

Deno.test('inspect-upload: methode interdite -> 405', async () => {
  assertEquals((await readResponse(await handleInspectUpload(makeRequest({ method: 'GET' }), deps()))).status, 405);
});

Deno.test('inspect-upload: payload invalide -> 400', async () => {
  assertEquals(
    (await readResponse(await handleInspectUpload(makeRequest({ body: { entity: 'export', id: ID } }), deps()))).status,
    400,
  );
});

Deno.test('inspect-upload: non authentifie -> 401', async () => {
  assertEquals(
    (await readResponse(await handleInspectUpload(req(), deps({ user: { data: { user: null } } })))).status,
    401,
  );
});

Deno.test('inspect-upload: config indisponible -> 500', async () => {
  const { status, text } = await readResponse(await handleInspectUpload(req(), deps({ throwBuild: true })));
  assertEquals(status, 500);
  assert(!text.includes(SERVICE_KEY));
});

Deno.test('inspect-upload: document inaccessible -> 403', async () => {
  assertEquals((await readResponse(await handleInspectUpload(req(), deps({ doc: null })))).status, 403);
});

Deno.test('inspect-upload: verdict deja accepted -> 200 (aucun re-scan)', async () => {
  const state = deps({
    doc: { id: ID, base_id: BASE, storage_path: PATH, inspection_status: 'accepted', inspection_attempt_count: 0 },
  });
  const { status, body } = await readResponse(await handleInspectUpload(req(), state));
  assertEquals(status, 200);
  assertEquals(body.status, 'accepted');
});

Deno.test('inspect-upload: verdict deja quarantined -> 409', async () => {
  const state = deps({
    doc: { id: ID, base_id: BASE, storage_path: PATH, inspection_status: 'quarantined', inspection_attempt_count: 0 },
  });
  assertEquals((await readResponse(await handleInspectUpload(req(), state))).status, 409);
});

Deno.test('inspect-upload: appel concurrent (verrou non acquis) -> 409', async () => {
  assertEquals((await readResponse(await handleInspectUpload(req(), deps({ lockRows: [] })))).status, 409);
});

Deno.test('inspect-upload: acquisition du verrou pose scanning + inspection_run_id', async () => {
  const updates: Array<Record<string, unknown>> = [];
  await handleInspectUpload(req(), deps({ updates }));
  const lock = updates.find((u) => u.inspection_status === 'scanning');
  assert(lock, 'un update de verrou scanning doit etre emis');
  assertEquals(lock!.inspection_run_id, 'run-1');
});

Deno.test('inspect-upload: fichier sain -> 200 accepted', async () => {
  const { status, body } = await readResponse(
    await handleInspectUpload(req(), deps({ scan: { ok: true, infected: false } })),
  );
  assertEquals(status, 200);
  assertEquals(body.status, 'accepted');
});

Deno.test('inspect-upload: fichier infecte -> 409 quarantined', async () => {
  const { status, body } = await readResponse(
    await handleInspectUpload(req(), deps({ scan: { ok: true, infected: true, signature: 'Eicar-Test' } })),
  );
  assertEquals(status, 409);
  assertEquals(body.status, 'quarantined');
  assertEquals(body.signature, 'Eicar-Test');
});

Deno.test('inspect-upload: timeout scanner -> 503 + remise en etat coherent', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const { status } = await readResponse(
    await handleInspectUpload(req(), deps({ scan: { ok: false, error: 'Scanner en timeout' }, updates })),
  );
  assertEquals(status, 503);
  // La ligne est remise a un statut non-terminal (pending) : reinspection possible.
  assert(updates.some((u) => u.inspection_status === 'pending'), 'reset vers pending attendu');
});

Deno.test('inspect-upload: erreur 5xx scanner -> 503', async () => {
  const { status } = await readResponse(
    await handleInspectUpload(req(), deps({ scan: { ok: false, error: 'Scanner indisponible (503)' } })),
  );
  assertEquals(status, 503);
});

Deno.test('inspect-upload: echec de deplacement en quarantaine -> 500', async () => {
  const state = deps({
    scan: { ok: true, infected: true, signature: 'X' },
    quarantineUpload: errorResult({ message: 'copy failed' }),
  });
  const { status, body } = await readResponse(await handleInspectUpload(req(), state));
  assertEquals(status, 500);
  assertEquals(body.error, 'Mise en quarantaine impossible');
});

Deno.test('inspect-upload: telechargement impossible -> 500', async () => {
  const state = deps({ download: errorResult({ message: 'not found' }) });
  const { status } = await readResponse(await handleInspectUpload(req(), state));
  assertEquals(status, 500);
});

Deno.test('inspect-upload: aucune fuite de secret dans la reponse saine ni infectee', async () => {
  for (
    const scan of [
      { ok: true, infected: false } as ScanResult,
      { ok: true, infected: true, signature: 'S' } as ScanResult,
    ]
  ) {
    const { text } = await readResponse(await handleInspectUpload(req(), deps({ scan })));
    assert(!text.includes(SERVICE_KEY));
    assert(!text.includes(CLAMAV_TOKEN));
  }
});
