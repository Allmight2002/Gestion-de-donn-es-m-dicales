// Contrat d'export : rendu des valeurs en cellules.
//
// Le cas critique est le champ de terminologie. Sa valeur est un objet {code, label} ;
// avant correction, elle tombait dans le `String(v)` final et toute la colonne rendait
// « [object Object] » — la donnee etait en base, mais l'export inexploitable. Ce projet
// avait deja connu ce defaut en juillet avec les codes de valeur manquante.
import { assertEquals } from '@std/assert';
import {
  buildDictionary,
  buildEncounterExport,
  buildPatientExport,
  codeColumnId,
  columnId,
  optionCodeColumnId,
  type ExportEncounter,
  type ExportField,
  type ExportPatient,
} from './exportContract.ts';

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
      field_key: 'diagnostic',
      scope: 'encounter',
      section: 'clinique',
      unit: '',
      allowed_values: '',
      missing_reasons: '',
      template_versions: '',
    },
    {
      column_id: codeColumnId(DIAGNOSTIC),
      description: '',
      label: 'diagnostic — code',
      type: 'terminology_code',
      field_key: 'diagnostic',
      scope: 'encounter',
      section: 'clinique',
      unit: '',
      allowed_values: '',
      missing_reasons: '',
      template_versions: '',
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
  assertEquals(table.rows[0][columnId(multi)], 'Toux; Fievre');
  assertEquals(table.rows[0][optionCodeColumnId(multi)], 'toux; fievre');
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
    fieldKey: 'evolution', type: 'select', templateVersionIds: ['v1'],
    allowedValues: ['gueri'],
    allowedOptions: [{ value_key: 'gueri', label: 'Gueri', is_active: true }],
  });
  const v2 = champ({
    fieldKey: 'evolution', type: 'select', templateVersionIds: ['v2'],
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
