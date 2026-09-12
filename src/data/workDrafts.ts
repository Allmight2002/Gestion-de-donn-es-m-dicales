import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type WorkDraftKind = 'patient_create' | 'patient_update' | 'encounter_create' | 'encounter_update';
export interface WorkDraftContext {
  baseId: string;
  kind: WorkDraftKind;
  targetId: string | null;
  templateVersionId: string;
  /** Patient row_version or encounter updated_at as integer epoch milliseconds. */
  entityRevision: string | null;
}
export interface WorkDraftPayload {
  values: Record<string, unknown>;
  code?: string;
  encounterType?: string;
  encounterDate?: string;
  status?: string;
  ageUnit?: string;
  reason?: string;
}
export interface WorkDraftReceipt {
  id: string;
  revision: number;
  updatedAt: string;
  expiresAt: string;
}
export interface WorkDraft extends WorkDraftReceipt {
  context: WorkDraftContext;
  payload: WorkDraftPayload;
  state: 'active' | 'consumed';
  result?: WorkDraftCommitReceipt | null;
}
export interface WorkDraftIdentity {
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  externalIdentifier: string | null;
}
export interface WorkDraftCommitReceipt { id: string; code?: string; version?: number; updatedAt?: string }
export interface WorkDraftRepository {
  readonly available: boolean;
  list(context: Pick<WorkDraftContext, 'baseId' | 'kind' | 'targetId'>): Promise<WorkDraft[]>;
  save(context: WorkDraftContext, id: string, expectedRevision: number, operationId: string, payload: WorkDraftPayload): Promise<WorkDraftReceipt>;
  discard(id: string, expectedRevision: number, operationId: string): Promise<void>;
  commit(id: string, expectedRevision: number, operationId: string, identity?: WorkDraftIdentity): Promise<WorkDraftCommitReceipt>;
}

export const WORK_DRAFT_MAX_BYTES = 256 * 1024;
export const WORK_DRAFT_DEBOUNCE_MS = 750;
export const WORK_DRAFT_MAX_WAIT_MS = 5_000;

const DRAFT_MESSAGES: Record<string, string> = {
  DRAFT_FORBIDDEN: 'Vos droits ne permettent plus de reprendre ou sauvegarder ce brouillon.',
  DRAFT_CONFLICT: 'Ce brouillon a été modifié dans un autre onglet ou appareil. Votre saisie est conservée ; choisissez explicitement la version à reprendre.',
  DRAFT_CONTEXT_CHANGED: 'La fiche ou le modèle a changé. Votre saisie est conservée ; une résolution du conflit est nécessaire.',
  DRAFT_OPERATION_CONFLICT: 'Cette opération correspond à une autre saisie. Votre saisie actuelle est conservée.',
  DRAFT_CLOSED: 'Ce brouillon a expiré, a été supprimé ou a déjà été enregistré. Votre saisie actuelle est conservée.',
  DRAFT_QUOTA: 'La limite de 50 brouillons est atteinte. Reprenez ou supprimez un brouillon avant de recommencer.',
  DRAFT_INVALID: 'Le brouillon dépasse la taille autorisée ou contient une valeur non prise en charge. Votre saisie est conservée.',
  DRAFT_VALIDATION: 'La fiche n’a pas pu être enregistrée. Vérifiez les réponses et les droits ; votre brouillon est conservé.',
  DRAFT_UNAVAILABLE: 'Les brouillons serveur sont indisponibles. Les dernières modifications ne sont pas protégées sur le serveur.',
};

export class WorkDraftError extends Error {
  constructor(readonly code: string, support: 'local' | 'server' = 'server') {
    super(code === 'DRAFT_UNAVAILABLE' && support === 'local'
      ? 'Le stockage sur cet appareil est indisponible. Les dernières modifications ne sont pas protégées.'
      : DRAFT_MESSAGES[code] ?? DRAFT_MESSAGES.DRAFT_UNAVAILABLE);
    this.name = 'WorkDraftError';
  }
}

function safeDraftError(error: unknown): WorkDraftError {
  if (error instanceof WorkDraftError) return error;
  const message = error && typeof error === 'object' ? String((error as { message?: unknown }).message ?? '') : '';
  const code = Object.keys(DRAFT_MESSAGES).find((candidate) => message === candidate);
  return new WorkDraftError(code ?? 'DRAFT_UNAVAILABLE');
}

export function createWorkDraftRepository(client: SupabaseClient | null): WorkDraftRepository {
  async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
    if (!client) throw new WorkDraftError('DRAFT_UNAVAILABLE');
    try {
      const { data, error } = await client.rpc(name, params);
      if (error) throw error;
      if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
        throw new WorkDraftError(data.error);
      }
      return data as T;
    } catch (error) {
      throw safeDraftError(error);
    }
  }
  const receipt = (row: { id: string; revision: number; updated_at: string; expires_at: string }): WorkDraftReceipt => ({
    id: row.id, revision: Number(row.revision), updatedAt: row.updated_at, expiresAt: row.expires_at,
  });
  return {
    available: client !== null,
    async list(context) {
      const rows = await rpc<Array<{
        id: string; revision: number; updated_at: string; expires_at: string;
        base_id: string; kind: WorkDraftKind; target_id: string | null; template_version_id: string;
        entity_revision: string | null; payload: WorkDraftPayload; state: 'active' | 'consumed'; result?: WorkDraftCommitReceipt | null;
      }>>('list_work_drafts', { p_base_id: context.baseId, p_kind: context.kind, p_target_id: context.targetId });
      return rows.map((row) => ({
        ...receipt(row), payload: row.state === 'consumed' ? { values: {} } : row.payload, state: row.state, result: row.result,
        context: { baseId: row.base_id, kind: row.kind, targetId: row.target_id,
          templateVersionId: row.template_version_id, entityRevision: row.entity_revision },
      }));
    },
    async save(context, id, expectedRevision, operationId, payload) {
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > WORK_DRAFT_MAX_BYTES) throw new WorkDraftError('DRAFT_INVALID');
      return receipt(await rpc('save_work_draft', {
        p_id: id, p_base_id: context.baseId, p_kind: context.kind, p_target_id: context.targetId,
        p_template_version_id: context.templateVersionId, p_entity_revision: context.entityRevision,
        p_expected_revision: expectedRevision, p_operation_id: operationId, p_payload: payload,
      }));
    },
    async discard(id, expectedRevision, operationId) {
      await rpc('delete_work_draft', { p_id: id, p_expected_revision: expectedRevision, p_operation_id: operationId });
    },
    async commit(id, expectedRevision, operationId, identity) {
      return rpc('commit_work_draft', { p_id: id, p_expected_revision: expectedRevision,
        p_operation_id: operationId, p_identity: identity ?? null });
    },
  };
}

export const workDraftRepository = createWorkDraftRepository(supabase);
