import { assert, assertEquals } from '@std/assert';
import { handleSignedRead, type SignedReadDeps } from './handler.ts';
import {
  assertNoSecret,
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

interface Opts {
  user?: { data: { user: { id: string } | null }; error?: unknown };
  userResponder?: Responder;
  adminResponder?: Responder;
  requireInspection?: boolean;
  throwBuild?: boolean;
}

function deps(opts: Opts = {}): SignedReadDeps {
  const asUser = fakeSupabaseClient({
    role: 'user',
    user: opts.user ?? { data: { user: { id: 'user-1' } } },
    responder: opts.userResponder,
  });
  const admin = fakeSupabaseClient({ role: 'admin', responder: opts.adminResponder });
  return {
    buildClients: () => {
      if (opts.throwBuild) throw new Error(`Configuration serveur manquante: ${SERVICE_KEY}`);
      return { asUser, admin };
    },
    requireInspection: () => opts.requireInspection ?? false,
  };
}

const rawDoc = (status: string, path = PATH): Responder => (call) =>
  call.kind === 'from' && call.table === 'raw_document'
    ? okResult({ id: ID, base_id: BASE, storage_path: path, inspection_status: status })
    : okResult(null);

const adminSignsOk: Responder = (call) => {
  if (call.kind === 'from' && call.table === 'audit_log') return okResult(null);
  if (call.kind === 'storage' && call.method === 'createSignedUrl') {
    return okResult({ signedUrl: 'https://signed/url' });
  }
  return okResult(null);
};

Deno.test('signed-read: methode interdite -> 405', async () => {
  const { status } = await readResponse(await handleSignedRead(makeRequest({ method: 'GET' }), deps()));
  assertEquals(status, 405);
});

Deno.test('signed-read: JWT absent -> 401', async () => {
  const { status } = await readResponse(
    await handleSignedRead(makeRequest({ auth: null, body: { entity: 'raw_document', id: ID } }), deps()),
  );
  assertEquals(status, 401);
});

Deno.test('signed-read: JWT invalide (session vide) -> 401', async () => {
  const d = deps({ user: { data: { user: null } } });
  const { status, body } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 401);
  assertEquals(body.error, 'Session invalide');
});

Deno.test('signed-read: payload invalide -> 400', async () => {
  const { status } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'bogus', id: ID } }), deps()),
  );
  assertEquals(status, 400);
});

Deno.test('signed-read: config indisponible -> 500', async () => {
  const { status, text } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), deps({ throwBuild: true })),
  );
  assertEquals(status, 500);
  assertNoSecret(text, [SERVICE_KEY]); // l'erreur de config ne fuite pas la valeur manquante
});

Deno.test('signed-read: ressource inexistante / RLS masque -> 403', async () => {
  const d = deps({ userResponder: () => okResult(null) });
  const { status, body } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 403);
  assertEquals(body.error, 'Acces refuse');
});

Deno.test('signed-read: inspection pending -> 409', async () => {
  const d = deps({ userResponder: rawDoc('pending'), adminResponder: adminSignsOk });
  const { status } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 409);
});

Deno.test('signed-read: inspection quarantined -> 409', async () => {
  const d = deps({ userResponder: rawDoc('quarantined'), adminResponder: adminSignsOk });
  const { status, body } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 409);
  assert(String(body.error).includes('quarantaine'));
});

Deno.test('signed-read: require_server_inspection refuse accepted_client -> 409', async () => {
  const d = deps({ userResponder: rawDoc('accepted_client'), adminResponder: adminSignsOk, requireInspection: true });
  const { status } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 409);
});

Deno.test('signed-read: chemin hors base -> 409 incoherent', async () => {
  const d = deps({ userResponder: rawDoc('accepted', 'AUTRE-BASE/doc.pdf'), adminResponder: adminSignsOk });
  const { status, body } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 409);
  assert(String(body.error).includes('incoherent'));
});

Deno.test('signed-read: export sans permission -> 403', async () => {
  const userResponder: Responder = (call) => {
    if (call.kind === 'from' && call.table === 'export_log') {
      return okResult({ id: ID, base_id: BASE, stored_file_path: PATH });
    }
    if (call.kind === 'rpc' && call.rpc === 'can_export_data') return okResult(false);
    return okResult(null);
  };
  const adminResponder: Responder = () => okResult(null);
  const { status, body } = await readResponse(
    await handleSignedRead(
      makeRequest({ body: { entity: 'export', id: ID } }),
      deps({ userResponder, adminResponder }),
    ),
  );
  assertEquals(status, 403);
  assertEquals(body.error, 'Acces refuse');
});

Deno.test('signed-read: export signe avec le nom lisible journalise', async () => {
  const filename = 'meddata_base-cohorte_patients_2026-07-28_06-15-09Z.csv';
  let signedOptions: unknown;
  const userResponder: Responder = (call) => {
    if (call.kind === 'from' && call.table === 'export_log') {
      return okResult({
        id: ID,
        base_id: BASE,
        stored_file_path: PATH,
        export_options: { download_filename: filename },
      });
    }
    if (call.kind === 'rpc' && call.rpc === 'can_export_data') return okResult(true);
    return okResult(null);
  };
  const adminResponder: Responder = (call) => {
    if (call.kind === 'from' && call.table === 'audit_log') return okResult(null);
    if (call.kind === 'storage' && call.method === 'createSignedUrl') {
      signedOptions = call.args[2];
      return okResult({ signedUrl: 'https://signed/url' });
    }
    return okResult(null);
  };
  const { status } = await readResponse(
    await handleSignedRead(
      makeRequest({ body: { entity: 'export', id: ID } }),
      deps({ userResponder, adminResponder }),
    ),
  );
  assertEquals(status, 200);
  assertEquals(signedOptions, { download: filename });
});

Deno.test('signed-read: journalisation echoue -> 500 (pas de signature sans trace)', async () => {
  const adminResponder: Responder = (call) => {
    if (call.kind === 'from' && call.table === 'audit_log') return errorResult({ message: 'db down' });
    if (call.kind === 'storage' && call.method === 'createSignedUrl') {
      return okResult({ signedUrl: 'https://signed/url' });
    }
    return okResult(null);
  };
  const d = deps({ userResponder: rawDoc('accepted'), adminResponder });
  const { status, text } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 500);
  assertNoSecret(text, ['db down']); // le message d'erreur DB interne ne fuite pas
});

Deno.test('signed-read: succes -> 200 avec URL signee', async () => {
  const d = deps({ userResponder: rawDoc('accepted'), adminResponder: adminSignsOk });
  const { status, body, text } = await readResponse(
    await handleSignedRead(makeRequest({ body: { entity: 'raw_document', id: ID } }), d),
  );
  assertEquals(status, 200);
  assertEquals(body.url, 'https://signed/url');
  assertNoSecret(text, [SERVICE_KEY]);
});
