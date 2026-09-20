// =============================================================================
// L71 — groupes répétables hors-ligne (spec-groupes-repetables.md §10).
//
// Tout s'exerce sur le PostgreSQL embarqué et les RPC de production, avec des
// fixtures entièrement fictives. Ce que ces tests établissent :
//
//   * l'instantané transporte `isRepeatable` par section et `group_section_key`
//     par rencontre (§10.1) ;
//   * `replay_encounter_create` accepte la clé de groupe, et l'empreinte qui
//     rend le rejeu idempotent est RECALCULÉE côté serveur : deux groupes
//     différents sous la même clé d'opération sont refusés (§10.2) ;
//   * l'ordre existant patient -> rencontres couvre le cas sans modification :
//     une occurrence d'un patient non confirmé est refusée (§10.3) ;
//   * un conflit sur une occurrence se comporte comme sur une rencontre, motif
//     compris, et ne laisse ni écriture partielle ni accusé résiduel (§10.4).
// =============================================================================
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let bobId: string;

let baseId: string;
let versionId: string;
let runId: string;

const GROUP_KEY = 'groupe_repetable';
const ORDINARY_SECTION = 'bloc_ordinaire';
const groupFieldKey = 'groupe_valeur';
const ordinaryFieldKey = 'ordinaire_valeur';

type Row = Record<string, unknown>;

const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

const REPLAY_PATIENT = `select * from public.replay_patient_create(
  $1, $2::uuid, $3, $4, $5::date, $6, $7, $8, $9::jsonb
)`;
// Huit arguments : la forme d'AVANT ce lot, qui doit rester appelable telle quelle.
const REPLAY_ENCOUNTER_LEGACY = `select * from public.replay_encounter_create(
  $1, $2, $3::uuid, $4, $5::date, $6, $7::jsonb, $8
)`;
const REPLAY_ENCOUNTER = `select * from public.replay_encounter_create(
  $1, $2, $3::uuid, $4, $5::date, $6, $7::jsonb, $8, $9::text
)`;
const REPLAY_UPDATE = `select * from public.replay_encounter_update(
  $1, $2::uuid, $3::jsonb, $4, $5, $6::timestamptz
)`;

const createReceipts = async (operationId: string): Promise<Row[]> => (await db.admin.query(
  'select * from public.offline_encounter_create_operation where operation_id = $1',
  [operationId],
)).rows;
const updateReceipts = async (operationId: string): Promise<Row[]> => (await db.admin.query(
  'select * from public.offline_encounter_operation where operation_id = $1',
  [operationId],
)).rows;
const encounterRow = async (encounterId: unknown): Promise<Row> => (await db.admin.query(
  'select * from public.encounter where id = $1', [encounterId],
)).rows[0];
const occurrencesOf = async (patientId: unknown): Promise<Row[]> => (await db.admin.query(
  `select id, data, created_at, encounter_date, age_value, age_unit, encounter_type
     from public.encounter
    where patient_id = $1 and group_section_key = $2 and deleted_at is null
    order by created_at`,
  [patientId, GROUP_KEY],
)).rows;

