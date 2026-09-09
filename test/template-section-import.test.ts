// =============================================================================
// L58 — import serveur d'un bloc reutilisable entre versions de jeu de variables.
//
// Couverture du §9.1 de docs/spec-blocs-reutilisables.md, onze points.
//
// RAPPEL DE LECTURE : les fixtures ecrivent avec `db.admin` (superutilisateur), ou
// `auth.uid()` est NULL — les gardes de gel et de propriete y sautent volontairement. Tout
// ce qui doit etre REFUSE pour raison d'autorisation ou de gel passe donc par `as(...)`,
// c'est-a-dire par une connexion `authenticated` portant le claim JWT.
// =============================================================================
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
const alice = '22222222-2222-2222-2222-222222222222';
const bob = '33333333-3333-3333-3333-333333333333';
const admin = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => { db = await startTestDb({ seed: true }); }, 240_000);
afterAll(async () => { await db?.stop(); });

const as = (sql: string, args: unknown[] = [], user = alice) => db.asUser(user, (c) => c.query(sql, args));

// --- Lectures d'observation --------------------------------------------------------------

const tree = async (version: string) => (await db.admin.query(
  `select s.id, s.section_key as key, p.section_key as parent, s.display_order as ord,
          s.source_template_version_id as src_version, s.source_section_key as src_key
     from public.template_section s
     left join public.template_section p on p.id = s.parent_section_id
    where s.template_version_id = $1
    order by s.display_order, s.section_key`,
  [version],
)).rows as {
  id: string; key: string; parent: string | null; ord: number;
  src_version: string | null; src_key: string | null;
}[];

/** Toutes les colonnes recopiees SAUF `id` et `section_id`, qui sont propres a la version. */
const fields = async (version: string, keys?: string[]) => (await db.admin.query(
  `select field_key, label, description, default_value, scope, section, type, is_multiple,
          unit, allowed_values, allowed_options, required, min_value, max_value,
          allow_missing_codes, missing_reasons, formula, display_order, encounter_types
     from public.template_field
    where template_version_id = $1 and ($2::text[] is null or field_key = any($2::text[]))
    order by field_key`,
  [version, keys ?? null],
)).rows;

const rules = async (version: string) => (await db.admin.query(
  'select rule from public.validation_rule where template_version_id = $1 order by id',
  [version],
)).rows.map((r) => r.rule as Record<string, unknown>);

const counts = async () => (await db.admin.query(
  `select (select count(*)::int from public.template_section) as s,
          (select count(*)::int from public.template_field) as f,
          (select count(*)::int from public.validation_rule) as r`,
)).rows[0];

// --- Appels des deux entrees --------------------------------------------------------------

type Report = {
  sectionKey: string; subsections: string[]; importedFields: string[]; reusedFields: string[];
  copiedRules: number; activationRule: Record<string, unknown> | null;
  conflicts: { code: string; fieldKey: string; existingSection: string | null; reusable: boolean }[];
};

const importBlock = (src: string, key: string, tgt: string, reuse: string[] = [], user = alice) =>
  as('select public.import_template_section($1,$2,$3,$4::text[]) as r', [src, key, tgt, reuse], user)
    .then((r) => r.rows[0].r as Report);

const preview = (src: string, key: string, tgt: string, reuse: string[] = [], user = alice) =>
  as('select public.preview_template_section_import($1,$2,$3,$4::text[]) as r', [src, key, tgt, reuse], user)
    .then((r) => r.rows[0].r as Report);

/**
 * Un refus type porte le code dans `detail`, pas dans le message : c'est la forme de
 * `block_hidden_value`, la seule que `structuredErrorCode` sait decoder cote web.
 */
async function expectRefusal(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code: 'P0001', detail: expect.stringContaining(code) });
}

// --- Fixtures ------------------------------------------------------------------------------

async function newVersion(owner = alice, status = 'draft'): Promise<{ templateId: string; versionId: string }> {
  const templateId = (await db.admin.query(
    'insert into public.template(name, owner_user_id, is_global) values($1,$2,false) returning id',
    [`L58 ${crypto.randomUUID()}`, owner],
  )).rows[0].id as string;
  const versionId = (await db.admin.query(
    'insert into public.template_version(template_id, version_number, status, created_by) values($1,1,$2,$3) returning id',
    [templateId, status, owner],
  )).rows[0].id as string;
  return { templateId, versionId };
}

/**
 * Source de reference : un bloc `tuberculose` a DEUX sous-sections et DOUZE variables, dont
 * une `multiselect` a codes d'option, une `terminology`, une a formule interne et une a
 * raisons de valeur manquante. Plus un bloc voisin `autre` et un pilote au tronc commun,
 * qui ne doivent jamais suivre.
 */
