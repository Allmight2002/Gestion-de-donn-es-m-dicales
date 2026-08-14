// Tests DB de la VALEUR PROPOSEE a la saisie (L28).
//
// Le point cardinal du lot : la proposition decrit la SAISIE, jamais la donnee. Le serveur
// ne l'ecrit nulle part de lui-meme -- une proposition effacee par la personne qui saisit
// reste vide en base. Les tests ci-dessous le prouvent sur les deux voies d'ecriture
// (creation et correction), puis verifient que la proposition ne peut pas etre enregistree
// incoherente avec sa variable, et qu'elle survit a la duplication d'un jeu de variables.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;   // medecin proprietaire de la base et de son jeu de variables
let adminId: string;   // administrateur systeme (promotion en modele global)
let baseId: string;
let versionId: string;

const asAlice = <T>(fn: (c: Client) => Promise<T>) => db.asUser(aliceId, fn);
const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

/** Ajoute une variable au jeu de variables de la base, avec sa proposition. */
const addField = (
  fieldKey: string,
  type: string,
  defaultValue: string | null,
  extra: { allowedValues?: string; minValue?: number; maxValue?: number; scope?: string } = {},
) =>
  rowsAs(
    aliceId,
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, default_value, allowed_values, min_value, max_value)
     values ($1, $2, $3, $4, 'clinique', $5, $6, $7, $8, $9) returning id, default_value`,
    [
      versionId, fieldKey, fieldKey, extra.scope ?? 'patient', type, defaultValue,
      extra.allowedValues ?? null, extra.minValue ?? null, extra.maxValue ?? null,
    ],
  );

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  adminId = byEmail.get('admin@demo.test')!;
  const base = (await db.admin.query(
    'select id, current_template_version_id as v from public.base where owner_user_id = $1 and deleted_at is null limit 1',
    [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.v;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('la colonne est additive', () => {
  test('les variables existantes n\'ont aucune proposition', async () => {
    const rows = await db.admin.query(
      'select count(*)::int as n from public.template_field where default_value is not null',
    );
    expect(rows.rows[0].n).toBe(0);
  });
});

describe('une proposition doit etre coherente avec sa variable', () => {
  test('un nombre est refuse sur une variable numerique quand ce n\'est pas un nombre', async () => {
    await expect(addField('poids_defaut', 'number', 'beaucoup')).rejects.toThrow(/nombre est attendu/i);
  });

  test('un entier refuse une valeur decimale', async () => {
    await expect(addField('parite_defaut', 'integer', '2.5')).rejects.toThrow(/entier est attendu/i);
  });

  test('les bornes de la variable s\'appliquent a la proposition', async () => {
    await expect(addField('temp_defaut', 'number', '45', { minValue: 30, maxValue: 42 }))
      .rejects.toThrow(/hors bornes/i);
  });

  test('une date invalide est refusee, le jeton du jour est accepte', async () => {
    await expect(addField('date_invalide', 'date', '32/13/2026')).rejects.toThrow(/date est attendue/i);
    const ok = await addField('date_consultation', 'date', '__today__');
    expect(ok[0].default_value).toBe('__today__');
  });

  test('une proposition absente de la liste est refusee', async () => {
    await expect(addField('pays_hors_liste', 'select', 'Cameroun', { allowedValues: '["Tchad","Niger"]' }))
      .rejects.toThrow(/absente de la liste/i);
    const ok = await addField('pays', 'select', 'Tchad', { allowedValues: '["Tchad","Niger"]' });
    expect(ok[0].default_value).toBe('Tchad');
  });

  test('oui/non n\'accepte que oui ou non', async () => {
    await expect(addField('fievre_defaut', 'boolean', 'peut-etre')).rejects.toThrow(/oui ou non attendu/i);
  });

  // Proposer un diagnostic ou un jeu de modalites ne fait pas gagner une frappe : il repond.
  test('aucune proposition n\'est possible sur une liste multiple ni sur un diagnostic', async () => {
    await expect(addField('antecedents', 'multiselect', 'diabete', { allowedValues: '["diabete"]' }))
      .rejects.toThrow(/oriente la saisie/i);
    await expect(addField('diag', 'terminology', 'I10')).rejects.toThrow(/oriente la saisie/i);
  });

  test('une proposition vide vaut absence de proposition', async () => {
    const rows = await addField('note_libre', 'text', '   ');
    expect(rows[0].default_value).toBeNull();
  });
});

describe('le serveur n\'ecrit jamais la proposition de lui-meme', () => {
  test('une fiche creee sans la variable proposee ne recoit AUCUNE valeur', async () => {
    // « date_consultation » porte la proposition « date du jour ». La creation n'envoie pas
    // la cle : le serveur ne doit pas la fabriquer.
    const created = await asAlice(async (c) => (await c.query(
      "select (public.create_patient($1,$2,null,null,null,null,null,$3::jsonb)).id as id",
      [baseId, 'P-DEFAUT-1', JSON.stringify({})],
    )).rows[0].id);
    expect(created).toBeTruthy();
    const stored = (await db.admin.query(
      'select data from public.patient where base_id = $1 and patient_code = $2',
      [baseId, 'P-DEFAUT-1'],
    )).rows[0].data;
    expect(stored).toEqual({});
    expect(Object.keys(stored)).not.toContain('date_consultation');
  });

  test('une proposition EFFACEE a la saisie reste vide apres correction', async () => {
    // La fiche part avec la valeur proposee ; la personne l'efface et enregistre.
    const patientId: string = await asAlice(async (c) => (await c.query(
      "select (public.create_patient($1,$2,null,null,null,null,null,$3::jsonb)).id as id",
      [baseId, 'P-DEFAUT-2', JSON.stringify({ date_consultation: '2026-08-14', pays: 'Tchad' })],
    )).rows[0].id);
    const version = (await db.admin.query('select row_version from public.patient where id = $1', [patientId]))
      .rows[0].row_version;

    await asAlice(async (c) => c.query(
      'select public.update_patient($1, $2::jsonb, null, $3, $4)',
      [patientId, JSON.stringify({ pays: 'Tchad' }), 'correction', version],
    ));

    const stored = (await db.admin.query('select data from public.patient where id = $1', [patientId])).rows[0].data;
    expect(stored).toEqual({ pays: 'Tchad' });
    expect(stored.date_consultation).toBeUndefined();
  });
});

describe('la proposition suit le jeu de variables', () => {
  test('dupliquer une version conserve proposition ET consigne de saisie', async () => {
    await rowsAs(aliceId, 'update public.template_field set description = $2 where template_version_id = $1 and field_key = $3', [
      versionId, 'Date de la consultation, pas de la saisie', 'date_consultation',
    ]);
    const next = await rowsAs(aliceId, `select (public.create_next_personal_template_version(
        (select template_id from public.template_version where id = $1))).id as v`, [versionId]);
    const copiedVersionId = next[0].v as string;
    const copied = (await db.admin.query(
      'select default_value, description from public.template_field where template_version_id = $1 and field_key = $2',
      [copiedVersionId, 'date_consultation'],
    )).rows[0];
    expect(copied.default_value).toBe('__today__');
    expect(copied.description).toBe('Date de la consultation, pas de la saisie');
  });

  test('la promotion en modele global conserve la proposition et les types de rencontre', async () => {
    // La promotion copie la DERNIERE version du gabarit : c'est donc celle-la qu'on garnit
    // (le test precedent en a cree une nouvelle).
    const templateId = (await db.admin.query('select template_id from public.template_version where id = $1', [versionId]))
      .rows[0].template_id;
    const latestVersionId = (await db.admin.query(
      'select id from public.template_version where template_id = $1 order by version_number desc limit 1',
      [templateId],
    )).rows[0].id;
    await rowsAs(aliceId, `insert into public.template_field
      (template_version_id, field_key, label, scope, section, type, default_value, encounter_types)
      values ($1,'motif','Motif','encounter','clinique','text','consultation externe', array['consultation'])`, [latestVersionId]);

    const promotedTemplateId = (await rowsAs(adminId, 'select (public.promote_template_to_global($1)).id as id', [templateId]))[0].id;
    const promoted = (await db.admin.query(
      `select tf.default_value, tf.encounter_types from public.template_field tf
         join public.template_version tv on tv.id = tf.template_version_id
        where tv.template_id = $1 and tf.field_key = 'motif'`,
      [promotedTemplateId],
    )).rows[0];
    // Les types de rencontre etaient perdus par cette copie avant L28 : la liste des colonnes
    // recopiees vit desormais a un seul endroit.
    expect(promoted.default_value).toBe('consultation externe');
    expect(promoted.encounter_types).toEqual(['consultation']);
  });

  test('l\'instantane hors-ligne transporte la proposition', async () => {
    const snap = await asAlice(async (c) => (await c.query('select public.download_base_snapshot($1) as s', [baseId])).rows[0].s);
    const field = (snap.fields as { fieldKey: string; defaultValue: string | null }[])
      .find((f) => f.fieldKey === 'date_consultation');
    expect(field?.defaultValue).toBe('__today__');
  });
});

describe('modification d\'une variable deja utilisee', () => {
  test('la proposition reste modifiable, le comportement reste verrouille', async () => {
    // Variable REELLEMENT utilisee : une fiche porte deja une valeur pour cette cle.
    const field = (await db.admin.query(
      'select id, field_key, label, scope, section, type from public.template_field where template_version_id = $1 and field_key = $2',
      [versionId, 'pays'],
    )).rows[0];
    await asAlice(async (c) => c.query(
      "select public.create_patient($1,$2,null,null,null,null,null,$3::jsonb)",
      [baseId, 'P-DEFAUT-3', JSON.stringify({ pays: 'Tchad' })],
    ));

    const updated = await rowsAs(aliceId, `select public.update_template_field(
        $1, $2, $3, null, $4, $5, $6, $7, false, null, $8::jsonb, null, null, null, true
      ) as f`, [
      field.id, field.field_key, field.label, 'Niger', field.scope, field.section, field.type,
      '["Tchad","Niger"]',
    ]);
    expect(updated).toHaveLength(1);
    const stored = (await db.admin.query('select default_value from public.template_field where id = $1', [field.id])).rows[0];
    expect(stored.default_value).toBe('Niger');

    // En revanche le TYPE d'une variable en service reste refuse.
    await expect(rowsAs(aliceId, `select public.update_template_field(
        $1, $2, $3, null, $4, $5, $6, 'text', false, null, $7::jsonb, null, null, null, true
      )`, [field.id, field.field_key, field.label, 'Niger', field.scope, field.section, '["Tchad","Niger"]']))
      .rejects.toThrow(/deja utilisee/i);
  });
});
