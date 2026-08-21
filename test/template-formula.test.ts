// Test DB des variables calculees (L35).
//
// Deux proprietes decident du lot, et chacune a son bloc ci-dessous :
//   1. PL/pgSQL VALIDE la formule a l'enregistrement — operandes existants, non calcules,
//      types compatibles — et REFUSE tout le reste ;
//   2. PL/pgSQL n'EVALUE jamais la formule : il sait seulement qu'une variable est calculee
//      (`formula is not null`), et s'en sert pour l'ECARTER de la completude et de la file
//      « a completer ».
//
// C'est cette distinction qui tient le lot. Le jour ou quelqu'un ajoutera un calcul en
// PL/pgSQL, il y aura deux implementations de la meme semantique sur des valeurs cliniques —
// exactement ce que le decoupage evite.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let baseId: string;
let versionId: string;
let aliceId: string;

/** Cree une variable de rencontre. `formula` non nulle = variable calculee. */
async function addField(
  fieldKey: string,
  type: string,
  order: number,
  extra: { formula?: string | null; required?: boolean } = {},
) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, required, formula)
     values($1, $2, $3, 'encounter', 'clinique', $4, $5, $6, $7)`,
    [versionId, fieldKey, `Libelle ${fieldKey}`, type, order, extra.required ?? false, extra.formula ?? null],
  );
}

const formulaOf = async (fieldKey: string) =>
  (await db.admin.query(
    'select formula, type, required from public.template_field where template_version_id=$1 and field_key=$2',
    [versionId, fieldKey],
  )).rows[0];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
  const base = (await db.admin.query(
    'select id, current_template_version_id as v from public.base where owner_user_id = $1 limit 1',
    [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.v;

  await addField('date_entree', 'date', 900);
  await addField('date_sortie', 'date', 901);
  await addField('heure_entree', 'datetime', 899);
  await addField('heure_sortie', 'datetime', 898);
  await addField('score_j0', 'integer', 902);
  await addField('score_j7', 'integer', 903);
  await addField('commentaire_l35', 'text', 904);
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('L35 — validation de la formule a l enregistrement', () => {
  test('accepte date - date et en DEDUIT un nombre entier de jours', async () => {
    await addField('duree_sejour', 'number', 910, { formula: 'date_sortie - date_entree' });
    const row = await formulaOf('duree_sejour');
    expect(row.formula).toBe('date_sortie - date_entree');
    // Le type envoye par le client etait `number` : c'est le SERVEUR qui deduit.
    expect(row.type).toBe('integer');
  });

  test('accepte datetime - datetime et en DEDUIT un nombre de jours fractionnaires', async () => {
    await addField('duree_precise', 'integer', 9101, { formula: 'heure_sortie - heure_entree' });
    const row = await formulaOf('duree_precise');
    expect(row.formula).toBe('heure_sortie - heure_entree');
    // Une date-heure peut produire une fraction de jour : le serveur deduit donc `number`.
    expect(row.type).toBe('number');
  });

  test('accepte date - datetime et en DEDUIT « number »', async () => {
    await addField('duree_mixte', 'integer', 9102, { formula: 'heure_sortie - date_entree' });
    expect((await formulaOf('duree_mixte')).type).toBe('number');
    await addField('duree_mixte_inverse', 'integer', 9103, { formula: 'date_sortie - heure_entree' });
    expect((await formulaOf('duree_mixte_inverse')).type).toBe('number');
  });

  test('accepte une soustraction de nombres et en deduit « number »', async () => {
    await addField('delta_score', 'integer', 911, { formula: 'score_j7 - score_j0' });
    expect((await formulaOf('delta_score')).type).toBe('number');
  });

  test('normalise l ecriture : la forme canonique est celle que relit l evaluateur', async () => {
    await addField('delta_norme', 'number', 912, { formula: '  score_j7   -   score_j0  ' });
    expect((await formulaOf('delta_norme')).formula).toBe('score_j7 - score_j0');
  });

  test('REFUSE un operande inconnu de la version', async () => {
    await expect(addField('mauvais_1', 'number', 920, { formula: 'score_j7 - absent_du_gabarit' }))
      .rejects.toThrow(/absent_du_gabarit/);
  });

  test('REFUSE un operande de type incompatible', async () => {
    await expect(addField('mauvais_2', 'number', 921, { formula: 'score_j7 - commentaire_l35' }))
      .rejects.toThrow(/ni un nombre ni une date/);
  });

  test('REFUSE la reference a une AUTRE variable calculee — pas de chaine, donc pas de cycle', async () => {
    await expect(addField('mauvais_3', 'number', 922, { formula: 'duree_sejour * 2' }))
      .rejects.toThrow(/variable calculee/);
  });

  test('REFUSE qu une variable se reference elle-meme', async () => {
    await expect(addField('mauvais_4', 'number', 923, { formula: 'mauvais_4 - score_j0' }))
      .rejects.toThrow(/elle-meme/);
  });

  test('REFUSE toute operation entre deux dates autre que la soustraction', async () => {
    await expect(addField('mauvais_5', 'number', 924, { formula: 'date_sortie + date_entree' }))
      .rejects.toThrow(/soustraction/);
  });

  test('REFUSE de melanger une date et un nombre', async () => {
    await expect(addField('mauvais_6', 'number', 925, { formula: 'date_entree + 3' }))
      .rejects.toThrow(/une autre date/);
    await expect(addField('mauvais_12', 'number', 9251, { formula: 'heure_entree + 3' }))
      .rejects.toThrow(/date\/heure|date-heure/i);
  });

  test('REFUSE une formule hors grammaire (imbrication, fonction, condition)', async () => {
    for (const bad of ['score_j0 + score_j7 - 1', 'round(score_j0)', 'score_j0 > score_j7', 'score_j0']) {
      await expect(addField(`mauvais_g_${bad.length}`, 'number', 926, { formula: bad }))
        .rejects.toThrow();
    }
  });

  test('REFUSE deux constantes : ce n est pas une variable de dossier', async () => {
    await expect(addField('mauvais_7', 'number', 927, { formula: '2 + 3' }))
      .rejects.toThrow(/au moins un element/i);
  });

  test('REFUSE une variable calculee OBLIGATOIRE : personne ne pourrait la completer', async () => {
    await expect(addField('mauvais_8', 'number', 928, { formula: 'score_j7 - score_j0', required: true }))
      .rejects.toThrow(/obligatoire/);
  });

  test('REFUSE une valeur proposee sur une variable calculee', async () => {
    await expect(db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order, formula, default_value)
       values($1,'mauvais_9','Libelle','encounter','clinique','number',929,'score_j7 - score_j0','5')`,
      [versionId],
    )).rejects.toThrow(/valeur proposee/);
  });

  test('RAMENE A VIDE les raisons de valeur manquante d une variable calculee', async () => {
    // La colonne a une valeur PAR DEFAUT non vide (L33) : refuser punirait l'appelant pour un
    // defaut de colonne. On ramene donc a vide -- une variable calculee n'etant jamais saisie,
    // aucune raison ne peut s'y appliquer.
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order, formula,
          allow_missing_codes, missing_reasons)
       values($1,'sans_raisons','Libelle','encounter','clinique','number',930,'score_j7 - score_j0',
              true, array['non_fait'])`,
      [versionId],
    );
    const row = (await db.admin.query(
      'select missing_reasons, allow_missing_codes from public.template_field where template_version_id=$1 and field_key=$2',
      [versionId, 'sans_raisons'],
    )).rows[0];
    expect(row.missing_reasons).toEqual([]);
    expect(row.allow_missing_codes).toBe(false);
  });

  test('REFUSE un operande d une AUTRE portee : le formulaire n a qu un bloc de donnees', async () => {
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order)
       values($1,'poids_permanent','Poids','patient','clinique','number',931)`,
      [versionId],
    );
    await expect(addField('mauvais_11', 'number', 932, { formula: 'poids_permanent * 2' }))
      .rejects.toThrow(/n''existe pas|n'existe pas|meme portee/);
  });

  test('REFUSE de supprimer un operande encore utilise par une formule', async () => {
    await expect(db.admin.query(
      'delete from public.template_field where template_version_id=$1 and field_key=$2',
      [versionId, 'date_entree'],
    )).rejects.toThrow(/utilisee par la formule/);
  });

  test('REFUSE de changer le type d un operande encore utilise par une formule', async () => {
    await expect(db.admin.query(
      "update public.template_field set type='text' where template_version_id=$1 and field_key=$2",
      [versionId, 'date_entree'],
    )).rejects.toThrow(/utilisee par la formule/);
  });
});