/** Crée un patient serveur (fictif) directement, pour les scénarios sans file locale. */
async function newPatient(label: string): Promise<string> {
  const code = `L71-${runId}-${label}`;
  const patient = await db.admin.query(
    `insert into public.patient
       (base_id, patient_code, template_version_id, data, validation_status, created_by)
     values ($1, $2, $3, '{}'::jsonb, 'draft', $4)
     returning id`,
    [baseId, code, versionId, aliceId],
  );
  await db.admin.query(
    `insert into public.patient_identity
       (base_id, patient_code, full_name, date_of_birth, created_by)
     values ($1, $2, $3, '1980-01-01', $4)`,
    [baseId, code, `Patient fictif ${label}`, aliceId],
  );
  return patient.rows[0].id;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  runId = `${Date.now()}`.slice(-9);

  const template = await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ('L71 hors-ligne groupes', 'neurochirurgie', $1, false) returning id`,
    [aliceId],
  );
  const version = await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, 1, 'draft', $2) returning id`,
    [template.rows[0].id, aliceId],
  );
  versionId = version.rows[0].id;

  const sectionId = async (key: string, label: string, repeatable: boolean): Promise<string> => (
    await db.admin.query(
      `insert into public.template_section
         (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
       values ($1, $2, $3, null,
         (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id = $1),
         $4)
       returning id`,
      [versionId, key, label, repeatable],
    )
  ).rows[0].id;
  const groupSectionId = await sectionId(GROUP_KEY, 'Groupe répétable fictif', true);
  const ordinarySectionId = await sectionId(ORDINARY_SECTION, 'Bloc ordinaire fictif', false);

  const addField = async (fieldKey: string, label: string, secId: string): Promise<void> => {
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
       values ($1, $2, $3, 'encounter', 'clinique', $4, 'text', false,
         (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id = $1))`,
      [versionId, fieldKey, label, secId],
    );
  };
  await addField(groupFieldKey, 'Variable de groupe fictive', groupSectionId);
  await addField(ordinaryFieldKey, 'Variable ordinaire fictive', ordinarySectionId);

  const base = await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ('Base L71 hors-ligne fictive', 'neurochirurgie', $1, $2, 'longitudinal')
     returning id`,
    [aliceId, versionId],
  );
  baseId = base.rows[0].id;
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe('§10.1 — l instantané transporte la portée', () => {
  test('isRepeatable par section et group_section_key par rencontre', async () => {
    const patientId = await newPatient('snapshot');
    const occurrence = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      `l71-${runId}-snap`, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'C5' }), 'years', GROUP_KEY,
    ]))[0];

    const snapshot = (await rowsAs(aliceId,
      'select public.download_base_snapshot($1) as snap', [baseId],
    ))[0].snap as {
      sections: { sectionKey: string; isRepeatable: boolean }[];
      sectionsByVersion: Record<string, { sectionKey: string; isRepeatable: boolean }[]>;
      patients: { id: string; encounters: { id: string; group_section_key: string | null }[] }[];
    };

    expect(snapshot.sections.find((s) => s.sectionKey === GROUP_KEY)?.isRepeatable).toBe(true);
    expect(snapshot.sections.find((s) => s.sectionKey === ORDINARY_SECTION)?.isRepeatable).toBe(false);
    // La carte par version porte la même information : c'est elle que lit une rencontre
    // dont la version n'est plus la version courante de la base.
    expect(snapshot.sectionsByVersion[versionId].find((s) => s.sectionKey === GROUP_KEY)?.isRepeatable).toBe(true);

    const cached = snapshot.patients.find((p) => p.id === patientId)!.encounters
      .find((e) => e.id === occurrence.id)!;
    expect(cached.group_section_key).toBe(GROUP_KEY);
  });
});

