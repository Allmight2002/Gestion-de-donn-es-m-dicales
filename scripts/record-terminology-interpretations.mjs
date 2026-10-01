#!/usr/bin/env node
// Enregistre les interpretations d'un VRAI fournisseur LLM sur le jeu de calibrage FICTIF
// (test/fixtures/terminologyCalibration.ts), pour rejouer le calibrage des seuils avec ses
// sorties reelles (test/terminology-calibration.test.ts, scenario « recorded »).
//
// Meme chemin que l'Edge Function : texte nettoye (scrubIdentifiers), meme prompt, meme
// validation (parseInterpretation). Un echec est enregistre comme tel (null) : l'Edge Function
// basculerait alors sur le repli lexical, et le calibrage fait de meme.
//
// Usage (la cle n'est lue que dans l'environnement, jamais affichee ni ecrite) :
//   TERMINOLOGY_LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=... \
//     node scripts/record-terminology-interpretations.mjs [--runs 3] [--out <fichier.json>]
//   TERMINOLOGY_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... TERMINOLOGY_LLM_MODEL=claude-sonnet-5-5 \
//     node scripts/record-terminology-interpretations.mjs ...
// Variables facultatives : TERMINOLOGY_LLM_MODEL, TERMINOLOGY_LLM_BASE_URL (compatible OpenAI),
// TERMINOLOGY_LLM_REASONING (DeepSeek : disabled, low, high, max), comme l'Edge Function.
// Pour Claude, meme client que l'Edge Function (SDK officiel, claudeInterpretation), seul le
// delai change ; modele par defaut identique a celui de la production (claude-opus-5-5).
import { writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { parseArgs } from 'node:util';
import { CALIBRATION_CASES } from '../test/fixtures/terminologyCalibration.ts';
import { claudeInterpretation, scrubIdentifiers } from '../supabase/functions/code-terminology/interpret.ts';
import {
  openAICompatibleInterpretation,
  PROVIDERS,
  reasoningOptions,
} from '../supabase/functions/code-terminology/openaiCompatible.ts';

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    out: { type: 'string', default: 'test/fixtures/terminologyCalibration.recorded.json' },
    concurrency: { type: 'string', default: '4' },
  },
});

const provider = (process.env.TERMINOLOGY_LLM_PROVIDER || 'deepseek').trim().toLowerCase();
// Meme defaut que l'Edge Function (supabase/functions/code-terminology/index.ts).
const ANTHROPIC = { keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-opus-5-5' };
if (provider !== 'anthropic' && !(provider in PROVIDERS)) {
  console.error(`Fournisseur non pris en charge par cet outil : ${provider} (anthropic, openai ou deepseek).`);
  process.exit(2);
}
const defaults = provider === 'anthropic' ? ANTHROPIC : PROVIDERS[provider];
const apiKey = process.env[defaults.keyEnv];
const model = process.env.TERMINOLOGY_LLM_MODEL?.trim() || defaults.model;
if (!apiKey || !model) {
  console.error(`${defaults.keyEnv}${model ? '' : ' et TERMINOLOGY_LLM_MODEL'} requis dans l'environnement.`);
  process.exit(2);
}
const reasoning = process.env.TERMINOLOGY_LLM_REASONING?.trim() || null;
const extraBody = provider === 'anthropic' ? {} : reasoningOptions(provider, reasoning ?? undefined);
if (!extraBody || (provider === 'anthropic' && reasoning)) {
  console.error(`TERMINOLOGY_LLM_REASONING non pris en charge pour ${provider} : ${reasoning}`);
  process.exit(2);
}
const runs = Math.max(1, Number.parseInt(values.runs, 10) || 1);
const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 1);

// Delai plus large qu'en production (8 s) : on mesure la qualite, pas la latence. Les
// depassements sont comptes a part.
const TIMEOUT_MS = 30_000;
const service = provider === 'anthropic'
  ? claudeInterpretation(new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }), model)
  : openAICompatibleInterpretation({
    apiKey,
    model,
    baseUrl: process.env.TERMINOLOGY_LLM_BASE_URL?.trim() || defaults.baseUrl,
    jsonMode: defaults.jsonMode,
    timeoutMs: TIMEOUT_MS,
    extraBody,
  });

const jobs = CALIBRATION_CASES.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
const cases = Object.fromEntries(CALIBRATION_CASES.map((c) => [c.id, Array(runs).fill(null)]));
let failures = 0;
let done = 0;

async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const { c, run } = job;
    const started = Date.now();
    try {
      const items = await service.interpret(scrubIdentifiers(c.text));
      cases[c.id][run] = { items, ms: Date.now() - started };
    } catch (error) {
      failures += 1;
      // Seul le type d'echec est garde : ni corps de reponse, ni cle.
      cases[c.id][run] = { items: null, ms: Date.now() - started, error: failureKind(error) };
    }
    done += 1;
    if (done % 20 === 0) console.log(`${done} appels sur ${CALIBRATION_CASES.length * runs}`);
  }
}
/** Type d'echec seulement : le message d'une erreur d'API du SDK peut reprendre le corps de reponse. */
function failureKind(error) {
  if (error instanceof Anthropic.APIError) return `${error.constructor.name}${error.status ? ` (${error.status})` : ''}`;
  return String(error?.message ?? error).slice(0, 80);
}

await Promise.all(Array.from({ length: concurrency }, worker));

writeFileSync(values.out, `${JSON.stringify({
  provider,
  model,
  reasoning,
  recordedAt: new Date().toISOString(),
  runs,
  cases,
}, null, 2)}\n`);
console.log(`${CALIBRATION_CASES.length} cas x ${runs} passages enregistres dans ${values.out} (${failures} echecs).`);
