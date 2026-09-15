# Évolution du formulaire — lots E0 à E7

- Révision : **2026-09-15**.
- Statut : **spécifié, implémentation et validations à réaliser**.
- Référence métier : [spécification de l’évolution du formulaire](spec-evolution-formulaire.md).
- Prompts d’exécution : [prompts-lots.md](prompts-lots.md), sections **E0 à E7**.
- Ce document porte le découpage et le suivi des lots E. Les identifiants L, UX et O existants ne sont pas renumérotés.

## Résultat à livrer

Dans la même base, le responsable choisit **Modifier le formulaire**, prépare une évolution et
l’applique. Les variables ajoutées sont ensuite renseignables dans les patients et rencontres
existants, selon leur portée et leur applicabilité. Les valeurs anciennes restent conservées.
Le responsable n’a pas à créer ni rattacher manuellement une version.

## Ordre et suivi

| Lot | Résultat | Prérequis | État | Preuves |
|---|---|---|---|---|
| [E0](#e0) | Contrats et classification des changements | Spécification métier | À réaliser | Aucune |
| [E1](#e1) | Préparations persistantes et droits serveur | E0 | À réaliser | Aucune |
| [E2](#e2) | Application atomique dans la même base | E1 | À réaliser | Aucune |
| [E3](#e3) | Lecture et écriture compatibles des dossiers existants | E2 | À réaliser | Aucune |
| [E4](#e4) | Éditeur avec versionnage en arrière-plan | E2, contrat E3 stabilisé | À réaliser | Aucune |
| [E5](#e5) | Complétion dans les formulaires patients et rencontres | E3, E4 | À réaliser | Aucune |
| [E6](#e6) | Exports, provenance et historique | E3 | À réaliser | Aucune |
| [E7](#e7) | Validation intégrée et dossier de preuves | E0 à E6 | À réaliser | Aucune |

Ordre conseillé : **E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7**.
E4 et E6 peuvent avancer séparément après stabilisation de E3 uniquement si leurs fichiers
et contrats sont distincts. Les migrations, RPC et appelants couplés ont un seul responsable
d’écriture. Les revues indépendantes sont en lecture seule.

Les contrôles ciblés appartiennent à chaque lot ; E7 vérifie leur intégration et les parcours
complets. Lors d’une exécution groupée, terminer les implémentations successives avant la campagne
de tests demandée par le porteur ; aucun lot n’est déclaré validé avant exécution de ses contrôles.
La mise à disposition du parcours complet attend E7 : E2 seul ne suffit pas à autoriser une
évolution qui rendrait les anciens dossiers incompatibles avec les lecteurs ou exports.

## E0

### Contrats et classification des changements

**Objectif.** Fixer le contrat partagé avant les modifications du serveur et de l’interface.

**Travail et surfaces.** Relire le code actuel des versions, bases, patients, rencontres,
règles, exports et brouillons. Documenter les interfaces de préparation, d’impact, de lecture
compatible et d’écriture. Réutiliser les mécanismes existants après vérification plutôt que
créer un système de brouillons concurrent. Définir les états et erreurs structurées.

Préciser la définition applicable à chaque champ et valeur, y compris après plusieurs évolutions
successives ; une seule version portée par la fiche ne décrit pas tous ses compléments.
Définir comment distinguer à l’export « non disponible à cette date », « disponible mais vide »
et « non applicable ». Traiter le cas de deux bases utilisant le même jeu : appliquer à A ne
doit pas faire évoluer B implicitement. Vérifier également le cas d’un jeu partagé ou publié
que le responsable de A peut utiliser sans avoir le droit de modifier sa source.

**Sortie attendue.** Contrats et matrice de compatibilité documentés avec exemples pour ajout,
renommage, déplacement, ajout d’option, association diagnostique et changement sémantique.
Un déplacement qui change l’applicabilité ne peut pas être classé comme pure présentation.
Une nouvelle association vers un bloc déjà rempli conserve les valeurs de ce bloc.

**Risques et vérification.** Revue des parcours de lecture/écriture réellement exécutés et des
permissions. Toute décision non résolue concernant la compatibilité est explicitée avant E1.
Les conversions complexes de L57 restent hors périmètre : en leur absence, refuser clairement
l’opération incompatible, conserver la préparation et expliquer la marche à suivre.

**Ajout du 2026-09-15 — justification propriétaire.** Inventorier les opérations de configuration
et leurs exigences de motif, de l’écran au serveur. Appliquer le §4.5 de la spécification :
pas de justification textuelle obligatoire pour le propriétaire, audit automatique conservé.
Distinguer attribution d’accès à l’identité et suppression de base des opérations dispensées.
L’extension du §4.5 couvre aussi les opérations autorisées du propriétaire sur les patients,
rencontres et leurs documents, corrections d’identité comprises sans élargissement des droits.
Inventorier les motifs dans chaque écran/RPC, les transitions de statut et la synchronisation.
Définir également le contrat de confirmation de purge par code aléatoire de cinq caractères (§4.6).

## E1

### Préparations persistantes et droits serveur

**Objectif.** Préparer les changements sans modifier le formulaire actif ni les données cliniques.

**Travail et surfaces.** Migrations additives, opérations serveur, types et appels dans la couche
de données. Ouvrir/reprendre, lire, sauvegarder et abandonner une préparation liée à la base,
à son auteur et à la révision source. Définir expiration, nettoyage et rétention de l’audit.
Conserver variables, sections, rubriques UX-16, règles et provenance dans une copie autonome.
Adapter les contrats de configuration identifiés par E0 pour accepter l’absence de motif du
propriétaire, y compris pour les opérations patient/rencontre, vérifié côté serveur, sans motif
artificiel ni suppression de l’audit. Tester la
dispense et les tentatives de contournement par les autres rôles ; préserver les appelants existants.
Adapter le contrat de purge si nécessaire au code court sans contourner une vérification serveur
du nom ; préserver droits, rétention, concurrence et rejeu.

**Acceptation.** Une préparation survit à la fermeture après sauvegarde confirmée ; une erreur
ne fait pas afficher « sauvegardé ». Abandonner ne touche aucune fiche. Les droits sont revérifiés
à chaque opération. Un autre compte ne peut ni lire ni modifier cette préparation sans droit.

**Risques et vérification.** Tests serveur des accès croisés, droits révoqués, révisions périmées,
double envoi, clé d’opération réutilisée avec un contenu différent et expiration. Vérifier que
la préparation ne contient aucune identité ni valeur clinique. Après migration : génération
et inspection du snapshot puis contrôle de cohérence du schéma.

## E2

### Application atomique dans la même base

**Objectif.** Appliquer une préparation en une opération cohérente et rejouable.

**Travail et surfaces.** Même responsable pour migration/RPC, couche de données et contrats.
Calculer l’impact côté serveur, classifier les changements, créer la révision interne,
copier/remapper sections, rubriques communes, champs et règles, rattacher A et auditer dans une
transaction. Les associations diagnostiques restent des règles du modèle existant.

**Acceptation.** Échec à n’importe quelle étape : aucune application partielle. Deux applications
concurrentes : une seule réussit, l’autre reçoit un conflit. Réponse perdue : le rejeu retrouve
le résultat de la même opération. Aucune fiche ni valeur n’est créée par l’application.
Une autre base B liée au même jeu conserve son formulaire jusqu’à sa propre évolution explicite.

**Risques et vérification.** Tests transactionnels, concurrence, idempotence, refus sémantiques,
provenance et fidélité des copies. Vérifier les groupes UX-16 sans faux blocs cliniques et les
références entre règles et champs. Contrôles de migrations, RLS et privilèges serveur.

## E3

### Lecture et écriture compatibles des dossiers existants

**Objectif.** Autoriser réellement les compléments sur les fiches historiques.

**Travail et surfaces.** Contextes de lecture patients/rencontres, lectures signées, validation
serveur et opérations d’enregistrement. Exposer les champs historiques et les ajouts compatibles
avec leur définition, applicabilité et provenance. Valider la totalité de l’écriture sans
supprimer les clés historiques absentes d’un écran. Refuser les clés et conversions inconnues.

**Acceptation.** Après ajout, un patient existant peut recevoir la nouvelle valeur en conservant
ses valeurs antérieures. Même résultat pour une rencontre existante, avec respect des portées.
Le comportement reste correct après plusieurs évolutions. Un client ancien ou une fiche déjà
ouverte reçoit un contexte compatible ou un conflit explicite conservant les inputs.

**Risques et vérification.** Tests avec champs masqués, valeurs historiques, règles conditionnelles,
formules, diagnostics multiples ou sans bloc, droits révoqués et payload d’un ancien client.
Un ajout d’association ne vide jamais un bloc déjà renseigné. Vérifier le contexte signé réel,
pas uniquement des objets simulés dans les tests React.

## E4

### Éditeur avec versionnage en arrière-plan

**Objectif.** Remplacer le parcours manuel de versions par une modification compréhensible.

**Travail et surfaces.** Éditeur de base, éditeur de version et composants Structure, Sections,
Règles, Collecte diagnostique, Aperçu ; traductions et couche de données associée. Brancher
« Modifier le formulaire », reprise, impact, application et abandon sur E1/E2. Conserver recherche,
Toutes les variables, navigation section/variable/règle, provenance et actions existantes.

**Acceptation.** Le responsable ajoute une variable sans choisir une version ni recréer de base.
Les états préparation locale/enregistrée/conflit sont honnêtes. Changement d’espace, fermeture,
Escape, erreur et conflit préservent la saisie. L’aperçu utilise le moteur réel sans écriture.
La création de nouvelles associations reste accessible par la préparation autorisée.
Les écrans de paramètres concernés et l’application du formulaire ne demandent plus de
justification au propriétaire ; les confirmations d’impact restent distinctes et utilisables.

**Risques et vérification.** Tests web ciblés des actions, droits, retours de navigation et inputs.
Vérification visuelle bureau/mobile : barre latérale escamotable, en-têtes non envahissants,
actions atteignables. Aucun bouton factice pour une dépendance serveur manquante.

## E5

### Complétion des patients et rencontres

**Objectif.** Rendre les champs ajoutés faciles à trouver et à renseigner.

**Travail et surfaces.** Formulaires patients/rencontres et composants de champs partagés.
Afficher les ajouts vides, l’état « À renseigner » et les obligations du formulaire courant.
Préserver le parcours par blocs avec identité en tête et sous-sections parcourues séparément.
Calculer les compteurs sur les données et l’applicabilité réelles, côté serveur lorsque requis.

**Acceptation.** Compléter un nouveau champ n’impose pas de recopier les anciennes réponses.
Ajouter un champ obligatoire ne modifie pas silencieusement le statut clinique existant.
La validation d’une nouvelle saisie et la revalidation explicite suivent le contrat E0 ;
une correction indépendante ne force pas à remplir tous les ajouts avant toute sauvegarde.
Le parcours brouillon, la reprise et les conflits conservent les inputs.

**Risques et vérification.** Tests d’enregistrement et de complétion distincts de la couverture
diagnostique. Scénarios patient/rencontre, fiche curatée, champ obligatoire conditionnel,
plusieurs diagnostics, aucun diagnostic et diagnostic sans bloc. Aucun nouveau droit de saisie
hors connexion n’est introduit ; contexte obsolète traité explicitement au retour en ligne.

**Extension propriétaire.** Retirer les champs de justification obligatoires des opérations patient,
rencontre et document concernées, après livraison des contrats E1 ; conserver l’audit et les
confirmations. Vérifier propriétaire d’une autre base, collaborateur, droits d’identité absents,
statuts cliniques, suppression/restauration et erreurs réseau sans perte de saisie.

**Confirmation de purge.** Dans la corbeille des bases, remplacer la ressaisie du nom par le code
aléatoire de cinq caractères du §4.6. Garder le nom visible, l’avertissement d’irréversibilité et
les conditions de purge. Tester génération à l’ouverture, stabilité, renouvellement, validation,
clavier et absence de double envoi. Ce sous-lot dépend aussi du contrat E1.

## E6

### Exports, provenance et historique

**Objectif.** Expliquer chaque valeur et chaque absence après l’évolution du formulaire.

**Travail et surfaces.** Exports serveur, dictionnaires et écran d’historique. Exposer la
définition applicable et les dates d’application/complétion selon le contrat E0. Préserver les
profils d’export et le cloisonnement d’identité. Garder lisibles les variables retirées et
les anciennes options, sans les remettre implicitement en saisie.

**Acceptation.** Exporter une cohorte mêlant anciennes et nouvelles fiches conserve toutes les
valeurs autorisées et distingue les différents états d’absence. L’historique indique auteur,
date, impact et révision. Les définitions d’anciennes valeurs restent consultables après plusieurs
évolutions. La liste des dossiers affectés respecte les droits de lecture.

**Risques et vérification.** Fixtures d’export avant/après complétion, options retirées, champs
masqués, formules, retrait de variable et périmètres patient/rencontre. Tests de non-divulgation
entre bases et profils. Vérifier le fichier exporté, pas uniquement le composant de téléchargement.

## E7

### Validation intégrée et dossier de preuves

**Objectif.** Prouver le parcours complet avec les données et le moteur réels.

**Fixture.** Base A avec au moins **216 variables, 21 sections et 26 règles**, rubriques communes,
sous-sections, patients et rencontres déjà renseignés ; base B partageant le jeu initial.
Inclure dossiers curatés, plusieurs diagnostics, diagnostic sans bloc, cas mixte et absence de
diagnostic. Ajouter un champ facultatif, un obligatoire et une association, puis compléter une
ancienne fiche. Toutes les données sont fictives.

**Campagne.** Exécuter les contrôles de E1 à E6 sur une cible locale/jetable identifiée ; tests
serveur/RLS et web pertinents, typecheck, lint, build avec `VITE_USE_SIGNED_READ=true`, et vérification
du schéma si migrations. Examiner l’application réelle au navigateur et capturer les parcours
éditeur → impact → application → ancien dossier → complément → export/historique.

**Acceptation.** Les 16 critères du §10 de la spécification ont chacun une preuve, un résultat
et une limite éventuelle. Aucun succès n’est déduit d’une maquette ou d’un compteur fixe.
Conflits, droits révoqués, rejeux et absence d’écriture dans l’aperçu sont vérifiés.

**Traçabilité.** Mettre à jour le tableau de ce document avec SHA testé, commandes, codes de sortie,
scénarios, chemins des captures et environnement. Distinguer implémenté, validé localement,
preuve navigateur et validation distante. Un contrôle impossible reste explicitement ouvert.
Commit, push, fusion, déploiement et migration distante nécessitent la demande correspondante.

## Prompt de reprise d’un lot

Remplacer `E<n>` par le lot visé :

```text
Implémente E<n> de docs/lots-evolution-formulaire.md selon docs/spec-evolution-formulaire.md.
Lis AGENTS.md, inspecte git status, les diffs et les contrats réels des lots prérequis.
Préserve le travail local. Vérifie les prérequis avant de modifier leurs appelants.
Garde un seul responsable d’écriture pour les migrations/RPC/interfaces couplées.
Réutilise les règles, rubriques UX-16, provenance, permissions et moteurs existants.
N’invente ni valeur clinique ni prise en charge d’une dépendance manquante.
Implémente le lot et exécute ses contrôles sur une cible locale/jetable identifiée.
Mets à jour le suivi avec preuves et limites sans déclarer les autres lots livrés.
Ne committe, ne pousse et ne modifie aucun environnement distant sans demande explicite.
```