describe('L35 — PL/pgSQL sait qu une variable est calculee, mais ne l evalue jamais', () => {
  test('SEULS les deux declencheurs L35 ANALYSENT une formule ; les autres la lisent, point', async () => {
    // Garde-fou de CONCEPTION, et non de comportement. La propriete qui tient tout le lot est
    // qu'aucune fonction PL/pgSQL n'evalue une formule : la seule implementation de la
    // semantique vit dans `exportContract.ts`, lu a l'identique par le navigateur et par
    // l'Edge Function. Le jour ou quelqu'un ajoutera un decoupage de formule ailleurs en
    // base, ce test tombera — et c'est exactement ce qu'on veut qu'il fasse.
    // `\mformula\M` : le MOT `formula`, pour ne pas confondre la colonne avec le mot
    // « formulaire » qui parsème les commentaires francais du schema.
    const parsers = (await db.admin.query(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ '\\mformula\\M'
          and p.prosrc like '%regexp_split_to_array%'
        order by p.proname`,
    )).rows.map((r) => r.proname as string);
    expect(parsers).toEqual([
      'enforce_template_field_formula',        // valide la formule a l'enregistrement
      'enforce_template_field_formula_operand', // empeche un operande de disparaitre
    ]);

    // Les autres fonctions ne font que LIRE la colonne (recopie, instantane, exclusion de la
    // completude). Liste explicite : toute nouvelle fonction qui mentionne `formula` doit
    // etre ajoutee ici sciemment, jamais par accident.
    const readers = (await db.admin.query(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ '\\mformula\\M'
        order by p.proname`,
    )).rows.map((r) => r.proname as string);
    expect(readers).toEqual([
      'base_completeness_stats',
      'base_completion_queue_page',
      'copy_template_fields',
      'download_base_snapshot',
      'enforce_template_field_formula',
      'enforce_template_field_formula_operand',
      'guard_template_field_update',
      'missing_required_fields',
      'update_template_field',
    ]);
  });

  test('la completude IGNORE la variable calculee : sinon 0 % chez tout le monde', async () => {
    const stats = (await db.admin.query(
      "select public.base_completeness_stats($1, 'both') as s",
      [baseId],
    )).rows[0].s as { fieldKey: string }[];
    const keys = stats.map((s) => s.fieldKey);
    expect(keys).toContain('date_entree');
    expect(keys).not.toContain('duree_sejour');
    expect(keys).not.toContain('delta_score');
  });

  test('la file « a completer » IGNORE la variable calculee : personne ne peut la completer', async () => {
    // Une variable SAISIE obligatoire doit bien apparaitre dans la file ; la variable calculee
    // ne doit jamais y figurer. Sans cette exclusion, elle y serait chez TOUT LE MONDE, et
    // personne ne pourrait l'en faire sortir -- une liste de travail impossible a solder.
    await db.admin.query(
      `update public.template_field set required = true
        where template_version_id = $1 and field_key = 'score_j0'`,
      [versionId],
    );
    // Le seed ne contient que des fiches `curated`, que la file exclut par construction.
    // On ajoute donc une fiche en cours de saisie, qui est le cas reel de la file.
    const patientId = (await db.admin.query(
      'select id from public.patient where base_id = $1 limit 1',
      [baseId],
    )).rows[0].id as string;
    await db.admin.query(
      `insert into public.encounter
         (patient_id, template_version_id, encounter_type, encounter_date, data,
          collection_mode, validation_status, created_by)
       values ($1, $2, 'consultation', date '2024-06-01', '{}'::jsonb, 'direct', 'draft', $3)`,
      [patientId, versionId, aliceId],
    );
    const page = (await db.admin.query(
      'select public.base_completion_queue_page($1, 500, 0) as p',
      [baseId],
    )).rows[0].p as { items: { missing: string[] }[] };
    const missing = page.items.flatMap((i) => i.missing);
    expect(missing).toContain('Libelle score_j0');
    expect(missing).not.toContain('Libelle duree_sejour');
    expect(missing).not.toContain('Libelle delta_score');
  });

  test('aucune fiche ne porte de valeur sous la cle d une variable calculee', async () => {
    const stored = (await db.admin.query(
      `select count(*)::int as n
         from public.encounter e
         join public.patient p on p.id = e.patient_id
        where p.base_id = $1 and (e.data ? 'duree_sejour')`,
      [baseId],
    )).rows[0].n as number;
    expect(stored).toBe(0);
  });
});

