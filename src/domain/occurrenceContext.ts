// L74c — contexte patient d'une occurrence de groupe répétable (cadrage L74, §3 et §3.1).
//
// Une variable PERMANENTE peut commander l'affichage d'une variable d'occurrence. La visibilité
// d'une occurrence se calcule donc sur `contexte ⊕ occurrence`, où le contexte est le
// sous-ensemble de portée `patient` de la fiche. Tout le reste — obligations conditionnelles,
// comparaisons, validation des valeurs — se calcule sur l'occurrence SEULE, comme avant. Le
// contexte n'est jamais écrit dans l'occurrence.
//
// Miroir de `occurrence_evaluation_data` côté serveur (L74a). Une version sans règle de
// contexte rend exactement le verdict d'avant : c'est la non-régression du lot.

import type { TemplateField, TemplateSection, ValidationRule } from '../data/types';
import {
  evaluateRules, hiddenFieldKeys, validateValues, visibilityCascadeFieldKeys, withoutHiddenValues,
} from './validation';

/**
 * Contexte d'évaluation d'une occurrence.
 *
 * `keys` liste les variables permanentes de la version qui porte l'occurrence : une variable
 * pilote de cet ensemble est lue sur la fiche, même vide. `values` ne garde que les valeurs
 * permanentes AFFICHÉES de la fiche — une variable masquée sur la fiche se lit comme absente,
 * exactement comme dans le point fixe serveur.
 */
export type OccurrenceContext = {
  keys: ReadonlySet<string>;
  values: Readonly<Record<string, unknown>>;
};

export const EMPTY_OCCURRENCE_CONTEXT: OccurrenceContext = { keys: new Set<string>(), values: {} };

/**
 * Contexte tiré des valeurs COURANTES d'une fiche (enregistrées ou non).
 *
 * `fields` est le dictionnaire de la version de l'occurrence ; seules ses variables de portée
 * `patient` entrent dans le contexte. `patientHidden` est l'ensemble masqué de la fiche : une
 * valeur qui ne s'affiche pas sur la fiche ne pilote rien dans l'occurrence.
 */
export function occurrenceContextOf(
  patientValues: Readonly<Record<string, unknown>>,
  fields: readonly Pick<TemplateField, 'fieldKey' | 'scope'>[],
  patientHidden: ReadonlySet<string> = new Set<string>(),
): OccurrenceContext {
  const keys = new Set(fields.filter((field) => field.scope === 'patient').map((field) => field.fieldKey));
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patientValues)) {
    if (keys.has(key) && !patientHidden.has(key)) values[key] = value;
  }
  return { keys, values };
}

/**
 * Données d'évaluation de la visibilité : `occurrence ⊕ contexte`.
 *
 * `field_key` est unique par version toutes portées confondues : la fusion ne peut pas créer de
 * collision. Le contexte est appliqué en dernier, comme `p_data || contexte` côté serveur, et
 * seules les clés permanentes de la version y entrent.
 */
export function occurrenceEvaluationData(
  values: Readonly<Record<string, unknown>>,
  context: OccurrenceContext = EMPTY_OCCURRENCE_CONTEXT,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) if (!context.keys.has(key)) merged[key] = value;
  for (const [key, value] of Object.entries(context.values)) if (context.keys.has(key)) merged[key] = value;
  return merged;
}

/** Ensemble masqué d'une occurrence, calculé sur `contexte ⊕ occurrence`. */
export function occurrenceHiddenFieldKeys(
  rules: readonly { rule: unknown }[],
  values: Readonly<Record<string, unknown>>,
  fields: readonly TemplateField[],
  sections: readonly TemplateSection[] | null | undefined,
  context: OccurrenceContext = EMPTY_OCCURRENCE_CONTEXT,
): Set<string> {
  return hiddenFieldKeys(rules, occurrenceEvaluationData(values, context), fields, sections);
}

const driverOf = (rule: unknown): string | null => {
  if (typeof rule !== 'object' || rule === null) return null;
  const condition = (rule as { if?: unknown }).if;
  if (typeof condition !== 'object' || condition === null) return null;
  const field = (condition as { field?: unknown }).field;
  return typeof field === 'string' ? field : null;
};

