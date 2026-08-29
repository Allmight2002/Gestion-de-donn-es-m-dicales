// Contrat d'export : rendu des valeurs en cellules.
//
// Le cas critique est le champ de terminologie. Sa valeur est un objet {code, label} ;
// avant correction, elle tombait dans le `String(v)` final et toute la colonne rendait
// « [object Object] » — la donnee etait en base, mais l'export inexploitable. Ce projet
// avait deja connu ce defaut en juillet avec les codes de valeur manquante.
import { assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  analyticId,
  assertNoAnalyticIdCollisions,
  buildDictionary,
  buildEncounterExport,
  buildMetadata,
  buildModalities,
  buildMultivalueTable,
  buildPatientExport,
  checkFormula,
  codeColumnId,
  columnId,
  evaluateFormulaText,
  excelDateSerial,
  excelDatetimeSerial,
  type ExportEncounter,
  type ExportField,
  type ExportPatient,
  type ExportTable,
  extractMultivalueCodes,
  formulaFieldIndex,
  type FormulaFieldRef,
  mergeExportFields,
  nbColumnId,
  optionCodeColumnId,
  toCsv,
  withExcelDateSerials,
} from './exportContract.ts';
import { FORMULA_CASE_FIELDS, FORMULA_CASES } from './formulaCases.ts';

const champ = (over: Partial<ExportField> & Pick<ExportField, 'fieldKey' | 'type'>): ExportField => ({
  label: over.fieldKey,
  scope: 'encounter',
  section: 'clinique',
  unit: null,
  allowedValues: null,
  description: null,
  ...over,
});

const DIAGNOSTIC = champ({ fieldKey: 'diagnostic', type: 'terminology' });
const ISSUE = champ({ fieldKey: 'issue', type: 'select' });

const rencontre = (data: Record<string, unknown>): ExportEncounter => ({
  id: 'e1',
  patientCode: 'P0001',
  encounterDate: '2026-01-01',
  encounterType: 'consultation',
  data,
});

Deno.test('terminologie : le libelle part en cellule, jamais [object Object]', () => {
  const table = buildEncounterExport(
    [rencontre({ diagnostic: { code: '1A00', label: 'Cholera' } })],
    [DIAGNOSTIC],
  );
  assertEquals(table.rows[0][columnId(DIAGNOSTIC)], 'Cholera');
});

Deno.test('terminologie : le code occupe sa propre colonne, pour regrouper sans ambiguite', () => {
  const table = buildEncounterExport(
    [rencontre({ diagnostic: { code: '1A00', label: 'Cholera' } })],
    [DIAGNOSTIC],
  );
  assertEquals(table.columns.includes(codeColumnId(DIAGNOSTIC)), true);
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '1A00');
});

Deno.test('la colonne de code ne peut pas entrer en collision avec une cle de champ', () => {
  const homonyme = champ({ fieldKey: 'diagnostic__code', type: 'text' });
  const table = buildEncounterExport(
    [rencontre({ diagnostic: { code: '1A00', label: 'Cholera' }, diagnostic__code: 'valeur metier' })],
    [DIAGNOSTIC, homonyme],
  );
  assertEquals(new Set(table.columns).size, table.columns.length);
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '1A00');
  assertEquals(table.rows[0][columnId(homonyme)], 'valeur metier');
});

Deno.test('le dictionnaire documente aussi la colonne analytique du code', () => {
  const dictionary = buildDictionary([DIAGNOSTIC]);
  assertEquals(dictionary.rows, [
    {
      column_id: columnId(DIAGNOSTIC),
      description: '',
      label: 'diagnostic',
      type: 'terminology',
      is_multiple: 'false',
      field_key: 'diagnostic',
      scope: 'encounter',
      section: 'clinique',
      section_label: '',
      unit: '',
      allowed_values: '',
      missing_reasons: '',
      template_versions: '',
      // L35 : colonne ajoutee au dictionnaire. Vide sur une variable saisie.
      formula: '',
    },
    {
      column_id: codeColumnId(DIAGNOSTIC),
      description: '',
      label: 'diagnostic — code',
      type: 'terminology_code',
      is_multiple: 'false',
      field_key: 'diagnostic',
      scope: 'encounter',
      section: 'clinique',
      section_label: '',
      unit: '',
      allowed_values: '',
      missing_reasons: '',
      template_versions: '',
      // L35 : colonne ajoutee au dictionnaire. Vide sur une variable saisie.
      formula: '',
    },
  ]);
});

Deno.test('la colonne de code n existe que pour les champs de terminologie', () => {
  const table = buildEncounterExport([rencontre({ issue: 'Domicile' })], [ISSUE]);
  assertEquals(table.columns.includes(codeColumnId(ISSUE)), false);
  assertEquals(table.rows[0][columnId(ISSUE)], 'Domicile');
});

Deno.test('le dictionnaire porte la consigne de saisie', () => {
  const dictionary = buildDictionary([
    champ({ fieldKey: 'glasgow', type: 'integer', description: 'Premier score documenté avant toute sédation' }),
  ]);
  assertEquals(dictionary.columns.includes('description'), true);
  assertEquals(dictionary.rows[0].description, 'Premier score documenté avant toute sédation');
});

Deno.test('un diagnostic absent laisse les deux colonnes vides', () => {
  const table = buildEncounterExport([rencontre({})], [DIAGNOSTIC]);
  assertEquals(table.rows[0][columnId(DIAGNOSTIC)], '');
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '');
});

// Les codes de donnee manquante restent prioritaires : ils sont traites avant.
Deno.test('une valeur manquante codifiee sort son code, sans code de terminologie', () => {
  const table = buildEncounterExport(
    [rencontre({ diagnostic: { __missing__: 'inconnu' } })],
    [DIAGNOSTIC],
  );
  assertEquals(table.rows[0][columnId(DIAGNOSTIC)], 'inconnu');
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '');
});

Deno.test('export par patient : les deux colonnes suivent l agregation', () => {
  const patients: ExportPatient[] = [{ code: 'P0001', data: {} }];
  const table = buildPatientExport(
    patients,
    [rencontre({ diagnostic: { code: '5A11', label: 'Diabete de type 2' } })],
    [DIAGNOSTIC],
    'first',
  );
  assertEquals(table.rows[0][columnId(DIAGNOSTIC)], 'Diabete de type 2');
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '5A11');
});

Deno.test('export par patient : sans rencontre retenue, les colonnes restent vides', () => {
  const table = buildPatientExport([{ code: 'P0002', data: {} }], [], [DIAGNOSTIC], 'first');
  assertEquals(table.rows[0][columnId(DIAGNOSTIC)], '');
  assertEquals(table.rows[0][codeColumnId(DIAGNOSTIC)], '');
});

// Un champ de terminologie en portee patient doit se comporter a l'identique.
Deno.test('terminologie en portee patient : libelle et code', () => {
  const patientDiag = champ({ fieldKey: 'antecedent', type: 'terminology', scope: 'patient' });
  const table = buildPatientExport(
    [{ code: 'P0003', data: { antecedent: { code: 'BA00', label: 'Hypertension' } } }],
    [],
    [patientDiag],
    'first',
  );
  assertEquals(table.rows[0][columnId(patientDiag)], 'Hypertension');
  assertEquals(table.rows[0][codeColumnId(patientDiag)], 'BA00');
});

