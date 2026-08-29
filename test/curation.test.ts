// Tests DB du POOL DE CURATION GLOBAL (cahier v3.0 + synthese produit) : le medecin soumet
// un cas (code opaque + documents deidentifies) ; les CURATEURS (role global) voient le pool,
// RESERVENT un cas (anti-collision), structurent et FINALISENT directement (le role
// `validateur` est supprime). Confidentialite : le curateur ne voit JAMAIS l'identite.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let adminId: string;
let aliceId: string;     // medecin proprietaire
let editorId: string;    // collaborateur avec droits structure + identite, mais non proprietaire
let curator1Id: string;  // curateur global
let curator2Id: string;  // curateur global
let annaId: string;      // medecin collaborateur (export seul) — EXCLU du pool
let baseId: string;
let seedTaskId: string;  // tache OUVERTE du seed (avec document)

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const atomicCall = (uid: string, key: string, code: string) => rowsAs(uid,
  'select * from public.create_patient_curation_submission($1,$2,$3,$4,$5,$6,$7,$8)',
  [baseId, code, 'Patient atomique', '1980-01-01', null, null, null, key]);

// Cree un cas OUVERT (dans le pool) : la RPC le cree en 'preparing', puis on depose un
// document (condition cote medecin) et on le SOUMET -> 'open', reservable par un curateur.
async function openCase(target: string): Promise<{ taskId: string; subId: string; patientId: string }> {
  const pid = (await db.admin.query('select id from public.patient where base_id=$1 and patient_code=$2', [baseId, target])).rows[0].id;
  const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'REF-' + target]);
  const taskId = task[0].id as string, subId = task[0].submission_id as string;
  await db.admin.query(
    "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'doc',$3,'application/pdf')",
    [subId, baseId, `${baseId}/${subId}/d.pdf`],
  );
  await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
  return { taskId, subId, patientId: pid };
}
// Reserve le cas (curator1) et cree son brouillon structure (pret a finaliser).
async function claimAndDraft(target: string, patientData: object, encounters: object[]) {
  const c = await openCase(target);
  await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]);
  const draft = await rowsAs(curator1Id,
    "insert into public.curation_draft(task_id, base_id, patient_data, encounters, status) values($1,$2,$3::jsonb,$4::jsonb,'draft') returning id",
    [c.taskId, baseId, JSON.stringify(patientData), JSON.stringify(encounters)]);
  return { ...c, draftId: draft[0].id as string };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  adminId = byEmail.get('admin@demo.test')!;
  aliceId = byEmail.get('alice@demo.test')!;
  editorId = byEmail.get('editor@demo.test')!;
  curator1Id = byEmail.get('curator1@demo.test')!;
  curator2Id = byEmail.get('curator2@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  seedTaskId = (await db.admin.query("select id from public.curation_task where status='open' limit 1")).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('pool global : visibilite + confidentialite', () => {
  test('un curateur voit le pool MINIMAL (RPC) mais PAS les metadonnees sensibles avant reservation', async () => {
    // §10 : le pool est visible via la RPC minimale (code, portee, specialite, date, nb documents).
    expect((await rowsAs(curator1Id, 'select task_id from public.curation_pool()')).length).toBeGreaterThan(0);
    // Avant reservation, aucun acces DIRECT a curation_task ni raw_submission (external_ref, notes,
    // target_patient_id, base_id... ne fuient plus).
    expect(await rowsAs(curator1Id, 'select id from public.curation_task')).toHaveLength(0);
    expect(await rowsAs(curator1Id, 'select id from public.raw_submission')).toHaveLength(0);
    // §5.1 : un curateur NON affecte ne voit AUCUN document (acces apres reservation seulement).
    expect(await rowsAs(curator1Id, 'select id from public.raw_document')).toHaveLength(0);
    // Aucun acces base -> aucune identite.
    expect(await rowsAs(curator1Id, 'select id from public.patient_identity')).toHaveLength(0);
  });

  test('§10 apres reservation, le curateur affecte accede a SA tache et SA soumission', async () => {
    const c = await openCase('NCH-003');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]);
    expect((await rowsAs(curator1Id, 'select id from public.curation_task where id=$1', [c.taskId]))).toHaveLength(1);
    expect((await rowsAs(curator1Id, 'select id from public.raw_submission where id=$1', [c.subId]))).toHaveLength(1);
  });

  test('apres reservation, le curateur voit les documents de SA tache ; pas ceux d une autre', async () => {
    const a = await openCase('NCH-005'); // chaque cas porte deja 1 document (depose a la soumission)
    const b = await openCase('NCH-006');

    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [a.taskId]); // curator1 reserve A
    expect((await rowsAs(curator1Id, 'select id from public.raw_document where submission_id=$1', [a.subId])).length).toBe(1); // SA tache
    expect(await rowsAs(curator1Id, 'select id from public.raw_document where submission_id=$1', [b.subId])).toHaveLength(0); // pas l autre
  });

  test('un collaborateur (export seul) et l admin ne voient PAS les documents bruts du pool', async () => {
    expect(await rowsAs(annaId, 'select id from public.raw_document')).toHaveLength(0);
    expect(await rowsAs(adminId, 'select id from public.raw_document')).toHaveLength(0);
  });

  test('le medecin proprietaire voit ses propres cas', async () => {
    expect((await rowsAs(aliceId, 'select id from public.curation_task where base_id=$1', [baseId])).length).toBeGreaterThan(0);
  });

  test('un curateur ne lit PAS le brouillon ni les clarifications d un AUTRE curateur', async () => {
    const c = await claimAndDraft('NCH-005', { blood_group: 'O+' }, []);
    // Le curateur AFFECTE lit son brouillon (controle positif) ; un autre curateur ne le lit pas.
    expect((await rowsAs(curator1Id, 'select id from public.curation_draft where task_id=$1', [c.taskId])).length).toBe(1);
    expect(await rowsAs(curator2Id, 'select id from public.curation_draft where task_id=$1', [c.taskId])).toHaveLength(0);
    // Idem pour les clarifications (meme isolation que le brouillon).
    await rowsAs(curator1Id, 'select * from public.request_clarification($1,$2)', [c.taskId, 'question ?']);
    expect((await rowsAs(curator1Id, 'select id from public.curation_clarification where task_id=$1', [c.taskId])).length).toBe(1);
    expect(await rowsAs(curator2Id, 'select id from public.curation_clarification where task_id=$1', [c.taskId])).toHaveLength(0);
  });
});

