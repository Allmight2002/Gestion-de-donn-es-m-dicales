// Verification « apply a blanc » : applique, sur un PostgreSQL EMBARQUE tout neuf, le shim
// Supabase puis TOUTES les migrations (dans l'ordre des noms de fichiers, comme
// `supabase db push`) puis le seed — et affiche un resume. Prouve, hors suite de tests, que
// le jeu de migrations se deploie PROPREMENT DEPUIS ZERO (cf. audit 4.7).
//
//   npm run db:verify
//
// NB : `storage.sql` n'est PAS inclus (il requiert le schema `storage` fourni par Supabase ;
// il s'applique separement sur le vrai projet — voir docs/deploiement.md §2).
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SHIM = join(ROOT, 'test', 'harness', '000_supabase_shim.sql');
const SEED = join(ROOT, 'supabase', 'seed.sql');

const databaseDir = mkdtempSync(join(tmpdir(), 'verify-pg-'));
const port = 50000 + Math.floor(Math.random() * 10000);
const pg = new EmbeddedPostgres({
  databaseDir, user: 'postgres', password: 'postgres', port,
  persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

let failed = false;
const t0 = Date.now();
await pg.initialise();
await pg.start();
const db = pg.getPgClient();
await db.connect();

async function apply(label, sql) {
  try {
    await db.query(sql);
    console.log('  ✓ ' + label);
  } catch (e) {
    failed = true;
    console.error('  ✗ ' + label + '  ->  ' + e.message);
    throw e;
  }
}

try {
  console.log('Application du shim + migrations (ordre des noms) + seed :');
  await apply('shim Supabase (test)', readFileSync(SHIM, 'utf8'));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await apply(f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  await apply('seed.sql', readFileSync(SEED, 'utf8'));

  const one = async (sql) => (await db.query(sql)).rows[0].n;
  const tables = await one("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
  const funcs = await one("select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'");
  const policies = await one("select count(*)::int n from pg_policies where schemaname='public'");
  const triggers = await one('select count(*)::int n from pg_trigger where not tgisinternal');
  const profiles = (await db.query("select global_role, count(*)::int n from public.profiles group by global_role order by global_role")).rows;
  const patients = await one('select count(*)::int n from public.patient');
  const encounters = await one('select count(*)::int n from public.encounter');
  const fields = await one('select count(*)::int n from public.template_field');

  console.log('\nSchema applique depuis zero — resume :');
  console.log(`  tables (public)     : ${tables}`);
  console.log(`  fonctions (public)  : ${funcs}`);
  console.log(`  policies RLS        : ${policies}`);
  console.log(`  triggers            : ${triggers}`);
  console.log('\nDonnees de demo (seed) :');
  console.log('  profils par role    : ' + profiles.map((r) => `${r.global_role}=${r.n}`).join(', '));
  console.log(`  patients            : ${patients}`);
  console.log(`  rencontres          : ${encounters}`);
  console.log(`  champs de gabarit   : ${fields}`);
  console.log(`\n✓ Le jeu de ${files.length} migrations s'applique PROPREMENT depuis zero (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
} catch {
  console.error('\n✗ Echec : le jeu de migrations NE s\'applique PAS proprement depuis zero (voir ci-dessus).');
} finally {
  await db.end();
  await pg.stop();
  try { rmSync(databaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* purge OS */ }
  process.exit(failed ? 1 : 0);
}
