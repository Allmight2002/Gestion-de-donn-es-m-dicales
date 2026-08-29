import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageClient } from '@supabase/storage-js';

const FORMAT = 'meddata-storage-backup/v1';
const ENCRYPTED_MAGIC = Buffer.from('MDSB1', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_MAX_OBJECTS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

const clean = (value) => value?.trim() ?? '';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function parseEncryptionKey(value) {
  const encoded = clean(value);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('STORAGE_BACKUP_ENCRYPTION_KEY doit etre une valeur base64 stricte.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('STORAGE_BACKUP_ENCRYPTION_KEY doit decoder exactement 32 octets.');
  }
  return key;
}

export function encryptPayload(key, plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENCRYPTED_MAGIC, iv, tag, ciphertext]);
}

export function decryptPayload(key, encrypted) {
  const minimumLength = ENCRYPTED_MAGIC.length + IV_LENGTH + TAG_LENGTH;
  if (encrypted.length < minimumLength
      || !encrypted.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)) {
    throw new Error('Charge chiffree Storage invalide.');
  }
  const ivStart = ENCRYPTED_MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const dataStart = tagStart + TAG_LENGTH;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    encrypted.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(encrypted.subarray(tagStart, dataStart));
  return Buffer.concat([
    decipher.update(encrypted.subarray(dataStart)),
    decipher.final(),
  ]);
}

