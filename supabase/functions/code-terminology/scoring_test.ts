import { assert, assertEquals } from '@std/assert';
import { type Candidate, decide, type DiagnosisInterpretation, normalizeText, similarity, stems } from './scoring.ts';

// Libelles fictifs calques sur la forme des intitules CIM-11 francais.
const candidates = (labels: Array<[string, string]>): Candidate[] =>
  labels.map(([code, label], rank) => ({ code, label, uri: null, rank }));

const item = (searchTerms: string[], extra: Partial<DiagnosisInterpretation> = {}): DiagnosisInterpretation => ({
  normalized: searchTerms[0],
  searchTerms,
  ambiguous: false,
  alternativeTerms: [],
  ...extra,
});

Deno.test('normalisation : accents, tirets et ponctuation', () => {
  assertEquals(normalizeText('Hémorragie sous-durale, non traumatique'), 'hemorragie sousdurale non traumatique');
  assertEquals(stems('Hématomes sous-duraux des méninges'), ['hematom', 'sousduraux', 'mening']);
});

Deno.test('similarite : equivalence, inclusion et absence de mot commun', () => {
  assertEquals(similarity('Hémorragie sousdurale non traumatique', 'Hémorragie sous-durale non traumatique'), 1);
  const partial = similarity(
    'Hémorragie sousdurale non traumatique',
    'Hémorragie sousdurale non traumatique du foetus',
  );
  assert(partial > 0.7 && partial < 1);
  assertEquals(similarity('Méningiome', 'Fracture du fémur'), 0);
});

Deno.test('correspondance claire : selection automatique', () => {
  const decision = decide(
    item(['Hémorragie sousdurale non traumatique', 'Hématome sous-dural']),
    candidates([
      ['FIC.02', 'Hémorragie sousdurale non traumatique'],
      ['FIC.07', 'Hémorragie sousdurale non traumatique du fœtus ou du nouveau-né'],
      ['FIC.40', 'Hémorragie sousdurale due à un traumatisme obstétrical'],
    ]),
  );
  assertEquals(decision.status, 'automatic');
  assertEquals(decision.best?.code, 'FIC.02');
  assertEquals(decision.score, 1);
});

Deno.test('terme general de la classification : selection automatique', () => {
  const decision = decide(
    item(['Méningiome frontal', 'Méningiome']),
    candidates([['FIC.10', 'Méningiomes'], ['FIC.11', 'Méningiome malin primitif']]),
  );
  assertEquals(decision.status, 'automatic');
  assertEquals(decision.best?.code, 'FIC.10');
});

Deno.test('correspondance intermediaire : proposition a confirmer', () => {
  const decision = decide(
    item(['Méningiome frontal']),
    candidates([['FIC.10', 'Méningiomes'], ['FIC.11', 'Méningiome malin primitif']]),
  );
  assertEquals(decision.status, 'suggested');
  assertEquals(decision.best?.code, 'FIC.10');
});

Deno.test('ambiguite signalee : une proposition par entite, aucun choix impose', () => {
  const decision = decide(
    item(['Hémorragie intracrânienne non traumatique'], {
      ambiguous: true,
      alternativeTerms: [
        'Hémorragie intracérébrale',
        'Hémorragie sous-arachnoïdienne',
        'Hémorragie sousdurale non traumatique',
      ],
    }),
    candidates([
      ['FIC.00', 'Hémorragie intracérébrale'],
      ['FIC.01', 'Hémorragie sous-arachnoïdienne'],
      ['FIC.02', 'Hémorragie sousdurale non traumatique'],
    ]),
  );
  assertEquals(decision.status, 'ambiguous');
  assertEquals(decision.alternatives.map((c) => c.code), ['FIC.00', 'FIC.01', 'FIC.02']);
});

Deno.test('ex aequo : jamais de selection automatique', () => {
  const decision = decide(
    item(['Fracture os temporal']),
    candidates([['FIC.A', "Fracture d'os temporal"], ['FIC.B', 'Fracture os temporal']]),
  );
  assertEquals(decision.status, 'ambiguous');
});

Deno.test('correspondance insuffisante : non code', () => {
  const decision = decide(item(['Syndrome imaginaire de test']), candidates([['FIC.Z', 'Fracture du fémur']]));
  assertEquals(decision.status, 'unmatched');
  assertEquals(decision.best, null);
  assertEquals(decide(item(['Quoi que ce soit']), []).status, 'unmatched');
});
