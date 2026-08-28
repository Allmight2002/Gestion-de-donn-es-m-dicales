import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Deux projets de test :
//  * db  : tests de securite RLS sur PostgreSQL embarque (Node, en serie).
//  * web : tests de composants React (jsdom).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // Chaque fichier peut demarrer son propre PostgreSQL embarque. Les fichiers DB sont
          // donc serialises pour ne jamais saturer la machine ni partager un etat implicite.
          name: 'db',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          fileParallelism: false,
          maxWorkers: 1,
          hookTimeout: 180_000,
          testTimeout: 60_000,
        },
      },
      {
        plugins: [react(), VitePWA({ registerType: 'prompt', devOptions: { enabled: false } })],
        // __APP_VERSION__ est injecte au build ; on le definit aussi en test pour que l'ecran
        // d'etat du systeme se rende sans ReferenceError.
        define: {
          __APP_VERSION__: JSON.stringify('test'),
          __GIT_COMMIT__: JSON.stringify('test-commit'),
          __GIT_BRANCH__: JSON.stringify('test-branch'),
          __BUILD_TIME__: JSON.stringify('2026-07-07T00:00:00.000Z'),
        },
        test: {
          name: 'web',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test-setup.ts'],
          globals: true,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
