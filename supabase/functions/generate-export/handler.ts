// Handler testable de generate-export (audit lot 9 §C3) : lecture serveur de la cohorte figee,
// construction de l'export (CSV/XLSX), upload service_role puis journalisation transactionnelle avec
// rollback du fichier si l'insert echoue. Les effets externes (clients Supabase, horloge, id) sont
// injectes ; la generation CSV/XLSX reste l'implementation reelle (exportContract/xlsxLimits).
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  assertNoAnalyticIdCollisions,
  assertNoIdentity,
  buildDictionary,
  buildEncounterExport,
  buildMetadata,
  buildModalities,
  buildMultivalueTable,
  buildPatientExport,
  columnId,
  type ExportField,
  type ExportTable,
  extractMultivalueCodes,
  findAmbiguousBlockFields,
  findProjectionProblem,
  hasSubsectionFields,
  isMultivalueField,
  MAX_INDICATOR_CODES,
  mergeExportFields,
  neutralizeExportTable,
  projectFields,
  referencedTemplateVersions,
  toCsv,
  withExcelDateSerials,
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
  dictionarySections: 5_000,
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

export function assertExportShapeWithinLimits(
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

/**
 * Mappe les colonnes date/datetime de la feuille principale pour l'ecriture de cellules
 * Excel natives (L48). En mode RENCONTRE, `encounter_date` est une colonne de date meta ;
 * en mode PATIENT, seuls les champs rendus (patient + rencontre agreges) portent des dates.
 */
function temporalColumnsOf(
  fields: ReturnType<typeof mergeExportFields>,
  mode: 'encounter' | 'patient',
): Map<string, 'date' | 'datetime'> {
  const map = new Map<string, 'date' | 'datetime'>();
  const rendered = mode === 'patient' ? fields : fields.filter((f) => f.scope === 'encounter');
  for (const f of rendered) {
    if (f.type === 'date') map.set(columnId(f), 'date');
    else if (f.type === 'datetime') map.set(columnId(f), 'datetime');
  }
  if (mode === 'encounter') map.set('encounter_date', 'date');
  return map;
}

type WorkSheetCells = Record<string, unknown> & { '!ref'?: string };

/**
 * Pose le format d'affichage (cellule Excel native, type nombre) sur les colonnes de date :
 * `yyyy-mm-dd` pour les dates, `yyyy-mm-dd hh:mm:ss` pour les datetime (secondes fixes, UTC).
 * Sans ce format, un nombre de serie s'afficherait comme un entier illisible.
 */
function applyExcelDateFormats(
  sheet: WorkSheetCells,
  columns: readonly string[],
  temporalColumns: ReadonlyMap<string, 'date' | 'datetime'>,
): void {
  const ref = sheet['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (const [column, kind] of temporalColumns) {
    const columnIndex = columns.indexOf(column);
    if (columnIndex < 0 || columnIndex > range.e.c) continue;
    const format = kind === 'datetime' ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd';
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: columnIndex })] as
        | { t?: string; z?: string }
        | undefined;
      if (cell && cell.t === 'n') cell.z = format;
    }
  }
}

