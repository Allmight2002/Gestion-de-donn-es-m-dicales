import type {
  DiagnosisConfiguration,
  DiagnosisContext,
  NewField,
  TemplateCommonLayout,
  TemplateField,
  TemplateSection,
  TemplateVersion,
  ValidationRule,
} from '../data/types';
import type { TemplateRepository } from '../data/templates';
import type { FormDefinition, FormPreparationPayload } from '../data/formPreparations';
import { optionKeys, toRawOptions } from './fieldOptions';

export interface PreparationEditorLoaded {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
  sections: TemplateSection[];
}

export interface PreparationTemplateRepository extends TemplateRepository {
  /** Charge utile structurelle courante, sans identifiant technique ni donnée clinique. */
  getPreparationPayload(): FormPreparationPayload;
}

type DefinitionEntry = Record<string, unknown>;

const FIELD_TYPES: TemplateField['type'][] = [
  'text', 'integer', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology',
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function fieldType(value: unknown, fallback: TemplateField['type'] = 'text'): TemplateField['type'] {
  return typeof value === 'string' && (FIELD_TYPES as string[]).includes(value)
    ? value as TemplateField['type']
    : fallback;
}

function scopeOf(value: unknown, fallback: TemplateField['scope'] = 'patient'): TemplateField['scope'] {
  return value === 'encounter' || value === 'patient' ? value : fallback;
}

function entriesOf(value: unknown): DefinitionEntry[] {
  return Array.isArray(value) ? value as DefinitionEntry[] : [];
}

function sectionMap(sections: readonly TemplateSection[]) {
  return new Map(sections.map((section) => [section.sectionKey, section]));
}

function diagnosisConfigurationOf(value: unknown): DiagnosisConfiguration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    const scope = candidate.scope === 'encounter' || candidate.scope === 'patient' ? candidate.scope : null;
    const diagnosisFieldKey = candidate.diagnosisFieldKey;
    if (!scope || typeof diagnosisFieldKey !== 'string') return [];
    return [{
      scope,
      diagnosisFieldKey,
      terminologyReleaseId: nullableString(candidate.terminologyReleaseId),
      commonOnlyCodes: stringArray(candidate.commonOnlyCodes),
    }];
  });
}

function contextForConfiguration(
  configuration: readonly DiagnosisConfiguration[],
  source: readonly DiagnosisContext[] | undefined,
): DiagnosisContext[] {
  return configuration.map((entry) => {
    const previous = source?.find((candidate) => candidate.scope === entry.scope);
    return {
      ...entry,
      proposalFieldKey: previous?.proposalFieldKey ?? `${entry.diagnosisFieldKey}_autre`,
      recognizedCodes: previous?.recognizedCodes ?? [],
    };
  });
}

function idFor(kind: 'field' | 'section' | 'rule', key: string, index: number): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `form-preparation-${kind}-${safe || index}`;
}

function sourceFieldOf(source: PreparationEditorLoaded, fieldKey: string): TemplateField | undefined {
  return source.fields.find((field) => field.fieldKey === fieldKey);
}

function sourceSectionOf(source: PreparationEditorLoaded, sectionKey: string): TemplateSection | undefined {
  return source.sections.find((section) => section.sectionKey === sectionKey);
}

function asSections(definition: FormDefinition, source: PreparationEditorLoaded): TemplateSection[] {
  return entriesOf(definition.sections).flatMap((entry, index) => {
    const sectionKey = stringValue(entry.sectionKey);
    if (!sectionKey) return [];
    const original = sourceSectionOf(source, sectionKey);
    return [{
      id: idFor('section', sectionKey, index),
      sectionKey,
      label: stringValue(entry.label, original?.label ?? sectionKey),
      displayOrder: numberValue(entry.displayOrder, original?.displayOrder ?? index),
      parentSectionKey: hasOwn(entry, 'parentSectionKey')
        ? nullableString(entry.parentSectionKey) : original?.parentSectionKey ?? null,
    }];
  }).sort((a, b) => a.displayOrder - b.displayOrder || a.sectionKey.localeCompare(b.sectionKey));
}

type PreparationField = TemplateField & { commonGroupKey?: string | null };

