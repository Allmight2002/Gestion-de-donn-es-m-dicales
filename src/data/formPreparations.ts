import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type FormPreparationState = 'active' | 'ready' | 'applied' | 'discarded' | 'conflict' | 'expired';
export type FormPreparationClassification = 'additive' | 'additive_required' | 'semantic' | 'unsupported';

export interface FormDefinition {
  sections: Array<Record<string, unknown>>;
  commonGroups: Array<Record<string, unknown>>;
  fields: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  diagnosisConfiguration: unknown;
  provenance?: Record<string, unknown>;
}

export type FormPreparationPayload = FormDefinition;

export interface FormPreparation {
  id: string;
  baseId: string;
  sourceTemplateVersionId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  preparationRevision: number;
  contentFingerprint: string;
  classification: FormPreparationClassification;
  state: FormPreparationState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  payload: FormPreparationPayload;
}

export interface FormPreparationContext {
  baseId: string;
  sourceTemplateVersionId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  definition: FormDefinition;
}

export interface FormPreparationOpenResult {
  preparation: FormPreparation | null;
  context: FormPreparationContext;
  persisted: boolean;
}

export interface FormPreparationReceipt {
  preparation: FormPreparation;
  operationId: string;
  operationKind: 'save' | 'preview' | 'resume' | 'discard' | 'apply';
  audit: {
    sourceRevision: number;
    sourceFingerprint: string;
    contentFingerprint: string;
    preparationRevision: number;
    state: FormPreparationState;
    classification: FormPreparationClassification;
  };
  impact?: Record<string, unknown>;
  application?: Record<string, unknown>;
}

export interface FormPreparationMutation {
  preparationId: string;
  expectedPreparationRevision: number;
  operationId: string;
}

export interface FormPreparationSave extends FormPreparationMutation {
  baseId: string;
  expectedSourceRevision: number;
  expectedSourceFingerprint: string;
  payload: FormPreparationPayload;
}

export interface FormPreparationPreview extends FormPreparationMutation {
  expectedSourceRevision: number;
  expectedSourceFingerprint: string;
}

export interface FormPreparationDiscard extends FormPreparationMutation {
  expectedSourceRevision: number;
  expectedSourceFingerprint: string;
}

export interface FormPreparationApply extends FormPreparationMutation {
  expectedSourceRevision: number;
  expectedSourceFingerprint: string;
}

export interface FormPreparationErrorReceipt {
  code: string;
  error: string;
  preparationId?: string;
  operationId?: string;
  retryable?: boolean;
  classification?: FormPreparationClassification;
  reason?: string;
  payloadPreserved?: boolean;
  impact?: Record<string, unknown>;
  application?: Record<string, unknown>;
  currentSourceTemplateVersionId?: string;
  currentSourceRevision?: number;
  currentSourceFingerprint?: string;
  currentPreparationRevision?: number;
}

export interface FormPreparationRepository {
  readonly available: boolean;
  openOrResume(baseId: string): Promise<FormPreparationOpenResult>;
  read(preparationId: string): Promise<FormPreparation>;
  save(input: FormPreparationSave): Promise<FormPreparationReceipt>;
  preview(input: FormPreparationPreview): Promise<FormPreparationReceipt>;
  apply(input: FormPreparationApply): Promise<FormPreparationReceipt>;
  resume(input: FormPreparationMutation): Promise<FormPreparationReceipt>;
  discard(input: FormPreparationDiscard): Promise<FormPreparationReceipt>;
  issuePurgeChallenge(baseId: string, operationId: string): Promise<PurgeChallengeReceipt & { code?: string }>;
  preparePurgeChallenge(baseId: string, challengeId: string, code: string, operationId: string): Promise<PurgeChallengeReceipt>;
  confirmPurgeChallenge(baseId: string, challengeId: string, code: string, operationId: string): Promise<{ confirmed: true; baseId: string; challengeId: string; operationId: string }>;
}

