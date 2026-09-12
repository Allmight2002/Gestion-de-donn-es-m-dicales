import type {
  DiagnosisConfiguration,
  DiagnosisContext,
  NewField,
  RuleBatchPayload,
  RuleBatchPlan,
  RuleBatchReceipt,
  TemplateCommonLayout,
  TemplateField,
  TemplateSection,
  TemplateVersion,
  ValidationRule,
} from '../../data/types';
import type { TemplateRepository } from '../../data/templates';

/**
 * Fixture fictive partageable entre les tests de l'éditeur et une vérification navigateur
 * locale. Elle dimensionne l'écran demandé sans reprendre de données cliniques réelles.
 *
 * La fixture contient 216 variables, 24 sections (8 blocs racines et 16 sous-sections) et
 * 26 règles. Les rubriques communes restent des variables sans section clinique ; leur
 * organisation est portée uniquement par `commonLayout`.
 */

export const EDITOR_REGISTRY_FIELD_COUNT = 216;
export const EDITOR_REGISTRY_SECTION_COUNT = 24;
export const EDITOR_REGISTRY_RULE_COUNT = 26;

export const EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY = 'diagnostics';
export const EDITOR_REGISTRY_DIAGNOSIS_COMPANION_KEY = 'diagnostics_autre';
/**
 * Publication terminologique fictive. Le moteur (`validateRule`) n'accepte `terminologyReleaseId`
 * que sous forme d'UUID : une fixture qui s'en écarterait produirait des règles que l'éditeur
 * déclare « non présentables en mode guidé », et la vérification ne prouverait plus rien.
 */
export const EDITOR_REGISTRY_DIAGNOSIS_RELEASE = '3f2b91c4-5d6e-4a71-9b02-7c8d4e5f6a10';
export const EDITOR_REGISTRY_COMMON_DIAGNOSIS_CODE = 'DX-COMMUN';
export const EDITOR_REGISTRY_UNCOVERED_DIAGNOSIS_CODE = 'DX-SANS-BLOC';

export const EDITOR_REGISTRY_ROOT_KEYS = [
  'bloc_01', 'bloc_02', 'bloc_03', 'bloc_04',
  'bloc_05', 'bloc_06', 'bloc_07', 'bloc_08',
] as const;

export const EDITOR_REGISTRY_SUBSECTION_KEYS = EDITOR_REGISTRY_ROOT_KEYS.flatMap((root) => [
  `${root}_a`, `${root}_b`,
]) as readonly string[];

export const EDITOR_REGISTRY_TARGET_SUBSECTION_KEY = 'bloc_08_b';
export const EDITOR_REGISTRY_TARGET_ROOT_KEY = 'bloc_08';

const diagnosisContext: DiagnosisContext = {
  scope: 'patient',
  diagnosisFieldKey: EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY,
  terminologyReleaseId: EDITOR_REGISTRY_DIAGNOSIS_RELEASE,
  commonOnlyCodes: [EDITOR_REGISTRY_COMMON_DIAGNOSIS_CODE],
  proposalFieldKey: EDITOR_REGISTRY_DIAGNOSIS_COMPANION_KEY,
  recognizedCodes: [
    'DX-AVC', 'DX-NEURO', 'DX-DIAB', 'DX-ENDO',
    EDITOR_REGISTRY_COMMON_DIAGNOSIS_CODE, EDITOR_REGISTRY_UNCOVERED_DIAGNOSIS_CODE,
    'DX-AUTRE',
  ],
};

const diagnosisConfiguration: DiagnosisConfiguration = {
  scope: diagnosisContext.scope,
  diagnosisFieldKey: diagnosisContext.diagnosisFieldKey,
  terminologyReleaseId: diagnosisContext.terminologyReleaseId,
  commonOnlyCodes: [...diagnosisContext.commonOnlyCodes],
};

function field(overrides: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label'>): TemplateField {
  return {
    scope: 'encounter',
    section: 'bloc_01',
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 0,
    ...overrides,
  };
}

const roots: TemplateSection[] = EDITOR_REGISTRY_ROOT_KEYS.map((key, index) => ({
  id: `section-${key}`,
  sectionKey: key,
  label: `Bloc ${String(index + 1).padStart(2, '0')}`,
  displayOrder: index * 3,
  parentSectionKey: null,
}));

