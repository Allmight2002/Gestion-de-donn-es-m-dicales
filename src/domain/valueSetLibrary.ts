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
