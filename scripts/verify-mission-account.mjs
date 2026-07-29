// Verification de bout en bout d'un COMPTE DE MISSION sur un projet Supabase reel
// (staging ou production). Donnees FICTIVES uniquement.
//
//   node scripts/verify-mission-account.mjs --env-file=.env.staging --prefix=STAGING_
//
// Le script cree un compte de mission de test, exerce ses droits AVEC SON PROPRE JETON
// (donc sous RLS reelle, pas en service_role), puis nettoie ce qu'il a cree. Il verifie :
//   1. le compte recoit bien le role `saisisseur` (app_metadata -> handle_new_user) ;
//   2. il peut creer un patient et une rencontre sur sa base ;
//   3. il ne voit AUCUNE identite nominative ;
//   4. il ne voit pas les autres bases ;
//   5. il ne peut ni exporter, ni creer de base, ni corriger une saisie soumise ;
//   6. la revocation le coupe immediatement.
//
// Aucun secret n'est affiche : seuls des verdicts le sont.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
  }),
);
const envFile = args.get('env-file');
const prefix = args.get('prefix') ?? '';
const keepAccount = args.get('keep') === 'true';

if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const need = (name) => {
  const value = process.env[`${prefix}${name}`] ?? process.env[name];
  if (!value) throw new Error(`Variable manquante : ${prefix}${name}`);
  return value;
};

const url = need('SUPABASE_URL');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = need('SUPABASE_ANON_KEY');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ECHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const stamp = Date.now();
const STUDENT_EMAIL = `mission.test.${stamp}@exemple.invalid`;
const STUDENT_PASSWORD = `Mission-${stamp}-${Math.random().toString(36).slice(2, 10)}!`;
const PATIENT_CODE = `MIS-VERIF-${stamp}`;

let studentId = null;
let baseId = null;
let otherBaseId = null;
let accessId = null;
let createdPatientId = null;

/** Attendu : l'appel echoue (RLS ou garde serveur). */
const mustFail = async (label, fn) => {
  try {
    const { data, error } = await fn();
    if (error) return check(label, true, 'refuse par le serveur');
    const empty = data == null || (Array.isArray(data) && data.length === 0);
    check(label, empty, empty ? 'aucune ligne visible' : 'DONNEES VISIBLES — a corriger');
  } catch {
    check(label, true, 'refuse par le serveur');
  }
};

