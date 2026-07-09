// @ts-nocheck - Fonction Edge Supabase (runtime Deno), hors build Vite.
//
// Generation serveur des exports scientifiques (audit v20 §7.6).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const EXPORTS_BUCKET = 'scientific-exports';
const FORBIDDEN_EXPORT_KEYS = [
  'full_name', 'name', 'patient_name', 'first_name', 'last_name',
  'date_of_birth', 'dob', 'birth_date', 'phone', 'address', 'contact', 'email',
];

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const assertNoIdentity = (columns: string[]) => {
  const bad = columns.find((c) => FORBIDDEN_EXPORT_KEYS.includes(c.toLowerCase()));
  if (bad) throw new Error(`Colonne identifiante interdite a l export: ${bad}`);
};
const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object' && v && 'missing' in v) return String((v as Record<string, unknown>).code ?? '');
  return String(v);
};
const toCsv = (table: { columns: string[]; rows: Record<string, unknown>[] }) => {
  assertNoIdentity(table.columns);
  return [
    table.columns.map(csvCell).join(','),
    ...table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
};
const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

function buildEncounterExport(encounters: unknown[], fields: unknown[]) {
  const encFields = fields.filter((f) => f.scope === 'encounter');
  const columns = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_at_encounter', ...encFields.map((f) => f.label)];
  const rows = encounters.map((e) => {
    const row: Record<string, unknown> = {
      patient_code: e.patientCode,
      encounter_id: e.id,
      encounter_date: e.encounterDate,
      encounter_type: e.encounterType,
      age_at_encounter: formatValue(e.data?.age_at_encounter),
    };
    for (const f of encFields) row[f.label] = formatValue(e.data?.[f.fieldKey]);
    return row;
  });
  return { columns, rows };
}

function buildPatientExport(patients: unknown[], encounters: unknown[], fields: unknown[], rule: 'first' | 'last') {
  const permFields = fields.filter((f) => f.scope === 'patient');
  const encFields = fields.filter((f) => f.scope === 'encounter');
  const columns = ['patient_code', ...permFields.map((f) => f.label), 'age_at_encounter', ...encFields.map((f) => f.label)];
  const byPatient = new Map<string, unknown[]>();
  for (const e of encounters) byPatient.set(e.patientCode, [...(byPatient.get(e.patientCode) ?? []), e]);
  const rows = patients.map((p) => {
    const row: Record<string, unknown> = { patient_code: p.code };
    for (const f of permFields) row[f.label] = formatValue(p.data?.[f.fieldKey]);
    const encs = [...(byPatient.get(p.code) ?? [])].sort((a, b) => String(a.encounterDate).localeCompare(String(b.encounterDate)));
    const enc = encs.length ? (rule === 'first' ? encs[0] : encs[encs.length - 1]) : null;
    row.age_at_encounter = enc ? formatValue(enc.data?.age_at_encounter) : '';
    for (const f of encFields) row[f.label] = enc ? formatValue(enc.data?.[f.fieldKey]) : '';
    return row;
  });
  return { columns, rows };
}

function buildDictionary(fields: unknown[]) {
  const columns = ['field_key', 'label', 'scope', 'section', 'type', 'unit', 'allowed_values'];
  const rows = fields.map((f) => ({
    field_key: f.fieldKey,
    label: f.label,
    scope: f.scope,
    section: f.section,
    type: f.type,
    unit: f.unit ?? '',
    allowed_values: Array.isArray(f.allowedValues) ? f.allowedValues.join('; ') : '',
  }));
  return { columns, rows };
}

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

  const { data: base, error: baseErr } = await admin
    .from('base')
    .select('current_template_version_id')
    .eq('id', cohort.base_id)
    .maybeSingle();
  if (baseErr || !base?.current_template_version_id) return json(409, { error: 'Version de gabarit introuvable' });

  const { data: rawFields, error: fieldsErr } = await admin
    .from('template_field')
    .select('field_key, label, scope, section, type, unit, allowed_values, display_order')
    .eq('template_version_id', base.current_template_version_id)
    .order('display_order', { ascending: true });
  if (fieldsErr) return json(500, { error: fieldsErr.message });
  const fields = (rawFields ?? []).map((f) => ({
    fieldKey: f.field_key,
    label: f.label,
    scope: f.scope,
    section: f.section,
    type: f.type,
    unit: f.unit,
    allowedValues: f.allowed_values,
  }));

  const { data: cm, error: cmErr } = await admin.from('cohort_member').select('patient_id').eq('cohort_id', cohortId);
  if (cmErr) return json(500, { error: cmErr.message });
  const patientIds = (cm ?? []).map((r) => r.patient_id);

  const { data: patientRows, error: patientErr } = patientIds.length
    ? await admin.from('patient').select('id, patient_code, data').in('id', patientIds).is('deleted_at', null).eq('validation_status', 'curated')
    : { data: [], error: null };
  if (patientErr) return json(500, { error: patientErr.message });
  const idToCode = new Map((patientRows ?? []).map((p) => [p.id, p.patient_code]));
  const patients = (patientRows ?? []).map((p) => ({ code: p.patient_code, data: p.data ?? {} }));

  const encMap = new Map<string, unknown>();
  if (options.scope === 'matching' || options.scope === 'both') {
    const { data: cem, error: cemErr } = await admin.from('cohort_encounter_member').select('encounter_id').eq('cohort_id', cohortId);
    if (cemErr) return json(500, { error: cemErr.message });
    const encIds = (cem ?? []).map((r) => r.encounter_id);
    if (encIds.length) {
      const { data: encs, error: encErr } = await admin
        .from('encounter')
        .select('id, patient_id, encounter_date, encounter_type, age_value, data')
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
      .select('id, patient_id, encounter_date, encounter_type, age_value, data')
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
    data: { ...(e.data ?? {}), age_at_encounter: e.age_value ?? null },
  }));

  try {
    const main = options.mode === 'patient'
      ? buildPatientExport(patients, encounters, fields, options.rule)
      : buildEncounterExport(encounters, fields);
    const dict = buildDictionary(fields);
    assertNoIdentity(main.columns);

    let bytes: Uint8Array;
    let contentType: string;
    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main.rows, { header: main.columns }), 'Export');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dict.rows, { header: dict.columns }), 'Dictionnaire');
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
        template_versions: [base.current_template_version_id],
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
