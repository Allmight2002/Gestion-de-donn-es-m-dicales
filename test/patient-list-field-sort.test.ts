// L62 — tri de la liste d'une base par une variable analytique de portee patient.
//
// Ce que ces tests protegent : la cle est resolue par le SERVEUR contre la version active de
// CETTE base ; filtre, ordre, total et page s'appliquent dans cet ordre ; les absents restent
// en fin dans les deux sens ; les egalites se departagent par id ; une cle forgee, d'une autre
// base, hors portee ou d'un type refuse, ou un appelant sans acces, recoivent la meme erreur
// sans la cle ni detail interne ; et l'identite n'est jamais lue.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDb, type TestDb } from './harness/db';

const ALICE = '22222222-2222-2222-2222-222222222222'; // medecin, proprietaire de BASE
const BOB = '33333333-3333-3333-3333-333333333333'; // medecin, proprietaire de AUTRE_BASE
const ANNA = '44444444-4444-4444-4444-444444444444'; // medecin, collaboratrice lecture de BASE
const CURATEUR = '66666666-6666-6666-6666-666666666666'; // curateur, aucun acces

const TEMPLATE = '62000000-0000-0000-0000-00000000a001';
const VERSION = '62000000-0000-0000-0000-00000000b001';
/** Version historique du meme gabarit : porte une variable retiree de la version active. */
const OLD_VERSION = '62000000-0000-0000-0000-00000000b000';
const BASE = '62000000-0000-0000-0000-00000000c001';
const AUTRE_TEMPLATE = '62000000-0000-0000-0000-00000000a002';
const AUTRE_VERSION = '62000000-0000-0000-0000-00000000b002';
const AUTRE_BASE = '62000000-0000-0000-0000-00000000c002';

