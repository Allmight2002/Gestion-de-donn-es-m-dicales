// Re-import d'un export MedData : les en-tetes `<portee>__<cle>` et `option_code__...`
// doivent etre associes sans intervention manuelle.
import { describe, expect, test } from 'vitest';
import { autoMapColumns, buildImportRows, duplicateTargets, findTerminologyColumns } from './import';
import type { TemplateField } from '../data/types';

const field = (
  fieldKey: string,
  label: string,
  scope: TemplateField['scope'],
  type: TemplateField['type'] = 'text',
  allowedValues: string[] | null = null,
): TemplateField => ({
  id: fieldKey, fieldKey, label, scope, section: 'clinique', type, unit: null, allowedValues,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const FIELDS: TemplateField[] = [
  field('sexe', 'Sexe', 'patient', 'select', ['m', 'f']),
  field('glasgow_score', 'Score de Glasgow', 'encounter', 'integer'),
  field('signes', 'Signes', 'encounter', 'multiselect', ['fievre', 'toux']),
  field('diag', 'Diagnostic', 'encounter', 'terminology'),
  field('note', 'Note', 'encounter'),
];

describe('autoMapColumns — export MedData', () => {
  test('profil complet : identifiants stables reconnus, code prefere au libelle', () => {
    const headers = [
      'patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_value', 'age_unit', 'group_section_key',
      'patient__sexe', 'option_code__patient__sexe',
      'encounter__glasgow_score',
      'encounter__signes', 'option_code__encounter__signes', 'nb__encounter__signes', 'has__encounter__signes__fievre',
      'encounter__diag', 'terminology_code__encounter__diag',
      'encounter__inconnue',
    ];
    const map = autoMapColumns(headers, FIELDS);
    expect(map).toEqual({
      0: 'patient_code', 1: 'ignore', 2: 'encounter_date', 3: 'encounter_type', 4: 'ignore', 5: 'ignore', 6: 'ignore',
      7: 'ignore', 8: 'patient:sexe',
      9: 'encounter:glasgow_score',
      10: 'ignore', 11: 'encounter:signes', 12: 'ignore', 13: 'ignore',
      14: 'ignore', 15: 'ignore',
      16: 'ignore',
    });
    expect(duplicateTargets(map)).toEqual([]);
    expect(findTerminologyColumns(headers, FIELDS).map((c) => c.header)).toEqual(['encounter__diag']);

    const [row] = buildImportRows(
      [['P1', 'e1', '2026-01-02', 'consultation', '40', 'ans', '', 'Femme', 'f', 12, 'Fièvre; Toux', 'fievre; toux', 2, 1, 'X', 'A00', 'z']],
      map,
      FIELDS,
    );
    expect(row.patient_data).toEqual({ sexe: 'f' });
    expect(row.encounter).toEqual({
      encounter_type: 'consultation', encounter_date: '2026-01-02', data: { glasgow_score: 12, signes: ['fievre', 'toux'] },
    });
  });

  test('profil analyse : la colonne principale d une liste porte deja le code', () => {
    const map = autoMapColumns(['patient_code', 'patient__sexe', 'encounter__note'], FIELDS);
    expect(map).toEqual({ 0: 'patient_code', 1: 'patient:sexe', 2: 'encounter:note' });
  });

  test('les en-tetes par libelle ou cle nue restent reconnus', () => {
    expect(autoMapColumns(['Score de Glasgow', 'note'], FIELDS)).toEqual({ 0: 'encounter:glasgow_score', 1: 'encounter:note' });
  });
});
