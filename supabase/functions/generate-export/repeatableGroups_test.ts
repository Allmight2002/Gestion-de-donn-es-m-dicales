// L70 — export des GROUPES REPETABLES (§9 et §14.3, points 21 a 24).
//
// Une occurrence est une `encounter` ; ce qui la distingue d'une rencontre ordinaire n'est pas
// son type — le serveur les force toutes a `autre` — mais le BLOC qui la porte. Ces tests
// verifient les deux formes du fichier : une ligne par occurrence, qui doit rester separable
// en analyse, et une ligne par patient, qui ne doit JAMAIS choisir une occurrence au hasard.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  assertNoIdentity,
  buildDictionary,
  buildEncounterExport,
  buildMultivalueTable,
  buildPatientExport,
  columnId,
  type ExportEncounter,
  type ExportField,
  type ExportPatient,
  groupCountColumnId,
  mergeExportFields,
  projectFields,
  repeatableBlocksOf,
  toCsv,
} from './exportContract.ts';

const TV = 'v1';

const champ = (over: Partial<ExportField> & Pick<ExportField, 'fieldKey' | 'type'>): ExportField => ({
  label: over.fieldKey,
  scope: 'encounter',
  section: 'clinique',
  unit: null,
  allowedValues: null,
  description: null,
  templateVersionIds: [TV],
  ...over,
});

/** TRONC COMMUN : applicable a une rencontre ordinaire COMME a une occurrence (§5). */
const AGE = champ({ fieldKey: 'age', type: 'number', section: null, blockKey: null, blockLabel: null });
/** Bloc ORDINAIRE : rien ne change pour lui, ni en occurrence ni en patient. */
const POIDS = champ({
  fieldKey: 'poids',
  type: 'number',
  section: 'clinique',
  sectionLabel: 'Clinique',
  blockKey: 'clinique',
  blockLabel: 'Clinique',
});
/** Bloc REPETABLE « lesions » : deux attributs propres par occurrence, donc un groupe. */
const LESION_NIVEAU = champ({
  fieldKey: 'niveau',
  type: 'text',
  section: 'lesions',
  sectionLabel: 'Lésions',
  blockKey: 'lesions',
  blockLabel: 'Lésions',
  blockIsRepeatable: true,
});
const LESION_GRADE = champ({
  fieldKey: 'grade',
  type: 'number',
  section: 'lesions',
  sectionLabel: 'Lésions',
  blockKey: 'lesions',
  blockLabel: 'Lésions',
  blockIsRepeatable: true,
});
/** Second bloc repetable : le discriminant doit les separer, la ou `encounter_type` ne peut pas. */
const INTERVENTION_VOIE = champ({
  fieldKey: 'voie',
  type: 'text',
  section: 'interventions',
  sectionLabel: 'Interventions',
  blockKey: 'interventions',
  blockLabel: 'Interventions',
  blockIsRepeatable: true,
});
/** §4.3 : un bloc repetable PEUT porter sa propre date, variable comme une autre. */
const INTERVENTION_DATE = champ({
  fieldKey: 'date_intervention',
  type: 'date',
  section: 'interventions',
  sectionLabel: 'Interventions',
  blockKey: 'interventions',
  blockLabel: 'Interventions',
  blockIsRepeatable: true,
});
const SEXE = champ({ fieldKey: 'sexe', type: 'text', scope: 'patient', section: null, blockKey: null });

const CHAMPS = [AGE, POIDS, LESION_NIVEAU, LESION_GRADE, INTERVENTION_VOIE, INTERVENTION_DATE, SEXE];

const PATIENTS: ExportPatient[] = [
  { code: 'P0001', templateVersionId: TV, data: { sexe: 'F' } },
  // Aucune occurrence : c'est lui qui prouve le zero.
  { code: 'P0002', templateVersionId: TV, data: { sexe: 'M' } },
];

/**
 * `encounter_type` vaut `autre` sur TOUTES les occurrences — c'est le serveur qui l'impose
 * (L66). Les fixtures le reproduisent tel quel : sans cela, le test se donnerait un
 * discriminant que la base ne fournit pas.
 */
const occurrence = (
  id: string,
  patientCode: string,
  groupSectionKey: string,
  data: Record<string, unknown>,
): ExportEncounter => ({
  id,
  patientCode,
  encounterDate: null,
  encounterType: 'autre',
  groupSectionKey,
  templateVersionId: TV,
  ageValue: null,
  ageUnit: null,
  data,
});

