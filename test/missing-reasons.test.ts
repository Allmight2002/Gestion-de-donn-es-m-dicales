// Test DB des raisons de valeur manquante par variable (L33).
//
// Trois proprietes decident du lot, et chacune a son bloc ci-dessous :
//   1. la reprise de donnees ne change le sens d'AUCUNE variable existante ;
//   2. une fiche portant un ancien code reste lisible ET modifiable ;
//   3. une variable peut proposer « refus » sans se voir imposer « non realise ».
//
// Les chemins de refus comptent autant que les chemins nominaux : c'est eux qui
// empechent une liste de raisons de se vider en silence.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let baseId: string;
let aliceId: string;

const HISTORIQUES = ['non_fait', 'inconnu', 'non_applicable'];

/** Validation serveur d'une fiche portant `value` sur la variable `fieldKey`. */
const validate = (fieldKey: string, value: unknown) =>
  db.admin.query('select public.assert_data_valid($1, $2, $3::jsonb)', [
    versionId, 'encounter', JSON.stringify({ [fieldKey]: value }),
  ]);

const reasonsOf = async (fieldKey: string) =>
  (await db.admin.query(
    'select missing_reasons, allow_missing_codes from public.template_field where template_version_id = $1 and field_key = $2',
    [versionId, fieldKey],
  )).rows[0];

/** Cree une variable de rencontre portant exactement ces raisons. */
async function addField(fieldKey: string, reasons: string[] | null, order: number) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order,
        allow_missing_codes, missing_reasons)
     values($1, $2, $3, 'encounter', 'clinique', 'text', $4, $5, $6)`,
    [versionId, fieldKey, `Libelle ${fieldKey}`, order, (reasons ?? []).length > 0, reasons ?? []],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
  const base = (await db.admin.query(
    'select id, current_template_version_id as v from public.base where owner_user_id = $1 limit 1',
    [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.v;

  await addField('examen_refus', ['refus'], 900);
  await addField('examen_complet', ['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente'], 901);
  await addField('sexe_strict', [], 902);
  await addField('histoire', ['non_fait'], 903);
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------

describe('reprise de donnees : aucune variable existante ne change de sens', () => {
  test('une variable qui acceptait les valeurs manquantes propose EXACTEMENT les trois codes historiques', async () => {
    // Les variables du seed ont ete creees avant la migration : elles portent le comportement
    // d'origine, celui que la reprise devait conserver a l'identique.
    const rows = (await db.admin.query(
      'select field_key, missing_reasons from public.template_field where allow_missing_codes',
    )).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.field_key.startsWith('examen_') || r.field_key === 'histoire') continue;
      expect(r.missing_reasons).toEqual(HISTORIQUES);
    }
  });

  test('une variable qui les refusait n\'en propose aucune', async () => {
    const rows = (await db.admin.query(
      'select missing_reasons from public.template_field where not allow_missing_codes',
    )).rows;
    for (const r of rows) expect(r.missing_reasons).toEqual([]);
  });

  test('les trois codes historiques restent acceptes la ou ils l\'etaient', async () => {
    for (const code of HISTORIQUES) {
      await expect(validate('examen_complet', { __missing__: code })).resolves.toBeDefined();
    }
  });
});

describe('raisons choisies variable par variable', () => {
  test('« refus » est accepte sans que « non fait » soit impose', async () => {
    await expect(validate('examen_refus', { __missing__: 'refus' })).resolves.toBeDefined();
    await expect(validate('examen_refus', { __missing__: 'non_fait' })).rejects.toThrow(/non autorisee/i);
  });

  test('« non documente » est une raison a part entiere', async () => {
    await expect(validate('examen_complet', { __missing__: 'non_documente' })).resolves.toBeDefined();
    await expect(validate('histoire', { __missing__: 'non_documente' })).rejects.toThrow(/non autorisee/i);
  });

  test('aucune raison proposee -> toute valeur manquante refusee', async () => {
    await expect(validate('sexe_strict', { __missing__: 'inconnu' })).rejects.toThrow(/Valeur manquante non autorisee/i);
  });

  test('un code inexistant reste refuse', async () => {
    await expect(validate('examen_complet', { __missing__: 'pas_un_code' })).rejects.toThrow(/invalide/i);
  });

  test('le refus nomme le LIBELLE de la variable et jamais la valeur', async () => {
    await expect(validate('examen_refus', { __missing__: 'inconnu' })).rejects.toThrow(/Libelle examen_refus/);
    // La raison invoquee dit deja quelque chose de la personne : elle ne doit pas remonter.
    await validate('examen_refus', { __missing__: 'inconnu' }).catch((e: Error) => {
      expect(e.message).not.toMatch(/inconnu/);
    });
  });
});

describe('miroir allow_missing_codes <-> missing_reasons', () => {
  test('ecrire la liste met le booleen a jour', async () => {
    await addField('miroir_a', ['refus', 'non_fait'], 910);
    const row = await reasonsOf('miroir_a');
    expect(row.allow_missing_codes).toBe(true);
    // Ordre canonique, pas l'ordre d'ecriture.
    expect(row.missing_reasons).toEqual(['non_fait', 'refus']);
  });

  test('un client ANCIEN qui n\'envoie que le booleen obtient le comportement d\'avant le lot', async () => {
    // Insertion sans la colonne : c'est exactement ce que fait une application non rafraichie.
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order, allow_missing_codes)
       values($1, 'ancien_true', 'Ancien vrai', 'encounter', 'clinique', 'text', 911, true),
             ($1, 'ancien_false', 'Ancien faux', 'encounter', 'clinique', 'text', 912, false)`,
      [versionId],
    );
    expect((await reasonsOf('ancien_true')).missing_reasons).toEqual(HISTORIQUES);
    expect((await reasonsOf('ancien_false')).missing_reasons).toEqual([]);
  });

  test('basculer le seul booleen sur une variable libre traduit dans les deux sens', async () => {
    await addField('bascule', ['refus'], 913);
    const id = (await db.admin.query(
      'select id from public.template_field where template_version_id = $1 and field_key = $2', [versionId, 'bascule'],
    )).rows[0].id;
    await db.admin.query('update public.template_field set allow_missing_codes = false where id = $1', [id]);
    expect((await reasonsOf('bascule')).missing_reasons).toEqual([]);
    await db.admin.query('update public.template_field set allow_missing_codes = true where id = $1', [id]);
    expect((await reasonsOf('bascule')).missing_reasons).toEqual(HISTORIQUES);
  });

  test('une raison inconnue est refusee, jamais ignoree en silence', async () => {
    await expect(addField('inconnue', ['refus', 'jamais_vu'], 914)).rejects.toThrow(/inconnue/i);
  });
});