// ---------------------------------------------------------------------------
// L30 — listes controlees a code interne stable
//
// Meme raison d'etre que la colonne de code de la terminologie : le libelle se corrige,
// le code ne bouge pas. Sans la colonne de code, corriger « hematome » en « hematome »
// accentue scinderait la modalite en deux dans l'analyse, en silence.
// ---------------------------------------------------------------------------

const EVOLUTION = champ({
  fieldKey: 'evolution',
  type: 'select',
  allowedValues: ['gueri', 'deces'],
  allowedOptions: [
    { value_key: 'gueri', label: 'Gueri', is_active: true },
    { value_key: 'deces', label: 'Deces', is_active: false },
  ],
});

Deno.test('liste : le libelle part en cellule, le code dans sa propre colonne', () => {
  const table = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION]);
  assertEquals(table.columns.includes(optionCodeColumnId(EVOLUTION)), true);
  assertEquals(table.rows[0][columnId(EVOLUTION)], 'Gueri');
  assertEquals(table.rows[0][optionCodeColumnId(EVOLUTION)], 'gueri');
});

Deno.test('liste : une option desactivee reste lisible dans les fiches qui la portent', () => {
  const table = buildEncounterExport([rencontre({ evolution: 'deces' })], [EVOLUTION]);
  assertEquals(table.rows[0][columnId(EVOLUTION)], 'Deces');
  assertEquals(table.rows[0][optionCodeColumnId(EVOLUTION)], 'deces');
});

Deno.test('liste : un code inconnu est rendu tel quel, jamais efface', () => {
  // Sequelle d'un renommage anterieur au lot : la valeur ne correspond a aucune option.
  const table = buildEncounterExport([rencontre({ evolution: 'hematome' })], [EVOLUTION]);
  assertEquals(table.rows[0][columnId(EVOLUTION)], 'hematome');
  assertEquals(table.rows[0][optionCodeColumnId(EVOLUTION)], 'hematome');
});

Deno.test('liste multiple : libelles et codes voyagent dans le meme ordre', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre', 'toux'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fievre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: true },
    ],
  });
  const table = buildEncounterExport([rencontre({ signes: ['toux', 'fievre'] })], [multi]);
  assertEquals(table.columns.slice(6, 9), [columnId(multi), optionCodeColumnId(multi), nbColumnId(multi)]);
  assertEquals(table.rows[0][columnId(multi)], 'Toux; Fievre');
  assertEquals(table.rows[0][optionCodeColumnId(multi)], 'toux; fievre');
  assertEquals(table.rows[0][nbColumnId(multi)], 2);
});

Deno.test('L36 : un multiselect a trois indicatrices 1/0 et un nombre exact', () => {
  const multi = champ({
    fieldKey: 'signes',
    label: 'Signes',
    type: 'multiselect',
    allowedValues: ['fievre', 'toux', 'douleur'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fièvre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: true },
      { value_key: 'douleur', label: 'Douleur', is_active: true },
    ],
  });
  const e2: ExportEncounter = {
    ...rencontre({ signes: ['douleur'] }),
    id: 'e2',
    patientCode: 'P0002',
    encounterDate: '2026-01-02',
  };
  const e3: ExportEncounter = {
    ...rencontre({ signes: { __missing__: 'non_documente' } }),
    id: 'e3',
    patientCode: 'P0003',
    encounterDate: '2026-01-03',
  };
  const table = buildEncounterExport(
    [rencontre({ signes: ['toux', 'fievre'] }), e2, e3],
    [multi],
  );
  const fievre = `has__${columnId(multi)}__fievre`;
  const toux = `has__${columnId(multi)}__toux`;
  const douleur = `has__${columnId(multi)}__douleur`;

  assertEquals(table.rows[0][columnId(multi)], 'Toux; Fièvre');
  assertEquals(table.rows[0][nbColumnId(multi)], 2);
  assertEquals(table.rows[0][fievre], 1);
  assertEquals(table.rows[0][toux], 1);
  assertEquals(table.rows[0][douleur], 0);
  assertEquals(table.rows[1][nbColumnId(multi)], 1);
  assertEquals(table.rows[1][fievre], 0);
  assertEquals(table.rows[1][toux], 0);
  assertEquals(table.rows[1][douleur], 1);
  assertEquals(table.rows[2][columnId(multi)], 'non_documente');
  assertEquals(table.rows[2][nbColumnId(multi)], 0);
  assertEquals(table.rows[2][fievre], 0);
  assertEquals(table.rows[2][toux], 0);
  assertEquals(table.rows[2][douleur], 0);

  const { indicatorsByField } = extractMultivalueCodes([multi], [
    rencontre({ signes: ['toux', 'fievre'] }),
    e2,
  ]);
  const dictionary = buildDictionary([multi], { indicatorsByField });
  const fievreRow = dictionary.rows.find((row) => row.column_id === fievre);
  assertEquals(fievreRow?.label, 'Signes — Fièvre');
});

Deno.test('L36 : un code inconnu reste identique dans la feuille principale et la feuille longue', () => {
  const multi = champ({
    fieldKey: 'signes',
    label: 'Signes',
    type: 'multiselect',
    allowedValues: ['fievre'],
    allowedOptions: [{ value_key: 'fievre', label: 'Fièvre', is_active: true }],
  });
  const encounter = rencontre({ signes: ['code_historique_inconnu'] });
  const main = buildEncounterExport([encounter], [multi]);
  const long = buildMultivalueTable(multi, [], [encounter]);

  assertEquals(main.rows[0][columnId(multi)], 'code_historique_inconnu');
  assertEquals(main.rows[0][optionCodeColumnId(multi)], 'code_historique_inconnu');
  assertEquals(long.rows, [{
    patient_code: 'P0001',
    encounter_id: 'e1',
    rang: 1,
    code: 'code_historique_inconnu',
    label: 'code_historique_inconnu',
  }]);
});

Deno.test('L36 : au-delà de 100 codes, les indicatrices sont omises et le dictionnaire le signale', () => {
  const codes = Array.from({ length: 101 }, (_, index) => `code_${index}`);
  const multi = champ({
    fieldKey: 'signes',
    label: 'Signes',
    type: 'multiselect',
    allowedValues: codes,
  });
  const encounter = rencontre({ signes: codes });
  const { indicatorsByField, omittedFieldKeys } = extractMultivalueCodes([multi], [encounter]);
  const table = buildEncounterExport([encounter], [multi]);
  const dictionary = buildDictionary([multi], { indicatorsByField, omittedFieldKeys });
  const omittedRow = dictionary.rows.find((row) => row.column_id === `has__${columnId(multi)}`);

  assertEquals(omittedFieldKeys.has('signes'), true);
  assertEquals(indicatorsByField.get('signes'), []);
  assertEquals(table.columns.some((column) => column.startsWith(`has__${columnId(multi)}__`)), false);
  assertEquals(omittedRow?.type, 'computed_indicator_omitted');
});

