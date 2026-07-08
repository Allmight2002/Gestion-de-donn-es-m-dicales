// Test DB de la feature D2 (courbe d'inclusion) : agregats ANALYTIQUES par mois sous RLS
// (sans acces -> serie vide), objectif porte par la base (proprietaire seulement).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let bobId: string;   // aucun acces a la base
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const statsAs = async (uid: string) =>
  (await rowsAs(uid, 'select public.base_inclusion_stats($1) as s', [baseId]))[0].s as {
    total: number; target: number | null; targetDate: string | null; dateField?: string; monthly: { month: string; count: number }[];
  };

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

describe('D2 base_inclusion_stats (courbe d inclusion)', () => {
  test('le proprietaire recoit total + serie mensuelle coherente ; l objectif se fixe et se lit', async () => {
    const s1 = await statsAs(aliceId);
    expect(s1.total).toBeGreaterThan(0);
    expect(s1.monthly.length).toBeGreaterThan(0);
    expect(s1.dateField).toBe('patient.inclusion_date');
    // La somme des mois = le total (serie coherente).
    expect(s1.monthly.reduce((acc, m) => acc + m.count, 0)).toBe(s1.total);
    expect(s1.target).toBeNull();

    // Le proprietaire fixe un objectif (RLS base_update) -> visible dans les stats.
    await rowsAs(aliceId, "update public.base set inclusion_target=150, inclusion_target_date='2026-12-31' where id=$1", [baseId]);
    const s2 = await statsAs(aliceId);
    expect(s2.target).toBe(150);
    expect(s2.targetDate).toBe('2026-12-31');
  });

  test('la serie utilise la date scientifique d inclusion, pas created_at', async () => {
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 order by created_at limit 1', [baseId])).rows[0].id;
    await db.admin.query("update public.patient set inclusion_date='2020-01-15' where id=$1", [pid]);
    const s = await statsAs(aliceId);
    expect(s.monthly.some((m) => m.month === '2020-01')).toBe(true);
  });

  test('sans acces a la base : serie vide, total 0, objectif invisible ; et pas de modification possible', async () => {
    const s = await statsAs(bobId);
    expect(s.total).toBe(0);
    expect(s.monthly).toEqual([]);
    expect(s.target).toBeNull(); // la base est invisible pour lui (RLS)

    // Bob ne peut pas fixer l'objectif d'une base qui n'est pas la sienne (0 ligne touchee).
    await rowsAs(bobId, 'update public.base set inclusion_target=1 where id=$1', [baseId]);
    expect((await db.admin.query('select inclusion_target from public.base where id=$1', [baseId])).rows[0].inclusion_target).toBe(150);
  });
});

describe('B1 base_completeness_stats (completude par variable)', () => {
  type Row = {
    mode: 'historical' | 'current';
    fieldKey: string;
    label: string;
    scope: string;
    versionNumber: number;
    observed: number;
    missingCoded: number;
    filled: number;
    total: number;
  };
  const compAs = async (uid: string): Promise<Row[]> =>
    (await rowsAs(uid, 'select public.base_completeness_stats($1) as c', [baseId]))[0].c as Row[];

  test('taux coherents (verifies par comptage independant) + tri des moins completes d abord', async () => {
    const rows = await compAs(aliceId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.mode === 'historical')).toBe(true);

    // Champ PATIENT « sexe » : compare au comptage direct (admin).
    const sexe = rows.find((r) => r.fieldKey === 'sexe' && r.scope === 'patient');
    expect(sexe).toBeTruthy();
    const expTotal = Number((await db.admin.query("select count(*)::int n from public.patient where base_id=$1 and deleted_at is null", [baseId])).rows[0].n);
    const expFilled = Number((await db.admin.query("select count(*)::int n from public.patient where base_id=$1 and deleted_at is null and nullif(data->>'sexe','') is not null", [baseId])).rows[0].n);
    expect(sexe!.total).toBe(expTotal);
    expect(sexe!.filled).toBe(expFilled);
    expect(sexe!.observed).toBe(expFilled);
    expect(sexe!.missingCoded).toBe(0);

    // Les codes manquants sont distingues des valeurs observees.
    const hb = rows.find((r) => r.fieldKey === 'hemoglobin' && r.scope === 'encounter');
    expect(hb).toBeTruthy();
    expect(hb!.missingCoded).toBeGreaterThan(0);
    expect(hb!.filled).toBe(hb!.observed + hb!.missingCoded);

    // Champ RENCONTRE limite a un type (admission_date -> hospitalisation) : le denominateur est
    // le nombre de rencontres DE CE TYPE, pas toutes les rencontres.
    const adm = rows.find((r) => r.fieldKey === 'admission_date');
    if (adm) {
      const expHosp = Number((await db.admin.query(
        "select count(*)::int n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and p.deleted_at is null and e.deleted_at is null and e.encounter_type='hospitalisation'",
        [baseId])).rows[0].n);
      expect(adm.total).toBe(expHosp);
    }

    // Tri : les moins renseignees d'abord (ratios croissants, lignes sans denominateur a la fin).
    const ratios = rows.filter((r) => r.total > 0).map((r) => r.filled / r.total);
    for (let i = 1; i < ratios.length; i += 1) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
  });

  test('sans acces a la base : liste vide (RLS)', async () => {
    expect(await compAs(bobId)).toEqual([]);
  });

  test('la vue courante reste disponible separement pour l harmonisation', async () => {
    const current = (await rowsAs(aliceId, "select public.base_completeness_stats($1, 'current') as c", [baseId]))[0].c as Row[];
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((r) => r.mode === 'current')).toBe(true);
  });
});
