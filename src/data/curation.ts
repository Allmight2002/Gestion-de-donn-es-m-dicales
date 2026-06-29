// Couche d'acces au sous-systeme de CURATION (cahier v3.0).
// Workflow : collecte (raw_submission + raw_document, zone restreinte) -> structuration
// (curation_draft par le curateur affecte) -> validation (RPC transactionnelle) ->
// donnees VERIFIEES en zone analytique. Les RPC portent les regles sensibles ; la RLS
// cloisonne les lignes. Les octets des documents bruts vivent dans un bucket prive
// (URL signees temporaires), JAMAIS exportes ni visibles a un compte sans acces identite.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { inspectFile, sha256Hex } from '../domain/imageUpload';
import { signedRead } from './signedRead';

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
  scope: 'patient' | 'encounter'; // donnees permanentes OU une rencontre
  templateVersionId: string | null; // gabarit a remplir (champs lisibles par le staff)
  assignedTo: string | null;
  assignedName: string | null;
  targetPatientId: string | null;
  targetPatientCode: string | null; // null pour le staff (RLS : pas d'acces patient)
  externalRef: string | null;
  // §10 : metadonnees MINIMALES du pool (visibles avant reservation, non sensibles).
  specialty?: string | null;
  documentCount?: number;
  submittedAt?: string | null;
}

export interface RawDocumentItem {
  id: string;
  label: string | null;
  storagePath: string;
  mimeType: string;
}

export interface CurationDraftItem {
  id: string;
  taskId: string;
  patientData: Record<string, unknown>;
  encounters: DraftEncounter[];
  status: string;
}

/** Identite MINIMALE du patient, visible UNIQUEMENT du medecin proprietaire (RLS).
 *  null pour le staff (curateur) qui ne doit jamais voir l'identite. */
export interface MinimalIdentity {
  fullName: string | null;
  dateOfBirth: string | null;
}

/** Echange de clarification (curateur pose une question, medecin repond). */
export interface ClarificationItem {
  id: string;
  question: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  status: string; // 'open' | 'answered'
}

export interface TaskBundle {
  task: CurationTaskItem;
  documents: RawDocumentItem[];
  draft: CurationDraftItem | null;
  patientIdentity: MinimalIdentity | null;
  clarifications: ClarificationItem[];
}

export interface AddRawDocumentInput {
  submissionId: string;
  baseId: string;
  file: File;
  label?: string;
}

