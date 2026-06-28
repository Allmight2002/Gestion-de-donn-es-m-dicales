import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deux projets de test :
//  * db  : tests de securite RLS sur PostgreSQL embarque (Node, en serie).
//  * web : tests de composants React (jsdom).
export default defineWorkspace([
  {
    test: {
      // Chaque fichier demarre SON Postgres embarque. Lancer plusieurs instances en parallele
      // sature la machine (lenteurs, processus residuels) -> on SERIALISE les fichiers du projet
      // db (audit §11.2). Les ports restent aleatoires (test/harness/db.ts) par precaution.
      name: 'db',
      include: ['test/**/*.test.ts'],
      environment: 'node',
      // Fichiers en SERIE (un seul fork) : une seule instance Postgres embarquee a la fois,
      // sinon plusieurs instances simultanees saturent la machine (audit §11.2).
      poolOptions: { forks: { singleFork: true } },
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
