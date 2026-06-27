// Cree un compte REEL (medecin / curateur / system_admin) sur un projet Supabase, via
// l'Admin API (cle service_role, COTE SERVEUR uniquement). Remplace le seed de demo pour
// un deploiement : on ne charge PAS les comptes/donnees fictifs en production.
//
// Usage :
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/create-account.mjs <email> <mot_de_passe> [role] ["Nom complet"]
//
//   role ∈ medecin | curateur | system_admin   (defaut : medecin)
//
// Le profil applicatif est cree automatiquement par le declencheur handle_new_user
// (role 'medecin' par defaut) ; ce script ajuste global_role si besoin. La cle
// service_role contourne la RLS et le garde-fou anti-escalade (auth.uid() est nul ici).
import { createClient } from '@supabase/supabase-js';

const ROLES = ['medecin', 'curateur', 'system_admin'];
const [email, password, role = 'medecin', fullName = ''] = process.argv.slice(2);
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

if (!url || !key) fail('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (cote serveur).');
if (!email || !password) fail('Usage : node scripts/create-account.mjs <email> <mot_de_passe> [role] ["Nom complet"]');
if (!ROLES.includes(role)) fail(`Role invalide « ${role} ». Attendu : ${ROLES.join(' | ')}.`);
if (password.length < 8) fail('Mot de passe trop court (8 caracteres minimum).');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // compte confirme d'emblee (pas d'email a cliquer)
  user_metadata: { full_name: fullName, language: 'fr' },
});
if (error) fail('Creation du compte : ' + error.message);

const userId = data.user.id;

// Le declencheur a cree le profil en 'medecin' ; on n'ajuste que si autre role demande.
if (role !== 'medecin') {
  const { error: e2 } = await admin.from('profiles').update({ global_role: role }).eq('id', userId);
  if (e2) fail('Attribution du role : ' + e2.message);
}

console.log(`✓ Compte cree : ${email} (${role})${fullName ? ' — ' + fullName : ''}`);
console.log(`  id = ${userId}`);
