import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';
import { containsAny, hiddenFieldKeys, evaluateRules } from '../src/domain/validation';
import { validateRule } from '../src/domain/templateRules';
import { containsAnyCases, invalidContainsAnyConfigs } from './fixtures/containsAny';

let db: TestDb;
let version: string;
let alice: string;
let template: string;
let release: string;
let base: string;
let patient: string;
const rule = (field = 'driver', value: unknown = ['A'], extra = {}) => ({
  if: { field, operator: 'contains_any', value, ...extra }, then: { field: 'target', operator: 'visible' },
});
const addRule = (r: unknown, v = version) => db.admin.query(
  'insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2,\'L51\',\'block\') returning id',
  [v, JSON.stringify(r)],
);
async function newVersion(number: number) {
  const v = (await db.admin.query("insert into public.template_version(template_id,version_number,status,created_by) values($1,$2,'draft',$3) returning id", [template, number, alice])).rows[0].id;
  for (const [i, [key, type, scope]] of [
    ['driver', 'multiselect', 'encounter'], ['single', 'select', 'encounter'],
    ['diagnosis', 'terminology', 'encounter'], ['target', 'text', 'encounter'],
    ['pdriver', 'select', 'patient'], ['ptarget', 'text', 'patient'],
  ].entries()) {
    await db.admin.query(`insert into public.template_field(template_version_id,field_key,label,scope,section,type,allowed_values,display_order)
      values($1,$2,$2,$3,'clinique',$4,$5,$6)`, [v, key, scope, type, ['select', 'multiselect'].includes(type) ? '["A","B"]' : null, i]);
  }
  return v as string;
}
beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  template = (await db.admin.query("insert into public.template(name,owner_user_id,is_global) values('L51',$1,false) returning id", [alice])).rows[0].id;
  version = await newVersion(1);
  release = (await db.admin.query("insert into public.terminology_release(slug,title,source,version) values('l51','L51','fiction','1') returning id")).rows[0].id;
  await db.admin.query(`insert into public.terminology_concept(release_id,code,label,kind,is_selectable)
    values($1,'A','Alpha','category',true),($1,'GROUP','Groupe','block',false)`, [release]);
  await addRule(rule());
  await addRule({ if: { field: 'pdriver', operator: 'contains_any', value: ['A'] }, then: { field: 'ptarget', operator: 'visible' } });
  base = (await db.admin.query("insert into public.base(name,owner_user_id,current_template_version_id) values('L51',$1,$2) returning id", [alice, version])).rows[0].id;
  patient = (await db.admin.query(`insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by)
    values($1,'L51-001',$2,'{}','direct','draft',$3) returning id`, [base, version, alice])).rows[0].id;
});
afterAll(async () => { await db?.stop(); });

describe('L51 exact server/client parity', () => {
  test.each(containsAnyCases)('$name', async ({ value, expected }) => {
    expect(containsAny(value, ['A'])).toBe(expected);
    const data = { driver: value };
    const actual = (await db.admin.query(`select public.rule_apply_op('contains_any',$1::jsonb,'["A"]') result,
      public.visibility_hidden_fields($2,$3::jsonb) hidden`, [value === undefined ? null : JSON.stringify(value), version, JSON.stringify(data)])).rows[0];
    expect(actual.result).toBe(expected);
    expect(actual.hidden.includes('target')).toBe(!expected);
    expect(hiddenFieldKeys([{ rule: rule() }], data).has('target')).toBe(!expected);
    const required = { ...rule(), then: { field: 'target', operator: 'required' } };
    expect(evaluateRules([{ rule: required, message: 'required', severity: 'block' }], data).blocking.length).toBe(expected ? 1 : 0);
    expect((await db.admin.query('select public.rule_holds($1,$2) result', [JSON.stringify(required), JSON.stringify(data)])).rows[0].result).toBe(!expected);
  });
  test.each(invalidContainsAnyConfigs.map((value, index) => ({ value, index })))('invalid config $index', async ({ value }) => {
    expect(containsAny('A', value)).toBe(false);
    expect(validateRule({ ...rule(), if: { field: 'driver', operator: 'contains_any', value } }).ok).toBe(false);
    expect((await db.admin.query("select public.rule_apply_op('contains_any','\"A\"',$1) result", [JSON.stringify(value) ?? null])).rows[0].result).toBe(false);
    const r = { ...rule(), if: { field: 'driver', operator: 'contains_any', value } };
    await expect(db.admin.query('select public.assert_rule_structure($1,$2)', [version, JSON.stringify(r)])).rejects.toThrow(/contains_any/);
  });
  test('in and comparison whitelist stay unchanged', async () => {
    expect((await db.admin.query(`select public.rule_apply_op('in','["A"]','["A"]') a,
      public.rule_apply_op('in','"A"','["A"]') b`)).rows[0]).toEqual({ a: false, b: true });
    const r = { operator: 'contains_any', left_field: 'driver', right_field: 'target' };
    expect(validateRule(r).ok).toBe(false);
    await expect(db.admin.query('select public.assert_rule_structure($1,$2)', [version, r])).rejects.toThrow(/invalide/);
    for (const malformed of [
      { ...rule(), operator: 'equals', left_field: 'driver', right_field: 'target' },
      { ...rule(), if: { ...rule().if, or: [{ field: 'single', value: 'B' }] } },
    ]) {
      expect(validateRule(malformed).ok).toBe(false);
      await expect(db.admin.query('select public.assert_rule_structure($1,$2)', [version, malformed])).rejects.toThrow(/contains_any/);
    }
  });
});

