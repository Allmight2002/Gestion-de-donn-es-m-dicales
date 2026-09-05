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

export const CONDITION_OPERATORS = [...COMPARISON_OPERATORS, 'in', 'contains_any'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** { operator, left_field, right_field } : compare deux champs. */
export interface ComparisonRule {
  operator: ComparisonOperator;
  left_field: string;
  right_field: string;
}

/**
 * Operateurs autorises dans la clause `then`. La liste est FERMEE : `required` impose la
 * saisie, `visible` conditionne l'AFFICHAGE. Aucun autre verbe n'est accepte.
 */
export const THEN_OPERATORS = ['required', 'visible'] as const;
export type ThenOperator = (typeof THEN_OPERATORS)[number];

/** { if: {field, operator, value}, then: {field, operator: 'required'} }. */
export interface ConditionalRule {
  if: { field: string; operator: ConditionOperator; value: unknown; terminologyReleaseId?: string };
  then: { field: string; operator: 'required' };
}

/**
 * { if: {field, operator, value}, then: {field, operator: 'visible'} } (L32).
 *
 * `then.field` n'est montre QUE si la condition est vraie. Condition non verifiable —
 * variable pilote vide, ou elle-meme masquee — vaut MASQUE : « ne montrer l'imagerie que si
 * une imagerie a ete faite » se lit strictement, sinon un formulaire vierge montrerait tout.
 */
export interface VisibilityRule {
  if: { field: string; operator: ConditionOperator; value: unknown; terminologyReleaseId?: string };
  then: { field: string; operator: 'visible' };
}

export type TemplateRule = ComparisonRule | ConditionalRule | VisibilityRule;

export type RuleKind = 'comparison' | 'conditional' | 'visibility';

export type RuleValidation = { ok: true; kind: RuleKind } | { ok: false; error: string };

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
    if (cond.operator === 'contains_any') {
      if ('operator' in rule || 'left_field' in rule || 'right_field' in rule
        || Object.keys(cond).some((key) => !['field', 'operator', 'value', 'terminologyReleaseId'].includes(key))) {
        return { ok: false, error: `contains_any (${cond.field}) : une seule condition de champ est autorisée` };
      }
      if (!Array.isArray(cond.value) || cond.value.length === 0
        || !cond.value.every(isNonEmptyString) || new Set(cond.value).size !== cond.value.length) {
        return { ok: false, error: `contains_any (${cond.field}) : liste de codes non vides et sans doublons requise` };
      }
    }
    if ('terminologyReleaseId' in cond && (cond.operator !== 'contains_any'
      || typeof cond.terminologyReleaseId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cond.terminologyReleaseId))) {
      return { ok: false, error: `Release terminologique invalide (${cond.field})` };
    }
    if (!THEN_OPERATORS.includes(then.operator as ThenOperator)) {
      return { ok: false, error: 'Regle conditionnelle : "then.operator" doit etre "required" ou "visible"' };
    }
    if (then.operator === 'visible' && cond.field === then.field) {
      // Une variable qui commande son propre affichage ne peut jamais s'afficher.
      return { ok: false, error: 'Regle d\'affichage : une variable ne peut pas commander son propre affichage' };
    }
    return { ok: true, kind: then.operator === 'visible' ? 'visibility' : 'conditional' };
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

/**
 * Consequence d'un operande dont la valeur n'est JAMAIS enregistree — le cas d'une variable
 * calculee (L35), dont le resultat n'existe ni dans `patient.data` ni dans `encounter.data`.
 * Elle depend de la position occupee, et c'est elle qui decide de ce qui est refusable :
 *
 *  - `visible_driver`     : la cible reste masquee POUR TOUJOURS — destructeur ;
 *  - `required_target`    : la regle est toujours violee, la fiche devient infinalisable ;
 *  - `required_driver`    : la regle ne se declenche jamais — exigence affichee, jamais appliquee ;
 *  - `comparison_operand` : idem, pour une comparaison.
 *
 * Une variable calculee CIBLE d'un affichage n'y figure pas : masquer un resultat affiche est
 * legitime et ne detruit rien.
 *
 * Codes IDENTIQUES a ceux de `public.rule_operand_positions` : le constructeur et le serveur
 * nomment le meme probleme, sinon l'ecran et la base raconteraient deux histoires.
 */
