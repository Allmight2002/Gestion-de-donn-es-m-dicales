import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db';

const migration = '20261002214653_export_source_revision_guard.sql';
const independentWritersMigration = '20261003203222_export_revision_independent_writers.sql';
let db: TestDb;
let writer: Client;
let owner: string;
let base: string;
let otherBase: string;
let cohort: string;
let version: string;
let unusedVersion: string;
let patient: string;
let encounter: string;
let field: string;

async function token(client = db.admin, id = cohort): Promise<string | null> {
  return (await client.query('select public.export_source_revision($1) as token', [id])).rows[0].token;
}

beforeAll(async () => {
  // Test d'upgrade : les donnees fictives existent AVANT la migration. Instance
  // embarquee neuve, port aleatoire et repertoire temporaire, aucune URL externe.
  db = await startTestDb({ seed: true, beforeMigration: migration });
  const legacy = (await db.admin.query("select id, base_id from public.cohort where cohort_type='snapshot' limit 1")).rows[0];
  await db.admin.query(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  expect(await token(db.admin, legacy.id)).toBe(`v1:${legacy.base_id}:0:0:0:0`);
  // Upgrade de compteurs existants : meme jeton, ancienne revision conservee sous writer_id=0.
  await db.admin.query('insert into export_consistency.revision(resource,revision) values($1,7)', [`base:${legacy.base_id}`]);
  const legacyToken = await token(db.admin, legacy.id);
  await db.admin.query(readFileSync(new URL(`../supabase/migrations/${independentWritersMigration}`, import.meta.url), 'utf8'));
  expect(await token(db.admin, legacy.id)).toBe(legacyToken);
  expect((await db.admin.query('select writer_id from export_consistency.revision where resource=$1', [`base:${legacy.base_id}`])).rows[0].writer_id).toBe(0);
  owner = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  const template = (await db.admin.query("insert into public.template(name, owner_user_id) values('Export synthetique', $1) returning id", [owner])).rows[0].id;
  version = (await db.admin.query("insert into public.template_version(template_id, version_number, created_by) values($1,1,$2) returning id", [template, owner])).rows[0].id;
  unusedVersion = (await db.admin.query("insert into public.template_version(template_id, version_number, created_by) values($1,2,$2) returning id", [template, owner])).rows[0].id;
  field = (await db.admin.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'value','Valeur','patient',null,'text') returning id", [version])).rows[0].id;
  await db.admin.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'value','Valeur','patient',null,'text')", [unusedVersion]);
  base = (await db.admin.query("insert into public.base(name,owner_user_id,current_template_version_id) values('Export isole',$1,$2) returning id", [owner, version])).rows[0].id;
  otherBase = (await db.admin.query("insert into public.base(name,owner_user_id,current_template_version_id) values('Autre base isolee',$1,$2) returning id", [owner, version])).rows[0].id;
  const beforeBulk = await token(db.admin, legacy.id);
  await db.admin.query(`insert into public.patient(base_id,patient_code,template_version_id,data,created_by)
    select $1, 'SYN-' || n, $2, '{"value":"avant"}'::jsonb, $3 from generate_series(1,501) n`, [base, version, owner]);
  expect(await token(db.admin, legacy.id)).toBe(beforeBulk);
  // Une seule incrementation pour 501 lignes (base INSERT + patient INSERT).
  expect((await db.admin.query('select sum(revision)::text as revision from export_consistency.revision where resource=$1', [`base:${base}`])).rows[0].revision).toBe('2');
  patient = (await db.admin.query('select id from public.patient where base_id=$1 order by id limit 1', [base])).rows[0].id;
  encounter = (await db.admin.query("insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,created_by) values($1,$2,'consultation',current_date,$3) returning id", [patient, version, owner])).rows[0].id;
  cohort = (await db.admin.query("insert into public.cohort(base_id,name,cohort_type,snapshot_at,validated_only,created_by) values($1,'Export synthetique','snapshot',now(),false,$2) returning id", [base, owner])).rows[0].id;
  await db.admin.query('insert into public.cohort_member(cohort_id,patient_id) select $1,id from public.patient where base_id=$2', [cohort, base]);
  await db.admin.query('insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort, encounter]);
  writer = db.pg.getPgClient();
  await writer.connect();
}, 180_000);

afterAll(async () => {
  await writer?.end();
  await db?.stop();
});

test('deux connexions : UPDATE entre pages, meme compte, donnees melees detectees', async () => {
  const before = await token();
  const page1 = await db.admin.query('select data from public.patient where base_id=$1 order by id limit 500', [base]);
  await writer.query("update public.patient set data = '{\"value\":\"apres\"}'::jsonb where base_id=$1", [base]);
  const page2 = await db.admin.query('select data from public.patient where base_id=$1 order by id offset 500 limit 500', [base]);
  expect(page1.rows[0].data.value).toBe('avant');
  expect(page2.rows[0].data.value).toBe('apres');
  expect((await db.admin.query('select count(*)::int n from public.patient where base_id=$1', [base])).rows[0].n).toBe(501);
  expect(await token()).not.toBe(before);
});

test('rollback : la revision reste inchangee et une transaction ouverte ne pollue pas les lecteurs', async () => {
  const before = await token();
  await writer.query('begin');
  try {
    await writer.query("update public.patient set data = '{\"value\":\"non valide\"}'::jsonb where id=$1", [patient]);
    expect(await token()).toBe(before);
    expect(await token(writer)).not.toBe(before);
  } finally { await writer.query('rollback'); }
  expect(await token()).toBe(before);
});

test('aller-retour de valeur (ABA) : deux commits ne remettent jamais le jeton initial', async () => {
  const before = await token();
  const original = (await db.admin.query('select data from public.patient where id=$1', [patient])).rows[0].data;
  await writer.query("update public.patient set data = '{\"value\":\"intermediaire\"}'::jsonb where id=$1", [patient]);
  await writer.query('update public.patient set data=$2 where id=$1', [patient, original]);
  expect(await token()).not.toBe(before);
});

// Regression du blocage observe en CI : pas de temporisation aleatoire, le timeout
// PostgreSQL borne une attente de verrou a 1 s et les transactions sont toujours fermees.
for (const source of ['patient', 'catalogue'] as const) {
  test(`transactions independantes sans blocage : ${source}, commit et rollback separes`, async () => {
    const second = db.pg.getPgClient();
    await second.connect();
    const before = await token();
    const query = source === 'patient'
      ? 'update public.patient set data=data where id=$1'
      : "update public.template_field set label=label || ' concurrent' where id=$1";
    const firstId = source === 'patient' ? patient : field;
    const secondId = source === 'patient'
      ? (await db.admin.query('select id from public.patient where base_id=$1 and id<>$2 order by id limit 1', [base, patient])).rows[0].id
      : (await db.admin.query('select id from public.template_field where template_version_id=$1 limit 1', [unusedVersion])).rows[0].id;
    try {
      await writer.query('begin');
      await second.query('begin');
      await writer.query("set local lock_timeout='1s'");
      await second.query("set local lock_timeout='1s'");
      await writer.query(query, [firstId]);
      await second.query(query, [secondId]);
      expect(await token()).toBe(before);
      await second.query('commit');
      const afterSecondCommit = await token();
      expect(afterSecondCommit).not.toBe(before);
      await writer.query('rollback');
      expect(await token()).toBe(afterSecondCommit);
    } finally {
      await writer.query('rollback');
      await second.query('rollback');
      await second.end();
    }
  });
}

test('une modification clinique sur une autre base ne refuse pas cet export', async () => {
  const before = await token();
  await writer.query("insert into public.patient(base_id,patient_code,template_version_id,created_by) values($1,'AUTRE',$2,$3)", [otherBase, version, owner]);
  expect(await token()).toBe(before);
});

const mutations: Array<[string, () => Promise<unknown>]> = [
  ['rencontre', () => writer.query('update public.encounter set age_value=42, age_unit=\'years\' where id=$1', [encounter])],
  ['nom de base', () => writer.query("update public.base set name=name || ' bis' where id=$1", [base])],
  ['revision active', () => writer.query('update public.base set current_template_version_id=$2 where id=$1', [base, unusedVersion])],
  ['nom de cohorte', () => writer.query("update public.cohort set name=name || ' bis' where id=$1", [cohort])],
  ['membres patient', async () => {
    await writer.query('delete from public.cohort_member where cohort_id=$1 and patient_id=$2', [cohort, patient]);
    await writer.query('insert into public.cohort_member(cohort_id,patient_id) values($1,$2)', [cohort, patient]);
  }],
  ['membres rencontre', async () => {
    await writer.query('delete from public.cohort_encounter_member where cohort_id=$1 and encounter_id=$2', [cohort, encounter]);
    await writer.query('insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort, encounter]);
  }],
  ['provenance', () => writer.query(`insert into public.record_field_provenance(record_kind,record_id,field_key,origin,captured_by,definition_revision,value_fingerprint)
    values('patient',$1,'value','completion',$2,$3,'sha256:' || repeat('0',64))`, [patient, owner, version])],
  ['acteur de provenance', () => writer.query("update public.profiles set full_name=full_name || ' bis' where id=$1", [owner])],
  ['dictionnaire', () => writer.query("update public.template_field set label=label || ' bis' where id=$1", [field])],
  ['sections', () => writer.query("insert into public.template_section(template_version_id,section_key,label) values($1,'synthetic','Section synthetique')", [unusedVersion])],
  ['rubriques communes', () => writer.query("insert into public.template_common_group(template_version_id,group_key,label) values($1,'synthetic','Rubrique synthetique')", [unusedVersion])],
  ['revision de definition', () => writer.query('update public.template_version set applied_at=now() where id=$1', [unusedVersion])],
  ['regles de completude', () => writer.query(`insert into public.validation_rule(template_version_id,rule,message)
    values($1,'{"if":{"field":"value","operator":"equals","value":"oui"},"then":{"field":"value","operator":"required"}}','synthetique')`, [unusedVersion])],
];
for (const [name, mutate] of mutations) {
  test(`invalidation : ${name}`, async () => {
    const before = await token();
    await mutate();
    expect(await token()).not.toBe(before);
  });
}

test('instructions sans ligne : pas de faux changement', async () => {
  const before = await token();
  await writer.query("update public.template_field set label='rien' where false");
  await writer.query('delete from public.patient where false');
  expect(await token()).toBe(before);
});

test('TRUNCATE invalide meme sans changement de cardinalite', async () => {
  const before = await token();
  await writer.query('truncate public.record_field_provenance');
  expect(await token()).not.toBe(before);
  const empty = await token();
  await writer.query('truncate public.record_field_provenance');
  expect(await token()).not.toBe(empty);
});

test('bigint preserve au-dela de la precision JavaScript et lecture service_role', async () => {
  await db.admin.query('update export_consistency.revision set revision=1 where resource=$1', [`base:${base}`]);
  await db.admin.query(`update export_consistency.revision set revision=9007199254740993 -
    (select coalesce(sum(r.revision),0) from export_consistency.revision r where r.resource=$1 and r.writer_id<>pg_backend_pid())
    where resource=$1 and writer_id=pg_backend_pid()`, [`base:${base}`]);
  expect(await token()).toContain(':9007199254740993:');
  await writer.query('update public.patient set data=data where id=$1', [patient]);
  expect(await token()).toContain(':9007199254740994:');
  // Le shim ne reproduit pas les grants Data API par defaut de Supabase.
  await db.admin.query('grant select on public.base,public.cohort to service_role');
  await writer.query('set role service_role');
  try { expect(await token(writer)).toBe(await token()); }
  finally { await writer.query('reset role'); }
});

test('RPC privee, compteurs non falsifiables et trigger ferme', async () => {
  const acl = (await db.admin.query(`select
    has_function_privilege('anon','public.export_source_revision(uuid)','EXECUTE') anon,
    has_function_privilege('authenticated','public.export_source_revision(uuid)','EXECUTE') authenticated,
    has_function_privilege('service_role','public.export_source_revision(uuid)','EXECUTE') service,
    has_function_privilege('authenticated','export_consistency.track_sources()','EXECUTE') trigger,
    has_table_privilege('service_role','export_consistency.revision','UPDATE') forge`)).rows[0];
  expect(acl).toEqual({ anon: false, authenticated: false, service: true, trigger: false, forge: false });
  await expect(db.asUser(owner, (c) => token(c))).rejects.toThrow(/permission denied/);
  await expect(db.asUser(owner, (c) => c.query('select * from export_consistency.revision'))).rejects.toThrow(/permission denied/);
});

test('suppression en cascade : une rencontre membre disparait et la base avance', async () => {
  const before = await token();
  await writer.query('delete from public.patient where id=$1', [patient]);
  expect(await token()).not.toBe(before);
  expect((await db.admin.query('select count(*)::int n from public.encounter where id=$1', [encounter])).rows[0].n).toBe(0);
});

test('cohorte supprimee : aucun jeton utilisable', async () => {
  await writer.query('delete from public.cohort where id=$1', [cohort]);
  expect(await token()).toBeNull();
});
