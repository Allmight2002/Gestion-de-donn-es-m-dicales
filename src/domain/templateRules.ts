// Regles de coherence en "JSON CONTROLE" (cahier §10) : on valide la STRUCTURE et
// on n'autorise que des operateurs d'une liste blanche. Ces regles ne sont JAMAIS
// executees comme du code ; l'evaluation (etape 7) lira ces champs de maniere sure.

export const COMPARISON_OPERATORS = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const CONDITION_OPERATORS = [...COMPARISON_OPERATORS, 'in'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** { operator, left_field, right_field } : compare deux champs. */
export interface ComparisonRule {
  operator: ComparisonOperator;
  left_field: string;
  right_field: string;
}

/** { if: {field, operator, value}, then: {field, operator: 'required'} }. */
export interface ConditionalRule {
  if: { field: string; operator: ConditionOperator; value: unknown };
  then: { field: string; operator: 'required' };
}

export type TemplateRule = ComparisonRule | ConditionalRule;

export type RuleValidation = { ok: true; kind: 'comparison' | 'conditional' } | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Valide une regle saisie par le staff. Rejette tout operateur hors liste blanche
 * ou toute structure inattendue.
 */
export function validateRule(rule: unknown): RuleValidation {
  if (!isPlainObject(rule)) return { ok: false, error: 'La regle doit etre un objet JSON' };

  // Forme conditionnelle : if/then
  if ('if' in rule || 'then' in rule) {
    const { if: cond, then } = rule as Record<string, unknown>;
    if (!isPlainObject(cond) || !isPlainObject(then)) {
      return { ok: false, error: 'Regle conditionnelle : "if" et "then" sont requis' };
    }
    if (!isNonEmptyString(cond.field) || !isNonEmptyString(then.field)) {
      return { ok: false, error: 'Regle conditionnelle : "field" requis dans if et then' };
    }
    if (!CONDITION_OPERATORS.includes(cond.operator as ConditionOperator)) {
      return { ok: false, error: `Operateur de condition non autorise: ${String(cond.operator)}` };
    }
    if (!('value' in cond)) {
      return { ok: false, error: 'Regle conditionnelle : "value" requis dans if' };
    }
    if (then.operator !== 'required') {
      return { ok: false, error: 'Regle conditionnelle : "then.operator" doit etre "required"' };
    }
    return { ok: true, kind: 'conditional' };
  }

  // Forme comparaison : operator/left_field/right_field
  if ('operator' in rule) {
    const { operator, left_field, right_field } = rule as Record<string, unknown>;
    if (!COMPARISON_OPERATORS.includes(operator as ComparisonOperator)) {
      return { ok: false, error: `Operateur de comparaison non autorise: ${String(operator)}` };
    }
    if (!isNonEmptyString(left_field) || !isNonEmptyString(right_field)) {
      return { ok: false, error: 'Comparaison : "left_field" et "right_field" requis' };
    }
    return { ok: true, kind: 'comparison' };
  }

  return { ok: false, error: 'Forme de regle non reconnue' };
}

/** Parse + valide une regle saisie en texte JSON. */
export function parseRule(json: string): RuleValidation & { value?: TemplateRule } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON invalide' };
  }
  const res = validateRule(parsed);
  return res.ok ? { ...res, value: parsed as TemplateRule } : res;
}
