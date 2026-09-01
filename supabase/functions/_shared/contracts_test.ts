import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  parseEntityId,
  parseExportRequest,
  parseReconcileRequest,
  readJsonObject,
  RequestValidationError,
  validationResponse,
} from './contracts.ts';

Deno.test('HTTP contract rejects wrong content type, malformed and oversized payloads', async () => {
  await assertRejects(
    () => readJsonObject(new Request('http://local', { method: 'POST', body: '{}' })),
    RequestValidationError,
  );
  await assertRejects(
    () =>
      readJsonObject(
        new Request('http://local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }),
      ),
    RequestValidationError,
  );
  await assertRejects(
    () =>
      readJsonObject(
        new Request('http://local', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: 'x'.repeat(17_000) }),
        }),
      ),
    RequestValidationError,
  );
});

Deno.test('validation responses expose their safe message to browser callers', async () => {
  const response = validationResponse(new RequestValidationError(400, 'Identifiant invalide'));

  assertEquals(response.status, 400);
  assertEquals(response.headers.get('access-control-allow-origin'), '*');
  assertEquals(
    response.headers.get('access-control-allow-headers'),
    'authorization, x-client-info, apikey, content-type',
  );
  assertEquals(await response.json(), { error: 'Identifiant invalide' });
});

Deno.test('generate-export accepts stable defaults and rejects identifiers/enums', () => {
  const cohortId = '123e4567-e89b-42d3-a456-426614174000';
  // Un appel sans profil (ancien appel) produit Analyse, le profil par defaut (L45).
  assertEquals(parseExportRequest({ cohortId }), {
    cohortId,
    format: 'csv',
    options: { mode: 'encounter', rule: 'last', scope: 'matching', profile: 'analysis' },
  });
  assertThrows(() => parseExportRequest({ cohortId: 'not-an-id' }), RequestValidationError);
  assertThrows(() => parseExportRequest({ cohortId, format: 'pdf' }), RequestValidationError);
});

Deno.test('generate-export accepts both explicit profiles and refuses an unknown one (L45)', () => {
  const cohortId = '123e4567-e89b-42d3-a456-426614174000';
  assertEquals(parseExportRequest({ cohortId, options: { profile: 'analysis' } }).options.profile, 'analysis');
  assertEquals(parseExportRequest({ cohortId, options: { profile: 'complete' } }).options.profile, 'complete');
  assertEquals(
    parseExportRequest({ cohortId, options: { profile: 'complete', mode: 'patient' } }).options,
    { mode: 'patient', rule: 'last', scope: 'matching', profile: 'complete' },
  );
  assertThrows(() => parseExportRequest({ cohortId, options: { profile: 'cible' } }), RequestValidationError);
});

Deno.test('inspect-upload and signed-read require supported entity and UUID', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assertEquals(parseEntityId({ entity: 'attachment', id }, ['attachment', 'raw_document']), {
    entity: 'attachment',
    id,
  });
  assertThrows(
    () => parseEntityId({ entity: 'export', id }, ['attachment', 'raw_document']),
    RequestValidationError,
  );
  assertThrows(
    () => parseEntityId({ entity: 'export', id: '../secret' }, ['attachment', 'raw_document', 'export']),
    RequestValidationError,
  );
});

Deno.test('reconcile-quarantine validates bounded integer volume', () => {
  assertEquals(parseReconcileRequest({}), { limit: 25 });
  assertEquals(parseReconcileRequest({ limit: 100 }), { limit: 100 });
  assertThrows(() => parseReconcileRequest({ limit: 101 }), RequestValidationError);
  assertThrows(() => parseReconcileRequest({ limit: 1.5 }), RequestValidationError);
});
