import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
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
    server: { port: 5173 },
  };
});
