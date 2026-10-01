// Score de confiance du codage terminologique assiste.
//
// Le LLM n'est PAS la source de verite : il propose des termes cliniques, le referentiel
// fournit les concepts, et la confiance est calculee ICI, de facon deterministe, a partir :
//   * de la similarite lexicale entre le terme et le libelle officiel ;
//   * de l'accord entre le terme PREFERE de l'interpretation et le meilleur concept ;
//   * de l'ecart entre le premier et le deuxieme concept ;
//   * du rang de pre-tri renvoye par la base (departage les ex aequo) ;
//   * du signal d'ambiguite de l'interpretation (information manquante pour trancher).
// Aucun score invente par le LLM n'entre dans la decision.

/** Interpretation d'un diagnostic : termes de recherche, du plus specifique au plus general. */
export interface DiagnosisInterpretation {
  normalized: string;
  searchTerms: string[];
  /** L'interpretation signale plusieurs entites plausibles qu'elle ne peut pas departager. */
  ambiguous: boolean;
  /** Entites distinctes a proposer au choix quand `ambiguous`. */
  alternativeTerms: string[];
  /**
   * Texte ecrit par le medecin, tel que transmis au codage. Il ne vient JAMAIS du LLM : avec
   * `normalized`, il borne ce qu'un libelle peut affirmer pour etre retenu sans confirmation.
   */
  source?: string;
}

export interface Candidate {
  code: string;
  label: string;
  uri: string | null;
  /** Rang de pre-tri renvoye par la base (0 = premier). */
  rank: number;
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

export type MatchStatus = 'automatic' | 'suggested' | 'ambiguous' | 'unmatched';

export interface MatchDecision {
  status: MatchStatus;
  /** Confiance retenue, entre 0 et 1, arrondie au centieme. */
  score: number;
  best: ScoredCandidate | null;
  /** Propositions a soumettre au choix (ambiguous), ou alternatives a une suggestion. */
  alternatives: ScoredCandidate[];
}

/**
 * Seuils CALIBRES le 2026-10-01 sur 72 diagnostics fictifs annotes, contre le referentiel
 * versionne, dans deux scenarios (LLM simule, repli lexical) : aucune erreur critique, y
 * compris pour le voisin plus permissif, puis utilite maximale. Mesures, methode et limites :
 * docs/calibration-codage-terminologique-2026-10-01.md. Garde : test/terminology-calibration.test.ts.
 */
export const THRESHOLDS: Thresholds = {
  automatic: 0.95,
  automaticGap: 0.05,
  suggested: 0.65,
  plausible: 0.55,
  maxAlternatives: 4,
};

const STOPWORDS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'un',
  'une',
  'et',
  'ou',
  'au',
  'aux',
  'en',
  'a',
  'd',
  'l',
  'par',
  'sur',
  'avec',
  'sans',
  'dans',
  'pour',
  'autre',
  'autres',
  'precision',
  'precise',
  'precisee',
  'sai',
  'type',
  'due',
  'dus',
  'dues',
  // La lateralite n'apparait pas dans les intitules : la garder ferait baisser le rappel.
  'droit',
  'droite',
  'gauche',
  'bilateral',
  'bilaterale',
  'bilateraux',
]);

/**
 * Equivalences cliniques ramenees au vocabulaire des intitules de la classification. Liste
 * courte et generale : ce sont des conventions de redaction, pas un dictionnaire medical.
 */
