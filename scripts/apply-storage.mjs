// Applique supabase/storage.sql (buckets prives + politiques RLS Storage) au Postgres
// LOCAL de Supabase. A lancer APRES `npm run supabase:start`, une seule fois.
// Les buckets et leurs politiques ne sont pas joues par `supabase db reset` (qui ne
// rejoue que les migrations + seed) ; ce script comble ce trou sans psql.
//
// Connexion : SUPABASE_DB_URL si defini, sinon la valeur locale par defaut de Supabase.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(HERE, '..', 'supabase', 'storage.sql'), 'utf8');
const url = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query(SQL);
  console.log('✓ storage.sql applique (buckets raw-documents / clinical-attachments / scientific-exports + RLS).');
} catch (e) {
  console.error('✗ Echec de l\'application de storage.sql :', e.message);
  console.error('  Verifiez que `npm run supabase:start` tourne (DB sur 127.0.0.1:54322).');
  process.exitCode = 1;
} finally {
  await client.end();
}
