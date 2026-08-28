// Couche d'acces aux donnees "patients" (cahier §4, §8.5).
// La separation identite/analytique est garantie cote base (RLS) : si l'utilisateur
// n'a pas l'acces identite, la liste des identites revient vide et seul le code
// (zone analytique) est visible.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ImportRow, ImportReport } from '../domain/import';
import type { RawSnapshotData } from './offline';

/** Options d'un import (statut cible, mode de conflit, empreinte fichier, version vue a l'apercu). */
export interface ImportOptions {
  dryRun: boolean;
  status: string;
  conflict: 'fill' | 'overwrite' | 'skip';
  fileHash?: string | null;
  templateVersionId?: string | null;
  /** Lot d'import en cours (import par chunks) ; null = appel autonome. */
  batchId?: string | null;
}

/** Parametres d'ouverture d'un lot d'import (import par chunks). */
export interface BeginImportOptions {
  status: string;
  conflict: 'fill' | 'overwrite' | 'skip';
  fileHash?: string | null;
  templateVersionId?: string | null;
  /** Nombre total de lignes annonce (§7.4 : controle de completude a la cloture du lot). */
  expectedRows?: number | null;
}

/** Etat serveur d'un lot: seule source de verite pour reprendre un import chunké. */
export interface ImportBatchState {
  batch_id: string;
  status: string;
  resume_state?: 'modern' | 'historical_unsafe' | 'historical_cancelled' | 'replacement';
  replaces_batch_id?: string | null;
  expected_rows: number | null;
  row_count: number;
  error_count: number;
  succeeded_source_rows: number[];
  rejected_source_rows: number[];
}

export interface PatientIdentityInfo {
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  externalIdentifier: string | null;
}

export interface PatientListItem {
  id: string;
  code: string;
  templateVersionId: string;
  data: Record<string, unknown>;
  validationStatus: string;
  /** Version optimiste des donnees permanentes. */
  version?: number | null;
  updatedAt?: string | null;
  /** Auteur serveur de la fiche, requis pour limiter la correction d'identite du saisisseur. */
  createdBy?: string | null;
  identity: PatientIdentityInfo | null; // null si pas d'acces identite
}

export interface NewPatientInput {
  code: string;
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  externalIdentifier: string | null;
  permanentData: Record<string, unknown>;
}

/** §7.6 — Rencontre du fichier ressemblant a une rencontre DEJA enregistree (avertissement). */
export interface ImportDuplicateWarning {
  row: number;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
}

/** Doublon potentiel : un patient existant au MEME nom complet + date de naissance. */
export interface IdentityMatch {
  patientId: string;
  code: string;
  fullName: string | null;
  dateOfBirth: string | null;
}

export interface NewEncounterInput {
  encounterType: string;
  encounterDate: string;
  validationStatus: string;
  ageUnit: string;
  data: Record<string, unknown>;
}

/** Rejeu idempotent d'une creation patient preparee hors-ligne (feuille de route O1). */
export interface ReplayPatientCreateInput extends NewPatientInput {
  operationKey: string;
}

/** Rejeu idempotent d'une creation rencontre hors-ligne : le patient est designe soit
 * par la cle d'operation parente (patient en attente), soit par son UUID serveur. */
export interface ReplayEncounterCreateInput extends NewEncounterInput {
  operationKey: string;
  parentOperationKey: string | null;
  patientId: string | null;
}

export interface Encounter {
  id: string;
  encounterType: string;
  encounterDate: string;
  validationStatus: string;
  ageValue: number | null;
  ageUnit: string | null;
  data: Record<string, unknown>;
  /** Version optimiste (cote serveur) : sert au verrou de synchronisation hors-ligne. */
  updatedAt?: string | null;
  /** §7.4 — version de gabarit DE LA RENCONTRE : l'edition historique charge CE dictionnaire. */
  templateVersionId?: string | null;
}

export interface FieldChange {
  fieldKey: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  changedAt: string;
}