const SYNONYMS: Record<string, string[]> = {
  hematome: ['hemorragie'],
  hematomes: ['hemorragie'],
  spontane: ['non', 'traumatique'],
  spontanee: ['non', 'traumatique'],
  posttraumatique: ['traumatique'],
  epidural: ['extradural'],
  epidurale: ['extradural'],
  atriale: ['auriculaire'],
  atrial: ['auriculaire'],
  // Vertebres nommees comme dans les intitules.
  atlas: ['premiere', 'vertebre', 'cervicale'],
  axis: ['deuxieme', 'vertebre', 'cervicale'],
  c1: ['premiere', 'vertebre', 'cervicale'],
  c2: ['deuxieme', 'vertebre', 'cervicale'],
  etage: ['fosse'],
  // Adjectif clinique ramene au nom des intitules (« conflit discal » -> « … des disques »).
  discal: ['disque'],
  discale: ['disque'],
  discaux: ['disque'],
  discales: ['disque'],
  // Sigle francais et anglais, developpe comme dans les intitules.
  vih: ['virus', 'immunodeficience', 'humaine'],
  hiv: ['virus', 'immunodeficience', 'humaine'],
};

/**
 * Rang de categorie : 0 principale, 1 « …, sans precision » (rien de plus n'est dit), 2
 * « Autres … » (une precision existe mais n'est pas listee). Sans precision dans le texte, la
 * categorie non precisee est la bonne ; « Autres » ne l'est jamais par defaut.
 */
export function residualRank(label: string): number {
  const text = normalizeText(label);
  if (/\bautres?\b/.test(text)) return 2;
  if (/\b(sans precis\w*|non precise\w*)\b/.test(text)) return 1;
  return 0;
}

/** Minuscules, accents retires, tirets fusionnes (« sous-dural » = « sousdural »). */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stemOf(word: string): string {
  // Pluriels en -aux (« sous-duraux ») ramenes a -al avant le retrait des finales.
  const singular = word.length > 5 ? word.replace(/aux$/, 'al') : word;
  return singular.length > 4 ? singular.replace(/(es|e|s)$/, '') : singular;
}

/**
 * Racines significatives : synonymes ramenes au vocabulaire des intitules, pluriel et feminin
 * retires, mots vides ecartes. La NEGATION est soudee au mot qu'elle porte : « non
 * traumatique » donne `nontraumatiqu`, qui ne se confond jamais avec `traumatiqu`.
 */
export function stems(text: string): string[] {
  const words = normalizeText(text).split(' ').flatMap((w) => SYNONYMS[w] ?? [w]);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word || STOPWORDS.has(word)) continue;
    // « non precise » est une mention residuelle, pas une negation qui porte : les deux mots
    // tombent comme « sans precision ».
    if (word === 'non' && STOPWORDS.has(words[i + 1] ?? '')) {
      i++;
      continue;
    }
    let stem = stemOf(word);
    if (word === 'non' && words[i + 1]) stem = `non${stemOf(words[++i])}`;
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

/** Cle d'un concept hors marqueurs residuels : « Meningiomes, sans precision » = « Meningiomes ». */
export const conceptKey = (label: string) => stems(coreLabel(label)).join(' ');

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  // Prefixe commun suffisamment long : « traumatiqu » / « traumatism » ne se confondent pas,
  // « hemorragi » / « hemorragiqu » si.
  return Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a));
}

function f1(q: string[], l: string[]): number {
  if (q.length === 0 || l.length === 0) return 0;
  const recall = q.filter((t) => l.some((s) => sameStem(t, s))).length / q.length;
  const precision = l.filter((s) => q.some((t) => sameStem(t, s))).length / l.length;
  return recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
}

/**
 * Similarite F1 entre racines : 1 pour des libelles equivalents, 0 sans mot commun. Une
 * precision entre parentheses dans l'intitule (« (de la base du crane) ») est facultative :
 * le meilleur des deux calculs est retenu.
 */
export function similarity(term: string, label: string): number {
  if (normalizeText(term) === normalizeText(label)) return 1;
  const q = stems(term);
  const core = coreLabel(label);
  return Math.max(f1(q, stems(label)), core === label ? 0 : f1(q, stems(core)));
}

/**
 * Partie de l'intitule qui AFFIRME quelque chose. Sont facultatives : une precision entre
 * parentheses (« (de la base du crane) ») et une clause « sans mention de … », qui dit
 * seulement ce que le texte ne mentionne pas (« … sans mention de tuberculose ni de
 * paludisme »).
 */
