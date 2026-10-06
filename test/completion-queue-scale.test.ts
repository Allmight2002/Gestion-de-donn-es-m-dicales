// File « A completer » a l'echelle signalee en production : formulaire de 402 variables,
// 62 sections et 238 regles de visibilite (blocs chaines, treillis en losange), plus des
// groupes repetables cote rencontre. La file et le compteur « A faire » doivent tenir sous
// le delai serveur (8 s) en tant qu'utilisateur sous RLS, avec le meme resultat que la
// definition par dossier (`record_completion_summary`). Donnees entierement fictives.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

const ROOTS = 31;
const FIELD_COUNT = 402;
const SECTIONED_FIELDS = 372;
const LATTICE = 28;
const PATIENTS = 400;
const GROUP_FIELDS = 6;

let db: TestDb;
let alice: string;
let versionId: string;
let baseId: string;

type Rule = Record<string, unknown>;
const fieldRule = (driver: string, target: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { field: target, operator: 'visible' },
});
const blockRule = (driver: string, section: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { section, operator: 'visible' },
});
const sectionOf = (k: number) => (k % 2 === 0 ? `r${(k / 2) % ROOTS}` : `s${((k - 1) / 2) % ROOTS}`);
const sectionedKey = (k: number) => `f${k}_${sectionOf(k)}`;
const firstFieldIn = (section: string) => {
  for (let k = 0; k < SECTIONED_FIELDS; k += 1) if (sectionOf(k) === section) return sectionedKey(k);
  throw new Error(section);
};

const within8s = async <T>(fn: (c: Client) => Promise<T>) => {
  const started = performance.now();
  const result = await db.asUser(alice, async (c) => {
    await c.query("set local statement_timeout = '8s'");
    return fn(c);
  });
  return { result, ms: performance.now() - started };
};

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id as string;

  const templateId = (await db.admin.query(
    "insert into public.template(name, owner_user_id, is_global) values ('File echelle',$1,false) returning id",
    [alice])).rows[0].id as string;
  versionId = (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values ($1,1,'draft',$2) returning id",
    [templateId, alice])).rows[0].id as string;

  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     select $1, 'r' || i, 'Bloc ' || i, i from generate_series(0, $2 - 1) i`, [versionId, ROOTS]);
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order, parent_section_id)
     select $1, 's' || i, 'Sous-section ' || i, $2 + i, r.id
       from generate_series(0, $2 - 1) i
       join public.template_section r on r.template_version_id = $1 and r.section_key = 'r' || i`,
    [versionId, ROOTS]);
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order, is_repeatable)
     values ($1,'g0','Groupe 0',100,true), ($1,'g1','Groupe 1',101,true), ($1,'e0','Rencontre',102,false)`,
    [versionId]);

  const fields: Array<{ key: string; section: string | null; scope: string; required: boolean }> = Array.from(
    { length: SECTIONED_FIELDS }, (_, k) => ({ key: sectionedKey(k), section: sectionOf(k), scope: 'patient', required: k % 7 === 0 }),
  );
  for (let i = 0; i < FIELD_COUNT - SECTIONED_FIELDS; i += 1) fields.push({ key: `c${i}`, section: null, scope: 'patient', required: false });
  for (const g of ['g0', 'g1', 'e0']) {
    for (let i = 0; i < GROUP_FIELDS; i += 1) fields.push({ key: `${g}_v${i}`, section: g, scope: 'encounter', required: i === 0 });
  }
  await db.admin.query(
    `insert into public.template_field(template_version_id, field_key, label, scope, section, type, required, display_order)
     select $1, f.key, 'Libelle ' || f.key, f.scope, f.section, 'text', f.required, f.ord
       from jsonb_to_recordset($2::jsonb) as f(key text, section text, scope text, required boolean, ord integer)`,
    [versionId, JSON.stringify(fields.map((f, ord) => ({ ...f, ord })))]);

  const rules: Rule[] = [];
  for (let i = 1; i < ROOTS; i += 1) rules.push(blockRule(firstFieldIn(`s${i - 1}`), `r${i}`));
  for (let i = 1; i < LATTICE; i += 1) rules.push(fieldRule(`c${i - 1}`, `c${i}`));
  for (let i = 2; i < LATTICE; i += 1) rules.push(fieldRule(`c${i - 2}`, `c${i}`));
  for (let k = 0; rules.length < 238; k += 1) rules.push(fieldRule(`c${k % LATTICE}`, sectionedKey(k)));
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     select $1, r, 'Regle fictive', 'block' from jsonb_array_elements($2::jsonb) as r`,
    [versionId, JSON.stringify(rules)]);
  await db.asUser(alice, (c) => c.query('select public.publish_template_version($1)', [versionId]));
  baseId = (await db.admin.query(
    "insert into public.base(name, owner_user_id, current_template_version_id) values ('File echelle',$1,$2) returning id",
    [alice, versionId])).rows[0].id as string;

  // Dossiers varies : une partie active toute la chaine (aucune masquee), une partie la coupe
  // tot (cascade de masquage), une partie est presque complete.
  const allOui = Object.fromEntries(fields.filter((f) => f.scope === 'patient').map((f) => [f.key, 'oui']));
  // Les valeurs retirees ne pilotent aucune regle : aucune valeur ne tombe dans un champ masque.
  const drivers = new Set(rules.map((r) => (r.if as { field: string }).field));
  const patientData = (i: number) => {
    if (i % 3 === 0) return allOui;
    if (i % 3 === 1) return { c0: 'oui' };
    return Object.fromEntries(Object.entries(allOui).filter(([key], k) => drivers.has(key) || k % 5 !== i % 5));
  };
  await db.admin.query(
    `insert into public.patient(base_id, patient_code, template_version_id, data)
     select $1, 'ECH-' || lpad(d.ord::text, 4, '0'), $2, d.data
       from jsonb_array_elements($3::jsonb) with ordinality as d(data, ord)`,
    [baseId, versionId, JSON.stringify(Array.from({ length: PATIENTS }, (_, i) => patientData(i)))]);
  // Rencontres : une ordinaire et une occurrence de groupe par patient sur la moitie.
  await db.admin.query(
    `insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data)
     select p.id, $2, 'consultation', '2026-09-01', case when n % 2 = 0 then '{"e0_v0":"x"}' else '{}' end::jsonb
       from (select id, row_number() over (order by patient_code) n from public.patient where base_id = $1) p
      where n % 2 = 0`, [baseId, versionId]);
  await db.admin.query(
    `insert into public.encounter(patient_id, template_version_id, encounter_type, group_section_key, data)
     select p.id, $2, 'autre', case when n % 4 = 0 then 'g0' else 'g1' end,
            case when n % 4 = 0 then '{"g0_v0":"x","g0_v1":"x","g0_v2":"x","g0_v3":"x","g0_v4":"x"}' else '{}' end::jsonb
       from (select id, row_number() over (order by patient_code) n from public.patient where base_id = $1) p
      where n % 2 = 0`, [baseId, versionId]);
  // Statistiques a jour, comme apres l'autovacuum d'une base en service : sans elles, le
  // planificateur d'une base fraichement remplie peut choisir des jointures aberrantes.
  await db.admin.query('analyze');
}, 600_000);