export interface PurgeChallengeReceipt {
  challengeId: string;
  baseId: string;
  expiresAt: string;
  operationId?: string;
}

export const FORM_PREPARATION_MAX_BYTES = 256 * 1024;

const PREPARATION_MESSAGES: Record<string, string> = {
  FORM_PREPARATION_FORBIDDEN: 'Vos droits ne permettent pas de gérer la préparation de ce formulaire.',
  FORM_PREPARATION_NOT_FOUND: 'Cette préparation n’existe plus ou n’est pas accessible.',
  FORM_PREPARATION_INVALID: 'La préparation contient une structure non prise en charge.',
  FORM_PREPARATION_TOO_LARGE: 'La préparation dépasse la taille autorisée.',
  FORM_PREPARATION_CLOSED: 'Cette préparation est déjà terminée ou expirée.',
  FORM_PREPARATION_CONFLICT: 'La définition source ou la préparation a changé. Votre préparation est conservée pour reprise explicite.',
  FORM_PREPARATION_NOT_READY: 'La préparation doit d’abord être prévisualisée et validée par le serveur.',
  FORM_PREPARATION_APPLY_FAILED: 'L’application du formulaire n’a pas abouti. Aucun changement partiel n’a été conservé.',
  FORM_PREPARATION_OPERATION_CONFLICT: 'Cette clé d’opération a déjà été utilisée avec un autre contenu.',
  FORM_PREPARATION_OPERATION_INVALID: 'La clé d’opération est invalide.',
  FORM_RULE_INVALID: 'Une règle ou une association diagnostique n’est pas compatible avec le formulaire.',
  FORM_SEMANTIC_MIGRATION_REQUIRED: 'Cette évolution nécessite une migration sémantique avant toute application.',
  FORM_CHANGE_UNSUPPORTED: 'Cette évolution n’est pas prise en charge par cette préparation.',
  JUSTIFICATION_REQUIRED: 'Un motif est requis pour cette opération avec vos droits actuels.',
  PURGE_CHALLENGE_INVALID: 'La confirmation de purge est invalide.',
  PURGE_CHALLENGE_MISMATCH: 'Le code de confirmation de purge ne correspond pas.',
  PURGE_CHALLENGE_CONFLICT: 'Ce challenge de purge est déjà utilisé pour une autre demande.',
  PURGE_OPERATION_CONFLICT: 'Cette clé de purge a déjà été utilisée avec un autre contenu.',
  PURGE_CHALLENGE_FORBIDDEN: 'Vous ne pouvez pas confirmer la purge de cette base.',
  BASE_ACTIVE: 'La base doit être dans la corbeille avant sa purge.',
  FORM_PREPARATION_UNAVAILABLE: 'Le service de préparation du formulaire est indisponible.',
};

export class FormPreparationError extends Error {
  constructor(
    readonly code: string,
    support: 'local' | 'server' = 'server',
    readonly receipt?: FormPreparationErrorReceipt,
  ) {
    super(support === 'local'
      ? PREPARATION_MESSAGES.FORM_PREPARATION_UNAVAILABLE
      : PREPARATION_MESSAGES[code] ?? PREPARATION_MESSAGES.FORM_PREPARATION_UNAVAILABLE);
    this.name = 'FormPreparationError';
  }
}

function asPreparation(row: Record<string, unknown>): FormPreparation {
  return {
    id: String(row.id),
    baseId: String(row.baseId),
    sourceTemplateVersionId: String(row.sourceTemplateVersionId),
    sourceRevision: Number(row.sourceRevision),
    sourceFingerprint: String(row.sourceFingerprint),
    preparationRevision: Number(row.preparationRevision),
    contentFingerprint: String(row.contentFingerprint),
    classification: row.classification as FormPreparationClassification,
    state: row.state as FormPreparationState,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    expiresAt: String(row.expiresAt),
    payload: (row.payload ?? {}) as FormPreparationPayload,
  };
}

