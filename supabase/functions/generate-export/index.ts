// @ts-nocheck - Fonction Edge Supabase (runtime Deno), hors build Vite.
//
// Generation serveur des exports scientifiques (audit v20 §7.6).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';
import { assertNoIdentity, buildDictionary, buildEncounterExport, buildPatientExport, mergeExportFields, neutralizeExportTable, referencedTemplateVersions, toCsv } from './exportContract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const EXPORTS_BUCKET = 'scientific-exports';
const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  const URL = Deno.env.get('SUPABASE_URL')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  const payload = await req.json().catch(() => null);
  const cohortId = payload?.cohortId;
  const format = payload?.format === 'xlsx' ? 'xlsx' : 'csv';
  const options = {
    mode: payload?.options?.mode === 'patient' ? 'patient' : 'encounter',
    rule: payload?.options?.rule === 'first' ? 'first' : 'last',
    scope: ['matching', 'all', 'both'].includes(payload?.options?.scope) ? payload.options.scope : 'matching',
  };
  if (!cohortId) return json(400, { error: 'cohortId requis' });

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
  if (cmErr) return json(500, { error: cmErr.message });
  const patientIds = (cm ?? []).map((r) => r.patient_id);

  const { data: patientRows, error: patientErr } = patientIds.length
    ? await admin.from('patient').select('id, patient_code, template_version_id, data').in('id', patientIds).is('deleted_at', null).eq('validation_status', 'curated').order('patient_code')
    : { data: [], error: null };
  if (patientErr) return json(500, { error: patientErr.message });
  const idToCode = new Map((patientRows ?? []).map((p) => [p.id, p.patient_code]));
  const patients = (patientRows ?? []).map((p) => ({ code: p.patient_code, templateVersionId: p.template_version_id, data: p.data ?? {} }));

  const encMap = new Map<string, unknown>();
  if (options.scope === 'matching' || options.scope === 'both') {
    const { data: cem, error: cemErr } = await admin.from('cohort_encounter_member').select('encounter_id').eq('cohort_id', cohortId);
    if (cemErr) return json(500, { error: cemErr.message });
    const encIds = (cem ?? []).map((r) => r.encounter_id);
    if (encIds.length) {
      const { data: encs, error: encErr } = await admin
        .from('encounter')
        .select('id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data')
        .in('id', encIds)
        .is('deleted_at', null)
        .eq('validation_status', 'curated');
      if (encErr) return json(500, { error: encErr.message });
      for (const e of encs ?? []) encMap.set(e.id, e);
    }
  }
  if ((options.scope === 'all' || options.scope === 'both') && patientIds.length) {
    const { data: encs, error: encErr } = await admin
      .from('encounter')
      .select('id, patient_id, template_version_id, encounter_date, encounter_type, age_value, age_unit, data')
      .in('patient_id', patientIds)
      .is('deleted_at', null)
      .eq('validation_status', 'curated');
    if (encErr) return json(500, { error: encErr.message });
    for (const e of encs ?? []) encMap.set(e.id, e);
  }

  const missingPids = [...new Set([...encMap.values()].map((e) => e.patient_id).filter((pid) => !idToCode.has(pid)))];
  if (missingPids.length) {
    const { data: extra, error: extraErr } = await admin.from('patient').select('id, patient_code').in('id', missingPids).is('deleted_at', null);
    if (extraErr) return json(500, { error: extraErr.message });
    for (const p of extra ?? []) idToCode.set(p.id, p.patient_code);
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
  if (fieldsErr) return json(500, { error: fieldsErr.message });
  const fields = mergeExportFields((rawFields ?? []).map((f) => ({ fieldKey: f.field_key, label: f.label, scope: f.scope, section: f.section, type: f.type, unit: f.unit, allowedValues: f.allowed_values, displayOrder: f.display_order, templateVersionIds: [f.template_version_id] })));

  try {
    const main = options.mode === 'patient'
      ? buildPatientExport(patients, encounters, fields, options.rule)
      : buildEncounterExport(encounters, fields);
    const dict = buildDictionary(fields);
    assertNoIdentity(main.columns);

    let bytes: Uint8Array;
    let contentType: string;
    if (format === 'xlsx') {
      const safeMain = neutralizeExportTable(main);
      const safeDict = neutralizeExportTable(dict);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeMain.rows, { header: safeMain.columns }), 'Export');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeDict.rows, { header: safeDict.columns }), 'Dictionnaire');
      bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      bytes = new TextEncoder().encode(toCsv(main));
      contentType = 'text/csv;charset=utf-8';
    }

    const fileHash = await sha256Hex(bytes);
    const path = `${cohort.base_id}/${cohortId}/${Date.now()}-${crypto.randomUUID()}.${format}`;
    const { error: uploadErr } = await admin.storage.from(EXPORTS_BUCKET).upload(path, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert: false,
    });
    if (uploadErr) return json(500, { error: uploadErr.message });

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
        server_generated_at: new Date().toISOString(),
      })
      .select('id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path, generation_mode')
      .single();
    if (insertErr) {
      await admin.storage.from(EXPORTS_BUCKET).remove([path]);
      return json(500, { error: insertErr.message });
    }

    return json(200, inserted);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
