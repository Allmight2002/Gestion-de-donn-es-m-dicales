// Couche d'acces aux donnees "bases" (cahier §8.3 tableau de bord medecin).
// La RLS renvoie deja les bases possedees + partagees ; ici on enrichit avec le
// role effectif de l'utilisateur et le gabarit courant.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AccessRole, BasePermissions } from './access';
import { requireUpdatedRow } from '../lib/guardedWrite';

export type BaseRole = 'owner' | AccessRole;
export type ObservationModel = 'cross_sectional' | 'longitudinal' | 'event_registry';

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
  /** Absent seulement dans d'anciens instantanes hors-ligne ; la base reste longitudinale par defaut. */
  observationModel?: ObservationModel;
}

export interface BaseListing {
  base: Base;
  role: BaseRole;
  permissions: BasePermissions;
  templateName: string | null;
  versionNumber: number | null;
  /**
   * Echeance de l'acces (compte de mission). `null`/absent = acces permanent.
   * Facultatif pour rester compatible avec les instantanes deja construits ailleurs ;
   * l'absence n'affecte que l'affichage du bandeau — la base reste seule juge de l'acces.
   */
  expiresAt?: string | null;
  /** Creer sans pouvoir corriger une saisie soumise (compte de mission). */
  canCreateStructuredData?: boolean;
  /** Utilisateur courant, utile aux gardes d'affichage qui comparent l'auteur d'un brouillon. */
  currentUserId?: string;
}

