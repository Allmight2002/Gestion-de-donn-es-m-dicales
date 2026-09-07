// L52 : visibilité d'un bloc racine, invariants versionnés et barrière serveur.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let admin: string;

type Fixture = {
  templateId: string;
  versionId: string;
  sections: { block: string; child: string; other: string; otherChild: string };
  fields: { driver: string; direct: string; child: string; common: string; after: string; outside: string };
};

const blockRule = (driver = 'driver', section = 'block', value = 'show') => ({
  if: { field: driver, operator: 'equals', value },
  then: { section, operator: 'visible' },
});

const fieldRule = (driver: string, target: string, value = 'show') => ({
  if: { field: driver, operator: 'equals', value },
  then: { field: target, operator: 'visible' },
});

async function fixture(options: { scope?: 'patient' | 'encounter'; withOtherChild?: boolean } = {}): Promise<Fixture> {
  const scope = options.scope ?? 'patient';
  const templateId = (await db.admin.query(
    "insert into public.template(name, owner_user_id, is_global) values($1,$2,false) returning id",
    [`L52 ${crypto.randomUUID()}`, alice],
  )).rows[0].id as string;
  const versionId = (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id",
    [templateId, alice],
  )).rows[0].id as string;

  const sectionRows = (await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     values ($1,'block','Bloc clinique',0),($1,'block_child','Sous-section',1),($1,'other','Autre bloc',2)
     returning section_key,id`,
    [versionId],
  )).rows as { section_key: string; id: string }[];
  const section = (key: string) => sectionRows.find((row) => row.section_key === key)!.id;
  let otherChild = '';
  await db.admin.query(
    "update public.template_section set parent_section_id=$1 where template_version_id=$2 and section_key='block_child'",
    [section('block'), versionId],
  );
  if (options.withOtherChild) {
    otherChild = (await db.admin.query(
      "insert into public.template_section(template_version_id,section_key,label,display_order,parent_section_id) values($1,'other_child','Autre sous-section',3,$2) returning id",
      [versionId, section('other')],
    )).rows[0].id as string;
  }

  const fieldRows = (await db.admin.query(
    `insert into public.template_field(template_version_id, field_key, label, scope, section, type, required, display_order)
     values
       ($1,'driver','Pilote',$2,null,'text',false,0),
       ($1,'direct','Variable directe',$2,'block','text',false,1),
       ($1,'child','Variable enfant',$2,'block_child','text',false,2),
       ($1,'common','Tronc commun',$2,null,'text',false,3),
       ($1,'after','Cascade',$2,null,'text',false,4),
       ($1,'outside','Variable externe',$2,null,'text',false,5)
     returning field_key,id`,
    [versionId, scope],
  )).rows as { field_key: string; id: string }[];
  const field = (key: string) => fieldRows.find((row) => row.field_key === key)!.id;
  return {
    templateId,
    versionId,
    sections: { block: section('block'), child: section('block_child'), other: section('other'), otherChild },
    fields: { driver: field('driver'), direct: field('direct'), child: field('child'), common: field('common'), after: field('after'), outside: field('outside') },
  };
}

const addRule = (versionId: string, rule: unknown) => db.admin.query(
  "insert into public.validation_rule(template_version_id,rule,message,severity) values($1,$2,'L52', 'block') returning id",
  [versionId, JSON.stringify(rule)],
);

const hidden = async (versionId: string, data: unknown): Promise<string[]> =>
  (await db.admin.query('select public.visibility_hidden_fields($1,$2::jsonb) as hidden', [versionId, JSON.stringify(data)])).rows[0].hidden;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id as string;
  admin = (await db.admin.query("select id from auth.users where email='admin@demo.test'")).rows[0].id as string;
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('dépliage du bloc, cascade et complétude', () => {
  test('masque le bloc entier, jamais le tronc commun, et cumule la règle de champ', async () => {
    const f = await fixture();
    await addRule(f.versionId, blockRule());
    await addRule(f.versionId, fieldRule('driver', 'outside'));
    expect(await hidden(f.versionId, {
      driver: 'hide', direct: 'D', child: 'C', common: 'K', after: 'A', outside: 'O',
    })).toEqual(expect.arrayContaining(['direct', 'child', 'outside']));
    expect(await hidden(f.versionId, { driver: 'show', direct: 'D', child: 'C', common: 'K', outside: 'O' }))
      .toEqual([]);
  });

  test('le point fixe cascade masque un pilote de bloc et sa cible en aval', async () => {
    const f = await fixture();
    await addRule(f.versionId, blockRule());
    await addRule(f.versionId, fieldRule('direct', 'after'));
    expect(await hidden(f.versionId, { driver: 'hide', direct: 'show', child: 'C', common: 'K', after: 'A' }))
      .toEqual(expect.arrayContaining(['direct', 'child', 'after']));
  });

  test('une variable requise dans le bloc masque est absente de la complétude', async () => {
    const f = await fixture();
    await db.admin.query("update public.template_field set required=true where template_version_id=$1 and field_key='child'", [f.versionId]);
    await addRule(f.versionId, blockRule());
    await expect(db.admin.query(
      "select public.assert_required_complete($1,'patient',$2::jsonb)",
      [f.versionId, JSON.stringify({ driver: 'hide' })],
    )).resolves.toBeDefined();
    await expect(db.admin.query(
      "select public.assert_required_complete($1,'patient',$2::jsonb)",
      [f.versionId, JSON.stringify({ driver: 'show' })],
    )).rejects.toThrow(/Variable enfant/);
  });
});

describe('refus de définition d’une règle de bloc', () => {
  test('refuse section inconnue, sous-section, pilote interne, scope mixte et required', async () => {
    const f = await fixture();
    const cases: [unknown, RegExp][] = [
      [blockRule('driver', 'missing'), /Section cible inconnue/],
      [blockRule('driver', 'block_child'), /sous-section/],
      [blockRule('direct'), /pilote ne peut pas appartenir/],
      [blockRule('child'), /pilote ne peut pas appartenir/],
      [{ if: { field: 'driver', operator: 'equals', value: 'show' }, then: { section: 'block', operator: 'required' } }, /n'accepte que l'operateur visible/],
    ];
    for (const [rule, message] of cases) await expect(addRule(f.versionId, rule)).rejects.toThrow(message);

    const mixed = await fixture();
    await db.admin.query(
      "update public.template_field set scope='encounter' where template_version_id=$1 and field_key='child'",
      [mixed.versionId],
    );
    await expect(addRule(mixed.versionId, blockRule())).rejects.toThrow(/meme fiche/);
  });
});

describe('cycle d’affichage avec cible bloc', () => {
  test('refuse le cycle au moment de l’enregistrement de la règle', async () => {
    const f = await fixture();
    await addRule(f.versionId, fieldRule('direct', 'outside'));
    await expect(addRule(f.versionId, blockRule('outside'))).rejects.toThrow(/circulaire/);
  });

  test('les mutations ultérieures de champ, section et options repassent par le validateur unique', async () => {
    const f = await fixture({ withOtherChild: true });
    await db.admin.query(
      "update public.template_field set section='other_child' where template_version_id=$1 and field_key='child'",
      [f.versionId],
    );
    await addRule(f.versionId, blockRule());

    // Le pilote ne peut pas être déplacé dans son propre bloc.
    await expect(db.asUser(alice, (c) => c.query(
      "update public.template_field set section='block' where template_version_id=$1 and field_key='driver'",
      [f.versionId],
    ))).rejects.toThrow(/pilote ne peut pas appartenir/);
    expect((await db.admin.query("select section from public.template_field where id=$1", [f.fields.driver])).rows[0].section).toBeNull();

    // Un changement de scope ne peut pas rendre le bloc partiellement évaluable.
    await expect(db.asUser(alice, (c) => c.query(
      "update public.template_field set scope='encounter' where template_version_id=$1 and field_key='driver'",
      [f.versionId],
    ))).rejects.toThrow(/meme fiche/);
    expect((await db.admin.query("select scope from public.template_field where id=$1", [f.fields.driver])).rows[0].scope).toBe('patient');

    // Une sous-section déplacée dans le bloc peut faire apparaître un cycle existant.
    const cycleMutation = await fixture({ withOtherChild: true });
    await db.admin.query(
      "update public.template_field set section='other_child' where template_version_id=$1 and field_key='child'",
      [cycleMutation.versionId],
    );
    await addRule(cycleMutation.versionId, blockRule('outside'));
    await addRule(cycleMutation.versionId, fieldRule('child', 'outside'));
    await expect(db.admin.query(
      "update public.template_section set parent_section_id=$1 where id=$2",
      [cycleMutation.sections.block, cycleMutation.sections.otherChild],
    )).rejects.toThrow(/circulaire/);
    expect((await db.admin.query("select parent_section_id from public.template_section where id=$1", [cycleMutation.sections.otherChild])).rows[0].parent_section_id)
      .toBe(cycleMutation.sections.other);

    // Le pilote contains_any reste vérifié après modification de ses options.
    const options = await fixture();
    await db.admin.query(
      "update public.template_field set type='select', allowed_values='[\"A\"]'::jsonb where template_version_id=$1 and field_key='driver'",
      [options.versionId],
    );
    await addRule(options.versionId, {
      if: { field: 'driver', operator: 'contains_any', value: ['A'] },
      then: { section: 'block', operator: 'visible' },
    });
    await expect(db.asUser(alice, (c) => c.query(
      "update public.template_field set allowed_values='[\"B\"]'::jsonb where template_version_id=$1 and field_key='driver'",
      [options.versionId],
    ))).rejects.toThrow(/code absent des options/);
    expect((await db.admin.query("select allowed_values from public.template_field where id=$1", [options.fields.driver])).rows[0].allowed_values)
      .toEqual(['A']);
  });
});

describe('sérialisation des mutations concurrentes', () => {
  test('une règle et un déplacement concurrents ne peuvent pas publier un graphe combiné cyclique', async () => {
    const f = await fixture({ withOtherChild: true });
    await db.admin.query(
      "update public.template_field set section='other_child' where template_version_id=$1 and field_key='child'",
      [f.versionId],
    );
    await addRule(f.versionId, fieldRule('child', 'outside'));
    const c1 = new Client({ connectionString: db.url });
    const c2 = new Client({ connectionString: db.url });
    await c1.connect();
    await c2.connect();
    let waiterPid = 0;
    try {
      await c1.query('begin');
      await c1.query(
        "insert into public.validation_rule(template_version_id,rule,message,severity) values($1,$2,'concurrent','block')",
        [f.versionId, JSON.stringify(blockRule('outside'))],
      );
      waiterPid = (await c2.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      const pending = c2.query(
        "update public.template_section set parent_section_id=$1 where id=$2",
        [f.sections.block, f.sections.otherChild],
      );
      await expect.poll(async () => (await db.admin.query(
        "select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting",
        [waiterPid],
      )).rows[0].waiting).toBe(true);
      await c1.query('commit');
      await expect(pending).rejects.toThrow(/circulaire/);
    } finally {
      try { await c1.query('rollback'); } catch { /* transaction already committed */ }
      await c1.end();
      await c2.end();
    }
    expect((await db.admin.query("select parent_section_id from public.template_section where id=$1", [f.sections.otherChild])).rows[0].parent_section_id)
      .toBe(f.sections.other);
  });
});

describe('copie par section_key stable', () => {
  test('duplicate_template_version recopie sections et règles de bloc vers les sections cibles', async () => {
    const f = await fixture();
    await addRule(f.versionId, blockRule());
    const copied = (await db.asUser(admin, (c) => c.query(
      'select (public.duplicate_template_version($1)).id as id', [f.versionId],
    ))).rows[0].id as string;
    expect((await db.admin.query(
      "select section_key,parent_section_id from public.template_section where template_version_id=$1 order by display_order",
      [copied],
    )).rows.map((row) => row.section_key)).toEqual(['block', 'block_child', 'other']);
    const copiedRule = (await db.admin.query("select rule from public.validation_rule where template_version_id=$1", [copied])).rows[0].rule;
    expect(copiedRule).toEqual(blockRule());
    expect((await db.admin.query(
      "select exists(select 1 from public.template_section where template_version_id=$1 and section_key=$2 and parent_section_id is null) as ok",
      [copied, copiedRule.then.section],
    )).rows[0].ok).toBe(true);
  });
});

describe('barrière serveur contre un ancien client', () => {
  test.each(['draft', 'complete', 'curated'])('refuse une valeur de bloc masqué au statut %s et conserve la ligne', async (status) => {
    const f = await fixture();
    await addRule(f.versionId, blockRule());
    const base = (await db.admin.query(
      "insert into public.base(name,owner_user_id,current_template_version_id) values($1,$2,$3) returning id",
      [`L52 base ${crypto.randomUUID()}`, alice, f.versionId],
    )).rows[0].id as string;
    const identity = (await db.admin.query(
      "insert into public.patient_identity(base_id,patient_code,created_by) values($1,$2,$3) returning id",
      [base, `L52-${crypto.randomUUID()}`, alice],
    )).rows[0].id as string;
    const patient = (await db.admin.query(
      "insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by) values($1,$2,$3,'{}','direct','draft',$4) returning id",
      [base, (await db.admin.query('select patient_code from public.patient_identity where id=$1', [identity])).rows[0].patient_code, f.versionId, alice],
    )).rows[0].id as string;

    await expect(db.admin.query(
      'update public.patient set data=$1,validation_status=$2 where id=$3',
      [JSON.stringify({ driver: 'hide', direct: 'secret' }), status, patient],
    )).rejects.toMatchObject({ code: 'P0001', hint: 'refresh_required', detail: expect.stringContaining('block_hidden_value') });
    const row = (await db.admin.query('select data,validation_status from public.patient where id=$1', [patient])).rows[0];
    expect(row).toEqual({ data: {}, validation_status: 'draft' });
  });

  test('le détail structuré ne révèle ni la valeur ni le libellé clinique du pilote', async () => {
    const f = await fixture();
    await addRule(f.versionId, blockRule());
    const base = (await db.admin.query(
      "insert into public.base(name,owner_user_id,current_template_version_id) values($1,$2,$3) returning id",
      [`L52 old ${crypto.randomUUID()}`, alice, f.versionId],
    )).rows[0].id as string;
    await expect(db.asUser(alice, (c) => c.query(
      "select public.create_patient($1,$2,null,null,null,null,null,$3::jsonb)",
      [base, `old-${crypto.randomUUID()}`, JSON.stringify({ driver: 'hide', direct: 'clinical secret' })],
    ))).rejects.toMatchObject({ code: 'P0001', hint: 'refresh_required', detail: expect.stringContaining('block_hidden_value') });
    expect((await db.admin.query('select count(*)::int as n from public.patient where base_id=$1', [base])).rows[0].n).toBe(0);
  });

  test('refuse aussi un code de valeur manquante saisi sous un bloc masqué', async () => {
    const f = await fixture();
    await db.admin.query("update public.template_field set allow_missing_codes=true where template_version_id=$1 and field_key='direct'", [f.versionId]);
    await addRule(f.versionId, blockRule());
    const base = (await db.admin.query(
      "insert into public.base(name,owner_user_id,current_template_version_id) values($1,$2,$3) returning id",
      [`L52 missing ${crypto.randomUUID()}`, alice, f.versionId],
    )).rows[0].id as string;

    await expect(db.admin.query(
      "insert into public.patient(base_id,patient_code,template_version_id,data,collection_mode,validation_status,created_by) values($1,$2,$3,$4,'direct','draft',$5)",
      [base, `L52-missing-${crypto.randomUUID()}`, f.versionId, JSON.stringify({ driver: 'hide', direct: { __missing__: 'inconnu' } }), alice],
    )).rejects.toMatchObject({ code: 'P0001', hint: 'refresh_required', detail: expect.stringContaining('block_hidden_value') });
  });
});
