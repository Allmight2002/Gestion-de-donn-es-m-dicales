// L74c — contexte patient d'une occurrence (cadrage L74, §3, §3.1 et §9.2).
import { describe, expect, test } from 'vitest';
import type { TemplateField, TemplateSection, ValidationRule } from '../data/types';
import { hiddenFieldKeys } from './validation';
import {
  contextHiddenFieldKeys, EMPTY_OCCURRENCE_CONTEXT, occurrenceContextOf, occurrenceEvaluationData,
  occurrenceHiddenFieldKeys, occurrenceNeedsReview, occurrenceVerdict,
} from './occurrenceContext';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type' | 'scope'>): TemplateField {
  return {
    id: p.fieldKey, label: p.fieldKey, section: 'lesions', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}

const rule = (id: string, body: unknown, severity: 'block' | 'warn' = 'block'): ValidationRule => ({
  id, rule: body, message: `regle ${id}`, severity,
});

// Données fictives.
const trauma = field({ fieldKey: 'trauma', type: 'boolean', scope: 'patient', section: 'clinique' });
const age = field({ fieldKey: 'age_diag', type: 'integer', scope: 'patient', section: 'clinique' });
const niveau = field({ fieldKey: 'niveau', type: 'text', scope: 'encounter' });
const gradation = field({ fieldKey: 'gradation_ao', type: 'text', scope: 'encounter', required: true });
const sousType = field({ fieldKey: 'sous_type', type: 'text', scope: 'encounter' });
const groupFields = [niveau, gradation, sousType];
const allFields = [trauma, age, ...groupFields];
const formSections: TemplateSection[] = [
  { id: 's-lesions', sectionKey: 'lesions', label: 'Lésions', displayOrder: 1, isRepeatable: false },
];

const showGradation = rule('r1', { if: { field: 'trauma', operator: 'equals', value: true }, then: { field: 'gradation_ao', operator: 'visible' } });
const cascade = rule('r2', { if: { field: 'gradation_ao', operator: 'equals', value: 'C' }, then: { field: 'sous_type', operator: 'visible' } });

describe('occurrenceContextOf', () => {
  test('ne garde que les variables permanentes affichées de la version', () => {
    const context = occurrenceContextOf({ trauma: true, age_diag: 40, niveau: 'C5', inconnue: 1 }, allFields, new Set(['age_diag']));
    expect([...context.keys].sort()).toEqual(['age_diag', 'trauma']);
    expect(context.values).toEqual({ trauma: true });
  });
});

describe('occurrenceEvaluationData', () => {
  test('fusionne sans laisser une clé permanente venir de l’occurrence', () => {
    const context = occurrenceContextOf({ trauma: true }, allFields);
    expect(occurrenceEvaluationData({ niveau: 'C5', trauma: false }, context)).toEqual({ niveau: 'C5', trauma: true });
  });
});

describe('visibilité sur contexte ⊕ occurrence', () => {
  test('le pilote permanent coché affiche la variable de groupe ; décoché ou vide, il la masque', () => {
    const on = occurrenceContextOf({ trauma: true }, allFields);
    const off = occurrenceContextOf({ trauma: false }, allFields);
    const empty = occurrenceContextOf({}, allFields);
    expect(occurrenceHiddenFieldKeys([showGradation], {}, groupFields, formSections, on).has('gradation_ao')).toBe(false);
    expect(occurrenceHiddenFieldKeys([showGradation], {}, groupFields, formSections, off).has('gradation_ao')).toBe(true);
    expect(occurrenceHiddenFieldKeys([showGradation], {}, groupFields, formSections, empty).has('gradation_ao')).toBe(true);
  });

  test('un pilote masqué sur la fiche se lit comme absent', () => {
    const context = occurrenceContextOf({ trauma: true }, allFields, new Set(['trauma']));
    expect(occurrenceHiddenFieldKeys([showGradation], {}, groupFields, formSections, context).has('gradation_ao')).toBe(true);
  });

  test('cascade : la variable pilotée par une variable masquée par le contexte est masquée', () => {
    const off = occurrenceContextOf({ trauma: false }, allFields);
    const hidden = occurrenceHiddenFieldKeys([showGradation, cascade], { gradation_ao: 'C' }, groupFields, formSections, off);
    expect(hidden.has('gradation_ao')).toBe(true);
    expect(hidden.has('sous_type')).toBe(true);
  });

  test('§9.2 test 18 — sans règle de contexte, l’ensemble masqué est celui d’avant L74', () => {
    const rules = [cascade];
    for (const values of [{}, { gradation_ao: 'C' }, { gradation_ao: 'A', sous_type: 'x' }]) {
      const before = hiddenFieldKeys(rules, values, groupFields, formSections);
      expect(occurrenceHiddenFieldKeys(rules, values, groupFields, formSections, occurrenceContextOf({ trauma: true }, allFields)))
        .toEqual(before);
      expect(occurrenceHiddenFieldKeys(rules, values, groupFields, formSections)).toEqual(before);
    }
  });
});

