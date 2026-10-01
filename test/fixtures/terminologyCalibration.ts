// Jeu de diagnostics FICTIFS annotes pour calibrer le codage terminologique assiste.
//
// Chaque cas porte :
//   * `text`   : ce qu'un medecin pourrait ecrire (aucune donnee reelle, aucun patient) ;
//   * `llm`    : une interpretation SIMULEE, telle que le LLM la rendrait. Elle est ecrite a la
//                main faute d'acces au modele pendant le calibrage ; une partie est volontairement
//                IMPARFAITE (termes cliniques plutot que CIM-11, terme trop general, coquilles)
//                pour ne pas calibrer sur un interprete ideal ;
//   * `expect` : la verite terrain, verifiee contre le referentiel versionne
//                (supabase/terminology/diagnostics-fr.tsv.gz) :
//                  - `code`      : codes ACCEPTABLES (le premier est le meilleur) ;
//                  - `ambiguous` : le texte ne permet pas de trancher ; un code impose serait une
//                                  erreur, la bonne reponse figure parmi `codes` ;
//                  - `unmatched` : aucun concept du referentiel ne convient (entite absente de la
//                                  traduction, chapitre ecarte, texte non diagnostique).
//   * `split`  : `dev` sert a choisir les seuils, `test` a mesurer sans les avoir vus.
//                `holdout` a ete ecrit APRES les corrections du score tirees de dev+test, et
//                n'a servi a aucun ajustement : c'est la seule mesure non biaisee.
//
// Le repli lexical (sans LLM) est evalue sur les memes textes, a partir de `text` seul.

export interface SimulatedInterpretation {
  normalized: string;
  searchTerms: string[];
  ambiguous?: boolean;
  alternativeTerms?: string[];
}

export type Expectation =
  /**
   * `noAuto` : codes acceptables en proposition, mais qui ajoutent une information absente du
   * texte (germe, stade) : les poser sans confirmation est une erreur critique.
   */
  | { kind: 'code'; codes: string[]; noAuto?: string[] }
  /**
   * `generic` : codes qui reprennent le texte SANS rien preciser (« Hydrocephalie » ->
   * « Hydrocephalie »). Les retenir n'invente aucun detail : ce n'est pas trancher l'ambiguite.
   */
  | { kind: 'ambiguous'; codes: string[]; generic?: string[] }
  | { kind: 'unmatched' };

export interface CalibrationCase {
  id: string;
  /** `holdout` : ecrit apres les corrections du score, evalue une seule fois, jamais ajuste. */
  split: 'dev' | 'test' | 'holdout';
  /** clear : interpretation proche de la CIM-11 ; imperfect : interpretation degradee. */
  family: 'clear' | 'imperfect' | 'ambiguous' | 'absent' | 'trap';
  text: string;
  llm: SimulatedInterpretation;
  expect: Expectation;
}

const code = (...codes: string[]): Expectation => ({ kind: 'code', codes });
const codeNoAuto = (noAuto: string[], ...codes: string[]): Expectation => ({ kind: 'code', codes, noAuto });
const ambiguous = (...codes: string[]): Expectation => ({ kind: 'ambiguous', codes });
const ambiguousOrGeneric = (generic: string[], ...codes: string[]): Expectation => ({ kind: 'ambiguous', codes, generic });
const unmatched: Expectation = { kind: 'unmatched' };
const llm = (normalized: string, ...searchTerms: string[]): SimulatedInterpretation => ({ normalized, searchTerms });
const choice = (normalized: string, alternativeTerms: string[]): SimulatedInterpretation => ({
  normalized,
  searchTerms: [normalized],
  ambiguous: true,
  alternativeTerms,
});