/** B2 — un dossier NON FINALISE avec ses champs requis manquants (file « a completer »). */
export interface CompletionItem {
  kind: 'patient' | 'encounter';
  patientId: string;
  encounterId?: string;
  code: string;
  encounterType?: string;
  encounterDate?: string;
  status: string;
  missing: string[];
}

export interface CompletionQueuePage {
  items: CompletionItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PatientRepository {
  listPatients(baseId: string): Promise<PatientListItem[]>;
  /** Page de patients (pagination serveur) + effectif total de la base. */
  listPatientsPage(baseId: string, limit: number, offset: number): Promise<{ rows: PatientListItem[]; total: number }>;
  /** §8 — Instantane ANALYTIQUE complet (patients + rencontres + champs) en UN appel (hors-ligne). */
  fetchBaseSnapshot(baseId: string): Promise<RawSnapshotData | null>;
  /** §7.6 — Avertit (a l'apercu) des rencontres ressemblant a des rencontres deja enregistrees. */
  detectImportDuplicates(baseId: string, rows: ImportRow[]): Promise<ImportDuplicateWarning[]>;
  /** Recherche un doublon potentiel par identite (nom + date de naissance). [] si rien. */
  findIdentityMatches(baseId: string, fullName: string, dateOfBirth: string): Promise<IdentityMatch[]>;
  createPatient(baseId: string, input: NewPatientInput): Promise<{ id: string; code: string }>;
  /** Rejeu IDEMPOTENT d'une creation hors-ligne : une meme cle + charge ne cree jamais deux fois. */
  replayPatientCreate(baseId: string, input: ReplayPatientCreateInput): Promise<{ id: string; code: string }>;
  getPatient(baseId: string, patientId: string): Promise<PatientListItem | null>;
  /** Age calcule par le systeme (DOB jamais exposee). null si pas de date de naissance. */
  computeAge(patientId: string, at: string, unit?: string): Promise<number | null>;
  createEncounter(patientId: string, input: NewEncounterInput): Promise<{ id: string }>;
  /** Rejeu IDEMPOTENT d'une creation rencontre hors-ligne (dependante du patient parent). */
  replayEncounterCreate(input: ReplayEncounterCreateInput): Promise<{ id: string; patientId: string }>;
  listEncounters(patientId: string): Promise<Encounter[]>;
  getEncounter(encounterId: string): Promise<Encounter | null>;
  updateEncounter(
    encounterId: string,
    data: Record<string, unknown>,
    status: string,
    reason: string,
    expectedUpdatedAt?: string | null,
    operationId?: string | null,
  ): Promise<{ id: string }>;
  listFieldChanges(entity: 'patient' | 'encounter', entityId: string): Promise<FieldChange[]>;
  softDeletePatient(patientId: string, reason: string): Promise<void>;
  softDeleteEncounter(encounterId: string, reason: string): Promise<void>;
  /** Finalise les donnees permanentes d'un patient (draft -> curated). Echoue si incompletes. */
  finalizePatient(patientId: string): Promise<void>;
  /** Corrige / complete les donnees PERMANENTES d'un patient (journalise, re-validees). */
  updatePatientData(patientId: string, data: Record<string, unknown>, status: string, reason: string, expectedVersion: number | null): Promise<{ version: number | null; updatedAt: string | null }>;
  /** Corrige la zone identite complete via la RPC dediee, auditee et verrouillee. */
  updatePatientIdentity(patientId: string, identity: PatientIdentityInfo, reason: string, expectedVersion: number | null): Promise<{ version: number | null; updatedAt: string | null }>;
  /** Import par lots (patients + rencontres). dryRun=true -> apercu sans ecriture. */
  importRecords(baseId: string, rows: ImportRow[], opts: ImportOptions): Promise<ImportReport>;
  /** Ouvre un lot d'import (controles globaux + idempotence) ; renvoie l'id du lot pour les chunks. */
  beginImportBatch(baseId: string, opts: BeginImportOptions): Promise<string>;
  getImportBatchState(batchId: string): Promise<ImportBatchState>;
  /** Cloture un lot d'import (apres tous les chunks) -> active l'idempotence du fichier. */
  completeImportBatch(batchId: string): Promise<void>;
  /** Annule un lot d'import en cours (libere le fichier). */
  cancelImportBatch(batchId: string): Promise<void>;
  /** B2 : dossiers non finalises + champs requis manquants (RLS : sans acces -> vide). */
  getCompletionQueue(baseId: string, limit?: number): Promise<CompletionItem[]>;
  /** B2 : version paginee de la file de completion. */
  getCompletionQueuePage(baseId: string, limit: number, offset: number): Promise<CompletionQueuePage>;
}

type PatientRow = {
  id: string; patient_code: string; template_version_id: string; data: Record<string, unknown>; validation_status: string; row_version?: number | null; updated_at?: string | null; created_by?: string | null;
};
const PATIENT_READ_COLUMNS = 'id, patient_code, template_version_id, data, validation_status, row_version, updated_at';
const LEGACY_PATIENT_READ_COLUMNS = 'id, patient_code, template_version_id, data, validation_status, updated_at';
const PATIENT_DETAIL_READ_COLUMNS = `${PATIENT_READ_COLUMNS}, created_by`;
const LEGACY_PATIENT_DETAIL_READ_COLUMNS = `${LEGACY_PATIENT_READ_COLUMNS}, created_by`;

// Compatibilite de lecture pendant une promotion coordonnee : un schema plus ancien peut ne
// pas encore posseder patient.row_version. Le repli est volontairement etroit afin de ne
// jamais masquer une erreur RLS, reseau ou serveur sous une compatibilite silencieuse.
function isMissingPatientRowVersion(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '42703'
    && typeof candidate.message === 'string'
    && /\brow_version\b/i.test(candidate.message);
}
type IdentityRow = {
  patient_code: string; full_name: string | null; date_of_birth: string | null; phone: string | null;
  address: string | null; external_identifier: string | null;
};
type IdentityMatchRow = {
  patient_id: string; code: string; full_name: string | null; date_of_birth: string | null;
};
type EncounterRow = {
  id: string; encounter_type: string; encounter_date: string; validation_status: string;
  age_value: number | null; age_unit: string | null; data: Record<string, unknown>; updated_at?: string | null;
  template_version_id?: string | null;
};
type FieldChangeRow = {
  field_key: string; old_value: unknown; new_value: unknown; reason: string | null; changed_at: string;
};
const mapIdentity = (i: IdentityRow): PatientIdentityInfo => ({
  fullName: i.full_name,
  dateOfBirth: i.date_of_birth,
  phone: i.phone,
  address: i.address,
  externalIdentifier: i.external_identifier,
});
// §5.8 — Element de LISTE pseudonymise : jamais d'identite. Le code (zone analytique) suffit a
// parcourir la base ; le nom n'est revele que sur la FICHE patient (getPatient), ou chaque
// consultation est journalisee. Les listes ne chargent donc aucune identite (rien en masse).
const toListItem = (p: PatientRow): PatientListItem => ({
  id: p.id,
  code: p.patient_code,
  templateVersionId: p.template_version_id,
  data: p.data ?? {},
  validationStatus: p.validation_status,
  version: p.row_version ?? null,
  updatedAt: p.updated_at ?? null,
  createdBy: p.created_by ?? null,
  identity: null,
});
const mapEncounter = (r: EncounterRow): Encounter => ({
  id: r.id,
  encounterType: r.encounter_type,
  encounterDate: r.encounter_date,
  validationStatus: r.validation_status,
  ageValue: r.age_value,
  ageUnit: r.age_unit,
  data: r.data ?? {},
  updatedAt: r.updated_at ?? null,
  templateVersionId: r.template_version_id ?? null,
});

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makePatientRepository(client: SupabaseClient | null): PatientRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listPatients: fail, listPatientsPage: fail, fetchBaseSnapshot: fail, detectImportDuplicates: fail, findIdentityMatches: fail, createPatient: fail, getPatient: fail, computeAge: fail, createEncounter: fail,
      replayPatientCreate: fail, replayEncounterCreate: fail,
      listEncounters: fail, getEncounter: fail, updateEncounter: fail, listFieldChanges: fail,
      softDeletePatient: fail, softDeleteEncounter: fail, finalizePatient: fail, updatePatientData: fail, importRecords: fail, beginImportBatch: fail,
      updatePatientIdentity: fail,
      getImportBatchState: fail, completeImportBatch: fail, cancelImportBatch: fail, getCompletionQueue: fail, getCompletionQueuePage: fail,
    };
  }

  return {
    async listPatients(baseId) {
      // §5.8 — LISTE PSEUDONYMISEE : on ne requete QUE la zone analytique, jamais patient_identity.
      const query = (columns: string) => client
        .from('patient')
        .select(columns)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      const current = await query(PATIENT_READ_COLUMNS);
      if (!current.error) return ((current.data ?? []) as unknown as PatientRow[]).map(toListItem);
      if (!isMissingPatientRowVersion(current.error)) throw current.error;
      const legacy = await query(LEGACY_PATIENT_READ_COLUMNS);
      if (legacy.error) throw legacy.error;
      return ((legacy.data ?? []) as unknown as PatientRow[]).map(toListItem);
    },

    async listPatientsPage(baseId, limit, offset) {
      // §5.8 — page PSEUDONYMISEE (zone analytique + effectif total) ; aucune identite chargee.
      const query = (columns: string) => client
        .from('patient')
        .select(columns, { count: 'exact' })
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
      const current = await query(PATIENT_READ_COLUMNS);
      if (!current.error) {
        const rows = (current.data ?? []) as unknown as PatientRow[];
        return { rows: rows.map(toListItem), total: current.count ?? rows.length };
      }
      if (!isMissingPatientRowVersion(current.error)) throw current.error;
      const legacy = await query(LEGACY_PATIENT_READ_COLUMNS);
      if (legacy.error) throw legacy.error;
      const rows = (legacy.data ?? []) as unknown as PatientRow[];
      return { rows: rows.map(toListItem), total: legacy.count ?? rows.length };
    },

    async fetchBaseSnapshot(baseId) {
      // §8 : un seul aller-retour serveur (RPC) -> base + champs + patients AVEC leurs rencontres.
      const { data, error } = await client.rpc('download_base_snapshot', { p_base_id: baseId });
      if (error) throw error;
      const d = data as RawSnapshotData | null;
      return d && d.base ? d : null;
    },

    async detectImportDuplicates(baseId, rows) {
      // §7.6 : avertissement (lecture seule) sur les rencontres ressemblant a des existantes.
      const { data, error } = await client.rpc('detect_import_duplicates', { p_base_id: baseId, p_rows: rows });
      if (error) throw error;
      const d = data as { warnings?: { row: number; patient_code: string; encounter_date: string; encounter_type: string }[] } | null;
      return (d?.warnings ?? []).map((w) => ({
        row: w.row, patientCode: w.patient_code, encounterDate: w.encounter_date, encounterType: w.encounter_type,
      }));
    },

    async findIdentityMatches(baseId, fullName, dateOfBirth) {
      const name = fullName.trim();
      if (!name || !dateOfBirth) return [];
      // Acces identite requis ; la RPC audite chaque match avant de renvoyer les champs.
      const { data: rows, error } = await client.rpc('find_identity_matches', {
        p_base_id: baseId,
        p_full_name: name,
        p_date_of_birth: dateOfBirth,
      });
      if (error) throw error;
      return ((rows ?? []) as IdentityMatchRow[])
        .map((r) => ({ patientId: r.patient_id, code: r.code, fullName: r.full_name, dateOfBirth: r.date_of_birth }));
    },

    async createPatient(baseId, input) {
      const { data, error } = await client.rpc('create_patient', {
        p_base_id: baseId,
        p_patient_code: input.code,
        p_full_name: input.fullName,
        p_date_of_birth: input.dateOfBirth,
        p_phone: input.phone,
        p_address: input.address,
        p_external_identifier: input.externalIdentifier,
        p_permanent_data: input.permanentData,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PatientRow;
      return { id: row.id, code: row.patient_code };
    },

    async replayPatientCreate(baseId, input) {
      // Meme charge que create_patient + la cle d'operation : la RPC serveur garantit
      // l'idempotence (un rejeu apres une reponse perdue ne cree pas de doublon).
      const { data, error } = await client.rpc('replay_patient_create', {
        p_operation_id: input.operationKey,
        p_base_id: baseId,
        p_patient_code: input.code,
        p_full_name: input.fullName,
        p_date_of_birth: input.dateOfBirth,
        p_phone: input.phone,
        p_address: input.address,
        p_external_identifier: input.externalIdentifier,
        p_permanent_data: input.permanentData,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PatientRow;
      return { id: row.id, code: row.patient_code };
    },

    async computeAge(patientId, at, unit = 'years') {
      const { data, error } = await client.rpc('patient_age_at', { p_patient_id: patientId, p_at: at, p_unit: unit });
      if (error) throw error;
      return (data as number | null) ?? null;
    },

    async createEncounter(patientId, input) {
      const { data, error } = await client.rpc('create_encounter', {
        p_patient_id: patientId,
        p_encounter_type: input.encounterType,
        p_encounter_date: input.encounterDate,
        p_validation_status: input.validationStatus,
        p_data: input.data,
        p_age_unit: input.ageUnit,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string };
      return { id: row.id };
    },

    async replayEncounterCreate(input) {
      // La RPC serveur resout le parent : cle d'operation du patient en attente, ou
      // UUID serveur direct ; elle garantit l'ordre et l'idempotence.
      const { data, error } = await client.rpc('replay_encounter_create', {
        p_operation_id: input.operationKey,
        p_parent_operation_id: input.parentOperationKey,
        p_patient_id: input.patientId,
        p_encounter_type: input.encounterType,
        p_encounter_date: input.encounterDate,
        p_validation_status: input.validationStatus,
        p_data: input.data,
        p_age_unit: input.ageUnit,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; patient_id: string };
      return { id: row.id, patientId: row.patient_id };
    },

    async getPatient(baseId, patientId) {
      const query = (columns: string) => client
        .from('patient')
        .select(columns)
        .eq('id', patientId)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .maybeSingle();
      const current = await query(PATIENT_DETAIL_READ_COLUMNS);
      const resolved = current.error && isMissingPatientRowVersion(current.error)
        ? await query(LEGACY_PATIENT_DETAIL_READ_COLUMNS)
        : current;
      if (resolved.error) throw resolved.error;
      const p = resolved.data;
      if (!p) return null;
      const row = p as unknown as PatientRow;
      // La zone identite n'est jamais lue en direct : la RPC verifie l'acces et audite
      // avant de renvoyer les champs. Sans acces identite, elle renvoie simplement [].
      const { data: identRows, error: e2 } = await client.rpc('get_patient_identity', { p_patient_id: patientId });
      if (e2) throw e2;
      const i = (((identRows ?? []) as IdentityRow[])[0]) ?? null;
      return {
        ...toListItem(row),
        identity: i ? mapIdentity(i) : null,
      };
    },

    async listEncounters(patientId) {
      const { data, error } = await client
        .from('encounter')
        .select('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data, updated_at, template_version_id')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('encounter_date', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as EncounterRow[]).map(mapEncounter);
    },

    async getEncounter(encounterId) {
      const { data, error } = await client
        .from('encounter')
        .select('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data, updated_at, template_version_id')
        .eq('id', encounterId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data ? mapEncounter(data as EncounterRow) : null;
    },

    async updateEncounter(encounterId, data, status, reason, expectedUpdatedAt, operationId) {
      const { data: row, error } = operationId
        ? await client.rpc('replay_encounter_update', {
          p_operation_id: operationId,
          p_encounter_id: encounterId,
          p_data: data,
          p_validation_status: status,
          p_reason: reason,
          p_expected_updated_at: expectedUpdatedAt ?? null,
        })
        : await client.rpc('update_encounter', {
          p_encounter_id: encounterId,
          p_data: data,
          p_validation_status: status,
          p_reason: reason,
          p_expected_updated_at: expectedUpdatedAt ?? null,
        });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as { id: string };
      return { id: r.id };
    },

    async listFieldChanges(entity, entityId) {
      const { data, error } = await client
        .from('field_change_log')
        .select('field_key, old_value, new_value, reason, changed_at')
        .eq('entity', entity)
        .eq('entity_id', entityId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as FieldChangeRow[]).map((c) => ({
        fieldKey: c.field_key,
        oldValue: c.old_value,
        newValue: c.new_value,
        reason: c.reason,
        changedAt: c.changed_at,
      }));
    },

    async softDeletePatient(patientId, reason) {
      const { error } = await client.rpc('soft_delete_patient', { p_patient_id: patientId, p_reason: reason });
      if (error) throw error;
    },

    async softDeleteEncounter(encounterId, reason) {
      const { error } = await client.rpc('soft_delete_encounter', { p_encounter_id: encounterId, p_reason: reason });
      if (error) throw error;
    },

    async finalizePatient(patientId) {
      const { error } = await client.rpc('finalize_patient', { p_patient_id: patientId });
      if (error) throw error;
    },

    async updatePatientData(patientId, data, status, reason, expectedVersion) {
      const { data: row, error } = await client.rpc('update_patient', {
        p_patient_id: patientId, p_data: data, p_validation_status: status, p_reason: reason,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as PatientRow;
      return { version: r.row_version ?? null, updatedAt: r.updated_at ?? null };
    },

    async updatePatientIdentity(patientId, identity, reason, expectedVersion) {
      const { data: row, error } = await client.rpc('update_patient_identity', {
        p_patient_id: patientId,
        p_full_name: identity.fullName,
        p_date_of_birth: identity.dateOfBirth,
        p_phone: identity.phone,
        p_address: identity.address,
        p_external_identifier: identity.externalIdentifier,
        p_reason: reason,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as PatientRow;
      return { version: r.row_version ?? null, updatedAt: r.updated_at ?? null };
    },

    async importRecords(baseId, rows, opts) {
      const { data, error } = await client.rpc('import_records', {
        p_base_id: baseId, p_rows: rows, p_dry_run: opts.dryRun, p_status: opts.status,
        p_conflict: opts.conflict, p_file_hash: opts.fileHash ?? null,
        p_template_version_id: opts.templateVersionId ?? null, p_batch_id: opts.batchId ?? null,
      });
      if (error) throw error;
      return data as ImportReport;
    },

    async beginImportBatch(baseId, opts) {
      const { data, error } = await client.rpc('begin_import_batch', {
        p_base_id: baseId, p_file_hash: opts.fileHash ?? null,
        p_template_version_id: opts.templateVersionId ?? null, p_conflict: opts.conflict, p_status: opts.status,
        p_expected_rows: opts.expectedRows ?? null,
      });
      if (error) throw error;
      return data as string;
    },

    async getImportBatchState(batchId) {
      const { data, error } = await client.rpc('get_import_batch_state', { p_batch_id: batchId });
      if (error) throw error;
      return data as ImportBatchState;
    },

    async completeImportBatch(batchId) {
      const { error } = await client.rpc('complete_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },

    async cancelImportBatch(batchId) {
      const { error } = await client.rpc('cancel_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },

    async getCompletionQueue(baseId, limit) {
      const { data, error } = await client.rpc('base_completion_queue', { p_base_id: baseId, p_limit: limit ?? 200 });
      if (error) throw error;
      return (data ?? []) as CompletionItem[];
    },

    async getCompletionQueuePage(baseId, limit, offset) {
      const { data, error } = await client.rpc('base_completion_queue_page', {
        p_base_id: baseId,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      const page = (data ?? {}) as Partial<CompletionQueuePage>;
      return {
        items: page.items ?? [],
        total: page.total ?? 0,
        limit: page.limit ?? limit,
        offset: page.offset ?? offset,
        hasMore: page.hasMore ?? false,
      };
    },
  };
}

export const patientRepository: PatientRepository = makePatientRepository(supabase);
