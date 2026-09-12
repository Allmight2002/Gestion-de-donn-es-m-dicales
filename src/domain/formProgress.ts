import type { TemplateField, ValidationRule } from '../data/types';
import { calculatedValue, isCalculatedField } from './fieldFormula';
import { applyOp, isMissing, ruleHolds, validateField, withoutHiddenValues } from './validation';
import { CONDITION_OPERATORS, type ConditionOperator } from './templateRules';

export interface FormFieldIssue { fieldKey: string; message: string }
export interface FormProgress {
  requiredKeys: Set<string>;
  missingKeys: string[];
  filledRequired: number;
  issues: FormFieldIssue[];
}

/** Presentation counts reuse the validation engine, including its deliberately different
 * treatment of permitted missing codes and conditional obligations. No business writes. */
export function calculateFormProgress(
  fields: readonly TemplateField[], values: Record<string, unknown>, rules: readonly ValidationRule[] = [],
  hidden: ReadonlySet<string> = new Set(), requireComplete = false,
): FormProgress {
  const active = withoutHiddenValues(values, hidden).values;
  const visible = fields.filter((field) => !hidden.has(field.fieldKey));
  const conditional = new Set<string>();
  for (const entry of rules) {
    const rule = entry.rule as { if?: { field: string; operator: string; value: unknown }; then?: { field?: string; operator?: string } };
    if (!rule?.if || !rule.then?.field || rule.then.operator !== 'required'
      || hidden.has(rule.if.field) || hidden.has(rule.then.field)) continue;
    // A required rule and a visibility rule share the same condition vocabulary.
    const driver = active[rule.if.field];
    if (CONDITION_OPERATORS.includes(rule.if.operator as ConditionOperator)
      && driver !== undefined && driver !== null && driver !== '' && !isMissing(driver)
      && (!Array.isArray(driver) || driver.length > 0)
      && applyOp(rule.if.operator, driver, rule.if.value)) conditional.add(rule.then.field);
  }
  const requiredKeys = new Set(visible.filter((field) => field.required || conditional.has(field.fieldKey)).map((field) => field.fieldKey));
  const missingKeys: string[] = [];
  const issues: FormFieldIssue[] = [];
  for (const field of visible) {
    const value = isCalculatedField(field) ? calculatedValue(field, active, fields) : active[field.fieldKey];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    const missing = empty || (conditional.has(field.fieldKey) && isMissing(value));
    if (requiredKeys.has(field.fieldKey) && missing) missingKeys.push(field.fieldKey);
    const message = validateField(field, value, requireComplete);
    if (message) issues.push({ fieldKey: field.fieldKey, message });
  }
  if (requireComplete) {
    for (const entry of rules) {
      if (entry.severity !== 'block' || ruleHolds(entry.rule, active, hidden)) continue;
      const rule = entry.rule as { then?: { field?: string }; left_field?: string };
      const key = rule.then?.field ?? rule.left_field;
      if (key && visible.some((field) => field.fieldKey === key) && !issues.some((issue) => issue.fieldKey === key)) {
        issues.push({ fieldKey: key, message: entry.message ?? 'Règle de cohérence non respectée' });
      }
    }
  }
  return { requiredKeys, missingKeys, filledRequired: requiredKeys.size - missingKeys.length, issues };
}
