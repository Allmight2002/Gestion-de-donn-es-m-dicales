// Manifeste de DEPLOIEMENT (audit v12 P2) : fige « ce qui DOIT etre en ligne » — commit,
// migrations, fonctions Edge, storage.sql, variables d'environnement — et fournit les
// requetes pour COMPARER avec ce qui est reellement applique sur le cloud. Objectif :
// eliminer le drift front/BD (« as-tu pense au db push ? ») releve a chaque audit.
//
//   npm run manifest      -> affiche le manifeste + ecrit deploy-manifest.json (non versionne)
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const git = (args) => execSync(`git ${args}`, { cwd: ROOT }).toString().trim();

const migrations = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const lastMigration = migrations[migrations.length - 1];
// `_shared` = code partage entre fonctions (convention Supabase), non deployable : exclu ici comme
// dans le workflow et scripts/verify-edge-functions.mjs, pour que le manifeste liste les 5 vraies fonctions.
const edgeFunctions = readdirSync(join(ROOT, 'supabase', 'functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort();
const storageSha = createHash('sha256').update(readFileSync(join(ROOT, 'supabase', 'storage.sql'))).digest('hex').slice(0, 12);

// Le snapshot docs/schema-etat-final.md embarque le nom de la derniere migration incluse :
// s'il differe, le document est EN RETARD -> relancer `npm run schema`.
const schemaPath = join(ROOT, 'docs', 'schema-etat-final.md');
let schemaState = 'ABSENT (lancer `npm run schema`)';
if (existsSync(schemaPath)) {
  const m = readFileSync(schemaPath, 'utf8').match(/Dernière migration incluse : `([^`]+)`/);
  schemaState = m && m[1] === lastMigration ? `à jour (${m[1]})` : `EN RETARD (contient ${m?.[1] ?? '?'}, attendu ${lastMigration}) -> npm run schema`;
}

const manifest = {
  generatedAt: new Date().toISOString(),
  // Provenance de release : renseignee par le workflow (variables GITHUB_* + RELEASE_TARGET), nulle en local.
  release: {
    target: process.env.RELEASE_TARGET ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runnerSha: process.env.GITHUB_SHA ?? null,
  },
  git: {
    commit: git('rev-parse --short HEAD'),
    sha: git('rev-parse HEAD'),
    branch: git('rev-parse --abbrev-ref HEAD'),
    dirty: git('status --porcelain') !== '',
  },
  database: {
    migrationCount: migrations.length,
    lastMigration,
    migrations,
    checkOnCloud: "select count(*) as appliquees, max(version) as derniere from supabase_migrations.schema_migrations;",
    applyCommand: 'npx supabase db push',
  },
  storage: {
    file: 'supabase/storage.sql',
    sha256_12: storageSha,
    note: 'A re-executer dans le SQL Editor du cloud a chaque modification (les buckets ne sont pas migres par db push).',
  },
  edgeFunctions: {
    expected: edgeFunctions,
    deployCommand: edgeFunctions.map((f) => `npx supabase functions deploy ${f} --import-map deno.json`).join(' && '),
    inspectionPolicyCheckCommand: 'npm run env:check',
    requiredSecrets: [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CLAMAV_SCAN_URL (si REQUIRE_SERVER_INSPECTION=true)',
      'CLAMAV_SCAN_TOKEN (si REQUIRE_SERVER_INSPECTION=true)',
      'REQUIRE_SERVER_INSPECTION=true (donnees reelles)',
      'QUARANTINE_BUCKET=quarantined-uploads (donnees reelles)',
    ],
  },
  frontend: {
    host: 'Vercel (production = branche main)',
    requiredEnv: [
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      "VITE_USE_SIGNED_READ='true' (Production ET Preview)",
      "VITE_REQUIRE_SERVER_INSPECTION='true' (donnees reelles + ClamAV)",
    ],
    securityHeaders: existsSync(join(ROOT, 'vercel.json')) ? 'vercel.json present' : 'vercel.json MANQUANT',
  },
  schemaSnapshot: schemaState,
};

writeFileSync(join(ROOT, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('Manifeste de déploiement — ' + manifest.git.commit + ' (' + manifest.git.branch + (manifest.git.dirty ? ', ARBRE MODIFIÉ' : '') + ')');
console.log('  Release         : cible ' + (manifest.release.target ?? 'locale') + ' · workflow ' + (manifest.release.workflow ?? 'local') + ' · run ' + (manifest.release.runId ?? 'n/a'));
console.log('');
console.log('  Base de données : ' + manifest.database.migrationCount + ' migrations, dernière = ' + lastMigration);
console.log('    → appliquer   : ' + manifest.database.applyCommand);
console.log('    → vérifier    : ' + manifest.database.checkOnCloud);
console.log('  Storage         : storage.sql sha256[' + storageSha + '] (ré-exécuter dans le SQL Editor si modifié)');
console.log('  Fonctions Edge  : ' + edgeFunctions.join(', '));
console.log('    → déployer    : ' + manifest.edgeFunctions.deployCommand);
console.log('    → verifier env: ' + manifest.edgeFunctions.inspectionPolicyCheckCommand);
console.log('  Frontend        : ' + manifest.frontend.securityHeaders + ' ; env requis : ' + manifest.frontend.requiredEnv.join(' · '));
console.log('  Snapshot schéma : ' + schemaState);
console.log('');
console.log('✓ deploy-manifest.json écrit (non versionné — instantané de release).');
if (manifest.git.dirty) console.log('⚠ Arbre de travail modifié : le manifeste ne correspond pas à un commit exact.');
if (schemaState.startsWith('EN RETARD') || schemaState.startsWith('ABSENT')) process.exitCode = 1;
