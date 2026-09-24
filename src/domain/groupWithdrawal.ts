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
): { withdrawals: PendingGroupWithdrawal[]; declaration: GroupWithdrawalDeclaration | null } {
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
  return { withdrawals, declaration: declarable && declaration.length > 0 ? declaration : null };
}
