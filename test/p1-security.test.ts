// Regressions P1 : roles globaux, base_access reserve aux medecins,
// et lecture d'identite audit-before-return.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let adminId: string;
let aliceId: string;
let bobId: string;
let curatorId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  adminId = byEmail.get('admin@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  curatorId = byEmail.get('curator1@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('P1 base_access reserve aux medecins', () => {
  test('un proprietaire ne peut plus inserer un acces actif en direct', async () => {
    await expect(
      rowsAs(
        aliceId,
        "insert into public.base_access(base_id,user_id,access_role,granted_by) values($1,$2,'viewer',$3)",
        [baseId, curatorId, aliceId],
      ),
    ).rejects.toThrow();
  });

  test('un compte system_admin invite ne peut pas accepter un acces patient', async () => {
    await db.admin.query(
      `insert into public.base_invitation
         (base_id, invited_email, access_role, token_hash, status, expires_at, invited_by)
       values ($1, 'admin@demo.test', 'viewer', encode(digest('tok-admin-p1','sha256'),'hex'), 'pending', now() + interval '1 day', $2)`,
      [baseId, aliceId],
    );

    await expect(rowsAs(adminId, 'select * from public.accept_invitation($1)', ['tok-admin-p1']))
      .rejects.toThrow(/medecin/i);
  });
});

describe('P1 administration des roles', () => {
  test('system_admin modifie un autre profil sans reactiver ses anciens acces', async () => {
    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,can_export_data,granted_by)
         values($1,$2,'viewer',true,$3)
       on conflict (base_id,user_id) do update set
         access_role='viewer', can_export_data=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    expect(await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).toHaveLength(1);

    const changed = await rowsAs(adminId, "update public.profiles set global_role='curateur' where id=$1 returning global_role", [bobId]);
    expect(changed).toHaveLength(1);
    expect(changed[0].global_role).toBe('curateur');
    expect((await db.admin.query('select revoked_at from public.base_access where base_id=$1 and user_id=$2', [baseId, bobId])).rows[0].revoked_at)
      .not.toBeNull();

    const restored = await rowsAs(adminId, "update public.profiles set global_role='medecin' where id=$1 returning global_role", [bobId]);
    expect(restored).toHaveLength(1);
    expect(restored[0].global_role).toBe('medecin');
    expect(await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).toHaveLength(0);
  });

  test('system_admin ne peut pas modifier son propre role', async () => {
    await expect(
      rowsAs(adminId, "update public.profiles set global_role='medecin' where id=$1 returning global_role", [adminId]),
    ).rejects.toThrow(/propre global_role/i);
  });

  test('un medecin ne peut pas modifier le role d un autre profil', async () => {
    const rows = await rowsAs(aliceId, "update public.profiles set global_role='curateur' where id=$1 returning global_role", [bobId]);
    expect(rows).toHaveLength(0);
  });
});

describe('P1 identite audit-before-return', () => {
  test('la RPC audite avant de renvoyer l identite, le SELECT direct reste ferme', async () => {
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
    const before = Number((await db.admin.query(
      "select count(*)::int n from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2",
      [pid, aliceId],
    )).rows[0].n);

    const ident = await rowsAs(aliceId, 'select * from public.get_patient_identity($1)', [pid]);
    expect(ident).toHaveLength(1);
    expect(ident[0].patient_code).toMatch(/^NCH-/);

    const after = Number((await db.admin.query(
      "select count(*)::int n from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2",
      [pid, aliceId],
    )).rows[0].n);
    expect(after).toBe(before + 1);
    expect(await rowsAs(aliceId, 'select * from public.patient_identity')).toHaveLength(0);
  });
});

describe('P1 helpers internes non exposés', () => {
  test('un utilisateur ne peut pas appeler les helpers de permissions', async () => {
    await expect(
      rowsAs(
        aliceId,
        'select public.invitation_permissions_still_valid($1,$2,false,false,false,false,false)',
        [baseId, aliceId],
      ),
    ).rejects.toThrow(/permission|denied|refus/i);

    await expect(
      rowsAs(
        aliceId,
        'select public.assert_access_change_allowed($1,$2,false,false,false,false,false,false,false,false,false,false)',
        [baseId, bobId],
      ),
    ).rejects.toThrow(/permission|denied|refus/i);
  });
});
