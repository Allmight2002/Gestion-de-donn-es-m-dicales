import { assertEquals, assertRejects } from '@std/assert';
import { openAICompatibleInterpretation } from './openaiCompatible.ts';

// Reponses simulees : aucun appel reseau, diagnostics fictifs.
const VALID = {
  diagnoses: [{
    normalized: 'Hématome sous-dural chronique spontané droit',
    search_terms: ['Hémorragie sousdurale non traumatique'],
    ambiguous: false,
    alternative_terms: [],
  }],
};

function completion(content: string | null, extra: Record<string, unknown> = {}) {
  return { choices: [{ finish_reason: 'stop', message: { content, refusal: null }, ...extra }] };
}

function fakeFetch(respond: () => Response) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const service = (impl: typeof fetch, jsonMode: 'json_schema' | 'json_object' = 'json_schema') =>
  openAICompatibleInterpretation({
    apiKey: 'cle-fictive',
    baseUrl: 'https://llm.example.test/v1/',
    model: 'modele-test',
    jsonMode,
    fetch: impl,
  });

Deno.test('compatible OpenAI : schema strict, seul le texte du diagnostic est envoye', async () => {
  const { calls, impl } = fakeFetch(() => json(completion(JSON.stringify(VALID))));
  const items = await service(impl).interpret('HSD chronique spontané droit');

  assertEquals(items[0].searchTerms, ['Hémorragie sousdurale non traumatique']);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://llm.example.test/v1/chat/completions');
  assertEquals((calls[0].init.headers as Record<string, string>).authorization, 'Bearer cle-fictive');
  const body = calls[0].body as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { type: string; json_schema: { strict: boolean } };
  };
  assertEquals(body.model, 'modele-test');
  assertEquals(body.response_format.type, 'json_schema');
  assertEquals(body.response_format.json_schema.strict, true);
  assertEquals(body.messages.map((m) => m.role), ['system', 'user']);
  assertEquals(body.messages[1].content, '<diagnostic>\nHSD chronique spontané droit\n</diagnostic>');
});

Deno.test('mode json_object (DeepSeek) : la forme JSON attendue est decrite dans le prompt', async () => {
  const { calls, impl } = fakeFetch(() => json(completion(JSON.stringify(VALID))));
  await service(impl, 'json_object').interpret('HSD droit');
  const body = calls[0].body as { response_format: unknown; max_tokens: number; messages: Array<{ content: string }> };
  assertEquals(body.response_format, { type: 'json_object' });
  assertEquals(body.max_tokens, 2048);
  assertEquals(body.messages[0].content.includes('JSON'), true);
});

Deno.test('compatible OpenAI : toute reponse inexploitable leve (repli lexical en amont)', async () => {
  const cases: Array<[string, () => Response]> = [
    ['erreur HTTP', () => json({ error: { message: 'detail interne' } }, 429)],
    ['JSON mal forme', () => json(completion('{"diagnoses": ['))],
    ['mauvais schema', () => json(completion(JSON.stringify({ autre: [] })))],
    ['contenu vide', () => json(completion(''))],
    ['refus', () => json(completion(null, { message: { content: null, refusal: 'non' } }))],
    ['tronque', () => json(completion(JSON.stringify(VALID), { finish_reason: 'length' }))],
    ['filtre', () => json(completion(JSON.stringify(VALID), { finish_reason: 'content_filter' }))],
    ['aucun choix', () => json({ choices: [] })],
  ];
  for (const [label, respond] of cases) {
    await assertRejects(() => service(fakeFetch(respond).impl).interpret('HSD droit'), Error, undefined, label);
  }
  const down = (() => Promise.reject(new TypeError('reseau'))) as unknown as typeof fetch;
  await assertRejects(() => service(down).interpret('HSD droit'));
});

Deno.test("compatible OpenAI : le message d'erreur ne reprend ni la reponse ni le texte", async () => {
  const error = await assertRejects(
    () =>
      service(fakeFetch(() => json({ error: { message: 'HSD droit cle-fictive' } }, 400)).impl).interpret('HSD droit'),
  );
  assertEquals((error as Error).message, 'interpretation indisponible (400)');
});
