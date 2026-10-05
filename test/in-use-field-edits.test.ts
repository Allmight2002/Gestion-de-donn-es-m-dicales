// Modifications d'un jeu de variables DEJA UTILISE (migration 20261005010000).
//
// Decision produit : sur une version qui porte des dossiers, le responsable peut renommer la
// cle d'une variable renseignee, la supprimer, retirer une option deja choisie, et gerer
// librement les regles. Ce que ces tests protegent :
//   * renommage : les valeurs SUIVENT la cle (dossiers de la version, valeurs de complement
//     des dossiers anciens, provenance, formulaire de saisie), le journal reste intact, et un
//     dossier portant deja le nouveau code bloque tout le renommage ;
//   * suppression : les valeurs sont retirees et chaque valeur retiree est journalisee ;
//   * retrait d'option : refus structure sans designation ; avec designation, remplacement
//     ou vidage, journalises, y compris dans les listes multiples (sans doublon) ;
//   * regles : ajout, modification, suppression et lot de regles acceptes sur une version
//     utilisee ; la version publiee reste figee ; un tiers reste refuse partout.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let alice: string;
let bob: string;
let template: string;
let v0: string;
let v1: string;
let base: string;
let p1: string;
let p2: string;
let p0: string;
let pShadow: string;
let e1: string;
let e2: string;