const RENCONTRES: ExportEncounter[] = [
  {
    id: 'e-consult-1',
    patientCode: 'P0001',
    encounterDate: '2026-01-10',
    encounterType: 'consultation',
    groupSectionKey: null,
    templateVersionId: TV,
    ageValue: 40,
    ageUnit: 'years',
    data: { age: 40, poids: 62 },
  },
  {
    id: 'e-consult-2',
    patientCode: 'P0002',
    encounterDate: '2026-01-05',
    encounterType: 'consultation',
    groupSectionKey: null,
    templateVersionId: TV,
    ageValue: 51,
    ageUnit: 'years',
    data: { age: 51, poids: 70 },
  },
  // `age: 99` n'a aucune chance d'etre celui du patient : il est la pour etre vu s'il fuit.
  occurrence('e-lesion-1', 'P0001', 'lesions', { niveau: 'L1', grade: 2, age: 99 }),
  occurrence('e-lesion-2', 'P0001', 'lesions', { niveau: 'T12', grade: 3, age: 99 }),
  occurrence('e-intervention-1', 'P0001', 'interventions', { voie: 'postérieure', date_intervention: '2026-02-01' }),
];

const ligne = (table: { rows: Record<string, unknown>[] }, id: string) =>
  table.rows.find((r) => r.encounter_id === id) ?? {};
const lignePatient = (table: { rows: Record<string, unknown>[] }, code: string) =>
  table.rows.find((r) => r.patient_code === code) ?? {};

// ---------------------------------------------------------------------------------------
// §14.3 point 21 — une ligne par occurrence : `group_section_key` present et juste.
// ---------------------------------------------------------------------------------------

Deno.test('L70 point 21 : une ligne par occurrence porte le bloc, la ou le type de rencontre dit `autre`', () => {
  const table = buildEncounterExport(RENCONTRES, CHAMPS);

  assertEquals(table.columns.includes('group_section_key'), true);
  // La forme longue attendue par une analyse par lesion : une ligne par occurrence, aucune perdue.
  assertEquals(table.rows.length, 5);

  assertEquals(ligne(table, 'e-lesion-1').group_section_key, 'lesions');
  assertEquals(ligne(table, 'e-lesion-2').group_section_key, 'lesions');
  assertEquals(ligne(table, 'e-intervention-1').group_section_key, 'interventions');
  // Une rencontre ordinaire n'appartient a aucun groupe : case vide, jamais un code invente.
  assertEquals(ligne(table, 'e-consult-1').group_section_key, '');

  // Le discriminant est JUSTE la ou `encounter_type` ne l'est pas : les trois occurrences
  // sont indiscernables par le type, et parfaitement separables par le bloc.
  const occurrences = table.rows.filter((r) => r.group_section_key !== '');
  assertEquals(new Set(occurrences.map((r) => r.encounter_type)), new Set(['autre']));
  assertEquals(new Set(occurrences.map((r) => r.group_section_key)), new Set(['lesions', 'interventions']));

  // Chaque occurrence n'apporte que les variables de SON bloc ; celles de l'autre restent vides.
  assertEquals(ligne(table, 'e-lesion-1')[columnId(LESION_NIVEAU)], 'L1');
  assertEquals(ligne(table, 'e-lesion-1')[columnId(INTERVENTION_VOIE)], '');
  assertEquals(ligne(table, 'e-intervention-1')[columnId(INTERVENTION_VOIE)], 'postérieure');
});

Deno.test('L70 point 21 : la forme une ligne par occurrence est INCHANGEE pour une base sans groupe', () => {
  const ordinaires = RENCONTRES.filter((e) => e.groupSectionKey == null);
  const table = buildEncounterExport(ordinaires, [AGE, POIDS]);
  // La colonne existe toujours — elle appartient a la meta, comme `encounter_type` — et elle
  // est vide partout. Le fichier garde donc la meme forme d'un export a l'autre.
  assertEquals(table.columns.includes('group_section_key'), true);
  assertEquals(new Set(table.rows.map((r) => r.group_section_key)), new Set(['']));
  assertEquals(table.rows.length, 2);
});

