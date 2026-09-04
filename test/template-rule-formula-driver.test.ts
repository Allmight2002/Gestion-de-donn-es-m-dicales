// Test DB : REGLES portant sur une VARIABLE CALCULEE (L32 x L35).
//
// Le resultat d'une variable calculee n'est JAMAIS stocke (L35, en-tete de
// 20260820120000) : rien n'est ecrit dans `patient.data` ni `encounter.data` sous sa cle, et
// aucune RPC ne calcule. Une regle dont un OPERANDE est une variable calculee lit donc une
// valeur ETERNELLEMENT ABSENTE. Selon la forme de la regle la consequence differe, et c'est
// elle qui decide de ce qui est refuse :
//
//   * affichage PILOTE par un calcul   -> la cible est masquee POUR TOUJOURS, et une fiche qui
//     porte encore sa valeur est refusee a la finalisation. Destructeur : refuse.
//   * obligation VISANT un calcul      -> la regle est TOUJOURS violee des que la condition est
//     vraie : la fiche devient infinalisable. Destructeur : refuse.
//   * obligation PILOTEE par un calcul -> la regle ne se declenche JAMAIS : le gabarit affiche
//     une exigence qu'il n'applique pas. Refuse aussi.
//   * comparaison portant sur un calcul -> meme inertie silencieuse. Refuse.
//   * affichage VISANT un calcul       -> legitime : on masque un resultat affiche, rien de plus.
//
// Le second bloc demontre le PREJUDICE sur une regle enregistree AVANT le garde-fou : c'est
// la preuve du defaut, et c'est aussi le sort reserve aux regles deja presentes en base.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string;

/**
 * Version de gabarit NEUVE : `guard_validation_rule_inuse` interdit d'ajouter une regle a une
 * version qui porte deja des donnees.
 */
async function newVersion(name: string): Promise<string> {
  const templateId = (await db.admin.query(
    'insert into public.template(name, specialty, owner_user_id, is_global) values($1, null, $2, false) returning id',
    [name, aliceId],
  )).rows[0].id;
  return (await db.admin.query(
    "insert into public.template_version(template_id, version_number, status, created_by) values($1, 1, 'draft', $2) returning id",
    [templateId, aliceId],
  )).rows[0].id;
}

