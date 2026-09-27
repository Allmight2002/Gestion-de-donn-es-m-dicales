// L73 : le validateur de version construit le graphe de visibilité une seule fois.
// Toutes les migrations sont appliquées : ce fichier exerce la version finale du validateur,
// à l'échelle signalée en production (402 variables, 62 sections, 238 règles), avec des
// blocs chaînés dont les sous-sections sont dépliées. Données entièrement fictives.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { performance } from 'node:perf_hooks';
import { startTestDb, type TestDb } from './harness/db.js';

const ROOTS = 31;
const FIELD_COUNT = 402;
const SECTIONED_FIELDS = 372;
const LATTICE = 28;

let db: TestDb;
let alice: string;

type Rule = Record<string, unknown>;

const fieldRule = (driver: string, target: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { field: target, operator: 'visible' },
});
const blockRule = (driver: string, section: string): Rule => ({
  if: { field: driver, operator: 'equals', value: 'oui' },
  then: { section, operator: 'visible' },
});

// Sections : r0..r30 et une sous-section s_i sous chaque r_i. Les variables 0..371 sont
// réparties sur les 62 sections ; les 30 dernières (c0..c29) forment le tronc commun.
const sectionOf = (k: number) => (k % 2 === 0 ? `r${(k / 2) % ROOTS}` : `s${((k - 1) / 2) % ROOTS}`);
const sectionedKey = (k: number) => `f${k}_${sectionOf(k)}`;
const firstFieldIn = (section: string) => {
  for (let k = 0; k < SECTIONED_FIELDS; k += 1) if (sectionOf(k) === section) return sectionedKey(k);
  throw new Error(section);
};

async function createVersion(name: string): Promise<string> {
  const templateId = (await db.admin.query(
    'insert into public.template(name, owner_user_id, is_global) values ($1,$2,false) returning id',
    [name, alice],
  )).rows[0].id as string;
  return (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values ($1,1,'draft',$2) returning id",
    [templateId, alice],
  )).rows[0].id as string;
}

async function insertFields(versionId: string, fields: Array<{ key: string; section: string | null }>) {
  await db.admin.query(
    `insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order)
     select $1, f.key, f.key, 'patient', f.section, 'text', f.ord
       from jsonb_to_recordset($2::jsonb) as f(key text, section text, ord integer)`,
    [versionId, JSON.stringify(fields.map((f, ord) => ({ ...f, ord })))],
  );
}

// Une seule instruction : gardes par ligne puis validateur par instruction, tous actifs.
async function seedRules(versionId: string, rules: Rule[]) {
  await db.admin.query(
    `insert into public.validation_rule(template_version_id, rule, message, severity)
     select $1, r, 'Regle fictive', 'block' from jsonb_array_elements($2::jsonb) as r`,
    [versionId, JSON.stringify(rules)],
  );
}

const within8s = async <T>(fn: (c: import('pg').Client) => Promise<T>) => {
  const started = performance.now();
  const result = await db.asUser(alice, async (c) => {
    await c.query("set local statement_timeout = '8s'");
    return fn(c);
  });
  return { result, ms: performance.now() - started };
};

const parentOf = async (versionId: string, key: string) => (await db.admin.query(
  `select p.section_key from public.template_section s
     left join public.template_section p on p.id = s.parent_section_id
    where s.template_version_id = $1 and s.section_key = $2`, [versionId, key],
)).rows[0].section_key as string | null;

let scaleVersion: string;
const sectionId = async (versionId: string, key: string) => (await db.admin.query(
  'select id from public.template_section where template_version_id=$1 and section_key=$2', [versionId, key],
)).rows[0].id as string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  alice = (await db.admin.query("select id from auth.users where email='alice@demo.test'")).rows[0].id as string;

  scaleVersion = await createVersion('L73 échelle fictive');
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     select $1, 'r' || i, 'Bloc ' || i, i from generate_series(0, $2 - 1) i`,
    [scaleVersion, ROOTS],
  );
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order, parent_section_id)
     select $1, 's' || i, 'Sous-section ' || i, $2 + i, r.id
       from generate_series(0, $2 - 1) i
       join public.template_section r on r.template_version_id = $1 and r.section_key = 'r' || i`,
    [scaleVersion, ROOTS],
  );
  const fields: Array<{ key: string; section: string | null }> = Array.from(
    { length: SECTIONED_FIELDS }, (_, k) => ({ key: sectionedKey(k), section: sectionOf(k) }),
  );
  for (let i = 0; i < FIELD_COUNT - SECTIONED_FIELDS; i += 1) fields.push({ key: `c${i}`, section: null });
  await insertFields(scaleVersion, fields);

  const rules: Rule[] = [];
  // 30 blocs chaînés : r_i dépend d'une variable de s_{i-1}, dépliée avec sa sous-section.
  for (let i = 1; i < ROOTS; i += 1) rules.push(blockRule(firstFieldIn(`s${i - 1}`), `r${i}`));
  // Treillis en losange sur c0..c27 : c_i dépend de c_{i-1} ET de c_{i-2}.
  for (let i = 1; i < LATTICE; i += 1) rules.push(fieldRule(`c${i - 1}`, `c${i}`));
  for (let i = 2; i < LATTICE; i += 1) rules.push(fieldRule(`c${i - 2}`, `c${i}`));
  // Règles de champ : le tronc commun pilote des variables de section.
  for (let k = 0; rules.length < 238; k += 1) rules.push(fieldRule(`c${k % LATTICE}`, sectionedKey(k)));
  await seedRules(scaleVersion, rules);
}, 600_000);

