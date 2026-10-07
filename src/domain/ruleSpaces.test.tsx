// L74d — espaces d'evaluation des regles : toutes les combinaisons d'espaces, et les regles
// dormantes P1 a P5 du cadrage (docs/l74-contexte-patient-occurrences.md, §2.2 et §4 D5).
import { describe, expect, test } from 'vitest';
import type { TemplateField, TemplateSection } from '../data/types';
import {
  fieldRuleSpace,
  fieldRuleVerdict,
  ruleSpaceVerdict,
  sameRuleSpace,
  sectionCarriesGroup,
  type RuleSpace,
} from './ruleSpaces';

const sections: TemplateSection[] = [
  { id: 's-patient', sectionKey: 'identite', label: 'Identité', displayOrder: 0, parentSectionKey: null, isRepeatable: false },
  { id: 's-clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 1, parentSectionKey: null, isRepeatable: false },
  // Groupe racine.
  { id: 's-lesions', sectionKey: 'lesions', label: 'Lésions', displayOrder: 2, parentSectionKey: null, isRepeatable: true },
  // Groupe en sous-section d'un bloc racine (L72).
  { id: 's-trauma', sectionKey: 'trauma', label: 'Trauma', displayOrder: 3, parentSectionKey: null, isRepeatable: false },
  { id: 's-interventions', sectionKey: 'interventions', label: 'Interventions', displayOrder: 4, parentSectionKey: 'trauma', isRepeatable: true },
  { id: 's-trauma-notes', sectionKey: 'trauma_notes', label: 'Notes', displayOrder: 5, parentSectionKey: 'trauma', isRepeatable: false },
];

function field(fieldKey: string, scope: TemplateField['scope'], section: string | null): TemplateField {
  return {
    id: `f-${fieldKey}`, fieldKey, label: fieldKey, scope, section, type: 'select', unit: null,
    allowedValues: ['oui', 'non'], required: false, minValue: null, maxValue: null,
    allowMissingCodes: false, displayOrder: 0,
  };
}

const fields: TemplateField[] = [
  field('diagnostic', 'patient', 'identite'),
  field('opere', 'patient', 'trauma'),
  field('motif', 'encounter', 'clinique'),
  field('sans_section', 'encounter', null),
  field('notes_trauma', 'encounter', 'trauma_notes'),
  field('ao_grade', 'encounter', 'lesions'),
  field('cote', 'encounter', 'lesions'),
  field('materiel', 'encounter', 'interventions'),
];

const PATIENT: RuleSpace = { kind: 'patient' };
const ENCOUNTER: RuleSpace = { kind: 'encounter' };
const LESIONS: RuleSpace = { kind: 'group', sectionKey: 'lesions' };
const INTERVENTIONS: RuleSpace = { kind: 'group', sectionKey: 'interventions' };

const visible = (driver: string, target: string) =>
  ({ if: { field: driver, operator: 'equals', value: 'oui' }, then: { field: target, operator: 'visible' } });
const required = (driver: string, target: string) =>
  ({ if: { field: driver, operator: 'equals', value: 'oui' }, then: { field: target, operator: 'required' } });
const block = (driver: string, section: string) =>
  ({ if: { field: driver, operator: 'equals', value: 'oui' }, then: { section, operator: 'visible' } });
const comparison = (left: string, right: string) =>
  ({ operator: 'equals', left_field: left, right_field: right });

describe('fieldRuleSpace', () => {
  test('une variable permanente est lue sur la fiche patient, quelle que soit sa section', () => {
    expect(fieldRuleSpace(field('x', 'patient', 'identite'), sections)).toEqual(PATIENT);
    expect(fieldRuleSpace(field('x', 'patient', null), sections)).toEqual(PATIENT);
  });

  test('une variable de rencontre hors groupe est lue sur la rencontre ordinaire', () => {
    expect(fieldRuleSpace(field('x', 'encounter', 'clinique'), sections)).toEqual(ENCOUNTER);
    expect(fieldRuleSpace(field('x', 'encounter', null), sections)).toEqual(ENCOUNTER);
    // Sous-section ORDINAIRE d'un bloc qui porte par ailleurs un groupe.
    expect(fieldRuleSpace(field('x', 'encounter', 'trauma_notes'), sections)).toEqual(ENCOUNTER);
  });

  test('une variable de groupe est lue dans son groupe, racine ou sous-section', () => {
    expect(fieldRuleSpace(field('x', 'encounter', 'lesions'), sections)).toEqual(LESIONS);
    expect(fieldRuleSpace(field('x', 'encounter', 'interventions'), sections)).toEqual(INTERVENTIONS);
  });

  test('un groupe est reconnu par un ancetre, a quelque profondeur que ce soit', () => {
    const deep: TemplateSection[] = [
      { id: 'g', sectionKey: 'g', label: 'G', displayOrder: 0, parentSectionKey: null, isRepeatable: true },
      { id: 'g1', sectionKey: 'g1', label: 'G1', displayOrder: 1, parentSectionKey: 'g' },
      { id: 'g2', sectionKey: 'g2', label: 'G2', displayOrder: 2, parentSectionKey: 'g1' },
    ];
    expect(fieldRuleSpace(field('x', 'encounter', 'g2'), deep)).toEqual({ kind: 'group', sectionKey: 'g' });
  });

  test('sans dictionnaire de sections, ou avec une boucle, aucun groupe n’est invente', () => {
    expect(fieldRuleSpace(field('x', 'encounter', 'lesions'), null)).toEqual(ENCOUNTER);
    const loop: TemplateSection[] = [
      { id: 'a', sectionKey: 'a', label: 'A', displayOrder: 0, parentSectionKey: 'b' },
      { id: 'b', sectionKey: 'b', label: 'B', displayOrder: 1, parentSectionKey: 'a' },
    ];
    expect(fieldRuleSpace(field('x', 'encounter', 'a'), loop)).toEqual(ENCOUNTER);
  });
});

describe('sameRuleSpace et sectionCarriesGroup', () => {
  test('deux groupes distincts sont deux espaces distincts', () => {
    expect(sameRuleSpace(LESIONS, LESIONS)).toBe(true);
    expect(sameRuleSpace(LESIONS, INTERVENTIONS)).toBe(false);
    expect(sameRuleSpace(PATIENT, ENCOUNTER)).toBe(false);
  });

  test('seul un bloc qui contient un groupe parmi ses descendants le porte', () => {
    expect(sectionCarriesGroup('trauma', sections)).toBe(true);
    expect(sectionCarriesGroup('clinique', sections)).toBe(false);
    expect(sectionCarriesGroup('lesions', sections)).toBe(false);
    expect(sectionCarriesGroup('trauma', null)).toBe(false);
  });
});

describe('fieldRuleVerdict : toutes les combinaisons d’espaces', () => {
  const spaces = { patient: PATIENT, encounter: ENCOUNTER, lesions: LESIONS, interventions: INTERVENTIONS };
  const names = Object.keys(spaces) as (keyof typeof spaces)[];
  const cases = names.flatMap((driver) => names.map((target) => [driver, target] as const));

  test.each(cases)('affichage %s → %s', (driver, target) => {
    const verdict = fieldRuleVerdict('visible', spaces[driver], spaces[target]);
    if (driver === target) expect(verdict).toEqual({ usable: true, patientContext: false });
    else if (driver === 'patient' && (target === 'lesions' || target === 'interventions')) {
      expect(verdict).toEqual({ usable: true, patientContext: true });
    } else expect(verdict).toEqual({ usable: false, problem: 'visible_cross_space' });
  });

  test.each(cases)('obligation %s → %s', (driver, target) => {
    const verdict = fieldRuleVerdict('required', spaces[driver], spaces[target]);
    expect(verdict).toEqual(driver === target
      ? { usable: true, patientContext: false }
      : { usable: false, problem: 'required_cross_space' });
  });
});

describe('ruleSpaceVerdict', () => {
  test('D2 : un pilote permanent commande l’affichage d’une variable de groupe, a toute profondeur', () => {
    expect(ruleSpaceVerdict(visible('diagnostic', 'ao_grade'), fields, sections)).toEqual({ usable: true, patientContext: true });
    expect(ruleSpaceVerdict(visible('opere', 'materiel'), fields, sections)).toEqual({ usable: true, patientContext: true });
  });

  test('regles dans un meme espace : inchangees', () => {
    expect(ruleSpaceVerdict(visible('ao_grade', 'cote'), fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict(required('motif', 'sans_section'), fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict(comparison('ao_grade', 'cote'), fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict(visible('diagnostic', 'opere'), fields, sections)).toEqual({ usable: true, patientContext: false });
  });

  test('P1 : affichage pilote par une rencontre ordinaire vers une variable de groupe', () => {
    expect(ruleSpaceVerdict(visible('motif', 'ao_grade'), fields, sections)).toEqual({ usable: false, problem: 'visible_cross_space' });
  });

  test('P2 : affichage pilote par un groupe vers une rencontre ordinaire ou un autre groupe', () => {
    expect(ruleSpaceVerdict(visible('ao_grade', 'motif'), fields, sections)).toEqual({ usable: false, problem: 'visible_cross_space' });
    expect(ruleSpaceVerdict(visible('ao_grade', 'materiel'), fields, sections)).toEqual({ usable: false, problem: 'visible_cross_space' });
  });

  test('D2 : une cible permanente pilotee par une variable de groupe est refusee', () => {
    expect(ruleSpaceVerdict(visible('ao_grade', 'diagnostic'), fields, sections)).toEqual({ usable: false, problem: 'visible_cross_space' });
    expect(ruleSpaceVerdict(required('ao_grade', 'diagnostic'), fields, sections)).toEqual({ usable: false, problem: 'required_cross_space' });
  });

  test('affichage permanent → rencontre ordinaire : deux fiches distinctes, refuse comme aujourd’hui', () => {
    expect(ruleSpaceVerdict(visible('diagnostic', 'motif'), fields, sections)).toEqual({ usable: false, problem: 'visible_cross_space' });
  });

  test('P3 : obligation entre deux espaces differents, y compris permanent → groupe (D2)', () => {
    expect(ruleSpaceVerdict(required('diagnostic', 'ao_grade'), fields, sections)).toEqual({ usable: false, problem: 'required_cross_space' });
    expect(ruleSpaceVerdict(required('diagnostic', 'motif'), fields, sections)).toEqual({ usable: false, problem: 'required_cross_space' });
    expect(ruleSpaceVerdict(required('motif', 'ao_grade'), fields, sections)).toEqual({ usable: false, problem: 'required_cross_space' });
  });

  test('P4 : comparaison entre deux espaces differents, y compris permanent ↔ groupe (D2)', () => {
    expect(ruleSpaceVerdict(comparison('diagnostic', 'ao_grade'), fields, sections)).toEqual({ usable: false, problem: 'comparison_cross_space' });
    expect(ruleSpaceVerdict(comparison('motif', 'ao_grade'), fields, sections)).toEqual({ usable: false, problem: 'comparison_cross_space' });
    expect(ruleSpaceVerdict(comparison('ao_grade', 'materiel'), fields, sections)).toEqual({ usable: false, problem: 'comparison_cross_space' });
  });

  test('P5 : un bloc portant un groupe enfant exige un pilote permanent', () => {
    expect(ruleSpaceVerdict(block('motif', 'trauma'), fields, sections)).toEqual({ usable: false, problem: 'block_group_driver' });
    expect(ruleSpaceVerdict(block('diagnostic', 'trauma'), fields, sections)).toEqual({ usable: true, patientContext: false });
    // Bloc sans groupe : pilote de rencontre accepte, comme aujourd'hui.
    expect(ruleSpaceVerdict(block('motif', 'clinique'), fields, sections)).toEqual({ usable: true, patientContext: false });
  });

  test('regle illisible ou variable inconnue : ce controle ne juge pas', () => {
    expect(ruleSpaceVerdict(null, fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict({ if: 'x', then: 'y' }, fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict(visible('inconnue', 'ao_grade'), fields, sections)).toEqual({ usable: true, patientContext: false });
    expect(ruleSpaceVerdict(comparison('motif', 'inconnue'), fields, sections)).toEqual({ usable: true, patientContext: false });
  });
});
