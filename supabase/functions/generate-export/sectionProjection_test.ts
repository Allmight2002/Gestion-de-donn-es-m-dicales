// L53 — projection d'export par BLOCS.
//
// Un bloc est la section RACINE ; une sous-section ne se choisit jamais separement, elle suit
// son bloc. La projection choisit des COLONNES : elle ne retire jamais une ligne, et les
// variables sans bloc — tronc commun, variable partagee, rattachement ancien non resolu —
// traversent toutes les projections.
import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  buildDictionary,
  buildEncounterExport,
  buildMetadata,
  buildModalities,
  buildPatientExport,
  columnId,
  type ExportEncounter,
  type ExportField,
  findAmbiguousBlockFields,
  findProjectionProblem,
  hasSubsectionFields,
  mergeExportFields,
  projectFields,
  toCsv,
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

const rencontre = (data: Record<string, unknown>): ExportEncounter => ({
  id: 'e1',
  patientCode: 'P0001',
  encounterDate: '2026-01-01',
  encounterType: 'consultation',
  data,
});

/** Tronc commun : aucune section, donc aucun bloc. Jamais decochable. */
const AGE = champ({ fieldKey: 'age', type: 'number', section: null, blockKey: null, blockLabel: null });
/** D8 : variable PARTAGEE, sortie de tout bloc et posee dans le tronc commun. */
const PARTAGEE = champ({ fieldKey: 'partagee', type: 'text', section: null, blockKey: null, blockLabel: null });
/** Bloc plat : la feuille EST le bloc. */
const TB = champ({
  fieldKey: 'tb_statut',
  type: 'text',
  section: 'tuberculose',
  sectionLabel: 'Tuberculose',
  blockKey: 'tuberculose',
  blockLabel: 'Tuberculose',
});
/** Sous-section du meme bloc : la feuille dit `tb_biologie`, le bloc dit `tuberculose`. */
const TB_BIO = champ({
  fieldKey: 'tb_crp',
  type: 'number',
  section: 'tb_biologie',
  sectionLabel: 'Biologie',
  blockKey: 'tuberculose',
  blockLabel: 'Tuberculose',
});
const MALNUT = champ({
  fieldKey: 'poids',
  type: 'number',
  section: 'malnutrition',
  sectionLabel: 'Malnutrition',
  blockKey: 'malnutrition',
  blockLabel: 'Malnutrition',
});
/** Rattachement ancien non resolu : un code de section, mais aucun bloc. Reste exportee. */
const ANCIEN = champ({ fieldKey: 'legacy', type: 'text', section: 'disparue', blockKey: null, blockLabel: null });

const CAS_BLOCS = [AGE, PARTAGEE, TB, TB_BIO, MALNUT, ANCIEN];
const clesDe = (fields: ExportField[]) => fields.map((f) => f.fieldKey);

Deno.test('L53 : projeter un bloc ramene ses SOUS-SECTIONS, le tronc commun et le non resolu', () => {
  const projete = projectFields(CAS_BLOCS, { mode: 'selected', blockKeys: ['tuberculose'] });
  // `tb_crp` est la preuve : sa feuille est `tb_biologie`, jamais listee, mais son bloc l'est.
  assertEquals(clesDe(projete), ['age', 'partagee', 'tb_statut', 'tb_crp', 'legacy']);
});

Deno.test('L53 : projeter plusieurs blocs les cumule', () => {
  const projete = projectFields(CAS_BLOCS, { mode: 'selected', blockKeys: ['tuberculose', 'malnutrition'] });
  assertEquals(clesDe(projete), ['age', 'partagee', 'tb_statut', 'tb_crp', 'poids', 'legacy']);
});

Deno.test('L53 : `all`, absence de projection et projection nulle rendent le meme jeu', () => {
  assertEquals(clesDe(projectFields(CAS_BLOCS, { mode: 'all' })), clesDe(CAS_BLOCS));
  assertEquals(clesDe(projectFields(CAS_BLOCS, undefined)), clesDe(CAS_BLOCS));
  assertEquals(clesDe(projectFields(CAS_BLOCS, null)), clesDe(CAS_BLOCS));
  // C'est le MODE qui decide, jamais la seule presence de cles.
  assertEquals(clesDe(projectFields(CAS_BLOCS, { mode: 'all', blockKeys: ['tuberculose'] })), clesDe(CAS_BLOCS));
});

