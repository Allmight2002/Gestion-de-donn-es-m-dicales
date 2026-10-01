// Evaluation et balayage des seuils du codage terminologique assiste.
//
// Les scores (similarites, classement) ne dependent pas des seuils : ils sont calcules une fois
// par cas, puis chaque jeu de seuils n'est qu'une nouvelle DECISION sur ces scores.
import {
  decideFromScores,
  type ItemScores,
  type MatchDecision,
  type Thresholds,
} from '../../supabase/functions/code-terminology/scoring';
import type { CalibrationCase, Expectation } from '../fixtures/terminologyCalibration';

/**
 * Issue d'un cas. Les erreurs CRITIQUES sont celles ou MedData impose un code faux sans
 * action de l'utilisateur ; elles doivent etre nulles.
 */
export type Outcome =
  | 'auto_ok' // code juste pose automatiquement
  | 'auto_wrong' // CRITIQUE : code faux pose automatiquement, ou choix tranche en silence
  | 'suggest_ok' // bon code propose a confirmer
  | 'suggest_wrong' // mauvais code propose a confirmer (l'utilisateur doit le refuser)
  | 'choice_ok' // bon code parmi les propositions au choix
  | 'choice_miss' // propositions au choix sans le bon code
  | 'missed' // non code alors qu'un code convenait
  | 'unmatched_ok' // rien d'impose quand rien ne convenait
  | 'false_choice'; // propositions au choix alors que rien ne convenait

export const CRITICAL: ReadonlySet<Outcome> = new Set(['auto_wrong']);

/** Utilite pour l'utilisateur : saisie evitee (+), verification inutile ou erreur a corriger (-). */
export const UTILITY: Record<Outcome, number> = {
  auto_ok: 1,
  suggest_ok: 0.7,
  choice_ok: 0.5,
  unmatched_ok: 0.5,
  missed: 0,
  choice_miss: -0.2,
  false_choice: -0.2,
  suggest_wrong: -0.6,
  auto_wrong: -3,
};

export function outcomeOf(expect: Expectation, decision: MatchDecision): Outcome {
  const options = decision.alternatives.map((c) => c.code);
  const best = decision.best?.code ?? null;
  if (expect.kind === 'unmatched') {
    if (decision.status === 'unmatched') return 'unmatched_ok';
    if (decision.status === 'automatic') return 'auto_wrong';
    if (decision.status === 'suggested') return 'suggest_wrong';
    return 'false_choice';
  }
  const ok = (c: string | null) => c !== null && expect.codes.includes(c);
  if (decision.status === 'unmatched') return 'missed';
  if (expect.kind === 'ambiguous') {
    // Un code generique fidele au texte n'invente rien ; trancher seul entre les entites
    // possibles impose un diagnostic : c'est une erreur critique.
    const generic = (c: string | null) => c !== null && (expect.generic ?? []).includes(c);
    if (decision.status === 'automatic') return generic(best) ? 'auto_ok' : 'auto_wrong';
    if (decision.status === 'suggested') return ok(best) || generic(best) ? 'suggest_ok' : 'suggest_wrong';
    return options.some((c) => ok(c) || generic(c)) ? 'choice_ok' : 'choice_miss';
  }
  if (decision.status === 'automatic') {
    // Un code qui ajoute une information absente du texte ne se pose jamais sans confirmation.
    if (best !== null && (expect.noAuto ?? []).includes(best)) return 'auto_wrong';
    return ok(best) ? 'auto_ok' : 'auto_wrong';
  }
  if (decision.status === 'suggested') return ok(best) ? 'suggest_ok' : 'suggest_wrong';
  return options.some(ok) || ok(best) ? 'choice_ok' : 'choice_miss';
}

export interface ScoredCase {
  case: CalibrationCase;
  /** Une interpretation par diagnostic reconnu ; le calibrage porte sur le premier. */
  scores: ItemScores | null;
}

