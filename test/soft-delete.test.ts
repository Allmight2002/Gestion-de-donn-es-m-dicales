// Tests DB de l'etape 13 (suppression logique, critere 12) : la ligne disparait de
// l'usage normal mais reste en base ; cascade patient -> identite/rencontres/images ;
// reservee a l'ecriture ; code reutilisable apres suppression.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let baseId: string;
let p1: string; // patient NCH-001 (a une image dans le seed)
let p3: string; // patient NCH-003 (2 rencontres dans le seed)

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const SD_PAT = 'select public.soft_delete_patient($1,$2)';
const SD_ENC = 'select public.soft_delete_encounter($1,$2)';

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  p1 = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-001'", [baseId])).rows[0].id;
  p3 = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-003'", [baseId])).rows[0].id;
});

afterAll(async () => {
  await db?.stop();
});

describe('suppression logique d un patient', () => {
  test('un analyste (lecture seule) ne peut pas supprimer', async () => {
    await expect(rowsAs(annaId, SD_PAT, [p1, 'tentative'])).rejects.toThrow();
  });

  test('le proprietaire supprime : cascade + disparait de l usage normal mais reste en base', async () => {
    await rowsAs(aliceId, SD_PAT, [p1, 'doublon']);

    // Disparait de l'usage normal (RLS filtre deleted_at).
    expect(await rowsAs(aliceId, 'select id from public.patient where id=$1', [p1])).toHaveLength(0);
    expect(await rowsAs(aliceId, "select id from public.patient_identity where base_id=$1 and patient_code='NCH-001'", [baseId])).toHaveLength(0);
    expect(await rowsAs(aliceId, 'select id from public.encounter where patient_id=$1', [p1])).toHaveLength(0);
    expect(await rowsAs(aliceId, 'select id from public.clinical_attachment where patient_id=$1', [p1])).toHaveLength(0);

    // Reste en base (acces admin/service, RLS contournee) avec la trace de suppression.
    const kept = (await db.admin.query('select deleted_at, deletion_reason from public.patient where id=$1', [p1])).rows[0];
    expect(kept.deleted_at).not.toBeNull();
    expect(kept.deletion_reason).toBe('doublon');
    expect((await db.admin.query("select id from public.patient_identity where base_id=$1 and patient_code='NCH-001'", [baseId])).rows).toHaveLength(1);
  });

  test('le code redevient reutilisable apres suppression logique', async () => {
    const r = await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
      baseId, 'NCH-001', 'Nouveau NCH-001', '1990-01-01', null, null, null, JSON.stringify({ sexe: 'M' }),
    ]);
    expect(r).toHaveLength(1);
  });
});

describe('suppression logique d une rencontre', () => {
  test('supprime une rencontre sans toucher aux autres', async () => {
    const before = (await rowsAs(aliceId, 'select id from public.encounter where patient_id=$1', [p3])).length;
    expect(before).toBeGreaterThan(1);
    const encId = (await rowsAs(aliceId, 'select id from public.encounter where patient_id=$1 limit 1', [p3]))[0].id;
    await rowsAs(aliceId, SD_ENC, [encId, 'erreur de saisie']);
    expect((await rowsAs(aliceId, 'select id from public.encounter where patient_id=$1', [p3])).length).toBe(before - 1);
  });
});
