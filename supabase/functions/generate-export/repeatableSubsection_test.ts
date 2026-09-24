// L72d — groupe repetable en SOUS-SECTION : le contrat d'export distingue le bloc de
// PROJECTION (`blockKey`, toujours la racine) du GROUPE (`groupKey`, la section repetable).
//
// Les tests de bout en bout (20 a 25 du cadrage) vivent dans `handler_test.ts`. Ceux-ci
// verrouillent les deux fonctions pures ou la confusion se glisserait sans bruit : la fusion
// des revisions et le recensement des groupes.
import { assertEquals } from '@std/assert';
import {
  buildDictionary,
  buildPatientExport,
  columnId,
  type ExportEncounter,
  type ExportField,
  type ExportPatient,
  groupCountColumnId,
  mergeExportFields,
  projectFields,
  repeatableBlocksOf,
  repeatableGroupOf,
} from './exportContract.ts';

const champ = (over: Partial<ExportField> & Pick<ExportField, 'fieldKey'>): ExportField => ({
  label: over.fieldKey,
  scope: 'encounter',
  type: 'number',
  section: 'a1',
  sectionLabel: 'A1',
  blockKey: 'a',
  blockLabel: 'Bloc A',
  unit: null,
  allowedValues: null,
  description: null,
  templateVersionIds: ['v1'],
  ...over,
});

/** Variable du groupe `g1`, enfant du bloc `a` — telle que le handler la decrit. */
const dansG1 = (over: Partial<ExportField> & Pick<ExportField, 'fieldKey'>) =>
  champ({
    section: 'g1',
    sectionLabel: 'Lésions',
    blockIsRepeatable: true,
    groupKey: 'g1',
    groupLabel: 'Lésions',
    ...over,
  });

Deno.test('L72d : le groupe d une variable est sa section repetable, pas son bloc', () => {
  assertEquals(repeatableGroupOf(dansG1({ fieldKey: 'niveau' })), { key: 'g1', label: 'Lésions' });
  assertEquals(repeatableGroupOf(champ({ fieldKey: 'a1_mesure' })), null);
  // Contrat de L70, inchange : un groupe racine sans `groupKey` est son bloc.
  assertEquals(
    repeatableGroupOf(
      champ({ fieldKey: 'x', section: 'lesions', blockKey: 'lesions', blockLabel: 'L', blockIsRepeatable: true }),
    ),
    { key: 'lesions', label: 'L' },
  );
  // Le drapeau reste la seule entree : un code de groupe sans drapeau ne fait pas un groupe.
  assertEquals(repeatableGroupOf(champ({ fieldKey: 'y', groupKey: 'g1' })), null);
});

Deno.test('L72d : le recensement nomme `g1`, jamais la racine `a`', () => {
  const champs = [
    champ({ fieldKey: 'a_statut', section: 'a' }),
    champ({ fieldKey: 'a1_mesure' }),
    dansG1({ fieldKey: 'niveau' }),
  ];
  assertEquals(repeatableBlocksOf(mergeExportFields(champs)), [{ key: 'g1', label: 'Lésions' }]);
  assertEquals(groupCountColumnId('g1'), 'nb__g1');
  // Projeter `a` garde le groupe enfant, donc son comptage.
  const projete = projectFields(mergeExportFields(champs), { mode: 'selected', blockKeys: ['a'] });
  assertEquals(repeatableBlocksOf(projete), [{ key: 'g1', label: 'Lésions' }]);
});

Deno.test("L72d : une revision ou la variable vit dans `a` n'est pas contaminee par le groupe d'une autre", () => {
  // Meme colonne, deux revisions : v1 la range dans le groupe `g1`, v2 dans la sous-section
  // ordinaire `a1`. Meme bloc de projection `a` : c'est exactement ce que L70 propageait.
  const v2Ordinaire = champ({ fieldKey: 'mesure', displayOrder: 1, templateVersionIds: ['v2'] });
  const v1Groupe = dansG1({ fieldKey: 'mesure', displayOrder: 2 });
  const [fusion] = mergeExportFields([v1Groupe, v2Ordinaire]);
  assertEquals(fusion.section, 'a1');
  assertEquals(fusion.blockIsRepeatable, false);
  assertEquals(repeatableGroupOf(fusion), null);
});

Deno.test('L72d : un groupe enfant ferme par une revision garde son comptage (regle de L70)', () => {
  // v2 a ferme `g1` : la section existe encore, n'est plus repetable. Des occurrences ont ete
  // saisies sous v1 ; elles doivent rester comptees, dans les deux ordres de fusion.
  const v1Groupe = dansG1({ fieldKey: 'niveau' });
  const v2Ferme = champ({ fieldKey: 'niveau', section: 'g1', sectionLabel: 'Lésions', templateVersionIds: ['v2'] });
  for (const [premier, second] of [[v1Groupe, v2Ferme], [v2Ferme, v1Groupe]]) {
    const [fusion] = mergeExportFields([
      { ...premier, displayOrder: 1 },
      { ...second, displayOrder: 2 },
    ]);
    assertEquals(fusion.blockIsRepeatable, true);
    assertEquals(repeatableGroupOf(fusion), { key: 'g1', label: 'Lésions' });
    assertEquals(fusion.templateVersionIds, ['v1', 'v2']);
  }
});

Deno.test('L72d : ligne patient et dictionnaire sur le contrat seul', () => {
  const champs = [
    champ({ fieldKey: 'a_statut', section: 'a', sectionLabel: 'Bloc A' }),
    dansG1({ fieldKey: 'niveau' }),
  ];
  const patients: ExportPatient[] = [{ code: 'P1', data: {} }, { code: 'P2', data: {} }];
  const rencontre = (id: string, patientCode: string, groupSectionKey: string | null, data: Record<string, unknown>) =>
    ({
      id,
      patientCode,
      encounterDate: groupSectionKey ? null : '2026-01-01',
      encounterType: 'autre',
      groupSectionKey,
      data,
    }) as ExportEncounter;
  const rencontres = [
    rencontre('e1', 'P1', null, { a_statut: 1 }),
    rencontre('e2', 'P1', 'g1', { niveau: 11 }),
    rencontre('e3', 'P1', 'g1', { niveau: 12 }),
  ];
  for (const rule of ['first', 'last'] as const) {
    const table = buildPatientExport(patients, rencontres, champs, rule);
    assertEquals(table.columns.includes(columnId(champs[1])), false);
    assertEquals(table.columns.includes('nb__a'), false);
    assertEquals(table.rows.map((r) => r['nb__g1']), [2, 0]);
    assertEquals(table.rows[0][columnId(champs[0])], 1);
  }
  const dict = buildDictionary(champs, {
    blockColumns: true,
    repeatableCountBlocks: repeatableBlocksOf(mergeExportFields(champs)),
  });
  const comptage = dict.rows.find((r) => r.column_id === 'nb__g1');
  assertEquals(
    [comptage?.section, comptage?.section_label, comptage?.block, comptage?.block_label],
    ['g1', 'Lésions', 'a', 'Bloc A'],
  );
  // Sans colonnes de bloc, le dictionnaire garde exactement ses colonnes : D12 n'en ajoute aucune.
  const sansBloc = buildDictionary(champs, { repeatableCountBlocks: repeatableBlocksOf(mergeExportFields(champs)) });
  assertEquals('block' in (sansBloc.rows.find((r) => r.column_id === 'nb__g1') ?? {}), false);
});