function asReceipt(row: Record<string, unknown>): FormPreparationReceipt {
  const audit = (row.audit ?? {}) as Record<string, unknown>;
  const receipt: FormPreparationReceipt = {
    preparation: asPreparation(row.preparation as Record<string, unknown>),
    operationId: String(row.operationId),
    operationKind: row.operationKind as FormPreparationReceipt['operationKind'],
    audit: {
      sourceRevision: Number(audit.sourceRevision),
      sourceFingerprint: String(audit.sourceFingerprint),
      contentFingerprint: String(audit.contentFingerprint),
      preparationRevision: Number(audit.preparationRevision),
      state: audit.state as FormPreparationState,
      classification: audit.classification as FormPreparationClassification,
    },
  };
  if (row.impact && typeof row.impact === 'object' && !Array.isArray(row.impact)) {
    receipt.impact = row.impact as Record<string, unknown>;
  }
  if (row.application && typeof row.application === 'object' && !Array.isArray(row.application)) {
    receipt.application = row.application as Record<string, unknown>;
  }
  return receipt;
}

function safeCode(error: unknown): string {
  const message = error && typeof error === 'object' ? String((error as { message?: unknown }).message ?? '') : '';
  const detail = error && typeof error === 'object' ? String((error as { details?: unknown }).details ?? '') : '';
  const candidates = Object.keys(PREPARATION_MESSAGES);
  return candidates.find((candidate) => message.includes(candidate) || detail.includes(candidate))
    ?? 'FORM_PREPARATION_UNAVAILABLE';
}

function knownCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(PREPARATION_MESSAGES, value)) return undefined;
  return value;
}

function knownClassification(value: unknown): FormPreparationClassification | undefined {
  return value === 'additive' || value === 'additive_required' || value === 'semantic' || value === 'unsupported'
    ? value
    : undefined;
}

function asErrorReceipt(value: Record<string, unknown>): FormPreparationErrorReceipt | undefined {
  const code = knownCode(value.code) ?? knownCode(value.error);
  if (!code) return undefined;
  const receipt: FormPreparationErrorReceipt = { code, error: code };
  if (typeof value.preparationId === 'string') receipt.preparationId = value.preparationId;
  if (typeof value.operationId === 'string') receipt.operationId = value.operationId;
  if (typeof value.retryable === 'boolean') receipt.retryable = value.retryable;
  if (typeof value.reason === 'string') receipt.reason = value.reason;
  if (typeof value.payloadPreserved === 'boolean') receipt.payloadPreserved = value.payloadPreserved;
  if (value.impact && typeof value.impact === 'object' && !Array.isArray(value.impact)) {
    receipt.impact = value.impact as Record<string, unknown>;
  }
  if (value.application && typeof value.application === 'object' && !Array.isArray(value.application)) {
    receipt.application = value.application as Record<string, unknown>;
  }
  const classification = knownClassification(value.classification);
  if (classification) receipt.classification = classification;
  if (typeof value.currentSourceTemplateVersionId === 'string') {
    receipt.currentSourceTemplateVersionId = value.currentSourceTemplateVersionId;
  }
  if (typeof value.currentSourceRevision === 'number' || typeof value.currentSourceRevision === 'string') {
    receipt.currentSourceRevision = Number(value.currentSourceRevision);
  }
  if (typeof value.currentSourceFingerprint === 'string') receipt.currentSourceFingerprint = value.currentSourceFingerprint;
  if (typeof value.currentPreparationRevision === 'number' || typeof value.currentPreparationRevision === 'string') {
    receipt.currentPreparationRevision = Number(value.currentPreparationRevision);
  }
  return receipt;
}

function checkSize(payload: FormPreparationPayload): void {
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  } catch {
    throw new FormPreparationError('FORM_PREPARATION_INVALID');
  }
  if (bytes > FORM_PREPARATION_MAX_BYTES) throw new FormPreparationError('FORM_PREPARATION_TOO_LARGE');
}

