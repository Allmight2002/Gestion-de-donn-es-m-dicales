// L72a — groupe répétable en SOUS-SECTION : socle serveur.
//
// docs/l72-groupe-repetable-sous-section.md §9.1. Le fichier démarre AVANT la migration
// L72a, peuple une version dont le groupe est RACINE, observe les fonctions de complétude,
// applique L72a et les migrations suivantes, puis observe de nouveau (test 1). Les autres
// tests s'exécutent ensuite sur le schéma final. Instance PostgreSQL embarquée sur loopback,
// données entièrement fictives : jamais de cloud.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

const MIGRATION = '20260923120000_repeatable_group_subsection.sql';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);

let db: TestDb;
let alice: string;

type Row = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

// --- Fixtures ------------------------------------------------------------------------------

async function newVersion(name: string): Promise<string> {
  const template = (await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false) returning id`,
    [`${name} ${uuid().slice(0, 8)}`, alice],
  )).rows[0].id;
  return (await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, 1, 'draft', $2) returning id`,
    [template, alice],
  )).rows[0].id;
}

async function addSection(
  version: string, key: string, parentKey: string | null = null, repeatable = false,
): Promise<string> {
  return (await db.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3,
       (select id from public.template_section where template_version_id=$1 and section_key=$4),
       (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1),
       $5)
     returning id`,
    [version, key, `Section ${key}`, parentKey, repeatable],
  )).rows[0].id;
}

async function addField(
  version: string, key: string, sectionKey: string | null, scope: 'patient' | 'encounter',
  required: boolean, encounterTypes: string[] | null = null,
): Promise<void> {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required,
        display_order, encounter_types)
     values ($1, $2, $3, $4, $5,
       (select id from public.template_section where template_version_id=$1 and section_key=$5),
       'text', $6,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1),
       $7)`,
    [version, key, `Libellé ${key}`, scope, sectionKey, required, encounterTypes],
  );
}

const blockRule = (driver: string, section: string) => JSON.stringify({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { section, operator: 'visible' },
});

async function addRule(version: string, rule: string): Promise<void> {
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     values ($1, $2, 'Règle fictive L72a', 'block')`,
    [version, rule],
  );
}

async function newBase(version: string): Promise<string> {
  return (await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ($1, 'neurochirurgie', $2, $3, 'longitudinal') returning id`,
    [`Base L72a fictive ${uuid().slice(0, 8)}`, alice, version],
  )).rows[0].id;
}

async function newPatient(base: string, version: string, data: Row = {}): Promise<string> {
  const code = `L72A-${uuid().slice(0, 8)}`;
  const id = (await db.admin.query(
    `insert into public.patient
       (base_id, patient_code, template_version_id, data, validation_status, created_by)
     values ($1, $2, $3, $4, 'draft', $5) returning id`,
    [base, code, version, JSON.stringify(data), alice],
  )).rows[0].id;
  await db.admin.query(
    `insert into public.patient_identity(base_id, patient_code, full_name, date_of_birth, created_by)
     values ($1, $2, 'Patient fictif L72a', '1980-01-01', $3)`,
    [base, code, alice],
  );
  return id;
}

// --- Test 1 : version à groupe RACINE, observée avant et après L72a -----------------------

// Tronc commun : `atteinte` pilote la règle du bloc `diag`. `diag` porte une sous-section
// patient, `suivi` une sous-section rencontre (l'expansion racine + enfants doit rester
// identique), `lesions` est le groupe racine, et `suivi_chir` exerce encounter_types.
const ROOT_KEYS = ['diag', 'suivi', 'lesions'];
const SUB_KEYS = ['diag_detail', 'suivi_detail'];
const DATASETS: (Row | null)[] = [
  null, {}, { atteinte: 'oui' }, { atteinte: 'non', diag_grade: 'x' },
  { atteinte: 'oui', diag_grade: 'x', diag_score: 'y', lesion_niveau: 'C5', suivi_etat: 'ok', suivi_note: 'n', suivi_chir: 's' },
  { lesion_niveau: '', suivi_etat: null },
];

let rootVersion: string;
let rootBase: string;
let rootCohort: string;