describe('L35 — la formule appartient a la version de gabarit', () => {
  test('dupliquer une version RECOPIE la formule : sans quoi elle disparaitrait en silence', async () => {
    const target = (await db.admin.query(
      `insert into public.template_version (template_id, version_number, status)
       select template_id, 99, 'draft' from public.template_version where id = $1
       returning id`,
      [versionId],
    )).rows[0].id as string;
    await db.admin.query('select public.copy_template_fields($1, $2)', [versionId, target]);
    const copied = (await db.admin.query(
      'select formula from public.template_field where template_version_id=$1 and field_key=$2',
      [target, 'duree_sejour'],
    )).rows[0];
    expect(copied.formula).toBe('date_sortie - date_entree');
  });

  test('une version PUBLIEE gele sa formule : une fiche ancienne garde son resultat', async () => {
    const published = (await db.admin.query(
      `insert into public.template_version (template_id, version_number, status)
       select template_id, 98, 'published' from public.template_version where id = $1
       returning id`,
      [versionId],
    )).rows[0].id as string;
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order)
       values($1,'a','A','encounter','clinique','integer',1), ($1,'b','B','encounter','clinique','integer',2)`,
      [published],
    );
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, type, display_order, formula)
       values($1,'ecart','Ecart','encounter','clinique','number',3,'a - b')`,
      [published],
    );
    // La garde `guard_template_field_update` n'agit que pour un appelant AUTHENTIFIE : c'est
    // le chemin reel de l'interface. On le rejoue tel quel.
    await expect(db.asUser(aliceId, (c) => c.query(
      "update public.template_field set formula = 'b - a' where template_version_id=$1 and field_key='ecart'",
      [published],
    ))).rejects.toThrow(/immuable/);
  });

  test('l instantane hors-ligne transporte la formule, pour que le calcul suive hors ligne', async () => {
    const snap = (await db.admin.query('select public.download_base_snapshot($1) as s', [baseId]))
      .rows[0].s as { fields: { fieldKey: string; formula: string | null }[] };
    const duree = snap.fields.find((f) => f.fieldKey === 'duree_sejour');
    expect(duree?.formula).toBe('date_sortie - date_entree');
  });
});
