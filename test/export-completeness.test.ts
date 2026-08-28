// Test DB : la porte de l'export devient la COMPLETUDE, plus le statut de validation
// (decision du 2026-08-17, §1-§2).
//
// Trois proprietes decident du lot :
//   1. la definition de « champ requis manquant » est UNIQUE : `missing_required_fields`
//      sert la porte de la saisie (`assert_required_complete`) comme celle de l'export ;
//   2. une valeur manquante CODIFIEE (refus, inconnu...) est une reponse : elle ne fait
//      pas sortir la fiche de l'export ;
//   3. `export_incomplete_records` ne regarde JAMAIS le statut : une fiche `draft`
//      complete s'exporte, une fiche `complete` incomplete (heritee d'avant la regle du
//      2026-08-17) est ecartee.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let baseId: string;
let cohortId: string;
let aliceId: string;

const missing = async (scope: string, data: unknown, encounterType: string | null = null): Promise<string[]> =>
  (await db.admin.query(
    'select public.missing_required_fields($1, $2, $3::jsonb, $4) as m',
    [versionId, scope, JSON.stringify(data), encounterType],
  )).rows.map((r: { m: string }) => r.m);

const requireComplete = (scope: string, data: unknown, encounterType: string | null = null) =>
  db.admin.query('select public.assert_required_complete($1, $2, $3::jsonb, $4)', [
    versionId, scope, JSON.stringify(data), encounterType,
  ]);

const incompleteOfCohort = async (): Promise<Array<{ record_kind: string; record_id: string }>> =>
  (await db.admin.query('select * from public.export_incomplete_records($1) order by record_kind, record_id', [cohortId])).rows;