async function rootFixture(): Promise<void> {
  rootVersion = await newVersion('L72a groupe racine');
  await addField(rootVersion, 'atteinte', null, 'patient', false);
  await addSection(rootVersion, 'diag');
  await addSection(rootVersion, 'diag_detail', 'diag');
  await addField(rootVersion, 'diag_grade', 'diag', 'patient', true);
  await addField(rootVersion, 'diag_score', 'diag_detail', 'patient', true);
  await addSection(rootVersion, 'suivi');
  await addSection(rootVersion, 'suivi_detail', 'suivi');
  await addField(rootVersion, 'suivi_etat', 'suivi', 'encounter', true);
  await addField(rootVersion, 'suivi_note', 'suivi_detail', 'encounter', true);
  await addField(rootVersion, 'suivi_chir', 'suivi', 'encounter', true, ['suivi']);
  await addSection(rootVersion, 'lesions', null, true);
  await addField(rootVersion, 'lesion_niveau', 'lesions', 'encounter', true);
  await addField(rootVersion, 'lesion_note', 'lesions', 'encounter', false);
  await addRule(rootVersion, blockRule('atteinte', 'diag'));

  rootBase = await newBase(rootVersion);
  rootCohort = (await db.admin.query(
    `insert into public.cohort(base_id, name, cohort_type, validated_only, created_by)
     values ($1, 'Cohorte L72a fictive', 'snapshot', false, $2) returning id`,
    [rootBase, alice],
  )).rows[0].id;
  const patientData: Row[] = [{}, { atteinte: 'non' }, { atteinte: 'oui', diag_grade: 'x' },
    { atteinte: 'oui', diag_grade: 'x', diag_score: 'y' }];
  for (const [i, data] of patientData.entries()) {
    const patient = await newPatient(rootBase, rootVersion, data);
    await db.admin.query('insert into public.cohort_member(cohort_id, patient_id) values ($1,$2)', [rootCohort, patient]);
    const encounters: [string, string | null, Row][] = [
      ['consultation', '2026-01-01', i % 2 ? { suivi_etat: 'ok' } : {}],
      ['suivi', '2026-02-01', { suivi_etat: 'ok', suivi_note: 'n' }],
      ['autre', null, i % 2 ? { lesion_niveau: 'T3' } : {}],
      ['autre', null, { lesion_note: 'seule' }],
    ];
    for (const [j, [type, date, data]] of encounters.entries()) {
      await db.admin.query(
        `insert into public.encounter
           (patient_id, template_version_id, encounter_type, encounter_date, data, validation_status,
            created_by, group_section_key)
         values ($1, $2, $3, $4, $5, 'draft', $6, $7)`,
        [patient, rootVersion, type, date, JSON.stringify(data), alice, j >= 2 ? 'lesions' : null],
      );
    }
  }
}

async function observe() {
  const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows;
  const fieldKeys: Record<string, unknown> = {};
  for (const key of [...ROOT_KEYS, 'inconnu']) {
    fieldKeys[key] = await q(
      'select field_key from public.template_section_field_keys($1,$2) order by 1', [rootVersion, key]);
  }
  const subsectionKeys: Record<string, unknown> = {};
  for (const key of SUB_KEYS) {
    subsectionKeys[key] = await q(
      'select field_key from public.template_section_field_keys($1,$2) order by 1', [rootVersion, key]);
  }
  const missing: unknown[] = [];
  const required: unknown[] = [];
  const hidden: unknown[] = [];
  for (const data of DATASETS) {
    hidden.push(await q('select public.visibility_hidden_fields($1,$2::jsonb) as h', [rootVersion, JSON.stringify(data)]));
    for (const scope of ['patient', 'encounter']) {
      for (const type of [null, 'consultation', 'suivi', 'autre']) {
        // `null`, le groupe racine, et un bloc ordinaire désigné à tort comme groupe.
        for (const group of [null, 'lesions', 'suivi']) {
          const args = [rootVersion, scope, JSON.stringify(data), type, group];
          missing.push(await q('select * from public.missing_required_fields($1,$2,$3::jsonb,$4,$5)', args));
          try {
            await q('select public.assert_required_complete($1,$2,$3::jsonb,$4,$5)', args);
            required.push('ok');
          } catch (error) {
            required.push((error as Error).message);
          }
        }
      }
    }
  }
  const stats: Record<string, unknown> = {};
  for (const mode of ['historical', 'current', 'both']) {
    stats[mode] = await rowsAs(alice, 'select public.base_completeness_stats($1,$2) as s', [rootBase, mode]);
  }
  const incomplete = await q(
    'select record_kind, record_id from public.export_incomplete_records($1) order by 1, 2', [rootCohort]);
  return { fieldKeys, subsectionKeys, missing, required, hidden, stats, incomplete };
}

