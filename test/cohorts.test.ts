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
      baseId, 'COH-NEW', 'Nouveau M', '1990-01-01', null, null, null, JSON.stringify({ sexe: 'M', birth_year: 1990 }),
    ]);
    await db.admin.query("update public.patient set validation_status='curated' where base_id=$1 and patient_code='COH-NEW'", [baseId]);

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

describe('§7 : rencontre curated sur patient draft (eligibilite decouplee)', () => {
  test('la rencontre curated compte dans la cohorte de rencontres meme si le patient est draft', async () => {
    // Patient DRAFT (create_patient impose draft) avec donnees permanentes COMPLETES.
    await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
      baseId, 'COH-MIX', 'Mix M', '1985-01-01', null, null, null, JSON.stringify({ sexe: 'M', birth_year: 1985 }),
    ]);
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='COH-MIX'", [baseId])).rows[0].id;
    // Rencontre CURATED complete (consultation, glasgow>=12).
    await rowsAs(aliceId, 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)', [
      pid, 'consultation', '2024-03-03', 'curated', JSON.stringify({ diagnosis: 'x', glasgow_score: 14 }), 'years',
    ]);
    expect((await db.admin.query('select validation_status from public.patient where id=$1', [pid])).rows[0].validation_status).toBe('draft');

    // L'apercu de RENCONTRES (validated_only) inclut TOUTES les rencontres curated glasgow>=12
    // sur patients actifs — y compris celle du patient draft.
    const expEnc = Number((await db.admin.query(
      "select count(*)::int n from public.encounter e join public.patient p on p.id=e.patient_id where p.base_id=$1 and e.validation_status='curated' and (e.data->>'glasgow_score')::int>=12 and e.deleted_at is null and p.deleted_at is null",
      [baseId])).rows[0].n);
    expect((await rowsAs(aliceId, PREVIEW, [baseId, fGcs]))[0].encounter_count).toBe(expEnc);

    // finalize_patient : les donnees permanentes deviennent curated (entre alors dans la cohorte de patients).
    await rowsAs(aliceId, 'select * from public.finalize_patient($1)', [pid]);
    expect((await db.admin.query('select validation_status from public.patient where id=$1', [pid])).rows[0].validation_status).toBe('curated');
  });

  test('finalize_patient refuse des donnees permanentes incompletes (birth_year requis manquant)', async () => {
    await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
      baseId, 'COH-INC', 'Inc', '1985-01-01', null, null, null, JSON.stringify({ sexe: 'M' }), // pas de birth_year
    ]);
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='COH-INC'", [baseId])).rows[0].id;
    await expect(rowsAs(aliceId, 'select * from public.finalize_patient($1)', [pid])).rejects.toThrow(/requis|manquant/i);
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

describe('suppression de cohorte : preuve d export conservee', () => {
  test('la RPC retire la cohorte et ses membres, conserve le journal, et ferme le DELETE direct', async () => {
    const cohort = await rowsAs(aliceId, SNAPSHOT, [baseId, 'A retirer', fM]);
    const cohortId = cohort[0].id as string;
    const exportId = (await db.admin.query(
      `insert into public.export_log(cohort_id, base_id, cohort_name, exported_by, format, export_options, patient_count, encounter_count, stored_file_path, file_hash)
       values($1, $2, 'A retirer', $3, 'csv', '{}'::jsonb, 2, 3, ($2::uuid)::text || '/exports/proof.csv', 'proof-hash') returning id`,
      [cohortId, baseId, aliceId],
    )).rows[0].id as string;

    expect(await rowsAs(aliceId, 'delete from public.cohort where id=$1 returning id', [cohortId])).toHaveLength(0);
    await rowsAs(annaId, 'select public.delete_cohort($1)', [cohortId]);

    expect((await db.admin.query('select id from public.cohort where id=$1', [cohortId])).rows).toHaveLength(0);
    expect((await db.admin.query('select count(*)::int n from public.cohort_member where cohort_id=$1', [cohortId])).rows[0].n).toBe(0);
    expect((await db.admin.query('select count(*)::int n from public.cohort_encounter_member where cohort_id=$1', [cohortId])).rows[0].n).toBe(0);
    expect((await db.admin.query('select cohort_id, base_id, cohort_name, stored_file_path, file_hash from public.export_log where id=$1', [exportId])).rows[0])
      .toMatchObject({ cohort_id: null, base_id: baseId, cohort_name: 'A retirer', stored_file_path: `${baseId}/exports/proof.csv`, file_hash: 'proof-hash' });
    expect(await rowsAs(annaId, 'select id from public.export_log where id=$1', [exportId])).toHaveLength(1);
    expect((await db.admin.query("select metadata from public.audit_log where action='cohort_deleted' and entity_id=$1", [cohortId])).rows[0].metadata)
      .toMatchObject({ cohort_name: 'A retirer', preserved_export_count: 1 });
    await rowsAs(annaId, 'select public.delete_cohort($1)', [cohortId]);
    expect((await db.admin.query("select count(*)::int n from public.audit_log where action='cohort_deleted' and entity_id=$1", [cohortId])).rows[0].n).toBe(1);
  });

  test('un viewer ne peut pas supprimer une cohorte, meme via la RPC', async () => {
    const cohort = await rowsAs(aliceId, SNAPSHOT, [baseId, 'Protegee', fM]);
    await expect(rowsAs(bobId, 'select public.delete_cohort($1)', [cohort[0].id])).rejects.toThrow(/acces/i);
    expect((await db.admin.query('select id from public.cohort where id=$1', [cohort[0].id])).rows).toHaveLength(1);
  });
});

