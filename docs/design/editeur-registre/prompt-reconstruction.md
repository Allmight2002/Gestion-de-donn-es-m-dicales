# Prompt à copier dans la nouvelle session

Les instructions ci-dessous supposent que l’agent a accès au dépôt MedData. Adapter uniquement le chemin du projet s’il est déplacé.

```text
Travaille dans le dépôt MedData, situé ici :
D:\Users\USER\Desktop\Claude MedData

Implémente dans l’application existante l’organisation de l’éditeur des jeux de variables décrite dans :
docs/design/editeur-registre/README.md

La référence visuelle interactive est :
docs/design/editeur-registre/maquette.html
Son code source lisible est :
docs/design/editeur-registre/maquette.source.html

Lis d’abord AGENTS.md, le README de transmission et les parties pertinentes des spécifications UX-14/UX-16. Inspecte git status, les diffs et le code réel : le projet contient du travail local à préserver. Ne suppose pas que les fonctions déjà présentes ont été validées.

Ouvre la maquette pour examiner Structure du formulaire, Règles, Collecte diagnostique et Aperçu. Reproduis sa hiérarchie, sa navigation et sa présentation progressive dans les composants React/TypeScript existants, en utilisant les données et le moteur réels de MedData. La maquette est une référence visuelle partielle : ne copie pas ses données fictives, ses compteurs fixes ni ses règles simplifiées dans l’application.

Conserve la recherche globale et la vue Toutes les variables, les actions existantes, les permissions, la provenance, les restrictions des versions publiées/utilisées et les protections contre la perte de saisie. Les associations diagnostiques et les règles doivent rester les mêmes objets. L’aperçu ne doit rien enregistrer. Les rubriques communes suivent le contrat UX-16 et ne deviennent jamais de faux blocs cliniques pour imiter la maquette.

Commence par un diagnostic court des écarts entre le code et cette cible, puis poursuis les lots d’implémentation et leurs vérifications. Garde un seul responsable d’écriture pour les changements couplés ; suis les règles de délégation du dépôt. Une dépendance UX-16 manquante doit être traitée explicitement selon son contrat, sans masquer son absence par une simulation.

Vérifie les critères du README, notamment une fixture fictive de 216 variables, au moins 21 sections et au moins 26 règles, les parcours section/variable/règle, la conservation des inputs et les scénarios diagnostiques multiples ou sans bloc. Exécute les contrôles pertinents et examine visuellement l’application réelle, en utilisant les outils disponibles. Si un contrôle est impossible, explique la limite et continue les travaux indépendants autorisés.

Termine avec les changements réalisés, les preuves de validation, des captures de l’interface réelle si le navigateur est disponible et les écarts restants. Ne t’arrête pas à une nouvelle maquette ni à un plan. Ne committe, ne pousse, ne fusionne, ne déploie et ne modifie aucun environnement distant sans demande explicite.
```
