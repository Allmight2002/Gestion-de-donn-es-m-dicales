// Tests PURS de la logique d'import (correspondance colonnes + construction des lignes).
import { describe, expect, test } from 'vitest';
import { autoMapColumns, buildImportRows, type ColumnMapping } from '../src/domain/import';
import type { TemplateField } from '../src/data/types';

const f = (fieldKey: string, label: string, scope: TemplateField['scope']): TemplateField => ({
  id: fieldKey, fieldKey, label, scope, section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const fields: TemplateField[] = [
  f('sexe', 'Sexe', 'patient'),
  f('glasgow_score', 'Score de Glasgow', 'encounter'),
];

describe('autoMapColumns', () => {
  test('reconnait meta, identite et champs de gabarit (par libelle, accents/casse ignores)', () => {
    const m = autoMapColumns(['Code patient', 'Nom', 'Date de naissance', 'Date', 'sexe', 'Score de Glasgow', 'xyz'], fields);
    expect(m['Code patient']).toBe('patient_code');
    expect(m['Nom']).toBe('identity.full_name');
    expect(m['Date de naissance']).toBe('identity.date_of_birth');
    expect(m['Date']).toBe('encounter_date');
    expect(m['sexe']).toBe('patient:sexe');
    expect(m['Score de Glasgow']).toBe('encounter:glasgow_score');
    expect(m['xyz']).toBe('ignore'); // inconnu -> ignore
  });
});

describe('buildImportRows', () => {
  test('eclate identite / patient / encounter et ignore les colonnes vides', () => {
    const mapping: ColumnMapping = {
      code: 'patient_code', nom: 'identity.full_name', sexe: 'patient:sexe',
      gcs: 'encounter:glasgow_score', d: 'encounter_date', skip: 'ignore',
    };
    const [out] = buildImportRows([{ code: 'P1', nom: 'Jean', sexe: 'M', gcs: '12', d: '2024-01-05', skip: 'x' }], mapping);
    expect(out.patient_code).toBe('P1');
    expect(out.identity).toEqual({ full_name: 'Jean' });
    expect(out.patient_data).toEqual({ sexe: 'M' });
    expect(out.encounter).toEqual({ encounter_type: 'consultation', encounter_date: '2024-01-05', data: { glasgow_score: '12' } });
  });

  test('ni identite ni rencontre quand les colonnes correspondantes sont vides', () => {
    const mapping: ColumnMapping = {
      code: 'patient_code', sexe: 'patient:sexe', nom: 'identity.full_name', gcs: 'encounter:glasgow_score',
    };
    const [out] = buildImportRows([{ code: 'P2', sexe: 'F', nom: '', gcs: '' }], mapping);
    expect(out.identity).toBeNull();
    expect(out.encounter).toBeNull();
    expect(out.patient_data).toEqual({ sexe: 'F' });
  });
});