function asFields(
  definition: FormDefinition,
  source: PreparationEditorLoaded,
  sections: readonly TemplateSection[],
): PreparationField[] {
  const bySection = sectionMap(sections);
  return entriesOf(definition.fields).flatMap((entry, index) => {
    const fieldKey = stringValue(entry.fieldKey);
    if (!fieldKey) return [];
    const original = sourceFieldOf(source, fieldKey);
    const section = hasOwn(entry, 'sectionKey') ? nullableString(entry.sectionKey) : original?.section ?? null;
    const sectionRow = section ? bySection.get(section) : undefined;
    return [{
      id: idFor('field', fieldKey, index),
      fieldKey,
      label: stringValue(entry.label, original?.label ?? fieldKey),
      description: nullableString(entry.description),
      defaultValue: nullableString(entry.defaultValue),
      scope: scopeOf(entry.scope, original?.scope ?? 'patient'),
      section,
      sectionId: sectionRow?.id ?? null,
      sectionLabel: sectionRow?.label ?? null,
      sectionOrder: sectionRow?.displayOrder ?? null,
      parentSectionKey: sectionRow?.parentSectionKey ?? null,
      parentSectionLabel: sectionRow?.parentSectionKey
        ? bySection.get(sectionRow.parentSectionKey)?.label
        : undefined,
      type: fieldType(entry.type, original?.type ?? 'text'),
      isMultiple: booleanValue(entry.isMultiple, original?.isMultiple ?? false),
      unit: nullableString(entry.unit),
      allowedValues: Array.isArray(entry.allowedValues) ? clone(entry.allowedValues) : null,
      allowedOptions: Array.isArray(entry.allowedOptions) ? clone(entry.allowedOptions) : null,
      required: booleanValue(entry.required, original?.required ?? false),
      minValue: nullableNumber(entry.minValue),
      maxValue: nullableNumber(entry.maxValue),
      allowMissingCodes: booleanValue(entry.allowMissingCodes, original?.allowMissingCodes ?? false),
      missingReasons: Array.isArray(entry.missingReasons) ? clone(entry.missingReasons) : null,
      formula: nullableString(entry.formula),
      displayOrder: numberValue(entry.displayOrder, original?.displayOrder ?? index),
      encounterTypes: Array.isArray(entry.encounterTypes) ? stringArray(entry.encounterTypes) : null,
      // Les données existantes verrouillent l'identité structurelle, exactement comme dans
      // l'éditeur réel. Une variable candidate créée ici reste libre jusqu'à l'application.
      inUse: original?.inUse ?? false,
      commonGroupKey: nullableString(entry.commonGroupKey),
    }];
  }).sort((a, b) => a.displayOrder - b.displayOrder || a.fieldKey.localeCompare(b.fieldKey));
}

function asRules(definition: FormDefinition): ValidationRule[] {
  return entriesOf(definition.rules).flatMap((entry, index) => {
    if (!entry.rule || typeof entry.rule !== 'object' || Array.isArray(entry.rule)) return [];
    return [{
      id: idFor('rule', String(index), index),
      rule: clone(entry.rule),
      message: entry.message === null ? null : stringValue(entry.message),
      severity: entry.severity === 'warn' ? 'warn' : 'block',
    }];
  });
}

function commonLayoutOf(
  definition: FormDefinition,
  source: PreparationEditorLoaded,
  fields: readonly PreparationField[],
  sections: readonly TemplateSection[],
): TemplateCommonLayout | undefined {
  // Une `commonLayout` absente est une vraie limite de capacité serveur. Ne pas transformer
  // une charge utile candidate en organisation UX-16 apparemment éditable sur un serveur ancien.
  const sourceLayout = source.version.commonLayout;
  if (sourceLayout === undefined) return undefined;
  const commonFields = fields.filter((field) => field.section === null);
  const groups = entriesOf(definition.commonGroups).flatMap((entry) => {
    const key = stringValue(entry.groupKey);
    if (!key) return [];
    return [{
      key,
      label: stringValue(entry.label, key),
      anchor: numberValue(entry.anchorOrder, numberValue(entry.displayOrder, 0)),
      isDefault: booleanValue(entry.isDefault, false),
      fields: commonFields.filter((field) => field.commonGroupKey === key).map((field) => field.fieldKey),
    }];
  });
  const assigned = new Set(groups.flatMap((group) => group.fields));
  return {
    fingerprint: sourceLayout.fingerprint,
    locked: false,
    inUse: false,
    defaultKey: groups.find((group) => group.isDefault)?.key ?? groups[0]?.key ?? sourceLayout.defaultKey,
    sections: sections.filter((section) => !section.parentSectionKey)
      .map((section) => ({ key: section.sectionKey, label: section.label })),
    groups,
    unassigned: commonFields.filter((field) => !assigned.has(field.fieldKey)).map((field) => field.fieldKey),
  };
}

