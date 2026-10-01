// Banc d'essai du codage assiste contre un VRAI fournisseur (DeepSeek), sur des diagnostics
// FICTIFS : le jeu de calibrage (un diagnostic par texte) et des saisies a plusieurs diagnostics.
//
// Trois strategies, memes textes, memes conditions :
//   * `current`    : chaine en vigueur (prompt actuel -> RPC de candidats -> score -> decision),
//                    mesuree cote serveur (`server` : meilleur + alternatives) et telle que
//                    l'ecran l'affiche aujourd'hui (`ui` : un seul code pour automatic/suggested) ;
//   * `memory`     : le LLM donne code + intitule, verifies dans le referentiel ;
//   * `candidates` : `memory`, puis le LLM choisit parmi des candidats reels du referentiel.
//
// Ne s'execute QUE sur demande, avec la cle dans l'environnement (jamais ecrite) :
//   DEEPSEEK_API_KEY=... TERMINOLOGY_BENCH_REPORT=<chemin.json> npx vitest run test/terminology-coding-bench.test.ts
// Variables facultatives : TERMINOLOGY_LLM_MODEL (deepseek-v4-pro), TERMINOLOGY_LLM_REASONING
// (disabled), TERMINOLOGY_BENCH_RUNS (1), TERMINOLOGY_BENCH_TIMEOUT_MS (30000),
// TERMINOLOGY_BENCH_ONLY (identifiants separes par des virgules).
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
  decide,
  type DiagnosisInterpretation,
  type MatchDecision,
} from '../supabase/functions/code-terminology/scoring';
import { lexicalInterpretation } from '../supabase/functions/code-terminology/lexical';
import { CALIBRATION_CASES, type Expectation } from './fixtures/terminologyCalibration';
import { MULTI_BENCH_CASES } from './fixtures/terminologyBenchMulti';
import {
  buildReferential,
  candidatePool,
  chatJson,
  CHOICE_PROMPT,
  choicePrompt,
  type LlmConfig,
  MEMORY_PROMPT,
  type MemoryDiagnosis,
  parseChoice,
  parseMemory,
  percentiles,
  pool,
  type Referential,
  verifiedCodes,
} from './helpers/terminologyBench';

// Modules de l'Edge Function charges dynamiquement : leurs imports en `.ts` (Deno) ne passent
// pas la verification de types du projet Node. Le code execute est bien celui de production.
interface InterpretationService {
  interpret(text: string): Promise<DiagnosisInterpretation[]>;
}
interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: 'json_schema' | 'json_object';
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
}
const FUNCTION_DIR = new URL('../supabase/functions/code-terminology/', import.meta.url);
const { scrubIdentifiers } = await import(/* @vite-ignore */ new URL('interpret.ts', FUNCTION_DIR).href) as {
  scrubIdentifiers(text: string): string;
};
const { openAICompatibleInterpretation, PROVIDERS, reasoningOptions } = await import(
  /* @vite-ignore */ new URL('openaiCompatible.ts', FUNCTION_DIR).href
) as {
  openAICompatibleInterpretation(config: OpenAICompatibleConfig): InterpretationService;
  PROVIDERS: { deepseek: { baseUrl: string; jsonMode: OpenAICompatibleConfig['jsonMode'] } };
  reasoningOptions(provider: string, value: string | undefined): Record<string, unknown> | null;
};

const OUT = process.env.TERMINOLOGY_BENCH_REPORT;
const STRATEGIES = ['current_ui', 'current_server', 'memory', 'candidates'] as const;
type Strategy = typeof STRATEGIES[number];

interface BenchCase {
  id: string;
  text: string;
  single?: Expectation;
  multi?: Array<{ label: string; codes: string[] }>;
}

/** Propositions d'une strategie : une liste ordonnee de codes par diagnostic reconnu. */
interface StrategyRun {
  diagnoses: string[][];
  ms: number;
  failed: string | null;
  detail: unknown;
}

let db: TestDb;
let userId: string;
let ref: Referential;

