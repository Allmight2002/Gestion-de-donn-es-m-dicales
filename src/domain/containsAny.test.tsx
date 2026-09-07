import { describe, expect, test } from 'vitest';
import { containsAny, hiddenFieldKeys } from './validation';
import { validateRule } from './templateRules';
import { containsAnyCases, invalidContainsAnyConfigs } from '../../test/fixtures/containsAny';

describe('contains_any — shared client vectors', () => {
  test.each(containsAnyCases)('$name', ({ value, expected }) => {
    expect(containsAny(value, ['A'])).toBe(expected);
    const rule = { if: { field: 'driver', operator: 'contains_any', value: ['A'] }, then: { field: 'target', operator: 'visible' } };
    expect(hiddenFieldKeys([{ rule }], { driver: value }).has('target')).toBe(!expected);
  });
  test.each(invalidContainsAnyConfigs.map((value, index) => ({ value, index })))('invalid config $index', ({ value }) => {
    expect(containsAny('A', value)).toBe(false);
    expect(validateRule({ if: { field: 'driver', operator: 'contains_any', value }, then: { field: 'target', operator: 'visible' } }).ok).toBe(false);
  });
  test('old-client condition whitelist rejects L51 and leaves its target visible', () => {
    // Frozen pre-L51 validateRule condition whitelist and visibilityRulesOf filtering.
    // An old client discards an unknown condition BEFORE hiddenFieldKeys evaluates it.
    const legacyOperators = ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'in'];
    const rule = { if: { field: 'driver', operator: 'contains_any', value: ['A'] }, then: { field: 'target', operator: 'visible' } };
    const oldClientRules = [{ rule }].filter(({ rule: r }) => legacyOperators.includes(r.if.operator));
    expect(oldClientRules).toEqual([]);
    expect(hiddenFieldKeys(oldClientRules, {}).has('target')).toBe(false);
    expect(hiddenFieldKeys([{ rule }], {}).has('target')).toBe(true);
  });
});