describe('reservation (anti-collision)', () => {
  test('un curateur reserve un cas ouvert ; un 2e curateur ne peut plus le reserver', async () => {
    const { taskId } = await openCase('NCH-005');
    const claimed = await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]);
    expect(claimed[0].assigned_to).toBe(curator1Id);
    expect(claimed[0].status).toBe('in_progress');
    await expect(rowsAs(curator2Id, 'select * from public.claim_curation_task($1)', [taskId])).rejects.toThrow(/reserve|indisponible/i);
  });

  test('un non-curateur (collaborateur export) ne peut pas reserver', async () => {
    await expect(rowsAs(annaId, 'select * from public.claim_curation_task($1)', [seedTaskId])).rejects.toThrow(/curateur/i);
  });

  test('deux creations concurrentes convergent vers un seul brouillon actif par tache', async () => {
    const { taskId } = await openCase('NCH-008');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]);
    const [a, b] = await Promise.all([
      rowsAs(curator1Id, 'select (public.ensure_curation_draft($1,$2)).id as id', [taskId, baseId]),
      rowsAs(curator1Id, 'select (public.ensure_curation_draft($1,$2)).id as id', [taskId, baseId]),
    ]);
    expect(a[0].id).toBe(b[0].id);
    expect((await db.admin.query(
      'select count(*)::int n from public.curation_draft where task_id=$1 and superseded_at is null', [taskId],
    )).rows[0].n).toBe(1);
    await expect(rowsAs(curator1Id,
      "insert into public.curation_draft(task_id,base_id,status) values($1,$2,'draft')", [taskId, baseId],
    )).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('structuration -> finalisation (pool, sans validateur)', () => {
  test('le curateur affecte FINALISE -> donnees CUREES (age calcule, journalisees)', async () => {
    const c = await claimAndDraft('NCH-004', { blood_group: 'AB-' }, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { admission_date: '2024-05-01', diagnosis: 'AVC', glasgow_score: 13 } },
    ]);
    const encBefore = Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [c.patientId])).rows[0].n);

    const fin = await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId]);
    expect(fin[0].status).toBe('completed');

    const pat = (await db.admin.query('select data, validation_status from public.patient where id=$1', [c.patientId])).rows[0];
    expect(pat.data.blood_group).toBe('AB-');
    expect(pat.validation_status).toBe('curated');
    const enc = (await db.admin.query("select age_value, validation_status, data from public.encounter where patient_id=$1 and encounter_date='2024-05-10'", [c.patientId])).rows[0];
    expect(enc.validation_status).toBe('curated');
    expect(enc.age_value).not.toBeNull();
    expect('age_at_encounter' in enc.data).toBe(false);
    expect(Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [c.patientId])).rows[0].n)).toBe(encBefore + 1);

    // Le curateur n'a jamais eu acces a l'identite ; la soumission passe a 'completed'.
    expect(await rowsAs(curator1Id, 'select id from public.patient_identity')).toHaveLength(0);
    expect((await db.admin.query('select status from public.raw_submission where id=$1', [c.subId])).rows[0].status).toBe('completed');
    // Journalisation.
    expect((await db.admin.query("select 1 from public.audit_log where action='curation_finalized' and entity_id=$1", [c.taskId])).rows.length).toBeGreaterThan(0);
  });

  test('validation SERVEUR (§6) : une finalisation hors bornes (Glasgow=78) est refusee', async () => {
    const c = await claimAndDraft('NCH-010', {}, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { glasgow_score: 78 } },
    ]);
    await expect(rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId])).rejects.toThrow(/maximum|glasgow/i);
  });

  test('completude SERVEUR (§6) : finalisation REFUSEE si un champ requis est absent', async () => {
    // Le gabarit du seed exige `diagnosis` (encounter) ; ici on l'omet (glasgow valide).
    const c = await claimAndDraft('NCH-003', {}, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { glasgow_score: 12 } },
    ]);
    await expect(rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId])).rejects.toThrow(/requis|manquant/i);
  });

  test('un curateur NON affecte ne peut pas finaliser le cas d un autre', async () => {
    const c = await claimAndDraft('NCH-006', {}, [{ encounter_type: 'suivi', encounter_date: '2024-06-01', age_unit: 'years', data: { glasgow_score: 7 } }]);
    await expect(rowsAs(curator2Id, 'select * from public.finalize_curation_task($1)', [c.taskId])).rejects.toThrow(/affecte|proprietaire/i);
  });

  test('un curateur non affecte ne peut pas creer de brouillon sur un cas', async () => {
    const { taskId } = await openCase('NCH-007');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]); // reserve par curator1
    await expect(
      rowsAs(curator2Id, "insert into public.curation_draft(task_id, base_id, status) values($1,$2,'draft')", [taskId, baseId]),
    ).rejects.toThrow();
  });

  test('§8.1 : la rencontre finalisee porte la version de VALIDATION (soumission), pas celle du patient', async () => {
    // Cree une 2e version (copie de la courante) et repointe la base dessus -> le patient reste
    // sur v1, mais la soumission enregistrera v2. Reset garanti par finally.
    const v1 = (await db.admin.query('select current_template_version_id v from public.base where id=$1', [baseId])).rows[0].v;
    const tpl = (await db.admin.query('select template_id from public.template_version where id=$1', [v1])).rows[0].template_id;
    const v2 = (await db.admin.query("insert into public.template_version(template_id, version_number, status, published_at) values($1, 999, 'published', now()) returning id", [tpl])).rows[0].id;
    await db.admin.query('insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types) select $1, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types from public.template_field where template_version_id=$2', [v2, v1]);
    await db.admin.query('insert into public.validation_rule(template_version_id, rule, message, severity) select $1, rule, message, severity from public.validation_rule where template_version_id=$2', [v2, v1]);
    try {
      await db.admin.query('update public.base set current_template_version_id=$1 where id=$2', [v2, baseId]);
      const c = await claimAndDraft('NCH-007', {}, [{ encounter_type: 'suivi', encounter_date: '2024-09-09', age_unit: 'years', data: { diagnosis: 'ctrl', glasgow_score: 11 } }]);
      await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId]);
      const encTv = (await db.admin.query("select template_version_id from public.encounter where patient_id=$1 and encounter_date='2024-09-09'", [c.patientId])).rows[0].template_version_id;
      expect(encTv).toBe(v2);       // version de la soumission (qui a valide)
      expect(encTv).not.toBe(v1);   // PAS la version (ancienne) du patient
    } finally {
      await db.admin.query('update public.base set current_template_version_id=$1 where id=$2', [v1, baseId]);
    }
  });
});

