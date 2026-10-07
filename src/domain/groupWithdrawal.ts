import type { TemplateField, TemplateSection } from '../data/types';
import type { Encounter, GroupWithdrawalDeclaration } from '../data/patients';
import { maskedRepeatableSectionKeys } from './templateSections';
import { hiddenFieldKeys } from './validation';

/** Un groupe dont l'enregistrement masque le bloc parent, avec ses occurrences enregistrées. */
export interface PendingGroupWithdrawal {
  sectionKey: string;
  blockKey: string;
  blockLabel: string;
  count: number;
}

/**
 * L74b — une variable d'occurrence que la fiche masque désormais : « {count} lésions perdront
 * {fieldLabel} ». Une ligne par groupe et par variable.
 */
export interface PendingContextErasure {
  sectionKey: string;
  groupLabel: string;
  fieldKey: string;
  fieldLabel: string;
  count: number;
}

/**
 * L72e — ce que l'enregistrement de la fiche va retirer : les groupes dont la racine passe de
 * visible (valeurs chargées) à masquée (valeurs saisies) et qui portent des occurrences.
 *
 * Même verdict que le serveur (`repeatable_group_root_visible`) : règle de bloc évaluée sur la
 * section, cascade comprise, condition non vérifiable = masqué. Un groupe déjà masqué au
 * chargement n'est pas compté : l'enregistrement ne le masque pas (D10).
 *
 * La déclaration n'est rendue que si chaque occurrence porte sa révision serveur ; sans elle,
 * le serveur refusera l'enregistrement et l'écran proposera un rechargement.
 */
export function pendingGroupWithdrawals(
  sections: readonly TemplateSection[] | null | undefined,
  rules: readonly { rule: unknown }[],
  fields: readonly TemplateField[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  occurrences: readonly Encounter[] | null,
  /** L74b — variables des groupes, pour les effacements (cibles des règles de bloc comprises). */
  groupFields: readonly TemplateField[] = [],
): {
  withdrawals: PendingGroupWithdrawal[];
  erasures: PendingContextErasure[];
  declaration: GroupWithdrawalDeclaration | null;
} {
  const maskedBefore = maskedRepeatableSectionKeys(sections, rules, before, hiddenFieldKeys(rules, before, fields, sections));
  const maskedAfter = maskedRepeatableSectionKeys(sections, rules, after, hiddenFieldKeys(rules, after, fields, sections));
  const withdrawals: PendingGroupWithdrawal[] = [];
  const declaration: GroupWithdrawalDeclaration = [];
  let declarable = true;
  for (const section of sections ?? []) {
    if (!maskedAfter.has(section.sectionKey) || maskedBefore.has(section.sectionKey)) continue;
    const rows = (occurrences ?? []).filter((row) => row.groupSectionKey === section.sectionKey);
    if (rows.length === 0) continue;
    const blockKey = section.parentSectionKey ?? section.sectionKey;
    const block = sections?.find((candidate) => candidate.sectionKey === blockKey);
    withdrawals.push({
      sectionKey: section.sectionKey,
      blockKey,
      blockLabel: block?.label?.trim() || blockKey,
      count: rows.length,
    });
    if (rows.some((row) => typeof row.recordRevision !== 'number')) declarable = false;
    declaration.push({
      sectionKey: section.sectionKey,
      occurrences: rows
        .map((row) => ({ id: row.id, recordRevision: row.recordRevision ?? 0 }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  const erased = pendingContextErasures(sections, rules, [...fields, ...groupFields], before, after, occurrences,
    new Set(withdrawals.map((item) => item.sectionKey)));
  if (!erased.declarable) declarable = false;
  declaration.push(...erased.declaration);
  declaration.sort((a, b) => (a.sectionKey < b.sectionKey ? -1 : a.sectionKey > b.sectionKey ? 1 : 0));
  return {
    withdrawals,
    erasures: erased.erasures,
    declaration: declarable && declaration.length > 0 ? declaration : null,
  };
}

/**
 * L74b — les valeurs d'occurrence que l'enregistrement efface : variables renseignées (clé
 * présente, valeur non nulle), masquées avec la fiche saisie et visibles avec la fiche chargée.
 *
 * Miroir de `patient_context_erasures` : la visibilité d'une occurrence se calcule sur
 * `occurrence ⊕ contexte`, le contexte étant les valeurs de portée `patient` de la fiche ; la
 * cascade est celle du point fixe (`hiddenFieldKeys`). Les groupes retirés avec leur bloc
 * (`excluded`) ne sont pas comptés : leurs occurrences disparaissent entières.
 */
export function pendingContextErasures(
  sections: readonly TemplateSection[] | null | undefined,
  rules: readonly { rule: unknown }[],
  fields: readonly TemplateField[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  occurrences: readonly Encounter[] | null,
  excluded: ReadonlySet<string> = new Set<string>(),
): {
  erasures: PendingContextErasure[];
  declaration: Extract<GroupWithdrawalDeclaration[number], { clearedFields: unknown }>[];
  declarable: boolean;
} {
  const patientKeys = new Set(fields.filter((f) => f.scope === 'patient').map((f) => f.fieldKey));
  const contextOf = (data: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(data).filter(([key]) => patientKeys.has(key)));
  const contextBefore = contextOf(before);
  const contextAfter = contextOf(after);
  const bySection = new Map<string, { id: string; recordRevision: number; fieldKeys: string[] }[]>();
  let declarable = true;
  for (const row of occurrences ?? []) {
    const sectionKey = row.groupSectionKey;
    if (!sectionKey || excluded.has(sectionKey)) continue;
    const data = row.data ?? {};
    const filled = Object.keys(data).filter((key) => !patientKeys.has(key) && data[key] !== null && data[key] !== undefined);
    if (filled.length === 0) continue;
    const hiddenAfter = hiddenFieldKeys(rules, { ...data, ...contextAfter }, fields, sections);
    const candidates = filled.filter((key) => hiddenAfter.has(key));
    if (candidates.length === 0) continue;
    const hiddenBefore = hiddenFieldKeys(rules, { ...data, ...contextBefore }, fields, sections);
    const fieldKeys = candidates.filter((key) => !hiddenBefore.has(key)).sort();
    if (fieldKeys.length === 0) continue;
    if (typeof row.recordRevision !== 'number') declarable = false;
    const items = bySection.get(sectionKey) ?? [];
    items.push({ id: row.id, recordRevision: row.recordRevision ?? 0, fieldKeys });
    bySection.set(sectionKey, items);
  }

  const erasures: PendingContextErasure[] = [];
  const declaration: Extract<GroupWithdrawalDeclaration[number], { clearedFields: unknown }>[] = [];
  for (const sectionKey of [...bySection.keys()].sort()) {
    const items = bySection.get(sectionKey)!.sort((a, b) => a.id.localeCompare(b.id));
    declaration.push({ sectionKey, clearedFields: items });
    const groupLabel = sections?.find((s) => s.sectionKey === sectionKey)?.label?.trim() || sectionKey;
    const counts = new Map<string, number>();
    for (const item of items) for (const key of item.fieldKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const ordered = fields.filter((f) => counts.has(f.fieldKey)).map((f) => f.fieldKey);
    for (const key of [...ordered, ...[...counts.keys()].filter((k) => !ordered.includes(k)).sort()]) {
      const label = fields.find((f) => f.fieldKey === key)?.label?.trim() || key;
      erasures.push({ sectionKey, groupLabel, fieldKey: key, fieldLabel: label, count: counts.get(key)! });
    }
  }
  return { erasures, declaration, declarable };
}