export function buildExportFilename(
  baseName: unknown,
  cohortName: unknown,
  mode: 'encounter' | 'patient',
  profile: 'analysis' | 'complete',
  generatedAt: string,
  format: 'csv' | 'xlsx',
): string {
  const timestamp = generatedAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  const readableTimestamp = timestamp
    ? `${timestamp[1]}_${timestamp[2]}-${timestamp[3]}-${timestamp[4]}Z`
    : 'date-inconnue';
  const readableMode = mode === 'patient' ? 'patients' : 'rencontres';
  // L45 : le profil est visible dans le nom du fichier, comme il l'est dans le journal.
  const readableProfile = profile === 'analysis' ? 'analyse' : 'complet';
  return [
    'meddata',
    exportFilenameSegment(baseName, 'base'),
    exportFilenameSegment(cohortName, 'cohorte'),
    readableMode,
    readableProfile,
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
      description: string | null;
      scope: 'patient' | 'encounter';
      /** L54 : nullable. `null` = variable du TRONC COMMUN, toujours exportee. */
      section: string | null;
      type: string;
      is_multiple?: boolean | null;
      unit: string | null;
      allowed_values: unknown[] | null;
      allowed_options: unknown[] | null;
      missing_reasons: string[] | null;
      /** Variable calculee (L35). Null = variable saisie. */
      formula?: string | null;
      display_order: number;
    }
    interface TemplateSectionRow {
      id: string;
      template_version_id: string;
      section_key: string;
      label: string;
      /** L54 : nul = BLOC racine ; non nul = sous-section, dont le parent est le bloc. */
      parent_section_id: string | null;
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
    // La porte de l'export n'est plus le STATUT de validation (`curated`) mais la
    // COMPLETUDE des champs obligatoires : une fiche `draft` ou `complete` s'exporte des
    // lors qu'elle porte ses champs requis. La definition de « champ requis manquant »
    // reste celle de la base (`missing_required_fields`) : une seule regle pour la saisie
    // et pour l'export. Fail-closed : si la base ne peut pas repondre, l'export echoue --
    // il n'exporte jamais des fiches dont la completude n'a pas ete verifiee.
    interface IncompleteRow {
      record_kind: string;
      record_id: string;
    }
    const { data: incompleteData, error: incompleteErr } = await admin
      .rpc('export_incomplete_records', { p_cohort_id: cohortId });
    if (incompleteErr) throw new ExportCollectionError('read', 'completeness');
    if (!Array.isArray(incompleteData)) throw new ExportCollectionError('inconsistent', 'completeness');
    const incompletePatientIds = new Set<string>();
    const incompleteEncounterIds = new Set<string>();
    for (const row of incompleteData as IncompleteRow[]) {
      if (typeof row?.record_id !== 'string' || !row.record_id) {
        throw new ExportCollectionError('inconsistent', 'completeness');
      }
      if (row.record_kind === 'patient') incompletePatientIds.add(row.record_id);
      else if (row.record_kind === 'encounter') incompleteEncounterIds.add(row.record_id);
      else throw new ExportCollectionError('inconsistent', 'completeness');
    }

    // Le code d'un patient ecarte reste connu : en mode rencontre le fichier ne porte
    // aucune donnee permanente, seulement `patient_code` -- une rencontre complete n'a
    // donc pas a disparaitre parce que la fiche patient est encore incomplete.
    const idToCode = new Map(patientRows.map((patient) => [patient.id, patient.patient_code]));
    const keptPatientRows = patientRows.filter((patient) => !incompletePatientIds.has(patient.id));
    const excludedPatientCount = patientRows.length - keptPatientRows.length;
    const patients = keptPatientRows.map((patient) => ({
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

    // Les rencontres incompletes sont ecartees APRES le controle de presence stricte : un
    // export peut etre partiel PAR DECISION (exclusions comptees), jamais PAR ACCIDENT
    // (lecture en echec, mutation concurrente) -- ce dernier cas reste un refus.
    let excludedEncounterCount = 0;
    for (const id of [...encMap.keys()]) {
      if (incompleteEncounterIds.has(id)) {
        encMap.delete(id);
        excludedEncounterCount += 1;
      }
    }

    // Une cohorte de rencontres peut contenir une rencontre dont le patient
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

    const encounters = [...encMap.values()]
      // En mode PATIENT la ligne est le patient : les rencontres d'un patient ecarte n'ont
      // pas de ligne d'accueil, et laisser leurs valeurs dans les feuilles annexes
      // produirait des `patient_code` orphelins. En mode RENCONTRE elles restent exportees :
      // le fichier ne porte alors aucune donnee permanente, et ces rencontres, elles, sont
      // completes.
      .filter((encounter) => options.mode !== 'patient' || !incompletePatientIds.has(encounter.patient_id))
      .map((encounter) => ({
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
            'id, template_version_id, field_key, label, description, scope, section, type, is_multiple, unit, allowed_values, allowed_options, missing_reasons, formula, display_order',
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
    // L31 : le dictionnaire doit nommer une section personnalisee, pas seulement la coder.
    // Les sections sont lues PAR VERSION, comme les champs : deux versions peuvent donner
    // deux libelles au meme code, et c'est celui de la version de la fiche qui fait foi.
    const rawSections = await readInChunks<TemplateSectionRow>({
      values: templateVersions,
      resource: 'dictionary_sections',
      limit: EXPORT_LIMITS.dictionarySections,
      keyOf: (row) => row.id,
      fetchPage: async (chunk, from, to) => {
        const result = await admin.from('template_section')
          .select('id, template_version_id, section_key, label, parent_section_id', { count: 'exact' })
          .in('template_version_id', chunk)
          .order('template_version_id', { ascending: true })
          .order('display_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        return { data: result.data as TemplateSectionRow[] | null, error: result.error, count: result.count };
      },
    });
    // L53 : la section est lue AVEC son parent, pour porter les DEUX niveaux dans le contrat.
    // `section_key` est unique par version et le parent vit dans la meme version : une entree
    // par `version + code` suffit, et l'id du parent se retraduit en code par `keyById`.
    const sectionByVersionKey = new Map(
      rawSections.map((s) => [`${s.template_version_id} ${s.section_key}`, s]),
    );
    const keyById = new Map(rawSections.map((s) => [s.id, s.section_key]));
    // Roles observes, toutes versions confondues. Une cle racine ici et feuille la est
    // ambigue : elle apparait dans les DEUX ensembles, et `findProjectionProblem` la refuse.
    const blockRoles = {
      roots: new Set(rawSections.filter((s) => !s.parent_section_id).map((s) => s.section_key)),
      leaves: new Set(rawSections.filter((s) => s.parent_section_id).map((s) => s.section_key)),
    };

    /**
     * Feuille et bloc racine d'une variable, DANS SA VERSION. Une section introuvable est un
     * rattachement ancien non resolu : la variable garde son code de section, n'a pas de bloc,
     * et reste donc exportee dans toutes les projections — le filet de L31 est preserve.
     */
    const levelsOf = (f: TemplateFieldRow) => {
      const own = f.section === null ? undefined : sectionByVersionKey.get(`${f.template_version_id} ${f.section}`);
      if (!own) return { sectionLabel: null, blockKey: null, blockLabel: null };
      const parentKey = own.parent_section_id ? keyById.get(own.parent_section_id) ?? null : null;
      if (!parentKey) return { sectionLabel: own.label, blockKey: own.section_key, blockLabel: own.label };
      const parent = sectionByVersionKey.get(`${f.template_version_id} ${parentKey}`);
      return { sectionLabel: own.label, blockKey: parentKey, blockLabel: parent?.label ?? null };
    };

    const versionedFields: ExportField[] = rawFields.map((f) => {
      const levels = levelsOf(f);
      return {
        fieldKey: f.field_key,
        label: f.label,
        description: f.description,
        scope: f.scope,
        section: f.section,
        sectionLabel: levels.sectionLabel,
        // L53 : bloc RACINE. Egal a `section` sur une base plate, donc la compatibilite
        // descendante est acquise par construction ; nul au tronc commun.
        blockKey: levels.blockKey,
        blockLabel: levels.blockLabel,
        type: f.type,
        isMultiple: Boolean(f.is_multiple),
        unit: f.unit,
        allowedValues: f.allowed_values,
        allowedOptions: f.allowed_options,
        missingReasons: f.missing_reasons,
        // L35 : la formule voyage avec SA version, et c'est `mergeExportFields` qui la
        // rattache a la bonne fiche. Rien n'est lu dans `data` sous cette cle.
        formula: f.formula ?? null,
        displayOrder: f.display_order,
        templateVersionIds: [f.template_version_id],
      };
    });

    // L53 : `allFields` est le dictionnaire COMPLET — il sert aux validations et aux operandes
    // de formule. `fields`, plus bas, est le jeu RESTITUE : colonnes, dictionnaire, Modalites,
    // feuilles multivaluees, limites et garde anti-identite.
    const allFields = mergeExportFields(versionedFields);

    // L46 : deux cles de champ distinctes ne doivent jamais se normaliser vers le meme
    // identifiant analytique, sinon le fichier porterait deux variables indiscernables.
    assertNoAnalyticIdCollisions(allFields);

    // L53 : la projection est refusee AVANT toute generation. Une cle inconnue de toutes les
    // versions, ou qui designe une sous-section dans l'une d'elles, ne peut pas produire un
    // fichier honnete : mieux vaut un refus explicite qu'un fichier silencieusement vide.
    const projection = options.sectionProjection;
    if (projection.mode === 'selected') {
      const problem = findProjectionProblem(projection.blockKeys ?? [], blockRoles);
      if (problem?.kind === 'unknown_block') {
        return json(400, {
          code: 'EXPORT_PROJECTION_UNKNOWN_BLOCK',
          error: 'Projection refusee : bloc inconnu des versions de la cohorte',
          blocks: problem.keys,
        });
      }
      if (problem?.kind === 'not_a_block') {
        return json(400, {
          code: 'EXPORT_PROJECTION_NOT_A_BLOCK',
          error: 'Projection refusee : cette cle designe une sous-section, pas un bloc',
          blocks: problem.keys,
        });
      }
    }

    // L53 : le bloc ne devient une information du fichier que si une projection est demandee ou
    // qu'une sous-section existe. C'est exactement la ou l'ambiguite compte — et donc la seule
    // ou on la refuse : une base historique plate SANS projection garde son contrat d'export,
    // meme si une variable a change de section au fil des versions.
    const blockColumns = projection.mode === 'selected' || hasSubsectionFields(allFields);
    if (blockColumns) {
      // Sur la liste NON FUSIONNEE : c'est la seule ou les versions parlent encore chacune
      // pour elle. `mergeExportFields` retiendrait la premiere section rencontree.
      const ambiguous = findAmbiguousBlockFields(versionedFields);
      if (ambiguous.length > 0) {
        return json(409, {
          code: 'EXPORT_BLOCK_AMBIGUOUS',
          error: 'Export refuse : une variable est rattachee a des blocs differents selon les versions',
          fields: ambiguous,
        });
      }
    }

    // Le point UNIQUE de restitution, juste apres la fusion.
    const fields = projectFields(allFields, projection);

    const multivalueFields = fields.filter((f) => isMultivalueField(f));
    const multivalueDataRows = options.mode === 'patient' ? patients : encounters;
    const { indicatorsByField, omittedFieldKeys } = extractMultivalueCodes(fields, multivalueDataRows);

    // L47 : le profil Analyse exprime chaque modalite par une indicatrice. Au-dela du seuil de
    // cardinalite, des colonnes seraient DROPPEES silencieusement : l'export echoue donc
    // explicitement, jamais de fichier tronque sans le signaler. Le profil `complete` conserve
    // les codes concatenes, exhaustivement, il n'a pas ce seuil a faire respecter ici.
    if (options.profile === 'analysis') {
      const renderedMultiselectKeys = new Set(
        fields
          .filter((f) => f.type === 'multiselect' && (options.mode === 'patient' || f.scope === 'encounter'))
          .map((f) => f.fieldKey),
      );
      const refused = [...omittedFieldKeys].filter((key) => renderedMultiselectKeys.has(key));
      if (refused.length > 0) {
        return json(413, {
          code: 'EXPORT_INDICATOR_CARDINALITY',
          error: `Export Analyse refuse : une variable multiselect depasse ${MAX_INDICATOR_CODES} modalites`,
          limit: MAX_INDICATOR_CODES,
          fields: refused,
        });
      }
    }

    // L53 : les colonnes viennent du jeu PROJETE, les operandes de formule du jeu complet. Une
    // formule projetee reste donc juste meme quand ses operandes vivent hors de la projection,
    // sans que leurs colonnes soient restituees.
    const main = options.mode === 'patient'
      ? buildPatientExport(patients, encounters, fields, options.rule, options.profile, allFields)
      : buildEncounterExport(encounters, fields, options.profile, allFields);
    // L49 : le dictionnaire suit le profil — reduit a l'interpretation en Analyse, detaille en Complet.
    const dict = buildDictionary(fields, {
      indicatorsByField,
      omittedFieldKeys,
      profile: options.profile,
      blockColumns,
    });
    // L46 : la feuille Modalites accompagne l'Export Analyse (XLSX). Le CSV ne tient qu'une
    // feuille : la colonne principale porte deja le code stable et le libelle reste une fois
    // dans Modalites au format classeur.
    const modalities = options.profile === 'analysis' ? buildModalities(fields) : null;

    const multivalueTables: { name: string; table: ExportTable }[] = [];
    for (const f of multivalueFields) {
      // L47 : le profil Analyse exprime un multiselect par ses indicatrices dans `Export` ; il
      // ne porte pas de feuille relationnelle pour ces champs (les terminologies restent intactes).
      if (options.profile === 'analysis' && f.type === 'multiselect') continue;
      const table = buildMultivalueTable(f, patients, encounters);
      const safeTable = neutralizeExportTable(table);
      const sheetName = exportFilenameSegment(f.label, f.fieldKey).slice(0, 31) || f.fieldKey.slice(0, 31);
      multivalueTables.push({ name: sheetName, table: safeTable });
    }

    const dictionaryCells = format === 'xlsx' ? (dict.rows.length + 1) * dict.columns.length : 0;
    const modalitiesCells = format === 'xlsx' && modalities
      ? (modalities.rows.length + 1) * modalities.columns.length
      : 0;
    // L49 : la feuille `Métadonnées` (profil Analyse, classeur) rend le fichier autonome :
    // profil, date, base, cohorte, mode, regle de selection, versions, nombre de lignes,
    // exclusions. Elle quitte le dictionnaire, qui n'en a plus besoin pour etre lisible.
    const generatedAt = deps.nowIso();
    const metadata = options.profile === 'analysis'
      ? buildMetadata({
        profile: options.profile,
        generatedAt,
        baseName: base.name,
        cohortName: cohort.name,
        mode: options.mode,
        selectionRule: options.rule,
        templateVersions,
        rowCount: main.rows.length,
        excludedPatientCount,
        excludedEncounterCount,
        sectionProjection: projection,
      })
      : null;
    const metadataCells = format === 'xlsx' && metadata ? (metadata.rows.length + 1) * metadata.columns.length : 0;
    const multivalueCells = format === 'xlsx'
      ? multivalueTables.reduce((acc, m) => acc + (m.table.rows.length + 1) * m.table.columns.length, 0)
      : 0;
    assertExportShapeWithinLimits(
      main.rows.length,
      main.columns.length,
      format,
      dictionaryCells + modalitiesCells + multivalueCells + metadataCells,
    );
    assertNoIdentity(main.columns);
    for (const m of multivalueTables) assertNoIdentity(m.table.columns);

    let bytes: Uint8Array;
    let contentType: string;
    if (format === 'xlsx') {
      const generationStartedAt = performance.now();
      // L48 : les colonnes date/datetime deviennent des cellules Excel NATIVES (nombre de serie
      // plus format d'affichage). Le CSV, plus haut, garde l'ISO. Les dates invalides restent
      // texte, jamais masquees par un zero.
      const temporalColumns = temporalColumnsOf(fields, options.mode);
      const safeMain = neutralizeExportTable(withExcelDateSerials(main, temporalColumns));
      const safeDict = neutralizeExportTable(dict);
      const safeModalities = modalities ? neutralizeExportTable(modalities) : null;
      const safeMetadata = metadata ? neutralizeExportTable(metadata) : null;
      assertXlsxExportWithinLimits([
        safeMain,
        safeDict,
        ...(safeModalities ? [safeModalities] : []),
        ...(safeMetadata ? [safeMetadata] : []),
        ...multivalueTables.map((m) => m.table),
      ]);
      const wb = XLSX.utils.book_new();
      const mainSheet = XLSX.utils.json_to_sheet(safeMain.rows, { header: safeMain.columns });
      applyExcelDateFormats(mainSheet, safeMain.columns, temporalColumns);
      // L49 : en Analyse, la feuille principale se nomme `Données` (elle est l'objet du
      // classeur) ; en Complet, le nom historique `Export` est conserve.
      const mainSheetName = options.profile === 'analysis' ? 'Données' : 'Export';
      XLSX.utils.book_append_sheet(wb, mainSheet, mainSheetName);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(safeDict.rows, { header: safeDict.columns }),
        'Dictionnaire',
      );
      if (safeModalities) {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(safeModalities.rows, { header: safeModalities.columns }),
          'Modalités',
        );
      }
      if (safeMetadata) {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(safeMetadata.rows, { header: safeMetadata.columns }),
          'Métadonnées',
        );
      }
      for (const m of multivalueTables) {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(m.table.rows, { header: m.table.columns }),
          m.name,
        );
      }
      // cellStyles : les formats de date natifs (cellule `z`) sont ecrits dans le classeur ;
      // sinon SheetJS les jetterait et le nombre de serie s'afficherait sans format lisible.
      bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }));
      assertXlsxGenerationTime(generationStartedAt);
      assertXlsxOutputSize(bytes);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      bytes = new TextEncoder().encode(toCsv(main));
      contentType = 'text/csv;charset=utf-8';
    }

    const fileHash = await sha256Hex(bytes);
    const filename = buildExportFilename(base.name, cohort.name, options.mode, options.profile, generatedAt, format);
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
        base_id: cohort.base_id,
        cohort_name: cohort.name,
        exported_by: who.user.id,
        template_versions: templateVersions,
        format,
        export_options: {
          ...options,
          generated_by: 'edge:generate-export',
          dictionary_included: format === 'xlsx',
          download_filename: filename,
          // Trace des exclusions : un export partiel doit rester explicable apres coup,
          // meme si l'ecran n'en dit rien.
          excluded_records: {
            reason: 'required_fields_missing',
            patients: excludedPatientCount,
            encounters: excludedEncounterCount,
          },
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
