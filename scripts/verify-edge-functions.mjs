// Contrat statique des Edge Functions — inventaire DYNAMIQUE (audit lot 9 §2).
//
// L'ancienne version comparait le contenu de supabase/functions a une liste de cinq noms codee
// en dur ET filtrait les dossiers sur cette meme liste : une SIXIEME fonction etait donc
// silencieusement ignoree (ni typee, ni verifiee, ni deployee avec le bon verify_jwt). Ici on
// DECOUVRE les fonctions sur disque, on ne tolere explicitement que les dossiers techniques
// prefixes par « _ » (ex. _shared), et on croise l'inventaire decouvert avec la source de verite
// de deploiement (supabase/config.toml : sections [functions.<nom>]). Toute derive echoue.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FUNCTIONS_DIR = 'supabase/functions';
export const ENTRYPOINT = 'index.ts';
// Un dossier technique partage est explicitement declare par un prefixe « _ » (ex. _shared).
const isSharedDir = (name) => name.startsWith('_');

/**
 * Classe chaque dossier de supabase/functions.
 * @returns {{ functions: string[], shared: string[], ambiguous: string[] }}
 */
export function discoverEdgeFunctions(root) {
  const base = join(root, FUNCTIONS_DIR);
  const functions = [];
  const shared = [];
  const ambiguous = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (isSharedDir(entry.name)) {
      shared.push(entry.name);
      continue;
    }
    let hasEntrypoint = false;
    try {
      readFileSync(join(base, entry.name, ENTRYPOINT), 'utf8');
      hasEntrypoint = true;
    } catch {
      // pas d'index.ts -> dossier non-fonction (potentiellement ambigu)
    }
    if (hasEntrypoint) functions.push(entry.name);
    else ambiguous.push(entry.name); // ni fonction (pas d'index.ts) ni dossier partage declare
  }
  return { functions: functions.sort(), shared: shared.sort(), ambiguous: ambiguous.sort() };
}

/** Fonctions declarees dans supabase/config.toml via des sections [functions.<nom>]. */
export function declaredFunctions(configTomlText) {
  const declared = [];
  const re = /^\[functions\.([A-Za-z0-9_-]+)\]/gm;
  let match;
  while ((match = re.exec(configTomlText)) !== null) declared.push(match[1]);
  return declared.sort();
}

/** Verifie le contenu d'un point d'entree (branches obligatoires, aucune desactivation globale). */
export function checkEntrypointContent(name, content) {
  const errors = [];
  if (!content.includes('Deno.serve')) errors.push(`${name}: point d'entree sans Deno.serve`);
  if (content.includes('@ts-nocheck')) errors.push(`${name}: @ts-nocheck interdit`);
  if (content.includes('@ts-ignore')) errors.push(`${name}: @ts-ignore interdit (preferer @ts-expect-error cible)`);
  // Desactivations GLOBALES de fichier (deno-lint / eslint) : interdites. Les suppressions ciblees
  // sur une seule ligne restent possibles.
  if (/deno-lint-ignore-file/.test(content)) errors.push(`${name}: deno-lint-ignore-file interdit`);
  if (/eslint-disable(?!-next-line|-line)/.test(content)) errors.push(`${name}: eslint-disable global interdit`);
  if (content.includes("jsr:@supabase/supabase-js@2'")) errors.push(`${name}: import Supabase non fige`);
  return errors;
}

/**
 * Verifie l'ensemble du contrat statique des Edge Functions.
 * @returns {{ ok: boolean, errors: string[], functions: string[] }}
 */
export function verifyEdgeFunctions(root) {
  const errors = [];
  const { functions, ambiguous } = discoverEdgeFunctions(root);

  for (const name of ambiguous) {
    errors.push(`Dossier ambigu dans ${FUNCTIONS_DIR}: ${name} (ni ${ENTRYPOINT} ni dossier « _ » partage)`);
  }

  // Contenu de chaque point d'entree decouvert.
  for (const name of functions) {
    const content = readFileSync(join(root, FUNCTIONS_DIR, name, ENTRYPOINT), 'utf8');
    errors.push(...checkEntrypointContent(name, content));
  }

  // Croisement avec la source de verite de deploiement (config.toml).
  const declared = declaredFunctions(readFileSync(join(root, 'supabase/config.toml'), 'utf8'));
  for (const name of functions) {
    if (!declared.includes(name)) {
      errors.push(`Fonction ${name} presente sur disque mais absente de config.toml ([functions.${name}])`);
    }
  }
  for (const name of declared) {
    if (!functions.includes(name)) {
      errors.push(`Fonction ${name} declaree dans config.toml mais introuvable dans ${FUNCTIONS_DIR}/${name}/${ENTRYPOINT}`);
    }
  }

  // Imports critiques figes.
  const denoConfig = readFileSync(join(root, 'deno.json'), 'utf8');
  if (
    !denoConfig.includes('jsr:@supabase/supabase-js@2.45.4') ||
    !denoConfig.includes('./supabase/functions/_shared/vendor/xlsx-0.20.3.mjs')
  ) {
    errors.push('Les imports Edge critiques ne sont pas figes dans deno.json.');
  }

  // Les gates Deno doivent couvrir le DOSSIER (mode dynamique) et non une liste de chemins figee,
  // sinon une 6e fonction echapperait a deno check / deno test.
  let tasks = {};
  try {
    tasks = (JSON.parse(denoConfig).tasks ?? {});
  } catch {
    errors.push('deno.json illisible (JSON invalide).');
  }
  for (const task of ['edge:check', 'edge:test']) {
    const cmd = tasks[task] ?? '';
    if (!cmd.includes(FUNCTIONS_DIR)) errors.push(`deno task ${task} ne cible pas ${FUNCTIONS_DIR}.`);
    if (/\/index\.ts\b/.test(cmd)) {
      errors.push(`deno task ${task} enumere des index.ts en dur — cibler le dossier ${FUNCTIONS_DIR} (inventaire dynamique).`);
    }
  }

  return { ok: errors.length === 0, errors, functions };
}

// --- CLI --------------------------------------------------------------------
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { ok, errors, functions } = verifyEdgeFunctions(root);
  if (!ok) {
    for (const message of errors) console.error(`Contrat statique Edge Functions: ${message}`);
    process.exit(1);
  }
  console.log(`Contrat statique Edge Functions OK (${functions.length} fonctions decouvertes): ${functions.join(', ')}.`);
}
