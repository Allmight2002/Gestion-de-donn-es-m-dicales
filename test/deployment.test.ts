import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('configuration de deploiement', () => {
  test('les exports conserves passent par signed-read, pas par une policy Storage SELECT directe', () => {
    const storage = read('supabase/storage.sql');
    const edge = read('supabase/functions/signed-read/index.ts');
    const exportsData = read('src/data/exports.ts');

    expect(storage).not.toMatch(/create policy "scientific_exports_read"/i);
    expect(storage).not.toMatch(/create policy "raw_documents_delete"/i);
    expect(storage).not.toMatch(/create policy "clinical_attachments_delete"/i);
    expect(storage).toContain('file_size_limit = 20971520');
    expect(storage).toContain('allowed_mime_types');
    expect(edge).toContain("entity !== 'export'");
    expect(edge).toContain("bucket = 'scientific-exports'");
    expect(edge).toContain("action = 'export_read'");
    expect(edge).toContain("path.startsWith(`${baseId}/`)");
    expect(exportsData).toContain('cleanupUploadedObject(client, EXPORTS_BUCKET, path)');
  });

  test('inspect-upload impose un verdict serveur avant la lecture de donnees reelles', () => {
    const inspect = read('supabase/functions/inspect-upload/index.ts');
    const signedRead = read('supabase/functions/signed-read/index.ts');
    const attachments = read('src/data/attachments.ts');
    const curation = read('src/data/curation.ts');
    const inspection = read('src/data/inspection.ts');
    const cleanup = read('supabase/functions/cleanup-upload/index.ts');
    const envCheck = read('scripts/check-inspection-env.mjs');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const config = read('supabase/config.toml');
    const ci = read('.github/workflows/ci.yml');

    expect(pkg.scripts['env:check']).toBe('node scripts/check-inspection-env.mjs');
    expect(ci).toContain('npm run env:check');
    expect(envCheck).toContain('frontendStrict !== edgeStrict');
    expect(envCheck).toContain('DB_REQUIRE_SERVER_INSPECTION');
    expect(envCheck).toContain('MAX_INSPECT_UPLOAD_BYTES');
    expect(envCheck).toContain('MAX_INSPECTION_ATTEMPTS');
    expect(envCheck).toContain('INSPECTION_RETRY_COOLDOWN_MS');
    expect(config).toContain('[functions.inspect-upload]');
    expect(config).toContain('[functions.cleanup-upload]');
    expect(inspect).toContain("CLAMAV_SCAN_URL");
    expect(inspect).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(inspect).toContain("inspection_status: 'scanning'");
    expect(inspect).toContain("currentStatus === 'accepted_client'");
    expect(inspect).toContain('inspection_run_id');
    expect(inspect).toContain("admin.rpc('complete_file_inspection'");
    expect(inspect).toContain('MAX_INSPECT_UPLOAD_BYTES');
    expect(inspect).toContain('MAX_INSPECTION_ATTEMPTS');
    expect(inspect).toContain('INSPECTION_RETRY_COOLDOWN_MS');
    expect(inspect).toContain('last_inspection_error');
    expect(inspect).toContain("engine: 'size-limit'");
    expect(inspect).toContain("'magic-bytes'");
    expect(inspect).toContain('officeSubtypeMatches');
    expect(inspect).toContain("'accepted'");
    expect(inspect).toContain("'quarantined'");
    expect(inspect).toContain("path.startsWith(`${baseId}/`)");
    expect(signedRead).toContain("REQUIRE_SERVER_INSPECTION");
    expect(signedRead).toContain("status === 'quarantined'");
    expect(signedRead).toContain("status === 'pending' || status === 'scanning'");
    expect(inspection).toContain("VITE_REQUIRE_SERVER_INSPECTION");
    expect(inspection).toContain("!requireServerInspection && status === 'accepted_client'");
    expect(inspection).toContain("requireServerInspection && status === 'accepted_client'");
    expect(inspection).toContain("inspect-upload");
    expect(inspection).toContain("cleanup-upload");
    expect(cleanup).toContain("orphan_upload_removed");
    expect(cleanup).toContain("Objet deja rattache a une ligne metier");
    expect(attachments).toContain("REQUIRE_SERVER_INSPECTION ? 'pending' : 'accepted_client'");
    expect(attachments).toContain('cleanupUploadedObject(client, ATTACHMENTS_BUCKET, path)');
    expect(attachments).toContain("inspectUploadedFile(client, 'attachment'");
    expect(curation).toContain("REQUIRE_SERVER_INSPECTION ? 'pending' : 'accepted_client'");
    expect(curation).toContain('cleanupUploadedObject(client, RAW_DOCUMENTS_BUCKET, path)');
    expect(curation).toContain("inspectUploadedFile(client, 'raw_document'");
  });

  test('le service ClamAV local et les variables de deploiement sont declares', () => {
    const compose = read('docker-compose.clamav.yml');
    const dockerfile = read('services/clamav-scanner/Dockerfile');
    const scanner = read('services/clamav-scanner/server.mjs');
    const prodEnv = read('.env.production.example');
    const viteConfig = read('vite.config.ts');

    expect(compose).toContain('clamav/clamav:stable@sha256:6f4a9e7d616ffc8d1070200fe35ac860735fdd522161a1043f94856e6ee13c28');
    expect(compose).toContain('clamav-scanner');
    expect(compose).toContain('CLAMAV_SCAN_TOKEN requis');
    expect(compose).toContain('clamdscan --ping');
    expect(dockerfile).toContain('node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2');
    expect(compose).not.toMatch(/image:\s*clamav\/clamav:stable\s*$/m);
    expect(dockerfile).not.toMatch(/^FROM\s+node:22-alpine\s*$/m);
    expect(scanner).toContain('zINSTREAM');
    expect(scanner).toContain('POST /scan expected');
    expect(scanner).toContain('FORBIDDEN_TOKENS');
    expect(prodEnv).toContain('CLAMAV_SCAN_URL=');
    expect(prodEnv).toContain('CLAMAV_SCAN_TOKEN=');
    expect(prodEnv).toContain('VITE_REQUIRE_SERVER_INSPECTION=');
    expect(prodEnv).toContain('MAX_INSPECTION_ATTEMPTS=');
    expect(prodEnv).toContain('INSPECTION_RETRY_COOLDOWN_MS=');
    expect(viteConfig).toContain("VITE_REQUIRE_SERVER_INSPECTION === 'true'");
    expect(viteConfig).toContain("VITE_USE_SIGNED_READ !== 'true'");
    expect(viteConfig).toContain('VERCEL_GIT_COMMIT_SHA');
    expect(viteConfig).toContain('VERCEL_GIT_COMMIT_REF');
    expect(viteConfig).toContain('__GIT_COMMIT__');
    expect(viteConfig).toContain('__GIT_BRANCH__');
    expect(viteConfig).toContain('__BUILD_TIME__');
  });

  test('vercel.json declare le fallback SPA et les principaux headers de securite', () => {
    const config = JSON.parse(read('vercel.json')) as {
      rewrites: Array<{ source: string; destination: string }>;
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const headers = new Map(config.headers[0].headers.map((h) => [h.key.toLowerCase(), h.value]));

    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('permissions-policy')).toContain('camera=()');
  });
});
