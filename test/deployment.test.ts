import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('configuration de deploiement', () => {
  test('les exports conserves passent par signed-read, pas par une policy Storage SELECT directe', () => {
    const storage = read('supabase/storage.sql');
    const edge = read('supabase/functions/signed-read/index.ts');

    expect(storage).not.toMatch(/create policy "scientific_exports_read"/i);
    expect(edge).toContain("entity !== 'export'");
    expect(edge).toContain("bucket = 'scientific-exports'");
    expect(edge).toContain("action = 'export_read'");
    expect(edge).toContain("path.startsWith(`${baseId}/`)");
  });

  test('vercel.json declare les principaux headers de securite', () => {
    const config = JSON.parse(read('vercel.json')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const headers = new Map(config.headers[0].headers.map((h) => [h.key.toLowerCase(), h.value]));

    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('permissions-policy')).toContain('camera=()');
  });
});