const subsections: TemplateSection[] = roots.flatMap((root, rootIndex) => [
  {
    id: `section-${root.sectionKey}-a`,
    sectionKey: `${root.sectionKey}_a`,
    label: `${root.label} · Sous-section A`,
    displayOrder: rootIndex * 3 + 1,
    parentSectionKey: root.sectionKey,
  },
  {
    id: `section-${root.sectionKey}-b`,
    sectionKey: `${root.sectionKey}_b`,
    label: `${root.label} · Sous-section B`,
    displayOrder: rootIndex * 3 + 2,
    parentSectionKey: root.sectionKey,
  },
]);

export const editorRegistrySections: TemplateSection[] = [...roots, ...subsections];

const commonFields: TemplateField[] = [
  field({
    id: 'field-diagnostics',
    fieldKey: EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY,
    label: 'Diagnostics',
    scope: 'patient',
    section: null,
    sectionLabel: null,
    type: 'terminology',
    isMultiple: true,
    displayOrder: 0,
  }),
  field({
    id: 'field-diagnostics-autre',
    fieldKey: EDITOR_REGISTRY_DIAGNOSIS_COMPANION_KEY,
    label: 'Diagnostics — valeur proposée',
    scope: 'patient',
    section: null,
    sectionLabel: null,
    type: 'text',
    displayOrder: 1,
  }),
  field({ id: 'field-code', fieldKey: 'code_patient', label: 'Code patient', scope: 'patient', section: null, displayOrder: 2 }),
  field({ id: 'field-inclusion', fieldKey: 'date_inclusion', label: 'Date d’inclusion', scope: 'patient', section: null, type: 'date', displayOrder: 3 }),
  field({ id: 'field-centre', fieldKey: 'centre', label: 'Centre de prise en charge', scope: 'patient', section: null, type: 'select', allowedValues: ['centre_a', 'centre_b'], displayOrder: 4 }),
  field({ id: 'field-motif', fieldKey: 'motif_global', label: 'Motif global', scope: 'encounter', section: null, displayOrder: 5 }),
  field({ id: 'field-reference', fieldKey: 'date_reference', label: 'Date de référence', scope: 'encounter', section: null, type: 'date', displayOrder: 6 }),
  field({ id: 'field-statut', fieldKey: 'statut_global', label: 'Statut global', scope: 'patient', section: null, type: 'select', allowedValues: ['actif', 'clos'], displayOrder: 7 }),
];

const sectionFields: TemplateField[] = [];
let displayOrder = commonFields.length;
for (const [rootIndex, root] of roots.entries()) {
  for (let index = 0; index < 8; index += 1) {
    const type: TemplateField['type'] = index % 4 === 0 ? 'select' : index % 4 === 1 ? 'integer' : 'text';
    sectionFields.push(field({
      id: `field-${root.sectionKey}-direct-${index + 1}`,
      fieldKey: `${root.sectionKey}_direct_${String(index + 1).padStart(2, '0')}`,
      label: `${root.label} · Variable directe ${String(index + 1).padStart(2, '0')}`,
      section: root.sectionKey,
      sectionLabel: root.label,
      // La collecte est retrospective et transversale : la majorite des variables est portee
      // par la FICHE PATIENT, comme le pilote diagnostique. Une association diagnostic -> bloc
      // n'est reconnue par `diagnosticBlockRules` que si le bloc contient au moins une variable
      // de la MEME portee que le pilote : une fixture tout-rencontre rendrait « sans bloc »
      // chaque diagnostic pourtant associe.
      scope: index % 6 === 5 ? 'encounter' : 'patient',
      type,
      allowedValues: type === 'select' ? ['oui', 'non'] : null,
      required: (rootIndex + index) % 7 === 0,
      displayOrder: displayOrder++,
    }));
  }
  for (const suffix of ['a', 'b'] as const) {
    const subsectionKey = `${root.sectionKey}_${suffix}`;
    const subsection = subsections.find((candidate) => candidate.sectionKey === subsectionKey)!;
    for (let index = 0; index < 9; index += 1) {
      const type: TemplateField['type'] = index % 5 === 0 ? 'number' : index % 5 === 1 ? 'boolean' : 'text';
      sectionFields.push(field({
        id: `field-${subsectionKey}-${index + 1}`,
        fieldKey: `${subsectionKey}_variable_${String(index + 1).padStart(2, '0')}`,
        label: `${subsection.label} · Variable ${String(index + 1).padStart(2, '0')}`,
        section: subsectionKey,
        sectionLabel: subsection.label,
        parentSectionKey: root.sectionKey,
        parentSectionLabel: root.label,
        scope: index % 5 === 4 ? 'encounter' : 'patient',
        type,
        required: (rootIndex + index + suffix.charCodeAt(0)) % 11 === 0,
        displayOrder: displayOrder++,
      }));
    }
  }
}

