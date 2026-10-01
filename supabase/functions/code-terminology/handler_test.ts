import { assert, assertEquals } from '@std/assert';
import { type CodeTerminologyDeps, handleCodeTerminology } from './handler.ts';
import type { InterpretationService } from './interpret.ts';
import {
  captureLogs,
  type ClientCall,
  errorResult,
  fakeSupabaseClient,
  makeRequest,
  okResult,
  readResponse,
  type RpcCall,
} from '../_shared/testing.ts';

const ROWS = [
  { code: 'FIC.02', label: 'Hémorragie sousdurale non traumatique', uri: null, release_version: '2026-01', hits: 3 },
  {
    code: 'FIC.07',
    label: 'Hémorragie sousdurale non traumatique du fœtus ou du nouveau-né',
    uri: null,
    release_version: '2026-01',
    hits: 3,
  },
];

interface Opts {
  user?: boolean;
  rpcFails?: boolean;
  interpreter?: InterpretationService | null;
  calls?: ClientCall[];
}

function deps(opts: Opts = {}): CodeTerminologyDeps {
  return {
    interpreter: opts.interpreter === undefined ? null : opts.interpreter,
    buildClient: () =>
      fakeSupabaseClient({
        role: 'user',
        user: { data: { user: opts.user === false ? null : { id: 'user-1' } } },
        responder: (call) => {
          opts.calls?.push(call);
          return opts.rpcFails ? errorResult({ message: 'boom' }) : okResult(ROWS);
        },
      }),
  };
}

const llm = (fn: (text: string) => Promise<unknown>): InterpretationService => ({
  interpret: fn as InterpretationService['interpret'],
});

Deno.test('authentification et methode exigees', async () => {
  assertEquals((await handleCodeTerminology(makeRequest({ auth: null, body: { text: 'HSD' } }), deps())).status, 401);
  assertEquals((await handleCodeTerminology(makeRequest({ method: 'GET' }), deps())).status, 405);
  const anonymous = await handleCodeTerminology(makeRequest({ body: { text: 'HSD droit' } }), deps({ user: false }));
  assertEquals(anonymous.status, 401);
});

Deno.test('entree bornee', async () => {
  for (const body of [{}, { text: 'x' }, { text: 'a'.repeat(501) }, { text: 'HSD', language: 'de' }]) {
    assertEquals((await handleCodeTerminology(makeRequest({ body }), deps())).status, 400);
  }
});

Deno.test('LLM : seul le texte nettoye part, le referentiel decide', async () => {
  const sent: string[] = [];
  const calls: ClientCall[] = [];
  const res = await handleCodeTerminology(
    makeRequest({ body: { text: 'HSD chronique spontané droit, dossier 1234567' } }),
    deps({
      calls,
      interpreter: llm((text) => {
        sent.push(text);
        return Promise.resolve([{
          normalized: 'Hématome sous-dural chronique spontané droit',
          searchTerms: ['Hémorragie sousdurale non traumatique'],
          ambiguous: false,
          alternativeTerms: [],
        }]);
      }),
    }),
  );
  const { status, body } = await readResponse(res);
  assertEquals(status, 200);
  assertEquals(sent, ['HSD chronique spontané droit, dossier']);
  assertEquals(body.method, 'ai_assisted');
  assertEquals(body.release, '2026-01');
  const [first] = body.items as Array<Record<string, unknown>>;
  assertEquals(first.status, 'automatic');
  assertEquals((first.best as { code: string }).code, 'FIC.02');
  const rpc = calls.find((c): c is RpcCall => c.kind === 'rpc');
  assertEquals(rpc?.rpc, 'match_terminology_candidates');
});

Deno.test('panne du LLM : repli lexical, sans texte clinique dans les journaux', async () => {
  const { response, logs } = await captureLogs(() =>
    handleCodeTerminology(
      makeRequest({ body: { text: 'HSD chronique spontané droit' } }),
      deps({ interpreter: llm(() => Promise.reject(new Error('HSD chronique spontané droit: provider 529'))) }),
    )
  );
  const { status, body } = await readResponse(response);
  assertEquals(status, 200);
  assertEquals(body.method, 'lexical');
  assert(!logs.includes('HSD'));
  assert(!logs.includes('529'));
});

Deno.test('referentiel indisponible : refus structure, sans detail interne', async () => {
  const { response, logs } = await captureLogs(() =>
    handleCodeTerminology(makeRequest({ body: { text: 'Méningiome frontal' } }), deps({ rpcFails: true }))
  );
  const { status, body, text } = await readResponse(response);
  assertEquals(status, 503);
  assertEquals(body.code, 'CODING_UNAVAILABLE');
  assert(!text.includes('boom'));
  assert(!logs.includes('Méningiome'));
});