// --- Fixture sous-section (schéma final) -----------------------------------------------------

// Le montage du cadrage §1 : `trauma` (A) porte un diagnostic et ses sous-sections
// `trauma_a1`, `lesions_g1` (G1, groupe enfant), `trauma_a2`. `consult` est une rencontre
// ordinaire au tronc de la version. La règle d'affichage de `trauma` est posée APRÈS que G1
// est devenu enfant.
let subVersion: string;
let subBase: string;
const G1_LABELS = ['Libellé g1_niveau'];

async function subFixture(): Promise<void> {
  subVersion = await newVersion('L72a groupe enfant');
  await addField(subVersion, 'diagnostic', null, 'patient', false);
  await addSection(subVersion, 'trauma');
  await addField(subVersion, 'trauma_type', 'trauma', 'patient', true);
  await addSection(subVersion, 'trauma_a1', 'trauma');
  await addField(subVersion, 'a1_x', 'trauma_a1', 'patient', true);
  await addSection(subVersion, 'lesions_g1', 'trauma', true);
  await addField(subVersion, 'g1_niveau', 'lesions_g1', 'encounter', true);
  await addField(subVersion, 'g1_note', 'lesions_g1', 'encounter', false);
  await addSection(subVersion, 'trauma_a2', 'trauma');
  await addField(subVersion, 'a2_y', 'trauma_a2', 'patient', false);
  await addSection(subVersion, 'consult');
  await addField(subVersion, 'consult_motif', 'consult', 'encounter', true);
  await addRule(subVersion, blockRule('diagnostic', 'trauma'));
  subBase = await newBase(subVersion);
}

const createCall = `select * from public.create_encounter(
  $1::uuid, $2::text, $3::date, $4::text, $5::jsonb, $6::text, $7::text)`;

async function createEncounter(
  pid: string, data: Row, group: string | null, status = 'complete', type = 'autre', date: string | null = null,
): Promise<Row> {
  return (await rowsAs(alice, createCall, [pid, type, date, status, JSON.stringify(data), 'years', group]))[0];
}

async function missing(data: Row, type: string | null, group: string | null): Promise<string[]> {
  return (await db.admin.query(
    `select * from public.missing_required_fields($1, 'encounter', $2::jsonb, $3, $4)`,
    [subVersion, JSON.stringify(data), type, group],
  )).rows.map((row) => String(Object.values(row)[0]));
}

const fieldKeysOf = async (version: string, key: string) => (await db.admin.query(
  'select field_key from public.template_section_field_keys($1,$2) order by 1', [version, key],
)).rows.map((row) => row.field_key);

// --- Cycle -------------------------------------------------------------------------------------

let before: Awaited<ReturnType<typeof observe>>;
let after: Awaited<ReturnType<typeof observe>>;

beforeAll(async () => {
  db = await startTestDb({ seed: true, beforeMigration: MIGRATION });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  // La contrainte racine est bien en place avant L72a : le test 1 observe l'état d'avant.
  expect((await db.admin.query(
    "select count(*)::int as n from pg_constraint where conname='template_section_repeatable_root_only'",
  )).rows[0].n).toBe(1);

  await rootFixture();
  before = await observe();
  // L72a puis toute migration postérieure : le reste du fichier exerce le schéma final.
  const pending = readdirSync(migrationDir).filter((name) => name.endsWith('.sql') && name >= MIGRATION).sort();
  expect(pending[0]).toBe(MIGRATION);
  for (const name of pending) {
    await db.admin.query(readFileSync(fileURLToPath(new URL(name, migrationDir)), 'utf8'));
  }
  after = await observe();

  await subFixture();
}, 240_000);

afterAll(async () => { await db?.stop(); });

