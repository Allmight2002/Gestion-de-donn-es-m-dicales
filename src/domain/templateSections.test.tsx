// L72c — groupe répétable en sous-section : rang dans la grappe du bloc et héritage de la
// visibilité, côté domaine. Données fictives uniquement.
import { describe, expect, test } from 'vitest';
import type { TemplateCommonLayout, TemplateField, TemplateSection } from '../data/types';
import { activationProposal } from './blockActivation';
import { visibilityTargetFieldKeys } from './templateRules';
import {
  groupFieldsBySection, maskedRepeatableSectionKeys, repeatableGroupFields, repeatableSectionsOf, withRepeatableSteps,
  type SectionStep,
} from './templateSections';
import { hiddenFieldKeys } from './validation';

const section = (sectionKey: string, displayOrder: number, parentSectionKey: string | null = null, isRepeatable = false): TemplateSection =>
  ({ id: sectionKey, sectionKey, label: sectionKey.toUpperCase(), displayOrder, parentSectionKey, isRepeatable });
const field = (fieldKey: string, sectionKey: string | null, scope: 'patient' | 'encounter' = 'patient', displayOrder = 0): TemplateField => ({
  id: fieldKey, fieldKey, label: fieldKey, scope, section: sectionKey, type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder,
});
const blockRule = (driver: string, value: string, target: string) =>
  ({ rule: { if: { field: driver, operator: 'equals', value }, then: { section: target, operator: 'visible' } } });
const keys = <T,>(steps: SectionStep<T>[]) => steps.map((step) => step.kind === 'repeatable'
  ? `${step.section.sectionKey}${step.masked ? '(masqué)' : ''}` : step.group.key);

// Test 14 : trois sous-sections et deux groupes, dont un racine. Ordre déjà normalisé par la
// base : global, en profondeur d'abord, groupé par racine.
const sections = [
  section('a', 0), section('a1', 1, 'a'), section('g1', 2, 'a', true), section('a2', 3, 'a'), section('a3', 4, 'a'),
  section('r', 5, null, true), section('b', 6),
];
const diag = { ...field('diag', null), type: 'select' as const, allowedValues: ['trauma', 'autre'] };
const fields = [
  diag, field('a_own', 'a', 'patient', 1), field('a1_x', 'a1', 'patient', 2), field('a2_x', 'a2', 'patient', 3),
  field('a3_x', 'a3', 'patient', 4), field('b_x', 'b', 'patient', 6),
  field('g1_niveau', 'g1', 'encounter', 7), field('r_x', 'r', 'encounter', 8),
];
const patientFields = fields.filter((item) => item.scope === 'patient');
const rules = [blockRule('diag', 'trauma', 'a')];

function stepsFor(values: Record<string, unknown>, layout?: TemplateCommonLayout) {
  const hidden = hiddenFieldKeys(rules, values, fields, sections);
  const masked = maskedRepeatableSectionKeys(sections, rules, values, hidden);
  const visible = patientFields.filter((item) => !hidden.has(item.fieldKey));
  return withRepeatableSteps(groupFieldsBySection(visible, sections, layout), sections, masked, layout);
}

describe('L72c — place du groupe dans la grappe de son bloc', () => {
  test('13 et 14 : le groupe enfant est rendu entre A1 et A2, le groupe racine garde son rang', () => {
    expect(repeatableSectionsOf(sections).map((item) => item.sectionKey)).toEqual(['g1', 'r']);
    expect(keys(stepsFor({ diag: 'trauma' }))).toEqual(['__common__', 'a', 'a1', 'g1', 'a2', 'a3', 'r', 'b']);
  });

  test('13 : bloc masqué, le groupe est marqué masqué et ses variables ne sont pas des variables du bloc', () => {
    const hidden = hiddenFieldKeys(rules, { diag: 'autre' }, fields, sections);
    expect([...hidden].sort()).toEqual(['a1_x', 'a2_x', 'a3_x', 'a_own']);
    // Aucun groupe n'est « visible par défaut » : le masquage vient de la section, pas des clés.
    expect(keys(stepsFor({ diag: 'autre' }))).toEqual(['__common__', 'g1(masqué)', 'r', 'b']);
    // Condition non vérifiable (pilote vide) : masqué, comme côté serveur (D1).
    expect(keys(stepsFor({}))).toContain('g1(masqué)');
  });

  test('D11 : une rubrique commune ne sort jamais le groupe de la grappe de son bloc', () => {
    const layout: TemplateCommonLayout = {
      fingerprint: 'fixture', locked: false, inUse: false, defaultKey: 'ctx', unassigned: [],
      sections: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      groups: [
        { key: 'ctx', label: 'Contexte', anchor: 0, isDefault: true, fields: ['diag'] },
        { key: 'synthese', label: 'Synthèse', anchor: 1, isDefault: false, fields: ['synth'] },
      ],
    };
    const withSynth = [...patientFields, field('synth', null)];
    const run = (values: Record<string, unknown>) => {
      const hidden = hiddenFieldKeys(rules, values, fields, sections);
      const masked = maskedRepeatableSectionKeys(sections, rules, values, hidden);
      const visible = withSynth.filter((item) => !hidden.has(item.fieldKey));
      return keys(withRepeatableSteps(groupFieldsBySection(visible, sections, layout), sections, masked, layout));
    };
    // La rubrique ancrée après A reste après toute la grappe de A, groupe compris ; le groupe
    // racine garde son rang L68 (après la rubrique, avant B).
    expect(run({ diag: 'trauma' })).toEqual([
      '__common_group__:ctx', 'a', 'a1', 'g1', 'a2', 'a3', '__common_group__:synthese', 'r', 'b',
    ]);
    // Bloc sans aucune étape rendue : le groupe garde la place du bloc, avant la rubrique qui le suit.
    expect(run({ diag: 'autre' })).toEqual([
      '__common_group__:ctx', 'g1(masqué)', '__common_group__:synthese', 'r', 'b',
    ]);
  });

  test('15 : sans groupe enfant, le rendu d’un groupe racine est celui de L68', () => {
    const rootOnly = [section('clinique', 0), section('lesions', 1, null, true), section('suivi', 2)];
    const groups = groupFieldsBySection([field('sexe', 'clinique'), field('note', 'suivi', 'patient', 2)], rootOnly);
    expect(keys(withRepeatableSteps(groups, rootOnly))).toEqual(['clinique', 'lesions', 'suivi']);
    expect(maskedRepeatableSectionKeys(rootOnly, [blockRule('sexe', 'F', 'clinique')], {}, new Set())).toEqual(new Set());
  });
});

