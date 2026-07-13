import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  assertLot13Prefix,
  cleanupLot13,
  envValue,
  safeMessage,
  stagingConfig,
} from './lot13-staging-support.mjs';

const prefix = assertLot13Prefix(envValue('LOT13_RUN_PREFIX'));
const stateFile = resolve(envValue('LOT13_STATE_FILE'));
const evidenceDir = resolve(process.env.LOT13_EVIDENCE_DIR || dirname(stateFile));
const config = stagingConfig();
const credentials = {
  doctor: {
    email: envValue('STAGING_MEDECIN_EMAIL'),
    password: envValue('STAGING_MEDECIN_PASSWORD'),
  },
  secondDoctor: {
    email: envValue('STAGING_SECOND_MEDECIN_EMAIL'),
    password: envValue('STAGING_SECOND_MEDECIN_PASSWORD'),
  },
  curator: {
    email: envValue('STAGING_CURATEUR_EMAIL'),
    password: envValue('STAGING_CURATEUR_PASSWORD'),
  },
  admin: {
    email: envValue('STAGING_ADMIN_EMAIL'),
    password: envValue('STAGING_ADMIN_PASSWORD'),
  },
};

mkdirSync(evidenceDir, { recursive: true });

const db = new pg.Client({ connectionString: config.dbUrl });
const service = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false } });
const results = [];
const state = { prefix, generatedAt: new Date().toISOString() };

function client() {
  return createClient(config.url, config.anonKey, { auth: { persistSession: false } });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameId(left, right, label) {
  assert(String(left) === String(right), `${label}: identifiants differents`);
}

async function signIn(account, label) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword(account);
  if (error || !data.user || !data.session) throw new Error(`Connexion ${label} impossible`);
  return { supabase, user: data.user, session: data.session };
}

async function query(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function asUser(userId, sql, params = []) {
  const connection = new pg.Client({ connectionString: config.dbUrl });
  await connection.connect();
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await connection.query('set local role authenticated');
    const response = await connection.query(sql, params);
    await connection.query('commit');
    return response.rows;
  } catch (error) {
    await connection.query('rollback').catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function edge(supabase, name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { status: 200, data };
  const response = error.context;
  let payload = null;
  if (response && typeof response.clone === 'function') {
    try { payload = await response.clone().json(); } catch { /* reponse non JSON */ }
  }
  return { status: Number(response?.status || 0), data: payload, message: error.message };
}

async function expectFailure(action, pattern, label) {
  try {
    await action();
  } catch (error) {
    const message = safeMessage(error);
    if (pattern && !pattern.test(message)) throw new Error(`${label}: erreur inattendue (${message})`, { cause: error });
    return message;
  }
  throw new Error(`${label}: operation acceptee a tort`);
}

async function check(name, action) {
  const started = performance.now();
  try {
    const detail = await action();
    const durationMs = Math.round(performance.now() - started);
    results.push({ name, status: 'passed', durationMs, detail: detail ?? null });
    console.log(`PASS ${name} (${durationMs} ms)`);
    return detail;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const message = safeMessage(error);
    results.push({ name, status: 'failed', durationMs, error: message });
    console.error(`FAIL ${name}: ${message}`);
    throw error;
  }
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function signedBytes(supabase, entity, id) {
  const signed = await edge(supabase, 'signed-read', { entity, id });
  assert(signed.status === 200 && signed.data?.url, `signed-read ${entity} refuse (${signed.status})`);
  const response = await fetch(signed.data.url);
  assert(response.ok, `URL signee ${entity} illisible`);
  return Buffer.from(await response.arrayBuffer());
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function crc32(buffer) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let current = n;
      for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xEDB88320 ^ (current >>> 1) : current >>> 1;
      crc32.table[n] = current >>> 0;
    }
  }
  let current = 0xFFFFFFFF;
  for (const byte of buffer) current = crc32.table[(current ^ byte) & 0xFF] ^ (current >>> 8);
  return (current ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'ascii');
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(entry.data.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, entry.data);
    central.push(Buffer.concat([directory, name]));
    offset += header.length + name.length + entry.data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function eicarDocx() {
  const signature = Buffer.from([
    'X5O!P%@AP[4', '\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*',
  ].join(''));
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from('<document/>') },
    { name: 'eicar.com', data: signature },
  ]);
}

async function createUpload({ supabase, userId, baseId, entity, entityId, bytes, extension, mime, label, operationKey = randomUUID() }) {
  const bucket = entity === 'attachment' ? 'clinical-attachments' : 'raw-documents';
  const path = `${baseId}/${prefix.toLowerCase()}/${operationKey}.${extension}`;
  const fileHash = hash(bytes);
  const operation = firstRow(await rpc(supabase, 'create_upload_operation', {
    p_base_id: baseId,
    p_bucket: bucket,
    p_path: path,
    p_idempotency_key: operationKey,
    p_file_hash: fileHash,
    p_file_size: bytes.length,
    p_mime_type: mime,
    p_ttl_seconds: 1800,
  }));
  assert(operation?.ticket_id, 'Ticket upload absent');
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);
  const metadata = entity === 'attachment'
    ? { patient_id: entityId, encounter_id: null, kind: 'document', label }
    : { submission_id: entityId, label };
  const finalized = await edge(supabase, 'finalize-upload', { ticketId: operation.ticket_id, entity, metadata });
  assert(finalized.status === 200 && finalized.data?.id, `finalize-upload refuse (${finalized.status})`);
  return { id: finalized.data.id, ticketId: operation.ticket_id, operationKey, path, fileHash, metadata, userId, bucket };
}

