// L75 — en-tetes d'option des variables dependantes d'une liste multiple
// (docs/spec-entetes-options-declenchantes.md).
//
// Presentation seule : les regles d'affichage disent deja quelle option d'une liste multiple
// fait apparaitre quelle variable. Cette fonction en deduit, pour UN bloc du formulaire, un
// arbre ordonne — variables non rattachees a leur place, regroupements par option juste sous
// leur liste pilote — et sa liste aplatie, qui est l'ordre de parcours de la navigation.
// Aucune valeur, cle ni regle n'est modifiee.
import type { TemplateField } from '../data/types';
import { fieldOptions } from './fieldOptions';
import { visibilityRulesOf } from './templateRules';

type GroupableField = Pick<TemplateField, 'fieldKey' | 'type'> & Partial<Pick<TemplateField, 'allowedOptions' | 'allowedValues'>>;

export type OptionNode<T> =
  | { kind: 'field'; field: T }
  | {
    kind: 'group';
    /** Stable : pilote + ensemble trie des codes. Ne depend jamais des cases cochees. */
    key: string;
    driverKey: string;
    /** Codes dans l'ordre des options du pilote. */
    codes: string[];
    /** Libelles des options, jamais leurs codes, separes par « / » pour un en-tete combine. */
    label: string;
    children: OptionNode<T>[];
  };

interface Attachment { driverKey: string; codes: string[] }

/** Codes valides d'une regle `contains_any` : meme exigence que `containsAny`, sinon rien. */
function codesOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0
    || !value.every((code) => typeof code === 'string' && code.trim() !== '')
    || new Set(value).size !== value.length) return null;
  return value as string[];
}

/**
 * Arbre ordonne des variables d'un bloc (§3, §4).
 *
 * Une cible n'est rattachee a son pilote que si elle porte exactement une regle d'affichage
 * de variable, `contains_any`, pilotee par une liste `multiselect` du MEME bloc, et qu'elle
 * n'est pas exclue (variable compagnon). Toute autre variable reste a sa place, sans en-tete.
 * Sans aucun rattachement, la sortie reprend l'entree telle quelle.
 */
export function arrangeOptionGroups<T extends GroupableField>(
  fields: readonly T[],
  rules: readonly unknown[],
  excluded: ReadonlySet<string> = new Set(),
): OptionNode<T>[] {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const visibility = visibilityRulesOf(rules);
  // Regles d'affichage de VARIABLE par cible : elles se cumulent en ET, donc au-dela d'une
  // seule, aucun en-tete ne decrit la condition (D3). Les regles de bloc ne comptent pas :
  // le titre du bloc joue deja ce role.
  const ruleCount = new Map<string, number>();
  for (const rule of visibility) {
    if ('field' in rule.then) ruleCount.set(rule.then.field, (ruleCount.get(rule.then.field) ?? 0) + 1);
  }
  const attached = new Map<string, Attachment>();
  for (const rule of visibility) {
    if (!('field' in rule.then) || rule.if.operator !== 'contains_any') continue;
    const target = rule.then.field;
    const driver = byKey.get(rule.if.field);
    const codes = codesOf(rule.if.value);
    if (ruleCount.get(target) !== 1 || !byKey.has(target) || excluded.has(target)
      || !driver || driver.type !== 'multiselect' || driver.fieldKey === target || !codes) continue;
    const rank = new Map(fieldOptions(driver).map((option, index) => [option.valueKey, index]));
    const ordered = [...codes].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER)
      || a.localeCompare(b));
    attached.set(target, { driverKey: driver.fieldKey, codes: ordered });
  }

  // Garde anti-cycle (§4.1) : l'acyclicite est garantie a l'enregistrement, mais un gabarit
  // incoherent ne doit ni boucler ni perdre de variable. Les variables d'un cycle restent a
  // leur place, sans en-tete.
  const inCycle = new Set<string>();
  for (const start of attached.keys()) {
    const path: string[] = [];
    const seen = new Set<string>();
    let key: string | undefined = start;
    while (key !== undefined && attached.has(key) && !seen.has(key) && !inCycle.has(key)) {
      seen.add(key);
      path.push(key);
      key = attached.get(key)?.driverKey;
    }
    if (key !== undefined && seen.has(key)) for (const member of path.slice(path.indexOf(key))) inCycle.add(member);
  }
  for (const key of inCycle) attached.delete(key);
  if (attached.size === 0) return fields.map((field) => ({ kind: 'field', field }));

  const targetsByDriver = new Map<string, T[]>();
  for (const field of fields) {
    const attachment = attached.get(field.fieldKey);
    if (!attachment) continue;
    const list = targetsByDriver.get(attachment.driverKey) ?? [];
    list.push(field);
    targetsByDriver.set(attachment.driverKey, list);
  }

  const visited = new Set<string>();
  const place = (field: T): OptionNode<T>[] => {
    const nodes: OptionNode<T>[] = [{ kind: 'field', field }];
    const targets = targetsByDriver.get(field.fieldKey);
    if (!targets || visited.has(field.fieldKey)) return nodes;
    visited.add(field.fieldKey);
    const options = fieldOptions(field);
    const rank = new Map(options.map((option, index) => [option.valueKey, index]));
    const optionRank = (code: string) => rank.get(code) ?? Number.MAX_SAFE_INTEGER;
    const groups = new Map<string, { codes: string[]; members: T[] }>();
    for (const target of targets) {
      const { codes } = attached.get(target.fieldKey)!;
      const key = [...codes].sort().join('+');
      const group = groups.get(key) ?? { codes, members: [] };
      group.members.push(target);
      groups.set(key, group);
    }
    // Un code d'abord, dans l'ordre des options ; puis les en-tetes combines, dans l'ordre de
    // leur premiere option (D2). Les cibles gardent leur ordre d'affichage dans le bloc.
    const ordered = [...groups.entries()].sort(([keyA, a], [keyB, b]) => Number(a.codes.length > 1) - Number(b.codes.length > 1)
      || optionRank(a.codes[0]) - optionRank(b.codes[0]) || keyA.localeCompare(keyB));
    for (const [key, group] of ordered) {
      nodes.push({
        kind: 'group',
        key: `${field.fieldKey}:${key}`,
        driverKey: field.fieldKey,
        codes: group.codes,
        label: group.codes.map((code) => options.find((option) => option.valueKey === code)?.label ?? code).join(' / '),
        children: group.members.flatMap(place),
      });
    }
    return nodes;
  };
  return fields.filter((field) => !attached.has(field.fieldKey)).flatMap(place);
}

/** Ordre de parcours : celui de l'affichage, regroupements compris. */
export function flattenOptionNodes<T>(nodes: readonly OptionNode<T>[]): T[] {
  return nodes.flatMap((node) => node.kind === 'field' ? [node.field] : flattenOptionNodes(node.children));
}