describe('L72c — héritage de la visibilité par la section', () => {
  // A ne porte qu'un pilote, qui commande B : une cascade à deux règles.
  const cascadeSections = [
    section('a', 0), section('ga', 1, 'a', true), section('b', 2), section('b1', 3, 'b'), section('gb', 4, 'b', true),
  ];
  const cascadeFields = [
    field('diag', null), field('a_pilote', 'a'), field('b1_x', 'b1'), field('ga_x', 'ga', 'encounter'), field('gb_x', 'gb', 'encounter'),
  ];
  const cascadeRules = [blockRule('diag', 'x', 'a'), blockRule('a_pilote', 'oui', 'b')];
  const masked = (values: Record<string, unknown>) => [...maskedRepeatableSectionKeys(
    cascadeSections, cascadeRules, values, hiddenFieldKeys(cascadeRules, values, cascadeFields, cascadeSections),
  )].sort();

  test('bloc dont la seule variable est un pilote, et cascade à deux règles', () => {
    expect(masked({ diag: 'x', a_pilote: 'oui' })).toEqual([]);
    expect(masked({ diag: 'x', a_pilote: 'non' })).toEqual(['gb']);
    // A masqué : son pilote se lit absent, donc B tombe aussi, avec son groupe.
    expect(masked({ diag: 'y', a_pilote: 'oui' })).toEqual(['ga', 'gb']);
  });

  test('un bloc sans aucune variable propre masque quand même son groupe', () => {
    const bare = [section('c', 0), section('gc', 1, 'c', true)];
    const bareRules = [blockRule('diag', 'c', 'c')];
    expect(maskedRepeatableSectionKeys(bare, bareRules, {}, new Set())).toEqual(new Set(['gc']));
    expect(maskedRepeatableSectionKeys(bare, bareRules, { diag: 'c' }, new Set())).toEqual(new Set());
  });
});

describe('L72c — miroirs web de l’expansion d’un bloc (§13)', () => {
  test('la cible d’une règle de bloc exclut le groupe enfant, avec ou sans dictionnaire de sections', () => {
    const rule = rules[0].rule;
    expect(visibilityTargetFieldKeys(rule, fields, sections).sort()).toEqual(['a1_x', 'a2_x', 'a3_x', 'a_own']);
    // Repli par `parentSectionKey` (instantané sans sections) : jamais une variable de groupe.
    const joined = fields.map((item) => ({ ...item, parentSectionKey: sections.find((s) => s.sectionKey === item.section)?.parentSectionKey ?? null }));
    expect(visibilityTargetFieldKeys(rule, joined, null)).not.toContain('g1_niveau');
  });

  test('la reconnexion d’une règle de bloc n’oppose plus la portée d’un groupe enfant', () => {
    const proposal = activationProposal({
      sectionKey: 'a', activation: { field: 'diag', operator: 'equals', value: 'trauma' }, sourceDriver: diag,
      fields, sections, rules: [],
    });
    expect(proposal).toMatchObject({ ok: true });
    // Le refus d'origine subsiste pour une vraie sous-section de l'autre portée.
    const mixed = fields.map((item) => item.fieldKey === 'a2_x' ? { ...item, scope: 'encounter' as const } : item);
    expect(activationProposal({
      sectionKey: 'a', activation: { field: 'diag', operator: 'equals', value: 'trauma' }, sourceDriver: diag,
      fields: mixed, sections, rules: [],
    })).toMatchObject({ ok: false, blocker: { code: 'block_scope' } });
  });

  test('un seul helper donne les variables de groupe, à toute profondeur', () => {
    expect(repeatableGroupFields(fields, sections).map((item) => item.fieldKey)).toEqual(['g1_niveau', 'r_x']);
  });
});
