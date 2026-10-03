import { describe, expect, test } from 'vitest';
import { validateContinuityPolicy } from '../scripts/continuity-policy.mjs';
import { validateStorageRestoreTarget } from '../scripts/storage-object-backup.mjs';
import { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from '../scripts/check-supabase-target.mjs';

describe('politique production et isolation', () => {
  test('exige une version de cle et borne la retention', () => {
    const config = { BACKUP_TARGET: 'production', BACKUP_KEY_ID: 'production-20261002' };
    expect(validateContinuityPolicy(config).retentionDays).toBe(30);
    expect(validateContinuityPolicy({ ...config, BACKUP_RETENTION_DAYS: '60' }).retentionDays).toBe(60);
    for (const value of ['0', '91', '-1', '1.5', 'patient@example.test']) {
      expect(() => validateContinuityPolicy({ ...config, BACKUP_RETENTION_DAYS: value })).toThrow();
    }
    expect(() => validateContinuityPolicy({ BACKUP_TARGET: 'production' })).toThrow();
  });

  test('interdit toujours les projets actifs et exige une cible distante explicite', () => {
    const env = { STORAGE_RESTORE_ALLOW_REMOTE: 'true' };
    for (const ref of [PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF]) {
      expect(() => validateStorageRestoreTarget(`https://${ref}.supabase.co/storage/v1`, {
        ...env, STORAGE_RESTORE_ISOLATED_PROJECT_REF: ref,
      })).toThrow(/active/);
    }
    const ref = 'a'.repeat(20);
    expect(() => validateStorageRestoreTarget(`https://${ref}.supabase.co`, env)).toThrow();
    expect(() => validateStorageRestoreTarget(`https://${ref}.supabase.co`, {
      ...env, STORAGE_RESTORE_ISOLATED_PROJECT_REF: ref,
    })).not.toThrow();
    expect(() => validateStorageRestoreTarget('http://127.0.0.1:54321')).not.toThrow();
    expect(() => validateStorageRestoreTarget('http://[::1]:54321')).not.toThrow();
  });
});
