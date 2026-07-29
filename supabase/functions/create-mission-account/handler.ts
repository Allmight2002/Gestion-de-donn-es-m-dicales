import type { SupabaseClient } from '@supabase/supabase-js';
import { readJsonObject, RequestValidationError, UUID_RE, validationResponse } from '../_shared/contracts.ts';

// Creation d'un COMPTE DE MISSION (docs/spec-comptes-mission.md §6).
//
// Seule fonction detentrice du droit admin Auth : le navigateur n'approche jamais la cle
// service_role. Trois proprietes portees ici, le reste etant garanti par la base :
//
//   * le role `saisisseur` est pose DES LA CREATION du compte, dans app_metadata (non
//     modifiable par l'utilisateur). Le trigger handle_new_user le lit la : un compte de
//     mission n'est jamais medecin, meme une fraction de seconde ;
//   * l'etudiant choisit LUI-MEME son mot de passe (courriel de definition de mot de
//     passe) : le medecin ne connait pas le secret, sinon toute saisie serait contestable ;
//   * l'operation est REJOUABLE. Auth et PostgreSQL ne forment pas une transaction : si le
//     compte existe deja avec le role de mission attendu mais sans ligne d'acces, le rejeu
//     reprend au provisionnement au lieu de repartir de zero ou d'echouer.
//
// L'autorisation de l'appelant est verifiee ici (pre-vol, avant l'acte irreversible qu'est
// la creation du compte) PUIS re-verifiee par provision_mission_access, appelee avec le
// jeton du medecin : la base reste seule juge.

export interface MissionAuthAdmin {
  /** Cree le compte Auth avec le role de mission dans app_metadata. */
  createMissionUser(email: string): Promise<{ userId?: string; error?: string }>;
  /** Envoie le courriel qui permet a l'etudiant de definir son mot de passe. */
  sendPasswordSetup(email: string): Promise<{ error?: string }>;
}

export interface MissionAccountDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
  auth: MissionAuthAdmin;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

// Duree d'une mission : au moins un jour, au plus 24 mois (decision du 2026-07-29).
// Les memes bornes sont re-appliquees par la base ; celles-ci evitent de creer un compte
// Auth pour une demande qui serait de toute facon refusee.
const MIN_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 731 * 24 * 60 * 60 * 1000; // 24 mois, borne haute (annees bissextiles)
const MAX_EMAIL_LENGTH = 254;
const MAX_JUSTIFICATION_LENGTH = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MissionAction = 'create' | 'resend';

interface MissionRequest {
  action: MissionAction;
  baseId: string;
  email: string;
  expiresAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
}

function parse(body: Record<string, unknown>): MissionRequest {
  const action = body.action === undefined ? 'create' : body.action;
  if (action !== 'create' && action !== 'resend') {
    throw new RequestValidationError(400, 'Action invalide');
  }
  if (typeof body.baseId !== 'string' || !UUID_RE.test(body.baseId)) {
    throw new RequestValidationError(400, 'Base invalide');
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    throw new RequestValidationError(400, 'Adresse de courriel invalide');
  }

  if (action === 'resend') {
    return { action, baseId: body.baseId, email, expiresAt: '', canViewIdentity: false, identityJustification: null };
  }

  if (typeof body.expiresAt !== 'string') throw new RequestValidationError(400, 'Echeance invalide');
  const expires = Date.parse(body.expiresAt);
  if (!Number.isFinite(expires)) throw new RequestValidationError(400, 'Echeance invalide');
  const delta = expires - Date.now();
  if (delta < MIN_DURATION_MS) throw new RequestValidationError(400, 'La mission doit durer au moins un jour');
  if (delta > MAX_DURATION_MS) throw new RequestValidationError(400, 'La mission ne peut depasser 24 mois');

  const canViewIdentity = body.canViewIdentity === true;
  let justification: string | null = null;
  if (canViewIdentity) {
    justification = typeof body.identityJustification === 'string' ? body.identityJustification.trim() : '';
    if (!justification) throw new RequestValidationError(400, "Justification requise pour ouvrir l'identite");
    if (justification.length > MAX_JUSTIFICATION_LENGTH) {
      throw new RequestValidationError(400, 'Justification trop longue');
    }
  }

  return {
    action,
    baseId: body.baseId,
    email,
    expiresAt: new Date(expires).toISOString(),
    canViewIdentity,
    identityJustification: justification,
  };
}

interface AccountState {
  userId: string;
  globalRole: string | null;
  activated: boolean;
}

/** Etat Auth+profil de l'adresse, via une RPC reservee au service_role. */
async function lookupAccount(admin: SupabaseClient, email: string): Promise<AccountState | null | 'error'> {
  const { data, error } = await admin.rpc('mission_account_lookup', { p_email: email });
  if (error) return 'error';
  const rows = (Array.isArray(data) ? data : []) as Array<
    { user_id: string; global_role: string | null; activated: boolean }
  >;
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id, globalRole: rows[0].global_role, activated: rows[0].activated === true };
}

