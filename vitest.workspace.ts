import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deux projets de test :
//  * db  : tests de securite RLS sur PostgreSQL embarque (Node, en serie).
//  * web : tests de composants React (jsdom).
export default defineWorkspace([
  {
    test: {
      // Chaque fichier qui demarre un Postgres embarque utilise un port aleatoire
      // (voir test/harness/db.ts) -> pas de collision meme en parallele.
      name: 'db',
      include: ['test/**/*.test.ts'],
      environment: 'node',
      hookTimeout: 180_000,
      testTimeout: 60_000,
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'web',
      include: ['src/**/*.test.tsx'],
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      globals: true,
    },
  },
]);
