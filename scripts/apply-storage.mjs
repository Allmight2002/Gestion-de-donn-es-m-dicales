// Applique supabase/storage.sql (buckets prives + politiques RLS Storage) au Postgres
// LOCAL de Supabase. A lancer APRES `npm run supabase:start`, une seule fois.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(HERE, '..', 'supabase', 'storage.sql'), 'utf8');
const url = process.env.SUPABASE_DB_URL || '';

const client = url
  ? new pg.Client({ connectionString: url })
  : new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
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
