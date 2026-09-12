// UX-14(d) — la conversion « variable lue -> charge d'ecriture » doit être EXHAUSTIVE.
//
// Ce test est la garantie qui rend un déplacement sûr : la RPC de modification remplace la
// ligne entière, donc tout attribut oublié ici disparaîtrait du gabarit au premier
// déplacement, sans message d'erreur et sans que personne ne le voie avant la saisie suivante.
import { describe, expect, test } from 'vitest';
import type { NewField, TemplateField } from '../data/types';
import { templateFieldToNewField } from './templateFields';

const COMPLETE: TemplateField = {
  id: 'f1',
  fieldKey: 'evolution',
  label: 'Évolution',
  description: 'Consigne de saisie',
  defaultValue: 'gueri',
  scope: 'encounter',
  section: 'clinique',
  type: 'select',
  isMultiple: false,
  unit: 'mg',
  allowedValues: ['gueri', 'deces'],
  allowedOptions: [
    { value_key: 'gueri', label: 'Guéri', is_active: true },
    { value_key: 'deces', label: 'Décès', is_active: false },
  ],
  required: true,
  minValue: 1,
  maxValue: 10,
  allowMissingCodes: true,
  missingReasons: ['non_fait', 'inconnu'],
  formula: null,
  displayOrder: 7,
  encounterTypes: ['consultation', 'suivi'],
};

describe('templateFieldToNewField — UX-14(d)', () => {
  test('reporte chaque attribut de la variable, y compris ceux qu\'un déplacement ne touche pas', () => {
    const converted = templateFieldToNewField(COMPLETE);

    expect(converted).toEqual({
      fieldKey: 'evolution',
      label: 'Évolution',
      description: 'Consigne de saisie',
      defaultValue: 'gueri',
      scope: 'encounter',
      section: 'clinique',
      type: 'select',
      required: true,
      isMultiple: false,
      encounterTypes: ['consultation', 'suivi'],
      allowedValues: ['gueri', 'deces'],
      allowedOptions: [
        { valueKey: 'gueri', label: 'Guéri', isActive: true },
        { valueKey: 'deces', label: 'Décès', isActive: false },
      ],
      minValue: 1,
      maxValue: 10,
      unit: 'mg',
      allowMissingCodes: true,
      missingReasons: ['non_fait', 'inconnu'],
      formula: null,
    } satisfies NewField);

    // Le test échouera si un attribut est ajouté à `NewField` sans être reporté ici : la
    // comparaison est exhaustive dans les deux sens.
    const attendus: Array<keyof NewField> = Object.keys(converted).sort() as Array<keyof NewField>;
    expect(attendus).toEqual([
      'allowMissingCodes', 'allowedOptions', 'allowedValues', 'defaultValue', 'description',
      'encounterTypes', 'fieldKey', 'formula', 'isMultiple', 'label', 'maxValue', 'minValue',
      'missingReasons', 'required', 'scope', 'section', 'type', 'unit',
    ].sort());
  });

  test('seul l\'attribut demandé change, et une variable calculée garde sa formule', () => {
    const calculee: TemplateField = {
      ...COMPLETE, type: 'number', formula: 'date_sortie - date_entree', allowedOptions: null,
      allowedValues: null, required: false, defaultValue: null, missingReasons: [], allowMissingCodes: false,
    };
    const deplacee = templateFieldToNewField(calculee, { section: 'biologie' });

    expect(deplacee.section).toBe('biologie');
    expect(deplacee.formula).toBe('date_sortie - date_entree');
    expect(deplacee.allowedOptions).toBeNull();
    // Aucune option inventée à partir d'un miroir absent.
    expect(deplacee.allowedValues).toBeNull();
    expect(deplacee.fieldKey).toBe('evolution');
  });

  test('un instantané ancien, sans options ni raisons, reste convertible', () => {
    const ancienne: TemplateField = {
      id: 'f2', fieldKey: 'poids', label: 'Poids', scope: 'patient', section: null, type: 'number',
      unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
      allowMissingCodes: false, displayOrder: 0,
    };
    const converted = templateFieldToNewField(ancienne, { section: 'clinique' });

    expect(converted.section).toBe('clinique');
    expect(converted.allowedOptions).toBeNull();
    expect(converted.missingReasons).toBeNull();
    expect(converted.isMultiple).toBe(false);
    expect(converted.encounterTypes).toBeNull();
  });
});
