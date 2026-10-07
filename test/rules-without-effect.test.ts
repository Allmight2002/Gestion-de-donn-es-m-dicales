// L74e — refus à l'écriture des règles sans effet (docs/l74-contexte-patient-occurrences.md,
// §2.2 P1 à P5, §4 D5, §9.1 test 11 partie D5). Migration 20261007130000_rules_without_effect.sql.
//
// Instance PostgreSQL embarquée sur loopback, données entièrement fictives : jamais de cloud.
// Les écritures « de l'éditeur » passent par `asUser` (personne authentifiée, RLS). Les règles
// déjà enregistrées avant L74e sont posées par la connexion d'administration, sans identité.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

const ALICE = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ADMIN = '1f111111-1111-1111-1111-111111111111';

type Row = Record<string, unknown>;
type Rule = Record<string, unknown>;

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
});

afterAll(async () => {
  await db?.stop();
});

const as = (sql: string, params: unknown[] = []) =>
  db.asUser(ALICE, async (client: Client) => {
    await client.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`);
    return (await client.query(sql, params)).rows as Row[];
  });

/** Message et détail JSON d'un refus. */
async function refusal(promise: Promise<unknown>): Promise<{ message: string; detail: Row }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message: string; detail?: string };
    let detail: Row = {};
    try { detail = e.detail ? JSON.parse(e.detail) : {}; } catch { /* détail non JSON */ }
    return { message: e.message, detail };
  }
  throw new Error('Refus attendu, succès obtenu');
}

// --- Fixture -------------------------------------------------------------------------------
//
//   perm, perm2          variables permanentes, tronc commun
//   enc_a, enc_b         rencontre ordinaire, tronc commun
//   bloc_p  (racine)     bp (permanente)        └─ lesions (groupe) : g1, g2
//   bloc_e  (racine)     be (rencontre)         └─ suivis (groupe)  : s1
//   plain   (racine)     plain_var (rencontre)  └─ plain_child (sous-section ordinaire) : pc
//   other   (racine)     other_var (rencontre)
//   implants (groupe racine) : i1

async function newVersion(): Promise<string> {
  const template = (await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false) returning id`,
    [`L74e ${randomUUID().slice(0, 8)}`, ALICE],
  )).rows[0].id as string;
  return (await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, 1, 'draft', $2) returning id`,
    [template, ALICE],
  )).rows[0].id as string;
}

async function addSection(version: string, key: string, parent: string | null, repeatable = false) {
  await db.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3,
       (select id from public.template_section where template_version_id=$1 and section_key=$4),
       (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1),
       $5)`,
    [version, key, `Bloc ${key}`, parent, repeatable],
  );
}

