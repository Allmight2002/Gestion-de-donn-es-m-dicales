import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
const alice = '22222222-2222-2222-2222-222222222222';
const admin = '11111111-1111-1111-1111-111111111111';
const bob = '33333333-3333-3333-3333-333333333333';
beforeAll(async () => { db = await startTestDb({ seed: true }); }, 240_000);
afterAll(async () => { await db?.stop(); });
const as = (sql: string, args: unknown[] = [], user = alice) => db.asUser(user, c => c.query(sql, args));
const tree = async (version: string) => (await db.admin.query(`select s.id, s.section_key as key,
  p.section_key as parent, s.display_order as ord from public.template_section s
  left join public.template_section p on p.id = s.parent_section_id
  where s.template_version_id = $1 order by s.display_order, s.section_key`, [version])).rows;
async function fixture(hierarchy = true) {
  const payload = { name: 'L54 fictif', sections: hierarchy ? [
    { key: 'bio', label: 'Biologie', parentKey: 'bloc' },
    { key: 'bloc', label: 'Bloc' }, { key: 'autre', label: 'Autre bloc' },
    { key: 'imagerie', label: 'Imagerie', parentKey: 'bloc' },
  ] : [{ key: 'bloc', label: 'Bloc' }, { key: 'autre', label: 'Autre bloc' }],
  fields: [] };
  const result = (await as('select public.create_template_bundle($1, $2) as r', [payload, crypto.randomUUID()])).rows[0].r;
  return { ...result, rows: await tree(result.versionId) } as {
    templateId: string; versionId: string; rows: { id: string; key: string; parent: string | null; ord: number }[];
  };
}

test('parentKey resolves in a second pass and all orders form a canonical preorder', async () => {
  const f = await fixture();
  expect(f.rows.map(r => [r.key, r.parent, r.ord])).toEqual([
    ['bloc', null, 0], ['bio', 'bloc', 1], ['imagerie', 'bloc', 2], ['autre', null, 3],
  ]);
});

test('server rejects cross-version parent, child as parent, self, and moving a populated root', async () => {
  const a = await fixture(); const b = await fixture();
  const id = (key: string) => a.rows.find(r => r.key === key)!.id;
  for (const [child, parent] of [[id('autre'), b.rows[0].id], [id('autre'), id('bio')], [id('autre'), id('autre')], [id('bloc'), id('autre')]]) {
    await expect(as('update public.template_section set parent_section_id=$2 where id=$1', [child, parent])).rejects.toThrow();
  }
  expect(await tree(a.versionId)).toEqual(a.rows);
});

test('deferred FK rejects isolated root deletion at commit, allows whole version and template cascades', async () => {
  const a = await fixture();
  await expect(as('delete from public.template_section where id=$1', [a.rows[0].id])).rejects.toThrow(/template_section_parent_fk/);
  await as('delete from public.template_version where id=$1', [a.versionId]);
  expect(await tree(a.versionId)).toEqual([]);
  const b = await fixture();
  await as(`insert into public.template_field(template_version_id, field_key, label, scope, section, type)
    values ($1, 'direct', 'Direct', 'patient', 'bloc', 'text'), ($1, 'child', 'Child', 'patient', 'bio', 'text')`, [b.versionId]);
  // La RLS interdit tout DELETE direct sur `template` : la suppression passe par delete_template().
  await as('select public.delete_template($1)', [b.templateId]);
  expect(await tree(b.versionId)).toEqual([]);
});

