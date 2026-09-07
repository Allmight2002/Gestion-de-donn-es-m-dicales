// F3 : chaque modele de la bibliotheque est bien forme (types/portees/sections valides, cles uniques).
import { describe, expect, test } from 'vitest';
import { TEMPLATE_LIBRARY } from './templateLibrary';

const TYPES = new Set(['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect']);
const SCOPES = new Set(['patient', 'encounter']);
const SECTIONS = new Set(['clinique', 'biologie', 'paraclinique']);

describe('TEMPLATE_LIBRARY (F3)', () => {
  test('au moins 3 modeles, chacun bien forme', () => {
    expect(TEMPLATE_LIBRARY.length).toBeGreaterThanOrEqual(3);
    for (const m of TEMPLATE_LIBRARY) {
      expect(m.fields.length).toBeGreaterThan(0);
      const keys = m.fields.map((f) => f.fieldKey);
      expect(new Set(keys).size).toBe(keys.length); // cles uniques dans le modele
      for (const f of m.fields) {
        expect(TYPES.has(f.type)).toBe(true);
        expect(SCOPES.has(f.scope)).toBe(true);
        expect(SECTIONS.has(f.section ?? '')).toBe(true);
        if (f.type === 'select') expect((f.allowedValues ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});
