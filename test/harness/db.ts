// =============================================================================
// test/harness/db.ts
// Boote un PostgreSQL REEL embarque (sans Docker), applique le shim Supabase puis
// les MEMES migrations que celles destinees a Supabase, et expose des aides pour
// exercer la RLS au niveau base de donnees.
//
//   * `admin` : connexion superutilisateur (postgres) = equivalent service_role
//               (contourne la RLS) -> mise en place des fixtures.
//   * `asUser(uid, fn)` : execute fn() en tant qu'utilisateur authentifie (RLS
//               appliquee), en posant le claim JWT comme le ferait Supabase.
// =============================================================================
import EmbeddedPostgres from 'embedded-postgres';
import type { Client } from 'pg';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SHIM = join(HERE, '000_supabase_shim.sql');
const SEED = join(ROOT, 'supabase', 'seed.sql');

export interface TestDb {
  pg: EmbeddedPostgres;
  admin: Client;
  /** Execute une fonction en tant qu'utilisateur authentifie (RLS appliquee). */
  asUser<T>(uid: string, fn: (c: Client) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

export async function startTestDb(opts: { seed?: boolean } = {}): Promise<TestDb> {
  const databaseDir = mkdtempSync(join(tmpdir(), 'rls-pg-'));
  const port = 50000 + Math.floor(Math.random() * 10000);

  // persistent:true => embedded-postgres ne tente PAS de supprimer le data dir au
  // stop (sous Windows, le verrou fichier provoque sinon un EBUSY intermittent).
  // On nettoie nous-memes, avec retries, dans stop().
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  await pg.initialise();
  await pg.start();

  const admin = pg.getPgClient();
  await admin.connect();

  // 1) shim (test-only)  2) migrations (reelles)  3) seed (optionnel)
  await admin.query(readFileSync(SHIM, 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  if (opts.seed) {
    await admin.query(readFileSync(SEED, 'utf8'));
  }

  // Chaque appel asUser ouvre une connexion DEDIEE (puis la ferme). C'est le
  // patron robuste pour tester la RLS : on evite tout etat residuel partage
  // (plans, GUC) sur une connexion longue duree, qui faisait echouer a tort le
  // WITH CHECK d'un INSERT. La connexion devient `authenticated` avec le claim JWT
  // (sub = id utilisateur), exactement comme une requete Supabase.
  const asUser: TestDb['asUser'] = async (uid, fn) => {
    const c = pg.getPgClient();
    await c.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await c.query('set local role authenticated');
      try {
        const result = await fn(c);
        await c.query('commit');
        return result;
      } catch (err) {
        await c.query('rollback');
        throw err;
      }
    } finally {
      await c.end();
    }
  };

  return {
    pg,
    admin,
    asUser,
    async stop() {
      await admin.end();
      await pg.stop();
      // Nettoyage best-effort du data dir temporaire (retries pour le verrou Windows).
      try {
        rmSync(databaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* data dir temporaire residuel : sans consequence, l'OS le purgera */
      }
    },
  };
}