/** Identifiants ordonnes : le departage par id suit donc le numero. */
const P = (n: number) => `62000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const AUTRE_PATIENT = '62000000-0000-0000-0000-0000000000f1';

const UNAVAILABLE = /PATIENT_SORT_UNAVAILABLE/;
const INVALID = /PATIENT_SORT_INVALID_REQUEST/;

let db: TestDb;

type Page = { total: number; rows: Array<{ id: string; patient_code: string; data: Record<string, unknown> }> };

async function sortAs(
  uid: string, key: string | null, direction: string, limit = 50, offset = 0,
  opts: { base?: string; code?: string | null; ids?: string[] | null } = {},
): Promise<Page> {
  return db.asUser(uid, async (c) => (await c.query(
    'select public.list_patients_by_field($1,$2,$3,$4,$5,$6,$7) as page',
    [opts.base ?? BASE, key, direction, limit, offset, opts.code ?? null, opts.ids ?? null],
  )).rows[0].page as Page);
}

const ids = (page: Page) => page.rows.map((row) => row.id);
const nums = (page: Page) => ids(page).map((id) => Number(id.slice(-2)));

async function rejection(promise: Promise<unknown>): Promise<{ message: string; detail?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { message: string; detail?: string };
  }
  throw new Error('rejet attendu');
}

async function addPatient(n: number, data: Record<string, unknown>, deleted = false, version = VERSION) {
  await db.admin.query(
    `insert into public.patient (id, base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by, deleted_at)
     values ($1, $2, $3, $4, $5::jsonb, 'direct', 'draft', $6, $7)`,
    [P(n), BASE, `L62-${String(n).padStart(3, '0')}`, version, JSON.stringify(data), ALICE, deleted ? new Date() : null],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });

  for (const [template, version, owner] of [[TEMPLATE, VERSION, ALICE], [AUTRE_TEMPLATE, AUTRE_VERSION, BOB]]) {
    await db.admin.query(
      `insert into public.template (id, name, specialty, owner_user_id, is_global) values ($1, 'L62 (fictif)', 'test', $2, false)`,
      [template, owner],
    );
    await db.admin.query(
      `insert into public.template_version (id, template_id, version_number, status, created_by) values ($1, $2, 2, 'draft', $3)`,
      [version, template, owner],
    );
    if (version === VERSION) {
      await db.admin.query(
        `insert into public.template_version (id, template_id, version_number, status, created_by) values ($1, $2, 1, 'draft', $3)`,
        [OLD_VERSION, template, owner],
      );
      await db.admin.query(
        `insert into public.template_section (template_version_id, section_key, label, display_order) values ($1, 'clinique', 'Clinique', 0)`,
        [OLD_VERSION],
      );
    }
    await db.admin.query(
      `insert into public.template_section (template_version_id, section_key, label, display_order) values ($1, 'clinique', 'Clinique', 0)`,
      [version],
    );
  }

  const field = (version: string, key: string, scope: string, type: string, order: number,
    extra: { options?: string[]; values?: string[] } = {}) => db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, allowed_options, allowed_values, required, display_order)
     values ($1, $2, $2, $3, 'clinique', $4, $5::jsonb, $6::jsonb, false, $7)`,
    [version, key, scope, type,
      extra.options ? JSON.stringify(extra.options.map((k) => ({ value_key: k, label: `Grade ${k}`, is_active: true }))) : null,
      extra.values ? JSON.stringify(extra.values) : null, order],
  );
  await field(OLD_VERSION, 'legacy_key', 'patient', 'number', 1);
  await field(VERSION, 'score', 'patient', 'number', 1);
  await field(VERSION, 'dx_date', 'patient', 'date', 2);
  await field(VERSION, 'smoker', 'patient', 'boolean', 3);
  // Ordre des options volontairement NON alphabetique : le tri suit le gabarit.
  await field(VERSION, 'grade', 'patient', 'select', 4, { options: ['III', 'I', 'II'] });
  await field(VERSION, 'note', 'patient', 'text', 5);
  await field(VERSION, 'comorb', 'patient', 'multiselect', 6, { values: ['hta', 'diabete'] });
  await field(VERSION, 'event_dt', 'patient', 'datetime', 7);
  await field(VERSION, 'enc_score', 'encounter', 'number', 8);
  await field(AUTRE_VERSION, 'score', 'patient', 'number', 1);
  await field(AUTRE_VERSION, 'other_only', 'patient', 'number', 2);

  await db.admin.query(
    `insert into public.base (id, name, specialty, owner_user_id, current_template_version_id) values
       ($1, 'Base L62 (fictive)', 'test', $2, $3), ($4, 'Base voisine L62 (fictive)', 'test', $5, $6)`,
    [BASE, ALICE, VERSION, AUTRE_BASE, BOB, AUTRE_VERSION],
  );
  await db.admin.query(
    `insert into public.base_access (base_id, user_id, access_role, can_view_identity, can_view_raw_documents, can_edit_structured_data, can_export_data, can_manage_access, granted_by)
     values ($1, $2, 'viewer', false, false, false, false, false, $3)`,
    [BASE, ANNA, ALICE],
  );

  await addPatient(1, { score: 5, dx_date: '2024-03-01', smoker: true, grade: 'II', note: 'beta', legacy_key: 1 }, false, OLD_VERSION);
  await addPatient(2, { score: 5, dx_date: '2023-12-31', smoker: false, grade: 'III', note: 'Alpha' });
  await addPatient(3, { score: -1.5, dx_date: '2024-03-01', smoker: true, grade: 'I', note: 'élan' });
  // Raison manquante, null JSON, option retiree de la version active, texte vide.
  await addPatient(4, { score: { __missing__: 'inconnu' }, dx_date: null, grade: 'ZZ', note: '' });
  // Types JSON non conformes au type actif : jamais convertis, donc absents.
  await addPatient(5, { score: '12', smoker: 'true', grade: 'I', note: 'alpha' });
  await addPatient(6, {});
  await addPatient(7, { score: 100 }, true); // supprime : jamais renvoye
  await addPatient(8, { score: 5, note: 'Zulu' });

  await db.admin.query(
    `insert into public.patient (id, base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values ($1, $2, 'VOI-001', $3, '{"score": 1, "other_only": 1}'::jsonb, 'direct', 'draft', $4)`,
    [AUTRE_PATIENT, AUTRE_BASE, AUTRE_VERSION, BOB],
  );
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('L62 — ordre par type, absents en fin, egalites par id', () => {
  test.each([
    ['score', 'asc', [3, 1, 2, 8, 4, 5, 6]],
    ['score', 'desc', [1, 2, 8, 3, 4, 5, 6]],
    ['dx_date', 'asc', [2, 1, 3, 4, 5, 6, 8]],
    ['dx_date', 'desc', [1, 3, 2, 4, 5, 6, 8]],
    ['smoker', 'asc', [2, 1, 3, 4, 5, 6, 8]],
    ['smoker', 'desc', [1, 3, 2, 4, 5, 6, 8]],
    // Rang d'option du gabarit (III, I, II), puis option inconnue de la version active.
    ['grade', 'asc', [2, 3, 5, 1, 4, 6, 8]],
    ['grade', 'desc', [4, 1, 3, 5, 2, 6, 8]],
    // Texte replie (casse, accents), puis texte brut : « élan » entre « beta » et « Zulu ».
    ['note', 'asc', [2, 5, 1, 3, 8, 4, 6]],
    ['note', 'desc', [8, 3, 1, 5, 2, 4, 6]],
  ] as const)('%s %s', async (key, direction, expected) => {
    const page = await sortAs(ALICE, key, direction);
    expect(page.total).toBe(7);
    expect(nums(page)).toEqual(expected);
  });

  test('la page reste pseudonymisee : colonnes analytiques seulement', async () => {
    const page = await sortAs(ALICE, 'score', 'asc', 1);
    expect(Object.keys(page.rows[0]).sort()).toEqual(
      ['data', 'id', 'patient_code', 'row_version', 'template_version_id', 'updated_at', 'validation_status'],
    );
  });
});