afterAll(async () => { await db?.stop(); });

type Page = { items: Array<Record<string, unknown>>; total: number };

describe('file « A completer » a l echelle', () => {
  test('la file complete tient sous 8 s et suit la definition par dossier', async () => {
    const { result, ms } = await within8s(async (c) =>
      (await c.query('select public.base_completion_queue_page($1, 500, 0) as q', [baseId])).rows[0].q as Page);
    console.info(`[file] base_completion_queue_page ${PATIENTS} patients : ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(8_000);

    // Reference : la definition par dossier (`record_completion_summary_in_context`, celle
    // qu'appelle `record_completion_summary`), contexte calcule une fois, hors delai.
    const expected = (await db.admin.query(
      `with ctx as (select public.completion_version_context($2) as c)
       select x.* from (
         select p.patient_code as code, 0 as rank, p.created_at, null::uuid as encounter_id,
                public.record_completion_summary_in_context(ctx.c, 'patient', p.data) as s
           from public.patient p, ctx where p.base_id = $1
         union all
         select p.patient_code, 1, e.created_at, e.id,
                public.record_completion_summary_in_context(ctx.c, 'encounter', e.data, e.encounter_type, e.group_section_key)
           from public.encounter e join public.patient p on p.id = e.patient_id, ctx where p.base_id = $1
       ) x where (x.s ->> 'needsCompletion')::boolean
       order by x.code, x.rank, x.created_at`, [baseId, versionId])).rows as Array<{ code: string; encounter_id: string | null; s: { missing: string[]; filled: number; displayed: number } }>;
    expect(result.total).toBe(expected.length);
    expect(result.items.map((i) => [i.code, i.encounterId ?? null, i.missing, i.filledFields, i.displayedFields]))
      .toEqual(expected.slice(0, 500).map((e) => [e.code, e.encounter_id, e.s.missing, e.s.filled, e.s.displayed]));
    // La fixture exerce bien les trois cas : dossiers dans la file, hors file, rencontres.
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThan(PATIENTS * 2);
    expect(result.items.some((i) => i.kind === 'encounter')).toBe(true);
  }, 120_000);

  test('le compteur « A faire » tient sous 8 s', async () => {
    const { result, ms } = await within8s(async (c) =>
      (await c.query('select public.my_todo_counts() as c')).rows[0].c as Array<{ baseId: string; incomplete: number }>);
    console.info(`[file] my_todo_counts : ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(8_000);
    expect(result.find((r) => r.baseId === baseId)?.incomplete).toBe(100);
  }, 120_000);
});
