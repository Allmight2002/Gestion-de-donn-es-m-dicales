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

  test('un medecin cree un gabarit PERSONNEL (owner=soi, is_global=false) + version draft', async () => {
    const tpl = await rowsAs(memberId, "insert into public.template(name, specialty, is_global, owner_user_id) values('Mon gabarit','neuro',false,$1) returning id", [memberId]);
    expect(tpl).toHaveLength(1);
    const ver = await rowsAs(memberId, "insert into public.template_version(template_id, version_number, status) values($1,1,'draft') returning id, status", [tpl[0].id]);
    expect(ver[0].status).toBe('draft');
    // ... mais pas un modele GLOBAL (reserve a l'admin).
    await expect(rowsAs(memberId, "insert into public.template(name, is_global, owner_user_id) values('Global pirate', true, $1)", [memberId])).rejects.toThrow();
  });
});

describe('creation transactionnelle de jeu de variables', () => {
  const key = () => crypto.randomUUID();
  const create = (payload: unknown, operationKey = key()) =>
    rowsAs(memberId, 'select public.create_template_bundle($1::jsonb, $2::uuid) as result', [JSON.stringify(payload), operationKey]);

  test('la RPC transactionnelle resout pgcrypto dans le schema Supabase extensions', async () => {
    const config = (await db.admin.query(
      "select proconfig from pg_proc where oid = 'public.create_template_bundle(jsonb,uuid)'::regprocedure",
    )).rows[0].proconfig as string[];
    expect(config).toContain('search_path=public, extensions, pg_temp');
  });

  test('cree en bulk les champs ordonnes et la base optionnelle', async () => {
    const out = (await create({ name: 'Bundle nominal', specialty: 'neuro', withBase: true, baseName: 'Base bundle', fields: [
      { fieldKey: 'age', label: 'Age', scope: 'patient', section: 'clinique', type: 'integer', required: true },
      { fieldKey: 'sexe', label: 'Sexe', scope: 'patient', section: 'clinique', type: 'select', allowedValues: ['F', 'M'] },
    ] }))[0].result;
    expect(out.baseId).toBeTruthy();
    const fields = (await db.admin.query('select field_key, display_order from public.template_field where template_version_id=$1 order by display_order', [out.versionId])).rows;
    expect(fields).toEqual([{ field_key: 'age', display_order: 0 }, { field_key: 'sexe', display_order: 1 }]);
    expect((await db.admin.query('select current_template_version_id from public.base where id=$1', [out.baseId])).rows[0].current_template_version_id).toBe(out.versionId);
  });

  test('rejette les doublons avant toute creation et laisse zero modele partiel', async () => {
    const name = `Rejet-${Date.now()}`;
    await expect(create({ name, fields: [
      { fieldKey: 'x', label: 'Même', scope: 'patient', section: 'clinique', type: 'text' },
      { fieldKey: 'x', label: 'Même', scope: 'patient', section: 'clinique', type: 'text' },
    ] })).rejects.toThrow(/DUPLICATE_FIELD/);
    expect((await db.admin.query('select id from public.template where name=$1', [name])).rows).toHaveLength(0);
  });

  test('retry avec la meme cle retourne les memes identifiants, mais refuse un payload different', async () => {
    const operationKey = key();
    const payload = { name: `Retry-${Date.now()}`, fields: [{ fieldKey: 'one', label: 'One', scope: 'patient', section: 'clinique', type: 'text' }] };
    const first = (await create(payload, operationKey))[0].result;
    const retry = (await create(payload, operationKey))[0].result;
    expect(retry).toEqual(first);
    await expect(create({ ...payload, name: `${payload.name} bis` }, operationKey)).rejects.toThrow(/IDEMPOTENCY_KEY_REUSED/);
  });

  test('clone une version historique dans une entite independante', async () => {
    const out = (await create({ name: `Clone-${Date.now()}`, sourceVersionId: globalVersionId }))[0].result;
    const sourceCount = Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [globalVersionId])).rows[0].n);
    const cloneCount = Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [out.versionId])).rows[0].n);
    expect(cloneCount).toBe(sourceCount);
    await rowsAs(memberId, ADD_FIELD, [out.versionId, `independent_${Date.now()}`]);
    expect(Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [globalVersionId])).rows[0].n)).toBe(sourceCount);
  });
});

