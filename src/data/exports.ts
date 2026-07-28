// Couche d'acces a l'export (cahier §9.2, §9.3).
// Les donnees exportees proviennent d'une cohorte FIGEE. La generation et le hash
// du fichier conserve sont produits cote serveur par l'Edge Function `generate-export`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { signedRead } from './signedRead';

export const EXPORTS_BUCKET = 'scientific-exports';
export type EncounterScopeOption = 'matching' | 'all' | 'both';

export interface ExportLogItem {
  id: string;
  format: string;
  exportedAt: string;
  patientCount: number | null;
  encounterCount: number | null;
  fileHash: string | null;
  storedFilePath: string | null;
  fileName?: string | null;
  generationMode?: 'client' | 'server' | null;
}

export interface RecordExportInput {
  cohortId: string;
  baseId: string;
  /** Versions de gabarit couvertes par les donnees exportees (export_log.template_versions). */
  templateVersions: string[];
  format: 'csv' | 'xlsx';
  options: Record<string, unknown>;
}

export interface ExportRepository {
  recordExport(input: RecordExportInput): Promise<ExportLogItem>;
  listExports(cohortId: string): Promise<ExportLogItem[]>;
  getExportDownloadUrl(exportId: string, storagePath: string): Promise<string | null>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeExportRepository(client: SupabaseClient | null): ExportRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { recordExport: fail, listExports: fail, getExportDownloadUrl: fail };
  }

  return {
    async recordExport(input) {
      const { data, error } = await client.functions.invoke('generate-export', {
        body: {
          cohortId: input.cohortId,
          baseId: input.baseId,
          templateVersions: input.templateVersions,
          format: input.format,
          options: input.options,
        },
      });
      if (error) throw error;
      return mapLog(data as LogRow);
    },

    async listExports(cohortId) {
      const { data, error } = await client
        .from('export_log')
        .select(
          'id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode, export_options',
        )
        .eq('cohort_id', cohortId)
        .order('exported_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as LogRow[]).map(mapLog);
    },

    async getExportDownloadUrl(exportId, storagePath) {
      return signedRead(client, 'export', exportId, EXPORTS_BUCKET, storagePath, 120);
    },
  };
}

type LogRow = {
  id: string; format: string; exported_at: string; patient_count: number | null;
  encounter_count: number | null; file_hash: string | null; stored_file_path: string | null;
  generation_mode?: 'client' | 'server' | null;
  export_options?: { download_filename?: unknown } | null;
};
const mapLog = (r: LogRow): ExportLogItem => ({
  id: r.id, format: r.format, exportedAt: r.exported_at, patientCount: r.patient_count,
  encounterCount: r.encounter_count, fileHash: r.file_hash, storedFilePath: r.stored_file_path,
  fileName: typeof r.export_options?.download_filename === 'string' ? r.export_options.download_filename : null,
  generationMode: r.generation_mode ?? null,
});

export const exportRepository: ExportRepository = makeExportRepository(supabase);
