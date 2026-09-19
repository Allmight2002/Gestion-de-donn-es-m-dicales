// E5 — complétion des dossiers existants.
//
// Après une évolution additive du formulaire, une fiche déjà enregistrée porte des variables
// qui n'existaient pas au moment de sa saisie. Ce module ne fabrique aucune décision : il lit
// le contexte calculé par le serveur (E3) et n'en tire qu'une PRÉSENTATION — quelles variables
// annoncer « À renseigner », combien en attend le formulaire courant, et lesquelles sont encore
// vides dans la saisie en cours. La compatibilité, l'applicabilité et l'autorisation restent des
// décisions serveur ; l'écran ne les recalcule pas et n'invente aucune valeur.

import type { RecordFormContext } from '../data/patients';
import type { TemplateField, TemplateSection, ValidationRule } from '../data/types';
import { isCalculatedField } from './fieldFormula';
import { repeatableFieldKeys } from './templateSections';
import { hiddenFieldKeys } from './validation';

export interface RecordCompletionSummary {
  /** Variables ajoutées après la révision de la fiche et applicables dans son contexte. */
  additionKeys: ReadonlySet<string>;
  /** Variables attendues par le formulaire courant, telles que le serveur les a comptées. */
  obligationKeys: ReadonlySet<string>;
  /** Sous-ensemble des obligations dues à un ajout postérieur à la fiche. */
  addedObligationKeys: ReadonlySet<string>;
  /** Libellés d'obligation renvoyés par le serveur, pour l'affichage seul. */
  labelByKey: ReadonlyMap<string, string>;
  /** Manques de la définition historique : ils ne sont pas créés par l'évolution. */
  historicalMissingCount: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Résumé de présentation d'un contexte E3. Sans contexte (serveur antérieur, hors connexion),
 * il n'y a rien à annoncer : l'écran garde exactement son parcours d'avant.
 */
export function recordCompletionSummary(context: RecordFormContext | null | undefined): RecordCompletionSummary | null {
  if (!context) return null;
  const additionKeys = new Set(context.fields
    .filter((item) => item.definition_state === 'not_defined' && item.applicability === 'applicable')
    .map((item) => item.field_key));
  const obligationKeys = new Set(context.current_obligations.map((item) => item.field_key));
  const addedObligationKeys = new Set(context.current_obligations
    .filter((item) => item.reason === 'not_defined')
    .map((item) => item.field_key));
  const labelByKey = new Map(context.current_obligations.map((item) => [item.field_key, item.label]));
  return {
    additionKeys,
    obligationKeys,
    addedObligationKeys,
    labelByKey,
    historicalMissingCount: context.completeness.historical_missing_count,
  };
}

/** Une valeur absente, nulle, vide ou sans option retenue reste « à renseigner ». Un code de
 * valeur manquante explicitement choisi est, lui, une réponse : il ne compte plus comme vide. */
const isEmptyValue = (value: unknown): boolean => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0);

/**
 * Parmi des clés décidées par le serveur, celles qui restent vides dans la saisie en cours.
 * Le compteur suit donc la frappe sans jamais élargir l'ensemble choisi par le serveur ; une
 * variable masquée par une règle d'affichage sort du compte tant qu'elle n'est pas rendue.
 */
export function stillEmptyKeys(
  keys: ReadonlySet<string>,
  values: Record<string, unknown>,
  hidden: ReadonlySet<string> = EMPTY_SET,
): Set<string> {
  const remaining = new Set<string>();
  for (const key of keys) {
    if (hidden.has(key)) continue;
    if (isEmptyValue(values[key])) remaining.add(key);
  }
  return remaining;
}

/**
 * Variables du formulaire ACTIF absentes de la définition de la fiche, pour une restitution en
 * lecture. Elle n'autorise rien : c'est la même lecture de présentation que celle déjà faite
 * pour masquer un bloc, et le serveur reste seul juge au moment de l'écriture.
 */
export function addedFieldsForRecord({
  activeFields, activeRules, activeSections, recordFieldKeys, data, encounterType,
}: {
  activeFields: readonly TemplateField[];
  activeRules: readonly ValidationRule[];
  activeSections?: readonly TemplateSection[] | null;
  recordFieldKeys: ReadonlySet<string>;
  data: Record<string, unknown>;
  encounterType?: string | null;
}): TemplateField[] {
  const hidden = hiddenFieldKeys(activeRules, data, activeFields, activeSections);
  // §5 — une variable de bloc répétable décrit une OCCURRENCE, pas la fiche : elle ne se
  // renseigne pas ici et le formulaire ne la rend jamais (voir `EncounterFields`). L'annoncer
  // « à renseigner » enverrait vers un champ qui n'existe nulle part sur cet écran.
  const grouped = repeatableFieldKeys(activeFields, activeSections);
  return activeFields.filter((field) => !recordFieldKeys.has(field.fieldKey)
    && !grouped.has(field.fieldKey)
    && !hidden.has(field.fieldKey)
    && !isCalculatedField(field)
    && isEmptyValue(data[field.fieldKey])
    && (!encounterType || !field.encounterTypes || field.encounterTypes.length === 0
      || field.encounterTypes.includes(encounterType)));
}
