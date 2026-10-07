// L74d — espaces d'evaluation des regles (docs/l74-contexte-patient-occurrences.md, §2 et §4 D5).
//
// Chaque regle s'evalue sur UNE fiche : la fiche patient, une rencontre ordinaire, ou une
// occurrence d'un groupe repetable. Une regle dont les operandes ne sont pas lus sur la meme
// fiche ne fonctionne jamais (regles dormantes P1 a P5), a une exception pres, apportee par
// L74 et limitee a l'AFFICHAGE (D2) : une variable permanente peut commander l'affichage d'une
// variable de groupe, l'occurrence etant evaluee sur `contexte patient ⊕ occurrence`.
//
// Module PUR, sans React ni i18n : l'editeur s'en sert pour guider et refuser a l'ecriture,
// et L74e le reprend tel quel pour signaler les regles existantes. Les verdicts doivent rester
// alignes sur `assert_rule_structure` (refus a l'ecriture, jamais au rejeu des invariants).

import type { TemplateField, TemplateSection } from '../data/types';
import { sectionKeyOf } from './templateSections';

export type RuleSpace =
  | { kind: 'patient' }
  | { kind: 'encounter' }
  /** Groupe repetable designe par SA section, a quelque profondeur qu'il soit. */
  | { kind: 'group'; sectionKey: string };

export const RULE_SPACE_PROBLEMS = [
  /** `visible` sur une variable : ni meme espace, ni pilote permanent vers une cible de groupe. */
  'visible_cross_space',
  /** `required` : pilote et cible ne sont pas lus sur la meme fiche (P3). */
  'required_cross_space',
  /** Comparaison : les deux operandes ne sont pas lus sur la meme fiche (P4). */
  'comparison_cross_space',
  /** Affichage d'un bloc portant un groupe enfant, pilote par une variable non permanente (P5). */
  'block_group_driver',
  /** Affichage d'un bloc pilote par une variable de groupe : la fiche ne lit pas ses occurrences. */
  'block_driver_in_group',
] as const;
export type RuleSpaceProblem = (typeof RULE_SPACE_PROBLEMS)[number];

export type RuleSpaceVerdict =
  /** `patientContext` : la condition est lue sur la fiche patient pour une cible de groupe. */
  | { usable: true; patientContext: boolean }
  | { usable: false; problem: RuleSpaceProblem };

type SpaceField = Pick<TemplateField, 'fieldKey' | 'scope' | 'section'>;
type SpaceSection = Pick<TemplateSection, 'sectionKey' | 'parentSectionKey' | 'isRepeatable'>;

const USABLE: RuleSpaceVerdict = { usable: true, patientContext: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Groupe repetable qui porte cette section : elle-meme ou l'un de ses ancetres. Une boucle
 * dans un instantane corrompu s'arrete sans verdict de groupe.
 */
function repeatableAncestorOf(sectionKey: string, sections: readonly SpaceSection[]): string | null {
  const byKey = new Map(sections.map((section) => [section.sectionKey, section]));
  const seen = new Set<string>();
  let current = byKey.get(sectionKey);
  while (current && !seen.has(current.sectionKey)) {
    if (current.isRepeatable === true) return current.sectionKey;
    seen.add(current.sectionKey);
    current = current.parentSectionKey ? byKey.get(current.parentSectionKey) : undefined;
  }
  return null;
}

/**
 * Espace d'evaluation d'une variable. Une variable permanente est toujours lue sur la fiche
 * patient (un groupe ne porte que des variables de rencontre, la base le garantit) ; une
 * variable de rencontre l'est dans son groupe si l'une de ses sections est repetable, sinon
 * sur la rencontre ordinaire.
 */
export function fieldRuleSpace(field: SpaceField, sections?: readonly SpaceSection[] | null): RuleSpace {
  if (field.scope === 'patient') return { kind: 'patient' };
  const group = repeatableAncestorOf(sectionKeyOf(field), sections ?? []);
  return group ? { kind: 'group', sectionKey: group } : { kind: 'encounter' };
}

export function sameRuleSpace(a: RuleSpace, b: RuleSpace): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'group' || a.sectionKey === (b as { sectionKey: string }).sectionKey;
}

