// Local-only drill driver. Credentials stay in memory; the encryption key and
// intermediate snapshots are kept outside the repository with private modes.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { runSupabaseDump } from './coordinated-backup.mjs';
import { canonicalDumpStatements } from './public-schema-access.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const run = '/tmp/meddata-recovery-exercise';
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8);
const resumeJourneys = process.argv.includes('--resume=journeys');
const cli = join(root, 'node_modules/supabase/dist/supabase.js');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const privateJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
function fixtureBytes(mime) {
  if (mime === 'image/jpeg') {
    return execFileSync('convert', ['-size', '32x32', 'xc:white', '-fill', 'blue', '-draw', 'rectangle 8,8 24,24', 'jpg:-']);
  }
  if (mime === 'application/pdf') {
    const stream = 'BT /F1 12 Tf 20 50 Td (MedData SYNTHETIC ONLY recovery fixture) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    for (const [i, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf);
  }
  throw new Error('Unsupported synthetic fixture MIME type.');
}
function execute(script, args, extraEnv = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root, env: { ...process.env, SUPABASE_INTERNAL_IMAGE_REGISTRY: 'docker.io', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30 * 60 * 1000,
  });
}
function status(kind) {
  return JSON.parse(execute(cli, ['status', '--workdir', `/tmp/meddata-recovery-${kind}`, '-o', 'json']));
}
function db(kind) {
  return new pg.Client({ host: '127.0.0.1', port: kind === 'source' ? 54322 : 55322,
    user: 'supabase_admin', password: 'postgres', database: 'postgres', connectionTimeoutMillis: 10_000 });
}
function api(kind, key) {
  return createClient(`http://127.0.0.1:${kind === 'source' ? 54321 : 55321}`, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function snapshots(client) {
  const tables = (await client.query("SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','auth','storage') AND tablename NOT IN ('schema_migrations','migrations') ORDER BY schemaname, tablename")).rows;
  const result = {};
  for (const t of tables) {
    const table = `${quote(t.schemaname)}.${quote(t.tablename)}`;
    const expression = t.schemaname === 'storage' && t.tablename === 'objects' ? "to_jsonb(t) - 'version'" : 'to_jsonb(t)';
    const rows = (await client.query(`SELECT (${expression})::text AS row FROM ${table} t ORDER BY (${expression})::text`)).rows;
    result[`${t.schemaname}.${t.tablename}`] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
async function prepare() {
  await mkdir(run, { recursive: true, mode: 0o700 });
  try {
    await access(join(run, 'exercise.key'));
    throw new Error('Source already prepared; refuse to overwrite an existing drill.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const st = status('source'), client = db('source');
  await client.connect();
  try {
    await client.query(await readFile(join(root, 'supabase/storage.sql'), 'utf8'));
    await client.query(`CREATE OR REPLACE FUNCTION auth.recovery_probe() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      REVOKE ALL ON FUNCTION auth.recovery_probe() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION auth.recovery_probe() TO authenticated;`);
    const admin = api('source', st.SERVICE_ROLE_KEY);
    const attachments = (await client.query('SELECT id, storage_path, mime_type, created_by FROM public.clinical_attachment')).rows;
    const documents = (await client.query('SELECT id, storage_path, mime_type, created_by FROM public.raw_document')).rows;
    const files = [];
    for (const [bucket, table, rows] of [['clinical-attachments', 'clinical_attachment', attachments], ['raw-documents', 'raw_document', documents]]) {
      for (const row of rows) {
        const bytes = fixtureBytes(row.mime_type);
        const result = await admin.storage.from(bucket).upload(row.storage_path, bytes, { contentType: row.mime_type, cacheControl: '60', upsert: true });
        assert.equal(result.error, null, 'Fixture upload failed');
        await client.query('UPDATE storage.objects SET owner=$1::uuid, owner_id=$1::text, user_metadata=$2 WHERE bucket_id=$3 AND name=$4', [row.created_by, { classification: 'fictitious-only' }, bucket, row.storage_path]);
        await client.query(`UPDATE public.${quote(table)} SET inspection_status='accepted', file_hash=$2, file_size=$3, inspected_at=now() WHERE id=$1`, [row.id, hash(bytes), bytes.length]);
        files.push({ bucket, path: row.storage_path, sha256: hash(bytes), bytes: bytes.length });
      }
    }
    const accounts = (await client.query("SELECT email FROM auth.users WHERE email LIKE '%@demo.test' ORDER BY email")).rows;
    for (const account of accounts) {
      const user = api('source', st.ANON_KEY);
      assert.equal((await user.auth.signInWithPassword({ email: account.email, password: 'Password123!' })).error, null, 'Source account login failed');
    }
    const baseline = await snapshots(client);
    for (const schema of ['auth', 'storage', 'public']) {
      runSupabaseDump(st.DB_URL, join(run, `${schema}-source.sql`), ['--schema', schema], schema === 'public' ? 'schema' : `${schema}-schema`);
    }
    await privateJson(join(run, 'baseline.json'), baseline);
    await privateJson(join(run, 'fixtures.json'), { files, attachmentId: attachments[0].id, accountCount: accounts.length });
    await writeFile(join(run, 'exercise.key'), randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ stage: 'source-prepared', accounts: accounts.length, files: files.length, tables: Object.keys(baseline).length }));
  } finally { await client.end(); }
}
async function backup() {
  const st = status('source');
  const env = { SUPABASE_PROJECT_REF: 'meddata-recovery-source', SUPABASE_URL: st.API_URL,
    SUPABASE_DB_URL: st.DB_URL, SUPABASE_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY,
    RECOVERY_ALLOW_LOCAL_BACKUP: 'true', RECOVERY_DATA_CLASSIFICATION: 'fictitious-only',
    BACKUP_KEY_ID: 'isolated-exercise-20261002', STORAGE_BACKUP_ENCRYPTION_KEY: await readFile(join(run, 'exercise.key'), 'utf8') };
  execute(join(root, 'scripts/coordinated-backup.mjs'), ['backup', '--target=isolated-local', `--output=${join(run, 'backup')}`], env);
  execute(join(root, 'scripts/coordinated-backup.mjs'), ['verify', `--backup=${join(run, 'backup')}`], env);
  const manifest = JSON.parse(await readFile(join(run, 'backup/backup-set.json'), 'utf8'));
  await privateJson(join(run, 'timing.json'), { backupStartedAt: manifest.startedAt, backupCompletedAt: manifest.completedAt,
    incidentAt: new Date().toISOString(), recoveryStartedAt: new Date().toISOString() });
  console.log(JSON.stringify({ stage: 'backup-verified', exports: manifest.databaseFiles.length, format: manifest.format }));
}
async function restore() {
  const st = status('target');
  const databaseUrl = new URL(st.DB_URL);
  databaseUrl.username = 'supabase_admin';
  const output = execute(join(root, 'scripts/restore-isolated.mjs'), [`--backup=${join(run, 'backup')}`], {
    RECOVERY_ALLOW_LOCAL_RESTORE: 'true', RECOVERY_DATA_CLASSIFICATION: 'fictitious-only',
    TARGET_SUPABASE_DB_URL: databaseUrl.toString(), TARGET_SUPABASE_URL: st.API_URL, TARGET_SUPABASE_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY,
    STORAGE_BACKUP_ENCRYPTION_KEY: await readFile(join(run, 'exercise.key'), 'utf8'), BACKUP_KEY_ID: 'isolated-exercise-20261002',
  });
  await privateJson(join(run, 'restore.json'), JSON.parse(output));
  console.log(output.trim());
}
async function verify() {
  const st = status('target'), client = db('target');
  await client.connect();
  const baseline = JSON.parse(await readFile(join(run, 'baseline.json'), 'utf8'));
  const fixtures = JSON.parse(await readFile(join(run, 'fixtures.json'), 'utf8'));
  try {
    if (resumeJourneys) {
      // Logins and deliberate writes mutate the restored database. Resume only
      // after the initial, pre-journey comparisons have actually passed.
      const tables = JSON.parse(await readFile(join(run, 'table-comparison.json'), 'utf8'));
      const schemas = JSON.parse(await readFile(join(run, 'schema-comparison.json'), 'utf8'));
      assert.equal(tables.tablesCompared, Object.keys(baseline).length);
      assert.equal(schemas.schemasCompared, 3);
      assert.deepEqual(tables.differences, []);
      assert.deepEqual(schemas.differences, []);
    } else {
    const restored = await snapshots(client);
    assert.deepEqual(Object.keys(restored), Object.keys(baseline), 'Restored table inventory differs');
    const differences = Object.keys(baseline).filter((name) => JSON.stringify(baseline[name]) !== JSON.stringify(restored[name]));
    await privateJson(join(run, 'table-comparison.json'), { tablesCompared: Object.keys(baseline).length, differences, baseline, restored });
    assert.deepEqual(differences, [], 'Restored table contents differ');
    const schemaDifferences = [];
    for (const schema of ['auth', 'storage', 'public']) {
      const targetDump = join(run, `${schema}-target.sql`);
      runSupabaseDump(st.DB_URL, targetDump, ['--schema', schema], schema === 'public' ? 'schema' : `${schema}-schema`);
      if (JSON.stringify(await canonicalDumpStatements(await readFile(join(run, `${schema}-source.sql`), 'utf8'))) !== JSON.stringify(await canonicalDumpStatements(await readFile(targetDump, 'utf8')))) schemaDifferences.push(schema);
    }
    await privateJson(join(run, 'schema-comparison.json'), { schemasCompared: 3, differences: schemaDifferences });
    assert.deepEqual(schemaDifferences, [], 'Restored definitions or privileges differ');
    }
    const keys = (await client.query(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
      ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid=c.conrelid AND attnum=ANY(c.conkey) ORDER BY array_position(c.conkey,attnum)) AS child_columns,
      ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid=c.confrelid AND attnum=ANY(c.confkey) ORDER BY array_position(c.confkey,attnum)) AS parent_columns
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=(SELECT relnamespace FROM pg_class WHERE oid=c.conrelid)
      WHERE c.contype='f' AND n.nspname IN ('public','auth','storage')`)).rows;
    let orphans = 0;
    for (const key of keys) {
      const match = key.child_columns.map((c, i) => `c.${quote(c)}=p.${quote(key.parent_columns[i])}`).join(' AND ');
      const present = key.child_columns.map((c) => `c.${quote(c)} IS NOT NULL`).join(' AND ');
      orphans += Number((await client.query(`SELECT count(*) AS n FROM ${key.child} c WHERE ${present} AND NOT EXISTS(SELECT 1 FROM ${key.parent} p WHERE ${match})`)).rows[0].n);
    }
    assert.equal(orphans, 0);
    const links = (await client.query(`SELECT 'clinical-attachments' AS bucket, storage_path AS path FROM public.clinical_attachment
      UNION ALL SELECT 'raw-documents', storage_path FROM public.raw_document
      UNION ALL SELECT 'scientific-exports', stored_file_path FROM public.export_log WHERE stored_file_path IS NOT NULL`)).rows;
    const objects = (await client.query('SELECT bucket_id AS bucket, name AS path FROM storage.objects')).rows;
    const ids = (rows) => rows.map((r) => `${r.bucket}/${r.path}`).sort();
    assert.deepEqual(ids(links), ids(objects), 'Storage links or orphan inventory differs');
    const admin = api('target', st.SERVICE_ROLE_KEY);
    for (const file of fixtures.files) {
      const response = await admin.storage.from(file.bucket).download(file.path);
      assert.equal(response.error, null);
      assert.equal(hash(Buffer.from(await response.data.arrayBuffer())), file.sha256);
    }
    const accounts = (await client.query("SELECT email FROM auth.users WHERE email LIKE '%@demo.test' ORDER BY email")).rows;
    assert.equal(accounts.length, fixtures.accountCount);
    const users = {};
    for (const account of accounts) {
      const user = api('target', st.ANON_KEY);
      const login = await user.auth.signInWithPassword({ email: account.email, password: 'Password123!' });
      assert.equal(login.error, null, 'Restored login failed'); users[account.email] = user;
    }
    const alice = users['alice@demo.test'], bob = users['bob@demo.test'];
    const allowed = await alice.from('clinical_attachment').select('id,label').eq('id', fixtures.attachmentId);
    assert.equal(allowed.error, null); assert.equal(allowed.data.length, 1);
    assert.deepEqual((await bob.from('clinical_attachment').select('id').eq('id', fixtures.attachmentId)).data, []);
    const changed = await alice.from('clinical_attachment').update({ label: 'Reprise fictive verifiee' }).eq('id', fixtures.attachmentId).select('id,label');
    assert.equal(changed.error, null); assert.equal(changed.data.length, 1);
    const denied = await bob.from('clinical_attachment').update({ label: 'Unauthorized synthetic change' }).eq('id', fixtures.attachmentId).select('id');
    assert.ok(denied.error || denied.data.length === 0);
    const auditBefore = Number((await client.query("SELECT count(*) AS n FROM public.audit_log WHERE action='attachment_read' AND entity_id=$1", [fixtures.attachmentId])).rows[0].n);
    const signed = await alice.functions.invoke('signed-read', { body: { entity: 'attachment', id: fixtures.attachmentId } });
    assert.equal(signed.error, null, 'Audited signed-read failed'); assert.ok(signed.data.url);
    const signedUrl = new URL(signed.data.url);
    // The local CLI exposes its Docker-only Kong hostname in signed URLs.
    // Reach that same local gateway through its published loopback port;
    // preserve the signed path/query and refuse every other origin.
    const localGatewayTranslation = signedUrl.origin === 'http://kong:8000';
    if (localGatewayTranslation) {
      const gateway = new URL(st.API_URL);
      signedUrl.hostname = gateway.hostname; signedUrl.port = gateway.port;
    }
    assert.equal(signedUrl.origin, st.API_URL, 'Signed URL must use this isolated gateway');
    const bytes = await fetch(signedUrl); assert.equal(bytes.status, 200);
    assert.equal(hash(Buffer.from(await bytes.arrayBuffer())), fixtures.files.find((f) => f.bucket === 'clinical-attachments').sha256);
    const blocked = await bob.functions.invoke('signed-read', { body: { entity: 'attachment', id: fixtures.attachmentId } });
    assert.ok(blocked.error); assert.ok(!blocked.data?.url);
    const newAuditEvents = Number((await client.query("SELECT count(*) AS n FROM public.audit_log WHERE action='attachment_read' AND entity_id=$1", [fixtures.attachmentId])).rows[0].n) - auditBefore;
    assert.ok(newAuditEvents > 0, 'Signed read did not create a new audit event');
    assert.equal((await client.query('SET ROLE authenticated; SELECT auth.recovery_probe() AS ok; RESET ROLE'))[1].rows[0].ok, true);
    await assert.rejects(client.query('SET ROLE anon; SELECT auth.recovery_probe()')); await client.query('RESET ROLE');
    const created = await admin.auth.admin.createUser({ email: 'recovery-trigger@demo.test', password: randomBytes(24).toString('hex'), email_confirm: true });
    assert.equal(created.error, null);
    assert.equal(Number((await client.query('SELECT count(*) AS n FROM public.profiles WHERE id=$1', [created.data.user.id])).rows[0].n), 1, 'Restored auth trigger failed');
    const results = { format: 'meddata-local-recovery-observations/v1', dataClassification: 'fictitious-only', productionConnected: false,
      tablesCompared: Object.keys(baseline).length, schemasCompared: 3, schemaDifferences: 0, tableDifferences: 0,
      accountsRestored: accounts.length, identitiesRestored: baseline['auth.identities'].count, accountLogins: accounts.length,
      objectsExpected: fixtures.files.length, objectsRestored: objects.length, hashMismatches: 0,
      foreignKeysChecked: keys.length, orphanCount: orphans, storageOrphanCount: 0, linksChecked: links.length,
      restoredCustomFunction: true, restoredAuthTrigger: true, read: true, modify: true,
      authorizationDenial: true, signedRead: true, auditTrail: true, newAuditEvents, apiJourneysCompletedAt: new Date().toISOString(),
      resumedJourneysAfterInitialComparison: resumeJourneys,
      localGatewayTranslation,
      browserJourneysCompleted: false, productionReadinessValidated: false, objectivesApproved: false };
    await privateJson(join(run, 'observations.json'), results);
    console.log(JSON.stringify(results));
  } finally { await client.end(); }
}
try {
  if (phase === 'prepare') await prepare(); else if (phase === 'backup') await backup();
  else if (phase === 'restore') await restore(); else if (phase === 'verify') await verify();
  else throw new Error('Usage: --phase=prepare|backup|restore|verify; requires the documented disposable local workdirs.');
} catch (error) {
  // Child output can contain credentials or SQL; never relay it.
  console.error(`Local exercise ${phase ?? 'configuration'} failed (${error.code ?? error.name}); details withheld.`);
  const frame = error.stack?.split('\n').find((line) => line.includes('exercise-isolated-recovery.mjs:'));
  if (frame) console.error(frame.trim());
  if (error instanceof assert.AssertionError) console.error(error.message.split('\n')[0]);
  process.exitCode = 1;
}
