// Migration de batching: la fixture préexistante est construite avant la migration
// sur PostgreSQL embarqué, puis les RPC et les déclencheurs sont exercés localement.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { startTestDb, type TestDb } from './harness/db.js';

const MIGRATION_FILE = '20260920192000_batch_template_version_invariants.sql';
const LARGE_FIELD_COUNT = 265;
const LARGE_RULE_COUNT = 53;

type FieldSeed = {
  field_key: string;
  label: string;
  scope: 'patient' | 'encounter';
  section: 'clinique' | 'biologie' | 'paraclinique';
  type: 'text';
  display_order: number;
};

type RuleSeed = {
  rule: Record<string, unknown>;
  message: string;
  severity: 'block';
};

let db: TestDb;
let ownerId: string;
let outsiderId: string;
let largeVersionId: string;
let moveFromVersionId: string;
let moveToVersionId: string;
let moveFieldId: string;
let populatedBefore: { fields: unknown[]; rules: unknown[] };

async function createTemplate(name: string, owner = ownerId): Promise<string> {
  const result = await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neuro', $2, false) returning id::text`,
    [name, owner],
  );
  return result.rows[0].id as string;
}

async function createVersion(templateId: string, number = 1): Promise<string> {
  const result = await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, $2, 'draft', $3) returning id::text`,
    [templateId, number, ownerId],
  );
  return result.rows[0].id as string;
}

async function insertFields(versionId: string, fields: FieldSeed[]): Promise<void> {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order)
     select $1, f.field_key, f.label, f.scope, f.section, f.type, f.display_order
       from jsonb_to_recordset($2::jsonb) as f(
         field_key text, label text, scope text, section text, type text, display_order integer
       )`,
    [versionId, JSON.stringify(fields)],
  );
}

