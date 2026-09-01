// Verifie la coherence des variables d'inspection documentaire avant un deploiement clinique.
// A lancer dans un contexte qui contient a la fois les variables frontend et les secrets Edge.
//
// Mode --cloud (audit v18 §6.2) : en plus des controles STATIQUES ci-dessous, se connecte a
// la base (SUPABASE_DB_URL) et compare la valeur REELLE de public.require_server_inspection()
// avec la configuration declaree — attrape une base cloud pas encore migree alors que les
// variables annoncent le mode strict. Le mode par defaut reste SANS dependance (import pg
// uniquement dans la branche cloud).

import {
  INSPECTION_MODE_ERROR,
  INSPECTION_PAUSED,
  inspectionPauseBanner,
  readInspectionMode,
} from './inspection-mode.mjs';

const cloudMode = process.argv.includes('--cloud');
const yes = (name) => process.env[name] === 'true';
const value = (name) => process.env[name] ?? '';
const fail = (message) => {
  console.error(`Inspection env invalide: ${message}`);
  process.exitCode = 1;
};

const inspectionMode = readInspectionMode(process.env);
if (!inspectionMode) fail(INSPECTION_MODE_ERROR);
const inspectionPaused = inspectionMode === INSPECTION_PAUSED;

const frontendStrict = yes('VITE_REQUIRE_SERVER_INSPECTION');
const edgeStrict = yes('REQUIRE_SERVER_INSPECTION');

// INSPECTION_MODE=paused est une declaration, pas une tolerance : les drapeaux stricts
// doivent avoir ete abaisses, sans quoi la configuration ment sur ce qu'elle applique.
if (inspectionPaused && (frontendStrict || edgeStrict || yes('DB_REQUIRE_SERVER_INSPECTION'))) {
  fail("INSPECTION_MODE=paused exige VITE_REQUIRE_SERVER_INSPECTION, REQUIRE_SERVER_INSPECTION et DB_REQUIRE_SERVER_INSPECTION a 'false'.");
}

if (frontendStrict !== edgeStrict) {
  fail("VITE_REQUIRE_SERVER_INSPECTION et REQUIRE_SERVER_INSPECTION doivent valoir 'true' ensemble, ou etre tous deux desactives.");
}

if (frontendStrict && !yes('VITE_USE_SIGNED_READ')) {
  fail("VITE_REQUIRE_SERVER_INSPECTION='true' exige VITE_USE_SIGNED_READ='true'.");
}

if (edgeStrict) {
  if (!yes('DB_REQUIRE_SERVER_INSPECTION')) {
    fail("DB_REQUIRE_SERVER_INSPECTION='true' est requis avec REQUIRE_SERVER_INSPECTION=true. Appliquez aussi la mise a jour SQL de public.app_security_setting.");
  }

  if (!value('CLAMAV_SCAN_URL')) fail('CLAMAV_SCAN_URL est requis quand REQUIRE_SERVER_INSPECTION=true.');
  const token = value('CLAMAV_SCAN_TOKEN').trim().toLowerCase();
  if (token.length < 32 || token === 'change-me' || token === 'changeme') {
    fail('CLAMAV_SCAN_TOKEN doit etre non standard et contenir au moins 32 caracteres.');
  }

  const maxInspect = Number(value('MAX_INSPECT_UPLOAD_BYTES') || 20 * 1024 * 1024);
  const maxScan = Number(value('MAX_SCAN_BYTES') || 25 * 1024 * 1024);
  const maxAttempts = Number(value('MAX_INSPECTION_ATTEMPTS') || 5);
  const retryCooldown = Number(value('INSPECTION_RETRY_COOLDOWN_MS') || 60000);
  const quarantineBucket = value('QUARANTINE_BUCKET') || 'quarantined-uploads';
  if (!Number.isFinite(maxInspect) || maxInspect <= 0) fail('MAX_INSPECT_UPLOAD_BYTES doit etre un entier positif.');
  if (!Number.isFinite(maxScan) || maxScan <= 0) fail('MAX_SCAN_BYTES doit etre un entier positif.');
  if (Number.isFinite(maxInspect) && Number.isFinite(maxScan) && maxInspect > maxScan) {
    fail('MAX_INSPECT_UPLOAD_BYTES doit rester inferieur ou egal a MAX_SCAN_BYTES.');
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) fail('MAX_INSPECTION_ATTEMPTS doit etre un entier positif.');
  if (!Number.isFinite(retryCooldown) || retryCooldown < 0) fail('INSPECTION_RETRY_COOLDOWN_MS doit etre un entier positif ou nul.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(quarantineBucket)) {
    fail('QUARANTINE_BUCKET doit etre un nom de bucket simple en minuscules, sans slash.');
  }
  if (quarantineBucket !== 'quarantined-uploads') {
    fail('QUARANTINE_BUCKET doit valoir quarantined-uploads pour correspondre au schema SQL.');
  }
}

// --cloud : verifier la valeur REELLE dans la base (pas seulement la variable declaree).
if (cloudMode) {
  const dbUrl = value('SUPABASE_DB_URL');
  if (!dbUrl) {
    fail("--cloud exige SUPABASE_DB_URL (chaine de connexion Postgres du projet — dashboard Supabase > Connect).");
  } else {
    let client = null;
    try {
      const { default: pg } = await import('pg');
      client = new pg.Client({ connectionString: dbUrl });
      await client.connect();
      const { rows } = await client.query('select public.require_server_inspection() as strict');
      const actual = rows[0]?.strict === true;
      const declared = yes('DB_REQUIRE_SERVER_INSPECTION');
      if (actual !== declared) {
        fail(`DB_REQUIRE_SERVER_INSPECTION='${value('DB_REQUIRE_SERVER_INSPECTION')}' mais public.require_server_inspection() renvoie ${actual} dans la base : migrez la base (npx supabase db push + mise a jour de app_security_setting) ou corrigez la variable.`);
      }
      if (edgeStrict && !actual) {
        fail('REQUIRE_SERVER_INSPECTION=true cote Edge mais la base n impose PAS l inspection stricte : base cloud en retard sur la configuration.');
      }
      if (!edgeStrict && actual) {
        fail("la base impose l'inspection stricte mais REQUIRE_SERVER_INSPECTION n'est pas 'true' cote Edge : les uploads resteraient bloques en pending.");
      }
      if (!process.exitCode) {
        console.log(`Base: require_server_inspection() = ${actual} (conforme a la configuration declaree)`);
      }
    } catch (e) {
      fail(`verification cloud impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }
}

if (!process.exitCode) {
  if (inspectionPaused) console.log(inspectionPauseBanner('configuration courante'));
  console.log('Inspection env OK');
}