Deno.test('L47 : en Analyse, un multiselect ne rend que ses indicatrices, sans concatenations ni compteur', () => {
  const multi = champ({
    fieldKey: 'signes',
    label: 'Signes',
    type: 'multiselect',
    allowedValues: ['fievre', 'toux', 'douleur'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fievre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: true },
      { value_key: 'douleur', label: 'Douleur', is_active: true },
    ],
  });
  const fievre = `has__${columnId(multi)}__fievre`;
  const toux = `has__${columnId(multi)}__toux`;
  const douleur = `has__${columnId(multi)}__douleur`;
  // Non applicable : le champ appartient a une autre version de gabarit.
  const multiV2 = { ...multi, templateVersionIds: ['v2'] };
  const r = (patientCode: string, data: Record<string, unknown>, templateVersionId?: string): ExportEncounter => ({
    ...rencontre(data),
    patientCode,
    templateVersionId,
  });
  const table = buildEncounterExport(
    [
      r('P0001', { signes: ['toux', 'fievre'] }),
      r('P0002', { signes: ['douleur'] }),
      r('P0003', { signes: { __missing__: 'non_documente' } }),
      r('P0004', { signes: [] }),
      r('P0005', { autre: 1 }), // valeur absente sur un champ applicable
      r('P0006', { signes: ['toux'] }, 'v1'), // champ absent de la version -> cellules vides
    ],
    [multiV2],
    'analysis',
  );

  assertEquals(table.columns.includes(columnId(multi)), false);
  assertEquals(table.columns.includes(optionCodeColumnId(multi)), false);
  assertEquals(table.columns.includes(nbColumnId(multi)), false);
  assertEquals(table.columns.slice(6), [douleur, fievre, toux]);
  assertEquals(table.rows[0][fievre], 1);
  assertEquals(table.rows[0][toux], 1);
  assertEquals(table.rows[0][douleur], 0);
  assertEquals(table.rows[1][fievre], 0);
  assertEquals(table.rows[1][toux], 0);
  assertEquals(table.rows[1][douleur], 1);
  // Chaque indicatrice est un nombre 0/1, jamais une chaine.
  assertEquals(typeof table.rows[0][fievre], 'number');
  assertEquals(typeof table.rows[1][douleur], 'number');
  // Raison de manque explicite -> AUCUNE indicatrice a 1, toutes a 0.
  assertEquals([table.rows[2][fievre], table.rows[2][toux], table.rows[2][douleur]], [0, 0, 0]);
  // Liste vide sur un champ applicable -> 0, jamais vide.
  assertEquals([table.rows[3][fievre], table.rows[3][toux], table.rows[3][douleur]], [0, 0, 0]);
  // Valeur absente sur un champ applicable -> 0 (champ applicable mais aucune modalite).
  assertEquals([table.rows[4][fievre], table.rows[4][toux], table.rows[4][douleur]], [0, 0, 0]);
  // Champ non applicable (absent de la version de la fiche) -> cellule vide.
  assertEquals([table.rows[5][fievre], table.rows[5][toux], table.rows[5][douleur]], ['', '', '']);
});

Deno.test('L47 : Analyse, les indicatrices du multiselect et de la terminologie restent separees', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre'],
    allowedOptions: [{ value_key: 'fievre', label: 'Fievre', is_active: true }],
  });
  const diag = champ({
    fieldKey: 'diagnostic',
    type: 'terminology',
    isMultiple: true,
    allowedValues: null,
  });
  const encounter = rencontre({
    signes: ['fievre'],
    diagnostic: [
      { code: '1A00', label: 'Cholera' },
      { code: 'BA00', label: 'Hypertension' },
    ],
  });
  const table = buildEncounterExport([encounter], [multi, diag], 'analysis');
  // Le multiselect n'a ni concatenations ni compteur en Analyse...
  assertEquals(table.columns.includes(columnId(multi)), false);
  assertEquals(table.columns.includes(nbColumnId(multi)), false);
  // ... mais la terminologie multivaluee garde ses formes (hors perimetre L47, L50).
  assertEquals(table.columns.includes(columnId(diag)), true);
  assertEquals(table.columns.includes(codeColumnId(diag)), true);
  assertEquals(table.columns.includes(nbColumnId(diag)), true);
  assertEquals(table.rows[0][columnId(diag)], 'Cholera; Hypertension');
  assertEquals(table.rows[0][`has__${columnId(diag)}__1a00`], 1);
  assertEquals(table.rows[0][`has__${columnId(multi)}__fievre`], 1);
});

Deno.test('L47 : Analyse, code historique inconnu et collision de suffixes restent distincts', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre'],
    allowedOptions: [{ value_key: 'fievre', label: 'Fievre', is_active: true }],
  });
  // Deux codes differents ('A-B' et 'a_b') se normalisent vers le meme suffixe : le second
  // porte un compteur pour rester distinct, et chaque ligne garde la bonne indicatrice.
  const r = (patientCode: string, signes: string[]): ExportEncounter => ({
    ...rencontre({ signes }),
    patientCode,
  });
  const table = buildEncounterExport(
    [
      r('P0001', ['code_historique_inconnu', 'A-B']),
      r('P0002', ['a_b']),
    ],
    [multi],
    'analysis',
  );
  const has = (suffix: string) => `has__${columnId(multi)}__${suffix}`;
  const cols = table.columns.slice(6);
  assertEquals(new Set(cols).size, cols.length);
  assertEquals(cols.includes(has('code_historique_inconnu')), true);
  assertEquals(cols.includes(has('a_b')), true);
  assertEquals(cols.includes(has('a_b_2')), true);
  // Un code inconnu historique n'est jamais efface : il existe, il est selectionne -> 1.
  assertEquals(table.rows[0][has('code_historique_inconnu')], 1);
  assertEquals(table.rows[0][has('a_b')], 1);
  assertEquals(table.rows[0][has('a_b_2')], 0);
  assertEquals(table.rows[1][has('a_b')], 0);
  assertEquals(table.rows[1][has('a_b_2')], 1);
});

Deno.test('L47 : le profil complete conserve les formes du multiselect, sans perte', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre', 'toux'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fievre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: true },
    ],
  });
  const encounter = { ...rencontre({ signes: ['toux', 'fievre'] }), patientCode: 'P0001' };
  const table = buildEncounterExport([encounter], [multi]);
  assertEquals(table.columns.slice(6, 9), [columnId(multi), optionCodeColumnId(multi), nbColumnId(multi)]);
  assertEquals(table.rows[0][columnId(multi)], 'Toux; Fievre');
  assertEquals(table.rows[0][optionCodeColumnId(multi)], 'toux; fievre');
  assertEquals(table.rows[0][nbColumnId(multi)], 2);
  assertEquals(table.rows[0][`has__${columnId(multi)}__fievre`], 1);
  assertEquals(table.rows[0][`has__${columnId(multi)}__toux`], 1);
});

Deno.test('L47 : Analyse par patient, le multiselect de rencontre rend aussi ses indicatrices seules', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre', 'toux'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fievre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: true },
    ],
  });
  const table = buildPatientExport(
    [{ code: 'P1', data: {} }],
    [
      {
        id: 'e1',
        patientCode: 'P1',
        encounterDate: '2026-01-01',
        encounterType: 'consultation',
        data: { signes: ['toux'] },
      },
      {
        id: 'e2',
        patientCode: 'P1',
        encounterDate: '2026-01-02',
        encounterType: 'consultation',
        data: { signes: ['fievre'] },
      },
    ],
    [multi],
    'first',
    'analysis',
  );
  assertEquals(table.columns.includes(columnId(multi)), false);
  assertEquals(table.columns.includes(nbColumnId(multi)), false);
  // 'first' retient la rencontre e1 : toux selectionne, fievre present dans la population mais
  // non selectionne sur la ligne retenue -> 0 (le 0 n'est jamais confondu avec une absence).
  assertEquals(table.rows[0][`has__${columnId(multi)}__toux`], 1);
  assertEquals(table.rows[0][`has__${columnId(multi)}__fievre`], 0);
});

