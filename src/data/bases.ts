// Couche d'acces aux donnees "bases" (cahier §8.3 tableau de bord medecin).
// La RLS renvoie deja les bases possedees + partagees ; ici on enrichit avec le
// role effectif de l'utilisateur et le gabarit courant.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AccessRole, BasePermissions } from './access';

export type BaseRole = 'owner' | AccessRole;

const ALL_PERMISSIONS: BasePermissions = {
  canViewIdentity: true,
  canViewRawDocuments: true,
  canEditStructuredData: true,
  canExportData: true,
  canManageAccess: true,
};

export interface Base {
  id: string;
  name: string;
  specialty: string | null;
  ownerUserId: string;
  currentTemplateVersionId: string | null;
}

export interface BaseListing {
  base: Base;
  role: BaseRole;
  permissions: BasePermissions;
  templateName: string | null;
  versionNumber: number | null;
}

export interface PublishedTemplateOption {
  versionId: string;
  versionNumber: number;
  templateId: string;
  name: string;
  specialty: string | null;
  scope: 'global' | 'personal';
}

export interface BaseRepository {
  listMyBases(): Promise<BaseListing[]>;
  /** Modeles proposes au medecin : officiels (global) + ses propres gabarits (personal). */
  listTemplateModels(): Promise<PublishedTemplateOption[]>;
  /** Cree une base en COPIANT un modele source en gabarit personnel editable. */
  createBase(name: string, specialty: string | null, sourceVersionId: string): Promise<Base>;
  getBase(id: string): Promise<BaseListing | null>;
  /** Rattache la base a une (nouvelle) version de son gabarit. Reserve au proprietaire (RLS). */
  setTemplateVersion(baseId: string, versionId: string): Promise<void>;
}

type BaseRow = {
  id: string; name: string; specialty: string | null; owner_user_id: string;
  current_template_version_id: string | null;
};
const mapBase = (r: BaseRow): Base => ({
  id: r.id, name: r.name, specialty: r.specialty, ownerUserId: r.owner_user_id,
  currentTemplateVersionId: r.current_template_version_id,
});

type AccessPermRow = {
  access_role: AccessRole; can_view_identity: boolean; can_view_raw_documents: boolean;
  can_edit_structured_data: boolean; can_export_data: boolean; can_manage_access: boolean;
};
const permsFromRow = (a: AccessPermRow | undefined): BasePermissions => ({
  canViewIdentity: a?.can_view_identity ?? false,
  canViewRawDocuments: a?.can_view_raw_documents ?? false,
  canEditStructuredData: a?.can_edit_structured_data ?? false,
  canExportData: a?.can_export_data ?? false,
  canManageAccess: a?.can_manage_access ?? false,
});

const uniq = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeBaseRepository(client: SupabaseClient | null): BaseRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listMyBases: fail, listTemplateModels: fail, createBase: fail, getBase: fail, setTemplateVersion: fail };
  }

  async function currentUserId(): Promise<string> {
    const { data, error } = await client!.auth.getUser();
    if (error) throw error;
    const id = data.user?.id;
    if (!id) throw new Error('Non authentifie');
    return id;
  }

  async function templateLabels(versionIds: string[]) {
    if (versionIds.length === 0) return { versions: [], templates: [] as { id: string; name: string }[] };
    const { data: versions, error: e1 } = await client!
      .from('template_version')
      .select('id, version_number, template_id')
      .in('id', versionIds);
    if (e1) throw e1;
    const templateIds = uniq((versions ?? []).map((v) => v.template_id as string));
    const { data: templates, error: e2 } = templateIds.length
      ? await client!.from('template').select('id, name').in('id', templateIds)
      : { data: [], error: null };
    if (e2) throw e2;
    return {
      versions: (versions ?? []) as { id: string; version_number: number; template_id: string }[],
      templates: (templates ?? []) as { id: string; name: string }[],
    };
  }

  return {
    async listMyBases() {
      const uid = await currentUserId();
      const { data: bases, error } = await client
        .from('base')
        .select('id, name, specialty, owner_user_id, current_template_version_id')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (bases ?? []) as BaseRow[];

      const { data: access, error: eAcc } = await client
        .from('base_access')
        .select(
          'base_id, access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access',
        )
        .eq('user_id', uid)
        .is('revoked_at', null);
      if (eAcc) throw eAcc;
      const accessByBase = new Map((access ?? []).map((a) => [a.base_id as string, a as AccessPermRow]));

      const { versions, templates } = await templateLabels(uniq(rows.map((b) => b.current_template_version_id)));
      const versionById = new Map(versions.map((v) => [v.id, v]));
      const templateById = new Map(templates.map((t) => [t.id, t]));

      return rows.map((r): BaseListing => {
        const isOwner = r.owner_user_id === uid;
        const acc = accessByBase.get(r.id);
        const v = r.current_template_version_id ? versionById.get(r.current_template_version_id) : undefined;
        return {
          base: mapBase(r),
          role: isOwner ? 'owner' : (acc?.access_role ?? 'viewer'),
          permissions: isOwner ? { ...ALL_PERMISSIONS } : permsFromRow(acc),
          templateName: v ? (templateById.get(v.template_id)?.name ?? null) : null,
          versionNumber: v?.version_number ?? null,
        };
      });
    },

    async listTemplateModels() {
      // La RLS ne renvoie que les modeles lisibles (global + ses propres gabarits).
      const { data, error } = await client
        .from('template')
        .select('id, name, specialty, is_global, template_version(id, version_number)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      type Row = { id: string; name: string; specialty: string | null; is_global: boolean; template_version: { id: string; version_number: number }[] };
      return ((data ?? []) as Row[]).flatMap((t) => {
        const latest = [...(t.template_version ?? [])].sort((a, b) => b.version_number - a.version_number)[0];
        if (!latest) return [];
        return [{
          versionId: latest.id,
          versionNumber: latest.version_number,
          templateId: t.id,
          name: t.name,
          specialty: t.specialty,
          scope: (t.is_global ? 'global' : 'personal') as 'global' | 'personal',
        }];
      });
    },

    async createBase(name, specialty, sourceVersionId) {
      const { data, error } = await client.rpc('create_base_from_model', {
        p_name: name,
        p_specialty: specialty ?? '',
        p_source_version_id: sourceVersionId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as BaseRow;
      return mapBase(row);
    },

    async getBase(id) {
      const all = await this.listMyBases();
      return all.find((b) => b.base.id === id) ?? null;
    },

    async setTemplateVersion(baseId, versionId) {
      const { error } = await client.from('base').update({ current_template_version_id: versionId }).eq('id', baseId);
      if (error) throw error;
    },
  };
}

export const baseRepository: BaseRepository = makeBaseRepository(supabase);