describe('integrite inter-base des membres de cohorte', () => {
  test('insert direct et UUID connu ne peuvent melanger patients, rencontres ou bases', async () => {
    const tv = (await db.admin.query('select current_template_version_id v from public.base where id=$1', [baseId])).rows[0].v;
    const baseB = (await db.admin.query(
      "insert into public.base(name,owner_user_id,current_template_version_id) values('Cohorte B',$1,$2) returning id",
      [aliceId, tv],
    )).rows[0].id as string;
    const patientA1 = (await db.admin.query(
      "insert into public.patient(base_id,patient_code,template_version_id,data,validation_status,created_by) values($1,$2,$3,'{\"sexe\":\"M\",\"birth_year\":1980}'::jsonb,'curated',$4) returning id",
      [baseId, `COH-A1-${Date.now()}`, tv, aliceId],
    )).rows[0].id as string;
    const patientA2 = (await db.admin.query(
      "insert into public.patient(base_id,patient_code,template_version_id,data,validation_status,created_by) values($1,$2,$3,'{\"sexe\":\"M\",\"birth_year\":1980}'::jsonb,'curated',$4) returning id",
      [baseId, `COH-A2-${Date.now()}`, tv, aliceId],
    )).rows[0].id as string;
    const patientB = (await db.admin.query(
      "insert into public.patient(base_id,patient_code,template_version_id,data,validation_status,created_by) values($1,$2,$3,'{\"sexe\":\"M\",\"birth_year\":1980}'::jsonb,'curated',$4) returning id",
      [baseB, `COH-B-${Date.now()}`, tv, aliceId],
    )).rows[0].id as string;
    const encounterA1 = (await db.admin.query(
      "insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by) values($1,$2,'consultation','2026-01-01','{\"diagnosis\":\"test\",\"glasgow_score\":12}'::jsonb,'curated',$3) returning id",
      [patientA1, tv, aliceId],
    )).rows[0].id as string;
    const encounterA2 = (await db.admin.query(
      "insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by) values($1,$2,'consultation','2026-01-02','{\"diagnosis\":\"test\",\"glasgow_score\":12}'::jsonb,'curated',$3) returning id",
      [patientA2, tv, aliceId],
    )).rows[0].id as string;
    const encounterB = (await db.admin.query(
      "insert into public.encounter(patient_id,template_version_id,encounter_type,encounter_date,data,validation_status,created_by) values($1,$2,'consultation','2026-01-03','{\"diagnosis\":\"test\",\"glasgow_score\":12}'::jsonb,'curated',$3) returning id",
      [patientB, tv, aliceId],
    )).rows[0].id as string;
    const cohort = (await rowsAs(aliceId,
      "insert into public.cohort(base_id,name,cohort_type,created_by) values($1,'Scope test','snapshot',$2) returning id",
      [baseId, aliceId],
    ))[0].id as string;

    await rowsAs(aliceId, 'insert into public.cohort_member(cohort_id,patient_id) values($1,$2)', [cohort, patientA1]);
    await rowsAs(aliceId, 'insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort, encounterA1]);
    await expect(rowsAs(aliceId,
      'insert into public.cohort_member(cohort_id,patient_id) values($1,$2)', [cohort, patientB],
    )).rejects.toThrow(/COHORT_SCOPE_MISMATCH/);
    await expect(rowsAs(aliceId,
      'insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort, encounterB],
    )).rejects.toThrow(/COHORT_SCOPE_MISMATCH/);
    // Une cohorte de rencontres peut legitimement contenir une rencontre curated
    // dont le patient draft n'est pas membre de la cohorte de patients.
    await rowsAs(aliceId,
      'insert into public.cohort_encounter_member(cohort_id,encounter_id) values($1,$2)', [cohort, encounterA2]);

    await expect(rowsAs(aliceId,
      'update public.cohort set base_id=$1 where id=$2', [baseB, cohort],
    )).rejects.toThrow(/COHORT_SCOPE_MISMATCH|immuable/i);

    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,can_edit_structured_data,granted_by)
       values($1,$2,'editor',true,$3)
       on conflict(base_id,user_id) do update set can_edit_structured_data=true,revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    await expect(rowsAs(bobId,
      'insert into public.cohort_member(cohort_id,patient_id) values($1,$2)', [cohort, patientB],
    )).rejects.toThrow(/COHORT_SCOPE_MISMATCH/);
    await expect(rowsAs(bobId, SNAPSHOT, [baseB, 'RPC hors base', fM])).rejects.toThrow();
  });
});
