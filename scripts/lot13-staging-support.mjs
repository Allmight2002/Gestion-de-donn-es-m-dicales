import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'gmsxrniiclrheehhoakn';

export function loadEnvFile(path = process.env.LOT13_ENV_FILE) {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

export function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Variable staging manquante: ${names.join(' ou ')}`);
}

export function stagingConfig() {
  loadEnvFile();
  const config = {
    url: envValue('STAGING_SUPABASE_URL', 'SUPABASE_URL'),
    anonKey: envValue('STAGING_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
    serviceRoleKey: envValue('STAGING_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    dbUrl: envValue('STAGING_SUPABASE_DB_URL', 'SUPABASE_DB_URL'),
  };
  if (!config.url.includes(STAGING_REF)) {
    throw new Error('Garde anti-production: la cible Supabase n est pas le staging LOT 13 autorise');
  }
  return config;
}

export function assertLot13Prefix(prefix) {
  if (!/^LOT13-[A-Za-z0-9._-]+$/.test(prefix)) {
    throw new Error('Prefixe LOT13 invalide');
  }
  return prefix;
}

export function safeMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[JWT]')
    .slice(0, 500);
}

export async function cleanupLot13(prefixInput) {
  const prefix = assertLot13Prefix(prefixInput);
  const config = stagingConfig();
  const db = new pg.Client({ connectionString: config.dbUrl });
  const service = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false } });
  await db.connect();
  try {
    const bases = (await db.query(
      'select id from public.base where name like $1',
      [`${prefix}%`],
    )).rows.map((row) => row.id);
    const templates = (await db.query(
      'select id from public.template where name like $1',
      [`${prefix}%`],
    )).rows.map((row) => row.id);

    const objects = bases.length === 0
      ? []
      : (await db.query(
        `select bucket, path from (
           select 'clinical-attachments'::text bucket, a.storage_path path
             from public.clinical_attachment a join public.patient p on p.id=a.patient_id
            where p.base_id = any($1::uuid[])
           union all
           select coalesce(a.quarantine_bucket, 'quarantined-uploads'), a.quarantine_path
             from public.clinical_attachment a join public.patient p on p.id=a.patient_id
            where p.base_id = any($1::uuid[]) and a.quarantine_path is not null
           union all
           select 'raw-documents', d.storage_path from public.raw_document d
            where d.base_id = any($1::uuid[])
           union all
           select coalesce(d.quarantine_bucket, 'quarantined-uploads'), d.quarantine_path
             from public.raw_document d
            where d.base_id = any($1::uuid[]) and d.quarantine_path is not null
           union all
           select 'scientific-exports', e.stored_file_path
             from public.export_log e join public.cohort c on c.id=e.cohort_id
            where c.base_id = any($1::uuid[]) and e.stored_file_path is not null
           union all
           select t.bucket, t.path from public.upload_ticket t
            where t.base_id = any($1::uuid[])
         ) paths where path is not null`,
        [bases],
      )).rows;

    const grouped = new Map();
    for (const { bucket, path } of objects) {
      if (!bucket || !path) continue;
      const paths = grouped.get(bucket) ?? new Set();
      paths.add(path);
      grouped.set(bucket, paths);
    }
    let removedObjects = 0;
    for (const [bucket, values] of grouped) {
      const paths = [...values];
      for (let offset = 0; offset < paths.length; offset += 100) {
        const slice = paths.slice(offset, offset + 100);
        const { error } = await service.storage.from(bucket).remove(slice);
        if (error && !/not found/i.test(error.message)) throw error;
        removedObjects += slice.length;
      }
    }

    await db.query('begin');
    try {
      if (bases.length) {
        await db.query(
          `delete from public.patient_curation_idempotency i
            using public.patient p
            where i.patient_id=p.id and p.base_id=any($1::uuid[])`,
          [bases],
        );
        await db.query('delete from public.base where id=any($1::uuid[])', [bases]);
      }
      if (templates.length) {
        await db.query(
          `delete from public.template_operation
            where result->>'templateId'=any($1::text[])`,
          [templates],
        );
        await db.query('delete from public.template where id=any($1::uuid[])', [templates]);
      }
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    return { bases: bases.length, templates: templates.length, storageObjects: removedObjects };
  } finally {
    await db.end();
  }
}
