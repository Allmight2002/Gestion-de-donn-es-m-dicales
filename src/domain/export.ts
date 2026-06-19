// Construction des exports (cahier §9.2) — PUR, testable.
//  * Export RENCONTRES : 1 ligne / rencontre (code + id pseudonymise + date + type +
//    age + variables de rencontre).
//  * Export PATIENTS : 1 ligne / patient (code + variables permanentes + variables de
//    rencontre AGREGEES selon une regle EXPLICITE — jamais de choix implicite).
//  * Dictionnaire de variables ; generation CSV.
//  * Garantie : AUCUNE identite ni image. Par construction (on ne lit que le code,
//    l'age calcule et les donnees analytiques) + garde-fou assertNoIdentity.
import { isMissing, missingCodeOf } from './validation';

export type AggregationRule = 'first' | 'last';

export interface ExportPatient {
  code: string;
  data: Record<string, unknown>;
}
export interface ExportEncounter {
  id: string;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
  data: Record<string, unknown>;
}
export interface ExportField {
  fieldKey: string;
  label: string;
  scope: 'patient' | 'encounter';
  section: string;
  type: string;
  unit: string | null;
  allowedValues: unknown[] | null;
}

export interface ExportTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

// Cles identifiantes qui ne doivent JAMAIS apparaitre dans un export (§9.2, critere 9).
export const FORBIDDEN_EXPORT_KEYS = [
  'full_name', 'name', 'patient_name', 'first_name', 'last_name',
  'date_of_birth', 'dob', 'birth_date', 'phone', 'address', 'contact', 'email',
];

export function assertNoIdentity(columns: string[]): void {
  const bad = columns.find((c) => FORBIDDEN_EXPORT_KEYS.includes(c.toLowerCase()));
  if (bad) throw new Error(`Colonne identifiante interdite a l'export: ${bad}`);
}

function formatValue(v: unknown): string {
  if (isMissing(v)) return missingCodeOf(v) ?? '';
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

const ENCOUNTER_META = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_at_encounter'];

/** Export RENCONTRES : 1 ligne / rencontre. */
export function buildEncounterExport(encounters: ExportEncounter[], fields: ExportField[]): ExportTable {
  const encFields = fields.filter((f) => f.scope === 'encounter');
  const columns = [...ENCOUNTER_META, ...encFields.map((f) => f.label)];
  const rows = encounters.map((e) => {
    const row: Record<string, unknown> = {
      patient_code: e.patientCode,
      encounter_id: e.id,
      encounter_date: e.encounterDate,
      encounter_type: e.encounterType,
      age_at_encounter: formatValue(e.data.age_at_encounter),
    };
    for (const f of encFields) row[f.label] = formatValue(e.data[f.fieldKey]);
    return row;
  });
  return { columns, rows };
}

/** Selectionne la rencontre agregee selon la regle EXPLICITE choisie. */
function pickEncounter(encs: ExportEncounter[], rule: AggregationRule): ExportEncounter | null {
  if (encs.length === 0) return null;
  const sorted = [...encs].sort((a, b) => a.encounterDate.localeCompare(b.encounterDate));
  return rule === 'first' ? sorted[0] : sorted[sorted.length - 1];
}

/** Export PATIENTS : 1 ligne / patient (permanent + rencontre agregee par regle). */
export function buildPatientExport(
  patients: ExportPatient[],
  encounters: ExportEncounter[],
  fields: ExportField[],
  rule: AggregationRule,
): ExportTable {
  const permFields = fields.filter((f) => f.scope === 'patient');
  const encFields = fields.filter((f) => f.scope === 'encounter');
  const columns = ['patient_code', ...permFields.map((f) => f.label), 'age_at_encounter', ...encFields.map((f) => f.label)];

  const byPatient = new Map<string, ExportEncounter[]>();
  for (const e of encounters) {
    const arr = byPatient.get(e.patientCode) ?? [];
    arr.push(e);
    byPatient.set(e.patientCode, arr);
  }

  const rows = patients.map((p) => {
    const row: Record<string, unknown> = { patient_code: p.code };
    for (const f of permFields) row[f.label] = formatValue(p.data[f.fieldKey]);
    const enc = pickEncounter(byPatient.get(p.code) ?? [], rule);
    row.age_at_encounter = enc ? formatValue(enc.data.age_at_encounter) : '';
    for (const f of encFields) row[f.label] = enc ? formatValue(enc.data[f.fieldKey]) : '';
    return row;
  });
  return { columns, rows };
}

/** Dictionnaire des variables joint a l'export (§9.2). */
export function buildDictionary(fields: ExportField[]): ExportTable {
  const columns = ['field_key', 'label', 'scope', 'section', 'type', 'unit', 'allowed_values'];
  const rows = fields.map((f) => ({
    field_key: f.fieldKey,
    label: f.label,
    scope: f.scope,
    section: f.section,
    type: f.type,
    unit: f.unit ?? '',
    allowed_values: Array.isArray(f.allowedValues) ? f.allowedValues.join('; ') : '',
  }));
  return { columns, rows };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ExportTable): string {
  assertNoIdentity(table.columns);
  const header = table.columns.map(csvCell).join(',');
  const lines = table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}
