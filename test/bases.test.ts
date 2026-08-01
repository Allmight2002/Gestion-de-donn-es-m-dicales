// Tests DB de l'etape 5 (bases) : creation, propriete, visibilite owned/partagee (§7).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let bobId: string;
let aliceId: string;
let curatorId: string; // role global curateur (staff) — ne doit PAS pouvoir creer de base
let publishedVersionId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  bobId = byEmail.get('bob@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  curatorId = byEmail.get('curator1@demo.test')!;
  publishedVersionId = (
    await db.admin.query("select id from public.template_version where status = 'published' limit 1")
  ).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

async function bobCreatesBase(): Promise<string> {
  const rows = await db.asUser(bobId, async (c) =>
    (
      await c.query(
        "insert into public.base(name, specialty, owner_user_id, current_template_version_id) values('Base de Bob','neuro',$1,$2) returning id",
        [bobId, publishedVersionId],
      )
    ).rows,
  );
  return rows[0].id;
}

describe('creation et propriete d une base', () => {
  test('un membre cree une base dont il est proprietaire et la voit', async () => {
    const baseId = await bobCreatesBase();
    expect(await rowsAs(bobId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
  });

  test('un membre ne peut pas creer une base au nom d un autre (RLS with check)', async () => {
    await expect(
      rowsAs(bobId, "insert into public.base(name, owner_user_id, current_template_version_id) values('Usurpee',$1,$2)", [
        aliceId,
        publishedVersionId,
      ]),
    ).rejects.toThrow();
  });

  test('un compte staff (curateur) ne peut PAS creer de base (reserve au medecin)', async () => {
    await expect(
      rowsAs(curatorId, "insert into public.base(name, owner_user_id, current_template_version_id) values('Base staff',$1,$2)", [
        curatorId,
        publishedVersionId,
      ]),
    ).rejects.toThrow();
  });

  test('le proprietaire d une base est immuable (owner_user_id)', async () => {
    const baseId = await bobCreatesBase();
    await expect(
      rowsAs(bobId, 'update public.base set owner_user_id = $2 where id = $1', [baseId, aliceId]),
    ).rejects.toThrow(/immuable/i);
  });
});

describe('L9 : modele d observation de la base', () => {
  test('une creation transversale convertit les variables de rencontre en variables participant', async () => {
    const created = await rowsAs(
      bobId,
      'select * from public.create_base_from_model_observation($1,$2,$3,$4)',
      ['Etude transversale', 'neuro', publishedVersionId, 'cross_sectional'],
    );
    const base = created[0];
    expect(base.observation_model).toBe('cross_sectional');

    const fields = (await db.admin.query(
      'select scope, encounter_types from public.template_field where template_version_id=$1',
      [base.current_template_version_id],
    )).rows;
    expect(fields).not.toHaveLength(0);
    expect(fields.every((field) => field.scope === 'patient' && field.encounter_types === null)).toBe(true);
  });

  test('la base refuse une rencontre et une soumission de rencontre en transversal, quel que soit l appelant', async () => {
    const base = (await rowsAs(
      bobId,
      'select * from public.create_base_from_model_observation($1,$2,$3,$4)',
      ['Etude transversale protege', 'neuro', publishedVersionId, 'cross_sectional'],
    ))[0];
    const patientId = (await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'TRANS-1',$2,'{}'::jsonb) returning id",
      [base.id, base.current_template_version_id],
    )).rows[0].id;

    await expect(rowsAs(
      bobId,
      "select * from public.create_encounter($1,'consultation','2026-08-01','draft','{}'::jsonb,'years')",
      [patientId],
    )).rejects.toThrow(/transversale.*rencontre/i);
    await expect(db.admin.query(
      "insert into public.raw_submission(base_id, target_patient_id, scope, case_code, status) values($1,$2,'encounter','CASE-TRANS-1','received')",
      [base.id, patientId],
    )).rejects.toThrow(/transversale.*rencontre/i);
  });

  test('le proprietaire peut changer une base vide, mais jamais apres la premiere saisie', async () => {
    const baseId = await bobCreatesBase();
    const changed = await rowsAs(bobId, 'select * from public.set_base_observation_model($1,$2)', [baseId, 'event_registry']);
    expect(changed[0].observation_model).toBe('event_registry');

    const templateVersionId = (await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'LOCK-OBS-1',$2,'{}'::jsonb)",
      [baseId, templateVersionId],
    );
    await expect(rowsAs(bobId, 'select * from public.set_base_observation_model($1,$2)', [baseId, 'cross_sectional']))
      .rejects.toThrow(/apres la premiere saisie/i);
    expect((await db.admin.query('select observation_model from public.base where id=$1', [baseId])).rows[0].observation_model)
      .toBe('event_registry');
  });
});