async function addField(version: string, key: string, scope: 'patient' | 'encounter', section: string | null) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
     values ($1, $2, $3, $4, $5,
       (select id from public.template_section where template_version_id=$1 and section_key=$5),
       'text', false,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1))`,
    [version, key, `Libellé ${key}`, scope, section],
  );
}

async function fixture(): Promise<string> {
  const v = await newVersion();
  await addField(v, 'perm', 'patient', null);
  await addField(v, 'perm2', 'patient', null);
  await addField(v, 'enc_a', 'encounter', null);
  await addField(v, 'enc_b', 'encounter', null);
  await addSection(v, 'bloc_p', null);
  await addField(v, 'bp', 'patient', 'bloc_p');
  await addSection(v, 'lesions', 'bloc_p', true);
  await addField(v, 'g1', 'encounter', 'lesions');
  await addField(v, 'g2', 'encounter', 'lesions');
  await addSection(v, 'bloc_e', null);
  await addField(v, 'be', 'encounter', 'bloc_e');
  await addSection(v, 'suivis', 'bloc_e', true);
  await addField(v, 's1', 'encounter', 'suivis');
  await addSection(v, 'plain', null);
  await addField(v, 'plain_var', 'encounter', 'plain');
  await addSection(v, 'plain_child', 'plain');
  await addField(v, 'pc', 'encounter', 'plain_child');
  await addSection(v, 'other', null);
  await addField(v, 'other_var', 'encounter', 'other');
  await addSection(v, 'implants', null, true);
  await addField(v, 'i1', 'encounter', 'implants');
  return v;
}

const show = (driver: string, target: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { field: target, operator: 'visible' },
});
const require = (driver: string, target: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { field: target, operator: 'required' },
});
const showBlock = (driver: string, section: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { section, operator: 'visible' },
});
const compare = (left: string, right: string): Rule => ({ operator: 'greater_than', left_field: left, right_field: right });

/** Écriture de l'éditeur : insertion directe, comme `addRule` côté web. */
const authorRule = (version: string, rule: Rule) => as(
  `insert into public.validation_rule(template_version_id, rule, message, severity)
   values ($1, $2, 'Règle fictive L74e', 'block') returning id`,
  [version, JSON.stringify(rule)],
);

/** Règle enregistrée avant L74e (aucune identité : écriture de maintenance). */
const legacyRule = async (version: string, rule: Rule) => (await db.admin.query(
  `insert into public.validation_rule(template_version_id, rule, message, severity)
   values ($1, $2, 'Règle ancienne L74e', 'block') returning id`,
  [version, JSON.stringify(rule)],
)).rows[0].id as string;

const ruleCount = async (version: string) => Number((await db.admin.query(
  'select count(*)::int n from public.validation_rule where template_version_id=$1', [version])).rows[0].n);

async function expectWithoutEffect(promise: Promise<unknown>, problem: string) {
  const { message, detail } = await refusal(promise);
  expect(message).toMatch(/^Regle sans effet : /);
  expect(detail).toEqual({ code: 'RULE_WITHOUT_EFFECT', problem });
  // Aucune valeur ni aucun libellé de variable dans le message.
  expect(message).not.toMatch(/oui|Libellé/);
}

// --- Tableau du cadrage ---------------------------------------------------------------------

describe('test 11 (D5) : refus à l\'écriture', () => {
  let v: string;
  beforeAll(async () => { v = await fixture(); });

  test('visible sur une variable : même espace, ou pilote permanent vers un groupe', async () => {
    await authorRule(v, show('enc_a', 'enc_b'));
    await authorRule(v, show('perm', 'perm2'));
    await authorRule(v, show('g1', 'g2'));
    await authorRule(v, show('perm', 'g1')); // D2, groupe en sous-section
    await authorRule(v, show('perm', 'i1')); // D2, groupe racine
    await authorRule(v, show('plain_var', 'pc')); // sous-section ordinaire = rencontre
    // P1 : rencontre ordinaire → groupe.
    await expectWithoutEffect(authorRule(v, show('enc_a', 'g2')), 'visible_cross_space');
    await expectWithoutEffect(authorRule(v, show('be', 's1')), 'visible_cross_space');
    // P2 : groupe → rencontre ordinaire, groupe → autre groupe.
    await expectWithoutEffect(authorRule(v, show('g1', 'enc_a')), 'visible_cross_space');
    await expectWithoutEffect(authorRule(v, show('g1', 'i1')), 'visible_cross_space');
  });

  test('required : pilote et cible dans le même espace', async () => {
    await authorRule(v, require('enc_a', 'enc_b'));
    await authorRule(v, require('perm', 'perm2'));
    await authorRule(v, require('g1', 'g2'));
    // P3.
    await expectWithoutEffect(authorRule(v, require('perm', 'g1')), 'required_cross_space');
    await expectWithoutEffect(authorRule(v, require('enc_a', 'g1')), 'required_cross_space');
    await expectWithoutEffect(authorRule(v, require('g1', 'enc_a')), 'required_cross_space');
    await expectWithoutEffect(authorRule(v, require('i1', 'g1')), 'required_cross_space');
    await expectWithoutEffect(authorRule(v, require('perm', 'enc_a')), 'required_cross_space');
  });

  test('comparaison : les deux opérandes dans le même espace', async () => {
    await authorRule(v, compare('enc_a', 'enc_b'));
    await authorRule(v, compare('perm', 'perm2'));
    await authorRule(v, compare('g1', 'g2'));
    // P4.
    await expectWithoutEffect(authorRule(v, compare('perm', 'g1')), 'comparison_cross_space');
    await expectWithoutEffect(authorRule(v, compare('enc_a', 'i1')), 'comparison_cross_space');
    await expectWithoutEffect(authorRule(v, compare('g1', 'i1')), 'comparison_cross_space');
    await expectWithoutEffect(authorRule(v, compare('perm', 'enc_a')), 'comparison_cross_space');
  });

  test('visible sur un bloc portant un groupe enfant : pilote permanent (P5)', async () => {
    await authorRule(v, showBlock('perm', 'bloc_p'));
    await expectWithoutEffect(authorRule(v, showBlock('enc_a', 'bloc_e')), 'block_group_driver');
  });

  test('visible sur un bloc, pilote dans un groupe répétable : refusée (arbitrage du 7 octobre)', async () => {
    await authorRule(v, showBlock('enc_a', 'plain'));
    await expectWithoutEffect(authorRule(v, showBlock('g1', 'other')), 'block_driver_in_group');
    await expectWithoutEffect(authorRule(v, showBlock('i1', 'plain')), 'block_driver_in_group');
    // Pilote dans le groupe enfant du bloc commandé : P5 prime, comme côté web.
    await expectWithoutEffect(authorRule(v, showBlock('s1', 'bloc_e')), 'block_group_driver');
  });

  test('les refus de structure existants gardent leur message', async () => {
    await expect(authorRule(v, show('perm', 'enc_a'))).rejects.toThrow(/meme fiche/);
    await expect(authorRule(v, showBlock('perm', 'bloc_e'))).rejects.toThrow(/meme fiche/);
  });

  test('modification du contenu refusée ; message et gravité seuls acceptés', async () => {
    const [{ id }] = await authorRule(v, show('enc_a', 'enc_b'));
    await expectWithoutEffect(as(
      'update public.validation_rule set rule=$2 where id=$1', [id, JSON.stringify(show('enc_a', 'g1'))],
    ), 'visible_cross_space');
    await as("update public.validation_rule set message='Nouveau message', severity='warn' where id=$1", [id]);
    expect((await db.admin.query('select rule from public.validation_rule where id=$1', [id])).rows[0].rule)
      .toEqual(show('enc_a', 'enc_b'));
  });

  test('le lot de règles refuse une cible sans effet sans rien créer', async () => {
    const before = await ruleCount(v);
    const payload = JSON.stringify({
      condition: { field: 'enc_a', operator: 'equals', value: 'oui' },
      effect: 'required',
      targets: ['enc_b', 'g1'],
    });
    const [{ result: preview }] = await as('select public.preview_rule_batch($1,$2::jsonb) as result', [v, payload]);
    const { detail } = await refusal(as(
      'select public.create_rule_batch($1, gen_random_uuid(), $2::jsonb, $3)',
      [v, payload, (preview as Row).fingerprint],
    ));
    expect(detail).toMatchObject({ code: 'rule_batch_refused', target: 'g1' });
    expect(String(detail.reason)).toMatch(/^Regle sans effet : /);
    expect(await ruleCount(v)).toBe(before);
  });
});

// --- Cas symétrique de P5 : garde des sections ---------------------------------------------

describe('test 11 (D5) : garde des sections, cas symétrique de P5', () => {
  test('rendre répétable une sous-section sous un bloc commandé par une variable de rencontre', async () => {
    const v = await fixture();
    await authorRule(v, showBlock('enc_a', 'plain'));
    await expectWithoutEffect(as(
      `update public.template_section set is_repeatable=true
        where template_version_id=$1 and section_key='plain_child'`, [v],
    ), 'block_group_driver');
    await expectWithoutEffect(as(
      `insert into public.template_section(template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
       select $1, 'nouveau_groupe', 'Nouveau groupe', id, 99, true
         from public.template_section where template_version_id=$1 and section_key='plain'`, [v],
    ), 'block_group_driver');
  });

  test('déplacer un groupe sous un bloc commandé par une variable non permanente', async () => {
    const v = await fixture();
    await authorRule(v, showBlock('enc_a', 'plain'));
    const implants = (await db.admin.query(
      "select id from public.template_section where template_version_id=$1 and section_key='implants'", [v],
    )).rows[0].id as string;
    await expectWithoutEffect(as('select public.move_template_section($1,$2,$3)', [v, implants, 'plain']),
      'block_group_driver');
    // Sous un bloc commandé par une variable permanente, ou sans règle : accepté.
    await authorRule(v, showBlock('perm', 'bloc_p'));
    await as('select public.move_template_section($1,$2,$3)', [v, implants, 'bloc_p']);
    await as('select public.move_template_section($1,$2,$3)', [v, implants, 'other']);
    await as('select public.move_template_section($1,$2,null)', [v, implants]);
  });
});

// --- Les règles existantes ne bloquent jamais --------------------------------------------

describe('test 11 (D5) : une version qui porte déjà des règles sans effet reste modifiable', () => {
  let v: string;
  let p1: string;
  beforeAll(async () => {
    v = await fixture();
    p1 = await legacyRule(v, show('enc_a', 'g1')); // P1
    await legacyRule(v, require('perm', 'g2')); // P3
    await legacyRule(v, compare('perm', 'i1')); // P4
    await legacyRule(v, showBlock('enc_a', 'bloc_e')); // P5
    await legacyRule(v, showBlock('g1', 'plain')); // pilote dans un groupe
  });

  test('le rejeu des invariants accepte la version', async () => {
    await db.admin.query('select public.validate_template_version_invariants($1)', [v]);
    await as('select public.validate_template_version_invariants($1)', [v]).catch((error: Error) => {
      // Fonction réservée au serveur : seul le refus de droit est admissible ici.
      expect(error.message).toMatch(/permission denied/);
    });
  });

  test('ajout de variable, réordonnancement, déplacement de section, nouvelle règle valide', async () => {
    await as(
      `insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order)
       values ($1, 'ajout', 'Ajout', 'encounter', null, 'text', 99)`, [v],
    );
    const ids = (await db.admin.query(
      'select id from public.template_field where template_version_id=$1 order by display_order desc', [v],
    )).rows.map((row) => row.id as string);
    await as('select public.reorder_template_fields($1,$2::uuid[])', [v, ids]);
    const other = (await db.admin.query(
      "select id from public.template_section where template_version_id=$1 and section_key='other'", [v],
    )).rows[0].id as string;
    await as('select public.move_template_section($1,$2,$3)', [v, other, 'plain']);
    await as('select public.move_template_section($1,$2,null)', [v, other]);
    // Le groupe déjà sous le bloc P5 se déplace ailleurs.
    const suivis = (await db.admin.query(
      "select id from public.template_section where template_version_id=$1 and section_key='suivis'", [v],
    )).rows[0].id as string;
    await as('select public.move_template_section($1,$2,null)', [v, suivis]);
    await authorRule(v, show('enc_a', 'ajout'));
  });

  test('message et gravité d\'une règle sans effet restent modifiables', async () => {
    await as("update public.validation_rule set message='Message corrigé', severity='warn' where id=$1", [p1]);
    await expectWithoutEffect(as(
      'update public.validation_rule set rule=$2 where id=$1', [p1, JSON.stringify(show('enc_b', 'g1'))],
    ), 'visible_cross_space');
  });

  test('renommer une clé citée par une règle sans effet', async () => {
    await as(`
      select public.update_template_field(
        p_field_id => f.id, p_field_key => 'enc_a_renomme', p_label => f.label, p_description => f.description,
        p_default_value => f.default_value, p_scope => f.scope, p_section => f.section, p_type => f.type,
        p_required => f.required, p_is_multiple => f.is_multiple, p_missing_reasons => f.missing_reasons,
        p_allowed_options => f.allowed_options, p_formula => f.formula, p_encounter_types => f.encounter_types,
        p_allowed_values => f.allowed_values, p_min_value => f.min_value, p_max_value => f.max_value, p_unit => f.unit)
        from public.template_field f where f.template_version_id = $1 and f.field_key = 'enc_a'`, [v]);
    expect((await db.admin.query('select rule from public.validation_rule where id=$1', [p1])).rows[0].rule)
      .toEqual(show('enc_a_renomme', 'g1'));
  });

  test('la recopie de version reprend les règles sans effet', async () => {
    // Version suivante d'un jeu personnel, par sa propriétaire.
    const [template] = await as('select template_id from public.template_version where id=$1', [v]);
    const [next] = await as('select (public.create_next_personal_template_version($1)).id as id', [template.template_id]);
    expect(await ruleCount(next.id as string)).toBe(await ruleCount(v));
    // Duplication par le gestionnaire de modèles.
    const [copy] = await db.asUser(TEMPLATE_ADMIN, async (client: Client) =>
      (await client.query('select (public.duplicate_template_version($1)).id as id', [v])).rows as Row[]);
    expect(await ruleCount(copy.id as string)).toBe(await ruleCount(v));
    // La copie n'est pas une porte : une règle sans effet NOUVELLE y reste refusée.
    await expectWithoutEffect(authorRule(next.id as string, require('enc_b', 'g2')), 'required_cross_space');
  });
});
