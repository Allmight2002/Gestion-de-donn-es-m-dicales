// Controle distant reel. Il echoue ferme sans credentials et ne pretend pas verifier ce que l'API n'expose pas.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = ['SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'];
for (const key of required) if (!process.env[key]) { console.error(`Drift non verifiable: ${key} manquant.`); process.exit(1); }
const supabaseCliVersion = process.env.SUPABASE_CLI_VERSION ?? '2.109.1';
if (!/^\d+\.\d+\.\d+$/.test(supabaseCliVersion)) { console.error('Drift non verifiable: SUPABASE_CLI_VERSION invalide.'); process.exit(1); }
if (!/^[a-z0-9]{20}$/i.test(process.env.SUPABASE_PROJECT_REF)) { console.error('Drift non verifiable: SUPABASE_PROJECT_REF invalide.'); process.exit(1); }
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((n) => n.endsWith('.sql')).map((n) => n.slice(0, 14)).sort();
const functions = readdirSync(join(root, 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')
    && existsSync(join(root, 'supabase/functions', entry.name, 'index.ts')))
  .map((entry) => entry.name).sort();
const storageSha = createHash('sha256').update(readFileSync(join(root, 'supabase/storage.sql'))).digest('hex');
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
try {
  await client.connect();
  const { rows } = await client.query('select version from supabase_migrations.schema_migrations order by version');
  const remote = rows.map((r) => String(r.version));
  const missing = migrations.filter((v) => !remote.includes(v));
  const extra = remote.filter((v) => !migrations.includes(v));
  if (missing.length || extra.length) throw new Error(`migrations divergentes (manquantes=${missing.length}, inconnues=${extra.length})`);
  const checks = await client.query("select to_regprocedure('public.require_server_inspection()') is not null as strict_fn, exists(select 1 from pg_policies where schemaname='storage') as storage_policies");
  if (!checks.rows[0].strict_fn || !checks.rows[0].storage_policies) throw new Error('RPC ou policies Storage attendues absentes');
  console.log(`Migrations et schema distant OK (${remote.length} migrations).`);
  console.log(`Preuve Storage requise: SHA-256 depot=${storageSha}; l'API Postgres ne conserve pas le checksum de storage.sql. Verifiez le rapport d'application joint a cette release.`);
} catch (error) { console.error(`Drift detecte: ${error.message}`); process.exitCode = 1; } finally { await client.end().catch(() => {}); }
// Le CLI est utilise apres authentification pour obtenir l'inventaire effectivement deploye.
const command = `npx --yes supabase@${supabaseCliVersion} functions list --project-ref ${process.env.SUPABASE_PROJECT_REF}`;
const { execSync } = await import('node:child_process');
try {
  const output = execSync(command, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const missing = functions.filter((name) => !output.includes(name));
  if (missing.length) throw new Error(`Edge Functions absentes: ${missing.join(', ')}`);
  console.log(`Inventaire Edge Functions distant OK: ${functions.join(', ')}.`);
} catch (error) { console.error(`Verification Edge Functions impossible ou incomplete: ${error.message}`); process.exitCode = 1; }