// ---------------------------------------------------------------------------------------
// §14.3 point 24 — occurrence non datee : trois cases VIDES, jamais une date fabriquee.
// ---------------------------------------------------------------------------------------

Deno.test('L70 point 24 : une occurrence non datee sort sans date et sans age', () => {
  const table = buildEncounterExport(RENCONTRES, CHAMPS);
  const lesion = ligne(table, 'e-lesion-1');

  assertEquals(lesion.encounter_date, '');
  assertEquals(lesion.age_value, '');
  assertEquals(lesion.age_unit, '');

  // La rencontre datee, elle, garde tout : la regle porte sur l'ABSENCE de date, pas sur le groupe.
  const consultation = ligne(table, 'e-consult-1');
  assertEquals(consultation.encounter_date, '2026-01-10');
  assertEquals(consultation.age_value, 40);
  assertEquals(consultation.age_unit, 'years');

  // Aucune date fabriquee nulle part dans le fichier — ni l'epoque Unix, ni la date du jour.
  const csv = toCsv(table);
  assertEquals(csv.includes('1970-01-01'), false);
  assertEquals(csv.includes('1899-12-30'), false);
});

Deno.test("L70 point 24 : sans date, aucun age n'est repeche dans les donnees de l'occurrence", () => {
  // Une fiche ancienne, ou rejouee hors ligne, peut encore porter `age_at_encounter` dans ses
  // donnees. Sans date d'occurrence, cet age ne repose sur rien : il ne doit pas remonter.
  const bricolee: ExportEncounter = {
    ...occurrence('e-lesion-3', 'P0001', 'lesions', { niveau: 'L5', age_at_encounter: 77 }),
    ageUnit: 'years',
  };
  const table = buildEncounterExport([bricolee], CHAMPS);
  assertEquals(table.rows[0].age_value, '');
  assertEquals(table.rows[0].age_unit, '');
  assertEquals(table.rows[0].encounter_date, '');
});

Deno.test('L70 point 24 : la date propre au bloc reste une variable, et ne devient pas la date de ligne', () => {
  const table = buildEncounterExport(RENCONTRES, CHAMPS);
  const intervention = ligne(table, 'e-intervention-1');
  // §4.3 : la v1 ne recopie rien de l'une vers l'autre. La date d'intervention se lit dans sa
  // colonne de variable ; `encounter_date` reste vide.
  assertEquals(intervention[columnId(INTERVENTION_DATE)], '2026-02-01');
  assertEquals(intervention.encounter_date, '');
});

Deno.test('L70 : une occurrence non datee ne fait pas echouer le tri des lignes', () => {
  // `encounter_date` est nullable depuis L66 : un tri naif leverait ici.
  const desordre = [...RENCONTRES].reverse();
  const table = buildEncounterExport(desordre, CHAMPS);
  assertEquals(table.rows.map((r) => r.encounter_id), [
    // P0001 d'abord, ses occurrences non datees avant sa consultation datee, puis P0002.
    'e-intervention-1',
    'e-lesion-1',
    'e-lesion-2',
    'e-consult-1',
    'e-consult-2',
  ]);
  // Meme exigence sur la feuille dediee d'une variable multivaluee, qui trie sur la meme date.
  const multi = champ({ fieldKey: 'diags', type: 'terminology', isMultiple: true, section: null, blockKey: null });
  assertEquals(buildMultivalueTable(multi, PATIENTS, desordre).rows, []);
});

// ---------------------------------------------------------------------------------------
// §14.3 point 22 — une ligne par patient : occurrences absentes, comptage present et exact.
// ---------------------------------------------------------------------------------------

Deno.test("L70 point 22 : une ligne par patient compte les occurrences au lieu d'en choisir une", () => {
  const table = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, 'first');

  assertEquals(table.columns.includes(groupCountColumnId('lesions')), true);
  assertEquals(table.columns.includes(groupCountColumnId('interventions')), true);

  const p1 = lignePatient(table, 'P0001');
  assertEquals(p1[groupCountColumnId('lesions')], 2);
  assertEquals(p1[groupCountColumnId('interventions')], 1);

  // Y COMPRIS A ZERO : la case dit « aucune occurrence », elle ne reste pas vide, ce qui se
  // lirait « on ne sait pas ».
  const p2 = lignePatient(table, 'P0002');
  assertEquals(p2[groupCountColumnId('lesions')], 0);
  assertEquals(p2[groupCountColumnId('interventions')], 0);
});

