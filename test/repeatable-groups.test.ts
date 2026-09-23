import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

// L66 — PostgreSQL/RLS pour les groupes répétables.
//
// Chaque test exerce la vraie base PostgreSQL embarquée et les RPC de production.
// Les fixtures sont entièrement fictives et disparaissent avec l'instance de test.

let db: TestDb;
let aliceId: string;
let bobId: string;
let annaId: string;

let baseId: string;
let versionId: string;
let patientId: string;
let repeatableSectionId: string;
let ordinarySectionId: string;
const groupFieldKey = 'groupe_requis';
const ordinaryFieldKey = 'ordinaire_requis';

type Row = Record<string, unknown>;

const uuid = () => crypto.randomUUID();

const rowsAs = (uid: string, sql: string, params: unknown[] = []) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows as Row[]);

const createCall = `select * from public.create_encounter(
  $1::uuid, $2::text, $3::date, $4::text, $5::jsonb, $6::text, $7::text
)`;

const updateCall = `select * from public.update_encounter(
  $1::uuid, $2::jsonb, $3::text, $4::text, $5::timestamptz
)`;

const idempotentEncounterCall = `select * from public.create_encounter_idempotent(
  $1::text, $2::uuid, $3::text, $4::date, $5::text, $6::jsonb, $7::text, $8::text
)`;

async function createEncounter(
  uid: string,
  pid: string,
  data: Record<string, unknown>,
  options: {
    type?: string;
    date?: string | null;
    status?: string;
    group?: string | null;
    ageUnit?: string;
  } = {},
): Promise<Row> {
  const result = await rowsAs(uid, createCall, [
    pid,
    options.type ?? 'autre',
    options.date ?? null,
    options.status ?? 'complete',
    JSON.stringify(data),
    options.ageUnit ?? 'years',
    options.group ?? null,
  ]);
  return result[0];
}

// L identifiant et l horodatage proviennent d une ligne lue et repartent tels quels en
// paramètres : les typer `unknown` préserve l objet Date de pg, dont dépend la comparaison
// à la milliseconde du verrou optimiste.
async function updateEncounter(
  uid: string,
  encounterId: unknown,
  data: Record<string, unknown>,
  expectedUpdatedAt: unknown,
  status = 'complete',
): Promise<Row> {
  const result = await rowsAs(uid, updateCall, [
    encounterId,
    JSON.stringify(data),
    status,
    'L66 test fictif',
    expectedUpdatedAt,
  ]);
  return result[0];
}