async function rpcCandidates(terms: string[]): Promise<Candidate[]> {
  if (terms.length === 0) return [];
  const rows = await db.asUser(userId, async (c: Client) => (await c.query(
    'select code, label, uri from public.match_terminology_candidates($1, $2)',
    [terms.slice(0, 8), CANDIDATE_LIMIT],
  )).rows as Array<{ code: string; label: string; uri: string | null }>);
  return rows.map((r, rank) => ({ code: r.code, label: r.label, uri: r.uri, rank }));
}

const unique = (codes: Array<string | null | undefined>) =>
  codes.filter((c, i, all): c is string => !!c && all.indexOf(c) === i);

/** Ce que l'ecran montre aujourd'hui (`entryFor`, src/domain/terminologyCoding.ts). */
function shown(d: MatchDecision): string[] {
  if (d.status === 'automatic' || d.status === 'suggested') return unique([d.best?.code]);
  if (d.status === 'ambiguous') return unique(d.alternatives.map((a) => a.code));
  return [];
}

describe.runIf(!!OUT)('codage assiste — banc d\'essai DeepSeek', () => {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
  const model = process.env.TERMINOLOGY_LLM_MODEL?.trim() || 'deepseek-v4-pro';
  const reasoning = process.env.TERMINOLOGY_LLM_REASONING?.trim() || 'disabled';
  const timeoutMs = Number.parseInt(process.env.TERMINOLOGY_BENCH_TIMEOUT_MS ?? '', 10) || 30_000;
  const runs = Math.max(1, Number.parseInt(process.env.TERMINOLOGY_BENCH_RUNS ?? '', 10) || 1);
  const only = new Set((process.env.TERMINOLOGY_BENCH_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const extraBody = reasoningOptions('deepseek', reasoning);
  const llm: LlmConfig = {
    apiKey,
    baseUrl: process.env.TERMINOLOGY_LLM_BASE_URL?.trim() || PROVIDERS.deepseek.baseUrl,
    model,
    timeoutMs,
    extraBody: extraBody ?? {},
  };
  const currentService = openAICompatibleInterpretation({
    apiKey,
    model,
    baseUrl: llm.baseUrl,
    jsonMode: PROVIDERS.deepseek.jsonMode,
    timeoutMs,
    extraBody: extraBody ?? {},
  });

  beforeAll(async () => {
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY requis');
    if (!extraBody) throw new Error(`TERMINOLOGY_LLM_REASONING invalide : ${reasoning}`);
    db = await startTestDb({ seed: true });
    userId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
    const { concepts } = parseTerminologyRows(readTextFile(join('supabase', 'terminology', 'diagnostics-fr.tsv.gz')));
    ref = buildReferential(concepts);
    await importTerminology(db.admin, {
      slug: 'banc-diagnostics-fr',
      concepts,
      title: 'Referentiel versionne (banc d\'essai)',
      source: 'depot',
      version: 'banc',
      activate: true,
    });
  }, 300_000);

  afterAll(async () => { await db?.stop(); });

  async function runCurrent(text: string): Promise<{ ui: StrategyRun; server: StrategyRun }> {
    const started = Date.now();
    let failed: string | null = null;
    let items: DiagnosisInterpretation[];
    try {
      items = await currentService.interpret(text);
    } catch (error) {
      // Comme l'Edge Function : repli lexical.
      failed = String((error as Error)?.message ?? error).slice(0, 60);
      items = lexicalInterpretation(text);
    }
    const ms = Date.now() - started;
    const decisions: Array<{ normalized: string; terms: string[]; decision: MatchDecision }> = [];
    for (const item of items.slice(0, 5)) {
      const decision = decide({ ...item, source: text }, await rpcCandidates(candidateTerms(item)));
      decisions.push({ normalized: item.normalized, terms: item.searchTerms, decision });
    }
    const detail = decisions.map(({ normalized, terms, decision: d }) => ({
      normalized,
      terms,
      status: d.status,
      best: d.best && `${d.best.code} ${d.best.label} (${d.best.score.toFixed(2)})`,
      alternatives: d.alternatives.map((a) => `${a.code} ${a.label}`),
    }));
    return {
      ui: { diagnoses: decisions.map((d) => shown(d.decision)), ms, failed, detail },
      server: {
        diagnoses: decisions.map(({ decision: d }) =>
          d.status === 'unmatched' ? [] : unique([d.best?.code, ...d.alternatives.map((a) => a.code)])
        ),
        ms,
        failed,
        detail: null,
      },
    };
  }

  async function runMemoryAndCandidates(text: string): Promise<{ memory: StrategyRun; candidates: StrategyRun }> {
    const first = await chatJson(llm, MEMORY_PROMPT, `<diagnostic>\n${text}\n</diagnostic>`);
    let parsed: MemoryDiagnosis[] | null = null;
    let failed = first.ok ? null : first.error;
    if (first.ok) {
      try {
        parsed = parseMemory(first.json, ref);
      } catch {
        failed = 'forme inattendue';
      }
    }
    if (!parsed) {
      const none = { diagnoses: [], ms: first.ms, failed, detail: null };
      return { memory: none, candidates: { ...none } };
    }
    const memory: StrategyRun = {
      diagnoses: parsed.map((d) => verifiedCodes(d.proposals)),
      ms: first.ms,
      failed: null,
      detail: parsed.map((d) => ({
        text: d.text,
        proposals: d.proposals.map((p) =>
          `${p.llmCode} « ${p.llmLabel} » -> ${p.verification}${p.code ? ` ${p.code} ${p.label}` : ''}`
        ),
      })),
    };
    const choices = await Promise.all(parsed.map(async (d) => {
      const verified = verifiedCodes(d.proposals);
      const terms = unique([d.text, ...d.proposals.map((p) => p.llmLabel)]);
      const searched = (await rpcCandidates(terms)).slice(0, 20).map((c) => c.code);
      const offered = candidatePool(ref, verified, searched);
      if (offered.length === 0) return { codes: [] as string[], ms: 0, failed: null as string | null, outside: 0, offered: 0 };
      const answer = await chatJson(llm, CHOICE_PROMPT, choicePrompt(ref, text, d.text || text, offered));
      if (!answer.ok) return { codes: verified, ms: answer.ms, failed: answer.error, outside: 0, offered: offered.length };
      try {
        return { ...parseChoice(answer.json, offered), ms: answer.ms, failed: null, offered: offered.length };
      } catch {
        return { codes: verified, ms: answer.ms, failed: 'forme inattendue', outside: 0, offered: offered.length };
      }
    }));
    return {
      memory,
      candidates: {
        diagnoses: choices.map((c) => c.codes),
        ms: first.ms + Math.max(0, ...choices.map((c) => c.ms)),
        // Un second appel en echec garde les codes verifies de `memory` (repli).
        failed: choices.find((c) => c.failed)?.failed ?? null,
        detail: choices.map((c) => ({ chosen: c.codes, offered: c.offered, outside: c.outside, failed: c.failed })),
      },
    };
  }

  test('mesure des trois strategies', async () => {
    const cases: BenchCase[] = [
      ...CALIBRATION_CASES.map((c) => ({ id: c.id, text: c.text, single: c.expect })),
      ...MULTI_BENCH_CASES.map((c) => ({ id: c.id, text: c.text, multi: c.expected })),
    ].filter((c) => only.size === 0 || only.has(c.id));
    const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
    let done = 0;
    const results = await pool(jobs, 4, async ({ c, run }) => {
      const text = scrubIdentifiers(c.text);
      const [current, other] = await Promise.all([runCurrent(text), runMemoryAndCandidates(text)]);
      if (++done % 20 === 0) console.log(`${done} saisies sur ${jobs.length}`);
      const byStrategy: Record<Strategy, StrategyRun> = {
        current_ui: current.ui,
        current_server: current.server,
        memory: other.memory,
        candidates: other.candidates,
      };
      return { c, run, byStrategy };
    });

    const summary = Object.fromEntries(STRATEGIES.map((s) => [s, summarize(results.map((r) => ({ c: r.c, run: r.byStrategy[s] })))]));
    const verification = { code: 0, code_incoherent: 0, label: 0, invented: 0 } as Record<string, number>;
    let outside = 0;
    for (const r of results) {
      for (const d of (r.byStrategy.memory.detail as Array<{ proposals: string[] }> | null) ?? []) {
        for (const p of d.proposals) verification[p.split(' -> ')[1].split(' ')[0]]++;
      }
      for (const d of (r.byStrategy.candidates.detail as Array<{ outside: number }> | null) ?? []) outside += d.outside;
    }
    const report = {
      config: { provider: 'deepseek', model, reasoning, timeoutMs, runs, measuredAt: new Date().toISOString() },
      summary,
      memoryVerification: verification,
      candidatesOutsideList: outside,
      detail: results.map((r) => ({
        id: r.c.id,
        run: r.run + 1,
        text: r.c.text,
        expected: r.c.single ?? r.c.multi,
        ...Object.fromEntries(STRATEGIES.map((s) => [s, {
          proposals: r.byStrategy[s].diagnoses,
          verdict: verdict(r.c, r.byStrategy[s].diagnoses),
          ms: r.byStrategy[s].ms,
          failed: r.byStrategy[s].failed,
          ...(r.byStrategy[s].detail ? { detail: r.byStrategy[s].detail } : {}),
        }])),
      })),
    };
    writeFileSync(OUT!, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ summary, memoryVerification: verification, candidatesOutsideList: outside }, null, 2));
    expect(results.length).toBe(jobs.length);
  }, 3_600_000);
});

