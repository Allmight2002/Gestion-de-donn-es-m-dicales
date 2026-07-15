// Gate de release : valide presence, format et identite coherente de la cible. Ne jamais afficher une valeur.
import { validateSupabaseTarget } from './check-supabase-target.mjs';

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
// Une PR ne possede pas de secrets : on valide la configuration de build fournie par CI.
required('VITE_SUPABASE_URL'); required('VITE_SUPABASE_ANON_KEY');
supabaseUrl('VITE_SUPABASE_URL'); anonKey('VITE_SUPABASE_ANON_KEY');
bool('VITE_USE_SIGNED_READ', true); bool('VITE_REQUIRE_SERVER_INSPECTION');
if (process.env.VITE_REQUIRE_SERVER_INSPECTION === 'true' && process.env.VITE_USE_SIGNED_READ !== 'true') fail('VITE_REQUIRE_SERVER_INSPECTION=true exige VITE_USE_SIGNED_READ=true.');
if (target !== 'pr') {
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLAMAV_SCAN_URL', 'CLAMAV_SCAN_TOKEN']) required(key);
  supabaseUrl('SUPABASE_URL'); anonKey('SUPABASE_ANON_KEY');
  if (!/^[a-z0-9]{20}$/i.test(process.env.SUPABASE_PROJECT_REF ?? '')) fail('SUPABASE_PROJECT_REF doit etre une reference Supabase de 20 caracteres.');
  if (!/^postgres(ql)?:\/\//i.test(process.env.SUPABASE_DB_URL ?? '')) fail('SUPABASE_DB_URL doit etre une URL Postgres.');
  try { const url = new URL(process.env.CLAMAV_SCAN_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { fail('CLAMAV_SCAN_URL doit etre une URL HTTP(S).'); }
  if ((process.env.CLAMAV_SCAN_TOKEN ?? '').length < 32) fail('CLAMAV_SCAN_TOKEN doit contenir au moins 32 caracteres.');
  bool('REQUIRE_SERVER_INSPECTION', true); bool('DB_REQUIRE_SERVER_INSPECTION', true);
  if (process.env.VITE_REQUIRE_SERVER_INSPECTION !== 'true') fail('VITE_REQUIRE_SERVER_INSPECTION=true est requis pour une release clinique.');
  for (const error of validateSupabaseTarget({ target })) fail(error);
}
if (!process.exitCode) console.log(`Configuration release ${target}: OK (valeurs masquees).`);
