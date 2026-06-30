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
const UPDATE_ENC5 = 'select * from public.update_encounter($1,$2::jsonb,$3,$4,$5::timestamptz)';
const encUpdatedAt = async (): Promise<Date> =>
  (await db.admin.query('select updated_at from public.encounter where id=$1', [encounterId])).rows[0].updated_at;
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
  // consultation : pas d'admission_date requis -> on peut la finaliser ('curated') avec glasgow+diagnosis.
  const enc = await rowsAs(aliceId, CREATE_ENC, [patient[0].id, 'consultation', '2024-03-01', 'complete', JSON.stringify({ glasgow_score: 10, diagnosis: 'TC' }), 'years']);
  encounterId = enc[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('historique des corrections (field_change_log)', () => {
  test('une correction journalise ancienne/nouvelle valeur, auteur, motif ; champ inchange non journalise', async () => {
    const updated = await rowsAs(aliceId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 12, diagnosis: 'TC' }), 'curated', 'correction Glasgow']);
    expect(updated[0].validation_status).toBe('curated');
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
    await rowsAs(aliceId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 12, diagnosis: 'TC' }), 'curated', 'aucune modif']);
    expect(await changes(aliceId)).toHaveLength(1); // toujours 1
  });

  test('un analyste (lecture seule) ne peut pas corriger', async () => {
    await expect(
      rowsAs(annaId, UPDATE_ENC, [encounterId, JSON.stringify({ glasgow_score: 3 }), 'curated', 'tentative']),
    ).rejects.toThrow();
  });
});

describe('§13 verrou optimiste (synchronisation hors-ligne)', () => {
  test('updated_at a jour -> applique (et bump) ; perime -> CONFLIT_VERSION ; null -> force', async () => {
    const before = await encUpdatedAt();
    // Version a jour : applique la correction et avance updated_at.
    await rowsAs(aliceId, UPDATE_ENC5, [encounterId, JSON.stringify({ glasgow_score: 13, diagnosis: 'TC' }), 'curated', 'sync a jour', before.toISOString()]);
    const after = await encUpdatedAt();
    expect(after.getTime()).toBeGreaterThan(before.getTime());

    // Rejouer avec l'ANCIEN updated_at (la rencontre a change entre-temps) -> conflit.
    await expect(
      rowsAs(aliceId, UPDATE_ENC5, [encounterId, JSON.stringify({ glasgow_score: 14, diagnosis: 'TC' }), 'curated', 'sync perimee', before.toISOString()]),
    ).rejects.toThrow(/CONFLIT_VERSION/);

    // Forcage (expected = null) : applique malgre le decalage (resolution « garder ma version »).
    const forced = await rowsAs(aliceId, UPDATE_ENC5, [encounterId, JSON.stringify({ glasgow_score: 15, diagnosis: 'TC' }), 'curated', 'forcage', null]);
    expect(forced[0].data.glasgow_score).toBe(15);
  });
});

describe('§5.2 triggers (defense en profondeur) : pas de retrogradation ni d age falsifie', () => {
  // Ecritures PRIVILEGIEES (admin) : la RLS est contournee mais les TRIGGERS s'appliquent.
  test('une rencontre curated ne peut etre RETROGRADEE (trigger)', async () => {
    await expect(
      db.admin.query("update public.encounter set validation_status='draft' where id=$1", [encounterId]),
    ).rejects.toThrow(/[Rr]etrogradation/);
  });

  test('age_value est RECALCULE par le serveur (trigger)', async () => {
    await db.admin.query('update public.encounter set age_value=999 where id=$1', [encounterId]);
    const a = (await db.admin.query('select age_value from public.encounter where id=$1', [encounterId])).rows[0].age_value;
    expect(Number(a)).toBe(44); // DOB 1980-01-01 @ 2024-03-01 -> 44, pas 999
  });
});

describe('§5.3 ecritures cliniques par RPC seulement', () => {
  test('un editeur ne peut PAS modifier une rencontre par UPDATE direct (RLS : sans effet)', async () => {
    const before = (await db.admin.query('select data from public.encounter where id=$1', [encounterId])).rows[0].data;
    // Alice (proprietaire, mais utilisateur authenticated) : l'UPDATE direct ne touche aucune ligne.
    await rowsAs(aliceId, "update public.encounter set data='{\"glasgow_score\":3}'::jsonb, encounter_date='2000-01-01' where id=$1", [encounterId]);
    const after = (await db.admin.query('select data from public.encounter where id=$1', [encounterId])).rows[0].data;
    expect(after).toEqual(before); // inchange -> seules les RPC journalisees peuvent modifier
  });
});