describe('soumission de cas (medecin)', () => {
  test('la RPC atomique resout pgcrypto dans le schema Supabase extensions', async () => {
    const config = (await db.admin.query(
      "select proconfig from pg_proc where oid = 'public.create_patient_curation_submission(uuid,text,text,date,text,text,text,text)'::regprocedure",
    )).rows[0].proconfig as string[];
    expect(config).toContain('search_path=public, extensions, pg_temp');
  });

  test('creation complete ; un retry apres reponse perdue restitue exactement les memes ids', async () => {
    const key = `atomic-${Date.now()}`;
    const call = (code: string) => atomicCall(aliceId, key, code);
    const first = await call('ATOMIC-001'); // la reponse peut etre perdue par le client
    expect(first[0].replayed).toBe(false);
    expect((await db.admin.query('select count(*)::int n from public.raw_submission where target_patient_id=$1', [first[0].patient_id])).rows[0].n).toBe(1);
    expect((await db.admin.query('select count(*)::int n from public.curation_task where id=$1', [first[0].task_id])).rows[0].n).toBe(1);
    expect(await rowsAs(aliceId, 'select id from public.raw_submission where id=$1', [first[0].submission_id])).toHaveLength(1);
    expect(await rowsAs(aliceId, 'select id from public.curation_task where id=$1', [first[0].task_id])).toHaveLength(1);
    await expect(rowsAs(aliceId, 'select * from public.patient_curation_idempotency')).rejects.toThrow(/permission|denied/i);
    const retry = await call('ATOMIC-001');
    expect(retry[0]).toMatchObject({ patient_id: first[0].patient_id, submission_id: first[0].submission_id, task_id: first[0].task_id, replayed: true });
    await expect(call('ATOMIC-CHANGED')).rejects.toThrow(/CLE_IDEMPOTENCE_CONTRADICTOIRE/);
    expect((await db.admin.query("select count(*)::int n from public.patient where base_id=$1 and patient_code='ATOMIC-CHANGED'", [baseId])).rows[0].n).toBe(0);
  });

  test('la finalisation ignore un doublon historique supersede meme s il a le updated_at le plus recent', async () => {
    const c = await claimAndDraft('NCH-005', { blood_group: 'A+' }, []);
    const historical = (await db.admin.query(
      `insert into public.curation_draft(
         task_id,base_id,patient_data,encounters,status,created_by,
         superseded_at,superseded_by,updated_at
       ) values($1,$2,$3::jsonb,'[]'::jsonb,'draft',$4,now(),$5,now()+interval '1 day') returning id`,
      [c.taskId, baseId, JSON.stringify({ blood_group: 'VALEUR-INVALIDE' }), curator1Id, c.draftId],
    )).rows[0].id as string;

    await expect(rowsAs(curator1Id,
      "update public.curation_draft set patient_data='{}'::jsonb where id=$1", [historical],
    )).rejects.toThrow(/historique|modifiable/i);
    await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId]);
    const drafts = (await db.admin.query(
      'select id,status,superseded_at from public.curation_draft where task_id=$1 order by id', [c.taskId],
    )).rows;
    expect(drafts.find((d) => d.id === c.draftId)).toMatchObject({ status: 'finalized', superseded_at: null });
    expect(drafts.find((d) => d.id === historical)?.superseded_at).not.toBeNull();
    expect((await db.admin.query('select data from public.patient where id=$1', [c.patientId])).rows[0].data.blood_group).toBe('A+');
  });

  test('un double clic concurrent ne cree qu un patient, une soumission et une tache', async () => {
    const key = `atomic-concurrent-${Date.now()}`;
    const code = `ATOMIC-CONCURRENT-${Date.now()}`;
    const [a, b] = await Promise.all([
      atomicCall(aliceId, key, code),
      atomicCall(aliceId, key, code),
    ]);
    expect([a[0].replayed, b[0].replayed].sort()).toEqual([false, true]);
    expect(b[0]).toMatchObject({ patient_id: a[0].patient_id, submission_id: a[0].submission_id, task_id: a[0].task_id });
    const counts = (await db.admin.query(`
      select
        (select count(*)::int from public.patient where base_id=$1 and patient_code=$2) patients,
        (select count(*)::int from public.patient_identity where base_id=$1 and patient_code=$2) identities,
        (select count(*)::int from public.raw_submission where target_patient_id=$3) submissions,
        (select count(*)::int from public.curation_task where submission_id=$4) tasks
    `, [baseId, code, a[0].patient_id, a[0].submission_id])).rows[0];
    expect(counts).toEqual({ patients: 1, identities: 1, submissions: 1, tasks: 1 });
  });

  test('une erreur pendant la soumission ou la tache annule toutes les ecritures', async () => {
    await db.admin.query(`
      create or replace function public.test_fail_atomic_patient_curation()
      returns trigger language plpgsql set search_path = public, pg_temp as $$
      declare v_code text;
      begin
        if tg_table_name = 'raw_submission' then
          select patient_code into v_code from public.patient where id = new.target_patient_id;
          if v_code = 'ATOMIC-FAIL-SUBMISSION' then raise exception 'TEST_FAIL_SUBMISSION'; end if;
        elsif tg_table_name = 'curation_task' then
          select p.patient_code into v_code
          from public.raw_submission s join public.patient p on p.id = s.target_patient_id
          where s.id = new.submission_id;
          if v_code = 'ATOMIC-FAIL-TASK' then raise exception 'TEST_FAIL_TASK'; end if;
        end if;
        return new;
      end $$;
      create trigger test_fail_atomic_submission before insert on public.raw_submission
        for each row execute function public.test_fail_atomic_patient_curation();
      create trigger test_fail_atomic_task before insert on public.curation_task
        for each row execute function public.test_fail_atomic_patient_curation();
    `);
    try {
      await expect(atomicCall(aliceId, `fail-sub-${Date.now()}`, 'ATOMIC-FAIL-SUBMISSION')).rejects.toThrow(/TEST_FAIL_SUBMISSION/);
      await expect(atomicCall(aliceId, `fail-task-${Date.now()}`, 'ATOMIC-FAIL-TASK')).rejects.toThrow(/TEST_FAIL_TASK/);
      for (const code of ['ATOMIC-FAIL-SUBMISSION', 'ATOMIC-FAIL-TASK']) {
        expect((await db.admin.query('select count(*)::int n from public.patient where base_id=$1 and patient_code=$2', [baseId, code])).rows[0].n).toBe(0);
        expect((await db.admin.query('select count(*)::int n from public.patient_identity where base_id=$1 and patient_code=$2', [baseId, code])).rows[0].n).toBe(0);
      }
      expect((await db.admin.query('select count(*)::int n from public.raw_submission s left join public.patient p on p.id=s.target_patient_id where p.id is null')).rows[0].n).toBe(0);
      expect((await db.admin.query('select count(*)::int n from public.curation_task t left join public.raw_submission s on s.id=t.submission_id where s.id is null')).rows[0].n).toBe(0);
    } finally {
      await db.admin.query(`
        drop trigger if exists test_fail_atomic_submission on public.raw_submission;
        drop trigger if exists test_fail_atomic_task on public.curation_task;
        drop function if exists public.test_fail_atomic_patient_curation();
      `);
    }
  });

  test('la creation combinee reste reservee au proprietaire et ne cree aucun cas fantome', async () => {
    const attempts = [
      { uid: editorId, code: `ATOMIC-EDITOR-${Date.now()}`, role: /proprietaire/i },
      { uid: annaId, code: `ATOMIC-VIEWER-${Date.now()}`, role: /proprietaire/i },
      { uid: curator1Id, code: `ATOMIC-CURATOR-${Date.now()}`, role: /proprietaire/i },
    ];
    for (const attempt of attempts) {
      await expect(atomicCall(attempt.uid, `denied-${attempt.code}`, attempt.code)).rejects.toThrow(attempt.role);
      expect((await db.admin.query('select count(*)::int n from public.patient where base_id=$1 and patient_code=$2', [baseId, attempt.code])).rows[0].n).toBe(0);
      expect((await db.admin.query('select count(*)::int n from public.patient_identity where base_id=$1 and patient_code=$2', [baseId, attempt.code])).rows[0].n).toBe(0);
    }
  });

  test('seul le medecin proprietaire cree un cas ; un curateur ne peut pas', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-008'", [baseId])).rows[0].id;
    await expect(rowsAs(curator1Id, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'x'])).rejects.toThrow(/proprietaire/i);
    const ok = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'x']);
    // Le cas naît en PREPARATION : il n'entre PAS encore dans le pool.
    expect(ok[0].status).toBe('preparing');
  });

  test('un cas n entre dans le pool qu apres soumission, et seulement avec >= 1 document', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-001'", [baseId])).rows[0].id;
    const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'prep']);
    const taskId = task[0].id as string, subId = task[0].submission_id as string;
    expect(task[0].status).toBe('preparing');

    // Sans document : la soumission est refusee (le staff n'aurait rien a traiter).
    await expect(rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId])).rejects.toThrow(/document/i);
    // Un cas 'preparing' n'est pas reservable par un curateur.
    await expect(rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId])).rejects.toThrow(/reserve|indisponible/i);

    await db.admin.query("insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'d',$3,'application/pdf')", [subId, baseId, `${baseId}/${subId}/d.pdf`]);
    // Un non-proprietaire ne peut pas soumettre.
    await expect(rowsAs(curator1Id, 'select * from public.submit_curation_request($1)', [taskId])).rejects.toThrow(/proprietaire/i);
    // Proprietaire + document : le cas entre dans le pool ('open').
    const sent = await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
    expect(sent[0].status).toBe('open');
    expect((await db.admin.query('select status from public.raw_submission where id=$1', [subId])).rows[0].status).toBe('in_curation');
  });

  test('un document brut pending/scanning/quarantined bloque la soumission au staff', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-002'", [baseId])).rows[0].id;
    const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'scan-pending']);
    const taskId = task[0].id as string, subId = task[0].submission_id as string;
    await db.admin.query(
      "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type, inspection_status) values($1,$2,'d',$3,'application/pdf','pending')",
      [subId, baseId, `${baseId}/${subId}/pending.pdf`],
    );

    await expect(rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]))
      .rejects.toThrow(/inspection|acceptes/i);
  });

  test('en politique stricte, accepted_client bloque la soumission au staff', async () => {
    await db.admin.query("update public.app_security_setting set value='true', updated_at=now() where key='require_server_inspection'");
    try {
      const pid = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;
      const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, pid, 'strict-client']);
      const taskId = task[0].id as string, subId = task[0].submission_id as string;
      await db.admin.query(
        "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type, inspection_status) values($1,$2,'d',$3,'application/pdf','accepted_client')",
        [subId, baseId, `${baseId}/${subId}/client.pdf`],
      );

      await expect(rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]))
        .rejects.toThrow(/inspection serveur|acceptes/i);

      await db.admin.query(
        "update public.raw_document set inspection_status='accepted', inspected_at=now() where submission_id=$1",
        [subId],
      );
      const sent = await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
      expect(sent[0].status).toBe('open');
    } finally {
      await db.admin.query("update public.app_security_setting set value='false', updated_at=now() where key='require_server_inspection'");
    }
  });

  test('portee "rencontre" : scope=encounter ; la finalisation cree une rencontre', async () => {
    const pid = (await db.admin.query("select id from public.patient where base_id=$1 and patient_code='NCH-009'", [baseId])).rows[0].id;
    const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3,$4)', [baseId, pid, 'ENC', 'encounter']);
    expect((await db.admin.query('select scope from public.raw_submission where id=$1', [task[0].submission_id])).rows[0].scope).toBe('encounter');

    // Soumission au pool : document requis, puis envoi, puis reservation + brouillon + finalisation.
    await db.admin.query("insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'d',$3,'application/pdf')", [task[0].submission_id, baseId, `${baseId}/${task[0].submission_id}/d.pdf`]);
    await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [task[0].id]);
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [task[0].id]);
    await rowsAs(curator1Id,
      "insert into public.curation_draft(task_id, base_id, encounters, status) values($1,$2,$3::jsonb,'draft')",
      [task[0].id, baseId, JSON.stringify([{ encounter_type: 'suivi', encounter_date: '2024-09-01', age_unit: 'years', data: { admission_date: '2024-09-01', diagnosis: 'suivi', glasgow_score: 11 } }])]);
    const before = Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [pid])).rows[0].n);
    await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [task[0].id]);
    expect(Number((await db.admin.query('select count(*)::int n from public.encounter where patient_id=$1', [pid])).rows[0].n)).toBe(before + 1);
  });
});

