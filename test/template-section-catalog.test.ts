// =============================================================================
// L59 — catalogue des blocs importables (`list_importable_template_sections`).
//
// La fonction ne fait qu'une chose : dire a l'editeur QUELS blocs il a le droit d'importer,
// et combien de variables chacun porte. Ce qui doit etre prouve ici tient en deux points.
//
//   1. Le catalogue et l'import voient EXACTEMENT la meme chose. Un bloc propose que l'import
//      refuserait pour `IMPORT_SOURCE_FORBIDDEN` serait un piege ; un bloc cache que l'import
//      accepterait serait une fonction perdue. Les deux sens sont testes.
//   2. Le compte annonce est celui que l'import copiera reellement — meme primitive
//      d'appartenance, miroir texte compris.
//
// RAPPEL DE LECTURE : les fixtures ecrivent avec `db.admin` (superutilisateur), ou
// `auth.uid()` est NULL. Tout ce qui releve de la RLS passe donc par `asUser(...)`.
// =============================================================================
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
const alice = '22222222-2222-2222-2222-222222222222';
const bob = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => { db = await startTestDb({ seed: true }); }, 240_000);
afterAll(async () => { await db?.stop(); });

interface Row {
  template_id: string; template_name: string | null; is_global: boolean;
  version_id: string; version_number: number; version_status: string;
  section_key: string; label: string; display_order: number;
  subsection_count: number; field_count: number;
}

const catalog = (user = alice) => db.asUser(user, (c) =>
  c.query<Row>('select * from public.list_importable_template_sections()')).then((r) => r.rows);

const blocksOf = async (versionId: string, user = alice) =>
  (await catalog(user)).filter((row) => row.version_id === versionId);

async function newVersion(owner = alice, status = 'draft') {
  const templateId = (await db.admin.query(
    'insert into public.template(name, owner_user_id, is_global) values($1,$2,false) returning id',
    [`L59 ${crypto.randomUUID()}`, owner],
  )).rows[0].id as string;
  const versionId = (await db.admin.query(
    'insert into public.template_version(template_id, version_number, status, created_by) values($1,1,$2,$3) returning id',
    [templateId, status, owner],
  )).rows[0].id as string;
  return { templateId, versionId };
}

/**
 * Un bloc `tuberculose` a DEUX sous-sections et QUATRE variables portees, plus un bloc voisin
 * `autre` a une seule variable et un pilote au tronc commun. Le tronc commun n'appartient a
 * aucun bloc : il ne doit jamais gonfler un compte.
 */
async function sourceFixture(owner = alice) {
  const v = await newVersion(owner);
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     values ($1,'tuberculose','Tuberculose',0), ($1,'clinique','Clinique',1),
            ($1,'biologie','Biologie',2), ($1,'autre','Autre bloc',3)`,
    [v.versionId],
  );
  await db.admin.query(
    `update public.template_section set parent_section_id =
       (select id from public.template_section where template_version_id=$1 and section_key='tuberculose')
      where template_version_id=$1 and section_key in ('clinique','biologie')`,
    [v.versionId],
  );
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order)
     values ($1,'diagnostic','Diagnostic','patient',null,'text',0),
            ($1,'bk_crachats','BK crachats','patient','tuberculose','text',1),
            ($1,'date_debut','Date de debut','patient','clinique','date',2),
            ($1,'toux','Toux','patient','clinique','boolean',3),
            ($1,'poids','Poids','patient','biologie','number',4),
            ($1,'age_autre','Age declare','patient','autre','integer',5)`,
    [v.versionId],
  );
  return v;
}