export function isLoopbackStorageUrl(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function integerEnv(name, fallback) {
  const value = clean(process.env[name]);
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} doit etre un entier strictement positif.`);
  }
  return Number(value);
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function normalizeStorageApiUrl(value, appendStoragePath = false) {
  const raw = clean(value).replace(/\/$/, '');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('STORAGE_API_URL doit etre une URL HTTP(S) valide.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('STORAGE_API_URL doit etre une URL HTTP(S) sans identifiants ni parametres.');
  }
  return appendStoragePath && !raw.endsWith('/storage/v1') ? `${raw}/storage/v1` : raw;
}

function configuredStorageApiUrl(explicitApiUrl, supabaseUrl) {
  const explicit = clean(explicitApiUrl);
  return normalizeStorageApiUrl(explicit || supabaseUrl, !explicit);
}

function storageClient(apiUrl, serviceKey) {
  if (serviceKey.length < 20) {
    throw new Error('La cle serveur Storage est absente ou manifestement invalide.');
  }
  const timeoutMs = integerEnv('STORAGE_HTTP_TIMEOUT_MS', DEFAULT_HTTP_TIMEOUT_MS);
  const boundedFetch = (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
  return new StorageClient(
    apiUrl,
    {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    boundedFetch,
  );
}

function storageError(operation, error) {
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
  return new Error(`${operation} a echoue${status}; detail masque.`);
}

function ensureOutsideRepository(path) {
  const absolute = resolve(path);
  const fromRepository = relative(process.cwd(), absolute);
  if (!fromRepository.startsWith('..') && !isAbsolute(fromRepository)) {
    throw new Error('La sauvegarde Storage doit etre ecrite hors du depot.');
  }
  return absolute;
}

async function ensureAbsent(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error('Le repertoire de destination existe deja.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function listAllObjects(client, bucketId, maxObjects) {
  const objects = [];
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    pages += 1;
    if (pages > maxObjects + 100) {
      throw new Error('Pagination Storage anormalement longue.');
    }
    const { data, error } = await client.from(bucketId).listV2({
      prefix: '',
      cursor,
      limit: 1000,
      with_delimiter: false,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw storageError('Inventaire des objets Storage', error);
    for (const object of data.objects) {
      const name = clean(object.key || object.name);
      if (!name || name.includes('\0')) {
        throw new Error('Un objet Storage possede un nom invalide.');
      }
      objects.push({ name, metadata: object.metadata ?? null });
      if (objects.length > maxObjects) {
        throw new Error(`La limite de ${maxObjects} objets Storage est depassee.`);
      }
    }
    cursor = data.hasNext ? data.nextCursor : undefined;
    if (data.hasNext && !cursor) {
      throw new Error('Pagination Storage incoherente: curseur suivant absent.');
    }
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('Pagination Storage incoherente: curseur repete.');
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return objects;
}

function limitedMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const contentType = typeof metadata.mimetype === 'string' ? metadata.mimetype : null;
  const cacheControl = typeof metadata.cacheControl === 'string'
    ? metadata.cacheControl
    : typeof metadata.cache_control === 'string'
      ? metadata.cache_control
      : null;
  return { contentType, cacheControl };
}

export function validateManifest(manifest) {
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.buckets)) {
    throw new Error('Manifest Storage invalide.');
  }
  let objectCount = 0;
  let totalBytes = 0;
  const blobFiles = new Set();
  for (const bucket of manifest.buckets) {
    if (!bucket || typeof bucket.id !== 'string' || !bucket.id || !Array.isArray(bucket.objects)) {
      throw new Error('Bucket invalide dans le manifest Storage.');
    }
    for (const object of bucket.objects) {
      if (!object || typeof object.name !== 'string' || !object.name
          || !/^objects\/\d{8}\.bin$/.test(object.blobFile)
          || !/^[a-f0-9]{64}$/.test(object.sha256)
          || !Number.isSafeInteger(object.size) || object.size < 0
          || blobFiles.has(object.blobFile)) {
        throw new Error('Objet invalide dans le manifest Storage.');
      }
      blobFiles.add(object.blobFile);
      objectCount += 1;
      totalBytes += object.size;
    }
  }
  if (manifest.objectCount !== objectCount || manifest.totalBytes !== totalBytes) {
    throw new Error('Totaux incoherents dans le manifest Storage.');
  }
  return { objectCount, totalBytes };
}

async function readManifest(backupRoot, key) {
  const headerPath = resolve(backupRoot, 'backup.json');
  const header = JSON.parse(await readFile(headerPath, 'utf8'));
  if (header?.format !== FORMAT || header.encryption !== 'AES-256-GCM'
      || header.encryptedManifestFile !== 'manifest.bin'
      || !/^[a-f0-9]{64}$/.test(header.encryptedManifestSha256 ?? '')) {
    throw new Error('En-tete de sauvegarde Storage invalide.');
  }
  const encrypted = await readFile(resolve(backupRoot, header.encryptedManifestFile));
  if (sha256(encrypted) !== header.encryptedManifestSha256) {
    throw new Error('Empreinte du manifest Storage invalide.');
  }
  let manifest;
  try {
    manifest = JSON.parse(decryptPayload(key, encrypted).toString('utf8'));
  } catch {
    throw new Error('Dechiffrement du manifest Storage impossible.');
  }
  validateManifest(manifest);
  return { header, manifest };
}

async function readAndVerifyObject(backupRoot, key, object) {
  const blobPath = resolve(backupRoot, object.blobFile);
  const contained = relative(resolve(backupRoot), blobPath);
  if (contained.startsWith('..') || isAbsolute(contained)) {
    throw new Error('Chemin objet hors sauvegarde refuse.');
  }
  let plaintext;
  try {
    plaintext = decryptPayload(key, await readFile(blobPath));
  } catch {
    throw new Error('Dechiffrement d un objet Storage impossible.');
  }
  if (plaintext.length !== object.size || sha256(plaintext) !== object.sha256) {
    throw new Error('Integrite d un objet Storage invalide.');
  }
  return plaintext;
}

async function backup() {
  const destination = ensureOutsideRepository(option('output') || process.env.STORAGE_BACKUP_DIR);
  const sourceApi = configuredStorageApiUrl(process.env.STORAGE_API_URL, process.env.SUPABASE_URL);
  const serviceKey = clean(process.env.STORAGE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const key = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const maxObjects = integerEnv('STORAGE_BACKUP_MAX_OBJECTS', DEFAULT_MAX_OBJECTS);
  const maxBytes = integerEnv('STORAGE_BACKUP_MAX_BYTES', DEFAULT_MAX_BYTES);
  await ensureAbsent(destination);

  const partial = `${destination}.partial-${randomUUID()}`;
  await ensureAbsent(partial);
  await mkdir(resolve(partial, 'objects'), { recursive: true, mode: 0o700 });

  const client = storageClient(sourceApi, serviceKey);
  const { data: buckets, error: bucketError } = await client.listBuckets();
  if (bucketError) throw storageError('Inventaire des buckets Storage', bucketError);
  console.log(`Inventaire Storage: ${buckets.length} buckets (noms masques).`);

  const manifest = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    sourceApiSha256: sha256(new URL(sourceApi).origin),
    buckets: [],
    objectCount: 0,
    totalBytes: 0,
  };
  let index = 0;

  const sortedBuckets = [...buckets].sort((left, right) => left.id.localeCompare(right.id));
  for (const [bucketIndex, bucket] of sortedBuckets.entries()) {
    const listed = await listAllObjects(client, bucket.id, maxObjects - manifest.objectCount);
    console.log(`Inventaire bucket ${bucketIndex + 1}/${sortedBuckets.length}: ${listed.length} objets.`);
    const bucketEntry = {
      id: bucket.id,
      public: Boolean(bucket.public),
      fileSizeLimit: bucket.file_size_limit ?? null,
      allowedMimeTypes: bucket.allowed_mime_types ?? null,
      objects: [],
    };
    for (const listedObject of listed) {
      const { data, error } = await client.from(bucket.id).download(listedObject.name);
      if (error) throw storageError('Telechargement d un objet Storage', error);
      const plaintext = Buffer.from(await data.arrayBuffer());
      manifest.totalBytes += plaintext.length;
      if (manifest.totalBytes > maxBytes) {
        throw new Error(`La limite de ${maxBytes} octets Storage est depassee.`);
      }
      index += 1;
      const blobFile = `objects/${String(index).padStart(8, '0')}.bin`;
      await writeFile(resolve(partial, blobFile), encryptPayload(key, plaintext), {
        flag: 'wx',
        mode: 0o600,
      });
      bucketEntry.objects.push({
        name: listedObject.name,
        blobFile,
        sha256: sha256(plaintext),
        size: plaintext.length,
        metadata: limitedMetadata(listedObject.metadata),
      });
      manifest.objectCount += 1;
    }
    manifest.buckets.push(bucketEntry);
  }

  validateManifest(manifest);
  const encryptedManifest = encryptPayload(key, Buffer.from(JSON.stringify(manifest), 'utf8'));
  await writeFile(resolve(partial, 'manifest.bin'), encryptedManifest, { flag: 'wx', mode: 0o600 });
  const header = {
    format: FORMAT,
    createdAt: manifest.createdAt,
    encryption: 'AES-256-GCM',
    encryptedManifestFile: 'manifest.bin',
    encryptedManifestSha256: sha256(encryptedManifest),
  };
  await writeFile(resolve(partial, 'backup.json'), `${JSON.stringify(header, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await rename(partial, destination);
  console.log(`Sauvegarde Storage chiffree: OK (${manifest.objectCount} objets, ${manifest.totalBytes} octets; noms masques).`);
}

async function verify() {
  const backupRoot = resolve(option('backup') || process.env.STORAGE_BACKUP_DIR);
  const key = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const { manifest } = await readManifest(backupRoot, key);
  let verified = 0;
  let bytes = 0;
  for (const bucket of manifest.buckets) {
    for (const object of bucket.objects) {
      const plaintext = await readAndVerifyObject(backupRoot, key, object);
      verified += 1;
      bytes += plaintext.length;
    }
  }
  console.log(`Sauvegarde Storage verifiee: OK (${verified} objets, ${bytes} octets; noms masques).`);
}

async function restoreBackup() {
  const backupRoot = resolve(option('backup') || process.env.STORAGE_BACKUP_DIR);
  const targetApi = configuredStorageApiUrl(
    process.env.TARGET_STORAGE_API_URL,
    process.env.TARGET_SUPABASE_URL,
  );
  if (!isLoopbackStorageUrl(targetApi) && process.env.STORAGE_RESTORE_ALLOW_REMOTE !== 'true') {
    throw new Error('Restauration Storage distante refusee sans STORAGE_RESTORE_ALLOW_REMOTE=true.');
  }
  const targetKey = clean(
    process.env.TARGET_STORAGE_SERVICE_ROLE_KEY || process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY,
  );
  const encryptionKey = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const { manifest } = await readManifest(backupRoot, encryptionKey);
  const client = storageClient(targetApi, targetKey);
  const { data: existingBuckets, error: bucketError } = await client.listBuckets();
  if (bucketError) throw storageError('Lecture des buckets cibles', bucketError);
  const existingIds = new Set(existingBuckets.map((bucket) => bucket.id));
  for (const bucket of manifest.buckets) {
    if (!existingIds.has(bucket.id)) {
      throw new Error('Un bucket cible requis est absent; creation implicite refusee.');
    }
  }
  if (process.env.STORAGE_RESTORE_ALLOW_INVENTORY_MISMATCH !== 'true') {
    for (const bucket of manifest.buckets) {
      const targetObjects = await listAllObjects(client, bucket.id, manifest.objectCount + 1);
      const expectedNames = bucket.objects.map((object) => object.name).sort();
      const targetNames = targetObjects.map((object) => object.name).sort();
      if (expectedNames.length !== targetNames.length
          || expectedNames.some((name, index) => name !== targetNames[index])) {
        throw new Error('Inventaire Storage DB/objets divergent; restauration refusee.');
      }
    }
  }

  let restored = 0;
  let bytes = 0;
  for (const bucket of manifest.buckets) {
    for (const object of bucket.objects) {
      const plaintext = await readAndVerifyObject(backupRoot, encryptionKey, object);
      const { error } = await client.from(bucket.id).upload(object.name, plaintext, {
        upsert: true,
        contentType: object.metadata?.contentType ?? undefined,
        cacheControl: object.metadata?.cacheControl ?? undefined,
      });
      if (error) throw storageError('Restauration d un objet Storage', error);
      const { data: downloaded, error: downloadError } = await client.from(bucket.id).download(object.name);
      if (downloadError) throw storageError('Verification d un objet Storage restaure', downloadError);
      const targetBytes = Buffer.from(await downloaded.arrayBuffer());
      if (targetBytes.length !== object.size || sha256(targetBytes) !== object.sha256) {
        throw new Error('Empreinte d un objet Storage restaure invalide.');
      }
      restored += 1;
      bytes += targetBytes.length;
    }
  }
  console.log(`Restauration Storage verifiee: OK (${restored} objets, ${bytes} octets; noms masques).`);
}

async function main() {
  const command = process.argv[2];
  if (!['backup', 'verify', 'restore'].includes(command)) {
    throw new Error('Usage: storage-object-backup.mjs backup|verify|restore --output=...|--backup=...');
  }
  if (command === 'backup') await backup();
  if (command === 'verify') await verify();
  if (command === 'restore') await restoreBackup();
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(`Operation Storage impossible: ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    process.exitCode = 1;
  });
}