async function insertRules(versionId: string, rules: RuleSeed[]): Promise<void> {
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     select $1, r.rule, r.message, r.severity
       from jsonb_to_recordset($2::jsonb) as r(rule jsonb, message text, severity text)`,
    [versionId, JSON.stringify(rules)],
  );
}

function simpleField(fieldKey: string, displayOrder: number, overrides: Partial<FieldSeed> = {}): FieldSeed {
  return {
    field_key: fieldKey,
    label: fieldKey,
    scope: 'encounter',
    section: 'clinique',
    type: 'text',
    display_order: displayOrder,
    ...overrides,
  };
}

function visibilityRule(driver: string, target: string): RuleSeed {
  return {
    rule: {
      if: { field: driver, operator: 'equals', value: 'oui' },
      then: { field: target, operator: 'visible' },
    },
    message: 'Règle fictive de test',
    severity: 'block',
  };
}

function largeFields(): FieldSeed[] {
  const fields: FieldSeed[] = [];
  for (let i = 0; i < LARGE_RULE_COUNT; i += 1) {
    fields.push(simpleField(`driver_${i}`, fields.length));
    fields.push(simpleField(`target_${i}`, fields.length));
  }
  while (fields.length < LARGE_FIELD_COUNT) {
    fields.push(simpleField(`extra_${fields.length}`, fields.length));
  }
  return fields;
}

function largeRules(): RuleSeed[] {
  return Array.from({ length: LARGE_RULE_COUNT }, (_, i) => visibilityRule(`driver_${i}`, `target_${i}`));
}

async function clearCalls(): Promise<void> {
  await db.admin.query('delete from public.timeout_test_validation_calls');
}

async function validationCallCount(): Promise<number> {
  const row = (await db.admin.query(
    'select last_value, is_called from public.timeout_test_validation_counter',
  )).rows[0] as { last_value: string; is_called: boolean };
  // Sequence values are not rolled back with the statement that invoked the validator.
  return Number(row.last_value) - (row.is_called ? 0 : 1);
}

async function callsByVersion(): Promise<Record<string, number>> {
  const rows = (await db.admin.query(
    `select template_version_id::text, count(*)::integer as calls
       from public.timeout_test_validation_calls group by template_version_id`,
  )).rows as Array<{ template_version_id: string; calls: number }>;
  return Object.fromEntries(rows.map((row) => [row.template_version_id, row.calls]));
}

async function snapshotLargeVersion(): Promise<{ fields: unknown[]; rules: unknown[] }> {
  const fields = (await db.admin.query(
    `select field_key, label, scope, section, type, display_order
       from public.template_field where template_version_id = $1 order by field_key`,
    [largeVersionId],
  )).rows;
  const rules = (await db.admin.query(
    `select rule, message, severity from public.validation_rule
      where template_version_id = $1 order by id`,
    [largeVersionId],
  )).rows;
  return { fields, rules };
}

async function instrumentValidator(): Promise<void> {
  await db.admin.query(
    'alter function public.validate_template_version_invariants(uuid) rename to validate_template_version_invariants_uninstrumented',
  );
  await db.admin.query('create sequence public.timeout_test_validation_counter');
  await db.admin.query(
    `create table public.timeout_test_validation_calls (
       template_version_id uuid not null,
       called_at timestamptz not null default clock_timestamp()
     )`,
  );
  await db.admin.query(`
    create function public.validate_template_version_invariants(p_version_id uuid)
    returns void language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      perform nextval('public.timeout_test_validation_counter');
      insert into public.timeout_test_validation_calls(template_version_id) values (p_version_id);
      perform public.validate_template_version_invariants_uninstrumented(p_version_id);
    end
    $$`);
  await db.admin.query(
    'revoke all on function public.validate_template_version_invariants(uuid) from public, anon, authenticated',
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true, beforeMigration: MIGRATION_FILE });
  const users = (await db.admin.query(
    "select email, id::text from auth.users where email in ('bob@demo.test', 'alice@demo.test')",
  )).rows as Array<{ email: string; id: string }>;
  ownerId = users.find((user) => user.email === 'bob@demo.test')?.id ?? '';
  outsiderId = users.find((user) => user.email === 'alice@demo.test')?.id ?? '';
  if (!ownerId || !outsiderId) throw new Error('Fixture utilisateur de test introuvable');

  const largeTemplateId = await createTemplate('Timeout batching — gabarit fictif 265');
  largeVersionId = await createVersion(largeTemplateId);
  await insertFields(largeVersionId, largeFields());
  await insertRules(largeVersionId, largeRules());
  populatedBefore = await snapshotLargeVersion();

  const moveTemplateId = await createTemplate('Timeout batching — déplacement fictif');
  moveFromVersionId = await createVersion(moveTemplateId, 1);
  moveToVersionId = await createVersion(moveTemplateId, 2);
  await insertFields(moveFromVersionId, [simpleField('moving_field', 0)]);
  moveFieldId = (await db.admin.query(
    'select id::text from public.template_field where template_version_id = $1 and field_key = $2',
    [moveFromVersionId, 'moving_field'],
  )).rows[0].id as string;

  const migrationSql = readFileSync(new URL(`../supabase/migrations/${MIGRATION_FILE}`, import.meta.url), 'utf8');
  await db.admin.query(migrationSql);
  await instrumentValidator();
}, 600_000);

afterAll(async () => { await db?.stop(); });

describe('validation des invariants par instruction', () => {
  test('la migration passe sur un schéma peuplé et installe les triggers, ACL et index attendus', async () => {
    expect(await snapshotLargeVersion()).toEqual(populatedBefore);

    const triggers = (await db.admin.query(`
      select tgname, (tgtype & 1) <> 0 as row_level
        from pg_trigger
       where not tgisinternal
         and tgrelid in ('public.template_field'::regclass,
                         'public.template_section'::regclass,
                         'public.validation_rule'::regclass)
         and tgname like 'trg_template_version_invariants_%'
       order by tgname`)).rows as Array<{ tgname: string; row_level: boolean }>;
    expect(triggers.map((trigger) => trigger.tgname)).toEqual([
      'trg_template_version_invariants_field_delete',
      'trg_template_version_invariants_field_insert',
      'trg_template_version_invariants_field_update',
      'trg_template_version_invariants_rule_delete',
      'trg_template_version_invariants_rule_insert',
      'trg_template_version_invariants_rule_update',
      'trg_template_version_invariants_section_delete',
      'trg_template_version_invariants_section_insert',
      'trg_template_version_invariants_section_update',
    ]);
    expect(triggers.every((trigger) => !trigger.row_level)).toBe(true);

    const functions = (await db.admin.query(`
      select proname, prosecdef, proconfig,
             has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_exec,
             has_function_privilege('anon', oid, 'EXECUTE') as anon_exec
        from pg_proc where pronamespace = 'public'::regnamespace
         and proname in (
           'run_template_version_invariants_insert_statement',
           'run_template_version_invariants_update_statement',
           'run_template_version_invariants_delete_statement',
           'guard_repeatable_fields_insert_statement',
           'guard_repeatable_fields_update_statement'
         ) order by proname`)).rows as Array<{
      proname: string; prosecdef: boolean; proconfig: string[]; authenticated_exec: boolean; anon_exec: boolean;
    }>;
    expect(functions).toHaveLength(5);
    expect(functions.every((fn) => !fn.authenticated_exec && !fn.anon_exec)).toBe(true);
    expect(functions.every((fn) => fn.proconfig.includes('search_path=public, pg_temp'))).toBe(true);
    expect(functions.filter((fn) => fn.proname.startsWith('run_template_version_invariants_'))
      .every((fn) => fn.prosecdef)).toBe(true);
    expect(functions.filter((fn) => fn.proname.startsWith('guard_repeatable_fields_'))
      .every((fn) => !fn.prosecdef)).toBe(true);

    const indexes = (await db.admin.query(`
      select to_regclass('public.ix_validation_rule_version_id_id') as rules,
             to_regclass('public.ix_base_active_current_template_version') as bases`)).rows[0];
    expect(indexes.rules).not.toBeNull();
    expect(indexes.bases).not.toBeNull();
  });

  test('les écritures multi-lignes valident une fois par version et ignorent le seul display_order', async () => {
    await clearCalls();
    await insertFields(moveFromVersionId, [simpleField('moving_peer_a', 1), simpleField('moving_peer_b', 2)]);
    expect(await callsByVersion()).toEqual({ [moveFromVersionId]: 1 });

    await clearCalls();
    await db.admin.query(
      "update public.template_field set label = label || ' modifie' where template_version_id = $1",
      [moveFromVersionId],
    );
    expect(await callsByVersion()).toEqual({ [moveFromVersionId]: 1 });

    await clearCalls();
    await db.admin.query(
      'update public.template_field set display_order = display_order + 10 where template_version_id = $1',
      [moveFromVersionId],
    );
    expect(await callsByVersion()).toEqual({});

    await clearCalls();
    await db.admin.query('update public.template_field set template_version_id = $2 where id = $1', [moveFieldId, moveToVersionId]);
    expect(await callsByVersion()).toEqual({ [moveFromVersionId]: 1, [moveToVersionId]: 1 });

    await clearCalls();
    await db.admin.query(
      'delete from public.template_field where template_version_id = any($1::uuid[])',
      [[moveFromVersionId, moveToVersionId]],
    );
    expect(await callsByVersion()).toEqual({ [moveFromVersionId]: 1, [moveToVersionId]: 1 });
  });

  test('un lot de règles invalide est entièrement annulé', async () => {
    const templateId = await createTemplate('Timeout batching — rollback fictif');
    const versionId = await createVersion(templateId);
    await insertFields(versionId, [simpleField('cycle_a', 0), simpleField('cycle_b', 1)]);
    await clearCalls();
    const validatorCallsBefore = await validationCallCount();

    // The legacy BEFORE-row guard checks cycles too. Disable only that guard so this
    // invalid batch must be rejected by the new AFTER STATEMENT invariant trigger.
    await db.admin.query('alter table public.validation_rule disable trigger trg_vr_structure');
    try {
      await expect(insertRules(versionId, [
        visibilityRule('cycle_a', 'cycle_b'),
        visibilityRule('cycle_b', 'cycle_a'),
      ])).rejects.toThrow(/circulaire|circular/i);
    } finally {
      await db.admin.query('alter table public.validation_rule enable trigger trg_vr_structure');
    }

    const remaining = await db.admin.query(
      'select count(*)::integer as count from public.validation_rule where template_version_id = $1',
      [versionId],
    );
    expect(remaining.rows[0].count).toBe(0);
    expect(await callsByVersion()).toEqual({});
    expect(await validationCallCount()).toBe(validatorCallsBefore + 1);
  });

  test('le garde répétable bloque la mauvaise portée et autorise les rencontres', async () => {
    const templateId = await createTemplate('Timeout batching — groupe fictif');
    const versionId = await createVersion(templateId);
    const sectionId = (await db.asUser(ownerId, async (client) => (await client.query(
      `insert into public.template_section(template_version_id,section_key,label,display_order,is_repeatable)
       values ($1,'clinique','Clinique',0,true) returning id::text`, [versionId],
    )).rows[0].id as string));

    await clearCalls();
    await expect(db.asUser(ownerId, (client) => client.query(
      `insert into public.template_field(template_version_id,field_key,label,scope,section,section_id,type)
       values ($1,'patient_bad','Patient interdit','patient','clinique',$2,'text')`,
      [versionId, sectionId],
    ))).rejects.toThrow(/rencontre/);
    expect((await db.admin.query(
      'select count(*)::integer as count from public.template_field where template_version_id = $1', [versionId],
    )).rows[0].count).toBe(0);
    expect(await callsByVersion()).toEqual({});

    await db.asUser(ownerId, (client) => client.query(
      `insert into public.template_field(template_version_id,field_key,label,scope,section,section_id,type)
       values ($1,'encounter_ok','Rencontre autorisée','encounter','clinique',$2,'text')`,
      [versionId, sectionId],
    ));
    expect(await callsByVersion()).toEqual({ [versionId]: 1 });
    await expect(db.asUser(ownerId, (client) => client.query(
      'select public.validate_template_version_invariants($1)', [versionId],
    ))).rejects.toThrow(/permission denied/i);
  });

  test('les suppressions conservent les FK de section et effacent la provenance après cascade', async () => {
    const sectionTemplateId = await createTemplate('Timeout batching — section FK fictive');
    const sectionVersionId = await createVersion(sectionTemplateId);
    const sectionId = (await db.admin.query(
      `insert into public.template_section(template_version_id,section_key,label,display_order)
       values ($1,'clinique','Clinique',0) returning id::text`, [sectionVersionId],
    )).rows[0].id as string;
    const linkedFieldId = (await db.admin.query(
      `insert into public.template_field(template_version_id,field_key,label,scope,section,section_id,type)
       values ($1,'linked','Lié','encounter','clinique',$2,'text') returning id::text`,
      [sectionVersionId, sectionId],
    )).rows[0].id as string;

    // La garde métier refuse une section peuplée; on la désactive uniquement dans cette
    // transaction jetable pour exercer directement le ON DELETE SET NULL de la FK.
    await db.admin.query('alter table public.template_section disable trigger trg_template_section_write');
    try {
      await db.admin.query('delete from public.template_section where id = $1', [sectionId]);
    } finally {
      // Each ALTER TABLE commits separately; the DELETE may queue AFTER triggers,
      // which PostgreSQL will not allow to coexist with another ALTER TABLE.
      await db.admin.query('alter table public.template_section enable trigger trg_template_section_write');
    }
    expect((await db.admin.query('select section_id from public.template_field where id = $1', [linkedFieldId]))
      .rows[0].section_id).toBeNull();

    const sourceTemplateId = await createTemplate('Timeout batching — source fictive');
    const targetTemplateId = await createTemplate('Timeout batching — cible fictive');
    const sourceVersionId = await createVersion(sourceTemplateId);
    const targetVersionId = await createVersion(targetTemplateId);
    const sourceSectionKey = 'source_block';
    await db.admin.query(
      `insert into public.template_section(template_version_id,section_key,label,display_order)
       values ($1,$2,'Source',0)`, [sourceVersionId, sourceSectionKey],
    );
    await db.admin.query(
      `insert into public.template_section
         (template_version_id,section_key,label,display_order,source_template_version_id,source_section_key)
       values ($1,'target_block','Cible',0,$2,$3)`, [targetVersionId, sourceVersionId, sourceSectionKey],
    );
    await insertFields(sourceVersionId, [simpleField('source_driver', 0), simpleField('source_target', 1)]);
    await insertFields(targetVersionId, [simpleField('target_driver', 0), simpleField('target_target', 1)]);
    const sourceRuleId = (await db.admin.query(
      `insert into public.validation_rule(template_version_id,rule,message,severity)
       values ($1,$2,'Source','block') returning id::text`,
      [sourceVersionId, JSON.stringify(visibilityRule('source_driver', 'source_target').rule)],
    )).rows[0].id as string;
    await db.admin.query(
      `insert into public.validation_rule
         (template_version_id,rule,message,severity,source_template_version_id,source_validation_rule_id)
       values ($1,$2,'Cible','block',$3,$4)`,
      [targetVersionId, JSON.stringify(visibilityRule('target_driver', 'target_target').rule), sourceVersionId, sourceRuleId],
    );
    await db.admin.query(
      `insert into public.template_field
         (template_version_id,field_key,label,scope,section,type,display_order,source_template_version_id,source_field_key)
       values ($1,'copied','Copié','encounter','clinique','text',2,$2,'source_target')`,
      [targetVersionId, sourceVersionId],
    );

    await db.admin.query('delete from public.template_version where id = $1', [sourceVersionId]);
    // Section provenance keeps its stable text key even after the source-version FK clears.
    expect((await db.admin.query(
      `select source_template_version_id,source_section_key from public.template_section
        where template_version_id = $1`, [targetVersionId],
    )).rows[0]).toEqual({ source_template_version_id: null, source_section_key: sourceSectionKey });
    // Field provenance follows the same rule: clear the FK, retain the source key.
    expect((await db.admin.query(
      `select source_template_version_id,source_field_key from public.template_field
        where template_version_id = $1 and field_key = 'copied'`, [targetVersionId],
    )).rows[0]).toEqual({ source_template_version_id: null, source_field_key: 'source_target' });
    expect((await db.admin.query(
      `select source_template_version_id,source_validation_rule_id from public.validation_rule
        where template_version_id = $1`, [targetVersionId],
    )).rows[0]).toEqual({ source_template_version_id: null, source_validation_rule_id: null });
    expect((await db.admin.query(
      'select count(*)::integer as count from public.template_field where template_version_id = $1', [sourceVersionId],
    )).rows[0].count).toBe(0);
  });

  test('la création et le réordonnancement à 265 champs/53 règles restent sous 8 s', async () => {
    await clearCalls();
    const createStarted = performance.now();
    const created = await db.asUser(ownerId, async (client) => {
      await client.query("set local statement_timeout = '8s'");
      return (await client.query(
        'select * from public.create_base_from_model_observation($1,$2,$3,$4)',
        ['Timeout batching fictif', 'neuro', largeVersionId, 'longitudinal'],
      )).rows[0] as { current_template_version_id: string };
    });
    const createMs = performance.now() - createStarted;
    const createdVersionId = created.current_template_version_id;
    expect((await db.admin.query(
      'select count(*)::integer as count from public.template_field where template_version_id = $1', [createdVersionId],
    )).rows[0].count).toBe(LARGE_FIELD_COUNT);
    expect((await db.admin.query(
      'select count(*)::integer as count from public.validation_rule where template_version_id = $1', [createdVersionId],
    )).rows[0].count).toBe(LARGE_RULE_COUNT);
    expect(await callsByVersion()).toEqual({ [createdVersionId]: 2 });

    const ids = (await db.admin.query(
      'select id::text from public.template_field where template_version_id = $1 order by display_order, id',
      [createdVersionId],
    )).rows.map((row) => row.id as string).reverse();
    await clearCalls();
    const reorderStarted = performance.now();
    await db.asUser(ownerId, async (client) => {
      await client.query("set local statement_timeout = '8s'");
      await client.query('select public.reorder_template_fields($1,$2::uuid[])', [createdVersionId, ids]);
    });
    const reorderMs = performance.now() - reorderStarted;
    expect(await callsByVersion()).toEqual({});
    await expect(db.asUser(outsiderId, (client) => client.query(
      'select public.reorder_template_fields($1,$2::uuid[])', [createdVersionId, ids],
    ))).rejects.toThrow(/autorisee|denied/i);

    const sectionTemplateId = await createTemplate('Timeout batching — réordonnancement fictif');
    const sectionVersionId = await createVersion(sectionTemplateId);
    const sections = Array.from({ length: 120 }, (_, index) => ({
      section_key: `sec_${String(index).padStart(3, '0')}`,
      label: `Section ${index}`,
      display_order: index,
    }));
    await db.admin.query(
      `insert into public.template_section(template_version_id,section_key,label,display_order)
       select $1,s.section_key,s.label,s.display_order
         from jsonb_to_recordset($2::jsonb) as s(section_key text,label text,display_order integer)`,
      [sectionVersionId, JSON.stringify(sections)],
    );
    const sectionIds = (await db.admin.query(
      'select id::text from public.template_section where template_version_id = $1 order by display_order',
      [sectionVersionId],
    )).rows.map((row) => row.id as string).reverse();
    await clearCalls();
    const sectionReorderStarted = performance.now();
    await db.asUser(ownerId, async (client) => {
      await client.query("set local statement_timeout = '8s'");
      await client.query('select public.reorder_template_section_siblings($1,null,$2::uuid[])', [sectionVersionId, sectionIds]);
    });
    const sectionReorderMs = performance.now() - sectionReorderStarted;
    expect(await callsByVersion()).toEqual({});

    console.info(
      `[timeout-trigger-benchmark] fields=${LARGE_FIELD_COUNT} rules=${LARGE_RULE_COUNT}`
      + ` create_ms=${createMs.toFixed(2)} field_reorder_ms=${reorderMs.toFixed(2)}`
      + ` section_siblings=${sections.length} section_reorder_ms=${sectionReorderMs.toFixed(2)}`,
    );
  });
});
