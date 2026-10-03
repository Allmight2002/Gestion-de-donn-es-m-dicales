// File « A completer » : visibilite conditionnelle et seuil de 75 % des variables affichees.
//
// Une variable masquee (regle `visible` sur un champ ou sur un bloc) n'est ni reclamee ni
// comptee ; un dossier non finalise entre dans la file s'il lui manque une obligatoire
// affichee OU si moins de 75 % de ses variables affichees sont documentees. Le compteur
// « A faire » (`my_todo_counts.incomplete`) suit exactement la meme definition.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let baseId: string;
let versionId: string;

type Item = {
  kind: string; code: string; missing: string[]; filledFields: number; displayedFields: number;
};
type QueuePage = { items: Item[]; total: number };

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const queue = async (): Promise<QueuePage> =>
  (await rowsAs(alice, 'select public.base_completion_queue_page($1,500,0) as q', [baseId]))[0].q as QueuePage;
const item = async (code: string) => (await queue()).items.find((i) => i.code === code);

const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const createPatient = async (code: string, data: object) =>
  (await rowsAs(alice, CREATE_PAT, [baseId, code, null, null, null, null, null, JSON.stringify(data)]))[0];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;

  const templateId = (await db.admin.query(
    "insert into public.template(name,owner_user_id,is_global) values('File visibilite',$1,false) returning id",
    [alice])).rows[0].id as string;
  versionId = (await db.admin.query(
    "insert into public.template_version(template_id,version_number,status) values($1,1,'draft') returning id",
    [templateId])).rows[0].id as string;
  await db.admin.query(
    "insert into public.template_section(template_version_id,section_key,label,display_order) values($1,'bloc','Bloc conditionnel',0)",
    [versionId]);
  // Affichees sans condition : pilote (obligatoire), b, c, d (facultatives) et une variable
  // calculee (jamais comptee). Conditionnelles : `cond` (obligatoire, regle de champ) et le
  // bloc `bloc` (deux facultatives, regle de bloc) n'apparaissent que si pilote = oui.
  await db.admin.query(
    `insert into public.template_field(template_version_id,field_key,label,scope,section,type,required,display_order)
     values ($1,'pilote','Pilote','patient',null,'text',true,0),
            ($1,'b','Variable B','patient',null,'text',false,1),
            ($1,'c','Variable C','patient',null,'text',false,2),
            ($1,'d','Variable D','patient',null,'text',false,3),
            ($1,'cond','Conditionnelle','patient',null,'text',true,4),
            ($1,'bloc_1','Bloc 1','patient','bloc','text',false,5),
            ($1,'bloc_2','Bloc 2','patient','bloc','text',false,6),
            ($1,'n1','Nombre 1','patient',null,'number',false,7),
            ($1,'calc','Calculee','patient',null,'number',false,8)`,
    [versionId]);
  await db.admin.query("update public.template_field set formula='n1 + 1' where template_version_id=$1 and field_key='calc'", [versionId]);
  for (const rule of [
    { if: { field: 'pilote', operator: 'equals', value: 'oui' }, then: { field: 'cond', operator: 'visible' } },
    { if: { field: 'pilote', operator: 'equals', value: 'oui' }, then: { section: 'bloc', operator: 'visible' } },
    { if: { field: 'pilote', operator: 'equals', value: 'oui' }, then: { field: 'n1', operator: 'visible' } },
  ]) {
    await db.admin.query(
      "insert into public.validation_rule(template_version_id,rule,message,severity) values($1,$2,'regle fictive','block')",
      [versionId, JSON.stringify(rule)]);
  }
  await rowsAs(alice, 'select public.publish_template_version($1)', [versionId]);
  baseId = (await db.admin.query(
    "insert into public.base(name,owner_user_id,current_template_version_id) values('File visibilite',$1,$2) returning id",
    [alice, versionId])).rows[0].id as string;
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('file « A completer » : visibilite conditionnelle', () => {
  test('une obligatoire masquee n est pas reclamee, et les masquees ne comptent pas', async () => {
    // pilote = non : `cond`, le bloc et n1 sont masques. Affichees : pilote, b, c, d (4/4).
    await createPatient('VIS-MASQUE', { pilote: 'non', b: 'x', c: 'x', d: 'x' });
    expect(await item('VIS-MASQUE')).toBeUndefined();
  });

  test('une obligatoire affichee manquante fait entrer le dossier, avec son libelle', async () => {
    // pilote = oui : `cond`, le bloc et n1 s'affichent. 4 documentees sur 8 affichees.
    await createPatient('VIS-AFFICHE', { pilote: 'oui', b: 'x', c: 'x', d: 'x' });
    const found = await item('VIS-AFFICHE');
    expect(found?.missing).toEqual(['Conditionnelle']);
    expect(found?.displayedFields).toBe(8);
    expect(found?.filledFields).toBe(4);
  });
});

describe('file « A completer » : seuil de 75 % des variables affichees', () => {
  test('moins de 75 % documente : dans la file, meme sans obligatoire manquante', async () => {
    await createPatient('TAUX-50', { pilote: 'non', b: 'x' });
    const found = await item('TAUX-50');
    expect(found?.missing).toEqual([]);
    expect(found?.filledFields).toBe(2);
    expect(found?.displayedFields).toBe(4);
  });

  test('exactement 75 % : hors de la file (les variables masquees ne diluent pas le taux)', async () => {
    // 3/4 affichees. Si le bloc masque et `cond` comptaient, le taux serait 3/7.
    await createPatient('TAUX-75', { pilote: 'non', b: 'x', c: 'x' });
    expect(await item('TAUX-75')).toBeUndefined();
  });

  test('une donnee manquante codee compte comme documentee', async () => {
    await createPatient('TAUX-CODE', { pilote: 'non', b: 'x', c: { __missing__: 'inconnu' } });
    expect(await item('TAUX-CODE')).toBeUndefined();
  });

  test('le compteur « A faire » suit la meme definition que la file', async () => {
    const page = await queue();
    const counts = (await rowsAs(alice, 'select public.my_todo_counts() as c'))[0].c as
      { baseId: string; incomplete: number }[];
    expect(counts.find((c) => c.baseId === baseId)?.incomplete).toBe(page.total);
    expect(page.items.map((i) => i.code).sort()).toEqual(['TAUX-50', 'VIS-AFFICHE']);
  });
});