export interface Report {
  thresholds: Thresholds;
  counts: Record<Outcome, number>;
  critical: number;
  utility: number;
  total: number;
  outcomes: Array<{ id: string; outcome: Outcome; status: string; best: string | null; score: number }>;
}

const emptyCounts = (): Record<Outcome, number> => ({
  auto_ok: 0,
  auto_wrong: 0,
  suggest_ok: 0,
  suggest_wrong: 0,
  choice_ok: 0,
  choice_miss: 0,
  missed: 0,
  unmatched_ok: 0,
  false_choice: 0,
});

export function evaluate(cases: ScoredCase[], thresholds: Thresholds): Report {
  const counts = emptyCounts();
  const outcomes: Report['outcomes'] = [];
  for (const { case: c, scores } of cases) {
    const decision: MatchDecision = scores
      ? decideFromScores(scores, thresholds)
      : { status: 'unmatched', score: 0, best: null, alternatives: [] };
    const outcome = outcomeOf(c.expect, decision);
    counts[outcome]++;
    outcomes.push({ id: c.id, outcome, status: decision.status, best: decision.best?.code ?? null, score: decision.score });
  }
  const critical = [...CRITICAL].reduce((n, o) => n + counts[o], 0);
  const utility = (Object.keys(counts) as Outcome[]).reduce((u, o) => u + counts[o] * UTILITY[o], 0);
  return { thresholds, counts, critical, utility, total: cases.length, outcomes };
}

/** Grille de recherche : bornes raisonnables, pas de 0,05. */
export function thresholdGrid(): Thresholds[] {
  const range = (from: number, to: number, step = 0.05) => {
    const out: number[] = [];
    for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  };
  const grid: Thresholds[] = [];
  for (const automatic of range(0.8, 1)) {
    for (const automaticGap of range(0.05, 0.3)) {
      for (const suggested of range(0.5, 0.9)) {
        if (suggested > automatic) continue;
        for (const plausible of range(0.3, 0.6)) {
          if (plausible > suggested) continue;
          grid.push({ automatic, automaticGap, suggested, plausible, maxAlternatives: 4 });
        }
      }
    }
  }
  return grid;
}

/**
 * Choix des seuils : aucune erreur critique sur AUCUN des scenarios, y compris pour le voisin
 * immediatement plus permissif (marge de robustesse), puis utilite maximale du
 * scenario principal (LLM) augmentee de la moitie de celle du repli lexical. A utilite egale,
 * le jeu le plus PRUDENT l'emporte (seuil automatique, puis ecart, puis seuil de suggestion
 * les plus hauts) : un seuil trop permissif ne se voit pas sur un petit jeu.
 */
export function selectThresholds(primary: ScoredCase[], fallback: ScoredCase[]): {
  best: Thresholds;
  candidates: number;
  feasible: number;
} {
  let best: { t: Thresholds; u: number } | null = null;
  let feasible = 0;
  const grid = thresholdGrid();
  for (const t of grid) {
    const a = evaluate(primary, t);
    const b = evaluate(fallback, t);
    if (a.critical > 0 || b.critical > 0) continue;
    // Marge de robustesse : le voisin plus permissif doit rester sans erreur critique. Un jeu
    // de seuils « sur le fil » ne se generalise pas (constate au calibrage du 2026-10-01).
    const looser = { ...t, automatic: t.automatic - 0.05, automaticGap: Math.max(0, t.automaticGap - 0.05) };
    if (evaluate(primary, looser).critical > 0 || evaluate(fallback, looser).critical > 0) continue;
    feasible++;
    const u = a.utility + 0.5 * b.utility;
    const prudence = (x: Thresholds) => [x.automatic, x.automaticGap, x.suggested, x.plausible];
    const better = !best || u > best.u + 1e-9 ||
      (Math.abs(u - best.u) <= 1e-9 && compare(prudence(t), prudence(best.t)) > 0);
    if (better) best = { t, u };
  }
  if (!best) throw new Error('Aucun jeu de seuils sans erreur critique');
  return { best: best.t, candidates: grid.length, feasible };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
