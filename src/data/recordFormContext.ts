import type {
  RecordFormContext,
  RecordFormDefinitionState,
} from './patients';
import type {
  FieldScope,
  TemplateField,
} from './types';

/** Extrait l'identifiant d'une définition renvoyée par le contexte serveur. */
export function definitionVersionId(definition: Record<string, unknown> | null | undefined): string | null {
  if (!definition || typeof definition !== 'object') return null;
  const version = definition.version;
  if (!version || typeof version !== 'object') return null;
  const id = (version as Record<string, unknown>).id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Prépare le dictionnaire affiché par les formulaires : les champs historiques restent présents,
 * puis les ajouts de la définition active sont ajoutés. La décision « compatible » vient du
 * contexte calculé côté serveur ; le navigateur ne compare jamais les types pour autoriser une
 * écriture.
 */
export function mergeRecordFormFields(
  context: RecordFormContext,
  historicalFields: readonly TemplateField[],
  activeFields: readonly TemplateField[],
  scope: FieldScope,
): TemplateField[] {
  const historicalByKey = new Map(historicalFields.filter((field) => field.scope === scope).map((field) => [field.fieldKey, field]));
  const activeByKey = new Map(activeFields.filter((field) => field.scope === scope).map((field) => [field.fieldKey, field]));
  const chosen = new Map<string, TemplateField>();

  for (const item of context.fields.filter((field) => field.scope === scope)) {
    const historical = historicalByKey.get(item.field_key);
    const active = activeByKey.get(item.field_key);
    const field = fieldForContextItem(item.definition_state, item.applicability_reason, historical, active);
    if (field) chosen.set(field.fieldKey, field);
  }

  // Filet de lecture : une définition compatible mal renseignée ne doit jamais faire disparaître
  // une variable historique du formulaire. Les écritures restent, elles, entièrement contrôlées
  // par la RPC E3.
  for (const field of historicalByKey.values()) if (!chosen.has(field.fieldKey)) chosen.set(field.fieldKey, field);
  for (const field of activeByKey.values()) if (!chosen.has(field.fieldKey)) chosen.set(field.fieldKey, field);

  return [...chosen.values()].sort((left, right) => left.displayOrder - right.displayOrder || left.fieldKey.localeCompare(right.fieldKey));
}

function fieldForContextItem(
  definitionState: RecordFormDefinitionState,
  applicabilityReason: string,
  historical: TemplateField | undefined,
  active: TemplateField | undefined,
): TemplateField | undefined {
  if (definitionState === 'not_defined') return active ?? historical;
  if (applicabilityReason === 'definition_incompatible' || !active) return historical ?? active;
  return active ?? historical;
}

/** Les ajouts requis sont signalés dans l'interface mais ne rendent pas rétroactivement une fiche curatée invalide. */
export function fieldsForLocalValidation(
  fields: readonly TemplateField[],
  context: RecordFormContext | null,
): TemplateField[] {
  if (!context) return [...fields];
  const stateByKey = new Map(context.fields.map((field) => [field.field_key, field.definition_state]));
  return fields.map((field) => stateByKey.get(field.fieldKey) === 'not_defined'
    ? { ...field, required: false }
    : field);
}

/** Un RPC absent signale une version de serveur antérieure, pas une perte de droits ou de données. */
export function isMissingRecordFormContextError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== 'PGRST202' && candidate.code !== '42883') return false;
  return typeof candidate.message === 'string'
    && /read_(patient|encounter)_form_context/i.test(candidate.message);
}
