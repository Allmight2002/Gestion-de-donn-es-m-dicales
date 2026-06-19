// Tests DB de l'etape 9 (images) : la table clinical_attachment est en ZONE RESTREINTE
// (cahier v3.0 §4.2, §13, critere §16.2). Acces identite requis ; jamais admin/analyste ;
// un editor SANS can_view_identity peut ecrire l'analytique mais PAS les images ;
// deidentification_confirmed obligatoire.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let bobId: string; // editor (identite togglee dans les tests)
let annaId: string; // analyste
let staffId: string;
let baseId: string;
let patientId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const INSERT_ATT = (deid = true) =>
  `insert into public.clinical_attachment(patient_id, kind, label, storage_path, mime_type, deidentification_confirmed, created_by)
   values($1,'imagerie','TDM','p/x.jpg','image/jpeg',${deid},auth.uid())`;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  staffId = byEmail.get('admin@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  patientId = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-001'", [baseId])).rows[0].id;
});

afterAll(async () => {
  await db?.stop();
});

describe('clinical_attachment = zone restreinte (lecture)', () => {
  test('le proprietaire voit les images ; admin et analyste ne voient rien', async () => {
    expect((await rowsAs(aliceId, 'select id from public.clinical_attachment where patient_id=$1', [patientId])).length).toBeGreaterThan(0);
    expect(await rowsAs(staffId, 'select id from public.clinical_attachment where patient_id=$1', [patientId])).toHaveLength(0);
    expect(await rowsAs(annaId, 'select id from public.clinical_attachment where patient_id=$1', [patientId])).toHaveLength(0);
  });
});

describe('can_view_identity gouverne l acces aux images', () => {
  test('un editor SANS identite : voit l analytique mais PAS les images, et ne peut pas en ajouter', async () => {
    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,can_view_identity,can_edit_structured_data,granted_by)
       values($1,$2,'editor',false,true,$3)
       on conflict (base_id,user_id) do update set
         access_role='editor', can_view_identity=false, can_edit_structured_data=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    expect((await rowsAs(bobId, 'select id from public.patient where id=$1', [patientId])).length).toBeGreaterThan(0); // analytique OK
    expect(await rowsAs(bobId, 'select id from public.clinical_attachment where patient_id=$1', [patientId])).toHaveLength(0); // images masquees
    await expect(rowsAs(bobId, INSERT_ATT(), [patientId])).rejects.toThrow();
  });

  test('un editor AVEC identite : voit et ajoute des images', async () => {
    await db.admin.query(
      "update public.base_access set can_view_identity=true, can_edit_structured_data=true where base_id=$1 and user_id=$2",
      [baseId, bobId],
    );
    await db.asUser(bobId, (c) => c.query(INSERT_ATT(), [patientId]));
    expect((await rowsAs(bobId, 'select id from public.clinical_attachment where patient_id=$1', [patientId])).length).toBeGreaterThan(0);
  });
});

describe('deidentification confirmee obligatoire (§13)', () => {
  test('inserer une image avec deidentification_confirmed=false -> refuse', async () => {
    await expect(rowsAs(aliceId, INSERT_ATT(false), [patientId])).rejects.toThrow();
  });
});
