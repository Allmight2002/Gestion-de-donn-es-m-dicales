// Variables CALCULEES (L35), cote interface.
//
// Ce module ne contient NI grammaire NI calcul : il les emprunte a `domain/export`, qui
// n'est qu'un ré-export de `supabase/functions/generate-export/exportContract.ts`. Le
// navigateur et l'Edge Function de production lisent donc le MEME module, et un ecran ne
// peut pas afficher un resultat different de celui qui partira dans le fichier exporte.
//
// Ce qui vit ici, et rien d'autre : ce dont les ECRANS ont besoin — quelles variables
// peuvent servir d'operande, comment nommer un refus, comment calculer une ligne de
// formulaire.
import {
  checkFormula,
  evaluateFormulaText,
  FORMULA_OPERAND_TYPES,
  formulaFieldIndex,
  isFormulaIdentifier,
  parseFormula,
  type FormulaCheck,
  type FormulaFieldRef,
  type FormulaOperator,
  type FormulaOutputType,
  type FormulaProblem,
} from './export';
import type { TemplateField } from '../data/types';

export {
  FORMULA_OPERATORS,
  FORMULA_OPERAND_TYPES,
  FORMULA_TIME_UNITS,
  DEFAULT_FORMULA_TIME_UNIT,
  formatFormula,
  isFormulaTimeUnit,
  normalizeFormulaTimeUnit,
  parseFormula,
  type FormulaTimeUnit,
  type FormulaOperator,
  type FormulaOutputType,
  type FormulaProblem,
} from './export';

/** Variable dont la valeur est un calcul : elle n'est jamais saisissable. */
export const isCalculatedField = (field: Pick<TemplateField, 'formula'>): boolean =>
  Boolean(field.formula && field.formula.trim());

/**
 * Variables admissibles comme operande : meme portee, saisies (jamais calculees), de type
 * nombre, date ou date-heure, et portant un nom interne relisible dans une formule.
 *
 * La restriction sur le nom est volontairement visible ici : une variable nommee « poids (kg) »
 * ne peut pas apparaitre dans « poids (kg) / 2 » sans rendre la formule ambigue. Elle n'est
 * donc pas proposee, plutot que proposee puis refusee par le serveur.
 */
export function operandCandidates(
  fields: readonly TemplateField[],
  self: { scope: TemplateField['scope']; fieldKey?: string },
): TemplateField[] {
  return fields.filter((f) =>
    f.scope === self.scope &&
    f.fieldKey !== self.fieldKey &&
    !isCalculatedField(f) &&
    (FORMULA_OPERAND_TYPES as readonly string[]).includes(f.type) &&
    isFormulaIdentifier(f.fieldKey)
  );
}

/** Vue minimale attendue par l'evaluateur partage. */
const toRefs = (fields: readonly TemplateField[]): FormulaFieldRef[] =>
  fields.map((f) => ({ fieldKey: f.fieldKey, type: f.type, formula: f.formula ?? null }));

/**
 * Verifie une formule AVANT de l'envoyer au serveur, avec exactement la meme regle. Le
 * serveur reste la source de verite — il revalide et refuse — mais l'utilisateur voit le
 * motif dans son formulaire au lieu de recevoir une erreur a l'enregistrement.
 */
export function checkFieldFormula(
  formula: string | null | undefined,
  self: { scope: TemplateField['scope']; fieldKey: string },
  fields: readonly TemplateField[],
  resultUnit?: string | null,
): FormulaCheck {
  return checkFormula(formula, self.fieldKey, toRefs(operandCandidates(fields, self)), resultUnit);
}

/** Une formule temporelle est une soustraction entre deux variables date/date-heure. */
export function formulaUsesTemporalOperands(
  formula: string | null | undefined,
  fields: readonly Pick<FormulaFieldRef, 'fieldKey' | 'type'>[],
): boolean {
  const parsed = parseFormula(formula);
  if (!parsed || parsed.operator !== '-') return false;
  const operands = [parsed.left, parsed.right];
  return operands.every((operand) => {
    if (operand.kind !== 'field') return false;
    const field = fields.find((candidate) => candidate.fieldKey === operand.fieldKey);
    return field?.type === 'date' || field?.type === 'datetime';
  });
}

/** Cle de message pour un motif de refus. Les libelles vivent dans `i18n/messages`. */
export const formulaProblemKey = (problem: FormulaProblem) => `admin.formula_error_${problem}` as const;

/**
 * Resultat affiche par le formulaire de saisie. `null` = ABSENT : un operande manque, porte
 * un code de valeur manquante, ou la division tombe sur zero. Jamais zero, jamais une erreur.
 */
export function calculatedValue(
  field: Pick<TemplateField, 'formula' | 'unit'>,
  values: Record<string, unknown>,
  fields: readonly TemplateField[],
): number | null {
  if (!isCalculatedField(field)) return null;
  return evaluateFormulaText(field.formula, values, formulaFieldIndex(toRefs(fields)), field.unit);
}

/** Assemble la forme canonique a partir des trois selecteurs du constructeur. */
export const composeFormula = (left: string, operator: FormulaOperator, right: string) =>
  `${left.trim()} ${operator} ${right.trim()}`;

/**
 * Type de sortie DEDUIT, pour l'afficher dans le constructeur. Le serveur en deduit un lui
 * aussi et c'est le sien qui est ecrit : les deux appliquent la meme regle, ce qui evite a
 * l'utilisateur de decouvrir apres coup une etiquette differente de celle qu'on lui montrait.
 */
export function deducedOutputType(check: FormulaCheck): FormulaOutputType | null {
  return check.ok ? check.outputType ?? null : null;
}