/** Metadonnees minimales exposees dans la corbeille du seul proprietaire. */
export interface DeletedBase {
  id: string;
  name: string;
  deletedAt: string;
  deletionReason: string;
  purgeEligibleAt: string;
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

/** L12 : occurrence non vide d'une proposition hors liste, avec sa fiche source. */
export interface BaseProposal {
  fieldKey: string;
  label: string;
  scope: 'patient' | 'encounter';
  proposalValue: string;
  patientId: string;
  patientCode: string;
  encounterId: string | null;
  encounterType: string | null;
  encounterDate: string | null;
  variableTotal: number;
}

export interface BaseProposalPage {
  items: BaseProposal[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * L30 — apercu de la conversion des valeurs orphelines d'une liste.
 *
 * Une valeur orpheline est la sequelle d'un renommage anterieur au lot : la fiche porte
 * une chaine qui ne figure plus dans la liste. `mappings` dit ce qui SERA fait,
 * `blockingValues` ce qui ne peut pas l'etre -- et qui bloque sa fiche entiere.
 */
export interface OptionKeyRepairPreview {
  records: { repairable: number; blocked: number };
  fields: {
    entity: 'patient' | 'encounter';
    fieldKey: string;
    label: string;
    repairableRecords: number;
    blockedRecords: number;
    mappings: { from: string; to: string; occurrences: number }[];
    blockingValues: { value: string; occurrences: number }[];
  }[];
}

export interface OptionKeyRepairResult {
  repairedRecords: number;
  repairedFields: number;
  blockedRecords: number;
  skippedRecords: number;
  failedRecords: number;
}

export interface BaseRepository {
  listMyBases(): Promise<BaseListing[]>;
  listDeletedBases(): Promise<DeletedBase[]>;
  /** Modeles proposes au medecin : officiels (global) + ses propres gabarits (personal). */
  listTemplateModels(): Promise<PublishedTemplateOption[]>;
  /** Cree une base en COPIANT un modele source en gabarit personnel editable. */
  createBase(name: string, specialty: string | null, sourceVersionId: string, observationModel?: ObservationModel): Promise<Base>;
  getBase(id: string): Promise<BaseListing | null>;
  /** Commandes de cycle de vie executees et autorisees exclusivement par la base. */
  softDeleteBase(baseId: string, reason: string): Promise<void>;
  restoreDeletedBase(baseId: string): Promise<void>;
  /** Rattache la base a une (nouvelle) version de son gabarit. Reserve au proprietaire (RLS). */
  setTemplateVersion(baseId: string, versionId: string): Promise<void>;
  /** Le serveur refuse tout changement des qu'une donnee existe dans la base. */
  setObservationModel(baseId: string, observationModel: ObservationModel): Promise<Base>;
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
  /** L12 : propositions de valeurs hors liste. RPC paginee reservee au proprietaire de la base. */
  getBaseProposalsPage(baseId: string, limit: number, offset: number): Promise<BaseProposalPage>;
  /** L30 : apercu EN LECTURE SEULE de la conversion des options de liste. N'ecrit rien. */
  previewOptionKeyRepair(baseId: string): Promise<OptionKeyRepairPreview>;
  /** L30 : conversion opt-in. Le serveur refuse d'agir sans confirmation explicite. */
  repairOptionKeys(baseId: string): Promise<OptionKeyRepairResult>;
}

type BaseRow = {
  id: string; name: string; specialty: string | null; owner_user_id: string;
  current_template_version_id: string | null;
  observation_model: ObservationModel;
};
const mapBase = (r: BaseRow): Base => ({
  id: r.id, name: r.name, specialty: r.specialty, ownerUserId: r.owner_user_id,
  currentTemplateVersionId: r.current_template_version_id, observationModel: r.observation_model,
});
// Base + libelle de gabarit JOINT en une requete (PostgREST embedding) -> evite 2 aller-retours.
type BaseEmbedRow = BaseRow & { tv: { version_number: number; tpl: { name: string } | null } | null };
const TV_EMBED = 'tv:template_version!current_template_version_id(version_number, tpl:template_id(name))';
const BASE_SELECT = `id, name, specialty, owner_user_id, current_template_version_id, observation_model, ${TV_EMBED}`;
const ACCESS_COLS = 'access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access, can_create_structured_data, expires_at';

type AccessPermRow = {
  access_role: AccessRole; can_view_identity: boolean; can_view_raw_documents: boolean;
  can_edit_structured_data: boolean; can_export_data: boolean; can_manage_access: boolean;
  can_create_structured_data?: boolean; expires_at?: string | null;
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
    return {
      listMyBases: fail, listDeletedBases: fail, listTemplateModels: fail, createBase: fail, getBase: fail,
      softDeleteBase: fail, restoreDeletedBase: fail, setTemplateVersion: fail, getInclusionStats: fail,
      setInclusionTarget: fail, getCompletenessStats: fail, setObservationModel: fail,
      getBaseProposalsPage: fail,
      previewOptionKeyRepair: fail,
      repairOptionKeys: fail,
    };
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
          expiresAt: isOwner ? null : (acc?.expires_at ?? null),
          canCreateStructuredData: isOwner || acc?.can_create_structured_data === true,
          currentUserId: uid,
        };
      });
    },

    async listDeletedBases() {
      const { data, error } = await client.rpc('list_deleted_bases');
      if (error) throw error;
      return ((data ?? []) as {
        id: string; name: string; deleted_at: string; deletion_reason: string; purge_eligible_at: string;
      }[]).map((row) => ({
        id: row.id,
        name: row.name,
        deletedAt: row.deleted_at,
        deletionReason: row.deletion_reason,
        purgeEligibleAt: row.purge_eligible_at,
      }));
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

    async createBase(name, specialty, sourceVersionId, observationModel = 'longitudinal') {
      const { data, error } = await client.rpc('create_base_from_model_observation', {
        p_name: name,
        p_specialty: specialty ?? '',
        p_source_version_id: sourceVersionId,
        p_observation_model: observationModel,
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
        expiresAt: isOwner ? null : (acc?.expires_at ?? null),
        canCreateStructuredData: isOwner || acc?.can_create_structured_data === true,
        currentUserId: uid,
      };
    },

    async softDeleteBase(baseId, reason) {
      const { error } = await client.rpc('soft_delete_base', { p_base_id: baseId, p_reason: reason });
      if (error) throw error;
    },

    async restoreDeletedBase(baseId) {
      const { error } = await client.rpc('restore_deleted_base', { p_base_id: baseId });
      if (error) throw error;
    },

    async setTemplateVersion(baseId, versionId) {
      const { error } = await client.rpc('set_base_template_version', { p_base_id: baseId, p_version_id: versionId });
      if (error) throw error;
    },

    async setObservationModel(baseId, observationModel) {
      const { data, error } = await client.rpc('set_base_observation_model', {
        p_base_id: baseId,
        p_observation_model: observationModel,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as BaseRow;
      return mapBase(row);
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

    async getBaseProposalsPage(baseId, limit, offset) {
      const { data, error } = await client.rpc('base_proposals', {
        p_base_id: baseId,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      const page = (data ?? {}) as Partial<BaseProposalPage>;
      return {
        items: page.items ?? [],
        total: page.total ?? 0,
        limit: page.limit ?? limit,
        offset: page.offset ?? offset,
        hasMore: page.hasMore ?? false,
      };
    },

    async previewOptionKeyRepair(baseId) {
      const { data, error } = await client.rpc('preview_option_key_repair', { p_base_id: baseId });
      if (error) throw error;
      const preview = (data ?? {}) as Partial<OptionKeyRepairPreview>;
      return {
        records: preview.records ?? { repairable: 0, blocked: 0 },
        fields: preview.fields ?? [],
      };
    },

    async repairOptionKeys(baseId) {
      // La confirmation est portee par l'appel : le serveur refuse toute execution sans
      // elle, et l'interface ne l'envoie qu'apres avoir montre l'apercu.
      const { data, error } = await client.rpc('repair_option_keys', {
        p_base_id: baseId,
        p_confirm: true,
      });
      if (error) throw error;
      const result = (data ?? {}) as Partial<OptionKeyRepairResult>;
      return {
        repairedRecords: result.repairedRecords ?? 0,
        repairedFields: result.repairedFields ?? 0,
        blockedRecords: result.blockedRecords ?? 0,
        skippedRecords: result.skippedRecords ?? 0,
        failedRecords: result.failedRecords ?? 0,
      };
    },
  };
}

export const baseRepository: BaseRepository = makeBaseRepository(supabase);