describe('variable en service : ajouter oui, retirer non', () => {
  let fieldId: string;
  let patientId: string;

  beforeAll(async () => {
    await addField('en_service', ['non_fait', 'inconnu'], 920);
    fieldId = (await db.admin.query(
      'select id from public.template_field where template_version_id = $1 and field_key = $2', [versionId, 'en_service'],
    )).rows[0].id;
    // Une fiche porte desormais cette variable, avec un ANCIEN code manquant.
    patientId = (await db.admin.query(
      `insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
       values($1, 'L33-001', $2, '{}'::jsonb, 'direct', 'draft', $3) returning id`,
      [baseId, versionId, aliceId],
    )).rows[0].id;
    await db.admin.query(
      `insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data, validation_status, created_by)
       values($1, $2, 'consultation', current_date, $3::jsonb, 'draft', $4)`,
      [patientId, versionId, JSON.stringify({ en_service: { __missing__: 'non_fait' } }), aliceId],
    );
  });

  test('ajouter une raison reste possible', async () => {
    await db.admin.query(
      'update public.template_field set missing_reasons = $2 where id = $1',
      [fieldId, ['non_fait', 'inconnu', 'refus']],
    );
    expect((await reasonsOf('en_service')).missing_reasons).toEqual(['non_fait', 'inconnu', 'refus']);
  });

  test('retirer une raison deja en service est refuse', async () => {
    await expect(db.admin.query(
      'update public.template_field set missing_reasons = $2 where id = $1', [fieldId, ['inconnu', 'refus']],
    )).rejects.toThrow(/ne peut plus etre retiree/i);
  });

  test('couper le booleen ne contourne pas le refus', async () => {
    // La voie du client ancien ne doit pas devenir la porte de sortie du garde.
    await expect(db.admin.query(
      'update public.template_field set allow_missing_codes = false where id = $1', [fieldId],
    )).rejects.toThrow(/ne peut plus etre retiree/i);
  });

  test('la fiche portant l\'ancien code reste lisible ET modifiable', async () => {
    const stored = (await db.admin.query(
      'select data from public.encounter where patient_id = $1', [patientId],
    )).rows[0].data;
    expect(stored.en_service).toEqual({ __missing__: 'non_fait' });
    // Modifiable : la revalidation d'une fiche ancienne ne rejette pas son propre contenu.
    await expect(validate('en_service', { __missing__: 'non_fait' })).resolves.toBeDefined();
  });
});

describe('recopie d\'une version a l\'autre', () => {
  test('la liste suit la variable, elle ne retombe pas sur les trois codes historiques', async () => {
    await addField('a_recopier', ['refus', 'non_documente'], 930);
    const templateId = (await db.admin.query(
      'select template_id from public.template_version where id = $1', [versionId],
    )).rows[0].template_id;
    const newVersion = (await db.asUser(aliceId, async (c) =>
      (await c.query('select id from public.create_next_personal_template_version($1)', [templateId])).rows[0].id,
    ));
    const copied = (await db.admin.query(
      'select missing_reasons from public.template_field where template_version_id = $1 and field_key = $2',
      [newVersion, 'a_recopier'],
    )).rows[0];
    expect(copied.missing_reasons).toEqual(['refus', 'non_documente']);
  });
});
