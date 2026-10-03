import { expect, test } from 'vitest';
import { validateIsolatedRestoreConfiguration } from '../scripts/restore-isolated.mjs';

test('refuse toute cible distante, tout override Storage et toute classification reelle', () => {
  const env = {
    RECOVERY_ALLOW_LOCAL_RESTORE: 'true', RECOVERY_DATA_CLASSIFICATION: 'fictitious-only',
    TARGET_SUPABASE_DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres',
    TARGET_SUPABASE_URL: 'http://127.0.0.1:54321',
  };
  expect(() => validateIsolatedRestoreConfiguration(env)).not.toThrow();
  for (const overrides of [
    { TARGET_SUPABASE_DB_URL: 'postgresql://postgres:synthetic@db.production.supabase.co:5432/postgres' },
    { TARGET_SUPABASE_DB_URL: env.TARGET_SUPABASE_DB_URL + '?host=db.production.supabase.co' },
    { TARGET_SUPABASE_URL: 'https://lrzmbwdnrjjzwossntun.supabase.co' },
    { TARGET_STORAGE_API_URL: 'https://lrzmbwdnrjjzwossntun.supabase.co/storage/v1' },
    { RECOVERY_DATA_CLASSIFICATION: 'medical-real' },
    { RECOVERY_ALLOW_LOCAL_RESTORE: 'false' },
    { STORAGE_RESTORE_ALLOW_INVENTORY_MISMATCH: 'true' },
  ]) expect(() => validateIsolatedRestoreConfiguration({ ...env, ...overrides })).toThrow();
});
