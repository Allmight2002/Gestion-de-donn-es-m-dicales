import { createHash } from 'node:crypto';
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
  test('les actions CI tierces sont epinglees a une empreinte immuable', () => {
    const workflows = readdirSync('.github/workflows')
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => `.github/workflows/${file}`);

    for (const workflow of workflows) {
      for (const match of read(workflow).matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
        const reference = match[1];
        if (reference.startsWith('./')) continue;

        if (reference.startsWith('docker://')) {
          expect(reference, workflow).toMatch(/^docker:\/\/[^\s@]+@sha256:[a-f0-9]{64}$/);
        } else {
          expect(reference, workflow).toMatch(/^[^\s@]+@[a-f0-9]{40}$/);
        }
      }
    }
  });

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
    expect(storage).toMatch(
      /create policy "clinical_attachments_insert"[\s\S]*?public\.is_medecin\(\)[\s\S]*?public\.can_write_identity/,
    );
    expect(config).toContain('[functions.generate-export]');
    // Chantier D : l'appel passe par l'utilitaire partage qui traduit le refus de l'Edge
    // (src/lib/edgeFunctionError.ts). L'exigence verifiee ici reste la meme : l'export est
    // produit par la fonction Edge, jamais cote client.
    expect(exportsData).toContain('invokeEdgeFunction');
    expect(exportsData).toContain("'generate-export'");
    expect(exportsData).not.toContain('createUploadTicket(client, input.baseId, EXPORTS_BUCKET');
    expect(exportsData).not.toContain('cleanupUploadedObject(client, EXPORTS_BUCKET');
    expect(exportsData).not.toContain('crypto.subtle.digest');
    expect(generateExport).toContain('can_export_data');
    expect(generateExport).toContain('admin.storage.from(EXPORTS_BUCKET).upload');
    expect(generateExport).toContain("generation_mode: 'server'");
    expect(generateExport).toContain("generated_by: 'edge:generate-export'");
    expect(generateExport).toContain('fileHash');
    // XLSX (audit lot 9 §C1) : l'invariant REEL, pas un import npm en dur. La version vit dans UNE
    // seule source de verite (l'alias `xlsx` de deno.json), pointe vers la copie locale dont le hash
    // est verrouille ici, et generate-export l'importe sans URL reseau ni version concurrente.
    const denoImports = (JSON.parse(read('deno.json')) as { imports: Record<string, string> }).imports;
    const xlsxSpecifier = denoImports.xlsx;
    expect(xlsxSpecifier).toBe('./supabase/functions/_shared/vendor/xlsx-0.20.3.mjs');
    // Git peut materialiser les fichiers texte en CRLF dans un worktree Windows. Le
    // contenu amont SheetJS est verrouille en LF : normaliser uniquement les fins de
    // ligne evite de confondre cette conversion Git avec une modification du module.
    const vendoredXlsx = readFileSync(xlsxSpecifier.slice(2), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(vendoredXlsx, 'utf8').digest('hex')).toBe(
      '1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db',
    );
    expect(read('supabase/functions/_shared/vendor/LICENSE.sheetjs.txt')).toContain('Apache License');
    expect(read('deno.lock')).not.toContain('cdn.sheetjs.com');
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
    // Chantier D : meme utilitaire partage ; la finalisation reste servie par l'Edge.
    expect(inspection).toContain('invokeEdgeFunction');
    expect(inspection).toContain("'finalize-upload'");
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
    expect(scanner).toContain('zVERSION');
    expect(dockerfile).toContain('parse-version.mjs');
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
    expect(viteConfig).toContain('assertOfflineBuildPolicy(env, mode)');
    expect(viteConfig).toContain('VERCEL_GIT_COMMIT_SHA');
    expect(viteConfig).toContain('VERCEL_GIT_COMMIT_REF');
    expect(viteConfig).toContain('__GIT_COMMIT__');
    expect(viteConfig).toContain('__GIT_BRANCH__');
    expect(viteConfig).toContain('__BUILD_TIME__');
  });

  test('la sauvegarde de continuite est periodique, chiffree, verifiee et conservee hors runner', () => {
    const workflow = read('.github/workflows/continuity-backup.yml');
    expect(workflow).toContain("cron: '17 2,14 * * *'");
    expect(workflow).toContain("github.event_name == 'schedule' && '[\"staging\"]'");
    expect(workflow).toContain('["staging","production"]');
    expect(workflow).toContain('environment: ${{ matrix.target }}');
    expect(workflow).toContain('CONTINUITY_BACKUP_ENABLED');
    expect(workflow).toContain('VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}');
    expect(workflow).toContain('VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}');
    expect(workflow).toContain('BACKUP_REQUIRE_SESSION_POOLER');
    expect(workflow).toContain('npm run backup:coordinated --');
    expect(workflow).toContain('npm run backup:coordinated:verify --');
    expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(workflow).toContain('retention-days: 30');
    expect(workflow.indexOf('backup:coordinated:verify'))
      .toBeLessThan(workflow.indexOf('actions/upload-artifact'));
    expect(workflow).toContain('alert_test:');
    expect(workflow).toContain('MONITOR_ALERT_WEBHOOK_URL: ${{ secrets.MONITOR_ALERT_WEBHOOK_URL }}');
    expect(workflow).toContain("if: failure() && matrix.target == 'staging'");
    expect(workflow).toContain("checks: [{ name: 'continuity-backup', ok: false, errorCode: 'backup-failed' }]");
    expect(workflow).toContain("if: inputs.alert_test == true && matrix.target == 'staging'");
    expect(workflow).toContain("MONITOR_ALERT_DRILL: 'true'");
    expect(workflow).toContain("errorCode: 'expected-test-alert'");
    expect(workflow).toContain('node scripts/send-operations-alert.mjs --file="$alert_file"');
  });

  test('vercel.json declare le fallback SPA et les principaux headers de securite', () => {
    const config = JSON.parse(read('vercel.json')) as {
      git: { deploymentEnabled: boolean };
      rewrites: Array<{ source: string; destination: string }>;
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const headers = new Map(config.headers[0].headers.map((h) => [h.key.toLowerCase(), h.value]));

    expect(config.git.deploymentEnabled).toBe(false);

    // Le repli SPA ne doit PAS avaler les routes internes de la plateforme : servies en `text/html`
    // sous `nosniff`, `/_vercel/speed-insights/script.js` et `/_vercel/insights/script.js` sont
    // refusees par le navigateur et la telemetrie (Speed Insights, Web Analytics) ne demarre jamais.
    const spaFallback = config.rewrites.find((rewrite) => rewrite.destination === '/index.html');
    expect(spaFallback?.source).toBe('/((?!_vercel/).*)');
    const capturedBySpa = (pathname: string) => new RegExp(`^${spaFallback!.source}$`).test(pathname);
    expect(capturedBySpa('/patients/42')).toBe(true);
    expect(capturedBySpa('/_vercel/speed-insights/script.js')).toBe(false);
    expect(capturedBySpa('/_vercel/insights/script.js')).toBe(false);
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('permissions-policy')).toContain('camera=()');
  });

  test('les E2E staging utilisent un cookie Vercel ephemere limite au deploiement exact', () => {
    const config = read('playwright.config.ts');
    const fixture = read('e2e/staging-test.ts');
    const cookieState = read('scripts/vercel-cookie-state.mjs');

    expect(config).toContain('E2E_VERCEL_STORAGE_STATE');
    expect(config).toContain('storageState: vercelStorageState || undefined');
    expect(config).not.toContain('extraHTTPHeaders:');
    expect(config).not.toContain('x-vercel-protection-bypass');
    expect(config).not.toContain('globalSetup');
    expect(config).toContain("trace: target === 'staging' ? 'off'");
    expect(fixture).not.toContain('newCDPSession');
    expect(fixture).toContain("export { expect, test } from '@playwright/test'");
    expect(cookieState).toContain("const VERCEL_COOKIE_NAME = '_vercel_jwt'");
    expect(cookieState).toContain("url.hostname.endsWith('.vercel.app')");
    expect(cookieState).toContain("rawSecure !== 'TRUE'");
    expect(cookieState).toContain("sameSite: 'Lax'");
    for (const spec of ['auth-roles.spec.ts', 'export-journey.spec.ts', 'patient-journey.spec.ts']) {
      expect(read(`e2e/${spec}`)).toContain("from './staging-test'");
    }
  });

  test('la release coordonnee verrouille la cible avant toute ecriture staging', () => {
    const workflow = read('.github/workflows/coordinated-release.yml');
    const backendStart = workflow.indexOf('\n  backend-staging:');
    const targetGate = workflow.indexOf('npm run release:env -- --target=staging');
    const encryptedBackup = workflow.indexOf('npm run backup:coordinated -- --target=staging');
    const verifiedBackup = workflow.indexOf('npm run backup:coordinated:verify', encryptedBackup);
    const preservedBackup = workflow.indexOf('pre-release-backup-staging-${{ github.run_id }}', verifiedBackup);
    const databaseWrite = workflow.indexOf('npm exec -- supabase db push');
    const storageWrite = workflow.indexOf('npm run supabase:storage');
    const functionAclGate = workflow.indexOf('npm run db:function-acl:verify', storageWrite);
    const edgeWrite = workflow.indexOf('npm exec -- supabase secrets set');

    expect(targetGate).toBeGreaterThan(-1);
    expect(encryptedBackup).toBeGreaterThan(targetGate);
    expect(verifiedBackup).toBeGreaterThan(encryptedBackup);
    expect(preservedBackup).toBeGreaterThan(verifiedBackup);
    expect(databaseWrite).toBeGreaterThan(preservedBackup);
    expect(workflow.slice(backendStart, databaseWrite)).toContain(
      'STORAGE_BACKUP_ENCRYPTION_KEY: ${{ secrets.STORAGE_BACKUP_ENCRYPTION_KEY }}',
    );
    expect(workflow.slice(backendStart, databaseWrite)).toContain("BACKUP_REQUIRE_SESSION_POOLER: 'true'");
    expect(workflow.slice(backendStart, databaseWrite)).toContain("BACKUP_PREPARE_DUMP_IMAGE: 'true'");
    expect(databaseWrite).toBeGreaterThan(targetGate);
    expect(storageWrite).toBeGreaterThan(targetGate);
    expect(functionAclGate).toBeGreaterThan(storageWrite);
    expect(edgeWrite).toBeGreaterThan(functionAclGate);
    expect(edgeWrite).toBeGreaterThan(targetGate);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "${{ needs.validate.outputs.sha }}"');
    expect(workflow).toContain('"CLAMAV_SCAN_URL=$CLAMAV_SCAN_URL"');
    expect(workflow).toContain('"REQUIRE_SERVER_INSPECTION=$REQUIRE_SERVER_INSPECTION"');
    expect(workflow).toContain('--project-ref "$SUPABASE_PROJECT_REF"');
    expect(
      workflow.match(
        /npm exec -- supabase functions deploy "\$fn" --import-map deno\.json --use-api --project-ref/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain('backend-drift-${{ github.run_id }}');
    expect(workflow).toContain('EXPECTED_EDGE_INVENTORY_FILE="$RUNNER_TEMP/staging-backend/backend-drift.json"');
    expect(workflow).toContain('production-backend-drift-${{ github.run_id }}');
    expect(workflow).toContain('Bootstrap scoped Vercel browser cookie');
    expect(workflow).toContain('scripts/vercel-cookie-state.mjs');
    expect(workflow).toContain('E2E_VERCEL_STORAGE_STATE');
    expect(workflow).toContain('"vercel@$VERCEL_CLI_VERSION" curl /login');
    expect(workflow).not.toContain('"vercel@$VERCEL_CLI_VERSION" --token "$VERCEL_TOKEN" curl');
    expect(workflow).toContain('Remove ephemeral Vercel browser state');
    expect(workflow).not.toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(workflow).toContain("node-version: '22'");
    expect(workflow).not.toContain("node-version: '20'");
    expect(workflow.match(/VITE_OFFLINE_MODE: disabled/g)?.length).toBeGreaterThanOrEqual(4);
    expect(workflow.match(/VITE_OFFLINE_ADMIN_ACK: 'false'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(workflow.match(/ALLOW_OFFLINE_DEMO_BUILD: 'true'/g)).toHaveLength(1);
    const edgeDeploy = workflow.indexOf('Deploy all Edge Functions');
    const frontendDeploy = workflow.indexOf('vercel@$VERCEL_CLI_VERSION" deploy --prebuilt');
    const strictActivation = workflow.indexOf('npm run inspection:activate -- --target=staging');
    const cloudGate = workflow.indexOf('npm run env:check:cloud', strictActivation);
    expect(frontendDeploy).toBeGreaterThan(edgeDeploy);
    expect(strictActivation).toBeGreaterThan(frontendDeploy);
    expect(cloudGate).toBeGreaterThan(strictActivation);
  });

  test('la production exige une sauvegarde chiffree verifiee et conservee avant toute ecriture', () => {
    const workflow = read('.github/workflows/coordinated-release.yml');
    const productionStart = workflow.indexOf('\n  production:');
    const production = workflow.slice(productionStart);
    const githubControlsGate = production.indexOf('npm run github:controls:verify');
    const governanceGate = production.indexOf('npm run governance:evidence:verify --');
    const recoveryGate = production.indexOf('npm run recovery:evidence:verify --');
    const operationsGate = production.indexOf('npm run operations:evidence:verify --');
    const targetGate = production.indexOf('npm run release:env -- --target=production');
    const encryptedBackup = production.indexOf('npm run backup:coordinated -- --target=production');
    const verifiedBackup = production.indexOf('npm run backup:coordinated:verify', encryptedBackup);
    const preservedBackup = production.indexOf('pre-release-backup-production-${{ github.run_id }}', verifiedBackup);
    const databaseWrite = production.indexOf('npm exec -- supabase db push');
    const storageWrite = production.indexOf('npm run supabase:storage');
    const functionAclGate = production.indexOf('npm run db:function-acl:verify', storageWrite);
    const edgeWrite = production.indexOf('npm exec -- supabase functions deploy');

    expect(productionStart).toBeGreaterThan(-1);
    expect(githubControlsGate).toBeGreaterThan(-1);
    expect(governanceGate).toBeGreaterThan(githubControlsGate);
    expect(governanceGate).toBeGreaterThan(-1);
    expect(recoveryGate).toBeGreaterThan(governanceGate);
    expect(recoveryGate).toBeGreaterThan(-1);
    expect(operationsGate).toBeGreaterThan(recoveryGate);
    expect(operationsGate).toBeGreaterThan(-1);
    expect(targetGate).toBeGreaterThan(operationsGate);
    expect(targetGate).toBeGreaterThan(-1);
    expect(encryptedBackup).toBeGreaterThan(targetGate);
    expect(verifiedBackup).toBeGreaterThan(encryptedBackup);
    expect(preservedBackup).toBeGreaterThan(verifiedBackup);
    expect(databaseWrite).toBeGreaterThan(preservedBackup);
    expect(storageWrite).toBeGreaterThan(preservedBackup);
    expect(functionAclGate).toBeGreaterThan(storageWrite);
    expect(edgeWrite).toBeGreaterThan(functionAclGate);
    expect(edgeWrite).toBeGreaterThan(preservedBackup);
    expect(production).toContain('STORAGE_BACKUP_ENCRYPTION_KEY: ${{ secrets.STORAGE_BACKUP_ENCRYPTION_KEY }}');
    expect(production).toContain("BACKUP_REQUIRE_SESSION_POOLER: 'true'");
    expect(production).toContain("BACKUP_PREPARE_DUMP_IMAGE: 'true'");
    expect(production).toContain('GOVERNANCE_EVIDENCE_JSON: ${{ secrets.GOVERNANCE_EVIDENCE_JSON }}');
    expect(production).toContain('RECOVERY_EVIDENCE_JSON: ${{ secrets.RECOVERY_EVIDENCE_JSON }}');
    expect(production).toContain('OPERATIONS_EVIDENCE_JSON: ${{ secrets.OPERATIONS_EVIDENCE_JSON }}');
    // Les deux noms diffèrent volontairement : GitHub réserve le préfixe GITHUB_ pour les secrets
    // comme pour les variables, donc le secret ne peut pas s'appeler GITHUB_CONTROLS_TOKEN. Seule
    // la variable d'environnement lue par le script garde ce nom.
    expect(production).toContain('GITHUB_CONTROLS_TOKEN: ${{ secrets.CONTROLS_ADMIN_TOKEN }}');
    expect(production).not.toContain('secrets.GITHUB_');
    expect(production).toContain('--commit="$RELEASE_SHA"');
    expect(workflow).not.toContain('BACKUP_ALLOW_PLAINTEXT_EXTRACTION');
  });

  test('la derogation pilote ne couvre que l ABSENCE de preuve, jamais une preuve fournie', () => {
    const workflow = read('.github/workflows/coordinated-release.yml');
    const production = workflow.slice(workflow.indexOf('\n  production:'));

    for (const secret of ['GOVERNANCE_EVIDENCE_JSON', 'RECOVERY_EVIDENCE_JSON', 'OPERATIONS_EVIDENCE_JSON']) {
      // La sortie anticipee exige les DEUX conditions : preuve vide ET derogation active.
      expect(production).toContain(`if [ -z "\${${secret}:-}" ] && [ "\${PILOT_EVIDENCE_WAIVER:-}" = "true" ]`);
      // Le controle d'origine subsiste : une preuve fournie reste verifiee, meme derogation active.
      expect(production).toContain(`test -n "$${secret}"`);
    }
    // La derogation est portee par une variable de depot, jamais ecrite en dur.
    expect(production).toContain('PILOT_EVIDENCE_WAIVER: ${{ vars.PILOT_EVIDENCE_WAIVER }}');
    expect(production).not.toContain('PILOT_EVIDENCE_WAIVER: true');

    // Ce qui reste bloquant quoi qu'il arrive : la sauvegarde chiffree avant toute ecriture.
    const backup = production.indexOf('npm run backup:coordinated -- --target=production');
    expect(backup).toBeGreaterThan(-1);
    expect(production.slice(0, backup)).not.toContain('STORAGE_BACKUP_ENCRYPTION_KEY:-');
  });

  test('la preuve de release compare les empreintes Storage et Edge distantes', () => {
    const stateMigration = read(
      'supabase/migrations/20260714215335_record_release_component_state.sql',
    );
    const applyStorage = read('scripts/apply-storage.mjs');
    const drift = read('scripts/release-drift.mjs');

    expect(stateMigration).toContain('create table public.release_component_state');
    expect(stateMigration).toContain('release_component_state_no_client_access');
    expect(stateMigration).toContain('revoke all on table public.release_component_state');
    expect(applyStorage).toContain("values ('storage.sql', $1, now(), current_user)");
    expect(applyStorage).toContain('state.rows[0]?.sha256 !== SHA256');
    expect(drift).toContain("where component = 'storage.sql'");
    expect(drift).toContain('component.rows[0].sha256 !== storageSha');
    expect(drift).toContain('ezbr_sha256');
    expect(drift).toContain('EXPECTED_EDGE_INVENTORY_FILE');
    expect(drift).toContain('expected.ezbrSha256 !== entry.ezbrSha256');
    expect(drift).toContain("DO_NOT_TRACK: '1'");
    expect(drift).not.toContain('npx --yes');
  });
});
