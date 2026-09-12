// UX-14(c) — contrat serveur de la creation groupee de regles.
//
// Ce que ces tests protegent : une meme condition appliquee a plusieurs cibles produit des
// regles ORDINAIRES, en une transaction ; un refus n'en laisse aucune ; un rejeu ne double
// rien ; une version modifiee depuis l'apercu est refusee au lieu d'etre ecrasee.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

// Une version SERVIE a des dossiers est figee par les gardes existants : la fixture cree donc
// un jeu de variables dedie, non rattache a une base, comme le ferait un medecin qui prepare
// une nouvelle version avant de la publier.
const TEMPLATE = '30000000-0000-0000-0000-0000000000c1';
const VERSION = '30000000-0000-0000-0000-0000000000d1';
const LOCKED_VERSION = '30000000-0000-0000-0000-0000000000d2';
const PUBLISHED_VERSION = '10000000-0000-0000-0000-0000000000a2';

const FIELDS: [string, string, string, string | null][] = [
  ['outcome', 'Evolution', 'select', '["gueri","deces"]'],
  ['ct_result', 'Resultat TDM', 'text', null],
  ['hemoglobin', 'Hemoglobine', 'number', null],
  ['death_date', 'Date de deces', 'date', null],
  ['glasgow_score', 'Score de Glasgow', 'integer', null],
  ['discharge_date', 'Date de sortie', 'date', null],
];

let db: TestDb;
let owner: string;
let other: string;

const as = (uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c) => (await c.query(sql, args)).rows);

const condition = { field: 'outcome', operator: 'equals', value: 'deces' };
const payload = (targets: string[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ condition, effect: 'required', targets, ...extra });

const preview = async (targets: string[], uid = owner, version = VERSION) =>
  (await as(uid, 'select public.preview_rule_batch($1,$2::jsonb) as result', [version, payload(targets)]))[0].result;

const create = async (
  targets: string[], fingerprint: string, operation = randomUUID(), uid = owner,
  version = VERSION, extra: Record<string, unknown> = {},
) => (await as(uid, 'select public.create_rule_batch($1,$2,$3::jsonb,$4) as result',
  [version, operation, payload(targets, extra), fingerprint]))[0].result;

const ruleCount = async () =>
  Number((await db.admin.query('select count(*) from public.validation_rule where template_version_id=$1', [VERSION])).rows[0].count);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  owner = (await db.admin.query('select owner_user_id from public.template where id=$1',
    ['10000000-0000-0000-0000-000000000001'])).rows[0].owner_user_id;
  other = (await db.admin.query("select id from auth.users where email='bob@demo.test'")).rows[0].id;
  await db.admin.query('insert into public.template (id, name, specialty, owner_user_id, is_global) values ($1,$2,$3,$4,false)',
    [TEMPLATE, 'Lot de regles (fictif)', 'neurochirurgie', owner]);
  for (const [id, number] of [[VERSION, 1], [LOCKED_VERSION, 2]] as [string, number][]) {
    await db.admin.query('insert into public.template_version (id, template_id, version_number, status, created_by) values ($1,$2,$3,$4,$5)',
      [id, TEMPLATE, number, 'draft', owner]);
    await db.admin.query('insert into public.template_section (template_version_id, section_key, label, display_order) values ($1,$2,$3,0)',
      [id, 'clinique', 'Clinique']);
    let order = 0;
    for (const [key, label, type, allowed] of FIELDS) {
      order += 1;
      await db.admin.query(
        `insert into public.template_field
           (template_version_id, field_key, label, scope, section, type, allowed_values, required, allow_missing_codes, display_order)
         values ($1,$2,$3,'encounter','clinique',$4,$5::jsonb,false,true,$6)`,
        [id, key, label, type, allowed, order],
      );
    }
  }
  // Doublon exact prepare pour T27 : il doit etre signale, jamais recree ni ecrase.
  await db.admin.query(
    `insert into public.validation_rule (template_version_id, rule, message, severity)
     values ($1, '{"if":{"field":"outcome","operator":"equals","value":"deces"},"then":{"field":"death_date","operator":"required"}}'::jsonb, null, 'block')`,
    [VERSION],
  );
}, 180_000);
afterAll(async () => { await db?.stop(); });

