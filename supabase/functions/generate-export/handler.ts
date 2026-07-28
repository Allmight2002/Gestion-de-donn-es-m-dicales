// Handler testable de generate-export (audit lot 9 §C3) : lecture serveur de la cohorte figee,
// construction de l'export (CSV/XLSX), upload service_role puis journalisation transactionnelle avec
// rollback du fichier si l'insert echoue. Les effets externes (clients Supabase, horloge, id) sont
// injectes ; la generation CSV/XLSX reste l'implementation reelle (exportContract/xlsxLimits).
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  assertNoIdentity,
  buildDictionary,
  buildEncounterExport,
  buildPatientExport,
  mergeExportFields,
  neutralizeExportTable,
  referencedTemplateVersions,
  toCsv,
} from './exportContract.ts';
import { parseExportRequest, readJsonObject, validationResponse } from '../_shared/contracts.ts';
import { assertXlsxExportWithinLimits, assertXlsxGenerationTime, assertXlsxOutputSize } from './xlsxLimits.ts';

export interface GenerateExportDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
  newId: () => string;
  now: () => number;
  nowIso: () => string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const EXPORTS_BUCKET = 'scientific-exports';
const PAGE_SIZE = 500;
const FILTER_CHUNK_SIZE = 200;
export const EXPORT_LIMITS = {
  patients: 10_000,
  encounters: 50_000,
  dictionaryFields: 25_000,
  cells: 1_000_000,
  csvColumns: 1_000,
  xlsxColumns: 256,
} as const;

type CollectionFailureKind = 'read' | 'inconsistent' | 'limit';

class ExportCollectionError extends Error {
  constructor(
    readonly kind: CollectionFailureKind,
    readonly resource: string,
    readonly limit?: number,
    readonly observed?: number,
  ) {
    super(kind);
    this.name = 'ExportCollectionError';
  }
}

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
  count: number | null;
}

interface PaginatedRead<T> {
  resource: string;
  limit: number;
  observedBefore?: number;
  keyOf: (row: T) => string;
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>;
}

/**
 * Lit une collection PostgREST avec un compte exact, un ordre impose par l'appelant et des plages
 * inclusives. Le compte est reverifie a chaque page afin qu'une mutation concurrente, une page
 * tronquee ou un plafond PostgREST ne puisse jamais produire un export partiel en HTTP 200.
 */
async function readAllPages<T>(options: PaginatedRead<T>): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  let offset = 0;

  while (expectedCount === null || rows.length < expectedCount) {
    const page = await options.fetchPage(offset, offset + PAGE_SIZE - 1);
    if (page.error) throw new ExportCollectionError('read', options.resource);
    if (!Number.isSafeInteger(page.count) || (page.count ?? -1) < 0 || !Array.isArray(page.data)) {
      throw new ExportCollectionError('inconsistent', options.resource);
    }

    const count = page.count as number;
    if (expectedCount === null) {
      expectedCount = count;
      const observed = (options.observedBefore ?? 0) + count;
      if (observed > options.limit) {
        throw new ExportCollectionError('limit', options.resource, options.limit, observed);
      }
    } else if (count !== expectedCount) {
      throw new ExportCollectionError('inconsistent', options.resource);
    }

    if (page.data.length === 0) {
      if (rows.length !== expectedCount) throw new ExportCollectionError('inconsistent', options.resource);
      break;
    }

    for (const row of page.data) {
      const key = options.keyOf(row);
      if (!key || seen.has(key)) throw new ExportCollectionError('inconsistent', options.resource);
      seen.add(key);
      rows.push(row);
      if (rows.length > expectedCount) throw new ExportCollectionError('inconsistent', options.resource);
    }
    offset += page.data.length;
  }

  if (expectedCount === null || rows.length !== expectedCount) {
    throw new ExportCollectionError('inconsistent', options.resource);
  }
  return rows;
}

interface ChunkedRead<T> {
  values: string[];
  resource: string;
  limit: number;
  keyOf: (row: T) => string;
  fetchPage: (chunk: string[], from: number, to: number) => Promise<PageResult<T>>;
}

