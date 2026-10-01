import { assert, assertEquals } from '@std/assert';
import {
  type Candidate,
  conceptKey,
  decide,
  type DiagnosisInterpretation,
  isCovered,
  normalizeText,
  similarity,
  stems,
} from './scoring.ts';

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
  assertEquals(stems('Hématomes sous-duraux des méninges'), ['hemorragi', 'sousdural', 'mening']);
  // Le Œ majuscule ne se perd pas : « Œdème » = « oedème ».
  assertEquals(normalizeText('Œdème cérébral'), 'oedeme cerebral');
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

Deno.test('ambiguite signalee : un terme general sans correspondance n empeche pas le choix', () => {
  const decision = decide(
    item(['Cancer du poumon'], {
      ambiguous: true,
      alternativeTerms: [
        'Adénocarcinome des bronches ou du poumon',
        'Carcinome à petites cellules des bronches ou du poumon',
      ],
    }),
    candidates([
      ['FIC.25.0', 'Adénocarcinome des bronches ou du poumon'],
      ['FIC.25.1', 'Carcinome à petites cellules des bronches ou du poumon'],
    ]),
  );
  assertEquals(decision.status, 'ambiguous');
  assertEquals(decision.alternatives.map((c) => c.code), ['FIC.25.0', 'FIC.25.1']);
});

Deno.test('ex aequo : jamais de selection automatique', () => {
  // Deux concepts distincts du referentiel, meme mots dans un autre ordre.
  const decision = decide(
    item(['Hémorragie intracérébrale traumatique']),
    candidates([['FIC.A', 'Hémorragie intracérébrale traumatique'], [
      'FIC.B',
      'Hémorragie traumatique intracérébrale',
    ]]),
  );
  assertEquals(decision.status, 'ambiguous');
});

Deno.test('categories residuelles : « Autres X » et « X, sans precision » ne concurrencent pas X', () => {
  const decision = decide(
    item(['Œdème cérébral traumatique']),
    candidates([
      ['FIC.2Y', 'Autres œdème cérébral traumatique'],
      ['FIC.2', 'Œdème cérébral traumatique'],
      ['FIC.2Z', 'Œdème cérébral traumatique, sans précision'],
    ]),
  );
  assertEquals(decision.status, 'automatic');
  assertEquals(decision.best?.code, 'FIC.2');
  // Sans categorie principale, « sans precision » passe avant « Autres ».
  const unspecified = decide(
    item(['Céphalées']),
    candidates([['FIC.8Y', 'Autres céphalées'], ['FIC.8Z', 'Céphalées, sans précision']]),
  );
  assertEquals(unspecified.best?.code, 'FIC.8Z');
});

Deno.test('negation : « non traumatique » ne vaut jamais « traumatique »', () => {
  assert(similarity('Hémorragie extradurale traumatique', 'Hémorragie extradurale non traumatique') < 0.7);
  assertEquals(similarity('Anévrisme cérébral non rompu', 'Anévrisme cérébral non-rompu'), 1);
  // « spontané » se lit « non traumatique », la lateralite est ignoree.
  assertEquals(similarity('Hématome sous-dural spontané droit', 'Hémorragie sousdurale non traumatique'), 1);
});

Deno.test('precision entre parentheses facultative', () => {
  assertEquals(similarity("Fracture d'os temporal", "Fracture d'os temporal (de la base du crâne)"), 1);
});

Deno.test('correspondance insuffisante : non code', () => {
  const decision = decide(item(['Syndrome imaginaire de test']), candidates([['FIC.Z', 'Fracture du fémur']]));
  assertEquals(decision.status, 'unmatched');
  assertEquals(decision.best, null);
  assertEquals(decide(item(['Quoi que ce soit']), []).status, 'unmatched');
});

Deno.test('inference : un germe deduit par le LLM n est jamais pose sans confirmation', () => {
  const pfla = item(['Pneumonie due à Streptococcus pneumoniae', 'Pneumonie bactérienne'], {
    normalized: 'Pneumonie franche lobaire aiguë',
    source: 'Pneumonie franche lobaire aigue',
  });
  assertEquals(isCovered('Pneumonie due à Streptococcus pneumoniae', pfla), false);
  const decision = decide(
    pfla,
    candidates([['FIC.07', 'Pneumonie due à Streptococcus pneumoniae'], ['FIC.0', 'Pneumonie bactérienne']]),
  );
  assertEquals(decision.status, 'suggested');
  assertEquals(decision.best?.code, 'FIC.07');
});

