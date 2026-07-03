// Couche d'acces "gestion des acces" (cahier v3.0 §4.3, §10).
// Les invitations ne stockent QUE le hash du jeton (token_hash) ; le jeton en clair
// n'est montre qu'une fois, a la creation. Les acces sont revoques en posant
// revoked_at (revocation douce), jamais supprimes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AccessRole = 'viewer' | 'editor';

/** Les 6 permissions granulaires (cahier v3.0 §4.3). */
export interface BasePermissions {
  canViewIdentity: boolean;
  canViewRawDocuments: boolean;
  canEditStructuredData: boolean;
  canExportData: boolean;
  canManageAccess: boolean;
}

export const NO_PERMISSIONS: BasePermissions = {
  canViewIdentity: false,
  canViewRawDocuments: false,
  canEditStructuredData: false,
  canExportData: false,
  canManageAccess: false,
};

/**
 * Permissions par defaut proposees pour un role de partage. Le partage de base se fait
 * entre medecins : `editor` (lecture + saisie structuree) ou `viewer` (lecture seule).
 * La base applique aussi ces invariants via des CHECK.
 */
export function defaultPermissionsFor(role: AccessRole): BasePermissions {
  switch (role) {
    case 'editor':
      return { ...NO_PERMISSIONS, canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true };
    case 'viewer':
    default:
      return { ...NO_PERMISSIONS };
  }
}

// --- Profils de role NOMMES (C1) --------------------------------------------------------------
// Pure ergonomie AU-DESSUS des 5 permissions : un chercheur pense en roles d'etude, pas en
// booleens. Choisir un profil coche les bonnes cases ; le reglage fin reste possible (-> 'custom').
// Le SERVEUR reste seul juge (RLS + triggers §6.1) : ces presets ne relachent aucun controle.
export type RolePreset = 'principal_investigator' | 'co_investigator' | 'data_entry' | 'monitor';

export const ROLE_PRESETS: RolePreset[] = ['principal_investigator', 'co_investigator', 'data_entry', 'monitor'];

const ALL_PERMISSIONS: BasePermissions = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canExportData: true, canManageAccess: true,
};

/** Les 5 permissions correspondant a un profil nomme. */
export function permissionsForPreset(preset: RolePreset): BasePermissions {
  switch (preset) {
    case 'principal_investigator': // pilote l'etude : tout, y compris gerer l'equipe
      return { ...ALL_PERMISSIONS };
    case 'co_investigator': // acces complet aux donnees + export, mais ne gere pas l'equipe
      return { ...ALL_PERMISSIONS, canManageAccess: false };
    case 'data_entry': // saisit l'analytique pseudonymise ; ni identite, ni export, ni gestion
      return { ...NO_PERMISSIONS, canEditStructuredData: true };
    case 'monitor': // relit en lecture seule (qualite) ; pseudonymise, aucune ecriture
      return { ...NO_PERMISSIONS };
  }
}

/** Le role de partage decoule des permissions : « editor » des qu'il y a de la saisie, sinon « viewer ». */
export function roleForPermissions(p: BasePermissions): AccessRole {
  return p.canEditStructuredData ? 'editor' : 'viewer';
}

const PERM_ORDER = Object.keys(NO_PERMISSIONS) as (keyof BasePermissions)[];
const samePerms = (a: BasePermissions, b: BasePermissions): boolean => PERM_ORDER.every((k) => a[k] === b[k]);

/** Reconnait le profil correspondant a un jeu de permissions, ou `null` (= « Personnalise »). */
export function presetOf(p: BasePermissions): RolePreset | null {
  return ROLE_PRESETS.find((preset) => samePerms(permissionsForPreset(preset), p)) ?? null;
}

export interface InvitationItem {
  id: string;
  email: string;
  role: AccessRole;
  permissions: BasePermissions;
  status: string;
  expiresAt: string;
}
export interface AccessItem {
  id: string;
  userId: string;
  fullName: string | null;
  role: AccessRole;
  permissions: BasePermissions;
}

// --- E1 : activite de consultation d'identite (« qui accede a mes bases ») --------------------
export interface IdentityRead {
  at: string;
  readerName: string;
  patientCode: string | null;
}
export interface IdentityReaderSummary {
  readerName: string;
  count: number;
  lastAt: string;
}
export interface IdentityAudit {
  byReader: IdentityReaderSummary[];
  reads: IdentityRead[];
}

