// Test DB de l'affichage conditionnel (L32).
//
// Quatre proprietes decident du lot, et chacune a son bloc ci-dessous :
//   1. l'ordre d'evaluation est VISIBILITE D'ABORD, OBLIGATION ENSUITE -- impose par la base,
//      pas seulement par l'ecran, sinon une fiche devient invalidable pour un champ que
//      personne ne voit ;
//   2. une fiche finalisee ne porte pas la valeur d'un champ masque, et le refus nomme la
//      variable sans jamais nommer son contenu ;
//   3. les cycles sont refuses a l'ENREGISTREMENT de la regle, pas a la saisie ;
//   4. une regle d'affichage est INERTE pour le code d'avant le lot : un client non
//      rafraichi montre la variable, il n'echoue pas.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let baseId: string;
let patientId: string;
let aliceId: string;

const VISIBLE_IMAGERIE = {
  if: { field: 'imagerie_faite', operator: 'equals', value: true },
  then: { field: 'imagerie_type', operator: 'visible' },
};
const VISIBLE_DATE = {
  if: { field: 'imagerie_type', operator: 'equals', value: 'scanner' },
  then: { field: 'imagerie_date', operator: 'visible' },
};

const hiddenFields = async (data: unknown): Promise<string[]> =>
  (await db.admin.query('select public.visibility_hidden_fields($1, $2::jsonb) as h', [
    versionId, JSON.stringify(data),
  ])).rows[0].h;

const requireComplete = (data: unknown, scope = 'encounter') =>
  db.admin.query('select public.assert_required_complete($1, $2, $3::jsonb, $4)', [
    versionId, scope, JSON.stringify(data), scope === 'encounter' ? 'consultation' : null,
  ]);

const applyRules = (data: unknown) =>
  db.admin.query('select public.assert_validation_rules($1, $2::jsonb)', [versionId, JSON.stringify(data)]);

const addRule = (rule: unknown, severity = 'block', version = versionId) =>
  db.admin.query(
    'insert into public.validation_rule(template_version_id, rule, message, severity) values($1, $2::jsonb, $3, $4)',
    [version, JSON.stringify(rule), 'Regle L32', severity],
  );

/** Cree une rencontre portant ces donnees, au statut demande. */
const insertEncounter = (data: unknown, status: string) =>
  db.admin.query(
    `insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data, validation_status, created_by)
     values($1, $2, 'consultation', current_date, $3::jsonb, $4, $5) returning id`,
    [patientId, versionId, JSON.stringify(data), status, aliceId],
  );

