// L70 — le contrat d'export des groupes repetables est le MEME des deux cotes.
//
// `src/domain/export` reexporte le fichier que l'Edge Function `generate-export` importe :
// il n'y a pas deux implementations a tenir d'accord. Ce fichier le VERIFIE au lieu de
// l'affirmer — il rejoue, par le chemin d'import du navigateur, les memes assertions que
// `supabase/functions/generate-export/repeatableGroups_test.ts` execute sous Deno. Une
// divergence — un contrat recopie, un cas traite d'un seul cote — ferait echouer l'une des
// deux suites.
import { describe, expect, test } from 'vitest';
import {
  buildDictionary,
  buildEncounterExport,
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
} from '../src/domain/export';

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

const AGE = champ({ fieldKey: 'age', type: 'number', section: null, blockKey: null, blockLabel: null });
const POIDS = champ({ fieldKey: 'poids', type: 'number', blockKey: 'clinique', blockLabel: 'Clinique' });
const LESION_NIVEAU = champ({
  fieldKey: 'niveau',
  type: 'text',
  section: 'lesions',
  blockKey: 'lesions',
  blockLabel: 'Lésions',
  blockIsRepeatable: true,
});
const LESION_GRADE = champ({
  fieldKey: 'grade',
  type: 'number',
  section: 'lesions',
  blockKey: 'lesions',
  blockLabel: 'Lésions',
  blockIsRepeatable: true,
});
const INTERVENTION_VOIE = champ({
  fieldKey: 'voie',
  type: 'text',
  section: 'interventions',
  blockKey: 'interventions',
  blockLabel: 'Interventions',
  blockIsRepeatable: true,
});
const CHAMPS = [AGE, POIDS, LESION_NIVEAU, LESION_GRADE, INTERVENTION_VOIE];

const PATIENTS: ExportPatient[] = [
  { code: 'P0001', templateVersionId: TV, data: {} },
  { code: 'P0002', templateVersionId: TV, data: {} },
];

/** Occurrence : non datee, de type `autre` comme le serveur l'impose, discriminee par son bloc. */
const occurrence = (id: string, code: string, bloc: string, data: Record<string, unknown>): ExportEncounter => ({
  id,
  patientCode: code,
  encounterDate: null,
  encounterType: 'autre',
  groupSectionKey: bloc,
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
  occurrence('e-lesion-1', 'P0001', 'lesions', { niveau: 'L1', grade: 2, age: 99 }),
  occurrence('e-lesion-2', 'P0001', 'lesions', { niveau: 'T12', grade: 3, age: 99 }),
  occurrence('e-intervention-1', 'P0001', 'interventions', { voie: 'postérieure' }),
];

describe('L70 : contrat des groupes repetables, vu depuis le navigateur', () => {
  test('point 21 : une ligne par occurrence porte `group_section_key`, juste', () => {
    const table = buildEncounterExport(RENCONTRES, CHAMPS);
    expect(table.columns).toContain('group_section_key');
    expect(table.rows.map((r) => [r.encounter_id, r.group_section_key])).toEqual([
      ['e-intervention-1', 'interventions'],
      ['e-lesion-1', 'lesions'],
      ['e-lesion-2', 'lesions'],
      ['e-consult-1', ''],
    ]);
    // Le type ne discrimine rien : c'est le bloc qui separe les lignes.
    expect(new Set(table.rows.filter((r) => r.group_section_key !== '').map((r) => r.encounter_type)))
      .toEqual(new Set(['autre']));
  });

  test('point 24 : une occurrence non datee sort sans date ni age, jamais 1970-01-01', () => {
    const table = buildEncounterExport(RENCONTRES, CHAMPS);
    const lesion = table.rows.find((r) => r.encounter_id === 'e-lesion-1');
    expect(lesion).toMatchObject({ encounter_date: '', age_value: '', age_unit: '' });
    expect(table.rows.find((r) => r.encounter_id === 'e-consult-1'))
      .toMatchObject({ encounter_date: '2026-01-10', age_value: 40, age_unit: 'years' });
    expect(toCsv(table)).not.toContain('1970-01-01');
  });

  test('point 22 : une ligne par patient compte les occurrences et n\'en choisit aucune', () => {
    for (const rule of ['first', 'last'] as const) {
      const table = buildPatientExport(PATIENTS, RENCONTRES, CHAMPS, rule);
      expect(table.columns).toContain(groupCountColumnId('lesions'));
      expect(table.columns).not.toContain(columnId(LESION_NIVEAU));
      expect(table.rows.find((r) => r.patient_code === 'P0001')).toMatchObject({
        [groupCountColumnId('lesions')]: 2,
        [groupCountColumnId('interventions')]: 1,
        // L'age de la lesion (99) ne remonte jamais, quelle que soit la regle.
        [columnId(AGE)]: 40,
      });
      // Y compris a zero : `0` est une observation, pas une case vide.
      expect(table.rows.find((r) => r.patient_code === 'P0002')).toMatchObject({
        [groupCountColumnId('lesions')]: 0,
        [groupCountColumnId('interventions')]: 0,
      });
      expect(toCsv(table)).not.toContain('L1');
    }
  });

  test('point 23 : la projection par bloc se combine sans modification', () => {
    const projete = projectFields(mergeExportFields(CHAMPS), { mode: 'selected', blockKeys: ['lesions'] });
    const parOccurrence = buildEncounterExport(RENCONTRES, projete, 'analysis', mergeExportFields(CHAMPS));
    expect(parOccurrence.columns).toEqual([
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
    // La projection ne retire jamais de ligne : les quatre sont la.
    expect(parOccurrence.rows).toHaveLength(4);

    const parPatient = buildPatientExport(PATIENTS, RENCONTRES, projete, 'last', 'complete', mergeExportFields(CHAMPS));
    expect(parPatient.columns).toContain(groupCountColumnId('lesions'));
    expect(parPatient.columns).not.toContain(groupCountColumnId('interventions'));
  });

  test('le dictionnaire enonce la colonne de comptage', () => {
    const blocs = repeatableBlocksOf(mergeExportFields(CHAMPS));
    expect(blocs).toEqual([
      { key: 'interventions', label: 'Interventions' },
      { key: 'lesions', label: 'Lésions' },
    ]);
    const dict = buildDictionary(CHAMPS, { repeatableCountBlocks: blocs });
    const ligne = dict.rows.find((r) => r.column_id === groupCountColumnId('lesions'));
    expect(ligne?.type).toBe('computed_group_count');
    expect(String(ligne?.description)).toContain('0 signifie aucune occurrence');
    // Sans l'option, aucune colonne de comptage n'est annoncee : le dictionnaire ne decrit
    // jamais une colonne absente du fichier.
    expect(buildDictionary(CHAMPS).rows.some((r) => String(r.column_id).startsWith('nb__lesions'))).toBe(false);
  });
});
