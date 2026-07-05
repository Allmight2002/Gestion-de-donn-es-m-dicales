// Test DB des groupes de recherche (feature C2 v1) : un groupe et ses rattachements de bases sont
// STRICTEMENT PRIVES a leur proprietaire (RLS). Aucune incidence sur l'acces aux donnees.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire de la base + du groupe
let bobId: string;   // autre medecin (ne doit rien voir)
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base where owner_user_id=$1 limit 1', [aliceId])).rows[0].id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('C2 research_group (etiquette d organisation, privee)', () => {
  test('le proprietaire cree un groupe et rattache SA base ; un tiers ne voit rien et ne peut pas rattacher', async () => {
    const gid = (await rowsAs(aliceId, "insert into public.research_group(name, owner_user_id) values('Neuro-onco',$1) returning id", [aliceId]))[0].id;
    await rowsAs(aliceId, 'insert into public.research_group_base(group_id, base_id) values($1,$2)', [gid, baseId]);

    // Alice voit son groupe + la base rattachee.
    expect((await rowsAs(aliceId, 'select id from public.research_group where id=$1', [gid])).length).toBe(1);
    expect((await rowsAs(aliceId, 'select base_id from public.research_group_base where group_id=$1', [gid]))[0].base_id).toBe(baseId);

    // Bob (autre medecin) ne voit PAS le groupe d'Alice (prive).
    expect(await rowsAs(bobId, 'select id from public.research_group where id=$1', [gid])).toHaveLength(0);
    // ...et ne peut pas rattacher une base a un groupe qui n'est pas le sien.
    await expect(rowsAs(bobId, 'insert into public.research_group_base(group_id, base_id) values($1,$2)', [gid, baseId]))
      .rejects.toThrow();

    // Alice detache -> la base n'est plus rattachee (la base elle-meme n'est pas touchee).
    await rowsAs(aliceId, 'delete from public.research_group_base where base_id=$1', [baseId]);
    expect(await rowsAs(aliceId, 'select base_id from public.research_group_base where group_id=$1', [gid])).toHaveLength(0);
    expect((await db.admin.query('select count(*)::int n from public.base where id=$1', [baseId])).rows[0].n).toBe(1);
  });

  test('le soft delete d une base supprime ses rattachements de groupes', async () => {
    const gid = (await rowsAs(aliceId, "insert into public.research_group(name, owner_user_id) values('A supprimer',$1) returning id", [aliceId]))[0].id;
    await rowsAs(aliceId, 'insert into public.research_group_base(group_id, base_id) values($1,$2)', [gid, baseId]);

    expect((await db.admin.query('select count(*)::int n from public.research_group_base where base_id=$1', [baseId])).rows[0].n).toBe(1);

    await rowsAs(aliceId, 'select public.soft_delete_base($1, $2)', [baseId, 'test groupe']);

    expect((await db.admin.query('select count(*)::int n from public.research_group_base where base_id=$1', [baseId])).rows[0].n).toBe(0);
    expect((await db.admin.query('select deleted_at is not null as deleted from public.base where id=$1', [baseId])).rows[0].deleted).toBe(true);
  });
});
