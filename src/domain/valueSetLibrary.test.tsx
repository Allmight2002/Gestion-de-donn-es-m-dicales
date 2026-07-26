// F4 : jeux de valeurs bien formes, et decoupage/fusion de la saisie des valeurs autorisees.
import { describe, expect, test } from 'vitest';
import { VALUE_SET_LIBRARY, mergeValues, parseAllowedValues } from './valueSetLibrary';

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

describe('parseAllowedValues', () => {
  test('decoupe une valeur par ligne, en ignorant les lignes vides', () => {
    expect(parseAllowedValues('Oui\n\nNon\n  Inconnu  \n')).toEqual(['Oui', 'Non', 'Inconnu']);
  });

  // Le defaut du champ d'origine : une valeur contenant une virgule etait impossible a saisir.
  test('preserve les virgules internes des que la saisie tient sur plusieurs lignes', () => {
    expect(parseAllowedValues('Traumatisme, membre inferieur\nBrulure')).toEqual([
      'Traumatisme, membre inferieur',
      'Brulure',
    ]);
  });

  test('reste compatible avec l ancienne saisie sur une seule ligne', () => {
    expect(parseAllowedValues('M, F')).toEqual(['M', 'F']);
  });

  test('supprime les doublons sans tenir compte de la casse', () => {
    expect(parseAllowedValues('Oui\noui\nNon')).toEqual(['Oui', 'Non']);
  });

  test('une saisie vide ne produit aucune valeur', () => {
    expect(parseAllowedValues('   \n  ')).toEqual([]);
  });
});

describe('mergeValues', () => {
  test('ajoute a la suite sans ecraser ni dupliquer', () => {
    expect(mergeValues(['Oui'], ['Non', 'Oui', 'Inconnu'])).toEqual(['Oui', 'Non', 'Inconnu']);
  });

  test('conserve l ordre existant', () => {
    expect(mergeValues(['III', 'I'], ['I', 'II'])).toEqual(['III', 'I', 'II']);
  });
});