export const editorRegistryFields: TemplateField[] = [...commonFields, ...sectionFields];

const rootVisibilityRules: ValidationRule[] = [
  {
    id: 'rule-diagnosis-bloc-01',
    rule: {
      if: {
        field: EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY,
        operator: 'contains_any',
        value: ['DX-AVC', 'DX-NEURO'],
        terminologyReleaseId: EDITOR_REGISTRY_DIAGNOSIS_RELEASE,
      },
      then: { section: 'bloc_01', operator: 'visible' },
    },
    message: null,
    severity: 'block',
  },
  {
    id: 'rule-diagnosis-bloc-04',
    rule: {
      if: {
        field: EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY,
        operator: 'contains_any',
        value: ['DX-DIAB', 'DX-ENDO'],
        terminologyReleaseId: EDITOR_REGISTRY_DIAGNOSIS_RELEASE,
      },
      then: { section: 'bloc_04', operator: 'visible' },
    },
    message: null,
    severity: 'block',
  },
];

const companionRule: ValidationRule = {
  id: 'rule-diagnosis-companion',
  rule: {
    if: {
      field: EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY,
      operator: 'contains_any',
      value: ['DX-AUTRE'],
      terminologyReleaseId: EDITOR_REGISTRY_DIAGNOSIS_RELEASE,
    },
    then: { field: EDITOR_REGISTRY_DIAGNOSIS_COMPANION_KEY, operator: 'visible' },
  },
  message: null,
  severity: 'block',
};

const genericRuleFields = sectionFields.filter((candidate) => candidate.type !== 'boolean');
const genericRules: ValidationRule[] = Array.from({ length: 23 }, (_, index) => {
  const source = genericRuleFields[(index * 3) % genericRuleFields.length];
  const target = genericRuleFields[(index * 3 + 1) % genericRuleFields.length];
  const comparison = index % 6 === 0;
  return {
    id: `rule-generic-${String(index + 1).padStart(2, '0')}`,
    rule: comparison
      ? { operator: 'greater_or_equal', left_field: source.fieldKey, right_field: target.fieldKey }
      : {
        if: { field: source.fieldKey, operator: 'equals', value: 'oui' },
        then: { field: target.fieldKey, operator: index % 4 === 0 ? 'visible' : 'required' },
      },
    message: null,
    severity: index % 5 === 0 ? 'warn' : 'block',
  };
});

export const editorRegistryRules: ValidationRule[] = [
  ...rootVisibilityRules,
  companionRule,
  ...genericRules,
];

export const editorRegistryCommonLayout: TemplateCommonLayout = {
  fingerprint: 'editor-registry-layout-v1',
  locked: false,
  inUse: false,
  defaultKey: 'contexte',
  sections: roots.map((section) => ({ key: section.sectionKey, label: section.label })),
  groups: [
    {
      key: 'contexte',
      label: 'Contexte commun',
      anchor: 0,
      isDefault: true,
      fields: ['code_patient', 'date_inclusion', EDITOR_REGISTRY_DIAGNOSIS_FIELD_KEY, EDITOR_REGISTRY_DIAGNOSIS_COMPANION_KEY],
    },
    {
      key: 'synthese',
      label: 'Synthèse commune',
      anchor: roots.length,
      isDefault: false,
      fields: ['centre', 'motif_global', 'date_reference', 'statut_global'],
    },
  ],
  unassigned: [],
};

