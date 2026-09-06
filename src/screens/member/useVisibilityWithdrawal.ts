import { useCallback, useEffect, useRef, useState } from 'react';
import type { TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { visibilityCascadeFieldKeys, visibilityConditionHolds } from '../../domain/validation';
import { visibilityRulesOf, visibilityTargetFieldKeys } from '../../domain/templateRules';

/**
 * Suit les transitions de visibilité provoquées par un retrait de diagnostic.
 *
 * Le suivi est par règle, pas seulement par variable cible : deux diagnostics peuvent
 * commander le même bloc et le retour d'un seul ne doit pas faire disparaître la demande
 * de confirmation tant que l'autre condition reste fausse. Le hook ne modifie jamais les
 * valeurs ; il fournit uniquement les clés à afficher dans l'aperçu avant enregistrement.
 */
export function useVisibilityWithdrawal(
  rules: readonly ValidationRule[],
  fields: readonly TemplateField[],
  sections?: readonly TemplateSection[] | null,
) {
  const activeDiagnosticRules = useRef(new Set<number>());
  const [keys, setKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    activeDiagnosticRules.current.clear();
    setKeys(new Set());
  }, [rules, fields, sections]);

  const reset = useCallback(() => {
    activeDiagnosticRules.current.clear();
    setKeys(new Set());
  }, []);

  const track = useCallback((previousValues: Record<string, unknown>, nextValues: Record<string, unknown>) => {
    const terminologyKeys = new Set(
      fields.filter((field) => field.type === 'terminology').map((field) => field.fieldKey),
    );
    const visibility = visibilityRulesOf(rules.map((item) => item.rule));
    visibility.forEach((rule, index) => {
      if (!terminologyKeys.has(rule.if.field)) return;
      const wasVisible = visibilityConditionHolds(rule, previousValues);
      const isVisible = visibilityConditionHolds(rule, nextValues);
      if (isVisible) activeDiagnosticRules.current.delete(index);
      else if (wasVisible) activeDiagnosticRules.current.add(index);
    });

    const directKeys = new Set<string>();
    visibility.forEach((rule, index) => {
      if (!activeDiagnosticRules.current.has(index)) return;
      for (const key of visibilityTargetFieldKeys(rule, fields, sections)) directKeys.add(key);
    });
    setKeys(visibilityCascadeFieldKeys(rules.map((item) => item.rule), directKeys, fields, sections));
  }, [fields, rules, sections]);

  return { keys, track, reset };
}
