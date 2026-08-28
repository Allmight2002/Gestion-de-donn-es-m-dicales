// F4 : jeux de valeurs bien formes. Le decoupage/fusion de la saisie libre a disparu avec la
// zone de texte, remplacee a L30 par un editeur d'options structure.
import { describe, expect, test } from 'vitest';
import { VALUE_SET_LIBRARY } from './valueSetLibrary';

describe('VALUE_SET_LIBRARY (F4)', () => {
  test('chaque jeu est bien forme et sans doublon interne', () => {
    expect(VALUE_SET_LIBRARY.length).toBeGreaterThanOrEqual(3);
    const ids = VALUE_SET_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of VALUE_SET_LIBRARY) {
      expect(set.name.trim()).not.toBe('');
      expect(set.domain.trim()).not.toBe('');
      expect(set.values.length).toBeGreaterThan(0);
      expect(set.values.every((v) => v.trim() !== '')).toBe(true);
      expect(new Set(set.values).size).toBe(set.values.length);
    }
  });

  // Le lot ne livre AUCUNE liste de diagnostics : celle des urgences attend le retour terrain,
  // et une nomenclature clinique ne s'invente pas depuis le depot.
  test('aucun jeu de diagnostics n est fourni pour l instant', () => {
    expect(VALUE_SET_LIBRARY.some((s) => /diagnostic/i.test(s.id) || /diagnostic/i.test(s.name))).toBe(false);
  });
});