describe('clarification (curateur <-> medecin, §4.3)', () => {
  test('le curateur affecte demande ; le medecin repond -> retour en cours', async () => {
    const c = await openCase('NCH-005');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]);

    const clar = await rowsAs(curator1Id, 'select * from public.request_clarification($1,$2)', [c.taskId, "Date d'admission absente ?"]);
    expect(clar[0].status).toBe('open');
    expect((await db.admin.query('select status from public.curation_task where id=$1', [c.taskId])).rows[0].status).toBe('clarification_requested');

    // Un curateur NON affecte ne peut pas demander.
    await expect(rowsAs(curator2Id, 'select * from public.request_clarification($1,$2)', [c.taskId, 'x'])).rejects.toThrow();

    // Le medecin proprietaire repond -> la tache repasse 'in_progress'.
    const ans = await rowsAs(aliceId, 'select * from public.answer_clarification($1,$2)', [clar[0].id, 'Admission le 3 mai']);
    expect(ans[0].status).toBe('answered');
    expect((await db.admin.query('select status from public.curation_task where id=$1', [c.taskId])).rows[0].status).toBe('in_progress');
  });

  test('un tiers (non proprietaire) ne peut pas repondre', async () => {
    const c = await openCase('NCH-006');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]);
    const clar = await rowsAs(curator1Id, 'select * from public.request_clarification($1,$2)', [c.taskId, 'q']);
    await expect(rowsAs(curator1Id, 'select * from public.answer_clarification($1,$2)', [clar[0].id, 'r'])).rejects.toThrow(/proprietaire/i);
  });
});

