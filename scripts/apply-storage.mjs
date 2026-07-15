// Applique supabase/storage.sql (buckets prives + politiques RLS Storage) au Postgres
// cible, puis enregistre son empreinte distante. A lancer APRES les migrations.
// Les buckets et leurs politiques ne sont pas joues par `supabase db reset` (qui ne
// rejoue que les migrations + seed) ; ce script comble ce trou sans psql.
//
// Connexion : SUPABASE_DB_URL si defini, sinon le Postgres local par defaut de Supabase.
// NB : pas d'URL litterale user:password@ dans ce fichier — le controle de securite de
// Repomix (secretlint) EXCLUT silencieusement tout fichier qui en contient une, ce qui
// rendait ce script inauditable dans les paquets transmis (audit v18 §6.1). La forme
// objet de pg.Client a exactement le meme effet (postgres/postgres est le mot de passe
// local par defaut du CLI Supabase, pas un secret).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(HERE, '..', 'supabase', 'storage.sql'), 'utf8');
const SHA256 = createHash('sha256').update(SQL).digest('hex');
const url = process.env.SUPABASE_DB_URL || '';

const client = url
  ? new pg.Client({ connectionString: url })
  : new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
try {
  await client.connect();
  await client.query('begin');
  await client.query(SQL);
  const { rows } = await client.query("select count(*)::int as buckets from storage.buckets where id = any(array['raw-documents','clinical-attachments','scientific-exports','quarantined-uploads'])");
  const policies = await client.query("select count(*)::int as policies from pg_policies where schemaname='storage'");
  if (rows[0].buckets !== 4 || policies.rows[0].policies < 1) throw new Error('post-verification Storage incomplete (buckets ou policies absents)');
  await client.query(
    `insert into public.release_component_state (component, sha256, applied_at, applied_by)
     values ('storage.sql', $1, now(), current_user)
     on conflict (component) do update
       set sha256 = excluded.sha256,
           applied_at = excluded.applied_at,
           applied_by = excluded.applied_by`,
    [SHA256],
  );
  const state = await client.query(
    "select sha256 from public.release_component_state where component = 'storage.sql'",
  );
  if (state.rows[0]?.sha256 !== SHA256) throw new Error('empreinte distante de storage.sql non enregistree');
  await client.query('commit');
  console.log(`✓ storage.sql applique et verifie (4 buckets, ${policies.rows[0].policies} policies, sha256=${SHA256}).`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('✗ Echec de l\'application de storage.sql :', e.message);
  if (url) {
    // Mode CLOUD (audit v19 §6.2) : ne pas renvoyer vers le Supabase local.
    console.error('  Cible : SUPABASE_DB_URL. Verifiez la chaine de connexion (dashboard Supabase > Connect, Session pooler) et les droits du role.');
  } else {
    console.error('  Verifiez que `npm run supabase:start` tourne (DB sur 127.0.0.1:54322).');
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