Deno.test('liste : une raison de valeur manquante part dans la colonne du libelle, pas dans celle du code', () => {
  const table = buildEncounterExport([rencontre({ evolution: { __missing__: 'inconnu' } })], [EVOLUTION]);
  assertEquals(table.rows[0][columnId(EVOLUTION)], 'inconnu');
  assertEquals(table.rows[0][optionCodeColumnId(EVOLUTION)], '');
});

Deno.test('liste sans options connues (instantane ancien) : le code stocke fait office de libelle', () => {
  const ancien = champ({ fieldKey: 'sexe', type: 'select', allowedValues: ['M', 'F'] });
  const table = buildEncounterExport([rencontre({ sexe: 'M' })], [ancien]);
  assertEquals(table.rows[0][columnId(ancien)], 'M');
  assertEquals(table.rows[0][optionCodeColumnId(ancien)], 'M');
});

Deno.test('dictionnaire : une ligne de libelles, une ligne de codes, les inactives signalees', () => {
  const dict = buildDictionary([EVOLUTION]);
  const valeurs = dict.rows.find((r) => r.column_id === columnId(EVOLUTION));
  const codes = dict.rows.find((r) => r.column_id === optionCodeColumnId(EVOLUTION));
  assertEquals(valeurs?.allowed_values, 'Gueri; Deces (inactif)');
  assertEquals(codes?.allowed_values, 'gueri; deces');
  assertEquals(codes?.type, 'select_code');
});

Deno.test('dictionnaire : une colonne traversant deux versions decrit TOUTES ses options', () => {
  // Sinon un code lu dans une fiche ancienne ne s'explique nulle part.
  const v1 = champ({
    fieldKey: 'evolution',
    type: 'select',
    templateVersionIds: ['v1'],
    allowedValues: ['gueri'],
    allowedOptions: [{ value_key: 'gueri', label: 'Gueri', is_active: true }],
  });
  const v2 = champ({
    fieldKey: 'evolution',
    type: 'select',
    templateVersionIds: ['v2'],
    allowedValues: ['gueri', 'perdu'],
    allowedOptions: [
      { value_key: 'gueri', label: 'Gueri', is_active: true },
      { value_key: 'perdu', label: 'Perdu de vue', is_active: true },
    ],
  });
  const dict = buildDictionary([v1, v2]);
  const codes = dict.rows.find((r) => r.column_id === optionCodeColumnId(v1));
  assertEquals(codes?.allowed_values, 'gueri; perdu');
});

// L31 — une section personnalisee doit apparaitre au dictionnaire. Le CODE reste dans la
// colonne `section` (inchangee pour une base qui n'a pas touche aux siennes) et le libelle
// occupe la sienne : sans lui, « imagerie_cerebrale » serait tout ce que verrait la
// personne qui relit l'export.
Deno.test('le dictionnaire nomme une section personnalisee', () => {
  const dictionary = buildDictionary([
    champ({
      fieldKey: 'tdm_realisee',
      type: 'boolean',
      section: 'imagerie_cerebrale',
      sectionLabel: 'Imagerie cérébrale',
    }),
  ]);
  assertEquals(dictionary.columns.includes('section_label'), true);
  assertEquals(dictionary.rows[0].section, 'imagerie_cerebrale');
  assertEquals(dictionary.rows[0].section_label, 'Imagerie cérébrale');
});

// Une colonne qui traverse deux versions dont l'une seulement porte le libelle ne doit pas
// perdre son nom lisible : le premier libelle connu tient.
Deno.test('le libelle de section survit a la fusion entre versions', () => {
  const merged = mergeExportFields([
    champ({ fieldKey: 'tdm', type: 'boolean', section: 'imagerie', sectionLabel: null, templateVersionIds: ['v1'] }),
    champ({
      fieldKey: 'tdm',
      type: 'boolean',
      section: 'imagerie',
      sectionLabel: 'Imagerie',
      templateVersionIds: ['v2'],
    }),
  ]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].sectionLabel, 'Imagerie');
});

// ---------------------------------------------------------------------------
// D13 — l'ordre des colonnes de l'export suit display_order, pas l'alphabet
// ---------------------------------------------------------------------------
Deno.test('D13 : les colonnes de donnees suivent display_order du gabarit', () => {
  const f1 = champ({ fieldKey: 'z_premier', type: 'text', displayOrder: 1 });
  const f2 = champ({ fieldKey: 'a_second', type: 'text', displayOrder: 2 });
  const table = buildEncounterExport([rencontre({ z_premier: '1', a_second: '2' })], [f1, f2]);
  const col1 = table.columns.indexOf(columnId(f1));
  const col2 = table.columns.indexOf(columnId(f2));
  assertEquals(col1 < col2, true);
});

// ---------------------------------------------------------------------------
// D14 — types natifs des cellules dans le tableau d'export (XLSX)
// ---------------------------------------------------------------------------
Deno.test('D14 : les nombres et entiers sont stockes comme nombres natifs JS', () => {
  const gcs = champ({ fieldKey: 'gcs', type: 'integer' });
  const hb = champ({ fieldKey: 'hemoglobine', type: 'number' });
  const table = buildEncounterExport([rencontre({ gcs: 8, hemoglobine: 12.5 })], [gcs, hb]);
  assertEquals(typeof table.rows[0][columnId(gcs)], 'number');
  assertEquals(table.rows[0][columnId(gcs)], 8);
  assertEquals(typeof table.rows[0][columnId(hb)], 'number');
  assertEquals(table.rows[0][columnId(hb)], 12.5);
});

Deno.test('D14 : age_value est un nombre natif quand il est present', () => {
  const enc: ExportEncounter = {
    id: 'e1',
    patientCode: 'P0001',
    encounterDate: '2026-01-01',
    encounterType: 'consultation',
    ageValue: 34,
    ageUnit: 'ans',
    data: {},
  };
  const table = buildEncounterExport([enc], []);
  assertEquals(typeof table.rows[0].age_value, 'number');
  assertEquals(table.rows[0].age_value, 34);
});

// ---------------------------------------------------------------------------
// L22 — Listes de diagnostics multivaluées à l'export
// ---------------------------------------------------------------------------
const DIAG_MULTI = champ({ fieldKey: 'diagnostics', type: 'terminology', isMultiple: true });

Deno.test('L22 : une liste de diagnostics ne produit JAMAIS [object Object]', () => {
  const table = buildEncounterExport(
    [
      rencontre({
        diagnostics: [
          { code: '1A00', label: 'Cholera' },
          { code: 'BA00', label: 'Hypertension' },
        ],
      }),
    ],
    [DIAG_MULTI],
  );
  assertEquals(table.rows[0][columnId(DIAG_MULTI)], 'Cholera; Hypertension');
  assertEquals(table.rows[0][codeColumnId(DIAG_MULTI)], '1A00; BA00');
  assertEquals(table.rows[0][`nb__${columnId(DIAG_MULTI)}`], 2);
});

Deno.test('L22 : donnée manquante codifiée sur champ multivalué laisse nb vide', () => {
  const table = buildEncounterExport(
    [rencontre({ diagnostics: { __missing__: 'non_fait' } })],
    [DIAG_MULTI],
  );
  assertEquals(table.rows[0][columnId(DIAG_MULTI)], 'non_fait');
  assertEquals(table.rows[0][codeColumnId(DIAG_MULTI)], '');
  assertEquals(table.rows[0][`nb__${columnId(DIAG_MULTI)}`], '');
});