/** Le bloc porte-t-il un groupe repetable parmi ses descendants (L72) ? */
export function sectionCarriesGroup(sectionKey: string, sections?: readonly SpaceSection[] | null): boolean {
  return (sections ?? []).some((section) => section.isRepeatable === true
    && section.sectionKey !== sectionKey
    && isDescendantOf(section, sectionKey, sections ?? []));
}

function isDescendantOf(section: SpaceSection, ancestorKey: string, sections: readonly SpaceSection[]): boolean {
  const byKey = new Map(sections.map((candidate) => [candidate.sectionKey, candidate]));
  const seen = new Set<string>();
  let parentKey = section.parentSectionKey ?? null;
  while (parentKey && !seen.has(parentKey)) {
    if (parentKey === ancestorKey) return true;
    seen.add(parentKey);
    parentKey = byKey.get(parentKey)?.parentSectionKey ?? null;
  }
  return false;
}

/**
 * Verdict d'une regle d'affichage ou d'obligation sur une VARIABLE, a partir des deux espaces.
 * Sert aussi a filtrer les pilotes proposes pour une cible deja choisie.
 */
export function fieldRuleVerdict(
  verb: 'visible' | 'required',
  driver: RuleSpace,
  target: RuleSpace,
): RuleSpaceVerdict {
  if (sameRuleSpace(driver, target)) return USABLE;
  if (verb === 'visible' && driver.kind === 'patient' && target.kind === 'group') {
    return { usable: true, patientContext: true };
  }
  return { usable: false, problem: verb === 'visible' ? 'visible_cross_space' : 'required_cross_space' };
}

/**
 * Verdict d'une regle d'affichage d'un BLOC entier. P5 d'abord, puis l'arbitrage du
 * 7 octobre 2026 : un bloc s'evalue sur la fiche patient ou une rencontre, qui ne lisent pas
 * les occurrences, donc un pilote de groupe ne le commande jamais. Meme ordre que
 * `public.rule_space_problem` (20261007130000_rules_without_effect).
 */
export function blockRuleVerdict(
  driver: RuleSpace,
  sectionKey: string,
  sections?: readonly SpaceSection[] | null,
): RuleSpaceVerdict {
  if (driver.kind !== 'patient' && sectionCarriesGroup(sectionKey, sections)) {
    return { usable: false, problem: 'block_group_driver' };
  }
  if (driver.kind === 'group') return { usable: false, problem: 'block_driver_in_group' };
  return USABLE;
}

/**
 * La regle peut-elle fonctionner, compte tenu des espaces de ses operandes ? Une regle
 * illisible, ou qui cite une variable inconnue de la version, est declaree utilisable : ce
 * n'est pas a ce controle d'en juger (structure et existence restent verifiees ailleurs).
 */
export function ruleSpaceVerdict(
  rule: unknown,
  fields: readonly SpaceField[],
  sections?: readonly SpaceSection[] | null,
): RuleSpaceVerdict {
  if (!isPlainObject(rule)) return USABLE;
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const spaceOf = (key: unknown): RuleSpace | null => {
    const field = typeof key === 'string' ? byKey.get(key) : undefined;
    return field ? fieldRuleSpace(field, sections) : null;
  };

  if ('left_field' in rule && 'right_field' in rule) {
    const left = spaceOf(rule.left_field);
    const right = spaceOf(rule.right_field);
    if (!left || !right || sameRuleSpace(left, right)) return USABLE;
    return { usable: false, problem: 'comparison_cross_space' };
  }

  if (!isPlainObject(rule.if) || !isPlainObject(rule.then)) return USABLE;
  const driver = spaceOf(rule.if.field);
  if (!driver) return USABLE;
  const verb = rule.then.operator;
  if (verb === 'visible' && typeof rule.then.section === 'string') {
    return blockRuleVerdict(driver, rule.then.section, sections);
  }
  if (verb !== 'visible' && verb !== 'required') return USABLE;
  const target = spaceOf(rule.then.field);
  return target ? fieldRuleVerdict(verb, driver, target) : USABLE;
}