describe('possession du gabarit (medecin) + edition des drafts (v3.0)', () => {
  test('un medecin edite librement SON gabarit draft (ajout de champ)', async () => {
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

describe('immutabilite des versions publiees/archivees', () => {
  test('publication/archive passent par RPC ; une version publiee ne se modifie plus', async () => {
    const tpl = await rowsAs(
      memberId,
      "insert into public.template(name, specialty, is_global, owner_user_id) values('Lockable','neuro',false,$1) returning id",
      [memberId],
    );
    const ver = await rowsAs(
      memberId,
      "insert into public.template_version(template_id, version_number, status) values($1,1,'draft') returning id",
      [tpl[0].id],
    );
    const versionId = ver[0].id;
    await rowsAs(memberId, ADD_FIELD, [versionId, 'locked_field']);

    await rowsAs(memberId, 'select * from public.publish_template_version($1)', [versionId]);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('published');

    await expect(rowsAs(memberId, ADD_FIELD, [versionId, 'late_field'])).rejects.toThrow(/immuable|publiee|archivee/i);
    const fid = (await db.admin.query('select id from public.template_field where template_version_id=$1 limit 1', [versionId])).rows[0].id;
    await expect(rowsAs(memberId, "update public.template_field set label='Late' where id=$1", [fid])).rejects.toThrow(/immuable|publiee|archivee/i);
    await expect(
      rowsAs(memberId, 'insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2::jsonb,$3,$4)', [
        versionId,
        JSON.stringify({ operator: 'equals', left_field: 'locked_field', right_field: 'locked_field' }),
        'm',
        'block',
      ]),
    ).rejects.toThrow(/immuable|publiee|archivee/i);
    await expect(rowsAs(memberId, 'update public.template_version set version_number=2 where id=$1', [versionId])).rejects.toThrow(/structurelles|immuable/i);
    await expect(
      rowsAs(memberId, "update public.template_version set status='archived' where id=$1 returning status", [versionId]),
    ).rejects.toThrow(/RPC|reservee/i);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('published');

    await rowsAs(memberId, 'select * from public.archive_template_version($1)', [versionId]);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('archived');
    await expect(
      rowsAs(memberId, "update public.template_version set status='draft' where id=$1 returning status", [versionId]),
    ).rejects.toThrow(/RPC|reservee/i);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('archived');
  });

  test('suppression directe REFUSEE pour les versions publiees et archivees', async () => {
    const tpl = await rowsAs(
      memberId,
      "insert into public.template(name, specialty, is_global, owner_user_id) values('No direct delete','neuro',false,$1) returning id",
      [memberId],
    );
    const ver = await rowsAs(
      memberId,
      "insert into public.template_version(template_id, version_number, status) values($1,1,'draft') returning id",
      [tpl[0].id],
    );
    const versionId = ver[0].id;
    await rowsAs(memberId, ADD_FIELD, [versionId, 'stable_field']);
    await rowsAs(memberId, 'select * from public.publish_template_version($1)', [versionId]);

    expect(await rowsAs(memberId, 'delete from public.template_version where id=$1 returning id', [versionId])).toHaveLength(0);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('published');

    await rowsAs(memberId, 'select * from public.archive_template_version($1)', [versionId]);
    expect(await rowsAs(memberId, 'delete from public.template_version where id=$1 returning id', [versionId])).toHaveLength(0);
    expect((await db.admin.query('select status from public.template_version where id=$1', [versionId])).rows[0].status).toBe('archived');
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

  test('§8.2 le MEDECIN cree la version suivante de SON gabarit (copie editable, draft)', async () => {
    const aliceTpl = (await db.admin.query('select template_id from public.template_version where id=$1', [aliceVersionId])).rows[0].template_id;
    const next = await rowsAs(memberId, 'select * from public.create_next_personal_template_version($1)', [aliceTpl]);
    expect(next[0].status).toBe('draft');
    expect(Number((await db.admin.query('select count(*)::int n from public.template_field where template_version_id=$1', [next[0].id])).rows[0].n)).toBeGreaterThan(0);
    // editable : Alice ajoute un champ a la nouvelle version.
    await rowsAs(memberId, ADD_FIELD, [next[0].id, 'champ_v_suivante']);
  });

  test('§8.2 un tiers, ou un modele global, ne peut PAS via create_next_personal_template_version', async () => {
    const aliceTpl = (await db.admin.query('select template_id from public.template_version where id=$1', [aliceVersionId])).rows[0].template_id;
    await expect(rowsAs(bobId, 'select * from public.create_next_personal_template_version($1)', [aliceTpl])).rejects.toThrow(/proprietaire/i);
    const globalTpl = (await db.admin.query('select template_id from public.template_version where id=$1', [globalVersionId])).rows[0].template_id;
    await expect(rowsAs(memberId, 'select * from public.create_next_personal_template_version($1)', [globalTpl])).rejects.toThrow(/personnel|proprietaire/i);
  });
});

describe('§8.3 regles de validation : versionnement + structure (cote serveur)', () => {
  const ADD_RULE = 'insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2::jsonb,$3,$4)';
  let freshVer: string;     // version d'Alice SANS donnees
  let f0: string; let f1: string;

  test('preparation : une version neuve (copie) sans donnees', async () => {
    const aliceTpl = (await db.admin.query('select template_id from public.template_version where id=$1', [aliceVersionId])).rows[0].template_id;
    freshVer = (await rowsAs(memberId, 'select * from public.create_next_personal_template_version($1)', [aliceTpl]))[0].id;
    const fs = (await db.admin.query('select field_key from public.template_field where template_version_id=$1 order by display_order limit 2', [freshVer])).rows;
    f0 = fs[0].field_key; f1 = fs[1].field_key;
  });

  test('regle bien formee sur une version SANS donnees -> acceptee', async () => {
    await rowsAs(memberId, ADD_RULE, [freshVer, JSON.stringify({ operator: 'equals', left_field: f0, right_field: f1 }), 'm', 'block']);
    expect(true).toBe(true);
  });

  test('operateur hors liste blanche -> refuse', async () => {
    await expect(rowsAs(memberId, ADD_RULE, [freshVer, JSON.stringify({ operator: 'pwn', left_field: f0, right_field: f1 }), 'm', 'block'])).rejects.toThrow(/operateur/i);
  });

  test('champ reference inexistant -> refuse', async () => {
    await expect(rowsAs(memberId, ADD_RULE, [freshVer, JSON.stringify({ operator: 'equals', left_field: 'inexistant', right_field: f1 }), 'm', 'block'])).rejects.toThrow(/inconnu/i);
  });

  test('structure non reconnue -> refuse', async () => {
    await expect(rowsAs(memberId, ADD_RULE, [freshVer, JSON.stringify({ foo: 'bar' }), 'm', 'block'])).rejects.toThrow(/structure/i);
  });

  test('version DEJA UTILISEE -> ajout/suppression de regle refuse (creez une nouvelle version)', async () => {
    await expect(rowsAs(memberId, ADD_RULE, [aliceVersionId, JSON.stringify({ operator: 'equals', left_field: f0, right_field: f1 }), 'm', 'block'])).rejects.toThrow(/utilisee|nouvelle version/i);
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

  test('suppression directe d un gabarit refusee ; delete_template refuse les versions publiees', async () => {
    const made = await db.asUser(staffId, async (c) => {
      const tpl = await c.query("insert into public.template(name) values('RPC only') returning id");
      const ver = await c.query("insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id", [tpl.rows[0].id, staffId]);
      await c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'f','F','patient','clinique','text')", [ver.rows[0].id]);
      await c.query('select * from public.publish_template_version($1)', [ver.rows[0].id]);
      return { tplId: tpl.rows[0].id, verId: ver.rows[0].id };
    });

    expect(await rowsAs(staffId, 'delete from public.template where id=$1 returning id', [made.tplId])).toHaveLength(0);
    expect((await db.admin.query('select id from public.template where id=$1', [made.tplId])).rows).toHaveLength(1);

    await expect(rowsAs(staffId, 'select public.delete_template($1)', [made.tplId])).rejects.toThrow(/publie|archive/i);
    expect((await db.admin.query('select id from public.template where id=$1', [made.tplId])).rows).toHaveLength(1);
    expect((await db.admin.query('select id from public.template_version where id=$1', [made.verId])).rows).toHaveLength(1);
  });
});

describe('edition d un champ : libelle libre, nom/type verrouilles si la variable est utilisee', () => {
  const UPDATE =
    'select * from public.update_template_field($1,$2,$3,$4,$5,$6,$7)';

  test('variable VIERGE : le proprietaire change librement nom interne, type et libelle', async () => {
    const fid = (await rowsAs(memberId, ADD_FIELD + ' returning id', [aliceVersionId, 'vierge']))[0].id;
    // aucune donnee -> changement structurel autorise
    const out = await rowsAs(memberId, UPDATE, [fid, 'vierge_renomme', 'Libelle modifie', 'patient', 'biologie', 'integer', true]);
    expect(out[0].field_key).toBe('vierge_renomme');
    expect(out[0].type).toBe('integer');
    expect(out[0].label).toBe('Libelle modifie');
  });

  test('definit les VALEURS AUTORISEES (select) et les BORNES (number)', async () => {
    const UPDATE_FULL = 'select * from public.update_template_field($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::jsonb,$10::numeric,$11::numeric,$12,$13)';
    const sel = (await rowsAs(memberId, ADD_FIELD + ' returning id', [aliceVersionId, 'sexe_t']))[0].id;
    const outSel = await rowsAs(memberId, UPDATE_FULL, [sel, 'sexe_t', 'Sexe', 'patient', 'clinique', 'select', false, null, JSON.stringify(['M', 'F']), null, null, null, false]);
    expect(outSel[0].allowed_values).toEqual(['M', 'F']);
    const num = (await rowsAs(memberId, ADD_FIELD + ' returning id', [aliceVersionId, 'glasgow_t']))[0].id;
    const outNum = await rowsAs(memberId, UPDATE_FULL, [num, 'glasgow_t', 'Glasgow', 'patient', 'clinique', 'integer', false, null, null, 3, 15, 'pts', false]);
    expect(Number(outNum[0].min_value)).toBe(3);
    expect(Number(outNum[0].max_value)).toBe(15);
    expect(outNum[0].unit).toBe('pts');
  });

  test('variable UTILISEE : libelle OK mais nom interne / type REFUSES', async () => {
    const baseId = (await db.admin.query('select id from public.base where owner_user_id=$1', [memberId])).rows[0].id;
    const fid = (await db.asUser(memberId, (c) =>
      c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'usee','Usee','patient','clinique','text') returning id", [aliceVersionId]),
    )).rows[0].id;
    // une donnee patient porte desormais la cle 'usee'
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,$2,$3,$4)",
      [baseId, 'P-EDIT-' + Date.now(), aliceVersionId, JSON.stringify({ usee: '42' })],
    );

    expect((await db.asUser(memberId, (c) => c.query('select public.template_field_in_use($1) as u', [fid]))).rows[0].u).toBe(true);

    // libelle seul -> OK
    const ok = await rowsAs(memberId, UPDATE, [fid, 'usee', 'Nouveau libelle', 'patient', 'clinique', 'text', false]);
    expect(ok[0].label).toBe('Nouveau libelle');
    // renommer la cle -> REFUSE
    await expect(rowsAs(memberId, UPDATE, [fid, 'usee_renomme', 'Nouveau libelle', 'patient', 'clinique', 'text', false])).rejects.toThrow(/utilis/i);
    // changer le type -> REFUSE
    await expect(rowsAs(memberId, UPDATE, [fid, 'usee', 'Nouveau libelle', 'patient', 'clinique', 'integer', false])).rejects.toThrow(/utilis/i);
    // §8.2 : changer le caractere REQUIS d'une variable utilisee -> REFUSE (changement semantique).
    await expect(rowsAs(memberId, UPDATE, [fid, 'usee', 'Nouveau libelle', 'patient', 'clinique', 'text', true])).rejects.toThrow(/utilis/i);
    // mais la SECTION (cosmetique) reste modifiable.
    const okSection = await rowsAs(memberId, UPDATE, [fid, 'usee', 'Nouveau libelle', 'patient', 'biologie', 'text', false]);
    expect(okSection[0].section).toBe('biologie');
    // la cle est restee 'usee' (rien casse cote donnees)
    expect((await db.admin.query('select field_key from public.template_field where id=$1', [fid])).rows[0].field_key).toBe('usee');
  });

  test('un tiers ne peut pas editer le champ d un autre gabarit', async () => {
    const fid = (await db.asUser(memberId, (c) =>
      c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'tiers','T','patient','clinique','text') returning id", [aliceVersionId]),
    )).rows[0].id;
    await expect(rowsAs(bobId, UPDATE, [fid, 'pirate', 'P', 'patient', 'clinique', 'text', false])).rejects.toThrow(/autoris/i);
  });

  test('suppression d un champ : OK si vierge, REFUSEE si utilise (garde serveur)', async () => {
    // Variable vierge -> suppression autorisee.
    const fOk = (await rowsAs(memberId, ADD_FIELD + ' returning id', [aliceVersionId, 'suppr_ok']))[0].id;
    await rowsAs(memberId, 'select public.delete_template_field($1)', [fOk]);
    expect((await db.admin.query('select id from public.template_field where id=$1', [fOk])).rows).toHaveLength(0);

    // Variable utilisee par une donnee patient -> suppression refusee, champ conserve.
    const baseId = (await db.admin.query('select id from public.base where owner_user_id=$1', [memberId])).rows[0].id;
    const fUsed = (await db.asUser(memberId, (c) =>
      c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'suppr_used','U','patient','clinique','text') returning id", [aliceVersionId]),
    )).rows[0].id;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,$2,$3,$4)",
      [baseId, 'P-DEL-' + Date.now(), aliceVersionId, JSON.stringify({ suppr_used: 'x' })],
    );
    await expect(rowsAs(memberId, 'select public.delete_template_field($1)', [fUsed])).rejects.toThrow(/utilis/i);
    expect((await db.admin.query('select id from public.template_field where id=$1', [fUsed])).rows).toHaveLength(1);
  });
});