describe('L62 — filtre, ordre, total puis page', () => {
  test('des pages consecutives couvrent la liste sans repetition ni oubli, total constant', async () => {
    for (const direction of ['asc', 'desc'] as const) {
      const full = ids(await sortAs(ALICE, 'score', direction));
      const seen: string[] = [];
      for (let offset = 0; offset < 8; offset += 2) {
        const page = await sortAs(ALICE, 'score', direction, 2, offset);
        expect(page.total).toBe(7);
        seen.push(...ids(page));
      }
      expect(seen).toEqual(full);
      expect(new Set(seen).size).toBe(7);
    }
    expect(await sortAs(ALICE, 'score', 'asc', 2, 8)).toEqual({ total: 7, rows: [] });
  });

  test('le code filtre AVANT la page, jokers traites comme du texte', async () => {
    const page = await sortAs(ALICE, 'score', 'desc', 1, 0, { code: ' 008 ' });
    expect(page).toMatchObject({ total: 1 });
    expect(nums(page)).toEqual([8]);
    expect((await sortAs(ALICE, 'score', 'asc', 50, 0, { code: 'L62_0' })).total).toBe(0);
    expect((await sortAs(ALICE, 'score', 'asc', 50, 0, { code: '%' })).total).toBe(0);
  });

  test('les ids restreignent a la base : supprime et patient voisin ignores', async () => {
    const page = await sortAs(ALICE, 'score', 'asc', 50, 0, { ids: [P(8), P(3), P(7), AUTRE_PATIENT] });
    expect(page.total).toBe(2);
    expect(nums(page)).toEqual([3, 8]);
    expect(await sortAs(ALICE, 'score', 'asc', 50, 0, { ids: [] })).toEqual({ total: 0, rows: [] });
  });

  test('compatibilite des tris techniques : meme perimetre que la lecture PostgREST existante', async () => {
    // Le tri technique reste servi par la table sous RLS ; la RPC doit filtrer exactement pareil.
    const technical = await db.asUser(ANNA, async (c) => (await c.query(
      `select id from public.patient
        where base_id = $1 and deleted_at is null and patient_code ilike $2
        order by patient_code desc, id asc`, [BASE, '%L62%'],
    )).rows.map((row: { id: string }) => row.id));
    expect(technical.map((id) => Number(id.slice(-2)))).toEqual([8, 6, 5, 4, 3, 2, 1]);
    const variable = await sortAs(ANNA, 'score', 'asc', 50, 0, { code: 'L62' });
    expect(variable.total).toBe(technical.length);
    expect([...ids(variable)].sort()).toEqual([...technical].sort());
  });
});

