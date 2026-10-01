// Transfert d'un jeu de variables par fichier (export_template_definition /
// import_template_definition).
//
// Ce que ces tests protegent : un gabarit exporte dans un compte se recree A L'IDENTIQUE dans
// un autre (sections, hierarchie, rubriques communes, attributs de variables, formule, regles,
// configuration diagnostique) ; la nomenclature est re-resolue par slug ; un rejeu ne cree
// rien de plus ; un refus n'ecrit rien ; on n'exporte que ce qu'on peut lire.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let alice: string;
let bob: string;
let admin: string;
let curator: string;
let release: string;
let version: string;

const client = async (c: Client) => {
  await c.query(`select set_config('request.headers','{"x-meddata-diagnosis-contract":"1"}',false)`);
};
const as = <T = Record<string, unknown>>(uid: string, sql: string, args: unknown[] = []) =>
  db.asUser(uid, async (c) => { await client(c); return (await c.query(sql, args)).rows as T[]; });

const exportAs = async (uid: string, versionId: string) =>
  (await as<{ d: Record<string, unknown> }>(uid, 'select public.export_template_definition($1) as d', [versionId]))[0].d;
const importAs = async (uid: string, payload: unknown, key = randomUUID()) =>
  (await as<{ r: { templateId: string; versionId: string; fieldCount: number } }>(
    uid, 'select public.import_template_definition($1::jsonb, $2) as r', [JSON.stringify(payload), key]))[0].r;
const templateCount = async (uid: string) =>
  Number((await db.admin.query('select count(*) from public.template where owner_user_id=$1', [uid])).rows[0].count);

