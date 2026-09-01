// Variables calculees (L35) — evaluateur et refus a l'enregistrement, cote NAVIGATEUR.
//
// Le meme jeu de cas est rejoue cote Deno par `exportContract_test.ts`. C'est la garantie
// centrale du lot : le front et l'Edge Function de production lisent le meme module, et on
// le PROUVE au lieu de le supposer. Le jeu vit dans `formulaCases.ts`, importe ici sans
// aucune adaptation.
import { describe, expect, test } from 'vitest';
import {
  checkFormula,
  evaluateFormulaText,
  formatFormula,
  formulaFieldIndex,
  parseFormula,
  type FormulaFieldRef,
} from '../src/domain/export';
import {
  FORMULA_CASES,
  FORMULA_CASE_FIELDS,
} from '../supabase/functions/generate-export/formulaCases';

const index = formulaFieldIndex(FORMULA_CASE_FIELDS as FormulaFieldRef[]);

describe('evaluateFormula — le meme jeu de cas que cote Deno', () => {
  test.each(FORMULA_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(evaluateFormulaText(c.formula, c.data, index)).toBe(c.expected);
  });

  test('les cinq codes de valeur manquante sont tous couverts', () => {
    const covered = FORMULA_CASES
      .flatMap((c) => Object.values(c.data))
      .filter((v): v is { __missing__: string } =>
        typeof v === 'object' && v !== null && '__missing__' in v)
      .map((v) => v.__missing__);
    expect(new Set(covered)).toEqual(
      new Set(['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente']),
    );
  });

  test('aucun cas ne rend zero la ou le resultat doit etre ABSENT', () => {
    // Le defaut qu'on se refuse : un zero fabrique se lirait comme une mesure.
    const absents = FORMULA_CASES.filter((c) => c.expected === null);
    expect(absents.length).toBeGreaterThan(10);
    for (const c of absents) {
      expect(evaluateFormulaText(c.formula, c.data, index)).not.toBe(0);
    }
  });
});

describe('parseFormula — grammaire fermee, une seule operation', () => {
  test('lit « A op B » et le restitue a l identique', () => {
    const parsed = parseFormula('date_sortie - date_entree');
    expect(parsed).toEqual({
      left: { kind: 'field', fieldKey: 'date_sortie' },
      operator: '-',
      right: { kind: 'field', fieldKey: 'date_entree' },
    });
    expect(formatFormula(parsed!)).toBe('date_sortie - date_entree');
  });

  test('accepte une constante decimale ou negative', () => {
    expect(parseFormula('poids * 2.5')?.right).toEqual({ kind: 'literal', value: 2.5 });
    expect(parseFormula('poids * -1')?.right).toEqual({ kind: 'literal', value: -1 });
  });

  test.each([
    ['imbrication', 'a + b - c'],
    ['parentheses', '(a + b) / 2'],
    ['appel de fonction', 'round(a)'],
    ['condition', 'a > b'],
    ['puissance', 'a ^ 2'],
    ['operande seul', 'a'],
    ['operateur inconnu', 'a % b'],
    ['nom invalide', 'poids (kg) / 2'],
    ['vide', ''],
  ])('refuse %s', (_label, text) => {
    expect(parseFormula(text)).toBeNull();
  });
});