describe('suppression d une demande (medecin)', () => {
  test('le proprietaire supprime sa demande : tache + documents passent en supprime + trace', async () => {
    const c = await openCase('NCH-005'); // cas 'open' avec 1 document
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [c.taskId, 'erreur de saisie']);

    expect((await db.admin.query('select deleted_at from public.curation_task where id=$1', [c.taskId])).rows[0].deleted_at).not.toBeNull();
    // Les documents ne sont plus lisibles (deleted_at) -> 0 actif.
    expect(Number((await db.admin.query('select count(*)::int n from public.raw_document where submission_id=$1 and deleted_at is null', [c.subId])).rows[0].n)).toBe(0);
    // Disparait de la vue du medecin (les listes filtrent deleted_at is null).
    expect(await rowsAs(aliceId, 'select id from public.curation_task where id=$1 and deleted_at is null', [c.taskId])).toHaveLength(0);
    // Journalisation.
    expect((await db.admin.query("select 1 from public.audit_log where action='curation_request_deleted' and entity_id=$1", [c.taskId])).rows.length).toBeGreaterThan(0);
  });

  test('un curateur ne peut pas supprimer la demande d un medecin', async () => {
    const c = await openCase('NCH-006');
    await expect(rowsAs(curator1Id, 'select public.delete_curation_request($1,$2)', [c.taskId, 'x'])).rejects.toThrow(/proprietaire/i);
  });

  test('une demande supprimee ne peut plus etre reservee ni liberee', async () => {
    const open = await openCase('NCH-002');
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [open.taskId, 'annulation']);
    await expect(rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [open.taskId])).rejects.toThrow(/reserve|indisponible/i);

    const claimed = await openCase('NCH-003');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [claimed.taskId]);
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [claimed.taskId, 'annulation']);
    await expect(rowsAs(curator1Id, 'select * from public.release_curation_task($1)', [claimed.taskId])).rejects.toThrow(/reserve|liberable/i);

    const kept = (await db.admin.query('select deleted_at, assigned_to, status from public.curation_task where id=$1', [claimed.taskId])).rows[0];
    expect(kept.deleted_at).not.toBeNull();
    expect(kept.assigned_to).toBe(curator1Id);
    expect(kept.status).toBe('in_progress');
  });

  test('une demande FINALISEE ne peut pas etre supprimee (provenance preservee)', async () => {
    const c = await claimAndDraft('NCH-004', { blood_group: 'AB-' }, []);
    await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId]);
    await expect(rowsAs(aliceId, 'select public.delete_curation_request($1,$2)', [c.taskId, 'x'])).rejects.toThrow(/finalisee/i);
  });

  test('option "patient + demande" : le patient cible (et son identite) sont aussi supprimes', async () => {
    const c = await openCase('NCH-008'); // cas 'open' avec 1 document, patient NCH-008
    await rowsAs(aliceId, 'select public.delete_curation_request($1,$2,$3)', [c.taskId, 'cree par erreur', true]);

    expect((await db.admin.query('select deleted_at from public.curation_task where id=$1', [c.taskId])).rows[0].deleted_at).not.toBeNull();
    // Cascade soft_delete_patient : patient + identite marques supprimes.
    expect((await db.admin.query('select deleted_at from public.patient where id=$1', [c.patientId])).rows[0].deleted_at).not.toBeNull();
    expect((await db.admin.query("select deleted_at from public.patient_identity where base_id=$1 and patient_code='NCH-008'", [baseId])).rows[0].deleted_at).not.toBeNull();
    // Trace de suppression patient (en plus de celle de la demande).
    expect((await db.admin.query("select 1 from public.audit_log where action='patient_deleted' and entity_id=$1", [c.patientId])).rows.length).toBeGreaterThan(0);
  });
});