test('common core is canonical; unresolved legacy code survives; mirror names the leaf at both levels', async () => {
  const f = await fixture();
  await as(`insert into public.template_field(template_version_id, field_key, label, scope, section, type)
    values ($1,'common','Common','patient',null,'text'), ($1,'legacy','Legacy','patient','unresolved','text'),
      ($1,'direct','Direct','patient','bloc','text'), ($1,'child','Child','patient','bio','text')`, [f.versionId]);
  const fields = async () => (await db.admin.query('select field_key, section, section_id from public.template_field where template_version_id=$1 order by field_key', [f.versionId])).rows;
  const rows = await fields();
  expect(rows.find(r => r.field_key === 'common')).toMatchObject({ section: null, section_id: null });
  expect(rows.find(r => r.field_key === 'legacy')).toMatchObject({ section: 'unresolved', section_id: null });
  expect(rows.find(r => r.field_key === 'child')?.section_id).toBe(f.rows.find(r => r.key === 'bio')!.id);
  expect(rows.find(r => r.field_key === 'direct')?.section_id).toBe(f.rows[0].id);
  await as("update public.template_field set section_id=null where template_version_id=$1 and field_key='child'", [f.versionId]);
  expect((await fields()).find(r => r.field_key === 'child')).toMatchObject({ section: null, section_id: null });
  await as("update public.template_field set section=null where template_version_id=$1 and field_key='direct'", [f.versionId]);
  expect((await fields()).find(r => r.field_key === 'direct')).toMatchObject({ section: null, section_id: null });
  expect((await fields()).find(r => r.field_key === 'legacy')).toMatchObject({ section: 'unresolved', section_id: null });
});

test('move/reorder are atomic, sibling order is local, old RPC never reparents', async () => {
  const f = await fixture(); const id = (key: string) => f.rows.find(r => r.key === key)!.id;
  await expect(as('select public.reorder_template_section_siblings($1,$2,$3)', [f.versionId, 'bloc', [id('bio'), id('autre')]])).rejects.toThrow();
  await expect(as('select public.move_template_section($1,$2,$3)', [f.versionId, id('bloc'), 'autre'])).rejects.toThrow();
  expect(await tree(f.versionId)).toEqual(f.rows);
  await as('select public.reorder_template_section_siblings($1,$2,$3)', [f.versionId, 'bloc', [id('imagerie'), id('bio')]]);
  expect((await tree(f.versionId)).map(r => r.key)).toEqual(['bloc','imagerie','bio','autre']);
  await as('select public.reorder_template_sections($1,$2)', [f.versionId, [id('bio'),id('autre'),id('imagerie'),id('bloc')]]);
  expect((await tree(f.versionId)).map(r => [r.key,r.parent,r.ord])).toEqual([
    ['autre',null,0],['bloc',null,1],['bio','bloc',2],['imagerie','bloc',3],
  ]);
  await as('select public.move_template_section($1,$2,$3)', [f.versionId,id('bio'),null]);
  expect((await tree(f.versionId)).map(r => [r.key,r.parent,r.ord])).toEqual([
    ['autre',null,0],['bloc',null,1],['imagerie','bloc',2],['bio',null,3],
  ]);
  await expect(as('select public.move_template_section($1,$2,$3)', [f.versionId,id('bio'),'autre'], bob)).rejects.toThrow(/autorisee/);
});

test('opposite concurrent direct reparentings cannot both commit', async () => {
  const f = await fixture(false);
  const c1 = new Client({ connectionString: db.url }); const c2 = new Client({ connectionString: db.url });
  await c1.connect(); await c2.connect();
  try {
    await c1.query('begin');
    await c1.query('update public.template_section set parent_section_id=$2 where id=$1', [f.rows[0].id,f.rows[1].id]);
    const pending = c2.query('update public.template_section set parent_section_id=$2 where id=$1', [f.rows[1].id,f.rows[0].id]);
    // Attach rejection handling before commit; the waiter must validate the winning state.
    const outcome = pending.then(() => 'committed', () => 'rejected');
    await c1.query('commit');
    expect(await outcome).toBe('rejected');
    expect((await tree(f.versionId)).filter(r => r.parent)).toHaveLength(1);
  } finally { await c1.end(); await c2.end(); }
});

