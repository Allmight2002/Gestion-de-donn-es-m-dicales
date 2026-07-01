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
  getPatient(baseId: string, patientId: string): Promise<PatientListItem | null>;
  /** Age calcule par le systeme (DOB jamais exposee). null si pas de date de naissance. */
  computeAge(patientId: string, at: string, unit?: string): Promise<number | null>;
  createEncounter(patientId: string, input: NewEncounterInput): Promise<{ id: string }>;
  listEncounters(patientId: string): Promise<Encounter[]>;
  getEncounter(encounterId: string): Promise<Encounter | null>;
  updateEncounter(encounterId: string, data: Record<string, unknown>, status: string, reason: string, expectedUpdatedAt?: string | null): Promise<{ id: string }>;
  listFieldChanges(entity: 'patient' | 'encounter', entityId: string): Promise<FieldChange[]>;
  softDeletePatient(patientId: string, reason: string): Promise<void>;
  softDeleteEncounter(encounterId: string, reason: string): Promise<void>;
  /** Finalise les donnees permanentes d'un patient (draft -> curated). Echoue si incompletes. */
  finalizePatient(patientId: string): Promise<void>;
  /** Corrige / complete les donnees PERMANENTES d'un patient (journalise, re-validees). */
  updatePatientData(patientId: string, data: Record<string, unknown>, status: string, reason: string): Promise<void>;
  /** Import par lots (patients + rencontres). dryRun=true -> apercu sans ecriture. */
  importRecords(baseId: string, rows: ImportRow[], opts: ImportOptions): Promise<ImportReport>;
  /** Ouvre un lot d'import (controles globaux + idempotence) ; renvoie l'id du lot pour les chunks. */
  beginImportBatch(baseId: string, opts: BeginImportOptions): Promise<string>;
  /** Cloture un lot d'import (apres tous les chunks) -> active l'idempotence du fichier. */
  completeImportBatch(batchId: string): Promise<void>;
  /** Annule un lot d'import en cours (libere le fichier). */
  cancelImportBatch(batchId: string): Promise<void>;
}

type PatientRow = {
  id: string; patient_code: string; template_version_id: string; data: Record<string, unknown>; validation_status: string;
};
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
      listEncounters: fail, getEncounter: fail, updateEncounter: fail, listFieldChanges: fail,
      softDeletePatient: fail, softDeleteEncounter: fail, finalizePatient: fail, updatePatientData: fail, importRecords: fail, beginImportBatch: fail,
      completeImportBatch: fail, cancelImportBatch: fail,
    };
  }

  return {
    async listPatients(baseId) {
      // §5.8 — LISTE PSEUDONYMISEE : on ne requete QUE la zone analytique, jamais patient_identity.
      const { data: patients, error } = await client
        .from('patient')
        .select('id, patient_code, template_version_id, data, validation_status')
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((patients ?? []) as PatientRow[]).map(toListItem);
    },

    async listPatientsPage(baseId, limit, offset) {
      // §5.8 — page PSEUDONYMISEE (zone analytique + effectif total) ; aucune identite chargee.
      const { data: patients, error, count } = await client
        .from('patient')
        .select('id, patient_code, template_version_id, data, validation_status', { count: 'exact' })
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = (patients ?? []) as PatientRow[];
      return { rows: rows.map(toListItem), total: count ?? rows.length };
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

    async getPatient(baseId, patientId) {
      const { data: p, error } = await client
        .from('patient')
        .select('id, patient_code, template_version_id, data, validation_status')
        .eq('id', patientId)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!p) return null;
      const row = p as PatientRow;
      // La zone identite n'est jamais lue en direct : la RPC verifie l'acces et audite
      // avant de renvoyer les champs. Sans acces identite, elle renvoie simplement [].
      const { data: identRows, error: e2 } = await client.rpc('get_patient_identity', { p_patient_id: patientId });
      if (e2) throw e2;
      const i = (((identRows ?? []) as IdentityRow[])[0]) ?? null;
      return {
        id: row.id,
        code: row.patient_code,
        templateVersionId: row.template_version_id,
        data: row.data ?? {},
        validationStatus: row.validation_status,
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

    async updateEncounter(encounterId, data, status, reason, expectedUpdatedAt) {
      const { data: row, error } = await client.rpc('update_encounter', {
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

    async updatePatientData(patientId, data, status, reason) {
      const { error } = await client.rpc('update_patient', {
        p_patient_id: patientId, p_data: data, p_validation_status: status, p_reason: reason,
      });
      if (error) throw error;
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

    async completeImportBatch(batchId) {
      const { error } = await client.rpc('complete_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },

    async cancelImportBatch(batchId) {
      const { error } = await client.rpc('cancel_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },
  };
}

export const patientRepository: PatientRepository = makePatientRepository(supabase);