describe('test 1 — groupe racine : les quatre fonctions de complétude sont inchangées', () => {
  test('missing_required_fields et assert_required_complete rendent les mêmes verdicts', () => {
    expect(before.missing).toHaveLength(DATASETS.length * 2 * 4 * 3);
    expect(before.missing.some((rows) => Array.isArray(rows) && rows.length > 0)).toBe(true);
    expect(before.required.some((verdict) => verdict !== 'ok')).toBe(true);
    expect(after.missing).toEqual(before.missing);
    expect(after.required).toEqual(before.required);
    expect(after.hidden).toEqual(before.hidden);
  });

  test('base_completeness_stats (historique, courant, les deux) est identique, ordre compris', () => {
    expect(before.stats.both).not.toEqual([{ s: [] }]);
    expect(after.stats).toEqual(before.stats);
  });

  test('export_incomplete_records rend les mêmes fiches', () => {
    expect((before.incomplete as unknown[]).length).toBeGreaterThan(0);
    expect(after.incomplete).toEqual(before.incomplete);
  });

  test('test 2 (racine) : template_section_field_keys rend racine + enfants à l identique', () => {
    expect(before.fieldKeys.suivi).toEqual([
      { field_key: 'suivi_chir' }, { field_key: 'suivi_etat' }, { field_key: 'suivi_note' },
    ]);
    expect(after.fieldKeys).toEqual(before.fieldKeys);
  });

  test('test 2 (rupture 1) : une clé de sous-section rendait zéro ligne, elle rend ses variables', () => {
    expect(before.subsectionKeys).toEqual({ diag_detail: [], suivi_detail: [] });
    expect(after.subsectionKeys).toEqual({
      diag_detail: [{ field_key: 'diag_score' }],
      suivi_detail: [{ field_key: 'suivi_note' }],
    });
  });
});

describe('groupe en sous-section : applicabilité du §5', () => {
  test('test 2 : le groupe enfant rend ses variables, sa racine ne les inclut pas', async () => {
    await expect(fieldKeysOf(subVersion, 'lesions_g1')).resolves.toEqual(['g1_niveau', 'g1_note']);
    await expect(fieldKeysOf(subVersion, 'trauma')).resolves.toEqual(['a1_x', 'a2_y', 'trauma_type']);
    await expect(fieldKeysOf(subVersion, 'trauma_a1')).resolves.toEqual(['a1_x']);
  });

  test('test 3 : une occurrence réclame les variables requises du groupe, et elles seules', async () => {
    await expect(missing({}, 'autre', 'lesions_g1')).resolves.toEqual(G1_LABELS);
    await expect(missing({ g1_niveau: 'C5' }, 'autre', 'lesions_g1')).resolves.toEqual([]);

    // Sous la règle de `trauma`, dont le pilote patient est absent des données d'une
    // occurrence : la création n'est ni privée de variables requises, ni refusée comme
    // « valeur d'un bloc masqué ».
    const pid = await newPatient(subBase, subVersion, { diagnostic: 'oui', trauma_type: 't', a1_x: 'a' });
    await expect(createEncounter(pid, {}, 'lesions_g1')).rejects.toThrow(/Champ requis manquant/i);
    const occurrence = await createEncounter(pid, { g1_niveau: 'C5', g1_note: 'fictive' }, 'lesions_g1');
    expect(occurrence).toMatchObject({ group_section_key: 'lesions_g1', encounter_type: 'autre', validation_status: 'complete' });
  });

  test('test 4 : les variables du groupe enfant ne sont pas réclamées sur une rencontre ordinaire', async () => {
    for (const type of [null, 'consultation', 'autre']) {
      const labels = await missing({}, type, null);
      expect(labels).toEqual(['Libellé consult_motif']);
      expect(labels).not.toContain(G1_LABELS[0]);
    }
  });

  test('test 6 : le dénominateur d une variable du groupe enfant ne compte que les lignes du groupe', async () => {
    const base = await newBase(subVersion);
    const pid = await newPatient(base, subVersion, { diagnostic: 'oui' });
    await createEncounter(pid, { g1_niveau: 'C5' }, 'lesions_g1');
    await createEncounter(pid, {}, 'lesions_g1', 'draft');
    await createEncounter(pid, { consult_motif: 'contrôle' }, null, 'complete', 'consultation', '2026-03-01');
    const rows = ((await rowsAs(alice, 'select public.base_completeness_stats($1,$2) as s', [base, 'current']))[0].s ?? []) as Row[];
    expect(rows.find((row) => row.fieldKey === 'g1_niveau')).toMatchObject({ total: 2, filled: 1 });
    expect(rows.find((row) => row.fieldKey === 'consult_motif')).toMatchObject({ total: 1, filled: 1 });
  });

  test('E3 : une occurrence de groupe enfant se corrige, et ses variables restent hors rencontre ordinaire', async () => {
    const applicable = async (field: string, group: string | null) => (await db.admin.query(
      'select public.form_record_field_group_applicable($1,$2,$3) as ok', [subVersion, field, group],
    )).rows[0].ok;
    await expect(applicable('g1_niveau', 'lesions_g1')).resolves.toBe(true);
    await expect(applicable('g1_niveau', null)).resolves.toBe(false);
    await expect(applicable('consult_motif', null)).resolves.toBe(true);
    await expect(applicable('consult_motif', 'lesions_g1')).resolves.toBe(false);

    const pid = await newPatient(subBase, subVersion, { diagnostic: 'oui' });
    const occurrence = await createEncounter(pid, { g1_niveau: 'C5' }, 'lesions_g1');
    const updated = (await rowsAs(alice,
      'select * from public.update_encounter($1::uuid,$2::jsonb,$3::text,$4::text,$5::timestamptz)',
      [occurrence.id, JSON.stringify({ g1_niveau: 'C6' }), 'complete', 'Correction fictive L72a', occurrence.updated_at],
    ))[0];
    expect((updated.data as Row).g1_niveau).toBe('C6');
    expect(updated.group_section_key).toBe('lesions_g1');
  });

  test('L69 : la création idempotente accepte un groupe enfant', async () => {
    const pid = await newPatient(subBase, subVersion, { diagnostic: 'oui' });
    const created = (await rowsAs(alice,
      `select * from public.create_encounter_idempotent(
         $1::text, $2::uuid, $3::text, $4::date, $5::text, $6::jsonb, $7::text, $8::text)`,
      [`l69-occurrence:${uuid()}`, pid, 'autre', null, 'complete', JSON.stringify({ g1_niveau: 'L1' }), 'years', 'lesions_g1'],
    ))[0];
    expect(created.replayed).toBe(false);
    const row = (await db.admin.query('select group_section_key from public.encounter where id=$1', [created.id])).rows[0];
    expect(row.group_section_key).toBe('lesions_g1');
  });
});

