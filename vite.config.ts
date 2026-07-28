import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertOfflineBuildPolicy } from './scripts/offline-build-policy.mjs';

// Version applicative = celle de package.json (source unique) -> injectee comme __APP_VERSION__.
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const git = (command: string) => {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const envCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? '';
const envBranch = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GITHUB_REF_NAME ?? process.env.BRANCH_NAME ?? '';
const rawGitBranch = envBranch || git('git branch --show-current') || git('git rev-parse --abbrev-ref HEAD');
const buildCommit = (envCommit ? envCommit.slice(0, 12) : git('git rev-parse --short=12 HEAD')) || 'unknown';
const buildBranch = rawGitBranch && rawGitBranch !== 'HEAD' ? rawGitBranch : 'unknown';
const buildTime = process.env.BUILD_TIME ?? new Date().toISOString();

// PWA installable (cahier §1, §17.15) — SANS hors-ligne avance (hors perimetre §5).
export default defineConfig(({ mode }) => {
  // §5.7 — En PRODUCTION, la lecture des fichiers prives (images cliniques, documents bruts) DOIT
  // passer par la fonction Edge `signed-read` (autorisation RLS + audit_log + signature serveur).
  // Si le drapeau n'est pas arme, on REFUSE le build de production -> impossible d'expedier par
  // megarde le repli de signature client (non audite). En dev/test, le repli reste autorise.
  const env = loadEnv(mode, process.cwd(), '');
  assertOfflineBuildPolicy(env, mode);
  if (mode === 'production' && env.VITE_USE_SIGNED_READ !== 'true') {
    throw new Error(
      "Build de production refuse : VITE_USE_SIGNED_READ doit valoir 'true' (lecture de fichiers " +
        "auditee via la fonction Edge signed-read). Definissez cette variable d'environnement " +
        '(Vercel : Production ET Preview) avant de deployer.',
    );
  }
  if (env.VITE_REQUIRE_SERVER_INSPECTION === 'true' && env.VITE_USE_SIGNED_READ !== 'true') {
    throw new Error(
      "Configuration refusee : VITE_REQUIRE_SERVER_INSPECTION='true' exige aussi " +
        "VITE_USE_SIGNED_READ='true' pour bloquer la lecture des fichiers non acceptes par le serveur.",
    );
  }
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __GIT_COMMIT__: JSON.stringify(buildCommit),
      __GIT_BRANCH__: JSON.stringify(buildBranch),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
  // §6.1 — les Web Workers sont des modules ES : autorise le code-splitting (import dynamique de
  // xlsx dans le worker de parsing) ; sans cela, le format IIFE par defaut casse le build.
    worker: { format: 'es' as const },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg'],
        // Le tableur (SheetJS) reste TELECHARGEABLE A LA DEMANDE mais sort du PRECACHE : il pese
        // ~856 Ko a lui seul (une copie pour le thread principal, une pour le worker de parsing),
        // soit la moitie de ce que le service worker tirait des la premiere visite. Or il ne sert
        // qu'a l'import d'un classeur, une action que la plupart des visites ne feront jamais, et
        // qui exige de toute facon le serveur (validation par `import_records`) : rien a gagner a
        // le tenir pret hors-ligne. Les deux fichiers restent servis normalement par le reseau au
        // moment ou l'utilisateur depose un fichier.
        workbox: {
          globIgnores: ['**/xlsx-*.js'],
        },
        manifest: {
          name: 'Registre clinique',
          short_name: 'Registre',
          description: 'Registre clinique structure pour la recherche',
          theme_color: '#0f766e',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          // Le fichier principal depassait 500 Ko, seuil d'alerte de l'outil de build : socle
          // (React, routeur) et client de base de donnees y voyageaient avec le code applicatif.
          // Les isoler donne deux gains : ils sont analyses separement, et surtout ils gardent
          // leur empreinte entre deux versions -> apres une mise a jour, le navigateur ne
          // retelecharge que le code qui a reellement change, pas le socle.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('@supabase')) return 'supabase';
            return undefined;
          },
        },
      },
    },
    server: { port: 5173 },
  };
});
