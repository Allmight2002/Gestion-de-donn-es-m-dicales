import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { buildDictionary, buildEncounterExport, buildPatientExport, mergeExportFields, neutralizeExportTable, neutralizeSpreadsheetFormula, referencedTemplateVersions, toCsv, type ExportEncounter, type ExportField, type ExportPatient } from '../src/domain/export';

const v1 = '00000000-0000-0000-0000-000000000001';
const v2 = '00000000-0000-0000-0000-000000000002';
const fields: ExportField[] = [
  { fieldKey: 'retired', label: 'Ancienne mesure', scope: 'patient', section: 'clinique', type: 'text', unit: null, allowedValues: null, templateVersionIds: [v1] },
  { fieldKey: 'weight', label: 'Poids initial', scope: 'patient', section: 'clinique', type: 'number', unit: 'kg', allowedValues: null, templateVersionIds: [v1] },
  { fieldKey: 'weight', label: 'Poids renomme', scope: 'patient', section: 'clinique', type: 'number', unit: 'kg', allowedValues: null, templateVersionIds: [v2] },
  { fieldKey: 'score_a', label: 'Score', scope: 'encounter', section: 'clinique', type: 'number', unit: null, allowedValues: null, templateVersionIds: [v1, v2] },
  { fieldKey: 'score_b', label: 'Score', scope: 'encounter', section: 'biologie', type: 'number', unit: null, allowedValues: null, templateVersionIds: [v2] },
];
const patients: ExportPatient[] = [
  { code: 'P-v2', templateVersionId: v2, data: { weight: 71 } },
  { code: 'P-v1', templateVersionId: v1, data: { retired: 'preservee', weight: 70 } },
];
const encounters: ExportEncounter[] = [
  { id: 'e-years', patientCode: 'P-v1', templateVersionId: v2, encounterDate: '2024-03-01', encounterType: 'suivi', ageValue: 42, ageUnit: 'years', data: { score_a: 2, score_b: 3 } },
  { id: 'e-days', patientCode: 'P-v2', templateVersionId: v2, encounterDate: '2024-01-01', encounterType: 'suivi', ageValue: 12, ageUnit: 'days', data: { score_a: 1, score_b: 4 } },
  { id: 'e-months', patientCode: 'P-v2', templateVersionId: v1, encounterDate: '2024-02-01', encounterType: 'suivi', ageValue: 6, ageUnit: 'months', data: { score_a: 5 } },
];

describe('contrat export partage avec generate-export', () => {
  test('union multi-version conserve les anciennes valeurs, renommages et labels dupliques', () => {
    const merged = mergeExportFields(fields);
    expect(merged).toHaveLength(4);
    expect(referencedTemplateVersions(patients, encounters)).toEqual([v1, v2]);
    const table = buildPatientExport(patients, encounters, fields, 'last');
    expect(table.columns).toEqual(expect.arrayContaining(['patient__retired', 'patient__weight', 'encounter__score_a', 'encounter__score_b', 'age_value', 'age_unit']));
    expect(new Set(table.columns).size).toBe(table.columns.length);
    expect(table.rows.find((r) => r.patient_code === 'P-v1')).toMatchObject({ patient__retired: 'preservee', patient__weight: '70', age_value: '42', age_unit: 'years', encounter__score_a: '2', encounter__score_b: '3' });
    expect(table.rows.find((r) => r.patient_code === 'P-v2')).toMatchObject({ patient__retired: '', patient__weight: '71', age_value: '6', age_unit: 'months', encounter__score_a: '5', encounter__score_b: '' });
    const dictionary = buildDictionary(fields);
    expect(dictionary.rows.find((r) => r.column_id === 'patient__weight')).toMatchObject({ label: 'Poids initial', template_versions: `${v1}; ${v2}` });
  });

  test('CSV et XLSX sont reproductibles et portent age_value + age_unit', () => {
    const table = buildEncounterExport([...encounters].reverse(), [...fields].reverse());
    expect(table.rows.map((r) => [r.age_value, r.age_unit])).toEqual([[ '42', 'years' ], [ '12', 'days' ], [ '6', 'months' ]]);
    const csv = toCsv(table);
    expect(csv).toContain('age_value,age_unit');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(table.rows, { header: table.columns }), 'Export');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildDictionary(fields).rows), 'Dictionnaire');
    const parsed = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
    expect(parsed.SheetNames).toEqual(['Export', 'Dictionnaire']);
    expect(XLSX.utils.sheet_to_json(parsed.Sheets.Export, { header: 1 })[0]).toEqual(table.columns);
  });

  test('preserve les nombres signes et neutralise les formules dangereuses en CSV et XLSX', () => {
    const safe = ['-3.5', '-1', '+2.4'];
    const dangerous = ['=SUM(A1:A2)', '@cmd', '-CMD()', '+SUM(A1:A2)'];
    for (const value of safe) expect(neutralizeSpreadsheetFormula(value)).toBe(value);
    for (const value of dangerous) expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);

    const table = { columns: ['value'], rows: [...safe, ...dangerous].map((value) => ({ value })) };
    expect(toCsv(table).split('\n').slice(1)).toEqual([...safe, ...dangerous.map((value) => `'${value}`)]);
    const xlsxRows = neutralizeExportTable(table).rows.map((row) => row.value);
    expect(xlsxRows).toEqual([...safe, ...dangerous.map((value) => `'${value}`)]);
  });

  test('preserve les trois valeurs manquantes codifiees en CSV et XLSX', () => {
    const missingValues = [
      { __missing__: 'non_fait' as const },
      { __missing__: 'inconnu' as const },
      { __missing__: 'non_applicable' as const },
    ];
    const exportFields: ExportField[] = [{ fieldKey: 'result', label: 'Resultat', scope: 'patient', section: 'clinique', type: 'text', unit: null, allowedValues: null }];
    const table = buildPatientExport(
      missingValues.map((value, index) => ({ code: `P${index + 1}`, data: { result: value } })),
      [],
      exportFields,
      'last',
    );
    expect(table.rows.map((row) => row.patient__result)).toEqual(['non_fait', 'inconnu', 'non_applicable']);
    expect(toCsv(table).split('\n').slice(1).map((row) => row.split(',')[1])).toEqual(['non_fait', 'inconnu', 'non_applicable']);

    const safeTable = neutralizeExportTable(table);
    const sheet = XLSX.utils.json_to_sheet(safeTable.rows, { header: safeTable.columns });
    const parsed = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
    expect(parsed.slice(1).map((row) => row[1])).toEqual(['non_fait', 'inconnu', 'non_applicable']);
  });

  test('rejette une sentinelle de valeur manquante dont le code est inconnu', () => {
    const exportFields: ExportField[] = [{ fieldKey: 'result', label: 'Resultat', scope: 'patient', section: 'clinique', type: 'text', unit: null, allowedValues: null }];
    expect(() => buildPatientExport([{ code: 'P1', data: { result: { __missing__: 'autre' } } }], [], exportFields, 'last'))
      .toThrow('Code de valeur manquante invalide');
  });
});