/** La definition sans ce qui depend legitimement de l'instance ou de l'instant. */
const comparable = (d: Record<string, unknown>) => {
  const { exportedAt: _at, template: _t, ...rest } = d;
  return rest;
};

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = (await db.admin.query('select id, email from auth.users')).rows;
  const id = (email: string) => users.find((u) => u.email === email).id as string;
  alice = id('alice@demo.test');
  bob = id('bob@demo.test');
  admin = id('admin@demo.test');
  curator = id('curator1@demo.test');

  release = (await db.admin.query(
    "insert into terminology_release(slug,title,source,version) values('transfert-fictif','Transfert','fictif','1') returning id")).rows[0].id;
  await db.admin.query(
    "insert into terminology_concept(release_id,code,label,kind) values($1,'A','Alpha','category'),($1,'B','Beta','category'),($1,'C','Gamma','category')",
    [release]);

  // Registre fictif de neurochirurgie, volontairement riche.
  const template = (await db.admin.query(
    "insert into template(name,specialty,owner_user_id,is_global) values('Neurochirurgie (fictif)','neurochirurgie',$1,false) returning id",
    [alice])).rows[0].id;
  version = (await db.admin.query(
    "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
  await db.admin.query(
    "insert into template_section(template_version_id,section_key,label,display_order) values($1,'bloc','Bloc opératoire',0),($1,'detail','Détail',1),($1,'imagerie','Imagerie',2)",
    [version]);
  await db.admin.query(
    "update template_section set parent_section_id=(select id from template_section where template_version_id=$1 and section_key='bloc') where template_version_id=$1 and section_key='detail'",
    [version]);
  await db.admin.query(
    "insert into template_common_group(template_version_id,group_key,label,display_order,anchor_order,is_default) values($1,'contexte','Contexte',0,0,true),($1,'synthese','Synthèse',1,1,false)",
    [version]);
  // La variable calculee precede ses operandes : l'import doit tout de meme la creer.
  await db.admin.query(`insert into template_field
      (template_version_id,field_key,label,scope,section,type,description,default_value,unit,allowed_values,is_multiple,required,min_value,max_value,formula,display_order)
    values
      ($1,'debut','Début',     'patient',null,'number','Minute de début',null,'min',null,false,false,0,1440,null,1),
      ($1,'fin','Fin',         'patient',null,'number',null,null,'min',null,false,false,0,1440,null,2),
      ($1,'diagnostics','Diagnostics','patient',null,'terminology',null,null,null,null,true,false,null,null,null,3),
      ($1,'diagnostics_autre','Proposition','patient',null,'text',null,null,null,null,false,false,null,null,null,4),
      ($1,'geste','Geste',     'patient','detail','select',null,'craniotomie',null,'["craniotomie","derivation"]',false,true,null,null,null,5),
      ($1,'irm','IRM',         'patient','imagerie','boolean',null,null,null,null,false,false,null,null,null,6)`,
  [version]);
  await db.admin.query(`insert into template_field
      (template_version_id,field_key,label,scope,section,type,unit,formula,display_order)
    values ($1,'duree','Durée','patient',null,'number','min','fin - debut',0)`, [version]);
  await db.admin.query("select set_config('app.setting_common_layout','on',false)");
  await db.admin.query(
    "update template_field set common_group_id=(select id from template_common_group where template_version_id=$1 and group_key='synthese') where template_version_id=$1 and field_key='duree'",
    [version]);
  await db.admin.query("select set_config('app.setting_common_layout','',false)");
  await db.admin.query("insert into validation_rule(template_version_id,rule,message,severity) values($1,$2,'Bloc selon diagnostic','block')", [version,
    { if: { field: 'diagnostics', operator: 'contains_any', value: ['A'], terminologyReleaseId: release }, then: { section: 'bloc', operator: 'visible' } }]);
  await db.admin.query("insert into validation_rule(template_version_id,rule,message,severity) values($1,$2,'Fin après début','warn')", [version,
    { operator: 'greater_or_equal', left_field: 'fin', right_field: 'debut' }]);
  await db.admin.query('update template_version set diagnosis_configuration=$2 where id=$1', [version, JSON.stringify([
    { scope: 'patient', diagnosisFieldKey: 'diagnostics', terminologyReleaseId: release, commonOnlyCodes: ['B'] }])]);
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('transfert d\'un jeu de variables par fichier', () => {
  test('l\'export ne porte que la structure, sans identifiant interne ni proprietaire', async () => {
    const d = await exportAs(alice, version);
    expect(d.format).toBe('meddata.template-definition');
    expect(d.formatVersion).toBe(1);
    expect(d.template).toMatchObject({ name: 'Neurochirurgie (fictif)', specialty: 'neurochirurgie' });
    const text = JSON.stringify(d);
    expect(text).not.toContain(version);
    expect(text).not.toContain(alice);
    expect((d.fields as { fieldKey: string }[]).map((f) => f.fieldKey))
      .toEqual(['duree', 'debut', 'fin', 'diagnostics', 'diagnostics_autre', 'geste', 'irm']);
    expect(d.terminologyReleases).toEqual([{ id: release, slug: 'transfert-fictif', version: '1' }]);
  });

  test('un autre compte ne peut pas exporter un gabarit qu\'il ne lit pas', async () => {
    await expect(exportAs(bob, version)).rejects.toThrow('TEMPLATE_EXPORT_NOT_FOUND');
  });

  test('aller-retour : l\'import dans un autre compte recree la meme definition', async () => {
    const d = await exportAs(alice, version);
    const result = await importAs(bob, { definition: d, name: 'Neurochirurgie (copie)' });
    expect(result.fieldCount).toBe(7);

    const owner = (await db.admin.query(
      'select t.name, t.owner_user_id, t.is_global, v.status from template t join template_version v on v.template_id=t.id where v.id=$1',
      [result.versionId])).rows[0];
    expect(owner).toEqual({ name: 'Neurochirurgie (copie)', owner_user_id: bob, is_global: false, status: 'draft' });

    const again = await exportAs(bob, result.versionId);
    expect(comparable(again)).toEqual(comparable(d));
  });

  test('la nomenclature est re-resolue par slug (fichier venu d\'une autre instance)', async () => {
    const d = JSON.parse(JSON.stringify(await exportAs(alice, version)).split(release).join('00000000-0000-4000-8000-00000000abcd'));
    const result = await importAs(admin, { definition: d });
    const imported = await exportAs(admin, result.versionId);
    expect(imported.terminologyReleases).toEqual([{ id: release, slug: 'transfert-fictif', version: '1' }]);
    expect((imported.diagnosisConfiguration as { terminologyReleaseId: string }[])[0].terminologyReleaseId).toBe(release);
  });

  test('un bloc repetable garde son caractere repetable et ses libelles de saisie', async () => {
    const template = (await db.admin.query(
      "insert into template(name,owner_user_id,is_global) values('Répétable (fictif)',$1,false) returning id", [alice])).rows[0].id;
    const v = (await db.admin.query(
      "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
    await db.admin.query(
      `insert into template_section(template_version_id,section_key,label,display_order,is_repeatable,add_label,item_label)
       values($1,'lesions','Lésions',0,true,'Ajouter une lésion','Lésion'),($1,'suivis','Suivis',1,true,null,null)`, [v]);
    await db.admin.query(
      "insert into template_field(template_version_id,field_key,label,scope,section,type,display_order) values($1,'taille','Taille','encounter','lesions','number',0)", [v]);
    const d = await exportAs(alice, v);
    expect(d.sections).toEqual([
      { key: 'lesions', label: 'Lésions', parentKey: null, displayOrder: 0, isRepeatable: true, addLabel: 'Ajouter une lésion', itemLabel: 'Lésion' },
      { key: 'suivis', label: 'Suivis', parentKey: null, displayOrder: 1, isRepeatable: true, addLabel: null, itemLabel: null },
    ]);
    const result = await importAs(bob, { definition: d });
    expect(comparable(await exportAs(bob, result.versionId))).toEqual(comparable(d));

    // Fichier anterieur, sans ces cles : il s'importe, libelles generiques.
    const older = { ...d, sections: (d.sections as Record<string, unknown>[]).map(({ addLabel: _a, itemLabel: _i, ...s }) => s) };
    const fromOlder = await importAs(bob, { definition: older });
    expect((await exportAs(bob, fromOlder.versionId)).sections).toEqual([
      expect.objectContaining({ key: 'lesions', addLabel: null, itemLabel: null }),
      expect.objectContaining({ key: 'suivis', addLabel: null, itemLabel: null }),
    ]);

    // Libelle hors bornes : refus lisible, avant toute ecriture.
    const before = await templateCount(bob);
    const bad = { ...d, sections: (d.sections as Record<string, unknown>[]).map((s) => (s.key === 'suivis' ? { ...s, itemLabel: ' Suivi' } : s)) };
    let detail: unknown;
    try { await importAs(bob, { definition: bad }); } catch (e) { detail = JSON.parse((e as { detail: string }).detail); }
    expect(detail).toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'section_repeat_label_invalid', key: 'suivis', position: 2 });
    expect(await templateCount(bob)).toBe(before);
  });

  // Registre reel construit dans l'editeur : 63 sections et des codes de variables avec
  // majuscules et accents. L'editeur les accepte ; l'import les refusait (plafond de 60
  // sections, format de code emprunte a la creation depuis Excel).
  test('un registre plus grand que les plafonds d\'Excel, aux codes accentues, fait l\'aller-retour', async () => {
    const template = (await db.admin.query(
      "insert into template(name,owner_user_id,is_global) values('Grand registre (fictif)',$1,false) returning id", [alice])).rows[0].id;
    const v = (await db.admin.query(
      "insert into template_version(template_id,version_number,status) values($1,1,'draft') returning id", [template])).rows[0].id;
    await db.admin.query(
      `insert into template_section(template_version_id,section_key,label,display_order)
       select $1, 'section_' || i, 'Section ' || i, i - 1 from generate_series(1, 63) i`, [v]);
    await db.admin.query(
      `insert into template_field(template_version_id,field_key,label,scope,section,type,display_order)
       values ($1,'Date_admission','Date d''admission','patient','section_1','date',0),
              ($1,'Fréquence_cardiaque','Fréquence cardiaque','patient','section_63','number',1)`, [v]);
    const d = await exportAs(alice, v);
    expect((d.sections as unknown[]).length).toBe(63);
    const result = await importAs(bob, { definition: d });
    expect(comparable(await exportAs(bob, result.versionId))).toEqual(comparable(d));
  });

  test('un rejeu rend le meme resultat sans rien creer ; une cle reutilisee pour un autre contenu est refusee', async () => {
    const d = await exportAs(alice, version);
    const key = randomUUID();
    const before = await templateCount(bob);
    const first = await importAs(bob, { definition: d, name: 'Rejeu' }, key);
    const replay = await importAs(bob, { definition: d, name: 'Rejeu' }, key);
    expect(replay).toEqual(first);
    expect(await templateCount(bob)).toBe(before + 1);
    await expect(importAs(bob, { definition: d, name: 'Autre nom' }, key)).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });

  test('refus sans aucune ecriture : format, nomenclature absente, contenu refuse par une garde, role', async () => {
    const d = await exportAs(alice, version);
    const before = await templateCount(bob);
    await expect(importAs(bob, { definition: { ...d, formatVersion: 2 } })).rejects.toThrow('TEMPLATE_IMPORT_FORMAT_UNSUPPORTED');
    await expect(importAs(bob, { definition: { ...d, terminologyReleases: [{ id: release, slug: 'inconnue' }] } }))
      .rejects.toThrow('TEMPLATE_IMPORT_TERMINOLOGY_MISSING');
    await expect(importAs(bob, { definition: { ...d, fields: [...(d.fields as object[]), { fieldKey: 'orpheline', label: 'X', scope: 'patient', section: 'inexistante', type: 'text' }] } }))
      .rejects.toThrow('TEMPLATE_IMPORT_INVALID');
    // Formule vers une variable inexistante : c'est la garde existante qui tranche, et son
    // motif metier remonte tel quel.
    const fields = (d.fields as { fieldKey: string; formula: string | null }[])
      .map((f) => (f.fieldKey === 'duree' ? { ...f, formula: 'fin - absente' } : f));
    await expect(importAs(bob, { definition: { ...d, fields } })).rejects.toThrow(/absente/);
    expect(await templateCount(bob)).toBe(before);

    await expect(importAs(curator, { definition: d })).rejects.toThrow('TEMPLATE_IMPORT_FORBIDDEN');
  });

  // `TEMPLATE_IMPORT_INVALID` seul ne disait pas quoi corriger. Le detail porte le motif et le
  // code de structure en cause, jamais une valeur clinique ni l'erreur SQL brute.
  test('un refus de forme porte son motif et le code en cause, sans rien ecrire', async () => {
    const d = await exportAs(alice, version);
    const sections = d.sections as { key: string; parentKey: string | null }[];
    const fields = d.fields as { fieldKey: string }[];
    const refusal = async (definition: object) => {
      try { await importAs(bob, { definition }); } catch (e) { return JSON.parse((e as { detail: string }).detail); }
      throw new Error('import accepte');
    };
    const before = await templateCount(bob);

    expect(await refusal({ ...d, sections: [...sections, { key: 'Mecanisme-lesionnel', label: 'Mécanisme' }] }))
      .toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'section_key_invalid', key: 'Mecanisme-lesionnel', position: 4 });
    expect(await refusal({ ...d, sections: Array.from({ length: 501 }, (_, i) => ({ key: `s_${i}`, label: 'S' })) }))
      .toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'too_many', list: 'sections', limit: 500, count: 501 });
    expect(await refusal({ ...d, sections: sections.map((s) => (s.key === 'detail' ? { ...s, parentKey: 'absent' } : s)) }))
      .toMatchObject({ reason: 'section_parent_invalid', key: 'detail', parentKey: 'absent' });
    expect(await refusal({ ...d, sections: [...sections, sections[0]] }))
      .toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'section_duplicate', key: sections[0].key });
    expect(await refusal({ ...d, fields: [...fields, { fieldKey: 'orpheline', label: 'X', scope: 'patient', section: 'inexistante', type: 'text' }] }))
      .toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'field_section_unknown', key: 'orpheline', section: 'inexistante', position: 8 });
    expect(await refusal({ ...d, fields: [...fields, { fieldKey: ' ', label: 'X' }] }))
      .toMatchObject({ reason: 'field_key_invalid', position: 8 });
    // Erreur de conversion pendant l'insertion : l'etape, pas le texte PostgreSQL.
    expect(await refusal({ ...d, fields: fields.map((f) => (f.fieldKey === 'debut' ? { ...f, minValue: 'zero' } : f)) }))
      .toEqual({ code: 'TEMPLATE_IMPORT_INVALID', reason: 'content_incoherent', stage: 'fields' });
    expect(await templateCount(bob)).toBe(before);
  });

  // Les gardes du bloc pilote par le diagnostic tranchent l'import comme l'editeur : leur motif
  // remonte tel quel, et l'ecran l'explique (src/lib/errorMessage.ts).
  test('un bloc pilote par le diagnostic sans variable propre est refuse avec le motif de la garde', async () => {
    const d = await exportAs(alice, version);
    const before = await templateCount(bob);
    const fields = (d.fields as { fieldKey: string }[]).filter((f) => f.fieldKey !== 'geste');
    await expect(importAs(bob, { definition: { ...d, fields } })).rejects.toThrow('DIAGNOSIS_BLOCK_EMPTY');
    const rules = d.rules as { rule: { then: { section?: string } } }[];
    const blockRule = rules.find((r) => r.rule.then.section === 'bloc')!;
    await expect(importAs(bob, { definition: { ...d, rules: [...rules, { ...blockRule, message: 'Seconde règle' }] } }))
      .rejects.toThrow('DIAGNOSIS_BLOCK_NONCANONICAL');
    expect(await templateCount(bob)).toBe(before);
  });
});
