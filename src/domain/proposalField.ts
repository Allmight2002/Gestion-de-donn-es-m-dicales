// F5 — SOUPAPE des listes controlees : « la valeur que je cherche n'est pas dans la liste ».
//
// Sans soupape, un saisisseur bloque devant une liste incomplete choisit n'importe quelle
// valeur pour avancer : on obtient des donnees FAUSSES, pires que des donnees absentes.
//
// Regle de conception : la valeur hors liste n'entre JAMAIS dans le champ a liste controlee.
// Le select reste vide — la fiche part alors dans la file de completion existante — et la
// proposition est consignee dans un CHAMP COMPAGNON de type texte, cree a cote du champ
// source. Au traitement, on lit ce champ et on decide : ajouter la valeur a la liste, ou
// constater qu'elle existait deja sous un autre nom.
//
// Consequence voulue : la colonne analysable ne contient que des valeurs de la liste, et
// aucune surface serveur n'est necessaire — un champ texte est valide tel quel par
// assert_data_valid, qui refuse au contraire toute valeur hors allowed_values.
import type { NewField, TemplateField } from '../data/types';

export const PROPOSAL_SUFFIX = '_autre';

export function proposalKeyOf(fieldKey: string): string {
  return `${fieldKey}${PROPOSAL_SUFFIX}`;
}

/** Le champ compagnon d'un champ source present dans la meme liste, s'il existe. */
export function findProposalField(fields: TemplateField[], source: TemplateField): TemplateField | undefined {
  if (!isProposalSource(source)) return undefined;
  const key = proposalKeyOf(source.fieldKey);
  return fields.find((f) => f.fieldKey === key && f.type === 'text' && f.scope === source.scope);
}

/** Cles des champs compagnons a NE PAS rendre comme des champs autonomes. */
export function proposalKeysOf(fields: TemplateField[]): Set<string> {
  const keys = new Set<string>();
  for (const f of fields) {
    if (isProposalSource(f)) {
      const companion = findProposalField(fields, f);
      if (companion) keys.add(companion.fieldKey);
    }
  }
  return keys;
}

/** Types dont la valeur reste contrôlée, donc qui peuvent avoir une proposition compagnon. */
export function isProposalSource(field: { type: string }): boolean {
  return field.type === 'select' || field.type === 'multiselect' || field.type === 'terminology';
}

/**
 * Construit le champ compagnon a creer en meme temps que le champ source.
 *
 * Jamais requis : la fiche doit rester enregistrable, sinon le saisisseur contourne la
 * soupape en choisissant une valeur fausse — exactement ce qu'elle doit empecher.
 */
export function makeProposalField(source: NewField, labelSuffix: string): NewField {
  return {
    fieldKey: proposalKeyOf(source.fieldKey),
    label: `${source.label} ${labelSuffix}`,
    scope: source.scope,
    section: source.section,
    type: 'text',
    required: false,
    encounterTypes: source.encounterTypes ?? null,
    allowedValues: null,
    minValue: null,
    maxValue: null,
    unit: null,
    allowMissingCodes: false,
  };
}
