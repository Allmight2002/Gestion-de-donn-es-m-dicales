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

describe('displayFieldValue — codage assiste', () => {
  const NON_CODE = { raw: 'Syndrome fictif', coding: { method: 'lexical', status: 'unmatched' } };

  test('un texte non code se lit tel qu ecrit, seul ou dans une liste', () => {
    expect(displayFieldValue(NON_CODE)).toBe('Syndrome fictif');
    expect(displayFieldValue([CHOLERA, NON_CODE])).toBe('Cholera; Syndrome fictif');
  });

  test('la provenance ne change pas le libelle affiche', () => {
    expect(displayFieldValue({ ...CHOLERA, raw: 'cholera grave', coding: { method: 'ai_assisted', status: 'automatic' } }))
      .toBe('Cholera');
  });
});

// Revue post-optimisation, lot C1 : une proposition jamais relue se lisait comme un diagnostic
// etabli. Avec les mentions, le statut se lit ; sans elles, le rendu historique est conserve.
describe('displayFieldValue — statut du codage assiste (C1)', () => {
  const MARKS = { toConfirm: 'à confirmer', uncoded: 'non codé' };
  const PROPOSE = { ...DIABETE, raw: 'DT2', coding: { method: 'ai_assisted', status: 'suggested' } };
  const NON_CODE = { raw: 'Syndrome fictif', coding: { method: 'ai_assisted', status: 'unmatched' } };

  test('une proposition se lit « à confirmer », un texte libre « non codé »', () => {
    expect(displayFieldValue(PROPOSE, '—', null, undefined, MARKS)).toBe('Diabete de type 2 (à confirmer)');
    expect(displayFieldValue(NON_CODE, '—', null, undefined, MARKS)).toBe('Syndrome fictif (non codé)');
  });

  test('un code verifie ne porte aucune mention', () => {
    for (const status of ['automatic', 'confirmed', 'manually_modified']) {
      expect(displayFieldValue({ ...CHOLERA, raw: 'cholera', coding: { method: 'ai_assisted', status } }, '—', null, undefined, MARKS))
        .toBe('Cholera');
    }
    expect(displayFieldValue(CHOLERA, '—', null, undefined, MARKS)).toBe('Cholera');
  });

  test('dans une liste, chaque entree garde son statut et son rang', () => {
    expect(displayFieldValue([CHOLERA, PROPOSE, NON_CODE], '—', null, undefined, MARKS))
      .toBe('Cholera; Diabete de type 2 (à confirmer); Syndrome fictif (non codé)');
  });

  test('sans mentions, le rendu historique est inchange ; une valeur vide reste vide', () => {
    expect(displayFieldValue(PROPOSE)).toBe('Diabete de type 2');
    expect(displayFieldValue([PROPOSE, NON_CODE])).toBe('Diabete de type 2; Syndrome fictif');
    expect(displayFieldValue(null, '—', null, undefined, MARKS)).toBe('—');
    expect(displayFieldValue('texte', '—', null, undefined, MARKS)).toBe('texte');
  });
});
