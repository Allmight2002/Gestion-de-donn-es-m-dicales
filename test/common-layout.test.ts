// UX-16 — contrat serveur des rubriques communes.
//
// Ce que ces tests protegent : une organisation enregistree decrit EXACTEMENT les variables
// communes de la version — aucune dupliquee, aucune oubliee ; un refus n'ecrit rien ; un rejeu
// ne cree pas une seconde rubrique ; une version gelee ou modifiee depuis l'ecran est refusee ;
// et une copie de version emporte l'organisation sans referencer la source.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

const TEMPLATE = '40000000-0000-0000-0000-0000000000c1';
const DEFAULT_TEMPLATE = '40000000-0000-0000-0000-0000000000c2';
const VERSION = '40000000-0000-0000-0000-0000000000d1';
const FROZEN = '40000000-0000-0000-0000-0000000000d2';
const DEFAULT_ASSIGNMENT = '40000000-0000-0000-0000-0000000000d3';

/** Cinq variables communes et une variable de bloc : le contrat ne doit jamais melanger les deux. */
const COMMON_FIELDS = ['age', 'motif', 'dx', 'dx_autre', 'remarques'];

let db: TestDb;
let owner: string;
let other: string;

const as = (uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c) => (await c.query(sql, args)).rows);

const state = async (uid = owner, version = VERSION) =>
  (await as(uid, 'select public.common_layout_state($1) as result', [version]))[0].result;

const save = async (
  payload: unknown, fingerprint: string, operation = randomUUID(), uid = owner, version = VERSION,
) => (await as(uid, 'select public.set_common_layout($1,$2,$3::jsonb,$4) as result',
  [version, operation, JSON.stringify(payload), fingerprint]))[0].result;

/** Organisation de reference : trois rubriques, la troisieme apres le premier bloc. */
const layout = {
  defaultKey: 'contexte',
  groups: [
    { key: 'contexte', label: 'Contexte de la consultation', anchor: 0, fields: ['motif', 'age'] },
    { key: 'diagnostics', label: 'Diagnostics retenus', anchor: 0, fields: ['dx', 'dx_autre'] },
    { key: 'synthese', label: 'Synthese', anchor: 1, fields: ['remarques'] },
  ],
};

const groupsOf = async (version = VERSION) => (await db.admin.query(
  'select group_key, label, display_order, anchor_order, is_default from public.template_common_group'
  + ' where template_version_id=$1 order by display_order, group_key', [version])).rows;

const attachmentsOf = async (version = VERSION) => (await db.admin.query(
  'select f.field_key, g.group_key from public.template_field f'
  + ' left join public.template_common_group g on g.id=f.common_group_id'
  + ' where f.template_version_id=$1 and f.section is null order by f.display_order, f.field_key', [version])).rows;