Deno.test('couverture : abreviation developpee, synonymes et mots qui situent sans preciser', () => {
  const hsd = { normalized: 'Hématome sous-dural chronique spontané droit', source: 'HSD chronique spontané droit' };
  assert(isCovered('Hémorragie sousdurale non traumatique', hsd));
  assert(isCovered('Glioblastome du cerveau', { normalized: 'Glioblastome temporal gauche', source: 'GBM temporal' }));
  assert(isCovered("Fracture d'os temporal (de la base du crâne)", { normalized: "Fracture de l'os temporal" }));
  assertEquals(isCovered('Insuffisance rénale aigüe', { normalized: 'Insuffisance rénale' }), false);
  // Intitule disjonctif : un cote couvert suffit ; un mot porteur hors disjonction, non.
  assert(isCovered('Hémorragie sousdurale non traumatique du fœtus ou du nouveau-né', {
    normalized: 'Hématome sous-dural non traumatique du nouveau-né',
  }));
  assert(isCovered("Anévrisme ou dissection de l'artère carotide", { normalized: 'Anévrisme carotidien' }));
  assert(isCovered('Fracture de la première vertèbre cervicale', { normalized: "Fracture de l'atlas" }));
  assertEquals(isCovered('Hypertension essentielle', { normalized: 'Hypertension artérielle', source: 'HTA' }), false);
});

Deno.test('sigles : VIH et HIV rejoignent l intitule developpe, « sans mention de » est facultatif', () => {
  const label = "Maladie par le virus de l'immunodéficience humaine sans mention de tuberculose ni de paludisme";
  assertEquals(similarity('Maladie due au VIH', label), 1);
  assert(isCovered(label, { normalized: 'Infection par le VIH', source: 'terrain HIV' }));
  // « …, stade clinique non precise » est le meme concept que l'intitule principal.
  assertEquals(
    conceptKey(
      "Maladie due au virus de l'immunodéficience humaine sans mention de tuberculose ni de paludisme, stade clinique non précisé",
    ),
    conceptKey(label),
  );
});

Deno.test('precision : jamais de parent pose seul quand un code plus precis convient', () => {
  const sdh = candidates([
    ['FIC.6', 'Hémorragie sousdurale traumatique'],
    ['FIC.60', 'Hémorragie sousdurale traumatique aigüe'],
    ['FIC.61', 'Hémorragie sousdurale traumatique chronique'],
    ['FIC.6Z', 'Hémorragie sousdurale traumatique, sans précision'],
  ]);
  // Terme general place en tete par le LLM : « aigu » est ecrit, le parent le perdrait.
  const acute = decide(
    item(['Hémorragie sousdurale traumatique', 'Hémorragie sousdurale traumatique aigüe'], {
      normalized: 'Hématome sous-dural aigu post-traumatique',
      source: 'HSD aigu post-traumatique',
    }),
    sdh,
  );
  assertEquals(acute.status, 'suggested');
  assertEquals(acute.best?.code, 'FIC.60');
  assert(acute.alternatives.some((c) => c.code === 'FIC.6'));

  // Descendant plausible mais non ecrit (« due a une atteinte des disques ») : rien de seul.
  const radiculo = decide(
    item(['Radiculopathie due à une atteinte des disques intervertébraux', 'Radiculopathie'], {
      normalized: 'Radiculopathie L5 sur conflit discal',
      source: 'Radiculopathie L5 sur conflit discal',
    }),
    candidates([
      ['FIC.93', 'Radiculopathie'],
      ['FIC.936', 'Radiculopathie due à une atteinte des disques intervertébraux'],
      ['FIC.93Z', 'Radiculopathie, sans précision'],
    ]),
  );
  assert(radiculo.status !== 'automatic');

  // Meme sans terme de recherche precis : « conflit discal » ecrit suffit a ecarter le parent seul.
  const discal = decide(
    item(['Radiculopathie lombaire', 'Radiculopathie'], {
      normalized: 'Radiculopathie L5 sur conflit discal',
      source: 'Radiculopathie L5 sur conflit discal',
    }),
    candidates([
      ['FIC.93', 'Radiculopathie'],
      ['FIC.936', 'Radiculopathie due à une atteinte des disques intervertébraux'],
    ]),
  );
  assert(discal.status !== 'automatic');

  // Sans precision ecrite, le parent reste posable : seuls des descendants residuels ou
  // etrangers au texte existent.
  const plain = decide(
    item(['Hémorragie sousdurale traumatique'], { source: 'HSD traumatique' }),
    sdh,
  );
  assertEquals(plain.status, 'automatic');
  assertEquals(plain.best?.code, 'FIC.6');
});
