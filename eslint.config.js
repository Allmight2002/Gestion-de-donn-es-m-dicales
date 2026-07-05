// ESLint (audit interne F-6) — filet complementaire de tsc et des tests : detecte les
// TOURNURES a risque (dependance de hook oubliee / closure perimee comme §7.2, promesse
// non geree, variable morte) pendant l'ecriture, avant qu'elles ne deviennent des bugs.
// Outil de DEV uniquement : rien n'entre dans le bundle de production.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'coverage/**',
      // Runtime Deno (imports jsr:, globals Deno) : hors perimetre du lint Node/navigateur.
      'supabase/functions/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // LA regle qui aurait signale la famille de bugs §7.2 (closure de hook perimee).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Convention du projet : un prefixe `_` marque une valeur volontairement ignoree.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Scripts Node (ESM) + tests + configs : globals Node en plus du navigateur (jsdom).
    files: ['scripts/**/*.mjs', 'services/**/*.mjs', 'test/**/*.ts', '*.config.js', '*.config.ts', 'vitest.workspace.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
