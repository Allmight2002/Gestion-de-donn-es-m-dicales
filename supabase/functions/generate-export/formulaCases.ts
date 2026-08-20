// Jeu de cas des variables calculees (L35) — LA GARANTIE CENTRALE DU LOT.
//
// Ce fichier ne contient que des DONNEES : aucune importation, aucune logique. C'est ce qui
// lui permet d'etre lu tel quel par les deux executeurs de tests du depot :
//   * `test/formula.test.ts`               — Node/Vitest, cote navigateur (via src/domain/export) ;
//   * `exportContract_test.ts`             — Deno, cote Edge Function de production.
//
// Les deux passent le MEME tableau dans le MEME evaluateur et attendent les MEMES resultats.
// L'egalite des deux cotes cesse ainsi d'etre une supposition tiree de « c'est le meme
// fichier » : elle est verifiee a chaque execution, y compris le jour ou quelqu'un croira
// bien faire en recopiant l'evaluateur dans l'un des deux mondes.
//
// Rappel de la regle que ces cas fixent : un resultat est ABSENT — jamais zero — des qu'un
// operande manque, porte l'un des cinq codes de valeur manquante, ou que la division tombe
// sur zero. Un zero fabrique se lirait comme une mesure et fausserait toute moyenne calculee
// ensuite.

/** Vue minimale d'une variable, telle que l'evaluateur la demande. */
export interface FormulaCaseField {
  fieldKey: string;
  type: string;
  formula?: string | null;
}

export interface FormulaCase {
  /** Ce que le cas prouve, en une ligne. */
  name: string;
  formula: string;
  data: Record<string, unknown>;
  /** `null` = resultat ABSENT. */
  expected: number | null;
}

/** Variables sur lesquelles portent les cas. Aucune n'est calculee : ce sont les operandes. */
export const FORMULA_CASE_FIELDS: FormulaCaseField[] = [
  { fieldKey: 'score_j0', type: 'integer' },
  { fieldKey: 'score_j7', type: 'integer' },
  { fieldKey: 'poids', type: 'number' },
  { fieldKey: 'taille', type: 'number' },
  { fieldKey: 'diviseur', type: 'number' },
  { fieldKey: 'date_entree', type: 'date' },
  { fieldKey: 'date_sortie', type: 'date' },
  { fieldKey: 'commentaire', type: 'text' },
];

const missing = (code: string) => ({ __missing__: code });

