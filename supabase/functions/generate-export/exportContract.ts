// Contrat pur partage entre le navigateur (tests de domaine) et l'Edge Function.
// Les noms de colonnes sont volontairement des identifiants stables, jamais des labels.
export type AggregationRule = 'first' | 'last';

export interface ExportPatient {
  code: string;
  data: Record<string, unknown>;
  templateVersionId?: string;
}
export interface ExportEncounter {
  id: string;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
  data: Record<string, unknown>;
  templateVersionId?: string;
  ageValue?: unknown;
  ageUnit?: string | null;
}
export interface ExportField {
  fieldKey: string;
  label: string;
  description?: string | null;
  scope: 'patient' | 'encounter';
  /** CODE de la section (L31) : stable, c'est lui qui survit a une correction de libelle. */
  section: string;
  /** Libelle de la section, lisible. Absent = version anterieure au lot, ou section detachee. */
  sectionLabel?: string | null;
  type: string;
  /** Variable multivaluee (L22) : accepte une liste ordonnee de couples terminologiques. */
  isMultiple?: boolean | null;
  unit: string | null;
  /** Miroir des codes d'options (L30) : ce que contient reellement la colonne de donnees. */
  allowedValues: unknown[] | null;
  /** Options de liste (L30) : `{value_key, label, is_active}`. Absent = instantane ancien. */
  allowedOptions?: unknown[] | null;
  /** Raisons de valeur manquante proposees pour CETTE variable (L33). Absent = instantane ancien. */
  missingReasons?: readonly string[] | null;
  templateVersionIds?: string[];
  displayOrder?: number;
}
export interface ExportTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Raisons de valeur manquante, dans l'ordre canonique de la base. Les trois premieres sont
 * HISTORIQUES : ni leur code ni leur sens ne changent, et une fiche deja saisie reste lisible
 * telle quelle. `refus` et `non_documente` sont ajoutees par L33 ; `non_documente` se distingue
 * d'`inconnu`, qui laisse croire que l'information a ete cherchee.
 *
 * Cette liste est la SEULE : `src/domain/validation.ts` l'importe au lieu de la recopier
 * (via `src/domain/export.ts`). Deux listes qui divergeraient produiraient un export
 * incoherent avec la saisie -- une valeur saisissable mais illisible a l'export.
 */
export const MISSING_CODES = ['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente'] as const;
export type MissingCode = (typeof MISSING_CODES)[number];
const MISSING_KEY = '__missing__';

function isMissing(value: unknown): value is { __missing__: MissingCode } {
  return typeof value === 'object' && value !== null && MISSING_KEY in value &&
    MISSING_CODES.includes((value as Record<string, unknown>)[MISSING_KEY] as MissingCode);
}

function missingCodeOf(value: unknown): MissingCode | null {
  return isMissing(value) ? value[MISSING_KEY] : null;
}

/** Sans doublon et dans l'ordre canonique de `MISSING_CODES`, comme en base. */
export function sortMissingReasons(reasons: readonly string[]): string[] {
  const present = new Set(reasons);
  return MISSING_CODES.filter((c) => present.has(c));
}

export const FORBIDDEN_EXPORT_KEYS = [
  'full_name',
  'name',
  'patient_name',
  'first_name',
  'last_name',
  'date_of_birth',
  'dob',
  'birth_date',
  'phone',
  'address',
  'contact',
  'email',
];
export function assertNoIdentity(columns: string[]): void {
  const bad = columns.find((c) => FORBIDDEN_EXPORT_KEYS.includes(c.toLowerCase()));
  if (bad) throw new Error(`Colonne identifiante interdite a l'export: ${bad}`);
}

export const columnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `${field.scope}__${field.fieldKey}`;

/**
 * Colonne du CODE d'un champ de terminologie. Le libelle part dans la colonne principale
 * pour la lecture, le code dans celle-ci pour l'analyse : c'est lui qui reste stable quand
 * un libelle est corrige, et donc lui qui permet de regrouper sans scinder une maladie.
 */
export const codeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `terminology_code__${columnId(field)}`;

/**
 * Colonne du NOMBRE d'elements d'une variable multivaluee (L22).
 */
export const nbColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `nb__${columnId(field)}`;

/**
 * Colonne du CODE d'une liste controlee (L30) — meme convention que la terminologie, et
 * pour la meme raison : le libelle part dans la colonne principale pour la lecture, le
 * code dans celle-ci pour l'analyse. C'est le code qui reste stable quand un libelle est
 * corrige, donc lui qui permet de regrouper sans scinder une modalite en deux.
 */