async function sourceFixture(owner = alice) {
  const v = await newVersion(owner);
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     values ($1,'tuberculose','Tuberculose',0), ($1,'clinique','Clinique',1),
            ($1,'biologie','Biologie',2), ($1,'autre','Autre bloc',3)`,
    [v.versionId],
  );
  await db.admin.query(
    `update public.template_section set parent_section_id =
       (select id from public.template_section where template_version_id=$1 and section_key='tuberculose')
      where template_version_id=$1 and section_key in ('clinique','biologie')`,
    [v.versionId],
  );
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, description, default_value, scope, section, type,
        is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
        allow_missing_codes, missing_reasons, formula, display_order)
     values
      ($1,'diagnostic','Diagnostic',null,null,'patient',null,'multiselect',false,null,
        '["A15.0","B90"]'::jsonb,null,false,null,null,false,'{}',null,0),
      ($1,'bk_crachats','BK crachats','Trois prelevements',null,'patient','tuberculose','select',false,null,null,
        '[{"value_key":"positif","label":"Positif","is_active":true},
          {"value_key":"negatif","label":"Negatif","is_active":true},
          {"value_key":"non_realise","label":"Non realise","is_active":false}]'::jsonb,
        false,null,null,true,'{inconnu,non_fait}',null,1),
      ($1,'bk_culture','BK culture',null,null,'patient','tuberculose','multiselect',false,null,null,
        '[{"value_key":"mtb","label":"M. tuberculosis","is_active":true},
          {"value_key":"autre_myco","label":"Autre mycobacterie","is_active":true}]'::jsonb,
        false,null,null,false,'{}',null,2),
      ($1,'cim_principal','Code principal',null,null,'patient','tuberculose','terminology',true,null,null,null,
        false,null,null,false,'{}',null,3),
      ($1,'date_debut','Date de debut',null,null,'patient','clinique','date',false,null,null,null,
        false,null,null,false,'{}',null,4),
      ($1,'date_fin','Date de fin',null,null,'patient','clinique','date',false,null,null,null,
        false,null,null,false,'{}',null,5),
      ($1,'duree_traitement','Duree de traitement','En jours',null,'patient','clinique','integer',false,'days',null,null,
        false,null,null,false,'{}','date_fin - date_debut',6),
      ($1,'toux','Toux',null,null,'patient','clinique','boolean',false,null,null,null,
        false,null,null,false,'{}',null,7),
      ($1,'fievre','Temperature',null,null,'patient','clinique','number',false,'degres',null,null,
        false,30,45,false,'{}',null,8),
      ($1,'poids','Poids',null,null,'patient','biologie','number',false,'kg',null,null,
        false,0,300,false,'{}',null,9),
      ($1,'vs','Vitesse de sedimentation','Premiere heure',null,'patient','biologie','integer',false,'mm',null,null,
        false,null,null,false,'{}',null,10),
      ($1,'crp','CRP',null,'0','patient','biologie','number',false,'mg/L',null,null,
        false,null,null,false,'{}',null,11),
      ($1,'notes_tb','Notes',null,null,'patient','biologie','text',false,null,null,null,
        false,null,null,false,'{}',null,12),
      ($1,'age_autre','Age declare',null,null,'patient','autre','integer',false,null,null,null,
        false,null,null,false,'{}',null,13)`,
    [v.versionId],
  );
  for (const rule of [
    // Interne au bloc : les deux cles citees appartiennent au bloc -> copiee.
    { if: { field: 'bk_crachats', operator: 'equals', value: 'positif' }, then: { field: 'notes_tb', operator: 'required' } },
    // Cle exterieure au bloc (le pilote du tronc commun) -> jamais copiee.
    { if: { field: 'diagnostic', operator: 'contains_any', value: ['B90'] }, then: { field: 'vs', operator: 'visible' } },
    // Regle d'ACTIVATION du bloc -> jamais copiee (D7), seulement decrite dans le rapport.
    { if: { field: 'diagnostic', operator: 'contains_any', value: ['A15.0'] }, then: { section: 'tuberculose', operator: 'visible' } },
    // Comparaison interne : deux cles du bloc -> copiee.
    { operator: 'less_or_equal', left_field: 'date_debut', right_field: 'date_fin' },
  ]) {
    await db.admin.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2,'L58 fictif','block')",
      [v.versionId, JSON.stringify(rule)],
    );
  }
  return v;
}

/** Ajoute une variable au tronc commun (ou a une section) d'une version cible. */
const addField = (version: string, key: string, opts: {
  type?: string; scope?: string; isMultiple?: boolean; section?: string | null;
} = {}) => db.admin.query(
  `insert into public.template_field
     (template_version_id, field_key, label, scope, section, type, is_multiple, display_order)
   values ($1,$2,$2,$3,$4,$5,$6,0)`,
  [version, key, opts.scope ?? 'patient', opts.section ?? null, opts.type ?? 'number', opts.isMultiple ?? false],
);