describe('contextHiddenFieldKeys — colonnes retirées du tableau', () => {
  test('retient le masquage dû au contexte et sa cascade, jamais un masquage interne à l’occurrence', () => {
    const off = occurrenceContextOf({ trauma: false }, allFields);
    const on = occurrenceContextOf({ trauma: true }, allFields);
    expect([...contextHiddenFieldKeys([showGradation, cascade], groupFields, formSections, off)].sort())
      .toEqual(['gradation_ao', 'sous_type']);
    // Contexte satisfait : `sous_type` dépend de chaque occurrence, il reste au niveau de la cellule.
    expect(contextHiddenFieldKeys([showGradation, cascade], groupFields, formSections, on).size).toBe(0);
    expect(contextHiddenFieldKeys([cascade], groupFields, formSections, off).size).toBe(0);
    expect(contextHiddenFieldKeys([showGradation], groupFields, formSections, EMPTY_OCCURRENCE_CONTEXT).size).toBe(0);
  });
});

describe('occurrenceVerdict — séparation §3.1', () => {
  test('§9.2 test 15 — le payload ne contient ni clé permanente ni valeur masquée', () => {
    const off = occurrenceContextOf({ trauma: false, age_diag: 40 }, allFields);
    const verdict = occurrenceVerdict({
      rules: [showGradation], fields: groupFields, sections: formSections, context: off,
      values: { niveau: 'C5', gradation_ao: 'B', trauma: true },
    });
    expect(verdict.data).toEqual({ niveau: 'C5' });
    expect(verdict.removed).toEqual(['gradation_ao']);
    // Masquée = non obligatoire : la variable requise mais masquée n'est pas réclamée.
    expect(verdict.complete).toBe(true);
  });

  test('contexte vrai : la variable requise est réclamée', () => {
    const on = occurrenceContextOf({ trauma: true }, allFields);
    const verdict = occurrenceVerdict({ rules: [showGradation], fields: groupFields, sections: formSections, context: on, values: { niveau: 'C5' } });
    expect(verdict.complete).toBe(false);
  });

  test('D3 — une règle `required` permanent → groupe reste inerte', () => {
    const required = rule('r3', { if: { field: 'trauma', operator: 'equals', value: true }, then: { field: 'sous_type', operator: 'required' } });
    const on = occurrenceContextOf({ trauma: true }, allFields);
    const verdict = occurrenceVerdict({ rules: [required], fields: [niveau, sousType], sections: formSections, context: on, values: { niveau: 'C5' } });
    expect(verdict.ruleErrors).toEqual([]);
    expect(verdict.complete).toBe(true);
  });

  test('une règle bloquante purement patient, violée sur la fiche, ne bloque pas l’occurrence', () => {
    const patientOnly = rule('r4', { operator: 'less_than', left_field: 'age_diag', right_field: 'trauma' });
    const context = occurrenceContextOf({ trauma: true, age_diag: 40 }, allFields);
    const verdict = occurrenceVerdict({ rules: [patientOnly], fields: [niveau], sections: formSections, context, values: { niveau: 'C5' } });
    expect(verdict.ruleErrors).toEqual([]);
  });
});

describe('occurrenceNeedsReview — lignes tamponnées à la création (§9.2 test 14)', () => {
  const evaluation = { rules: [showGradation], fields: groupFields, sections: formSections };
  test('une valeur devenue masquée ou une ligne complète devenue incomplète est à revoir', () => {
    const on = occurrenceContextOf({ trauma: true }, allFields);
    const off = occurrenceContextOf({ trauma: false }, allFields);
    const withGrade = { data: { niveau: 'C5', gradation_ao: 'B' }, validationStatus: 'complete' };
    const withoutGrade = { data: { niveau: 'C5' }, validationStatus: 'complete' };
    expect(occurrenceNeedsReview(withGrade, { ...evaluation, context: on })).toBe(false);
    expect(occurrenceNeedsReview(withGrade, { ...evaluation, context: off })).toBe(true);
    expect(occurrenceNeedsReview(withoutGrade, { ...evaluation, context: off })).toBe(false);
    expect(occurrenceNeedsReview(withoutGrade, { ...evaluation, context: on })).toBe(true);
    expect(occurrenceNeedsReview({ ...withoutGrade, validationStatus: 'draft' }, { ...evaluation, context: on })).toBe(false);
  });
});