export const optionCodeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `option_code__${columnId(field)}`;

const isOptionList = (field: Pick<ExportField, 'type'>) => field.type === 'select' || field.type === 'multiselect';

interface RawOption {
  value_key?: unknown;
  label?: unknown;
  is_active?: unknown;
}

/** Options d'une variable, avec repli sur les seuls codes pour un instantane ancien. */
function optionsOf(field: ExportField): { key: string; label: string; isActive: boolean }[] {
  if (Array.isArray(field.allowedOptions)) {
    return field.allowedOptions.flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const o = raw as RawOption;
      if (typeof o.value_key !== 'string' || o.value_key === '') return [];
      return [{
        key: o.value_key,
        label: typeof o.label === 'string' && o.label !== '' ? o.label : o.value_key,
        isActive: o.is_active !== false,
      }];
    });
  }
  return (field.allowedValues ?? [])
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map((v) => ({ key: v, label: v, isActive: true }));
}

/** Libelle d'un code stocke. Un code inconnu est rendu TEL QUEL, jamais efface. */
const labelOfOption = (field: ExportField, stored: unknown): string => {
  if (typeof stored !== 'string') return '';
  return optionsOf(field).find((o) => o.key === stored)?.label ?? stored;
};

/**
 * Les deux cellules d'une liste controlee : le libelle pour la lecture, le code pour
 * l'analyse. Un code de valeur manquante part dans la colonne principale, comme partout
 * ailleurs, et laisse la colonne de code vide.
 */
function optionCells(field: ExportField, v: unknown): { label: string; code: string } {
  const missing = missingCodeOf(v);
  if (missing) return { label: missing, code: '' };
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && MISSING_KEY in v) {
    throw new Error('Code de valeur manquante invalide');
  }
  if (v === null || v === undefined || v === '') return { label: '', code: '' };
  if (Array.isArray(v)) {
    const keys = v.filter((x): x is string => typeof x === 'string');
    return { label: keys.map((k) => labelOfOption(field, k)).join('; '), code: keys.join('; ') };
  }
  if (typeof v !== 'string') return { label: formatValue(v, field.type) as string, code: '' };
  return { label: labelOfOption(field, v), code: v };
}

const isTerminologyValue = (v: unknown): v is { code: string; label: string } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  typeof (v as { code?: unknown }).code === 'string' &&
  typeof (v as { label?: unknown }).label === 'string';

const isTerminologyList = (v: unknown): v is { code: string; label: string }[] =>
  Array.isArray(v) && v.length > 0 && v.every(isTerminologyValue);