Deno.test('L22 : export mixte : une valeur unitaire ancienne reste correctement rendue', () => {
  const table = buildEncounterExport(
    [rencontre({ diagnostics: { code: '1A00', label: 'Cholera' } })],
    [DIAG_MULTI],
  );
  assertEquals(table.rows[0][columnId(DIAG_MULTI)], 'Cholera');
  assertEquals(table.rows[0][codeColumnId(DIAG_MULTI)], '1A00');
  assertEquals(table.rows[0][`nb__${columnId(DIAG_MULTI)}`], 1);
});

Deno.test('L22 : colonnes indicatrices has__... créées pour les codes présents et renseignées en 0/1', () => {
  const e1 = rencontre({
    diagnostics: [
      { code: '1A00', label: 'Cholera' },
      { code: 'BA00', label: 'Hypertension' },
    ],
  });
  const e2: ExportEncounter = {
    id: 'e2',
    patientCode: 'P0002',
    encounterDate: '2026-01-02',
    encounterType: 'consultation',
    data: {
      diagnostics: [{ code: '1A00', label: 'Cholera' }],
    },
  };
  const table = buildEncounterExport([e1, e2], [DIAG_MULTI]);

  const colCholera = `has__${columnId(DIAG_MULTI)}__1a00`;
  const colHyper = `has__${columnId(DIAG_MULTI)}__ba00`;

  assertEquals(table.columns.includes(colCholera), true);
  assertEquals(table.columns.includes(colHyper), true);

  assertEquals(table.rows[0][colCholera], 1);
  assertEquals(table.rows[0][colHyper], 1);
  assertEquals(table.rows[1][colCholera], 1);
  assertEquals(table.rows[1][colHyper], 0);
});

Deno.test('L22 : au-delà de 100 codes distincts, les colonnes indicatrices sont omises', () => {
  const manyDiagnostics = Array.from({ length: 105 }, (_, i) => ({
    code: `CODE_${i}`,
    label: `Diagnostic ${i}`,
  }));
  const table = buildEncounterExport([rencontre({ diagnostics: manyDiagnostics })], [DIAG_MULTI]);
  const hasIndicators = table.columns.some((c) => c.startsWith(`has__${columnId(DIAG_MULTI)}__`));
  assertEquals(hasIndicators, false);
});

Deno.test('L22 : feuille dédiée buildMultivalueTable produit patient_code, encounter_id, rang, code, label', () => {
  const e1 = rencontre({
    diagnostics: [
      { code: '1A00', label: 'Cholera' },
      { code: 'BA00', label: 'Hypertension' },
    ],
  });
  const table = buildMultivalueTable(DIAG_MULTI, [], [e1]);
  assertEquals(table.columns, ['patient_code', 'encounter_id', 'rang', 'code', 'label']);
  assertEquals(table.rows, [
    {
      patient_code: 'P0001',
      encounter_id: 'e1',
      rang: 1,
      code: '1A00',
      label: 'Cholera',
    },
    {
      patient_code: 'P0001',
      encounter_id: 'e1',
      rang: 2,
      code: 'BA00',
      label: 'Hypertension',
    },
  ]);
});

Deno.test('L22 : le dictionnaire documente is_multiple=true et la colonne nb__...', () => {
  const dict = buildDictionary([DIAG_MULTI]);
  const isMultipleCol = dict.columns.includes('is_multiple');
  assertEquals(isMultipleCol, true);

  const mainRow = dict.rows.find((r) => r.column_id === columnId(DIAG_MULTI));
  assertEquals(mainRow?.is_multiple, 'true');

  const nbRow = dict.rows.find((r) => r.column_id === nbColumnId(DIAG_MULTI));
  assertEquals(nbRow?.label, 'diagnostics — nombre');
  assertEquals(nbRow?.type, 'computed_count');

  const sample = rencontre({
    diagnostics: [{ code: '1A00', label: 'Cholera' }],
  });
  const { indicatorsByField } = extractMultivalueCodes([DIAG_MULTI], [sample]);
  const dictionaryWithIndicators = buildDictionary([DIAG_MULTI], { indicatorsByField });
  const indicatorRow = dictionaryWithIndicators.rows.find(
    (row) => row.column_id === `has__${columnId(DIAG_MULTI)}__1a00`,
  );
  assertEquals(indicatorRow?.label, 'diagnostics — Cholera');
});

// =============================================================================
// L35 — variables calculees
// =============================================================================

// LA GARANTIE CENTRALE DU LOT. Le meme tableau de cas est rejoue ici (Deno, Edge Function de
// production) et dans `test/formula.test.ts` (Node, cote navigateur). Les deux mondes lisent
// le meme module TypeScript ; ce test le PROUVE au lieu de le supposer — y compris le jour ou
// quelqu'un croira bien faire en recopiant l'evaluateur dans l'un des deux.
Deno.test('L35 : le jeu de cas partage donne les memes resultats cote Deno que cote web', () => {
  const index = formulaFieldIndex(FORMULA_CASE_FIELDS as FormulaFieldRef[]);
  for (const c of FORMULA_CASES) {
    assertEquals(evaluateFormulaText(c.formula, c.data, index), c.expected, c.name);
  }
});

Deno.test('L35 : checkFormula refuse aux memes conditions des deux cotes', () => {
  const peers: FormulaFieldRef[] = [
    { fieldKey: 'score_j0', type: 'integer' },
    { fieldKey: 'date_entree', type: 'date' },
    { fieldKey: 'date_sortie', type: 'date' },
    { fieldKey: 'heure_entree', type: 'datetime' },
    { fieldKey: 'heure_sortie', type: 'datetime' },
    { fieldKey: 'commentaire', type: 'text' },
    { fieldKey: 'duree_deja_calculee', type: 'integer', formula: 'date_sortie - date_entree' },
  ];
  assertEquals(checkFormula('date_sortie - date_entree', 'duree', peers).outputType, 'integer');
  assertEquals(checkFormula('date_sortie - date_entree', 'duree_heures', peers, 'hours').outputType, 'integer');
  assertEquals(checkFormula('date_sortie - date_entree', 'duree_semaines', peers, 'weeks').outputType, 'number');
  assertEquals(checkFormula('heure_sortie - heure_entree', 'duree_precise', peers).outputType, 'number');
  assertEquals(checkFormula('heure_sortie - date_entree', 'duree_mixte', peers).outputType, 'number');
  assertEquals(checkFormula('date_sortie - heure_entree', 'duree_mixte_inverse', peers).outputType, 'number');
  assertEquals(checkFormula('score_j0 * 2', 'double', peers).outputType, 'number');
  assertEquals(checkFormula('score_j0 - absent', 'x', peers).problem, 'unknown_operand');
  assertEquals(checkFormula('score_j0 - commentaire', 'x', peers).problem, 'operand_type');
  assertEquals(checkFormula('duree_deja_calculee * 2', 'x', peers).problem, 'calculated_operand');
  assertEquals(checkFormula('date_sortie + date_entree', 'x', peers).problem, 'operator_type');
  assertEquals(checkFormula('heure_entree + 3', 'x', peers).problem, 'operator_type');
  assertEquals(checkFormula('2 + 3', 'x', peers).problem, 'constant_only');
  assertEquals(checkFormula('a + b - c', 'x', peers).problem, 'syntax');
});

const DUREE = champ({
  fieldKey: 'duree_sejour',
  type: 'integer',
  label: 'Duree de sejour',
  formula: 'date_sortie - date_entree',
});
const ENTREE = champ({ fieldKey: 'date_entree', type: 'date', label: 'Date d entree' });
const SORTIE = champ({ fieldKey: 'date_sortie', type: 'date', label: 'Date de sortie' });

