// Snapshot GENERE de l'ETAT FINAL du schema (audit interne F-2) : les 50+ migrations sont
// forward-only, l'etat courant est donc illisible sans les rejouer. Ce script applique tout
// sur un PostgreSQL EMBARQUE neuf puis interroge les CATALOGUES pour produire un document
// relisible (tables/colonnes, policies RLS, triggers, fonctions) : docs/schema-etat-final.md.
//
//   npm run schema        (a relancer apres chaque nouvelle migration ; le manifeste de
//                          deploiement signale un eventuel retard)
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SHIM = join(ROOT, 'test', 'harness', '000_supabase_shim.sql');
const OUT = join(ROOT, 'docs', 'schema-etat-final.md');

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const lastMigration = files[files.length - 1];

const databaseDir = mkdtempSync(join(tmpdir(), 'schema-pg-'));
const port = 50000 + Math.floor(Math.random() * 10000);
const pg = new EmbeddedPostgres({
  databaseDir, user: 'postgres', password: 'postgres', port,
  persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

let failed = false;
await pg.initialise();
await pg.start();
const db = pg.getPgClient();
await db.connect();

try {
  await db.query(readFileSync(SHIM, 'utf8'));
  for (const f of files) await db.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

  const rows = async (sql) => (await db.query(sql)).rows;

  const tables = await rows(`
    select c.relname as table, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by c.relname`);
  const columns = await rows(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'public'
    order by table_name, ordinal_position`);
  const policies = await rows(`
    select tablename, policyname, cmd, roles, coalesce(qual,'') as qual, coalesce(with_check,'') as with_check
    from pg_policies where schemaname = 'public' order by tablename, policyname`);
  const triggers = await rows(`
    select c.relname as table, t.tgname as name, p.proname as fn,
           (t.tgtype::int & 2) > 0 as before,
           (t.tgtype::int & 4) > 0 as on_insert,
           (t.tgtype::int & 8) > 0 as on_delete,
           (t.tgtype::int & 16) > 0 as on_update
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and n.nspname = 'public' order by c.relname, t.tgname`);
  const functions = await rows(`
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as definer, l.lanname as lang
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f' order by p.proname, args`);

  const colsBy = new Map();
  for (const c of columns) {
    if (!colsBy.has(c.table_name)) colsBy.set(c.table_name, []);
    colsBy.get(c.table_name).push(c);
  }
  const polBy = new Map();
  for (const p of policies) {
    if (!polBy.has(p.tablename)) polBy.set(p.tablename, []);
    polBy.get(p.tablename).push(p);
  }
  const trgBy = new Map();
  for (const t of triggers) {
    if (!trgBy.has(t.table)) trgBy.set(t.table, []);
    trgBy.get(t.table).push(t);
  }

  const L = [];
  L.push('# Schéma — état final (GÉNÉRÉ, ne pas éditer)');
  L.push('');
  L.push('> Document **généré** par `npm run schema` : il montre l\'état RÉSULTANT de toutes les');
  L.push('> migrations (forward-only) sans avoir à les rejouer de tête. À régénérer après chaque');
  L.push('> nouvelle migration — `npm run manifest` signale s\'il est en retard.');
  L.push('');
  L.push(`- Dernière migration incluse : \`${lastMigration}\``);
  L.push(`- Tables : ${tables.length} · Policies RLS : ${policies.length} · Triggers : ${triggers.length} · Fonctions : ${functions.length}`);
  L.push('');
  L.push('## Tables (colonnes, RLS, policies, triggers)');
  for (const t of tables) {
    L.push('');
    L.push(`### ${t.table} ${t.rls ? '· RLS activée' : '· ⚠ SANS RLS'}`);
    L.push('');
    L.push('| Colonne | Type | Nullable | Défaut |');
    L.push('|---|---|---|---|');
    for (const c of colsBy.get(t.table) ?? []) {
      const def = (c.column_default ?? '').replace(/\|/g, '\\|');
      L.push(`| ${c.column_name} | ${c.data_type} | ${c.is_nullable === 'YES' ? 'oui' : 'non'} | ${def ? '`' + def + '`' : ''} |`);
    }
    const pols = polBy.get(t.table) ?? [];
    if (pols.length) {
      L.push('');
      L.push('Policies :');
      for (const p of pols) {
        const parts = [];
        if (p.qual) parts.push(`USING ${p.qual}`);
        if (p.with_check) parts.push(`WITH CHECK ${p.with_check}`);
        L.push(`- \`${p.policyname}\` (${p.cmd}) — ${parts.join(' · ') || '—'}`);
      }
    } else if (t.rls) {
      L.push('');
      L.push('Policies : *(aucune — table fermée aux clients, écrite par RPC/serveur seulement)*');
    }
    const trgs = trgBy.get(t.table) ?? [];
    if (trgs.length) {
      L.push('');
      L.push('Triggers :');
      for (const g of trgs) {
        const evts = [g.on_insert && 'INSERT', g.on_update && 'UPDATE', g.on_delete && 'DELETE'].filter(Boolean).join('/');
        L.push(`- \`${g.name}\` — ${g.before ? 'BEFORE' : 'AFTER'} ${evts} → \`${g.fn}()\``);
      }
    }
  }
  L.push('');
  L.push('## Fonctions (public)');
  L.push('');
  L.push('| Fonction | Arguments | Sécurité | Langage |');
  L.push('|---|---|---|---|');
  for (const f of functions) {
    L.push(`| ${f.name} | ${f.args.replace(/\|/g, '\\|') || '—'} | ${f.definer ? 'DEFINER' : 'INVOKER'} | ${f.lang} |`);
  }
  L.push('');

  writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log(`✓ ${OUT.replace(ROOT + '\\', '').replace(ROOT + '/', '')} généré (${tables.length} tables, ${policies.length} policies, ${triggers.length} triggers, ${functions.length} fonctions ; jusqu'à ${lastMigration}).`);
} catch (e) {
  failed = true;
  console.error('✗ Échec de génération : ' + e.message);
} finally {
  await db.end();
  await pg.stop();
  try { rmSync(databaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* purge OS */ }
  process.exit(failed ? 1 : 0);
}