export function createFormPreparationRepository(client: SupabaseClient | null): FormPreparationRepository {
  async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
    if (!client) throw new FormPreparationError('FORM_PREPARATION_UNAVAILABLE', 'local');
    try {
      const { data, error } = await client.rpc(name, params);
      if (error) throw error;
      if (data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { error?: unknown }).error === 'string') {
        const receipt = asErrorReceipt(data as Record<string, unknown>);
        throw new FormPreparationError(receipt?.code ?? 'FORM_PREPARATION_UNAVAILABLE', 'server', receipt);
      }
      return data as T;
    } catch (error) {
      if (error instanceof FormPreparationError) throw error;
      throw new FormPreparationError(safeCode(error));
    }
  }

  return {
    available: client !== null,
    async openOrResume(baseId) {
      return rpc<FormPreparationOpenResult>('open_or_resume_form_preparation', { p_base_id: baseId });
    },
    async read(preparationId) {
      return asPreparation(await rpc<Record<string, unknown>>('read_form_preparation', { p_preparation_id: preparationId }));
    },
    async save(input) {
      checkSize(input.payload);
      return asReceipt(await rpc<Record<string, unknown>>('save_form_preparation', {
        p_preparation_id: input.preparationId,
        p_base_id: input.baseId,
        p_expected_preparation_revision: input.expectedPreparationRevision,
        p_expected_source_revision: input.expectedSourceRevision,
        p_expected_source_fingerprint: input.expectedSourceFingerprint,
        p_operation_id: input.operationId,
        p_payload: input.payload,
      }));
    },
    async preview(input) {
      return asReceipt(await rpc<Record<string, unknown>>('preview_form_preparation', {
        p_preparation_id: input.preparationId,
        p_expected_preparation_revision: input.expectedPreparationRevision,
        p_expected_source_revision: input.expectedSourceRevision,
        p_expected_source_fingerprint: input.expectedSourceFingerprint,
        p_operation_id: input.operationId,
      }));
    },
    async apply(input) {
      return asReceipt(await rpc<Record<string, unknown>>('apply_form_preparation', {
        p_preparation_id: input.preparationId,
        p_expected_preparation_revision: input.expectedPreparationRevision,
        p_expected_source_revision: input.expectedSourceRevision,
        p_expected_source_fingerprint: input.expectedSourceFingerprint,
        p_operation_id: input.operationId,
      }));
    },
    async resume(input) {
      return asReceipt(await rpc<Record<string, unknown>>('resume_form_preparation', {
        p_preparation_id: input.preparationId,
        p_expected_preparation_revision: input.expectedPreparationRevision,
        p_operation_id: input.operationId,
      }));
    },
    async discard(input) {
      return asReceipt(await rpc<Record<string, unknown>>('discard_form_preparation', {
        p_preparation_id: input.preparationId,
        p_expected_preparation_revision: input.expectedPreparationRevision,
        p_expected_source_revision: input.expectedSourceRevision,
        p_expected_source_fingerprint: input.expectedSourceFingerprint,
        p_operation_id: input.operationId,
      }));
    },
    async issuePurgeChallenge(baseId, operationId) {
      return rpc<PurgeChallengeReceipt & { code?: string }>('issue_base_purge_challenge', { p_base_id: baseId, p_operation_id: operationId });
    },
    async preparePurgeChallenge(baseId, challengeId, code, operationId) {
      return rpc<PurgeChallengeReceipt>('prepare_base_purge_challenge', {
        p_base_id: baseId,
        p_challenge_id: challengeId,
        p_code: code,
        p_operation_id: operationId,
      });
    },
    async confirmPurgeChallenge(baseId, challengeId, code, operationId) {
      return rpc('confirm_base_purge_challenge', {
        p_base_id: baseId, p_challenge_id: challengeId, p_code: code, p_operation_id: operationId,
      });
    },
  };
}

export const formPreparationRepository = createFormPreparationRepository(supabase);
