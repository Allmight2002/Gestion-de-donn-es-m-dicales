import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { dumpSubprocessEnvironment, runSupabaseDump } from './coordinated-backup.mjs';
import { isLoopbackStorageUrl, validateStorageRestoreTarget } from './storage-object-backup.mjs';

import { buildManagedSchemaPlan } from './reconcile-managed-schemas.mjs';
import { publicSchemaAccessSql } from './public-schema-access.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export function validateIsolatedRestoreConfiguration(env = process.env) {
  if (env.RECOVERY_ALLOW_LOCAL_RESTORE !== 'true' || env.RECOVERY_DATA_CLASSIFICATION !== 'fictitious-only') {
    throw new Error('Exercice refuse sans confirmation locale et classification fictitious-only.');
  }
  let database;
  try { database = new URL(env.TARGET_SUPABASE_DB_URL); } catch { throw new Error('URL DB cible invalide.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
      || !database.port || database.search || database.hash) {
    throw new Error('La restauration DB exige une cible loopback explicite sans options URL.');
  }
  if (!isLoopbackStorageUrl(env.TARGET_SUPABASE_URL)) throw new Error('La cible Storage doit etre locale.');
  validateStorageRestoreTarget(env.TARGET_SUPABASE_URL);
  // Prevent an overriding Storage URL from redirecting the subprocess elsewhere.
  if (env.TARGET_STORAGE_API_URL || env.STORAGE_RESTORE_ALLOW_INVENTORY_MISMATCH === 'true') {
    throw new Error('Surcharge Storage ou inventaire divergent refuse pour cet exercice.');
  }
  return database;
}

async function main() {
  const database = validateIsolatedRestoreConfiguration();
  const backup = process.argv.find((arg) => arg.startsWith('--backup='))?.slice(9);
  if (!backup) throw new Error('--backup est requis.');
  const backupRoot = resolve(backup);
  const started = new Date();
  const execute = (script, args, extraEnv = {}) => execFileSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000,
  });
  // Verify every encrypted file before opening a write-capable target connection.
  execute('coordinated-backup.mjs', ['verify', `--backup=${backupRoot}`]);
  const header = JSON.parse(await readFile(join(backupRoot, 'backup-set.json'), 'utf8'));
  if (header.format !== 'meddata-coordinated-backup/v2') throw new Error('Restauration complete exige un backup v2.');
  const client = new pg.Client({ connectionString: process.env.TARGET_SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const publicTables = await client.query("select count(*)::int as n from pg_tables where schemaname='public'");
    const existing = await client.query('select (select count(*) from auth.users) + (select count(*) from storage.objects) + (select count(*) from storage.buckets) as n');
    if (publicTables.rows[0].n !== 0 || Number(existing.rows[0].n) !== 0) {
      throw new Error('La cible doit etre une instance Supabase neuve, sans table publique ni compte ni objet.');
    }
  } finally { await client.end(); }
  const extracted = await mkdtemp(join(tmpdir(), 'meddata-isolated-restore-'));
  const dumpDirectory = join(extracted, 'sql');
  try {
    execute('coordinated-backup.mjs', ['extract', `--backup=${backupRoot}`, `--output=${dumpDirectory}`], {
      BACKUP_ALLOW_PLAINTEXT_EXTRACTION: 'true',
    });
    const managedPlans = [];
    for (const schema of ['auth', 'storage']) {
      const pristine = join(extracted, `${schema}-pristine.sql`);
      runSupabaseDump(process.env.TARGET_SUPABASE_DB_URL, pristine, ['--schema', schema], `${schema}-schema`);
      managedPlans.push(buildManagedSchemaPlan(
        await readFile(join(dumpDirectory, `${schema}-schema.sql`), 'utf8'), await readFile(pristine, 'utf8'),
      ));
    }
    const managedFile = join(extracted, 'managed-reconciliation.sql');
    await writeFile(managedFile, managedPlans.join('\n'), { flag: 'wx', mode: 0o600 });
    const publicAccessFile = join(extracted, 'public-access.sql');
    await writeFile(publicAccessFile, publicSchemaAccessSql(await readFile(join(dumpDirectory, 'schema.sql'), 'utf8')), { flag: 'wx', mode: 0o600 });
    execFileSync('psql', [
      '--no-psqlrc', '--single-transaction', '--set=ON_ERROR_STOP=1',
      '--host', database.hostname.replace(/^\[|\]$/g, ''), '--port', database.port,
      '--username', decodeURIComponent(database.username), '--dbname', decodeURIComponent(database.pathname.slice(1)),
      '--file', join(dumpDirectory, 'roles.sql'), '--command', 'SET ROLE postgres',
      '--file', join(dumpDirectory, 'schema.sql'), '--file', publicAccessFile,
      '--command', 'RESET ROLE',
      '--file', managedFile,
      '--command', 'SET session_replication_role = replica', '--file', join(dumpDirectory, 'data.sql'),
      '--command', 'SET session_replication_role = origin',
    ], { env: { ...dumpSubprocessEnvironment(), PGPASSWORD: decodeURIComponent(database.password) }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 });
    const metadataClient = new pg.Client({ connectionString: process.env.TARGET_SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    try {
      await metadataClient.connect();
      const objects = (await metadataClient.query('SELECT id, owner, owner_id, created_at::text, updated_at::text, last_accessed_at::text, metadata, user_metadata FROM storage.objects')).rows;
      execute('storage-object-backup.mjs', ['restore', `--backup=${join(backupRoot, 'storage-objects')}`]);
      // Storage generates a new backend version during upload. Preserve that version,
      // while restoring original ownership, timestamps and user-facing metadata.
      await metadataClient.query('BEGIN');
      await metadataClient.query('SET LOCAL session_replication_role = replica');
      for (const object of objects) {
        const result = await metadataClient.query(
          'UPDATE storage.objects SET owner=$2, owner_id=$3, created_at=$4, updated_at=$5, last_accessed_at=$6, metadata=$7, user_metadata=$8 WHERE id=$1',
          [object.id, object.owner, object.owner_id, object.created_at, object.updated_at, object.last_accessed_at, object.metadata, object.user_metadata],
        );
        if (result.rowCount !== 1) throw new Error('Metadonnee Storage perdue pendant la restauration.');
      }
      await metadataClient.query('COMMIT');
      await metadataClient.query("NOTIFY pgrst, 'reload schema'");
    } catch (error) {
      await metadataClient.query('ROLLBACK').catch(() => {}); throw error;
    } finally { await metadataClient.end(); }
    console.log(JSON.stringify({
      format: 'meddata-isolated-restore-execution/v1', startedAt: started.toISOString(),
      completedAt: new Date().toISOString(), elapsedSeconds: Math.ceil((Date.now() - started.getTime()) / 1000),
      databaseImportCompleted: true, managedSchemasReconciled: true, storageBytesVerified: true, storageMetadataReconciled: true,
      recoveryValidated: false, remainingChecks: ['accounts-login', 'rls', 'grants-policies', 'links-orphans', 'read-modify-file-open'],
    }));
  } finally { await rm(extracted, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Restauration isolee incomplete ou refusee (detail masque); la cible peut etre partiellement restauree.');
    process.exitCode = 1;
  });
}