describe('visibilite : privee par defaut, partage explicite', () => {
  test('une autre medecin ne voit pas la base, puis la voit apres partage', async () => {
    const baseId = await bobCreatesBase();

    // Alice n'a aucun acces -> base invisible.
    expect(await rowsAs(aliceId, 'select id from public.base where id = $1', [baseId])).toHaveLength(0);

    // Bob (proprietaire) partage avec Alice en lecture.
    await db.admin.query(
      "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
      [baseId, aliceId, bobId],
    );

    // Acces immediat.
    expect(await rowsAs(aliceId, 'select id from public.base where id = $1', [baseId])).toHaveLength(1);
  });
});

describe('audit v12 §6.2 : rattachement a un gabarit etranger interdit', () => {
  test('le proprietaire ne peut pointer sa base que vers une version de SON gabarit', async () => {
    const baseId = await bobCreatesBase(); // pointe vers publishedVersionId (gabarit T_a)
    const tA = (await db.admin.query('select template_id from public.template_version where id=$1', [publishedVersionId])).rows[0].template_id;

    // Version d'un AUTRE gabarit (le seed en compte deux) -> rattachement REFUSE.
    const foreign = (await db.admin.query('select id from public.template_version where template_id <> $1 limit 1', [tA])).rows[0].id;
    await expect(rowsAs(bobId, 'select * from public.set_base_template_version($1,$2)', [baseId, foreign]))
      .rejects.toThrow(/jeu de variables etranger/i);

    // Une nouvelle version du MEME gabarit reste acceptee (flux legitime createNextVersion).
    const sameTplNewVer = (await db.admin.query(
      "insert into public.template_version(template_id, version_number, status) values($1, 999, 'published') returning id",
      [tA],
    )).rows[0].id;
    await rowsAs(bobId, 'select * from public.set_base_template_version($1,$2)', [baseId, sameTplNewVer]);
    expect((await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id).toBe(sameTplNewVer);
  });

  test('la version courante ne peut plus etre detachee puis remplacee par un gabarit prive etranger', async () => {
    const baseId = await bobCreatesBase();
    await expect(rowsAs(bobId, 'update public.base set current_template_version_id=null where id=$1', [baseId]))
      .rejects.toThrow(/toujours pointer|jeu de variables/i);
  });
});

describe('suppression de base : soft delete audite uniquement', () => {
  test('le DELETE physique direct est ferme ; soft_delete_base masque la base et ses patients', async () => {
    const baseId = await bobCreatesBase();
    const tv = (await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'BASE-DEL-1',$2,'{}'::jsonb)",
      [baseId, tv],
    );

    expect(await rowsAs(bobId, 'delete from public.base where id=$1 returning id', [baseId])).toHaveLength(0);
    expect((await db.admin.query('select deleted_at from public.base where id=$1', [baseId])).rows[0].deleted_at).toBeNull();

    await rowsAs(bobId, 'select public.soft_delete_base($1,$2)', [baseId, 'fin etude']);
    expect(await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).toHaveLength(0);
    expect(await rowsAs(bobId, 'select id from public.patient where base_id=$1', [baseId])).toHaveLength(0);
    expect((await db.admin.query('select deleted_at, deletion_reason from public.base where id=$1', [baseId])).rows[0])
      .toMatchObject({ deletion_reason: 'fin etude' });
  });
});

