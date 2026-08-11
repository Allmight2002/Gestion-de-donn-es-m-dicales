// Verification de bout en bout d'un COMPTE DE MISSION sur un projet Supabase reel
// (staging ou production). Donnees FICTIVES uniquement.
//
//   node scripts/verify-mission-account.mjs --env-file=.env.staging --prefix=STAGING_
//
// Le script utilise le vrai contrat Edge pour creer, reveler, regenerer puis revoquer
// un compte de mission. Les sessions du saisisseur passent sous sa propre RLS.
// Aucun identifiant de connexion ni mot de passe de mission n'est imprime.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }),
);
const envFile = args.get('env-file');
const prefix = args.get('prefix') ?? '';
const keepAccount = args.get('keep') === 'true';

if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
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
const medecinEmail = need('MEDECIN_EMAIL');
const medecinPassword = need('MEDECIN_PASSWORD');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const medecin = createClient(url, anonKey, { auth: { persistSession: false } });

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ECHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const describeError = (error) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return 'erreur inconnue';
};

const stamp = Date.now();
const strictUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loginIdentifier = `qa-mission-${stamp}`;
const technicalEmail = `${loginIdentifier}@mission.meddata.invalid`;
const accountLabel = `QA mission ${stamp}`;
const patientCode = `MIS-VERIF-${stamp}`;
const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
const createOperationId = crypto.randomUUID();
const duplicateCreateOperationId = crypto.randomUUID();
const regenerateOperationId = crypto.randomUUID();

let studentId = null;
let baseId = null;
let otherBaseId = null;
let accessId = null;
let createdPatientId = null;
let firstPassword;
let secondPassword;

const missionBody = {
  action: 'create',
  operationId: createOperationId,
  baseId: null,
  accountLabel,
  loginIdentifier,
  expiresAt,
  canViewIdentity: false,
  identityJustification: null,
};

/** Attendu : l'appel echoue, ou sa RLS ne retourne aucune ligne. */
const mustFail = async (label, fn) => {
  try {
    const { data, error } = await fn();
    if (error) return check(label, true, 'refuse par le serveur');
    const empty = data == null || (Array.isArray(data) && data.length === 0);
    check(label, empty, empty ? 'aucune ligne visible' : 'donnees visibles');
  } catch {
    check(label, true, 'refuse par le serveur');
  }
};

const invokeMission = (client, body) => client.functions.invoke('create-mission-account', { body });

