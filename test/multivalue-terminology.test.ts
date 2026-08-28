import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let baseId: string;
let ownerId: string;

const multi = (codes: string[]) => codes.map((code) => ({
  code,
  label: code === 'A' ? 'Diagnostic A' : code === 'B' ? 'Diagnostic B' : `Diagnostic ${code}`,
}));

const validate = (value: unknown, fieldKey = 'diagnostics_multi') =>
  db.admin.query('select public.assert_data_valid($1, $2, $3::jsonb)', [
    versionId,
    fieldKey === 'diagnostics_patient' ? 'patient' : 'encounter',
    JSON.stringify({ [fieldKey]: value }),
  ]);

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (client: Client) => (await client.query(sql, params)).rows);

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const base = (await db.admin.query(
    'select id, owner_user_id, current_template_version_id from public.base order by created_at limit 1',
  )).rows[0];
  baseId = base.id;
  ownerId = base.owner_user_id;
  versionId = base.current_template_version_id;

  const activeRelease = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-l20-active', 'Referentiel L20 actif', 'test', '1', true, now()) returning id`,
  )).rows[0].id;
  const historicalRelease = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-l20-history', 'Referentiel L20 conserve', 'test', '0', false, now()) returning id`,
  )).rows[0].id;
  await db.admin.query(
    `insert into public.terminology_concept(release_id, code, label, kind, is_selectable) values
       ($1, 'A', 'Diagnostic A', 'category', true),
       ($1, 'B', 'Diagnostic B', 'category', true),
       ($1, 'BLOCK', 'Regroupement', 'block', false),
       ($2, 'H', 'Diagnostic H', 'category', true)`,
    [activeRelease, historicalRelease],
  );

  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, is_multiple,
        required, display_order, allow_missing_codes)
     values
       ($1, 'diagnostics_multi', 'Diagnostics multiples', 'encounter', 'clinique',
        'terminology', true, false, 1900, true),
       ($1, 'diagnostics_strict', 'Diagnostics sans raison manquante', 'encounter', 'clinique',
        'terminology', true, false, 1901, false),
       ($1, 'diagnostics_patient', 'Diagnostics patient', 'patient', 'clinique',
        'terminology', true, false, 1902, true)`,
    [versionId],
  );
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('L20 — validation terminologique multivaluee', () => {
  test('le defaut reste unitaire et la cardinalite multiple est reservee a terminology', async () => {
    const existing = (await db.admin.query(
      'select is_multiple from public.template_field where template_version_id=$1 and field_key=$2',
      [versionId, 'sexe'],
    )).rows[0];
    expect(existing.is_multiple).toBe(false);

    await expect(db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, is_multiple, display_order)
       values($1, 'multiple_text', 'Texte multiple', 'patient', 'clinique', 'text', true, 1999)`,
      [versionId],
    )).rejects.toThrow(/multiple_terminology_only|check constraint/i);
  });

  test('accepte une liste de 1 a N diagnostics et une publication conservee inactive', async () => {
    await expect(validate(multi(['A']))).resolves.toBeDefined();
    await expect(validate(multi(['A', 'B']))).resolves.toBeDefined();
    await expect(validate([{ code: 'H', label: 'Diagnostic H' }])).resolves.toBeDefined();
  });

  test('refuse une valeur non tableau, une liste vide et plus de 50 diagnostics', async () => {
    await expect(validate({ code: 'A', label: 'Diagnostic A' })).rejects.toThrow(/liste de diagnostics/i);
    await expect(validate([])).rejects.toThrow(/liste vide/i);
    const tooMany = Array.from({ length: 51 }, (_, index) => ({
      code: `CODE-${index}`,
      label: `Diagnostic ${index}`,
    }));
    await expect(validate(tooMany)).rejects.toThrow(/50 valeurs/i);
  });

  test('refuse doublon, cle surnumeraire et couple incoherent sans exposer la valeur', async () => {
    await expect(validate(multi(['A', 'A']))).rejects.toThrow(/double/i);
    await expect(validate([{ code: 'A', label: 'Diagnostic A', note: 'interdite' }]))
      .rejects.toThrow(/contenu inattendu/i);
    await expect(validate([{ code: 'A', label: 'Diagnostic B' }]))
      .rejects.toThrow(/inconnu|conforme/i);
    await expect(validate([{ code: 'BLOCK', label: 'Regroupement' }]))
      .rejects.toThrow(/inconnu|conforme/i);
  });

  test('une raison manquante remplace la liste et respecte la configuration du champ', async () => {
    await expect(validate({ __missing__: 'inconnu' })).resolves.toBeDefined();
    await expect(validate({ __missing__: 'inconnu' }, 'diagnostics_strict'))
      .rejects.toThrow(/manquante non autorisee/i);
  });
});