export const CALIBRATION_CASES: CalibrationCase[] = [
  // --- Correspondances claires (interpretation proche des intitules) ------------------------
  { id: 'c01', split: 'dev', family: 'clear', text: 'HSD chronique spontané droit',
    llm: llm('Hématome sous-dural chronique spontané droit', 'Hémorragie sousdurale non traumatique', 'Hématome sous-dural'),
    expect: code('8B02') },
  { id: 'c02', split: 'test', family: 'clear', text: 'Hématome sous-dural spontané gauche',
    llm: llm('Hématome sous-dural spontané gauche', 'Hémorragie sousdurale non traumatique'),
    expect: code('8B02') },
  { id: 'c03', split: 'dev', family: 'clear', text: 'HSD aigu post-traumatique',
    llm: llm('Hématome sous-dural aigu traumatique', 'Hémorragie sousdurale traumatique aigüe'),
    expect: code('NA07.60') },
  { id: 'c04', split: 'test', family: 'clear', text: 'HSD chronique post traumatique bilatéral',
    llm: llm('Hématome sous-dural chronique traumatique bilatéral', 'Hémorragie sousdurale traumatique chronique'),
    expect: code('NA07.61') },
  { id: 'c05', split: 'dev', family: 'clear', text: 'Méningiome frontal droit',
    llm: llm('Méningiome frontal droit', 'Méningiome', 'Méningiomes'),
    expect: code('2A01.0', '2A01.0Z') },
  { id: 'c06', split: 'test', family: 'clear', text: 'Méningiome de la faux du cerveau',
    llm: llm('Méningiome de la faux du cerveau', 'Méningiomes'),
    expect: code('2A01.0', '2A01.0Z') },
  { id: 'c07', split: 'dev', family: 'clear', text: 'GBM temporal gauche',
    llm: llm('Glioblastome temporal gauche', 'Glioblastome du cerveau'),
    expect: code('2A00.00') },
  { id: 'c08', split: 'test', family: 'clear', text: 'Glioblastome pariétal',
    llm: llm('Glioblastome pariétal', 'Glioblastome du cerveau', 'Glioblastome'),
    expect: code('2A00.00') },
  { id: 'c09', split: 'dev', family: 'clear', text: 'HSA spontanée',
    llm: llm('Hémorragie sous-arachnoïdienne spontanée', 'Hémorragie sous-arachnoïdienne'),
    expect: code('8B01') },
  { id: 'c10', split: 'test', family: 'clear', text: 'HSA traumatique',
    llm: llm('Hémorragie sous-arachnoïdienne traumatique', 'Hémorragie sousarachnoïdienne traumatique'),
    expect: code('NA07.7') },
  { id: 'c11', split: 'dev', family: 'clear', text: 'Hématome intracérébral spontané lobaire',
    llm: llm('Hématome intracérébral spontané lobaire', 'Hémorragie intracérébrale'),
    // « lobaire » est ecrit : 8B00.1 « Hemorragie lobaire » est le code le plus fidele (annotation
    // completee le 1er octobre 2026, quand la regle de precision l'a fait remonter).
    expect: code('8B00.1', '8B00', '8B00.Z') },
  { id: 'c12', split: 'test', family: 'clear', text: 'Anévrisme sylvien droit non rompu',
    llm: llm('Anévrisme de l’artère cérébrale moyenne droite non rompu', 'Anévrisme cérébral non-rompu'),
    expect: code('8B22.5') },
  { id: 'c13', split: 'dev', family: 'clear', text: 'Anévrisme carotidien supraclinoïdien droit',
    llm: llm('Anévrisme carotidien supraclinoïdien droit', 'Anévrisme ou dissection de l’artère carotide', 'Anévrisme cérébral non-rompu'),
    expect: code('BD51.0', '8B22.5') },
  { id: 'c14', split: 'test', family: 'clear', text: 'MAV frontale',
    llm: llm('Malformation artérioveineuse frontale', 'Malformation artérioveineuse cérébrale'),
    expect: code('8B22.40') },
  { id: 'c15', split: 'dev', family: 'clear', text: 'Hydrocéphalie à pression normale',
    llm: llm('Hydrocéphalie à pression normale', 'Hydrocéphalie à pression normale'),
    expect: code('8D64.04') },
  { id: 'c16', split: 'test', family: 'clear', text: 'Hydrocéphalie post-hémorragique',
    llm: llm('Hydrocéphalie posthémorragique', 'Hydrocéphalie posthémorragique'),
    expect: code('8D64.02') },
  { id: 'c17', split: 'dev', family: 'clear', text: 'Fracture du rocher droit',
    llm: llm('Fracture de l’os temporal droit', "Fracture d'os temporal"),
    expect: code('NA02.02') },
  { id: 'c18', split: 'test', family: 'clear', text: 'Fracture de la voûte frontale',
    llm: llm('Fracture de l’os frontal', "Fracture d'os frontal"),
    expect: code('NA02.00') },
  { id: 'c19', split: 'dev', family: 'clear', text: 'Fracture de L1',
    llm: llm('Fracture de la première vertèbre lombaire', 'Fracture de la vertèbre lombaire'),
    expect: code('NB52.0') },
  { id: 'c20', split: 'test', family: 'clear', text: 'Fracture de T12',
    llm: llm('Fracture de la douzième vertèbre thoracique', "Fracture d'une vertèbre thoracique"),
    expect: code('NA82.0') },
  { id: 'c21', split: 'dev', family: 'clear', text: 'Fracture de l’odontoïde',
    llm: llm('Fracture de l’odontoïde', 'Fracture du processus odontoïde'),
    expect: code('NA22.12') },
  { id: 'c22', split: 'test', family: 'clear', text: 'Adénome hypophysaire non sécrétant',
    llm: llm('Adénome hypophysaire non sécrétant', 'Adénome hypophysaire non-sécrétant'),
    expect: code('2F37.0') },
  { id: 'c23', split: 'dev', family: 'clear', text: 'Névralgie trigéminale droite',
    llm: llm('Névralgie du trijumeau droite', 'Névralgie du trijumeau'),
    expect: code('8B82.0') },
  { id: 'c24', split: 'test', family: 'clear', text: 'Canal carpien bilatéral',
    llm: llm('Syndrome du canal carpien bilatéral', 'Syndrome du canal carpien'),
    expect: code('8C10.0') },
  { id: 'c25', split: 'dev', family: 'clear', text: 'Méningite bactérienne',
    llm: llm('Méningite bactérienne', 'Méningite bactérienne'),
    expect: code('1D01.0', '1D01.0Z') },
  { id: 'c26', split: 'test', family: 'clear', text: 'Métastases cérébrales multiples',
    llm: llm('Métastases cérébrales multiples', 'Métastase de tumeur maligne, dans le cerveau'),
    expect: code('2D50') },
  { id: 'c27', split: 'dev', family: 'clear', text: 'HTA',
    llm: llm('Hypertension artérielle', 'Hypertension essentielle'),
    expect: code('BA00', 'BA00.Z') },
  { id: 'c28', split: 'test', family: 'clear', text: 'Diabète de type 2',
    llm: llm('Diabète de type 2', 'Diabète sucré de type 2'),
    expect: code('5A11') },
  { id: 'c29', split: 'dev', family: 'clear', text: 'DT1',
    llm: llm('Diabète de type 1', 'Diabète sucré de type 1'),
    expect: code('5A10') },
  { id: 'c30', split: 'test', family: 'clear', text: 'AIT',
    llm: llm('Accident ischémique transitoire', 'Accident ischémique transitoire'),
    expect: code('8B10', '8B10.Z') },
  { id: 'c31', split: 'dev', family: 'clear', text: 'BPCO',
    llm: llm('Bronchopneumopathie chronique obstructive', 'Bronchopneumopathie chronique obstructive'),
    expect: code('CA22', 'CA22.Z') },
  { id: 'c32', split: 'test', family: 'clear', text: 'Appendicite aiguë',
    llm: llm('Appendicite aiguë', 'Appendicite aigüe'),
    expect: code('DB10.0') },
  { id: 'c33', split: 'dev', family: 'clear', text: 'Fracture du col fémoral gauche',
    llm: llm('Fracture du col du fémur gauche', 'Fracture du col du fémur'),
    expect: code('NC72.2', 'NC72.2Z') },
  { id: 'c34', split: 'test', family: 'clear', text: 'SEP rémittente',
    llm: llm('Sclérose en plaques rémittente-récurrente', 'Sclérose en plaques rémittente-récurrente'),
    expect: code('8A40.0') },
  { id: 'c35', split: 'dev', family: 'clear', text: 'Paludisme à falciparum',
    llm: llm('Paludisme à Plasmodium falciparum', 'Paludisme à Plasmodium falciparum'),
    expect: code('1F40.Z') },
  { id: 'c36', split: 'test', family: 'clear', text: 'Hypothyroïdie',
    llm: llm('Hypothyroïdie', 'Hypothyroïdie'),
    expect: code('5A00') },

  // --- Interpretations imparfaites (termes cliniques, trop generaux, coquilles) -------------
  { id: 'i01', split: 'dev', family: 'imperfect', text: 'HSD chronique spontané droit',
    llm: llm('Hématome sous-dural chronique spontané droit', 'Hématome sous-dural chronique'),
    expect: code('8B02') },
  { id: 'i02', split: 'test', family: 'imperfect', text: 'Glioblastome frontal',
    llm: llm('Glioblastome frontal', 'Glioblastome frontal'),
    expect: code('2A00.00') },
  { id: 'i03', split: 'dev', family: 'imperfect', text: 'Contusion frontale gauche',
    llm: llm('Contusion cérébrale frontale gauche', 'Contusion cérébrale'),
    expect: code('NA07.4C', 'NA07.40', 'NA07.41') },
  { id: 'i04', split: 'test', family: 'imperfect', text: 'Commotion cérébrale',
    llm: llm('Commotion cérébrale', 'Commotion cérébrale'),
    expect: code('NA07.0', 'NA07.0Z') },
  { id: 'i05', split: 'dev', family: 'imperfect', text: 'Oedème cérébral post traumatique',
    llm: llm('Oedème cérébral post-traumatique', 'Oedeme cerebral traumatique'),
    expect: code('NA07.2', 'NA07.2Z') },
  { id: 'i06', split: 'test', family: 'imperfect', text: 'Fibrillation atriale permanente',
    llm: llm('Fibrillation atriale permanente', 'Fibrillation atriale permanente'),
    expect: code('BC81.32') },
  { id: 'i07', split: 'dev', family: 'imperfect', text: 'Pneumopathie',
    llm: llm('Pneumopathie', 'Pneumonie'),
    // Le referentiel porte un intitule identique au texte (CA7Z) : le retenir est fidele.
    expect: code('CA40', 'CA40.Z', 'CA7Z') },
  { id: 'i08', split: 'test', family: 'imperfect', text: 'Asthme',
    llm: llm('Asthme', 'Asthme'),
    expect: code('CA23', 'CA23.3') },
  { id: 'i09', split: 'dev', family: 'imperfect', text: 'Médulloblastome',
    llm: llm('Médulloblastome', 'Médulloblastome'),
    expect: code('2A00.10') },
  { id: 'i10', split: 'test', family: 'imperfect', text: 'Syringomyélie',
    llm: llm('Syringomyélie', 'Syringomyélie'),
    expect: code('8D66', '8D66.Z', '8D66.0') },
  { id: 'i11', split: 'dev', family: 'imperfect', text: 'Spondylolisthésis L4-L5',
    llm: llm('Spondylolisthésis L4-L5', 'Spondylolisthésis'),
    expect: code('FA84', 'FA84.Z') },
  { id: 'i12', split: 'test', family: 'imperfect', text: 'Radiculopathie L5 sur conflit discal',
    llm: llm('Radiculopathie L5 sur conflit disco-radiculaire', 'Radiculopathie due à une atteinte des disques intervertébraux', 'Radiculopathie'),
    expect: code('8B93.6') },

  // --- Ambiguites : le texte ne permet pas de choisir -------------------------------------------
  { id: 'a01', split: 'dev', family: 'ambiguous', text: 'Hémorragie intracrânienne spontanée',
    llm: choice('Hémorragie intracrânienne spontanée', ['Hémorragie intracérébrale', 'Hémorragie sous-arachnoïdienne', 'Hémorragie sousdurale non traumatique']),
    expect: ambiguousOrGeneric(['8B0Z'], '8B00', '8B01', '8B02') },
  { id: 'a02', split: 'test', family: 'ambiguous', text: 'Saignement intracrânien post-traumatique',
    llm: choice('Hémorragie intracrânienne traumatique', ['Hémorragie sousdurale traumatique', 'Hémorragie sousarachnoïdienne traumatique', 'Hémorragie intracérébrale traumatique']),
    expect: ambiguous('NA07.6', 'NA07.7', 'NA07.1') },
  { id: 'a03', split: 'dev', family: 'ambiguous', text: 'Tumeur cérébrale',
    llm: choice('Tumeur cérébrale', ['Gliomes du cerveau', 'Méningiomes', 'Métastase de tumeur maligne, dans le cerveau']),
    expect: ambiguous('2A00.0', '2A01.0', '2D50') },
  { id: 'a04', split: 'test', family: 'ambiguous', text: 'AVC',
    llm: choice('Accident vasculaire cérébral', ['Accident vasculaire cérébral ischémique', 'Hémorragie intracérébrale']),
    expect: ambiguous('8B11', '8B00') },
  { id: 'a05', split: 'dev', family: 'ambiguous', text: 'Diabète',
    llm: choice('Diabète', ['Diabète sucré de type 1', 'Diabète sucré de type 2']),
    // Decision clinique du 1er octobre 2026 : « Diabete » seul se code fidelement
    // « Diabete sucre, type non precise » (5A14) ; seul un type 1 ou 2 impose serait faux.
    expect: ambiguousOrGeneric(['5A14'], '5A10', '5A11') },
  { id: 'a06', split: 'test', family: 'ambiguous', text: 'Hydrocéphalie',
    llm: choice('Hydrocéphalie', ['Hydrocéphalie communicante', 'Hydrocéphalie non-communicante']),
    expect: ambiguousOrGeneric(['8D64', '8D64.Z'], '8D64.0', '8D64.1') },
  { id: 'a07', split: 'dev', family: 'ambiguous', text: 'Lésion de la moelle cervicale',
    llm: choice('Lésion traumatique de la moelle épinière cervicale', ['Commotion ou œdème de la moelle épinière cervicale', 'Section complète de la moelle épinière cervicale', 'Syndrome central de la moelle épinière cervicale']),
    expect: ambiguous('NA30', 'NA31.0', 'NA31.1') },
  { id: 'a08', split: 'test', family: 'ambiguous', text: 'Gliome',
    llm: choice('Gliome', ['Gliomes du cerveau', 'Gliomes de la moelle épinière, des nerfs crâniens ou paravertébraux']),
    expect: ambiguous('2A00.0', '2A02.0', '2A00.0Z') },

  // --- Absents du referentiel : rien ne doit etre impose -----------------------------------------
  // Annotation corrigee au calibrage : « epidurale » est le synonyme retenu par la traduction.
  { id: 'u01', split: 'dev', family: 'imperfect', text: 'HED temporal droit post-traumatique',
    llm: llm('Hématome extradural temporal droit traumatique', 'Hémorragie extradurale traumatique', 'Hématome extradural'),
    expect: code('NA07.5') },
  // Annotation corrigee au calibrage : la hernie discale lombaire est un prolapsus discal (FA80.9).
  { id: 'u02', split: 'test', family: 'imperfect', text: 'Hernie discale L5-S1',
    llm: llm('Hernie discale L5-S1', 'Hernie discale lombaire', 'Hernie du disque intervertébral'),
    expect: code('FA80.9') },
  // Annotation corrigee au calibrage : les cephalees existent au chapitre neurologique.
  { id: 'u03', split: 'dev', family: 'clear', text: 'Céphalées',
    llm: llm('Céphalées', 'Céphalée'),
    expect: code('8A8Z') },
  { id: 'u04', split: 'test', family: 'absent', text: 'Lombalgie commune',
    llm: llm('Lombalgie commune', 'Lombalgie'),
    expect: unmatched },
  { id: 'u05', split: 'dev', family: 'absent', text: 'Contrôle post-opératoire',
    llm: { normalized: 'Contrôle post-opératoire', searchTerms: [] },
    expect: unmatched },
  { id: 'u06', split: 'test', family: 'absent', text: 'Syndrome de Zorglub',
    llm: llm('Syndrome de Zorglub', 'Syndrome de Zorglub'),
    expect: unmatched },
  { id: 'u07', split: 'dev', family: 'absent', text: 'Schwannome vestibulaire droit',
    llm: llm('Schwannome vestibulaire droit', 'Schwannome vestibulaire', 'Neurinome de l’acoustique'),
    expect: unmatched },
  { id: 'u08', split: 'test', family: 'absent', text: 'Malformation de Chiari type 1',
    llm: llm('Malformation de Chiari de type 1', 'Malformation de Chiari'),
    expect: unmatched },

  // --- Pieges : entites voisines, un code proche serait faux --------------------------------------
  { id: 't01', split: 'dev', family: 'trap', text: 'Hématome sous-dural aigu traumatique',
    llm: llm('Hématome sous-dural aigu traumatique', 'Hémorragie sousdurale traumatique aigüe', 'Hémorragie sousdurale'),
    expect: code('NA07.60') },
  { id: 't02', split: 'test', family: 'trap', text: 'HSD du nouveau-né',
    llm: llm('Hématome sous-dural non traumatique du nouveau-né', 'Hémorragie sousdurale non traumatique du fœtus ou du nouveau-né'),
    expect: code('KA82.7') },
  { id: 't03', split: 'dev', family: 'trap', text: 'Hématome extradural spontané',
    llm: llm('Hématome extradural non traumatique', 'Hémorragie extradurale non traumatique'),
    expect: code('8B03') },
  { id: 't04', split: 'test', family: 'trap', text: 'Hémorragie intracérébrale traumatique',
    llm: llm('Hémorragie intracérébrale traumatique', 'Hémorragie intracérébrale traumatique'),
    expect: code('NA07.1') },
  { id: 't05', split: 'dev', family: 'trap', text: 'Fracture de C1',
    llm: llm('Fracture de l’atlas', 'Fracture de la première vertèbre cervicale'),
    expect: code('NA22.0', 'NA22.0Z') },
  { id: 't06', split: 'test', family: 'trap', text: 'Fracture de C2',
    llm: llm('Fracture de l’axis', 'Fracture de la deuxième vertèbre cervicale'),
    expect: code('NA22.1', 'NA22.13') },
  { id: 't07', split: 'dev', family: 'trap', text: 'Fracture de la base du crâne étage antérieur',
    llm: llm('Fracture de l’étage antérieur de la base du crâne', 'Fracture de la fosse antérieure de la base du crâne'),
    expect: code('NA02.10') },
  { id: 't08', split: 'test', family: 'trap', text: 'Démence parkinsonienne',
    llm: llm('Démence de la maladie de Parkinson', 'Démence due à la maladie de Parkinson'),
    expect: code('6D85.0') },

  // --- Inferences et sigles (ajoutes le 2026-10-01, apres l'exemple PFLA + IR + VIH) -------
  // Le LLM simule DEDUIT un germe que le medecin n'a pas ecrit : proposable, jamais automatique.
  { id: 't09', split: 'dev', family: 'trap', text: 'Pneumonie franche lobaire aiguë',
    llm: llm('Pneumonie franche lobaire aiguë', 'Pneumonie due à Streptococcus pneumoniae', 'Pneumonie bactérienne'),
    expect: codeNoAuto(['CA40.07'], 'CA40.0', 'CA40', 'CA40.Z', 'CA40.07') },
  { id: 't10', split: 'test', family: 'trap', text: 'Méningite purulente',
    llm: llm('Méningite purulente', 'Méningite à méningocoques', 'Méningite bactérienne'),
    expect: codeNoAuto(['1C1C.0'], '1D01.0', '1D01.0Z', '1C1C.0') },
  { id: 't11', split: 'dev', family: 'trap', text: 'Infection VIH',
    llm: llm('Infection par le VIH', 'Maladie due au VIH'),
    expect: code('1C62', '1C62.Z') },
  { id: 't12', split: 'test', family: 'trap', text: 'Terrain HIV',
    llm: llm('Infection par le VIH', "Maladie par le virus de l'immunodéficience humaine"),
    expect: code('1C62', '1C62.Z') },
  { id: 't13', split: 'dev', family: 'trap', text: 'VIH stade 3',
    llm: llm('Infection par le VIH stade clinique 3', 'Maladie due au VIH stade clinique 3'),
    expect: code('1C62.2') },

  // --- Controle inedit (holdout) : ecrit apres les corrections du score, jamais ajuste ---------
  { id: 'h01', split: 'holdout', family: 'clear', text: 'Thrombophlébite cérébrale',
    llm: llm('Thrombose veineuse cérébrale', 'Thrombose veineuse cérébrale'),
    expect: code('8B22.1') },
  { id: 'h02', split: 'holdout', family: 'clear', text: 'Dissection vertébrale intracrânienne',
    llm: llm('Dissection de l’artère vertébrale intracrânienne', 'Dissection des artères cérébrales'),
    expect: code('8B22.0') },
  { id: 'h03', split: 'holdout', family: 'clear', text: 'Abcès cérébral frontal',
    llm: llm('Abcès cérébral frontal', 'Abcès intracrânien'),
    expect: code('1D03.3', '1D03.3Z') },
  { id: 'h04', split: 'holdout', family: 'clear', text: 'Épilepsie post-traumatique',
    llm: llm('Épilepsie post-traumatique', 'Épilepsie due à des traumatismes crâniens'),
    expect: code('8A60.5') },
  { id: 'h05', split: 'holdout', family: 'clear', text: 'Kyste arachnoïdien temporal',
    llm: llm('Kyste arachnoïdien temporal', 'Kyste arachnoïdien intracrânien'),
    expect: code('8D67') },
  { id: 'h06', split: 'holdout', family: 'clear', text: 'Maladie de Parkinson',
    llm: llm('Maladie de Parkinson', 'Maladie de Parkinson'),
    expect: code('8A00.0', '8A00.0Z') },
  { id: 'h07', split: 'holdout', family: 'clear', text: 'IDM antérieur',
    llm: llm('Infarctus du myocarde antérieur', 'Infarctus aigu du myocarde'),
    expect: code('BA41', 'BA41.Z') },
  { id: 'h08', split: 'holdout', family: 'clear', text: 'Lymphome cérébral primitif',
    llm: llm('Lymphome primitif du système nerveux central', 'Lymphome primitif diffus à grandes cellules B du système nerveux central'),
    expect: code('2A81.5') },
  { id: 'h09', split: 'holdout', family: 'imperfect', text: 'Insuffisance rénale chronique stade 4',
    llm: llm('Insuffisance rénale chronique stade 4', 'Insuffisance rénale chronique'),
    expect: code('GB61.4') },
  { id: 'h10', split: 'holdout', family: 'imperfect', text: 'Contusion temporale droite',
    llm: llm('Contusion temporale droite', 'Contusion temporale'),
    expect: code('NA07.4A') },
  { id: 'h11', split: 'holdout', family: 'imperfect', text: 'Hydrocéphalie obstructive',
    llm: llm('Hydrocéphalie obstructive', 'Hydrocéphalie obstructive'),
    expect: code('8D64.1', '8D64.1Z') },
  { id: 'h12', split: 'holdout', family: 'imperfect', text: 'HTIC idiopathique',
    llm: llm('Hypertension intracrânienne idiopathique', 'Hypertension intracrânienne'),
    expect: code('8D60', '8D60.Z') },
  { id: 'h13', split: 'holdout', family: 'ambiguous', text: 'Fracture du crâne',
    llm: choice('Fracture du crâne', ['Fracture de la voute du crâne', 'Fracture de la base du crâne']),
    expect: ambiguousOrGeneric(['NA02', 'NA02.Z'], 'NA02.0', 'NA02.1', 'NA02.0Z', 'NA02.1Z') },
  { id: 'h14', split: 'holdout', family: 'ambiguous', text: 'Cancer du poumon',
    llm: choice('Cancer du poumon', ['Adénocarcinome des bronches ou du poumon', 'Carcinome à petites cellules des bronches ou du poumon', 'Carcinome épidermoïde des bronches ou du poumon']),
    expect: ambiguous('2C25.0', '2C25.1', '2C25.2') },
  { id: 'h15', split: 'holdout', family: 'ambiguous', text: 'Hépatite C',
    llm: choice('Hépatite C', ['Hépatite C aigüe', 'Hépatite C chronique']),
    expect: ambiguous('1E50.2', '1E51.1') },
  { id: 'h16', split: 'holdout', family: 'absent', text: 'Épendymome du 4e ventricule',
    llm: llm('Épendymome du quatrième ventricule', 'Épendymome'),
    expect: unmatched },
  { id: 'h17', split: 'holdout', family: 'absent', text: 'Craniopharyngiome',
    llm: llm('Craniopharyngiome', 'Craniopharyngiome'),
    expect: unmatched },
  { id: 'h18', split: 'holdout', family: 'absent', text: 'Spondylodiscite L3-L4',
    llm: llm('Spondylodiscite L3-L4', 'Spondylodiscite'),
    expect: unmatched },
  { id: 'h19', split: 'holdout', family: 'trap', text: 'HSA anévrismale',
    llm: llm('Hémorragie sous-arachnoïdienne par rupture anévrismale', 'Hémorragie sousarachnoïdienne anévrismale', 'Hémorragie sous-arachnoïdienne'),
    expect: code('8B01.0') },
  { id: 'h20', split: 'holdout', family: 'trap', text: 'Cholécystite aiguë lithiasique',
    llm: llm('Cholécystite aiguë lithiasique', 'Cholécystite aigüe'),
    expect: code('DC12.0', 'DC12.0Z') },
];
