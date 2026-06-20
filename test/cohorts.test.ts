// Tests DB de l'etape 10 (filtres + cohortes) : effectifs, cohorte figee
// (patients + rencontres), critere 8 (immuabilite apres ajout), RLS.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // owner
let annaId: string; // analyst (can_curate)
let bobId: string; // deviendra viewer (pas can_curate)
let baseId: string;
let expM: number; // patients sexe=M
let expMEnc: number; // rencontres des patients sexe=M
let expGcsP: number; // patients avec une rencontre glasgow>=12
let expGcsE: number; // rencontres glasgow>=12

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const PREVIEW = 'select * from public.cohort_preview($1, $2::jsonb)';
const SNAPSHOT = 'select * from public.create_cohort_snapshot($1, $2, $3::jsonb)';
const fM = JSON.stringify({ conditions: [{ scope: 'patient', field: 'sexe', op: 'eq', value: 'M' }] });
const fGcs = JSON.stringify({ conditions: [{ scope: 'encounter', field: 'glasgow_score', op: 'gte', value: 12 }] });

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;

  // Effectifs attendus calcules en SQL natif (croise-verification de jsonb_matches).
  expM = Number((await db.admin.query("select count(*)::int n from public.patient where base_id=$1 and data->>'sexe'='M' and deleted_at is null", [baseId])).rows[0].n);
  expMEnc = Number((await db.admin.query("select count(*)::int n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and p.data->>'sexe'='M' and e.deleted_at is null", [baseId])).rows[0].n);
  expGcsP = Number((await db.admin.query("select count(distinct p.id)::int n from public.patient p join public.encounter e on e.patient_id=p.id where p.base_id=$1 and (e.data->>'glasgow_score')::int>=12 and e.deleted_at is null", [baseId])).rows[0].n);
  expGcsE = Number((await db.admin.query("select count(*)::int n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and (e.data->>'glasgow_score')::int>=12 and e.deleted_at is null", [baseId])).rows[0].n);
});

afterAll(async () => {
  await db?.stop();
});

describe('effectifs (filtres)', () => {
  test('filtre permanent (sexe=M) : effectifs corrects', async () => {
    const r = await rowsAs(aliceId, PREVIEW, [baseId, fM]);
    expect(r[0].patient_count).toBe(expM);
    expect(r[0].encounter_count).toBe(expMEnc);
  });

  test('filtre de rencontre (glasgow>=12) : croise-verifie avec SQL natif', async () => {
    const r = await rowsAs(aliceId, PREVIEW, [baseId, fGcs]);
    expect(r[0].patient_count).toBe(expGcsP);
    expect(r[0].encounter_count).toBe(expGcsE);
  });
});

describe('cohorte figee (snapshot) + critere 8', () => {
  test('fige patients ET rencontres ; inchangee apres ajout d un nouveau patient', async () => {
    const cohort = await rowsAs(aliceId, SNAPSHOT, [baseId, 'Patients M', fM]);
    const cohortId = cohort[0].id;
    expect(cohort[0].cohort_type).toBe('snapshot');

    const members = async () => Number((await rowsAs(aliceId, 'select count(*)::int n from public.cohort_member where cohort_id=$1', [cohortId]))[0].n);
    const encMembers = async () => Number((await rowsAs(aliceId, 'select count(*)::int n from public.cohort_encounter_member where cohort_id=$1', [cohortId]))[0].n);
    expect(await members()).toBe(expM);
    expect(await encMembers()).toBe(expMEnc);

    // Ajout d'un nouveau patient M apres le figement (puis marque verifie : seules
    // les donnees verifiees comptent par defaut en v3.0).
    await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
      baseId, 'COH-NEW', 'Nouveau M', '1990-01-01', null, null, null, JSON.stringify({ sexe: 'M' }),
    ]);
    await db.admin.query("update public.patient set validation_status='verified' where base_id=$1 and patient_code='COH-NEW'", [baseId]);

    // La cohorte FIGEE ne bouge pas (critere 8)...
    expect(await members()).toBe(expM);
    // ...mais un apercu DYNAMIQUE recompte (+1).
    expect((await rowsAs(aliceId, PREVIEW, [baseId, fM]))[0].patient_count).toBe(expM + 1);
  });
});

describe('validated_only (v3.0)', () => {
  test('par defaut une cohorte ne compte que les donnees verifiees ; les brouillons sont exclus', async () => {
    // Nouveau patient M en BROUILLON (create_patient -> validation_status=draft).
    await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
      baseId, 'COH-DRAFT', 'Draft M', '1990-01-01', null, null, null, JSON.stringify({ sexe: 'M' }),
    ]);
    const verified = (await rowsAs(aliceId, PREVIEW, [baseId, fM]))[0].patient_count; // validated_only par defaut
    const all = (await rowsAs(aliceId, 'select * from public.cohort_preview($1, $2::jsonb, false)', [baseId, fM]))[0].patient_count;
    expect(all).toBe(verified + 1); // le brouillon n'apparait qu'avec validated_only=false
  });
});

describe('RLS sur la creation de cohorte', () => {
  test('un analyste peut figer une cohorte ; un viewer ne peut pas', async () => {
    await db.asUser(annaId, (c) => c.query(SNAPSHOT, [baseId, 'Par analyste', fM]));

    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,granted_by) values($1,$2,'viewer',$3)
       on conflict (base_id,user_id) do update set
         access_role='viewer', can_edit_structured_data=false, can_export_data=false, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    await expect(rowsAs(bobId, SNAPSHOT, [baseId, 'Par viewer', fM])).rejects.toThrow();
  });
});
