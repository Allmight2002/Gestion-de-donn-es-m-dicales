// Decision du 12 aout 2026 (docs/decision-pause-inspection-2026-08-12.md) : le parcours
// antivirus peut etre SUSPENDU. Ce fichier verrouille les deux proprietes qui empechent
// cette derogation de deriver en desactivation silencieuse :
//   1. le defaut reste STRICT — une variable oubliee ne desactive jamais l'antivirus ;
//   2. la pause est DECLAREE et COHERENTE — les trois drapeaux bougent ensemble, sinon
//      la release echoue (frontend permissif + base stricte = documents bloques en pending).
import { spawnSync } from 'node:child_process';
import { describe, expect, test, vi } from 'vitest';
import {
  INSPECTION_PAUSED,
  INSPECTION_STRICT,
  expectedInspectionFlag,
  inspectionPauseBanner,
  readInspectionMode,
} from '../scripts/inspection-mode.mjs';
import { pauseServerInspection, type StrictInspectionClient } from '../scripts/activate-strict-inspection.mjs';
import { STAGING_PROJECT_REF } from '../scripts/check-supabase-target.mjs';

function releaseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VITE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: 'cle-anon-publique-de-test-1234567890',
    VITE_USE_SIGNED_READ: 'true',
    VITE_OFFLINE_MODE: 'disabled',
    VITE_OFFLINE_ADMIN_ACK: 'false',
    SUPABASE_ACCESS_TOKEN: 'jeton-access-de-test',
    SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
    SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`,
    SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
    SUPABASE_ANON_KEY: 'cle-anon-publique-de-test-1234567890',
    SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-de-test-1234567890',
    CLAMAV_SCAN_URL: '',
    CLAMAV_SCAN_TOKEN: '',
    ...overrides,
  };
}

function runReleaseEnv(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['scripts/release-env-check.mjs', '--target=staging'], {
    env, encoding: 'utf8', timeout: 60_000,
  });
}

const pausedFlags = {
  INSPECTION_MODE: 'paused',
  VITE_REQUIRE_SERVER_INSPECTION: 'false',
  REQUIRE_SERVER_INSPECTION: 'false',
  DB_REQUIRE_SERVER_INSPECTION: 'false',
};

describe('mode d inspection declare', () => {
  test('le defaut reste strict : une variable absente ou vide ne desactive rien', () => {
    expect(readInspectionMode({})).toBe(INSPECTION_STRICT);
    expect(readInspectionMode({ INSPECTION_MODE: '' })).toBe(INSPECTION_STRICT);
    expect(readInspectionMode({ INSPECTION_MODE: '  STRICT ' })).toBe(INSPECTION_STRICT);
    expect(readInspectionMode({ INSPECTION_MODE: 'paused' })).toBe(INSPECTION_PAUSED);
    expect(expectedInspectionFlag(INSPECTION_STRICT)).toBe('true');
    expect(expectedInspectionFlag(INSPECTION_PAUSED)).toBe('false');
  });

  test('une valeur inconnue n est jamais interpretee comme une pause', () => {
    for (const value of ['off', 'false', 'disabled', 'no', '0']) {
      expect(readInspectionMode({ INSPECTION_MODE: value })).toBeNull();
    }
  });

  test('la banniere nomme la perte reelle, pas seulement la variable', () => {
    const banner = inspectionPauseBanner('production');
    expect(banner).toContain('production');
    expect(banner).toContain('SUSPENDUE');
    expect(banner).toMatch(/fictives/i);
    expect(banner).toContain('INSPECTION_MODE=strict');
  });
});

describe('gate de release et parcours antivirus', () => {
  test('pause declaree : la release passe SANS scanner et annonce la derogation', () => {
    const res = runReleaseEnv(releaseEnv(pausedFlags));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('DEROGATION SCANNER');
    expect(res.stdout).toContain('Configuration release staging: OK');
  });

  test('mode strict : l absence de scanner reste bloquante', () => {
    const res = runReleaseEnv(releaseEnv({
      INSPECTION_MODE: 'strict',
      VITE_REQUIRE_SERVER_INSPECTION: 'true',
      REQUIRE_SERVER_INSPECTION: 'true',
      DB_REQUIRE_SERVER_INSPECTION: 'true',
    }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('CLAMAV_SCAN_URL');
    expect(res.stderr).toContain('CLAMAV_SCAN_TOKEN');
  });

  test('trio incoherent : une base restee stricte face a un frontend permissif est refusee', () => {
    const res = runReleaseEnv(releaseEnv({ ...pausedFlags, DB_REQUIRE_SERVER_INSPECTION: 'true' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("DB_REQUIRE_SERVER_INSPECTION doit valoir 'false'");
  });

  test('drapeau omis : la pause doit etre ecrite, jamais deduite', () => {
    const res = runReleaseEnv(releaseEnv({ ...pausedFlags, REQUIRE_SERVER_INSPECTION: '' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("REQUIRE_SERVER_INSPECTION doit valoir 'false'");
  });

  test('valeur INSPECTION_MODE inconnue : la release refuse de conclure', () => {
    const res = runReleaseEnv(releaseEnv({ ...pausedFlags, INSPECTION_MODE: 'off' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('INSPECTION_MODE');
  });
});

describe('suspension de la politique DB', () => {
  test('ecrit false dans la meme transaction verrouillee, puis relit la valeur reelle', async () => {
    const sql: string[] = [];
    const client: StrictInspectionClient = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (query: string) => {
        sql.push(query);
        if (query.startsWith('update public.app_security_setting')) return { rowCount: 1, rows: [{ key: 'require_server_inspection' }] };
        if (query.startsWith('select public.require_server_inspection')) return { rowCount: 1, rows: [{ strict: false }] };
        return { rowCount: null, rows: [] };
      }),
      end: vi.fn(async () => {}),
    };

    await pauseServerInspection({
      dbUrl: 'postgresql://user:password@db.example.test:5432/postgres',
      createClient: async () => client,
    });

    expect(sql[0]).toBe('begin');
    expect(sql.some((query) => query.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql.some((query) => query.includes("set value = 'false'"))).toBe(true);
    expect(sql.at(-1)).toBe('commit');
    expect(client.end).toHaveBeenCalledOnce();
  });

  test('rollback si la base pretend rester stricte apres la mise a jour', async () => {
    const sql: string[] = [];
    const client: StrictInspectionClient = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (query: string) => {
        sql.push(query);
        if (query.startsWith('update public.app_security_setting')) return { rowCount: 1, rows: [{ key: 'require_server_inspection' }] };
        if (query.startsWith('select public.require_server_inspection')) return { rowCount: 1, rows: [{ strict: true }] };
        return { rowCount: null, rows: [] };
      }),
      end: vi.fn(async () => {}),
    };

    await expect(pauseServerInspection({
      dbUrl: 'postgresql://user:password@db.example.test:5432/postgres',
      createClient: async () => client,
    })).rejects.toThrow('ne confirme pas la suspension');
    expect(sql.at(-1)).toBe('rollback');
  });
});
