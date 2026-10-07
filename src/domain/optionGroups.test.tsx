// L75 — en-tetes d'option des variables dependantes d'une liste multiple : criteres 1 a 9 de
// docs/spec-entetes-options-declenchantes.md §8. Donnees fictives uniquement.
import { describe, expect, test } from 'vitest';
import type { FieldType, TemplateField } from '../data/types';
import { arrangeOptionGroups, flattenOptionNodes, type OptionNode } from './optionGroups';

const field = (fieldKey: string, displayOrder: number, type: FieldType = 'text', options?: [string, string][]): TemplateField => ({
  id: fieldKey, fieldKey, label: fieldKey, scope: 'encounter', section: 'clinique', type, unit: null,
  allowedValues: options ? options.map(([key]) => key) : null,
  allowedOptions: options ? options.map(([value_key, label]) => ({ value_key, label, is_active: true })) : null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder,
});
const shows = (driver: string, codes: unknown, target: string, operator = 'contains_any') =>
  ({ if: { field: driver, operator, value: codes }, then: { field: target, operator: 'visible' } });

const complications = field('complications', 1, 'multiselect', [['infection', 'Infection'], ['hemorragie', 'Hémorragie'], ['fistule', 'Fistule']]);
// Ordre global entrelace (critere 2) : Germe 3, Volume 4, Date 5, Reprise 6.
const avant = field('poids', 0, 'number');
const germe = field('germe', 3);
const volume = field('volume', 4, 'number');
const date = field('date_infection', 5, 'date');
const reprise = field('reprise', 6, 'boolean');
const apres = field('commentaire', 7);
const block = [avant, complications, germe, volume, date, reprise, apres];
const rules = [
  shows('complications', ['infection'], 'germe'),
  shows('complications', ['hemorragie'], 'volume'),
  shows('complications', ['infection'], 'date_infection'),
  shows('complications', ['hemorragie'], 'reprise'),
];

/** Arbre lisible : `cle` pour une variable, `[En-tete: ...]` pour un regroupement. */
const shape = (nodes: OptionNode<TemplateField>[]): unknown[] => nodes.map((node) => node.kind === 'field'
  ? node.field.fieldKey : { [node.label]: shape(node.children) });
const keys = (fields: TemplateField[]) => fields.map((entry) => entry.fieldKey);

