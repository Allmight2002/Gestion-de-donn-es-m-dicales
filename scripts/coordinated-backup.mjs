import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encryptPayload,
  decryptPayload,
  parseEncryptionKey,
} from './storage-object-backup.mjs';
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
} from './check-supabase-target.mjs';

const FORMAT = 'meddata-coordinated-backup/v1';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const supabaseEntrypoint = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');

const clean = (value) => value?.trim() ?? '';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function ensureOutsideRepository(value) {
  const destination = resolve(value);
  const fromRepository = relative(root, destination);
  if (!fromRepository.startsWith('..') && !isAbsolute(fromRepository)) {
    throw new Error('La sauvegarde coordonnee doit etre ecrite hors du depot.');
  }
  return destination;
}

async function ensureAbsent(path) {
  try {
    await access(path, fsConstants.F_OK);
    throw new Error('Le repertoire de sauvegarde existe deja.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validatedSource() {
  const target = option('target');
  if (!['staging', 'production'].includes(target)) {
    throw new Error('--target=staging ou --target=production est requis.');
  }
  const projectRef = clean(process.env.SUPABASE_PROJECT_REF).toLowerCase();
  const supabaseRef = projectRefFromSupabaseUrl(process.env.SUPABASE_URL);
  const databaseRef = projectRefFromDatabaseUrl(process.env.SUPABASE_DB_URL);
  if (!/^[a-z0-9]{20}$/.test(projectRef)
      || supabaseRef !== projectRef
      || databaseRef !== projectRef) {
    throw new Error('Les references Supabase URL/DB/projet sont absentes ou divergentes.');
  }
  if (target === 'staging' && projectRef !== STAGING_PROJECT_REF) {
    throw new Error('La cible ne correspond pas au staging MedData approuve.');
  }
  if (target === 'production' && projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error('La cible ne correspond pas a la production MedData approuvee.');
  }
  if (clean(process.env.SUPABASE_SERVICE_ROLE_KEY).length < 20) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY est absente ou manifestement invalide.');
  }
  return { target, projectRef };
}

function runSupabaseDump(databaseUrl, file, extraArguments) {
  try {
    execFileSync(
      process.execPath,
      [
        supabaseEntrypoint,
        'db',
        'dump',
        '--db-url',
        databaseUrl,
        '--file',
        file,
        ...extraArguments,
      ],
      {
        cwd: root,
        env: { ...process.env, DO_NOT_TRACK: '1' },
        stdio: 'ignore',
        timeout: 10 * 60 * 1000,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error('Un export PostgreSQL a echoue; detail masque.');
  }
}

async function encryptGeneratedFile(path, key) {
  const plaintext = await readFile(path);
  const encryptedPath = `${path}.bin`;
  const encrypted = encryptPayload(key, plaintext);
  await writeFile(encryptedPath, encrypted, { flag: 'wx', mode: 0o600 });
  await unlink(path);
  return {
    file: encryptedPath.split(/[\\/]/).at(-1),
    plaintextBytes: plaintext.length,
    plaintextSha256: sha256(plaintext),
    encryptedBytes: encrypted.length,
    encryptedSha256: sha256(encrypted),
  };
}

function manifestHmac(manifest, key) {
  return createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex');
}

async function backup() {
  const { target, projectRef } = validatedSource();
  const destination = ensureOutsideRepository(option('output') || process.env.BACKUP_SET_DIR);
  const key = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  await ensureAbsent(destination);
  const partial = `${destination}.partial-${randomUUID()}`;
  await ensureAbsent(partial);
  await mkdir(partial, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();

  const definitions = [
    ['roles.sql', ['--role-only']],
    ['schema.sql', []],
    ['data.sql', ['--data-only', '--use-copy']],
    ['public-data.sql', ['--data-only', '--use-copy', '--schema', 'public']],
  ];
  const databaseFiles = [];
  for (const [name, arguments_] of definitions) {
    const plaintextPath = join(partial, name);
    runSupabaseDump(process.env.SUPABASE_DB_URL, plaintextPath, arguments_);
    databaseFiles.push(await encryptGeneratedFile(plaintextPath, key));
    console.log(`Export PostgreSQL ${databaseFiles.length}/${definitions.length}: OK (contenu masque).`);
  }

  const storageDirectory = join(partial, 'storage-objects');
  try {
    execFileSync(
      process.execPath,
      [join(root, 'scripts', 'storage-object-backup.mjs'), 'backup', `--output=${storageDirectory}`],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        timeout: 30 * 60 * 1000,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error('La sauvegarde des octets Storage a echoue; detail sensible masque.');
  }
  const storageHeaderBytes = await readFile(join(storageDirectory, 'backup.json'));
  const storageHeader = JSON.parse(storageHeaderBytes.toString('utf8'));

  const unsignedManifest = {
    format: FORMAT,
    target,
    projectRef,
    startedAt,
    completedAt: new Date().toISOString(),
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    supabaseCliVersion: JSON.parse(
      await readFile(join(root, 'node_modules', 'supabase', 'package.json'), 'utf8'),
    ).version,
    databaseFiles,
    storage: {
      directory: 'storage-objects',
      headerSha256: sha256(storageHeaderBytes),
      encryptedManifestSha256: storageHeader.encryptedManifestSha256,
    },
  };
  const manifest = { ...unsignedManifest, hmacSha256: manifestHmac(unsignedManifest, key) };
  await writeFile(join(partial, 'backup-set.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(partial, destination);
  console.log(`Sauvegarde coordonnee ${target}: OK (${databaseFiles.length} exports DB + Storage chiffre).`);
}

async function readAuthenticatedManifest(backupRoot, key) {
  const manifest = JSON.parse(await readFile(join(backupRoot, 'backup-set.json'), 'utf8'));
  const { hmacSha256, ...unsignedManifest } = manifest;
  if (manifest.format !== FORMAT
      || !/^[a-f0-9]{64}$/.test(hmacSha256 ?? '')
      || manifestHmac(unsignedManifest, key) !== hmacSha256
      || !Array.isArray(manifest.databaseFiles)
      || manifest.databaseFiles.length !== 4) {
    throw new Error('Manifest de sauvegarde coordonnee invalide ou non authentifie.');
  }
  return manifest;
}

async function verifiedDatabasePayloads(backupRoot, key, manifest) {
  const payloads = [];
  for (const file of manifest.databaseFiles) {
    if (!/^[a-z-]+\.sql\.bin$/.test(file.file ?? '')) {
      throw new Error('Nom d export DB chiffre invalide.');
    }
    const encrypted = await readFile(join(backupRoot, file.file));
    if (encrypted.length !== file.encryptedBytes || sha256(encrypted) !== file.encryptedSha256) {
      throw new Error('Empreinte d un export DB chiffre invalide.');
    }
    let plaintext;
    try {
      plaintext = decryptPayload(key, encrypted);
    } catch {
      throw new Error('Dechiffrement d un export DB impossible.');
    }
    if (plaintext.length !== file.plaintextBytes || sha256(plaintext) !== file.plaintextSha256) {
      throw new Error('Empreinte d un export DB dechiffre invalide.');
    }
    payloads.push({ name: file.file.replace(/\.bin$/, ''), plaintext });
  }
  return payloads;
}

async function verify() {
  const backupRoot = resolve(option('backup') || process.env.BACKUP_SET_DIR);
  const key = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const manifest = await readAuthenticatedManifest(backupRoot, key);
  await verifiedDatabasePayloads(backupRoot, key, manifest);
  const storageHeader = await readFile(join(backupRoot, manifest.storage.directory, 'backup.json'));
  if (sha256(storageHeader) !== manifest.storage.headerSha256) {
    throw new Error('En-tete Storage non lie au manifest coordonne.');
  }
  try {
    execFileSync(
      process.execPath,
      [
        join(root, 'scripts', 'storage-object-backup.mjs'),
        'verify',
        `--backup=${join(backupRoot, manifest.storage.directory)}`,
      ],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        timeout: 30 * 60 * 1000,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error('Verification des objets Storage impossible.');
  }
  console.log('Sauvegarde coordonnee verifiee: OK (manifest HMAC, DB et Storage).');
}

async function extract() {
  if (process.env.BACKUP_ALLOW_PLAINTEXT_EXTRACTION !== 'true') {
    throw new Error('Extraction en clair refusee sans BACKUP_ALLOW_PLAINTEXT_EXTRACTION=true.');
  }
  const backupRoot = resolve(option('backup') || process.env.BACKUP_SET_DIR);
  const destination = ensureOutsideRepository(option('output') || process.env.BACKUP_EXTRACT_DIR);
  const key = parseEncryptionKey(process.env.STORAGE_BACKUP_ENCRYPTION_KEY);
  const manifest = await readAuthenticatedManifest(backupRoot, key);
  const payloads = await verifiedDatabasePayloads(backupRoot, key, manifest);
  await ensureAbsent(destination);
  const partial = `${destination}.partial-${randomUUID()}`;
  await ensureAbsent(partial);
  await mkdir(partial, { recursive: true, mode: 0o700 });
  try {
    for (const payload of payloads) {
      await writeFile(join(partial, payload.name), payload.plaintext, { flag: 'wx', mode: 0o600 });
    }
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
  console.log(`Exports DB extraits: OK (${payloads.length} fichiers; contenu masque).`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'backup') await backup();
  else if (command === 'verify') await verify();
  else if (command === 'extract') await extract();
  else throw new Error('Usage: coordinated-backup.mjs backup|verify|extract --output=...|--backup=...');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(`Sauvegarde coordonnee impossible: ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    process.exitCode = 1;
  });
}