describe('L59 — catalogue des blocs importables', () => {
  test('liste les blocs racines avec les variables des sous-sections, jamais les sous-sections', async () => {
    const src = await sourceFixture();
    const rows = await blocksOf(src.versionId);

    // Une sous-section ne s'importe pas seule (`IMPORT_SOURCE_NOT_A_BLOCK`) : elle n'a donc
    // rien a faire dans un catalogue de blocs.
    expect(rows.map((r) => r.section_key)).toEqual(['tuberculose', 'autre']);

    const tuberculose = rows[0];
    expect(tuberculose.subsection_count).toBe(2);
    // 1 portee par le bloc + 2 par `clinique` + 1 par `biologie`. Le pilote du tronc commun
    // n'est compte nulle part.
    expect(tuberculose.field_count).toBe(4);
    expect(tuberculose.label).toBe('Tuberculose');
    expect(tuberculose.version_status).toBe('draft');
    expect(rows[1]).toMatchObject({ section_key: 'autre', subsection_count: 0, field_count: 1 });
  });

  test('le compte annonce est celui que l import copie reellement', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    const announced = (await blocksOf(src.versionId)).find((r) => r.section_key === 'tuberculose')!;

    const report = await db.asUser(alice, (c) => c.query(
      'select public.import_template_section($1,$2,$3) as r', [src.versionId, 'tuberculose', tgt.versionId],
    )).then((r) => r.rows[0].r as { importedFields: string[]; subsections: string[] });

    expect(report.importedFields).toHaveLength(announced.field_count);
    expect(report.subsections).toHaveLength(announced.subsection_count);
  });

  test('compte aussi une variable rattachee par le seul code texte', async () => {
    // `section_id` reste nul quand le code texte ne designe encore aucune section (voir
    // `sync_template_field_section`). L'import, lui, ramasse cette variable : le catalogue
    // doit annoncer le meme nombre, sans quoi l'apercu contredirait l'ecriture.
    const v = await newVersion();
    await db.admin.query(
      `insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order)
       values ($1,'orpheline','Orpheline','patient','tardif','text',0)`,
      [v.versionId],
    );
    await db.admin.query(
      "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'tardif','Section tardive',0)",
      [v.versionId],
    );
    expect((await db.admin.query(
      "select section_id from public.template_field where template_version_id=$1 and field_key='orpheline'", [v.versionId],
    )).rows[0].section_id).toBeNull();

    expect((await blocksOf(v.versionId))[0]).toMatchObject({ section_key: 'tardif', field_count: 1 });
  });

  test('le parcours complet : un bloc de vingt variables insere en une seule operation', async () => {
    // Le cas dimensionnant du §1 de la spec — douze blocs d’environ vingt variables — joue
    // ici de bout en bout, dans l'ordre exact de l'ecran : catalogue, apercu, ecriture.
    const src = await newVersion(bob);
    await db.admin.query(
      `insert into public.template_section(template_version_id, section_key, label, display_order)
       values ($1,'vingt','Bloc de vingt',0), ($1,'v_clinique','Clinique',1), ($1,'v_biologie','Biologie',2)`,
      [src.versionId],
    );
    await db.admin.query(
      `update public.template_section set parent_section_id =
         (select id from public.template_section where template_version_id=$1 and section_key='vingt')
        where template_version_id=$1 and section_key in ('v_clinique','v_biologie')`,
      [src.versionId],
    );
    // Reparties sur le bloc et ses deux sous-sections, comme un vrai bloc clinique.
    const sections = ['vingt', 'v_clinique', 'v_biologie'];
    for (let i = 0; i < 20; i += 1) {
      await db.admin.query(
        `insert into public.template_field(template_version_id, field_key, label, scope, section, type, required, display_order)
         values ($1,$2,$3,'patient',$4,'text',$5,$6)`,
        [src.versionId, `v_${i}`, `Variable ${i}`, sections[i % 3], i < 3, i],
      );
    }
    // Source lisible par une autre praticienne, comme dans la spec : par la base partagee.
    const baseId = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) values ('L59 vingt', $1, $2) returning id",
      [bob, src.versionId],
    )).rows[0].id as string;
    await db.admin.query(
      "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
      [baseId, alice, bob],
    );

    const tgt = await newVersion(alice);
    const announced = (await blocksOf(src.versionId)).find((r) => r.section_key === 'vingt')!;
    expect(announced).toMatchObject({ subsection_count: 2, field_count: 20 });

    const previewed = await db.asUser(alice, (c) => c.query(
      'select public.preview_template_section_import($1,$2,$3) as r', [src.versionId, 'vingt', tgt.versionId],
    )).then((r) => r.rows[0].r as { importedFields: string[]; conflicts: unknown[] });
    expect(previewed.importedFields).toHaveLength(20);
    expect(previewed.conflicts).toEqual([]);
    // L'apercu n'ecrit rien : la cible est encore vide juste avant l'import.
    expect((await db.admin.query(
      'select count(*)::int as n from public.template_field where template_version_id = $1', [tgt.versionId],
    )).rows[0].n).toBe(0);

    const written = await db.asUser(alice, (c) => c.query(
      'select public.import_template_section($1,$2,$3) as r', [src.versionId, 'vingt', tgt.versionId],
    )).then((r) => r.rows[0].r as { importedFields: string[] });
    expect(written.importedFields).toHaveLength(20);

    const landed = (await db.admin.query(
      `select tf.field_key, tf.required, ts.section_key
         from public.template_field tf left join public.template_section ts on ts.id = tf.section_id
        where tf.template_version_id = $1 order by tf.field_key`,
      [tgt.versionId],
    )).rows as { field_key: string; required: boolean; section_key: string | null }[];
    expect(landed).toHaveLength(20);
    // Les sous-sections de la CIBLE, jamais celles de la source (deux passes de parente).
    expect(new Set(landed.map((r) => r.section_key))).toEqual(new Set(['vingt', 'v_clinique', 'v_biologie']));
    // `required` est importe tel quel (D9) : c’est ce que l’avertissement de L59 annonce.
    expect(landed.filter((r) => r.required)).toHaveLength(3);
  });

  test('la RLS filtre comme l import : version d un autre medecin cachee, puis visible par la base partagee', async () => {
    const src = await sourceFixture(bob);
    // Le negatif AVANT le positif : un catalogue vide ferait passer le controle tout seul.
    expect(await blocksOf(src.versionId)).toEqual([]);

    const baseId = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) values ('L59 partagee', $1, $2) returning id",
      [bob, src.versionId],
    )).rows[0].id as string;
    await db.admin.query(
      "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
      [baseId, alice, bob],
    );

    const rows = await blocksOf(src.versionId);
    expect(rows.map((r) => r.section_key)).toEqual(['tuberculose', 'autre']);
    expect(rows[0].field_count).toBe(4);
    // `can_read_template` couvre la base partagee ; la policy `template_read` du gabarit
    // lui-meme, non. Le bloc reste donc propose — l'import l'accepte — et seul le NOM manque :
    // c'est pourquoi le catalogue ne joint pas `template` en inner join.
    expect(rows[0].template_name).toBeNull();
    expect(rows[0].template_id).toBe(src.templateId);

    // Preuve que le catalogue ne ment pas : la meme source passe l'autorisation de l'import.
    const tgt = await newVersion(alice);
    const report = await db.asUser(alice, (c) => c.query(
      'select public.preview_template_section_import($1,$2,$3) as r',
      [src.versionId, 'tuberculose', tgt.versionId],
    )).then((r) => r.rows[0].r as { importedFields: string[]; conflicts: unknown[] });
    expect(report.importedFields).toHaveLength(4);
    expect(report.conflicts).toEqual([]);
  });

  test('le modele global est propose a tout medecin, avec son nom', async () => {
    const globalRows = (await catalog(bob)).filter((r) => r.is_global);
    expect(globalRows.length).toBeGreaterThan(0);
    expect(globalRows[0].template_name).toBe('Neurochirurgie (modele standard)');
    expect(globalRows[0].version_status).toBe('published');
  });

  test('lecture reservee a authenticated, fermee a anon', async () => {
    const acl = (await db.admin.query<{ anon: boolean; authenticated: boolean; secdef: boolean }>(`
      select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             p.prosecdef as secdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'list_importable_template_sections'
    `)).rows;
    expect(acl).toHaveLength(1);
    // `security invoker` : c'est la RLS qui filtre, pas un privilege emprunte.
    expect(acl[0]).toEqual({ anon: false, authenticated: true, secdef: false });
  });
});
