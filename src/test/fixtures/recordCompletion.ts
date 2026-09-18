// Fixture ENTIÈREMENT FICTIVE d'une base dont le formulaire a évolué (lot E5).
//
// Une même définition sert aux tests web et au banc de vérification navigateur, pour que la
// saisie réelle soit jugée sur exactement ce que les tests affirment. Aucun nom, aucune donnée
// clinique réelle, aucun accès réseau : le contexte serveur est reconstruit ici avec les mêmes
// décisions que la RPC E3 (définition historique + définition active, applicabilité par le
// moteur de règles et le type de rencontre, obligations du formulaire courant).

import type { BaseListing, BaseRepository } from '../../data/bases';
import type { RecordFormContext, RecordFormFieldContext } from '../../data/patients';
import type { TemplateRepository } from '../../data/templates';
import type {
  DiagnosisContext, TemplateField, TemplateSection, ValidationRule,
} from '../../data/types';
import { hiddenFieldKeys } from '../../domain/validation';

/** Révision de définition sous laquelle les fiches de la fixture ont été enregistrées. */
export const RECORD_VERSION = 'v-old';
/** Révision active de la base après l'évolution additive appliquée. */
export const ACTIVE_VERSION = 'v-new';
export const FIXTURE_BASE_ID = 'b1';

export const fixtureBaseListing: BaseListing = {
  base: {
    id: FIXTURE_BASE_ID, name: 'Base fictive', specialty: null, ownerUserId: 'u',
    currentTemplateVersionId: ACTIVE_VERSION,
  },
  role: 'owner',
  permissions: {
    canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: true,
    canExportData: false, canManageAccess: true,
  },
  templateName: 'Formulaire fictif',
  versionNumber: 2,
};

function field(
  fieldKey: string, label: string, scope: 'patient' | 'encounter', section: string, displayOrder: number,
  extra: Partial<TemplateField> = {},
): TemplateField {
  return {
    id: `${scope}:${fieldKey}`, fieldKey, label, section, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder, scope, ...extra,
  };
}

// Deux blocs diagnostiques et une sous-section : la sous-section doit rester une étape de
// parcours distincte, et son parent n'est qu'un contexte au-dessus d'elle.
export const fixtureSections: TemplateSection[] = [
  { id: 's-clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 },
  { id: 's-suivi', sectionKey: 'suivi', label: 'Suivi', displayOrder: 1 },
  { id: 's-d1', sectionKey: 'blocD1', label: 'Bloc D1', displayOrder: 2 },
  { id: 's-d1-detail', sectionKey: 'blocD1detail', label: 'Bloc D1 detail', displayOrder: 3, parentSectionKey: 'blocD1' },
  { id: 's-d2', sectionKey: 'blocD2', label: 'Bloc D2', displayOrder: 4 },
];

const historicalPatientFields: TemplateField[] = [
  field('diagnostic', 'Diagnostics retenus', 'patient', 'clinique', 0, { type: 'multiselect', allowedValues: ['D1', 'D2', 'D3'] }),
  field('historique', 'Valeur historique', 'patient', 'clinique', 1),
];
const addedPatientFields: TemplateField[] = [
  field('ajout_facultatif', 'Ajout facultatif', 'patient', 'suivi', 2),
  field('ajout_requis', 'Ajout obligatoire', 'patient', 'suivi', 3, { required: true }),
  field('bloc_d1', 'Variable du bloc D1', 'patient', 'blocD1', 4),
  field('bloc_d1_detail', 'Variable du detail D1', 'patient', 'blocD1detail', 5),
  field('bloc_d2', 'Variable du bloc D2', 'patient', 'blocD2', 6),
];

const historicalEncounterFields: TemplateField[] = [
  field('mesure', 'Mesure historique', 'encounter', 'clinique', 0, { type: 'integer' }),
];
const addedEncounterFields: TemplateField[] = [
  field('ajout_rencontre', 'Ajout rencontre facultatif', 'encounter', 'suivi', 1, { type: 'integer' }),
  field('ajout_rencontre_requis', 'Ajout rencontre obligatoire', 'encounter', 'suivi', 2, { type: 'integer', required: true }),
  field('ajout_autre_type', 'Ajout reserve au suivi', 'encounter', 'suivi', 3, { encounterTypes: ['suivi'] }),
];

/** Associations diagnostiques : les mêmes objets `validation_rule` que L51/L52/L55. */
export const fixtureRules: ValidationRule[] = [
  {
    id: 'r-d1', severity: 'block', message: 'Bloc D1',
    rule: { if: { field: 'diagnostic', operator: 'contains_any', value: ['D1'] }, then: { section: 'blocD1', operator: 'visible' } },
  },
  {
    id: 'r-d2', severity: 'block', message: 'Bloc D2',
    rule: { if: { field: 'diagnostic', operator: 'contains_any', value: ['D2'] }, then: { section: 'blocD2', operator: 'visible' } },
  },
];

export const fixtureDiagnosisContext: DiagnosisContext[] = [{
  scope: 'patient', diagnosisFieldKey: 'diagnostic', terminologyReleaseId: null, commonOnlyCodes: [],
  proposalFieldKey: 'diagnostic_propose', recognizedCodes: ['D1', 'D2', 'D3'],
}];

export const fixtureFieldsOf = (versionId: string): TemplateField[] => (versionId === RECORD_VERSION
  ? [...historicalPatientFields, ...historicalEncounterFields]
  : [...historicalPatientFields, ...addedPatientFields, ...historicalEncounterFields, ...addedEncounterFields]);

export const fixtureTemplateRepository: TemplateRepository = {
  async getVersion(versionId: string) {
    return {
      version: {
        id: versionId, templateId: 't1', versionNumber: versionId === RECORD_VERSION ? 1 : 2,
        status: 'published' as const,
        diagnosisContext: versionId === RECORD_VERSION ? undefined : fixtureDiagnosisContext,
      },
      fields: fixtureFieldsOf(versionId),
      rules: versionId === RECORD_VERSION ? [] : fixtureRules,
      sections: fixtureSections,
    };
  },
} as unknown as TemplateRepository;

export const fixtureBaseRepository: BaseRepository = {
  async getBase() { return fixtureBaseListing; },
} as unknown as BaseRepository;

const isEmpty = (value: unknown) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0);

