// Test DB des codes internes d'options de liste (L30).
//
// Le lot tient sur trois promesses, et chacune a son bloc ci-dessous :
//   1. la reprise ne touche AUCUNE donnee : le code d'une option deja en service est la
//      chaine elle-meme, donc les fiches portent deja leur code ;
//   2. renommer une option d'une variable DEJA UTILISEE est desormais possible, et la
//      fiche reste valide, reste modifiable et compte pour UNE seule modalite ;
//   3. la conversion des orphelins repare ce que les renommages anterieurs ont casse,
//      sans jamais deviner : une valeur non rapprochable bloque sa fiche et est rapportee.
//
// Les chemins de refus comptent autant que les chemins nominaux : ce sont eux qui
// empechent une option de disparaitre en silence d'une liste en service.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let templateId: string;
let baseId: string;
let aliceId: string;
let bobId: string;

interface Option { value_key: string; label: string; is_active: boolean }

const optionsOf = async (fieldKey: string): Promise<{ allowed_options: Option[] | null; allowed_values: string[] | null }> =>
  (await db.admin.query(
    'select allowed_options, allowed_values from public.template_field where template_version_id = $1 and field_key = $2',
    [versionId, fieldKey],
  )).rows[0];

const fieldId = async (fieldKey: string): Promise<string> =>
  (await db.admin.query(
    'select id from public.template_field where template_version_id = $1 and field_key = $2',
    [versionId, fieldKey],
  )).rows[0].id;

/** Validation serveur d'une fiche de rencontre portant `value` sur `fieldKey`. */
const validate = (fieldKey: string, value: unknown, scope = 'encounter') =>
  db.admin.query('select public.assert_data_valid($1, $2, $3::jsonb)', [
    versionId, scope, JSON.stringify({ [fieldKey]: value }),
  ]);

const setOptions = (fieldKey: string, options: Option[]) =>
  db.admin.query(
    `update public.template_field set allowed_options = $3::jsonb
      where template_version_id = $1 and field_key = $2`,
    [versionId, fieldKey, JSON.stringify(options)],
  );

/** Ce qu'ecrit un client ANTERIEUR au lot : la seule liste de cles. */
const setValues = (fieldKey: string, values: string[]) =>
  db.admin.query(
    `update public.template_field set allowed_values = $3::jsonb
      where template_version_id = $1 and field_key = $2`,
    [versionId, fieldKey, JSON.stringify(values)],
  );

