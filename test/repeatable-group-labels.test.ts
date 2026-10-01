// Libelles d'un bloc repetable choisis par l'auteur du formulaire
// (migration 20261001101500_repeatable_group_labels.sql).
//
// Ce que ces tests protegent : les deux libelles sont facultatifs et bornes ; ils s'ecrivent
// comme le nom du bloc (proprietaire, version non publiee) ; ils suivent la recopie d'une
// version et la copie hors-ligne, faute de quoi la saisie retomberait sur « occurrence ».
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let alice: string;
let template: string;
let version: string;

const sectionLabels = async (versionId: string) => (await db.admin.query(
  "select add_label, item_label from public.template_section where template_version_id=$1 and section_key='lesions'",
  [versionId])).rows[0];
const setLabelsAs = (uid: string, versionId: string, addLabel: string | null, itemLabel: string | null) =>
  db.asUser(uid, (c) => c.query(
    "update public.template_section set add_label=$2, item_label=$3 where template_version_id=$1 and section_key='lesions'",
    [versionId, addLabel, itemLabel]));
const newDraft = async (number: number) => (await db.admin.query(
  "insert into public.template_version(template_id,version_number,status) values($1,$2,'draft') returning id",
  [template, number])).rows[0].id as string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  template = (await db.admin.query(
    "insert into public.template(name,owner_user_id,is_global) values('Lésions (fictif)',$1,false) returning id", [alice])).rows[0].id;
  version = await newDraft(1);
  await db.admin.query(
    "insert into public.template_section(template_version_id,section_key,label,display_order,is_repeatable) values($1,'lesions','Lésions',0,true)",
    [version]);
  await db.admin.query(
    "insert into public.template_field(template_version_id,field_key,label,scope,section,type,display_order) values($1,'taille','Taille','encounter','lesions','number',0)",
    [version]);
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('libelles d un bloc repetable', () => {
  test('le proprietaire les ecrit et les retire ; la base refuse un libelle vide, trop long ou mal borde', async () => {
    await setLabelsAs(alice, version, 'Ajouter une lésion', 'Lésion');
    expect(await sectionLabels(version)).toEqual({ add_label: 'Ajouter une lésion', item_label: 'Lésion' });

    await expect(setLabelsAs(alice, version, '', 'Lésion')).rejects.toThrow(/template_section_add_label_format/);
    await expect(setLabelsAs(alice, version, ' Ajouter', 'Lésion')).rejects.toThrow(/template_section_add_label_format/);
    await expect(setLabelsAs(alice, version, 'x'.repeat(81), 'Lésion')).rejects.toThrow(/template_section_add_label_format/);
    await expect(setLabelsAs(alice, version, 'Ajouter une lésion', 'x'.repeat(61))).rejects.toThrow(/template_section_item_label_format/);
    expect(await sectionLabels(version)).toEqual({ add_label: 'Ajouter une lésion', item_label: 'Lésion' });

    await setLabelsAs(alice, version, null, null);
    expect(await sectionLabels(version)).toEqual({ add_label: null, item_label: null });
    await setLabelsAs(alice, version, 'Ajouter une lésion', 'Lésion');
  });

  test('ils suivent la recopie d une version', async () => {
    const copy = await newDraft(2);
    await db.admin.query('select public.copy_template_fields($1, $2)', [version, copy]);
    expect(await sectionLabels(copy)).toEqual({ add_label: 'Ajouter une lésion', item_label: 'Lésion' });
  });

  test('ils suivent la copie hors-ligne', async () => {
    const base = (await db.admin.query(
      "insert into public.base(name,owner_user_id,current_template_version_id) values('Base libellés (fictif)',$1,$2) returning id",
      [alice, version])).rows[0].id;
    const snapshot = (await db.asUser(alice, (c) => c.query('select public.download_base_snapshot($1) as s', [base]))).rows[0].s;
    expect(snapshot.sections).toEqual([expect.objectContaining({
      sectionKey: 'lesions', isRepeatable: true, addLabel: 'Ajouter une lésion', itemLabel: 'Lésion',
    })]);
  });

  test('une version publiee les fige, comme le nom du bloc', async () => {
    const frozen = await newDraft(3);
    await db.admin.query('select public.copy_template_fields($1, $2)', [version, frozen]);
    await db.asUser(alice, (c) => c.query('select public.publish_template_version($1)', [frozen]));
    await expect(setLabelsAs(alice, frozen, 'Autre', 'Autre')).rejects.toThrow(/immuable/);
    expect(await sectionLabels(frozen)).toEqual({ add_label: 'Ajouter une lésion', item_label: 'Lésion' });
  });
});
