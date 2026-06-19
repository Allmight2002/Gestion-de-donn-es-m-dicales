// Tests du validateur de regles JSON controlees (cahier §10).
import { describe, expect, test } from 'vitest';
import { validateRule, parseRule } from '../src/domain/templateRules';

describe('validateRule — formes valides', () => {
  test('comparaison (les regles du seed)', () => {
    expect(validateRule({ operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }))
      .toEqual({ ok: true, kind: 'comparison' });
  });

  test('conditionnelle deces -> death_date required (regle du seed)', () => {
    expect(
      validateRule({
        if: { field: 'outcome', operator: 'equals', value: 'deces' },
        then: { field: 'death_date', operator: 'required' },
      }),
    ).toEqual({ ok: true, kind: 'conditional' });
  });
});

describe('validateRule — rejets', () => {
  test('operateur de comparaison non autorise', () => {
    const r = validateRule({ operator: 'regex_match', left_field: 'a', right_field: 'b' });
    expect(r.ok).toBe(false);
  });

  test('operateur de condition non autorise', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'matches', value: 1 },
      then: { field: 'y', operator: 'required' },
    });
    expect(r.ok).toBe(false);
  });

  test('then.operator different de required', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'equals', value: 1 },
      then: { field: 'y', operator: 'forbidden' },
    });
    expect(r.ok).toBe(false);
  });

  test('champs manquants', () => {
    expect(validateRule({ operator: 'equals', left_field: 'a' }).ok).toBe(false);
  });

  test('non-objet', () => {
    expect(validateRule(42).ok).toBe(false);
    expect(validateRule(null).ok).toBe(false);
  });
});

describe('parseRule', () => {
  test('JSON invalide', () => {
    expect(parseRule('{ pas du json').ok).toBe(false);
  });
  test('JSON valide -> renvoie la valeur', () => {
    const r = parseRule('{"operator":"less_than","left_field":"a","right_field":"b"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeDefined();
  });
});