describe('L51 versioned definitions', () => {
  test('accept select and explicit terminology release; reject types, foreign codes and releases', async () => {
    const good = [rule('single'), rule('diagnosis', ['A'], { terminologyReleaseId: release })];
    for (const r of good) await db.admin.query('select public.assert_rule_structure($1,$2)', [version, r]);
    for (const r of [rule('target'), rule('driver', ['unknown']), rule('diagnosis'),
      rule('diagnosis', ['A'], { terminologyReleaseId: null }),
      rule('diagnosis', ['A'], { terminologyReleaseId: 'invalid' }),
      rule('diagnosis', ['A'], { terminologyReleaseId: '00000000-0000-0000-0000-000000000000' }),
      rule('diagnosis', ['GROUP'], { terminologyReleaseId: release }),
      rule('diagnosis', ['B'], { terminologyReleaseId: release }),
      rule('driver', ['A'], { terminologyReleaseId: release })]) {
      await expect(db.admin.query('select public.assert_rule_structure($1,$2)', [version, r])).rejects.toThrow(/contains_any/);
    }
  });
  test('direct authorized option withdrawal rolls back; adding and relabeling remain valid', async () => {
    const v = await newVersion(2);
    await addRule(rule(), v);
    await expect(db.asUser(alice, c => c.query("update public.template_field set allowed_values='[\"B\"]' where template_version_id=$1 and field_key='driver'", [v]))).rejects.toThrow(/code absent des options/);
    await expect(db.asUser(alice, c => c.query(`update public.template_field set allowed_options='[{"value_key":"B","label":"Beta","is_active":true}]'
      where template_version_id=$1 and field_key='driver'`, [v]))).rejects.toThrow(/code absent des options/);
    await db.asUser(alice, c => c.query("update public.template_field set allowed_values='[\"A\",\"B\",\"C\"]', label='Pilote modifie' where template_version_id=$1 and field_key='driver'", [v]));
    expect((await db.admin.query("select allowed_values from public.template_field where template_version_id=$1 and field_key='driver'", [v])).rows[0].allowed_values).toEqual(['A', 'B', 'C']);
  });
  test('copy retains release and codes after another release becomes active', async () => {
    const v = await newVersion(3);
    const r = rule('diagnosis', ['A'], { terminologyReleaseId: release });
    await addRule(r, v);
    await db.admin.query('update public.terminology_release set is_active=false where is_active');
    await db.admin.query("insert into public.terminology_release(slug,title,source,version,is_active) values('l51-next','L51 next','fiction','2',true)");
    const copied = await db.asUser(alice, async c => (await c.query('select (public.create_next_personal_template_version($1)).id', [template])).rows[0].id);
    expect((await db.admin.query('select rule from public.validation_rule where template_version_id=$1', [copied])).rows.map(r => r.rule)).toContainEqual(r);
    await expect(db.asUser(alice, c => c.query('select public.publish_template_version($1)', [copied]))).resolves.toBeDefined();
  });
  test('publish revalidates against the pinned release', async () => {
    const v = await newVersion(5);
    await addRule(rule('diagnosis', ['A'], { terminologyReleaseId: release }), v);
    // Simulate a privileged reference change; publication must not trust creation alone.
    await db.admin.query("update public.terminology_concept set is_selectable=false where release_id=$1 and code='A'", [release]);
    try {
      await expect(db.asUser(alice, c => c.query('select public.publish_template_version($1)', [v]))).rejects.toThrow(/code absent de la release/);
      expect((await db.admin.query('select status from public.template_version where id=$1', [v])).rows[0].status).toBe('draft');
    } finally {
      await db.admin.query("update public.terminology_concept set is_selectable=true where release_id=$1 and code='A'", [release]);
    }
  });
  test('a concurrent option withdrawal waits for rule creation, then revalidates', async () => {
    const v = await newVersion(6);
    let allowCommit!: () => void;
    const commit = new Promise<void>(resolve => { allowCommit = resolve; });
    let ruleInserted!: () => void;
    let insertionFailed!: (reason: unknown) => void;
    const inserted = new Promise<void>((resolve, reject) => { ruleInserted = resolve; insertionFailed = reject; });
    const creator = db.asUser(alice, async c => {
      await c.query('insert into public.validation_rule(template_version_id,rule,message,severity) values($1,$2,\'L51\',\'block\')', [v, rule()]);
      ruleInserted();
      await commit;
    }).catch(error => { insertionFailed(error); return error; });
    await inserted;
    let writerPid!: number;
    let started!: () => void;
    let startFailed!: (reason: unknown) => void;
    const writerStarted = new Promise<void>((resolve, reject) => { started = resolve; startFailed = reject; });
    const writer = db.asUser(alice, async c => {
      writerPid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
      started();
      await c.query("update public.template_field set allowed_values='[\"B\"]' where template_version_id=$1 and field_key='driver'", [v]);
    }).then(() => null, error => { startFailed(error); return error; });
    try {
      await writerStarted;
      await expect.poll(async () => (await db.admin.query('select exists(select 1 from pg_locks where pid=$1 and not granted) waiting', [writerPid])).rows[0].waiting).toBe(true);
    } finally {
      allowCommit();
    }
    await creator;
    expect(await writer).toMatchObject({ message: expect.stringContaining('code absent des options') });
  });
});

