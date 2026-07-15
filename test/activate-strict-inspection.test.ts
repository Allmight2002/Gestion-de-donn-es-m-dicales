import { describe, expect, test, vi } from 'vitest';
import {
  activateStrictInspection,
  verifyStrictScanner,
  type StrictInspectionClient,
} from '../scripts/activate-strict-inspection.mjs';

describe('activation stricte de staging', () => {
  test('prouve health, clean et EICAR sans exposer le token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/health')) return Response.json({ status: 'ok' });
      const bytes = Buffer.from(init?.body as Uint8Array).toString('utf8');
      return Response.json(bytes.includes('EICAR')
        ? { status: 'infected', signature: 'Eicar-Test-Signature', engine: 'clamav' }
        : { status: 'clean', signature: null, engine: 'clamav' });
    });

    await verifyStrictScanner({
      scanUrl: 'https://scanner.staging.example/scan',
      token: 'staging-secret-token-at-least-32-characters',
      fetchImpl,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://scanner.staging.example/health');
    expect(calls[1].init?.headers).toMatchObject({ authorization: 'Bearer staging-secret-token-at-least-32-characters' });
    expect(Buffer.from(calls[2].init?.body as Uint8Array).toString('utf8')).toContain('EICAR');
  });

  test('refuse un transport scanner non chiffre', async () => {
    await expect(verifyStrictScanner({
      scanUrl: 'http://scanner.staging.example/scan',
      token: 'staging-secret-token-at-least-32-characters',
      fetchImpl: vi.fn(),
    })).rejects.toThrow('URL HTTPS');
  });

  test('active la DB dans une transaction idempotente et verifie la valeur reelle', async () => {
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

    await activateStrictInspection({
      dbUrl: 'postgresql://user:password@db.example.test:5432/postgres',
      createClient: async () => client,
    });

    expect(sql[0]).toBe('begin');
    expect(sql.some((query) => query.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql.some((query) => query.startsWith('update public.app_security_setting'))).toBe(true);
    expect(sql.at(-1)).toBe('commit');
    expect(client.end).toHaveBeenCalledOnce();
  });

  test('rollback si la ligne de configuration attendue est absente', async () => {
    const sql: string[] = [];
    const client: StrictInspectionClient = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (query: string) => {
        sql.push(query);
        if (query.startsWith('update public.app_security_setting')) return { rowCount: 0, rows: [] };
        return { rowCount: null, rows: [] };
      }),
      end: vi.fn(async () => {}),
    };

    await expect(activateStrictInspection({
      dbUrl: 'postgresql://user:password@db.example.test:5432/postgres',
      createClient: async () => client,
    })).rejects.toThrow('absente ou ambigue');
    expect(sql.at(-1)).toBe('rollback');
    expect(client.end).toHaveBeenCalledOnce();
  });
});
