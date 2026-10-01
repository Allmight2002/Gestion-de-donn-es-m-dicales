// Regles et formules suivent le renommage de la variable qu'elles citent
// (migration 20260930130000_field_key_rename_follows.sql).
//
// Ce que ces tests protegent : renommer le code d'une variable dans l'editeur reecrit, dans la
// meme operation, chaque regle de la version qui la cite (left_field, right_field, if.field,
// then.field) et chaque formule qui l'utilise, sans toucher au reste ; un renommage refuse ne laisse aucune regle
// a moitie reecrite ; le pilote diagnostique et son compagnon `_autre` restent non renommables,
// avec un refus explicite.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let alice: string;
let version: string;

const as = <T = Record<string, unknown>>(uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c: Client) => {
    await c.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`);
    return (await c.query(sql, args)).rows as T[];
  });

/** Renomme par la RPC de l'editeur, tous les autres attributs inchanges. */
const rename = (uid: string, versionId: string, from: string, to: string) => as(uid, `
  select public.update_template_field(
    p_field_id => f.id, p_field_key => $3, p_label => f.label, p_description => f.description,
    p_default_value => f.default_value, p_scope => f.scope, p_section => f.section, p_type => f.type,
    p_required => f.required, p_is_multiple => f.is_multiple, p_missing_reasons => f.missing_reasons,
    p_allowed_options => f.allowed_options, p_formula => f.formula, p_encounter_types => f.encounter_types,
    p_allowed_values => f.allowed_values, p_min_value => f.min_value, p_max_value => f.max_value, p_unit => f.unit)
    from public.template_field f where f.template_version_id = $1 and f.field_key = $2`, [versionId, from, to]);

const rules = async (versionId: string) => (await db.admin.query(
  'select id, rule, message, severity from public.validation_rule where template_version_id=$1 order by message',
  [versionId])).rows as { id: string; rule: Record<string, unknown>; message: string; severity: string }[];

const draft = async (name: string) => {
  const template = (await db.admin.query(
    "insert into template(name,owner_user_id,is_global) values($1,$2,false) returning id", [name, alice])).rows[0].id;
  return (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id as string;
};

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;

  version = await draft('Renommage (fictif)');
  await db.admin.query(`insert into template_field
      (template_version_id,field_key,label,scope,type,allowed_values,display_order)
    values ($1,'age','Âge','patient','number',null,0),
           ($1,'poids','Poids','patient','number',null,1),
           ($1,'sexe','Sexe','patient','select','["f","m"]',2),
           ($1,'grossesse','Grossesse','patient','boolean',null,3)`, [version]);
  const add = (rule: object, message: string, severity = 'block') => db.admin.query(
    'insert into validation_rule(template_version_id,rule,message,severity) values($1,$2,$3,$4)', [version, rule, message, severity]);
  await add({ operator: 'greater_or_equal', left_field: 'poids', right_field: 'age' }, '1 comparaison', 'warn');
  await add({ if: { field: 'sexe', operator: 'equals', value: 'f' }, then: { field: 'grossesse', operator: 'visible' } }, '2 affichage');
  await add({ if: { field: 'sexe', operator: 'equals', value: 'm' }, then: { field: 'poids', operator: 'required' } }, '3 obligation');
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('renommer une variable met a jour les regles qui la citent', () => {
  test('les quatre emplacements suivent le nouveau code ; le reste de la regle est intact', async () => {
    const before = await rules(version);

    await rename(alice, version, 'sexe', 'Sexe_patient');
    await rename(alice, version, 'poids', 'Poids-kg');
    await rename(alice, version, 'grossesse', 'grossesse_en_cours');

    const after = await rules(version);
    expect(after.map(({ id, message, severity }) => ({ id, message, severity })))
      .toEqual(before.map(({ id, message, severity }) => ({ id, message, severity })));
    expect(after.map((r) => r.rule)).toEqual([
      { operator: 'greater_or_equal', left_field: 'Poids-kg', right_field: 'age' },
      { if: { field: 'Sexe_patient', operator: 'equals', value: 'f' }, then: { field: 'grossesse_en_cours', operator: 'visible' } },
      { if: { field: 'Sexe_patient', operator: 'equals', value: 'm' }, then: { field: 'Poids-kg', operator: 'required' } },
    ]);

    await rename(alice, version, 'age', 'age_ans');
    expect((await rules(version))[0].rule).toMatchObject({ left_field: 'Poids-kg', right_field: 'age_ans' });
  });

  test('un renommage refuse ne reecrit aucune regle', async () => {
    const before = await rules(version);
    // Code deja pris dans la version : la contrainte d'unicite refuse le renommage.
    await expect(rename(alice, version, 'Sexe_patient', 'age_ans')).rejects.toThrow();
    expect(await rules(version)).toEqual(before);
  });

  test('les formules suivent le renommage d un operande ; un code hors format de formule est refuse explicitement', async () => {
    const v = await draft('Formule (fictif)');
    await db.admin.query(`insert into template_field
        (template_version_id,field_key,label,scope,type,display_order)
      values ($1,'debut','Début','patient','number',0), ($1,'fin','Fin','patient','number',1)`, [v]);
    await db.admin.query(`insert into template_field
        (template_version_id,field_key,label,scope,type,formula,display_order)
      values ($1,'duree','Durée','patient','number','fin - debut',2)`, [v]);
    const formula = async () => (await db.admin.query(
      "select formula from template_field where template_version_id=$1 and field_key='duree'", [v])).rows[0].formula;

    await rename(alice, v, 'debut', 'heure_debut');
    expect(await formula()).toBe('fin - heure_debut');
    await rename(alice, v, 'fin', 'Fin_op');
    expect(await formula()).toBe('Fin_op - heure_debut');

    // Une formule n'admet ni accent ni tiret : refus nomme, rien n'est ecrit.
    let detail: unknown;
    try { await rename(alice, v, 'Fin_op', 'fin-op'); } catch (e) { detail = JSON.parse((e as { detail: string }).detail); }
    expect(detail).toEqual({ code: 'FIELD_KEY_FORMULA_INCOMPATIBLE', formulaField: 'Durée' });
    expect(await formula()).toBe('Fin_op - heure_debut');

    // Seul le renommage est suivi : le changement de type d'un operande reste refuse.
    await expect(db.admin.query("update template_field set type='text' where template_version_id=$1 and field_key='Fin_op'", [v]))
      .rejects.toThrow(/utilisee par la formule/);
  });

  test('le pilote diagnostique et son compagnon restent non renommables, avec un refus explicite', async () => {
    const v = await draft('Diagnostic (fictif)');
    await db.admin.query(`insert into template_field
        (template_version_id,field_key,label,scope,type,allowed_values,display_order)
      values ($1,'diag','Diagnostic','patient','select','["x","y"]',0),
             ($1,'diag_autre','Autre diagnostic','patient','text',null,1)`, [v]);
    await db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1', [v, JSON.stringify([
      { scope: 'patient', diagnosisFieldKey: 'diag', terminologyReleaseId: null, commonOnlyCodes: [] }])]);

    await expect(rename(alice, v, 'diag', 'diagnostic')).rejects.toThrow('FIELD_KEY_DIAGNOSIS_BOUND');
    await expect(rename(alice, v, 'diag_autre', 'diag_libre')).rejects.toThrow('FIELD_KEY_DIAGNOSIS_BOUND');
    const keys = (await db.admin.query('select field_key from template_field where template_version_id=$1 order by 1', [v])).rows;
    expect(keys.map((r) => r.field_key)).toEqual(['diag', 'diag_autre']);
  });
});