export const FORMULA_CASES: FormulaCase[] = [
  // --- Les quatre operations ------------------------------------------------------------
  {
    name: 'addition de deux variables',
    formula: 'score_j0 + score_j7',
    data: { score_j0: 5, score_j7: 12 },
    expected: 17,
  },
  {
    name: 'soustraction de deux variables',
    formula: 'score_j7 - score_j0',
    data: { score_j0: 5, score_j7: 12 },
    expected: 7,
  },
  {
    name: 'multiplication par une constante',
    formula: 'poids * 2',
    data: { poids: 3.5 },
    expected: 7,
  },
  {
    name: 'division de deux variables',
    formula: 'poids / taille',
    data: { poids: 70, taille: 2 },
    expected: 35,
  },
  {
    name: 'constante a gauche',
    formula: '100 - poids',
    data: { poids: 70 },
    expected: 30,
  },
  {
    name: 'division non entiere, arrondie a six decimales',
    formula: 'poids / diviseur',
    data: { poids: 1, diviseur: 3 },
    expected: 0.333333,
  },
  {
    name: 'l artefact du calcul binaire est efface (0,1 + 0,2 ne vaut pas 0,30000000000000004)',
    formula: 'poids + taille',
    data: { poids: 0.1, taille: 0.2 },
    expected: 0.3,
  },
  {
    name: 'un nombre ecrit en texte reste un nombre',
    formula: 'poids + taille',
    data: { poids: '70', taille: 0.5 },
    expected: 70.5,
  },

  // --- date - date, en jours entiers ------------------------------------------------------
  {
    name: 'duree de sejour en jours',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-02-01', date_sortie: '2024-03-01' },
    expected: 29, // 2024 est bissextile : fevrier compte 29 jours
  },
  {
    name: 'duree nulle : entree et sortie le meme jour',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-05-10', date_sortie: '2024-05-10' },
    expected: 0,
  },
  {
    name: 'duree negative : la sortie precede l entree (anomalie visible, pas masquee)',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-05-10', date_sortie: '2024-05-08' },
    expected: -2,
  },
  {
    name: 'passage d une annee a l autre',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2023-12-30', date_sortie: '2024-01-02' },
    expected: 3,
  },
  {
    name: 'une date avec heure reste lue sur son jour',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-05-01T23:30', date_sortie: '2024-05-03T01:00' },
    expected: 2,
  },
  {
    name: 'une date impossible vaut ABSENTE',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-02-31', date_sortie: '2024-03-05' },
    expected: null,
  },

  // --- Division par zero ------------------------------------------------------------------
  {
    name: 'division par zero : resultat ABSENT, ni erreur ni infini',
    formula: 'poids / diviseur',
    data: { poids: 70, diviseur: 0 },
    expected: null,
  },
  {
    name: 'division par une constante nulle : meme reponse',
    formula: 'poids / 0',
    data: { poids: 70 },
    expected: null,
  },

  // --- Operande absent --------------------------------------------------------------------
  {
    name: 'operande de gauche absent',
    formula: 'score_j7 - score_j0',
    data: { score_j7: 12 },
    expected: null,
  },
  {
    name: 'operande de droite absent',
    formula: 'score_j7 - score_j0',
    data: { score_j0: 5 },
    expected: null,
  },
  {
    name: 'operande a null',
    formula: 'score_j7 - score_j0',
    data: { score_j0: null, score_j7: 12 },
    expected: null,
  },
  {
    name: 'operande a chaine vide',
    formula: 'score_j7 - score_j0',
    data: { score_j0: '', score_j7: 12 },
    expected: null,
  },
  {
    name: 'operande non numerique',
    formula: 'poids + commentaire',
    data: { poids: 70, commentaire: 'stable' },
    expected: null,
  },
  {
    name: 'operande inconnu du gabarit',
    formula: 'poids + inconnu_du_gabarit',
    data: { poids: 70, inconnu_du_gabarit: 3 },
    expected: null,
  },

  // --- Les CINQ codes de valeur manquante (L33) : chacun rend le resultat ABSENT ----------
  {
    name: 'code de valeur manquante : non_fait',
    formula: 'score_j7 - score_j0',
    data: { score_j0: missing('non_fait'), score_j7: 12 },
    expected: null,
  },
  {
    name: 'code de valeur manquante : inconnu',
    formula: 'score_j7 - score_j0',
    data: { score_j0: missing('inconnu'), score_j7: 12 },
    expected: null,
  },
  {
    name: 'code de valeur manquante : non_applicable',
    formula: 'score_j7 - score_j0',
    data: { score_j0: missing('non_applicable'), score_j7: 12 },
    expected: null,
  },
  {
    name: 'code de valeur manquante : refus',
    formula: 'score_j7 - score_j0',
    data: { score_j0: missing('refus'), score_j7: 12 },
    expected: null,
  },
  {
    name: 'code de valeur manquante : non_documente',
    formula: 'score_j7 - score_j0',
    data: { score_j0: missing('non_documente'), score_j7: 12 },
    expected: null,
  },
  {
    name: 'code de valeur manquante sur l operande de DROITE',
    formula: 'score_j7 - score_j0',
    data: { score_j0: 5, score_j7: missing('non_fait') },
    expected: null,
  },
  {
    name: 'code de valeur manquante sur une date',
    formula: 'date_sortie - date_entree',
    data: { date_entree: '2024-02-01', date_sortie: missing('inconnu') },
    expected: null,
  },
  {
    name: 'fiche entierement vide',
    formula: 'score_j7 - score_j0',
    data: {},
    expected: null,
  },
];
