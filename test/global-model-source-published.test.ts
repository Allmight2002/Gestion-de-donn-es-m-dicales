// Tests DB : un modele OFFICIEL (template.is_global) ne sert de source a une base ou a une
// copie de jeu de variables que par une version PUBLIEE. Le filtre de `listTemplateModels`
// est client ; la garantie est ici, dans les RPC de copie. Un jeu personnel reste copiable
// par son proprietaire quel que soit son statut.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let bobId: string;
let aliceId: string;
const GLOBAL_PUBLISHED = '10000000-0000-0000-0000-0000000000a2'; // seed : modele officiel publie
const ALICE_PERSONAL_DRAFT = '10000000-0000-0000-0000-0000000000a1'; // seed : jeu personnel d'Alice, brouillon
let globalDraftId: string;
let globalArchivedId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

async function globalVersion(name: string, status: 'draft' | 'archived'): Promise<string> {
  const tpl = (await db.admin.query(
    "insert into public.template(name, specialty, owner_user_id, is_global) values($1,'neuro',null,true) returning id",
    [name],
  )).rows[0].id;
  const ver = (await db.admin.query(
    'insert into public.template_version(template_id, version_number, status) values($1,1,$2) returning id',
    [tpl, status],
  )).rows[0].id;
  await db.admin.query(
    "insert into public.template_section(template_version_id, section_key, label, display_order) values($1,'clinique','Clinique',0)",
    [ver],
  );
  await db.admin.query(
    "insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order) values($1,'age_fictif','Age fictif','patient','clinique','integer',0)",
    [ver],
  );
  return ver;
}

const templateCount = async () =>
  Number((await db.admin.query('select count(*)::int as n from public.template')).rows[0].n);
const baseCount = async () =>
  Number((await db.admin.query('select count(*)::int as n from public.base')).rows[0].n);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  bobId = byEmail.get('bob@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  globalDraftId = await globalVersion('Modele officiel fictif en brouillon', 'draft');
  globalArchivedId = await globalVersion('Modele officiel fictif archive', 'archived');
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('create_base_from_model_observation : source officielle publiee uniquement', () => {
  const create = (uid: string, versionId: string) =>
    rowsAs(uid, 'select * from public.create_base_from_model_observation($1,$2,$3,$4)',
      ['Base fictive', 'neuro', versionId, 'longitudinal']);

  test.each([['brouillon', () => globalDraftId], ['archivee', () => globalArchivedId]])(
    'une version officielle %s est refusee sans aucune ecriture',
    async (_label, version) => {
      const [templates, bases] = [await templateCount(), await baseCount()];
      await expect(create(bobId, version())).rejects.toThrow(/Modele non publie/);
      expect(await templateCount()).toBe(templates);
      expect(await baseCount()).toBe(bases);
    },
  );

  test('une version officielle publiee est acceptee', async () => {
    const base = (await create(bobId, GLOBAL_PUBLISHED))[0];
    expect(base.owner_user_id).toBe(bobId);
  });

  test('un jeu personnel en brouillon reste accepte pour son proprietaire', async () => {
    const base = (await create(aliceId, ALICE_PERSONAL_DRAFT))[0];
    expect(base.owner_user_id).toBe(aliceId);
  });
});

describe('create_base_from_model : source officielle publiee uniquement', () => {
  const create = (uid: string, versionId: string) =>
    rowsAs(uid, 'select * from public.create_base_from_model($1,$2,$3)', ['Base fictive', 'neuro', versionId]);

  test('une version officielle brouillon est refusee', async () => {
    await expect(create(bobId, globalDraftId)).rejects.toThrow(/Modele non publie/);
  });

  test('une version officielle publiee et un jeu personnel brouillon sont acceptes', async () => {
    expect((await create(bobId, GLOBAL_PUBLISHED))[0].owner_user_id).toBe(bobId);
    expect((await create(aliceId, ALICE_PERSONAL_DRAFT))[0].owner_user_id).toBe(aliceId);
  });
});

describe('create_template_bundle avec sourceVersionId : source officielle publiee uniquement', () => {
  const copy = (uid: string, versionId: string, operationKey = randomUUID()) =>
    rowsAs(uid, 'select public.create_template_bundle($1::jsonb, $2::uuid) as result',
      [JSON.stringify({ name: 'Copie fictive', specialty: 'neuro', sourceVersionId: versionId }), operationKey]);

  test('une version officielle brouillon est refusee sans operation ni gabarit residuels', async () => {
    const operationKey = randomUUID();
    const templates = await templateCount();
    await expect(copy(bobId, globalDraftId, operationKey)).rejects.toThrow(/SOURCE_NOT_PUBLISHED/);
    expect(await templateCount()).toBe(templates);
    expect((await db.admin.query(
      'select 1 from public.template_operation where operation_key=$1', [operationKey],
    )).rowCount).toBe(0);
  });

  test('une version officielle publiee est copiee avec ses variables', async () => {
    const result = (await copy(bobId, GLOBAL_PUBLISHED))[0].result;
    const fields = (await db.admin.query(
      'select count(*)::int as n from public.template_field where template_version_id=$1', [result.versionId],
    )).rows[0].n;
    expect(fields).toBeGreaterThan(0);
  });

  test('un jeu personnel en brouillon reste copiable par son proprietaire', async () => {
    const result = (await copy(aliceId, ALICE_PERSONAL_DRAFT))[0].result;
    expect(result.versionId).toBeTruthy();
  });
});