describe('restauration de base : proprietaire, transaction et acces revoques', () => {
  test('le proprietaire restaure les donnees et les etats, sans rouvrir le partage', async () => {
    const baseId = await bobCreatesBase();
    const tv = (await db.admin.query('select current_template_version_id from public.base where id=$1', [baseId])).rows[0].current_template_version_id;
    const patientId = (await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'BASE-RESTORE-1',$2,'{}'::jsonb) returning id",
      [baseId, tv],
    )).rows[0].id;
    const submissionId = (await db.admin.query(
      "insert into public.raw_submission(base_id, target_patient_id, case_code, status) values($1,$2,'CASE-BASE-RESTORE','received') returning id",
      [baseId, patientId],
    )).rows[0].id;
    const taskId = (await db.admin.query(
      "insert into public.curation_task(base_id, submission_id, status) values($1,$2,'preparing') returning id",
      [baseId, submissionId],
    )).rows[0].id;
    await db.admin.query(
      "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
      [baseId, aliceId, bobId],
    );

    await rowsAs(bobId, 'select public.soft_delete_base($1,$2)', [baseId, 'creation par erreur']);
    // Retry apres reponse perdue : l'etat deja atteint est un succes sans second audit.
    await rowsAs(bobId, 'select public.soft_delete_base($1,$2)', [baseId, null]);

    const trash = (await rowsAs(bobId, 'select * from public.list_deleted_bases()')).filter((row) => row.id === baseId);
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ id: baseId, name: 'Base de Bob', deletion_reason: 'creation par erreur' });
    expect(new Date(trash[0].purge_eligible_at).getTime()).toBeGreaterThan(new Date(trash[0].deleted_at).getTime());
    expect(await rowsAs(aliceId, 'select * from public.list_deleted_bases()')).toHaveLength(0);
    await expect(rowsAs(aliceId, 'select public.restore_deleted_base($1)', [baseId]))
      .rejects.toThrow(/proprietaire/i);

    // Deux clics ou retries concurrents se serialisent sur la base et convergent vers active.
    await Promise.all([
      rowsAs(bobId, 'select public.restore_deleted_base($1)', [baseId]),
      rowsAs(bobId, 'select public.restore_deleted_base($1)', [baseId]),
    ]);

    expect(await rowsAs(bobId, 'select id from public.base where id=$1', [baseId])).toHaveLength(1);
    // Le collaborateur reste exclu : seul une nouvelle invitation peut recreer l'acces.
    expect(await rowsAs(aliceId, 'select id from public.base where id=$1', [baseId])).toHaveLength(0);
    expect((await db.admin.query('select revoked_at from public.base_access where base_id=$1 and user_id=$2', [baseId, aliceId])).rows[0].revoked_at)
      .not.toBeNull();

    expect((await db.admin.query('select deleted_at from public.patient where id=$1', [patientId])).rows[0].deleted_at).toBeNull();
    expect((await db.admin.query('select deleted_at, status from public.raw_submission where id=$1', [submissionId])).rows[0])
      .toMatchObject({ deleted_at: null, status: 'received' });
    expect((await db.admin.query('select deleted_at, status from public.curation_task where id=$1', [taskId])).rows[0])
      .toMatchObject({ deleted_at: null, status: 'preparing' });
    expect((await db.admin.query('select deleted_at, deletion_snapshot from public.base where id=$1', [baseId])).rows[0])
      .toMatchObject({ deleted_at: null, deletion_snapshot: null });

    const audit = await db.admin.query(
      "select action from public.audit_log where base_id=$1 and action in ('base_deleted','base_restored') order by created_at",
      [baseId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['base_deleted', 'base_restored']);
  });
});
