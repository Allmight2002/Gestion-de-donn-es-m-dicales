// Tests DB de l'audit renforce (§14) : trace automatique des actions sensibles dans
// audit_log + lecture ciblee (proprietaire/auteur ; jamais un tiers).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;  // proprietaire
let annaId: string;   // analyste (can_export_data)
let bobId: string;    // membre sans acces (devient collaborateur)
let adminId: string;  // system_admin : ni proprietaire, ni acces base, ni staff curation
let baseId: string;
let cohortId: string;
let tvId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const EXPORT_INSERT = `insert into public.export_log(cohort_id, template_versions, exported_by, format, export_options, patient_count, encounter_count, stored_file_path, file_hash)
  values($1, to_jsonb(array[$2::uuid]), auth.uid(), 'csv', '{}'::jsonb, 1, 1, 'p/x.csv', 'h1') returning id`;
const CREATE_PAT = 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)';

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  adminId = byEmail.get('admin@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
  cohortId = (await db.admin.query("select id from public.cohort where cohort_type='snapshot' limit 1")).rows[0].id;
  tvId = (await db.admin.query('select current_template_version_id tv from public.base where id=$1', [baseId])).rows[0].tv;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('trace automatique des actions sensibles', () => {
  test('un export genere une trace export_created', async () => {
    const ex = await rowsAs(annaId, EXPORT_INSERT, [cohortId, tvId]);
    const exportId = ex[0].id;
    const audit = await db.admin.query("select user_id, base_id from public.audit_log where action='export_created' and entity_id=$1", [exportId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].user_id).toBe(annaId);
    expect(audit.rows[0].base_id).toBe(baseId);
  });

  test('accorder un acces genere une trace access_granted', async () => {
    await rowsAs(aliceId, `select * from public.create_base_invitation(
      $1,'bob@demo.test','viewer',false,false,false,false,false, encode(digest('tok-audit-access','sha256'),'hex'), now() + interval '1 day'
    )`, [baseId]);
    await rowsAs(bobId, 'select * from public.accept_invitation($1)', ['tok-audit-access']);
    const audit = await db.admin.query("select user_id from public.audit_log where action='access_granted' and base_id=$1 and (metadata->>'user_id')=$2", [baseId, bobId]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0].user_id).toBe(bobId);
  });

  test('une suppression logique genere une trace patient_deleted', async () => {
    const p = await rowsAs(aliceId, CREATE_PAT, [baseId, 'AUD-001', 'A Suppr', '1980-01-01', null, null, null, JSON.stringify({ sexe: 'M' })]);
    await rowsAs(aliceId, 'select public.soft_delete_patient($1,$2)', [p[0].id, 'doublon']);
    const audit = await db.admin.query("select action, metadata from public.audit_log where action='patient_deleted' and entity_id=$1", [p[0].id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.reason).toBe('doublon');
  });
});

describe('lecture ciblee de l audit (RLS)', () => {
  test('le proprietaire lit l audit de sa base ; un analyste ne voit pas la trace d un tiers', async () => {
    // Trace d'octroi d'acces : visible par le proprietaire...
    expect((await rowsAs(aliceId, "select id from public.audit_log where action='access_granted' and base_id=$1", [baseId])).length).toBeGreaterThan(0);
    // ...mais PAS par l'analyste (ni auteur, ni proprietaire).
    expect(await rowsAs(annaId, "select id from public.audit_log where action='access_granted' and base_id=$1", [baseId])).toHaveLength(0);
  });
});

describe('tracage des LECTURES sensibles (§7.1, §5.5 RPC specialisees)', () => {
  test('proprietaire trace ; compte sans acces ignore en silence ; trace lisible par le proprietaire seul', async () => {
    const pid = (await db.admin.query('select id from public.patient where base_id=$1 limit 1', [baseId])).rows[0].id;

    const beforeRpc = Number((await db.admin.query("select count(*)::int n from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2", [pid, aliceId])).rows[0].n);
    const ident = await rowsAs(aliceId, 'select * from public.get_patient_identity($1)', [pid]);
    expect(ident).toHaveLength(1);
    expect(Number((await db.admin.query("select count(*)::int n from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2", [pid, aliceId])).rows[0].n)).toBe(beforeRpc + 1);
    expect(await rowsAs(aliceId, 'select * from public.patient_identity where id is not null')).toHaveLength(0);

    // Proprietaire (acces identite) : la lecture d'identite est tracee (base + autz derivees serveur).
    await rowsAs(aliceId, 'select public.log_identity_read($1)', [pid]);
    expect((await db.admin.query("select 1 from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2", [pid, aliceId])).rows.length).toBeGreaterThan(0);

    // Compte sans acces identite (admin systeme) -> ignore SILENCIEUSEMENT (aucune trace inseree).
    await rowsAs(adminId, 'select public.log_identity_read($1)', [pid]);
    expect((await db.admin.query("select 1 from public.audit_log where action='identity_read' and entity_id=$1 and user_id=$2", [pid, adminId])).rows).toHaveLength(0);

    // La trace est lisible par le proprietaire, pas par un tiers (analyste).
    expect((await rowsAs(aliceId, "select id from public.audit_log where action='identity_read' and entity_id=$1", [pid])).length).toBeGreaterThan(0);
    expect(await rowsAs(annaId, "select id from public.audit_log where action='identity_read' and entity_id=$1", [pid])).toHaveLength(0);
  });
});

describe('E1 base_identity_audit (« qui accede a mes bases »)', () => {
  test('le proprietaire voit qui a consulte quel patient (30 j) ; un tiers est refuse', async () => {
    const p = (await db.admin.query('select id, patient_code from public.patient where base_id=$1 limit 1', [baseId])).rows[0];
    // Alice (proprietaire, acces identite) consulte une identite -> trace 'identity_read'.
    await rowsAs(aliceId, 'select * from public.get_patient_identity($1)', [p.id]);

    const overview = (await rowsAs(aliceId, 'select public.base_identity_audit($1) as a', [baseId]))[0].a as {
      byReader: { readerName: string; count: number }[];
      reads: { readerName: string; patientCode: string | null }[];
    };
    expect(overview.reads.length).toBeGreaterThan(0);
    expect(overview.byReader.length).toBeGreaterThan(0);
    // Le code patient (pseudonyme) est resolu cote serveur (SECURITY DEFINER).
    expect(overview.reads.some((r) => r.patientCode === p.patient_code)).toBe(true);

    // Un compte SANS gestion ni propriete (analyste) est refuse.
    await expect(rowsAs(annaId, 'select public.base_identity_audit($1) as a', [baseId])).rejects.toThrow(/refus|denied|acces/i);

    // Meme un gestionnaire d'acces non proprietaire ne voit pas ce journal sensible.
    await db.admin.query(
      `insert into public.base_access(base_id,user_id,access_role,can_manage_access,granted_by)
       values($1,$2,'viewer',true,$3)
       on conflict (base_id,user_id) do update set can_manage_access=true, revoked_at=null`,
      [baseId, bobId, aliceId],
    );
    await expect(rowsAs(bobId, 'select public.base_identity_audit($1) as a', [baseId])).rejects.toThrow(/refus|denied|acces/i);
  });
});