describe('L62 — autorisation et non-divulgation', () => {
  test('ACL : invoker, executable par authenticated seulement', async () => {
    const rows = (await db.admin.query(
      `select p.prosecdef,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p where p.oid = 'public.list_patients_by_field(uuid,text,text,int,int,text,uuid[])'::regprocedure`,
    )).rows;
    expect(rows).toEqual([{ prosecdef: false, anon: false, authenticated: true }]);
  });

  test('un collaborateur en lecture obtient le meme ordre que le proprietaire', async () => {
    expect(await sortAs(ANNA, 'grade', 'desc')).toEqual(await sortAs(ALICE, 'grade', 'desc'));
  });

  test('sans acces a la base (medecin tiers, curateur) : refus sans donnee', async () => {
    await expect(sortAs(BOB, 'score', 'asc')).rejects.toThrow(UNAVAILABLE);
    await expect(sortAs(CURATEUR, 'score', 'asc')).rejects.toThrow(UNAVAILABLE);
    await expect(sortAs(ALICE, 'score', 'asc', 50, 0, { base: '62000000-0000-0000-0000-00000000c0ff' }))
      .rejects.toThrow(UNAVAILABLE);
  });

  test('inter-base : chaque base resout sa propre version, sans melange', async () => {
    await expect(sortAs(ALICE, 'other_only', 'asc')).rejects.toThrow(UNAVAILABLE);
    const autre = await sortAs(BOB, 'score', 'asc', 50, 0, { base: AUTRE_BASE });
    expect(autre.total).toBe(1);
    expect(ids(autre)).toEqual([AUTRE_PATIENT]);
  });

  test.each([
    ['multiselect', 'comorb'],
    ['datetime sans fuseau de reference', 'event_dt'],
    ['portee rencontre', 'enc_score'],
    ['cle presente dans les donnees mais retiree de la version active', 'legacy_key'],
    ['colonne technique', 'created_at'],
    ['injection', "score' or '1'='1"],
    ['injection 2', 'score); drop table public.patient; --'],
    ['chemin JSON', '{score}'],
    ['cle trop longue', 's'.repeat(201)],
  ])('cle refusee (%s) : erreur uniforme sans la cle', async (_label, key) => {
    const error = await rejection(sortAs(ALICE, key, 'asc'));
    expect(error.message).toMatch(UNAVAILABLE);
    expect(error.message).not.toContain(key);
    expect(JSON.parse(error.detail ?? '{}')).toEqual({ code: 'PATIENT_SORT_UNAVAILABLE' });
  });

  test('cle nulle refusee, et la table patient reste intacte', async () => {
    await expect(sortAs(ALICE, null, 'asc')).rejects.toThrow(UNAVAILABLE);
    expect((await sortAs(ALICE, 'score', 'asc')).total).toBe(7);
  });

  test.each([
    ['sens forge', 'score', 'asc; drop', 10, 0],
    ['sens nul', 'score', null, 10, 0],
    ['page vide', 'score', 'asc', 0, 0],
    ['page trop grande', 'score', 'asc', 201, 0],
    ['decalage negatif', 'score', 'asc', 10, -1],
  ])('requete invalide (%s)', async (_label, key, direction, limit, offset) => {
    await expect(sortAs(ALICE, key, direction as string, limit, offset)).rejects.toThrow(INVALID);
  });

  test('revocation puis base supprimee : refus immediat', async () => {
    await db.admin.query('update public.base_access set revoked_at = now() where base_id = $1 and user_id = $2', [BASE, ANNA]);
    await expect(sortAs(ANNA, 'score', 'asc')).rejects.toThrow(UNAVAILABLE);
    await db.admin.query('update public.base_access set revoked_at = null where base_id = $1 and user_id = $2', [BASE, ANNA]);
    expect((await sortAs(ANNA, 'score', 'asc')).total).toBe(7);

    await db.admin.query('update public.base set deleted_at = now() where id = $1', [AUTRE_BASE]);
    await expect(sortAs(BOB, 'score', 'asc', 50, 0, { base: AUTRE_BASE })).rejects.toThrow(UNAVAILABLE);
  });
});

