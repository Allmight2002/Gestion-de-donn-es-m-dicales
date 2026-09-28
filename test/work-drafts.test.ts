import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db';

let db: TestDb;
let owner: string;
let other: string;
let base: string;
let version: string;
const as = (uid: string, sql: string, args: unknown[] = []) => db.asUser(uid, async (c) => (await c.query(sql, args)).rows);
const saveSql = 'select public.save_work_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as result';
const commitSql = 'select public.commit_work_draft($1,$2,$3,$4::jsonb) as result';
const payload = (code = 'UX-TEST') => ({ code, values: { sexe: 'M', birth_year: 1980 } });
const save = async (id: string, expected = 0, data = payload(), op = randomUUID(), uid = owner,
  kind = 'patient_create', target: string | null = null, entityRevision: string | null = null) =>
  (await as(uid, saveSql, [id, base, kind, target, version, entityRevision, expected, op, JSON.stringify(data)]))[0].result;
const commit = async (id: string, revision: number, op = randomUUID(), identity: object | null = null, uid = owner) =>
  (await as(uid, commitSql, [id, revision, op, identity === null ? null : JSON.stringify(identity)]))[0].result;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  owner = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  other = (await db.admin.query("select id from auth.users where email='bob@demo.test'")).rows[0].id;
  const row = (await db.admin.query('select id, current_template_version_id from public.base where owner_user_id=$1 limit 1', [owner])).rows[0];
  base = row.id;
  version = row.current_template_version_id;
}, 180_000);
afterAll(async () => { await db?.stop(); });