export const editorRegistryVersion: TemplateVersion = {
  id: 'editor-registry-version',
  templateId: 'editor-registry-template',
  versionNumber: 7,
  status: 'draft',
  fieldCount: EDITOR_REGISTRY_FIELD_COUNT,
  diagnosisConfiguration: [diagnosisConfiguration],
  diagnosisContext: [{ ...diagnosisContext, commonOnlyCodes: [...diagnosisContext.commonOnlyCodes], recognizedCodes: [...diagnosisContext.recognizedCodes] }],
  commonLayout: editorRegistryCommonLayout,
};

export interface EditorRegistryFixture {
  version: TemplateVersion;
  fields: TemplateField[];
  sections: TemplateSection[];
  rules: ValidationRule[];
}

export const editorRegistryFixture: EditorRegistryFixture = {
  version: editorRegistryVersion,
  fields: editorRegistryFields,
  sections: editorRegistrySections,
  rules: editorRegistryRules,
};

/** Alias explicite pour les consommateurs qui préfèrent les constantes en capitales. */
export const EDITOR_REGISTRY_FIXTURE = editorRegistryFixture;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Petit dépôt mémoire pour les tests UI et les vérifications locales. Il n'effectue aucun
 * accès réseau ; chaque relecture renvoie une copie afin que les mutations de l'écran restent
 * soumises au même cycle lecture/écriture que l'application.
 */