describe('durcissement (audit P0/P1)', () => {
  test('un brouillon FINALISE n est plus modifiable (RLS curateur inactif + trigger)', async () => {
    const c = await claimAndDraft('NCH-004', { blood_group: 'AB-' }, [
      { encounter_type: 'consultation', encounter_date: '2024-05-10', age_unit: 'years', data: { admission_date: '2024-05-01', diagnosis: 'AVC', glasgow_score: 13 } },
    ]);
    await rowsAs(curator1Id, 'select * from public.finalize_curation_task($1)', [c.taskId]);

    // Curateur affecte : tache 'completed' -> plus actif -> l'UPDATE ne touche AUCUNE ligne (RLS).
    const before = (await db.admin.query('select patient_data from public.curation_draft where id=$1', [c.draftId])).rows[0].patient_data;
    await rowsAs(curator1Id, "update public.curation_draft set patient_data='{\"hack\":1}'::jsonb where id=$1", [c.draftId]);
    const after = (await db.admin.query('select patient_data from public.curation_draft where id=$1', [c.draftId])).rows[0].patient_data;
    expect(after).toEqual(before);

    // Proprietaire (passe la RLS) : le TRIGGER refuse de modifier un brouillon finalise.
    await expect(
      rowsAs(aliceId, "update public.curation_draft set patient_data='{\"hack\":1}'::jsonb where id=$1", [c.draftId]),
    ).rejects.toThrow(/finalise/i);
  });

  test('un curateur ne modifie pas directement une soumission (transitions par RPC seulement)', async () => {
    const c = await openCase('NCH-006'); // submission 'in_curation' apres soumission
    const before = (await db.admin.query('select status from public.raw_submission where id=$1', [c.subId])).rows[0].status;
    await rowsAs(curator1Id, "update public.raw_submission set status='completed' where id=$1", [c.subId]);
    const after = (await db.admin.query('select status from public.raw_submission where id=$1', [c.subId])).rows[0].status;
    expect(after).toBe(before); // rs_update retiree -> aucune ligne touchee, inchange
  });

  test('§5.1 le curateur affecte ne CLOT pas une tache par UPDATE direct (RPC seulement)', async () => {
    const c = await openCase('NCH-002');
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [c.taskId]); // -> in_progress
    await rowsAs(curator1Id, "update public.curation_task set status='completed' where id=$1", [c.taskId]);
    // ct_update retiree : l'UPDATE direct ne touche aucune ligne -> cycle preserve.
    expect((await db.admin.query('select status from public.curation_task where id=$1', [c.taskId])).rows[0].status).toBe('in_progress');
  });

  test('§5.4 portee rencontre : le brouillon ne peut pas porter de donnees permanentes', async () => {
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 and patient_code=$2', [baseId, 'NCH-001'])).rows[0].id;
    const task = await rowsAs(aliceId, "select * from public.create_curation_submission($1,$2,$3,'encounter')", [baseId, pid, 'REF-ENCSCOPE']);
    const taskId = task[0].id as string, subId = task[0].submission_id as string;
    await db.admin.query("insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'doc',$3,'application/pdf')", [subId, baseId, `${baseId}/${subId}/d.pdf`]);
    await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
    await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]);

    // Brouillon AVEC donnees permanentes sur une portee 'encounter' -> refuse.
    await expect(
      rowsAs(curator1Id, "insert into public.curation_draft(task_id, base_id, patient_data, encounters, status) values($1,$2,$3::jsonb,'[]'::jsonb,'draft')",
        [taskId, baseId, JSON.stringify({ sexe: 'M' })]),
    ).rejects.toThrow(/[Pp]ortee rencontre/);

    // Brouillon de rencontre seule (sans donnees permanentes) -> accepte.
    const ok = await rowsAs(curator1Id,
      "insert into public.curation_draft(task_id, base_id, patient_data, encounters, status) values($1,$2,'{}'::jsonb,$3::jsonb,'draft') returning id",
      [taskId, baseId, JSON.stringify([{ encounter_type: 'suivi', encounter_date: '2024-06-01', age_unit: 'years', data: { glasgow_score: 10 } }])]);
    expect(ok[0].id).toBeTruthy();
  });

  test('§5.6 coherence inter-bases : une soumission ne peut cibler un patient d une AUTRE base', async () => {
    // Base B (admin) : meme proprietaire + version de gabarit que A.
    const baseB = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) select 'Base B', owner_user_id, current_template_version_id from public.base where id=$1 returning id",
      [baseId])).rows[0].id;
    const tv = (await db.admin.query('select current_template_version_id tv from public.base where id=$1', [baseB])).rows[0].tv;
    const pidB = (await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by) values($1,'XB-001',$2,'{}'::jsonb,'direct','draft',$3) returning id",
      [baseB, tv, aliceId])).rows[0].id;
    // Soumission de la base A ciblant le patient de la base B -> bloquee par le trigger.
    await expect(db.admin.query(
      "insert into public.raw_submission(base_id, target_patient_id, template_version_id, scope, case_code, status, submitted_by) values($1,$2,$3,'patient','XB','received',$4)",
      [baseId, pidB, tv, aliceId])).rejects.toThrow(/inter-bases/i);
  });
});

