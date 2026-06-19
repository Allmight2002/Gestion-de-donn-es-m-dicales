// Couche d'acces au sous-systeme de CURATION (cahier v3.0).
// Workflow : collecte (raw_submission + raw_document, zone restreinte) -> structuration
// (curation_draft par le curateur affecte) -> validation (RPC transactionnelle) ->
// donnees VERIFIEES en zone analytique. Les RPC portent les regles sensibles ; la RLS
// cloisonne les lignes. Les octets des documents bruts vivent dans un bucket prive
// (URL signees temporaires), JAMAIS exportes ni visibles a l'analyste.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const RAW_DOCUMENTS_BUCKET = 'raw-documents';
const SIGNED_URL_TTL = 60 * 10; // 10 min

export interface DraftEncounter {
  encounter_type: string;
  encounter_date: string;
  age_unit: string;
  data: Record<string, unknown>;
}

export interface CurationTaskItem {
  id: string;
  baseId: string;
  submissionId: string;
  status: string;
  caseCode: string | null; // code OPAQUE (ce que voit le staff) — jamais le patient_code
  templateVersionId: string | null; // gabarit a remplir (champs lisibles par le staff)
  assignedTo: string | null;
  assignedName: string | null;
  targetPatientId: string | null;
  targetPatientCode: string | null; // null pour le staff (RLS : pas d'acces patient)
  externalRef: string | null;
}

export interface RawDocumentItem {
  id: string;
  label: string | null;
  storagePath: string;
  mimeType: string;
  signedUrl: string | null;
}

export interface CurationDraftItem {
  id: string;
  taskId: string;
  patientData: Record<string, unknown>;
  encounters: DraftEncounter[];
  status: string;
}

export interface CurationReviewItem {
  id: string;
  decision: string;
  comment: string | null;
  createdAt: string;
}

export interface TaskBundle {
  task: CurationTaskItem;
  documents: RawDocumentItem[];
  draft: CurationDraftItem | null;
  reviews: CurationReviewItem[];
}

export interface AddRawDocumentInput {
  submissionId: string;
  baseId: string;
  file: File;
  label?: string;
}