Deno.test('L35 : la colonne calculee est RECALCULEE a l export, sans rien lire dans la fiche', () => {
  const table = buildEncounterExport(
    [rencontre({ date_entree: '2024-02-01', date_sortie: '2024-03-01' })],
    [ENTREE, SORTIE, DUREE],
  );
  assertEquals(table.rows[0][columnId(DUREE)], 29);
  // Une seule colonne : ni code, ni nombre, ni indicatrices — il n'y a rien a coder.
  assertEquals(table.columns.filter((c) => c.includes('duree_sejour')), [columnId(DUREE)]);
});

Deno.test('L35 : la duree exportee respecte l unite de restitution choisie', () => {
  const dureeHeures = { ...DUREE, unit: 'hours' };
  const table = buildEncounterExport(
    [rencontre({ date_entree: '2024-01-01', date_sortie: '2024-01-03' })],
    [ENTREE, SORTIE, dureeHeures],
  );
  assertEquals(table.rows[0][columnId(dureeHeures)], 48);
});

Deno.test('L35 : resultat ABSENT -> cellule VIDE, jamais zero', () => {
  const table = buildEncounterExport(
    [
      rencontre({ date_entree: '2024-02-01' }),
      {
        ...rencontre({ date_entree: '2024-02-01', date_sortie: { __missing__: 'inconnu' } }),
        id: 'e2',
      },
    ],
    [ENTREE, SORTIE, DUREE],
  );
  assertEquals(table.rows[0][columnId(DUREE)], '');
  assertEquals(table.rows[1][columnId(DUREE)], '');
});

Deno.test('L35 : une valeur stockee sous la cle calculee NE remplace PAS le calcul', () => {
  // Rien ne devrait s'y trouver ; si quelque chose s'y trouve, c'est la formule qui fait foi.
  const table = buildEncounterExport(
    [rencontre({ date_entree: '2024-02-01', date_sortie: '2024-03-01', duree_sejour: 999 })],
    [ENTREE, SORTIE, DUREE],
  );
  assertEquals(table.rows[0][columnId(DUREE)], 29);
});

Deno.test('L35 : la formule appartient a LA VERSION — une fiche ancienne garde son resultat', () => {
  const v1 = '00000000-0000-0000-0000-0000000000a1';
  const v2 = '00000000-0000-0000-0000-0000000000a2';
  // v1 : duree = sortie - entree. v2 : la formule est corrigee en sortie - inclusion.
  const fields: ExportField[] = [
    { ...ENTREE, templateVersionIds: [v1, v2] },
    { ...SORTIE, templateVersionIds: [v1, v2] },
    { ...champ({ fieldKey: 'date_inclusion', type: 'date' }), templateVersionIds: [v2] },
    { ...DUREE, formula: 'date_sortie - date_entree', templateVersionIds: [v1] },
    { ...DUREE, formula: 'date_sortie - date_inclusion', templateVersionIds: [v2] },
  ];
  const data = {
    date_entree: '2024-02-01',
    date_sortie: '2024-03-01',
    date_inclusion: '2024-02-20',
  };
  const table = buildEncounterExport(
    [
      { ...rencontre(data), id: 'e1', templateVersionId: v1 },
      { ...rencontre(data), id: 'e2', templateVersionId: v2 },
    ],
    fields,
  );
  assertEquals(table.rows[0][columnId(DUREE)], 29);
  assertEquals(table.rows[1][columnId(DUREE)], 10);
});

Deno.test('L35 : une version peut conserver une unite de restitution differente', () => {
  const v1 = '00000000-0000-0000-0000-0000000000b1';
  const v2 = '00000000-0000-0000-0000-0000000000b2';
  const fields: ExportField[] = [
    { ...ENTREE, templateVersionIds: [v1, v2] },
    { ...SORTIE, templateVersionIds: [v1, v2] },
    { ...DUREE, unit: null, templateVersionIds: [v1] },
    { ...DUREE, unit: 'hours', templateVersionIds: [v2] },
  ];
  const table = buildEncounterExport(
    [
      { ...rencontre({ date_entree: '2024-01-01', date_sortie: '2024-01-03' }), id: 'e1', templateVersionId: v1 },
      { ...rencontre({ date_entree: '2024-01-01', date_sortie: '2024-01-03' }), id: 'e2', templateVersionId: v2 },
    ],
    fields,
  );
  assertEquals(table.rows[0][columnId(DUREE)], 2);
  assertEquals(table.rows[1][columnId(DUREE)], 48);
});

Deno.test('L35 : le dictionnaire cite la formule, sinon la colonne serait inexplicable', () => {
  const dict = buildDictionary([ENTREE, SORTIE, DUREE]);
  assertEquals(dict.columns.includes('formula'), true);
  const row = dict.rows.find((r) => r.column_id === columnId(DUREE));
  assertEquals(row?.formula, 'date_sortie - date_entree');
  // Une variable saisie n'a pas de formule : la case reste vide.
  assertEquals(dict.rows.find((r) => r.column_id === columnId(ENTREE))?.formula, '');
});

// =============================================================================
// L46 — identifiants analytiques, colonne de code stable et feuille Modalites
// =============================================================================

Deno.test('L46 : analyticId est un repli deterministe court ASCII, stable sous renommage de libelle', () => {
  const v1 = champ({ fieldKey: 'evolution', type: 'select', label: 'Evolution clinique', templateVersionIds: ['v1'] });
  const v2 = champ({
    fieldKey: 'evolution',
    type: 'select',
    label: 'Evolution (libelle corrige)',
    templateVersionIds: ['v2'],
  });
  const merged = mergeExportFields([v1, v2]);
  // Un libelle peut changer, l'identifiant ne change pas ; il reste le meme que la colonne.
  assertEquals(analyticId(merged[0]), 'encounter__evolution');
  assertEquals(analyticId(merged[0]), columnId(merged[0]));
  assertEquals(/^[a-z0-9_]+$/.test(analyticId(merged[0])), true);
});

Deno.test('L46 : une collision d identifiant analytique est refusee explicitement', () => {
  // Deux cles distinctes d'une version a l'autre se normalisent vers le meme identifiant :
  // l'analyste verrait deux variables indiscernables. On refuse plutot que de deviner.
  const v1 = champ({ fieldKey: 'systole', type: 'integer', templateVersionIds: ['v1'] });
  const v2 = champ({ fieldKey: 'Systole', type: 'integer', templateVersionIds: ['v2'] });
  assertThrows(() => assertNoAnalyticIdCollisions([v1, v2]));
  // La meme cle d'une version a l'autre (union legitime) passe sans erreur.
  assertNoAnalyticIdCollisions([
    champ({ fieldKey: 'systole', type: 'integer', templateVersionIds: ['v1'] }),
    champ({ fieldKey: 'systole', type: 'integer', templateVersionIds: ['v2'] }),
  ]);
});

Deno.test('L46 : Modalites documente variable, code, libelle, ordre et etat actif', () => {
  const table = buildModalities([EVOLUTION]);
  assertEquals(table.columns, ['variable', 'code', 'label', 'order', 'is_active']);
  assertEquals(table.rows, [
    { variable: 'encounter__evolution', code: 'gueri', label: 'Gueri', order: 1, is_active: 'true' },
    { variable: 'encounter__evolution', code: 'deces', label: 'Deces', order: 2, is_active: 'false' },
  ]);
});

