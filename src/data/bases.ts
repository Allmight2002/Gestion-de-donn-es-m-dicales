// Couche d'acces aux donnees "bases" (cahier §8.3 tableau de bord medecin).
// La RLS renvoie deja les bases possedees + partagees ; ici on enrichit avec le
// role effectif de l'utilisateur et le gabarit courant.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AccessRole, BasePermissions } from './access';
import { requireUpdatedRow } from '../lib/guardedWrite';

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

// D2 — statistiques d'inclusion (courbe cumulée vs objectif). Analytique pur (comptes par mois).
export interface InclusionStats {
  total: number;
  target: number | null;
  targetDate: string | null;
  targetRevision: number;
  dateField?: string | null;
  monthly: { month: string; count: number }[];
}

// B1 — completude par variable. Par defaut, chaque dossier est evalue contre sa version historique.
export interface CompletenessRow {
  mode?: 'historical' | 'current';
  templateVersionId?: string;
  versionNumber?: number;
  fieldKey: string;
  label: string;
  scope: 'patient' | 'encounter';
  observed?: number;
  missingCoded?: number;
  filled: number;
  total: number;
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
  /** D2 : inclusions par mois + objectif (RLS : sans acces -> serie vide). */
  getInclusionStats(baseId: string): Promise<InclusionStats>;
  /** D2 : fixe/retire l'objectif d'inclusion (proprietaire seulement, RLS base_update). */
  setInclusionTarget(
    baseId: string,
    target: number | null,
    targetDate: string | null,
    expectedRevision: number,
  ): Promise<void>;
  /** B1 : completude par variable, les moins renseignees d'abord (RLS : sans acces -> vide). */
  getCompletenessStats(baseId: string, mode?: 'historical' | 'current' | 'both'): Promise<CompletenessRow[]>;
}

type BaseRow = {
  id: string; name: string; specialty: string | null; owner_user_id: string;
  current_template_version_id: string | null;
};
const mapBase = (r: BaseRow): Base => ({
  id: r.id, name: r.name, specialty: r.specialty, ownerUserId: r.owner_user_id,
  currentTemplateVersionId: r.current_template_version_id,
});
// Base + libelle de gabarit JOINT en une requete (PostgREST embedding) -> evite 2 aller-retours.
type BaseEmbedRow = BaseRow & { tv: { version_number: number; tpl: { name: string } | null } | null };
const TV_EMBED = 'tv:template_version!current_template_version_id(version_number, tpl:template_id(name))';
const BASE_SELECT = `id, name, specialty, owner_user_id, current_template_version_id, ${TV_EMBED}`;
const ACCESS_COLS = 'access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access';

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


const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeBaseRepository(client: SupabaseClient | null): BaseRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listMyBases: fail, listTemplateModels: fail, createBase: fail, getBase: fail, setTemplateVersion: fail, getInclusionStats: fail, setInclusionTarget: fail, getCompletenessStats: fail };
  }

  async function currentUserId(): Promise<string> {
    // getSession() lit la session LOCALE (pas d'appel reseau) -> bien plus rapide que getUser()
    // qui valide le token cote serveur a CHAQUE appel. La securite reste portee par la RLS.
    const { data, error } = await client!.auth.getSession();
    if (error) throw error;
    const id = data.session?.user?.id;
    if (!id) throw new Error('Non authentifie');
    return id;
  }

  return {
    async listMyBases() {
      const uid = await currentUserId();
      // Bases (+ libelle gabarit JOINT) et acces EN PARALLELE -> 2 aller-retours au lieu de 4.
      const [basesRes, accRes] = await Promise.all([
        client.from('base').select(BASE_SELECT).order('created_at', { ascending: true }),
        client.from('base_access').select(`base_id, ${ACCESS_COLS}`).eq('user_id', uid).is('revoked_at', null),
      ]);
      if (basesRes.error) throw basesRes.error;
      if (accRes.error) throw accRes.error;
      const rows = (basesRes.data ?? []) as unknown as BaseEmbedRow[];
      const accessByBase = new Map(
        (accRes.data ?? []).map((a) => [(a as { base_id: string }).base_id, a as unknown as AccessPermRow]),
      );

      return rows.map((r): BaseListing => {
        const isOwner = r.owner_user_id === uid;
        const acc = accessByBase.get(r.id);
        return {
          base: mapBase(r),
          role: isOwner ? 'owner' : (acc?.access_role ?? 'viewer'),
          permissions: isOwner ? { ...ALL_PERMISSIONS } : permsFromRow(acc),
          templateName: r.tv?.tpl?.name ?? null,
          versionNumber: r.tv?.version_number ?? null,
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
      // Cible UNE base (+ libelle gabarit JOINT) et son acces EN PARALLELE -> 1 aller-retour.
      const uid = await currentUserId();
      const [baseRes, accRes] = await Promise.all([
        client.from('base').select(BASE_SELECT).eq('id', id).maybeSingle(),
        client.from('base_access').select(ACCESS_COLS).eq('base_id', id).eq('user_id', uid).is('revoked_at', null).maybeSingle(),
      ]);
      if (baseRes.error) throw baseRes.error;
      const b = baseRes.data as unknown as BaseEmbedRow | null;
      if (!b) return null;
      if (accRes.error) throw accRes.error;
      const acc = (accRes.data ?? undefined) as AccessPermRow | undefined;
      const isOwner = b.owner_user_id === uid;
      return {
        base: mapBase(b),
        role: isOwner ? 'owner' : (acc?.access_role ?? 'viewer'),
        permissions: isOwner ? { ...ALL_PERMISSIONS } : permsFromRow(acc),
        templateName: b.tv?.tpl?.name ?? null,
        versionNumber: b.tv?.version_number ?? null,
      };
    },

    async setTemplateVersion(baseId, versionId) {
      const { error } = await client.rpc('set_base_template_version', { p_base_id: baseId, p_version_id: versionId });
      if (error) throw error;
    },

    async getInclusionStats(baseId) {
      const { data, error } = await client.rpc('base_inclusion_stats', { p_base_id: baseId });
      if (error) throw error;
      const s = (data ?? {}) as Partial<InclusionStats>;
      return {
        total: s.total ?? 0,
        target: s.target ?? null,
        targetDate: s.targetDate ?? null,
        targetRevision: s.targetRevision ?? 0,
        dateField: s.dateField ?? null,
        monthly: s.monthly ?? [],
      };
    },

    async setInclusionTarget(baseId, target, targetDate, expectedRevision) {
      const { data, error } = await client.rpc('set_base_inclusion_target', {
        p_base_id: baseId,
        p_target: target,
        p_target_date: targetDate,
        p_expected_revision: expectedRevision,
      });
      if (error) throw new Error('WRITE_FAILED');
      requireUpdatedRow(data);
    },

    async getCompletenessStats(baseId, mode = 'historical') {
      const { data, error } = await client.rpc('base_completeness_stats', { p_base_id: baseId, p_mode: mode });
      if (error) throw error;
      return (data ?? []) as CompletenessRow[];
    },
  };
}

export const baseRepository: BaseRepository = makeBaseRepository(supabase);
