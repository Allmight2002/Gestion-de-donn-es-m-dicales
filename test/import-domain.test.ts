// Tests PURS de la logique d'import (correspondance par INDEX + construction des lignes).
import { describe, expect, test } from 'vitest';
import { autoMapColumns, buildImportRows, duplicateTargets, type ColumnMapping } from '../src/domain/import';
import type { TemplateField } from '../src/data/types';

const f = (fieldKey: string, label: string, scope: TemplateField['scope']): TemplateField => ({
  id: fieldKey, fieldKey, label, scope, section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const fields: TemplateField[] = [
  f('sexe', 'Sexe', 'patient'),
  f('glasgow_score', 'Score de Glasgow', 'encounter'),
];

describe('autoMapColumns (par index)', () => {
  test('reconnait meta, identite et champs ; en-tete vide -> ignore', () => {
    const m = autoMapColumns(['Code patient', 'Nom', 'Date de naissance', 'Date', '', 'sexe', 'Score de Glasgow', 'xyz'], fields);
    expect(m[0]).toBe('patient_code');
    expect(m[1]).toBe('identity.full_name');
    expect(m[2]).toBe('identity.date_of_birth');
    expect(m[3]).toBe('encounter_date');
    expect(m[4]).toBe('ignore'); // en-tete vide
    expect(m[5]).toBe('patient:sexe');
    expect(m[6]).toBe('encounter:glasgow_score');
    expect(m[7]).toBe('ignore'); // inconnu
  });

  test('en-tetes dupliques : chaque INDEX a sa propre cible (pas de collision)', () => {
    const m = autoMapColumns(['Code patient', 'Code patient'], fields);
    expect(m[0]).toBe('patient_code');
    expect(m[1]).toBe('patient_code');
    expect(duplicateTargets(m)).toEqual(['patient_code']); // conflit detecte
  });
});

describe('buildImportRows (cellules par index)', () => {
  test('eclate identite / patient / encounter et ignore les cellules vides', () => {
    const mapping: ColumnMapping = {
      0: 'patient_code', 1: 'identity.full_name', 2: 'patient:sexe',
      3: 'encounter:glasgow_score', 4: 'encounter_date', 5: 'ignore',
    };
    const [out] = buildImportRows([['P1', 'Jean', 'M', '12', '2024-01-05', 'x']], mapping);
    expect(out.patient_code).toBe('P1');
    expect(out.identity).toEqual({ full_name: 'Jean' });
    expect(out.patient_data).toEqual({ sexe: 'M' });
    expect(out.encounter).toEqual({ encounter_type: 'consultation', encounter_date: '2024-01-05', data: { glasgow_score: '12' } });
  });

  test('ni identite ni rencontre quand les colonnes correspondantes sont vides', () => {
    const mapping: ColumnMapping = { 0: 'patient_code', 1: 'patient:sexe', 2: 'identity.full_name', 3: 'encounter:glasgow_score' };
    const [out] = buildImportRows([['P2', 'F', '', '']], mapping);
    expect(out.identity).toBeNull();
    expect(out.encounter).toBeNull();
    expect(out.patient_data).toEqual({ sexe: 'F' });
  });
});

describe('duplicateTargets', () => {
  test('signale une cible (hors ignore) utilisee par plusieurs colonnes', () => {
    expect(duplicateTargets({ 0: 'patient_code', 1: 'patient:sexe', 2: 'patient:sexe', 3: 'ignore' })).toEqual(['patient:sexe']);
    expect(duplicateTargets({ 0: 'patient_code', 1: 'patient:sexe' })).toEqual([]);
  });
});
