import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { encryptPayload } from '../scripts/storage-object-backup.mjs';

const roots: string[] = [];
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(current = false, covered = true) {
  const root = await mkdtemp(join(tmpdir(), 'meddata-cli-fixture-'));
  roots.push(root);
  const key = randomBytes(32);
  const backup = join(root, 'backup');
  await mkdir(join(backup, 'storage-objects', 'objects'), { recursive: true });
  const bytes = Buffer.from('fixture entirely synthetic');
  await writeFile(join(backup, 'storage-objects', 'objects', '00000001.bin'), encryptPayload(key, bytes));
  const storageManifest = encryptPayload(key, Buffer.from(JSON.stringify({
    format: 'meddata-storage-backup/v1', createdAt: new Date().toISOString(), sourceApiSha256: 'a'.repeat(64),
    buckets: [{ id: 'synthetic', objects: [{ name: 'synthetic.pdf', blobFile: 'objects/00000001.bin', sha256: hash(bytes), size: bytes.length }] }],
    objectCount: 1, totalBytes: bytes.length,
  })));
  await writeFile(join(backup, 'storage-objects', 'manifest.bin'), storageManifest);
  const header = Buffer.from(JSON.stringify({ format: 'meddata-storage-backup/v1', encryption: 'AES-256-GCM', encryptedManifestFile: 'manifest.bin', encryptedManifestSha256: hash(storageManifest) }));
  await writeFile(join(backup, 'storage-objects', 'backup.json'), header);
  const databaseFiles = [];
  for (const name of ['roles', 'schema', 'data', 'public-data', ...(current ? ['auth-schema', 'storage-schema'] : [])]) {
    const coverage = current && covered && name === 'data'
      ? ['auth.users', 'auth.identities', 'storage.buckets', 'storage.objects']
        .map((table) => `COPY ${table} (id) FROM stdin;\n\\.\n`).join('\n')
      : '';
    const sql = Buffer.from(`-- ${name}: synthetic fixture only\n${coverage}`);
    const encrypted = encryptPayload(key, sql);
    const file = `${name}.sql.bin`;
    await writeFile(join(backup, file), encrypted);
    databaseFiles.push({ file, plaintextBytes: sql.length, plaintextSha256: hash(sql), encryptedBytes: encrypted.length, encryptedSha256: hash(encrypted) });
  }
  const manifest = { format: current ? 'meddata-coordinated-backup/v2' : 'meddata-coordinated-backup/v1', keyId: 'fixture-v1', databaseFiles,
    storage: { directory: 'storage-objects', headerSha256: hash(header), encryptedManifestSha256: hash(storageManifest) } };
  await writeFile(join(backup, 'backup-set.json'), JSON.stringify({ ...manifest, hmacSha256: createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex') }));
  return { root, backup, key };
}

function run(command: string, backup: string, key: Buffer, extraArgs: string[] = [], keyId = 'fixture-v1') {
  return execFileSync(process.execPath, [resolve('scripts/coordinated-backup.mjs'), command, `--backup=${backup}`, ...extraArgs], {
    env: { ...process.env, STORAGE_BACKUP_ENCRYPTION_KEY: key.toString('base64'), BACKUP_KEY_ID: keyId, BACKUP_ALLOW_PLAINTEXT_EXTRACTION: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

test('verifie DB/Storage chiffres et extrait uniquement les SQL Auth/Storage et applicatifs authentifies', async () => {
  const { root, backup, key } = await fixture(true);
  expect(run('verify', backup, key)).toContain('Sauvegarde coordonnee verifiee');
  const output = join(root, 'extracted');
  run('extract', backup, key, [`--output=${output}`]);
  expect(await readFile(join(output, 'data.sql'), 'utf8')).toContain('synthetic fixture only');
  expect(await readFile(join(output, 'storage-schema.sql'), 'utf8')).toContain('storage-schema');
  expect(() => run('verify', backup, key, [], 'wrong-version')).toThrow();
  expect(() => run('verify', backup, randomBytes(32))).toThrow();
});

test('refuse un blob altere et masque les erreurs de parsing du manifest', async () => {
  const { backup, key } = await fixture();
  await writeFile(join(backup, 'storage-objects', 'objects', '00000001.bin'), Buffer.from('altered'));
  expect(() => run('verify', backup, key)).toThrow();
  await writeFile(join(backup, 'backup-set.json'), 'sensitive-marker-invalid-json');
  try { run('verify', backup, key); } catch (error) {
    const failure = error as { stderr: Buffer };
    expect(failure.stderr.toString()).toContain('detail masque');
    expect(failure.stderr.toString()).not.toContain('sensitive-marker');
  }
});

test('refuse un export v2 authentifie sans les tables Auth et Storage', async () => {
  const { backup, key } = await fixture(true, false);
  expect(() => run('verify', backup, key)).toThrow();
});