async function readInChunks<T>(options: ChunkedRead<T>): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < options.values.length; start += FILTER_CHUNK_SIZE) {
    const chunk = options.values.slice(start, start + FILTER_CHUNK_SIZE);
    const part = await readAllPages({
      resource: options.resource,
      limit: options.limit,
      observedBefore: rows.length,
      keyOf: options.keyOf,
      fetchPage: (from, to) => options.fetchPage(chunk, from, to),
    });
    for (const row of part) {
      const key = options.keyOf(row);
      if (seen.has(key)) throw new ExportCollectionError('inconsistent', options.resource);
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function collectionFailureResponse(error: ExportCollectionError): Response {
  if (error.kind === 'limit') {
    return json(413, {
      code: 'EXPORT_LIMIT_EXCEEDED',
      error: 'Export refuse : limite maximale depassee',
      resource: error.resource,
      limit: error.limit,
      observed: error.observed,
    });
  }
  if (error.kind === 'inconsistent') {
    return json(409, {
      code: 'EXPORT_INCOMPLETE',
      error: 'Export refuse : donnees incompletes ou incoherentes',
      resource: error.resource,
    });
  }
  return json(500, {
    code: 'EXPORT_READ_FAILED',
    error: 'Lecture des donnees d export impossible',
    resource: error.resource,
  });
}

function assertExportShapeWithinLimits(
  rowCount: number,
  columnCount: number,
  format: 'csv' | 'xlsx',
  extraCells = 0,
): void {
  const columnLimit = format === 'xlsx' ? EXPORT_LIMITS.xlsxColumns : EXPORT_LIMITS.csvColumns;
  if (columnCount > columnLimit) {
    throw new ExportCollectionError('limit', 'columns', columnLimit, columnCount);
  }
  const cells = (rowCount + 1) * columnCount + extraCells;
  if (cells > EXPORT_LIMITS.cells) {
    throw new ExportCollectionError('limit', 'cells', EXPORT_LIMITS.cells, cells);
  }
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const FILENAME_SEGMENT_MAX = 48;

/**
 * Produit un segment portable (Windows/macOS/Linux) sans laisser un nom de base ou de cohorte
 * injecter des separateurs de chemin. Les accents sont translitteres pour garder des URLs
 * Storage previsibles, puis chaque segment est borne afin de limiter la longueur totale.
 */
export function exportFilenameSegment(value: unknown, fallback: string): string {
  const safe = typeof value === 'string'
    ? value
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, FILENAME_SEGMENT_MAX)
      .replace(/-+$/g, '')
    : '';
  return safe || fallback;
}

export function buildExportFilename(
  baseName: unknown,
  cohortName: unknown,
  mode: 'encounter' | 'patient',
  generatedAt: string,
  format: 'csv' | 'xlsx',
): string {
  const timestamp = generatedAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  const readableTimestamp = timestamp
    ? `${timestamp[1]}_${timestamp[2]}-${timestamp[3]}-${timestamp[4]}Z`
    : 'date-inconnue';
  const readableMode = mode === 'patient' ? 'patients' : 'rencontres';
  return [
    'meddata',
    exportFilenameSegment(baseName, 'base'),
    exportFilenameSegment(cohortName, 'cohorte'),
    readableMode,
    readableTimestamp,
  ].join('_') + `.${format}`;
}

export async function handleGenerateExport(req: Request, deps: GenerateExportDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(auth));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible' });
  }

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  let parsed;
  try {
    parsed = parseExportRequest(await readJsonObject(req));
  } catch (error) {
    return validationResponse(error);
  }
  const { cohortId, format, options } = parsed;

  const { data: cohort, error: cohortErr } = await admin
    .from('cohort')
    .select('id, base_id, name, cohort_type')
    .eq('id', cohortId)
    .maybeSingle();
  if (cohortErr || !cohort) return json(404, { error: 'Cohorte introuvable' });
  if (cohort.cohort_type !== 'snapshot') return json(409, { error: 'Seule une cohorte figee est exportable' });

  const { data: canExport, error: canExportErr } = await asUser.rpc('can_export_data', { p_base: cohort.base_id });
  if (canExportErr || canExport !== true) return json(403, { error: 'Acces export refuse' });

  const { data: base, error: baseErr } = await admin
    .from('base')
    .select('name')
    .eq('id', cohort.base_id)
    .maybeSingle();
  if (baseErr || !base) return collectionFailureResponse(new ExportCollectionError('read', 'base'));

  try {
    interface CohortMemberRow {
      patient_id: string;
    }
    interface PatientRow {
      id: string;
      patient_code: string;
      template_version_id?: string;
      data?: Record<string, unknown>;
    }
    interface EncounterMemberRow {
      encounter_id: string;
    }
    interface EncounterRow {
      id: string;
      patient_id: string;
      template_version_id?: string;
      encounter_date: string;
      encounter_type: string;
      age_value?: unknown;
      age_unit?: string | null;
      data?: Record<string, unknown>;
    }
    interface TemplateFieldRow {
      id: string;
      template_version_id: string;
      field_key: string;
      label: string;
      scope: 'patient' | 'encounter';
      section: string;
      type: string;
      unit: string | null;
      allowed_values: unknown[] | null;
      display_order: number;
    }

    const cm = await readAllPages<CohortMemberRow>({
      resource: 'patients',
      limit: EXPORT_LIMITS.patients,
      keyOf: (row) => row.patient_id,
      fetchPage: async (from, to) => {
        const result = await admin.from('cohort_member')
          .select('patient_id', { count: 'exact' })
          .eq('cohort_id', cohortId)
          .order('patient_id', { ascending: true })
          .range(from, to);
        return { data: result.data as CohortMemberRow[] | null, error: result.error, count: result.count };
      },
    });
    const patientIds = cm.map((row) => row.patient_id);

    const patientRows = await readInChunks<PatientRow>({
      values: patientIds,
      resource: 'patients',
      limit: EXPORT_LIMITS.patients,
      keyOf: (row) => row.id,
      fetchPage: async (chunk, from, to) => {
        const result = await admin.from('patient')
          .select('id, patient_code, template_version_id, data', { count: 'exact' })
          .in('id', chunk)
          .eq('base_id', cohort.base_id)
          .is('deleted_at', null)
          .eq('validation_status', 'curated')
          .order('id', { ascending: true })
          .range(from, to);
        return { data: result.data as PatientRow[] | null, error: result.error, count: result.count };
      },
    });
    const expectedPatientIds = new Set(patientIds);
    const foundPatientIds = new Set(patientRows.map((patient) => patient.id));
    if (
      foundPatientIds.size !== expectedPatientIds.size ||
      [...expectedPatientIds].some((id) => !foundPatientIds.has(id))
    ) {
      console.error('generate-export cohort patient scope mismatch');
      throw new ExportCollectionError('inconsistent', 'patients');
    }
    const idToCode = new Map(patientRows.map((patient) => [patient.id, patient.patient_code]));
    const patients = patientRows.map((patient) => ({
      code: patient.patient_code,
      templateVersionId: patient.template_version_id,
      data: patient.data ?? {},
    }));

    const encMap = new Map<string, EncounterRow>();
    if (options.scope === 'matching' || options.scope === 'both') {
      const encounterMembers = await readAllPages<EncounterMemberRow>({
        resource: 'encounters',
        limit: EXPORT_LIMITS.encounters,
        keyOf: (row) => row.encounter_id,
        fetchPage: async (from, to) => {
          const result = await admin.from('cohort_encounter_member')
            .select('encounter_id', { count: 'exact' })
            .eq('cohort_id', cohortId)
            .order('encounter_id', { ascending: true })
            .range(from, to);
          return { data: result.data as EncounterMemberRow[] | null, error: result.error, count: result.count };
        },
      });
      const encounterIds = encounterMembers.map((row) => row.encounter_id);
      const matchingRows = await readInChunks<EncounterRow>({
        values: encounterIds,
        resource: 'encounters',
        limit: EXPORT_LIMITS.encounters,
        keyOf: (row) => row.id,
        fetchPage: async (chunk, from, to) => {
          const result = await admin.from('encounter')
            .select(
              'id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data, patient!inner(base_id)',
              { count: 'exact' },
            )
            .in('id', chunk)
            .eq('patient.base_id', cohort.base_id)
            .is('deleted_at', null)
            .eq('validation_status', 'curated')
            .order('id', { ascending: true })
            .range(from, to);
          return { data: result.data as EncounterRow[] | null, error: result.error, count: result.count };
        },
      });
      const expectedEncounterIds = new Set(encounterIds);
      const foundEncounterIds = new Set(matchingRows.map((encounter) => encounter.id));
      if (
        foundEncounterIds.size !== expectedEncounterIds.size ||
        [...expectedEncounterIds].some((id) => !foundEncounterIds.has(id))
      ) {
        console.error('generate-export cohort encounter scope mismatch');
        throw new ExportCollectionError('inconsistent', 'encounters');
      }
      for (const encounter of matchingRows) encMap.set(encounter.id, encounter);
    }

    if ((options.scope === 'all' || options.scope === 'both') && patientIds.length) {
      const allRows = await readInChunks<EncounterRow>({
        values: patientIds,
        resource: 'encounters',
        limit: EXPORT_LIMITS.encounters,
        keyOf: (row) => row.id,
        fetchPage: async (chunk, from, to) => {
          const result = await admin.from('encounter')
            .select(
              'id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data, patient!inner(base_id)',
              { count: 'exact' },
            )
            .in('patient_id', chunk)
            .eq('patient.base_id', cohort.base_id)
            .is('deleted_at', null)
            .eq('validation_status', 'curated')
            .order('id', { ascending: true })
            .range(from, to);
          return { data: result.data as EncounterRow[] | null, error: result.error, count: result.count };
        },
      });
      for (const encounter of allRows) {
        encMap.set(encounter.id, encounter);
        if (encMap.size > EXPORT_LIMITS.encounters) {
          throw new ExportCollectionError(
            'limit',
            'encounters',
            EXPORT_LIMITS.encounters,
            encMap.size,
          );
        }
      }
    }

    // Une cohorte de rencontres peut contenir une rencontre curated dont le patient draft
    // n'appartient pas a cohort_member. Son code est charge par lots, dans la meme base, et toute
    // absence est traitee fail-closed.
    const missingParentIds = [
      ...new Set([...encMap.values()].map((encounter) => encounter.patient_id).filter((id) => !idToCode.has(id))),
    ];
    const parentRows = await readInChunks<Pick<PatientRow, 'id' | 'patient_code'>>({
      values: missingParentIds,
      resource: 'encounter_parents',
      limit: EXPORT_LIMITS.encounters,
      keyOf: (row) => row.id,
      fetchPage: async (chunk, from, to) => {
        const result = await admin.from('patient')
          .select('id, patient_code', { count: 'exact' })
          .in('id', chunk)
          .eq('base_id', cohort.base_id)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to);
        return {
          data: result.data as Array<Pick<PatientRow, 'id' | 'patient_code'>> | null,
          error: result.error,
          count: result.count,
        };
      },
    });
    for (const parent of parentRows) idToCode.set(parent.id, parent.patient_code);
    if (missingParentIds.some((id) => !idToCode.has(id))) {
      console.error('generate-export encounter parent scope mismatch');
      throw new ExportCollectionError('inconsistent', 'encounter_parents');
    }

    const encounters = [...encMap.values()].map((encounter) => ({
      id: encounter.id,
      patientCode: idToCode.get(encounter.patient_id) ?? '',
      encounterDate: encounter.encounter_date,
      encounterType: encounter.encounter_type,
      templateVersionId: encounter.template_version_id,
      ageValue: encounter.age_value,
      ageUnit: encounter.age_unit,
      data: encounter.data ?? {},
    }));

    const templateVersions = referencedTemplateVersions(patients, encounters);
    if (!templateVersions.length) return json(409, { error: 'Aucune version de gabarit referencee' });
    const rawFields = await readInChunks<TemplateFieldRow>({
      values: templateVersions,
      resource: 'dictionary_fields',
      limit: EXPORT_LIMITS.dictionaryFields,
      keyOf: (row) => row.id,
      fetchPage: async (chunk, from, to) => {
        const result = await admin.from('template_field')
          .select(
            'id, template_version_id, field_key, label, scope, section, type, unit, allowed_values, display_order',
            { count: 'exact' },
          )
          .in('template_version_id', chunk)
          .order('template_version_id', { ascending: true })
          .order('scope', { ascending: true })
          .order('field_key', { ascending: true })
          .order('display_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        return { data: result.data as TemplateFieldRow[] | null, error: result.error, count: result.count };
      },
    });
    const fields = mergeExportFields(
      rawFields.map((f) => ({
        fieldKey: f.field_key,
        label: f.label,
        scope: f.scope,
        section: f.section,
        type: f.type,
        unit: f.unit,
        allowedValues: f.allowed_values,
        displayOrder: f.display_order,
        templateVersionIds: [f.template_version_id],
      })),
    );
    const main = options.mode === 'patient'
      ? buildPatientExport(patients, encounters, fields, options.rule)
      : buildEncounterExport(encounters, fields);
    const dict = buildDictionary(fields);
    const dictionaryCells = format === 'xlsx' ? (dict.rows.length + 1) * dict.columns.length : 0;
    assertExportShapeWithinLimits(main.rows.length, main.columns.length, format, dictionaryCells);
    assertNoIdentity(main.columns);

    let bytes: Uint8Array;
    let contentType: string;
    if (format === 'xlsx') {
      const generationStartedAt = performance.now();
      const safeMain = neutralizeExportTable(main);
      const safeDict = neutralizeExportTable(dict);
      assertXlsxExportWithinLimits([safeMain, safeDict]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeMain.rows, { header: safeMain.columns }), 'Export');
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(safeDict.rows, { header: safeDict.columns }),
        'Dictionnaire',
      );
      bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
      assertXlsxGenerationTime(generationStartedAt);
      assertXlsxOutputSize(bytes);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      bytes = new TextEncoder().encode(toCsv(main));
      contentType = 'text/csv;charset=utf-8';
    }

    const fileHash = await sha256Hex(bytes);
    const generatedAt = deps.nowIso();
    const filename = buildExportFilename(base.name, cohort.name, options.mode, generatedAt, format);
    // Le chemin Storage reste pseudonymise : le nom metier n'est conserve que dans le journal
    // autorise et transmis comme Content-Disposition au moment de la lecture signee.
    const path = `${cohort.base_id}/${cohortId}/${deps.now()}-${deps.newId()}.${format}`;
    const { error: uploadErr } = await admin.storage.from(EXPORTS_BUCKET).upload(
      path,
      new Blob([Uint8Array.from(bytes).buffer], { type: contentType }),
      {
        contentType,
        upsert: false,
      },
    );
    if (uploadErr) return json(500, { error: 'Ecriture de l export impossible' });

    const { data: inserted, error: insertErr } = await admin
      .from('export_log')
      .insert({
        cohort_id: cohortId,
        exported_by: who.user.id,
        template_versions: templateVersions,
        format,
        export_options: {
          ...options,
          generated_by: 'edge:generate-export',
          dictionary_included: format === 'xlsx',
          download_filename: filename,
        },
        patient_count: patients.length,
        encounter_count: encounters.length,
        stored_file_path: path,
        file_hash: fileHash,
        generation_mode: 'server',
        generated_by_function: 'generate-export',
        server_generated_at: generatedAt,
      })
      .select(
        'id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode, export_options',
      )
      .single();
    if (insertErr) {
      await admin.storage.from(EXPORTS_BUCKET).remove([path]);
      return json(500, { error: 'Journalisation de l export impossible' });
    }

    return json(200, inserted);
  } catch (e) {
    if (e instanceof ExportCollectionError) return collectionFailureResponse(e);
    console.error('generate-export failed', e instanceof Error ? e.name : 'unknown');
    return json(500, { error: 'Generation de l export impossible' });
  }
}
