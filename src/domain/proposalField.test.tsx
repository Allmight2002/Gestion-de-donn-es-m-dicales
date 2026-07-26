// F5 : conventions du champ compagnon « valeur proposee ».
import { describe, expect, test } from 'vitest';
import { findProposalField, makeProposalField, proposalKeyOf, proposalKeysOf } from './proposalField';
import type { NewField, TemplateField } from '../data/types';

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

const source: NewField = {
  fieldKey: 'diagnostic',
  label: 'Diagnostic',
  scope: 'encounter',
  section: 'clinique',
  type: 'select',
  required: true,
  allowedValues: ['Paludisme'],
  encounterTypes: ['consultation'],
};

describe('makeProposalField (F5)', () => {
  test('cree un champ texte suffixe, au meme niveau que la source', () => {
    const companion = makeProposalField(source, '— valeur proposée');
    expect(companion.fieldKey).toBe('diagnostic_autre');
    expect(companion.label).toBe('Diagnostic — valeur proposée');
    expect(companion.type).toBe('text');
    expect(companion.scope).toBe('encounter');
    expect(companion.section).toBe('clinique');
    expect(companion.encounterTypes).toEqual(['consultation']);
  });

  // Un compagnon obligatoire bloquerait l'enregistrement, donc pousserait le saisisseur a
  // choisir une valeur fausse dans la liste : exactement ce que la soupape doit empecher.
  test('n est jamais obligatoire, meme si la source l est', () => {
    expect(source.required).toBe(true);
    expect(makeProposalField(source, '— valeur proposée').required).toBe(false);
  });

  test('n herite ni des valeurs autorisees ni des codes manquants', () => {
    const companion = makeProposalField(source, '— valeur proposée');
    expect(companion.allowedValues).toBeNull();
    expect(companion.allowMissingCodes).toBe(false);
  });
});

describe('findProposalField et proposalKeysOf', () => {
  const diagnostic = field({ fieldKey: 'diagnostic', type: 'select' });
  const companion = field({ fieldKey: proposalKeyOf('diagnostic'), type: 'text' });
  const autre = field({ fieldKey: 'motif', type: 'text' });

  test('associe le compagnon a sa source', () => {
    expect(findProposalField([diagnostic, companion, autre], diagnostic)?.fieldKey).toBe('diagnostic_autre');
  });

  test('ignore un homonyme qui ne serait pas un champ texte de meme portee', () => {
    const faux = field({ fieldKey: proposalKeyOf('diagnostic'), type: 'select' });
    expect(findProposalField([diagnostic, faux], diagnostic)).toBeUndefined();
    const autrePortee = field({ fieldKey: proposalKeyOf('diagnostic'), type: 'text', scope: 'patient' });
    expect(findProposalField([diagnostic, autrePortee], diagnostic)).toBeUndefined();
  });

  test('liste les cles a ne pas rendre isolement', () => {
    expect([...proposalKeysOf([diagnostic, companion, autre])]).toEqual(['diagnostic_autre']);
  });

  test('un champ texte sans source a liste controlee reste un champ ordinaire', () => {
    expect(proposalKeysOf([autre, companion]).size).toBe(0);
  });
});
