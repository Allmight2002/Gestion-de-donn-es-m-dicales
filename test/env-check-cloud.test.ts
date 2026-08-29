// Audit v18 §6.2 — `env:check:cloud` : le preflight de release ne doit pas CROIRE la
// variable DB_REQUIRE_SERVER_INSPECTION, il interroge la valeur REELLE de
// public.require_server_inspection() dans la base. On execute ici le vrai script
// (child process) contre le PostgreSQL EMBARQUE (toutes migrations rejouees).
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb | undefined;

beforeAll(async () => {
  db = await startTestDb();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// Environnement STRICT complet et coherent cote variables (les controles statiques
// passent) : seul le desaccord avec la base doit alors faire echouer le mode cloud.
function strictEnv(dbUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VITE_REQUIRE_SERVER_INSPECTION: 'true',
    REQUIRE_SERVER_INSPECTION: 'true',
    VITE_USE_SIGNED_READ: 'true',
    DB_REQUIRE_SERVER_INSPECTION: 'true',
    CLAMAV_SCAN_URL: 'http://127.0.0.1:8088/scan',
    CLAMAV_SCAN_TOKEN: 'jeton-de-test-non-defaut-32-caracteres',
    QUARANTINE_BUCKET: 'quarantined-uploads',
    SUPABASE_DB_URL: dbUrl,
  };
}

function runCheck(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['scripts/check-inspection-env.mjs', '--cloud'], {
    env, encoding: 'utf8', timeout: 60_000,
  });
}

describe('env:check:cloud (audit v18 §6.2)', () => {
  test('configuration non stricte + base non stricte : concordance -> succes', () => {
    if (!db) throw new Error('PostgreSQL de test non initialise');
    const res = runCheck({ ...process.env, SUPABASE_DB_URL: db.url,
      VITE_REQUIRE_SERVER_INSPECTION: '', REQUIRE_SERVER_INSPECTION: '', DB_REQUIRE_SERVER_INSPECTION: '' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('require_server_inspection() = false');
    expect(res.stdout).toContain('Inspection env OK');
  });

  test('variables strictes mais base NON migree : la release est bloquee', () => {
    if (!db) throw new Error('PostgreSQL de test non initialise');
    const res = runCheck(strictEnv(db.url));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('require_server_inspection() renvoie false');
  });

  test('variables strictes ET base stricte : succes (valeur lue en base, pas declaree)', async () => {
    if (!db) throw new Error('PostgreSQL de test non initialise');
    await db.admin.query(
      "update public.app_security_setting set value = 'true' where key = 'require_server_inspection'",
    );
    const res = runCheck(strictEnv(db.url));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('require_server_inspection() = true');
  });

  test('sans SUPABASE_DB_URL, le mode cloud refuse de conclure', () => {
    const res = runCheck({ ...process.env, SUPABASE_DB_URL: '',
      VITE_REQUIRE_SERVER_INSPECTION: '', REQUIRE_SERVER_INSPECTION: '' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('SUPABASE_DB_URL');
  });
});
