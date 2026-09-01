// Test DB de la feature B2 (file « a completer ») : dossiers non finalises + champs requis
// manquants, evalues contre LA version de gabarit de chaque entite, sous RLS.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
type Item = { kind: string; patientId: string; encounterId?: string; code: string; status: string; missing: string[] };
const queueAs = async (uid: string): Promise<Item[]> =>
  (await rowsAs(uid, 'select public.base_completion_queue($1) as q', [baseId]))[0].q as Item[];
type QueuePage = { items: Item[]; total: number; limit: number; offset: number; hasMore: boolean };
const queuePageAs = async (uid: string, limit: number, offset: number): Promise<QueuePage> =>
  (await rowsAs(uid, 'select public.base_completion_queue_page($1,$2,$3) as q', [baseId, limit, offset]))[0].q as QueuePage;

const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const CREATE_ENC = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';

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

describe('B2 base_completion_queue (file « a completer »)', () => {
  test('liste les dossiers non finalises avec les LABELS des champs requis manquants', async () => {
    // Patient DRAFT sans birth_year (requis) ; rencontre DRAFT sans glasgow_score (requis).
    const p = await rowsAs(aliceId, CREATE_PAT, [baseId, 'B2-001', 'Queue Test', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);
    await rowsAs(aliceId, CREATE_ENC, [p[0].id, 'consultation', '2024-05-01', 'draft', JSON.stringify({}), 'years']);

    const items = await queueAs(aliceId);
    const mine = items.filter((i) => i.code === 'B2-001');
    expect(mine.length).toBe(2); // donnees permanentes + rencontre
    expect(items.every((i) => i.status !== 'curated')).toBe(true); // les finalises n'apparaissent pas

    // Les manquants sont des LIBELLES du gabarit (directement actionnables a l'ecran).
    const byLabel = async (key: string) =>
      (await db.admin.query('select label from public.template_field tf join public.base b on b.current_template_version_id = tf.template_version_id where b.id=$1 and tf.field_key=$2', [baseId, key])).rows[0].label;
    const patItem = mine.find((i) => i.kind === 'patient')!;
    expect(patItem.missing).toContain(await byLabel('birth_year'));
    expect(patItem.missing).not.toContain(await byLabel('sexe')); // renseigne
    const encItem = mine.find((i) => i.kind === 'encounter')!;
    expect(encItem.missing).toContain(await byLabel('glasgow_score'));
    // admission_date (requis pour hospitalisation seulement) n'est PAS exige d'une consultation.
    expect(encItem.missing).not.toContain(await byLabel('admission_date'));
  });

  test('exclut les brouillons sans champ requis manquant et pagine le resultat', async () => {
    await rowsAs(aliceId, CREATE_PAT, [
      baseId,
      'B2-FULL',
      'Queue Complete',
      '1980-01-01',
      null,
      null,
      null,
      JSON.stringify({ sexe: 'F', birth_year: 1980 }),
    ]);
    const p2 = await rowsAs(aliceId, CREATE_PAT, [
      baseId,
      'B2-PAGE',
      'Queue Page',
      '1981-01-01',
      null,
      null,
      null,
      JSON.stringify({ sexe: 'M' }),
    ]);
    await rowsAs(aliceId, CREATE_ENC, [p2[0].id, 'consultation', '2024-05-02', 'draft', JSON.stringify({}), 'years']);

    const items = await queueAs(aliceId);
    expect(items.some((i) => i.code === 'B2-FULL')).toBe(false);
    expect(items.some((i) => i.code === 'B2-PAGE')).toBe(true);

    const first = await queuePageAs(aliceId, 1, 0);
    expect(first.items).toHaveLength(1);
    expect(first.total).toBeGreaterThan(1);
    expect(first.limit).toBe(1);
    expect(first.offset).toBe(0);
    expect(first.hasMore).toBe(true);

    const second = await queuePageAs(aliceId, 1, 1);
    expect(second.items).toHaveLength(1);
    expect(second.offset).toBe(1);
  });

  test('sans acces a la base : liste vide (RLS)', async () => {
    expect(await queueAs(bobId)).toEqual([]);
  });
});
