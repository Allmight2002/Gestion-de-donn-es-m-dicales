// Tests DB des gabarits (cahier v3.0) : ecriture admin pour les modeles globaux,
// possession par le medecin (edition libre de SON gabarit, jamais celui d'un autre),
// copie a la creation de base, visibilite, duplication, promotion.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let staffId: string;
let memberId: string;   // alice (medecin, proprietaire d'un gabarit personnel)
let bobId: string;      // bob (medecin) — ne possede pas le gabarit d'Alice
let globalVersionId: string;  // modele global officiel (a2)
let aliceVersionId: string;   // gabarit personnel d'Alice (a1)
let sourceFieldCount: number;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const ADD_FIELD = "insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,$2,'X','patient','clinique','text')";

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  staffId = byEmail.get('admin@demo.test')!;
  memberId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  globalVersionId = (
    await db.admin.query("select id from public.template_version where status = 'published' limit 1")
  ).rows[0].id;
  aliceVersionId = (
    await db.admin.query('select current_template_version_id as v from public.base where owner_user_id = $1', [memberId])
  ).rows[0].v;
  sourceFieldCount = Number(
    (await db.admin.query('select count(*)::int as n from public.template_field where template_version_id = $1', [
      globalVersionId,
    ])).rows[0].n,
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('ecriture reservee au staff (§7, §8.2)', () => {
  test('le staff cree gabarit + version draft + champ', async () => {
    await db.asUser(staffId, async (c) => {
      const t = await c.query("insert into public.template(name, specialty) values('Test','neuro') returning id");
      const v = await c.query(
        "insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id",
        [t.rows[0].id, staffId],
      );
      await c.query(
        "insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'f1','F1','patient','clinique','text')",
        [v.rows[0].id],
      );
    });
    // pas d'exception => succes
    expect(true).toBe(true);
  });

  test('un membre (non staff) ne peut pas creer de gabarit', async () => {
    await expect(rowsAs(memberId, "insert into public.template(name) values('X')")).rejects.toThrow();
  });
});

describe('possession du gabarit (medecin) + edition libre (v3.0)', () => {
  test('un medecin edite librement SON gabarit (ajout de champ, plus d immuabilite)', async () => {
    const before = (await rowsAs(memberId, 'select id from public.template_field where template_version_id=$1', [aliceVersionId])).length;
    await rowsAs(memberId, ADD_FIELD, [aliceVersionId, 'free_field']);
    expect((await rowsAs(memberId, 'select id from public.template_field where template_version_id=$1', [aliceVersionId])).length).toBe(before + 1);
  });

  test('un medecin ne peut PAS editer le gabarit d un autre, ni un modele global', async () => {
    await expect(rowsAs(bobId, ADD_FIELD, [aliceVersionId, 'intrus'])).rejects.toThrow();      // gabarit d'Alice
    await expect(rowsAs(memberId, ADD_FIELD, [globalVersionId, 'intrus2'])).rejects.toThrow();  // modele global
  });

  test('create_base_from_model copie le modele en gabarit personnel editable', async () => {
    const base = await rowsAs(memberId, 'select * from public.create_base_from_model($1,$2,$3)', ['Ma base', 'neuro', globalVersionId]);
    expect(base).toHaveLength(1);
    const newVer = base[0].current_template_version_id;
    expect(Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [newVer])).rows[0].n)).toBe(sourceFieldCount);
    await rowsAs(memberId, ADD_FIELD, [newVer, 'copie_field']); // editable par Alice (proprietaire de la copie)
    expect(Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [newVer])).rows[0].n)).toBe(sourceFieldCount + 1);
  });

  test('un curateur ne peut pas creer de base via create_base_from_model', async () => {
    const curatorId = (await db.admin.query("select id from auth.users where email='curator1@demo.test'")).rows[0].id;
    await expect(rowsAs(curatorId, 'select * from public.create_base_from_model($1,$2,$3)', ['X', 'y', globalVersionId])).rejects.toThrow(/medecin/i);
  });
});