describe('§10.2/§10.3 — rejeu ordonné de trois occurrences', () => {
  test('trois occurrences hors-ligne : créées dans l ordre, sans doublon, rejeu idempotent', async () => {
    const parentKey = `l71-${runId}-parent`;
    const patient = (await rowsAs(aliceId, REPLAY_PATIENT, [
      parentKey, baseId, `L71-${runId}-P`, 'Patient Fictif L71', '1979-02-02',
      null, null, null, JSON.stringify({}),
    ]))[0];

    const occurrenceKeys = ['a', 'b', 'c'].map((suffix) => `l71-${runId}-occ-${suffix}`);
    const payloadOf = (key: string, index: number): unknown[] => [
      key, parentKey, null, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: `niveau-${index}` }), 'years', GROUP_KEY,
    ];

    const created: Row[] = [];
    for (const [index, key] of occurrenceKeys.entries()) {
      created.push((await rowsAs(aliceId, REPLAY_ENCOUNTER, payloadOf(key, index)))[0]);
    }
    expect(created.map((row) => row.replayed)).toEqual([false, false, false]);
    expect(created.every((row) => row.patient_id === patient.id)).toBe(true);
    expect(new Set(created.map((row) => row.id)).size).toBe(3);

    // L'ordre de rejeu est celui de la file : les trois lignes se suivent dans le même ordre.
    const stored = await occurrencesOf(patient.id);
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => row.id)).toEqual(created.map((row) => row.id));
    expect(stored.map((row) => (row.data as Record<string, unknown>)[groupFieldKey]))
      .toEqual(['niveau-0', 'niveau-1', 'niveau-2']);
    // §4.2 : le type est la constante de plomberie et la date d'occurrence reste absente,
    // donc aucun âge inventé.
    expect(stored.every((row) => row.encounter_type === 'autre')).toBe(true);
    expect(stored.every((row) => row.encounter_date === null)).toBe(true);
    expect(stored.every((row) => row.age_value === null && row.age_unit === null)).toBe(true);

    // Réponse réseau perdue sur les trois : le rejeu retrouve les accusés, sans seconde écriture.
    for (const [index, key] of occurrenceKeys.entries()) {
      const replay = (await rowsAs(aliceId, REPLAY_ENCOUNTER, payloadOf(key, index)))[0];
      expect(replay).toMatchObject({ id: created[index].id, patient_id: patient.id, replayed: true });
    }
    expect((await occurrencesOf(patient.id)).map((row) => row.id)).toEqual(created.map((row) => row.id));
    for (const key of occurrenceKeys) expect(await createReceipts(key)).toHaveLength(1);
  });

  test('§10.3 : une occurrence dont le patient n est pas confirmé est refusée, sans accusé', async () => {
    const key = `l71-${runId}-orphan`;
    await expect(rowsAs(aliceId, REPLAY_ENCOUNTER, [
      key, `l71-${runId}-parent-inconnu`, null, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'C7' }), 'years', GROUP_KEY,
    ])).rejects.toThrow(/OFFLINE_PARENT_NOT_SYNCED/);
    expect(await createReceipts(key)).toHaveLength(0);
  });
});

describe('§10.2 — l empreinte serveur lie le groupe', () => {
  test('la même clé d opération avec un autre groupe est refusée', async () => {
    const patientId = await newPatient('empreinte');
    const key = `l71-${runId}-fingerprint`;
    const data = JSON.stringify({ [groupFieldKey]: 'T3' });
    const first = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      key, null, patientId, 'autre', null, 'draft', data, 'years', GROUP_KEY,
    ]))[0];
    expect(first.replayed).toBe(false);

    // Même charge, groupe retiré : la charge canonique diffère, donc l'accusé ne la couvre pas.
    await expect(rowsAs(aliceId, REPLAY_ENCOUNTER, [
      key, null, patientId, 'consultation', '2026-04-01', 'draft', data, 'years', null,
    ])).rejects.toThrow(/OFFLINE_OPERATION_MISMATCH/);
    expect(await occurrencesOf(patientId)).toHaveLength(1);
  });

  test('un accusé émis AVANT ce lot reste rejouable : l empreinte sans groupe est inchangée', async () => {
    const patientId = await newPatient('heritage');
    const key = `l71-${runId}-legacy`;
    const legacyArgs = [key, null, patientId, 'consultation', '2026-04-02', 'draft',
      JSON.stringify({ [ordinaryFieldKey]: 'suivi' }), 'years'];

    const first = (await rowsAs(aliceId, REPLAY_ENCOUNTER_LEGACY, legacyArgs))[0];
    expect(first.replayed).toBe(false);
    // Rejeu par l'ancienne forme d'appel, puis par la nouvelle avec un groupe explicitement nul :
    // les deux retrouvent le MEME accusé.
    expect((await rowsAs(aliceId, REPLAY_ENCOUNTER_LEGACY, legacyArgs))[0])
      .toMatchObject({ id: first.id, replayed: true });
    expect((await rowsAs(aliceId, REPLAY_ENCOUNTER, [...legacyArgs, null]))[0])
      .toMatchObject({ id: first.id, replayed: true });
  });
});