export function coreLabel(label: string): string {
  return label.replace(/\([^)]*\)/g, ' ').replace(/,?\s+sans mention d.*$/i, ' ');
}

/**
 * Mots d'intitule qui situent sans rien preciser : « Glioblastome du cerveau » n'affirme rien
 * de plus que « glioblastome ». Liste courte, mesuree au calibrage ; un mot qui designe un
 * germe, un stade, une cause ou une localisation fine n'y figure jamais.
 */
const IMPLIED = new Set(stems('cerveau cérébral encéphale intracrânien maladie artère processus lobe sucré'));

/**
 * Alternatives d'un intitule disjonctif (« … du fœtus ou du nouveau-ne », « Anevrisme ou
 * dissection … ») : le mot porteur de chaque cote du « ou ». Il suffit que le texte en couvre
 * un pour que l'autre ne soit pas une information ajoutee.
 */
function disjunctions(label: string): Array<[string, string]> {
  const words = normalizeText(label).split(' ').flatMap((w) => SYNONYMS[w] ?? [w]);
  const pairs: Array<[string, string]> = [];
  words.forEach((w, i) => {
    if (w !== 'ou') return;
    const before = words.slice(0, i).reverse().find((x) => !STOPWORDS.has(x));
    const after = words.slice(i + 1).find((x) => !STOPWORDS.has(x));
    if (before && after) pairs.push([stemOf(before), stemOf(after)]);
  });
  return pairs;
}

/**
 * Le libelle n'affirme-t-il que ce que le medecin a ecrit ? Chaque mot porteur de l'intitule
 * doit se retrouver dans son texte ou dans le terme developpe (abreviations, synonymes). Un
 * germe, un stade ou une cause que seul le LLM a deduit (« Pneumonie due a Streptococcus
 * pneumoniae » pour « pneumonie franche lobaire aigue ») ne l'est pas : la proposition
 * reste alors a confirmer.
 */
