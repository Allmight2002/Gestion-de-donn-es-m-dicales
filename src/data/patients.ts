// Couche d'acces aux donnees "patients" (cahier §4, §8.5).
// La separation identite/analytique est garantie cote base (RLS) : si l'utilisateur
// n'a pas l'acces identite, la liste des identites revient vide et seul le code
// (zone analytique) est visible.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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
  createPatient(baseId: string, input: NewPatientInput): Promise<{ id: string; code: string }>;
  getPatient(baseId: string, patientId: string): Promise<PatientListItem | null>;
  /** Age calcule par le systeme (DOB jamais exposee). null si pas de date de naissance. */
  computeAge(patientId: string, at: string, unit?: string): Promise<number | null>;
  createEncounter(patientId: string, input: NewEncounterInput): Promise<{ id: string }>;
  listEncounters(patientId: string): Promise<Encounter[]>;
  getEncounter(encounterId: string): Promise<Encounter | null>;
  updateEncounter(encounterId: string, data: Record<string, unknown>, status: string, reason: string): Promise<{ id: string }>;
  listFieldChanges(entity: 'patient' | 'encounter', entityId: string): Promise<FieldChange[]>;
  softDeletePatient(patientId: string, reason: string): Promise<void>;
  softDeleteEncounter(encounterId: string, reason: string): Promise<void>;
}

type PatientRow = {
  id: string; patient_code: string; template_version_id: string; data: Record<string, unknown>; validation_status: string;
};
type IdentityRow = {
  patient_code: string; full_name: string | null; date_of_birth: string | null; phone: string | null;
  address: string | null; external_identifier: string | null;
};
type EncounterRow = {
  id: string; encounter_type: string; encounter_date: string; validation_status: string;
  age_value: number | null; age_unit: string | null; data: Record<string, unknown>;
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
const mapEncounter = (r: EncounterRow): Encounter => ({
  id: r.id,
  encounterType: r.encounter_type,
  encounterDate: r.encounter_date,
  validationStatus: r.validation_status,
  ageValue: r.age_value,
  ageUnit: r.age_unit,
  data: r.data ?? {},
});

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makePatientRepository(client: SupabaseClient | null): PatientRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listPatients: fail, createPatient: fail, getPatient: fail, computeAge: fail, createEncounter: fail,
      listEncounters: fail, getEncounter: fail, updateEncounter: fail, listFieldChanges: fail,
      softDeletePatient: fail, softDeleteEncounter: fail,
    };
  }

  return {
    async listPatients(baseId) {
      const { data: patients, error } = await client
        .from('patient')
        .select('id, patient_code, template_version_id, data, validation_status')
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Zone restreinte : ne revient que si l'utilisateur a l'acces identite (RLS).
      const { data: identities, error: e2 } = await client
        .from('patient_identity')
        .select('patient_code, full_name, date_of_birth, phone, address, external_identifier')
        .eq('base_id', baseId)
        .is('deleted_at', null);
      if (e2) throw e2;

      const idByCode = new Map(
        ((identities ?? []) as IdentityRow[]).map((i) => [i.patient_code, mapIdentity(i)]),
      );

      return ((patients ?? []) as PatientRow[]).map((p) => ({
        id: p.id,
        code: p.patient_code,
        templateVersionId: p.template_version_id,
        data: p.data ?? {},
        validationStatus: p.validation_status,
        identity: idByCode.get(p.patient_code) ?? null,
      }));
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
      const { data: ident, error: e2 } = await client
        .from('patient_identity')
        .select('patient_code, full_name, date_of_birth, phone, address, external_identifier')
        .eq('base_id', baseId)
        .eq('patient_code', row.patient_code)
        .is('deleted_at', null)
        .maybeSingle();
      if (e2) throw e2;
      const i = ident as IdentityRow | null;
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
        .select('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('encounter_date', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as EncounterRow[]).map(mapEncounter);
    },

    async getEncounter(encounterId) {
      const { data, error } = await client
        .from('encounter')
        .select('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data')
        .eq('id', encounterId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data ? mapEncounter(data as EncounterRow) : null;
    },

    async updateEncounter(encounterId, data, status, reason) {
      const { data: row, error } = await client.rpc('update_encounter', {
        p_encounter_id: encounterId,
        p_data: data,
        p_validation_status: status,
        p_reason: reason,
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
  };
}

export const patientRepository: PatientRepository = makePatientRepository(supabase);
