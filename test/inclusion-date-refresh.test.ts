// Date d'inclusion : une rencontre qui ne change pas la date n'avance pas la revision de la
// fiche (20261004150000). Cas d'origine : une occurrence de groupe repetable (sans date)
// ajoutee pendant la modification de la fiche rendait l'enregistrement de cette fiche
// conflictuel. Instance PostgreSQL embarquee, donnees entierement fictives.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let alice: string;
let version: string;
let base: string;

type Row = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
const asAlice = async (sql: string, params: unknown[] = []) =>
  db.asUser(alice, async (client: Client) => (await client.query(sql, params)).rows as Row[]);
const patientRow = async (id: string) => (await db.admin.query(
  'select row_version::int as row_version, inclusion_date::text as inclusion_date from public.patient where id = $1', [id],
)).rows[0] as { row_version: number; inclusion_date: string };

async function newPatient(): Promise<string> {
  const rows = await asAlice(
    `select id from public.create_patient($1, null, 'Patient fictif', '1980-01-01', null, null, null, $2::jsonb)`,
    [base, JSON.stringify({ nom: 'x' })],
  );
  return rows[0].id as string;
}

const addOccurrence = (pid: string, value: string) => asAlice(
  `select * from public.create_encounter_idempotent($1, $2, 'autre', null, 'complete', $3::jsonb, 'years', 'lesions')`,
  [`l69-occurrence:${uuid()}`, pid, JSON.stringify({ niveau: value })],
);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  const template = (await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false) returning id`, [`Inclusion ${uuid().slice(0, 8)}`, alice],
  )).rows[0].id;
  version = (await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, 1, 'draft', $2) returning id`, [template, alice],
  )).rows[0].id;
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order, is_repeatable)
     values ($1, 'lesions', 'Lésions', 0, true)`, [version],
  );
  for (const [key, scope, section, order] of [['nom', 'patient', null, 0], ['niveau', 'encounter', 'lesions', 1], ['motif', 'encounter', null, 2]]) {
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
       values ($1, $2, $2, $3, $4,
         (select id from public.template_section where template_version_id = $1 and section_key = $4),
         'text', false, $5)`,
      [version, key, scope, section, order],
    );
  }
  base = (await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ($1, 'neurochirurgie', $2, $3, 'longitudinal') returning id`,
    [`Base inclusion fictive ${uuid().slice(0, 8)}`, alice, version],
  )).rows[0].id;
});

afterAll(async () => { await db?.stop(); });

describe('refresh_patient_inclusion_date', () => {
  test('an undated occurrence leaves the open patient form saveable', async () => {
    const pid = await newPatient();
    const context = (await asAlice('select public.read_patient_form_context($1, $2) as c', [base, pid]))[0].c as Row;
    const before = await patientRow(pid);

    await addOccurrence(pid, 'C5');
    await addOccurrence(pid, 'T3');
    expect(await patientRow(pid)).toEqual(before);

    const saved = (await asAlice(
      'select public.update_patient_compatible($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9) as r',
      [base, pid, JSON.stringify({ nom: 'y' }), 'draft', '', context.record_revision,
        context.record_definition_revision, uuid(), context.context_fingerprint],
    ))[0].r;
    expect(saved).toBeTruthy();
    expect((await patientRow(pid)).row_version).toBe(before.row_version + 1);
  });

  test('the legacy optimistic lock also survives an occurrence', async () => {
    const pid = await newPatient();
    const before = await patientRow(pid);
    await addOccurrence(pid, 'L1');
    await asAlice(
      `select * from public.update_patient($1, $2::jsonb, 'draft', '', $3)`,
      [pid, JSON.stringify({ nom: 'z' }), before.row_version],
    );
    expect((await patientRow(pid)).row_version).toBe(before.row_version + 1);
  });

  test('an encounter that moves the inclusion date still advances the revision', async () => {
    const pid = await newPatient();
    const before = await patientRow(pid);
    await asAlice(
      `select * from public.create_encounter($1, 'consultation', '2001-02-03', 'draft', $2::jsonb, 'years', null)`,
      [pid, JSON.stringify({ motif: 'suivi' })],
    );
    const after = await patientRow(pid);
    expect(after.inclusion_date).toBe('2001-02-03');
    expect(after.row_version).toBe(before.row_version + 1);

    // Une rencontre posterieure ne deplace plus la date : aucune ecriture de la fiche.
    await asAlice(
      `select * from public.create_encounter($1, 'consultation', '2005-06-07', 'draft', $2::jsonb, 'years', null)`,
      [pid, JSON.stringify({ motif: 'controle' })],
    );
    expect(await patientRow(pid)).toEqual(after);
  });
});