describe('règles de bloc (rupture 2)', () => {
  test('test 5 : la règle de la racine reste créable dans les deux ordres, et le refus de portée subsiste', async () => {
    // Groupe enfant déclaré APRÈS la règle de sa racine.
    const later = await newVersion('L72a règle d abord');
    await addField(later, 'pilote', null, 'patient', false);
    await addSection(later, 'bloc');
    await addField(later, 'bloc_champ', 'bloc', 'patient', false);
    await addRule(later, blockRule('pilote', 'bloc'));
    await addSection(later, 'groupe', 'bloc', true);
    await addField(later, 'groupe_champ', 'groupe', 'encounter', false);
    // Et la fixture principale a posé la règle APRÈS le groupe enfant.
    expect((await db.admin.query(
      "select count(*)::int as n from public.validation_rule where template_version_id=$1 and rule #>> '{then,section}'='trauma'",
      [subVersion],
    )).rows[0].n).toBe(1);

    // Une vraie sous-section NON répétable qui mélange les portées reste refusée.
    const mixed = await newVersion('L72a portée mélangée');
    await addField(mixed, 'pilote', null, 'patient', false);
    await addSection(mixed, 'bloc');
    await addField(mixed, 'bloc_champ', 'bloc', 'patient', false);
    await addSection(mixed, 'sous_bloc', 'bloc');
    await addField(mixed, 'sous_champ', 'sous_bloc', 'encounter', false);
    await expect(addRule(mixed, blockRule('pilote', 'bloc')))
      .rejects.toThrow(/le bloc et son pilote doivent appartenir a la meme fiche/i);
  });

  test('G-d : un groupe enfant n est jamais la cible d une règle', async () => {
    // Version neuve : subVersion porte déjà des dossiers, ce qui refuserait toute règle.
    const version = await newVersion('L72a cible de règle');
    await addField(version, 'pilote', null, 'encounter', false);
    await addSection(version, 'bloc');
    await addSection(version, 'groupe', 'bloc', true);
    await addField(version, 'groupe_champ', 'groupe', 'encounter', false);
    await expect(addRule(version, blockRule('pilote', 'groupe')))
      .rejects.toThrow(/sous-section ne peut pas porter une regle/i);
  });
});

