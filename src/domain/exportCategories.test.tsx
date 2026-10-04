import { describe, expect, test } from 'vitest';
import { exportDiagnosisCategories } from './exportCategories';
import type { DiagnosisContext, TemplateField, TemplateSection } from '../data/types';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type' | 'section'>): TemplateField {
  return { id: p.fieldKey, label: p.fieldKey, scope: 'encounter', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p };
}

const SECTIONS: TemplateSection[] = [
  { id: 's1', sectionKey: 'tuberculose', label: 'Tuberculose', displayOrder: 1, parentSectionKey: null },
  { id: 's2', sectionKey: 'tb_bio', label: 'Biologie', displayOrder: 2, parentSectionKey: 'tuberculose' },
  { id: 's3', sectionKey: 'nutrition', label: 'Nutrition', displayOrder: 0, parentSectionKey: null },
  { id: 's4', sectionKey: 'vih', label: 'VIH', displayOrder: 3, parentSectionKey: null },
];
const FIELDS: TemplateField[] = [
  field({ fieldKey: 'diag', type: 'multiselect', section: 'clinique',
    allowedOptions: [{ valueKey: 'TB', label: 'Tuberculose', isActive: true }, { valueKey: 'MAL', label: 'Malnutrition', isActive: true }] } as Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type' | 'section'>),
  field({ fieldKey: 'crachat', type: 'text', section: 'tuberculose' }),
  field({ fieldKey: 'poids', type: 'number', section: 'nutrition' }),
  field({ fieldKey: 'cd4', type: 'integer', section: 'vih' }),
];
const CONTEXT: DiagnosisContext[] = [{ scope: 'encounter', diagnosisFieldKey: 'diag', terminologyReleaseId: null,
  commonOnlyCodes: [], proposalFieldKey: 'diag_autre', recognizedCodes: ['TB', 'MAL'] }];
const show = (codes: string[], section: string) =>
  ({ rule: { if: { field: 'diag', operator: 'contains_any', value: codes }, then: { section, operator: 'visible' } } });

describe('exportDiagnosisCategories', () => {
  test('regroupe les blocs racines par code, avec le libelle de l option', () => {
    const rules = [show(['TB'], 'tuberculose'), show(['TB', 'MAL'], 'nutrition'),
      { rule: { if: { field: 'cd4', operator: 'gt', value: 1 }, then: { section: 'vih', operator: 'visible' } } }];
    expect(exportDiagnosisCategories({ diagnosisContext: CONTEXT }, FIELDS, rules, SECTIONS)).toEqual([
      { code: 'MAL', label: 'Malnutrition', blockKeys: ['nutrition'] },
      { code: 'TB', label: 'Tuberculose', blockKeys: ['nutrition', 'tuberculose'] },
    ]);
  });

  test('sans configuration diagnostique, aucune categorie', () => {
    expect(exportDiagnosisCategories({}, FIELDS, [show(['TB'], 'tuberculose')], SECTIONS)).toEqual([]);
  });
});
