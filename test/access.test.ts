// Tests DB de l'etape 12 (invitations + acces) : creation reservee au proprietaire,
// revocation empechant l'acceptation, lecture des profils collaborateurs (§8.10, §7).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let annaId: string; // analyste (a deja un acces a la base)
let bobId: string; // membre sans acces
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

// v3.0 : seul le hash du token est stocke (token_hash).
const INVITE = `insert into public.base_invitation(base_id, invited_email, access_role, token_hash, status, expires_at, invited_by)
  values($1,$2,$3, encode(digest($4,'sha256'),'hex'),'pending', now() + interval '1 day', auth.uid())`;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
});

afterAll(async () => {
  await db?.stop();
});

describe('invitations : gestion reservee au proprietaire', () => {
  test('le proprietaire invite ; un collaborateur (non proprietaire) ne peut pas', async () => {
    await db.asUser(aliceId, (c) => c.query(INVITE, [baseId, 'invite@demo.test', 'viewer', 'tok-owner']));
    await expect(rowsAs(annaId, INVITE, [baseId, 'x@demo.test', 'viewer', 'tok-anna'])).rejects.toThrow();
  });
});

describe('revocation d une invitation', () => {
  test('une invitation revoquee ne peut plus etre acceptee ; une valide cree l acces', async () => {
    await db.asUser(aliceId, (c) => c.query(INVITE, [baseId, 'bob@demo.test', 'editor', 'tok-revoked']));
    await db.asUser(aliceId, (c) => c.query("update public.base_invitation set status='revoked' where token_hash = encode(digest('tok-revoked','sha256'),'hex')"));
    await expect(rowsAs(bobId, 'select * from public.accept_invitation($1)', ['tok-revoked'])).rejects.toThrow();

    await db.asUser(aliceId, (c) => c.query(INVITE, [baseId, 'bob@demo.test', 'editor', 'tok-valid']));
    const access = await rowsAs(bobId, 'select * from public.accept_invitation($1)', ['tok-valid']);
    expect(access).toHaveLength(1);
    expect((await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).length).toBeGreaterThan(0);
  });
});

describe('lecture des profils collaborateurs (§8.10)', () => {
  test('le proprietaire voit le profil de ses collaborateurs ; un tiers non', async () => {
    expect(await rowsAs(aliceId, 'select full_name from public.profiles where id=$1', [annaId])).toHaveLength(1);
    // Un membre qui n'est pas proprietaire ne voit pas le profil d'un collaborateur.
    const outsider = annaId; // anna n'est pas proprietaire de la base
    expect(await rowsAs(outsider, 'select full_name from public.profiles where id=$1', [aliceId])).toHaveLength(0);
  });
});

describe('audit v12 §6.1 : anti-escalade via can_manage_access', () => {
  // Bob = DELEGATAIRE (uniquement can_manage_access) ; Anna = cible SANS permission (octrois nouveaux).
  beforeAll(async () => {
    await db.admin.query(
      `insert into public.base_access(base_id, user_id, access_role, can_manage_access, granted_by)
         values($1,$2,'viewer',true,$3)
       on conflict (base_id, user_id) do update set
         can_manage_access=true, can_view_identity=false, can_view_raw_documents=false,
         can_edit_structured_data=false, can_export_data=false, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    await db.admin.query(
      `insert into public.base_access(base_id, user_id, access_role, granted_by)
         values($1,$2,'viewer',$3)
       on conflict (base_id, user_id) do update set
         can_manage_access=false, can_view_identity=false, can_view_raw_documents=false,
         can_edit_structured_data=false, can_export_data=false, revoked_at=null`,
      [baseId, annaId, aliceId],
    );
  });

  test('un delegue NE PEUT PAS s auto-attribuer des droits sur SA propre ligne', async () => {
    await expect(rowsAs(bobId, 'update public.base_access set can_view_identity=true where base_id=$1 and user_id=$2', [baseId, bobId]))
      .rejects.toThrow(/propre ligne|anti-escalade/i);
    await expect(rowsAs(bobId, 'update public.base_access set can_export_data=true, can_edit_structured_data=true where base_id=$1 and user_id=$2', [baseId, bobId]))
      .rejects.toThrow(/propre ligne|anti-escalade/i);
    // Aucune permission acquise.
    expect((await db.admin.query('select can_view_identity, can_export_data from public.base_access where base_id=$1 and user_id=$2', [baseId, bobId])).rows[0])
      .toMatchObject({ can_view_identity: false, can_export_data: false });
  });

  test('un delegue ne peut ni accorder gestion/identite, ni une permission qu il ne detient pas', async () => {
    await expect(rowsAs(bobId, 'update public.base_access set can_manage_access=true where base_id=$1 and user_id=$2', [baseId, annaId]))
      .rejects.toThrow(/gestion des acces/i);
    await expect(rowsAs(bobId, 'update public.base_access set can_view_identity=true where base_id=$1 and user_id=$2', [baseId, annaId]))
      .rejects.toThrow(/identite/i);
    await expect(rowsAs(bobId, 'update public.base_access set can_edit_structured_data=true where base_id=$1 and user_id=$2', [baseId, annaId]))
      .rejects.toThrow(/non detenue/i); // bob n'a pas l'edition -> ne peut pas l'accorder
  });

  test('le PROPRIETAIRE, lui, gouverne librement (octroi d identite a un tiers)', async () => {
    await rowsAs(aliceId, 'update public.base_access set can_view_identity=true where base_id=$1 and user_id=$2', [baseId, annaId]);
    expect((await db.admin.query('select can_view_identity from public.base_access where base_id=$1 and user_id=$2', [baseId, annaId])).rows[0].can_view_identity).toBe(true);
  });
});