async function addField(
  version: string,
  fieldKey: string,
  label: string,
  type: string,
  order: number,
  extra: { formula?: string | null; scope?: string } = {},
) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order, formula)
     values($1, $2, $3, $4, 'clinique', $5, $6, $7)`,
    [version, fieldKey, label, extra.scope ?? 'encounter', type, order, extra.formula ?? null],
  );
}

const addRule = (version: string, rule: unknown, severity = 'block') =>
  db.admin.query(
    'insert into public.validation_rule(template_version_id, rule, message, severity) values($1, $2::jsonb, $3, $4) returning id',
    [version, JSON.stringify(rule), 'Regle de test', severity],
  );

const hiddenFields = async (version: string, data: unknown): Promise<string[]> =>
  (await db.admin.query('select public.visibility_hidden_fields($1, $2::jsonb) as h', [
    version, JSON.stringify(data),
  ])).rows[0].h;

// ---------------------------------------------------------------------------
// Version de DEFINITION : aucune donnee, uniquement l'enregistrement des regles.
// ---------------------------------------------------------------------------
let defVersion: string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;

  defVersion = await newVersion('Gabarit calcul + regles');
  await addField(defVersion, 'poids', 'Poids', 'number', 10);
  await addField(defVersion, 'taille', 'Taille', 'number', 11);
  // Le pilote naturel d'un bloc « malnutrition » en pediatrie : un rapport calcule.
  await addField(defVersion, 'rapport_pt', 'Rapport poids sur taille', 'number', 12, {
    formula: 'poids / taille',
  });
  await addField(defVersion, 'oedemes', 'Oedemes', 'boolean', 13);
  await addField(defVersion, 'bloc_malnutrition', 'Bloc malnutrition', 'text', 14);
  await addField(defVersion, 'plan_nutritionnel', 'Plan nutritionnel', 'text', 15);
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('a la DEFINITION de la regle', () => {
  test('la variable de test est bien une variable calculee', async () => {
    const row = (await db.admin.query(
      'select formula from public.template_field where template_version_id=$1 and field_key=$2',
      [defVersion, 'rapport_pt'],
    )).rows[0];
    expect(row.formula).toBe('poids / taille');
  });

  test('affichage pilote par une variable calculee : REFUSE, en nommant la variable', async () => {
    // Le defaut : acceptee, cette regle masque « Bloc malnutrition » definitivement.
    await expect(addRule(defVersion, {
      if: { field: 'rapport_pt', operator: 'less_than', value: 18 },
      then: { field: 'bloc_malnutrition', operator: 'visible' },
    })).rejects.toThrow(/Rapport poids sur taille/);
  });

  test('le refus ne recopie jamais la formule elle-meme', async () => {
    await addRule(defVersion, {
      if: { field: 'rapport_pt', operator: 'less_than', value: 18 },
      then: { field: 'bloc_malnutrition', operator: 'visible' },
    }).then(
      () => { throw new Error('la regle a ete acceptee'); },
      (e: Error) => { expect(e.message).not.toMatch(/poids \/ taille/); },
    );
  });

  test('obligation VISANT une variable calculee : REFUSEE', async () => {
    // Sinon la fiche devient infinalisable des que la condition est vraie : la valeur exigee
    // ne peut jamais etre saisie. Le produit refuse deja `required = true` sur une variable
    // calculee ; l'exiger par une regle est la meme promesse, ecrite autrement.
    await expect(addRule(defVersion, {
      if: { field: 'oedemes', operator: 'equals', value: true },
      then: { field: 'rapport_pt', operator: 'required' },
    })).rejects.toThrow(/Rapport poids sur taille/);
  });

  test('obligation PILOTEE par une variable calculee : REFUSEE', async () => {
    // Elle ne se declencherait jamais : le gabarit afficherait une exigence qu'il n'applique pas.
    await expect(addRule(defVersion, {
      if: { field: 'rapport_pt', operator: 'less_than', value: 18 },
      then: { field: 'plan_nutritionnel', operator: 'required' },
    })).rejects.toThrow(/Rapport poids sur taille/);
  });

  test('comparaison portant sur une variable calculee : REFUSEE des deux cotes', async () => {
    await expect(addRule(defVersion, {
      operator: 'less_than', left_field: 'rapport_pt', right_field: 'poids',
    })).rejects.toThrow(/Rapport poids sur taille/);
    await expect(addRule(defVersion, {
      operator: 'less_than', left_field: 'poids', right_field: 'rapport_pt',
    })).rejects.toThrow(/Rapport poids sur taille/);
  });

  test('une variable calculee reste une CIBLE d\'affichage legitime', async () => {
    // Masquer un resultat affiche ne detruit rien : aucune valeur a saisir, aucune fiche a
    // refuser. Interdire ce cas retirerait une possibilite utile sans rien proteger.
    await expect(addRule(defVersion, {
      if: { field: 'oedemes', operator: 'equals', value: true },
      then: { field: 'rapport_pt', operator: 'visible' },
    })).resolves.toBeDefined();
  });

  test('les regles entre variables SAISIES restent acceptees', async () => {
    await expect(addRule(defVersion, {
      if: { field: 'oedemes', operator: 'equals', value: true },
      then: { field: 'bloc_malnutrition', operator: 'visible' },
    })).resolves.toBeDefined();
    await expect(addRule(defVersion, {
      operator: 'less_than', left_field: 'poids', right_field: 'taille',
    })).resolves.toBeDefined();
  });

  test('rendre CALCULEE une variable qui pilote deja un affichage : REFUSE', async () => {
    // La porte de derriere : la regle d'abord, la formule ensuite. Sans ce garde, l'interdiction
    // ci-dessus se contourne en deux temps.
    const v = await newVersion('Gabarit calcul apres regle');
    await addField(v, 'poids', 'Poids', 'number', 10);
    await addField(v, 'taille', 'Taille', 'number', 11);
    await addField(v, 'rapport_pt', 'Rapport poids sur taille', 'number', 12);
    await addField(v, 'bloc_malnutrition', 'Bloc malnutrition', 'text', 13);
    await addRule(v, {
      if: { field: 'rapport_pt', operator: 'less_than', value: 18 },
      then: { field: 'bloc_malnutrition', operator: 'visible' },
    });
    await expect(db.admin.query(
      'update public.template_field set formula = $3 where template_version_id = $1 and field_key = $2',
      [v, 'rapport_pt', 'poids / taille'],
    )).rejects.toThrow(/Rapport poids sur taille/);
  });
});

// ---------------------------------------------------------------------------
// Le PREJUDICE, sur une regle enregistree AVANT le garde-fou.
// ---------------------------------------------------------------------------
describe('une regle deja enregistree avant le garde-fou', () => {
  let legacy: string;
  let patientId: string;

  beforeAll(async () => {
    legacy = await newVersion('Gabarit regle heritee');
    await addField(legacy, 'poids', 'Poids', 'number', 10);
    await addField(legacy, 'taille', 'Taille', 'number', 11);
    await addField(legacy, 'rapport_pt', 'Rapport poids sur taille', 'number', 12, {
      formula: 'poids / taille',
    });
    await addField(legacy, 'bloc_malnutrition', 'Bloc malnutrition', 'text', 13);

    // Exactement ce qu'une base existante peut contenir : la regle a ete acceptee a une epoque
    // ou rien ne la refusait. Le declencheur est ecarte le temps de l'ecrire.
    await db.admin.query('alter table public.validation_rule disable trigger trg_vr_structure');
    await addRule(legacy, {
      if: { field: 'rapport_pt', operator: 'less_than', value: 18 },
      then: { field: 'bloc_malnutrition', operator: 'visible' },
    });
    await db.admin.query('alter table public.validation_rule enable trigger trg_vr_structure');

    const baseId = (await db.admin.query(
      "insert into public.base(name, owner_user_id, current_template_version_id) values('Base heritee', $1, $2) returning id",
      [aliceId, legacy],
    )).rows[0].id;
    patientId = (await db.admin.query(
      `insert into public.patient(base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
       values($1, 'HER-001', $2, '{}'::jsonb, 'direct', 'draft', $3) returning id`,
      [baseId, legacy, aliceId],
    )).rows[0].id;
  }, 60_000);

  test('la cible est masquee QUELLES QUE SOIENT les donnees', async () => {
    // Le resultat n'etant jamais stocke, aucune saisie ne peut rendre la condition vraie.
    expect(await hiddenFields(legacy, {})).toContain('bloc_malnutrition');
    expect(await hiddenFields(legacy, { poids: 10, taille: 1 })).toContain('bloc_malnutrition');
    expect(await hiddenFields(legacy, { poids: 100, taille: 1 })).toContain('bloc_malnutrition');
  });

  test('la fiche qui porte la valeur masquee ne peut plus etre finalisee', async () => {
    await expect(db.admin.query(
      `insert into public.encounter(patient_id, template_version_id, encounter_type, encounter_date, data, validation_status, created_by)
       values($1, $2, 'consultation', current_date, $3::jsonb, 'curated', $4)`,
      [patientId, legacy, JSON.stringify({ bloc_malnutrition: 'oui' }), aliceId],
    )).rejects.toThrow(/Bloc malnutrition/);
  });

  test('la version se charge et s\'evalue encore : diagnostic, jamais echec brut', async () => {
    // Le nouveau garde-fou porte sur l'ECRITURE d'une regle. Une version existante doit
    // continuer a s'ouvrir, sinon la correction serait pire que le defaut.
    await expect(hiddenFields(legacy, {})).resolves.toBeDefined();
    await expect(db.admin.query('select public.assert_required_complete($1, $2, $3::jsonb, $4)', [
      legacy, 'encounter', '{}', 'consultation',
    ])).resolves.toBeDefined();
    await expect(db.admin.query('select public.assert_validation_rules($1, $2::jsonb)', [
      legacy, '{}',
    ])).resolves.toBeDefined();
  });

  test('le diagnostic nomme la regle, la variable et le motif', async () => {
    const rows = (await db.admin.query(
      'select rule_id, problem, field_key, label from public.calculated_field_rule_conflicts($1) order by problem',
      [legacy],
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].problem).toBe('visible_driver');
    expect(rows[0].field_key).toBe('rapport_pt');
    expect(rows[0].label).toBe('Rapport poids sur taille');
    expect(rows[0].rule_id).toBeTruthy();
  });

  test('une version saine ne signale rien', async () => {
    const rows = (await db.admin.query(
      'select * from public.calculated_field_rule_conflicts($1)', [defVersion],
    )).rows;
    expect(rows).toEqual([]);
  });
});
