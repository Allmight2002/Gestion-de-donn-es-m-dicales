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
    total: number; target: number | null; targetDate: string | null; targetRevision: number;
    dateField?: string; monthly: { month: string; count: number }[];
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
  test('RPC definer : auth explicite, search_path fixe et EXECUTE limite a authenticated', async () => {
    const metadata = (await db.admin.query(
      `select p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
         from pg_proc p
        where p.oid = 'public.set_base_inclusion_target(uuid,integer,date,bigint)'::regprocedure`,
    )).rows[0];
    expect(metadata.prosecdef).toBe(true);
    expect(metadata.proconfig).toContain('search_path=public, pg_temp');
    expect(metadata.anon_exec).toBe(false);
    expect(metadata.authenticated_exec).toBe(true);
    const unauthenticated = (await db.admin.query(
      'select * from public.set_base_inclusion_target($1,1,null,0)',
      [baseId],
    )).rows[0];
    expect(unauthenticated.outcome).toBe('forbidden');
  });

  test('le proprietaire recoit total + serie mensuelle coherente ; l objectif se fixe et se lit', async () => {
    const s1 = await statsAs(aliceId);
    expect(s1.total).toBeGreaterThan(0);
    expect(s1.monthly.length).toBeGreaterThan(0);
    expect(s1.dateField).toBe('patient.inclusion_date');
    // La somme des mois = le total (serie coherente).
    expect(s1.monthly.reduce((acc, m) => acc + m.count, 0)).toBe(s1.total);
    expect(s1.target).toBeNull();

    // Le proprietaire fixe un objectif via la RPC gardee -> modification confirmee.
    const write = await rowsAs(
      aliceId,
      "select * from public.set_base_inclusion_target($1,150,'2026-12-31',$2)",
      [baseId, s1.targetRevision],
    );
    expect(write[0].outcome).toBe('updated');
    const s2 = await statsAs(aliceId);
    expect(s2.target).toBe(150);
    expect(s2.targetDate).toBe('2026-12-31');
    expect(s2.targetRevision).toBe(s1.targetRevision + 1);

    // Une commande acceptee avance le jeton meme si les valeurs metier sont deja identiques.
    const reaffirmed = await rowsAs(
      aliceId,
      "select * from public.set_base_inclusion_target($1,150,'2026-12-31',$2)",
      [baseId, s2.targetRevision],
    );
    expect(reaffirmed[0].outcome).toBe('updated');
    const s3 = await statsAs(aliceId);
    expect(s3.targetRevision).toBe(s2.targetRevision + 1);

    // Double soumission du meme payload avec l'ancien jeton : aucun second succes.
    const replay = await rowsAs(
      aliceId,
      "select * from public.set_base_inclusion_target($1,150,'2026-12-31',$2)",
      [baseId, s2.targetRevision],
    );
    expect(replay[0].outcome).toBe('stale');
    expect((await statsAs(aliceId)).target).toBe(150);

    const absent = await rowsAs(
      aliceId,
      'select * from public.set_base_inclusion_target($1,1,null,0)',
      ['00000000-0000-0000-0000-000000000001'],
    );
    expect(absent[0].outcome).toBe('not_found');
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

    // La RPC distingue explicitement le refus de l'ancien UPDATE silencieux a zero ligne.
    const refused = await rowsAs(
      bobId,
      'select * from public.set_base_inclusion_target($1,1,null,0)',
      [baseId],
    );
    expect(refused[0].outcome).toBe('forbidden');
    expect((await db.admin.query('select inclusion_target from public.base where id=$1', [baseId])).rows[0].inclusion_target).toBe(150);
  });

  test('deux ecritures concurrentes : une seule gagne ; entree invalide sans modification partielle', async () => {
    const before = (await db.admin.query(
      'select inclusion_target, inclusion_target_date, inclusion_target_revision from public.base where id=$1',
      [baseId],
    )).rows[0];
    const [a, b] = await Promise.all([
      rowsAs(aliceId, "select * from public.set_base_inclusion_target($1,151,'2027-01-31',$2)", [
        baseId,
        before.inclusion_target_revision,
      ]),
      rowsAs(aliceId, "select * from public.set_base_inclusion_target($1,152,'2027-02-28',$2)", [
        baseId,
        before.inclusion_target_revision,
      ]),
    ]);
    expect([a[0].outcome, b[0].outcome].sort()).toEqual(['stale', 'updated']);
    const current = (await db.admin.query(
      'select inclusion_target, inclusion_target_date, inclusion_target_revision from public.base where id=$1',
      [baseId],
    )).rows[0];
    expect([151, 152]).toContain(current.inclusion_target);
    expect(Number(current.inclusion_target_revision)).toBe(Number(before.inclusion_target_revision) + 1);

    const invalid = await rowsAs(
      aliceId,
      'select * from public.set_base_inclusion_target($1,$2,null,$3)',
      [baseId, -1, current.inclusion_target_revision],
    );
    expect(invalid[0].outcome).toBe('invalid_input');
    expect((await db.admin.query(
      'select inclusion_target, inclusion_target_date, inclusion_target_revision from public.base where id=$1',
      [baseId],
    )).rows[0]).toEqual(current);
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
