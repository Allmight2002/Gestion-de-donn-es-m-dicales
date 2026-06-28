// Tests DB de l'etape 7 cote serveur (cahier §4.1, critere 6) :
// l'age est CALCULE par le systeme depuis la DOB (zone restreinte) et n'est jamais
// saisi ; la date de naissance ne sort jamais (un editor sans acces identite obtient
// l'age sans voir la DOB).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire
let bobId: string; // deviendra editor SANS acces identite
let annaId: string; // analyste (lecture seule)
let staffId: string; // aucun acces base
let baseId: string;
let publishedVersionId: string;
let patientId: string;
let expectedAge: number;

const TEST_DATE = '2024-06-01';
const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const CALL = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';
const encArgs = (data: object, status = 'complete') => [patientId, 'consultation', TEST_DATE, status, JSON.stringify(data), 'years'];

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
  publishedVersionId = (
    await db.admin.query('select current_template_version_id as tv from public.base where id=$1', [baseId])
  ).rows[0].tv;

  const p = (await db.admin.query('select id, patient_code from public.patient where base_id=$1 limit 1', [baseId])).rows[0];
  patientId = p.id;
  expectedAge = (
    await db.admin.query(
      'select public.compute_age(date_of_birth, $2::date, $3) as age from public.patient_identity where base_id=$1 and patient_code=$4',
      [baseId, TEST_DATE, 'years', p.patient_code],
    )
  ).rows[0].age;

  // Bob devient editor SANS acces identite (peut saisir l'analytique, pas la DOB).
  await db.admin.query(
    `insert into public.base_access(base_id,user_id,access_role,can_view_identity,can_edit_structured_data,granted_by)
     values($1,$2,'editor',false,true,$3)`,
    [baseId, bobId, aliceId],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('age calcule (jamais saisi)', () => {
  test('le proprietaire cree une rencontre : age calcule, DOB absente des donnees, version par enregistrement', async () => {
    const r = await rowsAs(aliceId, CALL, encArgs({ glasgow_score: 12 }));
    expect(r).toHaveLength(1);
    // v3.0 : l'age est en COLONNE (age_value/age_unit), jamais dans data.
    expect(r[0].age_value).toBe(expectedAge);
    expect(r[0].age_unit).toBe('years');
    expect('age_at_encounter' in r[0].data).toBe(false);
    expect('date_of_birth' in r[0].data).toBe(false);
    expect(r[0].template_version_id).toBe(publishedVersionId);
    expect(r[0].validation_status).toBe('complete');
  });

  test("un editor SANS acces identite obtient l'age calcule sans voir la date de naissance (§4.1)", async () => {
    const r = await rowsAs(bobId, CALL, encArgs({ glasgow_score: 9 }));
    expect(r[0].age_value).toBe(expectedAge);
    // Preuve : Bob ne peut PAS lire la date de naissance.
    const ident = await rowsAs(bobId, 'select date_of_birth from public.patient_identity where base_id=$1', [baseId]);
    expect(ident).toHaveLength(0);
  });

  test("l'age fourni par le client est ignore (recalcule serveur, sorti des donnees)", async () => {
    const r = await rowsAs(bobId, CALL, encArgs({ age_at_encounter: 999, glasgow_score: 7 }));
    expect(r[0].age_value).toBe(expectedAge); // 999 ecrase
    expect('age_at_encounter' in r[0].data).toBe(false); // retire des donnees
    expect(r[0].data.glasgow_score).toBe(7);
  });
});

describe('validation serveur (§5.4/§5.5)', () => {
  test('une valeur hors bornes (Glasgow=78) est refusee cote serveur', async () => {
    await expect(rowsAs(aliceId, CALL, encArgs({ glasgow_score: 78 }))).rejects.toThrow(/maximum|glasgow/i);
  });
});

describe('RLS sur la saisie', () => {
  test('un analyste (lecture seule) ne peut pas creer de rencontre', async () => {
    await expect(rowsAs(annaId, CALL, encArgs({ glasgow_score: 10 }))).rejects.toThrow();
  });

  test('patient_age_at : acces analytique OK, hors base refuse', async () => {
    const age = await rowsAs(bobId, 'select public.patient_age_at($1,$2::date) as age', [patientId, TEST_DATE]);
    expect(age[0].age).toBe(expectedAge);
    await expect(rowsAs(staffId, 'select public.patient_age_at($1,$2::date) as age', [patientId, TEST_DATE])).rejects.toThrow();
  });
});

describe('promotion directe en curated : completude imposee (4.3)', () => {
  test('curated avec un champ requis manquant -> refus ; complet -> accepte', async () => {
    // 'complete' reste libre (brouillon avance) : OK meme partiel.
    expect((await rowsAs(aliceId, CALL, encArgs({ glasgow_score: 12 }, 'complete')))[0].validation_status).toBe('complete');
    // 'curated' incomplet (manque diagnosis requis) -> refuse.
    await expect(rowsAs(aliceId, CALL, encArgs({ glasgow_score: 12 }, 'curated'))).rejects.toThrow(/requis|manquant/i);
    // 'curated' complet -> accepte.
    const ok = await rowsAs(aliceId, CALL, encArgs({ admission_date: '2024-01-05', diagnosis: 'TC grave', glasgow_score: 12 }, 'curated'));
    expect(ok[0].validation_status).toBe('curated');
  });
});

describe('integrite curated par TRIGGER (ferme aussi la voie directe, hors RPC)', () => {
  test('un UPDATE direct vers curated est bloque si un champ requis manque', async () => {
    // rencontre hospitalisation en brouillon, incomplete.
    const enc = await rowsAs(aliceId, CALL, [patientId, 'hospitalisation', TEST_DATE, 'draft', JSON.stringify({ glasgow_score: 9 }), 'years']);
    const encId = enc[0].id;
    // Ecriture PRIVILEGIEE (admin, hors RLS) -> curated : le trigger exige admission_date + diagnosis.
    // (Un editeur authentifie, lui, ne peut plus ecrire en direct du tout — voir §5.3.)
    await expect(
      db.admin.query("update public.encounter set validation_status='curated' where id=$1", [encId]),
    ).rejects.toThrow(/requis|manquant/i);
    // Une fois complete, la promotion passe (controle positif du trigger).
    await db.admin.query("update public.encounter set data = data || '{\"admission_date\":\"2024-01-05\",\"diagnosis\":\"TC\"}'::jsonb, validation_status='curated' where id=$1", [encId]);
    expect((await db.admin.query('select validation_status from public.encounter where id=$1', [encId])).rows[0].validation_status).toBe('curated');
  });
});

describe('champs selon le type de rencontre (admission_date = hospitalisation)', () => {
  // encounter_type variable (encArgs fige 'consultation').
  const ENC = (type: string, data: object) => [patientId, type, TEST_DATE, 'curated', JSON.stringify(data), 'years'];
  test('suivi curated SANS admission_date -> OK ; hospitalisation SANS admission_date -> refus', async () => {
    // 'suivi' : admission_date ne s'applique pas -> non requis (diagnosis + glasgow le restent).
    expect((await rowsAs(aliceId, CALL, ENC('suivi', { diagnosis: 'controle', glasgow_score: 14 })))[0].validation_status).toBe('curated');
    // 'hospitalisation' : admission_date requis -> manquant -> refus.
    await expect(rowsAs(aliceId, CALL, ENC('hospitalisation', { diagnosis: 'TC', glasgow_score: 10 }))).rejects.toThrow(/requis|manquant/i);
    // 'hospitalisation' complete -> OK.
    expect((await rowsAs(aliceId, CALL, ENC('hospitalisation', { admission_date: '2024-01-05', diagnosis: 'TC', glasgow_score: 10 })))[0].validation_status).toBe('curated');
  });
});

describe('durcissement des ecritures (audit 2)', () => {
  test('§5.1 : un UPDATE direct hors bornes / a cle inconnue sur une ligne curated est refuse', async () => {
    const enc = await rowsAs(aliceId, CALL, [patientId, 'consultation', TEST_DATE, 'curated', JSON.stringify({ diagnosis: 'x', glasgow_score: 12 }), 'years']);
    const id = enc[0].id;
    // Glasgow > 15 par ecriture privilegiee (admin) -> refus (bornes rejouees sur curated par le trigger).
    await expect(db.admin.query("update public.encounter set data = data || '{\"glasgow_score\":99}'::jsonb where id=$1", [id])).rejects.toThrow(/maximum|glasgow/i);
    // Cle absente du gabarit -> refus.
    await expect(db.admin.query("update public.encounter set data = data || '{\"zzz\":1}'::jsonb where id=$1", [id])).rejects.toThrow(/inconnu/i);
  });

  test('§5.4 : entier decimal, date invalide et code manquant invente sont refuses', async () => {
    const C = (data: object) => [patientId, 'consultation', TEST_DATE, 'curated', JSON.stringify(data), 'years'];
    await expect(rowsAs(aliceId, CALL, C({ diagnosis: 'x', glasgow_score: 12.5 }))).rejects.toThrow(/entier/i);
    await expect(rowsAs(aliceId, CALL, C({ diagnosis: 'x', glasgow_score: 12, admission_date: 'pas-une-date' }))).rejects.toThrow(/date/i);
    await expect(rowsAs(aliceId, CALL, C({ diagnosis: 'x', glasgow_score: 12, hemoglobin: { __missing__: 'code_invente' } }))).rejects.toThrow(/manquante|code/i);
  });

  test('§5.3 : colonnes structurelles immuables par UPDATE direct', async () => {
    // patient_code (lien identite/analytique) immuable -> verifie via ecriture privilegiee (trigger).
    await expect(db.admin.query("update public.patient set patient_code='HACK' where id=$1", [patientId])).rejects.toThrow(/immuable/i);
    // reparentage d'une rencontre interdit.
    const other = (await db.admin.query('select id from public.patient where base_id=$1 and id<>$2 and deleted_at is null limit 1', [baseId, patientId])).rows[0].id;
    const enc = await rowsAs(aliceId, CALL, [patientId, 'consultation', TEST_DATE, 'draft', JSON.stringify({ glasgow_score: 10 }), 'years']);
    await expect(db.admin.query('update public.encounter set patient_id=$2 where id=$1', [enc[0].id, other])).rejects.toThrow(/immuable/i);
  });

  test('§5.2 : regles de coherence (block) imposees cote serveur sur curated', async () => {
    const H = (data: object) => [patientId, 'hospitalisation', TEST_DATE, 'curated', JSON.stringify(data), 'years'];
    // sortie < admission -> regle block violee.
    await expect(rowsAs(aliceId, CALL, H({ admission_date: '2024-02-10', discharge_date: '2024-02-01', diagnosis: 'TC', glasgow_score: 10 })))
      .rejects.toThrow(/sortie|admission/i);
    // outcome=deces sans date de deces -> regle block violee.
    await expect(rowsAs(aliceId, CALL, H({ admission_date: '2024-02-01', discharge_date: '2024-02-10', diagnosis: 'TC', glasgow_score: 10, outcome: 'deces' })))
      .rejects.toThrow(/deces/i);
    // coherent -> accepte en curated.
    expect((await rowsAs(aliceId, CALL, H({ admission_date: '2024-02-01', discharge_date: '2024-02-10', diagnosis: 'TC', glasgow_score: 10, outcome: 'gueri' })))[0].validation_status).toBe('curated');
  });
});
