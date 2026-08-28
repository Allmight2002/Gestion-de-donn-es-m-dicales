// L12 : les propositions hors liste sont lues par le seul proprietaire, groupees
// par le front a partir d'occurrences source (patient ou rencontre).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let annaId: string;
let bobId: string;
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  annaId = users.get('anna.analyst@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  baseId = (await db.admin.query('select id from public.base where owner_user_id = $1', [aliceId])).rows[0].id;
  const version = (await db.admin.query(
    `select tv.id, tv.template_id
       from public.template_version tv
       join public.base b on b.current_template_version_id = tv.id
      where b.id = $1`,
    [baseId],
  )).rows[0];

  await db.admin.query(
    `insert into public.template_field
      (template_version_id, field_key, label, scope, section, type, required, allow_missing_codes, display_order)
     values
      ($1, 'sexe_autre', 'Sexe — valeur proposée', 'patient', 'clinique', 'text', false, false, 101),
      ($1, 'blood_group_autre', 'Groupe sanguin — valeur proposée', 'patient', 'biologie', 'text', false, false, 102),
      ($1, 'outcome_autre', 'Evolution — valeur proposée', 'encounter', 'clinique', 'text', false, false, 103),
      ($1, 'invented_autre', 'Champ texte ordinaire', 'patient', 'clinique', 'text', false, false, 104),
      ($1, 'diagnostic_cim', 'Diagnostic CIM', 'encounter', 'clinique', 'terminology', false, false, 105),
      ($1, 'diagnostic_cim_autre', 'Diagnostic CIM — valeur proposée', 'encounter', 'clinique', 'text', false, false, 106)`,
    [version.id],
  );

  const historicalVersionId = (await db.admin.query(
    `insert into public.template_version (template_id, version_number, status, created_by, published_at)
     values ($1, 901, 'archived', $2, now()) returning id`,
    [version.template_id, aliceId],
  )).rows[0].id;
  await db.admin.query(
    `insert into public.template_field
      (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
       required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
     select $1, field_key, label, scope, section, type, unit, allowed_values,
            required, min_value, max_value, allow_missing_codes, display_order, encounter_types
       from public.template_field where template_version_id = $2`,
    [historicalVersionId, version.id],
  );

  await db.admin.query(
    `insert into public.patient
      (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values
      ($1, 'PROP-001', $2, jsonb_build_object(
        'sexe_autre', 'Intersexe', 'blood_group_autre', '   ', 'invented_autre', 'Ne pas lister'
      ), 'direct', 'draft', $4),
      ($1, 'PROP-002', $3, jsonb_build_object('sexe_autre', 'Intersexe'), 'direct', 'draft', $4)`,
    [baseId, version.id, historicalVersionId, aliceId],
  );
  await db.admin.query(
    `insert into public.patient
      (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by, deleted_at)
     values ($1, 'PROP-DELETED', $2, jsonb_build_object('sexe_autre', 'Masquée'), 'direct', 'draft', $3, now())`,
    [baseId, version.id, aliceId],
  );
  await db.admin.query(
    `insert into public.encounter
      (patient_id, template_version_id, encounter_type, encounter_date, data, collection_mode, validation_status, created_by)
     select id, $2, 'consultation', date '2026-08-01', jsonb_build_object(
       'outcome_autre', 'Sortie contre avis', 'diagnostic_cim_autre', 'Syndrome introuvable'
     ), 'direct', 'draft', $3
       from public.patient
      where base_id = $1 and patient_code = 'PROP-001'`,
    [baseId, version.id, aliceId],
  );
  await db.admin.query(
    `insert into public.encounter
      (patient_id, template_version_id, encounter_type, encounter_date, data, collection_mode, validation_status, created_by, deleted_at)
     select id, $2, 'suivi', date '2026-08-02', jsonb_build_object('outcome_autre', 'Masquée'), 'direct', 'draft', $3, now()
       from public.patient
      where base_id = $1 and patient_code = 'PROP-001'`,
    [baseId, version.id, aliceId],
  );

  await db.admin.query(
    `insert into public.base (name, specialty, owner_user_id, current_template_version_id)
     values ('Base de Bob', 'neurochirurgie', $1, $2)`,
    [bobId, version.id],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('base_proposals (L12)', () => {
  test('le proprietaire voit les occurrences valides, historiques et non vides, doublons conserves', async () => {
    const page = (await rowsAs(
      aliceId,
      'select public.base_proposals($1, $2, $3) as result',
      [baseId, 50, 0],
    ))[0].result;

    expect(page).toMatchObject({ total: 4, limit: 50, offset: 0, hasMore: false });
    expect(page.items).toHaveLength(4);
    expect(page.items.filter((row: { fieldKey: string }) => row.fieldKey === 'sexe')).toMatchObject([
      { label: 'Sexe', scope: 'patient', proposalValue: 'Intersexe', encounterId: null, variableTotal: 2 },
      { label: 'Sexe', scope: 'patient', proposalValue: 'Intersexe', encounterId: null, variableTotal: 2 },
    ]);
    expect(page.items.find((row: { fieldKey: string }) => row.fieldKey === 'outcome')).toMatchObject({
      label: 'Evolution',
      scope: 'encounter',
      proposalValue: 'Sortie contre avis',
      encounterType: 'consultation',
      variableTotal: 1,
    });
    expect(page.items.find((row: { fieldKey: string }) => row.fieldKey === 'diagnostic_cim')).toMatchObject({
      label: 'Diagnostic CIM',
      proposalValue: 'Syndrome introuvable',
      variableTotal: 1,
    });
    expect(page.items.some((row: { fieldKey: string }) => row.fieldKey === 'blood_group')).toBe(false);
    expect(page.items.some((row: { proposalValue: string }) => row.proposalValue === 'Ne pas lister')).toBe(false);
    expect(page.items.some((row: { proposalValue: string }) => row.proposalValue === 'Masquée')).toBe(false);
  });

  test('borne la page sans perdre le total des occurrences ni celui de la variable', async () => {
    const page = (await rowsAs(
      aliceId,
      'select public.base_proposals($1, $2, $3) as result',
      [baseId, 1, 0],
    ))[0].result;

    expect(page).toMatchObject({ total: 4, limit: 1, offset: 0, hasMore: true });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].variableTotal).toBeGreaterThanOrEqual(1);
  });

  test('refuse un membre partage et le proprietaire medecin d une autre base', async () => {
    await expect(rowsAs(annaId, 'select public.base_proposals($1, 50, 0)', [baseId]))
      .rejects.toThrow(/proprietaire/i);
    await expect(rowsAs(bobId, 'select public.base_proposals($1, 50, 0)', [baseId]))
      .rejects.toThrow(/proprietaire/i);
  });

  test('retire anon de la surface RPC et n eleve pas les privileges', async () => {
    const metadata = (await db.admin.query(`
      select
        p.prosecdef,
        p.provolatile,
        p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'base_proposals'
        and pg_get_function_identity_arguments(p.oid) = 'p_base_id uuid, p_limit integer, p_offset integer'
    `)).rows[0];

    expect(metadata).toMatchObject({
      prosecdef: false,
      provolatile: 's',
      anon_execute: false,
      authenticated_execute: true,
    });
    expect(metadata.proconfig).toContain('search_path=public, pg_temp');
  });
});
