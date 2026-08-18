// Tests PURS de la logique d'import (correspondance par INDEX + construction des lignes).
import { describe, expect, test } from 'vitest';
import {
  autoMapColumns, buildImportRows, duplicateTargets, findInFileEncounterDuplicates,
  findTerminologyColumns, terminologyTargetField,
  type ColumnMapping, type ImportRow,
} from '../src/domain/import';
import type { TemplateField } from '../src/data/types';

const f = (fieldKey: string, label: string, scope: TemplateField['scope'], type: TemplateField['type'] = 'text'): TemplateField => ({
  id: fieldKey, fieldKey, label, scope, section: 'clinique', type, unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const fields: TemplateField[] = [
  f('sexe', 'Sexe', 'patient'),
  f('glasgow_score', 'Score de Glasgow', 'encounter', 'integer'),
];

// L24 : l'import ne resout aucun champ `terminology`, a valeur MULTIPLE comme a valeur UNIQUE.
const diagnostics = { ...f('diagnostics', 'Diagnostics', 'encounter', 'terminology'), isMultiple: true };
const diagnosticPrincipal = f('diagnostic_principal', 'Diagnostic principal', 'patient', 'terminology');
const withTerminology: TemplateField[] = [...fields, diagnostics, diagnosticPrincipal];

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

describe('cibles de terminologie refusees a l import (L24)', () => {
  test('une colonne visant un champ terminology n est PAS proposee, multivaluee ou non', () => {
    const m = autoMapColumns(['Code patient', 'Diagnostics', 'Diagnostic principal', 'Sexe'], withTerminology);
    expect(m[0]).toBe('patient_code');
    expect(m[1]).toBe('ignore'); // multivaluee
    expect(m[2]).toBe('ignore'); // valeur unique : meme manque
    expect(m[3]).toBe('patient:sexe'); // le reste du fichier se mappe normalement
  });

  test('la cle de la variable est reconnue au meme titre que son libelle', () => {
    const m = autoMapColumns(['diagnostics', 'diagnostic_principal'], withTerminology);
    expect(m[0]).toBe('ignore');
    expect(m[1]).toBe('ignore');
  });

  test('findTerminologyColumns nomme la colonne ET la variable visee', () => {
    const found = findTerminologyColumns(['Code patient', 'Diagnostics', 'Sexe', 'Diagnostic principal'], withTerminology);
    expect(found).toEqual([
      { index: 1, header: 'Diagnostics', fieldLabel: 'Diagnostics' },
      { index: 3, header: 'Diagnostic principal', fieldLabel: 'Diagnostic principal' },
    ]);
  });

  test('sans champ de terminologie, rien n est signale', () => {
    expect(findTerminologyColumns(['Code patient', 'Sexe', 'xyz'], fields)).toEqual([]);
  });

  test('un alias meta garde la priorite sur un champ de terminologie homonyme', () => {
    const dateDiag = f('date', 'Date', 'encounter', 'terminology');
    const m = autoMapColumns(['Date'], [dateDiag]);
    expect(m[0]).toBe('encounter_date');
    expect(findTerminologyColumns(['Date'], [dateDiag])).toEqual([]);
  });

  test('terminologyTargetField : refuse les deux portees, laisse passer le reste', () => {
    expect(terminologyTargetField('encounter:diagnostics', withTerminology)).toBe(diagnostics);
    expect(terminologyTargetField('patient:diagnostic_principal', withTerminology)).toBe(diagnosticPrincipal);
    expect(terminologyTargetField('patient:sexe', withTerminology)).toBeNull();
    expect(terminologyTargetField('patient_code', withTerminology)).toBeNull();
    expect(terminologyTargetField('ignore', withTerminology)).toBeNull();
    // Cible visant une variable absente du gabarit : rien a refuser, rien a supposer.
    expect(terminologyTargetField('encounter:inconnu', withTerminology)).toBeNull();
    // La portee compte : la variable existe, mais pas dans celle-ci.
    expect(terminologyTargetField('patient:diagnostics', withTerminology)).toBeNull();
  });
});

describe('buildImportRows (cellules par index)', () => {
  test('eclate identite / patient / encounter et ignore les cellules vides', () => {
    const mapping: ColumnMapping = {
      0: 'patient_code', 1: 'identity.full_name', 2: 'patient:sexe',
      3: 'encounter:glasgow_score', 4: 'encounter_date', 5: 'ignore',
    };
    const [out] = buildImportRows([['P1', 'Jean', 'M', '12', '2024-01-05', 'x']], mapping, fields);
    expect(out.patient_code).toBe('P1');
    expect(out.identity).toEqual({ full_name: 'Jean' });
    expect(out.patient_data).toEqual({ sexe: 'M' });
    expect(out.encounter).toEqual({ encounter_type: 'consultation', encounter_date: '2024-01-05', data: { glasgow_score: 12 } });
  });

  test('ni identite ni rencontre quand les colonnes correspondantes sont vides', () => {
    const mapping: ColumnMapping = { 0: 'patient_code', 1: 'patient:sexe', 2: 'identity.full_name', 3: 'encounter:glasgow_score' };
    const [out] = buildImportRows([['P2', 'F', '', '']], mapping, fields);
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

describe('findInFileEncounterDuplicates', () => {
  test('detecte un doublon exact entre la premiere ligne et un second chunk', () => {
    const rows: ImportRow[] = Array.from({ length: 301 }, (_, index) => ({
      patient_code: index === 300 ? 'P1' : `P${index + 1}`,
      source_row_number: index + 1,
      identity: null,
      patient_data: {},
      encounter: {
        encounter_type: 'consultation',
        encounter_date: index === 300 ? '2024-01-01' : `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
        data: index === 300 ? { diagnosis: 'TC', score: 12 } : { diagnosis: `D${index}`, score: index },
      },
    }));
    rows[0].encounter = {
      encounter_type: 'consultation', encounter_date: '2024-01-01', data: { score: 12, diagnosis: 'TC' },
    };

    expect(findInFileEncounterDuplicates(rows)).toEqual([{
      row: 301,
      firstRow: 1,
      patientCode: 'P1',
      encounterDate: '2024-01-01',
      encounterType: 'consultation',
    }]);
  });

  test('ne confond pas deux rencontres dont les donnees different', () => {
    const base: ImportRow = {
      patient_code: 'P1', source_row_number: 1, identity: null, patient_data: {},
      encounter: { encounter_type: 'consultation', encounter_date: '2024-01-01', data: { score: 10 } },
    };
    expect(findInFileEncounterDuplicates([
      base,
      { ...base, source_row_number: 2, encounter: { ...base.encounter!, data: { score: 11 } } },
    ])).toEqual([]);
  });
});
