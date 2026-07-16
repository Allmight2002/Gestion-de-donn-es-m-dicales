import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  classifyDumpFailure,
  dumpFailureSignals,
  dumpSubprocessEnvironment,
  isSessionPoolerDatabaseUrl,
  runSupabaseDump,
  writeAtomicBackupDirectory,
} from '../scripts/coordinated-backup.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('sauvegarde coordonnee sure', () => {
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