describe('reordonner les variables (drag & drop)', () => {
  // Version globale fraiche (admin) : isolee, owns_template(admin)=true.
  async function freshVersionWithFields() {
    return db.asUser(staffId, async (c) => {
      const tpl = await c.query("insert into public.template(name) values('Ordre') returning id");
      const ver = await c.query(
        "insert into public.template_version(template_id, version_number, status, created_by) values($1,1,'draft',$2) returning id",
        [tpl.rows[0].id, staffId],
      );
      const v = ver.rows[0].id;
      const ids: string[] = [];
      for (const [k, ord] of [['a', 0], ['b', 1], ['c', 2]] as const) {
        const r = await c.query(
          "insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order) values($1,$2,$2,'patient','clinique','text',$3) returning id",
          [v, k, ord],
        );
        ids.push(r.rows[0].id);
      }
      return { v, ids }; // ids dans l'ordre a,b,c
    });
  }

  test('le proprietaire reordonne -> display_order reaffecte', async () => {
    const { v, ids } = await freshVersionWithFields();
    const [a, b, c] = ids;
    await rowsAs(staffId, 'select public.reorder_template_fields($1,$2::uuid[])', [v, [c, a, b]]);
    const rows = await db.admin.query('select field_key, display_order from public.template_field where template_version_id=$1 order by display_order', [v]);
    expect(rows.rows.map((r) => r.field_key)).toEqual(['c', 'a', 'b']);
    expect(rows.rows.map((r) => Number(r.display_order))).toEqual([0, 1, 2]);
  });

  test('un tiers ne peut pas reordonner', async () => {
    const { v, ids } = await freshVersionWithFields();
    await expect(
      rowsAs(bobId, 'select public.reorder_template_fields($1,$2::uuid[])', [v, [...ids].reverse()]),
    ).rejects.toThrow(/autoris/i);
  });

  test('§8.3 : une liste partielle ou avec doublon est refusee', async () => {
    const { v, ids } = await freshVersionWithFields(); // a, b, c
    // partielle (1 sur 3) -> refus
    await expect(rowsAs(staffId, 'select public.reorder_template_fields($1,$2::uuid[])', [v, [ids[0]]])).rejects.toThrow(/invalide|exactement/i);
    // doublon (4 ids dont un repete) -> refus
    await expect(rowsAs(staffId, 'select public.reorder_template_fields($1,$2::uuid[])', [v, [ids[0], ids[1], ids[2], ids[0]]])).rejects.toThrow(/invalide|exactement/i);
    // liste exacte -> OK
    await rowsAs(staffId, 'select public.reorder_template_fields($1,$2::uuid[])', [v, [ids[2], ids[1], ids[0]]]);
    expect(true).toBe(true);
  });
});

