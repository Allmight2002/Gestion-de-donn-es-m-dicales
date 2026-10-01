// Formulaires de saisie (« Saisie rapide », « Admission », « Sortie »…) : une VUE de saisie
// sur les variables de fiche d'une base. Ce module ne decide que de ce qui est PROPOSE a
// l'ecran ; la visibilite, la validation et l'enregistrement restent ceux du formulaire
// complet, calcules sur toutes les variables et toutes les valeurs du dossier.
import type { TemplateField, TemplateSection, ValidationRule } from '../data/types';
import { parseFormula } from './fieldFormula';
import { findProposalField, isProposalSource, proposalKeysOf } from './proposalField';
import { visibilityRulesOf, visibilityTargetFieldKeys } from './templateRules';
import { repeatableFieldKeys } from './templateSections';

/** Section de presentation unique d'un formulaire court : l'ordre est celui du formulaire. */
export const ENTRY_FORM_SECTION_KEY = '__entry_form__';

export interface EntryFormDefinition {
  name: string;
  fieldKeys: readonly string[];
  requiredKeys: readonly string[];
}

export interface ResolvedEntryForm {
  /** Variables proposees, dans l'ordre du formulaire, dependances inserees avant leur cible
   *  (le champ « autre » d'une liste suit sa source, comme dans le formulaire complet). */
  fields: TemplateField[];
  /** Variables ajoutees automatiquement : elles conditionnent l'affichage ou le calcul d'une autre. */
  dependencyKeys: Set<string>;
  /** Variables saisissables depuis ce formulaire (variables proposees et champs « autre » associes). */
  editableKeys: Set<string>;
  /** Variables du formulaire absentes de la version courante (retirees depuis) : ignorees. */
  unavailableKeys: string[];
}

/**
 * Variables dont depend directement chaque variable : pilotes de ses regles d'affichage
 * (y compris celles portees par son bloc) et operandes de sa formule.
 */
export function directDependencies(
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[],
  sections?: readonly TemplateSection[] | null,
): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const add = (target: string, source: string) => {
    if (target === source) return;
    const current = deps.get(target) ?? [];
    if (!current.includes(source)) deps.set(target, [...current, source]);
  };
  for (const rule of visibilityRulesOf(rules.map((entry) => entry.rule))) {
    for (const target of visibilityTargetFieldKeys(rule, fields, sections)) add(target, rule.if.field);
  }
  for (const field of fields) {
    const parsed = field.formula ? parseFormula(field.formula) : null;
    if (!parsed) continue;
    for (const operand of [parsed.left, parsed.right]) {
      if (operand.kind === 'field') add(field.fieldKey, operand.fieldKey);
    }
  }
  return deps;
}

/**
 * Projette un formulaire de saisie sur les variables de fiche de la version courante.
 *
 * - l'ordre est celui choisi par le responsable, independamment des sections ;
 * - une variable qui en conditionne une autre (affichage ou calcul) est ajoutee juste avant
 *   la premiere variable qui en a besoin, recursivement : sans elle, la cible resterait
 *   masquee ou son calcul vide ;
 * - les variables d'un bloc repetable decrivent une occurrence et ne sont jamais proposees ;
 * - le caractere requis est celui du FORMULAIRE : les requis du formulaire complet ne bloquent
 *   pas un enregistrement partiel (le serveur garde ses propres regles selon le statut).
 */
export function resolveEntryForm(
  form: EntryFormDefinition,
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[] = [],
  sections?: readonly TemplateSection[] | null,
): ResolvedEntryForm {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const groupKeys = repeatableFieldKeys(fields, sections);
  const companions = proposalKeysOf(fields);
  // Le champ « autre » d'une liste suit sa source : le choisir seul revient a choisir la source.
  const sourceOfCompanion = new Map<string, string>();
  for (const field of fields) {
    if (!isProposalSource(field)) continue;
    const companion = findProposalField(fields, field);
    if (companion) sourceOfCompanion.set(companion.fieldKey, field.fieldKey);
  }
  const usable = (key: string) => byKey.has(key) && !groupKeys.has(key);
  const deps = directDependencies(fields, rules, sections);
  const required = new Set(form.requiredKeys);
  const requested = new Set<string>();
  const unavailableKeys: string[] = [];
  for (const raw of form.fieldKeys) {
    const key = sourceOfCompanion.get(raw) ?? raw;
    if (!usable(key)) { unavailableKeys.push(raw); continue; }
    requested.add(key);
    if (required.has(raw)) required.add(key);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const dependencyKeys = new Set<string>();
  const visit = (key: string) => {
    if (placed.has(key) || visiting.has(key)) return; // un cycle (refuse a l'enregistrement) ne boucle pas
    visiting.add(key);
    for (const dep of deps.get(key) ?? []) {
      const source = sourceOfCompanion.get(dep) ?? dep;
      if (!usable(source)) continue;
      if (!requested.has(source)) dependencyKeys.add(source);
      visit(source);
    }
    visiting.delete(key);
    placed.add(key);
    ordered.push(key);
  };
  for (const key of requested) visit(key);

  // Le champ « autre » d'une liste suit sa source dans la liste : l'ecran le rend AVEC elle.
  const withCompanions = ordered.flatMap((key) => {
    const companion = isProposalSource(byKey.get(key)!) ? findProposalField(fields, byKey.get(key)!) : undefined;
    return companion && companions.has(companion.fieldKey) && !groupKeys.has(companion.fieldKey) ? [key, companion.fieldKey] : [key];
  });
  const editableKeys = new Set(withCompanions);
  const resolved = withCompanions.map((key, index) => ({
    ...byKey.get(key)!,
    section: ENTRY_FORM_SECTION_KEY,
    sectionId: null,
    sectionLabel: form.name,
    sectionOrder: 0,
    parentSectionKey: null,
    parentSectionLabel: null,
    displayOrder: index,
    required: !dependencyKeys.has(key) && required.has(key),
  } satisfies TemplateField));
  return { fields: resolved, dependencyKeys, editableKeys, unavailableKeys };
}

/** Regles utiles a l'affichage seulement : un formulaire court n'impose pas les requis conditionnels. */
export function visibilityOnlyRules<T extends Pick<ValidationRule, 'rule'>>(rules: readonly T[]): T[] {
  const visibility = new Set(visibilityRulesOf(rules.map((entry) => entry.rule)));
  return rules.filter((entry) => visibility.has(entry.rule as never));
}

/**
 * Valeurs a enregistrer depuis un formulaire court : une valeur PROPOSEE par le jeu de
 * variables et jamais touchee n'est envoyee que si sa variable est affichee. Sans formulaire
 * court (`shownKeys` nul), les valeurs sont rendues telles quelles.
 */
export function withoutUnshownProposals(
  data: Record<string, unknown>,
  prefilled: ReadonlySet<string>,
  shownKeys: ReadonlySet<string> | null,
): Record<string, unknown> {
  if (!shownKeys) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !prefilled.has(key) || shownKeys.has(key)));
}
