// Tests DB de la RPC download_base_snapshot (audit v9 P1 §8) : tout l'instantane ANALYTIQUE en UN
// appel (base + champs + patients AVEC rencontres), analytique seulement, soumis a la RLS.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let bobId: string;   // aucun acces a la base (dans une base fraiche)
let baseId: string;

const snapshotAs = (uid: string) =>
  db.asUser(uid, async (c: Client) => (await c.query('select public.download_base_snapshot($1) as snap', [baseId])).rows[0].snap);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('§8 download_base_snapshot (instantane hors-ligne en 1 appel)', () => {
  test('le proprietaire recoit base + patients AVEC rencontres imbriquees, analytique seulement', async () => {
    const snap = await snapshotAs(aliceId);
    expect(snap.base.id).toBe(baseId);
    expect(Array.isArray(snap.fields)).toBe(true);
    expect(snap.patients.length).toBeGreaterThan(0);
    // Les rencontres sont imbriquees dans les patients (pas de N+1 cote client).
    expect(snap.patients.some((p: { encounters: unknown[] }) => Array.isArray(p.encounters) && p.encounters.length > 0)).toBe(true);

    // ANALYTIQUE SEULEMENT : aucune identite dans la charge utile (ni cle, ni valeur reelle).
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/full_name|date_of_birth|"phone"|"address"/);
    const aName = (await db.admin.query("select full_name from public.patient_identity where full_name is not null limit 1")).rows[0]?.full_name;
    if (aName) expect(text).not.toContain(aName);
  });

  test('un utilisateur SANS acces a la base recoit base=null et aucun patient (RLS)', async () => {
    const snap = await snapshotAs(bobId);
    expect(snap.base).toBeNull();
    expect(snap.patients).toEqual([]);
  });
});
