// F4 — Bibliotheque de JEUX DE VALEURS pour les champs a liste controlee.
//
// Pourquoi : une liste controlee ne vaut que si elle est REELLEMENT garnie. Taper trente
// valeurs a la main decourage, et l'utilisateur retombe sur du texte libre — donc sur des
// donnees non analysables, qui est precisement le probleme que la liste devait resoudre.
// On propose donc des jeux prets a l'emploi au moment de creer le champ.
//
// Contenu PUR (aucune I/O), comme templateLibrary. L'insertion est une COPIE : les valeurs
// sont recopiees dans le champ, jamais referencees. Une base reste donc autonome — modifier
// un jeu ici ne peut pas changer retroactivement le sens de donnees deja saisies, ni faire
// disparaitre une valeur utilisee dans un historique.
//
// Ces jeux sont des POINTS DE DEPART a adapter, pas des standards cliniques. Ils reprennent
// les listes deja utilisees par les modeles de templateLibrary, afin de n'introduire aucune
// nomenclature nouvelle qui n'aurait pas ete validee par un usage reel.

export interface ValueSet {
  id: string;
  name: string;
  /** Regroupement affiche dans le selecteur. */
  domain: string;
  description: string;
  values: string[];
}

export const VALUE_SET_LIBRARY: ValueSet[] = [
  {
    id: 'sexe',
    name: 'Sexe',
    domain: 'Démographie',
    description: 'Sexe tel que recueilli dans les registres existants.',
    values: ['M', 'F'],
  },
  {
    id: 'oui-non-inconnu',
    name: 'Oui / Non / Inconnu',
    domain: 'Général',
    description: "Réponse à trois états, lorsque l'absence d'information doit rester distincte d'un « non ».",
    values: ['Oui', 'Non', 'Inconnu'],
  },
  {
    id: 'type-rencontre',
    name: 'Type de rencontre',
    domain: 'Général',
    description: 'Types de rencontre reconnus par le modèle de données.',
    values: ['consultation', 'hospitalisation', 'suivi', 'autre'],
  },
  {
    id: 'stade-tumoral',
    name: 'Stade tumoral',
    domain: 'Oncologie',
    description: 'Stades du registre oncologique de la bibliothèque de gabarits.',
    values: ['I', 'II', 'III', 'IV'],
  },
  {
    id: 'traitement-oncologique',
    name: 'Traitement oncologique',
    domain: 'Oncologie',
    description: 'Traitements du registre oncologique de la bibliothèque de gabarits.',
    values: ['chirurgie', 'chimiothérapie', 'radiothérapie', 'surveillance'],
  },
  {
    id: 'reponse-traitement',
    name: 'Réponse au traitement',
    domain: 'Oncologie',
    description: 'Réponses du registre oncologique de la bibliothèque de gabarits.',
    values: ['complète', 'partielle', 'stable', 'progression'],
  },
];

/**
 * Decoupe la saisie libre des valeurs autorisees.
 *
 * Une valeur par ligne : c'est le seul format qui autorise une valeur contenant une virgule
 * (« Traumatisme, membre inferieur ») et qui reste lisible au-dela de quelques items.
 * Compatibilite : une saisie tenant sur UNE seule ligne est encore decoupee sur les virgules,
 * afin de ne pas casser l'habitude ni la relecture des champs crees avant ce changement.
 */
export function parseAllowedValues(raw: string): string[] {
  const lines = raw.split('\n');
  const parts = lines.length > 1 ? lines : raw.split(',');
  return dedupe(parts.map((v) => v.trim()).filter(Boolean));
}

/** Fusionne des valeurs dans une liste existante sans creer de doublon ni changer l'ordre. */
export function mergeValues(current: string[], added: string[]): string[] {
  return dedupe([...current, ...added.map((v) => v.trim()).filter(Boolean)]);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
