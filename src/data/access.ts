// Couche d'acces "gestion des acces" (cahier v3.0 §4.3, §10).
// Les invitations ne stockent QUE le hash du jeton (token_hash) ; le jeton en clair
// n'est montre qu'une fois, a la creation. Les acces sont revoques en posant
// revoked_at (revocation douce), jamais supprimes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AccessRole = 'viewer' | 'editor' | 'curator' | 'validator';

/** Les 6 permissions granulaires (cahier v3.0 §4.3). */
export interface BasePermissions {
  canViewIdentity: boolean;
  canViewRawDocuments: boolean;
  canEditStructuredData: boolean;
  canValidateData: boolean;
  canExportData: boolean;
  canManageAccess: boolean;
}

export const NO_PERMISSIONS: BasePermissions = {
  canViewIdentity: false,
  canViewRawDocuments: false,
  canEditStructuredData: false,
  canValidateData: false,
  canExportData: false,
  canManageAccess: false,
};

/**
 * Permissions par defaut proposees pour un role de partage. Le partage de base se fait
 * desormais entre medecins (viewer/editor) ; curator/validator restent dans l'enum (legacy,
 * non proposes a l'invitation). La base applique aussi ces invariants via des CHECK.
 */
export function defaultPermissionsFor(role: AccessRole): BasePermissions {
  switch (role) {
    case 'editor':
      return { ...NO_PERMISSIONS, canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true };
    case 'curator':
      return { ...NO_PERMISSIONS, canViewRawDocuments: true, canEditStructuredData: true };
    case 'validator':
      return { ...NO_PERMISSIONS, canViewRawDocuments: true, canEditStructuredData: true, canValidateData: true };
    case 'viewer':
    default:
      return { ...NO_PERMISSIONS };
  }
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

export interface AccessRepository {
  listInvitations(baseId: string): Promise<InvitationItem[]>;
  /** Renvoie le jeton EN CLAIR (a montrer une seule fois) ; seul le hash est stocke. */
  createInvitation(baseId: string, email: string, role: AccessRole, permissions: BasePermissions): Promise<{ token: string }>;
  revokeInvitation(id: string): Promise<void>;
  listAccess(baseId: string): Promise<AccessItem[]>;
  revokeAccess(id: string): Promise<void>;
  setPermissions(id: string, permissions: BasePermissions): Promise<void>;
  acceptInvitation(token: string): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';
const INVITATION_TTL_DAYS = 7;

type PermRow = {
  can_view_identity: boolean; can_view_raw_documents: boolean; can_edit_structured_data: boolean;
  can_validate_data: boolean; can_export_data: boolean; can_manage_access: boolean;
};
type InvRow = PermRow & { id: string; invited_email: string; access_role: AccessRole; status: string; expires_at: string };
type AccRow = PermRow & { id: string; user_id: string; access_role: AccessRole; profiles: { full_name: string | null } | null };

const mapPerms = (r: PermRow): BasePermissions => ({
  canViewIdentity: r.can_view_identity,
  canViewRawDocuments: r.can_view_raw_documents,
  canEditStructuredData: r.can_edit_structured_data,
  canValidateData: r.can_validate_data,
  canExportData: r.can_export_data,
  canManageAccess: r.can_manage_access,
});
const permColumns = (p: BasePermissions) => ({
  can_view_identity: p.canViewIdentity,
  can_view_raw_documents: p.canViewRawDocuments,
  can_edit_structured_data: p.canEditStructuredData,
  can_validate_data: p.canValidateData,
  can_export_data: p.canExportData,
  can_manage_access: p.canManageAccess,
});
const PERM_SELECT =
  'can_view_identity, can_view_raw_documents, can_edit_structured_data, can_validate_data, can_export_data, can_manage_access';

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
      const { data: u } = await client.auth.getUser();
      const token = crypto.randomUUID();
      const tokenHash = await sha256Hex(token);
      const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000).toISOString();
      const { error } = await client.from('base_invitation').insert({
        base_id: baseId,
        invited_email: email,
        access_role: role,
        ...permColumns(permissions),
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expires,
        invited_by: u.user?.id ?? null,
      });
      if (error) throw error;
      return { token };
    },

    async revokeInvitation(id) {
      const { error } = await client.from('base_invitation').update({ status: 'revoked' }).eq('id', id);
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
      const { error } = await client.from('base_access').update({ revoked_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },

    async setPermissions(id, permissions) {
      const { error } = await client.from('base_access').update(permColumns(permissions)).eq('id', id);
      if (error) throw error;
    },

    async acceptInvitation(token) {
      const { error } = await client.rpc('accept_invitation', { p_token: token });
      if (error) throw error;
    },
  };
}

export const accessRepository: AccessRepository = makeAccessRepository(supabase);
