// Tests du constructeur d'export (cahier §9.2, critere 9).
import { describe, expect, test } from 'vitest';
import {
  buildEncounterExport,
  buildPatientExport,
  buildDictionary,
  toCsv,
  assertNoIdentity,
  type ExportField,
  type ExportEncounter,
  type ExportPatient,
} from '../src/domain/export';
import { makeMissing } from '../src/domain/validation';

const fields: ExportField[] = [
  { fieldKey: 'sexe', label: 'Sexe', scope: 'patient', section: 'clinique', type: 'select', unit: null, allowedValues: ['M', 'F'] },
  { fieldKey: 'birth_year', label: 'Annee de naissance', scope: 'patient', section: 'clinique', type: 'integer', unit: null, allowedValues: null },
  { fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', section: 'clinique', type: 'integer', unit: null, allowedValues: null },
  { fieldKey: 'hemoglobin', label: 'Hemoglobine', scope: 'encounter', section: 'biologie', type: 'number', unit: 'g/dL', allowedValues: null },
];
const patients: ExportPatient[] = [{ code: 'P-001', data: { sexe: 'M', birth_year: 1980 } }];
const encounters: ExportEncounter[] = [
  { id: 'e1', patientCode: 'P-001', encounterDate: '2024-01-01', encounterType: 'hospitalisation', data: { glasgow_score: 10, hemoglobin: makeMissing('inconnu'), age_at_encounter: 44 } },
  { id: 'e2', patientCode: 'P-001', encounterDate: '2024-06-01', encounterType: 'suivi', data: { glasgow_score: 13, hemoglobin: 12, age_at_encounter: 44 } },
];

describe('export rencontres (1 ligne / rencontre)', () => {
  test('une ligne par rencontre, avec code + age, et AUCUNE colonne identifiante', () => {
    const t = buildEncounterExport(encounters, fields);
    expect(t.rows).toHaveLength(2);
    expect(t.columns).toContain('patient_code');
    expect(t.columns).toContain('age_at_encounter');
    expect(t.columns).not.toContain('full_name');
    expect(t.columns).not.toContain('date_of_birth');
    expect(t.rows[0].patient_code).toBe('P-001');
    // valeur manquante codifiee rendue par son code
    expect(t.rows[0].Hemoglobine).toBe('inconnu');
  });
});

describe('export patients (agregation EXPLICITE)', () => {
  test('regle "premiere" vs "derniere" donnent des valeurs differentes', () => {
    const first = buildPatientExport(patients, encounters, fields, 'first');
    const last = buildPatientExport(patients, encounters, fields, 'last');
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].patient_code).toBe('P-001');
    expect(first.rows[0].Glasgow).toBe('10'); // 1re rencontre
    expect(last.rows[0].Glasgow).toBe('13'); // derniere rencontre
    // variable permanente presente
    expect(first.rows[0].Sexe).toBe('M');
  });
});

describe('dictionnaire + CSV + garde-fou identite', () => {
  test('dictionnaire : une ligne par variable', () => {
    const d = buildDictionary(fields);
    expect(d.rows).toHaveLength(4);
    expect(d.rows[0]).toMatchObject({ field_key: 'sexe', label: 'Sexe' });
  });

  test('CSV : entete + lignes, echappement des separateurs', () => {
    const csv = toCsv({ columns: ['a', 'b'], rows: [{ a: 'x,y', b: 'z' }] });
    expect(csv.split('\n')[0]).toBe('a,b');
    expect(csv.split('\n')[1]).toBe('"x,y",z');
  });

  test('assertNoIdentity rejette une colonne identifiante', () => {
    expect(() => assertNoIdentity(['patient_code', 'full_name'])).toThrow(/interdite/i);
    expect(() => assertNoIdentity(['patient_code', 'Glasgow'])).not.toThrow();
  });
});
