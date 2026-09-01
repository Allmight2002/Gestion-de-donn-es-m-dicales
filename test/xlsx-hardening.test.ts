import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { parseSpreadsheet, SPREADSHEET_LIMITS } from '../src/domain/spreadsheet';
import {
  assertXlsxExportWithinLimits,
  assertXlsxGenerationTime,
  assertXlsxOutputSize,
  XLSX_EXPORT_LIMITS,
} from '../supabase/functions/generate-export/xlsxLimits';

const workbookBytes = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Donnees');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

describe('durcissement XLSX', () => {
  test('lit un classeur nominal Unicode et borne les colonnes', async () => {
    const parsed = await parseSpreadsheet(workbookBytes([['Libelle', 'Valeur'], ['Crane', 'éΩ中']]));
    expect(parsed).toEqual({ headers: ['Libelle', 'Valeur'], rows: [['Crane', 'éΩ中']] });

    const tooWide = [Array.from({ length: SPREADSHEET_LIMITS.columns + 1 }, (_, index) => `c${index}`)];
    await expect(parseSpreadsheet(workbookBytes(tooWide))).rejects.toThrow('colonnes');
  });

  test('rejette une chaine pathologique avant son usage applicatif', async () => {
    const pathological = 'a'.repeat(SPREADSHEET_LIMITS.cellCharacters + 1);
    const csv = new TextEncoder().encode(`label\n${pathological}`).buffer;
    await expect(parseSpreadsheet(csv)).rejects.toThrow('caracteres');
  });

  test('rejette un classeur corrompu', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff]).buffer;
    await expect(parseSpreadsheet(corrupt)).rejects.toThrow();
  });

  test('neutralise le risque de classeur export demesure par des plafonds deterministes', () => {
    expect(() => assertXlsxExportWithinLimits([{ columns: ['c'], rows: [{ c: 'éΩ中' }] }])).not.toThrow();
    expect(() => assertXlsxExportWithinLimits([{
      columns: Array.from({ length: XLSX_EXPORT_LIMITS.columnsPerSheet + 1 }, (_, index) => `c${index}`),
      rows: [],
    }])).toThrow('colonnes');
    expect(() => assertXlsxExportWithinLimits([{
      columns: ['c'],
      rows: [{ c: '=CMD()' }, { c: 'x'.repeat(XLSX_EXPORT_LIMITS.cellCharacters + 1) }],
    }])).toThrow('cellule');
    expect(() => assertXlsxExportWithinLimits([{
      columns: ['c'],
      rows: Array.from({ length: XLSX_EXPORT_LIMITS.rowsPerSheet + 1 }, () => ({ c: 'x' })),
    }])).toThrow('lignes');
  });

  test('borne explicitement la taille du fichier serialise', () => {
    expect(() => assertXlsxOutputSize(new Uint8Array(128))).not.toThrow();
    expect(() => assertXlsxOutputSize(new Uint8Array(XLSX_EXPORT_LIMITS.outputBytes + 1))).toThrow('octets');
  });

  test('signale deterministiquement le depassement du budget temps', () => {
    expect(() => assertXlsxGenerationTime(100, 100 + XLSX_EXPORT_LIMITS.generationMilliseconds)).not.toThrow();
    expect(() => assertXlsxGenerationTime(100, 101 + XLSX_EXPORT_LIMITS.generationMilliseconds)).toThrow('ms');
  });
});