export function isCovered(label: string, item: Pick<DiagnosisInterpretation, 'normalized' | 'source'>): boolean {
  const known = [...stems(item.normalized), ...stems(item.source ?? '')];
  const isKnown = (s: string) => IMPLIED.has(s) || known.some((k) => sameStem(k, s));
  const core = coreLabel(label);
  const alternatives = disjunctions(core);
  return stems(core).every((s) =>
    isKnown(s) ||
    alternatives.some(([a, b]) => (s === a && isKnown(b)) || (s === b && isKnown(a)))
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Meilleure similarite d'un candidat sur l'ensemble des termes ; le terme prefere pese plein. */
export function scoreCandidates(terms: string[], candidates: Candidate[]): ScoredCandidate[] {
  const scored = candidates.map((c) => ({
    ...c,
    score: Math.max(0, ...terms.map((t, i) => similarity(t, c.label) * (i === 0 ? 1 : 0.95))),
  }));
  return scored.sort((a, b) =>
    b.score - a.score || residualRank(a.label) - residualRank(b.label) || a.rank - b.rank ||
    a.label.localeCompare(b.label)
  );
}

/** Nombre de candidats demandes au referentiel pour un diagnostic. */
export const CANDIDATE_LIMIT = 60;

/** Variante d'un terme dans le vocabulaire des intitules (« hematome » -> « hemorragie »). */
export function withSynonyms(term: string): string {
  return normalizeText(term).split(' ').flatMap((w) => SYNONYMS[w] ?? [w]).join(' ');
}

/**
 * Termes envoyes a `match_terminology_candidates` pour un diagnostic (8 au plus) : ceux de
 * l'interpretation, puis leurs variantes synonymes quand elles different.
 */
export function candidateTerms(item: DiagnosisInterpretation): string[] {
  const base = [...item.searchTerms, item.normalized, ...item.alternativeTerms].filter(Boolean);
  const variants = base.map(withSynonyms).filter((v, i) => v !== normalizeText(base[i]));
  return [...base, ...variants]
    .filter((t, i, all) => t && all.indexOf(t) === i)
    .slice(0, 8);
}

/** Seuils de decision ; `THRESHOLDS` en est la valeur calibree. */
export interface Thresholds {
  automatic: number;
  automaticGap: number;
  suggested: number;
  plausible: number;
  maxAlternatives: number;
}

/**
 * Tout ce qui ne depend PAS des seuils : classement des candidats, meilleur candidat pour le
 * terme prefere, meilleur candidat par entite signalee. Calcule une fois, il permet de
 * balayer les seuils sans recalculer les similarites (calibrage).
 */
export interface ItemScores {
  ambiguous: boolean;
  ranked: ScoredCandidate[];
  preferredCode: string | null;
  /** Le meilleur candidat global est-il, au sens du concept, celui du terme prefere ? */
  agrees: boolean;
  /** Le meilleur candidat est-il couvert par le texte du medecin (`isCovered`) ? */
  covered: boolean;
  /** `ranked` sans les doublons residuels (« X, sans precision », « Autres X »). */
  distinct: ScoredCandidate[];
  perEntity: ScoredCandidate[];
  /**
   * Codes PLUS PRECIS que le meilleur candidat (ses descendants, hors « Autres » et « sans
   * precision ») dont la precision ajoutee figure dans le texte ou dans l'interpretation, avec
   * leur couverture par le texte. Poser le parent alors que l'un d'eux convient perdrait une
   * precision ecrite (« aigu », « sur conflit discal »).
   */
  refinements: Array<ScoredCandidate & { covered: boolean }>;
}

/** `child` est-il un descendant de `parent` dans la classification (« NA07.60 » sous « NA07.6 ») ? */
export function isDescendantCode(child: string, parent: string): boolean {
  return child.length > parent.length && child.startsWith(parent);
}

export function scoreItem(item: DiagnosisInterpretation, candidates: Candidate[]): ItemScores {
  const terms = [item.searchTerms[0] ?? item.normalized, ...item.searchTerms.slice(1), item.normalized]
    .filter((t, i, all) => t && all.indexOf(t) === i);
  const preferred = scoreCandidates(terms.slice(0, 1), candidates)[0];
  const ranked = scoreCandidates(terms, candidates);
  // « X », « X, sans precision » et « Autres X » sont un meme concept pour l'ecart et les
  // propositions : seul le premier classe (la categorie principale) est retenu.
  const keys = ranked.map((c) => conceptKey(c.label));
  const distinct = ranked.filter((_, i) => keys.indexOf(keys[i]) === i);
  const best = ranked[0];
  return {
    ambiguous: item.ambiguous,
    ranked,
    preferredCode: preferred?.code ?? null,
    agrees: !!best && !!preferred &&
      (preferred.code === best.code || conceptKey(preferred.label) === keys[0]),
    covered: !!best && isCovered(best.label, item),
    distinct,
    refinements: best ? refinementsOf(best, ranked, item) : [],
    perEntity: item.ambiguous
      ? item.alternativeTerms
        .map((t) => scoreCandidates([t], candidates)[0])
        .filter((c): c is ScoredCandidate => !!c)
        .filter((c, i, all) => all.findIndex((x) => x.code === c.code) === i)
      : [],
  };
}

/**
 * Descendants de `best` qui precisent ce que l'interpretation dit deja : un mot que le
 * descendant ajoute au parent (« aigue », « disques ») se retrouve dans le texte, le terme
 * developpe ou un terme de recherche. Sans cela (« HSD traumatique » face a « … aigue » et
 * « … chronique »), le parent reste le code fidele.
 */
function refinementsOf(
  best: ScoredCandidate,
  ranked: ScoredCandidate[],
  item: DiagnosisInterpretation,
): Array<ScoredCandidate & { covered: boolean }> {
  const parent = stems(coreLabel(best.label));
  const said = stems([item.source ?? '', item.normalized, ...item.searchTerms, ...item.alternativeTerms].join(' '));
  return ranked
    .filter((c) => isDescendantCode(c.code, best.code) && residualRank(c.label) === 0)
    .map((c) => ({ ...c, covered: isCovered(c.label, item) }))
    .filter((c) =>
      c.covered ||
      stems(coreLabel(c.label))
        .filter((s) => !parent.some((p) => sameStem(p, s)) && !IMPLIED.has(s))
        .some((s) => said.some((w) => sameStem(w, s)))
    );
}

/** Decision a partir des scores, pour des seuils donnes. */
export function decideFromScores(scores: ItemScores, thresholds: Thresholds = THRESHOLDS): MatchDecision {
  const { ranked } = scores;
  // Ambiguite signalee : les propositions par entite priment, meme si le terme general
  // (« Cancer du poumon ») ne correspond lui-meme a aucun intitule.
  const perEntity = scores.ambiguous
    ? scores.perEntity.filter((c) => c.score >= thresholds.plausible).slice(0, thresholds.maxAlternatives)
    : [];
  if (perEntity.length > 1) {
    return { status: 'ambiguous', score: round(perEntity[0].score), best: perEntity[0], alternatives: perEntity };
  }
  const best = ranked[0] ?? null;
  if (!best || best.score < thresholds.plausible) {
    return { status: 'unmatched', score: round(best?.score ?? 0), best: null, alternatives: [] };
  }
  const { distinct } = scores;
  const second = distinct.find((c) => c.code !== best.code);
  const gap = best.score - (second?.score ?? 0);
  // Accord : le meilleur concept doit aussi etre le meilleur pour le terme PREFERE seul.
  const agrees = scores.agrees;
  const plausible = distinct.filter((c) => c.score >= thresholds.plausible).slice(0, thresholds.maxAlternatives);

  if (scores.ambiguous) {
    // Une seule entite plausible ou aucune : les candidats plausibles sont offerts au choix,
    // on ne choisit jamais a la place du medecin.
    return { status: 'ambiguous', score: round(best.score), best, alternatives: plausible };
  }
  if (best.score >= thresholds.suggested && gap < thresholds.automaticGap / 2) {
    return { status: 'ambiguous', score: round(best.score), best, alternatives: plausible };
  }
  // Un code plus precis du meme concept reprend ce qui est ecrit (`refinements`) :
  // le parent perdrait cette precision. Rien n'est pose seul ; le plus fidele est propose.
  const finer = scores.refinements;
  if (finer.length > 0) {
    const proposed = finer.find((c) => c.covered) ?? best;
    const others = [best, ...finer].filter((c, i, all) =>
      c.code !== proposed.code && all.findIndex((x) => x.code === c.code) === i
    );
    return {
      status: 'suggested',
      score: round(proposed.score),
      best: proposed,
      alternatives: others.slice(0, thresholds.maxAlternatives - 1),
    };
  }
  // Seul un libelle qui n'ajoute rien au texte du medecin peut etre retenu sans confirmation.
  if (best.score >= thresholds.automatic && gap >= thresholds.automaticGap && agrees && scores.covered) {
    return { status: 'automatic', score: round(best.score), best, alternatives: [] };
  }
  // Un seul candidat plausible : il n'y a rien a departager, on le propose a confirmer.
  if (best.score >= thresholds.suggested || plausible.length === 1) {
    return {
      status: 'suggested',
      score: round(best.score),
      best,
      alternatives: plausible.filter((c) => c.code !== best.code),
    };
  }
  return { status: 'ambiguous', score: round(best.score), best, alternatives: plausible };
}

/** Decision a partir des candidats bruts. */
export function decide(
  item: DiagnosisInterpretation,
  candidates: Candidate[],
  thresholds: Thresholds = THRESHOLDS,
): MatchDecision {
  return decideFromScores(scoreItem(item, candidates), thresholds);
}
