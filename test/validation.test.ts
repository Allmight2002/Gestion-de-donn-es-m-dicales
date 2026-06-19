// Tests du moteur de validation de saisie (cahier §10, critères 3 et 4).
import { describe, expect, test } from 'vitest';
import {
  validateField,
  validateValues,
  evaluateRules,
  makeMissing,
  isMissing,
  missingCodeOf,
} from '../src/domain/validation';
import type { TemplateField } from '../src/data/types';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type'>): TemplateField {
  return {
    id: p.fieldKey,
    label: p.fieldKey,
    scope: 'encounter',
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: true,
    displayOrder: 0,
    ...p,
  };
}

describe('valeurs manquantes codifiees (distinctes du vide)', () => {
  test('helpers', () => {
    const m = makeMissing('inconnu');
    expect(isMissing(m)).toBe(true);
    expect(missingCodeOf(m)).toBe('inconnu');
    expect(isMissing('')).toBe(false);
    expect(isMissing(5)).toBe(false);
  });

  test('un champ obligatoire vide -> erreur ; un code manquant satisfait la presence', () => {
    const f = field({ fieldKey: 'x', type: 'text', required: true });
    expect(validateField(f, '')).toMatch(/obligatoire/i);
    expect(validateField(f, makeMissing('non_fait'))).toBeNull();
  });

  test('code manquant interdit si allow_missing_codes=false', () => {
    const f = field({ fieldKey: 'x', type: 'text', allowMissingCodes: false });
    expect(validateField(f, makeMissing('inconnu'))).toMatch(/non autoris/i);
  });
});

describe('controles par champ (bornes, listes)', () => {
  const gcs = field({ fieldKey: 'glasgow_score', type: 'integer', required: true, minValue: 3, maxValue: 15 });
  test('hors bornes -> erreur', () => {
    expect(validateField(gcs, 2)).toMatch(/minimale/i);
    expect(validateField(gcs, 20)).toMatch(/maximale/i);
    expect(validateField(gcs, 10)).toBeNull();
  });
  test('valeur hors liste -> erreur', () => {
    const sel = field({ fieldKey: 'outcome', type: 'select', allowedValues: ['gueri', 'deces'] });
    expect(validateField(sel, 'autre')).toMatch(/liste/i);
    expect(validateField(sel, 'deces')).toBeNull();
  });
  test('validateValues agrege les erreurs', () => {
    const errs = validateValues([gcs], { glasgow_score: 99 });
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldKey).toBe('glasgow_score');
  });
});

describe('regles de coherence (§10, critere 4)', () => {
  const cmp = { rule: { operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }, message: 'sortie >= admission', severity: 'block' as const };
  const cond = { rule: { if: { field: 'outcome', operator: 'equals', value: 'deces' }, then: { field: 'death_date', operator: 'required' } }, message: 'deces -> date requise', severity: 'block' as const };

  test('comparaison de dates : sortie < admission -> bloquant', () => {
    expect(evaluateRules([cmp], { admission_date: '2024-01-05', discharge_date: '2024-01-01' }).blocking).toContain('sortie >= admission');
    expect(evaluateRules([cmp], { admission_date: '2024-01-05', discharge_date: '2024-01-10' }).blocking).toHaveLength(0);
  });

  test('regle inapplicable si un operande absent', () => {
    expect(evaluateRules([cmp], { admission_date: '2024-01-05' }).blocking).toHaveLength(0);
  });

  test('conditionnelle deces -> death_date requise', () => {
    expect(evaluateRules([cond], { outcome: 'deces' }).blocking).toContain('deces -> date requise');
    expect(evaluateRules([cond], { outcome: 'deces', death_date: '2024-01-06' }).blocking).toHaveLength(0);
    expect(evaluateRules([cond], { outcome: 'gueri' }).blocking).toHaveLength(0);
  });

  test('severite warn -> avertissement, pas bloquant', () => {
    const warnRule = { ...cmp, severity: 'warn' as const };
    const res = evaluateRules([warnRule], { admission_date: '2024-01-05', discharge_date: '2024-01-01' });
    expect(res.blocking).toHaveLength(0);
    expect(res.warnings).toContain('sortie >= admission');
  });
});