describe('§4.3 et gardes de groupe au rejeu', () => {
  test('la date reste obligatoire hors groupe et facultative dans une occurrence', async () => {
    const patientId = await newPatient('date');
    const undatedKey = `l71-${runId}-sans-date`;
    await expect(rowsAs(aliceId, REPLAY_ENCOUNTER, [
      undatedKey, null, patientId, 'consultation', null, 'draft',
      JSON.stringify({ [ordinaryFieldKey]: 'x' }), 'years', null,
    ])).rejects.toThrow(/OFFLINE_OPERATION_INVALID/);
    expect(await createReceipts(undatedKey)).toHaveLength(0);

    const occurrence = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      `l71-${runId}-occ-sans-date`, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'L1' }), 'years', GROUP_KEY,
    ]))[0];
    expect(await encounterRow(occurrence.id)).toMatchObject({ encounter_date: null, age_value: null });
  });

  test('un bloc non répétable est refusé et ne laisse aucun accusé', async () => {
    const patientId = await newPatient('bloc-ordinaire');
    const key = `l71-${runId}-bloc-refuse`;
    await expect(rowsAs(aliceId, REPLAY_ENCOUNTER, [
      key, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [ordinaryFieldKey]: 'x' }), 'years', ORDINARY_SECTION,
    ])).rejects.toThrow(/groupe r[ée]p[ée]table/i);
    expect(await createReceipts(key)).toHaveLength(0);
    expect(await occurrencesOf(patientId)).toHaveLength(0);
  });

  test('un compte sans accès à la base est refusé et ne laisse aucun accusé', async () => {
    const patientId = await newPatient('sans-acces');
    const key = `l71-${runId}-refus-acces`;
    await expect(rowsAs(bobId, REPLAY_ENCOUNTER, [
      key, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'C3' }), 'years', GROUP_KEY,
    ])).rejects.toThrow(/Acces refuse|RESOURCE_NOT_FOUND/i);
    expect(await createReceipts(key)).toHaveLength(0);
  });
});

