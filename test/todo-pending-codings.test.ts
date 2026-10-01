// Codage CIM-11 assiste : diagnostics en attente dans « A faire » (20261001200000).
//
// Une entree `terminology` est en attente quand elle est non codee (`unmatched`) ou proposee
// sans confirmation (`suggested`). Le compte (`my_todo_counts.pendingCodings`) et la liste
// (`list_pending_codings`) suivent la RLS de l'appelant et le perimetre de la file
// « A completer ». Donnees fictives.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;  // medecin proprietaire de la base du seed
let bobId: string;    // autre medecin, sans acces a cette base
let editorId: string; // collaborateur avec droit de modification
let annaId: string;   // collaboratrice lectrice (export seul)
let baseId: string;
let versionId: string;

type Counts = { baseId: string; incomplete: number; clarifications: number; pendingCodings: number };
type Item = {
  patientId: string; patientCode: string; encounterId: string | null; encounterType: string | null;
  encounterDate: string | null; fieldKey: string; fieldLabel: string; position: number | null;
  raw: string | null; proposedLabel: string | null; status: string; updatedAt: string;
};
type Page = { items: Item[]; hasMore: boolean };

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);
const countsAs = async (uid: string): Promise<Counts[]> =>
  (await rowsAs(uid, 'select public.my_todo_counts() as c'))[0].c as Counts[];
const countsFor = async (uid: string, base = baseId) => (await countsAs(uid)).find((c) => c.baseId === base);
const listAs = async (uid: string, base = baseId, limit?: number): Promise<Page> =>
  (await rowsAs(uid, limit === undefined
    ? 'select public.list_pending_codings($1) as l'
    : 'select public.list_pending_codings($1, $2) as l', limit === undefined ? [base] : [base, limit]))[0].l as Page;

const HSD = { code: 'FIC.02', label: 'Hémorragie sousdurale non traumatique' };
const HIC = { code: 'FIC.00', label: 'Hémorragie intracérébrale' };
const coded = (status: string, concept = HSD, raw = 'HSD chronique fictif') =>
  ({ ...concept, raw, coding: { method: 'ai_assisted', status, normalized: raw, language: 'fr' } });
const nonCoded = (raw: string, method = 'ai_assisted') => ({ raw, coding: { method, status: 'unmatched' } });

async function patient(code: string, data: Record<string, unknown>, opts: { status?: string; updatedAt?: string; deleted?: boolean; base?: string } = {}) {
  return (await db.admin.query(
    `insert into public.patient (base_id, patient_code, template_version_id, data, validation_status, created_by, updated_at, deleted_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, case when $8 then now() end) returning id`,
    [opts.base ?? baseId, code, versionId, JSON.stringify(data), opts.status ?? 'draft', aliceId,
      opts.updatedAt ?? '2026-09-01T08:00:00Z', opts.deleted ?? false],
  )).rows[0].id as string;
}

async function encounter(patientId: string, type: string, data: Record<string, unknown>, opts: { updatedAt?: string; deleted?: boolean } = {}) {
  return (await db.admin.query(
    `insert into public.encounter (patient_id, template_version_id, encounter_type, encounter_date, data, validation_status, created_by, updated_at, deleted_at)
     values ($1, $2, $3, '2026-08-15', $4::jsonb, 'draft', $5, $6::timestamptz, case when $7 then now() end) returning id`,
    [patientId, versionId, type, JSON.stringify(data), aliceId, opts.updatedAt ?? '2026-09-01T08:00:00Z', opts.deleted ?? false],
  )).rows[0].id as string;
}