export const formatValue = (v: unknown, type?: string): unknown => {
  if (v === null || v === undefined) return '';
  const missingCode = missingCodeOf(v);
  if (missingCode) return missingCode;
  if (typeof v === 'object' && v !== null && MISSING_KEY in v) {
    throw new Error('Code de valeur manquante invalide');
  }
  // Un diagnostic est un couple code + libelle (ou une liste de couples pour L22) :
  // sans ce cas, `String(v)` rendait « [object Object] » dans toute la colonne.
  if (isTerminologyValue(v)) return v.label;
  if (isTerminologyList(v)) return v.map((item) => item.label).join('; ');
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  // D14 : conserver les nombres natifs JS pour que SheetJS produise des cellules type=n
  if (typeof v === 'number') return v;
  if ((type === 'integer' || type === 'number') && typeof v === 'string' && v !== '' && NUMERIC_LITERAL.test(v)) {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return String(v);
};

const codeOf = (v: unknown): string => {
  if (isTerminologyValue(v)) return v.code;
  if (isTerminologyList(v)) return v.map((item) => item.code).join('; ');
  return '';
};

const nbOf = (v: unknown): number | '' => {
  if (v === null || v === undefined || v === '') return '';
  if (missingCodeOf(v)) return '';
  if (isTerminologyList(v)) return v.length;
  if (isTerminologyValue(v)) return 1;
  return '';
};

/**
 * Colonnes d'un jeu de champs : un champ de terminologie en occupe deux (ou trois si multivalué),
 * une liste contrôlée deux.
 */
export const columnsForFields = (fields: ExportField[]): string[] =>
  fields.flatMap((f) => {
    if (f.type === 'terminology') {
      if (f.isMultiple) {
        return [columnId(f), codeColumnId(f), nbColumnId(f)];
      }
      return [columnId(f), codeColumnId(f)];
    }
    if (isOptionList(f)) return [columnId(f), optionCodeColumnId(f)];
    return [columnId(f)];
  });

/** Union de deux listes d'options sur le code, la premiere rencontree fixant le libelle. */
function mergeOptionLists(a: unknown[] | null | undefined, b: unknown[] | null | undefined): unknown[] | null {
  if (!Array.isArray(a)) return Array.isArray(b) ? b : (a ?? null);
  if (!Array.isArray(b)) return a;
  const seen = new Set(
    a.map((o) => (o && typeof o === 'object' ? (o as RawOption).value_key : undefined))
      .filter((k): k is string => typeof k === 'string'),
  );
  const extra = b.filter((o) => {
    const key = o && typeof o === 'object' ? (o as RawOption).value_key : undefined;
    return typeof key === 'string' && !seen.has(key);
  });
  return extra.length ? [...a, ...extra] : a;
}

/** Unionne scope+field_key : une cle reste une variable malgre un renommage. */
export function mergeExportFields(input: ExportField[]): ExportField[] {
  // D13 : préserver l'ordre du formulaire (scope -> display_order -> fieldKey)
  const sorted = [...input].sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
    a.fieldKey.localeCompare(b.fieldKey) ||
    a.label.localeCompare(b.label)
  );
  const merged = new Map<string, ExportField>();
  for (const field of sorted) {
    const key = columnId(field);
    const versions = field.templateVersionIds ?? [];
    const previous = merged.get(key);
    if (previous) {
      previous.templateVersionIds = [...new Set([...(previous.templateVersionIds ?? []), ...versions])].sort();
      previous.isMultiple = Boolean(previous.isMultiple || field.isMultiple);
      // Une colonne peut traverser plusieurs versions dont les raisons different. Le
      // dictionnaire doit couvrir TOUT ce que la colonne peut contenir, sinon il decrit
      // une version et laisse un code inexplique en face d'une fiche plus ancienne.
      previous.missingReasons = sortMissingReasons([
        ...(previous.missingReasons ?? []),
        ...(field.missingReasons ?? []),
      ]);
      // Meme raison pour les options : une colonne peut traverser plusieurs versions dont
      // les listes different. Le dictionnaire doit couvrir TOUT ce que la colonne peut
      // contenir, sinon un code lu dans une fiche ancienne ne s'explique nulle part.
      previous.allowedOptions = mergeOptionLists(previous.allowedOptions, field.allowedOptions);
      // L31 : une colonne peut traverser des versions dont l'une seulement porte le libelle
      // de section (version anterieure au lot, ou section detachee). On garde le premier
      // libelle connu plutot que de laisser la colonne sans nom lisible.
      previous.sectionLabel = previous.sectionLabel ?? field.sectionLabel;
    } else {
      merged.set(key, {
        ...field,
        isMultiple: Boolean(field.isMultiple),
        templateVersionIds: [...new Set(versions)].sort(),
        missingReasons: field.missingReasons ? sortMissingReasons(field.missingReasons) : field.missingReasons,
      });
    }
  }
  // D13 : tri final respectant l'ordre d'affichage
  return [...merged.values()].sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
    a.fieldKey.localeCompare(b.fieldKey)
  );
}

export function referencedTemplateVersions(patients: ExportPatient[], encounters: ExportEncounter[]): string[] {
  return [
    ...new Set([
      ...patients.map((p) => p.templateVersionId),
      ...encounters.map((e) => e.templateVersionId),
    ].filter((id): id is string => Boolean(id))),
  ].sort();
}

const belongsToField = (versionId: string | undefined, field: ExportField) =>
  !versionId || !field.templateVersionIds?.length || field.templateVersionIds.includes(versionId);
const valueFor = (data: Record<string, unknown>, versionId: string | undefined, field: ExportField) =>
  belongsToField(versionId, field) ? formatValue(data[field.fieldKey], field.type) : '';