test('rule-targeted empty root refuses deletion and reparenting, including rollback of order', async () => {
  const f = await fixture(false);
  // L52 will admit then.section. Simulate a pre-existing rule without weakening production guards.
  await db.admin.query('begin');
  try {
    await db.admin.query('alter table public.validation_rule disable trigger trg_vr_structure');
    await db.admin.query(`insert into public.validation_rule(template_version_id,rule,message,severity)
      values ($1,'{"kind":"visibility","then":{"section":"bloc"}}','Fictif','block')`, [f.versionId]);
    await db.admin.query('alter table public.validation_rule enable trigger trg_vr_structure');
    await db.admin.query('commit');
  } catch(e) { await db.admin.query('rollback'); throw e; }
  await expect(as('delete from public.template_section where id=$1', [f.rows[0].id])).rejects.toThrow(/cible/);
  await expect(as('select public.move_template_section($1,$2,$3)', [f.versionId,f.rows[0].id,'autre'])).rejects.toThrow(/cible/);
  expect(await tree(f.versionId)).toEqual(f.rows);
  await as('delete from public.template where id=$1',[f.templateId]);
});

test('all six copying paths preserve parents within target version and preserve common core', async () => {
  const f = await fixture();
  await as(`insert into public.template_field(template_version_id,field_key,label,scope,section,type)
    values ($1,'child','Child','patient','bio','text'),($1,'common','Common','patient',null,'text')`,[f.versionId]);
  const targets: string[] = [];
  targets.push((await as('select (public.duplicate_template_version($1)).id as id',[f.versionId],admin)).rows[0].id);
  targets.push((await as('select (public.create_next_personal_template_version($1)).id as id',[f.templateId])).rows[0].id);
  const promoted = (await as('select (public.promote_template_to_global($1)).id as id',[f.templateId],admin)).rows[0].id;
  targets.push((await db.admin.query('select id from public.template_version where template_id=$1',[promoted])).rows[0].id);
  targets.push((await as("select (public.create_base_from_model_observation('L54',null,$1,'cross_sectional')).current_template_version_id as id",[f.versionId])).rows[0].id);
  targets.push((await as("select (public.create_base_from_model('L54 legacy',null,$1)).current_template_version_id as id",[f.versionId])).rows[0].id);
  targets.push((await as('select public.create_template_bundle($1,$2) as r',[{name:'L54 copie',sourceVersionId:f.versionId},crypto.randomUUID()])).rows[0].r.versionId);
  for (const v of targets) {
    expect((await tree(v)).map(r=>[r.key,r.parent,r.ord])).toEqual(f.rows.map(r=>[r.key,r.parent,r.ord]));
    expect((await tree(v)).every(r=>!f.rows.some(src=>src.id===r.id))).toBe(true);
    expect((await db.admin.query("select section,section_id from public.template_field where template_version_id=$1 and field_key='common'",[v])).rows[0]).toEqual({section:null,section_id:null});
  }
});

test('snapshot carries both current and historical hierarchical dictionaries', async () => {
  const f = await fixture();
  const b = (await as("insert into public.base(name,owner_user_id,current_template_version_id) values ('L54 snapshot',$1,$2) returning id",[alice,f.versionId])).rows[0].id;
  const snapshot = (await as('select public.download_base_snapshot($1) as s',[b])).rows[0].s;
  expect(snapshot.sections.find((s: {sectionKey: string})=>s.sectionKey==='bio').parentSectionKey).toBe('bloc');
  expect(snapshot.sectionsByVersion[f.versionId]).toEqual(snapshot.sections);
});

test('invalid parentKey rolls back the entire bundle; canonical common-only bundle succeeds', async () => {
  const key=crypto.randomUUID();
  await expect(as('select public.create_template_bundle($1,$2)',[{name:'L54 invalid',sections:[{key:'bad',label:'Bad',parentKey:'missing'}]},key])).rejects.toThrow();
  expect((await db.admin.query('select * from public.template_operation where operation_key=$1',[key])).rows).toHaveLength(0);
  const f=(await as('select public.create_template_bundle($1,$2) as r',[{name:'L54 common',fields:[{fieldKey:'common',label:'Common',scope:'patient',section:null,type:'text'}]},key])).rows[0].r;
  expect(await tree(f.versionId)).toEqual([]);
  expect((await db.admin.query('select section,section_id from public.template_field where template_version_id=$1',[f.versionId])).rows).toEqual([{section:null,section_id:null}]);
});