export interface AccessRepository {
  listInvitations(baseId: string): Promise<InvitationItem[]>;
  /** Renvoie le jeton EN CLAIR (a montrer une seule fois) ; seul le hash est stocke. */
  createInvitation(baseId: string, email: string, role: AccessRole, permissions: BasePermissions): Promise<{ token: string }>;
  revokeInvitation(id: string): Promise<void>;
  listAccess(baseId: string): Promise<AccessItem[]>;
  revokeAccess(id: string): Promise<void>;
  setPermissions(id: string, permissions: BasePermissions): Promise<void>;
  acceptInvitation(token: string): Promise<void>;
  /** E1 : consultations d'identite des 30 derniers jours (proprietaire / gestionnaire seulement). */
  getIdentityAudit(baseId: string): Promise<IdentityAudit>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';
const INVITATION_TTL_DAYS = 7;

type PermRow = {
  can_view_identity: boolean; can_view_raw_documents: boolean; can_edit_structured_data: boolean;
  can_export_data: boolean; can_manage_access: boolean;
};
type InvRow = PermRow & { id: string; invited_email: string; access_role: AccessRole; status: string; expires_at: string };
type AccRow = PermRow & { id: string; user_id: string; access_role: AccessRole; profiles: { full_name: string | null } | null };

const mapPerms = (r: PermRow): BasePermissions => ({
  canViewIdentity: r.can_view_identity,
  canViewRawDocuments: r.can_view_raw_documents,
  canEditStructuredData: r.can_edit_structured_data,
  canExportData: r.can_export_data,
  canManageAccess: r.can_manage_access,
});
const PERM_SELECT =
  'can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access';

/** SHA-256 hex via Web Crypto — meme algorithme que digest('sha256') cote base. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function makeAccessRepository(client: SupabaseClient | null): AccessRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listInvitations: fail, createInvitation: fail, revokeInvitation: fail,
      listAccess: fail, revokeAccess: fail, setPermissions: fail, acceptInvitation: fail,
      getIdentityAudit: fail,
    };
  }

  return {
    async listInvitations(baseId) {
      const { data, error } = await client
        .from('base_invitation')
        .select(`id, invited_email, access_role, status, expires_at, ${PERM_SELECT}`)
        .eq('base_id', baseId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as InvRow[]).map((r) => ({
        id: r.id, email: r.invited_email, role: r.access_role,
        permissions: mapPerms(r), status: r.status, expiresAt: r.expires_at,
      }));
    },

    async createInvitation(baseId, email, role, permissions) {
      const token = crypto.randomUUID();
      const tokenHash = await sha256Hex(token);
      const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000).toISOString();
      const { error } = await client.rpc('create_base_invitation', {
        p_base_id: baseId,
        p_invited_email: email,
        p_access_role: role,
        p_token_hash: tokenHash,
        p_expires_at: expires,
        p_can_view_identity: permissions.canViewIdentity,
        p_can_view_raw_documents: permissions.canViewRawDocuments,
        p_can_edit_structured_data: permissions.canEditStructuredData,
        p_can_export_data: permissions.canExportData,
        p_can_manage_access: permissions.canManageAccess,
      });
      if (error) throw error;
      return { token };
    },

    async revokeInvitation(id) {
      const { error } = await client.rpc('revoke_base_invitation', { p_invitation_id: id });
      if (error) throw error;
    },

    async listAccess(baseId) {
      const { data, error } = await client
        .from('base_access')
        .select(`id, user_id, access_role, profiles:user_id(full_name), ${PERM_SELECT}`)
        .eq('base_id', baseId)
        .is('revoked_at', null);
      if (error) throw error;
      return ((data ?? []) as unknown as AccRow[]).map((r) => ({
        id: r.id, userId: r.user_id, fullName: r.profiles?.full_name ?? null,
        role: r.access_role, permissions: mapPerms(r),
      }));
    },

    async revokeAccess(id) {
      const { error } = await client.rpc('revoke_base_access', { p_access_id: id });
      if (error) throw error;
    },

    async setPermissions(id, permissions) {
      const { error } = await client.rpc('update_base_access_permissions', {
        p_access_id: id,
        p_can_view_identity: permissions.canViewIdentity,
        p_can_view_raw_documents: permissions.canViewRawDocuments,
        p_can_edit_structured_data: permissions.canEditStructuredData,
        p_can_export_data: permissions.canExportData,
        p_can_manage_access: permissions.canManageAccess,
      });
      if (error) throw error;
    },

    async acceptInvitation(token) {
      const { error } = await client.rpc('accept_invitation', { p_token: token });
      if (error) throw error;
    },

    async getIdentityAudit(baseId) {
      const { data, error } = await client.rpc('base_identity_audit', { p_base_id: baseId });
      if (error) throw error;
      const a = (data ?? {}) as Partial<IdentityAudit>;
      return { byReader: a.byReader ?? [], reads: a.reads ?? [] };
    },
  };
}

export const accessRepository: AccessRepository = makeAccessRepository(supabase);
