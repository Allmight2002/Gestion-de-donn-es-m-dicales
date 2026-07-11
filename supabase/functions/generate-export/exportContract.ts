// Contrat pur partage entre le navigateur (tests de domaine) et l'Edge Function.
// Les noms de colonnes sont volontairement des identifiants stables, jamais des labels.
export type AggregationRule = 'first' | 'last';

export interface ExportPatient { code: string; data: Record<string, unknown>; templateVersionId?: string; }
export interface ExportEncounter {
  id: string; patientCode: string; encounterDate: string; encounterType: string;
  data: Record<string, unknown>; templateVersionId?: string; ageValue?: unknown; ageUnit?: string | null;
}
export interface ExportField {
  fieldKey: string; label: string; scope: 'patient' | 'encounter'; section: string;
  type: string; unit: string | null; allowedValues: unknown[] | null;
  templateVersionIds?: string[]; displayOrder?: number;
}
export interface ExportTable { columns: string[]; rows: Record<string, unknown>[]; }

export const MISSING_CODES = ['non_fait', 'inconnu', 'non_applicable'] as const;
export type MissingCode = (typeof MISSING_CODES)[number];
const MISSING_KEY = '__missing__';

function isMissing(value: unknown): value is { __missing__: MissingCode } {
  return typeof value === 'object' && value !== null && MISSING_KEY in value &&
    MISSING_CODES.includes((value as Record<string, unknown>)[MISSING_KEY] as MissingCode);
}

function missingCodeOf(value: unknown): MissingCode | null {
  return isMissing(value) ? value[MISSING_KEY] : null;
}

export const FORBIDDEN_EXPORT_KEYS = ['full_name', 'name', 'patient_name', 'first_name', 'last_name', 'date_of_birth', 'dob', 'birth_date', 'phone', 'address', 'contact', 'email'];
export function assertNoIdentity(columns: string[]): void {
  const bad = columns.find((c) => FORBIDDEN_EXPORT_KEYS.includes(c.toLowerCase()));
  if (bad) throw new Error(`Colonne identifiante interdite a l'export: ${bad}`);
}

export const columnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `${field.scope}__${field.fieldKey}`;
const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const missingCode = missingCodeOf(v);
  if (missingCode) return missingCode;
  if (typeof v === 'object' && v !== null && MISSING_KEY in v) {
    throw new Error('Code de valeur manquante invalide');
  }
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
};

/** Unionne scope+field_key : une cle reste une variable malgre un renommage. */
export function mergeExportFields(input: ExportField[]): ExportField[] {
  const sorted = [...input].sort((a, b) =>
    a.scope.localeCompare(b.scope) || a.fieldKey.localeCompare(b.fieldKey) ||
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.label.localeCompare(b.label));
  const merged = new Map<string, ExportField>();
  for (const field of sorted) {
    const key = columnId(field);
    const versions = field.templateVersionIds ?? [];
    const previous = merged.get(key);
    if (previous) previous.templateVersionIds = [...new Set([...(previous.templateVersionIds ?? []), ...versions])].sort();
    else merged.set(key, { ...field, templateVersionIds: [...new Set(versions)].sort() });
  }
  return [...merged.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.fieldKey.localeCompare(b.fieldKey));
}

export function referencedTemplateVersions(patients: ExportPatient[], encounters: ExportEncounter[]): string[] {
  return [...new Set([...patients.map((p) => p.templateVersionId), ...encounters.map((e) => e.templateVersionId)].filter((id): id is string => Boolean(id)))].sort();
}

const belongsToField = (versionId: string | undefined, field: ExportField) =>
  !versionId || !field.templateVersionIds?.length || field.templateVersionIds.includes(versionId);
const valueFor = (data: Record<string, unknown>, versionId: string | undefined, field: ExportField) =>
  belongsToField(versionId, field) ? formatValue(data[field.fieldKey]) : '';