try {
  console.log(`\nProjet : ${url}\n`);

  const { data: doctorSession, error: doctorError } = await medecin.auth.signInWithPassword({
    email: medecinEmail,
    password: medecinPassword,
  });
  if (doctorError || !doctorSession.user) {
    throw doctorError ?? new Error('Connexion du medecin impossible');
  }

  // La cible doit obligatoirement appartenir au medecin de verification.
  const { data: ownedBases, error: ownedError } = await medecin
    .from('base')
    .select('id, name, current_template_version_id')
    .eq('owner_user_id', doctorSession.user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100);
  const ownedBase = ownedBases?.find((base) => strictUuid.test(base.id) && base.current_template_version_id);
  if (ownedError || !ownedBase) {
    throw ownedError ?? new Error('Le medecin de verification ne possede aucune base active');
  }
  baseId = ownedBase.id;
  missionBody.baseId = baseId;
  console.log(`Base de mission : ${ownedBase.name}`);

  otherBaseId = ownedBases.find((base) => base.id !== baseId)?.id ?? null;

  // 1. Creation reelle par l'Edge, sans e-mail utilisateur.
  const { data: created, error: createError } = await invokeMission(medecin, missionBody);
  const createdCredential = created?.credential;
  const creationOk = !createError
    && typeof created?.userId === 'string'
    && typeof created?.accessId === 'string'
    && createdCredential?.loginIdentifier === loginIdentifier
    && typeof createdCredential?.password === 'string';
  check("l'Edge cree le compte sans e-mail utilisateur", creationOk, createError ? 'appel refuse' : '');
  if (!creationOk) throw new Error('Creation Edge incomplete');

  studentId = created.userId;
  accessId = created.accessId;
  firstPassword = createdCredential.password;

  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(studentId);
  if (authUserError) throw authUserError;
  check(
    'le compte recoit le role saisisseur, pas medecin',
    authUser.user?.app_metadata?.global_role === 'saisisseur',
  );
  check(
    "l'identite Auth technique reste distincte de l'identifiant visible",
    authUser.user?.email === technicalEmail && authUser.user?.user_metadata?.full_name === accountLabel,
  );

  // 2. Rejeu et unicite : aucun nouveau compte et aucun nouveau secret silencieux.
  const { data: replayed, error: replayError } = await invokeMission(medecin, missionBody);
  check(
    'le rejeu strict restitue le meme compte et le meme secret',
    !replayError
      && replayed?.userId === studentId
      && replayed?.credential?.loginIdentifier === loginIdentifier
      && replayed?.credential?.password === firstPassword,
  );

  const { error: duplicateError } = await invokeMission(medecin, {
    ...missionBody,
    operationId: duplicateCreateOperationId,
  });
  const { count: credentialCount, error: credentialCountError } = await admin
    .from('mission_account_credential')
    .select('user_id', { count: 'exact', head: true })
    .ilike('login_identifier', loginIdentifier);
  if (credentialCountError) throw credentialCountError;
  check(
    'une nouvelle operation avec le meme identifiant est refusee sans doublon',
    !!duplicateError && credentialCount === 1,
    `${credentialCount ?? 0} compte(s)`,
  );

  const { data: ownedMissionRows, error: ownedMissionError } = await medecin
    .rpc('mission_accounts_owned', { p_base_id: baseId });
  if (ownedMissionError) throw ownedMissionError;
  const accessCount = ownedMissionRows?.filter((row) => row.user_id === studentId).length ?? 0;
  check("l'acces n'est pas duplique", accessCount === 1, `${accessCount} ligne(s)`);

  // 3. Le coffre, les operations et l'audit ne contiennent aucun mot de passe en clair.
  const { data: credentialRow, error: credentialError } = await admin
    .from('mission_account_credential')
    .select('password_ciphertext, password_nonce, credential_generation, status')
    .eq('user_id', studentId)
    .single();
  if (credentialError) throw credentialError;

  const { data: operationRows, error: operationError } = await admin
    .from('mission_credential_operation')
    .select('*')
    .eq('user_id', studentId);
  if (operationError) throw operationError;

  const { data: auditRows, error: auditError } = await medecin
    .from('audit_log')
    .select('action, metadata')
    .eq('base_id', baseId)
    .like('action', 'mission_%');
  if (auditError) throw auditError;

  const storedEvidence = JSON.stringify({ credentialRow, operationRows, auditRows });
  check(
    'aucune table ni trace audit ne contient le mot de passe en clair',
    credentialRow.status === 'active'
      && credentialRow.credential_generation === 1
      && credentialRow.password_ciphertext !== firstPassword
      && credentialRow.password_nonce !== firstPassword
      && !storedEvidence.includes(firstPassword)
      && !storedEvidence.includes(loginIdentifier),
  );

  const { data: revealed, error: revealError } = await invokeMission(medecin, {
    action: 'reveal',
    accessId,
  });
  check(
    'le proprietaire peut retrouver le mot de passe chiffre',
    !revealError
      && revealed?.credential?.loginIdentifier === loginIdentifier
      && revealed?.credential?.password === firstPassword,
  );

  // 4. Session du compte de mission : tout passe sous SA RLS.
  const oldStudentSession = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await oldStudentSession.auth.signInWithPassword({
    email: technicalEmail,
    password: firstPassword,
  });
  if (signInError) throw signInError;

  const { data: visible } = await oldStudentSession.from('base').select('id');
  check(
    'le saisisseur voit exactement une base, la sienne',
    visible?.length === 1 && visible[0].id === baseId,
    `${visible?.length ?? 0} base(s)`,
  );

  const { data: newPatient, error: patientError } = await oldStudentSession.rpc('create_patient', {
    p_base_id: baseId,
    p_patient_code: patientCode,
    p_full_name: null,
    p_date_of_birth: null,
    p_phone: null,
    p_address: null,
    p_external_identifier: null,
    p_permanent_data: {},
  });
  check('il cree un patient sur sa base', !patientError && !!newPatient, patientError ? 'refuse' : '');
  createdPatientId = newPatient?.id ?? null;

  if (createdPatientId) {
    const { error: encounterError } = await oldStudentSession.rpc('create_encounter', {
      p_patient_id: createdPatientId,
      p_encounter_type: 'consultation',
      p_encounter_date: new Date().toISOString().slice(0, 10),
      p_validation_status: 'draft',
      p_data: {},
      p_age_unit: 'years',
    });
    check('il cree une rencontre en brouillon', !encounterError, encounterError ? 'refuse' : '');
  }

  const { data: canSeeIdentity, error: identityPermissionError } = await oldStudentSession
    .rpc('can_view_identity', { p_base: baseId });
  if (identityPermissionError) throw identityPermissionError;
  check("la mission refuse la lecture de l'identite", canSeeIdentity === false);
  await mustFail("le saisisseur ne peut pas lire l'identite du patient", () =>
    oldStudentSession.rpc('get_patient_identity', { p_patient_id: createdPatientId }));

  await mustFail("le saisisseur ne peut pas reveler les justificatifs", () =>
    invokeMission(oldStudentSession, { action: 'reveal', accessId }));
  await mustFail("le saisisseur ne peut pas lister les comptes de mission", () =>
    oldStudentSession.rpc('mission_accounts_owned'));

  if (otherBaseId) {
    await mustFail("il ne voit pas l'autre base", () =>
      oldStudentSession.from('base').select('id').eq('id', otherBaseId));
    await mustFail("il ne peut pas creer dans l'autre base", () =>
      oldStudentSession.rpc('create_patient', {
        p_base_id: otherBaseId,
        p_patient_code: `${patientCode}-X`,
        p_full_name: null,
        p_date_of_birth: null,
        p_phone: null,
        p_address: null,
        p_external_identifier: null,
        p_permanent_data: {},
      }));
  }

  const { data: canExport } = await oldStudentSession.rpc('can_export_data', { p_base: baseId });
  check('il ne peut pas exporter', canExport === false);
  const { data: canManage } = await oldStudentSession.rpc('can_manage_access', { p_base: baseId });
  check('il ne peut pas gerer les acces', canManage === false);

  // 5. Regeneration distincte, rejouable, qui invalide le mot de passe et le JWT anterieurs.
  const { data: regenerated, error: regenerateError } = await invokeMission(medecin, {
    action: 'regenerate',
    accessId,
    operationId: regenerateOperationId,
  });
  const regenerationOk = !regenerateError
    && regenerated?.credential?.loginIdentifier === loginIdentifier
    && typeof regenerated?.credential?.password === 'string'
    && regenerated.credential.password !== firstPassword;
  check('la regeneration conserve l identifiant et change le mot de passe', regenerationOk);
  if (!regenerationOk) throw new Error('Regeneration Edge incomplete');
  secondPassword = regenerated.credential.password;

  const { data: regenerationReplay, error: regenerationReplayError } = await invokeMission(medecin, {
    action: 'regenerate',
    accessId,
    operationId: regenerateOperationId,
  });
  check(
    'le rejeu de la regeneration ne fabrique pas un troisieme secret',
    !regenerationReplayError
      && regenerationReplay?.credential?.password === secondPassword
      && regenerationReplay?.credential?.loginIdentifier === loginIdentifier,
  );

  const { data: oldSessionBases } = await oldStudentSession.from('base').select('id');
  check(
    "l'ancien jeton perd immediatement l'acces aux donnees",
    (oldSessionBases?.length ?? 0) === 0,
    `${oldSessionBases?.length ?? 0} base(s)`,
  );

  const oldPasswordClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: oldPasswordError } = await oldPasswordClient.auth.signInWithPassword({
    email: technicalEmail,
    password: firstPassword,
  });
  check("l'ancien mot de passe est refuse", !!oldPasswordError);

  const currentStudentSession = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: newPasswordError } = await currentStudentSession.auth.signInWithPassword({
    email: technicalEmail,
    password: secondPassword,
  });
  check('le nouveau mot de passe fonctionne', !newPasswordError);

  const { data: revealedAfterRegeneration, error: secondRevealError } = await invokeMission(medecin, {
    action: 'reveal',
    accessId,
  });
  check(
    'la revelation ulterieure rend le mot de passe courant',
    !secondRevealError && revealedAfterRegeneration?.credential?.password === secondPassword,
  );

  const { data: rotatedCredential, error: rotatedCredentialError } = await admin
    .from('mission_account_credential')
    .select('password_ciphertext, password_nonce, credential_generation, status')
    .eq('user_id', studentId)
    .single();
  if (rotatedCredentialError) throw rotatedCredentialError;
  const { data: rotatedAudit, error: rotatedAuditError } = await medecin
    .from('audit_log')
    .select('action, metadata')
    .eq('base_id', baseId)
    .like('action', 'mission_%');
  if (rotatedAuditError) throw rotatedAuditError;
  const rotatedEvidence = JSON.stringify({ rotatedCredential, rotatedAudit });
  check(
    'la regeneration ne laisse aucun ancien ou nouveau mot de passe dans les traces',
    rotatedCredential.credential_generation === 2
      && rotatedCredential.password_ciphertext !== secondPassword
      && !rotatedEvidence.includes(firstPassword)
      && !rotatedEvidence.includes(secondPassword)
      && !rotatedEvidence.includes(loginIdentifier),
  );

  // 6. La revocation reste une garde serveur independante du mot de passe.
  const { data: revoked, error: revokeError } = await invokeMission(medecin, {
    action: 'revoke',
    accessId,
  });
  check('le proprietaire revoque explicitement le compte', !revokeError && revoked?.revoked === true);

  const { data: afterRevoke } = await currentStudentSession.from('base').select('id');
  check('apres revocation, aucune donnee ne redevient visible', (afterRevoke?.length ?? 0) === 0);

  const revokedClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: revokedLoginError } = await revokedClient.auth.signInWithPassword({
    email: technicalEmail,
    password: secondPassword,
  });
  check('apres revocation, le mot de passe courant est refuse par Auth', !!revokedLoginError);
} catch (error) {
  check('deroulement du scenario', false, describeError(error));
} finally {
  // Nettoyage : aucune donnee fictive ni aucun compte technique ne doit rester.
  try {
    if (!keepAccount) {
      if (createdPatientId) await medecin.rpc('soft_delete_patient', {
        p_patient_id: createdPatientId,
        p_reason: 'Nettoyage de la verification synthetique MedData',
      });
      if (studentId) {
        await admin.from('mission_credential_operation').delete().eq('user_id', studentId);
        await admin.from('mission_account_credential').delete().eq('user_id', studentId);
        await admin.auth.admin.deleteUser(studentId);
      }
    }
    console.log(keepAccount ? '\nCompte de test conserve (--keep=true).' : '\nCompte supprime et donnees QA neutralisees.');
  } catch (error) {
    console.error(`\nNettoyage incomplet : ${describeError(error)}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verifications passees.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