describe('L20 — completude, cohortes et surfaces partagees', () => {
  test('la presence generique distingue un tableau vide d une liste renseignee', async () => {
    const result = (await db.admin.query(
      `select public.rule_value_present('[]'::jsonb) as empty,
              public.rule_value_present('[{"code":"A","label":"Diagnostic A"}]'::jsonb) as filled`,
    )).rows[0];
    expect(result).toEqual({ empty: false, filled: true });
  });

  test('base_completeness_stats compte une liste non vide comme observee', async () => {
    const patientId = (await db.admin.query(
      'select id from public.patient where base_id=$1 and template_version_id=$2 and deleted_at is null limit 1',
      [baseId, versionId],
    )).rows[0].id;
    await db.admin.query(
      `update public.patient
          set data = jsonb_set(data, '{diagnostics_patient}', $2::jsonb, true)
        where id=$1`,
      [patientId, JSON.stringify(multi(['A', 'B']))],
    );
    const stats = (await rowsAs(
      ownerId,
      "select public.base_completeness_stats($1, 'historical') as result",
      [baseId],
    ))[0].result as { fieldKey: string; observed: number; missingCoded: number }[];
    expect(stats.find((row) => row.fieldKey === 'diagnostics_patient')).toMatchObject({
      observed: 1,
      missingCoded: 0,
    });
  });

  test('has_any et has_none couvrent des listes de taille 0, 1 et N', async () => {
    const matches = async (data: unknown, op: 'has_any' | 'has_none', values: string[]) =>
      (await db.admin.query(
        'select public.jsonb_matches($1::jsonb, $2::jsonb) as result',
        [
          JSON.stringify({ diagnostic: data }),
          JSON.stringify([{ field: 'diagnostic', op, value: values }]),
        ],
      )).rows[0].result as boolean;

    await expect(matches([], 'has_any', ['A'])).resolves.toBe(false);
    await expect(matches([], 'has_none', ['A'])).resolves.toBe(true);
    await expect(matches(multi(['A']), 'has_any', ['A'])).resolves.toBe(true);
    await expect(matches(multi(['A']), 'has_none', ['A'])).resolves.toBe(false);
    await expect(matches(multi(['A']), 'has_any', [])).resolves.toBe(false);
    await expect(matches(multi(['A']), 'has_none', [])).resolves.toBe(true);
    await expect(matches(multi(['A', 'B']), 'has_any', ['B'])).resolves.toBe(true);
    await expect(matches(multi(['A', 'B']), 'has_none', ['H'])).resolves.toBe(true);
    await expect(matches(multi(['A', 'B']), 'has_none', ['B', 'H'])).resolves.toBe(false);
    await expect(matches({ code: 'A', label: 'Diagnostic A' }, 'has_any', ['A'])).resolves.toBe(false);
    await expect(matches({ code: 'A', label: 'Diagnostic A' }, 'has_none', ['A'])).resolves.toBe(true);
  });

  test('la duplication et l instantane hors ligne conservent isMultiple', async () => {
    const template = (await db.admin.query(
      'select template_id from public.template_version where id=$1',
      [versionId],
    )).rows[0].template_id;
    const nextNumber = Number((await db.admin.query(
      'select max(version_number)::int + 1 as n from public.template_version where template_id=$1',
      [template],
    )).rows[0].n);
    const target = (await db.admin.query(
      `insert into public.template_version(template_id, version_number, status, created_by)
       values($1,$2,'draft',$3) returning id`,
      [template, nextNumber, ownerId],
    )).rows[0].id;
    await db.admin.query('select public.copy_template_fields($1,$2)', [versionId, target]);
    expect((await db.admin.query(
      "select is_multiple from public.template_field where template_version_id=$1 and field_key='diagnostics_multi'",
      [target],
    )).rows[0].is_multiple).toBe(true);

    const snapshot = (await rowsAs(ownerId, 'select public.download_base_snapshot($1) as result', [baseId]))[0].result as {
      fields: { fieldKey: string; isMultiple: boolean }[];
      fieldsByVersion: Record<string, { fieldKey: string; isMultiple: boolean }[]>;
    };
    expect(snapshot.fields.find((field) => field.fieldKey === 'diagnostics_multi')?.isMultiple).toBe(true);
    expect(snapshot.fieldsByVersion[versionId]
      .find((field) => field.fieldKey === 'diagnostics_multi')?.isMultiple).toBe(true);
  });

  test('la cardinalite utilisee est immuable et la nouvelle RPC reste reservee aux authentifies', async () => {
    await expect(db.admin.query(
      "update public.template_field set is_multiple=false where template_version_id=$1 and field_key='diagnostics_patient'",
      [versionId],
    )).rejects.toThrow(/utilisee|comportement/i);

    const acl = (await db.admin.query(
      `select has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
         from pg_proc p
        where p.oid = 'public.update_template_field(uuid,text,text,text,text,text,text,text,boolean,boolean,text[],jsonb,text[],jsonb,numeric,numeric,text)'::regprocedure`,
    )).rows[0];
    expect(acl).toEqual({ anon_exec: false, authenticated_exec: true });
  });
});
