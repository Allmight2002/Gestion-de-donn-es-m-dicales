import { assert, assertEquals } from '@std/assert';
import { fakeSupabaseClient, makeRequest, okResult, readResponse, type Responder } from '../_shared/testing.ts';
import { type FinalizeUploadDeps, handleFinalizeUpload } from './handler.ts';

const TICKET = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000002';
const BASE = '10000000-0000-4000-8000-000000000003';
const DOC = '10000000-0000-4000-8000-000000000004';
const bytes = new TextEncoder().encode('fichier fictif');
const hash = async (value: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer),
    ),
  ).map((b) => b.toString(16).padStart(2, '0')).join('');

interface Options {
  bucket?: string;
  path?: string;
  status?: string;
  expiresAt?: string;
  expectedHash?: string;
  expectedSize?: number;
  expectedMime?: string;
  downloads?: Array<Blob | null>;
  rollbackResult?: boolean;
  rollbackError?: boolean;
  onRpc?: (name: string) => void;
}

async function deps(options: Options = {}) {
  const expectedHash = options.expectedHash ?? await hash(bytes);
  const downloads = [
    ...(options.downloads ?? [
      new Blob([bytes], { type: 'application/pdf' }),
      new Blob([bytes], { type: 'application/pdf' }),
    ]),
  ];
  const userResponder: Responder = (call) =>
    call.kind === 'from' && call.table === 'upload_ticket'
      ? okResult({
        id: TICKET,
        owner_user_id: USER,
        base_id: BASE,
        bucket: options.bucket ?? 'raw-documents',
        path: options.path ?? `${BASE}/case/file.pdf`,
        status: options.status ?? 'pending',
        expires_at: options.expiresAt ?? '2099-01-01T00:00:00.000Z',
        file_hash: expectedHash,
        file_size: options.expectedSize ?? bytes.byteLength,
        mime_type: options.expectedMime ?? 'application/pdf',
      })
      : okResult(null);
  const adminResponder: Responder = (call) => {
    if (call.kind === 'storage' && call.method === 'download') {
      const blob = downloads.shift();
      return blob ? okResult(blob) : { data: null, error: { message: 'missing' } };
    }
    if (call.kind === 'rpc') options.onRpc?.(call.rpc);
    if (call.kind === 'rpc' && call.rpc === 'complete_verified_upload_operation') return okResult(DOC);
    if (call.kind === 'rpc' && call.rpc === 'rollback_verified_upload_operation') {
      return options.rollbackError
        ? { data: null, error: { message: 'rollback failed' } }
        : okResult(options.rollbackResult ?? true);
    }
    return okResult(null);
  };
  return {
    buildClients: () => ({
      asUser: fakeSupabaseClient({ role: 'user', user: { data: { user: { id: USER } } }, responder: userResponder }),
      admin: fakeSupabaseClient({ role: 'admin', responder: adminResponder }),
    }),
  } satisfies FinalizeUploadDeps;
}

const request = () =>
  makeRequest({
    body: { ticketId: TICKET, entity: 'raw_document', metadata: { submission_id: DOC, label: 'fictif' } },
  });

Deno.test('finalize-upload: objet exact present -> ligne creee', async () => {
  const result = await readResponse(await handleFinalizeUpload(request(), await deps()));
  assertEquals(result.status, 200);
  assertEquals(result.body.id, DOC);
});

Deno.test('finalize-upload: objet absent -> refus sans ligne metier', async () => {
  const result = await readResponse(await handleFinalizeUpload(request(), await deps({ downloads: [null] })));
  assertEquals(result.status, 409);
  assertEquals(result.body.error, 'Objet Storage absent');
});

Deno.test('finalize-upload: bucket, chemin, taille, hash, MIME et expiration incoherents -> refus', async () => {
  const cases: Options[] = [
    { bucket: 'clinical-attachments' },
    { path: `other/${DOC}.pdf` },
    { expectedSize: bytes.byteLength + 1 },
    { expectedHash: '0'.repeat(64) },
    { expectedMime: 'image/jpeg' },
    { expiresAt: '2000-01-01T00:00:00.000Z' },
  ];
  for (const options of cases) {
    const result = await readResponse(await handleFinalizeUpload(request(), await deps(options)));
    assertEquals(result.status, 409);
    assert(!result.text.includes(BASE));
  }
});

Deno.test('finalize-upload: suppression entre preuve et transaction -> compensation', async () => {
  const first = new Blob([bytes], { type: 'application/pdf' });
  const calls: string[] = [];
  const result = await readResponse(
    await handleFinalizeUpload(request(), await deps({ downloads: [first, null], onRpc: (name) => calls.push(name) })),
  );
  assertEquals(result.status, 409);
  assertEquals(result.body.error, 'Objet Storage disparu pendant la finalisation');
  assert(calls.includes('rollback_verified_upload_operation'));
});

Deno.test('finalize-upload: compensation refusee -> etat incertain explicite et non faux 409', async () => {
  for (const options of [{ rollbackResult: false }, { rollbackError: true }]) {
    const first = new Blob([bytes], { type: 'application/pdf' });
    const result = await readResponse(
      await handleFinalizeUpload(
        request(),
        await deps({ downloads: [first, null], ...options }),
      ),
    );
    assertEquals(result.status, 500);
    assertEquals(result.body.error, 'Finalisation incertaine : reconciliation serveur requise');
    assert(!result.text.includes('rollback failed'));
  }
});

Deno.test('finalize-upload: rejeu attached reverifie encore l objet', async () => {
  const result = await readResponse(await handleFinalizeUpload(request(), await deps({ status: 'attached' })));
  assertEquals(result.status, 200);
  assertEquals(result.body.id, DOC);
});