Deno.test('L46 : Modalites couvre select et multiselect, jamais la terminologie', () => {
  const multi = champ({
    fieldKey: 'signes',
    type: 'multiselect',
    allowedValues: ['fievre'],
    allowedOptions: [{ value_key: 'fievre', label: 'Fievre', is_active: true }],
  });
  const table = buildModalities([DIAGNOSTIC, EVOLUTION, multi]);
  // Le diagnostic n'a pas de liste controlee : ses codes libres restent ailleurs.
  assertEquals(table.rows.some((r) => r.variable === 'encounter__diagnostic'), false);
  assertEquals(table.rows, [
    { variable: 'encounter__evolution', code: 'gueri', label: 'Gueri', order: 1, is_active: 'true' },
    { variable: 'encounter__evolution', code: 'deces', label: 'Deces', order: 2, is_active: 'false' },
    { variable: 'encounter__signes', code: 'fievre', label: 'Fievre', order: 1, is_active: 'true' },
  ]);
});

Deno.test('L46 : un libelle corrige d une version a l autre ne change ni code ni variable, et le dictionnaire reste coherent', () => {
  const v1 = champ({
    fieldKey: 'evolution',
    type: 'select',
    templateVersionIds: ['v1'],
    allowedValues: ['gueri'],
    allowedOptions: [{ value_key: 'gueri', label: 'Gueri', is_active: true }],
  });
  const v2 = champ({
    fieldKey: 'evolution',
    type: 'select',
    templateVersionIds: ['v2'],
    allowedValues: ['gueri', 'perdu'],
    allowedOptions: [
      { value_key: 'gueri', label: 'Guerison complete', is_active: true },
      { value_key: 'perdu', label: 'Perdu de vue', is_active: true },
    ],
  });
  const modalities = buildModalities([v1, v2]);
  const gueri = modalities.rows.find((r) => r.code === 'gueri');
  assertEquals(gueri?.variable, 'encounter__evolution');
  // Le libelle corrige apparait une fois (premier connu), le code stable n a pas bouge.
  assertEquals(gueri?.label, 'Gueri');
  // Le dictionnaire et Modalites citent exactement les memes codes.
  const dict = buildDictionary([v1, v2]);
  const codes = dict.rows.find((r) => r.column_id === optionCodeColumnId(v1));
  assertEquals(codes?.allowed_values, 'gueri; perdu');
  assertEquals(modalities.rows.map((r) => r.code).join('; '), codes?.allowed_values);
});

Deno.test('L46 : en Analyse, un select rend son CODE stable dans la colonne principale, sans colonne de code', () => {
  const analysis = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION], 'analysis');
  assertEquals(analysis.columns.includes(optionCodeColumnId(EVOLUTION)), false);
  assertEquals(analysis.rows[0][columnId(EVOLUTION)], 'gueri');
  // En Complet, le libelle et la colonne de code restent, pour la reimportation.
  const complete = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION], 'complete');
  assertEquals(complete.columns.includes(optionCodeColumnId(EVOLUTION)), true);
  assertEquals(complete.rows[0][columnId(EVOLUTION)], 'Gueri');
  assertEquals(complete.rows[0][optionCodeColumnId(EVOLUTION)], 'gueri');
  // Defaut de generateur : Complet. Les sorties existantes ne changent pas.
  const absent = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION]);
  assertEquals(absent.rows[0][columnId(EVOLUTION)], 'Gueri');
});

Deno.test('L46 : Analyse, un select a valeur manquante ou absent garde un rendu lisible', () => {
  const manque = buildEncounterExport([rencontre({ evolution: { __missing__: 'inconnu' } })], [EVOLUTION], 'analysis');
  assertEquals(manque.rows[0][columnId(EVOLUTION)], 'inconnu');
  const vide = buildEncounterExport([rencontre({})], [EVOLUTION], 'analysis');
  assertEquals(vide.rows[0][columnId(EVOLUTION)], '');
});

Deno.test('L46 : Analyse par patient, un select permanent rend aussi son code stable', () => {
  const evoPatient = champ({
    fieldKey: 'evolution',
    type: 'select',
    scope: 'patient',
    allowedValues: ['gueri'],
    allowedOptions: [{ value_key: 'gueri', label: 'Gueri', is_active: true }],
  });
  const table = buildPatientExport(
    [{ code: 'P1', data: { evolution: 'gueri' } }],
    [],
    [evoPatient],
    'first',
    'analysis',
  );
  assertEquals(table.rows[0][columnId(evoPatient)], 'gueri');
});

Deno.test('L46 : le CSV Analyse du select porte le code stable et aucune identite', () => {
  const table = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION], 'analysis');
  const csv = toCsv(table); // toCsv refuse toute colonne identifiante.
  assertStringIncludes(csv, 'gueri');
  assertStringIncludes(csv, 'patient_code');
});

Deno.test('L48 : une date devient un nombre de serie Excel, une invalide reste absente', () => {
  assertEquals(excelDateSerial('2020-01-01'), 43_831);
  // 2020-01-01T12:30:00Z : 12h30 / 24h = 0,5208333 j, ajoute a la partie entiere.
  assertAlmostEquals(excelDatetimeSerial('2020-01-01T12:30:00Z')!, 43_831.5208333, 0.000_001);
  // Un fuseau est translate vers l'heure UTC avant le chiffrage (12:30+02:00 -> 10:30Z).
  assertEquals(excelDatetimeSerial('2020-01-01T12:30:00+02:00'), 43_831.4375);
  // Une date invalide ou illisible vaut ABSENTE : jamais zero, jamais un chiffre invente.
  assertEquals(excelDateSerial('2020-13-01'), null);
  assertEquals(excelDateSerial('pas une date'), null);
  assertEquals(excelDatetimeSerial('2020-02-30T10:00:00Z'), null);
});

Deno.test('L48 : withExcelDateSerials chiffre les dates et datetime, sans toucher au reste', () => {
  const dateField = champ({ fieldKey: 'naissance', type: 'date' });
  const instantField = champ({ fieldKey: 'debut_visite', type: 'datetime' });
  const compteur = champ({ fieldKey: 'nb_visites', type: 'integer' });
  const table: ExportTable = {
    columns: ['patient_code', columnId(dateField), columnId(instantField), columnId(compteur)],
    rows: [{
      patient_code: 'P0001',
      [columnId(dateField)]: '2020-01-01',
      [columnId(instantField)]: '2020-01-01T12:30:00Z',
      [columnId(compteur)]: 3,
    }],
  };
  const temporalColumns = new Map<string, 'date' | 'datetime'>([
    [columnId(dateField), 'date'],
    [columnId(instantField), 'datetime'],
  ]);
  const converted = withExcelDateSerials(table, temporalColumns);
  // Cells natives : type nombre, valeurs numeriques. Le compteur reste numerique tel quel.
  assertEquals(converted.rows[0][columnId(dateField)], 43_831);
  assertAlmostEquals(converted.rows[0][columnId(instantField)] as number, 43_831.5208333, 0.000_001);
  assertEquals(typeof converted.rows[0][columnId(compteur)], 'number');
  // La table d'origine reste en ISO : elle sert a ecrire le CSV sans conversion.
  assertEquals(table.rows[0][columnId(dateField)], '2020-01-01');
  // Vide conserve, invalide conservee en TEXTE (jamais masquee par un zero, jamais convertie).
  const edge: ExportTable = {
    columns: ['patient_code', columnId(dateField)],
    rows: [
      { patient_code: 'P1', [columnId(dateField)]: '' },
      { patient_code: 'P2', [columnId(dateField)]: '2020-13-01' },
    ],
  };
  const convertedEdge = withExcelDateSerials(edge, temporalColumns);
  assertEquals(convertedEdge.rows[0][columnId(dateField)], '');
  assertEquals(convertedEdge.rows[1][columnId(dateField)], '2020-13-01');
});

