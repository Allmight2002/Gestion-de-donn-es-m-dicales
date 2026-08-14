// Moteur de validation de saisie (cahier §10) — PUR, testable en node.
//  * contrôles par champ : obligatoire, bornes, listes ;
//  * valeurs manquantes CODIFIÉES (non_fait / inconnu / non_applicable), distinctes
//    du vide (§6) ;
//  * évaluation des règles de cohérence JSON (opérateurs whitelist, jamais exécutées
//    comme du code) -> erreurs bloquantes (block) ou avertissements (warn).
import { isTerminologyValue, type TemplateField } from '../data/types';
import { COMPARISON_OPERATORS, CONDITION_OPERATORS, type ConditionOperator } from './templateRules';
import { MISSING_CODES, sortMissingReasons, type MissingCode } from './export';

// La liste des raisons n'est PAS recopiee ici : elle est importee du contrat d'export, qui
// en est le seul proprietaire. Deux listes maintenues en parallele finiraient par diverger,
// et une raison saisissable mais inconnue de l'export produirait une colonne illisible.
export { MISSING_CODES };
export type { MissingCode };

/**
 * Les trois raisons anterieures a L33. Ce n'est pas un doublon de `MISSING_CODES` mais une
 * notion distincte : le REPLI de compatibilite. Un instantane hors-ligne telecharge avant ce
 * lot ne porte pas `missingReasons` ; on retombe alors sur exactement ce que la variable
 * proposait a ce moment-la — la meme regle que la reprise de donnees de la migration.
 */
export const HISTORIC_MISSING_CODES = ['non_fait', 'inconnu', 'non_applicable'] as const;

const MISSING_KEY = '__missing__';

/** Raisons proposees pour CETTE variable, repli compris. */
export function allowedMissingReasons(
  field: { missingReasons?: readonly string[] | null; allowMissingCodes?: boolean },
): MissingCode[] {
  if (field.missingReasons) return sortMissingReasons(field.missingReasons) as MissingCode[];
  return field.allowMissingCodes ? [...HISTORIC_MISSING_CODES] : [];
}