describe('audit v9 §5.3 : ecriture DIRECTE sur template_field bloquee par trigger (champ utilise)', () => {
  test('update semantique + delete directs refuses ; libelle direct OK', async () => {
    const baseId = (await db.admin.query('select id from public.base where owner_user_id=$1', [memberId])).rows[0].id;
    const fid = (await db.asUser(memberId, (c) =>
      c.query("insert into public.template_field(template_version_id, field_key, label, scope, section, type) values($1,'direct_used','U','patient','clinique','text') returning id", [aliceVersionId]),
    )).rows[0].id;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,$2,$3,$4)",
      [baseId, 'P-DIRECT-' + Date.now(), aliceVersionId, JSON.stringify({ direct_used: 'x' })],
    );
    // UPDATE direct du caractere requis (semantique) sur un champ UTILISE -> trigger refuse.
    await expect(rowsAs(memberId, 'update public.template_field set required=true where id=$1', [fid])).rejects.toThrow(/utilis/i);
    // DELETE direct d'un champ utilise -> trigger refuse.
    await expect(rowsAs(memberId, 'delete from public.template_field where id=$1', [fid])).rejects.toThrow(/utilis/i);
    // Le libelle (cosmetique) reste modifiable en direct.
    await rowsAs(memberId, "update public.template_field set label='Nouveau' where id=$1", [fid]);
    expect((await db.admin.query('select label from public.template_field where id=$1', [fid])).rows[0].label).toBe('Nouveau');
  });
});