export function createEditorRegistryRepository(): TemplateRepository {
  let currentVersion = clone(editorRegistryVersion);
  let currentFields = clone(editorRegistryFields);
  let currentSections = clone(editorRegistrySections);
  let currentRules = clone(editorRegistryRules);

  const getVersion = async () => ({
    version: clone(currentVersion),
    fields: clone(currentFields),
    rules: clone(currentRules),
    sections: clone(currentSections),
  });

  const repo: Partial<TemplateRepository> = {
    getVersion,
    getFields: async () => clone(currentFields),
    getSections: async () => clone(currentSections),
    setDiagnosisConfiguration: async (versionId, configuration) => {
      if (versionId !== currentVersion.id) throw new Error('Version introuvable');
      currentVersion = { ...currentVersion, diagnosisConfiguration: clone(configuration) };
      const previous = currentVersion.diagnosisContext ?? [];
      currentVersion.diagnosisContext = configuration.map((entry) => ({
        ...entry,
        proposalFieldKey: previous.find((item) => item.scope === entry.scope)?.proposalFieldKey
          ?? `${entry.diagnosisFieldKey}_autre`,
        recognizedCodes: previous.find((item) => item.scope === entry.scope)?.recognizedCodes ?? [],
      }));
    },
    setCommonLayout: async (versionId, _operationId, payload, _expectedFingerprint) => {
      if (versionId !== currentVersion.id) throw new Error('Version introuvable');
      currentVersion = {
        ...currentVersion,
        commonLayout: {
          ...clone(currentVersion.commonLayout ?? editorRegistryCommonLayout),
          defaultKey: payload.defaultKey ?? null,
          groups: clone(payload.groups).map((group) => ({ ...group, isDefault: group.key === payload.defaultKey })),
          unassigned: [],
        },
      };
      return clone(currentVersion.commonLayout!);
    },
    addSection: async (versionId, sectionKey, label, parentKey = null) => {
      const section: TemplateSection = {
        id: `section-${sectionKey}`,
        sectionKey,
        label,
        parentSectionKey: parentKey,
        displayOrder: currentSections.length,
      };
      if (versionId !== currentVersion.id) throw new Error('Version introuvable');
      currentSections = [...currentSections, section];
      return clone(section);
    },
    moveSection: async (_versionId, sectionId, parentKey) => {
      currentSections = currentSections.map((section) => section.id === sectionId ? { ...section, parentSectionKey: parentKey } : section);
    },
    reorderSectionSiblings: async (_versionId, parentKey, orderedIds) => {
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      currentSections = currentSections.map((section) => rank.has(section.id) && section.parentSectionKey === parentKey
        ? { ...section, displayOrder: rank.get(section.id)! }
        : section);
    },
    reorderSections: async (_versionId, orderedIds) => {
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      currentSections = currentSections.map((section) => rank.has(section.id) ? { ...section, displayOrder: rank.get(section.id)! } : section);
    },
    renameSection: async (sectionId, label) => {
      currentSections = currentSections.map((section) => section.id === sectionId ? { ...section, label } : section);
    },
    deleteSection: async (sectionId) => {
      const section = currentSections.find((candidate) => candidate.id === sectionId);
      if (section && currentFields.some((candidate) => candidate.section === section.sectionKey)) throw new Error('Section non vide');
      currentSections = currentSections.filter((candidate) => candidate.id !== sectionId);
    },
    listImportableSections: async () => [],
    updateField: async (fieldId, next: NewField) => {
      const previous = currentFields.find((candidate) => candidate.id === fieldId);
      if (!previous) throw new Error('Variable introuvable');
      const updated = { ...previous, ...clone(next), id: fieldId } as TemplateField;
      currentFields = currentFields.map((candidate) => candidate.id === fieldId ? updated : candidate);
      return clone(updated);
    },
    addField: async (_versionId, next: NewField, companion) => {
      const source = { ...clone(next), id: `field-${next.fieldKey}` } as TemplateField;
      const companionField = companion ? { ...clone(companion), id: `field-${companion.fieldKey}` } as TemplateField : null;
      currentFields = [...currentFields, source, ...(companionField ? [companionField] : [])];
      return clone(source);
    },
    deleteField: async (fieldId) => {
      currentFields = currentFields.filter((fieldItem) => fieldItem.id !== fieldId);
    },
    reorderFields: async (_versionId, orderedIds) => {
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      currentFields = currentFields.map((fieldItem) => rank.has(fieldItem.id)
        ? { ...fieldItem, displayOrder: rank.get(fieldItem.id)! }
        : fieldItem).sort((a, b) => a.displayOrder - b.displayOrder);
    },
    addRule: async (_versionId, rule, message, severity) => {
      const created: ValidationRule = { id: `rule-created-${currentRules.length + 1}`, rule: clone(rule), message, severity };
      currentRules = [...currentRules, created];
      return clone(created);
    },
    updateRule: async (ruleId, rule, message, severity) => {
      const existing = currentRules.find((candidate) => candidate.id === ruleId);
      if (!existing) throw new Error('Règle introuvable');
      const updated = { ...existing, rule: clone(rule), message, severity };
      currentRules = currentRules.map((candidate) => candidate.id === ruleId ? updated : candidate);
      return clone(updated);
    },
    deleteRule: async (ruleId) => {
      currentRules = currentRules.filter((candidate) => candidate.id !== ruleId);
    },
    previewRuleBatch: async (_versionId, payload: RuleBatchPayload): Promise<RuleBatchPlan> => ({
      fingerprint: 'editor-registry-rules-v1',
      severity: payload.severity ?? 'block',
      create: payload.targets.map((target) => ({ target })),
      duplicates: [],
      invalid: [],
      locked: false,
      inUse: false,
    }),
    createRuleBatch: async (_versionId, _operationId, payload, fingerprint): Promise<RuleBatchReceipt> => ({
      created: payload.targets.map((target, index) => ({ id: `rule-batch-${index + 1}`, target })),
      duplicates: [],
      fingerprint,
    }),
    publishVersion: async () => { currentVersion = { ...currentVersion, status: 'published' }; },
    archiveVersion: async () => { currentVersion = { ...currentVersion, status: 'archived' }; },
    duplicateVersion: async () => clone(currentVersion),
    createNextVersion: async () => clone({ ...currentVersion, id: `${currentVersion.id}-next`, versionNumber: currentVersion.versionNumber + 1, status: 'draft' }),
  };

  return repo as TemplateRepository;
}

/** Charge utile pratique pour une vérification navigateur qui sérialise la fixture. */
export function editorRegistryFixtureJson(): string {
  return JSON.stringify(editorRegistryFixture);
}

export type EditorRegistryRootKey = (typeof EDITOR_REGISTRY_ROOT_KEYS)[number];
