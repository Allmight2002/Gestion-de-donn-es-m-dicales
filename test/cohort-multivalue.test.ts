// L23 — cohortes sur variables MULTIVALUEES.
//
// La propriete verrouillee ici est celle qui compte pour l'utilisateur : ce qui est ANNONCE a
// l'apercu est exactement ce qui est FIGE. `cohort_preview` et `create_cohort_snapshot` sont
// deux fonctions distinctes qui decoupent les conditions par portee et appellent la meme
// `jsonb_matches` ; rien dans le schema n'empeche l'une de deriver de l'autre. Un filtre qui
// marcherait a l'apercu mais pas au figeage produirait une cohorte silencieusement differente
// de celle qui a ete montree — et une cohorte fausse ne se voit pas, elle se publie.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;
let baseId: string;
let versionId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

// Portee non validee : les fiches creees ici restent en brouillon, et la comparaison
// apercu/figeage porte sur la meme population des deux cotes.
const PREVIEW = 'select * from public.cohort_preview($1, $2::jsonb, false)';
const SNAPSHOT = 'select * from public.create_cohort_snapshot($1, $2, $3::jsonb, false)';

const EXTRADURAL = { code: 'S06.4', label: 'Hematome extradural' };
const FEMUR = { code: 'S72.0', label: 'Fracture du femur' };

const filtre = (op: 'has_any' | 'has_none', codes: string[]) =>
  JSON.stringify({ conditions: [{ scope: 'encounter', field: 'diagnostics', op, value: codes }] });

/** Cree un patient et sa rencontre, avec ou sans liste de diagnostics. */
async function addCase(code: string, diagnostics: { code: string; label: string }[] | null) {
  const patient = await rowsAs(aliceId, 'select * from public.create_patient($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
    baseId, code, `Patient ${code}`, '1990-01-01', null, null, null,
    JSON.stringify({ sexe: 'M', birth_year: 1990 }),
  ]);
  await rowsAs(aliceId, 'select * from public.create_encounter($1,$2,$3,$4,$5::jsonb,$6)', [
    patient[0].id, 'consultation', '2026-08-18', 'draft',
    JSON.stringify(diagnostics ? { diagnostics } : {}), 'years',
  ]);
  return patient[0].id as string;
}

/** Effectifs annonces par l'apercu. */
async function preview(op: 'has_any' | 'has_none', codes: string[]) {
  const row = (await rowsAs(aliceId, PREVIEW, [baseId, filtre(op, codes)]))[0];
  return { patients: Number(row.patient_count), encounters: Number(row.encounter_count) };
}

/** Effectifs REELLEMENT figes par le meme filtre. */
async function frozen(name: string, op: 'has_any' | 'has_none', codes: string[]) {
  const cohort = (await rowsAs(aliceId, SNAPSHOT, [baseId, name, filtre(op, codes)]))[0];
  const count = async (table: string) => Number((await rowsAs(
    aliceId, `select count(*)::int as n from public.${table} where cohort_id=$1`, [cohort.id],
  ))[0].n);
  return { patients: await count('cohort_member'), encounters: await count('cohort_encounter_member') };
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id;
  const base = (await db.admin.query(
    'select id, current_template_version_id from public.base order by created_at limit 1',
  )).rows[0];
  baseId = base.id;
  versionId = base.current_template_version_id;

  const release = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-l23', 'Referentiel L23', 'test', '1', true, now()) returning id`,
  )).rows[0].id;
  await db.admin.query(
    `insert into public.terminology_concept(release_id, code, label, kind, is_selectable) values
       ($1, $2, $3, 'category', true),
       ($1, $4, $5, 'category', true)`,
    [release, EXTRADURAL.code, EXTRADURAL.label, FEMUR.code, FEMUR.label],
  );
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, is_multiple,
        required, display_order, allow_missing_codes)
     values ($1, 'diagnostics', 'Diagnostics', 'encounter', 'clinique', 'terminology', true,
             false, 1950, false)`,
    [versionId],
  );

  await addCase('L23-A', [EXTRADURAL]);
  await addCase('L23-B', [FEMUR, EXTRADURAL]);
  await addCase('L23-C', [FEMUR]);
  await addCase('L23-D', null); // aucune liste : ne porte donc aucun de ces codes
});

afterAll(async () => {
  await db?.stop();
});

describe('cohortes sur listes de diagnostics (L23)', () => {
  test('has_any retient les fiches portant l un des codes, quel que soit son rang', async () => {
    const un = await preview('has_any', [EXTRADURAL.code]);
    // A (rang 1) et B (rang 2) : le rang n'entre pas dans la selection.
    expect(un.encounters).toBe(2);

    const deux = await preview('has_any', [EXTRADURAL.code, FEMUR.code]);
    expect(deux.encounters).toBe(3);

    const aucun = await preview('has_any', ['CODE-ABSENT']);
    expect(aucun.encounters).toBe(0);
  });

  test('has_none exclut ces fiches et laisse passer celles qui n ont pas de liste', async () => {
    const total = Number((await db.admin.query(
      `select count(*)::int as n from public.encounter e join public.patient p on p.id = e.patient_id
       where p.base_id = $1 and e.deleted_at is null and p.deleted_at is null`,
      [baseId],
    )).rows[0].n);

    const sansExtradural = await preview('has_none', [EXTRADURAL.code]);
    expect(sansExtradural.encounters).toBe(total - 2);

    // La rencontre sans aucune liste (L23-D) n'est pas exclue : elle ne porte pas ce code.
    const sansLesDeux = await preview('has_none', [EXTRADURAL.code, FEMUR.code]);
    expect(sansLesDeux.encounters).toBe(total - 3);
  });

  // Le point 4 du lot : l'apercu ANNONCE, le figeage ENREGISTRE. Les deux doivent porter sur
  // exactement la meme population, sinon la cohorte publiee n'est pas celle qui a ete montree.
  test('la population figee est identique a celle annoncee par l apercu', async () => {
    const annonce = await preview('has_any', [EXTRADURAL.code, FEMUR.code]);
    const fige = await frozen('L23 porte au moins un de', 'has_any', [EXTRADURAL.code, FEMUR.code]);
    expect(fige).toEqual(annonce);

    const annonceSans = await preview('has_none', [EXTRADURAL.code]);
    const figeSans = await frozen('L23 ne porte aucun de', 'has_none', [EXTRADURAL.code]);
    expect(figeSans).toEqual(annonceSans);
  });

  test('ce sont les MEMES patients, pas seulement le meme compte', async () => {
    const cohort = (await rowsAs(aliceId, SNAPSHOT, [baseId, 'L23 identite', filtre('has_any', [FEMUR.code])]))[0];
    const membres = (await rowsAs(
      aliceId,
      `select p.patient_code from public.cohort_member m join public.patient p on p.id = m.patient_id
       where m.cohort_id = $1 order by p.patient_code`,
      [cohort.id],
    )).map((row: { patient_code: string }) => row.patient_code);

    expect(membres).toEqual(['L23-B', 'L23-C']);
  });
});