export async function handleCreateMissionAccount(req: Request, deps: MissionAccountDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'Authentification requise' });

  let input: MissionRequest;
  try {
    input = parse(await readJsonObject(req));
  } catch (error) {
    return validationResponse(error);
  }

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(authHeader));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible' });
  }

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  // Pre-vol : ne jamais creer un compte Auth pour un appelant qui n'a pas la main sur la
  // base. La base re-verifie ensuite ; ce controle evite seulement l'acte irreversible.
  const { data: allowed, error: permissionError } = await asUser.rpc('can_manage_access', { p_base: input.baseId });
  if (permissionError || allowed !== true) {
    return json(403, { error: 'Gestion des acces requise sur cette base' });
  }

  const existing = await lookupAccount(admin, input.email);
  if (existing === 'error') {
    console.error('create-mission-account: lookup failed');
    return json(500, { error: 'Verification du compte impossible' });
  }

  if (input.action === 'resend') {
    if (!existing || existing.globalRole !== 'saisisseur') {
      return json(404, { error: 'Aucun compte de mission pour cette adresse' });
    }
    const { error: mailError } = await deps.auth.sendPasswordSetup(input.email);
    if (mailError) {
      console.error('create-mission-account: password setup mail failed on resend');
      return json(502, { error: 'Envoi du courriel impossible' });
    }
    return json(200, { userId: existing.userId, resent: true });
  }

  let userId: string;
  let created = false;

  if (existing && existing.globalRole !== 'saisisseur') {
    // Aucune retrogradation silencieuse d'un compte existant (medecin, curateur, admin).
    // Message generique cote client : l'existence d'un compte ne doit pas etre enumerable.
    console.error('create-mission-account: refused, address already bound to a non-mission account');
    return json(409, { error: 'Cette adresse ne peut pas recevoir un compte de mission' });
  }

  if (existing) {
    // Rejeu : le compte de mission existe deja (invitation precedente, ou provisionnement
    // interrompu apres la creation Auth). On reprend au provisionnement.
    userId = existing.userId;
  } else {
    const invited = await deps.auth.createMissionUser(input.email);
    if (!invited.userId) {
      console.error('create-mission-account: auth user creation failed');
      return json(502, { error: 'Creation du compte impossible' });
    }
    userId = invited.userId;
    created = true;
  }

  // Supabase n'ecrit PAS app_metadata dans la meme instruction que l'insertion de
  // l'utilisateur : le declencheur handle_new_user ne voit donc pas le role et cree un
  // profil medecin. Sans cette reconciliation, le compte de mission naitrait medecin,
  // capable de creer ses propres bases — l'escalade meme que le lot doit empecher.
  // La RPC relit app_metadata cote serveur et refuse de toucher un compte deja etabli.
  // Idempotente : sans effet sur un rejeu.
  const { data: role, error: roleError } = await admin.rpc('reconcile_mission_profile', {
    p_user_id: userId,
  });
  if (roleError || role !== 'saisisseur') {
    console.error('create-mission-account: mission role could not be established');
    return json(409, { error: 'Role de mission non etabli : aucun acces pose' });
  }

  // Provisionnement AVEC LE JETON DU MEDECIN : l'autorisation, les invariants de mission
  // et l'audit restent portes par la base (auth.uid() = le medecin appelant).
  const { data: access, error: accessError } = await asUser.rpc('provision_mission_access', {
    p_base_id: input.baseId,
    p_user_id: userId,
    p_expires_at: input.expiresAt,
    p_can_view_identity: input.canViewIdentity,
    p_identity_justification: input.identityJustification,
  });
  if (accessError || !access) {
    // Compensation : le compte Auth eventuellement cree reste INERTE (role saisisseur sans
    // aucune ligne d'acces : il ne peut ni creer de base, ni voir quoi que ce soit). Le rejeu
    // de la meme demande le retrouvera et reprendra exactement ici.
    console.error('create-mission-account: access provisioning refused');
    return json(409, {
      error: created ? 'Compte cree mais acces non pose : relancez la meme demande' : 'Acces de mission refuse',
    });
  }

  // Le courriel de definition de mot de passe part APRES le provisionnement : l'etudiant
  // qui suit le lien trouve sa base en place. Un echec d'envoi ne perd pas la mission,
  // il se rattrape par le renvoi d'invitation.
  const { error: mailError } = await deps.auth.sendPasswordSetup(input.email);
  if (mailError) {
    console.error('create-mission-account: password setup mail failed');
    return json(200, { userId, created, mailSent: false });
  }

  return json(200, { userId, created, mailSent: true });
}