Deno.test("L70 point 22 : les variables d'un bloc repetable quittent la ligne patient", () => {
  const table = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, 'first');
  // Aucune colonne du bloc : `first`/`last` choisirait une lesion au hasard et la presenterait
  // comme LA lesion du patient. Le comptage la remplace.
  assertEquals(table.columns.includes(columnId(LESION_NIVEAU)), false);
  assertEquals(table.columns.includes(columnId(LESION_GRADE)), false);
  assertEquals(table.columns.includes(columnId(INTERVENTION_VOIE)), false);
  assertEquals(table.columns.includes(columnId(INTERVENTION_DATE)), false);
  // Le bloc ORDINAIRE et le tronc commun, eux, s'agregent comme avant le lot.
  assertEquals(table.columns.includes(columnId(POIDS)), true);
  assertEquals(table.columns.includes(columnId(AGE)), true);

  // Et aucune valeur d'occurrence ne se glisse dans la ligne : `L1` et `T12` n'y sont nulle part.
  const csv = toCsv(table);
  assertEquals(csv.includes('L1'), false);
  assertEquals(csv.includes('T12'), false);
  assertEquals(csv.includes('postérieure'), false);
});

Deno.test('L70 §15.7 : `first` ne peut pas tomber sur une occurrence non datee', () => {
  // Le piege exact : une occurrence sans date se range AVANT toute rencontre datee. Si elle
  // restait dans le vivier d'agregation, `first` la choisirait, et la ligne patient porterait
  // l'age de la lesion (99) au lieu de celui de la consultation (40).
  for (const rule of ['first', 'last'] as const) {
    const table = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, rule);
    const p1 = lignePatient(table, 'P0001');
    assertEquals(p1[columnId(AGE)], 40);
    assertEquals(p1[columnId(POIDS)], 62);
    assertEquals(p1.age_value, 40);
    assertEquals(p1.age_unit, 'years');
  }
});

Deno.test('L70 point 22 : un patient dont TOUTES les rencontres sont des occurrences reste une ligne vide, pas une ligne fausse', () => {
  const sansRencontre: ExportPatient[] = [{ code: 'P0003', templateVersionId: TV, data: { sexe: 'F' } }];
  const seulementDesOccurrences = [
    occurrence('e-lesion-9', 'P0003', 'lesions', { niveau: 'C4', grade: 1, age: 88 }),
  ];
  const table = buildPatientExport(sansRencontre, seulementDesOccurrences, CHAMPS, 'last');
  const p3 = lignePatient(table, 'P0003');
  // Aucune rencontre ordinaire : les colonnes de rencontre sont vides, comme pour un patient
  // qui n'en a aucune — et surtout l'age 88 de la lesion n'est pas promu age du patient.
  assertEquals(p3[columnId(AGE)], '');
  assertEquals(p3.age_value, '');
  assertEquals(p3.age_unit, '');
  // Mais l'occurrence est comptee : elle existe, et le fichier le dit.
  assertEquals(p3[groupCountColumnId('lesions')], 1);
});

Deno.test('L70 point 22 : une base SANS bloc repetable garde exactement sa ligne par patient', () => {
  const sansGroupe = [AGE, POIDS, SEXE];
  const table = buildPatientExport(PATIENTS, RENCONTRES.filter((e) => e.groupSectionKey == null), sansGroupe, 'last');
  assertEquals(table.columns.some((c) => c.startsWith('nb__')), false);
  assertEquals(repeatableBlocksOf(mergeExportFields(sansGroupe)), []);
});

// ---------------------------------------------------------------------------------------
// §14.3 point 23 — projection par bloc sur un bloc repetable.
// ---------------------------------------------------------------------------------------

