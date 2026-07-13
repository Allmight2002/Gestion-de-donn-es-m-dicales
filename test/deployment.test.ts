import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

// Source COMPLETE d'une Edge Function : index.ts (adaptateur mince) + modules extraits (handler.ts,
// etc.). Les gardes structurelles doivent porter sur le comportement, pas sur son emplacement : apres
// l'extraction de handleRequest (audit lot 9 §C3), la logique vit dans handler.ts et non plus dans
// index.ts. On concatene donc tous les .ts non-test du dossier pour rester robuste au refactor.
const readFn = (name: string): string => {
  const dir = `supabase/functions/${name}`;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('_test.ts'))
    .sort()
    .map((f) => read(`${dir}/${f}`))
    .join('\n');
};

describe('configuration de deploiement', () => {
  test('les exports conserves passent par signed-read, pas par une policy Storage SELECT directe', () => {
    const storage = read('supabase/storage.sql');
    const edge = readFn('signed-read');
    const generateExport = readFn('generate-export');
    const exportsData = read('src/data/exports.ts');
    const config = read('supabase/config.toml');

    expect(storage).not.toMatch(/create policy "scientific_exports_read"/i);
    expect(storage).not.toMatch(/create policy "scientific_exports_insert"/i);
    expect(storage).not.toMatch(/create policy "raw_documents_delete"/i);
    expect(storage).not.toMatch(/create policy "clinical_attachments_delete"/i);
    expect(storage).toContain('file_size_limit = 20971520');
    expect(storage).toContain('allowed_mime_types');
    expect(storage).toContain("values ('quarantined-uploads'");
    // Audit v20 §7.5 : prouver l'ETAT voulu — la quarantaine n'a AUCUNE policy utilisateur
    // (service_role seulement, qui contourne la RLS). L'ancienne assertion toContain
    // matchait une chaine presente... dans un drop policy.
    expect(storage).not.toMatch(/create policy "quarantined[^"]*"/i);
    for (const op of ['read', 'insert', 'update', 'delete']) {
      expect(storage).toContain(`drop policy if exists "quarantined_uploads_${op}"`);
    }
    expect(edge).toContain("['attachment', 'raw_document', 'export']");
    expect(edge).toContain("bucket = 'scientific-exports'");
    expect(edge).toContain("action = 'export_read'");
    expect(edge).toContain("path.startsWith(`${baseId}/`)");
    expect(storage).toContain('has_pending_upload_ticket');
    expect(config).toContain('[functions.generate-export]');
    expect(exportsData).toContain("client.functions.invoke('generate-export'");
    expect(exportsData).not.toContain('createUploadTicket(client, input.baseId, EXPORTS_BUCKET');
    expect(exportsData).not.toContain('cleanupUploadedObject(client, EXPORTS_BUCKET');
    expect(exportsData).not.toContain('crypto.subtle.digest');
    expect(generateExport).toContain('can_export_data');
    expect(generateExport).toContain('admin.storage.from(EXPORTS_BUCKET).upload');
    expect(generateExport).toContain("generation_mode: 'server'");
    expect(generateExport).toContain("generated_by: 'edge:generate-export'");
    expect(generateExport).toContain('fileHash');
    // XLSX (audit lot 9 §C1) : l'invariant REEL, pas un import npm en dur. La version vit dans UNE
    // seule source de verite (l'alias `xlsx` de deno.json), elle est VERROUILLEE dans deno.lock, et
    // generate-export l'importe par alias sans version flottante ni URL/import npm concurrent.
    const denoImports = (JSON.parse(read('deno.json')) as { imports: Record<string, string> }).imports;
    const xlsxSpecifier = denoImports.xlsx;
    expect(xlsxSpecifier).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    expect(read('deno.lock')).toContain(xlsxSpecifier); // present + resolution figee du meme specifier
    expect(generateExport).toContain("from 'xlsx'");
    expect(generateExport).not.toMatch(/from ['"]npm:xlsx/); // aucun import npm direct concurrent
    expect(generateExport).not.toContain('cdn.sheetjs.com'); // aucune URL en dur hors deno.json
    expect(generateExport).not.toContain('xlsx@0.18.5'); // aucune version flottante/obsolete
    expect(generateExport).toContain("from './exportContract.ts'");
    expect(generateExport).toContain('referencedTemplateVersions(patients, encounters)');
    expect(generateExport).not.toContain(".eq('template_version_id', base.current_template_version_id)");
  });

  test('inspect-upload impose un verdict serveur avant la lecture de donnees reelles', () => {
    const inspect = readFn('inspect-upload');
    const reconcile = readFn('reconcile-quarantine');
    const signedRead = readFn('signed-read');
    const attachments = read('src/data/attachments.ts');
    const curation = read('src/data/curation.ts');
    const inspection = read('src/data/inspection.ts');
    const uploadHardening = read('supabase/migrations/20260712000100_upload_operation_hardening.sql');
    const cleanup = readFn('cleanup-upload');
    const finalizeUpload = readFn('finalize-upload');
    const envCheck = read('scripts/check-inspection-env.mjs');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const config = read('supabase/config.toml');
    const ci = read('.github/workflows/ci.yml');

    expect(pkg.scripts['env:check']).toBe('node scripts/check-inspection-env.mjs');
    expect(pkg.scripts['env:check:cloud']).toBe('node scripts/check-inspection-env.mjs --cloud');
    expect(ci).toContain('npm run env:check');
    // Idee volee a un audit externe (qui croyait le controle deja present) : la CI refuse
    // un bundle contenant un motif de cle serveur.
    expect(ci).toContain('sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY');
    // §6.2 audit v18 : le preflight de release interroge la valeur REELLE dans la base.
    expect(envCheck).toContain('require_server_inspection()');
    expect(envCheck).toContain('SUPABASE_DB_URL');
    expect(envCheck).toContain('frontendStrict !== edgeStrict');
    expect(envCheck).toContain('DB_REQUIRE_SERVER_INSPECTION');
    expect(envCheck).toContain('MAX_INSPECT_UPLOAD_BYTES');
    expect(envCheck).toContain('MAX_INSPECTION_ATTEMPTS');
    expect(envCheck).toContain('INSPECTION_RETRY_COOLDOWN_MS');
    expect(envCheck).toContain('QUARANTINE_BUCKET');
    expect(config).toContain('[functions.inspect-upload]');
    expect(config).toContain('[functions.cleanup-upload]');
    expect(config).toContain('[functions.finalize-upload]');
    expect(config).toContain('[functions.reconcile-quarantine]');
    expect(inspect).toContain("CLAMAV_SCAN_URL");
    // Service role (audit lot 9 §C1) : la cle n'est lue QUE via le helper partage supabaseEnvironment()
    // (contracts.ts), qui l'EXIGE explicitement (requiredEnv -> echec si absente) ; inspect-upload ne la
    // lit jamais en direct et construit le client admin cote serveur via env.serviceRoleKey. La preuve de
    // non-fuite (aucune cle/token dans une reponse ou un log) est portee par les tests comportementaux
    // du handler (handler_test.ts).
    const sharedContracts = read('supabase/functions/_shared/contracts.ts');
    expect(inspect).toContain('supabaseEnvironment()');
    expect(inspect).toContain('createClient(env.url, env.serviceRoleKey');
    expect(inspect).not.toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"); // aucune lecture directe hors helper
    expect(sharedContracts).toMatch(/requiredEnv\(\[[^\]]*'SUPABASE_SERVICE_ROLE_KEY'/); // le helper l'exige
    expect(inspect).toContain("inspection_status: 'scanning'");
    expect(inspect).toContain("currentStatus === 'accepted_client'");
    expect(inspect).toContain('inspection_run_id');
    expect(inspect).toContain("admin.rpc('complete_file_inspection'");
    expect(inspect).toContain('MAX_INSPECT_UPLOAD_BYTES');
    expect(inspect).toContain('MAX_INSPECTION_ATTEMPTS');
    expect(inspect).toContain('INSPECTION_RETRY_COOLDOWN_MS');
    expect(inspect).toContain('QUARANTINE_BUCKET');
    expect(inspect).toContain('moveToPhysicalQuarantine');
    expect(inspect).toContain('record_quarantine_move');
    expect(inspect).toContain('update_quarantine_move');
    expect(inspect).toContain('.from(config.quarantineBucket).upload');
    expect(inspect).toContain('.from(bucket).remove([path])');
    expect(inspect).toContain('p_quarantine_bucket');
    expect(inspect).toContain('p_quarantine_path');
    // Audit v19 §5.4 : la restauration depuis la quarantaine lit { error } et journalise.
    expect(inspect).toContain('restauration quarantaine impossible');
    expect(inspect).toContain('restored.ok');
    expect(inspect).toContain('last_inspection_error');
    expect(inspect).toContain("'size-limit'");
    expect(inspect).toContain("'magic-bytes'");
    expect(inspect).toContain('officeSubtypeMatches');
    expect(inspect).toContain("'accepted'");
    expect(inspect).toContain("'quarantined'");
    expect(inspect).toContain("path.startsWith(`${baseId}/`)");
    expect(reconcile).toContain('quarantine_reconciliation_candidates');
    expect(reconcile).toContain("profile?.global_role !== 'system_admin'");
    expect(reconcile).toContain("admin.rpc('complete_file_inspection'");
    expect(signedRead).toContain("REQUIRE_SERVER_INSPECTION");
    expect(signedRead).toContain("status === 'quarantined'");
    expect(signedRead).toContain("status === 'pending' || status === 'scanning'");
    expect(inspection).toContain("VITE_REQUIRE_SERVER_INSPECTION");
    expect(inspection).toContain("!requireServerInspection && status === 'accepted_client'");
    expect(inspection).toContain("requireServerInspection && status === 'accepted_client'");
    expect(inspection).toContain("inspect-upload");
    // Le client passe par l'operation idempotente serveur ; les wrappers historiques ont disparu.
    expect(inspection).toContain('create_upload_operation');
    expect(inspection).toContain("functions.invoke('finalize-upload'");
    expect(finalizeUpload).toContain("admin.rpc('complete_verified_upload_operation'");
    expect(finalizeUpload).toContain("admin.storage.from(ticket.bucket).download(ticket.path)");
    expect(inspection).not.toContain('export async function createUploadTicket');
    expect(inspection).not.toContain('export async function cleanupUploadedObject');
    expect(cleanup).toContain("orphan_upload_removed");
    expect(cleanup).toContain("ticketId requis");
    expect(cleanup).toContain(".from('upload_ticket')");
    expect(cleanup).toContain("Ticket upload non proprietaire");
    expect(cleanup).toContain("Objet deja rattache a une ligne metier");
    // --- Architecture REELLE des uploads : identite/idempotence/verdict cote serveur (§ lot uploads) ---
    // Les deux couches d'acces utilisent l'operation idempotente et la finalisation serveur ; elles ne
    // recalculent plus le verdict initial et ne peuvent pas reintroduire la voie ticket+cleanup directe.
    for (const src of [attachments, curation]) {
      expect(src).toContain('createUploadOperation(client, {');
      expect(src).toContain('finalizeUploadOperation(client, operation.ticketId');
      expect(src).toContain('stableUploadOperationKey(');
      expect(src).not.toMatch(/'pending'\s*:\s*'accepted_client'/); // verdict initial: plus decide cote client
      expect(src).not.toContain('createUploadTicket(');
      expect(src).not.toContain('cleanupUploadedObject(');
    }
    expect(attachments).toContain("inspectUploadedFile(client, 'attachment'");
    expect(curation).toContain("inspectUploadedFile(client, 'raw_document'");
    // Le verdict pending/accepted_client est decide en SQL ; le client ne peut poser ni 'accepted'
    // ni 'quarantined' a la finalisation (seul inspect-upload ecrit un verdict terminal).
    expect(uploadHardening).toContain('require_server_inspection()');
    expect(uploadHardening).toContain("then 'pending' else 'accepted_client'");
    expect(uploadHardening).not.toContain("'accepted'");
    expect(uploadHardening).not.toContain("'quarantined'");
    // Durcissement additif : creations concurrentes deterministes + refus explicite du soft-delete rejoue.
    expect(uploadHardening).toContain('when unique_violation then');
    expect(uploadHardening).toContain('Document supprime : operation d upload non rejouable');
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
    expect(prodEnv).toContain('QUARANTINE_BUCKET=');
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

  test('les E2E staging obtiennent un cookie Vercel sans propager le secret aux appels cross-origin', () => {
    const config = read('playwright.config.ts');
    const setup = read('e2e/vercel-bypass.setup.ts');
    const state = read('e2e/vercel-bypass-state.ts');

    expect(config).toContain("globalSetup: './e2e/vercel-bypass.setup.ts'");
    expect(config).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(config).not.toContain('extraHTTPHeaders');
    expect(setup).toContain("'x-vercel-protection-bypass': secret");
    expect(setup).toContain("'x-vercel-set-bypass-cookie': 'true'");
    expect(setup).toContain('await api.storageState');
    expect(setup).toContain("await api.get('/', { maxRedirects: 0 });");
    expect(setup).toContain('state.cookies.some');
    expect(state).toContain('process.env.RUNNER_TEMP ?? tmpdir()');
  });

  test('la release coordonnee verrouille la cible avant toute ecriture staging', () => {
    const workflow = read('.github/workflows/coordinated-release.yml');
    const targetGate = workflow.indexOf('npm run release:env -- --target=staging');
    const databaseWrite = workflow.indexOf('supabase@$SUPABASE_CLI_VERSION" db push');
    const storageWrite = workflow.indexOf('npm run supabase:storage');
    const edgeWrite = workflow.indexOf('supabase@$SUPABASE_CLI_VERSION" secrets set');

    expect(targetGate).toBeGreaterThan(-1);
    expect(databaseWrite).toBeGreaterThan(targetGate);
    expect(storageWrite).toBeGreaterThan(targetGate);
    expect(edgeWrite).toBeGreaterThan(targetGate);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "${{ needs.validate.outputs.sha }}"');
    expect(workflow).toContain('"CLAMAV_SCAN_URL=$CLAMAV_SCAN_URL"');
    expect(workflow).toContain('"REQUIRE_SERVER_INSPECTION=$REQUIRE_SERVER_INSPECTION"');
    expect(workflow).toContain('--project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
  });
});