async function seedVersion(id: string, number: number, templateId = TEMPLATE) {
  await db.admin.query(
    'insert into public.template_version (id, template_id, version_number, status, created_by) values ($1,$2,$3,$4,$5)',
    [id, templateId, number, 'draft', owner],
  );
  let order = 0;
  for (const [key, label] of [['clinique', 'Clinique'], ['imagerie', 'Imagerie']]) {
    await db.admin.query(
      'insert into public.template_section (template_version_id, section_key, label, display_order) values ($1,$2,$3,$4)',
      [id, key, label, order],
    );
    order += 1;
  }
  order = 0;
  for (const key of [...COMMON_FIELDS, 'tension']) {
    order += 1;
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, required, allow_missing_codes, display_order)
       values ($1,$2,$3,'encounter',$4,'text',false,true,$5)`,
      [id, key, key, key === 'tension' ? 'clinique' : null, order],
    );
  }
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  owner = (await db.admin.query('select owner_user_id from public.template where id=$1',
    ['10000000-0000-0000-0000-000000000001'])).rows[0].owner_user_id;
  other = (await db.admin.query("select id from auth.users where email='bob@demo.test'")).rows[0].id;
  await db.admin.query('insert into public.template (id, name, specialty, owner_user_id, is_global) values ($1,$2,$3,$4,false)',
    [TEMPLATE, 'Rubriques communes (fictif)', 'neurochirurgie', owner]);
  await db.admin.query('insert into public.template (id, name, specialty, owner_user_id, is_global) values ($1,$2,$3,$4,false)',
    [DEFAULT_TEMPLATE, 'Rubriques communes par défaut (fictif)', 'neurochirurgie', owner]);
  // La version editable est la plus recente : `create_next_personal_template_version` doit
  // recopier exactement celle qui porte l'organisation UX-16, tandis que FROZEN reste une
  // version historique publiee pour le refus d'ecriture.
  await seedVersion(VERSION, 3);
  await seedVersion(FROZEN, 2);
  await seedVersion(DEFAULT_ASSIGNMENT, 1, DEFAULT_TEMPLATE);
  await as(owner, 'select public.publish_template_version($1)', [FROZEN]);
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('UX-16 — organisation des rubriques communes', () => {
  test('sans rubrique, l\'etat decrit le rendu historique et situe les blocs', async () => {
    const current = await state();
    expect(current.groups).toEqual([]);
    expect(current.defaultKey).toBeNull();
    // Toutes les variables communes sont la, et la variable de bloc n'y est pas.
    expect(current.unassigned).toEqual(COMMON_FIELDS);
    // Les ancres comptent des blocs : l'ecran a besoin de leur ordre pour les nommer.
    expect(current.sections.map((s: { key: string }) => s.key)).toEqual(['clinique', 'imagerie']);
    expect(current.locked).toBe(false);
    expect(current.inUse).toBe(false);
    expect(typeof current.fingerprint).toBe('string');
  });

  test('T30 — trois rubriques nommees, ordonnees et placees autour d\'un bloc', async () => {
    const before = await state();
    const receipt = await save(layout, before.fingerprint);

    expect(receipt.groups.map((g: { key: string }) => g.key)).toEqual(['contexte', 'diagnostics', 'synthese']);
    expect(receipt.groups.map((g: { anchor: number }) => g.anchor)).toEqual([0, 0, 1]);
    expect(receipt.defaultKey).toBe('contexte');
    expect(receipt.unassigned).toEqual([]);
    // L'ordre demande DANS une rubrique est celui rendu : motif avant age.
    expect(receipt.groups[0].fields).toEqual(['motif', 'age']);

    // La base porte la meme chose que le recu : l'ecran n'a rien invente.
    expect(await groupsOf()).toEqual([
      { group_key: 'contexte', label: 'Contexte de la consultation', display_order: 0, anchor_order: 0, is_default: true },
      { group_key: 'diagnostics', label: 'Diagnostics retenus', display_order: 1, anchor_order: 0, is_default: false },
      { group_key: 'synthese', label: 'Synthese', display_order: 2, anchor_order: 1, is_default: false },
    ]);
    // Une variable commune, et une seule rubrique par variable.
    expect(await attachmentsOf()).toEqual([
      { field_key: 'motif', group_key: 'contexte' },
      { field_key: 'age', group_key: 'contexte' },
      { field_key: 'dx', group_key: 'diagnostics' },
      { field_key: 'dx_autre', group_key: 'diagnostics' },
      { field_key: 'remarques', group_key: 'synthese' },
    ]);
    // Le deplacement est VISUEL : la variable reste commune, donc eligible au role diagnostique.
    const attached = await db.admin.query(
      'select count(*) from public.template_field where template_version_id=$1 and common_group_id is not null and (section is not null or section_id is not null)',
      [VERSION]);
    expect(Number(attached.rows[0].count)).toBe(0);
  });

  test('T33 — rejeu, cle reutilisee et empreinte perimee', async () => {
    const before = await state();
    const operation = randomUUID();
    const renamed = { ...layout, groups: layout.groups.map((g) => g.key === 'synthese' ? { ...g, label: 'Synthese finale' } : g) };
    const first = await save(renamed, before.fingerprint, operation);
    // Rejeu d'une reponse perdue : meme recu, aucune seconde rubrique.
    const again = await save(renamed, before.fingerprint, operation);
    expect(again).toEqual(first);
    expect((await groupsOf()).length).toBe(3);

    // Meme cle, autre organisation : refus explicite plutot qu'un ecrasement silencieux.
    await expect(save(layout, first.fingerprint, operation)).rejects.toThrow(/COMMON_LAYOUT_OPERATION_CONFLICT/);

    // Empreinte de l'etat d'AVANT le renommage : l'ecran decidait sur une organisation perimee.
    await expect(save(layout, before.fingerprint)).rejects.toThrow(/COMMON_LAYOUT_CONFLICT/);
    expect((await groupsOf()).find((g) => g.group_key === 'synthese')?.label).toBe('Synthese finale');
  });

  test('une charge incomplete, doublee ou inconnue est refusee sans rien ecrire', async () => {
    const before = await state();
    const reference = await groupsOf();
    const attempt = (groups: unknown[], extra: Record<string, unknown> = {}) =>
      save({ defaultKey: 'contexte', groups, ...extra }, before.fingerprint);

    // Une variable commune absente de la charge disparaitrait de l'organisation.
    await expect(attempt([{ key: 'contexte', label: 'Contexte', anchor: 0, fields: ['motif'] }]))
      .rejects.toThrow(/COMMON_LAYOUT_MISSING_FIELD/);
    // La meme variable dans deux rubriques : c'est le doublon au rendu que le lot interdit.
    await expect(attempt([
      { key: 'contexte', label: 'Contexte', anchor: 0, fields: [...COMMON_FIELDS, 'motif'] },
    ])).rejects.toThrow(/COMMON_LAYOUT_DUPLICATE_FIELD/);
    // Une variable de bloc n'entre pas dans une rubrique commune.
    await expect(attempt([
      { key: 'contexte', label: 'Contexte', anchor: 0, fields: [...COMMON_FIELDS, 'tension'] },
    ])).rejects.toThrow(/COMMON_LAYOUT_UNKNOWN_FIELD/);
    // Une ancre au-dela du nombre de blocs ne designe aucune place.
    await expect(attempt([
      { key: 'contexte', label: 'Contexte', anchor: 9, fields: COMMON_FIELDS },
    ])).rejects.toThrow(/COMMON_LAYOUT_INVALID_ANCHOR/);
    // Deux rubriques dont les ancres se croisent decriraient deux ordres contradictoires.
    await expect(attempt([
      { key: 'contexte', label: 'Contexte', anchor: 1, fields: COMMON_FIELDS },
      { key: 'synthese', label: 'Synthese', anchor: 0, fields: [] },
    ])).rejects.toThrow(/COMMON_LAYOUT_INVALID_ANCHOR/);
    // Un titre vide ou un code invalide n'est pas une rubrique.
    await expect(attempt([{ key: 'contexte', label: '   ', anchor: 0, fields: COMMON_FIELDS }]))
      .rejects.toThrow(/COMMON_LAYOUT_INVALID_GROUP/);
    await expect(attempt([{ key: '2024', label: 'Contexte', anchor: 0, fields: COMMON_FIELDS }]))
      .rejects.toThrow(/COMMON_LAYOUT_INVALID_GROUP/);
    await expect(attempt([{ key: 'contexte', label: 'Contexte', anchor: 'pas-un-rang', fields: COMMON_FIELDS }]))
      .rejects.toThrow(/COMMON_LAYOUT_INVALID_GROUP/);
    // Une rubrique par defaut qui n'existe pas laisserait les nouvelles variables sans place.
    await expect(attempt([{ key: 'contexte', label: 'Contexte', anchor: 0, fields: COMMON_FIELDS }],
      { defaultKey: 'absente' })).rejects.toThrow(/COMMON_LAYOUT_UNKNOWN_DEFAULT/);

    expect(await groupsOf()).toEqual(reference);
  });

  test('supprimer une rubrique conserve ses variables', async () => {
    const before = await state();
    const receipt = await save({
      defaultKey: 'contexte',
      groups: [
        { key: 'contexte', label: 'Contexte', anchor: 0, fields: ['motif', 'age', 'remarques'] },
        { key: 'diagnostics', label: 'Diagnostics retenus', anchor: 1, fields: ['dx', 'dx_autre'] },
      ],
    }, before.fingerprint);

    expect(receipt.groups.map((g: { key: string }) => g.key)).toEqual(['contexte', 'diagnostics']);
    // « Synthese » n'existe plus, mais sa variable est dans la destination demandee.
    expect(receipt.groups[0].fields).toContain('remarques');
    expect((await attachmentsOf()).map((row) => row.field_key).sort()).toEqual([...COMMON_FIELDS].sort());
  });

  test('revenir au rendu historique est une organisation vide, pas une suppression de variables', async () => {
    const before = await state();
    const receipt = await save({ groups: [] }, before.fingerprint);
    expect(receipt.groups).toEqual([]);
    expect(receipt.defaultKey).toBeNull();
    expect(receipt.unassigned.sort()).toEqual([...COMMON_FIELDS].sort());
    expect(await groupsOf()).toEqual([]);
  });

  test('une variable commune deplacee vers un bloc perd sa rubrique, sans refus', async () => {
    const before = await state();
    await save(layout, before.fingerprint);
    await db.admin.query('update public.template_field set section=$1 where template_version_id=$2 and field_key=$3',
      ['clinique', VERSION, 'remarques']);
    const rows = await db.admin.query(
      'select section, common_group_id from public.template_field where template_version_id=$1 and field_key=$2',
      [VERSION, 'remarques']);
    expect(rows.rows[0].section).toBe('clinique');
    expect(rows.rows[0].common_group_id).toBeNull();
    // Remise en etat pour les tests suivants.
    await db.admin.query('update public.template_field set section=null, section_id=null where template_version_id=$1 and field_key=$2',
      [VERSION, 'remarques']);
  });

  test('autorisation : un autre compte non lecteur et un visiteur anonyme sont refuses', async () => {
    await expect(state(other)).rejects.toThrow(/COMMON_LAYOUT_FORBIDDEN/);
    await expect(as(other, 'select public.template_version_layout_fingerprint($1)', [VERSION]))
      .rejects.toThrow(/COMMON_LAYOUT_FORBIDDEN/);
    await expect(save(layout, 'peu-importe', randomUUID(), other)).rejects.toThrow(/COMMON_LAYOUT_FORBIDDEN/);
    // Une version inexistante renvoie le MEME refus : l'existence d'un gabarit ne se deduit pas.
    await expect(state(owner, '40000000-0000-0000-0000-0000000000ff')).rejects.toThrow(/COMMON_LAYOUT_FORBIDDEN/);
    for (const fn of ['common_layout_state(uuid)', 'set_common_layout(uuid,uuid,jsonb,text)']) {
      const granted = await db.admin.query("select has_function_privilege('anon', $1, 'execute') as ok", [`public.${fn}`]);
      expect(granted.rows[0].ok).toBe(false);
    }

    // Un collaborateur de base lit deja les champs de la version : il doit aussi lire leur
    // organisation, mais le meme chemin ne lui accorde jamais l'ecriture.
    const base = (await db.admin.query(
      `insert into public.base(name, specialty, owner_user_id, current_template_version_id)
       values ('Base lecteur UX-16', 'neurochirurgie', $1, $2) returning id`,
      [owner, VERSION],
    )).rows[0];
    await db.admin.query(
      `insert into public.base_access(base_id, user_id, access_role, granted_by)
       values($1,$2,'viewer',$3)
       on conflict(base_id, user_id) do update set revoked_at=null`,
      [base.id, other, owner],
    );
    expect((await state(other)).groups).toEqual(expect.any(Array));
    expect(typeof (await as(other, 'select public.template_version_layout_fingerprint($1) as value', [VERSION]))[0].value)
      .toBe('string');
    await expect(save(layout, 'peu-importe', randomUUID(), other)).rejects.toThrow(/COMMON_LAYOUT_FORBIDDEN/);
  });

  test('une version publiee refuse la reorganisation et le dit', async () => {
    const current = await state(owner, FROZEN);
    expect(current.locked).toBe(true);
    await expect(save(layout, current.fingerprint, randomUUID(), owner, FROZEN))
      .rejects.toThrow(/COMMON_LAYOUT_VERSION_LOCKED/);
  });

  test('une nouvelle variable commune rejoint la rubrique par defaut', async () => {
    const before = await state(owner, DEFAULT_ASSIGNMENT);
    await save(layout, before.fingerprint, randomUUID(), owner, DEFAULT_ASSIGNMENT);
    await db.admin.query(
      `insert into public.template_field
        (template_version_id, field_key, label, scope, section, type, required, allow_missing_codes, display_order)
       values ($1,'nouvelle_variable','Nouvelle variable','encounter',null,'text',false,true,99)`,
      [DEFAULT_ASSIGNMENT],
    );
    const current = await state(owner, DEFAULT_ASSIGNMENT);
    expect(current.groups.find((g: { key: string }) => g.key === 'contexte').fields).toContain('nouvelle_variable');
    expect(current.unassigned).toEqual([]);
    // Une ecriture PostgREST directe ne peut pas contourner l'operation complete et son
    // empreinte en pointant une variable vers une autre rubrique.
    await expect(as(owner, `update public.template_field set common_group_id=(
      select id from public.template_common_group where template_version_id=$1 and group_key='synthese'
    ) where template_version_id=$1 and field_key='nouvelle_variable'`, [DEFAULT_ASSIGNMENT]))
      .rejects.toThrow(/COMMON_LAYOUT_DIRECT_WRITE_FORBIDDEN/);
  });

  test('une copie de version emporte l\'organisation et n\'y reference plus la source', async () => {
    const before = await state();
    await save(layout, before.fingerprint);
    const copy = (await as(owner, 'select (public.create_next_personal_template_version($1)).id as id', [TEMPLATE]))[0].id;

    expect((await groupsOf(copy)).map((g) => [g.group_key, g.label, g.anchor_order, g.is_default])).toEqual([
      ['contexte', 'Contexte de la consultation', 0, true],
      ['diagnostics', 'Diagnostics retenus', 0, false],
      ['synthese', 'Synthese', 1, false],
    ]);
    expect(await attachmentsOf(copy)).toEqual(await attachmentsOf());
    // Aucune reference vivante : les identifiants de rubrique de la copie lui appartiennent.
    const shared = await db.admin.query(
      'select count(*) from public.template_field f join public.template_common_group g on g.id=f.common_group_id'
      + ' where f.template_version_id=$1 and g.template_version_id<>$1', [copy]);
    expect(Number(shared.rows[0].count)).toBe(0);
  });
});