/** Renseigne la colonne du champ, et celle du code lorsqu'il s'agit d'une terminologie. */
function assignField(
  row: Record<string, unknown>,
  data: Record<string, unknown> | null,
  versionId: string | undefined,
  field: ExportField,
): void {
  const applicable = Boolean(data) && belongsToField(versionId, field);
  if (isOptionList(field)) {
    // L30 : le libelle dans la colonne principale, le code dans la sienne. C'est le code
    // qui reste stable quand un libelle est corrige, donc lui qui permet de compter.
    const cells = applicable ? optionCells(field, data![field.fieldKey]) : { label: '', code: '' };
    row[columnId(field)] = cells.label;
    row[optionCodeColumnId(field)] = cells.code;
    return;
  }
  row[columnId(field)] = data ? valueFor(data, versionId, field) : '';
  if (field.type !== 'terminology') return;
  row[codeColumnId(field)] = applicable ? codeOf(data![field.fieldKey]) : '';
  if (field.isMultiple) {
    row[nbColumnId(field)] = applicable ? nbOf(data![field.fieldKey]) : '';
  }
}

const formatAgeValue = (raw: unknown): unknown => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && NUMERIC_LITERAL.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return formatValue(raw);
};

export const MAX_INDICATOR_CODES = 100;

export function normalizeIndicatorSuffix(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'code';
}

export interface IndicatorMeta {
  columnId: string;
  field: ExportField;
  code: string;
  label: string;
}

export function extractMultivalueCodes(
  fields: ExportField[],
  dataRows: Array<{ data?: Record<string, unknown> | null; templateVersionId?: string }>,
): { indicatorsByField: Map<string, IndicatorMeta[]>; omittedFieldKeys: Set<string> } {
  const indicatorsByField = new Map<string, IndicatorMeta[]>();
  const omittedFieldKeys = new Set<string>();

  for (const f of fields.filter((field) => field.isMultiple)) {
    const rawCodes: string[] = [];
    const labelByCode = new Map<string, string>();

    for (const row of dataRows) {
      if (!row.data) continue;
      const val = row.data[f.fieldKey];
      if (isTerminologyList(val)) {
        for (const item of val) {
          rawCodes.push(item.code);
          if (!labelByCode.has(item.code)) labelByCode.set(item.code, item.label);
        }
      } else if (isTerminologyValue(val)) {
        rawCodes.push(val.code);
        if (!labelByCode.has(val.code)) labelByCode.set(val.code, val.label);
      }
    }

    const uniqueCodes = [...new Set(rawCodes)].sort();
    if (uniqueCodes.length > MAX_INDICATOR_CODES) {
      omittedFieldKeys.add(f.fieldKey);
      indicatorsByField.set(f.fieldKey, []);
    } else if (uniqueCodes.length > 0) {
      const indicators: IndicatorMeta[] = [];
      const seenSuffixes = new Map<string, number>();

      for (const code of uniqueCodes) {
        const baseNorm = normalizeIndicatorSuffix(code);
        const count = seenSuffixes.get(baseNorm) ?? 0;
        const norm = count > 0 ? `${baseNorm}_${count + 1}` : baseNorm;
        seenSuffixes.set(baseNorm, count + 1);

        indicators.push({
          columnId: `has__${columnId(f)}__${norm}`,
          field: f,
          code,
          label: labelByCode.get(code) ?? code,
        });
      }
      indicatorsByField.set(f.fieldKey, indicators);
    } else {
      indicatorsByField.set(f.fieldKey, []);
    }
  }

  return { indicatorsByField, omittedFieldKeys };
}

const hasCodeInValue = (v: unknown, targetCode: string): boolean => {
  if (isTerminologyList(v)) return v.some((item) => item.code === targetCode);
  if (isTerminologyValue(v)) return v.code === targetCode;
  return false;
};

