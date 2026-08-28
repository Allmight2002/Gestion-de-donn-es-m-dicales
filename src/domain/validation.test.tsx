// L21 : la validation web d'un diagnostic ne verifie que la FORME. L'existence du concept, les
// doublons et la borne de 50 restent au serveur, qui est seul a disposer du referentiel — ce
// partage n'est pas un oubli, il evite qu'un client se croie autorise a trancher a sa place.
import { describe, expect, test } from 'vitest';
import { validateField } from './validation';
import type { TemplateField } from '../data/types';

const CHOLERA = { code: '1A00', label: 'Cholera' };
const DIABETE = { code: '5A11', label: 'Diabete de type 2' };

const champ = (over: Partial<TemplateField> = {}): TemplateField => ({
  id: 'diagnostic', fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter',
  section: 'clinique', type: 'terminology', unit: null, allowedValues: null, required: false,
  minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...over,
});

describe('validateField — diagnostic multivalue (L21)', () => {
  const liste = champ({ isMultiple: true });

  test('une liste de couples bien formes passe', () => {
    expect(validateField(liste, [CHOLERA, DIABETE])).toBeNull();
    expect(validateField(liste, [CHOLERA])).toBeNull();
  });

  test('un element incomplet est refuse', () => {
    expect(validateField(liste, [CHOLERA, { code: '5A11' }])).toContain('Liste de diagnostics');
    expect(validateField(liste, [{ code: '', label: 'Vide' }])).toContain('Liste de diagnostics');
  });

  test('une valeur unitaire ne vaut pas une liste, et reciproquement', () => {
    expect(validateField(liste, CHOLERA)).toContain('Liste de diagnostics');
    expect(validateField(champ(), [CHOLERA])).toContain('Diagnostic incomplet');
  });

  // Le tableau vide n'atteint jamais la branche de type : il est traite en amont comme une
  // ABSENCE de valeur, ce qui est exactement la lecture voulue par la specification.
  test('une liste vide est une absence de valeur, pas une liste invalide', () => {
    expect(validateField(liste, [])).toBeNull();
    expect(validateField(champ({ isMultiple: true, required: true }), [])).toBe('Champ obligatoire');
    expect(validateField(champ({ isMultiple: true, required: true }), [], false)).toBeNull();
  });

  test('un code de donnee manquante remplace la liste et reste soumis aux raisons ouvertes', () => {
    const avecRaison = champ({ isMultiple: true, allowMissingCodes: true, missingReasons: ['non_fait'] });
    expect(validateField(avecRaison, { __missing__: 'non_fait' })).toBeNull();
    expect(validateField(avecRaison, { __missing__: 'inconnu' })).toContain('Raison de valeur manquante');
    expect(validateField(liste, { __missing__: 'non_fait' })).toContain('Valeur manquante non autorisée');
  });

  // Ni l'existence du concept, ni les doublons, ni la borne de 50 ne sont juges ici : les
  // laisser passer cote web est deliberé, le serveur les refuse.
  test('ce qui releve du serveur n est pas rejuge ici', () => {
    expect(validateField(liste, [{ code: 'INEXISTANT', label: 'Inconnu au referentiel' }])).toBeNull();
    expect(validateField(liste, [CHOLERA, CHOLERA])).toBeNull();
  });
});
