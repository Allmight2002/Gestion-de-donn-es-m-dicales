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
 * Seuils initiaux. Ils DEVRONT etre recalibres sur un jeu de diagnostics fictifs annotes
 * (cf. docs/codage-terminologique-assiste.md) ; ils sont regroupes ici pour cela.
 */
export const THRESHOLDS = {
  automatic: 0.9,
  automaticGap: 0.1,
  suggested: 0.7,
  plausible: 0.45,
  maxAlternatives: 4,
} as const;

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
]);

/** Minuscules, accents retires, tirets fusionnes (« sous-dural » = « sousdural »). */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[œ]/g, 'oe')
    .replace(/[æ]/g, 'ae')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Racines significatives : pluriel et feminin retires, mots vides ecartes. */
export function stems(text: string): string[] {
  const out: string[] = [];
  for (const word of normalizeText(text).split(' ')) {
    if (!word || STOPWORDS.has(word)) continue;
    const stem = word.length > 4 ? word.replace(/(es|e|s)$/, '') : word;
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  // Prefixe commun suffisamment long : « traumatiqu » / « traumatism » ne se confondent pas,
  // « hemorragi » / « hemorragiqu » si.
  return Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a));
}

/** Similarite F1 entre racines : 1 pour des libelles equivalents, 0 sans mot commun. */
export function similarity(term: string, label: string): number {
  if (normalizeText(term) === normalizeText(label)) return 1;
  const q = stems(term);
  const l = stems(label);
  if (q.length === 0 || l.length === 0) return 0;
  const recall = q.filter((t) => l.some((s) => sameStem(t, s))).length / q.length;
  const precision = l.filter((s) => q.some((t) => sameStem(t, s))).length / l.length;
  return recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Meilleure similarite d'un candidat sur l'ensemble des termes ; le terme prefere pese plein. */
export function scoreCandidates(terms: string[], candidates: Candidate[]): ScoredCandidate[] {
  const scored = candidates.map((c) => ({
    ...c,
    score: Math.max(0, ...terms.map((t, i) => similarity(t, c.label) * (i === 0 ? 1 : 0.95))),
  }));
  return scored.sort((a, b) => b.score - a.score || a.rank - b.rank || a.label.localeCompare(b.label));
}

/** Decision a partir des candidats deja scores. */
export function decide(item: DiagnosisInterpretation, candidates: Candidate[]): MatchDecision {
  const terms = [item.searchTerms[0] ?? item.normalized, ...item.searchTerms.slice(1), item.normalized]
    .filter((t, i, all) => t && all.indexOf(t) === i);
  const ranked = scoreCandidates(terms, candidates);
  const best = ranked[0] ?? null;
  if (!best || best.score < THRESHOLDS.plausible) {
    return { status: 'unmatched', score: round(best?.score ?? 0), best: null, alternatives: [] };
  }
  const second = ranked.find((c) => c.code !== best.code);
  const gap = best.score - (second?.score ?? 0);
  // Accord : le meilleur concept doit aussi etre le meilleur pour le terme PREFERE seul.
  const preferred = scoreCandidates(terms.slice(0, 1), candidates)[0];
  const agrees = preferred?.code === best.code;
  const plausible = ranked.filter((c) => c.score >= THRESHOLDS.plausible).slice(0, THRESHOLDS.maxAlternatives);

  if (item.ambiguous) {
    // Une proposition par entite distincte signalee par l'interpretation, a defaut les
    // candidats plausibles : on ne choisit jamais a la place du medecin.
    const perEntity = item.alternativeTerms
      .map((t) => scoreCandidates([t], candidates)[0])
      .filter((c): c is ScoredCandidate => !!c && c.score >= THRESHOLDS.plausible)
      .filter((c, i, all) => all.findIndex((x) => x.code === c.code) === i)
      .slice(0, THRESHOLDS.maxAlternatives);
    return {
      status: 'ambiguous',
      score: round(best.score),
      best,
      alternatives: perEntity.length > 1 ? perEntity : plausible,
    };
  }
  if (best.score >= THRESHOLDS.suggested && gap < THRESHOLDS.automaticGap / 2) {
    return { status: 'ambiguous', score: round(best.score), best, alternatives: plausible };
  }
  if (best.score >= THRESHOLDS.automatic && gap >= THRESHOLDS.automaticGap && agrees) {
    return { status: 'automatic', score: round(best.score), best, alternatives: [] };
  }
  // Un seul candidat plausible : il n'y a rien a departager, on le propose a confirmer.
  if (best.score >= THRESHOLDS.suggested || plausible.length === 1) {
    return {
      status: 'suggested',
      score: round(best.score),
      best,
      alternatives: plausible.filter((c) => c.code !== best.code),
    };
  }
  return { status: 'ambiguous', score: round(best.score), best, alternatives: plausible };
}
