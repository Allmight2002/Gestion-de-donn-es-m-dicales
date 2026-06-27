// Logique PURE d'importation (testable en node) : correspondance colonnes -> cibles, et
// construction des lignes structurees envoyees a la RPC import_records. Le decoupage
// identite / analytique est decide ICI (cote client) ; la base le RE-VALIDE et l'ECRIT.
import type { TemplateField } from '../data/types';

export type ImportTarget =
  | 'ignore'
  | 'patient_code'
  | 'encounter_type'
  | 'encounter_date'
  | 'identity.full_name'
  | 'identity.date_of_birth'
  | `patient:${string}`
  | `encounter:${string}`;

export type ColumnMapping = Record<string, ImportTarget>;

export interface ImportRow {
  patient_code: string | null;
  identity: { full_name?: string; date_of_birth?: string } | null;
  patient_data: Record<string, unknown>;
  encounter: { encounter_type: string; encounter_date: string; data: Record<string, unknown> } | null;
}

export interface ImportReport {
  dry_run: boolean;
  status: string;
  patients_new: number;
  patients_updated: number;
  encounters: number;
  error_count: number;
  errors: { row: number; patient_code: string; message: string }[];
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const META_ALIASES: Record<string, ImportTarget> = {
  patientcode: 'patient_code', codepatient: 'patient_code', code: 'patient_code', patientid: 'patient_code', id: 'patient_code',
  encountertype: 'encounter_type', typerencontre: 'encounter_type', typederencontre: 'encounter_type', type: 'encounter_type',
  encounterdate: 'encounter_date', daterencontre: 'encounter_date', date: 'encounter_date', dateconsultation: 'encounter_date',
  fullname: 'identity.full_name', nom: 'identity.full_name', nomcomplet: 'identity.full_name', name: 'identity.full_name',
  dateofbirth: 'identity.date_of_birth', datedenaissance: 'identity.date_of_birth', naissance: 'identity.date_of_birth', dob: 'identity.date_of_birth',
};

/** Pre-remplit la correspondance : meta connue, puis champ de gabarit par libelle/cle. */
export function autoMapColumns(headers: string[], fields: TemplateField[]): ColumnMapping {
  const patient = fields.filter((f) => f.scope === 'patient');
  const encounter = fields.filter((f) => f.scope === 'encounter');
  const map: ColumnMapping = {};
  for (const h of headers) {
    const n = norm(h);
    if (META_ALIASES[n]) { map[h] = META_ALIASES[n]; continue; }
    const pf = patient.find((f) => norm(f.label) === n || norm(f.fieldKey) === n);
    if (pf) { map[h] = `patient:${pf.fieldKey}`; continue; }
    const ef = encounter.find((f) => norm(f.label) === n || norm(f.fieldKey) === n);
    if (ef) { map[h] = `encounter:${ef.fieldKey}`; continue; }
    map[h] = 'ignore';
  }
  return map;
}

/** Construit les lignes structurees a partir des lignes brutes (objets par en-tete) + mapping. */
export function buildImportRows(rows: Record<string, unknown>[], mapping: ColumnMapping): ImportRow[] {
  return rows.map((raw) => {
    let patient_code: string | null = null;
    const identity: { full_name?: string; date_of_birth?: string } = {};
    const patient_data: Record<string, unknown> = {};
    const encData: Record<string, unknown> = {};
    let encType = '';
    let encDate = '';

    for (const [col, target] of Object.entries(mapping)) {
      if (target === 'ignore') continue;
      const v = raw[col];
      const s = v == null ? '' : String(v).trim();
      if (s === '') continue;
      if (target === 'patient_code') patient_code = s;
      else if (target === 'encounter_type') encType = s;
      else if (target === 'encounter_date') encDate = s;
      else if (target === 'identity.full_name') identity.full_name = s;
      else if (target === 'identity.date_of_birth') identity.date_of_birth = s;
      else if (target.startsWith('patient:')) patient_data[target.slice('patient:'.length)] = s;
      else if (target.startsWith('encounter:')) encData[target.slice('encounter:'.length)] = s;
    }

    const hasEnc = encDate !== '' || encType !== '' || Object.keys(encData).length > 0;
    const hasIdentity = !!(identity.full_name || identity.date_of_birth);
    return {
      patient_code,
      identity: hasIdentity ? identity : null,
      patient_data,
      encounter: hasEnc ? { encounter_type: encType || 'consultation', encounter_date: encDate, data: encData } : null,
    };
  });
}