describe('L51 old client persistence protection', () => {
  test.each(['draft', 'complete', 'curated'])('patient and encounter reject hidden values at %s', async status => {
    for (const entity of ['patient', 'encounter']) {
      const query = entity === 'patient'
        ? db.admin.query('update public.patient set data=$1,validation_status=$2 where id=$3', [JSON.stringify({ ptarget: 'fiction' }), status, patient])
        : db.admin.query(`insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by)
          values($1,$2,'consultation',current_date,$3,$4,$5)`, [patient, version, JSON.stringify({ target: 'fiction' }), status, alice]);
      await expect(query).rejects.toMatchObject({ code: 'P0001', hint: 'refresh_required', detail: expect.stringContaining('contains_any_hidden_value') });
    }
    expect((await db.admin.query('select data,validation_status from public.patient where id=$1', [patient])).rows[0]).toEqual({ data: {}, validation_status: 'draft' });
  });
  test('authorized old-client RPC refuses the value, preserves database, and returns refresh instruction', async () => {
    await expect(db.asUser(alice, c => c.query(`select public.create_patient($1,'L51-old-client',null,null,null,null,null,$2::jsonb)`, [base, JSON.stringify({ ptarget: 'fiction' })])))
      .rejects.toMatchObject({ hint: 'refresh_required', message: expect.stringContaining('actualisez') });
    expect((await db.admin.query("select count(*)::int n from public.patient where base_id=$1 and patient_code='L51-old-client'", [base])).rows[0].n).toBe(0);
    await expect(db.asUser(alice, c => c.query(`select public.create_patient($1,'L51-current-client',null,null,null,null,null,$2::jsonb)`, [base, JSON.stringify({ pdriver: 'A', ptarget: 'fiction' })])))
      .resolves.toBeDefined();
  });
  test('missing reason in hidden target is also refused', async () => {
    await expect(db.admin.query('update public.patient set data=$1 where id=$2', [{ ptarget: { __missing__: 'inconnu' } }, patient])).rejects.toMatchObject({ hint: 'refresh_required' });
  });
});