type Verdict = 'top1' | 'listed' | 'missed' | 'empty_ok' | 'false_proposal' | string;

/** Verdict d'une saisie : un diagnostic attendu (calibrage) ou plusieurs (`n/m`). */
function verdict(c: BenchCase, diagnoses: string[][]): Verdict {
  const flat = unique(diagnoses.flat());
  if (c.single) {
    if (c.single.kind === 'unmatched') return flat.length === 0 ? 'empty_ok' : 'false_proposal';
    const ok = new Set([...c.single.codes, ...(c.single.kind === 'ambiguous' ? c.single.generic ?? [] : [])]);
    if (diagnoses[0]?.[0] && ok.has(diagnoses[0][0])) return 'top1';
    return flat.some((x) => ok.has(x)) ? 'listed' : 'missed';
  }
  const found = c.multi!.filter((e) => flat.some((x) => e.codes.includes(x))).length;
  return `${found}/${c.multi!.length}`;
}

function summarize(rows: Array<{ c: BenchCase; run: StrategyRun }>) {
  const single = rows.filter((r) => r.c.single && r.c.single.kind !== 'unmatched');
  const absent = rows.filter((r) => r.c.single?.kind === 'unmatched');
  const multi = rows.filter((r) => r.c.multi);
  const count = (list: typeof rows, v: Verdict) => list.filter((r) => verdict(r.c, r.run.diagnoses) === v).length;
  const multiFound = multi.reduce((n, r) => n + Number(verdict(r.c, r.run.diagnoses).split('/')[0]), 0);
  const multiTotal = multi.reduce((n, r) => n + r.c.multi!.length, 0);
  const firstRight = multi.reduce((n, r) =>
    n + r.c.multi!.filter((e) => r.run.diagnoses.some((d) => d[0] && e.codes.includes(d[0]))).length, 0);
  // Un code « ajoute une precision » quand il est propose en premier alors que le jeu le
  // marque `noAuto` (germe, stade non ecrits).
  const addedInfo = single.filter((r) =>
    r.c.single!.kind === 'code' && (r.c.single as { noAuto?: string[] }).noAuto?.includes(r.run.diagnoses[0]?.[0] ?? '')
  ).length;
  return {
    single: {
      cases: single.length,
      top1: count(single, 'top1'),
      listed: count(single, 'listed'),
      missed: count(single, 'missed'),
      firstAddsInformation: addedInfo,
    },
    absent: { cases: absent.length, emptyOk: count(absent, 'empty_ok'), falseProposal: count(absent, 'false_proposal') },
    multi: { diagnoses: multiTotal, found: multiFound, firstProposalRight: firstRight },
    meanProposals: Math.round(rows.reduce((n, r) => n + unique(r.run.diagnoses.flat()).length, 0) / Math.max(1, rows.length) * 10) / 10,
    failures: rows.filter((r) => r.run.failed).length,
    latencyMs: { ...percentiles(rows.map((r) => r.run.ms)), over8s: rows.filter((r) => r.run.ms > 8_000).length },
  };
}