/**
 * Projection de la définition structurelle vers la vue attendue par l'éditeur réel.
 * Elle ne sert qu'à l'affichage et à l'édition : la définition reste la référence.
 */
export function loadedFromPreparation(
  source: PreparationEditorLoaded,
  definition: FormDefinition,
): PreparationEditorLoaded {
  const sections = asSections(definition, source);
  const fields = asFields(definition, source, sections);
  const diagnosisConfiguration = diagnosisConfigurationOf(definition.diagnosisConfiguration);
  const version: TemplateVersion = {
    ...clone(source.version),
    // Le candidat s'édite même quand la version source est publiée ou déjà utilisée.
    // C'est E2, et non ce drapeau client, qui décide de son applicabilité.
    status: 'draft',
    diagnosisConfiguration,
    diagnosisContext: contextForConfiguration(diagnosisConfiguration, source.version.diagnosisContext),
    commonLayout: commonLayoutOf(definition, source, fields, sections),
  };
  return { version, fields, rules: asRules(definition), sections };
}

function nextOrder(entries: readonly DefinitionEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, numberValue(entry.displayOrder, 0)), -1) + 1;
}

/**
 * Attributs qu'un formulaire de variable peut changer, dans la forme exacte que le serveur
 * publie et relit. Le miroir `allowedValues`/`allowedOptions` suit la règle de `templates.ts` :
 * les options riches font foi dès qu'elles existent.
 */
function editableFieldEntry(field: NewField): DefinitionEntry {
  return {
    fieldKey: field.fieldKey,
    label: field.label,
    scope: field.scope,
    sectionKey: field.section ?? null,
    type: field.type,
    unit: field.unit ?? null,
    allowedValues: field.allowedOptions ? optionKeys(field.allowedOptions) : field.allowedValues ?? null,
    allowedOptions: field.allowedOptions ? toRawOptions(field.allowedOptions) : null,
    required: field.required,
    minValue: field.minValue ?? null,
    maxValue: field.maxValue ?? null,
    allowMissingCodes: field.allowMissingCodes ?? false,
    encounterTypes: field.encounterTypes ?? null,
    description: field.description ?? null,
    defaultValue: field.defaultValue ?? null,
    missingReasons: field.missingReasons ?? null,
    isMultiple: field.isMultiple ?? false,
    formula: field.formula ?? null,
  };
}

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error('FORM_CHANGE_UNSUPPORTED'));
}

/**
 * Adapte l'éditeur de version réel à un candidat structurel.
 *
 * La DÉFINITION rendue par le serveur est l'état de référence : chaque commande de l'éditeur
 * la modifie sur place, et la vue de l'éditeur en est recalculée. Une partie du formulaire que
 * personne n'a touchée repart donc au serveur telle qu'elle en est venue, y compris les clés
 * que ce module ne connaît pas. C'est indispensable : E1 compare le candidat à la source objet
 * par objet, et une simple clé reconstruite ferait classer toute l'évolution comme sémantique.
 *
 * L'adaptateur laisse volontairement indéfinies les méthodes serveur L59/L60 : leurs RPC
 * écrivent une version active et aucune RPC de préparation n'accepte encore leurs plans.
 */
