// Tests DB/RLS des COMPTES DE MISSION (docs/spec-comptes-mission.md §10, lot L10).
//
// Le point de la suite : chaque refus doit venir DE LA BASE, jamais de l'interface.
// Un compte de mission qui atteint l'identite, une autre base, l'export, la curation
// ou une saisie deja soumise doit etre refuse meme en appelant PostgreSQL en direct.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire de la base 1
let bobId: string; // medecin proprietaire de la base 2 (aucun lien avec la base 1)
let editorId: string; // collaborateur medecin historique : can_edit, PAS can_create
let studentId: string; // compte de mission sur la base 1
let baseId: string; // base d'Alice
let otherBaseId: string; // base de Bob
let templateVersionId: string;
let alicePatientId: string;
let aliceEncounterId: string;

const IN_12_MONTHS = "now() + interval '12 months'";

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(
    uid,
    async (c: Client) => (await c.query(sql, params)).rows,
    uid === studentId ? { app_metadata: { mission_credential_generation: 1 } } : undefined,
  );

const CREATE_PATIENT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const CREATE_ENCOUNTER = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';
const UPDATE_ENCOUNTER = 'select * from public.update_encounter($1,$2::jsonb,$3,$4,$5::timestamptz)';

/** Cree un compte auth + profil via le trigger on_auth_user_created. */
async function createAuthUser(email: string, appMetadata: object, userMetadata: object = {}): Promise<string> {
  const { rows } = await db.admin.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                             email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
             $1, 'x', now(), $2::jsonb, $3::jsonb, now(), now())
     returning id`,
    [email, JSON.stringify(appMetadata), JSON.stringify(userMetadata)],
  );
  return rows[0].id as string;
}

const globalRoleOf = async (userId: string): Promise<string> =>
  (await db.admin.query('select global_role from public.profiles where id = $1', [userId])).rows[0].global_role;

/** Repose une mission active de 12 mois pour l'etudiant sur la base d'Alice. */
async function resetMission(canViewIdentity = false, justification: string | null = null): Promise<void> {
  await db.admin.query('delete from public.base_access where user_id = $1', [studentId]);
  await rowsAs(
    aliceId,
    `select * from public.provision_mission_access($1,$2,${IN_12_MONTHS},$3,$4)`,
    [baseId, studentId, canViewIdentity, justification],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  editorId = byEmail.get('editor@demo.test')!;

  const base = (
    await db.admin.query('select id, current_template_version_id as tv from public.base limit 1')
  ).rows[0];
  baseId = base.id;
  templateVersionId = base.tv;

  // Deuxieme base, sans aucun lien avec l'etudiant : cible du test d'acces croise.
  otherBaseId = (
    await db.admin.query(
      `insert into public.base (name, specialty, owner_user_id, current_template_version_id)
       values ('Base de Bob', 'cardiologie', $1, $2) returning id`,
      [bobId, templateVersionId],
    )
  ).rows[0].id;

  const patient = (
    await db.admin.query('select id from public.patient where base_id = $1 order by created_at limit 1', [baseId])
  ).rows[0];
  alicePatientId = patient.id;

  // Une rencontre SOUMISE, creee par Alice : l'etudiant ne doit jamais pouvoir y toucher.
  aliceEncounterId = (
    await rowsAs(aliceId, CREATE_ENCOUNTER, [alicePatientId, 'consultation', '2024-05-01', 'complete', '{}', 'years'])
  )[0].id;

  studentId = await createAuthUser('etudiant@demo.test', { global_role: 'saisisseur' });
  await db.admin.query(
    `insert into public.mission_account_credential (
       user_id, base_id, owner_user_id, account_label, login_identifier,
       password_ciphertext, password_nonce, credential_generation, status
     ) values ($1, $2, $3, 'Compte de test mission', 'mission-test-01',
               'ciphertext-test-non-secret', 'nonce-test-123', 1, 'active')`,
    [studentId, baseId, aliceId],
  );
  await resetMission();
});

afterAll(async () => {
  await db?.stop();
});

// =============================================================================
describe('role a l inscription : app_metadata seul fait foi', () => {
  test('app_metadata global_role=saisisseur cree un profil saisisseur', async () => {
    expect(await globalRoleOf(studentId)).toBe('saisisseur');
  });

  test('l auto-inscription publique reste medecin', async () => {
    const id = await createAuthUser('libre@demo.test', { provider: 'email' });
    expect(await globalRoleOf(id)).toBe('medecin');
  });

  test('un role force dans user_metadata (modifiable par l utilisateur) est ignore', async () => {
    const id = await createAuthUser('malin@demo.test', { provider: 'email' }, { global_role: 'system_admin' });
    expect(await globalRoleOf(id)).toBe('medecin');
  });

  test('un role non prevu dans app_metadata retombe sur medecin, jamais sur un role privilegie', async () => {
    const id = await createAuthUser('bidon@demo.test', { global_role: 'system_admin' });
    expect(await globalRoleOf(id)).toBe('medecin');
  });
});

// =============================================================================
describe('saisie : ce que le compte de mission PEUT faire', () => {
  test('il voit sa base et le gabarit associe', async () => {
    expect(await rowsAs(studentId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
    expect(
      await rowsAs(studentId, 'select id from public.template_version where id = $1', [templateVersionId]),
    ).toHaveLength(1);
    expect(
      (await rowsAs(studentId, 'select id from public.template_field where template_version_id = $1', [templateVersionId]))
        .length,
    ).toBeGreaterThan(0);
  });

  test('il cree un patient MINIMAL : le code passe, aucun champ nominatif n est ecrit', async () => {
    const created = await rowsAs(studentId, CREATE_PATIENT, [
      baseId, 'MIS-001', null, null, null, null, null, '{}',
    ]);
    expect(created).toHaveLength(1);
    const identity = (
      await db.admin.query(
        'select full_name, date_of_birth, phone, address, external_identifier from public.patient_identity where base_id=$1 and patient_code=$2',
        [baseId, 'MIS-001'],
      )
    ).rows[0];
    expect(identity.full_name).toBeNull();
    expect(identity.date_of_birth).toBeNull();
    expect(identity.phone).toBeNull();
    expect(identity.address).toBeNull();
    expect(identity.external_identifier).toBeNull();
  });

  test('il cree une rencontre en brouillon, la corrige, puis la soumet', async () => {
    const patientId = (await rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-002', null, null, null, null, null, '{}']))[0].id;
    const draft = (
      await rowsAs(studentId, CREATE_ENCOUNTER, [patientId, 'consultation', '2024-06-01', 'draft', '{}', 'years'])
    )[0];
    expect(draft.validation_status).toBe('draft');

    const corrected = (
      await rowsAs(studentId, UPDATE_ENCOUNTER, [draft.id, JSON.stringify({}), 'draft', 'faute de frappe', null])
    )[0];
    expect(corrected.validation_status).toBe('draft');

    const submitted = (
      await rowsAs(studentId, UPDATE_ENCOUNTER, [draft.id, JSON.stringify({}), 'complete', 'soumission', null])
    )[0];
    expect(submitted.validation_status).toBe('complete');
  });

  test('il corrige son propre brouillon de patient, verrou optimiste compris', async () => {
    const patient = (await rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-003', null, null, null, null, null, '{}']))[0];
    const updated = (
      await rowsAs(studentId, 'select * from public.update_patient($1,$2::jsonb,$3,$4,$5::bigint)', [
        patient.id, JSON.stringify({}), 'draft', 'correction', patient.row_version,
      ])
    )[0];
    expect(updated.row_version).toBe(String(Number(patient.row_version) + 1));
  });
});

// =============================================================================
describe('immuabilite apres soumission', () => {
  test('il ne peut plus modifier SA saisie une fois soumise', async () => {
    const patientId = (await rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-010', null, null, null, null, null, '{}']))[0].id;
    const enc = (
      await rowsAs(studentId, CREATE_ENCOUNTER, [patientId, 'consultation', '2024-06-01', 'complete', '{}', 'years'])
    )[0];
    await expect(
      rowsAs(studentId, UPDATE_ENCOUNTER, [enc.id, JSON.stringify({}), 'complete', 'apres coup', null]),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('il ne peut pas modifier la saisie d AUTRUI, meme en brouillon', async () => {
    await expect(
      rowsAs(studentId, UPDATE_ENCOUNTER, [aliceEncounterId, JSON.stringify({}), 'draft', 'intrusion', null]),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('il ne peut pas promouvoir une saisie en curated', async () => {
    const patientId = (await rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-011', null, null, null, null, null, '{}']))[0].id;
    await expect(
      rowsAs(studentId, CREATE_ENCOUNTER, [patientId, 'consultation', '2024-06-01', 'curated', '{}', 'years']),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('il ne peut pas supprimer une saisie', async () => {
    await expect(
      rowsAs(studentId, 'select public.soft_delete_encounter($1,$2)', [aliceEncounterId, 'menage']),
    ).rejects.toThrow(/Acces refuse/i);
    await expect(
      rowsAs(studentId, 'select public.soft_delete_patient($1,$2)', [alicePatientId, 'menage']),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('un UPDATE direct sur encounter/patient est refuse par la RLS (hors RPC)', async () => {
    const before = (
      await db.admin.query('select validation_status from public.encounter where id = $1', [aliceEncounterId])
    ).rows[0].validation_status;
    await rowsAs(studentId, 'update public.encounter set validation_status = $2 where id = $1', [
      aliceEncounterId, 'curated',
    ]);
    const after = (
      await db.admin.query('select validation_status from public.encounter where id = $1', [aliceEncounterId])
    ).rows[0].validation_status;
    expect(after).toBe(before);
  });
});

// =============================================================================
describe('identite nominative', () => {
  test('sans l option, get_patient_identity ne renvoie RIEN au compte de mission', async () => {
    expect(await rowsAs(studentId, 'select * from public.get_patient_identity($1)', [alicePatientId])).toHaveLength(0);
    expect(await rowsAs(studentId, 'select public.can_view_identity($1) as ok', [baseId])).toEqual([{ ok: false }]);
  });

  test('la table patient_identity n est de toute facon pas lisible en direct', async () => {
    expect(
      await rowsAs(studentId, 'select full_name from public.patient_identity where base_id = $1', [baseId]),
    ).toHaveLength(0);
  });

  test('il ne peut JAMAIS ecrire l identite : create_patient refuse un nom', async () => {
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-020', 'Jean Dupont', null, null, null, null, '{}']),
    ).rejects.toThrow(/identite/i);
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-021', null, '1990-01-01', null, null, null, '{}']),
    ).rejects.toThrow(/identite/i);
  });

  test('avec l option activee et justifiee, la lecture passe — mais l ecriture reste refusee', async () => {
    await resetMission(true, 'Rapprochement des dossiers papier nominatifs du service');
    expect(await rowsAs(studentId, 'select public.can_view_identity($1) as ok', [baseId])).toEqual([{ ok: true }]);
    expect(await rowsAs(studentId, 'select public.can_write_identity($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(
      (await rowsAs(studentId, 'select * from public.get_patient_identity($1)', [alicePatientId])).length,
    ).toBeGreaterThan(0);
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-022', 'Jean Dupont', null, null, null, null, '{}']),
    ).rejects.toThrow(/identite/i);
    await resetMission();
  });

  test('activer l identite sans justification est refuse par la base', async () => {
    await expect(
      rowsAs(aliceId, `select * from public.provision_mission_access($1,$2,${IN_12_MONTHS},true,null)`, [
        baseId, studentId,
      ]),
    ).rejects.toThrow(/[Jj]ustification/);
  });
});

// =============================================================================
describe('cloisonnement : une seule base, aucune autre', () => {
  test('il ne voit pas la base d un autre medecin', async () => {
    expect(await rowsAs(studentId, 'select id from public.base where id = $1', [otherBaseId])).toHaveLength(0);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [otherBaseId])).toEqual([{ ok: false }]);
  });

  test('il ne voit aucun patient ni rencontre d une autre base', async () => {
    const foreignPatient = (
      await rowsAs(bobId, CREATE_PATIENT, [otherBaseId, 'BOB-001', null, null, null, null, null, '{}'])
    )[0];
    expect(await rowsAs(studentId, 'select id from public.patient where id = $1', [foreignPatient.id])).toHaveLength(0);
  });

  test('il ne peut pas creer de patient dans une autre base', async () => {
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [otherBaseId, 'MIS-030', null, null, null, null, null, '{}']),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('la base refuse une seconde mission sur une autre base pour le meme compte', async () => {
    await expect(
      rowsAs(bobId, `select * from public.provision_mission_access($1,$2,${IN_12_MONTHS},false,null)`, [
        otherBaseId, studentId,
      ]),
    ).rejects.toThrow(/une seule base/i);
  });

  test('il ne voit ni cohortes, ni exports, ni lots d import de sa base', async () => {
    await db.admin.query(
      `insert into public.cohort (base_id, name, created_by) values ($1, 'Cohorte test', $2)`,
      [baseId, aliceId],
    );
    expect(await rowsAs(studentId, 'select id from public.cohort where base_id = $1', [baseId])).toHaveLength(0);
    expect(await rowsAs(studentId, 'select id from public.import_batch where base_id = $1', [baseId])).toHaveLength(0);
    expect(await rowsAs(aliceId, 'select id from public.cohort where base_id = $1', [baseId])).not.toHaveLength(0);
  });
});

// =============================================================================
describe('capacites refusees au role', () => {
  test('il ne peut pas creer de base', async () => {
    await expect(
      rowsAs(studentId, `insert into public.base (name, specialty, owner_user_id, current_template_version_id)
                         values ('Ma base', 'x', auth.uid(), $1)`, [templateVersionId]),
    ).rejects.toThrow();
    await expect(
      rowsAs(studentId, 'select public.create_base_from_model($1,$2,$3)', ['Ma base', 'x', templateVersionId]),
    ).rejects.toThrow();
  });

  test('il ne peut pas creer de gabarit', async () => {
    await expect(
      rowsAs(studentId, `insert into public.template (name, specialty, owner_user_id, is_global)
                         values ('Mon gabarit', 'x', auth.uid(), false)`),
    ).rejects.toThrow();
  });

  test('il ne peut ni exporter, ni curer, ni gerer les acces', async () => {
    expect(await rowsAs(studentId, 'select public.can_export_data($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(studentId, 'select public.can_curate($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(studentId, 'select public.can_manage_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(studentId, 'select public.can_view_raw_documents($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(studentId, 'select public.can_edit_structured_data($1) as ok', [baseId])).toEqual([{ ok: false }]);
  });

  test('il ne peut pas s inviter ailleurs ni provisionner un acces', async () => {
    await expect(
      rowsAs(studentId, `select * from public.provision_mission_access($1,$2,${IN_12_MONTHS},false,null)`, [
        baseId, studentId,
      ]),
    ).rejects.toThrow(/proprietaire/i);
  });

  test('il ne peut pas lire l inventaire des comptes de mission', async () => {
    await expect(rowsAs(studentId, 'select * from public.mission_accounts($1)', [baseId])).rejects.toThrow(/proprietaire/i);
  });

  test('la garde refuse toute ligne de mission aux permissions elargies', async () => {
    const attempt = (column: string) =>
      db.admin.query(
        `update public.base_access set ${column} = true where user_id = $1 and revoked_at is null`,
        [studentId],
      );
    await expect(attempt('can_edit_structured_data')).rejects.toThrow(/interdites/i);
    await expect(attempt('can_export_data')).rejects.toThrow(/interdites/i);
    await expect(attempt('can_manage_access')).rejects.toThrow(/interdites/i);
    await expect(attempt('can_view_raw_documents')).rejects.toThrow(/interdites/i);
  });

  test('la garde refuse une mission sans echeance ou de plus de 24 mois', async () => {
    await expect(
      db.admin.query('update public.base_access set expires_at = null where user_id = $1 and revoked_at is null', [studentId]),
    ).rejects.toThrow(/echeance/i);
    await expect(
      db.admin.query(
        "update public.base_access set expires_at = now() + interval '25 months' where user_id = $1 and revoked_at is null",
        [studentId],
      ),
    ).rejects.toThrow(/24 mois/i);
    await expect(
      rowsAs(aliceId, "select * from public.provision_mission_access($1,$2,now() + interval '30 months',false,null)", [
        baseId, studentId,
      ]),
    ).rejects.toThrow(/24 mois/i);
  });
});

// =============================================================================
describe('echeance et revocation : la base tranche, pas l interface', () => {
  test('a l echeance, tout est refuse sans aucune action de l administrateur', async () => {
    await db.admin.query(
      "update public.base_access set expires_at = now() - interval '1 day' where user_id = $1 and revoked_at is null",
      [studentId],
    );
    expect(await rowsAs(studentId, 'select id from public.base where id = $1', [baseId])).toHaveLength(0);
    expect(await rowsAs(studentId, 'select id from public.patient where base_id = $1', [baseId])).toHaveLength(0);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-040', null, null, null, null, null, '{}']),
    ).rejects.toThrow(/Acces refuse/i);
    await resetMission();
  });

  test('la revocation coupe immediatement, jeton encore valide ou non', async () => {
    const accessId = (
      await db.admin.query('select id from public.base_access where user_id = $1 and revoked_at is null', [studentId])
    ).rows[0].id;
    await rowsAs(aliceId, 'select public.revoke_base_access($1)', [accessId]);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    await expect(
      rowsAs(studentId, CREATE_PATIENT, [baseId, 'MIS-041', null, null, null, null, null, '{}']),
    ).rejects.toThrow(/Acces refuse/i);
  });

  test('une nouvelle mission sur la MEME base reactive la ligne existante (contrainte unique)', async () => {
    const before = (await db.admin.query('select count(*)::int as n from public.base_access where user_id = $1', [studentId]))
      .rows[0].n;
    await rowsAs(aliceId, `select * from public.provision_mission_access($1,$2,${IN_12_MONTHS},false,null)`, [
      baseId, studentId,
    ]);
    const after = (await db.admin.query('select count(*)::int as n from public.base_access where user_id = $1', [studentId]))
      .rows[0].n;
    expect(after).toBe(before);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: true }]);
  });

  test('la prolongation repousse l echeance et laisse une trace', async () => {
    const accessId = (
      await db.admin.query('select id from public.base_access where user_id = $1 and revoked_at is null', [studentId])
    ).rows[0].id;
    const extended = (
      await rowsAs(aliceId, "select * from public.extend_mission_access($1, now() + interval '18 months')", [accessId])
    )[0];
    expect(new Date(extended.expires_at).getTime()).toBeGreaterThan(Date.now() + 400 * 86400_000);
    const trace = await db.admin.query(
      "select 1 from public.audit_log where action = 'mission_extended' and entity_id = $1",
      [accessId],
    );
    expect(trace.rowCount).toBeGreaterThan(0);
  });

  test('un tiers ne peut ni prolonger ni revoquer une mission qui ne le concerne pas', async () => {
    const accessId = (
      await db.admin.query('select id from public.base_access where user_id = $1 and revoked_at is null', [studentId])
    ).rows[0].id;
    await expect(
      rowsAs(bobId, "select * from public.extend_mission_access($1, now() + interval '6 months')", [accessId]),
    ).rejects.toThrow(/proprietaire/i);
    await expect(rowsAs(bobId, 'select public.revoke_base_access($1)', [accessId])).rejects.toThrow();
  });

  test('perdre le role saisisseur revoque l acces (declassement)', async () => {
    const admin = (await db.admin.query("select id from public.profiles where global_role = 'system_admin' limit 1")).rows[0].id;
    await rowsAs(admin, "update public.profiles set global_role = 'curateur' where id = $1", [studentId]);
    const active = await db.admin.query(
      'select id from public.base_access where user_id = $1 and revoked_at is null',
      [studentId],
    );
    expect(active.rowCount).toBe(0);
    await db.admin.query("update public.profiles set global_role = 'saisisseur' where id = $1", [studentId]);
    await resetMission();
  });
});

// =============================================================================
describe('compatibilite du socle existant', () => {
  test('un editeur historique (can_edit, sans can_create) cree toujours patients et rencontres', async () => {
    const access = (
      await db.admin.query(
        'select can_create_structured_data, expires_at from public.base_access where base_id = $1 and user_id = $2',
        [baseId, editorId],
      )
    ).rows[0];
    expect(access.can_create_structured_data).toBe(false);
    expect(access.expires_at).toBeNull();

    const patient = (
      await rowsAs(editorId, CREATE_PATIENT, [baseId, 'EDT-001', 'Marie Test', '1980-03-02', null, null, null, '{}'])
    )[0];
    expect(patient.patient_code).toBe('EDT-001');
    const identity = (
      await db.admin.query('select full_name from public.patient_identity where base_id=$1 and patient_code=$2', [
        baseId, 'EDT-001',
      ])
    ).rows[0];
    expect(identity.full_name).toBe('Marie Test');

    const enc = (
      await rowsAs(editorId, CREATE_ENCOUNTER, [patient.id, 'consultation', '2024-06-01', 'complete', '{}', 'years'])
    )[0];
    expect(enc.validation_status).toBe('complete');
  });

  test('les acces permanents existants restent permanents (expires_at null)', async () => {
    const permanent = await db.admin.query(
      'select count(*)::int as n from public.base_access where expires_at is null and revoked_at is null',
    );
    expect(permanent.rows[0].n).toBeGreaterThan(0);
  });

  test('un acces medecin echu est refuse comme une mission echue', async () => {
    await db.admin.query(
      "update public.base_access set expires_at = now() - interval '1 day' where base_id = $1 and user_id = $2",
      [baseId, editorId],
    );
    expect(await rowsAs(editorId, 'select public.can_edit_structured_data($1) as ok', [baseId])).toEqual([{ ok: false }]);
    await db.admin.query('update public.base_access set expires_at = null where base_id = $1 and user_id = $2', [
      baseId, editorId,
    ]);
    expect(await rowsAs(editorId, 'select public.can_edit_structured_data($1) as ok', [baseId])).toEqual([{ ok: true }]);
  });

  test('base_access reste interdit aux roles hors medecin / saisisseur', async () => {
    const curateur = (await db.admin.query("select id from public.profiles where global_role = 'curateur' limit 1")).rows[0].id;
    await expect(
      db.admin.query(
        `insert into public.base_access (base_id, user_id, access_role, granted_by) values ($1,$2,'viewer',$3)`,
        [baseId, curateur, aliceId],
      ),
    ).rejects.toThrow(/medecin/i);
  });
});

// =============================================================================
describe('inventaire cote medecin', () => {
  test('le proprietaire voit son compte de mission, avec echeance et etat', async () => {
    const rows = await rowsAs(aliceId, 'select * from public.mission_accounts($1)', [baseId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('mission-test-01');
    expect(rows[0].expires_at).not.toBeNull();
    expect(rows[0].can_view_identity).toBe(false);
  });

  test('un medecin etranger a la base n y accede pas', async () => {
    await expect(rowsAs(bobId, 'select * from public.mission_accounts($1)', [baseId])).rejects.toThrow(
      /proprietaire/i,
    );
  });
});

// =============================================================================
// Bloc final : ces verifications mettent la base a la corbeille, ce qui revoque les
// acces. Elles sont donc placees APRES tout le reste.
describe('garde de suppression logique (regression)', () => {
  test('une base mise a la corbeille n autorise plus rien (garde de 20260616096000 conservee)', async () => {
    await rowsAs(aliceId, 'select public.soft_delete_base($1,$2)', [baseId, 'fin d etude']);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(aliceId, 'select public.can_edit_structured_data($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(aliceId, 'select public.can_export_data($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(aliceId, 'select public.can_manage_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    expect(await rowsAs(studentId, 'select id from public.base where id = $1', [baseId])).toHaveLength(0);

    // La suppression logique revoque aussi les lignes d'acces : remettre la base en
    // service ne ressuscite personne, mission comprise. Le retour se fait par un
    // nouveau provisionnement, seul chemin audite.
    await db.admin.query('update public.base set deleted_at = null, deleted_by = null where id = $1', [baseId]);
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: false }]);
    await resetMission();
    expect(await rowsAs(studentId, 'select public.has_base_access($1) as ok', [baseId])).toEqual([{ ok: true }]);
  });

  test('la lecture des traces d export reste soumise a can_export_data (20260616095700)', async () => {
    const definition = (
      await db.admin.query(
        "select pg_get_expr(polqual, polrelid) as expr from pg_policy where polname = 'el_select'",
      )
    ).rows[0].expr as string;
    expect(definition).toMatch(/can_export_data/);
  });
});

// =============================================================================
// Regression trouvee en verifiant sur un projet Supabase REEL (staging, 2026-07-29).
// `createUser` avec app_metadata n'ecrit pas ces cles dans la MEME instruction que
// l'insertion : le declencheur ne voit rien et cree un profil medecin. Le compte de
// mission naissait donc medecin, capable de creer ses propres bases.
describe('reconciliation du role de mission (defaut Supabase reel)', () => {
  /** Reproduit le comportement de Supabase : insertion NUE, app_metadata posee apres. */
  async function createUserLikeSupabase(email: string): Promise<string> {
    const id = await createAuthUser(email, { provider: 'email', providers: ['email'] });
    await db.admin.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"global_role":"saisisseur"}'::jsonb
       where id = $1`,
      [id],
    );
    return id;
  }

  test('sans reconciliation, le profil reste medecin — c est bien le defaut', async () => {
    const id = await createUserLikeSupabase('tardif@demo.test');
    expect(await globalRoleOf(id)).toBe('medecin');
  });

  test('la reconciliation retablit le role de mission', async () => {
    const id = await createUserLikeSupabase('reconcilie@demo.test');
    const role = (await db.admin.query('select public.reconcile_mission_profile($1) as role', [id])).rows[0].role;
    expect(role).toBe('saisisseur');
    expect(await globalRoleOf(id)).toBe('saisisseur');
  });

  test('elle est idempotente : rejouer ne change rien', async () => {
    const id = await createUserLikeSupabase('rejeu@demo.test');
    await db.admin.query('select public.reconcile_mission_profile($1)', [id]);
    const again = (await db.admin.query('select public.reconcile_mission_profile($1) as role', [id])).rows[0].role;
    expect(again).toBe('saisisseur');
  });

  test('elle ne touche pas un compte qui n a pas demande le role de mission', async () => {
    const id = await createAuthUser('simple.medecin@demo.test', { provider: 'email' });
    const role = (await db.admin.query('select public.reconcile_mission_profile($1) as role', [id])).rows[0].role;
    expect(role).toBe('medecin');
    expect(await globalRoleOf(id)).toBe('medecin');
  });

  test('elle REFUSE de retrograder un compte deja etabli (proprietaire ou beneficiaire)', async () => {
    // Un medecin proprietaire d'une base : la retrograder lui ferait perdre sa base.
    await db.admin.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"global_role":"saisisseur"}'::jsonb
       where id = $1`,
      [aliceId],
    );
    await expect(
      db.admin.query('select public.reconcile_mission_profile($1)', [aliceId]),
    ).rejects.toThrow(/deja etabli/i);
    expect(await globalRoleOf(aliceId)).toBe('medecin');
    await db.admin.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data - 'global_role' where id = $1`,
      [aliceId],
    );
  });

  test('elle n est PAS executable par un client authentifie', async () => {
    const id = await createUserLikeSupabase('interdit@demo.test');
    await expect(
      rowsAs(bobId, 'select public.reconcile_mission_profile($1)', [id]),
    ).rejects.toThrow(/permission|denied|droit/i);
  });

  test('un compte introuvable est refuse explicitement', async () => {
    await expect(
      db.admin.query('select public.reconcile_mission_profile($1)', ['00000000-0000-0000-0000-0000000000ff']),
    ).rejects.toThrow(/introuvable/i);
  });
});