const ENCOUNTER_META = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_value', 'age_unit'];
export function buildEncounterExport(encounters: ExportEncounter[], fields: ExportField[]): ExportTable {
  const encFields = mergeExportFields(fields).filter((f) => f.scope === 'encounter');
  const columns = [...ENCOUNTER_META, ...encFields.map(columnId)];
  const rows = [...encounters].sort((a, b) => a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) || a.id.localeCompare(b.id)).map((e) => {
    const row: Record<string, unknown> = { patient_code: e.patientCode, encounter_id: e.id, encounter_date: e.encounterDate, encounter_type: e.encounterType, age_value: formatValue(e.ageValue ?? e.data.age_at_encounter), age_unit: e.ageUnit ?? '' };
    for (const f of encFields) row[columnId(f)] = valueFor(e.data, e.templateVersionId, f);
    return row;
  });
  return { columns, rows };
}

const pickEncounter = (encounters: ExportEncounter[], rule: AggregationRule) => {
  const sorted = [...encounters].sort((a, b) => a.encounterDate.localeCompare(b.encounterDate) || a.id.localeCompare(b.id));
  return sorted.length ? (rule === 'first' ? sorted[0] : sorted[sorted.length - 1]) : null;
};
export function buildPatientExport(patients: ExportPatient[], encounters: ExportEncounter[], fields: ExportField[], rule: AggregationRule): ExportTable {
  const all = mergeExportFields(fields); const patientFields = all.filter((f) => f.scope === 'patient'); const encounterFields = all.filter((f) => f.scope === 'encounter');
  const columns = ['patient_code', ...patientFields.map(columnId), 'age_value', 'age_unit', ...encounterFields.map(columnId)];
  const byPatient = new Map<string, ExportEncounter[]>();
  for (const e of encounters) byPatient.set(e.patientCode, [...(byPatient.get(e.patientCode) ?? []), e]);
  const rows = [...patients].sort((a, b) => a.code.localeCompare(b.code)).map((p) => {
    const row: Record<string, unknown> = { patient_code: p.code };
    for (const f of patientFields) row[columnId(f)] = valueFor(p.data, p.templateVersionId, f);
    const e = pickEncounter(byPatient.get(p.code) ?? [], rule);
    row.age_value = e ? formatValue(e.ageValue ?? e.data.age_at_encounter) : '';
    row.age_unit = e?.ageUnit ?? '';
    for (const f of encounterFields) row[columnId(f)] = e ? valueFor(e.data, e.templateVersionId, f) : '';
    return row;
  });
  return { columns, rows };
}

export function buildDictionary(fields: ExportField[]): ExportTable {
  const columns = ['column_id', 'field_key', 'label', 'scope', 'section', 'type', 'unit', 'allowed_values', 'template_versions'];
  return { columns, rows: mergeExportFields(fields).map((f) => ({ column_id: columnId(f), field_key: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type, unit: f.unit ?? '', allowed_values: Array.isArray(f.allowedValues) ? f.allowedValues.join('; ') : '', template_versions: (f.templateVersionIds ?? []).join('; ') })) };
}

const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Apostrophe Excel : neutralise une formule, mais preserve les litteraux numeriques signes. */
export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) && !NUMERIC_LITERAL.test(value) ? `'${value}` : value;
}

/** Applique le meme contrat anti-formule aux cellules XLSX qu'aux cellules CSV. */
export function neutralizeExportTable(table: ExportTable): ExportTable {
  return {
    columns: [...table.columns],
    rows: table.rows.map((row) => Object.fromEntries(table.columns.map((column) => {
      const value = row[column];
      return [column, typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : value];
    }))),
  };
}
function csvCell(value: unknown): string {
  const s = neutralizeSpreadsheetFormula(value === null || value === undefined ? '' : String(value));
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(table: ExportTable): string {
  assertNoIdentity(table.columns);
  return [table.columns.map(csvCell).join(','), ...table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(','))].join('\n');
}