Deno.test('L53 : base PLATE — blockKey egal a section, la projection reste possible', () => {
  const plate = [
    champ({ fieldKey: 'a', type: 'text', section: 'clinique', blockKey: 'clinique', blockLabel: 'Clinique' }),
    champ({ fieldKey: 'b', type: 'text', section: 'biologie', blockKey: 'biologie', blockLabel: 'Biologie' }),
  ];
  assertEquals(hasSubsectionFields(plate), false);
  assertEquals(clesDe(projectFields(plate, { mode: 'selected', blockKeys: ['clinique'] })), ['a']);
});

Deno.test('L53 : la projection ne filtre JAMAIS la population', () => {
  const rencontres = [
    { ...rencontre({ age: 7, tb_statut: 'confirme' }), id: 'e1', patientCode: 'P0001' },
    // Ce patient ne releve d'aucun bloc projete : il garde sa ligne, avec ses seules
    // colonnes communes renseignees.
    { ...rencontre({ age: 9, poids: 12 }), id: 'e2', patientCode: 'P0002' },
  ];
  const projete = projectFields(CAS_BLOCS, { mode: 'selected', blockKeys: ['tuberculose'] });
  const table = buildEncounterExport(rencontres, projete, 'analysis', CAS_BLOCS);
  assertEquals(table.rows.length, 2);
  assertEquals(table.columns.includes(columnId(MALNUT)), false);
  assertEquals(table.rows[1][columnId(AGE)], 9);
  assertEquals(table.rows[1][columnId(TB)], '');
});