Deno.test('L70 point 23 : projeter le bloc « lesions » produit le fichier des lesions', () => {
  const projete = projectFields(mergeExportFields(CHAMPS), { mode: 'selected', blockKeys: ['lesions'] });
  const table = buildEncounterExport(RENCONTRES, projete, 'analysis', mergeExportFields(CHAMPS));

  // Les colonnes attendues : la meta — discriminant compris — le tronc commun, et le bloc choisi.
  assertEquals(table.columns, [
    'patient_code',
    'encounter_id',
    'encounter_date',
    'encounter_type',
    'age_value',
    'age_unit',
    'group_section_key',
    columnId(AGE),
    columnId(LESION_GRADE),
    columnId(LESION_NIVEAU),
  ]);
  // La projection choisit des COLONNES, jamais des lignes : les cinq lignes sont toujours la,
  // et `group_section_key` reste ce qui permet de ne garder que les lesions.
  assertEquals(table.rows.length, 5);
  assertEquals(table.rows.filter((r) => r.group_section_key === 'lesions').length, 2);
  assertNoIdentity(table.columns);
});

Deno.test('L70 point 23 : la projection se combine au comptage sans rien ajouter', () => {
  const projete = projectFields(mergeExportFields(CHAMPS), { mode: 'selected', blockKeys: ['lesions'] });
  const table = buildPatientExport(PATIENTS, RENCONTRES, projete, 'last', 'complete', mergeExportFields(CHAMPS));

  // Seul le bloc projete rend son comptage : « interventions » est hors projection, donc absent.
  assertEquals(table.columns.includes(groupCountColumnId('lesions')), true);
  assertEquals(table.columns.includes(groupCountColumnId('interventions')), false);
  assertEquals(lignePatient(table, 'P0001')[groupCountColumnId('lesions')], 2);
  assertNoIdentity(table.columns);
});

Deno.test("L70 point 23 : aucune fuite d'identite par les colonnes nouvelles", () => {
  // La garde s'applique aux DEUX formes et au dictionnaire, colonnes de groupe comprises.
  const parOccurrence = buildEncounterExport(RENCONTRES, CHAMPS);
  const parPatient = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, 'last');
  assertNoIdentity(parOccurrence.columns);
  assertNoIdentity(parPatient.columns);
  assertNoIdentity(
    buildDictionary(CHAMPS, { repeatableCountBlocks: repeatableBlocksOf(mergeExportFields(CHAMPS)) })
      .columns,
  );
  // Et le contenu : ni date de naissance ni nom ne transitent par une occurrence. Les seules
  // valeurs nouvelles sont un code de bloc et un entier.
  const nouvelles = parPatient.columns.filter((c) => c.startsWith('nb__'));
  assertEquals(nouvelles, [groupCountColumnId('interventions'), groupCountColumnId('lesions')]);
  for (const row of parPatient.rows) {
    for (const column of nouvelles) assertEquals(typeof row[column], 'number');
  }
  // `toCsv` repasse la garde de son cote : un export qui fuirait ne pourrait pas etre ecrit.
  toCsv(parOccurrence);
  toCsv(parPatient);
});

// ---------------------------------------------------------------------------------------
// §9.3 — le dictionnaire ENONCE la regle.
// ---------------------------------------------------------------------------------------

Deno.test("L70 : le dictionnaire enonce la colonne de comptage et l'exclusion qu'elle remplace", () => {
  const blocs = repeatableBlocksOf(mergeExportFields(CHAMPS));
  const dict = buildDictionary(CHAMPS, { repeatableCountBlocks: blocs, blockColumns: true });

  const ligneComptage = dict.rows.find((r) => r.column_id === groupCountColumnId('lesions'));
  assertEquals(ligneComptage?.type, 'computed_group_count');
  assertEquals(ligneComptage?.label, "Lésions — nombre d'occurrences");
  assertEquals(ligneComptage?.block, 'lesions');
  const explication = String(ligneComptage?.description ?? '');
  assertStringIncludes(explication, '0 signifie aucune occurrence');
  assertStringIncludes(explication, "ne s'agrègent");
  assertStringIncludes(explication, 'group_section_key');

  // Le dictionnaire reste complet : chaque colonne du fichier y a sa ligne.
  const table = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, 'last');
  const decrites = new Set(dict.rows.map((r) => r.column_id));
  for (const column of table.columns) {
    if (column === 'patient_code' || column === 'age_value' || column === 'age_unit') continue;
    assertEquals(decrites.has(column), true, `colonne non documentee : ${column}`);
  }
});

Deno.test("L70 : sans colonne de comptage, le dictionnaire n'en annonce aucune", () => {
  // Une ligne par occurrence ne compte rien : annoncer `nb__lesions` decrirait une colonne
  // absente du fichier.
  const dict = buildDictionary(CHAMPS);
  assertEquals(dict.rows.some((r) => String(r.column_id).startsWith('nb__lesions')), false);
});

