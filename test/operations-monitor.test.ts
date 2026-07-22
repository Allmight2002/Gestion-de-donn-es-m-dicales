import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  healthUrlForScan,
  monitor,
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
  MONITOR_MAX_SIGNATURE_AGE_HOURS: '48',
});

describe('monitoring operationnel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  test('accepte le statut Storage officiel a corps vide et transmet le cookie Vercel seulement au frontend', async () => {
    const config = validateMonitorConfiguration(validEnvironment());
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url === config.appUrl) {
        return new Response('<!doctype html><div id="root"></div>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.endsWith('/auth/v1/health')) return Response.json({ version: 'synthetic' });
      if (url.includes('/rest/v1/profiles')) return Response.json([]);
      if (url.endsWith('/storage/v1/status')) return new Response(null, { status: 200 });
      if (url.endsWith('/health')) return Response.json({
        status: 'ok',
        engine: 'clamav',
        engineVersion: '1.5.1',
        signatureDatabaseVersion: '27896',
        signatureDatabaseUpdatedAt: new Date().toISOString(),
        capacity: { activeScans: 0, maxConcurrentScans: 4, availableSlots: 4 },
      });
      if (init?.body === 'MedData synthetic monitoring fixture') {
        return Response.json({ status: 'clean', engine: 'clamav' });
      }
      return Response.json({ status: 'infected', engine: 'clamav', signature: 'Eicar-Test-Signature' });
    }));

    const checks = await monitor(config, { frontendCookieHeader: '_vercel_jwt=fictional-cookie' });

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.find((check) => check.name === 'supabase-storage')).toMatchObject({
      ok: true,
      httpStatus: 200,
    });
    expect(requests.find((request) => request.url === config.appUrl)?.headers.get('cookie'))
      .toBe('_vercel_jwt=fictional-cookie');
    expect(requests.filter((request) => request.url !== config.appUrl)
      .every((request) => request.headers.get('cookie') === null)).toBe(true);
  });

  test('echoue si les signatures sont perimees ou le scanner sature', async () => {
    const config = validateMonitorConfiguration(validEnvironment());
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === config.appUrl) {
        return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/auth/v1/health')) return Response.json({ version: 'synthetic' });
      if (url.includes('/rest/v1/profiles')) return Response.json([]);
      if (url.endsWith('/storage/v1/status')) return new Response(null, { status: 200 });
      if (url.endsWith('/health')) return Response.json({
        status: 'ok',
        engine: 'clamav',
        engineVersion: '1.5.1',
        signatureDatabaseVersion: '27000',
        signatureDatabaseUpdatedAt: '2026-01-01T00:00:00.000Z',
        capacity: { activeScans: 4, maxConcurrentScans: 4, availableSlots: 0 },
      });
      if (init?.body === 'MedData synthetic monitoring fixture') {
        return Response.json({ status: 'clean', engine: 'clamav' });
      }
      return Response.json({ status: 'infected', engine: 'clamav', signature: 'Eicar-Test-Signature' });
    }));

    const checks = await monitor(config);
    expect(checks.find((check) => check.name === 'clamav-health')).toMatchObject({ ok: false });
  });

  test('le workflow staging cree puis supprime un cookie ephemere borne au deploiement', () => {
    const workflow = readFileSync('.github/workflows/operations-monitor.yml', 'utf8');
    expect(workflow).toContain('Bootstrap scoped Vercel monitoring cookie');
    expect(workflow).toContain('scripts/vercel-cookie-state.mjs');
    expect(workflow).toContain('MONITOR_FRONTEND_STORAGE_STATE');
    expect(workflow).toContain('Remove ephemeral Vercel monitoring state');
    expect(workflow).not.toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
  });
});
