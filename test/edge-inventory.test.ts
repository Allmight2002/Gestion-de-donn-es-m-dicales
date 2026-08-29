import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import {
  checkEntrypointContent,
  declaredFunctions,
  discoverEdgeFunctions,
  verifyEdgeFunctions,
} from '../scripts/verify-edge-functions.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Squelette minimal mais VALIDE : toutes les fonctions declarees + config.toml + deno.json coherents.
const BASE_FUNCTIONS = ['cleanup-upload', 'create-mission-account', 'finalize-upload', 'generate-export', 'inspect-upload', 'purge-deleted-base', 'reconcile-quarantine', 'signed-read'];
const ENTRYPOINT = 'Deno.serve((_req: Request) => new Response("ok"));\n';

const DENO_JSON = JSON.stringify({
  imports: {
    '@supabase/supabase-js': 'jsr:@supabase/supabase-js@2.45.4',
    xlsx: './supabase/functions/_shared/vendor/xlsx-0.20.3.mjs',
  },
  tasks: {
    'edge:check': 'deno check --frozen supabase/functions',
    'edge:test': 'deno test --frozen supabase/functions',
  },
});

const tmpRoots: string[] = [];

function makeFixtureRoot(functions: string[], extraDirs: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'edge-inv-'));
  tmpRoots.push(root);
  mkdirSync(join(root, 'supabase/functions'), { recursive: true });
  for (const name of functions) {
    mkdirSync(join(root, 'supabase/functions', name), { recursive: true });
    writeFileSync(join(root, 'supabase/functions', name, 'index.ts'), ENTRYPOINT);
  }
  // extraDirs: nom -> contenu d'index.ts (ou null pour un dossier SANS index.ts).
  for (const [name, content] of Object.entries(extraDirs)) {
    mkdirSync(join(root, 'supabase/functions', name), { recursive: true });
    if (content !== null) writeFileSync(join(root, 'supabase/functions', name, 'index.ts'), content);
  }
  const declared = functions.map((name) => `[functions.${name}]\nverify_jwt = false\n`).join('\n');
  writeFileSync(join(root, 'supabase/config.toml'), `[api]\nenabled = true\n\n${declared}`);
  writeFileSync(join(root, 'deno.json'), DENO_JSON);
  return root;
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

describe('inventaire dynamique des Edge Functions', () => {
  test('le depot reel passe : huit fonctions decouvertes, aucune derive', () => {
    const result = verifyEdgeFunctions(REPO_ROOT);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.functions).toEqual(BASE_FUNCTIONS);
  });

  test('_shared est exclu de l inventaire (dossier technique prefixe _)', () => {
    const root = makeFixtureRoot(BASE_FUNCTIONS, { _shared: 'export const x = 1;\n' });
    const { functions, shared, ambiguous } = discoverEdgeFunctions(root);
    expect(functions).toEqual(BASE_FUNCTIONS);
    expect(shared).toContain('_shared');
    expect(ambiguous).toEqual([]);
    expect(verifyEdgeFunctions(root).ok).toBe(true);
  });

  test('une fonction SUPPLEMENTAIRE non declaree est detectee (ne peut pas echapper au controle)', () => {
    const root = makeFixtureRoot(BASE_FUNCTIONS, { 'shadow-export': ENTRYPOINT });
    const { functions } = discoverEdgeFunctions(root);
    expect(functions).toContain('shadow-export'); // decouverte, contrairement a l'ancienne liste figee
    const { ok, errors } = verifyEdgeFunctions(root);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('shadow-export') && e.includes('config.toml'))).toBe(true);
  });

  test('une fonction declaree mais absente du disque echoue', () => {
    const root = makeFixtureRoot(BASE_FUNCTIONS);
    // On ajoute une declaration orpheline dans config.toml sans creer le dossier.
    writeFileSync(
      join(root, 'supabase/config.toml'),
      `[api]\nenabled = true\n\n${
        [...BASE_FUNCTIONS, 'ghost-fn'].map((n) => `[functions.${n}]\nverify_jwt = false\n`).join('\n')
      }`,
    );
    const { ok, errors } = verifyEdgeFunctions(root);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('ghost-fn') && e.includes('introuvable'))).toBe(true);
  });

  test('un dossier ambigu (ni index.ts ni prefixe _) echoue', () => {
    const root = makeFixtureRoot(BASE_FUNCTIONS, { 'orphan-dir': null });
    const { ambiguous } = discoverEdgeFunctions(root);
    expect(ambiguous).toContain('orphan-dir');
    const { ok, errors } = verifyEdgeFunctions(root);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('orphan-dir') && e.toLowerCase().includes('ambigu'))).toBe(true);
  });

  test('deno.json enumerant des index.ts en dur (liste figee) echoue', () => {
    const root = makeFixtureRoot(BASE_FUNCTIONS);
    writeFileSync(
      join(root, 'deno.json'),
      JSON.stringify({
        imports: {
          '@supabase/supabase-js': 'jsr:@supabase/supabase-js@2.45.4',
          xlsx: './supabase/functions/_shared/vendor/xlsx-0.20.3.mjs',
        },
        tasks: {
          'edge:check': 'deno check supabase/functions/signed-read/index.ts',
          'edge:test': 'deno test --frozen supabase/functions',
        },
      }),
    );
    const { ok, errors } = verifyEdgeFunctions(root);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('edge:check') && e.includes('index.ts'))).toBe(true);
  });

  test('les desactivations globales et directives interdites sont signalees', () => {
    expect(checkEntrypointContent('f', 'Deno.serve(() => {});')).toEqual([]);
    expect(checkEntrypointContent('f', '// @ts-nocheck\nDeno.serve(() => {});')).toContain('f: @ts-nocheck interdit');
    expect(checkEntrypointContent('f', '// deno-lint-ignore-file\nDeno.serve(() => {});')).toContain(
      'f: deno-lint-ignore-file interdit',
    );
    expect(checkEntrypointContent('f', 'const x = 1; // no serve here')).toContain("f: point d'entree sans Deno.serve");
    // Une suppression CIBLEE d'une seule ligne reste autorisee.
    expect(checkEntrypointContent('f', '// eslint-disable-next-line\nDeno.serve(() => {});')).toEqual([]);
  });

  test('declaredFunctions extrait les sections [functions.*]', () => {
    const toml = '[api]\nenabled = true\n[functions.a-b]\nverify_jwt = false\n[functions.c]\n';
    expect(declaredFunctions(toml)).toEqual(['a-b', 'c']);
  });
});
