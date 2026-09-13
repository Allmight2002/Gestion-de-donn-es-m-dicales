import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';
import { calculateDiagnosisCoverage } from '../src/domain/diagnosisCoverage';
import type { DiagnosisConfiguration, DiagnosisContext, TemplateField, TemplateSection, ValidationRule } from '../src/data/types';

let db: TestDb;
let alice: string;
let bob: string;
let admin: string;
let release: string;
beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = (await db.admin.query('select id,email from auth.users')).rows;
  alice = users.find((u) => u.email === 'alice@demo.test').id;
  bob = users.find((u) => u.email === 'bob@demo.test').id;
  admin = users.find((u) => u.email === 'admin@demo.test').id;
  release = (await db.admin.query("insert into terminology_release(slug,title,source,version) values('l55','L55','fictif','1') returning id")).rows[0].id;
  await db.admin.query("insert into terminology_concept(release_id,code,label,kind) values($1,'A','Alpha','category'),($1,'B','Beta','category'),($1,'C','Gamma','category'),($1,'D','Delta','category')", [release]);
}, 240_000);
afterAll(async () => { await db?.stop(); });

async function client(c: Client) { await c.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`); }
async function fixture(type = 'multiselect', scope = 'patient', multiple = type === 'terminology') {
  const template = (await db.admin.query("insert into template(name,owner_user_id,is_global) values('L55',$1,false) returning id",[alice])).rows[0].id;
  const version = (await db.admin.query("insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id",[template])).rows[0].id;
  await db.admin.query("insert into template_section(template_version_id,section_key,label,display_order) values($1,'block','Bloc',0),($1,'child','Enfant',1),($1,'second','Second',2)",[version]);
  await db.admin.query("update template_section set parent_section_id=(select id from template_section where template_version_id=$1 and section_key='block') where template_version_id=$1 and section_key='child'",[version]);
  await db.admin.query(`insert into template_field(template_version_id,field_key,label,scope,section,type,allowed_values,is_multiple,display_order)
    values($1,'diagnostics','Diagnostics',$2,null,$3,$4::jsonb,$5,0),
    ($1,'diagnostics_autre','Proposition',$2,null,'text',null,false,1),
    ($1,'measure','Mesure',$2,'child','text',null,false,2),
    ($1,'measure2','Mesure 2',$2,'second','text',null,false,3)`,
  [version,scope,type,type === 'terminology' ? null : '["A","B","C","D"]',multiple]);
  const rule = { if: { field: 'diagnostics', operator: 'contains_any', value: ['A','D'],
    ...(type === 'terminology' ? { terminologyReleaseId: release } : {}) }, then: { section: 'block', operator: 'visible' } };
  await db.admin.query("insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')",[version,rule]);
  const config: DiagnosisConfiguration[] = [{scope: scope as 'patient',diagnosisFieldKey:'diagnostics',terminologyReleaseId:type === 'terminology' ? release : null,commonOnlyCodes:['B']}];
  await db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1',[version,JSON.stringify(config)]);
  return {template,version,config,rule};
}
async function context(version: string) {
  const configs = (await db.admin.query('select get_diagnosis_context($1) as c',[version])).rows[0].c as DiagnosisContext[];
  const raw = (await db.admin.query('select * from template_field where template_version_id=$1',[version])).rows;
  const fields = raw.map((f) => ({id:f.id,fieldKey:f.field_key,scope:f.scope,type:f.type,section:f.section,formula:f.formula,isMultiple:f.is_multiple})) as TemplateField[];
  const rows = (await db.admin.query('select * from template_section where template_version_id=$1',[version])).rows;
  const sections = rows.map((s) => ({id:s.id,sectionKey:s.section_key,parentSectionKey:rows.find((r) => r.id === s.parent_section_id)?.section_key ?? null})) as TemplateSection[];
  const rules = (await db.admin.query('select rule from validation_rule where template_version_id=$1 order by id',[version])).rows as ValidationRule[];
  return {configs,fields,sections,rules};
}

describe('L55 configuration et couverture', () => {
  test.each(['select','multiselect','terminology'])('parité SQL/TS %s : multiples, codes exacts, absence et proposition', async (type) => {
    const f = await fixture(type);
    const ctx = await context(f.version);
    const values: unknown[] = type === 'select' ? ['A','B','C','D','A.1',null,{__missing__:'unknown'}] : type === 'multiselect'
      ? [['A','C','B','D'],['C'],[],null,['A',3],['A','A'],['A.1']]
      : [[{code:'A',label:'Renommé'},{code:'C',label:'Gamma'},{code:'B',label:'Beta'}],[],null,[{code:'A',label:''}], [{code:'A',label:'A',extra:true}], [{code:'A',label:'A'},{code:'A',label:'A'}]];
    for (const value of values) for (const proposal of [undefined,'Texte fictif',' \t\n']) {
      const data = {diagnostics:value,diagnostics_autre:proposal};
      const sql = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',[f.version,'patient',JSON.stringify(data)])).rows[0].c;
      expect(sql).toEqual(calculateDiagnosisCoverage({id:f.version,diagnosisContext:ctx.configs},'patient',data,ctx.fields,ctx.rules,ctx.sections));
    }
    const covered = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',[f.version,'patient',JSON.stringify({diagnostics:type === 'select' ? 'A' : type === 'multiselect' ? ['A','C'] : [{code:'A',label:'Alpha'},{code:'C',label:'Gamma'}]})])).rows[0].c;
    expect(covered.counts.covered).toBe(1);
    expect(covered.diagnostics[0].blockKeys).toEqual(['block']);
  });
  test('invariants sur configuration, champs, codes, règles et sections', async () => {
    const f = await fixture();
    const set = (c: unknown) => db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1',[f.version,JSON.stringify(c)]);
    await expect(set([f.config[0],f.config[0]])).rejects.toThrow('DIAGNOSIS_SCOPE_DUPLICATE');
    await expect(set([{...f.config[0],commonOnlyCodes:['A']}])).rejects.toThrow('DIAGNOSIS_COMMON_BLOCK_OVERLAP');
    await expect(set([{...f.config[0],commonOnlyCodes:['X']}])).rejects.toThrow('DIAGNOSIS_CODE_UNKNOWN');
    await expect(set([{...f.config[0],terminologyReleaseId:release}])).rejects.toThrow('DIAGNOSIS_RELEASE_FORBIDDEN');
    await expect(db.admin.query("update template_field set section='block' where template_version_id=$1 and field_key='diagnostics'",[f.version])).rejects.toThrow();
    await expect(db.admin.query("delete from template_field where template_version_id=$1 and field_key='diagnostics_autre'",[f.version])).rejects.toThrow('DIAGNOSIS_PROPOSAL_INVALID');
    await expect(db.admin.query("delete from template_field where template_version_id=$1 and field_key='measure'",[f.version])).rejects.toThrow('DIAGNOSIS_BLOCK_EMPTY');
    await expect(db.admin.query("update template_field set allowed_values='[\"A\",\"C\",\"D\"]' where template_version_id=$1 and field_key='diagnostics'",[f.version])).rejects.toThrow();
    await expect(db.admin.query("insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')",[f.version,f.rule])).rejects.toThrow('DIAGNOSIS_BLOCK_NONCANONICAL');
  });
  // L60 : l'ecran refuse une edition differente avant d'ecrire, mais c'est le SERVEUR qui en
  // repond. Ce test verifie les gardes elles-memes — sans interface, sans RPC nouvelle — pour
  // que la reconnexion d'un bloc importe ne repose jamais sur le seul controle du navigateur.
  test('L60 : reconnexion d’un bloc importe — gardes serveur de l’edition et des codes', async () => {
    const f = await fixture('terminology');
    const other = (await db.admin.query("insert into terminology_release(slug,title,source,version) values('l60','L60','fictif','1') returning id")).rows[0].id;
    await db.admin.query("insert into terminology_concept(release_id,code,label,kind) values($1,'A','Alpha','category')", [other]);
    // Le bloc « second » porte `measure2` : il n'est pas vide, donc seule l'edition est en cause.
    const activation = (releaseId: string, value: string[]) => ({
      if: { field: 'diagnostics', operator: 'contains_any', value, terminologyReleaseId: releaseId },
      then: { section: 'second', operator: 'visible' },
    });
    const create = (rule: unknown) => db.admin.query(
      "insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')", [f.version, rule]);

    // Edition differente de celle du pilote de la cible : le refus vient des gardes de L55.
    await expect(create(activation(other, ['A']))).rejects.toThrow('DIAGNOSIS_RELEASE_MISMATCH');
    // Code absent de l'edition configuree : refus de la garde de forme, avant L55.
    await expect(create(activation(release, ['ZZZ']))).rejects.toThrow('code absent de la release');
    // Code deja declare « socle suffisant » : un code ne peut pas se passer de bloc et en activer un.
    await expect(create(activation(release, ['B']))).rejects.toThrow('DIAGNOSIS_COMMON_BLOCK_OVERLAP');
    // Aucun de ces refus n'a laisse de regle derriere lui.
    expect((await db.admin.query(
      "select count(*)::int as n from validation_rule where template_version_id=$1 and rule->'then'->>'section'='second'",
      [f.version])).rows[0].n).toBe(0);

    // Meme edition et code reconnu : la regle passe par le chemin d'ecriture existant.
    await create(activation(release, ['A']));
    expect((await db.admin.query(
      "select count(*)::int as n from validation_rule where template_version_id=$1 and rule->'then'->>'section'='second'",
      [f.version])).rows[0].n).toBe(1);
    // Et le bloc est bien devenu couvert pour ce code, par la meme voie que L55.
    const coverage = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',
      [f.version, 'patient', JSON.stringify({ diagnostics: [{ code: 'A', label: 'Alpha' }] })])).rows[0].c;
    expect(coverage.diagnostics[0].blockKeys).toEqual(['block', 'second']);
  });
  test('permissions gabarit, ancien client, publication et gel', async () => {
    const f = await fixture();
    await expect(db.asUser(bob, async (c) => {await client(c); return c.query('select set_diagnosis_configuration($1,$2)',[f.version,JSON.stringify(f.config)]);})).rejects.toThrow();
    expect(await db.asUser(bob, async (c) => (await c.query('select * from template_version where id=$1',[f.version])).rows)).toEqual([]);
    // Permissions identiques a celles du gabarit : owns_template rend deja l'administrateur systeme proprietaire.
    await db.asUser(admin, async (c) => {await client(c); return c.query('select set_diagnosis_configuration($1,$2)',[f.version,JSON.stringify(f.config)]);});
    await expect(db.asUser(alice,c => c.query('select set_diagnosis_configuration($1,$2)',[f.version,JSON.stringify(f.config)]))).rejects.toThrow('Actualisez');
    await db.asUser(alice, async (c) => {await client(c); await c.query('select set_diagnosis_configuration($1,$2)',[f.version,JSON.stringify(f.config)]); await c.query('select publish_template_version($1)',[f.version]);});
    await expect(db.admin.query("update template_version set diagnosis_configuration='[]' where id=$1",[f.version])).rejects.toThrow('DIAGNOSIS_VERSION_FROZEN');
  });
  test('release source, changement de libellé, mutations du référentiel refusées', async () => {
    const f = await fixture('terminology');
    await db.admin.query("update terminology_concept set label='Autre libellé' where release_id=$1 and code='A'",[release]);
    await expect(db.admin.query("delete from terminology_concept where release_id=$1 and code='C'",[release])).rejects.toThrow('DIAGNOSIS_RELEASE_FROZEN');
    await expect(db.admin.query('delete from terminology_release where id=$1',[release])).rejects.toThrow('DIAGNOSIS_RELEASE_FROZEN');
    const next = (await db.admin.query("insert into terminology_release(slug,title,source,version) values('l55-next','L55','fictif','2') returning id")).rows[0].id;
    await expect(db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1',[f.version,JSON.stringify([{...f.config[0],terminologyReleaseId:next}])])).rejects.toThrow();
    expect((await context(f.version)).configs[0].terminologyReleaseId).toBe(release);
  });
  test('copie personnelle et bundle, sans pointeur inter-version', async () => {
    const f = await fixture();
    const next = await db.asUser(alice, async c => {await client(c); return (await c.query('select (create_next_personal_template_version($1)).id',[f.template])).rows[0].id;});
    expect((await context(next)).configs).toEqual((await context(f.version)).configs);
    const bundle = await db.asUser(alice, async c => {await client(c); return (await c.query('select create_template_bundle($1,$2) as b',[{name:'copie L55',sourceVersionId:f.version,withBase:true},crypto.randomUUID()])).rows[0].b;});
    expect((await context(bundle.versionId)).configs).toEqual((await context(f.version)).configs);
    // Les associations sont des regles L52 : la couverture de la copie doit rester identique.
    for (const target of [next, bundle.versionId]) {
      const c = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',[target,'patient',JSON.stringify({diagnostics:['A','B','C'],diagnostics_autre:'Hors liste'})])).rows[0].c;
      expect(c.counts).toEqual({covered:1,common_only:1,uncovered:1,unclassified:1});
      expect(c.diagnostics.find((d: {code: string}) => d.code === 'A').blockKeys).toEqual(['block']);
    }
  });
  test('ancienne base sans configuration inchangée', async () => {
    const f = await fixture();
    await db.admin.query("update template_version set diagnosis_configuration='[]' where id=$1",[f.version]);
    const r = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',[f.version,'patient',{diagnostics:['A']}])).rows[0].c;
    expect(r.diagnostics).toEqual([]);
    await db.asUser(alice,c => c.query('select publish_template_version($1)',[f.version]));
  });
});

describe('L55 scope encounter, pilote simple et blocs multiples', () => {
  test('terminologie simple, scope encounter, un code cite par deux blocs', async () => {
    const f = await fixture('terminology', 'encounter', false);
    // Second bloc racine citant le MEME code : les deux doivent remonter, tries.
    await db.admin.query("insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')",
      [f.version, { if: { field: 'diagnostics', operator: 'contains_any', value: ['A'], terminologyReleaseId: release },
        then: { section: 'second', operator: 'visible' } }]);
    const ctx = await context(f.version);
    const values: unknown[] = [{ code: 'A', label: 'Alpha' }, { code: 'B', label: 'Beta' }, { code: 'C', label: 'Gamma' },
      { code: 'X', label: 'Hors publication' }, { code: 'A', label: '' }, [{ code: 'A', label: 'Alpha' }], null, 'A'];
    for (const value of values) for (const proposal of [undefined, 'Texte fictif', '  ']) {
      const data = { diagnostics: value, diagnostics_autre: proposal };
      const sql = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c', [f.version, 'encounter', JSON.stringify(data)])).rows[0].c;
      expect(sql).toEqual(calculateDiagnosisCoverage({ id: f.version, diagnosisContext: ctx.configs }, 'encounter', data, ctx.fields, ctx.rules, ctx.sections));
    }
    const covered = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',
      [f.version, 'encounter', JSON.stringify({ diagnostics: { code: 'A', label: 'Alpha' } })])).rows[0].c;
    expect(covered.diagnostics[0].blockKeys).toEqual(['block', 'second']);
    expect(covered.counts).toEqual({ covered: 1, common_only: 0, uncovered: 0, unclassified: 0 });
    // Un scope non configure ne renvoie rien : la configuration est bien par scope.
    const value = { diagnostics: { code: 'A', label: 'Alpha' } };
    const other = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',
      [f.version, 'patient', JSON.stringify(value)])).rows[0].c;
    expect(other.diagnostics).toEqual([]);
    expect(calculateDiagnosisCoverage({ id: f.version, diagnosisContext: ctx.configs }, 'patient', value, ctx.fields, ctx.rules, ctx.sections)).toEqual(other);
  });
});

describe('L55 quatre autres voies de copie', () => {
  const probe = { diagnostics: ['A', 'B', 'C'], diagnostics_autre: 'Hors liste' };
  const coverageOf = async (v: string) => (await db.admin.query(
    'select diagnosis_coverage($1,$2,$3) as c', [v, 'patient', JSON.stringify(probe)])).rows[0].c;

  test('duplication, deux creations de base et promotion globale restent fideles', async () => {
    const f = await fixture();
    const expected = await coverageOf(f.version);
    expect(expected.counts).toEqual({ covered: 1, common_only: 1, uncovered: 1, unclassified: 1 });

    // duplicate_template_version est reserve a l'administrateur systeme.
    const duplicated = await db.asUser(admin, async (c) => {
      await client(c);
      return (await c.query('select (duplicate_template_version($1)).id', [f.version])).rows[0].id;
    });
    const fromModel = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_base_from_model('L55 modele',null,$1)).current_template_version_id as v", [f.version])).rows[0].v;
    });
    const observation = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_base_from_model_observation('L55 obs',null,$1,'cross_sectional')).current_template_version_id as v", [f.version])).rows[0].v;
    });
    const promoted = await db.asUser(admin, async (c) => {
      await client(c);
      const tpl = (await c.query('select (promote_template_to_global($1)).id', [f.template])).rows[0].id;
      return (await c.query('select id from template_version where template_id=$1', [tpl])).rows[0].id;
    });

    for (const target of [duplicated, fromModel, observation, promoted]) {
      expect((await context(target)).configs).toEqual((await context(f.version)).configs);
      expect(await coverageOf(target)).toEqual({ ...expected, versionId: target });
    }
  });

  test('forcer le scope patient refuse une configuration encounter au lieu de la deformer', async () => {
    const f = await fixture('multiselect', 'encounter');
    await expect(db.asUser(alice, async (c) => {
      await client(c);
      return c.query("select create_base_from_model_observation('L55 conflit',null,$1,'cross_sectional')", [f.version]);
    })).rejects.toThrow('DIAGNOSIS_SCOPE_COPY_CONFLICT');
  });
});

describe('L55 concurrence, ancien client et transport hors-ligne', () => {
  test('une reference prise sous verrou n est pas manquee par un instantane anterieur', async () => {
    const f = await fixture('terminology');
    // On repart d'une version SANS configuration : la reference nait pendant le test.
    await db.admin.query("update template_version set diagnosis_configuration='[]' where id=$1", [f.version]);

    let allowCommit!: () => void;
    const commit = new Promise<void>((resolve) => { allowCommit = resolve; });
    let configured!: () => void;
    let configureFailed!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { configured = resolve; configureFailed = reject; });
    const writer = db.asUser(alice, async (c) => {
      await client(c);
      await c.query('select set_diagnosis_configuration($1,$2)', [f.version, JSON.stringify(f.config)]);
      configured();
      await commit;
    }).catch((error) => { configureFailed(error); return error; });
    await ready;

    let deleterPid!: number;
    let started!: () => void;
    let startFailed!: (reason: unknown) => void;
    const deleterStarted = new Promise<void>((resolve, reject) => { started = resolve; startFailed = reject; });
    const deleter = (async () => {
      // Le referentiel n'a aucune politique d'ecriture : sous RLS le DELETE ne
      // toucherait aucune ligne et le trigger ne se declencherait jamais. On ouvre
      // donc une seconde connexion privilegiee, distincte de `db.admin` qui sonde.
      const c = db.pg.getPgClient();
      await c.connect();
      try {
        await c.query('begin');
        deleterPid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
        started();
        await c.query('delete from terminology_concept where release_id=$1 and code=$2', [release, 'D']);
        await c.query('commit');
        return null;
      } catch (error) {
        await c.query('rollback').catch(() => undefined);
        return error;
      } finally {
        await c.end();
      }
    })().catch((error) => { startFailed(error); return error; });
    try {
      await deleterStarted;
      await expect.poll(async () => (await db.admin.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) waiting', [deleterPid])).rows[0].waiting).toBe(true);
    } finally {
      allowCommit();
    }
    await writer;
    expect(await deleter).toMatchObject({ message: expect.stringContaining('DIAGNOSIS_RELEASE_FROZEN') });
    expect((await db.admin.query(
      "select count(*)::int n from terminology_concept where release_id=$1 and code='D'", [release])).rows[0].n).toBe(1);
  });

  test('ancien client : soumission refusee sur le scope configure seulement, sans effacement', async () => {
    const f = await fixture();
    const base = (await db.admin.query(
      "insert into base(name,owner_user_id,current_template_version_id) values('L55',$1,$2) returning id", [alice, f.version])).rows[0].id;

    // Sans l'en-tete de contrat : refus explicite, message d'actualisation, rien n'est ecrit.
    await expect(db.asUser(alice, (c) => c.query(
      "select create_patient($1,'L55-ancien',null,null,null,null,null,$2::jsonb)", [base, JSON.stringify({ diagnostics: ['A'] })])))
      .rejects.toMatchObject({ hint: 'refresh_required', detail: expect.stringContaining('DIAGNOSIS_CLIENT_UNSUPPORTED') });
    expect((await db.admin.query('select count(*)::int n from patient where base_id=$1', [base])).rows[0].n).toBe(0);

    // Avec l'en-tete : la meme saisie passe.
    const patient = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_patient($1,'L55-courant',null,null,null,null,null,$2::jsonb)).id",
        [base, JSON.stringify({ diagnostics: ['A'] })])).rows[0].id;
    });
    expect((await db.admin.query('select count(*)::int n from patient where base_id=$1', [base])).rows[0].n).toBe(1);

    // La configuration porte sur `patient` : une rencontre n'est PAS concernee par le refus.
    await db.admin.query(
      `insert into encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by)
       values($1,$2,'consultation',current_date,'{}','draft',$3)`, [patient, f.version, alice]);
    expect((await db.admin.query('select count(*)::int n from encounter where patient_id=$1', [patient])).rows[0].n).toBe(1);
  });

  test('l instantane hors-ligne transporte le contrat par version, sans l activer', async () => {
    const f = await fixture();
    const base = (await db.admin.query(
      "insert into base(name,owner_user_id,current_template_version_id) values('L55 offline',$1,$2) returning id", [alice, f.version])).rows[0].id;
    await db.asUser(alice, async (c) => {
      await client(c);
      await c.query("select create_patient($1,'L55-offline',null,null,null,null,null,$2::jsonb)", [base, JSON.stringify({ diagnostics: ['A'] })]);
    });

    const snapshot = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query('select download_base_snapshot($1) as s', [base])).rows[0].s;
    });
    const transported = snapshot.diagnosisContextByVersion as Record<string, DiagnosisContext[]>;
    expect(Object.keys(transported)).toEqual([f.version]);
    expect(transported[f.version]).toEqual((await context(f.version)).configs);
    // Le contrat voyage ; aucun drapeau d'activation ni champ supplementaire.
    expect(transported[f.version][0]).toHaveProperty('proposalFieldKey', 'diagnostics_autre');
    expect(Object.keys(transported[f.version][0]).sort()).toEqual(
      ['commonOnlyCodes', 'diagnosisFieldKey', 'proposalFieldKey', 'recognizedCodes', 'scope', 'terminologyReleaseId']);
  });
});

describe('L55 scope encounter, pilote simple et blocs multiples', () => {
  test('terminologie simple, scope encounter, un code cite par deux blocs', async () => {
    const f = await fixture('terminology', 'encounter', false);
    // Second bloc racine citant le MEME code : les deux doivent remonter, tries.
    await db.admin.query("insert into validation_rule(template_version_id,rule,severity) values($1,$2,'block')",
      [f.version, { if: { field: 'diagnostics', operator: 'contains_any', value: ['A'], terminologyReleaseId: release },
        then: { section: 'second', operator: 'visible' } }]);
    const ctx = await context(f.version);
    const values: unknown[] = [{ code: 'A', label: 'Alpha' }, { code: 'B', label: 'Beta' }, { code: 'C', label: 'Gamma' },
      { code: 'X', label: 'Hors publication' }, { code: 'A', label: '' }, [{ code: 'A', label: 'Alpha' }], null, 'A'];
    for (const value of values) for (const proposal of [undefined, 'Texte fictif', '  ']) {
      const data = { diagnostics: value, diagnostics_autre: proposal };
      const sql = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c', [f.version, 'encounter', JSON.stringify(data)])).rows[0].c;
      expect(sql).toEqual(calculateDiagnosisCoverage({ id: f.version, diagnosisContext: ctx.configs }, 'encounter', data, ctx.fields, ctx.rules, ctx.sections));
    }
    const covered = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',
      [f.version, 'encounter', JSON.stringify({ diagnostics: { code: 'A', label: 'Alpha' } })])).rows[0].c;
    expect(covered.diagnostics[0].blockKeys).toEqual(['block', 'second']);
    expect(covered.counts).toEqual({ covered: 1, common_only: 0, uncovered: 0, unclassified: 0 });
    // Un scope non configure ne renvoie rien : la configuration est bien par scope.
    const value = { diagnostics: { code: 'A', label: 'Alpha' } };
    const other = (await db.admin.query('select diagnosis_coverage($1,$2,$3) as c',
      [f.version, 'patient', JSON.stringify(value)])).rows[0].c;
    expect(other.diagnostics).toEqual([]);
    expect(calculateDiagnosisCoverage({ id: f.version, diagnosisContext: ctx.configs }, 'patient', value, ctx.fields, ctx.rules, ctx.sections)).toEqual(other);
  });
});

describe('L55 quatre autres voies de copie', () => {
  const probe = { diagnostics: ['A', 'B', 'C'], diagnostics_autre: 'Hors liste' };
  const coverageOf = async (v: string) => (await db.admin.query(
    'select diagnosis_coverage($1,$2,$3) as c', [v, 'patient', JSON.stringify(probe)])).rows[0].c;

  test('duplication, deux creations de base et promotion globale restent fideles', async () => {
    const f = await fixture();
    const expected = await coverageOf(f.version);
    expect(expected.counts).toEqual({ covered: 1, common_only: 1, uncovered: 1, unclassified: 1 });

    // duplicate_template_version est reserve a l'administrateur systeme.
    const duplicated = await db.asUser(admin, async (c) => {
      await client(c);
      return (await c.query('select (duplicate_template_version($1)).id', [f.version])).rows[0].id;
    });
    const fromModel = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_base_from_model('L55 modele',null,$1)).current_template_version_id as v", [f.version])).rows[0].v;
    });
    const observation = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_base_from_model_observation('L55 obs',null,$1,'cross_sectional')).current_template_version_id as v", [f.version])).rows[0].v;
    });
    const promoted = await db.asUser(admin, async (c) => {
      await client(c);
      const tpl = (await c.query('select (promote_template_to_global($1)).id', [f.template])).rows[0].id;
      return (await c.query('select id from template_version where template_id=$1', [tpl])).rows[0].id;
    });

    for (const target of [duplicated, fromModel, observation, promoted]) {
      expect((await context(target)).configs).toEqual((await context(f.version)).configs);
      expect(await coverageOf(target)).toEqual({ ...expected, versionId: target });
    }
  });

  test('forcer le scope patient refuse une configuration encounter au lieu de la deformer', async () => {
    const f = await fixture('multiselect', 'encounter');
    await expect(db.asUser(alice, async (c) => {
      await client(c);
      return c.query("select create_base_from_model_observation('L55 conflit',null,$1,'cross_sectional')", [f.version]);
    })).rejects.toThrow('DIAGNOSIS_SCOPE_COPY_CONFLICT');
  });
});

describe('L55 concurrence, ancien client et transport hors-ligne', () => {
  test('une reference prise sous verrou n est pas manquee par un instantane anterieur', async () => {
    const f = await fixture('terminology');
    // On repart d'une version SANS configuration : la reference nait pendant le test.
    await db.admin.query("update template_version set diagnosis_configuration='[]' where id=$1", [f.version]);

    let allowCommit!: () => void;
    const commit = new Promise<void>((resolve) => { allowCommit = resolve; });
    let configured!: () => void;
    let configureFailed!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { configured = resolve; configureFailed = reject; });
    const writer = db.asUser(alice, async (c) => {
      await client(c);
      await c.query('select set_diagnosis_configuration($1,$2)', [f.version, JSON.stringify(f.config)]);
      configured();
      await commit;
    }).catch((error) => { configureFailed(error); return error; });
    await ready;

    let deleterPid!: number;
    let started!: () => void;
    let startFailed!: (reason: unknown) => void;
    const deleterStarted = new Promise<void>((resolve, reject) => { started = resolve; startFailed = reject; });
    const deleter = (async () => {
      // Le referentiel n'a aucune politique d'ecriture : sous RLS le DELETE ne
      // toucherait aucune ligne et le trigger ne se declencherait jamais. On ouvre
      // donc une seconde connexion privilegiee, distincte de `db.admin` qui sonde.
      const c = db.pg.getPgClient();
      await c.connect();
      try {
        await c.query('begin');
        deleterPid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
        started();
        await c.query('delete from terminology_concept where release_id=$1 and code=$2', [release, 'D']);
        await c.query('commit');
        return null;
      } catch (error) {
        await c.query('rollback').catch(() => undefined);
        return error;
      } finally {
        await c.end();
      }
    })().catch((error) => { startFailed(error); return error; });
    try {
      await deleterStarted;
      await expect.poll(async () => (await db.admin.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) waiting', [deleterPid])).rows[0].waiting).toBe(true);
    } finally {
      allowCommit();
    }
    await writer;
    expect(await deleter).toMatchObject({ message: expect.stringContaining('DIAGNOSIS_RELEASE_FROZEN') });
    expect((await db.admin.query(
      "select count(*)::int n from terminology_concept where release_id=$1 and code='D'", [release])).rows[0].n).toBe(1);
  });

  test('ancien client : soumission refusee sur le scope configure seulement, sans effacement', async () => {
    const f = await fixture();
    const base = (await db.admin.query(
      "insert into base(name,owner_user_id,current_template_version_id) values('L55',$1,$2) returning id", [alice, f.version])).rows[0].id;

    // Sans l'en-tete de contrat : refus explicite, message d'actualisation, rien n'est ecrit.
    await expect(db.asUser(alice, (c) => c.query(
      "select create_patient($1,'L55-ancien',null,null,null,null,null,$2::jsonb)", [base, JSON.stringify({ diagnostics: ['A'] })])))
      .rejects.toMatchObject({ hint: 'refresh_required', detail: expect.stringContaining('DIAGNOSIS_CLIENT_UNSUPPORTED') });
    expect((await db.admin.query('select count(*)::int n from patient where base_id=$1', [base])).rows[0].n).toBe(0);

    // Avec l'en-tete : la meme saisie passe.
    const patient = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query("select (create_patient($1,'L55-courant',null,null,null,null,null,$2::jsonb)).id",
        [base, JSON.stringify({ diagnostics: ['A'] })])).rows[0].id;
    });
    expect((await db.admin.query('select count(*)::int n from patient where base_id=$1', [base])).rows[0].n).toBe(1);

    // La configuration porte sur `patient` : une rencontre n'est PAS concernee par le refus.
    await db.admin.query(
      `insert into encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by)
       values($1,$2,'consultation',current_date,'{}','draft',$3)`, [patient, f.version, alice]);
    expect((await db.admin.query('select count(*)::int n from encounter where patient_id=$1', [patient])).rows[0].n).toBe(1);
  });

  test('l instantane hors-ligne transporte le contrat par version, sans l activer', async () => {
    const f = await fixture();
    const base = (await db.admin.query(
      "insert into base(name,owner_user_id,current_template_version_id) values('L55 offline',$1,$2) returning id", [alice, f.version])).rows[0].id;
    await db.asUser(alice, async (c) => {
      await client(c);
      await c.query("select create_patient($1,'L55-offline',null,null,null,null,null,$2::jsonb)", [base, JSON.stringify({ diagnostics: ['A'] })]);
    });

    const snapshot = await db.asUser(alice, async (c) => {
      await client(c);
      return (await c.query('select download_base_snapshot($1) as s', [base])).rows[0].s;
    });
    const transported = snapshot.diagnosisContextByVersion as Record<string, DiagnosisContext[]>;
    expect(Object.keys(transported)).toEqual([f.version]);
    expect(transported[f.version]).toEqual((await context(f.version)).configs);
    // Le contrat voyage ; aucun drapeau d'activation ni champ supplementaire.
    expect(transported[f.version][0]).toHaveProperty('proposalFieldKey', 'diagnostics_autre');
    expect(Object.keys(transported[f.version][0]).sort()).toEqual(
      ['commonOnlyCodes', 'diagnosisFieldKey', 'proposalFieldKey', 'recognizedCodes', 'scope', 'terminologyReleaseId']);
  });
});
