// =============================================================================
// test/rls.security.test.ts
// Tests de securite RLS OBLIGATOIRES (cahier technique §16).
//
// "La securite est testee comme une fonction du produit, pas verifiee
//  visuellement." (§12)
//
// Chaque scenario du §16 est verifie AU NIVEAU BASE DE DONNEES (RLS), avec un
// CONTROLE POSITIF associe : on prouve que la donnee existe et qu'un utilisateur
// legitime la voit, afin qu'un refus ne soit jamais un faux positif (table vide).
//
// Rappel : sur une requete SELECT, la RLS ne renvoie PAS d'erreur, elle masque
// les lignes -> un acces refuse se traduit par 0 ligne. Sur INSERT/UPDATE/DELETE
// ou via une fonction, un refus leve une erreur.
// =============================================================================
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;

// Identifiants resolus depuis le seed.
let adminId: string;   // global_role = system_admin
let aliceId: string;   // medecin proprietaire de la base
let bobId: string;     // medecin (collaborateur de test)
let annaId: string;    // analyste (acces analytique, sans identite)
let outsiderId: string; // membre SANS aucun acces a la base
let baseId: string;
let templateVersionId: string;

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
  annaId = byEmail.get('anna.analyst@demo.test')!;

  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  templateVersionId = (
    await db.admin.query('select current_template_version_id as tv from public.base where id = $1', [baseId])
  ).rows[0].tv;

  // Fixtures de test (via admin = service_role, contourne la RLS) :
  // un membre SANS acces, + invitations valide / expiree / revoquee.
  await db.admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
             'outsider@demo.test', crypt('Password123!', gen_salt('bf')), now(),
             '{}'::jsonb, '{"full_name":"Olivier Outsider"}'::jsonb, now(), now())`,
  );
  outsiderId = (await db.admin.query("select id from auth.users where email = 'outsider@demo.test'")).rows[0].id;

  // v3.0 : l'invitation ne stocke que l'empreinte du token (token_hash).
  await db.admin.query(
    `insert into public.base_invitation
       (base_id, invited_email, access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data,
        can_export_data, can_manage_access, token_hash, status, expires_at, invited_by)
     values
       ($1,'outsider@demo.test','viewer',false,false,false,false,false, encode(digest('tok-valid','sha256'),'hex'),  'pending', now() + interval '1 day', $2),
       ($1,'outsider@demo.test','viewer',false,false,false,false,false, encode(digest('tok-expired','sha256'),'hex'),'pending', now() - interval '1 day', $2),
       ($1,'outsider@demo.test','viewer',false,false,false,false,false, encode(digest('tok-revoked','sha256'),'hex'),'revoked', now() + interval '1 day', $2)`,
    [baseId, aliceId],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
// §16.1 — Un staff ne lit NI les identites NI les donnees analytiques d'une base.
// ---------------------------------------------------------------------------
describe('§16.1 staff cloisonne (aucune donnee patient)', () => {
  test('staff -> patient_identity : refuse (0 ligne)', async () => {
    expect(await rowsAs(adminId, 'select * from public.patient_identity')).toHaveLength(0);
  });

  test('staff -> patient (analytique) : refuse (0 ligne)', async () => {
    expect(await rowsAs(adminId, 'select * from public.patient')).toHaveLength(0);
  });

  test('controle positif : le proprietaire lit bien les identites', async () => {
    expect((await rowsAs(aliceId, 'select * from public.patient_identity')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §16.2 — Un analyste ne lit pas les images (zone restreinte).
// ---------------------------------------------------------------------------
describe('§16.2 analyste sans images', () => {
  test('analyst -> clinical_attachment : refuse (0 ligne)', async () => {
    expect(await rowsAs(annaId, 'select * from public.clinical_attachment')).toHaveLength(0);
  });

  test("controle positif : l'analyste lit bien les donnees analytiques", async () => {
    expect((await rowsAs(annaId, 'select * from public.patient')).length).toBeGreaterThan(0);
  });

  test('controle positif : le proprietaire voit bien les images', async () => {
    expect((await rowsAs(aliceId, 'select * from public.clinical_attachment')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §16.3 — Un collaborateur SANS includes_identity ne lit pas les noms.
// ---------------------------------------------------------------------------
describe('§16.3 collaborateur sans acces identite', () => {
  test('editor (can_view_identity=false) -> patient_identity : refuse', async () => {
    await db.admin.query(
      `insert into public.base_access (base_id, user_id, access_role, can_view_identity, can_edit_structured_data, granted_by)
       values ($1,$2,'editor',false,true,$3)
       on conflict (base_id, user_id) do update set
         access_role='editor', can_view_identity=false, can_edit_structured_data=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    expect(await rowsAs(bobId, 'select full_name from public.patient_identity')).toHaveLength(0);
  });

  test('controle positif : ce meme collaborateur lit les donnees analytiques', async () => {
    expect((await rowsAs(bobId, 'select * from public.patient')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §16.4 — Un utilisateur sans base_access ne voit pas la base.
// ---------------------------------------------------------------------------
describe('§16.4 etranger a la base', () => {
  test('outsider -> base : refuse (0 ligne)', async () => {
    expect(await rowsAs(outsiderId, 'select * from public.base')).toHaveLength(0);
  });

  test('outsider -> patient : refuse (0 ligne)', async () => {
    expect(await rowsAs(outsiderId, 'select * from public.patient')).toHaveLength(0);
  });

  test('controle positif : le proprietaire voit sa base', async () => {
    expect((await rowsAs(aliceId, 'select * from public.base')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §16.5 — Un export tentant d'inclure un champ identifiant est bloque.
// ---------------------------------------------------------------------------
describe('§16.5 export sans champ identifiant', () => {
  test('colonnes analytiques + meta : autorise', async () => {
    await expect(
      rowsAs(annaId, 'select public.assert_export_columns_safe($1, $2)', [
        templateVersionId,
        ['patient_code', 'age_value', 'glasgow_score', 'hemoglobin'],
      ]),
    ).resolves.toBeDefined();
  });

  test("full_name dans l'export : bloque", async () => {
    await expect(
      rowsAs(annaId, 'select public.assert_export_columns_safe($1, $2)', [
        templateVersionId,
        ['glasgow_score', 'full_name'],
      ]),
    ).rejects.toThrow(/identifiant interdit/i);
  });

  test("date_of_birth dans l'export : bloque", async () => {
    await expect(
      rowsAs(annaId, 'select public.assert_export_columns_safe($1, $2)', [
        templateVersionId,
        ['date_of_birth'],
      ]),
    ).rejects.toThrow(/identifiant interdit/i);
  });
});

// ---------------------------------------------------------------------------
// §16.6 — La revocation d'un acces prend effet immediatement.
// ---------------------------------------------------------------------------
describe('§16.6 revocation immediate', () => {
  test('avant revocation le collaborateur voit, apres il ne voit plus', async () => {
    await db.admin.query(
      `insert into public.base_access (base_id, user_id, access_role, can_view_identity, can_edit_structured_data, granted_by)
       values ($1,$2,'editor',false,true,$3)
       on conflict (base_id, user_id) do update set
         access_role='editor', can_view_identity=false, can_edit_structured_data=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    expect((await rowsAs(bobId, 'select * from public.patient')).length).toBeGreaterThan(0);

    // Le proprietaire revoque (supprime la ligne d'acces).
    await db.asUser(aliceId, (c) =>
      c.query('delete from public.base_access where base_id = $1 and user_id = $2', [baseId, bobId]),
    );

    expect(await rowsAs(bobId, 'select * from public.patient')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16.7 — Une invitation expiree ou revoquee ne peut pas etre acceptee.
// ---------------------------------------------------------------------------
describe('§16.7 invitation expirable / revocable / a usage unique', () => {
  test('invitation expiree -> refus', async () => {
    await expect(
      rowsAs(outsiderId, 'select * from public.accept_invitation($1)', ['tok-expired']),
    ).rejects.toThrow(/expiree/i);
  });

  test('invitation revoquee -> refus', async () => {
    await expect(
      rowsAs(outsiderId, 'select * from public.accept_invitation($1)', ['tok-revoked']),
    ).rejects.toThrow(/non valable/i);
  });

  test('invitation valide -> cree un acces, et le compte voit alors la base', async () => {
    const access = await rowsAs(outsiderId, 'select * from public.accept_invitation($1)', ['tok-valid']);
    expect(access).toHaveLength(1);
    expect(access[0].base_id).toBe(baseId);
    // L'acces est effectif immediatement.
    expect((await rowsAs(outsiderId, 'select * from public.base')).length).toBeGreaterThan(0);
  });

  test('un token deja accepte ne peut pas etre reutilise (usage unique)', async () => {
    await expect(
      rowsAs(outsiderId, 'select * from public.accept_invitation($1)', ['tok-valid']),
    ).rejects.toThrow(/non valable/i);
  });
});