export const RULE_OPERAND_PROBLEMS = [
  'visible_driver',
  'required_driver',
  'required_target',
  'comparison_operand',
] as const;
export type RuleOperandProblem = (typeof RULE_OPERAND_PROBLEMS)[number];

export interface RuleOperandPosition {
  fieldKey: string;
  problem: RuleOperandProblem;
}

/**
 * Positions ou une regle DESIGNE une variable, avec la consequence associee. Fonction PURE de
 * la regle : elle ne connait pas le gabarit et ne dit pas si la variable est calculee — c'est
 * `calculatedOperandConflict` (domain/fieldFormula) qui croise les deux.
 */
export function ruleOperandPositions(rule: unknown): RuleOperandPosition[] {
  if (!isPlainObject(rule)) return [];
  const positions: RuleOperandPosition[] = [];

  // Comparaison : { operator, left_field, right_field }
  if ('operator' in rule && 'left_field' in rule && 'right_field' in rule) {
    for (const key of [rule.left_field, rule.right_field]) {
      if (isNonEmptyString(key)) positions.push({ fieldKey: key, problem: 'comparison_operand' });
    }
  }

  // Conditionnelle : { if, then }
  if ('if' in rule && 'then' in rule) {
    const cond = isPlainObject(rule.if) ? rule.if : null;
    const then = isPlainObject(rule.then) ? rule.then : null;
    const verb = then?.operator;
    const driverField = cond?.field;
    const targetField = then?.field;
    const driverProblem: RuleOperandProblem | null = verb === 'visible'
      ? 'visible_driver'
      : verb === 'required' ? 'required_driver' : null;
    if (driverProblem && isNonEmptyString(driverField)) {
      positions.push({ fieldKey: driverField, problem: driverProblem });
    }
    if (verb === 'required' && isNonEmptyString(targetField)) {
      positions.push({ fieldKey: targetField, problem: 'required_target' });
    }
  }

  return positions;
}

/** La regle est-elle une regle d'AFFICHAGE ? (structure validee, sinon null). */
export function visibilityRuleOf(rule: unknown): VisibilityRule | null {
  const res = validateRule(rule);
  return res.ok && res.kind === 'visibility' ? (rule as VisibilityRule) : null;
}

/** Les seules regles d'affichage d'un lot, les autres formes etant ignorees. */
export function visibilityRulesOf(rules: readonly unknown[]): VisibilityRule[] {
  return rules.map(visibilityRuleOf).filter((r): r is VisibilityRule => r !== null);
}

/**
 * Cherche un CYCLE dans le graphe des dependances d'affichage : A masque par B, B masque
 * par A. Un cycle rend les deux variables definitivement invisibles — aucune des deux ne
 * peut etre renseignee, donc aucune des deux ne peut satisfaire la condition de l'autre.
 * Renvoie le chemin fautif (premiere variable repetee en fin) ou null.
 *
 * Le controle appartient a l'ENREGISTREMENT de la regle, pas a la saisie : une fiche ne doit
 * jamais avoir a se defendre contre un gabarit incoherent.
 */
export function findVisibilityCycle(rules: readonly unknown[]): string[] | null {
  // Arete pilote -> pilotee : l'affichage de `then.field` DEPEND de `if.field`.
  const dependsOn = new Map<string, string[]>();
  for (const rule of visibilityRulesOf(rules)) {
    dependsOn.set(rule.then.field, [...(dependsOn.get(rule.then.field) ?? []), rule.if.field]);
  }

  const done = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  function walk(field: string): string[] | null {
    if (onStack.has(field)) return [...stack.slice(stack.indexOf(field)), field];
    if (done.has(field)) return null;
    stack.push(field);
    onStack.add(field);
    for (const parent of dependsOn.get(field) ?? []) {
      const cycle = walk(parent);
      if (cycle) return cycle;
    }
    stack.pop();
    onStack.delete(field);
    done.add(field);
    return null;
  }

  for (const field of dependsOn.keys()) {
    const cycle = walk(field);
    if (cycle) return cycle;
  }
  return null;
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
