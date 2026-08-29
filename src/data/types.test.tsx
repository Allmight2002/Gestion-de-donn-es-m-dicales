// L21 : une liste de diagnostics doit se LIRE partout ou une valeur unitaire se lisait deja.
// `displayFieldValue` teste `isTerminologyValue` avant `Array.isArray` ; sans cas dedie, un
// tableau de couples tombait dans `join(', ')` et rendait « [object Object] » sur toute la
// colonne — la meme regression que celle deja rencontree sur les codes manquants.
import { describe, expect, test } from 'vitest';
import { displayFieldValue, isMultipleTerminology, isTerminologyList } from './types';

const CHOLERA = { code: '1A00', label: 'Cholera' };
const DIABETE = { code: '5A11', label: 'Diabete de type 2' };

describe('displayFieldValue — listes de diagnostics (L21)', () => {
  test('rend les libelles joints, jamais [object Object]', () => {
    const rendu = displayFieldValue([CHOLERA, DIABETE]);
    expect(rendu).toBe('Cholera; Diabete de type 2');
    expect(rendu).not.toContain('[object Object]');
  });

  test('une liste a une seule valeur se lit comme une valeur unitaire', () => {
    expect(displayFieldValue([CHOLERA])).toBe('Cholera');
  });

  test('l ordre affiche est celui du tableau : le premier reste le principal', () => {
    expect(displayFieldValue([DIABETE, CHOLERA])).toBe('Diabete de type 2; Cholera');
  });

  test('les autres valeurs ne changent pas de rendu', () => {
    expect(displayFieldValue(CHOLERA)).toBe('Cholera');
    expect(displayFieldValue(['a', 'b'])).toBe('a, b');
    expect(displayFieldValue(null, '—')).toBe('—');
    expect(displayFieldValue([], '—')).toBe('');
  });
});

describe('gardes de cardinalite (L21)', () => {
  test('isTerminologyList exige un tableau NON VIDE de couples complets', () => {
    expect(isTerminologyList([CHOLERA])).toBe(true);
    // Le tableau vide n'est pas une liste : « pas de valeur » se dit par l'absence de cle.
    expect(isTerminologyList([])).toBe(false);
    expect(isTerminologyList([CHOLERA, { code: '5A11' }])).toBe(false);
    expect(isTerminologyList(CHOLERA)).toBe(false);
  });

  test('isMultipleTerminology reste faux hors terminologie, comme la contrainte serveur', () => {
    expect(isMultipleTerminology({ type: 'terminology', isMultiple: true })).toBe(true);
    expect(isMultipleTerminology({ type: 'terminology' })).toBe(false);
    expect(isMultipleTerminology({ type: 'multiselect', isMultiple: true })).toBe(false);
  });
});