// ---------------------------------------------------------------------------------------
// Recensement des blocs repetables.
// ---------------------------------------------------------------------------------------

Deno.test('L70 : un bloc declare repetable par UNE SEULE revision compte ses occurrences', () => {
  // Une revision ulterieure peut fermer le groupe ; les occurrences deja saisies existent
  // toujours, et une colonne qui disparaitrait les rendrait invisibles sans le dire.
  const v2 = 'v2';
  const ferme: ExportField = { ...LESION_NIVEAU, blockIsRepeatable: false, templateVersionIds: [v2] };
  const blocs = repeatableBlocksOf(mergeExportFields([LESION_NIVEAU, ferme]));
  assertEquals(blocs, [{ key: 'lesions', label: 'Lésions' }]);
});

Deno.test('L70 : les blocs repetables sont recenses par CODE, dans un ordre stable', () => {
  assertEquals(repeatableBlocksOf(mergeExportFields(CHAMPS)), [
    { key: 'interventions', label: 'Interventions' },
    { key: 'lesions', label: 'Lésions' },
  ]);
  // L'ordre ne depend pas de celui des variables en entree.
  assertEquals(repeatableBlocksOf(mergeExportFields([...CHAMPS].reverse())), [
    { key: 'interventions', label: 'Interventions' },
    { key: 'lesions', label: 'Lésions' },
  ]);
});

Deno.test('L70 : une collision de nom entre comptage de groupe et compteur multivalue est REFUSEE', () => {
  // Cas pathologique mais possible : le code de bloc respecte le meme alphabet que la cle de
  // colonne. Le fichier ne doit pas sortir avec deux colonnes homonymes dont l'une ecrase
  // silencieusement l'autre.
  const multivaluee = champ({
    fieldKey: 'poids',
    type: 'terminology',
    isMultiple: true,
    section: null,
    blockKey: null,
    blockLabel: null,
  });
  const blocPiege = champ({
    fieldKey: 'mesure',
    type: 'number',
    section: 'encounter__poids',
    blockKey: 'encounter__poids',
    blockLabel: 'Bloc au nom malheureux',
    blockIsRepeatable: true,
  });
  assertThrows(
    () => buildPatientExport(PATIENTS, RENCONTRES, [multivaluee, blocPiege], 'last'),
    Error,
    'Collision de colonne de comptage de groupe: nb__encounter__poids',
  );
  // La meme base sort normalement en une ligne par occurrence : la collision n'existe que la
  // ou la colonne de comptage existe.
  buildEncounterExport(RENCONTRES, [multivaluee, blocPiege]);
});

Deno.test('L70 : une modalite vue seulement sur une occurrence ne devient pas une indicatrice a zero', () => {
  // Le piege : en Analyse, les indicatrices sont relevees sur les donnees. Une modalite qui
  // n'existe que sur des occurrences produirait une colonne `0` partout — le fichier dirait
  // « jamais selectionnee » d'une modalite bel et bien saisie, sur une ligne qu'il n'affiche pas.
  const signes = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    section: null,
    blockKey: null,
    blockLabel: null,
    allowedValues: ['fievre', 'douleur'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fièvre', is_active: true },
      { value_key: 'douleur', label: 'Douleur', is_active: true },
    ],
  });
  const rencontres: ExportEncounter[] = [
    { ...RENCONTRES[0], data: { signes: ['fievre'] } },
    occurrence('e-lesion-8', 'P0001', 'lesions', { niveau: 'L3', signes: ['douleur'] }),
  ];
  const parPatient = buildPatientExport(PATIENTS, rencontres, [signes, LESION_NIVEAU], 'last', 'analysis');
  assertEquals(parPatient.columns.some((c) => c.endsWith('__fievre')), true);
  assertEquals(parPatient.columns.some((c) => c.endsWith('__douleur')), false);

  // En une ligne par occurrence, la modalite est la : c'est le fichier qui porte la ligne.
  const parOccurrence = buildEncounterExport(rencontres, [signes, LESION_NIVEAU], 'analysis');
  assertEquals(parOccurrence.columns.some((c) => c.endsWith('__douleur')), true);
});