const as = <T = Record<string, unknown>>(uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c: Client) => {
    await c.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`);
    return (await c.query(sql, args)).rows as T[];
  });

interface FieldOverrides { key?: string; options?: unknown; replacements?: Record<string, string | null> | null }

/** RPC de l'editeur (surcharge p_option_replacements), attributs inchanges sauf overrides. */
const save = (uid: string, versionId: string, fieldKey: string, o: FieldOverrides = {}) => as(uid, `
  select (public.update_template_field(
    p_field_id => f.id, p_field_key => coalesce($3, f.field_key), p_label => f.label,
    p_description => f.description, p_default_value => f.default_value, p_scope => f.scope,
    p_section => f.section, p_type => f.type, p_required => f.required, p_is_multiple => f.is_multiple,
    p_missing_reasons => f.missing_reasons, p_allowed_options => coalesce($4::jsonb, f.allowed_options),
    p_formula => f.formula, p_option_replacements => $5::jsonb, p_encounter_types => f.encounter_types,
    p_allowed_values => f.allowed_values, p_min_value => f.min_value, p_max_value => f.max_value,
    p_unit => f.unit)).field_key
    from public.template_field f where f.template_version_id = $1 and f.field_key = $2`,
  [versionId, fieldKey, o.key ?? null, o.options === undefined ? null : JSON.stringify(o.options),
    o.replacements === undefined || o.replacements === null ? null : JSON.stringify(o.replacements)]);

const fieldId = async (versionId: string, key: string) => (await db.admin.query(
  'select id from public.template_field where template_version_id=$1 and field_key=$2', [versionId, key])).rows[0]?.id as string | undefined;
const patientData = async (id: string) =>
  (await db.admin.query('select data from public.patient where id=$1', [id])).rows[0].data as Record<string, unknown>;
const encounterData = async (id: string) =>
  (await db.admin.query('select data from public.encounter where id=$1', [id])).rows[0].data as Record<string, unknown>;
const logs = async (source: string, key: string) => (await db.admin.query(
  `select entity, entity_id, old_value, new_value, changed_by, source from public.field_change_log
    where source=$1 and field_key=$2 order by entity, entity_id`, [source, key])).rows;
const options = (...keys: (string | [string, boolean])[]) => keys.map((k) => {
  const [key, active] = Array.isArray(k) ? k : [k, true];
  return { value_key: key, label: key.toUpperCase(), is_active: active };
});

async function addPatient(code: string, version: string, data: object, status = 'draft') {
  return (await db.admin.query(
    `insert into public.patient (base_id, patient_code, template_version_id, data, validation_status, created_by)
     values ($1,$2,$3,$4::jsonb,$5,$6) returning id`,
    [base, code, version, JSON.stringify(data), status, alice])).rows[0].id as string;
}
async function addEncounter(patient: string, data: object) {
  return (await db.admin.query(
    `insert into public.encounter (patient_id, template_version_id, encounter_type, encounter_date, data, created_by)
     values ($1,$2,'consultation',date '2026-09-01',$3::jsonb,$4) returning id`,
    [patient, v1, JSON.stringify(data), alice])).rows[0].id as string;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  bob = (await db.admin.query("select id from auth.users where email='bob@demo.test'")).rows[0].id;
  template = (await db.admin.query(
    "insert into template(name,owner_user_id,is_global) values('Jeu utilise (fictif)',$1,false) returning id", [alice])).rows[0].id;
  v0 = (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
  v1 = (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,2,'draft') returning id", [template])).rows[0].id;
  // v0 : version ancienne. Elle definit `taille` et `groupe`, mais ni `poids` ni `note`.
  await db.admin.query(`insert into template_field
      (template_version_id,field_key,label,scope,section,type,allowed_values,display_order)
    values ($1,'taille','Taille','patient','clinique','number',null,0),
           ($1,'groupe','Groupe','patient','clinique','select','["a","b","c"]',1)`, [v0]);
  await db.admin.query(`insert into template_field
      (template_version_id,field_key,label,scope,section,type,allowed_values,display_order)
    values ($1,'age','Age','patient','clinique','number',null,0),
           ($1,'poids','Poids','patient','clinique','number',null,1),
           ($1,'groupe','Groupe','patient','clinique','select','["a","b","c"]',2),
           ($1,'note','Note','patient','clinique','text',null,3),
           ($1,'symptomes','Symptomes','encounter','clinique','multiselect','["toux","fievre","douleur"]',4)`, [v1]);
  await db.admin.query(
    `insert into validation_rule(template_version_id,rule,message,severity)
     values ($1,'{"operator":"greater_or_equal","left_field":"poids","right_field":"age"}','poids >= age','warn')`, [v1]);
  base = (await db.admin.query(
    "insert into public.base(name,owner_user_id,current_template_version_id) values('Base jeu utilise (fictif)',$1,$2) returning id",
    [alice, v1])).rows[0].id;

  p1 = await addPatient('U-001', v1, { age: 40, poids: 70, groupe: 'a', note: 'premiere' }, 'curated');
  p2 = await addPatient('U-002', v1, { groupe: 'b', note: 'seconde' });
  // Dossier ancien complete sous la definition courante : `note` et `poids` n'existent pas
  // dans v0, leurs valeurs relevent donc de v1. `taille` releve de v0.
  p0 = await addPatient('U-000', v0, { taille: 180, poids: 82, note: 'ancienne' });
  // Dossier ancien dont la version definit elle-meme `groupe` (valeur « ombree »).
  pShadow = await addPatient('U-00S', v0, { groupe: 'a' });
  e1 = await addEncounter(p1, { symptomes: ['toux', 'fievre'] });
  e2 = await addEncounter(p2, { symptomes: ['douleur'] });

  await db.admin.query(
    `insert into public.base_entry_form(base_id,name,field_keys,required_keys)
     values ($1,'Saisie rapide',array['groupe','note'],array['note'])`, [base]);
  await db.admin.query(
    `insert into public.record_field_provenance(record_kind,record_id,field_key,origin,definition_revision,value_fingerprint)
     values ('patient',$1,'note','initial',$2,'sha256:' || repeat('0',64))`, [p1, v1]);
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('compter les dossiers concernes', () => {
  test('le proprietaire obtient des comptes, sans valeur ni identifiant', async () => {
    const [{ usage }] = await as<{ usage: { records: number; options: Record<string, number> } }>(alice,
      'select public.template_field_usage($1) as usage', [await fieldId(v1, 'groupe')]);
    // p1 et p2 (v1) ; pShadow porte `groupe` sous sa propre definition : hors du compte de
    // suppression, mais compte pour l'option, car son enregistrement valide aussi v1.
    expect(usage).toEqual({ records: 2, options: { a: 2, b: 1 } });
    const [{ u }] = await as<{ u: { records: number } }>(alice,
      'select public.template_field_usage($1) as u', [await fieldId(v1, 'note')]);
    expect(u.records).toBe(3);
  });

  test('un tiers est refuse', async () => {
    await expect(as(bob, 'select public.template_field_usage($1)', [await fieldId(v1, 'groupe')]))
      .rejects.toThrow(/non autorisee/);
  });
});

describe('renommer la cle d une variable deja renseignee', () => {
  test('les valeurs, la provenance et le formulaire de saisie suivent ; le journal reste intact', async () => {
    const before = (await db.admin.query('select row_version from public.patient where id=$1', [p1])).rows[0].row_version;
    const logBefore = (await db.admin.query('select count(*)::int n from public.field_change_log')).rows[0].n;

    const [{ field_key }] = await save(alice, v1, 'note', { key: 'commentaire' });
    expect(field_key).toBe('commentaire');

    expect(await patientData(p1)).toEqual({ age: 40, poids: 70, groupe: 'a', commentaire: 'premiere' });
    expect(await patientData(p2)).toEqual({ groupe: 'b', commentaire: 'seconde' });
    expect(await patientData(p0)).toEqual({ taille: 180, poids: 82, commentaire: 'ancienne' });
    // Revision incrementee : un editeur concurrent recoit un conflit au lieu d'ecraser.
    expect((await db.admin.query('select row_version from public.patient where id=$1', [p1])).rows[0].row_version)
      .toBe(String(BigInt(before) + 1n));
    expect((await db.admin.query(
      "select field_key from public.record_field_provenance where record_id=$1", [p1])).rows).toEqual([{ field_key: 'commentaire' }]);
    expect((await db.admin.query(
      'select field_keys, required_keys from public.base_entry_form where base_id=$1', [base])).rows[0])
      .toEqual({ field_keys: ['groupe', 'commentaire'], required_keys: ['commentaire'] });
    expect((await db.admin.query('select count(*)::int n from public.field_change_log')).rows[0].n).toBe(logBefore);
    expect((await db.admin.query(
      "select metadata from public.audit_log where action='template_field_key_renamed' and entity_id=$1",
      [await fieldId(v1, 'commentaire')])).rows[0].metadata).toEqual({ from: 'note', to: 'commentaire', records: 3 });

    // La fiche reste ecrivable par la voie ordinaire sous le nouveau code.
    const rv = (await db.admin.query('select row_version from public.patient where id=$1', [p2])).rows[0].row_version;
    await expect(as(alice, 'select public.update_patient($1,$2::jsonb,$3,$4,$5)',
      [p2, JSON.stringify({ groupe: 'b', commentaire: 'relue' }), 'draft', 'relecture', rv])).resolves.toBeDefined();
  });

  test('un dossier portant deja le nouveau code bloque tout le renommage', async () => {
    // p0 porte `taille` (definition v0) et `poids` (valeur de complement v1).
    await expect(save(alice, v1, 'poids', { key: 'taille' })).rejects.toThrow(/FIELD_KEY_RENAME_CONFLICT/);
    expect(await fieldId(v1, 'poids')).toBeDefined();
    expect(await patientData(p0)).toEqual({ taille: 180, poids: 82, commentaire: 'ancienne' });
    expect(await patientData(p1)).toMatchObject({ poids: 70 });
  });

  test('le type d une variable utilisee reste fige', async () => {
    await expect(as(alice, `
      select public.update_template_field(
        p_field_id => f.id, p_field_key => f.field_key, p_label => f.label, p_description => f.description,
        p_default_value => f.default_value, p_scope => f.scope, p_section => f.section, p_type => 'integer',
        p_required => f.required, p_is_multiple => f.is_multiple, p_missing_reasons => f.missing_reasons,
        p_allowed_options => f.allowed_options, p_formula => f.formula, p_option_replacements => null)
        from public.template_field f where f.template_version_id = $1 and f.field_key = 'poids'`, [v1]))
      .rejects.toThrow(/deja utilisee/);
  });
});

describe('retirer une option deja choisie', () => {
  test('sans designation : refus structure qui nomme les options a remplacer, rien ne change', async () => {
    await expect(save(alice, v1, 'groupe', { options: options('b', 'c') }))
      .rejects.toThrow(/OPTION_REPLACEMENT_REQUIRED/);
    try {
      await save(alice, v1, 'groupe', { options: options('b', 'c') });
    } catch (e) {
      expect(JSON.parse((e as { detail: string }).detail)).toMatchObject({ code: 'OPTION_REPLACEMENT_REQUIRED', options: ['a'] });
    }
    expect(await patientData(p1)).toMatchObject({ groupe: 'a' });
    expect((await db.admin.query(
      'select allowed_values from public.template_field where id=$1', [await fieldId(v1, 'groupe')])).rows[0].allowed_values)
      .toEqual(['a', 'b', 'c']);
  });

  test('une designation vers une option inconnue, desactivee ou non retiree est refusee', async () => {
    const cases: { replacements: Record<string, string | null>; opts: ReturnType<typeof options> }[] = [
      { replacements: { a: 'z' }, opts: options('b', 'c') },
      { replacements: { a: 'c' }, opts: options('b', ['c', false]) },
      { replacements: { b: null }, opts: options('b', 'c') },
    ];
    for (const { replacements, opts } of cases) {
      await expect(save(alice, v1, 'groupe', { options: opts, replacements }))
        .rejects.toThrow(/OPTION_REPLACEMENT_INVALID/);
    }
  });

  test('remplacement : les dossiers, y compris anciens, passent sur l option designee ; journalise', async () => {
    await save(alice, v1, 'groupe', { options: options('b', 'c'), replacements: { a: 'c' } });
    expect((await db.admin.query(
      'select allowed_values from public.template_field where id=$1', [await fieldId(v1, 'groupe')])).rows[0].allowed_values)
      .toEqual(['b', 'c']);
    expect(await patientData(p1)).toMatchObject({ groupe: 'c' });
    expect(await patientData(pShadow)).toEqual({ groupe: 'c' });
    expect(await patientData(p2)).toMatchObject({ groupe: 'b' });
    expect(await logs('option_retirement', 'groupe')).toEqual(
      [p1, pShadow].sort().map((id) => ({
        entity: 'patient', entity_id: id, old_value: 'a', new_value: 'c', changed_by: alice, source: 'option_retirement',
      })));
  });

  test('vidage : la valeur est retiree de la fiche et l ancienne valeur journalisee', async () => {
    await save(alice, v1, 'groupe', { options: options('c'), replacements: { b: null } });
    expect(await patientData(p2)).not.toHaveProperty('groupe');
    expect((await logs('option_retirement', 'groupe')).find((r) => r.entity_id === p2))
      .toMatchObject({ old_value: 'b', new_value: null });
  });

  test('liste multiple : remplacement sans doublon, option non portee retiree librement', async () => {
    await save(alice, v1, 'symptomes', { options: options('fievre'), replacements: { toux: 'fievre', douleur: null } });
    expect(await encounterData(e1)).toEqual({ symptomes: ['fievre'] });
    expect(await encounterData(e2)).toEqual({});
    expect(await logs('option_retirement', 'symptomes')).toEqual(
      [{ id: e1, o: ['toux', 'fievre'], n: ['fievre'] }, { id: e2, o: ['douleur'], n: null }]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map(({ id, o, n }) => ({ entity: 'encounter', entity_id: id, old_value: o, new_value: n, changed_by: alice, source: 'option_retirement' })));
  });

  test('retirer TOUTES les options (liste envoyee a null) vide les valeurs designees', async () => {
    const before = await patientData(pShadow);
    expect(before).toEqual({ groupe: 'c' });
    await as(alice, `
      select public.update_template_field(
        p_field_id => f.id, p_field_key => f.field_key, p_label => f.label, p_description => f.description,
        p_default_value => f.default_value, p_scope => f.scope, p_section => f.section, p_type => f.type,
        p_required => f.required, p_is_multiple => f.is_multiple, p_missing_reasons => f.missing_reasons,
        p_allowed_options => null, p_formula => f.formula, p_option_replacements => '{"c":null}'::jsonb,
        p_allowed_values => null)
        from public.template_field f where f.template_version_id = $1 and f.field_key = 'groupe'`, [v1]);
    expect(await patientData(pShadow)).toEqual({});
    expect(await patientData(p1)).not.toHaveProperty('groupe');
    expect((await db.admin.query(
      'select allowed_values, allowed_options from public.template_field where id=$1', [await fieldId(v1, 'groupe')])).rows[0])
      .toEqual({ allowed_values: null, allowed_options: null });
    // Pour la suite : une liste a nouveau portee par une fiche.
    await save(alice, v1, 'groupe', { options: options('a', 'b') });
    await db.admin.query(`update public.patient set data = data || '{"groupe":"a"}' where id=$1`, [p2]);
  });

  test('une ecriture directe ne peut toujours pas faire disparaitre une option portee', async () => {
    await expect(db.admin.query(
      "update public.template_field set allowed_values='[]'::jsonb where id=$1", [await fieldId(v1, 'groupe')]))
      .rejects.toThrow(/OPTION_REPLACEMENT_REQUIRED/);
  });
});

describe('regles d une version utilisee', () => {
  test('ajouter, modifier et supprimer une regle sont acceptes', async () => {
    const [{ id }] = await as<{ id: string }>(alice,
      `insert into public.validation_rule(template_version_id,rule,message,severity)
       values ($1,'{"operator":"greater_or_equal","left_field":"age","right_field":"poids"}','age >= poids','warn') returning id`, [v1]);
    await as(alice, "update public.validation_rule set message='age >= poids (revu)' where id=$1", [id]);
    await as(alice, 'delete from public.validation_rule where id=$1', [id]);
    expect((await db.admin.query('select count(*)::int n from public.validation_rule where id=$1', [id])).rows[0].n).toBe(0);
  });

  test('le lot de regles est accepte', async () => {
    const payload = JSON.stringify({
      condition: { field: 'age', operator: 'greater_than', value: 120 }, effect: 'required', targets: ['poids'],
    });
    const [{ preview }] = await as<{ preview: { inUse: boolean; locked: boolean; fingerprint: string } }>(alice,
      'select public.preview_rule_batch($1,$2::jsonb) preview', [v1, payload]);
    // `inUse` reste expose a titre informatif ; seul `locked` fige le panneau.
    expect(preview).toMatchObject({ inUse: true, locked: false });
    const [{ receipt }] = await as<{ receipt: { created: unknown[] } }>(alice,
      'select public.create_rule_batch($1,gen_random_uuid(),$2::jsonb,$3) receipt', [v1, payload, preview.fingerprint]);
    expect(receipt.created).toHaveLength(1);
  });

  test('un tiers reste refuse', async () => {
    await expect(as(bob,
      `insert into public.validation_rule(template_version_id,rule,message,severity)
       values ($1,'{"operator":"greater_or_equal","left_field":"age","right_field":"poids"}','x','warn')`, [v1]))
      .rejects.toThrow();
  });
});

describe('supprimer une variable deja renseignee', () => {
  test('une regle qui la cite bloque encore la suppression ; une fois retiree, la suppression passe', async () => {
    const poids = (await fieldId(v1, 'poids'))!;
    await expect(as(alice, 'select public.delete_template_field($1)', [poids])).rejects.toThrow();
    expect(await patientData(p1)).toMatchObject({ poids: 70 });

    await as(alice, "delete from public.validation_rule where template_version_id=$1 and rule::text like '%poids%'", [v1]);
    await as(alice, 'select public.delete_template_field($1)', [poids]);

    expect(await fieldId(v1, 'poids')).toBeUndefined();
    expect(await patientData(p1)).not.toHaveProperty('poids');
    expect(await patientData(p0)).toEqual({ taille: 180, commentaire: 'ancienne' });
    expect(await logs('field_deletion', 'poids')).toEqual([p0, p1].sort().map((id) => ({
      entity: 'patient', entity_id: id, old_value: id === p0 ? 82 : 70, new_value: null, changed_by: alice, source: 'field_deletion',
    })));
    // Rejouer la suppression ne fait rien et ne journalise rien de plus.
    await as(alice, 'select public.delete_template_field($1)', [poids]);
    expect(await logs('field_deletion', 'poids')).toHaveLength(2);
  });

  test('un tiers ne peut pas supprimer', async () => {
    await expect(as(bob, 'select public.delete_template_field($1)', [await fieldId(v1, 'commentaire')]))
      .rejects.toThrow(/non autorisee/);
    expect(await patientData(p1)).toHaveProperty('commentaire');
  });

  test('une version publiee reste figee', async () => {
    const published = (await db.admin.query(
      "insert into template_version(template_id,version_number,status) values($1,3,'published') returning id", [template])).rows[0].id;
    await db.admin.query(`insert into template_field
        (template_version_id,field_key,label,scope,section,type,allowed_values,display_order)
      values ($1,'age','Age','patient','clinique','number',null,0)`, [published]);
    await expect(as(alice, 'select public.delete_template_field($1)', [await fieldId(published, 'age')]))
      .rejects.toThrow(/immuable/);
    await expect(save(alice, published, 'age', { key: 'age_ans' })).rejects.toThrow(/immuable/);
    await expect(as(alice,
      `insert into public.validation_rule(template_version_id,rule,message,severity)
       values ($1,'{"operator":"greater_or_equal","left_field":"age","right_field":"age"}','x','warn')`, [published]))
      .rejects.toThrow();
    expect(await fieldId(published, 'age')).toBeDefined();
  });
});

describe('nouvelle version courante sans dossier, dossiers anciens portant la meme cle', () => {
  test('retirer une option portee par les dossiers anciens exige un remplacement, puis les reecrit', async () => {
    // Cas courant apres une evolution : la version courante v3 n'a encore aucun dossier, mais
    // les dossiers de v1 portent `groupe`, que v1 definit aussi. Leur enregistrement valide
    // la definition courante : retirer l'option sans traiter leurs valeurs les casserait.
    const v3 = (await db.admin.query(
      "insert into template_version(template_id,version_number,status) values($1,4,'draft') returning id", [template])).rows[0].id;
    await db.admin.query(`insert into template_field
        (template_version_id,field_key,label,scope,section,type,allowed_values,display_order)
      values ($1,'groupe','Groupe','patient','clinique','select','["a","b"]',0)`, [v3]);
    await db.admin.query('update public.base set current_template_version_id=$2 where id=$1', [base, v3]);
    try {
      expect((await db.admin.query('select public.template_field_in_use($1) u', [await fieldId(v3, 'groupe')])).rows[0].u).toBe(false);
      expect(await patientData(p2)).toMatchObject({ groupe: 'a' });
      await expect(save(alice, v3, 'groupe', { options: options('b') })).rejects.toThrow(/OPTION_REPLACEMENT_REQUIRED/);
      await save(alice, v3, 'groupe', { options: options('b'), replacements: { a: 'b' } });
      expect(await patientData(p2)).toMatchObject({ groupe: 'b' });
    } finally {
      await db.admin.query('update public.base set current_template_version_id=$2 where id=$1', [base, v1]);
    }
  });
});

describe('reecriture des donnees : fonctions pures', () => {
  test('rename, remove, replace_options', async () => {
    const q = async (sql: string) => (await db.admin.query(`select ${sql} as r`)).rows[0].r;
    expect(await q(`public.field_data_rewrite('{"a":1,"b":2}','rename','a','c',null)`)).toEqual({ b: 2, c: 1 });
    expect(await q(`public.field_data_rewrite('{"a":1,"b":2}','remove','a',null,null)`)).toEqual({ b: 2 });
    expect(await q(`public.field_data_rewrite('{"b":2}','remove','a',null,null)`)).toEqual({ b: 2 });
    expect(await q(`public.field_data_rewrite('{"s":["x","y","z"]}','replace_options','s',null,'{"x":"z","y":null}')`))
      .toEqual({ s: ['z'] });
    expect(await q(`public.field_data_rewrite('{"s":{"__missing__":"inconnu"}}','replace_options','s',null,'{"x":null}')`))
      .toEqual({ s: { __missing__: 'inconnu' } });
    expect(await q(`public.text_array_key_renamed(array['a','b','c'],'a','c')`)).toEqual(['c', 'b']);
  });
});
