// UX-14(d) — deplacer une variable sans la reecrire.
//
// `update_template_field` remplace la ligne entiere : la RPC recoit chaque attribut, y compris
// ceux qu'on ne touche pas. Un deplacement vers une autre section doit donc renvoyer au serveur
// EXACTEMENT ce que la variable portait — options, formule, raisons de valeur manquante, valeur
// proposee, cardinalite, types de rencontre. Oublier un seul de ces attributs ne casse rien de
// visible immediatement : il disparait simplement du gabarit, et on ne s'en apercoit qu'a la
// saisie suivante. D'ou cette conversion unique, exhaustive, couverte par son propre test.
import type { NewField, TemplateField } from '../data/types';
import { fieldOptions } from './fieldOptions';

/**
 * Convertit une variable LUE en charge d'ecriture equivalente.
 *
 * `overrides` ne sert qu'a l'attribut reellement modifie par l'appelant ; tout le reste est
 * repris tel quel. La fonction ne valide rien : le serveur reste seul juge de ce qu'il accepte.
 */
export function templateFieldToNewField(field: TemplateField, overrides: Partial<NewField> = {}): NewField {
  const options = fieldOptions(field);
  return {
    fieldKey: field.fieldKey,
    label: field.label,
    description: field.description ?? null,
    defaultValue: field.defaultValue ?? null,
    scope: field.scope,
    section: field.section,
    type: field.type,
    required: field.required,
    isMultiple: field.isMultiple ?? false,
    encounterTypes: field.encounterTypes ?? null,
    // Le miroir des cles est reconstruit depuis les options quand elles existent : c'est la
    // source de verite cote serveur, et les deux doivent rester coherents.
    allowedValues: options.length > 0
      ? options.map((option) => option.valueKey)
      : (field.allowedValues ?? null)?.filter((value): value is string => typeof value === 'string') ?? null,
    allowedOptions: field.allowedOptions ? options : null,
    minValue: field.minValue,
    maxValue: field.maxValue,
    unit: field.unit,
    allowMissingCodes: field.allowMissingCodes,
    missingReasons: field.missingReasons ?? null,
    formula: field.formula ?? null,
    ...overrides,
  };
}