async function addSelectField(
  fieldKey: string,
  values: string[],
  order: number,
  opts: { type?: 'select' | 'multiselect'; scope?: 'patient' | 'encounter' } = {},
) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, allowed_values)
     values ($1, $2, $3, $4, 'clinique', $5, $6, $7::jsonb)`,
    [versionId, fieldKey, `Libelle ${fieldKey}`, opts.scope ?? 'encounter', opts.type ?? 'select',
      order, JSON.stringify(values)],
  );
}

/** Cree une rencontre portant `data`, rattachee a un patient de la base. */
async function addEncounter(code: string, data: Record<string, unknown>): Promise<string> {
  const patientId = (await db.admin.query(
    `insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values ($1, $2, $3, '{}'::jsonb, 'direct', 'draft', $4) returning id`,
    [baseId, code, versionId, aliceId],
  )).rows[0].id;
  return (await db.admin.query(
    `insert into public.encounter
       (patient_id, template_version_id, encounter_type, encounter_date, data, collection_mode, validation_status, created_by)
     values ($1, $2, 'consultation', date '2026-08-01', $3::jsonb, 'direct', 'draft', $4) returning id`,
    [patientId, versionId, JSON.stringify(data), aliceId],
  )).rows[0].id;
}

const dataOfEncounter = async (id: string) =>
  (await db.admin.query('select data from public.encounter where id = $1', [id])).rows[0].data;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
  bobId = (await db.admin.query("select id from auth.users where email = 'bob@demo.test'")).rows[0].id;
  const base = (await db.admin.query(
    'select id, current_template_version_id as v from public.base where owner_user_id = $1 limit 1',
    [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.v;
  templateId = (await db.admin.query(
    'select template_id from public.template_version where id = $1', [versionId],
  )).rows[0].template_id;

  await addSelectField('l30_evolution', ['gueri', 'sequelles', 'deces'], 800);
  await addSelectField('l30_libre', ['alpha', 'beta'], 801);
  await addSelectField('l30_multi', ['rouge', 'vert', 'bleu'], 802, { type: 'multiselect' });
  await addSelectField('l30_orphelin', ['hématome', 'oedeme'], 803);
  await addSelectField('l30_ambigu', ['Choc', 'choc'], 804);
  await addSelectField('l30_multi_orph', ['rouge', 'vert'], 805, { type: 'multiselect' });
  await addSelectField('l30_defaut', ['oui', 'non'], 806);
  await addSelectField('l30_intact', ['a', 'b'], 807);
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
// 1. Reprise : aucune donnee touchee
// ---------------------------------------------------------------------------

describe('reprise des listes existantes', () => {
  test('les listes du seed portent des options dont le code EST la chaine deja stockee', async () => {
    const row = (await db.admin.query(
      "select allowed_values, allowed_options from public.template_field where template_version_id = $1 and field_key = 'sexe'",
      [versionId],
    )).rows[0];
    expect(row.allowed_values).toEqual(['M', 'F']);
    expect(row.allowed_options).toEqual([
      { value_key: 'M', label: 'M', is_active: true },
      { value_key: 'F', label: 'F', is_active: true },
    ]);
  });

  test('une fiche saisie avant le lot reste valide sans aucune reecriture', async () => {
    await expect(validate('sexe', 'M', 'patient')).resolves.toBeDefined();
  });

  test('allowed_values reste le miroir exact des codes, dans l ordre', async () => {
    const { allowed_values, allowed_options } = await optionsOf('l30_evolution');
    expect(allowed_values).toEqual(['gueri', 'sequelles', 'deces']);
    expect(allowed_options?.map((o) => o.value_key)).toEqual(allowed_values);
    expect(allowed_options?.every((o) => o.is_active)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Variable deja utilisee : ce qui est autorise, ce qui ne l'est pas
// ---------------------------------------------------------------------------

describe('variable deja utilisee', () => {
  let encounterId: string;

  beforeAll(async () => {
    encounterId = await addEncounter('L30-USED', { l30_evolution: 'gueri' });
    // La variable est bien reputee « en service » : c'est la condition de tous les refus.
    expect((await db.admin.query('select public.template_field_in_use($1) as v', [await fieldId('l30_evolution')])).rows[0].v)
      .toBe(true);
  });

  test('RENOMMER un libelle est accepte, et la fiche reste valide et modifiable', async () => {
    await setOptions('l30_evolution', [
      { value_key: 'gueri', label: 'Guéri', is_active: true },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
      { value_key: 'deces', label: 'Décès', is_active: true },
    ]);
    const { allowed_values, allowed_options } = await optionsOf('l30_evolution');
    // Le code n'a pas bouge : c'est tout l'objet du lot.
    expect(allowed_values).toEqual(['gueri', 'sequelles', 'deces']);
    expect(allowed_options?.[0]).toEqual({ value_key: 'gueri', label: 'Guéri', is_active: true });

    // La fiche deja saisie reste valide...
    await expect(validate('l30_evolution', 'gueri')).resolves.toBeDefined();
    // ... et reste modifiable par la voie ordinaire.
    await expect(db.asUser(aliceId, (c) => c.query(
      'select public.update_encounter($1, $2::jsonb, $3, $4)',
      [encounterId, JSON.stringify({ l30_evolution: 'gueri' }), 'draft', 'relecture'],
    ))).resolves.toBeDefined();
  });

  test('AJOUTER une option est accepte', async () => {
    await setOptions('l30_evolution', [
      { value_key: 'gueri', label: 'Guéri', is_active: true },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
      { value_key: 'deces', label: 'Décès', is_active: true },
      { value_key: 'perdu_de_vue', label: 'Perdu de vue', is_active: true },
    ]);
    expect((await optionsOf('l30_evolution')).allowed_values)
      .toEqual(['gueri', 'sequelles', 'deces', 'perdu_de_vue']);
  });

  test('DESACTIVER une option est accepte, et la fiche qui la porte reste valide', async () => {
    await setOptions('l30_evolution', [
      { value_key: 'gueri', label: 'Guéri', is_active: false },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
      { value_key: 'deces', label: 'Décès', is_active: true },
      { value_key: 'perdu_de_vue', label: 'Perdu de vue', is_active: true },
    ]);
    // Une option desactivee reste dans le miroir : la validation reste SANS ETAT, et la
    // fiche qui la porte reste ecrivable sans cas particulier.
    expect((await optionsOf('l30_evolution')).allowed_values).toContain('gueri');
    await expect(validate('l30_evolution', 'gueri')).resolves.toBeDefined();
  });

  test('REORDONNER est accepte et se voit dans le miroir', async () => {
    await setOptions('l30_evolution', [
      { value_key: 'deces', label: 'Décès', is_active: true },
      { value_key: 'gueri', label: 'Guéri', is_active: false },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
      { value_key: 'perdu_de_vue', label: 'Perdu de vue', is_active: true },
    ]);
    expect((await optionsOf('l30_evolution')).allowed_values)
      .toEqual(['deces', 'gueri', 'sequelles', 'perdu_de_vue']);
  });

  test('RETIRER une option est refuse', async () => {
    await expect(setOptions('l30_evolution', [
      { value_key: 'deces', label: 'Décès', is_active: true },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
    ])).rejects.toThrow(/ne peut plus etre retiree/i);
  });

  test('CHANGER un code est refuse (c est un retrait deguise)', async () => {
    await expect(setOptions('l30_evolution', [
      { value_key: 'gueri_v2', label: 'Guéri', is_active: true },
      { value_key: 'sequelles', label: 'Séquelles', is_active: true },
      { value_key: 'deces', label: 'Décès', is_active: true },
      { value_key: 'perdu_de_vue', label: 'Perdu de vue', is_active: true },
    ])).rejects.toThrow(/ne peut plus etre retiree/i);
  });

  test('vider la liste d une variable en service est refuse', async () => {
    await expect(setValues('l30_evolution', [])).rejects.toThrow(/ne peut plus etre retiree/i);
  });

  test('sur une variable SANS donnee, retirer une option reste libre', async () => {
    await setOptions('l30_libre', [{ value_key: 'alpha', label: 'Alpha', is_active: true }]);
    expect((await optionsOf('l30_libre')).allowed_values).toEqual(['alpha']);
  });
});

// ---------------------------------------------------------------------------
// 3. Miroir et compatibilite des clients anciens
// ---------------------------------------------------------------------------

describe('miroir allowed_values', () => {
  test('un client anterieur au lot, qui n envoie que les cles, ne perd pas les libelles corriges', async () => {
    await setOptions('l30_intact', [
      { value_key: 'a', label: 'Première', is_active: true },
      { value_key: 'b', label: 'Deuxième', is_active: false },
    ]);
    // Exactement ce qu'ecrit l'ancienne RPC : la liste des cles, rien d'autre.
    await setValues('l30_intact', ['a', 'b', 'c']);
    expect((await optionsOf('l30_intact')).allowed_options).toEqual([
      { value_key: 'a', label: 'Première', is_active: true },
      { value_key: 'b', label: 'Deuxième', is_active: false },
      { value_key: 'c', label: 'c', is_active: true },
    ]);
  });

  test('les doublons de cle sont fusionnes en conservant la premiere position', async () => {
    await setValues('l30_intact', ['c', 'a', 'c', 'b']);
    expect((await optionsOf('l30_intact')).allowed_values).toEqual(['c', 'a', 'b']);
  });

  test('une liste de cles non textuelles est refusee, jamais retrecie en silence', async () => {
    await expect(db.admin.query(
      `update public.template_field set allowed_values = '["ok", 42]'::jsonb
        where template_version_id = $1 and field_key = 'l30_intact'`,
      [versionId],
    )).rejects.toThrow(/Liste de valeurs invalide/i);
  });

  test('une option malformee est refusee', async () => {
    const cases: [unknown[], RegExp][] = [
      [[{ value_key: 'x', label: 'X' }], /Option invalide/i],
      [[{ value_key: 'x', label: '', is_active: true }], /Option invalide/i],
      [[{ value_key: 'x', label: 'X', is_active: true, couleur: 'bleu' }], /Option invalide/i],
      [[{ value_key: 'x', label: 'X', is_active: true }, { value_key: 'x', label: 'Y', is_active: true }], /meme code/i],
    ];
    for (const [options, message] of cases) {
      await expect(db.admin.query(
        `update public.template_field set allowed_options = $2::jsonb
          where template_version_id = $1 and field_key = 'l30_libre'`,
        [versionId, JSON.stringify(options)],
      )).rejects.toThrow(message);
    }
  });

  test('desactiver l option qui sert de valeur proposee est refuse', async () => {
    await db.admin.query(
      `update public.template_field set default_value = 'oui'
        where template_version_id = $1 and field_key = 'l30_defaut'`,
      [versionId],
    );
    await expect(setOptions('l30_defaut', [
      { value_key: 'oui', label: 'Oui', is_active: false },
      { value_key: 'non', label: 'Non', is_active: true },
    ])).rejects.toThrow(/valeur proposee/i);
  });

  test('la recopie d une version a l autre emporte les options, libelles compris', async () => {
    // `copy_template_fields` est la fonction partagee par duplication, version suivante et
    // promotion : une colonne oubliee la se perdrait EN SILENCE dans les trois parcours.
    const copy = (await db.admin.query(
      `insert into public.template_version (template_id, version_number, status, created_by)
       values ($1, 950, 'draft', $2) returning id`,
      [templateId, aliceId],
    )).rows[0].id;
    await db.admin.query('select public.copy_template_fields($1, $2)', [versionId, copy]);
    const row = (await db.admin.query(
      "select allowed_options, allowed_values from public.template_field where template_version_id = $1 and field_key = 'l30_evolution'",
      [copy],
    )).rows[0];
    expect(row.allowed_options).toContainEqual({ value_key: 'gueri', label: 'Guéri', is_active: false });
    expect(row.allowed_values).toEqual(['deces', 'gueri', 'sequelles', 'perdu_de_vue']);
  });

  test('l instantane hors-ligne emet les DEUX formes', async () => {
    const snap = (await db.asUser(aliceId, (c) =>
      c.query('select public.download_base_snapshot($1) as s', [baseId]))).rows[0].s;
    const field = (snap.fields as Record<string, unknown>[]).find((f) => f.fieldKey === 'l30_evolution');
    expect(field?.allowedValues).toEqual(['deces', 'gueri', 'sequelles', 'perdu_de_vue']);
    expect(field?.allowedOptions).toContainEqual({ value_key: 'gueri', label: 'Guéri', is_active: false });
  });
});

// ---------------------------------------------------------------------------
// 4. Conversion des orphelins : apercu, opt-in, blocage, idempotence
// ---------------------------------------------------------------------------

describe('conversion des valeurs orphelines', () => {
  let orphanId: string;
  let blockedId: string;
  let ambiguousId: string;
  let multiId: string;
  let conformingId: string;

  // `asUser` ouvre une connexion dediee et pose le claim JWT pour toute la transaction :
  // un `set_config(..., true)` sur la connexion admin serait perdu des la requete suivante.
  const preview = async () =>
    (await db.asUser(aliceId, (c) =>
      c.query('select public.preview_option_key_repair($1) as p', [baseId]))).rows[0].p;

  beforeAll(async () => {
    // Le degat historique : la fiche porte « hematome », la liste dit « hématome ».
    orphanId = await addEncounter('L30-ORPH', { l30_orphelin: 'hematome' });
    blockedId = await addEncounter('L30-BLOQ', { l30_orphelin: 'traumatisme cranien' });
    ambiguousId = await addEncounter('L30-AMBI', { l30_ambigu: 'CHOC' });
    multiId = await addEncounter('L30-MULT', { l30_multi_orph: ['ROUGE', 'vert'] });
    conformingId = await addEncounter('L30-OK', { l30_orphelin: 'oedeme' });
  });

  test('l apercu compte les fiches convertibles, propose le rapprochement et nomme les bloquantes', async () => {
    const p = await preview();
    expect(p.records.repairable).toBe(2); // orphelin + multiselect
    expect(p.records.blocked).toBe(2);    // valeur inconnue + ambiguite

    const orph = (p.fields as Record<string, never>[]).find((f) => f.fieldKey === 'l30_orphelin');
    expect(orph?.mappings).toEqual([{ from: 'hematome', to: 'hématome', occurrences: 1 }]);
    expect(orph?.blockingValues).toEqual([{ value: 'traumatisme cranien', occurrences: 1 }]);

    const ambi = (p.fields as Record<string, never>[]).find((f) => f.fieldKey === 'l30_ambigu');
    // Deux options se ramenent a « choc » : personne ici n'a le droit de trancher.
    expect(ambi?.mappings).toEqual([]);
    expect(ambi?.blockingValues).toEqual([{ value: 'CHOC', occurrences: 1 }]);
  });

  test('l apercu ne modifie rien', async () => {
    await preview();
    expect(await dataOfEncounter(orphanId)).toEqual({ l30_orphelin: 'hematome' });
  });

  test('sans confirmation explicite, la conversion refuse d agir', async () => {
    await expect(db.asUser(aliceId, (c) => c.query('select public.repair_option_keys($1) as r', [baseId])))
      .rejects.toThrow(/non confirmee/i);
    expect(await dataOfEncounter(orphanId)).toEqual({ l30_orphelin: 'hematome' });
  });

  test('un compte sans droit d edition sur la base est refuse', async () => {
    await expect(db.asUser(bobId, (c) => c.query('select public.preview_option_key_repair($1) as p', [baseId])))
      .rejects.toThrow(/Acces refuse/i);
    await expect(db.asUser(bobId, (c) => c.query('select public.repair_option_keys($1, true) as r', [baseId])))
      .rejects.toThrow(/Acces refuse/i);
  });

  test('la conversion confirmee ramene les orphelins sur leur option et laisse les fiches bloquees intactes', async () => {
    const r = (await db.asUser(aliceId, (c) =>
      c.query('select public.repair_option_keys($1, true) as r', [baseId]))).rows[0].r;
    expect(r.repairedRecords).toBe(2);
    expect(r.blockedRecords).toBe(2);
    expect(r.failedRecords).toBe(0);

    expect(await dataOfEncounter(orphanId)).toEqual({ l30_orphelin: 'hématome' });
    expect(await dataOfEncounter(multiId)).toEqual({ l30_multi_orph: ['rouge', 'vert'] });
    // Bloquees : rien n'a bouge, et surtout rien n'a ete devine.
    expect(await dataOfEncounter(blockedId)).toEqual({ l30_orphelin: 'traumatisme cranien' });
    expect(await dataOfEncounter(ambiguousId)).toEqual({ l30_ambigu: 'CHOC' });
    // Deja conforme : jamais touchee.
    expect(await dataOfEncounter(conformingId)).toEqual({ l30_orphelin: 'oedeme' });
  });

  test('chaque conversion est tracee avec l ancienne et la nouvelle valeur', async () => {
    const rows = (await db.admin.query(
      `select field_key, old_value, new_value, source, changed_by
         from public.field_change_log
        where base_id = $1 and source = 'option_key_repair' order by field_key`,
      [baseId],
    )).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      field_key: 'l30_multi_orph', old_value: ['ROUGE', 'vert'], new_value: ['rouge', 'vert'],
      source: 'option_key_repair', changed_by: aliceId,
    });
    expect(rows[1]).toMatchObject({
      field_key: 'l30_orphelin', old_value: 'hematome', new_value: 'hématome',
    });
  });

  test('la conversion est idempotente : la rejouer ne reconvertit ni ne rejournalise rien', async () => {
    const r = (await db.asUser(aliceId, (c) =>
      c.query('select public.repair_option_keys($1, true) as r', [baseId]))).rows[0].r;
    expect(r.repairedRecords).toBe(0);
    expect(r.blockedRecords).toBe(2);
    const count = (await db.admin.query(
      "select count(*)::int as n from public.field_change_log where base_id = $1 and source = 'option_key_repair'",
      [baseId],
    )).rows[0].n;
    expect(count).toBe(2);
  });

  test('apres conversion, une fiche reparee est valide et compte pour la meme modalite', async () => {
    await expect(validate('l30_orphelin', 'hématome')).resolves.toBeDefined();
    const modalites = (await db.admin.query(
      `select count(distinct e.data ->> 'l30_orphelin')::int as n
         from public.encounter e join public.patient p on p.id = e.patient_id
        where p.base_id = $1 and e.data ? 'l30_orphelin' and e.data ->> 'l30_orphelin' <> 'traumatisme cranien'`,
      [baseId],
    )).rows[0].n;
    // « hematome » et « hématome » ne font plus deux modalites.
    expect(modalites).toBe(2); // hématome et oedeme
  });
});

// ---------------------------------------------------------------------------
// 5. La variable renommee reste utilisable de bout en bout
// ---------------------------------------------------------------------------

describe('bout en bout', () => {
  test('une nouvelle saisie sur la variable renommee passe la validation avec le code', async () => {
    await expect(validate('l30_evolution', 'deces')).resolves.toBeDefined();
    // Le LIBELLE n'est pas une valeur acceptable : c'est le code qui fait foi.
    await expect(validate('l30_evolution', 'Décès')).rejects.toThrow(/non autorisee/i);
  });

  test('le gabarit reste coherent : autant d options que de cles', async () => {
    const rows = (await db.admin.query(
      `select field_key, allowed_values, allowed_options from public.template_field
        where allowed_values is not null and template_version_id = $1`,
      [versionId],
    )).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect((row.allowed_options as Option[]).map((o) => o.value_key)).toEqual(row.allowed_values);
    }
  });

  test('le gabarit source du template reste inchange pour les autres versions', async () => {
    const other = (await db.admin.query(
      'select count(*)::int as n from public.template_version where template_id = $1', [templateId],
    )).rows[0].n;
    expect(other).toBeGreaterThanOrEqual(1);
  });
});