async function addField(
  fieldKey: string,
  type: string,
  order: number,
  opts: { required?: boolean; scope?: string } = {},
) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, required)
     values($1, $2, $3, $4, 'paraclinique', $5, $6, $7)`,
    [versionId, fieldKey, `Libelle ${fieldKey}`, opts.scope ?? 'encounter', type, order, opts.required ?? false],
  );
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;

  // Version NEUVE : `guard_validation_rule_inuse` interdit d'ajouter une regle a une version
  // qui porte deja des donnees. C'est aussi la garantie qu'une regle d'affichage ne peut pas
  // masquer retroactivement des fiches deja saisies.
  const templateId = (await db.admin.query(
    "insert into public.template(name, specialty, owner_user_id, is_global) values('Gabarit L32', null, $1, false) returning id",
    [aliceId],
  )).rows[0].id;
  versionId = (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values($1, 1, 'draft', $2) returning id",
    [templateId, aliceId],
  )).rows[0].id;

  await addField('imagerie_faite', 'boolean', 10);
  await addField('imagerie_type', 'text', 11, { required: true });
  await addField('imagerie_date', 'date', 12);
  await addField('poids', 'number', 13, { required: true });
  await addField('antecedent', 'text', 14, { scope: 'patient' });

  await addRule(VISIBLE_IMAGERIE);
  await addRule(VISIBLE_DATE);
  // Regle « obligatoire sous condition » visant une variable qui peut etre masquee : c'est
  // elle qui prouve l'ordre d'evaluation. Posee AVANT toute donnee, comme le veut le garde
  // anti-retroactivite.
  await addRule({
    if: { field: 'poids', operator: 'greater_than', value: 0 },
    then: { field: 'imagerie_date', operator: 'required' },
  });

  baseId = (await db.admin.query(
    "insert into public.base(name, owner_user_id, current_template_version_id) values('Base L32', $1, $2) returning id",
    [aliceId, versionId],
  )).rows[0].id;
  patientId = (await db.admin.query(
    `insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
     values($1, 'L32-001', $2, '{}'::jsonb, 'direct', 'draft', $3) returning id`,
    [baseId, versionId, aliceId],
  )).rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------

describe('ce qui est masque, et quand', () => {
  test('condition non verifiable -> masque : un formulaire vierge ne montre pas l\'imagerie', async () => {
    expect(await hiddenFields({})).toEqual(expect.arrayContaining(['imagerie_type', 'imagerie_date']));
  });

  test('condition fausse -> masque', async () => {
    expect(await hiddenFields({ imagerie_faite: false })).toContain('imagerie_type');
  });

  test('condition vraie -> affiche, et seulement la variable concernee', async () => {
    const hidden = await hiddenFields({ imagerie_faite: true });
    expect(hidden).not.toContain('imagerie_type');
    expect(hidden).toContain('imagerie_date'); // sa propre condition n'est pas encore vraie
  });

  test('cascade : masquer la variable pilote masque celle qu\'elle commande', async () => {
    // `imagerie_type` porte une valeur, mais il est masque : il est lu comme ABSENT, donc
    // `imagerie_date` reste masque. Sans le point fixe, la date reapparaitrait toute seule.
    const hidden = await hiddenFields({ imagerie_type: 'scanner' });
    expect(hidden).toContain('imagerie_type');
    expect(hidden).toContain('imagerie_date');
  });

  test('une variable sans regle d\'affichage n\'est jamais masquee', async () => {
    expect(await hiddenFields({})).not.toContain('poids');
  });
});

describe('visibilite d\'abord, obligation ensuite', () => {
  test('un champ requis MASQUE n\'est pas reclame', async () => {
    // Sans cet ordre, cette fiche serait impossible a finaliser : elle exigerait une valeur
    // pour une variable que le formulaire ne montre pas.
    await expect(requireComplete({ poids: 70 })).resolves.toBeDefined();
  });

  test('le meme champ redevient obligatoire des qu\'il est AFFICHE', async () => {
    await expect(requireComplete({ imagerie_faite: true, poids: 70 }))
      .rejects.toThrow(/Champ requis manquant : Libelle imagerie_type/);
  });

  test('les autres champs requis restent exiges', async () => {
    await expect(requireComplete({})).rejects.toThrow(/Libelle poids/);
  });

  test('une regle « obligatoire sous condition » visant un champ masque ne bloque pas', async () => {
    // `imagerie_date` est masque : la regle est inapplicable, pas violee.
    await expect(applyRules({ poids: 70 })).resolves.toBeDefined();
    // Affiche, la meme regle reprend tout son effet.
    await expect(applyRules({ poids: 70, imagerie_faite: true, imagerie_type: 'scanner' }))
      .rejects.toThrow(/Regle L32/);
  });
});

describe('une fiche finalisee ne porte pas la valeur d\'un champ masque', () => {
  test('brouillon : la valeur est toleree, rien n\'est efface dans le dos de la personne', async () => {
    await expect(insertEncounter({ imagerie_type: 'scanner' }, 'draft')).resolves.toBeDefined();
  });

  test('finalisation : refusee, en nommant la variable', async () => {
    await expect(insertEncounter({ imagerie_type: 'scanner', poids: 70 }, 'curated'))
      .rejects.toThrow(/Libelle imagerie_type/);
  });

  test('le refus ne nomme jamais le contenu de la variable', async () => {
    await insertEncounter({ imagerie_type: 'scanner', poids: 70 }, 'curated').catch((e: Error) => {
      expect(e.message).not.toMatch(/scanner/);
    });
  });

  test('la meme fiche passe des que la condition d\'affichage est vraie', async () => {
    await expect(insertEncounter(
      { imagerie_faite: true, imagerie_type: 'scanner', imagerie_date: '2026-08-01', poids: 70 },
      'curated',
    )).resolves.toBeDefined();
  });

  test('et passe aussi sans la valeur masquee', async () => {
    await expect(insertEncounter({ poids: 70 }, 'curated')).resolves.toBeDefined();
  });
});

describe('structure de la regle', () => {
  let draftVersion: string;

  beforeAll(async () => {
    const templateId = (await db.admin.query(
      "insert into public.template(name, specialty, owner_user_id, is_global) values('Gabarit L32 bis', null, $1, false) returning id",
      [aliceId],
    )).rows[0].id;
    draftVersion = (await db.admin.query(
      "insert into public.template_version(template_id, version_number, status, created_by) values($1, 1, 'draft', $2) returning id",
      [templateId, aliceId],
    )).rows[0].id;
    for (const [key, scope] of [['a', 'encounter'], ['b', 'encounter'], ['c', 'encounter'], ['p', 'patient']]) {
      await db.admin.query(
        `insert into public.template_field
           (template_version_id, field_key, label, scope, section, type, display_order)
         values($1, $2, $3, $4, 'clinique', 'text', 0)`,
        [draftVersion, key, `Libelle ${key}`, scope],
      );
    }
  });

  test('un verbe inconnu dans « then » reste refuse', async () => {
    await expect(addRule(
      { if: { field: 'a', operator: 'equals', value: 'x' }, then: { field: 'b', operator: 'forbidden' } },
      'block', draftVersion,
    )).rejects.toThrow(/required ou operator=visible/);
  });

  test('une variable ne peut pas commander son propre affichage', async () => {
    await expect(addRule(
      { if: { field: 'a', operator: 'equals', value: 'x' }, then: { field: 'a', operator: 'visible' } },
      'block', draftVersion,
    )).rejects.toThrow(/son propre affichage/);
  });

  test('les deux variables doivent appartenir a la meme fiche', async () => {
    // Une condition portee par l'autre fiche n'est jamais verifiable : la variable serait
    // masquee pour toujours, sans que personne comprenne pourquoi.
    await expect(addRule(
      { if: { field: 'p', operator: 'equals', value: 'x' }, then: { field: 'b', operator: 'visible' } },
      'block', draftVersion,
    )).rejects.toThrow(/meme fiche/);
  });

  test('une variable inconnue reste refusee', async () => {
    await expect(addRule(
      { if: { field: 'jamais_vu', operator: 'equals', value: 'x' }, then: { field: 'b', operator: 'visible' } },
      'block', draftVersion,
    )).rejects.toThrow(/Champ inconnu/);
  });
});

describe('cycles refuses a l\'enregistrement de la regle', () => {
  let cycleVersion: string;

  beforeAll(async () => {
    const templateId = (await db.admin.query(
      "insert into public.template(name, specialty, owner_user_id, is_global) values('Gabarit L32 cycle', null, $1, false) returning id",
      [aliceId],
    )).rows[0].id;
    cycleVersion = (await db.admin.query(
      "insert into public.template_version(template_id, version_number, status, created_by) values($1, 1, 'draft', $2) returning id",
      [templateId, aliceId],
    )).rows[0].id;
    for (const key of ['a', 'b', 'c']) {
      await db.admin.query(
        `insert into public.template_field
           (template_version_id, field_key, label, scope, section, type, display_order)
         values($1, $2, $3, 'encounter', 'clinique', 'text', 0)`,
        [cycleVersion, key, `Libelle ${key}`],
      );
    }
  });

  test('A masque par B puis B masque par A : la seconde regle est refusee', async () => {
    await expect(addRule(
      { if: { field: 'b', operator: 'equals', value: 'x' }, then: { field: 'a', operator: 'visible' } },
      'block', cycleVersion,
    )).resolves.toBeDefined();
    await expect(addRule(
      { if: { field: 'a', operator: 'equals', value: 'x' }, then: { field: 'b', operator: 'visible' } },
      'block', cycleVersion,
    )).rejects.toThrow(/circulaire/);
  });

  test('un cycle INDIRECT (A <- B <- C <- A) est refuse aussi', async () => {
    await expect(addRule(
      { if: { field: 'c', operator: 'equals', value: 'x' }, then: { field: 'b', operator: 'visible' } },
      'block', cycleVersion,
    )).resolves.toBeDefined();
    // a <- b existe deja, b <- c vient d'etre pose : ajouter c <- a ferme la boucle.
    await expect(addRule(
      { if: { field: 'a', operator: 'equals', value: 'x' }, then: { field: 'c', operator: 'visible' } },
      'block', cycleVersion,
    )).rejects.toThrow(/circulaire/);
  });

  test('une chaine sans boucle reste autorisee', async () => {
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order)
       values($1, 'd', 'Libelle d', 'encounter', 'clinique', 'text', 0)`,
      [cycleVersion],
    );
    await expect(addRule(
      { if: { field: 'b', operator: 'equals', value: 'x' }, then: { field: 'd', operator: 'visible' } },
      'block', cycleVersion,
    )).resolves.toBeDefined();
  });
});

describe('compatibilite descendante', () => {
  test('la signature historique de rule_holds ignore une regle d\'affichage', async () => {
    // C'est ce que fait le code d'AVANT le lot : il ne masque pas, mais il n'echoue pas et
    // n'efface rien. Une PWA non rafraichie reste utilisable.
    const held = (await db.admin.query('select public.rule_holds($1::jsonb, $2::jsonb) as ok', [
      JSON.stringify(VISIBLE_IMAGERIE), JSON.stringify({}),
    ])).rows[0].ok;
    expect(held).toBe(true);
  });

  test('une version sans aucune regle d\'affichage ne masque rien', async () => {
    const seedVersion = (await db.admin.query(
      'select current_template_version_id as v from public.base where owner_user_id = $1 and id <> $2 limit 1',
      [aliceId, baseId],
    )).rows[0].v;
    const hidden = (await db.admin.query('select public.visibility_hidden_fields($1, $2::jsonb) as h', [
      seedVersion, JSON.stringify({}),
    ])).rows[0].h;
    expect(hidden).toEqual([]);
  });
});