describe('visibilite des versions (RLS tv_read)', () => {
  test('un membre ne voit pas les brouillons, mais voit les versions publiees', async () => {
    const draftId = (
      await db.asUser(staffId, async (c) => {
        const t = await c.query("insert into public.template(name) values('Draft only') returning id");
        return c.query(
          "insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id",
          [t.rows[0].id, staffId],
        );
      })
    ).rows[0].id;

    expect(await rowsAs(memberId, 'select id from public.template_version where id = $1', [draftId])).toHaveLength(0);
    expect(await rowsAs(staffId, 'select id from public.template_version where id = $1', [draftId])).toHaveLength(1);
    expect(
      await rowsAs(memberId, 'select id from public.template_version where id = $1', [globalVersionId]),
    ).toHaveLength(1);
  });
});

describe('duplication d une version (§8.2)', () => {
  test('un membre ne peut pas dupliquer', async () => {
    await expect(
      rowsAs(memberId, 'select * from public.duplicate_template_version($1)', [globalVersionId]),
    ).rejects.toThrow(/gestionnaire|gabarit/i);
  });

  test('le staff duplique -> nouvelle version draft, champs recopies, editable', async () => {
    const dup = await rowsAs(staffId, 'select * from public.duplicate_template_version($1)', [globalVersionId]);
    expect(dup).toHaveLength(1);
    expect(dup[0].status).toBe('draft');
    expect(dup[0].version_number).toBe(2);

    const copied = await rowsAs(staffId, 'select count(*)::int as n from public.template_field where template_version_id = $1', [
      dup[0].id,
    ]);
    expect(copied[0].n).toBe(sourceFieldCount);

    // La nouvelle version (draft) est editable, sans toucher l'originale.
    await db.asUser(staffId, (c) =>
      c.query(
        "insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'new_field','Nouveau','encounter','clinique','text')",
        [dup[0].id],
      ),
    );
    const after = await rowsAs(staffId, 'select count(*)::int as n from public.template_field where template_version_id = $1', [
      dup[0].id,
    ]);
    expect(after[0].n).toBe(sourceFieldCount + 1);
  });
});

describe('renommer et supprimer un gabarit (v3.0)', () => {
  test('le proprietaire renomme son gabarit ; un tiers ne peut pas (RLS)', async () => {
    const tplId = (await db.admin.query('select template_id from public.template_version where id=$1', [aliceVersionId])).rows[0].template_id;
    await rowsAs(memberId, 'update public.template set name=$1, specialty=$2 where id=$3', ['Neuro renomme', 'neurochirurgie', tplId]);
    expect((await db.admin.query('select name from public.template where id=$1', [tplId])).rows[0].name).toBe('Neuro renomme');
    // bob (non proprietaire) : l'UPDATE RLS n'affecte aucune ligne -> nom inchange.
    await rowsAs(bobId, 'update public.template set name=$1 where id=$2', ['Pirate', tplId]);
    expect((await db.admin.query('select name from public.template where id=$1', [tplId])).rows[0].name).toBe('Neuro renomme');
  });

  test('suppression REFUSEE si le gabarit est utilise par une base', async () => {
    const tplId = (await db.admin.query('select template_id from public.template_version where id=$1', [aliceVersionId])).rows[0].template_id;
    await expect(rowsAs(memberId, 'select public.delete_template($1)', [tplId])).rejects.toThrow(/utilise/i);
  });

  test('un tiers ne peut pas supprimer le gabarit d un autre', async () => {
    const tplId = (await db.asUser(staffId, (c) => c.query("insert into public.template(name) values('A supprimer') returning id"))).rows[0].id;
    await expect(rowsAs(bobId, 'select public.delete_template($1)', [tplId])).rejects.toThrow(/proprietaire/i);
  });

  test('le proprietaire supprime un gabarit NON utilise (cascade versions/champs)', async () => {
    const made = await db.asUser(staffId, async (c) => {
      const tpl = await c.query("insert into public.template(name) values('Jetable') returning id");
      const ver = await c.query("insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id", [tpl.rows[0].id, staffId]);
      await c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'f','F','patient','clinique','text')", [ver.rows[0].id]);
      return { tplId: tpl.rows[0].id, verId: ver.rows[0].id };
    });
    await rowsAs(staffId, 'select public.delete_template($1)', [made.tplId]);
    expect((await db.admin.query('select id from public.template where id=$1', [made.tplId])).rows).toHaveLength(0);
    expect((await db.admin.query('select id from public.template_version where id=$1', [made.verId])).rows).toHaveLength(0); // cascade
  });
});