async function retryUpload(supabase, upload, baseId, bytes, mime) {
  const operation = firstRow(await rpc(supabase, 'create_upload_operation', {
    p_base_id: baseId,
    p_bucket: upload.bucket,
    p_path: upload.path,
    p_idempotency_key: upload.operationKey,
    p_file_hash: hash(bytes),
    p_file_size: bytes.length,
    p_mime_type: mime,
    p_ttl_seconds: 1800,
  }));
  sameId(operation.ticket_id, upload.ticketId, 'retry ticket upload');
  sameId(operation.document_id, upload.id, 'retry document upload');
  const finalized = await edge(supabase, 'finalize-upload', {
    ticketId: upload.ticketId,
    entity: upload.bucket === 'clinical-attachments' ? 'attachment' : 'raw_document',
    metadata: upload.metadata,
  });
  assert(finalized.status === 200, `retry finalize-upload refuse (${finalized.status})`);
  sameId(finalized.data.id, upload.id, 'retry finalize-upload');
}

await db.connect();

try {
  await check('garde staging et nettoyage initial', async () => {
    const removed = await cleanupLot13(prefix);
    const strict = (await query('select public.require_server_inspection() as strict'))[0]?.strict;
    assert(strict === true, 'Mode scanner strict inactif');
    return { removed, stagingRef: 'gmsxrniiclrheehhoakn', strict };
  });

  await check('RLS, policies Storage et buckets attendus actifs', async () => {
    const protectedTables = [
      'base', 'base_access', 'patient_identity', 'patient', 'encounter', 'cohort',
      'export_log', 'raw_submission', 'raw_document', 'curation_task', 'clinical_attachment',
    ];
    const rls = await query(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=any($1::text[])`,
      [protectedTables],
    );
    assert(rls.length === protectedTables.length, 'Inventaire des tables RLS incomplet');
    assert(rls.every((row) => row.relrowsecurity === true), 'RLS inactive sur une table protegee');
    const policyCounts = await query(
      `select tablename,count(*)::int count from pg_policies
        where schemaname='public' and tablename=any($1::text[]) group by tablename`,
      [protectedTables],
    );
    const withPolicies = new Set(policyCounts.filter((row) => row.count > 0).map((row) => row.tablename));
    const directlyReadable = ['base', 'base_access', 'patient', 'encounter', 'cohort', 'raw_document', 'curation_task', 'clinical_attachment'];
    for (const table of directlyReadable) {
      assert(withPolicies.has(table), `Aucune policy RLS trouvee pour ${table}`);
    }
    assert(!withPolicies.has('patient_identity'), 'patient_identity ne doit pas exposer de lecture directe; utiliser la RPC auditee');
    const expectedBuckets = ['clinical-attachments', 'quarantined-uploads', 'raw-documents', 'scientific-exports'];
    const buckets = await query('select id,public from storage.buckets where id=any($1::text[]) order by id', [expectedBuckets]);
    assert(buckets.length === expectedBuckets.length, 'Bucket staging manquant');
    assert(buckets.every((row) => row.public === false), 'Bucket clinique public');
    const storagePolicies = await query(
      `select policyname,cmd,roles::text[] as roles from pg_policies
        where schemaname='storage' and tablename='objects' order by policyname`,
    );
    const expectedStoragePolicies = new Map([
      ['clinical_attachments_insert', 'INSERT'],
      ['raw_documents_insert', 'INSERT'],
    ]);
    assert(
      storagePolicies.length === expectedStoragePolicies.size,
      'Inventaire storage.objects inattendu: seules les deux policies INSERT auditees sont autorisees',
    );
    for (const [policyName, command] of expectedStoragePolicies) {
      const policy = storagePolicies.find((row) => row.policyname === policyName);
      assert(policy?.cmd === command, `Policy Storage attendue absente ou invalide: ${policyName}`);
      assert(
        Array.isArray(policy.roles)
          && policy.roles.length === 1
          && policy.roles[0] === 'authenticated',
        `Role Storage inattendu pour ${policyName}`,
      );
    }
    assert(
      storagePolicies.every((row) => !['SELECT', 'UPDATE', 'DELETE'].includes(row.cmd)),
      'Une policy Storage directe contourne signed-read ou l\'immutabilite des objets',
    );
    return {
      rlsTables: rls.length,
      publicPolicyTables: withPolicies.size,
      patientIdentityDirectPolicies: 0,
      buckets: buckets.map((row) => row.id),
      storagePolicies: storagePolicies.map((row) => row.policyname),
    };
  });

  const doctor = await signIn(credentials.doctor, 'medecin');
  const secondDoctor = await signIn(credentials.secondDoctor, 'second medecin');
  const curatorLogin = await signIn(credentials.curator, 'curateur');
  const adminLogin = await signIn(credentials.admin, 'administrateur');
  state.accounts = {
    doctorId: doctor.user.id,
    secondDoctorId: secondDoctor.user.id,
    curatorId: curatorLogin.user.id,
    adminId: adminLogin.user.id,
  };

  await check('authentification des quatre profils fictifs', async () => {
    const profiles = await query(
      'select id, global_role from public.profiles where id=any($1::uuid[]) order by id',
      [[doctor.user.id, secondDoctor.user.id, curatorLogin.user.id, adminLogin.user.id]],
    );
    const roles = new Map(profiles.map((row) => [row.id, row.global_role]));
    assert(roles.get(doctor.user.id) === 'medecin', 'Compte medecin mal profile');
    assert(roles.get(secondDoctor.user.id) === 'medecin', 'Second medecin mal profile');
    assert(roles.get(curatorLogin.user.id) === 'curateur', 'Compte curateur mal profile');
    assert(roles.get(adminLogin.user.id) === 'system_admin', 'Compte admin mal profile');
    return { roles: [...roles.values()].sort() };
  });

  const fieldsV1 = [
    { fieldKey: 'retired', label: 'Variable retiree', scope: 'patient', section: 'clinique', type: 'text', required: false, allowMissingCodes: false },
    { fieldKey: 'weight', label: 'Poids initial', scope: 'patient', section: 'clinique', type: 'number', required: false, allowMissingCodes: false },
    { fieldKey: 'score_a', label: 'Score historique', scope: 'encounter', section: 'clinique', type: 'number', required: false, allowMissingCodes: false, encounterTypes: [] },
  ];
  const templateOperation = randomUUID();
  const templatePayload = {
    name: `${prefix}-modele-principal`, specialty: 'validation-fictive', fields: fieldsV1,
    withBase: true, baseName: `${prefix}-base`, isGlobal: false,
  };
  const bundle = firstRow(await rpc(doctor.supabase, 'create_template_bundle', {
    p_payload: templatePayload,
    p_operation_key: templateOperation,
  }));
  assert(bundle?.templateId && bundle?.versionId && bundle?.baseId, 'Bundle modele/base incomplet');
  state.templateId = bundle.templateId;
  state.version1Id = bundle.versionId;
  state.baseId = bundle.baseId;

  await check('creation modele/base transactionnelle et retry exact', async () => {
    const replay = firstRow(await rpc(doctor.supabase, 'create_template_bundle', {
      p_payload: templatePayload,
      p_operation_key: templateOperation,
    }));
    sameId(replay.templateId, bundle.templateId, 'retry modele');
    sameId(replay.versionId, bundle.versionId, 'retry version');
    sameId(replay.baseId, bundle.baseId, 'retry base');
    const counts = (await query(
      'select (select count(*)::int from public.template where id=$1) templates, (select count(*)::int from public.base where id=$2) bases',
      [bundle.templateId, bundle.baseId],
    ))[0];
    assert(counts.templates === 1 && counts.bases === 1, 'Retry non idempotent');
    return counts;
  });

  await check('rollback modele sur erreur tardive', async () => {
    const operationKey = randomUUID();
    const failedName = `${prefix}-modele-rollback`;
    await expectFailure(
      () => rpc(doctor.supabase, 'create_template_bundle', {
        p_payload: {
          name: failedName,
          specialty: 'validation-fictive',
          fields: [{ ...fieldsV1[0], fieldKey: 'late_failure', label: 'Echec tardif', allowMissingCodes: 'not-a-boolean' }],
          withBase: true,
          baseName: `${prefix}-base-rollback`,
          isGlobal: false,
        },
        p_operation_key: operationKey,
      }),
      /boolean|syntaxe|input/i,
      'creation modele invalide',
    );
    const residue = (await query(
      `select
         (select count(*)::int from public.template where name=$1) templates,
         (select count(*)::int from public.base where name=$2) bases,
         (select count(*)::int from public.template_operation where operation_key=$3) operations`,
      [failedName, `${prefix}-base-rollback`, operationKey],
    ))[0];
    assert(residue.templates === 0 && residue.bases === 0 && residue.operations === 0, 'Residus apres rollback modele');
    return residue;
  });

  await check('clonage et suppression de modele inutilise', async () => {
    const cloneOperation = randomUUID();
    const clone = firstRow(await rpc(doctor.supabase, 'create_template_bundle', {
      p_payload: {
        name: `${prefix}-modele-clone`, specialty: 'validation-fictive', fields: [],
        sourceVersionId: bundle.versionId, withBase: false, isGlobal: false,
      },
      p_operation_key: cloneOperation,
    }));
    assert(clone?.templateId && clone?.versionId, 'Clone absent');
    const count = Number((await query('select count(*)::int count from public.template_field where template_version_id=$1', [clone.versionId]))[0].count);
    assert(count === fieldsV1.length, 'Champs du clone incomplets');
    await rpc(doctor.supabase, 'delete_template', { p_template_id: clone.templateId });
    assert((await query('select 1 from public.template where id=$1', [clone.templateId])).length === 0, 'Modele clone non supprime');
    await query('delete from public.template_operation where owner_user_id=$1 and operation_key=$2', [doctor.user.id, cloneOperation]);
    return { clonedFields: count };
  });

  const version2 = (await query(
    `insert into public.template_version(template_id,version_number,status,created_by)
     values($1,2,'draft',$2) returning id`,
    [bundle.templateId, doctor.user.id],
  ))[0];
  state.version2Id = version2.id;
  await query(
    `insert into public.template_field(
       template_version_id,field_key,label,scope,section,type,required,allow_missing_codes,display_order,encounter_types
     ) values
       ($1,'weight','Poids renomme','patient','clinique','number',false,false,0,null),
       ($1,'score_a','Score','encounter','clinique','number',false,false,1,array[]::text[]),
       ($1,'score_b','Score','encounter','clinique','number',false,false,2,array[]::text[])`,
    [version2.id],
  );
  await query('update public.base set current_template_version_id=$1 where id=$2', [version2.id, bundle.baseId]);

  await check('suppression refusee pour un modele utilise', async () => {
    await expectFailure(
      () => rpc(doctor.supabase, 'delete_template', { p_template_id: bundle.templateId }),
      /utilis|base|gabarit/i,
      'suppression modele utilise',
    );
  });

  const patientFixtures = [
    { code: `${prefix}-P-YEARS`, version: bundle.versionId, data: { retired: '=SUM(A1:A2)', weight: 70 }, dob: '1982-03-01', date: '2024-03-01', age: 42, unit: 'years', enc: { score_a: 10 } },
    { code: `${prefix}-P-MONTHS`, version: version2.id, data: { weight: 71 }, dob: '2023-08-01', date: '2024-02-01', age: 6, unit: 'months', enc: { score_a: 11, score_b: 12 } },
    { code: `${prefix}-P-DAYS`, version: version2.id, data: { weight: 72 }, dob: '2023-12-20', date: '2024-01-01', age: 12, unit: 'days', enc: { score_a: 13, score_b: 14 } },
  ];
  state.patients = [];
  for (const fixture of patientFixtures) {
    await query(
      `insert into public.patient_identity(base_id,patient_code,full_name,date_of_birth,created_by)
       values($1,$2,$3,$4,$5)`,
      [bundle.baseId, fixture.code, `Personne fictive ${fixture.code}`, fixture.dob, doctor.user.id],
    );
    const patient = (await query(
      `insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by)
       values($1,$2,$3,$4::jsonb,'direct','curated',$5) returning id,row_version`,
      [bundle.baseId, fixture.code, fixture.version, JSON.stringify(fixture.data), doctor.user.id],
    ))[0];
    const encounter = (await query(
      `insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,age_value,age_unit,data,collection_mode,validation_status,created_by)
       values($1,$2,'consultation',$3,$4,$5,$6::jsonb,'direct','curated',$7) returning id,updated_at`,
      [patient.id, fixture.version, fixture.date, fixture.age, fixture.unit, JSON.stringify(fixture.enc), doctor.user.id],
    ))[0];
    state.patients.push({ id: patient.id, code: fixture.code, encounterId: encounter.id, encounterUpdatedAt: encounter.updated_at });
  }
  const cohort = (await query(
    `insert into public.cohort(base_id,name,filter_definition,cohort_type,snapshot_at,validated_only,created_by)
     values($1,$2,'{}'::jsonb,'snapshot',now(),true,$3) returning id`,
    [bundle.baseId, `${prefix}-cohorte`, doctor.user.id],
  ))[0];
  state.cohortId = cohort.id;
  for (const patient of state.patients) {
    await query('insert into public.cohort_member(cohort_id,patient_id) values($1,$2)', [cohort.id, patient.id]);
    await query('insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort.id, patient.encounterId]);
  }

  await check('RLS sans permission, octroi puis revocation immediate', async () => {
    const before = await asUser(secondDoctor.user.id, 'select id from public.base where id=$1', [bundle.baseId]);
    assert(before.length === 0, 'Base visible sans permission');
    await query(
      `insert into public.base_access(
         base_id,user_id,access_role,can_view_identity,can_view_raw_documents,can_edit_structured_data,can_export_data,can_manage_access,granted_by,revoked_at
       ) values($1,$2,'editor',true,false,true,true,false,$3,null)
       on conflict(base_id,user_id) do update set access_role='editor',can_view_identity=true,
         can_edit_structured_data=true,can_export_data=true,revoked_at=null,granted_by=excluded.granted_by`,
      [bundle.baseId, secondDoctor.user.id, doctor.user.id],
    );
    const granted = await asUser(secondDoctor.user.id, 'select id from public.patient where base_id=$1 and deleted_at is null', [bundle.baseId]);
    assert(granted.length === 3, 'Octroi non effectif');
    await query('update public.base_access set revoked_at=now() where base_id=$1 and user_id=$2', [bundle.baseId, secondDoctor.user.id]);
    const revoked = await asUser(secondDoctor.user.id, 'select id from public.patient where base_id=$1 and deleted_at is null', [bundle.baseId]);
    assert(revoked.length === 0, 'Revocation non effectuee immediatement');
    return { before: before.length, granted: granted.length, revoked: revoked.length };
  });

  await check('cloisonnement curateur et administrateur', async () => {
    const curatorIdentity = await asUser(curatorLogin.user.id, 'select id from public.patient_identity where base_id=$1', [bundle.baseId]);
    const adminIdentity = await asUser(adminLogin.user.id, 'select id from public.patient_identity where base_id=$1', [bundle.baseId]);
    assert(curatorIdentity.length === 0, 'Curateur voit une identite');
    assert(adminIdentity.length === 0, 'Administrateur voit une identite clinique');
    return { curatorIdentityRows: 0, adminIdentityRows: 0 };
  });

  await check('export CSV multi-versions, ages et neutralisation formules', async () => {
    const generated = await edge(doctor.supabase, 'generate-export', {
      cohortId: cohort.id,
      format: 'csv',
      options: { mode: 'patient', rule: 'last', scope: 'all' },
    });
    assert(generated.status === 200 && generated.data?.id, `Export CSV refuse (${generated.status})`);
    state.csvExportId = generated.data.id;
    const bytes = await signedBytes(doctor.supabase, 'export', generated.data.id);
    const csv = bytes.toString('utf8');
    const book = XLSX.read(csv, { type: 'string' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
    assert(rows.length === 3, 'CSV ne contient pas trois patients');
    const byCode = new Map(rows.map((row) => [row.patient_code, row]));
    const years = byCode.get(patientFixtures[0].code);
    const months = byCode.get(patientFixtures[1].code);
    const days = byCode.get(patientFixtures[2].code);
    assert(years?.patient__retired === "'=SUM(A1:A2)", 'Formule CSV non neutralisee');
    assert(String(years?.age_value) === '42' && years?.age_unit === 'years', 'Age en annees incorrect');
    assert(String(months?.age_value) === '6' && months?.age_unit === 'months', 'Age en mois incorrect');
    assert(String(days?.age_value) === '12' && days?.age_unit === 'days', 'Age en jours incorrect');
    assert(years?.encounter__score_b === '', 'Variable inexistante dans la version historique non vide');
    assert(!/full_name|date_of_birth|phone|address/i.test(csv.split('\n')[0]), 'Identite presente dans le CSV');
    return { bytes: bytes.length, rows: rows.length };
  });

  await check('export XLSX dictionnaire stable, variable retiree/renommee et libelles identiques', async () => {
    const generated = await edge(doctor.supabase, 'generate-export', {
      cohortId: cohort.id,
      format: 'xlsx',
      options: { mode: 'patient', rule: 'last', scope: 'all' },
    });
    assert(generated.status === 200 && generated.data?.id, `Export XLSX refuse (${generated.status})`);
    state.xlsxExportId = generated.data.id;
    const bytes = await signedBytes(doctor.supabase, 'export', generated.data.id);
    const book = XLSX.read(bytes, { type: 'buffer' });
    assert(book.SheetNames.includes('Export') && book.SheetNames.includes('Dictionnaire'), 'Feuilles XLSX manquantes');
    const rows = XLSX.utils.sheet_to_json(book.Sheets.Export, { defval: '' });
    const dictionary = XLSX.utils.sheet_to_json(book.Sheets.Dictionnaire, { defval: '' });
    const columns = Object.keys(rows[0] || {});
    assert(columns.filter((name) => name === 'patient__weight').length === 1, 'Renommage a cree une seconde colonne');
    assert(columns.includes('patient__retired'), 'Variable retiree absente de l historique');
    const scores = dictionary.filter((row) => row.label === 'Score');
    assert(scores.length === 2 && new Set(scores.map((row) => row.column_id)).size === 2, 'Libelles identiques fusionnes a tort');
    const weight = dictionary.find((row) => row.column_id === 'patient__weight');
    assert(String(weight?.template_versions).includes(bundle.versionId) && String(weight?.template_versions).includes(version2.id), 'Versions du renommage incompletes');
    const formulaRow = rows.find((row) => row.patient_code === patientFixtures[0].code);
    assert(formulaRow?.patient__retired === "'=SUM(A1:A2)", 'Formule XLSX non neutralisee');
    return { bytes: bytes.length, dictionaryRows: dictionary.length };
  });

  await check('export forge refuse et historique telechargeable', async () => {
    const forged = await doctor.supabase.from('export_log').insert({
      cohort_id: cohort.id,
      format: 'csv',
      export_options: {},
      generation_mode: 'client',
    });
    assert(Boolean(forged.error), 'Insertion directe export acceptee');
    const unauthorized = await edge(secondDoctor.supabase, 'generate-export', {
      cohortId: cohort.id,
      format: 'csv',
      options: { mode: 'patient', rule: 'last', scope: 'all' },
    });
    assert(unauthorized.status === 403, `Export non autorise retourne ${unauthorized.status}`);
    const history = await doctor.supabase.from('export_log').select('id,stored_file_path').eq('cohort_id', cohort.id).order('exported_at');
    if (history.error) throw new Error(`Historique export: ${history.error.message}`);
    assert((history.data || []).length >= 2, 'Historique export incomplet');
    const bytes = await signedBytes(doctor.supabase, 'export', state.csvExportId);
    assert(bytes.length > 0, 'Telechargement historique vide');
    return { historyRows: history.data.length };
  });

  await check('import multi-chunks, reponse perdue, refresh et retries concurrents', async () => {
    const batchHash = hash(`${prefix}-import-batch`);
    const rows = [1, 2, 3, 4].map((number) => ({
      patient_code: `${prefix}-IMP-${number}`,
      identity: { full_name: `Import fictif ${number}`, date_of_birth: '2000-01-01' },
      patient_data: { weight: 50 + number },
      encounter: null,
      source_row_number: number,
      normalized_row_hash: hash(`${prefix}-row-${number}`),
    }));
    const batchId = await rpc(doctor.supabase, 'begin_import_batch', {
      p_base_id: bundle.baseId,
      p_file_hash: batchHash,
      p_template_version_id: version2.id,
      p_conflict: 'fill',
      p_status: 'draft',
      p_expected_rows: rows.length,
    });
    state.importBatchId = batchId;
    const chunkArgs = (chunk) => ({
      p_base_id: bundle.baseId, p_rows: chunk, p_dry_run: false, p_status: 'draft', p_conflict: 'fill',
      p_file_hash: null, p_template_version_id: version2.id, p_batch_id: batchId,
    });
    await rpc(doctor.supabase, 'import_records', chunkArgs(rows.slice(0, 2))); // reponse volontairement ignoree
    const replay = await rpc(doctor.supabase, 'import_records', chunkArgs(rows.slice(0, 2)));
    assert(Number(replay.already_processed) === 2 && Number(replay.newly_imported) === 0, 'Retry chunk non reconnu');
    const resumedId = await rpc(doctor.supabase, 'begin_import_batch', {
      p_base_id: bundle.baseId, p_file_hash: batchHash, p_template_version_id: version2.id,
      p_conflict: 'fill', p_status: 'draft', p_expected_rows: rows.length,
    });
    sameId(resumedId, batchId, 'reprise lot import');
    const refreshed = await signIn(credentials.doctor, 'medecin apres refresh');
    const before = await rpc(refreshed.supabase, 'get_import_batch_state', { p_batch_id: batchId });
    assert(Number(before.row_count) === 2, 'Etat serveur perdu apres refresh');
    const duplicateRetries = await Promise.all([
      rpc(doctor.supabase, 'import_records', chunkArgs(rows.slice(0, 2))),
      rpc(refreshed.supabase, 'import_records', chunkArgs(rows.slice(0, 2))),
    ]);
    assert(duplicateRetries.every((report) => Number(report.newly_imported) === 0), 'Double retry a reinsere des lignes');
    await expectFailure(
      () => rpc(doctor.supabase, 'complete_import_batch', { p_batch_id: batchId }),
      /incomplet|ligne/i,
      'cloture prematuree import',
    );
    await Promise.all([
      rpc(doctor.supabase, 'import_records', chunkArgs(rows.slice(2))),
      rpc(refreshed.supabase, 'import_records', chunkArgs(rows.slice(2))),
    ]);
    await rpc(doctor.supabase, 'complete_import_batch', { p_batch_id: batchId });
    const finalState = await rpc(doctor.supabase, 'get_import_batch_state', { p_batch_id: batchId });
    assert(finalState.status === 'completed' && Number(finalState.row_count) === 4, 'Cloture import incorrecte');
    const counts = (await query(
      `select
         (select count(*)::int from public.patient where base_id=$1 and patient_code like $2) patients,
         (select count(*)::int from public.import_batch_row where batch_id=$3) receipts`,
      [bundle.baseId, `${prefix}-IMP-%`, batchId],
    ))[0];
    assert(counts.patients === 4 && counts.receipts === 4, 'Doublons ou recus import incorrects');
    await expectFailure(
      () => rpc(doctor.supabase, 'begin_import_batch', {
        p_base_id: bundle.baseId, p_file_hash: batchHash, p_template_version_id: version2.id,
        p_conflict: 'fill', p_status: 'draft', p_expected_rows: rows.length,
      }),
      /deja|doublon/i,
      'reimport fichier cloture',
    );
    return { batchId, ...counts };
  });

  await check('mise a jour patient nominale et conflit concurrent', async () => {
    const target = state.patients[0];
    const current = (await query('select data,row_version from public.patient where id=$1', [target.id]))[0];
    const nominal = firstRow(await rpc(doctor.supabase, 'update_patient', {
      p_patient_id: target.id,
      p_data: { ...current.data, weight: 73 },
      p_validation_status: 'curated',
      p_reason: `${prefix} mise a jour nominale`,
      p_expected_version: current.row_version,
    }));
    assert(Number(nominal.row_version) === Number(current.row_version) + 1, 'Version patient non incrementee');
    const competitor = await signIn(credentials.doctor, 'medecin concurrent');
    const calls = await Promise.all([
      doctor.supabase.rpc('update_patient', {
        p_patient_id: target.id, p_data: { ...nominal.data, weight: 74 }, p_validation_status: 'curated',
        p_reason: `${prefix} concurrence A`, p_expected_version: nominal.row_version,
      }),
      competitor.supabase.rpc('update_patient', {
        p_patient_id: target.id, p_data: { ...nominal.data, weight: 75 }, p_validation_status: 'curated',
        p_reason: `${prefix} concurrence B`, p_expected_version: nominal.row_version,
      }),
    ]);
    assert(calls.filter((call) => !call.error).length === 1, 'Concurrence patient: nombre de succes different de un');
    assert(calls.filter((call) => /CONFLIT_VERSION/i.test(call.error?.message || '')).length === 1, 'Conflit patient non explicite');
    return { winnerVersion: Number(nominal.row_version) + 1 };
  });

  let curationCreation;
  await check('creation patient/curation atomique, retry et double clic concurrent', async () => {
    const key = `${prefix}-atomic-one`;
    const args = {
      p_base_id: bundle.baseId,
      p_patient_code: `${prefix}-ATOMIC-1`,
      p_full_name: 'Patient fictif atomique',
      p_date_of_birth: '1990-01-01',
      p_phone: null,
      p_address: null,
      p_external_identifier: null,
      p_idempotency_key: key,
    };
    curationCreation = firstRow(await rpc(doctor.supabase, 'create_patient_curation_submission', args));
    const replay = firstRow(await rpc(doctor.supabase, 'create_patient_curation_submission', args));
    sameId(replay.patient_id, curationCreation.patient_id, 'retry patient atomique');
    sameId(replay.task_id, curationCreation.task_id, 'retry tache atomique');
    assert(replay.replayed === true, 'Retry atomique non marque');
    const concurrentArgs = { ...args, p_patient_code: `${prefix}-ATOMIC-2`, p_full_name: 'Patient fictif double clic', p_idempotency_key: `${prefix}-atomic-two` };
    const peer = await signIn(credentials.doctor, 'medecin double clic');
    const concurrent = await Promise.all([
      rpc(doctor.supabase, 'create_patient_curation_submission', concurrentArgs),
      rpc(peer.supabase, 'create_patient_curation_submission', concurrentArgs),
    ]);
    const first = firstRow(concurrent[0]);
    const second = firstRow(concurrent[1]);
    sameId(first.patient_id, second.patient_id, 'double clic patient');
    sameId(first.task_id, second.task_id, 'double clic tache');
    const counts = (await query(
      `select
         (select count(*)::int from public.patient where base_id=$1 and patient_code=$2) patients,
         (select count(*)::int from public.patient_identity where base_id=$1 and patient_code=$2) identities`,
      [bundle.baseId, concurrentArgs.p_patient_code],
    ))[0];
    assert(counts.patients === 1 && counts.identities === 1, 'Double creation patient/identite');
    state.atomicPatientId = curationCreation.patient_id;
    state.atomicSubmissionId = curationCreation.submission_id;
    state.atomicTaskId = curationCreation.task_id;
    return counts;
  });

  await check('rollback atomique sur echec apres insertion identite', async () => {
    const connection = new pg.Client({ connectionString: config.dbUrl });
    await connection.connect();
    const code = `${prefix}-ROLLBACK-ATOMIC`;
    try {
      await connection.query('begin');
      await connection.query(
        `insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by)
         values($1,$2,$3,'{}'::jsonb,'direct','draft',$4)`,
        [bundle.baseId, code, version2.id, doctor.user.id],
      );
      await connection.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: doctor.user.id, role: 'authenticated' })]);
      await connection.query('set local role authenticated');
      await connection.query('savepoint atomic_probe');
      try {
        await connection.query(
          'select * from public.create_patient_curation_submission($1,$2,$3,$4,$5,$6,$7,$8)',
          [bundle.baseId, code, 'Identite fictive rollback', '1991-01-01', null, null, null, `${prefix}-rollback-probe`],
        );
        throw new Error('La sonde de rollback aurait du echouer');
      } catch (error) {
        if (/aurait du/.test(error.message)) throw error;
        await connection.query('rollback to savepoint atomic_probe');
      }
      const identities = await connection.query('select id from public.patient_identity where base_id=$1 and patient_code=$2', [bundle.baseId, code]);
      assert(identities.rows.length === 0, 'Identite orpheline apres rollback');
      await connection.query('rollback');
    } finally {
      await connection.end();
    }
    const residue = (await query(
      `select
         (select count(*)::int from public.patient where base_id=$1 and patient_code=$2) patients,
         (select count(*)::int from public.patient_identity where base_id=$1 and patient_code=$2) identities`,
      [bundle.baseId, code],
    ))[0];
    assert(residue.patients === 0 && residue.identities === 0, 'Residus de la sonde transactionnelle');
    return residue;
  });

  let cleanAttachment;
  await check('fichier pending refuse, verdict accepte, retry idempotent et lecture signee', async () => {
    cleanAttachment = await createUpload({
      supabase: doctor.supabase,
      userId: doctor.user.id,
      baseId: bundle.baseId,
      entity: 'attachment',
      entityId: state.patients[0].id,
      bytes: PDF,
      extension: 'pdf',
      mime: 'application/pdf',
      label: `${prefix} PDF sain`,
    });
    state.cleanAttachmentId = cleanAttachment.id;
    const pendingRead = await edge(doctor.supabase, 'signed-read', { entity: 'attachment', id: cleanAttachment.id });
    assert(pendingRead.status === 409 && !pendingRead.data?.url, 'Fichier pending lisible');
    const inspected = await edge(doctor.supabase, 'inspect-upload', { entity: 'attachment', id: cleanAttachment.id });
    assert(inspected.status === 200 && inspected.data?.status === 'accepted', `Verdict sain inattendu (${inspected.status})`);
    const bytes = await signedBytes(doctor.supabase, 'attachment', cleanAttachment.id);
    assert(bytes.equals(PDF), 'Octets relus differents');
    await retryUpload(doctor.supabase, cleanAttachment, bundle.baseId, PDF, 'application/pdf');
    const count = Number((await query('select count(*)::int count from public.clinical_attachment where upload_ticket_id=$1', [cleanAttachment.ticketId]))[0].count);
    assert(count === 1, 'Retry fichier a cree un doublon');
    return { documentId: cleanAttachment.id, duplicateRows: count };
  });

  let timeoutAttachment;
  await check('timeout avant verdict reste fail-closed puis reprise', async () => {
    timeoutAttachment = await createUpload({
      supabase: doctor.supabase,
      userId: doctor.user.id,
      baseId: bundle.baseId,
      entity: 'attachment',
      entityId: state.patients[1].id,
      bytes: PDF,
      extension: 'pdf',
      mime: 'application/pdf',
      label: `${prefix} timeout avant verdict`,
    });
    const controller = new AbortController();
    controller.abort();
    await fetch(`${config.url}/functions/v1/inspect-upload`, {
      method: 'POST',
      headers: { apikey: config.anonKey, authorization: `Bearer ${doctor.session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'attachment', id: timeoutAttachment.id }),
      signal: controller.signal,
    }).catch(() => {});
    const row = (await query('select inspection_status from public.clinical_attachment where id=$1', [timeoutAttachment.id]))[0];
    assert(row.inspection_status === 'pending', 'Timeout avant envoi a change le verdict');
    const read = await edge(doctor.supabase, 'signed-read', { entity: 'attachment', id: timeoutAttachment.id });
    assert(read.status === 409 && !read.data?.url, 'Timeout pending lisible');
    const resumed = await edge(doctor.supabase, 'inspect-upload', { entity: 'attachment', id: timeoutAttachment.id });
    assert(resumed.status === 200 && resumed.data?.status === 'accepted', 'Reprise inspection echouee');
  });

  await check('reponse perdue apres verdict et retry du meme fichier', async () => {
    const upload = await createUpload({
      supabase: doctor.supabase,
      userId: doctor.user.id,
      baseId: bundle.baseId,
      entity: 'attachment',
      entityId: state.patients[2].id,
      bytes: PDF,
      extension: 'pdf',
      mime: 'application/pdf',
      label: `${prefix} reponse perdue apres verdict`,
    });
    await edge(doctor.supabase, 'inspect-upload', { entity: 'attachment', id: upload.id }); // reponse ignoree
    const durable = (await query('select inspection_status from public.clinical_attachment where id=$1', [upload.id]))[0];
    assert(durable.inspection_status === 'accepted', 'Verdict non durable apres perte de reponse');
    const retry = await edge(doctor.supabase, 'inspect-upload', { entity: 'attachment', id: upload.id });
    assert(retry.status === 200 && retry.data?.status === 'accepted', 'Retry inspection refuse');
    await retryUpload(doctor.supabase, upload, bundle.baseId, PDF, 'application/pdf');
  });

  await check('Storage refuse un upload sans ticket', async () => {
    const path = `${bundle.baseId}/${prefix.toLowerCase()}/${randomUUID()}.pdf`;
    const attempt = await doctor.supabase.storage.from('clinical-attachments').upload(path, PDF, { contentType: 'application/pdf' });
    assert(Boolean(attempt.error), 'Storage a accepte un objet sans ticket');
  });

  let infectedAttachment;
  await check('EICAR isole: verdict ClamAV, quarantaine physique et lecture refusee', async () => {
    const bytes = eicarDocx();
    infectedAttachment = await createUpload({
      supabase: doctor.supabase,
      userId: doctor.user.id,
      baseId: bundle.baseId,
      entity: 'attachment',
      entityId: state.patients[0].id,
      bytes,
      extension: 'docx',
      mime: DOCX_MIME,
      label: `${prefix} EICAR fictif`,
    });
    state.infectedAttachmentId = infectedAttachment.id;
    const inspected = await edge(doctor.supabase, 'inspect-upload', { entity: 'attachment', id: infectedAttachment.id });
    assert(inspected.status === 409 && inspected.data?.status === 'quarantined', `EICAR non mis en quarantaine (${inspected.status})`);
    const row = (await query(
      'select inspection_status,quarantine_bucket,quarantine_path from public.clinical_attachment where id=$1',
      [infectedAttachment.id],
    ))[0];
    assert(row.inspection_status === 'quarantined' && row.quarantine_bucket === 'quarantined-uploads' && row.quarantine_path, 'Pointeur quarantaine absent');
    const originalFolder = infectedAttachment.path.split('/').slice(0, -1).join('/');
    const originalName = infectedAttachment.path.split('/').at(-1);
    const original = await service.storage.from('clinical-attachments').list(originalFolder);
    assert(!(original.data || []).some((item) => item.name === originalName), 'Original infecte encore present');
    const quarantineFolder = row.quarantine_path.split('/').slice(0, -1).join('/');
    const quarantineName = row.quarantine_path.split('/').at(-1);
    const quarantined = await service.storage.from('quarantined-uploads').list(quarantineFolder);
    assert((quarantined.data || []).some((item) => item.name === quarantineName), 'Objet de quarantaine absent');
    const signed = await edge(doctor.supabase, 'signed-read', { entity: 'attachment', id: infectedAttachment.id });
    assert(signed.status === 409 && !signed.data?.url, 'Fichier en quarantaine lisible');
    const userList = await doctor.supabase.storage.from('quarantined-uploads').list(quarantineFolder);
    assert(Boolean(userList.error) || (userList.data || []).length === 0, 'Bucket quarantaine lisible par utilisateur');
    return { quarantineBucket: row.quarantine_bucket };
  });

  let rawUpload;
  await check('document brut accepte et soumission au pool', async () => {
    rawUpload = await createUpload({
      supabase: doctor.supabase,
      userId: doctor.user.id,
      baseId: bundle.baseId,
      entity: 'raw_document',
      entityId: curationCreation.submission_id,
      bytes: PDF,
      extension: 'pdf',
      mime: 'application/pdf',
      label: `${prefix} document brut fictif`,
    });
    state.rawDocumentId = rawUpload.id;
    const inspected = await edge(doctor.supabase, 'inspect-upload', { entity: 'raw_document', id: rawUpload.id });
    assert(inspected.status === 200 && inspected.data?.status === 'accepted', 'Document brut non accepte');
    const submitted = firstRow(await rpc(doctor.supabase, 'submit_curation_request', { p_task_id: curationCreation.task_id }));
    assert(submitted.status === 'open', 'Tache non ouverte');
  });

  await check('reservation concurrente, brouillon unique et finalisation curation', async () => {
    const curatorProfiles = await query("select id from public.profiles where global_role='curateur' order by id");
    assert(curatorProfiles.length >= 2, 'Deux profils curateurs requis pour la concurrence');
    const claims = await Promise.allSettled(curatorProfiles.slice(0, 2).map((profile) =>
      asUser(profile.id, 'select (public.claim_curation_task($1)).*', [curationCreation.task_id])));
    assert(claims.filter((entry) => entry.status === 'fulfilled').length === 1, 'Reservation concurrente: nombre de gagnants different de un');
    const task = (await query('select assigned_to,status from public.curation_task where id=$1', [curationCreation.task_id]))[0];
    assert(task.status === 'in_progress' && task.assigned_to, 'Tache non reservee');
    const identity = await asUser(task.assigned_to, 'select id from public.patient_identity where base_id=$1', [bundle.baseId]);
    assert(identity.length === 0, 'Curateur gagnant voit les identites');
    await Promise.all([
      asUser(task.assigned_to, 'select (public.ensure_curation_draft($1,$2)).id', [curationCreation.task_id, bundle.baseId]),
      asUser(task.assigned_to, 'select (public.ensure_curation_draft($1,$2)).id', [curationCreation.task_id, bundle.baseId]),
    ]);
    const drafts = await query('select id from public.curation_draft where task_id=$1 and superseded_at is null', [curationCreation.task_id]);
    assert(drafts.length === 1, 'Double brouillon actif');
    await query(
      `update public.curation_draft set patient_data=$1::jsonb,encounters='[]'::jsonb where id=$2`,
      [JSON.stringify({ weight: 76 }), drafts[0].id],
    );
    const finalized = await asUser(task.assigned_to, 'select (public.finalize_curation_task($1)).status', [curationCreation.task_id]);
    assert(finalized[0]?.status === 'completed', 'Curation non finalisee');
    await expectFailure(
      () => asUser(task.assigned_to, 'select public.finalize_curation_task($1)', [curationCreation.task_id]),
      /cours|statut|reserve/i,
      'double finalisation curation',
    );
    const patient = (await query('select validation_status,data from public.patient where id=$1', [curationCreation.patient_id]))[0];
    assert(patient.validation_status === 'curated' && Number(patient.data.weight) === 76, 'Donnees curees non publiees');
    return { curatorWinner: task.assigned_to, activeDrafts: drafts.length };
  });

  await check('absence de patients analytiques ou identites orphelins', async () => {
    const orphan = (await query(
      `select
         (select count(*)::int from public.patient p left join public.patient_identity i
            on i.base_id=p.base_id and i.patient_code=p.patient_code and i.deleted_at is null
          where p.base_id=$1 and p.deleted_at is null and i.id is null) patient_without_identity,
         (select count(*)::int from public.patient_identity i left join public.patient p
            on p.base_id=i.base_id and p.patient_code=i.patient_code and p.deleted_at is null
          where i.base_id=$1 and i.deleted_at is null and p.id is null) identity_without_patient`,
      [bundle.baseId],
    ))[0];
    assert(orphan.patient_without_identity === 0 && orphan.identity_without_patient === 0, 'Orphelin detecte');
    return orphan;
  });

  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(resolve(evidenceDir, 'backend-matrix.json'), `${JSON.stringify({
    prefix,
    stagingRef: 'gmsxrniiclrheehhoakn',
    commit: process.env.GITHUB_SHA || process.env.LOT13_COMMIT || null,
    branch: process.env.GITHUB_REF_NAME || null,
    generatedAt: new Date().toISOString(),
    results,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`LOT13_BACKEND_SUMMARY ${results.filter((entry) => entry.status === 'passed').length}/${results.length}`);
} catch (error) {
  writeFileSync(resolve(evidenceDir, 'backend-matrix.json'), `${JSON.stringify({
    prefix,
    stagingRef: 'gmsxrniiclrheehhoakn',
    commit: process.env.GITHUB_SHA || process.env.LOT13_COMMIT || null,
    branch: process.env.GITHUB_REF_NAME || null,
    generatedAt: new Date().toISOString(),
    results,
    interrupted: safeMessage(error),
  }, null, 2)}\n`, { mode: 0o600 });
  throw error;
} finally {
  await db.end();
}