describe('UX-14(c) création groupée de règles', () => {
  test('T27 : une condition, plusieurs cibles, des règles ordinaires en une opération', async () => {
    const before = await ruleCount();
    const plan = await preview(['ct_result', 'hemoglobin', 'death_date']);
    // Le doublon exact du seed est annoncé comme tel, jamais recréé ni écrasé.
    expect(plan.create.map((item: { target: string }) => item.target)).toEqual(['ct_result', 'hemoglobin']);
    expect(plan.duplicates.map((item: { target: string }) => item.target)).toEqual(['death_date']);
    expect(plan.invalid).toEqual([]);
    expect(plan.locked).toBe(false);

    const receipt = await create(['ct_result', 'hemoglobin', 'death_date'], plan.fingerprint);
    expect(receipt.created).toHaveLength(2);
    expect(receipt.duplicates).toHaveLength(1);
    expect(await ruleCount()).toBe(before + 2);

    // Des règles unitaires ordinaires : même forme que celles du formulaire guidé.
    const created = (await db.admin.query('select rule, severity, message from public.validation_rule where id = any($1)',
      [receipt.created.map((item: { id: string }) => item.id)])).rows;
    expect(created.map((row) => row.rule).sort((a, b) => (a.then.field < b.then.field ? -1 : 1))).toEqual([
      { if: condition, then: { field: 'ct_result', operator: 'required' } },
      { if: condition, then: { field: 'hemoglobin', operator: 'required' } },
    ]);
    expect(created.every((row) => row.severity === 'block' && row.message === null)).toBe(true);
  });

  test('T29 : le rejeu de la même opération ne crée rien de plus et rend le même reçu', async () => {
    const operation = randomUUID();
    const plan = await preview(['glasgow_score']);
    const first = await create(['glasgow_score'], plan.fingerprint, operation);
    const before = await ruleCount();
    // Même clé, même charge : la réponse perdue se rejoue sans produire de doublon, alors même
    // que l'empreinte attendue est désormais périmée par cette création.
    const replay = await create(['glasgow_score'], plan.fingerprint, operation);
    expect(replay).toEqual(first);
    expect(await ruleCount()).toBe(before);

    // Même clé, charge différente : refus explicite, jamais une seconde interprétation.
    await expect(create(['ct_result'], plan.fingerprint, operation)).rejects.toThrow('RULE_BATCH_OPERATION_CONFLICT');
  });

  test('T28 : une cible inconnue refuse tout le lot, sans écriture partielle', async () => {
    const before = await ruleCount();
    const plan = await preview(['discharge_date', 'cible_inexistante']);
    expect(plan.create.map((item: { target: string }) => item.target)).toEqual(['discharge_date']);
    expect(plan.invalid[0].target).toBe('cible_inexistante');
    expect(plan.invalid[0].reason).toMatch(/inconnu/i);

    await expect(create(['discharge_date', 'cible_inexistante'], plan.fingerprint))
      .rejects.toThrow('RULE_BATCH_INVALID_TARGET');
    expect(await ruleCount()).toBe(before);
  });

  test('T28 : un cycle d’affichage est refusé avec son motif, et rien n’est créé', async () => {
    const before = await ruleCount();
    await db.admin.query(
      `insert into public.validation_rule (template_version_id, rule, message, severity)
       values ($1, '{"if":{"field":"ct_result","operator":"equals","value":"x"},"then":{"field":"hemoglobin","operator":"visible"}}'::jsonb, null, 'block')`,
      [VERSION],
    );
    const plan = await preview(['ct_result']);
    const cyclique = JSON.stringify({ condition: { field: 'hemoglobin', operator: 'equals', value: 1 }, effect: 'visible', targets: ['ct_result'] });
    const refus = as(owner, 'select public.create_rule_batch($1,$2,$3::jsonb,$4) as result',
      [VERSION, randomUUID(), cyclique, plan.fingerprint]);
    await expect(refus).rejects.toThrow('RULE_BATCH_INVALID_TARGET');
    expect(await ruleCount()).toBe(before + 1); // la seule règle ajoutée est celle du fixture
  });

  test('T28 : une version modifiée depuis l’aperçu produit un conflit structuré', async () => {
    const plan = await preview(['ct_result']);
    await db.admin.query(
      `insert into public.validation_rule (template_version_id, rule, message, severity)
       values ($1, '{"if":{"field":"outcome","operator":"equals","value":"gueri"},"then":{"field":"glasgow_score","operator":"required"}}'::jsonb, null, 'warn')`,
      [VERSION],
    );
    const before = await ruleCount();
    await expect(create(['ct_result'], plan.fingerprint)).rejects.toThrow('RULE_BATCH_CONFLICT');
    expect(await ruleCount()).toBe(before);
    // L'empreinte relue permet de reprendre sans perdre la condition ni les cibles.
    const repris = await preview(['ct_result']);
    expect(repris.fingerprint).not.toBe(plan.fingerprint);
  });

  test('refuse un autre compte, l’accès anonyme et les charges hors contrat', async () => {
    const plan = await preview(['ct_result']);
    await expect(preview(['ct_result'], other)).rejects.toThrow('RULE_BATCH_FORBIDDEN');
    await expect(create(['ct_result'], plan.fingerprint, randomUUID(), other)).rejects.toThrow('RULE_BATCH_FORBIDDEN');

    const anon = await db.admin.query(
      "select has_function_privilege('anon', 'public.create_rule_batch(uuid,uuid,jsonb,text)', 'EXECUTE') as allowed",
    );
    expect(anon.rows[0].allowed).toBe(false);

    // Le contrat n'accepte ni un effet inventé, ni une liste vide, ni une clé inconnue.
    for (const invalide of [
      { condition, effect: 'hidden', targets: ['ct_result'] },
      { condition, effect: 'required', targets: [] },
      { condition, effect: 'required', targets: ['ct_result'], severity: 'fatal' },
      { condition, effect: 'required', targets: ['ct_result'], inconnu: true },
    ]) {
      await expect(as(owner, 'select public.preview_rule_batch($1,$2::jsonb) as result', [VERSION, JSON.stringify(invalide)]))
        .rejects.toThrow('RULE_BATCH_INVALID');
    }
  });

  test('une version gelée refuse le lot avant toute écriture', async () => {
    const plan = await preview(['ct_result'], owner, LOCKED_VERSION);
    expect(plan.locked).toBe(false);
    // Publication par la RPC prévue : le gel n'est pas simulé par une écriture directe.
    await as(owner, 'select public.publish_template_version($1)', [LOCKED_VERSION]);

    await expect(create(['ct_result'], plan.fingerprint, randomUUID(), owner, LOCKED_VERSION))
      .rejects.toThrow('RULE_BATCH_VERSION_LOCKED');
    expect(Number((await db.admin.query(
      'select count(*) from public.validation_rule where template_version_id=$1', [LOCKED_VERSION])).rows[0].count)).toBe(0);
    // L'aperçu reste lisible et annonce le gel plutôt que de promettre une création.
    expect((await preview(['ct_result'], owner, LOCKED_VERSION)).locked).toBe(true);
  });

  test('la version publiée d’un modèle global n’est pas ouverte à un médecin', async () => {
    await expect(preview(['ct_result'], owner, PUBLISHED_VERSION)).rejects.toThrow('RULE_BATCH_FORBIDDEN');
  });
});
