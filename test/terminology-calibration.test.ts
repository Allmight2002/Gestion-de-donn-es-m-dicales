// Calibrage du codage terminologique assiste sur le referentiel REEL versionne
// (supabase/terminology/diagnostics-fr.tsv.gz), avec la RPC reelle et le score reel.
//
// Deux scenarios, memes seuils :
//   * `llm`     : interpretations simulees du jeu annote (test/fixtures/terminologyCalibration.ts) ;
//   * `lexical` : repli sans LLM, a partir du seul texte du medecin.
//
// Ce test GARDE le calibrage : aucune erreur critique (code faux impose, ambiguite tranchee en
// silence) et une utilite au moins egale a celle mesuree au calibrage. Avec
// TERMINOLOGY_CALIBRATION_REPORT=<chemin.json>, il refait le balayage des seuils sur `dev`,
// mesure le resultat sur `test` et ecrit le rapport.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';
import { importTerminology, parseTerminologyRows, readTextFile } from '../scripts/import-terminology.mjs';
import {
  type Candidate,
  CANDIDATE_LIMIT,
  candidateTerms,
  type DiagnosisInterpretation,
  scoreItem,
  THRESHOLDS,
} from '../supabase/functions/code-terminology/scoring';
import { lexicalInterpretation } from '../supabase/functions/code-terminology/lexical';
import { CALIBRATION_CASES, type CalibrationCase } from './fixtures/terminologyCalibration';
import { evaluate, type ScoredCase, selectThresholds } from './helpers/terminologyCalibration';

let db: TestDb;
let userId: string;
const scored: Record<'llm' | 'lexical', ScoredCase[]> = { llm: [], lexical: [] };

async function candidates(item: DiagnosisInterpretation): Promise<Candidate[]> {
  const rows = await db.asUser(userId, async (c: Client) => (await c.query(
    'select code, label, uri from public.match_terminology_candidates($1, $2)',
    [candidateTerms(item), CANDIDATE_LIMIT],
  )).rows as Array<{ code: string; label: string; uri: string | null }>);
  return rows.map((r, rank) => ({ code: r.code, label: r.label, uri: r.uri, rank }));
}

async function score(c: CalibrationCase, item: DiagnosisInterpretation | undefined): Promise<ScoredCase> {
  if (!item || candidateTerms(item).length === 0) return { case: c, scores: null };
  return { case: c, scores: scoreItem(item, await candidates(item)) };
}

const only = (split: 'dev' | 'test' | 'holdout', cases: ScoredCase[]) => cases.filter((c) => c.case.split === split);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  userId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
  const { concepts } = parseTerminologyRows(readTextFile(join('supabase', 'terminology', 'diagnostics-fr.tsv.gz')));
  await importTerminology(db.admin, {
    slug: 'calibrage-diagnostics-fr',
    concepts,
    title: 'Referentiel versionne (calibrage)',
    source: 'depot',
    version: 'calibrage',
    activate: true,
  });
  for (const c of CALIBRATION_CASES) {
    // Comme l'Edge Function : le texte du medecin accompagne chaque interpretation.
    scored.llm.push(await score(c, {
      normalized: c.llm.normalized,
      searchTerms: c.llm.searchTerms,
      ambiguous: c.llm.ambiguous ?? false,
      alternativeTerms: c.llm.alternativeTerms ?? [],
      source: c.text,
    }));
    const lexical = lexicalInterpretation(c.text)[0];
    scored.lexical.push(await score(c, lexical && { ...lexical, source: c.text }));
  }
}, 300_000);

afterAll(async () => { await db?.stop(); });

describe('codage assiste — calibrage des seuils', () => {
  test('aucun code faux impose, sur le jeu complet et dans les deux scenarios', () => {
    for (const scenario of ['llm', 'lexical'] as const) {
      const report = evaluate(scored[scenario], THRESHOLDS);
      const critical = report.outcomes.filter((o) => o.outcome === 'auto_wrong');
      expect(critical, scenario).toEqual([]);
    }
  });

  test('utilite au moins egale a celle mesuree au calibrage', () => {
    // Planchers releves au calibrage du 2026-10-01 (docs/calibration-codage-terminologique-2026-10-01.md).
    expect(evaluate(scored.llm, THRESHOLDS).counts.auto_ok).toBeGreaterThanOrEqual(CALIBRATED.llmAutoOk);
    expect(evaluate(scored.llm, THRESHOLDS).utility).toBeGreaterThanOrEqual(CALIBRATED.llmUtility);
    expect(evaluate(scored.lexical, THRESHOLDS).utility).toBeGreaterThanOrEqual(CALIBRATED.lexicalUtility);
  });

  test.runIf(!!process.env.TERMINOLOGY_CALIBRATION_REPORT)('balayage des seuils et rapport', () => {
    // Detail par cas, utile pour comprendre une erreur avant de toucher aux seuils.
    const detail = Object.fromEntries((['llm', 'lexical'] as const).map((scenario) => [
      scenario,
      scored[scenario].map(({ case: c, scores }) => ({
        id: c.id,
        expect: c.expect,
        preferred: scores?.preferredCode ?? null,
        top: (scores?.ranked ?? []).slice(0, 4).map((x) => `${x.code} ${x.score.toFixed(2)} ${x.label}`),
      })),
    ]));
    writeFileSync(`${process.env.TERMINOLOGY_CALIBRATION_REPORT}.detail.json`, JSON.stringify(detail, null, 2));
    // Calibrage sur dev + test ; le controle inedit (holdout) n'entre jamais dans le choix.
    const calibration = (cases: ScoredCase[]) => cases.filter((c) => c.case.split !== 'holdout');
    const devOnly = selectThresholds(only('dev', scored.llm), only('dev', scored.lexical));
    const selection = selectThresholds(calibration(scored.llm), calibration(scored.lexical));
    const report = {
      selected: selection,
      // Choix sur dev seul, mesure sur test : temoin de la generalisation des seuils.
      devOnly: {
        selection: devOnly,
        llmTest: evaluate(only('test', scored.llm), devOnly.best),
        lexicalTest: evaluate(only('test', scored.lexical), devOnly.best),
      },
      current: THRESHOLDS,
      measures: Object.fromEntries((['llm', 'lexical'] as const).flatMap((scenario) =>
        (['dev', 'test', 'holdout'] as const).flatMap((split) =>
          [[`${scenario}.${split}.selected`, evaluate(only(split, scored[scenario]), selection.best)],
            [`${scenario}.${split}.current`, evaluate(only(split, scored[scenario]), THRESHOLDS)]]
        )
      )),
      full: {
        llm: evaluate(scored.llm, selection.best),
        lexical: evaluate(scored.lexical, selection.best),
      },
    };
    writeFileSync(process.env.TERMINOLOGY_CALIBRATION_REPORT!, JSON.stringify(report, null, 2));
  });
});

// Valeurs mesurees au calibrage (jeu complet, 97 cas, regle de couverture incluse) ; le calcul est deterministe.
const CALIBRATED = { llmAutoOk: 58, llmUtility: 75.6 - 1e-9, lexicalUtility: 49.8 - 1e-9 };