export interface CurationRepository {
  /** Pool GLOBAL : toutes les taches visibles par le staff (curateur/validateur). */
  listPool(): Promise<CurationTaskItem[]>;
  /** Cas d'une base (suivi cote medecin proprietaire). */
  listBaseSubmissions(baseId: string): Promise<CurationTaskItem[]>;
  getTaskBundle(taskId: string): Promise<TaskBundle | null>;
  /** Le medecin soumet un cas au pool (RPC atomique : soumission + tache ouverte + code). */
  createSubmission(baseId: string, targetPatientId: string, externalRef: string | null): Promise<{ taskId: string; submissionId: string }>;
  /** Un curateur RESERVE un cas ouvert (anti-collision). */
  claimTask(taskId: string): Promise<void>;
  /** Le curateur affecte libere un cas. */
  releaseTask(taskId: string): Promise<void>;
  addRawDocument(input: AddRawDocumentInput): Promise<{ id: string }>;
  /** Renvoie le brouillon de la tache, en le creant s'il n'existe pas encore. */
  ensureDraft(taskId: string, baseId: string): Promise<CurationDraftItem>;
  saveDraft(draftId: string, patientData: Record<string, unknown>, encounters: DraftEncounter[]): Promise<void>;
  submitDraft(draftId: string): Promise<void>;
  validateDraft(draftId: string, decision: 'approved' | 'rejected', comment: string | null): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type AssigneeRel = { full_name: string | null } | null;
type PatientRel = { patient_code: string } | null;
type SubmissionRel = { case_code: string; template_version_id: string | null; external_ref: string | null; status: string; target_patient_id: string; patient: PatientRel } | null;
type TaskRow = {
  id: string; base_id: string; status: string; submission_id: string; assigned_to: string | null;
  assignee: AssigneeRel; raw_submission: SubmissionRel;
};
type DraftRow = { id: string; task_id: string; patient_data: Record<string, unknown>; encounters: DraftEncounter[]; status: string };

const TASK_SELECT =
  'id, base_id, status, submission_id, assigned_to, assignee:assigned_to(full_name), ' +
  'raw_submission:submission_id(case_code, template_version_id, external_ref, status, target_patient_id, patient:target_patient_id(patient_code))';

const mapTask = (r: TaskRow): CurationTaskItem => ({
  id: r.id,
  baseId: r.base_id,
  submissionId: r.submission_id,
  status: r.status,
  caseCode: r.raw_submission?.case_code ?? null,
  templateVersionId: r.raw_submission?.template_version_id ?? null,
  assignedTo: r.assigned_to,
  assignedName: r.assignee?.full_name ?? null,
  targetPatientId: r.raw_submission?.target_patient_id ?? null,
  targetPatientCode: r.raw_submission?.patient?.patient_code ?? null,
  externalRef: r.raw_submission?.external_ref ?? null,
});
const mapDraft = (r: DraftRow): CurationDraftItem => ({
  id: r.id, taskId: r.task_id, patientData: r.patient_data ?? {}, encounters: r.encounters ?? [], status: r.status,
});

export function makeCurationRepository(client: SupabaseClient | null): CurationRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listPool: fail, listBaseSubmissions: fail, getTaskBundle: fail, createSubmission: fail,
      claimTask: fail, releaseTask: fail, addRawDocument: fail,
      ensureDraft: fail, saveDraft: fail, submitDraft: fail, validateDraft: fail,
    };
  }

  return {
    async listPool() {
      // La RLS ne renvoie que les taches visibles : pour le staff = tout le pool.
      const { data, error } = await client
        .from('curation_task')
        .select(TASK_SELECT)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as TaskRow[]).map(mapTask);
    },

    async listBaseSubmissions(baseId) {
      const { data, error } = await client
        .from('curation_task')
        .select(TASK_SELECT)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as TaskRow[]).map(mapTask);
    },

    async getTaskBundle(taskId) {
      const { data: t, error } = await client.from('curation_task').select(TASK_SELECT).eq('id', taskId).maybeSingle();
      if (error) throw error;
      if (!t) return null;
      const task = mapTask(t as unknown as TaskRow);

      const { data: docs, error: e2 } = await client
        .from('raw_document')
        .select('id, label, storage_path, mime_type')
        .eq('submission_id', task.submissionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (e2) throw e2;
      const documents = await Promise.all(
        ((docs ?? []) as { id: string; label: string | null; storage_path: string; mime_type: string }[]).map(async (d) => {
          const { data: signed } = await client.storage.from(RAW_DOCUMENTS_BUCKET).createSignedUrl(d.storage_path, SIGNED_URL_TTL);
          return { id: d.id, label: d.label, storagePath: d.storage_path, mimeType: d.mime_type, signedUrl: signed?.signedUrl ?? null };
        }),
      );

      const { data: draftRow, error: e3 } = await client
        .from('curation_draft')
        .select('id, task_id, patient_data, encounters, status')
        .eq('task_id', taskId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e3) throw e3;

      const { data: reviews, error: e4 } = await client
        .from('curation_review')
        .select('id, decision, comment, created_at')
        .order('created_at', { ascending: false });
      if (e4) throw e4;

      return {
        task,
        documents,
        draft: draftRow ? mapDraft(draftRow as DraftRow) : null,
        reviews: ((reviews ?? []) as { id: string; decision: string; comment: string | null; created_at: string }[]).map((r) => ({
          id: r.id, decision: r.decision, comment: r.comment, createdAt: r.created_at,
        })),
      };
    },

    async createSubmission(baseId, targetPatientId, externalRef) {
      const { data, error } = await client.rpc('create_curation_submission', {
        p_base_id: baseId, p_target_patient_id: targetPatientId, p_external_ref: externalRef,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; submission_id: string };
      return { taskId: row.id, submissionId: row.submission_id };
    },

    async claimTask(taskId) {
      const { error } = await client.rpc('claim_curation_task', { p_task_id: taskId });
      if (error) throw error;
    },

    async releaseTask(taskId) {
      const { error } = await client.rpc('release_curation_task', { p_task_id: taskId });
      if (error) throw error;
    },

    async addRawDocument(input) {
      const ext = input.file.name.split('.').pop()?.toLowerCase() || 'bin';
      const path = `${input.baseId}/${input.submissionId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await client.storage.from(RAW_DOCUMENTS_BUCKET).upload(path, input.file, {
        contentType: input.file.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data, error } = await client
        .from('raw_document')
        .insert({ submission_id: input.submissionId, base_id: input.baseId, label: input.label ?? null, storage_path: path, mime_type: input.file.type || 'application/octet-stream' })
        .select('id')
        .single();
      if (error) {
        await client.storage.from(RAW_DOCUMENTS_BUCKET).remove([path]);
        throw error;
      }
      return { id: (data as { id: string }).id };
    },

    async ensureDraft(taskId, baseId) {
      const { data: existing, error } = await client
        .from('curation_draft')
        .select('id, task_id, patient_data, encounters, status')
        .eq('task_id', taskId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (existing) return mapDraft(existing as DraftRow);
      const { data, error: e2 } = await client
        .from('curation_draft')
        .insert({ task_id: taskId, base_id: baseId })
        .select('id, task_id, patient_data, encounters, status')
        .single();
      if (e2) throw e2;
      return mapDraft(data as DraftRow);
    },

    async saveDraft(draftId, patientData, encounters) {
      const { error } = await client
        .from('curation_draft')
        .update({ patient_data: patientData, encounters })
        .eq('id', draftId);
      if (error) throw error;
    },

    async submitDraft(draftId) {
      const { error } = await client.rpc('submit_curation_draft', { p_draft_id: draftId });
      if (error) throw error;
    },

    async validateDraft(draftId, decision, comment) {
      const { error } = await client.rpc('validate_curation_draft', { p_draft_id: draftId, p_decision: decision, p_comment: comment });
      if (error) throw error;
    },
  };
}

export const curationRepository: CurationRepository = makeCurationRepository(supabase);