describe('checkFormula — refus a l enregistrement du gabarit', () => {
  const peers: FormulaFieldRef[] = [
    { fieldKey: 'score_j0', type: 'integer' },
    { fieldKey: 'score_j7', type: 'integer' },
    { fieldKey: 'date_entree', type: 'date' },
    { fieldKey: 'date_sortie', type: 'date' },
    { fieldKey: 'heure_entree', type: 'datetime' },
    { fieldKey: 'heure_sortie', type: 'datetime' },
    { fieldKey: 'commentaire', type: 'text' },
    { fieldKey: 'duree_deja_calculee', type: 'integer', formula: 'date_sortie - date_entree' },
  ];

  test('accepte une soustraction de nombres, type de sortie « number »', () => {
    const check = checkFormula('score_j7 - score_j0', 'delta', peers);
    expect(check.ok).toBe(true);
    expect(check.outputType).toBe('number');
  });

  test('accepte date - date, type de sortie « integer » (des jours)', () => {
    const check = checkFormula('date_sortie - date_entree', 'duree', peers);
    expect(check.ok).toBe(true);
    expect(check.outputType).toBe('integer');
  });

  test('deduit le type selon l unite de restitution date - date', () => {
    expect(checkFormula('date_sortie - date_entree', 'duree_heures', peers, 'hours').outputType).toBe('integer');
    expect(checkFormula('date_sortie - date_entree', 'duree_semaines', peers, 'weeks').outputType).toBe('number');
    expect(checkFormula('date_sortie - date_entree', 'duree_annees', peers, 'years').outputType).toBe('number');
  });

  test('accepte datetime - datetime, type de sortie « number » (jours fractionnaires)', () => {
    const check = checkFormula('heure_sortie - heure_entree', 'duree_precise', peers);
    expect(check.ok).toBe(true);
    expect(check.outputType).toBe('number');
  });

  test('accepte une date et une date-heure ensemble, avec une sortie « number »', () => {
    const check = checkFormula('heure_sortie - date_entree', 'duree_mixte', peers);
    expect(check.ok).toBe(true);
    expect(check.outputType).toBe('number');
    const inverse = checkFormula('date_sortie - heure_entree', 'duree_mixte_inverse', peers);
    expect(inverse.ok).toBe(true);
    expect(inverse.outputType).toBe('number');
  });

  test('refuse un operande inconnu, en le nommant', () => {
    const check = checkFormula('score_j7 - absent_du_gabarit', 'delta', peers);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('unknown_operand');
    expect(check.detail).toBe('absent_du_gabarit');
  });

  test('refuse un operande de type incompatible', () => {
    const check = checkFormula('score_j7 - commentaire', 'delta', peers);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('operand_type');
    expect(check.detail).toBe('commentaire');
  });

  test('refuse la reference a une AUTRE variable calculee — ce qui supprime les cycles', () => {
    const check = checkFormula('duree_deja_calculee * 2', 'duree_x2', peers);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('calculated_operand');
    expect(check.detail).toBe('duree_deja_calculee');
  });

  test('refuse qu une variable se reference elle-meme', () => {
    const check = checkFormula('duree - score_j0', 'duree', peers);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('self_reference');
  });

  test.each(['+', '*', '/'])('refuse « date %s date » : seule la soustraction a un sens', (op) => {
    const check = checkFormula(`date_sortie ${op} date_entree`, 'duree', peers);
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('operator_type');
  });

  test('refuse de melanger une date et un nombre', () => {
    // « date + 3 » demanderait de decider si 3 est un jour, un mois ou une heure.
    expect(checkFormula('date_entree + 3', 'x', peers).problem).toBe('operator_type');
    expect(checkFormula('date_entree - score_j0', 'x', peers).problem).toBe('operator_type');
    expect(checkFormula('heure_entree + 3', 'x', peers).problem).toBe('operator_type');
  });

  test('refuse deux constantes : ce n est pas une variable de dossier', () => {
    expect(checkFormula('2 + 3', 'x', peers).problem).toBe('constant_only');
  });

  test('refuse une syntaxe hors grammaire', () => {
    expect(checkFormula('score_j0 + score_j7 - 1', 'x', peers).problem).toBe('syntax');
  });
});

describe('evaluateFormula — unite de restitution des durees', () => {
  test.each([
    ['seconds', 172800],
    ['minutes', 2880],
    ['hours', 48],
    ['days', 2],
    ['weeks', 0.285714],
    ['years', 0.005476],
  ] as const)('convertit date - date en %s', (unit, expected) => {
    expect(evaluateFormulaText(
      'date_sortie - date_entree',
      { date_entree: '2024-01-01', date_sortie: '2024-01-03' },
      index,
      unit,
    )).toBe(expected);
  });

  test('conserve les anciennes formules sans unite en jours', () => {
    expect(evaluateFormulaText(
      'date_sortie - date_entree',
      { date_entree: '2024-01-01', date_sortie: '2024-01-03' },
      index,
    )).toBe(2);
  });

  test('convertit aussi la fraction issue de deux date-heures', () => {
    expect(evaluateFormulaText(
      'heure_sortie - heure_entree',
      { heure_entree: '2024-01-01T08:00', heure_sortie: '2024-01-02T20:00' },
      index,
      'hours',
    )).toBe(36);
  });
});
