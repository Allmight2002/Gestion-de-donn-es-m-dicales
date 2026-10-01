// Saisies FICTIVES a plusieurs diagnostics, pour le banc d'essai du codage assiste
// (test/terminology-coding-bench.test.ts). Le jeu de calibrage
// (terminologyCalibration.ts) ne porte qu'un diagnostic par texte ; ici, chaque diagnostic
// attendu doit se retrouver parmi les propositions.
//
// Codes verifies contre le referentiel versionne (supabase/terminology/diagnostics-fr.tsv.gz).
// `codes` : codes ACCEPTABLES pour ce diagnostic, le premier etant le plus fidele au texte.

export interface MultiBenchCase {
  id: string;
  text: string;
  expected: Array<{ label: string; codes: string[] }>;
}

export const MULTI_BENCH_CASES: MultiBenchCase[] = [
  {
    id: 'm01',
    text: 'Syndrome néphrotique associé à une pneumonie',
    expected: [
      { label: 'Syndrome néphrotique', codes: ['GB41'] },
      { label: 'Pneumonie', codes: ['CA40.Z', 'CA40'] },
    ],
  },
  {
    id: 'm02',
    text: 'Polytraumatisme avec TCE sévère avec HED + Fracture des 2 os de la jambe droite',
    expected: [
      { label: 'Hématome extradural traumatique', codes: ['NA07.5'] },
      // Le siege (diaphyse) n'est pas ecrit : le parent ou la jambe sans precision sont fideles,
      // le tibia et la fibula acceptables.
      { label: 'Fracture des deux os de la jambe', codes: ['NC92', 'ND54', 'NC92.2', 'NC92.4'] },
    ],
  },
  {
    id: 'm03',
    text: 'HTA, diabète de type 2 et FA',
    expected: [
      { label: 'Hypertension artérielle', codes: ['BA00.Z', 'BA00'] },
      { label: 'Diabète de type 2', codes: ['5A11'] },
      { label: 'Fibrillation atriale', codes: ['BC81.3Z', 'BC81.3'] },
    ],
  },
  {
    id: 'm04',
    text: 'AVC ischémique sur FA',
    expected: [
      { label: 'AVC ischémique', codes: ['8B11.20', '8B11', '8B11.2', '8B11.2Z'] },
      { label: 'Fibrillation atriale', codes: ['BC81.3Z', 'BC81.3'] },
    ],
  },
  {
    id: 'm05',
    text: 'Cirrhose alcoolique compliquée de varices oesophagiennes',
    expected: [
      { label: 'Cirrhose alcoolique', codes: ['DB94.3'] },
      { label: 'Varices œsophagiennes', codes: ['DA26.0Z', 'DA26.0'] },
    ],
  },
  {
    id: 'm06',
    text: 'BPCO + insuffisance cardiaque',
    expected: [
      { label: 'BPCO', codes: ['CA22.Z', 'CA22'] },
      { label: 'Insuffisance cardiaque', codes: ['BD1Z', 'BD10'] },
    ],
  },
  {
    id: 'm07',
    text: 'IRC stade 3 avec anémie',
    expected: [
      { label: 'Maladie rénale chronique stade 3', codes: ['GB61.2', 'GB61.3', 'GB61', 'GB61.Z'] },
      { label: 'Anémie', codes: ['3A71.2', '3A71', '3A71.Z', '3A9Z'] },
    ],
  },
  {
    id: 'm08',
    text: 'Méningiome frontal opéré, épilepsie séquellaire',
    expected: [
      { label: 'Méningiome', codes: ['2A01.0Z', '2A01.0'] },
      { label: 'Épilepsie', codes: ['8A6Z', '8A60'] },
    ],
  },
];