describe('§10.4 — conflit sur une occurrence', () => {
  test('conflit de version : rien n est écrit, aucun accusé ne subsiste, la reprise garde le motif', async () => {
    const patientId = await newPatient('conflit');
    const occurrence = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      `l71-${runId}-conflit-creation`, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'origine' }), 'years', GROUP_KEY,
    ]))[0];
    const seen = (await encounterRow(occurrence.id)).updated_at;

    // Quelqu'un corrige la même occurrence pendant que la copie locale est hors-ligne.
    await rowsAs(aliceId,
      'select * from public.update_encounter($1::uuid, $2::jsonb, $3, $4, $5::timestamptz)',
      [occurrence.id, JSON.stringify({ [groupFieldKey]: 'serveur' }), 'draft', 'correction serveur', seen],
    );
    const serverState = await encounterRow(occurrence.id);
    expect((serverState.data as Record<string, unknown>)[groupFieldKey]).toBe('serveur');

    const conflictKey = `l71-${runId}-conflit`;
    await expect(rowsAs(aliceId, REPLAY_UPDATE, [
      conflictKey, occurrence.id, JSON.stringify({ [groupFieldKey]: 'local' }),
      'draft', 'correction hors-ligne', seen,
    ])).rejects.toThrow(/CONFLIT_VERSION/);

    // Aucune écriture partielle : ni la ligne clinique ni l'accusé n'ont bougé.
    const afterConflict = await encounterRow(occurrence.id);
    expect((afterConflict.data as Record<string, unknown>)[groupFieldKey]).toBe('serveur');
    expect(afterConflict.updated_at).toEqual(serverState.updated_at);
    expect(await updateReceipts(conflictKey)).toHaveLength(0);

    // Résolution « garder ma version » : la même clé repart avec la charge locale préservée,
    // et le motif de correction reste exigé et journalisé comme pour toute rencontre.
    const resolveKey = `l71-${runId}-conflit-resolu`;
    const resolved = (await rowsAs(aliceId, REPLAY_UPDATE, [
      resolveKey, occurrence.id, JSON.stringify({ [groupFieldKey]: 'local' }),
      'draft', 'correction hors-ligne', null,
    ]))[0];
    expect(resolved.replayed).toBe(false);
    expect((await encounterRow(occurrence.id)).data).toMatchObject({ [groupFieldKey]: 'local' });

    const journal = (await db.admin.query(
      `select field_key, new_value, reason from public.field_change_log
        where entity = 'encounter' and entity_id = $1 and field_key = $2
        order by changed_at desc limit 1`,
      [occurrence.id, groupFieldKey],
    )).rows[0];
    expect(journal.reason).toBe('correction hors-ligne');

    // Réponse réseau perdue APRES le commit : le rejeu retrouve l'accusé sans réécrire.
    const replay = (await rowsAs(aliceId, REPLAY_UPDATE, [
      resolveKey, occurrence.id, JSON.stringify({ [groupFieldKey]: 'local' }),
      'draft', 'correction hors-ligne', null,
    ]))[0];
    expect(replay).toMatchObject({ id: occurrence.id, replayed: true });
    expect(await updateReceipts(resolveKey)).toHaveLength(1);
  });

  test('deux occurrences du même patient ne se bloquent pas entre elles', async () => {
    const patientId = await newPatient('conflit-voisin');
    const first = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      `l71-${runId}-voisin-1`, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'un' }), 'years', GROUP_KEY,
    ]))[0];
    const second = (await rowsAs(aliceId, REPLAY_ENCOUNTER, [
      `l71-${runId}-voisin-2`, null, patientId, 'autre', null, 'draft',
      JSON.stringify({ [groupFieldKey]: 'deux' }), 'years', GROUP_KEY,
    ]))[0];

    const staleFirst = (await encounterRow(first.id)).updated_at;
    await rowsAs(aliceId, 'select * from public.update_encounter($1::uuid, $2::jsonb, $3, $4, $5::timestamptz)',
      [first.id, JSON.stringify({ [groupFieldKey]: 'un-serveur' }), 'draft', 'correction serveur', staleFirst]);

    await expect(rowsAs(aliceId, REPLAY_UPDATE, [
      `l71-${runId}-voisin-1-conflit`, first.id, JSON.stringify({ [groupFieldKey]: 'un-local' }),
      'draft', 'correction hors-ligne', staleFirst,
    ])).rejects.toThrow(/CONFLIT_VERSION/);

    const freshSecond = (await encounterRow(second.id)).updated_at;
    const ok = (await rowsAs(aliceId, REPLAY_UPDATE, [
      `l71-${runId}-voisin-2-ok`, second.id, JSON.stringify({ [groupFieldKey]: 'deux-local' }),
      'draft', 'correction hors-ligne', freshSecond,
    ]))[0];
    expect(ok.replayed).toBe(false);
    expect((await encounterRow(second.id)).data).toMatchObject({ [groupFieldKey]: 'deux-local' });
  });
});

describe('privilèges de la RPC élargie', () => {
  test('security definer, search_path figé, exécution réservée aux authentifiés', async () => {
    const metadata = (await db.admin.query(
      `select p.prosecdef, p.proconfig,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
         from pg_proc p
        where p.oid = 'public.replay_encounter_create(text,text,uuid,text,date,text,jsonb,text,text)'::regprocedure`,
    )).rows[0];
    expect(metadata.prosecdef).toBe(true);
    expect(metadata.proconfig).toContain('search_path=public, extensions, pg_temp');
    expect(metadata.auth_execute).toBe(true);
    expect(metadata.anon_execute).toBe(false);

    // L'ancienne signature à huit arguments ne subsiste pas en surcharge ambiguë.
    const overloads = (await db.admin.query(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'replay_encounter_create'`,
    )).rows[0].n;
    expect(overloads).toBe(1);
  });

  test('authentification requise avant toute écriture', async () => {
    await expect(db.admin.query(REPLAY_ENCOUNTER, [
      `l71-${runId}-sans-auth`, null, null, 'autre', null, 'draft', '{}', 'years', GROUP_KEY,
    ])).rejects.toThrow(/AUTHENTICATION_REQUIRED/);
  });
});