// Mesure, pas un seuil : `L62_PERF=1 npx vitest run --project db test/patient-list-field-sort.test.ts -t mesure`.
// Le rapport est ecrit dans `<tmpdir>/l62-mesure.txt` : la console d'un test reussi peut etre masquee.
describe.skipIf(!process.env.L62_PERF)('L62 — mesure sur fixture representative', () => {
  test('temps de page, premiere et profonde, par taille de base', async () => {
    const report: string[] = [];
    for (const size of [2_000, 20_000]) {
      const base = `62000000-0000-0000-0000-0000000${String(size).padStart(5, '0')}`;
      await db.admin.query(
        `insert into public.base (id, name, specialty, owner_user_id, current_template_version_id)
         values ($1, 'Base mesure L62 (fictive)', 'test', $2, $3)`, [base, ALICE, VERSION],
      );
      // 10 % d'absents, nombreuses egalites sur le score, texte et options varies.
      const insertStart = performance.now();
      await db.admin.query(
        `insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
         select $1, 'M-' || lpad(g::text, 6, '0'), $2,
                case when g % 10 = 0 then '{}'::jsonb else jsonb_build_object(
                  'score', (g * 7919) % 700 / 10.0,
                  'note', 'note ' || md5(g::text),
                  'grade', (array['I','II','III'])[1 + g % 3],
                  'dx_date', to_char(date '2020-01-01' + (g * 37) % 1500, 'YYYY-MM-DD')) end,
                'direct', 'draft', $3
           from generate_series(1, $4) g`, [base, VERSION, ALICE, size],
      );
      const insertMs = (performance.now() - insertStart).toFixed(0);
      await db.admin.query('analyze public.patient');
      // Mediane de 5 executions sur UNE connexion authentifiee, apres une execution a blanc :
      // le temps mesure est celui de la requete, pas l'ouverture de connexion du harnais.
      const time = (sql: string, args: unknown[]) => db.asUser(ALICE, async (c) => {
        await c.query(sql, args);
        const samples: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const start = performance.now();
          await c.query(sql, args);
          samples.push(performance.now() - start);
        }
        return samples.sort((a, b) => a - b)[2].toFixed(1);
      });
      const rpc = 'select public.list_patients_by_field($1,$2,$3,20,$4)';
      report.push(`${size} patients (insertion ${insertMs} ms) :`
        + ` score p1 ${await time(rpc, [base, 'score', 'asc', 0])} ms,`
        + ` score profonde ${await time(rpc, [base, 'score', 'desc', size - 40])} ms,`
        + ` note p1 ${await time(rpc, [base, 'note', 'asc', 0])} ms,`
        + ` grade p1 ${await time(rpc, [base, 'grade', 'asc', 0])} ms,`
        + ` dx_date p1 ${await time(rpc, [base, 'dx_date', 'desc', 0])} ms,`
        + ` technique patient_code p1 ${await time(
          `select id, data, count(*) over () from public.patient where base_id = $1 and deleted_at is null
            order by patient_code, id limit 20 offset $2`, [base, 0])} ms`);
    }
    writeFileSync(join(tmpdir(), 'l62-mesure.txt'), `${report.join('\n')}\n`);
  }, 600_000);
});
