// Couche d'acces a l'export (cahier §9.2, §9.3).
// Les donnees exportees proviennent d'une cohorte FIGEE. La generation et le hash
// du fichier conserve sont produits cote serveur par l'Edge Function `generate-export`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ExportEncounter, ExportPatient } from '../domain/export';
import { signedRead } from './signedRead';

export const EXPORTS_BUCKET = 'scientific-exports';
export type EncounterScopeOption = 'matching' | 'all' | 'both';

export interface SnapshotData {
  patients: ExportPatient[];
  encounters: ExportEncounter[];
}

export interface ExportLogItem {
  id: string;
  format: string;
  exportedAt: string;
  patientCount: number | null;
  encounterCount: number | null;
  fileHash: string | null;
  storedFilePath: string | null;
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
  getSnapshotData(cohortId: string, scope: EncounterScopeOption): Promise<SnapshotData>;
  recordExport(input: RecordExportInput): Promise<ExportLogItem>;
  listExports(cohortId: string): Promise<ExportLogItem[]>;
  getExportDownloadUrl(exportId: string, storagePath: string): Promise<string | null>;
}

type PatientRow = { id: string; patient_code: string; data: Record<string, unknown> };
type EncRow = { id: string; patient_id: string; encounter_date: string; encounter_type: string; data: Record<string, unknown> };

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeExportRepository(client: SupabaseClient | null): ExportRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { getSnapshotData: fail, recordExport: fail, listExports: fail, getExportDownloadUrl: fail };
  }

  return {
    async getSnapshotData(cohortId, scope) {
      const { data: members, error: e0 } = await client.from('cohort_member').select('patient_id').eq('cohort_id', cohortId);
      if (e0) throw e0;
      const patientIds = (members ?? []).map((m) => m.patient_id as string);

      // Securite v3.0 : un export ne contient QUE des donnees CUREES (finalisees).
      const { data: pats, error: e1 } = patientIds.length
        ? await client.from('patient').select('id, patient_code, data').in('id', patientIds).eq('validation_status', 'curated')
        : { data: [], error: null };
      if (e1) throw e1;
      const prows = (pats ?? []) as PatientRow[];
      const idToCode = new Map(prows.map((p) => [p.id, p.patient_code]));
      const patients: ExportPatient[] = prows.map((p) => ({ code: p.patient_code, data: p.data ?? {} }));

      const encMap = new Map<string, EncRow>();
      if (scope === 'matching' || scope === 'both') {
        const { data: cem, error } = await client.from('cohort_encounter_member').select('encounter_id').eq('cohort_id', cohortId);
        if (error) throw error;
        const encIds = (cem ?? []).map((r) => r.encounter_id as string);
        if (encIds.length) {
          const { data: encs, error: e2 } = await client.from('encounter').select('id, patient_id, encounter_date, encounter_type, data').in('id', encIds).eq('validation_status', 'curated');
          if (e2) throw e2;
          for (const e of (encs ?? []) as EncRow[]) encMap.set(e.id, e);
        }
      }
      if ((scope === 'all' || scope === 'both') && patientIds.length) {
        const { data: encs, error: e3 } = await client
          .from('encounter').select('id, patient_id, encounter_date, encounter_type, data')
          .in('patient_id', patientIds).is('deleted_at', null).eq('validation_status', 'curated');
        if (e3) throw e3;
        for (const e of (encs ?? []) as EncRow[]) encMap.set(e.id, e);
      }

      // §7.2 : une rencontre CUREE peut appartenir a un patient dont les donnees PERMANENTES
      // sont encore `draft` (donc absent de idToCode, curated only). On resout malgre tout son
      // CODE pseudonymise (analytique, jamais l'identite) pour ne pas exporter patient_code vide
      // ni omettre la rencontre. Les donnees permanentes du patient draft, elles, ne sont PAS exportees.
      const missingPids = [...new Set([...encMap.values()].map((e) => e.patient_id).filter((pid) => !idToCode.has(pid)))];
      if (missingPids.length) {
        const { data: extra, error: e4 } = await client
          .from('patient').select('id, patient_code').in('id', missingPids).is('deleted_at', null);
        if (e4) throw e4;
        for (const p of (extra ?? []) as { id: string; patient_code: string }[]) idToCode.set(p.id, p.patient_code);
      }

      const encounters: ExportEncounter[] = [...encMap.values()].map((e) => ({
        id: e.id,
        patientCode: idToCode.get(e.patient_id) ?? '',
        encounterDate: e.encounter_date,
        encounterType: e.encounter_type,
        data: e.data ?? {},
      }));
      return { patients, encounters };
    },

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
        .select('id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode')
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
};
const mapLog = (r: LogRow): ExportLogItem => ({
  id: r.id, format: r.format, exportedAt: r.exported_at, patientCount: r.patient_count,
  encounterCount: r.encounter_count, fileHash: r.file_hash, storedFilePath: r.stored_file_path,
  generationMode: r.generation_mode ?? null,
});

export const exportRepository: ExportRepository = makeExportRepository(supabase);