const ENCOUNTER_META = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_value', 'age_unit'];
export function buildEncounterExport(encounters: ExportEncounter[], fields: ExportField[]): ExportTable {
  const encFields = mergeExportFields(fields).filter((f) => f.scope === 'encounter');
  const { indicatorsByField } = extractMultivalueCodes(encFields, encounters);

  const columns = [
    ...ENCOUNTER_META,
    ...encFields.flatMap((f) => {
      const base = columnsForFields([f]);
      const inds = (indicatorsByField.get(f.fieldKey) ?? []).map((i) => i.columnId);
      return [...base, ...inds];
    }),
  ];

  const rows = [...encounters].sort((a, b) =>
    a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) ||
    a.id.localeCompare(b.id)
  ).map((e) => {
    const row: Record<string, unknown> = {
      patient_code: e.patientCode,
      encounter_id: e.id,
      encounter_date: e.encounterDate,
      encounter_type: e.encounterType,
      age_value: formatAgeValue(e.ageValue ?? e.data.age_at_encounter),
      age_unit: e.ageUnit ?? '',
    };
    for (const f of encFields) {
      assignField(row, e.data, e.templateVersionId, f);
      const indicators = indicatorsByField.get(f.fieldKey) ?? [];
      const applicable = Boolean(e.data) && belongsToField(e.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !e.data || e.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(e.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(e.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
    }
    return row;
  });
  return { columns, rows };
}

const pickEncounter = (encounters: ExportEncounter[], rule: AggregationRule) => {
  const sorted = [...encounters].sort((a, b) =>
    a.encounterDate.localeCompare(b.encounterDate) || a.id.localeCompare(b.id)
  );
  return sorted.length ? (rule === 'first' ? sorted[0] : sorted[sorted.length - 1]) : null;
};
export function buildPatientExport(
  patients: ExportPatient[],
  encounters: ExportEncounter[],
  fields: ExportField[],
  rule: AggregationRule,
): ExportTable {
  const all = mergeExportFields(fields);
  const patientFields = all.filter((f) => f.scope === 'patient');
  const encounterFields = all.filter((f) => f.scope === 'encounter');

  const { indicatorsByField: patIndicators } = extractMultivalueCodes(patientFields, patients);
  const { indicatorsByField: encIndicators } = extractMultivalueCodes(encounterFields, encounters);

  const patientCols = patientFields.flatMap((f) => {
    const base = columnsForFields([f]);
    const inds = (patIndicators.get(f.fieldKey) ?? []).map((i) => i.columnId);
    return [...base, ...inds];
  });
  const encounterCols = encounterFields.flatMap((f) => {
    const base = columnsForFields([f]);
    const inds = (encIndicators.get(f.fieldKey) ?? []).map((i) => i.columnId);
    return [...base, ...inds];
  });

  const columns = [
    'patient_code',
    ...patientCols,
    'age_value',
    'age_unit',
    ...encounterCols,
  ];

  const byPatient = new Map<string, ExportEncounter[]>();
  for (const e of encounters) byPatient.set(e.patientCode, [...(byPatient.get(e.patientCode) ?? []), e]);
  const rows = [...patients].sort((a, b) => a.code.localeCompare(b.code)).map((p) => {
    const row: Record<string, unknown> = { patient_code: p.code };
    for (const f of patientFields) {
      assignField(row, p.data, p.templateVersionId, f);
      const indicators = patIndicators.get(f.fieldKey) ?? [];
      const applicable = Boolean(p.data) && belongsToField(p.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !p.data || p.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(p.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(p.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
    }
    const e = pickEncounter(byPatient.get(p.code) ?? [], rule);
    row.age_value = e ? formatAgeValue(e.ageValue ?? e.data.age_at_encounter) : '';
    row.age_unit = e?.ageUnit ?? '';
    for (const f of encounterFields) {
      assignField(row, e ? e.data : null, e?.templateVersionId, f);
      const indicators = encIndicators.get(f.fieldKey) ?? [];
      const applicable = Boolean(e?.data) && belongsToField(e?.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !e || !e.data || e.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(e.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(e.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
    }
    return row;
  });
  return { columns, rows };
}

/**
 * Construit la feuille dédiée pour un champ multivalué (L22 §7.3).
 */
export function buildMultivalueTable(
  field: ExportField,
  patients: ExportPatient[],
  encounters: ExportEncounter[],
): ExportTable {
  const columns = ['patient_code', 'encounter_id', 'rang', 'code', 'label'];
  const rows: Record<string, unknown>[] = [];

  if (field.scope === 'patient') {
    const sortedPatients = [...patients].sort((a, b) => a.code.localeCompare(b.code));
    for (const p of sortedPatients) {
      const raw = p.data ? p.data[field.fieldKey] : null;
      if (isTerminologyList(raw)) {
        raw.forEach((item, index) => {
          rows.push({
            patient_code: p.code,
            encounter_id: '',
            rang: index + 1,
            code: item.code,
            label: item.label,
          });
        });
      } else if (isTerminologyValue(raw)) {
        rows.push({
          patient_code: p.code,
          encounter_id: '',
          rang: 1,
          code: raw.code,
          label: raw.label,
        });
      }
    }
  } else {
    const sortedEncounters = [...encounters].sort((a, b) =>
      a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) ||
      a.id.localeCompare(b.id)
    );
    for (const e of sortedEncounters) {
      const raw = e.data ? e.data[field.fieldKey] : null;
      if (isTerminologyList(raw)) {
        raw.forEach((item, index) => {
          rows.push({
            patient_code: e.patientCode,
            encounter_id: e.id,
            rang: index + 1,
            code: item.code,
            label: item.label,
          });
        });
      } else if (isTerminologyValue(raw)) {
        rows.push({
          patient_code: e.patientCode,
          encounter_id: e.id,
          rang: 1,
          code: raw.code,
          label: raw.label,
        });
      }
    }
  }

  return { columns, rows };
}

export interface DictionaryOptions {
  indicatorsByField?: Map<string, IndicatorMeta[]>;
  omittedFieldKeys?: Set<string>;
}

export function buildDictionary(fields: ExportField[], options?: DictionaryOptions): ExportTable {
  const columns = [
    'column_id',
    'field_key',
    'label',
    'description',
    'scope',
    'section',
    'section_label',
    'type',
    'is_multiple',
    'unit',
    'allowed_values',
    'missing_reasons',
    'template_versions',
  ];
  return {
    columns,
    rows: mergeExportFields(fields).flatMap((f) => {
      const optionsList = isOptionList(f) ? optionsOf(f) : [];
      const common = {
        field_key: f.fieldKey,
        description: f.description ?? '',
        scope: f.scope,
        section: f.section,
        section_label: f.sectionLabel ?? '',
        is_multiple: f.isMultiple ? 'true' : 'false',
        unit: f.unit ?? '',
        allowed_values: isOptionList(f)
          ? optionsList.map((o) => (o.isActive ? o.label : `${o.label} (inactif)`)).join('; ')
          : Array.isArray(f.allowedValues)
          ? f.allowedValues.join('; ')
          : '',
        missing_reasons: (f.missingReasons ?? []).join('; '),
        template_versions: (f.templateVersionIds ?? []).join('; '),
      };
      const valueRow = { column_id: columnId(f), label: f.label, type: f.type, ...common };
      if (isOptionList(f)) {
        return [
          valueRow,
          {
            ...common,
            column_id: optionCodeColumnId(f),
            label: `${f.label} — code`,
            type: `${f.type}_code`,
            is_multiple: 'false',
            unit: '',
            allowed_values: optionsList.map((o) => o.key).join('; '),
            missing_reasons: '',
          },
        ];
      }
      if (f.type !== 'terminology') return [valueRow];
      const result = [
        valueRow,
        {
          ...common,
          column_id: codeColumnId(f),
          label: `${f.label} — code`,
          type: 'terminology_code',
          is_multiple: 'false',
          unit: '',
          allowed_values: '',
          missing_reasons: '',
        },
      ];
      if (f.isMultiple) {
        result.push({
          ...common,
          column_id: nbColumnId(f),
          label: `${f.label} — nombre`,
          type: 'computed_count',
          is_multiple: 'false',
          unit: '',
          allowed_values: '',
          missing_reasons: '',
        });

        const indicators = options?.indicatorsByField?.get(f.fieldKey) ?? [];
        for (const ind of indicators) {
          result.push({
            ...common,
            column_id: ind.columnId,
            label: `${f.label} — ${ind.code}`,
            type: 'computed_indicator',
            is_multiple: 'false',
            unit: '',
            allowed_values: ind.code,
            missing_reasons: '',
          });
        }
        if (options?.omittedFieldKeys?.has(f.fieldKey)) {
          result.push({
            ...common,
            column_id: `has__${columnId(f)}`,
            label: `${f.label} — indicateurs (>100 codes, voir feuille dédiée)`,
            type: 'computed_indicator_omitted',
            is_multiple: 'false',
            unit: '',
            allowed_values: '',
            missing_reasons: '',
          });
        }
      }
      return result;
    }),
  };
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
    rows: table.rows.map((row) =>
      Object.fromEntries(table.columns.map((column) => {
        const value = row[column];
        return [column, typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : value];
      }))
    ),
  };
}
function csvCell(value: unknown): string {
  const s = neutralizeSpreadsheetFormula(value === null || value === undefined ? '' : String(value));
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(table: ExportTable): string {
  assertNoIdentity(table.columns);
  return [
    table.columns.map(csvCell).join(','),
    ...table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
}
