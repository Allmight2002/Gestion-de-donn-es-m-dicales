import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('configuration de deploiement', () => {
  test('les exports conserves passent par signed-read, pas par une policy Storage SELECT directe', () => {
    const storage = read('supabase/storage.sql');
    const edge = read('supabase/functions/signed-read/index.ts');

    expect(storage).not.toMatch(/create policy "scientific_exports_read"/i);
    expect(storage).not.toMatch(/create policy "raw_documents_delete"/i);
    expect(storage).not.toMatch(/create policy "clinical_attachments_delete"/i);
    expect(edge).toContain("entity !== 'export'");
    expect(edge).toContain("bucket = 'scientific-exports'");
    expect(edge).toContain("action = 'export_read'");
    expect(edge).toContain("path.startsWith(`${baseId}/`)");
  });

  test('inspect-upload impose un verdict serveur avant la lecture de donnees reelles', () => {
    const inspect = read('supabase/functions/inspect-upload/index.ts');
    const signedRead = read('supabase/functions/signed-read/index.ts');
    const attachments = read('src/data/attachments.ts');
    const curation = read('src/data/curation.ts');
    const inspection = read('src/data/inspection.ts');
    const config = read('supabase/config.toml');

    expect(config).toContain('[functions.inspect-upload]');
    expect(inspect).toContain("CLAMAV_SCAN_URL");
    expect(inspect).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(inspect).toContain("inspection_status: status");
    expect(inspect).toContain("'accepted'");
    expect(inspect).toContain("'quarantined'");
    expect(inspect).toContain("path.startsWith(`${baseId}/`)");
    expect(signedRead).toContain("REQUIRE_SERVER_INSPECTION");
    expect(signedRead).toContain("data.inspection_status !== 'accepted'");
    expect(inspection).toContain("VITE_REQUIRE_SERVER_INSPECTION");
    expect(inspection).toContain("inspect-upload");
    expect(attachments).toContain("REQUIRE_SERVER_INSPECTION ? 'pending' : 'accepted_client'");
    expect(attachments).toContain("inspectUploadedFile(client, 'attachment'");
    expect(curation).toContain("REQUIRE_SERVER_INSPECTION ? 'pending' : 'accepted_client'");
    expect(curation).toContain("inspectUploadedFile(client, 'raw_document'");
  });

  test('le service ClamAV local et les variables de deploiement sont declares', () => {
    const compose = read('docker-compose.clamav.yml');
    const scanner = read('services/clamav-scanner/server.mjs');
    const prodEnv = read('.env.production.example');
    const viteConfig = read('vite.config.ts');

    expect(compose).toContain('clamav/clamav:stable');
    expect(compose).toContain('clamav-scanner');
    expect(scanner).toContain('zINSTREAM');
    expect(scanner).toContain('POST /scan expected');
    expect(prodEnv).toContain('CLAMAV_SCAN_URL=');
    expect(prodEnv).toContain('CLAMAV_SCAN_TOKEN=');
    expect(prodEnv).toContain('VITE_REQUIRE_SERVER_INSPECTION=');
    expect(viteConfig).toContain("VITE_REQUIRE_SERVER_INSPECTION === 'true'");
    expect(viteConfig).toContain("VITE_USE_SIGNED_READ !== 'true'");
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