export function makeMissing(code: MissingCode): { __missing__: MissingCode } {
  return { [MISSING_KEY]: code };
}
export function isMissing(v: unknown): v is { __missing__: MissingCode } {
  return (
    typeof v === 'object' &&
    v !== null &&
    MISSING_KEY in v &&
    MISSING_CODES.includes((v as Record<string, unknown>)[MISSING_KEY] as MissingCode)
  );
}
export function missingCodeOf(v: unknown): MissingCode | null {
  return isMissing(v) ? v[MISSING_KEY] : null;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
/** Présence d'une vraie valeur (ni vide, ni code manquant). */
function present(v: unknown): boolean {
  return !isEmpty(v) && !isMissing(v);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isStrictDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  return validDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isStrictDateTimeString(value: string): boolean {
  const m = DATETIME_RE.exec(value);
  if (!m) return false;
  if (!validDateParts(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[8] !== undefined && m[9] !== undefined) {
    const offsetHour = Number(m[8]);
    const offsetMinute = Number(m[9]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

export interface FieldError {
  fieldKey: string;
  message: string;
}

/** Valide un champ ; renvoie un message d'erreur (bloquant) ou null.
 *  requireComplete=false (brouillon) : un champ requis VIDE n'est pas bloquant (completion plus tard) ;
 *  les valeurs RENSEIGNEES restent validees (bornes / type / liste). */
export function validateField(field: TemplateField, value: unknown, requireComplete = true): string | null {
  if (isMissing(value)) {
    const allowed = allowedMissingReasons(field);
    if (allowed.length === 0) return 'Valeur manquante non autorisée pour ce champ';
    // Le serveur reste juge : ce controle evite l'aller-retour reseau, il ne le remplace pas.
    return allowed.includes(value[MISSING_KEY]) ? null : 'Raison de valeur manquante non autorisée pour ce champ';
  }
  if (isEmpty(value)) {
    return field.required && requireComplete ? 'Champ obligatoire' : null;
  }
  if (field.type === 'date') {
    return isStrictDateString(String(value)) ? null : 'Date invalide (format AAAA-MM-JJ attendu)';
  }
  if (field.type === 'datetime') {
    return isStrictDateTimeString(String(value)) ? null : 'Date/heure invalide (format ISO attendu)';
  }
  if (field.type === 'number' || field.type === 'integer') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) return 'Nombre invalide';
    if (field.type === 'integer' && !Number.isInteger(n)) return 'Entier attendu';
    if (field.minValue != null && n < field.minValue) return `Valeur minimale : ${field.minValue}`;
    if (field.maxValue != null && n > field.maxValue) return `Valeur maximale : ${field.maxValue}`;
  }
  // Terminologie : le serveur reste seul juge de l'existence du concept et de la coherence
  // du couple. Ici on ne verifie que la FORME, pour signaler la saisie incomplete avant
  // l'aller-retour reseau.
  if (field.type === 'terminology') {
    return isTerminologyValue(value) ? null : 'Diagnostic incomplet : choisissez une proposition';
  }
  if (field.type === 'select' && Array.isArray(field.allowedValues)) {
    if (!field.allowedValues.map(String).includes(String(value))) return 'Valeur hors liste';
  }
  if (field.type === 'multiselect' && Array.isArray(field.allowedValues)) {
    const allowed = field.allowedValues.map(String);
    const arr = Array.isArray(value) ? value.map(String) : [];
    if (arr.some((x) => !allowed.includes(x))) return 'Valeur hors liste';
  }
  return null;
}

export function validateValues(fields: TemplateField[], values: Record<string, unknown>, requireComplete = true): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of fields) {
    const e = validateField(f, values[f.fieldKey], requireComplete);
    if (e) errors.push({ fieldKey: f.fieldKey, message: e });
  }
  return errors;
}

// --- Évaluation des règles de cohérence (§10) -------------------------------

function order(a: unknown, b: unknown): number | null {
  // dates ISO comparables en chaîne ; sinon numérique ; sinon null (incomparable)
  if (typeof a === 'string' && typeof b === 'string' && isStrictDateString(a) && isStrictDateString(b)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string' && isStrictDateTimeString(a) && isStrictDateTimeString(b)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na < nb ? -1 : na > nb ? 1 : 0;
  return null;
}

function applyOp(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case 'equals':
      return String(a) === String(b);
    case 'not_equals':
      return String(a) !== String(b);
    case 'in':
      return Array.isArray(b) && b.map(String).includes(String(a));
    default: {
      const c = order(a, b);
      if (c === null) return false;
      if (op === 'greater_than') return c > 0;
      if (op === 'greater_or_equal') return c >= 0;
      if (op === 'less_than') return c < 0;
      if (op === 'less_or_equal') return c <= 0;
      return false;
    }
  }
}

/** true si la règle est SATISFAITE (pas de violation) pour ces valeurs. */
function ruleHolds(rule: unknown, values: Record<string, unknown>): boolean {
  if (typeof rule !== 'object' || rule === null) return true;
  const r = rule as Record<string, unknown>;

  // Conditionnelle : { if:{field,operator,value}, then:{field, operator:'required'} }
  if ('if' in r && 'then' in r) {
    const cond = r.if as { field: string; operator: ConditionOperator; value: unknown };
    const then = r.then as { field: string; operator: string };
    if (!CONDITION_OPERATORS.includes(cond.operator)) return true; // opérateur non whitelist -> ignorée
    const conditionHolds = present(values[cond.field]) && applyOp(cond.operator, values[cond.field], cond.value);
    if (!conditionHolds) return true;
    if (then.operator === 'required') return present(values[then.field]);
    return true;
  }

  // Comparaison : { operator, left_field, right_field }
  if ('operator' in r) {
    const op = r.operator as string;
    if (!COMPARISON_OPERATORS.includes(op as (typeof COMPARISON_OPERATORS)[number])) return true;
    const left = values[r.left_field as string];
    const right = values[r.right_field as string];
    if (!present(left) || !present(right)) return true; // règle inapplicable si un opérande absent
    return applyOp(op, left, right);
  }

  return true;
}

export interface RuleEvaluation {
  blocking: string[];
  warnings: string[];
}

export function evaluateRules(
  rules: { rule: unknown; message: string | null; severity: 'block' | 'warn' }[],
  values: Record<string, unknown>,
): RuleEvaluation {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const r of rules) {
    if (!ruleHolds(r.rule, values)) {
      (r.severity === 'block' ? blocking : warnings).push(r.message ?? 'Règle de cohérence non respectée');
    }
  }
  return { blocking, warnings };
}