async function addField(
  fieldKey: string,
  scope: string,
  order: number,
  opts: { required?: boolean; encounterTypes?: string[] } = {},
) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, required, encounter_types)
     values($1, $2, $3, $4, 'clinique', 'text', $5, $6, $7)`,
    [versionId, fieldKey, `Libelle ${fieldKey}`, scope, order, opts.required ?? false, opts.encounterTypes ?? null],
  );
}

/** Patient insere DIRECTEMENT (hors RPC) pour pouvoir fabriquer les cas d'avant la regle. */
async function insertPatient(code: string, data: unknown, status: string): Promise<string> {
  return (await db.admin.query(
    `insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values($1, $2, $3, $4::jsonb, 'direct', $5, $6) returning id`,
    [baseId, code, versionId, JSON.stringify(data), status, aliceId],
  )).rows[0].id;
}

async function insertEncounter(patientId: string, type: string, data: unknown, status: string): Promise<string> {
  return (await db.admin.query(
    `insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data, validation_status, created_by)
     values($1, $2, $3, current_date, $4::jsonb, $5, $6) returning id`,
    [patientId, versionId, type, JSON.stringify(data), status, aliceId],
  )).rows[0].id;
}

let completeDraftId: string;
let incompleteDraftId: string;
let incompleteCompleteId: string;
let codifiedId: string;
let incompleteEncounterId: string;
let completeEncounterId: string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;

  const templateId = (await db.admin.query(
    "insert into public.template(name, specialty, owner_user_id, is_global) values('Gabarit export', null, $1, false) returning id",
    [aliceId],
  )).rows[0].id;
  versionId = (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values($1, 1, 'published', $2) returning id",
    [templateId, aliceId],
  )).rows[0].id;

  await addField('sexe', 'patient', 10, { required: true });
  await addField('remarque', 'patient', 11);
  await addField('motif', 'encounter', 20, { required: true });
  // Champ requis SEULEMENT pour la chirurgie : une consultation n'a pas a le porter.
  await addField('voie_abord', 'encounter', 21, { required: true, encounterTypes: ['chirurgie'] });

  baseId = (await db.admin.query(
    "insert into public.base(name, owner_user_id, current_template_version_id) values('Base export', $1, $2) returning id",
    [aliceId, versionId],
  )).rows[0].id;

  // Le trigger `assert_curated_complete` interdit desormais une fiche `complete`
  // incomplete : on desactive le trigger pour fabriquer l'HERITAGE (fiches ecrites
  // avant la regle du 2026-08-17), que l'export doit encore savoir ecarter.
  completeDraftId = await insertPatient('P-DRAFT-OK', { sexe: 'F' }, 'draft');
  incompleteDraftId = await insertPatient('P-DRAFT-KO', { remarque: 'sans sexe' }, 'draft');
  codifiedId = await insertPatient('P-CODIFIE', { sexe: { __missing__: 'refus' } }, 'draft');
  await db.admin.query('alter table public.patient disable trigger user');
  incompleteCompleteId = await insertPatient('P-COMPLETE-KO', {}, 'complete');
  await db.admin.query('alter table public.patient enable trigger user');

  completeEncounterId = await insertEncounter(completeDraftId, 'consultation', { motif: 'suivi' }, 'draft');
  incompleteEncounterId = await insertEncounter(completeDraftId, 'consultation', {}, 'draft');

  cohortId = (await db.admin.query(
    `insert into public.cohort(base_id, name, cohort_type, snapshot_at, validated_only, created_by)
     values($1, 'Cohorte export', 'snapshot', now(), false, $2) returning id`,
    [baseId, aliceId],
  )).rows[0].id;
  await db.admin.query(
    'insert into public.cohort_member(cohort_id, patient_id) select $1, unnest($2::uuid[])',
    [cohortId, [completeDraftId, incompleteDraftId, codifiedId, incompleteCompleteId]],
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------

describe('une seule definition de « champ requis manquant »', () => {
  test('la fiche complete ne manque de rien', async () => {
    expect(await missing('patient', { sexe: 'F' })).toEqual([]);
  });

  test('le champ requis absent est nomme', async () => {
    expect(await missing('patient', { remarque: 'x' })).toEqual(['Libelle sexe']);
  });

  test('vide ou null valent absent ; un objet codifie vaut renseigne', async () => {
    expect(await missing('patient', { sexe: '' })).toEqual(['Libelle sexe']);
    expect(await missing('patient', { sexe: null })).toEqual(['Libelle sexe']);
    expect(await missing('patient', { sexe: { __missing__: 'refus' } })).toEqual([]);
  });

  test('un champ reserve a un type de rencontre n\'est requis que pour ce type', async () => {
    expect(await missing('encounter', { motif: 'suivi' }, 'consultation')).toEqual([]);
    expect(await missing('encounter', { motif: 'suivi' }, 'chirurgie')).toEqual(['Libelle voie_abord']);
  });

  test('la porte de la SAISIE s\'appuie sur la meme definition, message inchange', async () => {
    await expect(requireComplete('patient', { sexe: 'F' })).resolves.toBeDefined();
    await expect(requireComplete('patient', {})).rejects.toThrow(/Champ requis manquant : Libelle sexe/);
  });
});

describe('ce que l\'export ecarte d\'une cohorte', () => {
  test('le statut de validation n\'entre pas dans le calcul', async () => {
    const rows = await incompleteOfCohort();
    const ids = rows.map((r) => r.record_id);
    // Ecartes : le brouillon incomplet ET la fiche `complete` heritee, incomplete.
    expect(ids).toContain(incompleteDraftId);
    expect(ids).toContain(incompleteCompleteId);
    // Gardes : le brouillon complet et la fiche dont la valeur manquante est CODIFIEE.
    expect(ids).not.toContain(completeDraftId);
    expect(ids).not.toContain(codifiedId);
  });

  test('les rencontres atteignables par l\'export sont examinees, membres ou non', async () => {
    const rows = await incompleteOfCohort();
    const encounters = rows.filter((r) => r.record_kind === 'encounter').map((r) => r.record_id);
    expect(encounters).toContain(incompleteEncounterId);
    expect(encounters).not.toContain(completeEncounterId);
  });

  test('une cohorte dont toutes les fiches sont completes ne renvoie rien', async () => {
    const clean = (await db.admin.query(
      `insert into public.cohort(base_id, name, cohort_type, snapshot_at, validated_only, created_by)
       values($1, 'Cohorte propre', 'snapshot', now(), false, $2) returning id`,
      [baseId, aliceId],
    )).rows[0].id;
    await db.admin.query('insert into public.cohort_member(cohort_id, patient_id) values($1, $2)', [clean, codifiedId]);
    const rows = (await db.admin.query('select * from public.export_incomplete_records($1)', [clean])).rows;
    expect(rows).toEqual([]);
  });

  test('une fiche supprimee n\'est jamais signalee : elle n\'est deja plus exportee', async () => {
    await db.admin.query('update public.patient set deleted_at = now() where id = $1', [incompleteDraftId]);
    const ids = (await incompleteOfCohort()).map((r) => r.record_id);
    expect(ids).not.toContain(incompleteDraftId);
    await db.admin.query('update public.patient set deleted_at = null where id = $1', [incompleteDraftId]);
  });
});
