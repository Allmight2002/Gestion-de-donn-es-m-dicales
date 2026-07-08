import { describe, expect, test } from 'vitest';
import { isInspectionReadable, isInspectionRetryable } from '../src/data/inspection';

describe('politique de lecture inspection', () => {
  test('accepted_client est lisible seulement hors mode strict', () => {
    expect(isInspectionReadable('accepted', true)).toBe(true);
    expect(isInspectionReadable('accepted_client', false)).toBe(true);
    expect(isInspectionReadable('accepted_client', true)).toBe(false);
  });

  test('accepted_client devient relancable en mode strict', () => {
    expect(isInspectionRetryable('accepted_client', false)).toBe(false);
    expect(isInspectionRetryable('accepted_client', true)).toBe(true);
    expect(isInspectionRetryable('pending', true)).toBe(true);
    expect(isInspectionRetryable('scanning', true)).toBe(true);
  });
});