/** Bloc minimal dont une variable calculee cite un operande du TRONC COMMUN de la source. */
async function externalOperandFixture() {
  const v = await newVersion();
  await db.admin.query(
    "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'bloc_min','Bloc minimal',0)",
    [v.versionId],
  );
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, formula)
     values ($1,'ref_min','Reference','patient',null,'date',0,null),
            ($1,'fin_min','Fin','patient','bloc_min','date',1,null),
            ($1,'delta_min','Delta','patient','bloc_min','integer',2,'fin_min - ref_min')`,
    [v.versionId],
  );
  return v;
}

// =============================================================================
// 9.1-1 / 9.1-2 / 9.1-3 — import nominal
// =============================================================================

describe('L58 import nominal', () => {
  test('9.1-1 toutes les colonnes du bloc sont retrouvees a l identique dans la cible', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    const report = await importBlock(src.versionId, 'tuberculose', tgt.versionId);

    expect(report.sectionKey).toBe('tuberculose');
    expect(report.subsections).toEqual(['clinique', 'biologie']);
    expect(report.importedFields).toHaveLength(12);
    expect(report.reusedFields).toEqual([]);
    expect(report.conflicts).toEqual([]);

    const expected = await fields(src.versionId, report.importedFields);
    expect(await fields(tgt.versionId)).toEqual(expected);
    // Les codes d'option, les raisons de valeur manquante et la formule survivent nommement :
    // ce sont les colonnes qu'une seconde liste aurait perdues sans lever d'erreur.
    const byKey = Object.fromEntries((await fields(tgt.versionId)).map((f) => [f.field_key, f]));
    expect(byKey.bk_crachats.allowed_options).toHaveLength(3);
    expect(byKey.bk_crachats.missing_reasons).toEqual(['non_fait', 'inconnu']);
    expect(byKey.bk_culture.allowed_options).toHaveLength(2);
    expect(byKey.cim_principal.is_multiple).toBe(true);
    expect(byKey.cim_principal.type).toBe('terminology');
    expect(byKey.duree_traitement.formula).toBe('date_fin - date_debut');
    expect(byKey.crp.default_value).toBe('0');
    expect(byKey.vs.description).toBe('Premiere heure');
    // Ni le bloc voisin ni le tronc commun de la source ne suivent.
    expect(byKey.age_autre).toBeUndefined();
    expect(byKey.diagnostic).toBeUndefined();
  });

  test('9.1-2 parente resolue en deux passes, aucun pointeur vers la version source, provenance posee', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await importBlock(src.versionId, 'tuberculose', tgt.versionId);

    const copied = await tree(tgt.versionId);
    expect(copied.map((r) => [r.key, r.parent, r.ord])).toEqual([
      ['tuberculose', null, 0], ['clinique', 'tuberculose', 1], ['biologie', 'tuberculose', 2],
    ]);
    const sourceIds = new Set((await tree(src.versionId)).map((r) => r.id));
    expect(copied.some((r) => sourceIds.has(r.id))).toBe(false);
    // 9.1-9, premiere moitie : la provenance est posee sur les trois sections importees.
    expect(copied.every((r) => r.src_version === src.versionId)).toBe(true);
    expect(copied.map((r) => r.src_key)).toEqual(['tuberculose', 'clinique', 'biologie']);
    // Le bloc voisin de la source ne suit jamais.
    expect(copied.map((r) => r.key)).not.toContain('autre');
  });

  test('9.1-2 bis le bloc importe se place EN FIN de version et la renumerotation reste dense', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await db.admin.query(
      `insert into public.template_section(template_version_id, section_key, label, display_order)
       values ($1,'existant','Existant',0), ($1,'existant_fils','Fils',1)`,
      [tgt.versionId],
    );
    await db.admin.query(
      `update public.template_section set parent_section_id =
         (select id from public.template_section where template_version_id=$1 and section_key='existant')
        where template_version_id=$1 and section_key='existant_fils'`,
      [tgt.versionId],
    );
    await importBlock(src.versionId, 'tuberculose', tgt.versionId);
    expect((await tree(tgt.versionId)).map((r) => [r.key, r.parent, r.ord])).toEqual([
      ['existant', null, 0], ['existant_fils', 'existant', 1],
      ['tuberculose', null, 2], ['clinique', 'tuberculose', 3], ['biologie', 'tuberculose', 4],
    ]);
  });

  test('9.1-3 regle interne copiee, regle exterieure et regle d activation jamais copiees', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    const report = await importBlock(src.versionId, 'tuberculose', tgt.versionId);

    expect(report.copiedRules).toBe(2);
    // Les identifiants de regle sont des UUID aleatoires : on compare l'ENSEMBLE, pas l'ordre.
    const copied = await rules(tgt.versionId);
    expect(copied).toHaveLength(2);
    expect(copied).toEqual(expect.arrayContaining([
      { if: { field: 'bk_crachats', operator: 'equals', value: 'positif' }, then: { field: 'notes_tb', operator: 'required' } },
      { operator: 'less_or_equal', left_field: 'date_debut', right_field: 'date_fin' },
    ]));
    // La regle d'activation est DECRITE, jamais recreee : c'est la matiere de L60.
    expect(report.activationRule).toEqual({ field: 'diagnostic', operator: 'contains_any', value: ['A15.0'] });
    expect(await rules(src.versionId)).toHaveLength(4);
  });

  test.each([false, true])('9.1-3 un cycle avec cible bloc=%s est annonce sans ecriture puis refuse', async (sectionTarget) => {
    // Source : `c` masque par `b`, `a` masque par `c`. Aucun cycle tant que `b` ne depend de rien.
    const src = await newVersion();
    await db.admin.query(
      "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'bloc_cycle','Bloc cycle',0)",
      [src.versionId],
    );
    await db.admin.query(
      `insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order)
       values ($1,'a_cycle','A','patient','bloc_cycle','text',0),
              ($1,'b_cycle','B','patient','bloc_cycle','text',1),
              ($1,'c_cycle','C','patient','bloc_cycle','text',2)`,
      [src.versionId],
    );
    for (const rule of [
      { if: { field: 'b_cycle', operator: 'equals', value: 'x' }, then: { field: 'c_cycle', operator: 'visible' } },
      { if: { field: 'c_cycle', operator: 'equals', value: 'x' }, then: { field: 'a_cycle', operator: 'visible' } },
    ]) {
      await db.admin.query(
        "insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2,'L58 fictif','block')",
        [src.versionId, JSON.stringify(rule)],
      );
    }
    // Cible : `a` et `b` au tronc commun, avec la troisieme arete qui fermerait le cycle.
    const tgt = await newVersion();
    await addField(tgt.versionId, 'a_cycle', { type: 'text' });
    await addField(tgt.versionId, 'b_cycle', { type: 'text' });
    if (sectionTarget) {
      // La cible intermediaire est dans un bloc : le graphe doit deplier then.section.
      await db.admin.query(
        "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'existant','Existant',0)",
        [tgt.versionId],
      );
      await addField(tgt.versionId, 'd_cycle', { type: 'text', section: 'existant' });
      await db.admin.query(
        "insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2,'L58 fictif','block')",
        [tgt.versionId, JSON.stringify({ if: { field: 'd_cycle', operator: 'equals', value: 'x' }, then: { field: 'b_cycle', operator: 'visible' } })],
      );
    }
    await db.admin.query(
      "insert into public.validation_rule(template_version_id, rule, message, severity) values($1,$2,'L58 fictif','block')",
      [tgt.versionId, JSON.stringify({ if: { field: 'a_cycle', operator: 'equals', value: 'x' }, then: sectionTarget
        ? { section: 'existant', operator: 'visible' }
        : { field: 'b_cycle', operator: 'visible' } })],
    );
    const before = await counts();
    const sourceBefore = { sections: await tree(src.versionId), fields: await fields(src.versionId), rules: await rules(src.versionId) };
    const targetBefore = { sections: await tree(tgt.versionId), fields: await fields(tgt.versionId), rules: await rules(tgt.versionId) };
    const report = await preview(src.versionId, 'bloc_cycle', tgt.versionId, ['a_cycle', 'b_cycle']);
    expect(report.conflicts).toEqual([expect.objectContaining({ code: 'IMPORT_VISIBILITY_CYCLE' })]);
    expect(await counts()).toEqual(before);
    await expectRefusal(importBlock(src.versionId, 'bloc_cycle', tgt.versionId, ['a_cycle', 'b_cycle']), 'IMPORT_VISIBILITY_CYCLE');
    expect(await counts()).toEqual(before);
    expect({ sections: await tree(src.versionId), fields: await fields(src.versionId), rules: await rules(src.versionId) }).toEqual(sourceBefore);
    expect({ sections: await tree(tgt.versionId), fields: await fields(tgt.versionId), rules: await rules(tgt.versionId) }).toEqual(targetBefore);

    // En supprimant seulement l'arete de fermeture, le meme import devient valide.
    await db.admin.query("delete from public.validation_rule where template_version_id = $1 and rule -> 'if' ->> 'field' = 'a_cycle'", [tgt.versionId]);
    const allowed = await preview(src.versionId, 'bloc_cycle', tgt.versionId, ['a_cycle', 'b_cycle']);
    expect(allowed.conflicts).toEqual([]);
    expect(await importBlock(src.versionId, 'bloc_cycle', tgt.versionId, ['a_cycle', 'b_cycle'])).toEqual(allowed);
  });
});

// =============================================================================
// 9.1-4 — refus types (formule incompatible et cycle couverts dans leurs scenarios)
// =============================================================================

describe('9.1-4 refus types', () => {
  test('IMPORT_SOURCE_FORBIDDEN : la version source n est pas lisible', async () => {
    const src = await sourceFixture(bob);
    const tgt = await newVersion(alice);
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_SOURCE_FORBIDDEN');
  });

  test('IMPORT_TARGET_FORBIDDEN : la version cible n appartient pas a l appelant', async () => {
    const src = await sourceFixture(alice);
    const tgt = await newVersion(bob);
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_TARGET_FORBIDDEN');
  });

  test('IMPORT_SOURCE_NOT_A_BLOCK : le code designe une sous-section', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await expectRefusal(importBlock(src.versionId, 'clinique', tgt.versionId), 'IMPORT_SOURCE_NOT_A_BLOCK');
  });

  test('IMPORT_TARGET_LOCKED : version cible publiee', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion(alice, 'published');
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_TARGET_LOCKED');
  });

  test('IMPORT_TARGET_IN_USE : version cible portant deja un dossier', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    const baseId = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) values ('L58 in use', $1, $2) returning id",
      [alice, tgt.versionId],
    )).rows[0].id as string;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'L58-INUSE',$2,'{}'::jsonb)",
      [baseId, tgt.versionId],
    );
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_TARGET_IN_USE');
  });

  test('IMPORT_SECTION_EXISTS : le code d une SOUS-section importee est deja pris par un bloc de la cible', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await db.admin.query(
      "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'biologie','Biologie deja la',0)",
      [tgt.versionId],
    );
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_SECTION_EXISTS');
  });

  test('IMPORT_FIELD_CONFLICT : une cle est prise et absente de p_reuse_field_keys', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids');
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_FIELD_CONFLICT');
  });

  test('IMPORT_REUSE_INCOMPATIBLE : type different', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids', { type: 'text' });
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId, ['poids']), 'IMPORT_REUSE_INCOMPATIBLE');
  });

  test('IMPORT_REUSE_IN_BLOCK : la variable reutilisee vit dans un autre bloc de la cible', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await db.admin.query(
      "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'autre_bloc','Autre bloc',0)",
      [tgt.versionId],
    );
    await addField(tgt.versionId, 'poids', { section: 'autre_bloc' });
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId, ['poids']), 'IMPORT_REUSE_IN_BLOCK');
  });

  test('IMPORT_FORMULA_OPERAND_MISSING : un operande est absent du bloc ET de la cible', async () => {
    const src = await externalOperandFixture();
    const tgt = await newVersion();
    await expectRefusal(importBlock(src.versionId, 'bloc_min', tgt.versionId), 'IMPORT_FORMULA_OPERAND_MISSING');
    // D8 : l'operande present dans la CIBLE suffit, la formule reste alors honorable.
    const ok = await newVersion();
    await addField(ok.versionId, 'ref_min', { type: 'date' });
    const report = await importBlock(src.versionId, 'bloc_min', ok.versionId);
    expect(report.importedFields).toEqual(['delta_min', 'fin_min']);
  });
});

// =============================================================================
// 9.1-5 / 9.1-6 — reutilisation et etat de la version cible
// =============================================================================

describe('9.1-5 reutilisation', () => {
  test('une entree NULL ne vaut jamais accord de reutilisation implicite', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids');
    const before = await counts();
    const args = [src.versionId, 'tuberculose', tgt.versionId, [null]];
    const result = await as('select public.preview_template_section_import($1,$2,$3,$4::text[]) as r', args);
    expect(result.rows[0].r.reusedFields).toEqual([]);
    expect(result.rows[0].r.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'IMPORT_REUSE_INCOMPATIBLE' }),
      expect.objectContaining({ code: 'IMPORT_FIELD_CONFLICT', fieldKey: 'poids' }),
    ]));
    await expectRefusal(as('select public.import_template_section($1,$2,$3,$4::text[])', args), 'IMPORT_REUSE_INCOMPATIBLE');
    expect(await counts()).toEqual(before);
  });

  test('cle compatible dans le tronc commun acceptee, et la variable reutilisee n est PAS reecrite', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids');
    const before = (await fields(tgt.versionId, ['poids']))[0];

    const report = await importBlock(src.versionId, 'tuberculose', tgt.versionId, ['poids']);
    expect(report.reusedFields).toEqual(['poids']);
    expect(report.importedFields).toHaveLength(11);
    expect(report.importedFields).not.toContain('poids');
    // Ni re-parentage, ni changement de section : la variable reste au tronc commun.
    expect((await fields(tgt.versionId, ['poids']))[0]).toEqual(before);
    expect((await db.admin.query(
      "select section_id from public.template_field where template_version_id=$1 and field_key='poids'",
      [tgt.versionId],
    )).rows[0].section_id).toBeNull();
  });

  test('scope different refuse', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids', { scope: 'encounter' });
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId, ['poids']), 'IMPORT_REUSE_INCOMPATIBLE');
  });

  test('caractere multivalue different refuse', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'cim_principal', { type: 'terminology', isMultiple: false });
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId, ['cim_principal']), 'IMPORT_REUSE_INCOMPATIBLE');
  });

  test('une cle de reutilisation qui ne resout aucun conflit est refusee, jamais ignoree', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId, ['inexistante']), 'IMPORT_REUSE_INCOMPATIBLE');
  });
});

describe('9.1-6 etat de la version cible', () => {
  test('published, archived et draft portant un patient : trois refus distincts', async () => {
    const src = await sourceFixture();
    const published = await newVersion(alice, 'published');
    const archived = await newVersion(alice, 'archived');
    const used = await newVersion();
    const baseId = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) values ('L58 etat', $1, $2) returning id",
      [alice, used.versionId],
    )).rows[0].id as string;
    await db.admin.query(
      "insert into public.patient(base_id, patient_code, template_version_id, data) values($1,'L58-ETAT',$2,'{}'::jsonb)",
      [baseId, used.versionId],
    );

    await expectRefusal(importBlock(src.versionId, 'tuberculose', published.versionId), 'IMPORT_TARGET_LOCKED');
    await expectRefusal(importBlock(src.versionId, 'tuberculose', archived.versionId), 'IMPORT_TARGET_LOCKED');
    await expectRefusal(importBlock(src.versionId, 'tuberculose', used.versionId), 'IMPORT_TARGET_IN_USE');
  });
});

// =============================================================================
// 9.1-7 / 9.1-8 / 9.1-10 — previsualisation, concurrence, atomicite
// =============================================================================

describe('9.1-7 previsualisation', () => {
  test('rend le MEME rapport que l import et n ecrit rien', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    const before = await counts();
    const report = await preview(src.versionId, 'tuberculose', tgt.versionId);
    expect(await counts()).toEqual(before);
    expect(await importBlock(src.versionId, 'tuberculose', tgt.versionId)).toEqual(report);
  });

  test('enumere les conflits cle par cle la ou l import leve, et dit si la reutilisation est possible', async () => {
    const src = await sourceFixture();
    const tgt = await newVersion();
    await addField(tgt.versionId, 'poids');
    await addField(tgt.versionId, 'notes_tb', { type: 'number' });

    const report = await preview(src.versionId, 'tuberculose', tgt.versionId);
    expect(report.conflicts).toEqual([
      { code: 'IMPORT_FIELD_CONFLICT', fieldKey: 'notes_tb', existingSection: null, reusable: false },
      { code: 'IMPORT_FIELD_CONFLICT', fieldKey: 'poids', existingSection: null, reusable: true },
    ]);
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_FIELD_CONFLICT');
  });

  test('un refus structurel est leve par les DEUX entrees', async () => {
    const src = await sourceFixture(bob);
    const tgt = await newVersion(alice);
    await expectRefusal(preview(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_SOURCE_FORBIDDEN');
    await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_SOURCE_FORBIDDEN');
  });
});

test('9.1-8 deux imports concurrents du meme bloc : un seul reussit', async () => {
  const src = await sourceFixture();
  const tgt = await newVersion();
  const claims = JSON.stringify({ sub: alice, role: 'authenticated' });
  const c1 = new Client({ connectionString: db.url });
  const c2 = new Client({ connectionString: db.url });
  await c1.connect();
  await c2.connect();
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await c.query('set local role authenticated');
    }
    await c1.query('select public.import_template_section($1,$2,$3,$4::text[])', [src.versionId, 'tuberculose', tgt.versionId, []]);
    // La seconde transaction bute sur le verrou de version pris par la premiere. Son rejet
    // est attache AVANT le commit, sans quoi la course serait perdue d'avance.
    const pending = c2.query('select public.import_template_section($1,$2,$3,$4::text[])', [src.versionId, 'tuberculose', tgt.versionId, []]);
    const outcome = pending.then(() => 'committed', () => 'rejected');
    await c1.query('commit');
    expect(await outcome).toBe('rejected');
    await c2.query('rollback');
  } finally {
    await c1.end();
    await c2.end();
  }
  expect((await tree(tgt.versionId)).map((r) => r.key)).toEqual(['tuberculose', 'clinique', 'biologie']);
  expect(await fields(tgt.versionId)).toHaveLength(12);
});

test('la source reste stable jusqu au commit et les imports croises ne se bloquent pas', async () => {
  const src = await sourceFixture();
  const tgt = await newVersion();
  await db.asUser(alice, async (c) => {
    await c.query('select public.import_template_section($1,$2,$3)', [src.versionId, 'tuberculose', tgt.versionId]);
    // Une autre connexion ne peut modifier le contenu source pendant l'import.
    await expect(db.asUser(alice, async (other) => {
      await other.query("set local lock_timeout = '250ms'");
      await other.query("update public.template_field set label = 'Modification concurrente' where template_version_id = $1 and field_key = 'poids'", [src.versionId]);
    })).rejects.toMatchObject({ code: '55P03' });
  });

  const a = await newVersion();
  const b = await newVersion();
  // L'editeur peut avoir verrouille une ligne avant son trigger de verrou de version.
  // L'import doit lire la derniere valeur commitee sans attendre cette ligne.
  await db.asUser(alice, async (editor) => {
    await editor.query("select id from public.template_field where template_version_id = $1 and field_key = 'poids' for update", [src.versionId]);
    await db.asUser(alice, async (importer) => {
      await importer.query("set local statement_timeout = '2s'");
      await importer.query('select public.import_template_section($1,$2,$3)', [src.versionId, 'tuberculose', a.versionId]);
    });
  });
  const crossA = await newVersion();
  await db.admin.query(
    `insert into public.template_section(template_version_id, section_key, label, display_order)
     values ($1,'bloc_a','A',0), ($2,'bloc_b','B',0)`, [crossA.versionId, b.versionId],
  );
  await Promise.all([
    importBlock(crossA.versionId, 'bloc_a', b.versionId),
    importBlock(b.versionId, 'bloc_b', crossA.versionId),
  ]);
  expect((await tree(crossA.versionId)).map((r) => r.key).sort()).toEqual(['bloc_a', 'bloc_b']);
  expect((await tree(b.versionId)).map((r) => r.key).sort()).toEqual(['bloc_a', 'bloc_b']);
});

test('un operande externe incompatible est annonce par l apercu et refuse avec un code stable', async () => {
  // L'existence seule ne suffit pas : une autre portee doit etre annoncee par l'apercu,
  // avant que le declencheur de formule refuse l'insertion avec son message interne.
  const src = await externalOperandFixture();
  const tgt = await newVersion();
  await addField(tgt.versionId, 'ref_min', { type: 'date', scope: 'encounter' });
  const before = await counts();
  expect((await preview(src.versionId, 'bloc_min', tgt.versionId)).conflicts).toEqual([
    expect.objectContaining({ code: 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE', operandKey: 'ref_min' }),
  ]);
  await expectRefusal(importBlock(src.versionId, 'bloc_min', tgt.versionId), 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE');
  expect(await counts()).toEqual(before);
  expect(await tree(tgt.versionId)).toEqual([]);
});

test('9.1-10 une erreur apres insertion des sections annule tout l import', async () => {
  const src = await sourceFixture();
  const tgt = await newVersion();
  const before = await counts();
  await db.admin.query(`
    create function public.l58_test_fail() returns trigger language plpgsql as $$
    begin raise exception 'L58 injected failure'; end $$;
    create trigger l58_test_fail before insert on public.template_field
      for each row execute function public.l58_test_fail();
  `);
  try {
    await expect(importBlock(src.versionId, 'tuberculose', tgt.versionId)).rejects.toThrow('L58 injected failure');
    expect(await counts()).toEqual(before);
    expect(await tree(tgt.versionId)).toEqual([]);
  } finally {
    await db.admin.query('drop trigger l58_test_fail on public.template_field; drop function public.l58_test_fail()');
  }
});

// =============================================================================
// 9.1-9 — la provenance survit aux six voies de recopie de version
// =============================================================================

test('9.1-9 provenance posee, puis conservee par les six voies de recopie', async () => {
  const src = await sourceFixture();
  const origin = await newVersion();
  await importBlock(src.versionId, 'tuberculose', origin.versionId);
  const expected = (await tree(origin.versionId)).map((r) => [r.key, r.src_version, r.src_key]);

  const targets: string[] = [];
  targets.push((await as('select (public.duplicate_template_version($1)).id as id', [origin.versionId], admin)).rows[0].id);
  targets.push((await as('select (public.create_next_personal_template_version($1)).id as id', [origin.templateId])).rows[0].id);
  const promoted = (await as('select (public.promote_template_to_global($1)).id as id', [origin.templateId], admin)).rows[0].id;
  targets.push((await db.admin.query('select id from public.template_version where template_id=$1', [promoted])).rows[0].id);
  targets.push((await as("select (public.create_base_from_model_observation('L58 obs',null,$1,'cross_sectional')).current_template_version_id as id", [origin.versionId])).rows[0].id);
  targets.push((await as("select (public.create_base_from_model('L58 modele',null,$1)).current_template_version_id as id", [origin.versionId])).rows[0].id);
  targets.push((await as('select public.create_template_bundle($1,$2) as r', [{ name: 'L58 bundle', sourceVersionId: origin.versionId }, crypto.randomUUID()])).rows[0].r.versionId);

  expect(targets).toHaveLength(6);
  for (const v of targets) {
    expect((await tree(v)).map((r) => [r.key, r.src_version, r.src_key])).toEqual(expected);
  }
});

// =============================================================================
// 9.1-11 — RLS
// =============================================================================

test('9.1-11 source lisible via une base partagee acceptee, version d un autre medecin refusee a la cible', async () => {
  const src = await sourceFixture(bob);
  const baseId = (await db.admin.query(
    "insert into public.base(name, owner_user_id, current_template_version_id) values ('L58 partagee', $1, $2) returning id",
    [bob, src.versionId],
  )).rows[0].id as string;
  // Sans partage, la source n'est pas lisible : le refus DOIT preceder le positif, sinon un
  // catalogue vide ferait passer le test de securite tout seul.
  const tgt = await newVersion(alice);
  await expectRefusal(importBlock(src.versionId, 'tuberculose', tgt.versionId), 'IMPORT_SOURCE_FORBIDDEN');

  await db.admin.query(
    "insert into public.base_access(base_id, user_id, access_role, granted_by) values($1,$2,'viewer',$3)",
    [baseId, alice, bob],
  );
  const report = await importBlock(src.versionId, 'tuberculose', tgt.versionId);
  expect(report.importedFields).toHaveLength(12);

  // Lecture autorisee ne vaut pas ecriture : la version de Bob reste interdite comme CIBLE.
  const mine = await sourceFixture(alice);
  await expectRefusal(importBlock(mine.versionId, 'tuberculose', src.versionId), 'IMPORT_TARGET_FORBIDDEN');
});

// =============================================================================
// Provenance et suppression de la source : `on delete set null` ne doit pas rendre un
// gabarit source indelebile des que la version cible est gelee.
// =============================================================================

test('supprimer le gabarit source efface la provenance, meme sur une version cible publiee', async () => {
  // Source volontairement minimale : `delete_template` bute deja, independamment de ce lot,
  // sur la garde d'operande d'une variable calculee (`enforce_template_field_formula_operand`).
  const src = await newVersion();
  await db.admin.query(
    "insert into public.template_section(template_version_id, section_key, label, display_order) values ($1,'prov_bloc','Bloc provenance',0)",
    [src.versionId],
  );
  await db.admin.query(
    `insert into public.template_field(template_version_id, field_key, label, scope, section, type, display_order)
     values ($1,'prov_champ','Champ','patient','prov_bloc','text',0)`,
    [src.versionId],
  );
  const tgt = await newVersion();
  await importBlock(src.versionId, 'prov_bloc', tgt.versionId);
  await as('select public.publish_template_version($1)', [tgt.versionId]);

  // L'exemption de gel est reservee au SET NULL de la FK, pas a un effacement direct.
  await expect(as(
    'update public.template_section set source_template_version_id = null where template_version_id = $1',
    [tgt.versionId],
  )).rejects.toThrow();
  expect((await tree(tgt.versionId))[0].src_version).toBe(src.versionId);

  // Meme lors d'un SET NULL legitime, une autre colonne ne peut changer en meme temps.
  const createdAtBefore = (await db.admin.query(
    'select created_at from public.template_section where template_version_id = $1', [tgt.versionId],
  )).rows[0].created_at;
  await db.admin.query(`
    create function public.l58_test_change_timestamp() returns trigger language plpgsql as $$
    begin new.created_at := old.created_at + interval '1 day'; return new; end $$;
    create trigger aaa_l58_test_change_timestamp before update of source_template_version_id
      on public.template_section for each row execute function public.l58_test_change_timestamp();
  `);
  try {
    await expect(as('select public.delete_template($1)', [src.templateId])).rejects.toThrow(/immuable/);
    expect((await tree(tgt.versionId))[0].src_version).toBe(src.versionId);
    expect((await db.admin.query(
      'select created_at from public.template_section where template_version_id = $1', [tgt.versionId],
    )).rows[0].created_at).toEqual(createdAtBefore);
  } finally {
    await db.admin.query('drop trigger aaa_l58_test_change_timestamp on public.template_section; drop function public.l58_test_change_timestamp()');
  }

  await as('select public.delete_template($1)', [src.templateId]);
  const copied = await tree(tgt.versionId);
  expect(copied.map((r) => r.key)).toEqual(['prov_bloc']);
  expect(copied.every((r) => r.src_version === null)).toBe(true);
  expect(copied.map((r) => r.src_key)).toEqual(['prov_bloc']);
});
