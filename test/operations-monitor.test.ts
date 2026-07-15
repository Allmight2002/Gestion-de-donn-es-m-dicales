import { describe, expect, test } from 'vitest';
import {
  healthUrlForScan,
  validateMonitorConfiguration,
} from '../scripts/operations-monitor.mjs';

const validEnvironment = () => ({
  MONITOR_TARGET: 'staging',
  MONITOR_APP_URL: 'https://staging.example.test',
  MONITOR_REQUIRE_STRICT_INSPECTION: 'true',
  SUPABASE_PROJECT_REF: 'gmsxrniiclrheehhoakn',
  SUPABASE_URL: 'https://gmsxrniiclrheehhoakn.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key-long-enough-for-monitoring',
  CLAMAV_SCAN_URL: 'https://scanner.example.test/scan',
  CLAMAV_SCAN_TOKEN: 'synthetic-secret-long-enough-32-characters',
});

describe('monitoring operationnel', () => {
  test('derive le endpoint de sante sans propager les parametres', () => {
    expect(healthUrlForScan('https://scanner.example.test/scan?probe=1'))
      .toBe('https://scanner.example.test/health');
    expect(() => healthUrlForScan('http://scanner.example.test/scan')).toThrow(/HTTPS/);
    expect(() => healthUrlForScan('https://scanner.example.test/other')).toThrow(/\/scan/);
  });

  test('valide une configuration staging coherente sans cle serveur', () => {
    const config = validateMonitorConfiguration(validEnvironment());
    expect(config.target).toBe('staging');
    expect(config.projectRef).toBe('gmsxrniiclrheehhoakn');
  });

  test('refuse une cible divergente, une cle serveur et le mode non strict', () => {
    expect(() => validateMonitorConfiguration({
      ...validEnvironment(),
      SUPABASE_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
    })).toThrow(/divergents/);
    expect(() => validateMonitorConfiguration({
      ...validEnvironment(),
      SUPABASE_ANON_KEY: 'service_role-secret-that-must-never-be-used',
    })).toThrow(/cle serveur/);
    expect(() => validateMonitorConfiguration({
      ...validEnvironment(),
      MONITOR_REQUIRE_STRICT_INSPECTION: 'false',
    })).toThrow(/doit valoir true/);
  });
});
