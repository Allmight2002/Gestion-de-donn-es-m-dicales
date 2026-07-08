// Verifie la coherence des variables d'inspection documentaire avant un deploiement clinique.
// A lancer dans un contexte qui contient a la fois les variables frontend et les secrets Edge.

const yes = (name) => process.env[name] === 'true';
const value = (name) => process.env[name] ?? '';
const fail = (message) => {
  console.error(`Inspection env invalide: ${message}`);
  process.exitCode = 1;
};

const frontendStrict = yes('VITE_REQUIRE_SERVER_INSPECTION');
const edgeStrict = yes('REQUIRE_SERVER_INSPECTION');

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
  if (!token || token === 'change-me' || token === 'changeme') {
    fail('CLAMAV_SCAN_TOKEN doit etre un secret non vide et non par defaut.');
  }

  const maxInspect = Number(value('MAX_INSPECT_UPLOAD_BYTES') || 20 * 1024 * 1024);
  const maxScan = Number(value('MAX_SCAN_BYTES') || 25 * 1024 * 1024);
  if (!Number.isFinite(maxInspect) || maxInspect <= 0) fail('MAX_INSPECT_UPLOAD_BYTES doit etre un entier positif.');
  if (!Number.isFinite(maxScan) || maxScan <= 0) fail('MAX_SCAN_BYTES doit etre un entier positif.');
  if (Number.isFinite(maxInspect) && Number.isFinite(maxScan) && maxInspect > maxScan) {
    fail('MAX_INSPECT_UPLOAD_BYTES doit rester inferieur ou egal a MAX_SCAN_BYTES.');
  }
}

if (!process.exitCode) {
  console.log('Inspection env OK');
}