async function newPatient(label = 'patient'): Promise<string> {
  const code = `L66-${label}-${uuid().slice(0, 8)}`;
  const result = await db.admin.query(
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
  return result.rows[0].id;
}

async function createTemplateVersion(name: string, versionNumber: number): Promise<{
  templateId: string;
  versionId: string;
}> {
  const template = await db.admin.query(
    `insert into public.template(name, specialty, owner_user_id, is_global)
     values ($1, 'neurochirurgie', $2, false)
     returning id`,
    [name, aliceId],
  );
  const version = await db.admin.query(
    `insert into public.template_version(template_id, version_number, status, created_by)
     values ($1, $2, 'draft', $3)
     returning id`,
    [template.rows[0].id, versionNumber, aliceId],
  );
  return { templateId: template.rows[0].id, versionId: version.rows[0].id };
}

async function addSection(
  targetVersionId: string,
  key: string,
  label: string,
  parentKey: string | null = null,
  repeatable = false,
): Promise<string> {
  const parent = parentKey
    ? (await db.admin.query(
      'select id from public.template_section where template_version_id=$1 and section_key=$2',
      [targetVersionId, parentKey],
    )).rows[0]?.id
    : null;
  const result = await db.admin.query(
    `insert into public.template_section
       (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
     values ($1, $2, $3, $4, (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id=$1), $5)
     returning id`,
    [targetVersionId, key, label, parent, repeatable],
  );
  return result.rows[0].id;
}

async function addField(
  targetVersionId: string,
  fieldKey: string,
  label: string,
  sectionId: string,
  scope: 'patient' | 'encounter',
  required = true,
): Promise<string> {
  const result = await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, section_id, type, required, display_order)
     values ($1, $2, $3, $4, 'clinique', $5, 'text', $6,
       (select coalesce(max(display_order), -1) + 1 from public.template_field where template_version_id=$1))
     returning id`,
    [targetVersionId, fieldKey, label, scope, sectionId, required],
  );
  return result.rows[0].id;
}

async function missing(
  data: Record<string, unknown>,
  encounterType: string | null,
  group: string | null,
  targetVersionId = versionId,
): Promise<string[]> {
  const result = await rowsAs(aliceId,
    `select * from public.missing_required_fields(
       $1::uuid, 'encounter', $2::jsonb, $3::text, $4::text
     )`,
    [targetVersionId, JSON.stringify(data), encounterType, group],
  );
  return result.map((row) => String(Object.values(row)[0]));
}

async function stats(targetBaseId = baseId, mode = 'current'): Promise<Row[]> {
  const result = await rowsAs(aliceId,
    'select public.base_completeness_stats($1,$2) as stats',
    [targetBaseId, mode],
  );
  return (result[0].stats ?? []) as Row[];
}

async function authenticatedClient(uid: string): Promise<Client> {
  const client = db.pg.getPgClient();
  await client.connect();
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
  return client;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((row) => [row.email, row.id]),
  );
  aliceId = users.get('alice@demo.test')!;
  bobId = users.get('bob@demo.test')!;
  annaId = users.get('anna.analyst@demo.test')!;

  const custom = await createTemplateVersion('L66 groupes répétables', 1);
  versionId = custom.versionId;
  repeatableSectionId = await addSection(versionId, 'groupe_repetable', 'Groupe répétable fictif', null, true);
  ordinarySectionId = await addSection(versionId, 'bloc_ordinaire', 'Bloc ordinaire fictif');
  // Le couple bloc racine / sous-bloc sert de cible non racine aux gardes du §6.4 ;
  // les tests le désignent par son section_key, pas par son identifiant.
  await addSection(versionId, 'bloc_parent', 'Bloc parent fictif');
  await addSection(versionId, 'sous_bloc', 'Sous-bloc fictif', 'bloc_parent');
  await addField(versionId, groupFieldKey, 'Variable groupe fictive', repeatableSectionId, 'encounter', true);
  await addField(versionId, ordinaryFieldKey, 'Variable ordinaire fictive', ordinarySectionId, 'encounter', true);

  const base = await db.admin.query(
    `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
     values ('Base L66 groupes fictive', 'neurochirurgie', $1, $2, 'longitudinal')
     returning id`,
    [aliceId, versionId],
  );
  baseId = base.rows[0].id;
  await db.admin.query(
    `insert into public.base_access
       (base_id, user_id, access_role, can_view_identity, can_edit_structured_data, can_export_data, granted_by)
     values ($1, $2, 'viewer', false, false, true, $3)`,
    [baseId, annaId, aliceId],
  );
  patientId = await newPatient('principal');
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe('applicabilité et complétude des groupes', () => {
  test('§14.1.1 : une variable du bloc est réclamée sur une occurrence du groupe', async () => {
    await expect(missing({}, 'autre', 'groupe_repetable')).resolves.toEqual(['Variable groupe fictive']);
    await expect(missing({ groupe_requis: 'C5' }, 'autre', 'groupe_repetable')).resolves.toEqual([]);
  });

  test('§14.1.2 : une variable de groupe ne fuit pas vers une consultation ordinaire, même avec encounter_types nul', async () => {
    await expect(missing({}, 'consultation', null)).resolves.toEqual(['Variable ordinaire fictive']);
    await expect(missing({ ordinaire_requis: 'consultation' }, 'consultation', null)).resolves.toEqual([]);
    await expect(missing({}, 'consultation', null)).resolves.not.toContain('Variable groupe fictive');
  });

  test('§14.1.3 : le dénominateur des statistiques d une variable de groupe ne compte que son groupe', async () => {
    const pid = await newPatient('stats');
    const completeGroup = await createEncounter(aliceId, pid, { [groupFieldKey]: 'C5' }, { group: 'groupe_repetable' });
    await expect(completeGroup.group_section_key).toBe('groupe_repetable');
    await createEncounter(aliceId, pid, {}, { group: 'groupe_repetable', status: 'draft' });
    // Une vraie consultation reste datée : la contrainte §4.3 ne relâche l'obligation
    // que pour une occurrence de groupe.
    await createEncounter(aliceId, pid, { [ordinaryFieldKey]: 'consultation' }, {
      type: 'consultation',
      date: '2026-03-01',
      group: null,
    });

    const current = await stats();
    const groupRow = current.find((row) => row.fieldKey === groupFieldKey);
    const ordinaryRow = current.find((row) => row.fieldKey === ordinaryFieldKey);
    expect(groupRow).toMatchObject({ total: 2, filled: 1 });
    expect(ordinaryRow).toMatchObject({ total: 1, filled: 1 });
  });

  test('§14.1.4 bis : create/update complete et export_incomplete_records relaient le groupe', async () => {
    const pid = await newPatient('complete');
    const complete = await createEncounter(aliceId, pid, { [groupFieldKey]: 'C5' }, { group: 'groupe_repetable' });
    expect(complete.validation_status).toBe('complete');
    expect(complete.encounter_type).toBe('autre');
    expect(complete.group_section_key).toBe('groupe_repetable');

    const incomplete = await createEncounter(aliceId, pid, {}, { group: 'groupe_repetable', status: 'draft' });
    const promoted = await updateEncounter(
      aliceId,
      incomplete.id,
      { [groupFieldKey]: 'T3' },
      incomplete.updated_at,
      'complete',
    );
    expect(promoted.validation_status).toBe('complete');

    const draft = await createEncounter(aliceId, pid, {}, { group: 'groupe_repetable', status: 'draft' });
    const cohort = (await db.admin.query(
      `insert into public.cohort(base_id, name, cohort_type, validated_only, created_by)
       values ($1, 'Cohorte L66 complète fictive', 'snapshot', false, $2)
       returning id`,
      [baseId, aliceId],
    )).rows[0].id;
    await db.admin.query('insert into public.cohort_member(cohort_id, patient_id) values ($1,$2)', [cohort, pid]);
    await db.admin.query('insert into public.cohort_encounter_member(cohort_id, encounter_id) values ($1,$2)', [cohort, complete.id]);
    await db.admin.query('insert into public.cohort_encounter_member(cohort_id, encounter_id) values ($1,$2)', [cohort, draft.id]);

    const incompleteRows = (await db.admin.query(
      'select record_kind, record_id from public.export_incomplete_records($1)',
      [cohort],
    )).rows;
    expect(incompleteRows).toEqual([{ record_kind: 'encounter', record_id: draft.id }]);
    expect(incompleteRows.some((row) => row.record_id === complete.id)).toBe(false);
    expect(incompleteRows.some((row) => row.record_id === promoted.id)).toBe(false);
  });
});

describe('gardes serveur L66', () => {
  test('§14.1.5 : un groupe inconnu, ordinaire ou non racine est refusé', async () => {
    await expect(createEncounter(aliceId, patientId, { [groupFieldKey]: 'x' }, { group: 'inconnu' }))
      .rejects.toThrow(/Groupe inconnu pour cette version/i);
    await expect(createEncounter(aliceId, patientId, { [ordinaryFieldKey]: 'x' }, { group: 'bloc_ordinaire' }))
      .rejects.toThrow(/Ce bloc n'est pas un groupe répétable/i);
    // L72a : une sous-section peut être un groupe ; `sous_bloc` est refusé parce qu'il
    // n'est pas répétable, plus parce qu'il n'est pas racine.
    await expect(createEncounter(aliceId, patientId, { [groupFieldKey]: 'x' }, { group: 'sous_bloc' }))
      .rejects.toThrow(/Ce bloc n'est pas un groupe répétable/i);
  });

  test('§14.1.5 : une variable patient ne peut entrer dans un groupe répétable, à l insertion ou au déplacement', async () => {
    const guard = await createTemplateVersion('L66 garde portée', 1);
    const group = await addSection(guard.versionId, 'groupe_portee', 'Groupe portée', null, true);
    const ordinary = await addSection(guard.versionId, 'bloc_portee', 'Bloc portée');

    await expect(db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, section_id, type, required)
       values ($1, 'patient_dans_groupe', 'Patient dans groupe', 'patient', 'clinique', $2, 'text', false)`,
      [guard.versionId, group],
    )).rejects.toThrow(/groupe répétable ne contient que des variables de rencontre/i);

    const field = await addField(guard.versionId, 'champ_a_deplacer', 'Champ à déplacer', ordinary, 'patient', false);
    await expect(db.admin.query(
      'update public.template_field set section_id=$2 where id=$1',
      [field, group],
    )).rejects.toThrow(/groupe répétable ne contient que des variables de rencontre/i);
  });

  test('§14.1.5 : un groupe répétable n accepte ni sous-section ni bascule avec sous-section existante', async () => {
    const guard = await createTemplateVersion('L66 garde hiérarchie', 1);
    const repeatable = await addSection(guard.versionId, 'groupe_hierarchie', 'Groupe hiérarchie', null, true);
    const plain = await addSection(guard.versionId, 'bloc_hierarchie', 'Bloc hiérarchie');
    await addSection(guard.versionId, 'sous_hierarchie', 'Sous hiérarchie', 'bloc_hierarchie');

    await expect(db.admin.query(
      `insert into public.template_section
         (template_version_id, section_key, label, parent_section_id, display_order, is_repeatable)
       values ($1, 'sous_groupe_hierarchie', 'Sous groupe hiérarchie', $2, 99, false)`,
      [guard.versionId, repeatable],
    )).rejects.toThrow(/groupe répétable n'accepte pas de sous-section/i);
    await expect(db.admin.query(
      'update public.template_section set is_repeatable=true where id=$1',
      [plain],
    )).rejects.toThrow(/groupe répétable n'accepte pas de sous-section/i);
  });

  test('§14.1.9 : une version utilisée refuse la bascule de is_repeatable', async () => {
    await expect(rowsAs(aliceId,
      'update public.template_section set is_repeatable=false where id=$1',
      [repeatableSectionId],
    )).rejects.toThrow(/Version deja utilisee/i);
    const current = (await db.admin.query(
      'select is_repeatable from public.template_section where id=$1',
      [repeatableSectionId],
    )).rows[0];
    expect(current.is_repeatable).toBe(true);
  });

  test('§14.1.6 : 50 occurrences sont acceptées et la 51e est refusée sous verrou de fiche', async () => {
    const pid = await newPatient('quota');
    for (let index = 1; index <= 50; index += 1) {
      const row = await createEncounter(aliceId, pid, { [groupFieldKey]: `occurrence-${index}` }, {
        type: 'consultation',
        date: null,
        group: 'groupe_repetable',
      });
      expect(row.group_section_key).toBe('groupe_repetable');
    }
    await expect(createEncounter(aliceId, pid, { [groupFieldKey]: 'occurrence-51' }, {
      date: null,
      group: 'groupe_repetable',
    })).rejects.toThrow(/Nombre maximal d'occurrences atteint pour ce groupe/i);
    const count = (await db.admin.query(
      `select count(*)::int as count from public.encounter
       where patient_id=$1 and group_section_key='groupe_repetable' and deleted_at is null`,
      [pid],
    )).rows[0].count;
    expect(count).toBe(50);
  }, 120_000);

  test('§14.1.7 : une date nulle est permise pour un groupe et laisse l âge nul, mais pas pour une rencontre ordinaire', async () => {
    const groupPatient = await newPatient('date-groupe');
    const group = await createEncounter(aliceId, groupPatient, { [groupFieldKey]: 'sans date' }, {
      date: null,
      group: 'groupe_repetable',
    });
    expect(group.encounter_date).toBeNull();
    expect(group.age_value).toBeNull();
    expect(group.age_unit).toBeNull();

    const ordinaryPatient = await newPatient('date-ordinaire');
    await expect(createEncounter(aliceId, ordinaryPatient, { [ordinaryFieldKey]: 'sans date' }, {
      date: null,
      type: 'consultation',
      group: null,
    })).rejects.toThrow();
  });

  test('§14.1.8 : copy_template_fields conserve is_repeatable et le rattachement au bloc', async () => {
    const target = await createTemplateVersion('L66 copie cible', 1);
    await db.admin.query(
      'select public.copy_template_fields($1,$2,false)',
      [versionId, target.versionId],
    );
    const sections = (await db.admin.query(
      `select section_key, is_repeatable from public.template_section
       where template_version_id=$1 order by section_key`,
      [target.versionId],
    )).rows;
    expect(sections.find((row) => row.section_key === 'groupe_repetable')?.is_repeatable).toBe(true);
    const copied = (await db.admin.query(
      `select f.scope, f.section, s.section_key, f.section_id
         from public.template_field f
         left join public.template_section s on s.id=f.section_id
        where f.template_version_id=$1 and f.field_key=$2`,
      [target.versionId, groupFieldKey],
    )).rows[0];
    expect(copied).toMatchObject({ scope: 'encounter', section: 'groupe_repetable', section_key: 'groupe_repetable' });
    expect(copied.section_id).toBeTruthy();
  });

  test('§6.5 : un groupe répétable n est jamais la cible d une règle de visibilité, dans les deux sens', async () => {
    const rules = await createTemplateVersion('L66 règle de bloc', 1);
    const group = await addSection(rules.versionId, 'groupe_regle', 'Groupe règle fictif', null, true);
    const target = await addSection(rules.versionId, 'bloc_cible', 'Bloc cible fictif');
    const pilot = await addSection(rules.versionId, 'bloc_pilote', 'Bloc pilote fictif');
    await addField(rules.versionId, 'pilote_regle', 'Pilote fictif', pilot, 'encounter', false);
    await addField(rules.versionId, 'membre_groupe', 'Membre du groupe fictif', group, 'encounter', false);
    await addField(rules.versionId, 'membre_cible', 'Membre du bloc cible fictif', target, 'encounter', false);

    const rule = (section: string) => JSON.stringify({
      if: { field: 'pilote_regle', operator: 'equals', value: 'oui' },
      then: { section, operator: 'visible' },
    });
    const insertRule = (section: string) => db.admin.query(
      `insert into public.validation_rule(template_version_id, rule, message, severity)
       values ($1, $2, 'Règle fictive L66', 'block')`,
      [rules.versionId, rule(section)],
    );

    // Sens 1 : la règle est refusée à sa définition.
    await expect(insertRule('groupe_regle'))
      .rejects.toThrow(/groupe repetable ne peut pas etre la cible/i);

    // Sens 2 : un bloc déjà ciblé ne peut plus devenir répétable.
    await insertRule('bloc_cible');
    await expect(db.admin.query(
      'update public.template_section set is_repeatable=true where id=$1',
      [target],
    )).rejects.toThrow(/groupe repetable ne peut pas etre la cible/i);

    // Les règles internes au groupe, entre variables d une même occurrence, restent permises.
    await addField(rules.versionId, 'membre_groupe_bis', 'Second membre fictif', group, 'encounter', false);
    await db.admin.query(
      `insert into public.validation_rule(template_version_id, rule, message, severity)
       values ($1, $2, 'Règle interne fictive L66', 'block')`,
      [rules.versionId, JSON.stringify({
        if: { field: 'membre_groupe', operator: 'equals', value: 'oui' },
        then: { field: 'membre_groupe_bis', operator: 'visible' },
      })],
    );
    const kept = (await db.admin.query(
      `select count(*)::int as count from public.validation_rule
       where template_version_id=$1 and rule #>> '{then,field}' = 'membre_groupe_bis'`,
      [rules.versionId],
    )).rows[0].count;
    expect(kept).toBe(1);
  });

  test('§14.1.12 : un modèle transversal refuse une variable de rencontre dans un groupe répétable', async () => {
    const cross = await createTemplateVersion('L66 modèle transversal', 1);
    const group = await addSection(cross.versionId, 'groupe_transversal', 'Groupe transversal', null, true);
    await db.admin.query(
      `insert into public.base(name, specialty, owner_user_id, current_template_version_id, observation_model)
       values ('Base transversale L66 fictive', 'neurochirurgie', $1, $2, 'cross_sectional')`,
      [aliceId, cross.versionId],
    );
    await expect(db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, section_id, type, required)
       values ($1, 'champ_transversal', 'Champ transversal', 'encounter', 'clinique', $2, 'text', false)`,
      [cross.versionId, group],
    )).rejects.toThrow(/transversale|cross_sectional|encounter/i);
  });
});

describe('cycle de vie, concurrence et RLS', () => {
  test('§14.1.10 : suppression douce puis restauration conserve la ligne dans son groupe', async () => {
    const pid = await newPatient('corbeille');
    const encounter = await createEncounter(aliceId, pid, { [groupFieldKey]: 'corbeille' }, { group: 'groupe_repetable' });
    await rowsAs(aliceId, 'select public.soft_delete_encounter($1,$2)', [encounter.id, 'Suppression fictive L66']);
    expect((await rowsAs(aliceId, 'select id from public.encounter where id=$1', [encounter.id]))).toHaveLength(0);
    const deleted = (await db.admin.query(
      'select group_section_key, deletion_reason from public.encounter where id=$1',
      [encounter.id],
    )).rows[0];
    expect(deleted).toMatchObject({ group_section_key: 'groupe_repetable', deletion_reason: 'Suppression fictive L66' });

    // Le produit ne possède pas encore de RPC de restauration d occurrence : la restauration
    // de corbeille reste une opération privilégiée. On vérifie ici l invariance de la ligne
    // et de son discriminant lors de la remise en ligne.
    await db.admin.query(
      `update public.encounter
          set deleted_at=null, deleted_by=null, deletion_reason=null
        where id=$1`,
      [encounter.id],
    );
    const restored = (await rowsAs(aliceId,
      'select group_section_key, deleted_at from public.encounter where id=$1',
      [encounter.id],
    ))[0];
    expect(restored).toMatchObject({ group_section_key: 'groupe_repetable', deleted_at: null });
  });

  test('§14.1.11 : deux mises à jour concurrentes de la même ligne donnent un conflit', async () => {
    const pid = await newPatient('conflit-meme');
    const encounter = await createEncounter(aliceId, pid, { [groupFieldKey]: 'initial' }, { group: 'groupe_repetable' });
    const first = await authenticatedClient(aliceId);
    const second = await authenticatedClient(aliceId);
    try {
      const firstUpdate = first.query(updateCall, [
        encounter.id, JSON.stringify({ [groupFieldKey]: 'première écriture' }), 'complete', 'première écriture', encounter.updated_at,
      ]);
      await firstUpdate;
      const secondUpdate = second.query(updateCall, [
        encounter.id, JSON.stringify({ [groupFieldKey]: 'seconde écriture' }), 'complete', 'seconde écriture', encounter.updated_at,
      ]);
      await first.query('commit');
      await expect(secondUpdate).rejects.toThrow(/CONFLIT_VERSION/i);
      await second.query('rollback');
    } finally {
      await first.end();
      await second.end();
    }
    const final = (await db.admin.query('select data from public.encounter where id=$1', [encounter.id])).rows[0].data;
    expect(final[groupFieldKey]).toBe('première écriture');
  });

  test('§14.1.11 : deux mises à jour concurrentes de lignes différentes ne se bloquent pas', async () => {
    const pid = await newPatient('conflit-different');
    const one = await createEncounter(aliceId, pid, { [groupFieldKey]: 'ligne une' }, { group: 'groupe_repetable' });
    const two = await createEncounter(aliceId, pid, { [groupFieldKey]: 'ligne deux' }, { group: 'groupe_repetable' });
    const first = await authenticatedClient(aliceId);
    const second = await authenticatedClient(aliceId);
    try {
      const updates = await Promise.all([
        first.query(updateCall, [one.id, JSON.stringify({ [groupFieldKey]: 'ligne une modifiée' }), 'complete', 'ligne une', one.updated_at]),
        second.query(updateCall, [two.id, JSON.stringify({ [groupFieldKey]: 'ligne deux modifiée' }), 'complete', 'ligne deux', two.updated_at]),
      ]);
      expect(updates).toHaveLength(2);
      await Promise.all([first.query('commit'), second.query('commit')]);
    } finally {
      await first.end();
      await second.end();
    }
    const rows = (await db.admin.query(
      `select id, data from public.encounter where id in ($1,$2) order by id`,
      [one.id, two.id],
    )).rows;
    expect(rows.map((row) => row.data[groupFieldKey]).sort()).toEqual(['ligne deux modifiée', 'ligne une modifiée'].sort());
  });

  test('complément hors §14.1 : l accès structuré est refusé sans droit d édition, et les lectures restent RLS-scopées', async () => {
    const pid = await newPatient('rls');
    const encounter = await createEncounter(aliceId, pid, { [groupFieldKey]: 'RLS fictive' }, { group: 'groupe_repetable' });
    await expect(createEncounter(bobId, pid, { [groupFieldKey]: 'sans droit' }, { group: 'groupe_repetable' }))
      .rejects.toThrow(/Acces refuse|permission denied/i);
    await expect(createEncounter(annaId, pid, { [groupFieldKey]: 'lecture seule' }, { group: 'groupe_repetable' }))
      .rejects.toThrow(/Acces refuse|permission denied/i);
    expect(await rowsAs(bobId, 'select id from public.encounter where id=$1', [encounter.id])).toHaveLength(0);
    await expect(rowsAs(annaId, 'select public.soft_delete_encounter($1,$2)', [encounter.id, 'interdit']))
      .rejects.toThrow(/Acces refuse|permission denied/i);
    await expect(rowsAs(annaId, 'select * from public.export_incomplete_records($1)', [uuid()]))
      .rejects.toThrow(/permission denied|privilege/i);

    const privileges = (await db.admin.query(`
      select
        has_function_privilege('anon', 'public.create_encounter(uuid,text,date,text,jsonb,text,text)', 'execute') as anon_create,
        has_function_privilege('authenticated', 'public.create_encounter(uuid,text,date,text,jsonb,text,text)', 'execute') as auth_create,
        has_function_privilege('authenticated', 'public.export_incomplete_records(uuid)', 'execute') as auth_export
    `)).rows[0];
    expect(privileges.anon_create).toBe(false);
    expect(privileges.auth_create).toBe(true);
    expect(privileges.auth_export).toBe(false);
  });
});

describe('L69 — création idempotente d occurrences', () => {
  test('un même reçu concurrent puis rejoué renvoie une seule occurrence et refuse un payload différent', async () => {
    const pid = await newPatient('l69-idempotence');
    const operationId = `l69-occurrence:${uuid()}`;
    const data = { [groupFieldKey]: 'L69, ligne une' };
    const args = [operationId, pid, 'autre', null, 'complete', JSON.stringify(data), 'years', 'groupe_repetable'];

    // Deux appels concurrents simulent le cas où le client perd l'une des réponses.
    const concurrent = await Promise.all([
      rowsAs(aliceId, idempotentEncounterCall, args),
      rowsAs(aliceId, idempotentEncounterCall, args),
    ]);
    const results = concurrent.map((rows) => rows[0]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(results.map((row) => row.replayed).sort()).toEqual([false, true]);

    const persisted = await db.admin.query(
      'select id, encounter_date, group_section_key, data from public.encounter where patient_id=$1',
      [pid],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      id: results[0].id,
      encounter_date: null,
      group_section_key: 'groupe_repetable',
      data,
    });

    await expect(rowsAs(aliceId, idempotentEncounterCall, [
      operationId, pid, 'autre', null, 'complete', JSON.stringify(data), 'years', 'bloc_ordinaire',
    ])).rejects.toThrow(/L69_OPERATION_MISMATCH/);
    await expect(rowsAs(annaId, idempotentEncounterCall, args)).rejects.toThrow(/WRITE_FORBIDDEN/);
    expect((await db.admin.query('select id from public.encounter where patient_id=$1', [pid])).rows).toHaveLength(1);
  });
});
