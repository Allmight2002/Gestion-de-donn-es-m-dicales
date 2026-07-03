// Tests DB de l'etape 5 (bases) : creation, propriete, visibilite owned/partagee (§7).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let bobId: string;
let aliceId: string;
let curatorId: string; // role global curateur (staff) — ne doit PAS pouvoir creer de base
let publishedVersionId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  bobId = byEmail.get('bob@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  curatorId = byEmail.get('curator1@demo.test')!;
  publishedVersionId = (
    await db.admin.query("select id from public.template_version where status = 'published' limit 1")
  ).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

async function bobCreatesBase(): Promise<string> {
  const rows = await db.asUser(bobId, async (c) =>
    (
      await c.query(
        "insert into public.base(name, specialty, owner_user_id, current_template_version_id) values('Base de Bob','neuro',$1,$2) returning id",
        [bobId, publishedVersionId],
      )
    ).rows,
  );
  return rows[0].id;
}

describe('creation et propriete d une base', () => {
  test('un membre cree une base dont il est proprietaire et la voit', async () => {
    const baseId = await bobCreatesBase();
    expect(await rowsAs(bobId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
  });

  test('un membre ne peut pas creer une base au nom d un autre (RLS with check)', async () => {
    await expect(
      rowsAs(bobId, "insert into public.base(name, owner_user_id, current_template_version_id) values('Usurpee',$1,$2)", [
        aliceId,
        publishedVersionId,
      ]),
    ).rejects.toThrow();
  });

  test('un compte staff (curateur) ne peut PAS creer de base (reserve au medecin)', async () => {
    await expect(
      rowsAs(curatorId, "insert into public.base(name, owner_user_id, current_template_version_id) values('Base staff',$1,$2)", [
        curatorId,
        publishedVersionId,
      ]),
    ).rejects.toThrow();
  });

  test('le proprietaire d une base est immuable (owner_user_id)', async () => {
    const baseId = await bobCreatesBase();
    await expect(
      rowsAs(bobId, 'update public.base set owner_user_id = $2 where id = $1', [baseId, aliceId]),
    ).rejects.toThrow(/immuable/i);
  });
});

describe('visibilite : privee par defaut, partage explicite', () => {
  test('une autre medecin ne voit pas la base, puis la voit apres partage', async () => {
    const baseId = await bobCreatesBase();

    // Alice n'a aucun acces -> base invisible.
    expect(await rowsAs(aliceId, 'select id from public.base where id = $1', [baseId])).toHaveLength(0);

    // Bob (proprietaire) partage avec Alice en lecture.
    await db.admin.query(
      "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
      [baseId, aliceId, bobId],
    );

    // Acces immediat.
    expect(await rowsAs(aliceId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
  });
});

describe('audit v12 §6.2 : rattachement a un gabarit etranger interdit', () => {
  test('le proprietaire ne peut pointer sa base que vers une version de SON gabarit', async () => {
    const baseId = await bobCreatesBase(); // pointe vers publishedVersionId (gabarit T_a)
    const tA = (await db.admin.query('select template_id from public.template_version where id=$1', [publishedVersionId])).rows[0].template_id;

    // Version d'un AUTRE gabarit (le seed en compte deux) -> rattachement REFUSE.
    const foreign = (await db.admin.query('select id from public.template_version where template_id <> $1 limit 1', [tA])).rows[0].id;
    await expect(rowsAs(bobId, 'select * from public.set_base_template_version($1,$2)', [baseId, foreign]))
      .rejects.toThrow(/gabarit etranger/i);

    // Une nouvelle version du MEME gabarit reste acceptee (flux legitime createNextVersion).
    const sameTplNewVer = (await db.admin.query(
      "insert into public.template_version(template_id, version_number, status) values($1, 999, 'published') returning id",
      [tA],
    )).rows[0].id;
    await rowsAs(bobId, 'select * from public.set_base_template_version($1,$2)', [baseId, sameTplNewVer]);
    expect((await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id).toBe(sameTplNewVer);
  });

  test('la version courante ne peut plus etre detachee puis remplacee par un gabarit prive etranger', async () => {
    const baseId = await bobCreatesBase();
    await expect(rowsAs(bobId, 'update public.base set current_template_version_id=null where id=$1', [baseId]))
      .rejects.toThrow(/toujours pointer|gabarit/i);
  });
});

describe('suppression de base : soft delete audite uniquement', () => {
  test('le DELETE physique direct est ferme ; soft_delete_base masque la base et ses patients', async () => {
    const baseId = await bobCreatesBase();
    const tv = (await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'BASE-DEL-1',$2,'{}'::jsonb)",
      [baseId, tv],
    );

    expect(await rowsAs(bobId, 'delete from public.base where id=$1 returning id', [baseId])).toHaveLength(0);
    expect((await db.admin.query('select deleted_at from public.base where id=$1', [baseId])).rows[0].deleted_at).toBeNull();

    await rowsAs(bobId, 'select public.soft_delete_base($1,$2)', [baseId, 'fin etude']);
    expect(await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).toHaveLength(0);
    expect(await rowsAs(bobId, 'select id from public.patient where base_id=$1', [baseId])).toHaveLength(0);
    expect((await db.admin.query('select deleted_at, deletion_reason from public.base where id=$1', [baseId])).rows[0])
      .toMatchObject({ deletion_reason: 'fin etude' });
  });
});
