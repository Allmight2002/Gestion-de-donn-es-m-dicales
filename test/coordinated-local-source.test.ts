import { expect, test } from 'vitest';
import { validateCoordinatedSource } from '../scripts/coordinated-backup.mjs';
const env = { RECOVERY_ALLOW_LOCAL_BACKUP: 'true', RECOVERY_DATA_CLASSIFICATION: 'fictitious-only', SUPABASE_PROJECT_REF: 'meddata-recovery-source', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_DB_URL: 'postgresql://127.0.0.1:54322/postgres', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key-for-test' };
test('source locale explicite sans usurper staging ou production', () => {
  expect(validateCoordinatedSource('isolated-local', env).target).toBe('isolated-local');
  for (const patch of [{ RECOVERY_DATA_CLASSIFICATION: 'real' }, { RECOVERY_ALLOW_LOCAL_BACKUP: '' }, { SUPABASE_URL: 'https://example.com:443' }, { SUPABASE_DB_URL: 'postgres://example.com:5432/postgres' }, { SUPABASE_URL: 'http://127.0.0.1:54321/storage/v1' }]) {
    expect(() => validateCoordinatedSource('isolated-local', { ...env, ...patch })).toThrow();
  }
  expect(() => validateCoordinatedSource('production', env)).toThrow();
  expect(() => validateCoordinatedSource('staging', env)).toThrow();
});