/**
 * Variables masquées par le CONTEXTE seul, donc dans TOUTES les occurrences quelles que soient
 * leurs valeurs : une règle pilotée par une variable permanente qui n'est pas satisfaite, plus
 * la cascade (une variable dont le pilote est toujours masqué est toujours masquée).
 *
 * Le tableau d'occurrences retire ces colonnes ; un masquage qui dépend des valeurs d'une
 * occurrence reste, lui, au niveau de la cellule.
 */
export function contextHiddenFieldKeys(
  rules: readonly { rule: unknown }[],
  fields: readonly TemplateField[],
  sections: readonly TemplateSection[] | null | undefined,
  context: OccurrenceContext = EMPTY_OCCURRENCE_CONTEXT,
): Set<string> {
  if (context.keys.size === 0) return new Set<string>();
  const contextRules = rules.filter((entry) => {
    const driver = driverOf(entry.rule);
    return driver !== null && context.keys.has(driver);
  });
  if (contextRules.length === 0) return new Set<string>();
  const roots = hiddenFieldKeys(contextRules, { ...context.values }, fields, sections);
  return visibilityCascadeFieldKeys(rules.map((entry) => entry.rule), roots, fields, sections);
}

export type OccurrenceVerdict = {
  /** Ensemble masqué calculé sur `contexte ⊕ occurrence`. */
  hidden: Set<string>;
  /** Le payload à enregistrer : l'occurrence SEULE, sans valeur masquée ni clé permanente. */
  data: Record<string, unknown>;
  /** Valeurs saisies que le masquage retire, à annoncer avant l'enregistrement. */
  removed: string[];
  /** Règles bloquantes non respectées, évaluées sur l'occurrence seule (§3.1). */
  ruleErrors: string[];
  /** Occurrence complète : le statut SUIT la complétude, il ne la décrète pas. */
  complete: boolean;
};

/**
 * Verdict d'une occurrence avant écriture, commun à la correction (`RepeatableGroup`) et à la
 * création de fiche (`PendingRepeatableGroup`).
 *
 * Séparation §3.1 : le contexte n'entre QUE dans l'ensemble masqué. Les règles et la validation
 * lisent l'occurrence seule ; une règle `required` ou de comparaison inter-fiches reste donc
 * inerte, comme aujourd'hui (D2, D3).
 */
export function occurrenceVerdict({
  rules, fields, sections, values, context = EMPTY_OCCURRENCE_CONTEXT,
}: {
  rules: readonly ValidationRule[];
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[] | null | undefined;
  values: Readonly<Record<string, unknown>>;
  context?: OccurrenceContext;
}): OccurrenceVerdict {
  const hidden = occurrenceHiddenFieldKeys(rules, values, fields, sections, context);
  const own = Object.fromEntries(Object.entries(values).filter(([key]) => !context.keys.has(key)));
  const { values: data, removed } = withoutHiddenValues(own, hidden);
  const ruleErrors = evaluateRules(
    rules.map((rule) => ({ rule: rule.rule, message: rule.message, severity: rule.severity })),
    data,
    hidden,
  ).blocking;
  const complete = validateValues([...fields], data, true, hidden).length === 0 && ruleErrors.length === 0;
  return { hidden, data, removed, ruleErrors, complete };
}

/**
 * Une ligne déjà saisie que la fiche a rendue incohérente : une de ses valeurs est désormais
 * masquée, ou elle se disait complète et ne l'est plus. Le serveur la refuserait au rejeu ; elle
 * doit être revue avant l'enregistrement, jamais corrigée en silence.
 */
export function occurrenceNeedsReview(
  row: { data: Readonly<Record<string, unknown>>; validationStatus: string },
  evaluation: Omit<Parameters<typeof occurrenceVerdict>[0], 'values'>,
): boolean {
  const verdict = occurrenceVerdict({ ...evaluation, values: row.data });
  return verdict.removed.length > 0 || (row.validationStatus === 'complete' && !verdict.complete);
}
