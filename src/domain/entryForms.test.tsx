import { describe, expect, test } from 'vitest';
import type { TemplateField, TemplateSection, ValidationRule } from '../data/types';
import { resolveEntryForm, visibilityOnlyRules, withoutUnshownProposals } from './entryForms';

const field = (fieldKey: string, extra: Partial<TemplateField> = {}): TemplateField => ({
  id: fieldKey, fieldKey, label: fieldKey.toUpperCase(), scope: 'patient', section: 'clinique', type: 'text',
  unit: null, allowedValues: null, required: false, minValue: null, maxValue: null, allowMissingCodes: false,
  displayOrder: 0, ...extra,
});

const rule = (value: unknown): ValidationRule => ({ id: JSON.stringify(value), rule: value, message: null, severity: 'block' });

const FIELDS: TemplateField[] = [
  field('sexe', { section: 'demo', required: true, type: 'select', allowedValues: ['M', 'F'] }),
  field('pathologie', { section: 'diag', type: 'select', allowedValues: ['tc', 'avc'] }),
  field('pathologie_autre', { section: 'diag' }),
  field('glasgow', { section: 'tc', type: 'integer', required: true }),
  field('scanner', { section: 'imagerie', type: 'select', allowedValues: ['oui', 'non'] }),
  field('date_entree', { section: 'sejour', type: 'date' }),
  field('date_sortie', { section: 'sejour', type: 'date' }),
  field('duree', { section: 'sejour', type: 'integer', formula: 'date_sortie - date_entree' }),
  field('lesion_type', { section: 'lesions' }),
];

const SECTIONS: TemplateSection[] = [
  { id: 's1', sectionKey: 'tc', label: 'Traumatisme', displayOrder: 1 },
  { id: 's2', sectionKey: 'lesions', label: 'Lésions', displayOrder: 2, isRepeatable: true },
];

const RULES: ValidationRule[] = [
  // Bloc « Traumatisme » visible seulement pour un TC : glasgow depend de `pathologie`.
  rule({ if: { field: 'pathologie', operator: 'equals', value: 'tc' }, then: { section: 'tc', operator: 'visible' } }),
  rule({ if: { field: 'glasgow', operator: 'less_than', value: 9 }, then: { field: 'scanner', operator: 'required' } }),
];

describe('resolveEntryForm', () => {
  test('garde sections et ordre du formulaire complet, quel que soit l’ordre de selection, et ses propres requis', () => {
    const resolved = resolveEntryForm(
      { name: 'Sortie', fieldKeys: ['date_sortie', 'sexe'], requiredKeys: ['date_sortie'] },
      FIELDS, RULES, SECTIONS,
    );
    expect(resolved.fields.map((f) => f.fieldKey)).toEqual(['sexe', 'date_sortie']);
    expect(resolved.fields.map((f) => f.section)).toEqual(['demo', 'sejour']);
    // Le requis du formulaire complet (sexe) ne bloque pas ce formulaire court.
    expect(resolved.fields.map((f) => f.required)).toEqual([false, true]);
    expect(resolved.dependencyKeys.size).toBe(0);
  });

  test('ajoute la variable qui conditionne l’affichage d’une variable choisie (bloc compris)', () => {
    const resolved = resolveEntryForm(
      { name: 'Rapide', fieldKeys: ['sexe', 'glasgow'], requiredKeys: ['glasgow'] }, FIELDS, RULES, SECTIONS,
    );
    expect(resolved.fields.map((f) => f.fieldKey)).toEqual(['sexe', 'pathologie', 'pathologie_autre', 'glasgow']);
    expect([...resolved.dependencyKeys]).toEqual(['pathologie']);
    // Une dependance ajoutee n'est jamais rendue obligatoire.
    expect(resolved.fields.find((f) => f.fieldKey === 'pathologie')?.required).toBe(false);
    // Le champ « autre » suit sa liste source.
    expect(resolved.editableKeys.has('pathologie_autre')).toBe(true);
  });

  test('ajoute les operandes d’une variable calculee et ignore les variables retirees ou repetables', () => {
    const resolved = resolveEntryForm(
      { name: 'Séjour', fieldKeys: ['duree', 'date_entree', 'ancienne', 'lesion_type'], requiredKeys: [] },
      FIELDS, RULES, SECTIONS,
    );
    expect(resolved.fields.map((f) => f.fieldKey)).toEqual(['date_entree', 'date_sortie', 'duree']);
    expect([...resolved.dependencyKeys]).toEqual(['date_sortie']);
    expect(resolved.unavailableKeys).toEqual(['ancienne', 'lesion_type']);
  });

  test('un champ « autre » choisi seul ramene sa liste source', () => {
    const resolved = resolveEntryForm({ name: 'D', fieldKeys: ['pathologie_autre'], requiredKeys: [] }, FIELDS, RULES, SECTIONS);
    expect(resolved.fields.map((f) => f.fieldKey)).toEqual(['pathologie', 'pathologie_autre']);
  });

  test('les regles conservees pour un formulaire court sont les seules regles d’affichage', () => {
    expect(visibilityOnlyRules(RULES)).toEqual([RULES[0]]);
  });

  test('une valeur proposee non affichee n’est jamais envoyee ; une saisie reelle l’est toujours', () => {
    const data = { sexe: 'F', scanner: 'non', glasgow: 12 };
    const prefilled = new Set(['scanner', 'sexe']);
    expect(withoutUnshownProposals(data, prefilled, new Set(['sexe']))).toEqual({ sexe: 'F', glasgow: 12 });
    expect(withoutUnshownProposals(data, prefilled, null)).toBe(data);
  });
});
