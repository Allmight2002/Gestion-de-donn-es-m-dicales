import { describe, expect, test } from 'vitest';
import {
  STAGING_PROJECT_REF,
  projectRefFromDatabaseUrl,
  validateSupabaseTarget,
} from '../scripts/check-supabase-target.mjs';

const baseEnv = {
  SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  VITE_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`,
};

describe('garde de cible Supabase', () => {
  test('accepte les URL directes et pooler du staging approuve', () => {
    expect(validateSupabaseTarget({ target: 'staging', env: baseEnv })).toEqual([]);
    const pooler = `postgresql://postgres.${STAGING_PROJECT_REF}:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
    expect(projectRefFromDatabaseUrl(pooler)).toBe(STAGING_PROJECT_REF);
    expect(validateSupabaseTarget({ target: 'staging', env: { ...baseEnv, SUPABASE_DB_URL: pooler } })).toEqual([]);
  });

  test('refuse une divergence entre variables sans afficher leurs valeurs', () => {
    const other = 'abcdefghijklmnopqrst';
    const errors = validateSupabaseTarget({
      target: 'staging',
      env: { ...baseEnv, SUPABASE_URL: `https://${other}.supabase.co` },
    });
    expect(errors).toContain('SUPABASE_URL ne correspond pas a SUPABASE_PROJECT_REF.');
    expect(errors.join(' ')).not.toContain(other);
  });

  test('refuse un project ref valide mais different du staging approuve', () => {
    const other = 'abcdefghijklmnopqrst';
    const errors = validateSupabaseTarget({
      target: 'staging',
      env: {
        SUPABASE_PROJECT_REF: other,
        VITE_SUPABASE_URL: `https://${other}.supabase.co`,
        SUPABASE_URL: `https://${other}.supabase.co`,
        SUPABASE_DB_URL: `postgresql://postgres:secret@db.${other}.supabase.co:5432/postgres`,
      },
    });
    expect(errors).toContain('La cible staging ne correspond pas au projet staging MedData approuve.');
  });

  test('echoue ferme si la reference du pooler est impossible a extraire', () => {
    const errors = validateSupabaseTarget({
      target: 'staging',
      env: { ...baseEnv, SUPABASE_DB_URL: 'postgresql://postgres:secret@pooler.supabase.com:6543/postgres' },
    });
    expect(errors).toContain('SUPABASE_DB_URL ne permet pas d extraire une reference projet Supabase non ambigue.');
  });
});
