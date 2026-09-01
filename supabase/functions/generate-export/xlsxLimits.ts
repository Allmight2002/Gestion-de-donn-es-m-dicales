import type { ExportTable } from './exportContract.ts';

export const XLSX_EXPORT_LIMITS = {
  rowsPerSheet: 50_000,
  columnsPerSheet: 256,
  cellsPerWorkbook: 1_000_000,
  cellCharacters: 32_767,
  outputBytes: 64 * 1024 * 1024,
  generationMilliseconds: 10_000,
} as const;

export function assertXlsxExportWithinLimits(tables: ExportTable[]): void {
  let cells = 0;
  for (const table of tables) {
    if (table.rows.length > XLSX_EXPORT_LIMITS.rowsPerSheet) {
      throw new Error(`Export XLSX limite a ${XLSX_EXPORT_LIMITS.rowsPerSheet} lignes par feuille`);
    }
    if (table.columns.length > XLSX_EXPORT_LIMITS.columnsPerSheet) {
      throw new Error(`Export XLSX limite a ${XLSX_EXPORT_LIMITS.columnsPerSheet} colonnes par feuille`);
    }
    cells += (table.rows.length + 1) * table.columns.length;
    if (cells > XLSX_EXPORT_LIMITS.cellsPerWorkbook) {
      throw new Error(`Export XLSX limite a ${XLSX_EXPORT_LIMITS.cellsPerWorkbook} cellules`);
    }
    for (const column of table.columns) {
      if (column.length > XLSX_EXPORT_LIMITS.cellCharacters) throw new Error('Libelle XLSX trop long');
    }
    for (const row of table.rows) {
      for (const column of table.columns) {
        const value = row[column];
        if (typeof value === 'string' && value.length > XLSX_EXPORT_LIMITS.cellCharacters) {
          throw new Error('Contenu de cellule XLSX trop long');
        }
      }
    }
  }
}

export function assertXlsxOutputSize(bytes: Uint8Array): void {
  if (bytes.byteLength > XLSX_EXPORT_LIMITS.outputBytes) {
    throw new Error(`Classeur XLSX limite a ${XLSX_EXPORT_LIMITS.outputBytes} octets`);
  }
}

export function assertXlsxGenerationTime(startedAt: number, now = performance.now()): void {
  if (now - startedAt > XLSX_EXPORT_LIMITS.generationMilliseconds) {
    throw new Error(`Generation XLSX limitee a ${XLSX_EXPORT_LIMITS.generationMilliseconds} ms`);
  }
}