export interface CurationRepository {
  /** Pool GLOBAL : toutes les taches visibles par le staff de curation (curateur). */
  listPool(): Promise<CurationTaskItem[]>;
  /** Cas d'une base (suivi cote medecin proprietaire). */
  listBaseSubmissions(baseId: string): Promise<CurationTaskItem[]>;
  getTaskBundle(taskId: string): Promise<TaskBundle | null>;
  /** §11 — URL signee d'un document A LA DEMANDE (au clic) : autorisation + audit ne se
   *  declenchent que pour une VRAIE ouverture, pas au chargement de la liste. null si indisponible. */
  documentUrl(id: string, storagePath: string): Promise<string | null>;
  /** Le medecin soumet un cas au pool (RPC atomique : soumission + tache ouverte + code).
   *  scope='patient' (donnees permanentes) ou 'encounter' (une rencontre). */
  createSubmission(baseId: string, targetPatientId: string, externalRef: string | null, scope?: 'patient' | 'encounter'): Promise<{ taskId: string; submissionId: string }>;
  /** Le medecin proprietaire ENVOIE la demande au pool (exige >= 1 document). */
  submitRequest(taskId: string): Promise<void>;
  /** Le medecin proprietaire SUPPRIME (logique) une demande ; deletePatient=true supprime
   *  AUSSI le patient cible (cascade). Bloquee si la demande est deja validee. */
  deleteRequest(taskId: string, reason: string, deletePatient: boolean): Promise<void>;
  /** Un curateur RESERVE un cas ouvert (anti-collision). */
  claimTask(taskId: string): Promise<void>;
  /** Le curateur affecte libere un cas. */
  releaseTask(taskId: string): Promise<void>;
  addRawDocument(input: AddRawDocumentInput): Promise<{ id: string }>;
  /** Renvoie le brouillon de la tache, en le creant s'il n'existe pas encore. */
  ensureDraft(taskId: string, baseId: string): Promise<CurationDraftItem>;
  saveDraft(draftId: string, patientData: Record<string, unknown>, encounters: DraftEncounter[]): Promise<void>;
  /** Le curateur affecte (ou le proprietaire) FINALISE la curation -> donnees curees. */
  finalizeTask(taskId: string): Promise<void>;
  /** Le curateur affecte DEMANDE une clarification au medecin (tache -> clarification_requested). */
  requestClarification(taskId: string, question: string): Promise<void>;
  /** Le medecin proprietaire REPOND a une clarification (tache -> in_progress). */
  answerClarification(clarificationId: string, answer: string): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type AssigneeRel = { full_name: string | null } | null;
type PatientRel = { patient_code: string } | null;
type SubmissionRel = { case_code: string; scope: 'patient' | 'encounter'; template_version_id: string | null; external_ref: string | null; status: string; target_patient_id: string; patient: PatientRel } | null;
type TaskRow = {
  id: string; base_id: string; status: string; submission_id: string; assigned_to: string | null;
  assignee: AssigneeRel; raw_submission: SubmissionRel;
};
type DraftRow = { id: string; task_id: string; patient_data: Record<string, unknown>; encounters: DraftEncounter[]; status: string };
// Ligne du pool minimal (RPC curation_pool) : aucune metadonnee sensible.
type PoolRow = {
  task_id: string; status: string; case_code: string | null; scope: 'patient' | 'encounter';
  specialty: string | null; submitted_at: string | null; document_count: number;
  assigned_to: string | null; assigned_name: string | null;
};

const TASK_SELECT =
  'id, base_id, status, submission_id, assigned_to, assignee:assigned_to(full_name), ' +
  'raw_submission:submission_id(case_code, scope, template_version_id, external_ref, status, target_patient_id, patient:target_patient_id(patient_code))';

const mapTask = (r: TaskRow): CurationTaskItem => ({
  id: r.id,
  baseId: r.base_id,
  submissionId: r.submission_id,
  status: r.status,
  caseCode: r.raw_submission?.case_code ?? null,
  scope: r.raw_submission?.scope ?? 'patient',
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
      listPool: fail, listBaseSubmissions: fail, getTaskBundle: fail, documentUrl: fail, createSubmission: fail,
      submitRequest: fail, deleteRequest: fail, claimTask: fail, releaseTask: fail, addRawDocument: fail,
      ensureDraft: fail, saveDraft: fail, finalizeTask: fail, requestClarification: fail, answerClarification: fail,
    };
  }