export function createPreparationTemplateRepository(
  source: PreparationEditorLoaded,
  definition: FormDefinition,
  onChanged?: (loaded: PreparationEditorLoaded) => void,
): PreparationTemplateRepository {
  let current = clone(definition);
  let loaded = loadedFromPreparation(source, current);

  const commit = (next: FormDefinition): void => {
    current = next;
    loaded = loadedFromPreparation(source, current);
    onChanged?.(clone(loaded));
  };
  const withSections = (sections: DefinitionEntry[]) => commit({ ...current, sections });
  const withFields = (fields: DefinitionEntry[]) => commit({ ...current, fields });
  const withRules = (rules: DefinitionEntry[]) => commit({ ...current, rules });

  const assertVersion = (versionId: string): void => {
    if (versionId !== loaded.version.id) throw new Error('FORM_PREPARATION_INVALID');
  };
  const sectionKeyOf = (sectionId: string): string => {
    const section = loaded.sections.find((entry) => entry.id === sectionId);
    if (!section) throw new Error('FORM_PREPARATION_INVALID');
    return section.sectionKey;
  };
  const fieldKeyOf = (fieldId: string): string => {
    const field = loaded.fields.find((entry) => entry.id === fieldId);
    if (!field) throw new Error('FORM_PREPARATION_INVALID');
    return field.fieldKey;
  };
  const ruleIndexOf = (ruleId: string): number => {
    const index = loaded.rules.findIndex((entry) => entry.id === ruleId);
    if (index < 0) throw new Error('FORM_PREPARATION_INVALID');
    return index;
  };
  const rankBySectionId = (orderedIds: readonly string[]) => new Map(
    orderedIds.flatMap((id, index) => {
      const section = loaded.sections.find((entry) => entry.id === id);
      return section ? [[section.sectionKey, index] as const] : [];
    }),
  );

  const repository: PreparationTemplateRepository = {
    getVersion: async () => clone(loaded),
    getPreparationPayload: () => clone({
      ...current,
      provenance: {
        sourceTemplateVersionId: source.version.id,
        sourceVersionNumber: source.version.versionNumber,
      },
    }),
    getFields: async () => clone(loaded.fields),
    getSections: async () => clone(loaded.sections),

    setDiagnosisConfiguration: async (versionId, configuration) => {
      assertVersion(versionId);
      commit({ ...current, diagnosisConfiguration: clone(configuration) });
    },

    setCommonLayout: async (versionId, _operationId, payload, _expectedFingerprint) => {
      assertVersion(versionId);
      if (!loaded.version.commonLayout) throw new Error('FORM_CHANGE_UNSUPPORTED');
      const groupOfField = new Map<string, string>(
        payload.groups.flatMap((group) => group.fields.map((fieldKey) => [fieldKey, group.key] as const)),
      );
      const defaultKey = payload.defaultKey ?? null;
      commit({
        ...current,
        commonGroups: payload.groups.map((group, index) => ({
          groupKey: group.key,
          label: group.label,
          displayOrder: index,
          anchorOrder: group.anchor,
          isDefault: group.key === defaultKey,
        })),
        fields: entriesOf(current.fields).map((entry) => (
          nullableString(entry.sectionKey) === null
            ? { ...entry, commonGroupKey: groupOfField.get(stringValue(entry.fieldKey)) ?? null }
            : entry
        )),
      });
      const layout = loaded.version.commonLayout;
      if (!layout) throw new Error('FORM_CHANGE_UNSUPPORTED');
      return clone(layout);
    },

    addSection: async (versionId, sectionKey, label, parentKey = null) => {
      assertVersion(versionId);
      const sections = entriesOf(current.sections);
      withSections([...sections, {
        sectionKey, label, displayOrder: nextOrder(sections), parentSectionKey: parentKey,
      }]);
      const created = loaded.sections.find((section) => section.sectionKey === sectionKey);
      if (!created) throw new Error('FORM_PREPARATION_INVALID');
      return clone(created);
    },

    renameSection: async (sectionId, label) => {
      const key = sectionKeyOf(sectionId);
      withSections(entriesOf(current.sections).map((entry) => (
        stringValue(entry.sectionKey) === key ? { ...entry, label } : entry
      )));
    },

    deleteSection: async (sectionId) => {
      const key = sectionKeyOf(sectionId);
      const hasChild = entriesOf(current.sections)
        .some((entry) => nullableString(entry.parentSectionKey) === key);
      const hasField = entriesOf(current.fields)
        .some((entry) => nullableString(entry.sectionKey) === key);
      if (hasChild || hasField) throw new Error('FORM_CHANGE_UNSUPPORTED');
      withSections(entriesOf(current.sections).filter((entry) => stringValue(entry.sectionKey) !== key));
    },

    reorderSections: async (versionId, orderedIds) => {
      assertVersion(versionId);
      const rank = rankBySectionId(orderedIds);
      withSections(entriesOf(current.sections).map((entry) => {
        const order = rank.get(stringValue(entry.sectionKey));
        return order === undefined ? entry : { ...entry, displayOrder: order };
      }));
    },

    reorderSectionSiblings: async (versionId, parentKey, orderedIds) => {
      assertVersion(versionId);
      const rank = rankBySectionId(orderedIds);
      withSections(entriesOf(current.sections).map((entry) => {
        const order = rank.get(stringValue(entry.sectionKey));
        return order === undefined || nullableString(entry.parentSectionKey) !== parentKey
          ? entry
          : { ...entry, displayOrder: order };
      }));
    },

    moveSection: async (versionId, sectionId, parentKey) => {
      assertVersion(versionId);
      const key = sectionKeyOf(sectionId);
      withSections(entriesOf(current.sections).map((entry) => (
        stringValue(entry.sectionKey) === key ? { ...entry, parentSectionKey: parentKey } : entry
      )));
    },

    addField: async (versionId, field, companion) => {
      assertVersion(versionId);
      const fields = entriesOf(current.fields);
      const order = nextOrder(fields);
      const added = [field, ...(companion ? [companion] : [])].map((entry, index) => ({
        ...editableFieldEntry(entry),
        displayOrder: order + index,
        // Une variable commune nouvelle reste non affectée : c'est l'espace UX-16 qui la place.
        commonGroupKey: null,
      }));
      withFields([...fields, ...added]);
      const created = loaded.fields.find((entry) => entry.fieldKey === field.fieldKey);
      if (!created) throw new Error('FORM_PREPARATION_INVALID');
      return clone(created);
    },

    updateField: async (fieldId, field) => {
      const key = fieldKeyOf(fieldId);
      const fields = entriesOf(current.fields);
      const index = fields.findIndex((entry) => stringValue(entry.fieldKey) === key);
      if (index < 0) throw new Error('FORM_PREPARATION_INVALID');
      const previous = fields[index];
      const section = field.section ?? null;
      withFields(fields.map((entry, position) => (position === index ? {
        ...previous,
        ...editableFieldEntry(field),
        displayOrder: numberValue(previous.displayOrder, index),
        // Une variable rattachée à un bloc ne peut pas rester dans une rubrique commune.
        commonGroupKey: section === null ? nullableString(previous.commonGroupKey) : null,
      } : entry)));
      const updated = loaded.fields.find((entry) => entry.fieldKey === field.fieldKey);
      if (!updated) throw new Error('FORM_PREPARATION_INVALID');
      return clone(updated);
    },

    deleteField: async (fieldId) => {
      const key = fieldKeyOf(fieldId);
      if (loaded.fields.find((entry) => entry.fieldKey === key)?.inUse) {
        throw new Error('FORM_CHANGE_UNSUPPORTED');
      }
      withFields(entriesOf(current.fields).filter((entry) => stringValue(entry.fieldKey) !== key));
    },

    reorderFields: async (versionId, orderedIds) => {
      assertVersion(versionId);
      const rank = new Map(orderedIds.flatMap((id, index) => {
        const field = loaded.fields.find((entry) => entry.id === id);
        return field ? [[field.fieldKey, index] as const] : [];
      }));
      withFields(entriesOf(current.fields).map((entry) => {
        const order = rank.get(stringValue(entry.fieldKey));
        return order === undefined ? entry : { ...entry, displayOrder: order };
      }));
    },

    addRule: async (versionId, rule, message, severity) => {
      assertVersion(versionId);
      withRules([...entriesOf(current.rules), { rule: clone(rule), message, severity }]);
      const created = loaded.rules[loaded.rules.length - 1];
      if (!created) throw new Error('FORM_PREPARATION_INVALID');
      return clone(created);
    },

    updateRule: async (ruleId, rule, message, severity) => {
      const index = ruleIndexOf(ruleId);
      withRules(entriesOf(current.rules).map((entry, position) => (
        position === index ? { ...entry, rule: clone(rule), message, severity } : entry
      )));
      const updated = loaded.rules[index];
      if (!updated) throw new Error('FORM_PREPARATION_INVALID');
      return clone(updated);
    },

    deleteRule: async (ruleId) => {
      const index = ruleIndexOf(ruleId);
      withRules(entriesOf(current.rules).filter((_entry, position) => position !== index));
    },

    // Ces méthodes sont volontairement inatteignables depuis la préparation. Un refus explicite
    // fait échouer un appel futur accidentel au lieu de le laisser écrire ailleurs.
    listTemplates: unsupported,
    createTemplate: unsupported,
    createPersonalTemplate: unsupported,
    createTemplateBundle: unsupported,
    publishVersion: unsupported,
    archiveVersion: unsupported,
    duplicateVersion: unsupported,
    createNextVersion: unsupported,
    promoteToGlobal: unsupported,
    renameTemplate: unsupported,
    deleteTemplate: unsupported,
  };
  return repository;
}