Deno.test('L53 : base plate SANS projection — le dictionnaire garde exactement ses colonnes', () => {
  const plate = [champ({ fieldKey: 'a', type: 'text', section: 'clinique', blockKey: 'clinique' })];
  assertEquals(buildDictionary(plate, { profile: 'analysis' }).columns, [
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
  assertEquals(buildDictionary(plate, { profile: 'complete' }).columns.includes('block'), false);
});

Deno.test('L53 : le dictionnaire porte les DEUX niveaux quand on les lui demande', () => {
  const dict = buildDictionary(CAS_BLOCS, { profile: 'analysis', blockColumns: true });
  // Le bloc se lit juste apres la feuille : les colonnes anterieures gardent leur rang.
  assertEquals(dict.columns.slice(0, 7), [
    'column_id',
    'label',
    'description',
    'section',
    'section_label',
    'block',
    'block_label',
  ]);
  const parCle = new Map(dict.rows.map((r) => [r.column_id, r]));
  const sousSection = parCle.get(columnId(TB_BIO));
  assertEquals(sousSection?.section, 'tb_biologie');
  assertEquals(sousSection?.block, 'tuberculose');
  assertEquals(sousSection?.block_label, 'Tuberculose');
  // Tronc commun : ni feuille ni bloc, et surtout jamais le mot « null » en cellule.
  assertEquals(parCle.get(columnId(AGE))?.section, '');
  assertEquals(parCle.get(columnId(AGE))?.block, '');
  // Rattachement ancien non resolu : la feuille subsiste, le bloc reste vide.
  assertEquals(parCle.get(columnId(ANCIEN))?.section, 'disparue');
  assertEquals(parCle.get(columnId(ANCIEN))?.block, '');
});

Deno.test('L53 : une formule PROJETEE reste calculee par des operandes hors projection', () => {
  const debut = champ({ fieldKey: 'debut', type: 'date', section: 'malnutrition', blockKey: 'malnutrition' });
  const fin = champ({ fieldKey: 'fin', type: 'date', section: 'malnutrition', blockKey: 'malnutrition' });
  const duree = champ({
    fieldKey: 'duree',
    type: 'number',
    section: 'tuberculose',
    blockKey: 'tuberculose',
    formula: 'fin - debut',
    templateVersionIds: ['v1'],
  });
  const tous = [debut, fin, duree];
  const projete = projectFields(tous, { mode: 'selected', blockKeys: ['tuberculose'] });
  const table = buildEncounterExport(
    [{ ...rencontre({ debut: '2026-01-01', fin: '2026-01-11' }), templateVersionId: 'v1' }],
    projete,
    'complete',
    tous,
  );
  // La colonne calculee sort juste ; celles de ses operandes ne sont pas restituees.
  assertEquals(table.rows[0][columnId(duree)], 10);
  assertEquals(table.columns.includes(columnId(debut)), false);
  assertEquals(table.columns.includes(columnId(fin)), false);
});

Deno.test('L53 : meme chose en mode patient — index d operandes par portee', () => {
  const taille = champ({
    fieldKey: 'taille',
    type: 'number',
    scope: 'patient',
    section: 'malnutrition',
    blockKey: 'malnutrition',
  });
  const ratio = champ({
    fieldKey: 'ratio',
    type: 'number',
    scope: 'patient',
    section: 'tuberculose',
    blockKey: 'tuberculose',
    formula: 'taille / 2',
    templateVersionIds: ['v1'],
  });
  const tous = [taille, ratio];
  const projete = projectFields(tous, { mode: 'selected', blockKeys: ['tuberculose'] });
  const table = buildPatientExport(
    [{ code: 'P0001', templateVersionId: 'v1', data: { taille: 150 } }],
    [],
    projete,
    'last',
    'complete',
    tous,
  );
  assertEquals(table.rows[0][columnId(ratio)], 75);
  assertEquals(table.columns.includes(columnId(taille)), false);
});

Deno.test('L53 : Modalites suit le jeu PROJETE', () => {
  const issue = champ({
    fieldKey: 'issue_tb',
    type: 'select',
    section: 'tuberculose',
    blockKey: 'tuberculose',
    allowedValues: ['gueri'],
    allowedOptions: [{ value_key: 'gueri', label: 'Gueri', is_active: true }],
  });
  const autre = champ({
    fieldKey: 'issue_mal',
    type: 'select',
    section: 'malnutrition',
    blockKey: 'malnutrition',
    allowedValues: ['sortie'],
    allowedOptions: [{ value_key: 'sortie', label: 'Sortie', is_active: true }],
  });
  const projete = projectFields([issue, autre], { mode: 'selected', blockKeys: ['tuberculose'] });
  const modalites = buildModalities(projete);
  assertEquals(modalites.rows.some((r) => r.code === 'gueri'), true);
  assertEquals(modalites.rows.some((r) => r.code === 'sortie'), false);
});

Deno.test('L53 : hasSubsectionFields ne voit que la vraie hierarchie', () => {
  assertEquals(hasSubsectionFields([TB]), false);
  assertEquals(hasSubsectionFields([AGE, ANCIEN]), false);
  assertEquals(hasSubsectionFields([TB, TB_BIO]), true);
});

Deno.test('L53 : refus — cle inconnue de toutes les versions', () => {
  const index = { roots: new Set(['tuberculose']), leaves: new Set(['tb_biologie']) };
  assertEquals(findProjectionProblem(['paludisme'], index), { kind: 'unknown_block', keys: ['paludisme'] });
  assertEquals(findProjectionProblem(['tuberculose'], index), null);
});

Deno.test('L53 : une cle absente de certaines versions reste valide si elle est racine partout ou elle existe', () => {
  // `roots` et `leaves` sont l'UNION des versions presentes : un bloc retire du gabarit courant,
  // mais racine dans la version qui le portait, reste projetable — ses fiches existent encore.
  const index = { roots: new Set(['tuberculose', 'paludisme']), leaves: new Set(['tb_biologie']) };
  assertEquals(findProjectionProblem(['paludisme'], index), null);
  assertEquals(findProjectionProblem(['tuberculose', 'paludisme'], index), null);
});

Deno.test('L53 : refus — la cle designe une SOUS-SECTION, ou change de role selon la version', () => {
  const index = { roots: new Set(['tuberculose']), leaves: new Set(['tb_biologie']) };
  assertEquals(findProjectionProblem(['tb_biologie'], index), { kind: 'not_a_block', keys: ['tb_biologie'] });
  // Racine dans une version, feuille dans une autre : le role diverge, donc refus.
  const divergent = { roots: new Set(['nutrition']), leaves: new Set(['nutrition']) };
  assertEquals(findProjectionProblem(['nutrition'], divergent), { kind: 'not_a_block', keys: ['nutrition'] });
});

Deno.test('L53 : refus — une variable rattachee a des BLOCS differents selon les versions', () => {
  const v1 = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tuberculose',
    blockKey: 'tuberculose',
    templateVersionIds: ['v1'],
  });
  const v2 = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'malnutrition',
    blockKey: 'malnutrition',
    templateVersionIds: ['v2'],
  });
  assertEquals(findAmbiguousBlockFields([v1, v2]), ['encounter__crp']);
});

