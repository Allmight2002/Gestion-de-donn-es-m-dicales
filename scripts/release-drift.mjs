// Controle distant reel. Echoue ferme sans credentials et produit, sur demande,
// une preuve JSON liant SHA Git, migrations, Storage et bundles Edge effectivement actifs.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = ['SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'];
const missingEnvironment = required.filter((key) => !process.env[key]);
if (missingEnvironment.length > 0) {
  console.error(`Drift non verifiable: variables manquantes (${missingEnvironment.join(', ')}).`);
  process.exit(1);
}

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!/^[a-z0-9]{20}$/i.test(projectRef)) {
  console.error('Drift non verifiable: SUPABASE_PROJECT_REF invalide.');
  process.exit(1);
}

const cliPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'supabase', 'package.json'), 'utf8'));
const expectedCliVersion = process.env.SUPABASE_CLI_VERSION ?? cliPackage.version;
if (cliPackage.version !== expectedCliVersion) {
  console.error(
    `Drift non verifiable: Supabase CLI locale ${cliPackage.version}, version attendue ${expectedCliVersion}.`,
  );
  process.exit(1);
}

const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => name.slice(0, 14))
  .sort();
const functions = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith('_') &&
      existsSync(join(root, 'supabase', 'functions', entry.name, 'index.ts')),
  )
  .map((entry) => entry.name)
  .sort();
const storageSha = createHash('sha256')
  .update(readFileSync(join(root, 'supabase', 'storage.sql')))
  .digest('hex');
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const errors = [];
const fail = (message) => {
  errors.push(message);
  console.error(`Drift detecte: ${message}`);
};

let databaseEvidence = null;
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
});
try {
  await client.connect();
  const { rows } = await client.query(
    'select version from supabase_migrations.schema_migrations order by version',
  );
  const remote = rows.map((row) => String(row.version));
  const missing = migrations.filter((version) => !remote.includes(version));
  const extra = remote.filter((version) => !migrations.includes(version));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`migrations divergentes (manquantes=${missing.length}, inconnues=${extra.length})`);
  }

  const checks = await client.query(
    `select
       to_regprocedure('public.require_server_inspection()') is not null as strict_fn,
       exists(select 1 from pg_policies where schemaname = 'storage') as storage_policies,
       (select count(*) = 4
          from storage.buckets
         where id = any(array[
           'raw-documents',
           'clinical-attachments',
           'scientific-exports',
           'quarantined-uploads'
         ])) as storage_buckets`,
  );
  if (!checks.rows[0].strict_fn || !checks.rows[0].storage_policies || !checks.rows[0].storage_buckets) {
    throw new Error('RPC stricte, buckets ou policies Storage attendus absents');
  }

  const component = await client.query(
    `select sha256, applied_at
       from public.release_component_state
      where component = 'storage.sql'`,
  );
  if (component.rows.length !== 1 || component.rows[0].sha256 !== storageSha) {
    throw new Error('empreinte distante de storage.sql absente ou divergente');
  }

  databaseEvidence = {
    migrationCount: remote.length,
    lastMigration: remote.at(-1) ?? null,
    storageSha256: component.rows[0].sha256,
    storageAppliedAt: component.rows[0].applied_at,
  };
  console.log(
    `Migrations et Storage distants OK (${remote.length} migrations, sha256=${storageSha}).`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : 'verification PostgreSQL impossible');
} finally {
  await client.end().catch(() => {});
}

let edgeFunctions = [];
try {
  const cliEntrypoint = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const reportedVersion = execFileSync(process.execPath, [cliEntrypoint, '--version'], {
    cwd: root,
    env: { ...process.env, DO_NOT_TRACK: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (reportedVersion !== expectedCliVersion) {
    throw new Error(`Supabase CLI executee=${reportedVersion}, attendue=${expectedCliVersion}`);
  }

  const output = execFileSync(
    process.execPath,
    [
      cliEntrypoint,
      'functions',
      'list',
      '--project-ref',
      projectRef,
      '--output',
      'json',
    ],
    {
      cwd: root,
      env: { ...process.env, DO_NOT_TRACK: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    },
  );
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error('inventaire Edge JSON invalide');

  edgeFunctions = parsed
    .map((entry) => ({
      slug: String(entry.slug ?? entry.name ?? ''),
      version: Number(entry.version),
      status: String(entry.status ?? ''),
      ezbrSha256: String(entry.ezbr_sha256 ?? ''),
      verifyJwt: entry.verify_jwt === true,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const remoteNames = edgeFunctions.map((entry) => entry.slug);
  const missing = functions.filter((name) => !remoteNames.includes(name));
  const extra = remoteNames.filter((name) => !functions.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`inventaire Edge divergent (manquantes=${missing.join(',') || '-'}, inconnues=${extra.join(',') || '-'})`);
  }
  const invalid = edgeFunctions.filter(
    (entry) =>
      entry.status !== 'ACTIVE' ||
      !Number.isInteger(entry.version) ||
      entry.version < 1 ||
      !/^[0-9a-f]{64}$/.test(entry.ezbrSha256),
  );
  if (invalid.length > 0) {
    throw new Error(`Edge Functions inactives ou sans empreinte: ${invalid.map((entry) => entry.slug).join(', ')}`);
  }

  const expectedInventoryPath = process.env.EXPECTED_EDGE_INVENTORY_FILE;
  if (expectedInventoryPath) {
    const expectedDocument = JSON.parse(readFileSync(expectedInventoryPath, 'utf8'));
    if (!Array.isArray(expectedDocument)) {
      if (expectedDocument.ok !== true || expectedDocument.gitSha !== gitSha) {
        throw new Error('preuve Edge staging en echec ou issue d un autre SHA Git');
      }
    }
    const expectedInventory = Array.isArray(expectedDocument)
      ? expectedDocument
      : expectedDocument.edgeFunctions;
    if (!Array.isArray(expectedInventory)) throw new Error('preuve Edge staging invalide');
    const expectedBySlug = new Map(expectedInventory.map((entry) => [entry.slug, entry]));
    const divergent = edgeFunctions.filter((entry) => {
      const expected = expectedBySlug.get(entry.slug);
      return (
        !expected ||
        expected.ezbrSha256 !== entry.ezbrSha256 ||
        Boolean(expected.verifyJwt) !== entry.verifyJwt
      );
    });
    if (divergent.length > 0 || expectedBySlug.size !== edgeFunctions.length) {
      throw new Error(
        `bundles Edge differents de la preuve staging: ${divergent.map((entry) => entry.slug).join(', ') || 'inventaire'}`,
      );
    }
  }

  console.log(
    `Edge Functions distantes OK: ${edgeFunctions.map((entry) => `${entry.slug}@${entry.version}:${entry.ezbrSha256}`).join(', ')}.`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : 'verification Edge Functions impossible');
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectRef,
  gitSha,
  supabaseCliVersion: expectedCliVersion,
  storageSha256: storageSha,
  database: databaseEvidence,
  edgeFunctions,
  ok: errors.length === 0,
  errors,
};

if (process.env.RELEASE_DRIFT_OUTPUT) {
  const outputPath = process.env.RELEASE_DRIFT_OUTPUT;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Preuve de drift ecrite: ${outputPath}`);
}

if (errors.length > 0) process.exitCode = 1;
