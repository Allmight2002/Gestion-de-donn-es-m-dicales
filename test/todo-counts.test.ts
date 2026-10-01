// Audit UI mobile, lot 8 : compteurs de la page « A faire » (my_todo_counts). Une seule
// lecture pour toutes les bases, sous la RLS de l'appelant ; les dossiers comptes sont ceux
// de la file « A completer » (jusqu'a 100), les questions celles qui attendent le medecin
// proprietaire.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;    // medecin proprietaire de la base du seed
let bobId: string;      // autre medecin, sans acces a cette base
let editorId: string;   // collaborateur avec droit de modification
let annaId: string;     // collaboratrice lectrice (export seul)
let curator1Id: string; // curateur global
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
type Counts = { baseId: string; incomplete: number; clarifications: number; pendingCodings: number };
const countsAs = async (uid: string): Promise<Counts[]> =>
  (await rowsAs(uid, 'select public.my_todo_counts() as c'))[0].c as Counts[];
const countsFor = async (uid: string, base = baseId) => (await countsAs(uid)).find((c) => c.baseId === base);
const queueTotalAs = async (uid: string, base = baseId): Promise<number> =>
  ((await rowsAs(uid, 'select public.base_completion_queue_page($1, 1, 0) as q', [base]))[0].q as { total: number }).total;

const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';
const CREATE_ENC = 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)';

// Cas soumis au pool puis reserve par curator1, comme dans le parcours reel.
async function claimedCase(code: string): Promise<string> {
  const p = await rowsAs(aliceId, CREATE_PAT, [baseId, code, 'Patient Fictif', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'F', birth_year: 1980 })]);
  const task = await rowsAs(aliceId, 'select * from public.create_curation_submission($1,$2,$3)', [baseId, p[0].id, 'REF-' + code]);
  const taskId = task[0].id as string;
  await db.admin.query(
    "insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type) values($1,$2,'doc',$3,'application/pdf')",
    [task[0].submission_id, baseId, `${baseId}/${task[0].submission_id}/d.pdf`],
  );
  await rowsAs(aliceId, 'select * from public.submit_curation_request($1)', [taskId]);
  await rowsAs(curator1Id, 'select * from public.claim_curation_task($1)', [taskId]);
  return taskId;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  editorId = byEmail.get('editor@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  curator1Id = byEmail.get('curator1@demo.test')!;
  baseId = (await db.admin.query('select id from public.base where owner_user_id=$1 limit 1', [aliceId])).rows[0].id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('lot 8 : compteurs « A faire » (my_todo_counts)', () => {
  test('proprietaire : autant de dossiers incomplets que la file, et rien d autre que des nombres', async () => {
    const p = await rowsAs(aliceId, CREATE_PAT, [baseId, 'TODO-001', 'Todo Fictif', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);
    await rowsAs(aliceId, CREATE_ENC, [p[0].id, 'consultation', '2024-05-01', 'draft', JSON.stringify({}), 'years']);

    const mine = await countsFor(aliceId);
    expect(mine).toBeDefined();
    expect(Object.keys(mine!).sort()).toEqual(['baseId', 'clarifications', 'incomplete', 'pendingCodings']);
    expect(mine!.incomplete).toBeGreaterThanOrEqual(2);
    expect(mine!.incomplete).toBe(await queueTotalAs(aliceId));
  });

  test('question du curateur : comptee pour le seul proprietaire, retiree par sa reponse', async () => {
    const before = (await countsFor(aliceId))?.clarifications ?? 0;
    const taskId = await claimedCase('TODO-CLAR');
    const clar = await rowsAs(curator1Id, 'select * from public.request_clarification($1,$2)', [taskId, 'Question fictive ?']);

    expect((await countsFor(aliceId))!.clarifications).toBe(before + 1);
    // Le collaborateur complete les dossiers, mais ne repond pas au curateur.
    expect((await countsFor(editorId))!.clarifications).toBe(0);
    // Le curateur affecte lit la tache (RLS), mais n'a rien a faire dans cette base.
    expect(await countsAs(curator1Id)).toEqual([]);

    await rowsAs(aliceId, 'select * from public.answer_clarification($1,$2)', [clar[0].id, 'Reponse fictive']);
    expect((await countsFor(aliceId))?.clarifications ?? 0).toBe(before);
  });

  test('editeur : les dossiers de la base ; lectrice et tiers : rien', async () => {
    const editor = await countsFor(editorId);
    expect(editor!.incomplete).toBe(await queueTotalAs(editorId));
    expect(await countsAs(annaId)).toEqual([]);
    expect(await countsAs(bobId)).toEqual([]);
  });

  test('acces revoque : la base disparait, et revient avec le droit', async () => {
    await db.admin.query('update public.base_access set revoked_at = now() where base_id=$1 and user_id=$2', [baseId, editorId]);
    try {
      expect(await countsAs(editorId)).toEqual([]);
    } finally {
      await db.admin.query('update public.base_access set revoked_at = null where base_id=$1 and user_id=$2', [baseId, editorId]);
    }
    expect(await countsFor(editorId)).toBeDefined();
  });

  test('une base sans rien a faire est omise ; elle apparait des qu un dossier manque', async () => {
    const version = (await db.admin.query('select current_template_version_id v from public.base where id=$1', [baseId])).rows[0].v;
    const empty = (await db.admin.query(
      "insert into public.base (name, specialty, owner_user_id, current_template_version_id) values ('Base vide fictive', null, $1, $2) returning id",
      [bobId, version],
    )).rows[0].id as string;
    expect(await countsAs(bobId)).toEqual([]);

    await rowsAs(bobId, CREATE_PAT, [empty, 'TODO-BOB', 'Bob Fictif', '1990-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);
    expect(await countsAs(bobId)).toEqual([{ baseId: empty, incomplete: 1, clarifications: 0, pendingCodings: 0 }]);
    // Le cloisonnement tient dans les deux sens : Alice ne voit pas la base de Bob.
    expect((await countsAs(aliceId)).some((c) => c.baseId === empty)).toBe(false);
  });

  test('au-dela de 100 dossiers, le compte s arrete a 100 ; la file garde le compte exact', async () => {
    const version = (await db.admin.query('select current_template_version_id v from public.base where id=$1', [baseId])).rows[0].v;
    const large = (await db.admin.query(
      "insert into public.base (name, specialty, owner_user_id, current_template_version_id) values ('Base volumineuse fictive', null, $1, $2) returning id",
      [bobId, version],
    )).rows[0].id as string;
    await db.admin.query(`
      insert into public.patient (base_id, patient_code, template_version_id, data, validation_status, created_by)
      select $1::uuid, 'TODO-MASSE-' || g, $2::uuid, '{"sexe":"F"}'::jsonb, 'draft', $3::uuid
      from generate_series(1, 150) g`, [large, version, bobId]);

    expect(await countsFor(bobId, large)).toEqual({ baseId: large, incomplete: 100, clarifications: 0, pendingCodings: 0 });
    expect(await queueTotalAs(bobId, large)).toBe(150);
  });

  test('lecture sous les droits de l appelant : INVOKER, fermee a anon, ouverte a authenticated', async () => {
    const acl = (await db.admin.query(`
      select p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'my_todo_counts'`)).rows;
    expect(acl).toEqual([{ prosecdef: false, anon: false, authenticated: true }]);
  });
});