  return {
    async listPool() {
      // §10 : le pool passe par une RPC MINIMALE (aucune metadonnee sensible avant reservation).
      // L'acces complet a curation_task / raw_submission est reserve au curateur AFFECTE.
      const { data, error } = await client.rpc('curation_pool');
      if (error) throw error;
      return ((data ?? []) as PoolRow[]).map((r) => ({
        id: r.task_id,
        baseId: '',
        submissionId: '',
        status: r.status,
        caseCode: r.case_code,
        scope: r.scope ?? 'patient',
        templateVersionId: null,
        assignedTo: r.assigned_to,
        assignedName: r.assigned_name,
        targetPatientId: null,
        targetPatientCode: null,
        externalRef: null,
        specialty: r.specialty,
        documentCount: r.document_count,
        submittedAt: r.submitted_at,
      }));
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

      // §11 : la liste des documents ne genere AUCUNE URL signee (donc aucun audit) ; l'URL est
      // demandee a l'ouverture d'un document (documentUrl) -> l'audit correspond a une vraie consultation.
      const { data: docs, error: e2 } = await client
        .from('raw_document')
        .select('id, label, storage_path, mime_type')
        .eq('submission_id', task.submissionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (e2) throw e2;
      const documents = ((docs ?? []) as { id: string; label: string | null; storage_path: string; mime_type: string }[])
        .map((d) => ({ id: d.id, label: d.label, storagePath: d.storage_path, mimeType: d.mime_type }));

      const { data: draftRow, error: e3 } = await client
        .from('curation_draft')
        .select('id, task_id, patient_data, encounters, status')
        .eq('task_id', taskId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e3) throw e3;

      // Identite minimale : tentee a chaque fois, mais la RLS ne la renvoie QU'au medecin
      // proprietaire (le staff n'a pas de patient_code et aucun acces a patient_identity).
      let patientIdentity: MinimalIdentity | null = null;
      if (task.targetPatientCode) {
        const { data: idRow } = await client
          .from('patient_identity')
          .select('full_name, date_of_birth')
          .eq('base_id', task.baseId)
          .eq('patient_code', task.targetPatientCode)
          .is('deleted_at', null)
          .maybeSingle();
        if (idRow) patientIdentity = { fullName: (idRow as { full_name: string | null }).full_name, dateOfBirth: (idRow as { date_of_birth: string | null }).date_of_birth };
      }

      const { data: clarRows, error: e5 } = await client
        .from('curation_clarification')
        .select('id, question, asked_at, answer, answered_at, status')
        .eq('task_id', taskId)
        .order('asked_at', { ascending: true });
      if (e5) throw e5;
      const clarifications = ((clarRows ?? []) as { id: string; question: string; asked_at: string; answer: string | null; answered_at: string | null; status: string }[]).map((r) => ({
        id: r.id, question: r.question, askedAt: r.asked_at, answer: r.answer, answeredAt: r.answered_at, status: r.status,
      }));

      return {
        task,
        documents,
        draft: draftRow ? mapDraft(draftRow as DraftRow) : null,
        patientIdentity,
        clarifications,
      };
    },

    async documentUrl(id, storagePath) {
      return signedRead(client, 'raw_document', id, RAW_DOCUMENTS_BUCKET, storagePath, SIGNED_URL_TTL);
    },

    async createSubmission(baseId, targetPatientId, externalRef, scope = 'patient') {
      const { data, error } = await client.rpc('create_curation_submission', {
        p_base_id: baseId, p_target_patient_id: targetPatientId, p_external_ref: externalRef, p_scope: scope,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; submission_id: string };
      return { taskId: row.id, submissionId: row.submission_id };
    },

    async submitRequest(taskId) {
      const { error } = await client.rpc('submit_curation_request', { p_task_id: taskId });
      if (error) throw error;
    },

    async deleteRequest(taskId, reason, deletePatient) {
      const { error } = await client.rpc('delete_curation_request', { p_task_id: taskId, p_reason: reason, p_delete_patient: deletePatient });
      if (error) throw error;
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
      // Inspection par magic bytes (§5.3) : on refuse un fichier deguise et on enregistre
      // le type REEL detecte + l'empreinte, plutot que de faire confiance au navigateur.
      const v = await inspectFile(input.file);
      if (!v.ok) throw new Error(v.error);
      const path = `${input.baseId}/${input.submissionId}/${crypto.randomUUID()}.${v.ext}`;
      const { error: upErr } = await client.storage.from(RAW_DOCUMENTS_BUCKET).upload(path, input.file, {
        contentType: v.type,
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data, error } = await client
        .from('raw_document')
        .insert({
          submission_id: input.submissionId, base_id: input.baseId, label: input.label ?? null,
          storage_path: path, mime_type: v.type, detected_mime_type: v.type,
          file_size: input.file.size, file_hash: await sha256Hex(input.file),
          inspection_status: 'accepted_client', inspected_at: new Date().toISOString(),
        })
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

    async finalizeTask(taskId) {
      const { error } = await client.rpc('finalize_curation_task', { p_task_id: taskId });
      if (error) throw error;
    },

    async requestClarification(taskId, question) {
      const { error } = await client.rpc('request_clarification', { p_task_id: taskId, p_question: question });
      if (error) throw error;
    },

    async answerClarification(clarificationId, answer) {
      const { error } = await client.rpc('answer_clarification', { p_clarification_id: clarificationId, p_answer: answer });
      if (error) throw error;
    },
  };
}

export const curationRepository: CurationRepository = makeCurationRepository(supabase);