describe('gardes de structure', () => {
  test('test 7 : pas de groupe sous un groupe, ni de sous-section dans un groupe enfant', async () => {
    const version = await newVersion('L72a imbrication');
    await addSection(version, 'racine');
    await addSection(version, 'groupe_enfant', 'racine', true);
    await addSection(version, 'groupe_racine', null, true);
    await expect(addSection(version, 'sous_groupe', 'groupe_racine', true))
      .rejects.toThrow(/groupe répétable n'accepte pas de sous-section/i);
    await expect(addSection(version, 'sous_sous_groupe', 'groupe_enfant', true))
      .rejects.toThrow(/groupe répétable n'accepte pas de sous-section/i);
    await expect(addSection(version, 'sous_section', 'groupe_enfant'))
      .rejects.toThrow(/groupe répétable n'accepte pas de sous-section/i);
    // Le groupe enfant ne devient pas un parent par déplacement non plus.
    const other = await addSection(version, 'autre_racine');
    await expect(db.admin.query(
      `update public.template_section set parent_section_id=(select id from public.template_section
         where template_version_id=$1 and section_key='groupe_enfant') where id=$2`,
      [version, other],
    )).rejects.toThrow(/groupe répétable n'accepte pas de sous-section|parent doit etre un bloc/i);
  });

  test('test 8 : une occurrence ne désigne qu un bloc répétable connu de sa version', async () => {
    const pid = await newPatient(subBase, subVersion, { diagnostic: 'oui' });
    await expect(createEncounter(pid, { g1_niveau: 'x' }, 'trauma_a1')).rejects.toThrow(/n'est pas un groupe répétable/i);
    await expect(createEncounter(pid, { g1_niveau: 'x' }, 'trauma')).rejects.toThrow(/n'est pas un groupe répétable/i);
    await expect(createEncounter(pid, { g1_niveau: 'x' }, 'inconnu')).rejects.toThrow(/Groupe inconnu/i);
  });

  test('test 9 : la recopie de version conserve is_repeatable ET le rattachement au parent', async () => {
    const target = await newVersion('L72a copie');
    await db.admin.query('select public.copy_template_fields($1,$2,false)', [subVersion, target]);
    const group = (await db.admin.query(
      `select s.is_repeatable, p.section_key as parent from public.template_section s
         left join public.template_section p on p.id = s.parent_section_id
        where s.template_version_id=$1 and s.section_key='lesions_g1'`,
      [target],
    )).rows[0];
    expect(group).toEqual({ is_repeatable: true, parent: 'trauma' });
    await expect(fieldKeysOf(target, 'lesions_g1')).resolves.toEqual(['g1_niveau', 'g1_note']);
  });

  test('test 12 : gardes rejouées — portée patient refusée, bascule et déplacement refusés sur version utilisée', async () => {
    const fresh = await newVersion('L72a portée groupe enfant');
    await addSection(fresh, 'bloc');
    await addSection(fresh, 'groupe', 'bloc', true);
    await expect(addField(fresh, 'patient_dans_groupe', 'groupe', 'patient', false))
      .rejects.toThrow(/ne contient que des variables de rencontre/i);
    // subVersion porte des occurrences depuis les tests précédents.
    await expect(rowsAs(alice,
      "update public.template_section set is_repeatable=false where template_version_id=$1 and section_key='lesions_g1'",
      [subVersion],
    )).rejects.toThrow(/Version deja utilisee/i);
    await expect(rowsAs(alice,
      "update public.template_section set parent_section_id=null where template_version_id=$1 and section_key='lesions_g1'",
      [subVersion],
    )).rejects.toThrow(/Version deja utilisee/i);
  });

  test('import de bloc : un bloc portant un groupe enfant est refusé, sans écriture', async () => {
    const target = await newVersion('L72a import cible');
    const count = async () => (await db.admin.query(
      'select count(*)::int as n from public.template_section where template_version_id=$1', [target],
    )).rows[0].n;
    for (const rpc of ['preview_template_section_import', 'import_template_section']) {
      await expect(rowsAs(alice, `select public.${rpc}($1,$2,$3) as r`, [subVersion, 'trauma', target]))
        .rejects.toMatchObject({ code: 'P0001', detail: expect.stringContaining('IMPORT_SOURCE_HAS_REPEATABLE_GROUP') });
    }
    expect(await count()).toBe(0);
    // Un bloc sans groupe enfant s'importe comme avant.
    const report = (await rowsAs(alice, 'select public.import_template_section($1,$2,$3) as r', [subVersion, 'consult', target]))[0].r;
    expect(report).toMatchObject({ sectionKey: 'consult', importedFields: ['consult_motif'] });
  });
});