describe('update_patient (donnees permanentes)', () => {
  const UPDATE_PAT = 'select * from public.update_patient($1,$2::jsonb,$3,$4)';
  test('corrige les donnees permanentes (journalise) ; valeur hors liste refusee', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='CORR-001'", [baseId])).rows[0].id;
    const out = await rowsAs(aliceId, UPDATE_PAT, [pid, JSON.stringify({ sexe: 'F' }), 'draft', 'correction sexe']);
    expect(out[0].data.sexe).toBe('F');
    expect((await db.admin.query("select 1 from public.field_change_log where entity='patient' and entity_id=$1 and field_key='sexe'", [pid])).rows.length).toBeGreaterThan(0);
    // re-validation serveur : une valeur hors liste autorisee est refusee.
    await expect(rowsAs(aliceId, UPDATE_PAT, [pid, JSON.stringify({ sexe: 'Z' }), 'draft', 'invalide'])).rejects.toThrow();
  });
});

describe('§5.5 journaux infalsifiables (aucun insert direct)', () => {
  test('un evenement d audit ne peut PAS etre fabrique par insert direct', async () => {
    await expect(
      rowsAs(aliceId, "insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata) values($1,'FAKE_ADMIN_EVENT','x',null,$2,'{}'::jsonb)", [aliceId, baseId]),
    ).rejects.toThrow();
  });

  test('une ligne d historique ne peut PAS etre inseree directement (hors RPC)', async () => {
    await expect(
      rowsAs(aliceId, "insert into public.field_change_log(base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source) values($1,'encounter',$2,'glasgow_score','1'::jsonb,'2'::jsonb,$3,'faux','manual_correction')", [baseId, encounterId, aliceId]),
    ).rejects.toThrow();
  });
});

describe('audit v9 §5.1/§5.2 : creation clinique par RPC seulement + log_audit non appelable', () => {
  test('§5.1 INSERT direct refuse : patient / encounter / patient_identity', async () => {
    await expect(rowsAs(aliceId,
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'HACK-P',(select current_template_version_id from public.base where id=$1),'{}'::jsonb)", [baseId])).rejects.toThrow();
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
    await expect(rowsAs(aliceId,
      "insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, validation_status) values($1,(select template_version_id from public.patient where id=$1),'consultation','2024-01-01','draft')", [pid])).rejects.toThrow();
    await expect(rowsAs(aliceId,
      "insert into public.patient_identity(base_id, patient_code, full_name) values($1,'HACK-P','Hacker')", [baseId])).rejects.toThrow();
  });

  test('§5.2 log_audit n est plus appelable par un utilisateur (audit infalsifiable)', async () => {
    await expect(rowsAs(aliceId, "select public.log_audit('FAKE_ADMIN_EVENT','base',null,$1,'{}'::jsonb)", [baseId]))
      .rejects.toThrow(/permission|denied|refus/i);
  });
});

describe('audit v10 §4.2 : verdict d inspection reserve au serveur', () => {
  test('un utilisateur ne peut PAS s auto-attribuer inspection_status=accepted/quarantined', async () => {
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
    // Piece jointe inseree cote serveur (admin), au statut client.
    const aid = (await db.admin.query(
      "insert into public.clinical_attachment(patient_id, storage_path, deidentification_confirmed, inspection_status) values($1,'b/p/x.png',true,'accepted_client') returning id",
      [pid],
    )).rows[0].id;
    // Alice (proprietaire, acces identite) NE PEUT PAS promouvoir le verdict serveur.
    await expect(rowsAs(aliceId, "update public.clinical_attachment set inspection_status='accepted' where id=$1", [aid]))
      .rejects.toThrow(/inspection/i);
    await expect(rowsAs(aliceId, "update public.clinical_attachment set inspection_status='quarantined' where id=$1", [aid]))
      .rejects.toThrow(/inspection/i);
    // Mais une mise a jour qui NE touche pas au verdict reste possible.
    await rowsAs(aliceId, "update public.clinical_attachment set label='ok' where id=$1", [aid]);
    expect((await db.admin.query('select inspection_status, label from public.clinical_attachment where id=$1', [aid])).rows[0])
      .toMatchObject({ inspection_status: 'accepted_client', label: 'ok' });
  });
});

describe('audit v10 §4.5 : cles inconnues du gabarit refusees a TOUS les statuts', () => {
  test('create_patient draft avec une cle hors dictionnaire -> refuse', async () => {
    await expect(rowsAs(aliceId, CREATE_PAT, [baseId, 'UNK-' + Date.now(), 'X', '1980-01-01', null, null, null,
      JSON.stringify({ sexe: 'M', unknown_secret: 'x' })])).rejects.toThrow(/inconnu/i);
    // Sans la cle inconnue, le meme patient draft passe.
    const ok = await rowsAs(aliceId, CREATE_PAT, [baseId, 'UNK-OK-' + Date.now(), 'X', '1980-01-01', null, null, null,
      JSON.stringify({ sexe: 'M' })]);
    expect(ok[0].validation_status).toBe('draft');
  });
});