describe('UX-2 brouillons analytiques privés et transactions', () => {
  test('isole les auteurs et interdit les accès directs et anonymes', async () => {
    const id = randomUUID();
    await save(id);
    await expect(save(id, 1, payload(), randomUUID(), other)).rejects.toThrow('DRAFT_FORBIDDEN');
    await expect(as(owner, 'select * from public.work_draft')).rejects.toThrow('permission denied');
    await expect(as(owner, 'update public.work_draft set owner_id=$1 where id=$2', [other, id])).rejects.toThrow('permission denied');
    const anon = await db.admin.query("select has_function_privilege('anon', 'public.save_work_draft(uuid,uuid,text,uuid,uuid,text,bigint,uuid,jsonb)', 'EXECUTE') as allowed");
    expect(anon.rows[0].allowed).toBe(false);
    const listed = (await as(owner, 'select public.list_work_drafts($1,$2,null) as result', [base, 'patient_create']))[0].result;
    expect(listed.some((d: { id: string }) => d.id === id)).toBe(true);
  });

  test('refuse identité, clé hors dictionnaire et quota de taille sans écriture', async () => {
    const id = randomUUID();
    await expect(save(id, 0, { ...payload(), fullName: 'Identité fictive' } as ReturnType<typeof payload>)).rejects.toThrow('DRAFT_INVALID');
    await expect(save(id, 0, { code: 'X', values: { fullName: 'Identité fictive' } } as unknown as ReturnType<typeof payload>)).rejects.toThrow('DRAFT_INVALID');
    await expect(save(id, 0, { ...payload(), code: 'X'.repeat(262145) })).rejects.toThrow('DRAFT_INVALID');
    expect((await db.admin.query('select id from public.work_draft where id=$1', [id])).rows).toHaveLength(0);
  });

  test('révision attendue, rejeu exact et clé réutilisée avec autre contenu', async () => {
    const id = randomUUID(); const op = randomUUID();
    const first = await save(id, 0, payload(), op);
    expect(await save(id, 0, payload(), op)).toEqual(first);
    expect(first.revision).toBe(1);
    await expect(save(id, 0)).rejects.toThrow('DRAFT_CONFLICT');
    await expect(save(id, 0, payload('ALTERED'), op)).rejects.toThrow('DRAFT_OPERATION_CONFLICT');
    const next = await save(id, 1, payload('NEXT'));
    expect(next.revision).toBe(2);
    expect(next.expires_at).toBe(first.expires_at);
  });

  test('deux onglets concurrents : un gagnant, un conflit et aucune perte', async () => {
    const id = randomUUID();
    await save(id);
    const outcomes = await Promise.allSettled([save(id, 1, payload('LEFT')), save(id, 1, payload('RIGHT'))]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const row = (await db.admin.query('select revision,payload from public.work_draft where id=$1', [id])).rows[0];
    expect(Number(row.revision)).toBe(2);
    expect(['LEFT', 'RIGHT']).toContain(row.payload.code);
  });

  test('commit et réponse perdue : une fiche, accusé identique, valeurs purgées', async () => {
    const id = randomUUID(); const op = randomUUID();
    await save(id, 0, payload('UX-COMMITTED'));
    const identity = { fullName: 'Identité fictive UX', dateOfBirth: '1980-01-01' };
    const result = await commit(id, 1, op, identity);
    expect(await commit(id, 1, op, identity)).toEqual(result);
    expect((await db.admin.query("select id from public.patient where base_id=$1 and patient_code='P-0001'", [base])).rows).toHaveLength(1);
    expect((await db.admin.query("select id from public.patient where base_id=$1 and patient_code='UX-COMMITTED'", [base])).rows).toHaveLength(0);
    const draft = (await db.admin.query('select state,payload from public.work_draft where id=$1', [id])).rows[0];
    expect(draft).toEqual({ state: 'consumed', payload: {} });
    expect(JSON.stringify((await db.admin.query('select * from public.work_draft_operation where draft_id=$1', [id])).rows)).not.toContain('Identité fictive UX');
    await expect(save(id, 1)).rejects.toThrow('DRAFT_CLOSED');
    await expect(commit(id, 1, op, { fullName: 'Autre' })).rejects.toThrow('DRAFT_OPERATION_CONFLICT');
  });

  test('un refus métier ne consomme rien, ne crée ni patient ni identité', async () => {
    const id = randomUUID();
    await save(id, 0, { code: 'UX-INVALID', values: { sexe: 'INVALID', birth_year: 1980 } });
    await expect(commit(id, 1)).rejects.toThrow('DRAFT_VALIDATION');
    expect((await db.admin.query('select state from public.work_draft where id=$1', [id])).rows[0].state).toBe('active');
    expect((await db.admin.query("select id from public.patient where patient_code='UX-INVALID'")).rows).toHaveLength(0);
    expect((await db.admin.query("select id from public.patient_identity where patient_code='UX-INVALID'")).rows).toHaveLength(0);
    expect((await db.admin.query('select * from public.work_draft_operation where draft_id=$1', [id])).rows).toHaveLength(1);
  });

  test('suppression idempotente et expiration ne ressuscitent pas une saisie', async () => {
    const id = randomUUID(); const op = randomUUID();
    await save(id);
    const args = [id, 1, op];
    const deleted = await as(owner, 'select public.delete_work_draft($1,$2,$3) as result', args);
    expect(await as(owner, 'select public.delete_work_draft($1,$2,$3) as result', args)).toEqual(deleted);
    await expect(save(id)).rejects.toThrow('DRAFT_CLOSED');
    const expired = randomUUID();
    await save(expired);
    await db.admin.query("update public.work_draft set expires_at=now()-interval '1 second' where id=$1", [expired]);
    await expect(commit(expired, 1)).rejects.toThrow('DRAFT_CLOSED');
    await as(owner, 'select public.list_work_drafts($1,$2,null)', [base, 'patient_create']);
    expect((await db.admin.query('select state,payload from public.work_draft where id=$1', [expired])).rows[0]).toEqual({ state: 'expired', payload: {} });
    await expect(save(expired)).rejects.toThrow('DRAFT_CLOSED');
  });

  test('une correction concurrente conserve la fiche gagnante et le brouillon perdant', async () => {
    const id = randomUUID();
    await save(id, 0, payload('UX-EDIT'));
    const created = await commit(id, 1);
    const editId = randomUUID();
    await save(editId, 0, payload('UX-EDIT'), randomUUID(), owner, 'patient_update', created.id, String(created.version));
    await as(owner, 'select public.update_patient($1,$2::jsonb,$3,$4,$5)', [created.id,
      JSON.stringify({ sexe: 'F', birth_year: 1980 }), 'draft', 'Correction fictive', created.version]);
    await expect(commit(editId, 1)).rejects.toThrow('DRAFT_CONTEXT_CHANGED');
    expect((await db.admin.query('select data from public.patient where id=$1', [created.id])).rows[0].data.sexe).toBe('F');
    expect((await db.admin.query('select state,payload from public.work_draft where id=$1', [editId])).rows[0].payload.values.sexe).toBe('M');
  });
});

// Audit UI mobile, lot 8 : la page « A faire » retrouve ses brouillons sans en connaitre la cible.
describe('lot 8 : brouillons a reprendre (list_my_work_drafts)', () => {
  type Listed = { id: string; baseId: string; kind: string; targetId: string | null; patientId: string | null;
    patientCode: string | null; updatedAt: string; expiresAt: string };
  const mine = async (uid = owner) => (await as(uid, 'select public.list_my_work_drafts() as result'))[0].result as Listed[];
  const editor = async () => (await db.admin.query("select id from auth.users where email='editor@demo.test'")).rows[0].id as string;

  test('ses brouillons actifs seulement, en metadonnees, avec le code patient pour naviguer', async () => {
    const creation = randomUUID();
    await save(creation, 0, payload('UX-TODO-SECRET'));
    const seed = randomUUID();
    await save(seed, 0, payload('UX-TODO-P'));
    const created = await commit(seed, 1);
    const code = (await db.admin.query('select patient_code from public.patient where id=$1', [created.id])).rows[0].patient_code;
    const update = randomUUID();
    await save(update, 0, payload('UX-TODO-P'), randomUUID(), owner, 'patient_update', created.id, String(created.version));

    const listed = await mine();
    const byId = new Map(listed.map((draft) => [draft.id, draft]));
    expect(byId.get(creation)).toMatchObject({ baseId: base, kind: 'patient_create', targetId: null, patientId: null, patientCode: null });
    expect(byId.get(update)).toMatchObject({ baseId: base, kind: 'patient_update', targetId: created.id, patientId: created.id, patientCode: code });
    // Le brouillon consomme par l'enregistrement n'est plus a reprendre.
    expect(byId.has(seed)).toBe(false);
    // Jamais les reponses : ni valeurs, ni code propose par la saisie, ni proprietaire.
    expect(JSON.stringify(listed)).not.toContain('UX-TODO-SECRET');
    expect(Object.keys(byId.get(creation)!).sort()).toEqual(['baseId', 'expiresAt', 'id', 'kind', 'patientCode', 'patientId', 'targetId', 'updatedAt']);
    // Un autre medecin ne voit rien des brouillons d'Alice.
    expect((await mine(other)).some((draft) => draft.id === creation || draft.id === update)).toBe(false);
  });

  test('expire, supprime : omis ; lecture pure, sans purge ni ecriture', async () => {
    const expired = randomUUID();
    await save(expired);
    await db.admin.query("update public.work_draft set expires_at=now()-interval '1 second' where id=$1", [expired]);
    const deleted = randomUUID();
    await save(deleted);
    await as(owner, 'select public.delete_work_draft($1,$2,$3)', [deleted, 1, randomUUID()]);
    const ids = (await mine()).map((draft) => draft.id);
    expect(ids).not.toContain(expired);
    expect(ids).not.toContain(deleted);
    // Contrairement a list_work_drafts, la lecture ne marque rien comme expire.
    expect((await db.admin.query('select state from public.work_draft where id=$1', [expired])).rows[0].state).toBe('active');
  });

  test('droits retires : le brouillon est omis, sans etre purge, et revient avec les droits', async () => {
    const uid = await editor();
    const id = randomUUID();
    await save(id, 0, payload('UX-TODO-EDITOR'), randomUUID(), uid);
    expect((await mine(uid)).some((draft) => draft.id === id)).toBe(true);
    await db.admin.query('update public.base_access set revoked_at=now() where base_id=$1 and user_id=$2', [base, uid]);
    try {
      expect((await mine(uid)).some((draft) => draft.id === id)).toBe(false);
      const row = (await db.admin.query('select state, payload from public.work_draft where id=$1', [id])).rows[0];
      expect(row.state).toBe('active');
      expect(row.payload.code).toBe('UX-TODO-EDITOR');
    } finally {
      await db.admin.query('update public.base_access set revoked_at=null where base_id=$1 and user_id=$2', [base, uid]);
    }
    expect((await mine(uid)).some((draft) => draft.id === id)).toBe(true);
  });

  test('session requise ; execution refusee a anon, accordee a authenticated', async () => {
    await expect(db.asUser(null as unknown as string, (c) => c.query('select public.list_my_work_drafts()'))).rejects.toThrow('Authentification requise');
    const privilege = async (role: string) => (await db.admin.query(
      "select has_function_privilege($1, 'public.list_my_work_drafts()', 'EXECUTE') as allowed", [role])).rows[0].allowed;
    expect(await privilege('anon')).toBe(false);
    expect(await privilege('authenticated')).toBe(true);
  });
});

