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
      // Les tests UI (userEvent) tournent en parallele du projet 'db' (PostgreSQL embarque,
      // lourd) : sous contention, les interactions les plus lentes peuvent depasser le
      // timeout par defaut (5 s). On l'augmente pour eviter des echecs de timing non
      // deterministes (les assertions doivent quand meme finir par passer).
      testTimeout: 20_000,
    },
  },
]);
