// Export par categorie diagnostique : `create_cohort_snapshot_by_diagnosis`.
//
// Un patient est retenu des que l'un des codes figure dans son diagnostic (portee patient)
// ou dans celui de l'une de ses rencontres ; TOUTES ses rencontres suivent. La variable lue
// est celle de la configuration diagnostique de la version de chaque fiche, quelle que
// soit la forme de sa valeur (liste, liste multiple, terminologie).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let base: string;
let encounterVersion: string;
let patientVersion: string;

const SNAPSHOT = 'select * from public.create_cohort_snapshot_by_diagnosis($1, $2, $3::text[], $4)';
const asUser = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

/** Version dont la variable diagnostic `diag` vit a la portee indiquee. */
async function version(scope: 'patient' | 'encounter', type: 'multiselect' | 'terminology') {
  const template = (await db.admin.query("insert into template(name,owner_user_id,is_global) values('Diag',$1,false) returning id", [alice])).rows[0].id;
  const v = (await db.admin.query("insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
  await db.admin.query(`insert into template_field(template_version_id,field_key,label,scope,section,type,allowed_values,is_multiple,display_order)
    values($1,'diag','Diagnostic',$2,null,$3,$4::jsonb,$5,0), ($1,'diag_autre','Proposition',$2,null,'text',null,false,1)`,
  [v, scope, type, type === 'terminology' ? null : '["TB","HIV","PALU"]', type === 'terminology']);
  let release: string | null = null;
  if (type === 'terminology') {
    release = (await db.admin.query("insert into terminology_release(slug,title,source,version) values($1,'Diag','fictif','1') returning id", [`diag-${v}`])).rows[0].id;
    await db.admin.query("insert into terminology_concept(release_id,code,label,kind) values($1,'TB','Tuberculose','category'),($1,'HIV','VIH','category')", [release]);
  }
  await db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1',
    [v, JSON.stringify([{ scope, diagnosisFieldKey: 'diag', terminologyReleaseId: release, commonOnlyCodes: [] }])]);
  return v as string;
}

async function patient(code: string, data: Record<string, unknown> = {}, v = encounterVersion) {
  return (await db.admin.query(
    "insert into patient(base_id,patient_code,template_version_id,data) values($1,$2,$3,$4) returning id",
    [base, code, v, JSON.stringify(data)])).rows[0].id as string;
}
async function encounter(patientId: string, data: Record<string, unknown>, deleted = false) {
  return (await db.admin.query(
    `insert into encounter(patient_id,template_version_id,encounter_type,encounter_date,data,deleted_at)
     values($1,$2,'consultation','2026-09-01',$3,$4) returning id`,
    [patientId, encounterVersion, JSON.stringify(data), deleted ? new Date().toISOString() : null])).rows[0].id as string;
}

async function members(cohortId: string) {
  const patients = (await db.admin.query(
    'select p.patient_code from cohort_member m join patient p on p.id=m.patient_id where m.cohort_id=$1 order by 1', [cohortId],
  )).rows.map((r) => r.patient_code);
  const encounters = (await db.admin.query(
    'select count(*)::int as n from cohort_encounter_member where cohort_id=$1', [cohortId],
  )).rows[0].n as number;
  return { patients, encounters };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = (await db.admin.query('select id,email from auth.users')).rows;
  alice = users.find((u) => u.email === 'alice@demo.test').id;
  base = (await db.admin.query(
    'select b.id from base b where b.owner_user_id=$1 and b.deleted_at is null order by b.created_at limit 1', [alice],
  )).rows[0].id;
  encounterVersion = await version('encounter', 'multiselect');
  patientVersion = await version('patient', 'terminology');

  // A : TB sur une rencontre sur deux -> retenu avec ses DEUX rencontres.
  const a = await patient('DX-A');
  await encounter(a, { diag: ['TB'] });
  await encounter(a, { diag: ['PALU'] });
  // B : PALU seulement -> ecarte.
  await encounter(await patient('DX-B'), { diag: ['PALU'] });
  // C : aucun diagnostic -> ecarte quand on filtre, garde par l'export « tous les patients ».
  await encounter(await patient('DX-C'), {});
  // D : HIV a la portee PATIENT (terminologie unitaire) et une rencontre sans diagnostic.
  await encounter(await patient('DX-D', { diag: { code: 'HIV', label: 'VIH' } }, patientVersion), {});
  // E : TB uniquement sur une rencontre SUPPRIMEE -> ecarte.
  await encounter(await patient('DX-E'), { diag: ['TB'] }, true);
}, 240_000);
afterAll(async () => { await db?.stop(); });

describe('create_cohort_snapshot_by_diagnosis', () => {
  test('retient les patients portant un code et TOUTES leurs rencontres', async () => {
    const cohort = (await asUser(alice, SNAPSHOT, [base, 'TB', ['TB'], false]))[0];
    expect(await members(cohort.id)).toEqual({ patients: ['DX-A'], encounters: 2 });
    expect(cohort.filter_definition).toEqual({ conditions: [], diagnosisCodes: ['TB'] });
    expect(cohort.cohort_type).toBe('snapshot');
  });

  test('lit la portee patient et chaque forme de valeur', async () => {
    const cohort = (await asUser(alice, SNAPSHOT, [base, 'TB+HIV', ['HIV', 'TB', 'HIV', ' '], false]))[0];
    expect(await members(cohort.id)).toEqual({ patients: ['DX-A', 'DX-D'], encounters: 3 });
    expect(cohort.filter_definition.diagnosisCodes).toEqual(['HIV', 'TB']);
  });

  test('sans code, refus explicite et aucune cohorte creee', async () => {
    const before = (await db.admin.query('select count(*)::int as n from cohort')).rows[0].n;
    await expect(asUser(alice, SNAPSHOT, [base, 'vide', [' '], false])).rejects.toThrow('COHORT_DIAGNOSIS_CODES_REQUIRED');
    expect((await db.admin.query('select count(*)::int as n from cohort')).rows[0].n).toBe(before);
  });

  test('un utilisateur sans acces a la base ne fige rien', async () => {
    const outsider = (await db.admin.query(
      `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
         raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',
         'dx-outsider@demo.test','x',now(),'{"global_role":"medecin"}'::jsonb,'{}'::jsonb,now(),now())
       returning id`)).rows[0].id as string;
    const before = (await db.admin.query('select count(*)::int as n from cohort')).rows[0].n;
    await expect(asUser(outsider, SNAPSHOT, [base, 'intrus', ['TB'], false])).rejects.toThrow();
    expect((await db.admin.query('select count(*)::int as n from cohort')).rows[0].n).toBe(before);
  });

  test('jsonb_has_any_code reconnait chaque forme, rien d autre', async () => {
    const has = async (value: unknown) => (await db.admin.query(
      "select public.jsonb_has_any_code($1::jsonb, array['TB']) as ok", [JSON.stringify(value)])).rows[0].ok;
    expect(await has('TB')).toBe(true);
    expect(await has(['PALU', 'TB'])).toBe(true);
    expect(await has({ code: 'TB', label: 'x' })).toBe(true);
    expect(await has([{ code: 'TB', label: 'x' }])).toBe(true);
    expect(await has('TB.1')).toBe(false);
    expect(await has({ label: 'TB' })).toBe(false);
    expect(await has(3)).toBe(false);
    expect(await has(null)).toBe(false);
  });
});
