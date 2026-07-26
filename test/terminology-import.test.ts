// Analyse du fichier de terminologie (feature T1) : hierarchie reconstruite depuis les
// tirets, entrees inutilisables ecartees, et distinction entre ce qui structure et ce qui
// se choisit. Test PUR : aucune base n'est requise.
import { describe, expect, test } from 'vitest';
import { parseTerminologyRows } from '../scripts/import-terminology.mjs';

const HEADER = 'Code\tTitle\tClassKind\tDepthInKind';
const tsv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const HEADER_BLOCK = 'Code\tBlockId\tTitle\tClassKind\tDepthInKind';
const tsvWithBlockId = (...rows: string[]) => [HEADER_BLOCK, ...rows].join('\n');

describe('parseTerminologyRows (T1)', () => {
  test('reconstruit la hierarchie a partir des tirets du libelle', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '\tCertaines maladies infectieuses\tchapter\t1',
      '\t- Gastroenterite infectieuse\tblock\t1',
      '\t- - Infections intestinales bacteriennes\tblock\t2',
      '1A00\t- - - Cholera\tcategory\t1',
    ));

    expect(concepts.map((c) => c.label)).toEqual([
      'Certaines maladies infectieuses',
      'Gastroenterite infectieuse',
      'Infections intestinales bacteriennes',
      'Cholera',
    ]);
    expect(concepts[0].parentId).toBeNull();
    expect(concepts[1].parentId).toBe(concepts[0].id);
    expect(concepts[2].parentId).toBe(concepts[1].id);
    expect(concepts[3].parentId).toBe(concepts[2].id);
    expect(concepts.map((c) => c.depth)).toEqual([0, 1, 2, 3]);
  });

  // Un frere qui suit une branche plus profonde ne doit pas heriter du dernier concept vu.
  test('referme les branches profondes en remontant', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '\tChapitre\tchapter\t1',
      '\t- Bloc A\tblock\t1',
      '1A00\t- - Feuille A\tcategory\t1',
      '\t- Bloc B\tblock\t1',
    ));
    const [chapitre, blocA, feuille, blocB] = concepts;
    expect(feuille.parentId).toBe(blocA.id);
    expect(blocB.parentId).toBe(chapitre.id);
  });

  // Le fichier CIM francais contient des sections non traduites : libelle vide, code present.
  // Les importer produirait des entrees invisibles a la recherche.
  test('ignore les entrees sans libelle et les compte', () => {
    const { concepts, skipped } = parseTerminologyRows(tsv(
      '1A00\t- - - Cholera\tcategory\t1',
      'SK00\t\tcategory\t1',
      '1F40\t- - -\tcategory\t1',
    ));
    expect(concepts).toHaveLength(1);
    expect(concepts[0].code).toBe('1A00');
    expect(skipped.noLabel).toBe(2);
  });

  // Un regroupement ecarte ne doit ni orpheliner ses enfants, ni les faire adopter par la
  // branche voisine : ils remontent au plus proche ancetre encore valide.
  test('un parent ecarte fait remonter ses enfants au grand-parent', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '\tChapitre\tchapter\t1',
      '\t- \tblock\t1',
      '1A00\t- - Feuille\tcategory\t1',
    ));
    expect(concepts.map((c) => c.label)).toEqual(['Chapitre', 'Feuille']);
    expect(concepts[1].parentId).toBe(concepts[0].id);
  });

  test('un frere qui suit un parent ecarte ne herite pas de la branche precedente', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '\tChapitre\tchapter\t1',
      '\t- Bloc A\tblock\t1',
      '1A00\t- - Feuille A\tcategory\t1',
      '\t- \tblock\t1',
      '1B00\t- - Feuille orpheline\tcategory\t1',
    ));
    const orpheline = concepts.find((c) => c.label === 'Feuille orpheline');
    const blocA = concepts.find((c) => c.label === 'Bloc A');
    // Surtout pas Bloc A : la source ne dit pas qu'elle lui appartient.
    expect(orpheline?.parentId).not.toBe(blocA?.id);
    expect(orpheline?.parentId).toBe(concepts[0].id);
  });

  test('seules les categories codees sont proposables a la saisie', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '\tChapitre\tchapter\t1',
      '\t- Bloc\tblock\t1',
      '1A00\t- - Cholera\tcategory\t1',
      '\t- - Categorie sans code\tcategory\t1',
    ));
    expect(concepts.map((c) => c.isSelectable)).toEqual([false, false, true, false]);
  });

  test('un chapitre ou un bloc n a pas de code, et cela reste licite', () => {
    const { concepts } = parseTerminologyRows(tsv('\tChapitre\tchapter\t1'));
    expect(concepts[0].code).toBeNull();
    expect(concepts[0].isSelectable).toBe(false);
  });

  test('les lignes de type inconnu sont ecartees et comptees', () => {
    const { concepts, skipped } = parseTerminologyRows(tsv(
      '1A00\t- - Cholera\tcategory\t1',
      'XX\t- - Note de bas de page\tfootnote\t1',
    ));
    expect(concepts).toHaveLength(1);
    expect(skipped.unknownKind).toBe(1);
  });

  test('un en-tete inattendu est refuse plutot qu interprete au hasard', () => {
    expect(() => parseTerminologyRows('Libelle\tType\nCholera\tcategory')).toThrow(/En-tete/);
  });

  // Les regroupements n'ont pas de code de classification mais peuvent porter un
  // identifiant technique : autant le reprendre plutot que d'en inventer un.
  test('la colonne BlockId sert d identifiant de repli quand elle est presente', () => {
    const { concepts } = parseTerminologyRows(tsvWithBlockId(
      '\t\tCertaines maladies infectieuses\tchapter\t1',
      '\tBlockL1-1A0\t- Gastroenterite infectieuse\tblock\t1',
      '1A00\t\t- - Cholera\tcategory\t1',
    ));
    expect(concepts.map((c) => c.code)).toEqual([null, 'BlockL1-1A0', '1A00']);
    // Un identifiant de repli ne rend pas un regroupement selectionnable pour autant.
    expect(concepts.map((c) => c.isSelectable)).toEqual([false, false, true]);
  });

  test('l absence de colonne BlockId reste acceptee', () => {
    const { concepts } = parseTerminologyRows(tsv('1A00\t- Cholera\tcategory\t1'));
    expect(concepts[0].code).toBe('1A00');
  });

  test('chaque concept recoit un identifiant distinct', () => {
    const { concepts } = parseTerminologyRows(tsv(
      '1A00\t- Cholera\tcategory\t1',
      '1A01\t- Vibrio\tcategory\t1',
    ));
    expect(new Set(concepts.map((c) => c.id)).size).toBe(2);
  });
});