afterAll(async () => { await db?.stop(); });

describe('validation du graphe de visibilité à l’échelle', () => {
  test('la fixture a la taille signalée', async () => {
    expect((await db.admin.query(`select
      (select count(*)::int from public.template_field where template_version_id=$1) as fields,
      (select count(*)::int from public.template_section where template_version_id=$1) as sections,
      (select count(*)::int from public.validation_rule where template_version_id=$1) as rules`,
    [scaleVersion])).rows[0]).toEqual({ fields: 402, sections: 62, rules: 238 });
  });

  test('déplacer une sous-section reste sous 8 s', async () => {
    const s25 = await sectionId(scaleVersion, 's25');
    const { ms } = await within8s((c) => c.query(
      'select public.move_template_section($1,$2,$3)', [scaleVersion, s25, 'r3'],
    ));
    expect(await parentOf(scaleVersion, 's25')).toBe('r3');
    expect(ms).toBeLessThan(8_000);
    console.info(`[L73] move_template_section 402/62/238 : ${ms.toFixed(0)} ms`);
  }, 30_000);

  test('un déplacement qui ferme un cycle via les blocs est refusé et annulé', async () => {
    // s5 pilote r6 ; sous r20, ses variables dépendraient de r20 -> s19 -> ... -> r6 -> s5.
    const s5 = await sectionId(scaleVersion, 's5');
    await expect(within8s((c) => c.query(
      'select public.move_template_section($1,$2,$3)', [scaleVersion, s5, 'r20'],
    ))).rejects.toThrow(/circulaire/);
    expect(await parentOf(scaleVersion, 's5')).toBe('r5');
  }, 30_000);

  test('créer une règle, directement ou par lot, reste sous 8 s', async () => {
    const direct = await within8s((c) => c.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values ($1,$2,'Fictive','block')",
      [scaleVersion, JSON.stringify(fieldRule('c28', 'c29'))],
    ));
    expect(direct.ms).toBeLessThan(8_000);

    const block = await within8s((c) => c.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values ($1,$2,'Fictive','block')",
      [scaleVersion, JSON.stringify(blockRule('c29', 'r0'))],
    ));
    expect(block.ms).toBeLessThan(8_000);

    const payload = JSON.stringify({
      condition: { field: 'c28', operator: 'equals', value: 'oui' },
      effect: 'visible',
      targets: [sectionedKey(300), sectionedKey(301), sectionedKey(302)],
    });
    const planned = (await db.asUser(alice, (c) => c.query(
      'select public.preview_rule_batch($1,$2::jsonb) as r', [scaleVersion, payload],
    ))).rows[0].r as { fingerprint: string; invalid: unknown[] };
    expect(planned.invalid).toEqual([]);
    const batch = await within8s((c) => c.query(
      'select public.create_rule_batch($1,$2,$3::jsonb,$4) as r',
      [scaleVersion, crypto.randomUUID(), payload, planned.fingerprint],
    ));
    expect(batch.result.rows[0].r.created).toHaveLength(3);
    expect(batch.ms).toBeLessThan(8_000);
    console.info(`[L73] règle ${direct.ms.toFixed(0)} ms, bloc ${block.ms.toFixed(0)} ms, lot ${batch.ms.toFixed(0)} ms`);
  }, 30_000);

  test('une règle qui referme le treillis est refusée', async () => {
    await expect(within8s((c) => c.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values ($1,$2,'Fictive','block')",
      [scaleVersion, JSON.stringify(fieldRule(`c${LATTICE - 1}`, 'c0'))],
    ))).rejects.toThrow(/circulaire/);
  }, 30_000);
});

describe('coût du graphe en losange', () => {
  test('60 variables en treillis se valident sans énumérer les chemins, le cycle reste détecté', async () => {
    // Environ 10^12 chemins distincts relient n59 à n0 : une énumération de chemins
    // dépasserait toute limite, la fermeture sur des paires reste instantanée.
    const version = await createVersion('L73 treillis fictif');
    const n = 60;
    await insertFields(version, Array.from({ length: n }, (_, i) => ({ key: `n${i}`, section: null })));
    const rules: Rule[] = [];
    for (let i = 1; i < n; i += 1) rules.push(fieldRule(`n${i - 1}`, `n${i}`));
    for (let i = 2; i < n; i += 1) rules.push(fieldRule(`n${i - 2}`, `n${i}`));
    await seedRules(version, rules);

    const { ms } = await within8s((c) => c.query(
      "update public.template_field set label = label || ' modifiee' where template_version_id=$1 and field_key='n0'",
      [version],
    ));
    expect(ms).toBeLessThan(8_000);

    // La garde BEFORE ROW ne rejoue plus le graphe : c'est le validateur par instruction
    // qui refuse ce cycle, dans la même instruction.
    await expect(within8s((c) => c.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values ($1,$2,'Fictive','block')",
      [version, JSON.stringify(fieldRule(`n${n - 1}`, 'n0'))],
    ))).rejects.toThrow(/circulaire : n\d+ finirait/);
    expect((await db.admin.query(
      'select count(*)::int as c from public.validation_rule where template_version_id=$1', [version],
    )).rows[0].c).toBe(rules.length);
  }, 60_000);
});