describe('audit v9 §5.4 : creation du workflow de curation par RPC seulement', () => {
  test('INSERT direct refuse : curation_task (tache fabriquee) et raw_submission', async () => {
    const c = await openCase('NCH-002'); // soumission + tache crees via RPC (definer)
    // Tache 'open' fabriquee directement (sans document) -> refus (ct_insert retiree).
    await expect(rowsAs(aliceId,
      "insert into public.curation_task(base_id, submission_id, status) values($1,$2,'open')", [baseId, c.subId]),
    ).rejects.toThrow();
    // Soumission inseree directement -> refus (rs_insert retiree).
    const tv = (await db.admin.query('select current_template_version_id v from public.base where id=$1', [baseId])).rows[0].v;
    await expect(rowsAs(aliceId,
      "insert into public.raw_submission(base_id, target_patient_id, template_version_id, scope, case_code, status, submitted_by) values($1,$2,$3,'patient','HACK-'||floor(random()*1000000)::text,'received',$4)",
      [baseId, c.patientId, tv, aliceId]),
    ).rejects.toThrow();
  });
});

describe('ecriture de brouillon gardee : resultat, permissions et concurrence', () => {
  const save = (
    uid: string,
    draftId: string,
    patientData: unknown,
    encounters: unknown,
    revision: number,
  ) => rowsAs(
    uid,
    'select * from public.save_curation_draft($1,$2::jsonb,$3::jsonb,$4)',
    [draftId, JSON.stringify(patientData), JSON.stringify(encounters), revision],
  );

  test('mise a jour autorisee, double soumission, ressource absente et aucune modification partielle', async () => {
    const c = await claimAndDraft('NCH-002', {}, []);
    const before = (await db.admin.query(
      'select patient_data, encounters, revision from public.curation_draft where id=$1',
      [c.draftId],
    )).rows[0];

    const updated = await save(curator1Id, c.draftId, { blood_group: 'A+' }, [], before.revision);
    expect(updated[0].outcome).toBe('updated');
    expect(Number(updated[0].revision)).toBe(Number(before.revision) + 1);

    const replay = await save(curator1Id, c.draftId, { blood_group: 'B+' }, [], before.revision);
    expect(replay[0].outcome).toBe('stale');
    expect((await db.admin.query('select patient_data from public.curation_draft where id=$1', [c.draftId])).rows[0].patient_data)
      .toEqual({ blood_group: 'A+' });

    const current = (await db.admin.query(
      'select patient_data, encounters, revision from public.curation_draft where id=$1',
      [c.draftId],
    )).rows[0];
    const invalid = await save(curator1Id, c.draftId, [], [{ encounter_type: 'suivi' }], current.revision);
    expect(invalid[0].outcome).toBe('invalid_input');
    const afterInvalid = (await db.admin.query(
      'select patient_data, encounters, revision from public.curation_draft where id=$1',
      [c.draftId],
    )).rows[0];
    expect(afterInvalid).toEqual(current);

    const absent = await save(
      curator1Id,
      '00000000-0000-0000-0000-000000000001',
      {},
      [],
      0,
    );
    expect(absent[0].outcome).toBe('not_found');
  });

  test('permission revoquee, reattribution et cloture sont refusees explicitement', async () => {
    const revoked = await claimAndDraft('NCH-003', {}, []);
    const revokedRevision = Number((await db.admin.query(
      'select revision from public.curation_draft where id=$1',
      [revoked.draftId],
    )).rows[0].revision);
    await db.admin.query("update public.profiles set global_role='medecin' where id=$1", [curator1Id]);
    try {
      expect((await save(curator1Id, revoked.draftId, { blood_group: 'A+' }, [], revokedRevision))[0].outcome)
        .toBe('forbidden');
    } finally {
      await db.admin.query("update public.profiles set global_role='curateur' where id=$1", [curator1Id]);
    }

    await db.admin.query('update public.curation_task set assigned_to=$2 where id=$1', [revoked.taskId, curator2Id]);
    expect((await save(curator1Id, revoked.draftId, {}, [], revokedRevision))[0].outcome).toBe('forbidden');

    const closed = await claimAndDraft('NCH-005', {}, []);
    const closedRevision = Number((await db.admin.query(
      'select revision from public.curation_draft where id=$1',
      [closed.draftId],
    )).rows[0].revision);
    await db.admin.query("update public.curation_task set status='completed' where id=$1", [closed.taskId]);
    expect((await save(curator1Id, closed.draftId, {}, [], closedRevision))[0].outcome).toBe('invalid_state');
  });

  test('deux ecritures concurrentes avec la meme revision : une seule est appliquee', async () => {
    const c = await claimAndDraft('NCH-006', {}, []);
    const revision = Number((await db.admin.query(
      'select revision from public.curation_draft where id=$1',
      [c.draftId],
    )).rows[0].revision);

    const [a, b] = await Promise.all([
      save(curator1Id, c.draftId, { blood_group: 'A+' }, [], revision),
      save(curator1Id, c.draftId, { blood_group: 'B+' }, [], revision),
    ]);
    expect([a[0].outcome, b[0].outcome].sort()).toEqual(['stale', 'updated']);
    const final = (await db.admin.query(
      'select patient_data, revision from public.curation_draft where id=$1',
      [c.draftId],
    )).rows[0];
    expect([{ blood_group: 'A+' }, { blood_group: 'B+' }]).toContainEqual(final.patient_data);
    expect(Number(final.revision)).toBe(revision + 1);
  });

  test('RPC definer : auth explicite, search_path fixe et EXECUTE limite a authenticated', async () => {
    const metadata = (await db.admin.query(
      `select p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
         from pg_proc p
        where p.oid = 'public.save_curation_draft(uuid,jsonb,jsonb,bigint)'::regprocedure`,
    )).rows[0];
    expect(metadata.prosecdef).toBe(true);
    expect(metadata.proconfig).toContain('search_path=public, pg_temp');
    expect(metadata.anon_exec).toBe(false);
    expect(metadata.authenticated_exec).toBe(true);
    const unauthenticated = (await db.admin.query(
      'select * from public.save_curation_draft($1,$2::jsonb,$3::jsonb,$4)',
      ['00000000-0000-0000-0000-000000000001', '{}', '[]', 0],
    )).rows[0];
    expect(unauthenticated.outcome).toBe('forbidden');
  });
});
