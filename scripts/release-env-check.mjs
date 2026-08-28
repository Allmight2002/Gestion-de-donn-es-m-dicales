// Gate de release : valide presence, format et identite coherente de la cible. Ne jamais afficher une valeur.
import { validateSupabaseTarget } from './check-supabase-target.mjs';
import { assertOfflineBuildPolicy } from './offline-build-policy.mjs';
import {
  INSPECTION_MODE_ERROR,
  INSPECTION_PAUSED,
  expectedInspectionFlag,
  inspectionPauseBanner,
  readInspectionMode,
} from './inspection-mode.mjs';

const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice(9) ?? 'pr';
const fail = (message) => { console.error(`Configuration release invalide: ${message}`); process.exitCode = 1; };
const present = (name) => Boolean(process.env[name]?.trim());
const required = (name) => { if (!present(name)) fail(`${name} est requis pour ${target}.`); };
const bool = (name, requiredValue = false) => {
  if (!present(name)) { if (requiredValue) fail(`${name} doit valoir 'true'.`); return; }
  if (!['true', 'false'].includes(process.env[name])) fail(`${name} doit valoir 'true' ou 'false'.`);
  if (requiredValue && process.env[name] !== 'true') fail(`${name} doit valoir 'true'.`);
};
const supabaseUrl = (name) => {
  if (!present(name)) return;
  try {
    const url = new URL(process.env[name]);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.host)) fail(`${name} doit etre une URL HTTPS Supabase.`);
  } catch { fail(`${name} doit etre une URL valide.`); }
};
const anonKey = (name) => {
  if (!present(name)) return;
  if (process.env[name].length < 20 || /service_role|sb_secret_/i.test(process.env[name])) fail(`${name} doit etre une cle anon/publishable, jamais une cle serveur.`);
};

if (!['pr', 'staging', 'production'].includes(target)) fail(`cible inconnue: ${target}.`);
// Mode d'inspection : 'strict' exige le scanner, 'paused' l'assume suspendu (derogation ecrite).
const inspectionMode = readInspectionMode(process.env);
if (!inspectionMode) fail(INSPECTION_MODE_ERROR);
const inspectionPaused = inspectionMode === INSPECTION_PAUSED;
const inspectionFlag = expectedInspectionFlag(inspectionMode);
// Une PR ne possede pas de secrets : on valide la configuration de build fournie par CI.
required('VITE_SUPABASE_URL'); required('VITE_SUPABASE_ANON_KEY');
supabaseUrl('VITE_SUPABASE_URL'); anonKey('VITE_SUPABASE_ANON_KEY');
bool('VITE_USE_SIGNED_READ', true); bool('VITE_REQUIRE_SERVER_INSPECTION');
if (process.env.VITE_REQUIRE_SERVER_INSPECTION === 'true' && process.env.VITE_USE_SIGNED_READ !== 'true') fail('VITE_REQUIRE_SERVER_INSPECTION=true exige VITE_USE_SIGNED_READ=true.');
if (target !== 'pr') {
  try { assertOfflineBuildPolicy(process.env); } catch (error) {
    fail(error instanceof Error ? error.message : 'politique hors-ligne invalide.');
  }
  const backendKeys = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  // Le scanner n'est exige QUE si le parcours d'inspection est actif. En pause, sa
  // configuration reste facultative — mais si une valeur est fournie, elle est validee.
  if (!inspectionPaused) backendKeys.push('CLAMAV_SCAN_URL', 'CLAMAV_SCAN_TOKEN');
  for (const key of backendKeys) required(key);
  supabaseUrl('SUPABASE_URL'); anonKey('SUPABASE_ANON_KEY');
  if (!/^[a-z0-9]{20}$/i.test(process.env.SUPABASE_PROJECT_REF ?? '')) fail('SUPABASE_PROJECT_REF doit etre une reference Supabase de 20 caracteres.');
  if (!/^postgres(ql)?:\/\//i.test(process.env.SUPABASE_DB_URL ?? '')) fail('SUPABASE_DB_URL doit etre une URL Postgres.');
  if (!inspectionPaused || present('CLAMAV_SCAN_URL')) {
    try { const url = new URL(process.env.CLAMAV_SCAN_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { fail('CLAMAV_SCAN_URL doit etre une URL HTTP(S).'); }
  }
  if ((!inspectionPaused || present('CLAMAV_SCAN_TOKEN')) && (process.env.CLAMAV_SCAN_TOKEN ?? '').length < 32) {
    fail('CLAMAV_SCAN_TOKEN doit contenir au moins 32 caracteres.');
  }
  // Les trois drapeaux suivent le mode declare, ensemble et explicitement : ni valeur
  // deduite, ni variable omise. Un frontend permissif devant une base stricte bloquerait
  // les documents en `pending`; l'inverse ouvrirait une lecture sans verdict serveur.
  for (const key of ['VITE_REQUIRE_SERVER_INSPECTION', 'REQUIRE_SERVER_INSPECTION', 'DB_REQUIRE_SERVER_INSPECTION']) {
    bool(key);
    if (process.env[key] !== inspectionFlag) fail(`${key} doit valoir '${inspectionFlag}' pour INSPECTION_MODE=${inspectionMode}.`);
  }
  for (const error of validateSupabaseTarget({ target })) fail(error);
}
if (!process.exitCode) {
  if (inspectionPaused && target !== 'pr') console.log(inspectionPauseBanner(target));
  console.log(`Configuration release ${target}: OK (valeurs masquees).`);
}
