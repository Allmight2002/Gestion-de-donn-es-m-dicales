// L28 : la valeur PROPOSEE a la saisie. Une proposition epargne une frappe ; elle ne doit
// jamais repondre a la place de la personne qui saisit, ni survivre a son effacement.
import { describe, expect, test } from 'vitest';
import {
  NOW_TOKEN,
  TODAY_TOKEN,
  defaultValueRisk,
  forgetPrefilled,
  initialValuesFromDefaults,
  resolveDefaultValue,
  supportsDefaultValue,
} from './fieldDefaults';
import type { TemplateField } from '../data/types';

function field(over: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type'>): TemplateField {
  return {
    id: over.fieldKey,
    label: over.fieldKey,
    scope: 'encounter',
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 0,
    ...over,
  } as TemplateField;
}

describe('resolution de la proposition', () => {
  // Une date figee dans le jeu de variables vieillirait : le jeton est resolu a la saisie.
  test('le jeton du jour rend la date LOCALE du moment', () => {
    const at = new Date(2026, 7, 14, 0, 30); // 14 aout 2026, 00h30 locales
    const resolved = resolveDefaultValue(field({ fieldKey: 'date_consultation', type: 'date', defaultValue: TODAY_TOKEN }), at);
    expect(resolved).toBe('2026-08-14');
  });

  test('le jeton date+heure rend un format accepte par le champ de saisie', () => {
    const at = new Date(2026, 7, 14, 9, 5);
    const resolved = resolveDefaultValue(field({ fieldKey: 'admis_le', type: 'datetime', defaultValue: NOW_TOKEN }), at);
    expect(resolved).toBe('2026-08-14T09:05');
  });

  test('une date litterale est rendue telle quelle', () => {
    expect(resolveDefaultValue(field({ fieldKey: 'd', type: 'date', defaultValue: '2020-01-01' }))).toBe('2020-01-01');
  });

  test('chaque type rend la valeur dans sa forme de saisie', () => {
    expect(resolveDefaultValue(field({ fieldKey: 'pays', type: 'text', defaultValue: 'Tchad' }))).toBe('Tchad');
    expect(resolveDefaultValue(field({ fieldKey: 'n', type: 'integer', defaultValue: '3' }))).toBe(3);
    expect(resolveDefaultValue(field({ fieldKey: 'p', type: 'number', defaultValue: '36.5' }))).toBe(36.5);
    expect(resolveDefaultValue(field({ fieldKey: 'b', type: 'boolean', defaultValue: 'true' }))).toBe(true);
    expect(resolveDefaultValue(field({ fieldKey: 'b2', type: 'boolean', defaultValue: 'false' }))).toBe(false);
  });

  test('une variable sans proposition ne propose rien', () => {
    expect(resolveDefaultValue(field({ fieldKey: 'x', type: 'text' }))).toBeUndefined();
    expect(resolveDefaultValue(field({ fieldKey: 'y', type: 'text', defaultValue: '   ' }))).toBeUndefined();
  });

  // Le refus vit aussi cote base ; l'interface ne doit pas contredire ce refus.
  test('liste multiple et terminologie n acceptent aucune proposition', () => {
    expect(supportsDefaultValue('multiselect')).toBe(false);
    expect(supportsDefaultValue('terminology')).toBe(false);
    expect(resolveDefaultValue(field({ fieldKey: 'ant', type: 'multiselect', defaultValue: 'diabete' }))).toBeUndefined();
  });
});

describe('valeurs initiales d un formulaire de creation', () => {
  test('seules les variables portant une proposition sont preremplies', () => {
    const { values, prefilled } = initialValuesFromDefaults([
      field({ fieldKey: 'pays', type: 'text', defaultValue: 'Tchad' }),
      field({ fieldKey: 'poids', type: 'number' }),
    ]);
    expect(values).toEqual({ pays: 'Tchad' });
    expect([...prefilled]).toEqual(['pays']);
  });

  test('une variable effacee sort de la liste des valeurs proposees', () => {
    const prefilled = new Set(['pays', 'date_consultation']);
    const after = forgetPrefilled(prefilled, 'pays');
    expect([...after]).toEqual(['date_consultation']);
    // Identite stable quand rien ne change : pas de rendu inutile.
    expect(forgetPrefilled(after, 'inconnue')).toBe(after);
  });
});

describe('garde-fou clinique du constructeur', () => {
  test('un intitule de jugement clinique est signale, quel que soit le type', () => {
    expect(defaultValueRisk({ fieldKey: 'complication', label: 'Complication', type: 'text' })).toBe('clinical');
    expect(defaultValueRisk({ fieldKey: 'issue_hospitalisation', label: 'Issue', type: 'text' })).toBe('clinical');
    expect(defaultValueRisk({ fieldKey: 'evolution', label: 'Évolution à 30 jours', type: 'text' })).toBe('clinical');
    // Accents et separateurs ne doivent pas faire manquer le mot.
    expect(defaultValueRisk({ fieldKey: 'deces_hospitalier', label: 'Décès hospitalier', type: 'text' })).toBe('clinical');
  });

  test('oui/non et liste sont signales par leur forme', () => {
    expect(defaultValueRisk({ fieldKey: 'fievre', label: 'Fièvre', type: 'boolean' })).toBe('shape');
    expect(defaultValueRisk({ fieldKey: 'pays', label: 'Pays', type: 'select' })).toBe('shape');
  });

  test('une variable neutre ne declenche aucun avertissement', () => {
    expect(defaultValueRisk({ fieldKey: 'pays', label: 'Pays de residence', type: 'text' })).toBeNull();
    expect(defaultValueRisk({ fieldKey: 'date_consultation', label: 'Date de consultation', type: 'date' })).toBeNull();
  });
});
