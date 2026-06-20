// Tests DB de l'etape 8 (corrections) : field_change_log (cahier §10, critere 12).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let baseId: string;
let encounterId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const CREATE_ENC = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';
const UPDATE_ENC = 'select * from public.update_encounter($1,$2::jsonb,$3,$4)';
const changes = (uid: string) =>
  rowsAs(uid, 'select field_key, old_value, new_value, reason, changed_by from public.field_change_log where entity=$1 and entity_id=$2 order by changed_at', ['encounter', encounterId]);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;

  const patient = await rowsAs(aliceId, CREATE_PAT, [baseId, 'CORR-001', 'Patient Corr', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);
  const enc = await rowsAs(aliceId, CREATE_ENC, [patient[0].id, 'hospitalisation', '2024-03-01', 'complete', JSON.stringify({ glasgow_score: 10, diagnosis: 'TC' }), 'years']);
  encounterId = enc[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('historique des corrections (field_change_log)', () => {
  test('une correction journalise ancienne/nouvelle valeur, auteur, motif ; champ inchange non journalise', async () => {
    const updated = await rowsAs(aliceId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 12, diagnosis: 'TC' }), 'verified', 'correction Glasgow']);
    expect(updated[0].validation_status).toBe('verified');
    expect(updated[0].data.glasgow_score).toBe(12);
    expect('date_of_birth' in updated[0].data).toBe(false);

    const log = await changes(aliceId);
    expect(log).toHaveLength(1); // seul glasgow_score a change (diagnosis inchange, age non journalise)
    expect(log[0].field_key).toBe('glasgow_score');
    expect(log[0].old_value).toBe(10);
    expect(log[0].new_value).toBe(12);
    expect(log[0].reason).toBe('correction Glasgow');
    expect(log[0].changed_by).toBe(aliceId);
  });

  test('une maj sans changement reel n ajoute aucune entree', async () => {
    await rowsAs(aliceId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 12, diagnosis: 'TC' }), 'verified', 'aucune modif']);
    expect(await changes(aliceId)).toHaveLength(1); // toujours 1
  });

  test('un analyste (lecture seule) ne peut pas corriger', async () => {
    await expect(
      rowsAs(annaId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 3 }), 'verified', 'tentative']),
    ).rejects.toThrow();
  });
});