try {
  console.log(`\nProjet : ${url}\n`);

  // --- Base cible : la premiere base active d'un medecin proprietaire ----------------
  const { data: bases, error: baseError } = await admin
    .from('base')
    .select('id, name, owner_user_id')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(2);
  if (baseError) throw baseError;
  if (!bases?.length) throw new Error('Aucune base active sur ce projet : impossible de verifier.');
  baseId = bases[0].id;
  otherBaseId = bases[1]?.id ?? null;
  console.log(`Base de mission : ${bases[0].name}`);
  console.log(`Autre base pour le cloisonnement : ${otherBaseId ? bases[1].name : '(aucune seconde base)'}\n`);

  // --- 1. Creation par le VRAI chemin : l'Edge Function, appelee par un medecin ------
  // C'est le seul moyen de verifier ce qui compte : que le compte recoit bien le role de
  // mission. Supabase n'ecrivant pas app_metadata dans la meme instruction que
  // l'insertion, seule la reconciliation faite par la fonction l'etablit.
  const medecinEmail = process.env[`${prefix}MEDECIN_EMAIL`] ?? process.env.MEDECIN_EMAIL;
  const medecinPassword = process.env[`${prefix}MEDECIN_PASSWORD`] ?? process.env.MEDECIN_PASSWORD;
  if (!medecinEmail || !medecinPassword) {
    throw new Error(`Identifiants medecin absents (${prefix}MEDECIN_EMAIL / ${prefix}MEDECIN_PASSWORD).`);
  }

  const medecin = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: session, error: medecinError } = await medecin.auth.signInWithPassword({
    email: medecinEmail,
    password: medecinPassword,
  });
  if (medecinError) throw medecinError;

  // La base doit etre geree par CE medecin, sinon la fonction refuse (a juste titre).
  const { data: managed } = await medecin.from('base').select('id, name').eq('owner_user_id', session.user.id).limit(1);
  if (managed?.length) {
    baseId = managed[0].id;
    console.log(`Base geree par le medecin de test : ${managed[0].name}\n`);
  }

  const { data: invoked, error: invokeError } = await medecin.functions.invoke('create-mission-account', {
    body: {
      action: 'create',
      baseId,
      email: STUDENT_EMAIL,
      expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
      canViewIdentity: false,
    },
  });
  check("l'Edge Function cree le compte de mission", !invokeError && !!invoked?.userId, invokeError?.message ?? '');
  studentId = invoked?.userId ?? null;
  if (!studentId) throw new Error("l'Edge Function n'a pas cree de compte");

  const { data: profile } = await admin.from('profiles').select('global_role').eq('id', studentId).single();
  check('le compte recoit le role saisisseur, pas medecin', profile?.global_role === 'saisisseur', `role=${profile?.global_role}`);

  // Rejeu a l'identique : doit etre accepte sans creer de doublon.
  const { error: replayError } = await medecin.functions.invoke('create-mission-account', {
    body: {
      action: 'create', baseId, email: STUDENT_EMAIL,
      expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(), canViewIdentity: false,
    },
  });
  const { count: accessCount } = await admin
    .from('base_access').select('id', { count: 'exact', head: true }).eq('user_id', studentId);
  check('le rejeu de la meme demande ne cree aucun doublon', !replayError && accessCount === 1, `${accessCount} ligne(s)`);

  // Le mot de passe est normalement choisi par l'etudiant via le courriel recu. Pour la
  // suite de la verification, on en pose un cote serveur : c'est l'AUTORISATION qu'on
  // teste ici, pas le parcours de definition du mot de passe.
  await admin.auth.admin.updateUserById(studentId, { password: STUDENT_PASSWORD, email_confirm: true });

  // --- Provisionnement de la mission (12 mois), au nom du proprietaire ---------------
  // L'acces a ete pose par l'Edge Function elle-meme, avec le jeton du medecin.
  const { data: access, error: accessError } = await admin
    .from('base_access')
    .select('id, expires_at, can_create_structured_data, can_edit_structured_data, can_export_data, can_manage_access')
    .eq('user_id', studentId)
    .maybeSingle();
  if (accessError || !access) throw accessError ?? new Error('acces de mission introuvable');
  accessId = access.id;
  check(
    'la mission posee est bornee et en creation seule',
    access.expires_at != null && access.can_create_structured_data === true
      && access.can_edit_structured_data === false && access.can_export_data === false
      && access.can_manage_access === false,
    `echeance ${String(access.expires_at).slice(0, 10)}`,
  );

  // --- Session du compte de mission : tout ce qui suit passe sous SA RLS -------------
  const student = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await student.auth.signInWithPassword({
    email: STUDENT_EMAIL,
    password: STUDENT_PASSWORD,
  });
  if (signInError) throw signInError;

  // --- 2. Il voit sa base et peut saisir --------------------------------------------
  const { data: visible } = await student.from('base').select('id, name');
  check('il voit exactement UNE base : la sienne', visible?.length === 1 && visible[0].id === baseId, `${visible?.length ?? 0} base(s)`);

  const { data: newPatient, error: patientError } = await student.rpc('create_patient', {
    p_base_id: baseId,
    p_patient_code: PATIENT_CODE,
    p_full_name: null,
    p_date_of_birth: null,
    p_phone: null,
    p_address: null,
    p_external_identifier: null,
    p_permanent_data: {},
  });
  check('il cree un patient sur sa base', !patientError && !!newPatient, patientError?.message ?? PATIENT_CODE);
  createdPatientId = newPatient?.id ?? null;

  if (createdPatientId) {
    const { error: encError } = await student.rpc('create_encounter', {
      p_patient_id: createdPatientId,
      p_encounter_type: 'consultation',
      p_encounter_date: new Date().toISOString().slice(0, 10),
      p_validation_status: 'draft',
      p_data: {},
      p_age_unit: 'years',
    });
    check('il cree une rencontre en brouillon', !encError, encError?.message ?? '');
  }

  // --- 3. Aucune identite nominative ------------------------------------------------
  const { data: identityRow } = await admin
    .from('patient_identity')
    .select('full_name, date_of_birth, phone, address, external_identifier')
    .eq('base_id', baseId)
    .eq('patient_code', PATIENT_CODE)
    .maybeSingle();
  const nothingNominative = identityRow
    ? [identityRow.full_name, identityRow.date_of_birth, identityRow.phone, identityRow.address, identityRow.external_identifier].every((v) => v == null)
    : false;
  check('le patient qu il cree ne porte AUCUN champ nominatif', nothingNominative);

  const { data: canSeeIdentity } = await student.rpc('can_view_identity', { p_base: baseId });
  check('la base lui refuse la lecture de l identite', canSeeIdentity === false, `can_view_identity=${canSeeIdentity}`);

  await mustFail('get_patient_identity ne lui renvoie rien', () =>
    student.rpc('get_patient_identity', { p_patient_id: createdPatientId }));
  await mustFail('patient_identity n est pas lisible en direct', () =>
    student.from('patient_identity').select('full_name').eq('base_id', baseId));
  await mustFail('il ne peut pas ecrire un nom sur un patient', () =>
    student.rpc('create_patient', {
      p_base_id: baseId, p_patient_code: `${PATIENT_CODE}-N`, p_full_name: 'Nom Fictif',
      p_date_of_birth: null, p_phone: null, p_address: null, p_external_identifier: null, p_permanent_data: {},
    }));

  // --- 4. Cloisonnement entre bases --------------------------------------------------
  if (otherBaseId) {
    await mustFail('il ne voit pas l autre base', () => student.from('base').select('id').eq('id', otherBaseId));
    await mustFail('il ne voit aucun patient de l autre base', () =>
      student.from('patient').select('id').eq('base_id', otherBaseId));
    await mustFail('il ne peut pas creer de patient dans l autre base', () =>
      student.rpc('create_patient', {
        p_base_id: otherBaseId, p_patient_code: `${PATIENT_CODE}-X`, p_full_name: null,
        p_date_of_birth: null, p_phone: null, p_address: null, p_external_identifier: null, p_permanent_data: {},
      }));
  } else {
    console.log('  (une seule base sur ce projet : cloisonnement inter-bases non exercable ici)');
  }

  // --- 5. Capacites refusees ---------------------------------------------------------
  const { data: canExport } = await student.rpc('can_export_data', { p_base: baseId });
  check('il ne peut pas exporter', canExport === false, `can_export_data=${canExport}`);
  const { data: canEdit } = await student.rpc('can_edit_structured_data', { p_base: baseId });
  check('il ne peut pas corriger une saisie soumise', canEdit === false, `can_edit_structured_data=${canEdit}`);
  const { data: canManage } = await student.rpc('can_manage_access', { p_base: baseId });
  check('il ne peut pas gerer les acces', canManage === false, `can_manage_access=${canManage}`);
  const { data: anyVersion } = await admin.from('template_version').select('id').limit(1).maybeSingle();
  await mustFail('il ne peut pas creer de base', () =>
    student.rpc('create_base_from_model', {
      p_name: 'Base interdite', p_specialty: 'x', p_source_version_id: anyVersion?.id ?? null,
    }));
  await mustFail('il ne peut pas lire l inventaire des comptes de mission', () =>
    student.rpc('mission_accounts', { p_base_id: baseId }));

  // --- 6. Revocation immediate -------------------------------------------------------
  const { error: revokeError } = await admin.from('base_access').update({ revoked_at: new Date().toISOString() }).eq('id', accessId);
  if (revokeError) throw revokeError;

  const { data: afterRevoke } = await student.from('base').select('id');
  check('apres revocation, sa base disparait — jeton pourtant toujours valide', (afterRevoke?.length ?? 0) === 0, `${afterRevoke?.length ?? 0} base(s)`);
  await mustFail('apres revocation, il ne peut plus rien creer', () =>
    student.rpc('create_patient', {
      p_base_id: baseId, p_patient_code: `${PATIENT_CODE}-R`, p_full_name: null,
      p_date_of_birth: null, p_phone: null, p_address: null, p_external_identifier: null, p_permanent_data: {},
    }));
} catch (e) {
  check('deroulement du scenario', false, e.message);
} finally {
  // --- Nettoyage : le compte et les donnees fictives creees ne restent pas ------------
  try {
    if (createdPatientId) {
      await admin.from('encounter').delete().eq('patient_id', createdPatientId);
      await admin.from('patient').delete().eq('id', createdPatientId);
      await admin.from('patient_identity').delete().eq('base_id', baseId).eq('patient_code', PATIENT_CODE);
    }
    if (accessId) await admin.from('base_access').delete().eq('id', accessId);
    if (studentId && !keepAccount) await admin.auth.admin.deleteUser(studentId);
    console.log(keepAccount ? '\nCompte de test CONSERVE (--keep=true).' : '\nCompte et donnees de test supprimes.');
  } catch (e) {
    console.error(`\nNettoyage incomplet : ${e.message}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verifications passees.`);
  process.exit(failed.length === 0 ? 0 : 1);
}