Deno.test('L48 : le CSV conserve la representation ISO des dates, jamais la serie Excel', () => {
  const dateField = champ({ fieldKey: 'naissance', type: 'date' });
  const table = buildEncounterExport([rencontre({ naissance: '2020-01-01' })], [dateField]);
  const csv = toCsv(table);
  assertStringIncludes(csv, '2020-01-01');
  // Jamais le nombre de serie Excel correspondant (43831 pour le 2020-01-01).
  assertEquals(csv.includes('43831'), false);
  // La colonne porte l'ISO, pas un nombre de serie.
  assertEquals(table.rows[0][columnId(dateField)], '2020-01-01');
});

Deno.test('L48 : le dictionnaire documente l unite du calcul d une duree', () => {
  const ENTREE = champ({ fieldKey: 'date_entree', type: 'date' });
  const SORTIE = champ({ fieldKey: 'date_sortie', type: 'date' });
  const DUREE = champ({
    fieldKey: 'duree_hospitalisation',
    type: 'integer',
    formula: 'date_sortie - date_entree',
    unit: 'days',
  });
  const dict = buildDictionary([ENTREE, SORTIE, DUREE]);
  const row = dict.rows.find((r) => r.column_id === columnId(DUREE));
  assertEquals(row?.unit, 'days');
  assertEquals(row?.formula, 'date_sortie - date_entree');
  // Les deux operandes, eux, restent des dates sans unite de duree.
  assertEquals(dict.rows.find((r) => r.column_id === columnId(ENTREE))?.unit, '');
});

Deno.test('L49 : en Analyse le dictionnaire est reduit et documente indicatrices, calculs et inactifs', () => {
  const multi = champ({
    fieldKey: 'signes',
    label: 'Signes',
    type: 'multiselect',
    allowedValues: ['fievre'],
    allowedOptions: [{ value_key: 'fievre', label: 'Fievre', is_active: true }],
  });
  const DUREE = champ({
    fieldKey: 'duree_hospitalisation',
    type: 'integer',
    formula: 'date_sortie - date_entree',
    unit: 'days',
  });
  const { indicatorsByField } = extractMultivalueCodes([multi], [rencontre({ signes: ['fievre'] })]);
  const dict = buildDictionary([EVOLUTION, multi, DUREE], { indicatorsByField, profile: 'analysis' });

  // Le dictionnaire Analyse ne garde que les proprietes d'interpretation.
  assertEquals(dict.columns, [
    'column_id',
    'label',
    'description',
    'section',
    'section_label',
    'type',
    'unit',
    'formula',
    'allowed_values',
    'missing_reasons',
  ]);
  for (const removed of ['field_key', 'scope', 'is_multiple', 'template_versions']) {
    assertEquals(dict.columns.includes(removed), false, removed);
  }
  // Select : en Analyse la colonne principale porte deja le code stable, pas de `option_code__`.
  assertEquals(dict.rows.some((r) => r.column_id === optionCodeColumnId(EVOLUTION)), false);
  // Modalite inactive toujours signalee dans les valeurs autorisees.
  const evo = dict.rows.find((r) => r.column_id === columnId(EVOLUTION));
  assertEquals(evo?.allowed_values, 'Gueri; Deces (inactif)');
  // Multiselect : seule l'indicatrice est documentee, ni compteur ni code concatene.
  assertEquals(dict.rows.some((r) => r.column_id === nbColumnId(multi)), false);
  assertEquals(dict.rows.some((r) => r.column_id === optionCodeColumnId(multi)), false);
  const indicator = dict.rows.find((r) => r.column_id === `has__${columnId(multi)}__fievre`);
  assertEquals(indicator?.type, 'computed_indicator');
  assertEquals(indicator?.allowed_values, 'fievre');
  // Le calcul de duree garde sa formule ET son unite : la colonne s'explique seule.
  const duree = dict.rows.find((r) => r.column_id === columnId(DUREE));
  assertEquals(duree?.formula, 'date_sortie - date_entree');
  assertEquals(duree?.unit, 'days');
});

Deno.test('L49 : en Complet le dictionnaire conserve le detail (portee, multiplicite, versions)', () => {
  const dict = buildDictionary([EVOLUTION]);
  for (
    const kept of [
      'column_id',
      'field_key',
      'scope',
      'section',
      'section_label',
      'type',
      'formula',
      'is_multiple',
      'unit',
      'allowed_values',
      'missing_reasons',
      'template_versions',
    ]
  ) {
    assertEquals(dict.columns.includes(kept), true, kept);
  }
  const evo = dict.rows.find((r) => r.column_id === columnId(EVOLUTION));
  assertEquals(evo?.allowed_values, 'Gueri; Deces (inactif)');
  assertEquals(evo?.template_versions, '');
});

Deno.test('L49 : une variable conditionnelle vide reste documentee et une colonne reste dans Donnees', () => {
  const sexe = champ({
    fieldKey: 'sexe',
    label: 'Sexe',
    type: 'select',
    allowedValues: ['M', 'F'],
    allowedOptions: [
      { value_key: 'M', label: 'M', is_active: true },
      { value_key: 'F', label: 'F', is_active: true },
    ],
  });
  // La fiche ne porte pas la variable : la colonne existe, les cellules sont vides.
  const table = buildEncounterExport([rencontre({ evolution: 'gueri' })], [EVOLUTION, sexe], 'analysis');
  assertEquals(table.columns.includes(columnId(sexe)), true);
  assertEquals(table.rows[0][columnId(sexe)], '');
  const dict = buildDictionary([EVOLUTION, sexe], { profile: 'analysis' });
  assertEquals(dict.rows.some((r) => r.column_id === columnId(sexe)), true);
});

Deno.test('L49 : export vide, le dictionnaire reste complet', () => {
  const table = buildEncounterExport([], [EVOLUTION], 'analysis');
  assertEquals(table.rows, []);
  const dict = buildDictionary([EVOLUTION], { profile: 'analysis' });
  assertEquals(dict.rows.some((r) => r.column_id === columnId(EVOLUTION)), true);
});

Deno.test('L49 : buildMetadata documente profil, population, versions, lignes et exclusions', () => {
  const metadata = buildMetadata({
    profile: 'analysis',
    generatedAt: '2026-07-12T00:00:00.000Z',
    baseName: 'Base Test',
    cohortName: 'Cohorte Test',
    mode: 'encounter',
    selectionRule: 'first',
    templateVersions: ['v1', 'v2'],
    rowCount: 3,
    excludedPatientCount: 1,
    excludedEncounterCount: 2,
  });
  assertEquals(metadata.columns, ['attribute', 'value']);
  const by = new Map(metadata.rows.map((r) => [r.attribute, r.value]));
  assertEquals(by.get('export_profile'), 'analysis');
  assertEquals(by.get('generated_at'), '2026-07-12T00:00:00.000Z');
  assertEquals(by.get('base_name'), 'Base Test');
  assertEquals(by.get('cohort_name'), 'Cohorte Test');
  assertEquals(by.get('export_mode'), 'encounter');
  assertEquals(by.get('selection_rule'), 'first');
  assertEquals(by.get('template_versions'), 'v1; v2');
  assertEquals(by.get('row_count'), 3);
  assertEquals(by.get('excluded_patients_incomplete'), 1);
  assertEquals(by.get('excluded_encounters_incomplete'), 2);
});
