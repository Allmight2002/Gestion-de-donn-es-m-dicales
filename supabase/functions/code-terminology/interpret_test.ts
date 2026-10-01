import { assertEquals, assertThrows } from '@std/assert';
import { lexicalInterpretation, parseInterpretation, scrubIdentifiers } from './interpret.ts';

Deno.test('nettoyage : identifiants retires, texte clinique conserve', () => {
  assertEquals(
    scrubIdentifiers('HSD chronique droit, dossier 123456789, tel 06 12 34 56 78, jean@exemple.test, le 12/03/2026'),
    'HSD chronique droit, dossier , tel , , le',
  );
  assertEquals(scrubIdentifiers('Fracture L1 avec compression médullaire'), 'Fracture L1 avec compression médullaire');
});

Deno.test('repli lexical : abreviation developpee et separateurs explicites', () => {
  const items = lexicalInterpretation('HSD chronique droit; méningiome frontal');
  assertEquals(items.length, 2);
  assertEquals(items[0].normalized, 'Hématome sous-dural chronique droit');
  assertEquals(items[0].searchTerms[0], 'Hémorragie sousdurale');
  assertEquals(items[1].searchTerms, ['méningiome frontal']);
});

Deno.test('sortie du LLM : bornee et validee', () => {
  const parsed = parseInterpretation({
    diagnoses: [
      {
        normalized: 'Hématome sous-dural chronique spontané droit',
        search_terms: ['Hémorragie sousdurale non traumatique', 'Hémorragie sousdurale non traumatique', 'x'],
        ambiguous: true,
        alternative_terms: ['seule'],
      },
      { normalized: '', search_terms: [], ambiguous: false, alternative_terms: [] },
    ],
  });
  assertEquals(parsed.length, 1);
  // Doublons et termes trop courts retires ; une ambiguite a une seule entite n'en est pas une.
  assertEquals(parsed[0].searchTerms, ['Hémorragie sousdurale non traumatique']);
  assertEquals(parsed[0].ambiguous, false);
  assertThrows(() => parseInterpretation({ autre: [] }));
});