describe('arrangeOptionGroups', () => {
  test('1-2. deux options, deux regles a un code : regroupements dans l\'ordre des options, sous le pilote', () => {
    const nodes = arrangeOptionGroups(block, rules);
    expect(shape(nodes)).toEqual([
      'poids', 'complications',
      { Infection: ['germe', 'date_infection'] },
      { 'Hémorragie': ['volume', 'reprise'] },
      'commentaire',
    ]);
    expect(keys(flattenOptionNodes(nodes))).toEqual(['poids', 'complications', 'germe', 'date_infection', 'volume', 'reprise', 'commentaire']);
    const groups = nodes.filter((node) => node.kind === 'group');
    expect(groups.map((node) => node.kind === 'group' && node.codes)).toEqual([['infection'], ['hemorragie']]);
  });

  test('l\'ordre des options du pilote prime sur l\'ordre des regles et des variables', () => {
    const nodes = arrangeOptionGroups([complications, volume, germe], [
      shows('complications', ['hemorragie'], 'volume'), shows('complications', ['infection'], 'germe'),
    ]);
    expect(shape(nodes)).toEqual(['complications', { Infection: ['germe'] }, { 'Hémorragie': ['volume'] }]);
  });

  test('un regroupement ne porte que les variables presentes : une option sans variable visible n\'a pas d\'en-tete', () => {
    expect(shape(arrangeOptionGroups([complications, volume, reprise], rules)))
      .toEqual(['complications', { 'Hémorragie': ['volume', 'reprise'] }]);
  });

  test('3. regle a plusieurs codes : en-tete combine « / », apres les regroupements a un code', () => {
    const transfusion = field('transfusion', 2, 'boolean');
    const fievre = field('fievre', 8, 'boolean');
    const nodes = arrangeOptionGroups([complications, transfusion, germe, fievre, volume], [
      // Codes dans le desordre : l'en-tete suit l'ordre des options, la cle l'ensemble trie.
      shows('complications', ['hemorragie', 'infection'], 'transfusion'),
      shows('complications', ['infection'], 'germe'),
      shows('complications', ['infection', 'hemorragie'], 'fievre'),
      shows('complications', ['hemorragie'], 'volume'),
    ]);
    expect(shape(nodes)).toEqual([
      'complications',
      { Infection: ['germe'] },
      { 'Hémorragie': ['volume'] },
      { 'Infection / Hémorragie': ['transfusion', 'fievre'] },
    ]);
    const combined = nodes.at(-1);
    expect(combined?.kind === 'group' && combined.key).toBe('complications:hemorragie+infection');
  });

  test('3. deux en-tetes combines se rangent dans l\'ordre de leur premiere option', () => {
    const a = field('a', 2);
    const b = field('b', 3);
    expect(shape(arrangeOptionGroups([complications, a, b], [
      shows('complications', ['hemorragie', 'fistule'], 'a'),
      shows('complications', ['infection', 'fistule'], 'b'),
    ]))).toEqual(['complications', { 'Infection / Fistule': ['b'] }, { 'Hémorragie / Fistule': ['a'] }]);
  });

  test('4. une cible portant deux regles d\'affichage reste a sa place, sans en-tete', () => {
    const fievre = field('fievre', 0, 'boolean');
    const nodes = arrangeOptionGroups(block, [
      ...rules,
      shows('complications', ['infection'], 'commentaire'),
      shows('poids', 50, 'commentaire', 'greater_than'),
    ]);
    expect(shape(nodes).at(-1)).toBe('commentaire');
    // La seconde regle peut viser une variable d'un autre bloc : elle compte quand meme.
    expect(shape(arrangeOptionGroups([complications, germe], [
      shows('complications', ['infection'], 'germe'), shows(fievre.fieldKey, true, 'germe', 'equals'),
    ]))).toEqual(['complications', 'germe']);
  });

  test('5. regle de bloc, pilote select, pilote terminology, comparaison numerique : rendu identique', () => {
    const choix = field('choix', 0, 'select', [['oui', 'Oui'], ['non', 'Non']]);
    const diagnostic = { ...field('diagnostic', 1, 'terminology'), isMultiple: true };
    const age = field('age', 2, 'number');
    const x = field('x', 3);
    const y = field('y', 4);
    const z = field('z', 5);
    const fields = [choix, diagnostic, age, x, y, z, complications];
    const nodes = arrangeOptionGroups(fields, [
      { if: { field: 'complications', operator: 'contains_any', value: ['infection'] }, then: { section: 'clinique', operator: 'visible' } },
      shows('choix', ['oui'], 'x'),
      shows('diagnostic', ['A00'], 'y'),
      shows('age', 18, 'z', 'greater_than'),
    ]);
    expect(nodes).toEqual(fields.map((entry) => ({ kind: 'field', field: entry })));
  });

  test('5. un pilote multiselect avec un autre operateur que contains_any ne rattache pas', () => {
    expect(shape(arrangeOptionGroups([complications, germe], [shows('complications', ['infection'], 'germe', 'equals')])))
      .toEqual(['complications', 'germe']);
  });

  test('6. pilote et cible dans deux blocs differents : la cible reste a sa place', () => {
    // La fonction travaille bloc par bloc : un pilote absent du bloc ne rattache rien.
    expect(shape(arrangeOptionGroups([avant, germe, date], rules))).toEqual(['poids', 'germe', 'date_infection']);
  });

  test('7. cascade : un pilote dans un regroupement place ses propres regroupements sous lui', () => {
    const germes = field('germes', 3, 'multiselect', [['staph', 'Staphylocoque'], ['strepto', 'Streptocoque']]);
    const antibio = field('antibiogramme', 2);
    const nodes = arrangeOptionGroups([complications, antibio, germes, date, volume], [
      shows('complications', ['infection'], 'germes'),
      shows('complications', ['infection'], 'date_infection'),
      shows('complications', ['hemorragie'], 'volume'),
      shows('germes', ['staph'], 'antibiogramme'),
    ]);
    expect(shape(nodes)).toEqual([
      'complications',
      { Infection: ['germes', { Staphylocoque: ['antibiogramme'] }, 'date_infection'] },
      { 'Hémorragie': ['volume'] },
    ]);
    expect(keys(flattenOptionNodes(nodes))).toEqual(['complications', 'germes', 'antibiogramme', 'date_infection', 'volume']);
  });

  test('8. gabarit incoherent avec cycle : la fonction termine et laisse le cycle a sa place', () => {
    const a = field('a', 0, 'multiselect', [['x', 'X']]);
    const b = field('b', 1, 'multiselect', [['y', 'Y']]);
    const c = field('c', 2);
    const d = field('d', 3);
    const nodes = arrangeOptionGroups([a, b, c, complications, d], [
      shows('a', ['x'], 'b'),
      shows('b', ['y'], 'a'),
      // Une variable pendue a un membre du cycle reste rattachee a lui.
      shows('b', ['y'], 'c'),
      shows('complications', ['infection'], 'complications'),
    ]);
    expect(shape(nodes)).toEqual(['a', 'b', { Y: ['c'] }, 'complications', 'd']);
    expect(keys(flattenOptionNodes(nodes))).toEqual(['a', 'b', 'c', 'complications', 'd']);
  });

  test('9. sans regle d\'affichage : sortie identique a l\'entree', () => {
    expect(flattenOptionNodes(arrangeOptionGroups(block, []))).toEqual(block);
    expect(arrangeOptionGroups(block, [{ if: { field: 'poids', operator: 'greater_than', value: 1 }, then: { field: 'commentaire', operator: 'required' } }]))
      .toEqual(block.map((entry) => ({ kind: 'field', field: entry })));
  });

  test('une variable compagnon ou une regle mal formee ne rattache rien', () => {
    expect(shape(arrangeOptionGroups([complications, germe], [shows('complications', ['infection'], 'germe')], new Set(['germe']))))
      .toEqual(['complications', 'germe']);
    expect(shape(arrangeOptionGroups([complications, germe], [shows('complications', [], 'germe')])))
      .toEqual(['complications', 'germe']);
  });

  test('un code inconnu des options garde son code comme en-tete et se range apres les options connues', () => {
    expect(shape(arrangeOptionGroups([complications, germe, volume], [
      shows('complications', ['ancienne'], 'germe'), shows('complications', ['fistule'], 'volume'),
    ]))).toEqual(['complications', { Fistule: ['volume'] }, { ancienne: ['germe'] }]);
  });
});
