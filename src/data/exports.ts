// Couche d'acces a l'export (cahier §9.2, §9.3).
// Les donnees exportees proviennent d'une cohorte FIGEE. La generation et le hash
// du fichier conserve sont produits cote serveur par l'Edge Function `generate-export`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../lib/edgeFunctionError';
import { signedRead } from './signedRead';

export const EXPORTS_BUCKET = 'scientific-exports';
export type EncounterScopeOption = 'matching' | 'all' | 'both';
/** Profil d'export (L45) : Analyse par defaut, Complet pour la structure technique. */
export type ExportProfile = 'analysis' | 'complete';

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
  profile?: ExportProfile | null;
  /** UX-15 : elements du bilan deja consignes par le serveur, jamais reconstitues ici. */
  rowShape?: 'patient' | 'encounter' | null;
  projection?: { mode: 'all' | 'selected'; blockKeys: string[] } | null;
  excluded?: { patients: number; encounters: number } | null;
}

export interface RecordExportInput {
  cohortId: string;
  baseId: string;
  /** Versions de gabarit couvertes par les donnees exportees (export_log.template_versions). */
  templateVersions: string[];
  format: 'csv' | 'xlsx';
  options: Record<string, unknown>;
  /** Profil d'export (L45). Absent = `analysis` : le serveur traite aussi un appel sans profil. */
  profile?: ExportProfile;
}

export interface ExportRepository {
  recordExport(input: RecordExportInput): Promise<ExportLogItem>;
  listExports(cohortId: string): Promise<ExportLogItem[]>;
  /** Historique du parcours principal : tous les exports de la base, cohorte par cohorte. */
  listBaseExports(baseId: string): Promise<ExportLogItem[]>;
  getExportDownloadUrl(exportId: string, storagePath: string): Promise<string | null>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeExportRepository(client: SupabaseClient | null): ExportRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { recordExport: fail, listExports: fail, listBaseExports: fail, getExportDownloadUrl: fail };
  }

  return {
    async recordExport(input) {
      // Le refus de l'Edge Function (cohorte non figee, EXPORT_INCOMPLETE, limite depassee) doit
      // arriver tel quel a l'ecran : `invokeEdgeFunction` lit le corps de la reponse.
      const data = await invokeEdgeFunction<LogRow>(client, 'generate-export', {
        cohortId: input.cohortId,
        baseId: input.baseId,
        templateVersions: input.templateVersions,
        format: input.format,
        // `profile` explicite, meme si `options` en portait deja un : le champ d'entree prime.
        options: { ...input.options, profile: input.profile },
      });
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

    // La RLS reste la meme (`can_export_data` sur la base de la cohorte) : filtrer par base
    // n'ouvre aucune ligne de plus, cela evite seulement d'exiger une cohorte pour lire son
    // propre historique.
    async listBaseExports(baseId) {
      const { data, error } = await client
        .from('export_log')
        .select(
          'id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode, export_options',
        )
        .eq('base_id', baseId)
        .order('exported_at', { ascending: false })
        .limit(20);
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
  export_options?: {
    download_filename?: unknown;
    profile?: 'analysis' | 'complete' | null;
    mode?: unknown;
    sectionProjection?: { mode?: unknown; blockKeys?: unknown } | null;
    excluded_records?: { patients?: unknown; encounters?: unknown } | null;
  } | null;
};

/** L'historique ne montre que ce que le serveur a REELLEMENT enregistre : un export ancien,
 * ecrit avant ces options, reste lisible sans valeur inventee. */
function readProjection(options: LogRow['export_options']): ExportLogItem['projection'] {
  const projection = options?.sectionProjection;
  if (!projection) return null;
  if (projection.mode === 'selected') {
    const keys = Array.isArray(projection.blockKeys)
      ? projection.blockKeys.filter((key): key is string => typeof key === 'string')
      : [];
    return { mode: 'selected', blockKeys: keys };
  }
  return projection.mode === 'all' ? { mode: 'all', blockKeys: [] } : null;
}

function readExcluded(options: LogRow['export_options']): ExportLogItem['excluded'] {
  const excluded = options?.excluded_records;
  if (!excluded) return null;
  const patients = typeof excluded.patients === 'number' ? excluded.patients : 0;
  const encounters = typeof excluded.encounters === 'number' ? excluded.encounters : 0;
  return patients === 0 && encounters === 0 ? null : { patients, encounters };
}
const mapLog = (r: LogRow): ExportLogItem => ({
  id: r.id, format: r.format, exportedAt: r.exported_at, patientCount: r.patient_count,
  encounterCount: r.encounter_count, fileHash: r.file_hash, storedFilePath: r.stored_file_path,
  fileName: typeof r.export_options?.download_filename === 'string' ? r.export_options.download_filename : null,
  generationMode: r.generation_mode ?? null,
  profile: r.export_options?.profile ?? null,
  rowShape: r.export_options?.mode === 'patient' || r.export_options?.mode === 'encounter' ? r.export_options.mode : null,
  projection: readProjection(r.export_options),
  excluded: readExcluded(r.export_options),
});

export const exportRepository: ExportRepository = makeExportRepository(supabase);
