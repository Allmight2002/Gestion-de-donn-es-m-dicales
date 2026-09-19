// L66 §14.1.4: compare the actual pre-migration schema with its populated upgrade.
// This harness always starts a fresh embedded PostgreSQL on loopback, never a cloud URL.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestDb, type TestDb } from './harness/db.js';

const migrationDir = new URL('../supabase/migrations/', import.meta.url);
let db: TestDb;
let base: string;
let owner: string;
let outsider: string;
const versions: string[] = [];
let before: Awaited<ReturnType<typeof observe>>;
let after: Awaited<ReturnType<typeof observe>>;

async function observe() {
  const missing: unknown[] = [];
  for (const version of versions) {
    for (const scope of ['patient', 'encounter']) {
      for (const encounterType of [null, 'consultation', 'hospitalisation', 'suivi', 'autre']) {
        for (const data of [null, {}, { common: null }, { common: '' }, { common: { __missing__: 'refus' } },
          { common: 'present', empty_types: 'present', surgery: 'present', driver: 'show' },
          { driver: 'hide' }, { driver: 'show' }]) {
          missing.push((await db.admin.query(
            'select * from public.missing_required_fields($1,$2,$3::jsonb,$4)',
            [version, scope, JSON.stringify(data), encounterType],
          )).rows);
        }
      }
    }
  }
  const stats: Record<string, unknown[]> = {};
  for (const actor of [owner, outsider]) {
    for (const mode of ['historical', 'current', 'both']) {
      stats[`${actor}:${mode}`] = await db.asUser(actor, async c => (await c.query(
        'select public.base_completeness_stats($1,$2) as result', [base, mode],
      )).rows);
    }
  }
  const patients = (await db.admin.query(
    'select to_jsonb(p) as row from public.patient p where base_id=$1 order by id', [base],
  )).rows;
  const encounters = (await db.admin.query(
    `select to_jsonb(e) - 'group_section_key' as row from public.encounter e
     join public.patient p on p.id=e.patient_id where p.base_id=$1 order by e.id`, [base],
  )).rows;
  return { missing, stats, patients, encounters };
}

beforeAll(async () => {
  const migrations = readdirSync(migrationDir).filter(name => /_repeatable_groups\.sql$/.test(name));
  expect(migrations).toHaveLength(1);
  db = await startTestDb({ seed: true, beforeMigration: migrations[0] });
  expect((await db.admin.query(
    "select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='encounter' and column_name='group_section_key'",
  )).rows[0].n).toBe(0);
  owner = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  outsider = (await db.admin.query("select id from auth.users where email='bob@demo.test'")).rows[0].id;
  const template = (await db.admin.query(
    "insert into public.template(name,owner_user_id,is_global) values('L66 regression fictive',$1,false) returning id", [owner],
  )).rows[0].id;
  for (const number of [1, 2]) {
    const version = (await db.admin.query(
      "insert into public.template_version(template_id,version_number,status,created_by) values($1,$2,'draft',$3) returning id",
      [template, number, owner],
    )).rows[0].id;
    versions.push(version);
    await db.admin.query(
      "insert into public.template_section(template_version_id,section_key,label,display_order) values($1,'ordinary','Ordinaire',0)", [version],
    );
    await db.admin.query(
      `insert into public.template_field(template_version_id,field_key,label,scope,section,type,required,display_order,encounter_types)
       values ($1,'participant','Participant','patient',null,'text',true,0,null),
       ($1,'common','Common','encounter','ordinary','text',true,1,null),
       ($1,'empty_types','Empty types','encounter','ordinary','text',true,2,'{}'),
       ($1,'surgery','Surgery','encounter','ordinary','text',true,3,'{suivi}'),
       ($1,'driver','Driver','encounter','ordinary','text',false,4,null),
       ($1,'conditional','Conditional','encounter','ordinary','text',true,5,null),
       ($1,'start_date','Start date','encounter','ordinary','date',false,6,null),
       ($1,'end_date','End date','encounter','ordinary','date',false,7,null)`, [version],
    );
    await db.admin.query(
      `insert into public.template_field(template_version_id,field_key,label,scope,section,type,required,display_order,formula)
       values($1,'duration','Duration','encounter','ordinary','integer',false,8,'end_date - start_date')`, [version],
    );
    await db.admin.query(
      `insert into public.validation_rule(template_version_id,rule,message,severity)
       values($1,$2,'Condition fictive','block')`,
      [version, JSON.stringify({ if: { field: 'driver', operator: 'equals', value: 'show' },
        then: { field: 'conditional', operator: 'visible' } })],
    );
  }
  base = (await db.admin.query(
    "insert into public.base(name,owner_user_id,current_template_version_id) values('L66 regression fictive',$1,$2) returning id", [owner, versions[1]],
  )).rows[0].id;
  for (const [v, version] of versions.entries()) {
    for (let i = 0; i < 4; i++) {
      const patient = (await db.admin.query(
        `insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by,deleted_at)
         values($1,$2,$3,$4,'direct','draft',$5,$6) returning id`,
        [base, `L66-${v}-${i}`, version, JSON.stringify(i === 1 ? { participant: 'fictif' } : {}), owner,
          i === 3 ? '2026-01-01' : null],
      )).rows[0].id;
      for (const [j, type] of ['consultation', 'hospitalisation', 'suivi', 'autre'].entries()) {
        await db.admin.query(
          `insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by,deleted_at)
           values($1,$2,$3,'2026-01-01',$4,'draft',$5,$6)`,
          [patient, version, type, JSON.stringify([
            {}, { common: 'fictif', empty_types: '' },
            { common: { __missing__: 'refus' }, surgery: 'fictif' }, { common: null, driver: 'show' },
          ][i]), owner, j === 3 && i === 2 ? '2026-01-02' : null],
        );
      }
    }
  }
  before = await observe();
  await db.admin.query(readFileSync(fileURLToPath(new URL(migrations[0], migrationDir)), 'utf8'));
  after = await observe();
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('L66 — populated upgrade without repeatable blocks', () => {
  test('160 required-field verdicts are exactly identical, including visibility and legacy null type', () => {
    expect(before.missing).toHaveLength(160);
    expect(before.missing.some(rows => Array.isArray(rows) && rows.length > 0)).toBe(true);
    expect(after.missing).toEqual(before.missing);
  });

  test('historical/current/both JSON results including order and RLS are exactly identical', () => {
    expect(before.stats[`${owner}:both`][0]).not.toEqual({ result: [] });
    expect(before.stats[`${outsider}:both`]).toEqual([{ result: [] }]);
    expect(after.stats).toEqual(before.stats);
  });

  test('migration preserves every pre-existing patient and encounter value and timestamp', async () => {
    expect(before.patients).toHaveLength(8);
    expect(before.encounters).toHaveLength(32);
    expect(after.patients).toEqual(before.patients);
    expect(after.encounters).toEqual(before.encounters);
    expect((await db.admin.query('select count(*)::int as n from public.template_section where is_repeatable')).rows[0].n).toBe(0);
    expect((await db.admin.query('select count(*)::int as n from public.encounter where group_section_key is not null')).rows[0].n).toBe(0);
  });
});