let complete: Record<string, unknown>;
let p1: string; let p2: string; let pEnc: string; let e1: string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  bobId = byEmail.get('bob@demo.test')!;
  editorId = byEmail.get('editor@demo.test')!;
  annaId = byEmail.get('anna.analyst@demo.test')!;
  const base = (await db.admin.query(
    'select id, current_template_version_id from public.base where owner_user_id=$1 order by created_at limit 1', [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.current_template_version_id;

  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, is_multiple, required, display_order, encounter_types)
     values
       ($1, 'diag_patient', 'Diagnostic principal', 'patient', 'clinique', 'terminology', false, false, 1950, null),
       ($1, 'diag_liste', 'Diagnostics associes', 'encounter', 'clinique', 'terminology', true, false, 1951, null),
       ($1, 'diag_hospit', 'Diagnostic de sortie', 'encounter', 'clinique', 'terminology', false, false, 1952, array['hospitalisation'])`,
    [versionId],
  );
  complete = (await db.admin.query(
    `select coalesce(jsonb_object_agg(field_key, case when jsonb_typeof(allowed_values) = 'array' and jsonb_array_length(allowed_values) > 0
       then allowed_values -> 0 when type in ('number', 'integer') then to_jsonb(coalesce(min_value, max_value, 1))
       when cardinality(missing_reasons) > 0
       then jsonb_build_object('__missing__', missing_reasons[1]) else '"x"'::jsonb end), '{}'::jsonb) d
      from public.template_field
      where template_version_id = $1 and scope = 'patient' and required and formula is null`, [versionId],
  )).rows[0].d as Record<string, unknown>;
  // Un texte en attente n'est compte qu'a travers une variable `terminology`.
  expect((await countsFor(aliceId))?.pendingCodings ?? 0).toBe(0);

  p1 = await patient('PEND-001', { diag_patient: nonCoded('Syndrome fictif rare', 'lexical') }, { updatedAt: '2026-09-10T08:00:00Z' });
  // Identite fictive rattachee a la fiche : elle ne doit jamais ressortir de la liste.
  await db.admin.query(
    "insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth) values ($1, 'PEND-001', 'Sentinelle Fictive', '1970-01-01')",
    [baseId],
  );
  p2 = await patient('PEND-002', { diag_patient: coded('suggested') }, { updatedAt: '2026-09-05T08:00:00Z' });
  for (const [code, status] of [['PEND-AUTO', 'automatic'], ['PEND-CONF', 'confirmed'], ['PEND-MODIF', 'manually_modified']]) {
    await patient(code, { diag_patient: coded(status) });
  }
  await patient('PEND-DIRECT', { diag_patient: HSD });
  await patient('PEND-MANQUE', { diag_patient: { __missing__: 'inconnu' } });
  // Hors perimetre : texte en attente dans une fiche supprimee ou finalisee.
  await patient('PEND-SUPPR', { diag_patient: nonCoded('Texte fictif supprime') }, { deleted: true });
  await patient('PEND-CURE', { ...complete, diag_patient: nonCoded('Texte fictif finalise') }, { status: 'curated' });

  pEnc = await patient('PEND-ENC', {});
  e1 = await encounter(pEnc, 'consultation', {
    diag_liste: [coded('automatic', HIC), nonCoded('Douleur fictive atypique'), coded('suggested'), coded('confirmed', HIC, 'autre')],
  }, { updatedAt: '2026-09-20T08:00:00Z' });
  // Variable reservee aux hospitalisations : sans objet pour une consultation.
  await encounter(pEnc, 'consultation', { diag_hospit: nonCoded('Hors type fictif') });
  await encounter(pEnc, 'consultation', { diag_liste: [nonCoded('Rencontre supprimee fictive')] }, { deleted: true });
  // Une variable d'un autre type ne compte jamais, meme avec une forme de texte non code.
  await encounter(pEnc, 'consultation', { ct_result: nonCoded('Pas une variable terminology') });
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('my_todo_counts : diagnostics en attente', () => {
  test('compte chaque entree unmatched ou suggested, valeur unique ou liste', async () => {
    const mine = await countsFor(aliceId);
    expect(mine).toBeDefined();
    expect(Object.keys(mine!).sort()).toEqual(['baseId', 'clarifications', 'incomplete', 'pendingCodings']);
    // p1 (unmatched) + p2 (suggested) + e1 (unmatched + suggested dans la liste).
    expect(mine!.pendingCodings).toBe(4);
  });

  test('editeur : meme compte ; lectrice et tiers : rien', async () => {
    expect((await countsFor(editorId))!.pendingCodings).toBe(4);
    expect(await countsFor(annaId)).toBeUndefined();
    expect(await countsFor(bobId)).toBeUndefined();
  });

  test('une base apparait des qu un diagnostic attend, meme sans autre tache ; plafond a 100', async () => {
    const own = (await db.admin.query(
      "insert into public.base (name, specialty, owner_user_id, current_template_version_id) values ('Base codage fictive', null, $1, $2) returning id",
      [bobId, versionId],
    )).rows[0].id as string;
    expect(await countsAs(bobId)).toEqual([]);

    // Fiche complete (toutes les variables obligatoires renseignees) : seul le diagnostic attend.
    await patient('PEND-BOB', { ...complete, diag_patient: nonCoded('Texte fictif de Bob') }, { base: own });
    expect(await countsAs(bobId)).toEqual([{ baseId: own, incomplete: 0, clarifications: 0, pendingCodings: 1 }]);
    expect((await countsAs(aliceId)).some((c) => c.baseId === own)).toBe(false);

    await db.admin.query(`
      insert into public.patient (base_id, patient_code, template_version_id, data, validation_status, created_by)
      select $1::uuid, 'PEND-MASSE-' || g, $2::uuid, $3::jsonb, 'draft', $4::uuid
      from generate_series(1, 150) g`,
    [own, versionId, JSON.stringify({ ...complete, diag_patient: nonCoded('Texte fictif en masse') }), bobId]);
    expect((await countsFor(bobId, own))!.pendingCodings).toBe(100);

    // La liste borne sa limite a 200 et dit s'il en reste.
    const all = await listAs(bobId, own, 500);
    expect(all.items).toHaveLength(151);
    expect(all.hasMore).toBe(false);
    const first = await listAs(bobId, own, 20);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
  });
});

describe('list_pending_codings', () => {
  test('liste les entrees en attente, la plus recente d abord, sans donnee d identite', async () => {
    const page = await listAs(aliceId);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((i) => [i.patientCode, i.encounterId, i.fieldKey, i.position, i.status])).toEqual([
      ['PEND-ENC', e1, 'diag_liste', 1, 'unmatched'],
      ['PEND-ENC', e1, 'diag_liste', 2, 'suggested'],
      ['PEND-001', null, 'diag_patient', null, 'unmatched'],
      ['PEND-002', null, 'diag_patient', null, 'suggested'],
    ]);
    const [enc, , unmatched, suggested] = page.items;
    expect(Object.keys(enc).sort()).toEqual([
      'encounterDate', 'encounterId', 'encounterType', 'fieldKey', 'fieldLabel', 'patientCode', 'patientId',
      'position', 'proposedLabel', 'raw', 'status', 'updatedAt',
    ]);
    expect(enc).toMatchObject({
      patientId: pEnc, encounterType: 'consultation', encounterDate: '2026-08-15',
      fieldLabel: 'Diagnostics associes', raw: 'Douleur fictive atypique', proposedLabel: null,
    });
    expect(unmatched).toMatchObject({ patientId: p1, raw: 'Syndrome fictif rare', fieldLabel: 'Diagnostic principal' });
    expect(suggested).toMatchObject({ patientId: p2, raw: 'HSD chronique fictif', proposedLabel: HSD.label });
    // Aucune colonne d'identite n'est lue.
    expect(JSON.stringify(page)).not.toMatch(/Sentinelle|1970-01-01/);

    expect((await listAs(editorId)).items).toHaveLength(4);
    const limited = await listAs(aliceId, baseId, 1);
    expect(limited).toEqual({ items: [page.items[0]], hasMore: true });
  });

  test('refusee hors droit de modification, sans dire si la base existe', async () => {
    for (const uid of [annaId, bobId]) {
      await expect(listAs(uid)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(listAs(aliceId, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ code: '42501' });
  });

  test('une entree confirmee sort de la liste et du compte', async () => {
    await db.admin.query(
      `update public.patient set data = jsonb_set(data, '{diag_patient}', $2::jsonb) where id = $1`,
      [p2, JSON.stringify(coded('confirmed'))],
    );
    expect((await countsFor(aliceId))!.pendingCodings).toBe(3);
    expect((await listAs(aliceId)).items.some((i) => i.patientId === p2)).toBe(false);
  });

  test('INVOKER, fermees a anon, ouvertes a authenticated', async () => {
    const acl = (await db.admin.query(`
      select p.proname, p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('my_todo_counts', 'list_pending_codings')
       order by p.proname`)).rows;
    expect(acl).toEqual([
      { proname: 'list_pending_codings', prosecdef: false, anon: false, authenticated: true },
      { proname: 'my_todo_counts', prosecdef: false, anon: false, authenticated: true },
    ]);
  });
});