/**
 * Contexte E3 d'une fiche : ce que le serveur enverrait pour cette définition et ces valeurs.
 * Les écrans ne recalculent ni la compatibilité ni l'applicabilité ; ils affichent ce contexte.
 */
export function fixtureRecordContext(
  kind: 'patient' | 'encounter', recordId: string, data: Record<string, unknown>,
  { recordRevision = 3, encounterType = null as string | null, validationStatus = 'curated' } = {},
): RecordFormContext {
  const activeFields = fixtureFieldsOf(ACTIVE_VERSION).filter((item) => item.scope === kind);
  const historical = fixtureFieldsOf(RECORD_VERSION).filter((item) => item.scope === kind);
  const hidden = hiddenFieldKeys(fixtureRules, data, activeFields, fixtureSections);
  const appliesToType = (item: TemplateField) => kind !== 'encounter' || !encounterType
    || !item.encounterTypes || item.encounterTypes.length === 0 || item.encounterTypes.includes(encounterType);
  const contextField = (item: TemplateField, defined: boolean): RecordFormFieldContext => {
    const applicable = !hidden.has(item.fieldKey) && appliesToType(item)
      && activeFields.some((active) => active.fieldKey === item.fieldKey);
    return {
      field_key: item.fieldKey,
      definition_revision: defined ? RECORD_VERSION : ACTIVE_VERSION,
      active_definition_revision: ACTIVE_VERSION,
      scope: kind,
      definition_state: defined ? 'defined' : 'not_defined',
      applicability: applicable ? 'applicable' : 'not_applicable',
      applicability_reason: applicable
        ? (defined ? 'applicable' : 'new_addition')
        : hidden.has(item.fieldKey) ? 'rule_hidden' : 'encounter_type',
      value_state: !applicable ? 'not_applicable' : isEmpty(data[item.fieldKey]) ? 'empty' : 'present',
      provenance: null,
      definition: { fieldKey: item.fieldKey },
      active_definition: { fieldKey: item.fieldKey },
      ...(applicable && !isEmpty(data[item.fieldKey]) ? { value: data[item.fieldKey] } : {}),
    };
  };
  const historicalKeys = new Set(historical.map((item) => item.fieldKey));
  const fields = [
    ...historical.map((item) => contextField(item, true)),
    ...activeFields.filter((item) => !historicalKeys.has(item.fieldKey)).map((item) => contextField(item, false)),
  ];
  const obligations = activeFields
    .filter((item) => item.required && !hidden.has(item.fieldKey) && appliesToType(item) && isEmpty(data[item.fieldKey]))
    .map((item) => ({
      field_key: item.fieldKey,
      label: item.label,
      definition_revision: historicalKeys.has(item.fieldKey) ? RECORD_VERSION : ACTIVE_VERSION,
      reason: historicalKeys.has(item.fieldKey) ? 'missing_value' as const : 'not_defined' as const,
    }));
  return {
    record_kind: kind,
    record_id: recordId,
    record_revision: recordRevision,
    base_id: FIXTURE_BASE_ID,
    active_revision: 2,
    record_definition_revision: RECORD_VERSION,
    historical_definition: { version: { id: RECORD_VERSION } },
    active_definition: { version: { id: ACTIVE_VERSION } },
    fields,
    values: data,
    current_obligations: obligations,
    completeness: {
      current_missing_field_keys: obligations.map((item) => item.field_key),
      current_missing_count: obligations.length,
      current_complete: obligations.length === 0,
      historical_missing_field_keys: [],
      historical_missing_count: 0,
      historical_complete: true,
    },
    diagnosis_coverage: null,
    validation_status: validationStatus,
    encounter_type: encounterType,
    context_fingerprint: `sha256:${'a'.repeat(64)}`,
  };
}
