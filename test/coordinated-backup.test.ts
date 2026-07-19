import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  COORDINATED_DUMP_IMAGE,
  classifyDumpFailure,
  dumpFailureSignals,
  dumpSubprocessEnvironment,
  isSessionPoolerDatabaseUrl,
  prepareDumpImage,
  runSupabaseDump,
  withIsolatedSupabaseWorkdir,
  writeAtomicBackupDirectory,
} from '../scripts/coordinated-backup.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('sauvegarde coordonnee sure', () => {
  test('epingle l image PG17 publiee avec la CLI candidate', () => {
    expect(COORDINATED_DUMP_IMAGE).toMatchObject({
      cliVersion: '2.109.1',
      dbMajorVersion: 17,
      tag: '17.6.1.143',
      digest: 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453',
    });
  });

  test('supprime tout repertoire partiel lorsqu une construction echoue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meddata-coordinated-backup-test-'));
    temporaryRoots.push(root);
    const destination = join(root, 'backup');

    await expect(writeAtomicBackupDirectory(destination, async (partial) => {
      await writeFile(join(partial, 'data.sql'), 'donnees fictives en clair');
      throw new Error('echec simule');
    }, { suffix: 'fixed' })).rejects.toThrow('echec simule');

    expect(await readdir(root)).toEqual([]);
  });

  test('ne transmet au dump que l environnement systeme minimal', () => {
    const environment = dumpSubprocessEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      SUPABASE_DB_URL: 'postgresql://secret',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
      STORAGE_BACKUP_ENCRYPTION_KEY: 'backup-secret',
      CLAMAV_SCAN_TOKEN: 'scanner-secret',
      VERCEL_TOKEN: 'vercel-secret',
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      DO_NOT_TRACK: '1',
    });
  });

  test('classe l erreur sans exposer URL, mot de passe ou stderr', () => {
    const databaseUrl = 'postgresql://postgres.project:mot-de-passe@pooler.supabase.com:5432/postgres';
    const execute = () => {
      const error = new Error(`password authentication failed for ${databaseUrl}`) as Error & { stderr: string };
      error.stderr = `detail sensible ${databaseUrl}`;
      throw error;
    };

    let message = '';
    try {
      runSupabaseDump(databaseUrl, '/tmp/roles.sql', ['--role-only'], 'roles', {
        execute,
        sourceEnv: { PATH: '/usr/bin', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('roles');
    expect(message).toContain('categorie: authentication');
    expect(message).not.toContain(databaseUrl);
    expect(message).not.toContain('mot-de-passe');
    expect(message).not.toContain('server-secret');
  });

  test('identifie les categories utiles sans reprendre le diagnostic brut', () => {
    expect(classifyDumpFailure({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyDumpFailure({ stderr: 'Cannot connect to the Docker daemon' })).toBe('docker');
    expect(classifyDumpFailure({ stderr: 'could not translate host name' })).toBe('connectivity');
    expect(classifyDumpFailure({ stderr: 'permission denied' })).toBe('permission');
    expect(classifyDumpFailure({ stderr: 'unexpected failure' })).toBe('cli-exit');
    expect(dumpFailureSignals({
      stderr: 'docker pull from public.ecr.aws failed: too many requests; container exited with status 1',
    })).toEqual(['container', 'docker', 'ecr', 'exit-status', 'pull', 'rate-limit']);
  });

  test('reutilise uniquement l image de dump dont le digest est prouve', async () => {
    const calls: string[][] = [];
    const execute = (_command: string, arguments_: string[]) => {
      calls.push(arguments_);
      return JSON.stringify([`${COORDINATED_DUMP_IMAGE.repository}@${COORDINATED_DUMP_IMAGE.digest}`]);
    };

    await expect(prepareDumpImage({
      execute,
      sourceEnv: { BACKUP_PREPARE_DUMP_IMAGE: 'true', PATH: '/usr/bin' },
      attempts: 1,
      installedCliVersion: COORDINATED_DUMP_IMAGE.cliVersion,
    })).resolves.toBe('cached');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`${COORDINATED_DUMP_IMAGE.repository}:${COORDINATED_DUMP_IMAGE.tag}`);
  });

  test('refuse le dump si la version PostgreSQL ne correspond plus a l image epinglee', async () => {
    let executed = false;

    await expect(prepareDumpImage({
      execute: () => { executed = true; },
      sourceEnv: { BACKUP_PREPARE_DUMP_IMAGE: 'true', PATH: '/usr/bin' },
      attempts: 1,
      installedCliVersion: COORDINATED_DUMP_IMAGE.cliVersion,
      configuredDbMajorVersion: COORDINATED_DUMP_IMAGE.dbMajorVersion + 2,
    })).rejects.toThrow('Version PostgreSQL divergente');
    expect(executed).toBe(false);
  });

  test('isole la configuration du dump de tout cache Supabase local', async () => {
    let workdir = '';
    await withIsolatedSupabaseWorkdir(async (isolatedWorkdir) => {
      workdir = isolatedWorkdir;
      const config = await readFile(join(workdir, 'supabase', 'config.toml'), 'utf8');
      expect(config).toContain(`major_version = ${COORDINATED_DUMP_IMAGE.dbMajorVersion}`);
      await expect(access(join(workdir, 'supabase', '.temp', 'postgres-version'))).rejects.toThrow();
    });
    await expect(access(workdir)).rejects.toThrow();
  });

  test('execute le CLI dans le workdir de dump explicitement fourni', () => {
    let receivedWorkdir = '';
    runSupabaseDump('postgresql://fictitious', '/tmp/roles.sql', ['--role-only'], 'roles', {
      execute: (_command, _arguments, options) => {
        receivedWorkdir = options.cwd;
        return '';
      },
      sourceEnv: { PATH: '/usr/bin' },
      workdir: '/tmp/isolated-supabase-workdir',
    });
    expect(receivedWorkdir).toBe('/tmp/isolated-supabase-workdir');
  });

  test('utilise le miroir par digest lorsque le registre ECR echoue', async () => {
    const calls: string[][] = [];
    const environments: Array<Record<string, string>> = [];
    let tagged = false;
    const execute = (_command: string, arguments_: string[], options: { env: Record<string, string> }) => {
      calls.push(arguments_);
      environments.push(options.env);
      if (arguments_[0] === 'image') {
        return tagged
          ? JSON.stringify([`${COORDINATED_DUMP_IMAGE.mirrorRepository}@${COORDINATED_DUMP_IMAGE.digest}`])
          : '[]';
      }
      if (arguments_[0] === 'pull' && arguments_.at(-1)?.startsWith(COORDINATED_DUMP_IMAGE.repository)) {
        throw new Error('echec registre primaire');
      }
      if (arguments_[0] === 'tag') tagged = true;
      return '';
    };

    await expect(prepareDumpImage({
      execute,
      sourceEnv: {
        BACKUP_PREPARE_DUMP_IMAGE: 'true',
        PATH: '/usr/bin',
        SUPABASE_SERVICE_ROLE_KEY: 'secret-ne-doit-pas-etre-transmis',
      },
      attempts: 1,
      installedCliVersion: COORDINATED_DUMP_IMAGE.cliVersion,
    })).resolves.toBe('mirror');
    expect(calls.some((arguments_) => arguments_.includes(
      `${COORDINATED_DUMP_IMAGE.mirrorRepository}@${COORDINATED_DUMP_IMAGE.digest}`,
    ))).toBe(true);
    expect(environments.every((environment) => !('SUPABASE_SERVICE_ROLE_KEY' in environment))).toBe(true);
  });

  test('echoue ferme si aucun registre ne fournit le digest attendu', async () => {
    const execute = (_command: string, arguments_: string[]) => {
      if (arguments_[0] === 'image') return '[]';
      throw new Error('registre indisponible');
    };

    await expect(prepareDumpImage({
      execute,
      sourceEnv: { BACKUP_PREPARE_DUMP_IMAGE: 'true', PATH: '/usr/bin' },
      attempts: 1,
      installedCliVersion: COORDINATED_DUMP_IMAGE.cliVersion,
    })).rejects.toThrow('aucun dump lance');
  });

  test('exige le Session pooler 5432 pour les sauvegardes CI', () => {
    expect(isSessionPoolerDatabaseUrl(
      'postgresql://postgres.project:secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres',
    )).toBe(true);
    expect(isSessionPoolerDatabaseUrl(
      'postgresql://postgres.project:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
    )).toBe(false);
    expect(isSessionPoolerDatabaseUrl(
      'postgresql://postgres:secret@db.project.supabase.co:5432/postgres',
    )).toBe(false);
  });
});