Deno.test('L53 : refus — passage TRONC COMMUN <-> bloc', () => {
  const commune = champ({ fieldKey: 'crp', type: 'number', section: null, blockKey: null, templateVersionIds: ['v1'] });
  const enBloc = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tuberculose',
    blockKey: 'tuberculose',
    templateVersionIds: ['v2'],
  });
  assertEquals(findAmbiguousBlockFields([commune, enBloc]), ['encounter__crp']);
});

Deno.test('L53 : PAS de refus — deplacement entre sous-sections du MEME bloc', () => {
  const v1 = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tb_biologie',
    blockKey: 'tuberculose',
    templateVersionIds: ['v1'],
  });
  const v2 = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tb_imagerie',
    blockKey: 'tuberculose',
    templateVersionIds: ['v2'],
  });
  assertEquals(findAmbiguousBlockFields([v1, v2]), []);
  // Tronc commun et rattachement non resolu disent la meme chose : aucun bloc.
  const nonResolu = champ({
    fieldKey: 'autre',
    type: 'text',
    section: 'disparue',
    blockKey: null,
    templateVersionIds: ['v1'],
  });
  const tronc = champ({ fieldKey: 'autre', type: 'text', section: null, blockKey: null, templateVersionIds: ['v2'] });
  assertEquals(findAmbiguousBlockFields([nonResolu, tronc]), []);
});

Deno.test('L53 : la fusion n emprunte le libelle de bloc qu au MEME bloc', () => {
  const sansLibelle = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tb_biologie',
    blockKey: 'tuberculose',
    blockLabel: null,
    templateVersionIds: ['v1'],
  });
  const avecLibelle = champ({
    fieldKey: 'crp',
    type: 'number',
    section: 'tb_biologie',
    blockKey: 'tuberculose',
    blockLabel: 'Tuberculose',
    templateVersionIds: ['v2'],
  });
  assertEquals(mergeExportFields([sansLibelle, avecLibelle])[0].blockLabel, 'Tuberculose');
});

Deno.test('L53 : Metadonnees porte la projection resolue, et rien de plus en mode all', () => {
  const commun = {
    profile: 'analysis' as const,
    generatedAt: '2026-09-05T00:00:00.000Z',
    baseName: 'Base',
    cohortName: 'Cohorte',
    mode: 'encounter' as const,
    selectionRule: 'last',
    templateVersions: ['v1'],
    rowCount: 4,
    excludedPatientCount: 0,
    excludedEncounterCount: 0,
  };
  const projete = buildMetadata({
    ...commun,
    sectionProjection: { mode: 'selected', blockKeys: ['tuberculose'] },
  });
  const parAttribut = new Map(projete.rows.map((r) => [r.attribute, r.value]));
  assertEquals(parAttribut.get('section_projection_blocks'), 'tuberculose');
  // La population n'a pas bouge : le compte de lignes reste celui de la cohorte entiere.
  assertEquals(parAttribut.get('row_count'), 4);
  const complet = buildMetadata({ ...commun, sectionProjection: { mode: 'all' } });
  assertEquals(complet.rows.some((r) => r.attribute === 'section_projection_blocks'), false);
  assertEquals(buildMetadata(commun).rows.length, complet.rows.length);
});

Deno.test('L53 : le CSV projete porte le tronc commun et le bloc choisi, pas les autres', () => {
  const projete = projectFields(CAS_BLOCS, { mode: 'selected', blockKeys: ['tuberculose'] });
  const csv = toCsv(
    buildEncounterExport([rencontre({ age: 7, tb_statut: 'confirme', poids: 12 })], projete, 'analysis', CAS_BLOCS),
  );
  const entete = csv.split('\n')[0];
  assertStringIncludes(entete, columnId(AGE));
  assertStringIncludes(entete, columnId(TB));
  assertEquals(entete.includes(columnId(MALNUT)), false);
});
