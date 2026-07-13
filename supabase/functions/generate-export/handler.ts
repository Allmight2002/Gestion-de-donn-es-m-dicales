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
const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

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
    .select('id, base_id, cohort_type')
    .eq('id', cohortId)
    .maybeSingle();
  if (cohortErr || !cohort) return json(404, { error: 'Cohorte introuvable' });
  if (cohort.cohort_type !== 'snapshot') return json(409, { error: 'Seule une cohorte figee est exportable' });

  const { data: canExport, error: canExportErr } = await asUser.rpc('can_export_data', { p_base: cohort.base_id });
  if (canExportErr || canExport !== true) return json(403, { error: 'Acces export refuse' });

  const { data: cm, error: cmErr } = await admin.from('cohort_member').select('patient_id').eq('cohort_id', cohortId);
  if (cmErr) return json(500, { error: 'Lecture des membres impossible' });
  const patientIds = (cm ?? []).map((r) => r.patient_id);

  const { data: patientRows, error: patientErr } = patientIds.length
    ? await admin.from('patient').select('id, patient_code, template_version_id, data')
      .in('id', patientIds)
      .eq('base_id', cohort.base_id)
      .is('deleted_at', null)
      .eq('validation_status', 'curated').order('patient_code')
    : { data: [], error: null };
  if (patientErr) return json(500, { error: 'Lecture des patients impossible' });
  const expectedPatientIds = new Set(patientIds);
  const foundPatientIds = new Set((patientRows ?? []).map((p) => p.id));
  if (
    foundPatientIds.size !== expectedPatientIds.size || [...expectedPatientIds].some((id) => !foundPatientIds.has(id))
  ) {
    console.error('generate-export cohort patient scope mismatch');
    return json(409, { error: 'Cohorte incoherente : export refuse' });
  }
  const idToCode = new Map((patientRows ?? []).map((p) => [p.id, p.patient_code]));
  const patients = (patientRows ?? []).map((p) => ({
    code: p.patient_code,
    templateVersionId: p.template_version_id,
    data: p.data ?? {},
  }));

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
  const encMap = new Map<string, EncounterRow>();
  if (options.scope === 'matching' || options.scope === 'both') {
    const { data: cem, error: cemErr } = await admin.from('cohort_encounter_member').select('encounter_id').eq(
      'cohort_id',
      cohortId,
    );
    if (cemErr) return json(500, { error: 'Lecture des rencontres impossible' });
    const encIds = (cem ?? []).map((r) => r.encounter_id);
    if (encIds.length) {
      const { data: encs, error: encErr } = await admin
        .from('encounter')
        .select(
          'id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data, patient!inner(base_id)',
        )
        .in('id', encIds)
        .eq('patient.base_id', cohort.base_id)
        .is('deleted_at', null)
        .eq('validation_status', 'curated');
      if (encErr) return json(500, { error: 'Lecture des rencontres impossible' });
      for (const e of encs ?? []) encMap.set(e.id, e as EncounterRow);
      const expectedEncounterIds = new Set(encIds);
      if (encMap.size !== expectedEncounterIds.size || [...expectedEncounterIds].some((id) => !encMap.has(id))) {
        console.error('generate-export cohort encounter scope mismatch');
        return json(409, { error: 'Cohorte incoherente : export refuse' });
      }
    }
  }
  if ((options.scope === 'all' || options.scope === 'both') && patientIds.length) {
    const { data: encs, error: encErr } = await admin
      .from('encounter')
      .select(
        'id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data, patient!inner(base_id)',
      )
      .in('patient_id', patientIds)
      .eq('patient.base_id', cohort.base_id)
      .is('deleted_at', null)
      .eq('validation_status', 'curated');
    if (encErr) return json(500, { error: 'Lecture des rencontres impossible' });
    for (const e of encs ?? []) encMap.set(e.id, e as EncounterRow);
  }

  // Une cohorte de rencontres peut contenir une rencontre curated dont le
  // patient draft n'appartient pas a cohort_member. Charge uniquement son code,
  // en conservant le filtre de base et l'exhaustivite fail-closed.
  const missingParentIds = [
    ...new Set(
      [...encMap.values()].map((e) => e.patient_id).filter((id) => !idToCode.has(id)),
    ),
  ];
  if (missingParentIds.length) {
    const { data: parents, error: parentsErr } = await admin.from('patient')
      .select('id, patient_code').in('id', missingParentIds)
      .eq('base_id', cohort.base_id).is('deleted_at', null);
    if (parentsErr) return json(500, { error: 'Lecture des patients de rencontres impossible' });
    for (const parent of parents ?? []) idToCode.set(parent.id, parent.patient_code);
    if (missingParentIds.some((id) => !idToCode.has(id))) {
      console.error('generate-export encounter parent scope mismatch');
      return json(409, { error: 'Cohorte incoherente : export refuse' });
    }
  }
  const inconsistentEncounter = [...encMap.values()].some((e) => !idToCode.has(e.patient_id));
  if (inconsistentEncounter) {
    console.error('generate-export encounter patient mismatch');
    return json(409, { error: 'Cohorte incoherente : export refuse' });
  }
  const encounters = [...encMap.values()].map((e) => ({
    id: e.id,
    patientCode: idToCode.get(e.patient_id) ?? '',
    encounterDate: e.encounter_date,
    encounterType: e.encounter_type,
    templateVersionId: e.template_version_id,
    ageValue: e.age_value,
    ageUnit: e.age_unit,
    data: e.data ?? {},
  }));

  const templateVersions = referencedTemplateVersions(patients, encounters);
  if (!templateVersions.length) return json(409, { error: 'Aucune version de gabarit referencee' });
  const { data: rawFields, error: fieldsErr } = await admin.from('template_field')
    .select('template_version_id, field_key, label, scope, section, type, unit, allowed_values, display_order')
    .in('template_version_id', templateVersions)
    .order('scope').order('field_key').order('display_order').order('template_version_id');
  if (fieldsErr) return json(500, { error: 'Lecture du dictionnaire impossible' });
  const fields = mergeExportFields(
    (rawFields ?? []).map((f) => ({
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

  try {
    const main = options.mode === 'patient'
      ? buildPatientExport(patients, encounters, fields, options.rule)
      : buildEncounterExport(encounters, fields);
    const dict = buildDictionary(fields);
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
        },
        patient_count: patients.length,
        encounter_count: encounters.length,
        stored_file_path: path,
        file_hash: fileHash,
        generation_mode: 'server',
        generated_by_function: 'generate-export',
        server_generated_at: deps.nowIso(),
      })
      .select('id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode')
      .single();
    if (insertErr) {
      await admin.storage.from(EXPORTS_BUCKET).remove([path]);
      return json(500, { error: 'Journalisation de l export impossible' });
    }

    return json(200, inserted);
  } catch (e) {
    console.error('generate-export failed', e instanceof Error ? e.name : 'unknown');
    return json(500, { error: 'Generation de l export impossible' });
  }
}
