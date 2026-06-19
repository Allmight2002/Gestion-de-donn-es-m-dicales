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
    await db.asUser(bobId, (c) =>
      c.query(
        "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
        [baseId, aliceId, bobId],
      ),
    );

    // Acces immediat.
    expect(await rowsAs(aliceId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
  });
});
