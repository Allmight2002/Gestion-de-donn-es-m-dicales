# Spécification — évolution fluide du formulaire et complétion des dossiers existants

- Révision : **2026-09-15** (ajout : paramètres de base sans justification obligatoire pour le propriétaire).
- Statut : **décision métier retenue, implémentation à planifier**.
- Origine : retour d’usage sur le versionnage des jeux de variables. Le responsable d’une base
  ne comprend pas pourquoi une variable ou une règle devient impossible à modifier, et ne doit
  pas avoir à créer un nouveau jeu de variables ni une nouvelle base pour faire évoluer sa
  collecte.
- Périmètre : une base existante, ses patients et ses rencontres, ses variables, ses sections,
  ses règles et ses associations diagnostiques. Les données restent fictives tant que le cadre
  juridique et éthique du projet n’est pas validé.

Cette décision complète UX-14/UX-16, L51 à L56 et le modèle de version décrit dans
[`architecture.md`](architecture.md). Elle **ne modifie pas encore le code ni le schéma**.
Tant que les lots ci-dessous ne sont pas livrés, les gardes actuelles des versions publiées ou
utilisées restent actives. Elle précise le comportement cible qui remplacera l’exposition du
versionnage technique dans le parcours courant.

## 1. Décision produit

Le responsable travaille toujours dans **la même base**. Il choisit « Modifier le formulaire »
et l’application prépare en arrière-plan une évolution du formulaire. Le responsable peut y
ajouter une variable, créer une section ou une association diagnostique, puis compléter les
dossiers existants. Il ne choisit pas un numéro de version et ne crée pas de nouveau jeu de
variables pour cette opération.

L’application conserve les définitions précédentes pour l’audit et pour les données déjà
enregistrées, mais les évolutions additives deviennent disponibles dans la base après une
application explicite. Une nouvelle variable ajoutée n’a aucune valeur par défaut implicite dans
les dossiers existants : elle apparaît vide et doit être renseignée par un utilisateur autorisé.

La promesse utilisateur est la suivante :

> Je peux faire évoluer le formulaire de ma base, puis renseigner cette nouvelle information
> pour les patients déjà présents. L’application garde l’historique et m’avertit seulement quand
> une modification pourrait changer le sens d’une donnée existante.

Le versionnage reste une propriété technique et scientifique du système. Il apparaît uniquement
dans l’historique, les exports de dictionnaire et les messages d’impact nécessaires à une
décision, jamais comme une étape obligatoire du parcours nominal.

## 2. Vocabulaire

| Terme | Définition | Visible dans le parcours courant |
|---|---|---|
| Formulaire actif | Définition utilisée pour les nouvelles saisies dans la base | Oui |
| Préparation | Ensemble de changements locaux ou serveur non encore appliqués à la base | Oui |
| Application | Validation atomique d’une préparation et mise à disposition dans la même base | Oui |
| Révision technique | Copie interne conservée pour l’historique, les droits, l’export et la reproductibilité | Non, sauf historique |
| Complétion | Saisie d’une nouvelle variable dans une fiche existante | Oui |
| Migration sémantique | Transformation explicite d’une variable existante dont le sens ou le type change | Oui, avec décision |
| Historique | Liste des applications, auteurs, dates, impacts et définitions précédentes | Secondaire |

Une fiche existante conserve son auteur, ses valeurs, sa provenance et la définition sous laquelle
elles ont été enregistrées. Cela n’empêche pas d’y ajouter une nouvelle valeur compatible. Une
valeur manquante reste manquante jusqu’à une saisie explicite.

## 3. Objectifs et limites

### Objectifs

- Faire évoluer le formulaire d’une base sans créer de base ou de jeu de variables parallèle.
- Permettre qu’une variable nouvellement ajoutée soit visible et renseignable pour les patients
  et rencontres déjà présents.
- Permettre qu’une association diagnostique nouvellement créée rende un bloc disponible pour les
  fiches concernées, sans inventer de valeur clinique.
- Préserver les valeurs, les clés, la provenance, les journaux et les exportations historiques.
- Garder une application atomique, contrôlée par les permissions et rejouable sans doublon.
- Montrer un impact compréhensible au responsable sans lui demander de connaître SQL ou les RPC.
- Conserver les protections de concurrence, de perte de saisie, de RLS et de séparation identité /
  analytique / documents.

### Hors périmètre de cette décision

- Convertir automatiquement une valeur existante vers un autre type ou une autre unité.
- Réinterpréter silencieusement une réponse historique selon une nouvelle règle.
- Remplir automatiquement une nouvelle variable avec une valeur supposée.
- Modifier une fiche à laquelle l’utilisateur n’a plus accès.
- Créer une table de diagnostics indépendante des valeurs et règles existantes.
- Modifier la politique hors connexion ou autoriser des données d’identité dans un brouillon.
- Publier ou déployer une migration distante.

## 4. Parcours utilisateur

### 4.1 Ajouter une variable oubliée

Exemple : la base A contient 100 patients et le responsable découvre que « Date de début des
symptômes » manque au formulaire.

1. Il ouvre A et choisit **Modifier le formulaire**.
2. L’application ouvre ou reprend une préparation nommée **Modifications du formulaire**.
3. Il ajoute la variable dans la section voulue et peut utiliser l’aperçu réel du formulaire.
4. L’application indique : « 1 variable ajoutée ; elle sera disponible pour les nouveaux et les
   100 patients existants. Les fiches existantes commenceront sans valeur. »
5. Il clique sur **Appliquer les modifications**.
6. Après validation serveur, la même base A utilise la nouvelle définition pour les prochaines
   saisies et expose la variable aux 100 patients existants.
7. Il ouvre une fiche, renseigne la date et enregistre. La modification est auditée comme toute
   autre correction autorisée.

Aucun patient n’est recréé. Aucun nom, date ou valeur n’est copié dans la préparation de structure.

### 4.2 Ajouter une association diagnostique

Le responsable ajoute l’association du code D au bloc B1.

- L’association est enregistrée comme la règle diagnostique existante, sans second objet
  concurrent.
- Après application, les fiches dont le diagnostic contient D peuvent afficher B1.
- Les champs de B1 sont vides tant qu’aucun utilisateur ne les renseigne.
- Une fiche peut donc être **éligible à un bloc** et rester **incomplète**. La couverture
  diagnostique ne vaut pas preuve de collecte.
- Les fiches historiques qui ne portent pas D ne voient pas B1 pour ce seul changement.

Le responsable peut consulter le nombre de fiches potentiellement concernées, mais aucune valeur
clinique n’est calculée ou préremplie par cette opération.

### 4.3 Reprendre ou abandonner une préparation

- Fermer l’éditeur conserve la préparation selon le support validé, avec son état réel : aucune
  modification, préparation locale, préparation enregistrée, erreur ou conflit.
- Rouvrir **Modifier le formulaire** reprend la préparation du même responsable si elle est encore
  autorisée et compatible avec la base.
- **Abandonner** demande une confirmation et supprime uniquement la préparation non appliquée.
- Un changement d’espace ou l’ouverture de l’aperçu n’applique jamais la préparation.
- L’aperçu ne crée ni patient, ni rencontre, ni brouillon clinique, ni nouvelle révision active.

### 4.4 Conflit pendant la préparation

Si un autre responsable applique une évolution entre l’ouverture et la confirmation :

- l’application refuse la confirmation avec un conflit structuré ;
- les champs et choix locaux sont conservés ;
- aucune moitié de préparation n’est appliquée ;
- l’utilisateur peut recharger la base, comparer les changements et reprendre explicitement.

Une réponse réseau perdue ne doit jamais être interprétée comme une application réussie. Une
rejouabilité par clé d’opération doit rendre un nouvel envoi idempotent.

### 4.5 Modifier les paramètres en tant que propriétaire

Le propriétaire peut enregistrer les modifications autorisées des paramètres de sa base et
appliquer les évolutions de son formulaire sans saisir une justification textuelle obligatoire.
Le parcours ne présente pas de champ de justification à remplir pour ces opérations.
L’absence de justification est acceptée côté serveur après vérification du propriétaire réel
de la base ; le navigateur ne peut pas accorder lui-même cette dispense.

L’audit automatique conserve l’auteur, la date, la base, l’opération et les changements de
configuration nécessaires à leur traçabilité. Aucun motif fictif tel que « modification propriétaire »
n’est envoyé pour contourner un ancien contrat obligatoire. Les confirmations d’impact et les
protections contre les changements incompatibles restent applicables.

**Extension du 2026-09-15 :** la dispense s’applique également aux opérations autorisées du
propriétaire sur les patients de cette base et leurs rencontres : saisie et correction de données
analytiques ou d’identité, changement de statut/curation, suppression et restauration des fiches,
ainsi qu’aux opérations sur leurs documents lorsqu’un motif est actuellement exigé.
Elle retire l’obligation de rédiger un motif, sans accorder de droit supplémentaire sur les données.
Les contrôles de propriété, droits d’identité, transitions de statut, concurrence et confirmations
des actions destructrices restent applicables. Le journal conserve la trace réelle des opérations,
avec séparation des données d’identité et analytiques ; aucun motif automatique fictif n’est créé.

Les justifications relatives à l’attribution d’un accès à l’identité à un autre compte et les
motifs de suppression de la base elle-même restent hors de cette dispense. Les autres rôles
conservent leurs droits et obligations actuels. L’inventaire E0 doit couvrir toutes les opérations
sur les patients et rencontres, y compris leurs appels serveur directs et leur synchronisation.

**Constat local du 2026-09-15 :** dans `BaseSettings.tsx`, le changement de modèle d’observation
ne demande déjà aucun motif ; le motif obligatoire visible dans cet écran concerne la suppression.
L’inventaire E0 devra identifier les autres opérations concernées avant toute suppression de
contrôle. Ce constat ne prouve pas la conformité de tous les parcours de configuration.

### 4.6 Confirmer une suppression définitive par un code court

La confirmation de suppression définitive d’une base affiche le nom complet de la base et les
conséquences de l’action, puis demande de recopier **cinq caractères générés aléatoirement**.
Elle ne demande plus de ressaisir le nom. Exemple de présentation : « Pour supprimer définitivement
cette base, saisissez le code affiché : K7M3R ». Cet exemple n’est jamais une constante utilisée
par l’application.

- Générer le code à l’ouverture du dialogue, avec un générateur aléatoire adapté, dans un alphabet
  de lettres majuscules et chiffres excluant les caractères ambigus (0/O, 1/I/L).
- Conserver le même code pendant la saisie et les nouveaux rendus du dialogue ; ne jamais le
  préremplir. Accepter les minuscules après normalisation et ignorer les espaces de début/fin.
- Désactiver la confirmation tant que les cinq caractères ne correspondent pas. Une erreur
  affiche un message près du champ sans effacer la saisie.
- Annuler/fermer ou changer de base invalide le code ; une nouvelle ouverture en génère un autre.
- Pendant l’envoi, empêcher les doubles clics ; en cas de réponse perdue, vérifier le résultat
  avant de relancer une opération. Préserver les protections serveur de rejeu et concurrence.
- Garder le champ accessible au clavier et au lecteur d’écran avec un libellé explicite ; le code
  est une confirmation d’intention, pas un secret ni un facteur d’authentification.

Le serveur continue de vérifier les droits et les conditions de purge. Si le contrat existant
vérifie une ressaisie du nom côté serveur, le remplacer par un contrat cohérent avec ce parcours,
sans envoyer discrètement le nom à la place de l’utilisateur pour contourner le contrôle.
Ce changement concerne la suppression définitive ; la mise en corbeille reste une opération
distincte. Les protections de rétention et les éventuels motifs ne sont pas supprimés par ce code.

## 5. Classification des changements

L’application classe les changements pour éviter de bloquer les corrections courantes tout en
signalant les transformations qui demandent une décision.

| Changement | Parcours cible | Effet sur les fiches existantes |
|---|---|---|
| Ajouter une variable facultative | Autorisé dans la préparation | Nouvelle colonne vide, renseignable |
| Ajouter une variable obligatoire | Autorisé avec avertissement et compteur « à compléter » | Aucune invalidation silencieuse ; la fiche peut être complétée |
| Ajouter une section ou sous-section | Autorisé | Présentation disponible selon le bloc et ses règles |
| Ajouter une association diagnostic → bloc | Autorisé avec aperçu des fiches concernées | Bloc disponible si le diagnostic correspond, sans valeur créée |
| Renommer un libellé ou déplacer une variable | Autorisé | Valeurs conservées ; la présentation suit la définition active |
| Ajouter une option à une liste | Autorisé après validation du référentiel | Les anciennes valeurs restent valides |
| Modifier une clé interne, un type ou un scope | Assistant de migration explicite | Aucune conversion silencieuse |
| Changer le sens d’une règle ou d’une formule | Assistant d’impact, confirmation obligatoire | Les anciennes valeurs ne sont pas réinterprétées sans décision |
| Changer un code d’option ou supprimer une option utilisée | Refus ou migration explicite | Les valeurs historiques restent lisibles |
| Retirer une variable du formulaire courant | Confirmation | La saisie courante la masque ; l’historique et l’export versionné la conservent |

Une variable obligatoire ajoutée ne modifie pas automatiquement `validation_status` des fiches.
Le système expose un état séparé, par exemple **À compléter pour le formulaire courant**, afin
de distinguer la qualité historique de la nouvelle obligation. Une fiche déjà `curated` ne devient
pas silencieusement non curatée.

## 6. Conservation des données et des versions

Le versionnage technique est conservé, mais il cesse d’être le mécanisme que l’utilisateur doit
manipuler.

1. Chaque patient et chaque rencontre conserve la révision sous laquelle ses valeurs existantes
   ont été enregistrées.
2. Une évolution additive ajoute des définitions compatibles à la vue du formulaire de la base.
   Une clé absente de la donnée est rendue comme vide, jamais comme une valeur par défaut inventée.
3. Une écriture de complément conserve les clés historiques et ajoute uniquement les champs
   autorisés par la nouvelle définition. Le serveur valide l’ensemble réellement envoyé.
4. Les changements de type, de clé, de portée ou de sens utilisent une migration explicite, un
   nouveau champ ou un nouveau parcours approuvé ; ils ne sont pas déduits du seul libellé.
5. Les exports doivent pouvoir indiquer la révision de définition de chaque valeur et distinguer
   une valeur absente d’une variable qui n’existait pas encore dans la fiche.
6. Le dictionnaire et l’audit conservent l’auteur, la date, la préparation appliquée et la
   définition précédente. Aucun pointeur vivant vers une copie source n’est utilisé.

La vue compatible doit être calculée côté serveur ou à partir d’un contexte signé et contrôlé.
Le navigateur ne peut pas décider seul qu’une variable est additive, qu’une fiche est compatible
ou qu’une valeur historique peut être convertie.

## 7. Contrat technique cible

Les noms ci-dessous sont des propositions de contrat et doivent être alignés sur les conventions
du dépôt avant migration. Ils décrivent les responsabilités, pas une permission d’ajouter des RPC
sans revue de sécurité.

### 7.1 Préparation de formulaire

Une préparation est liée à une base, à son propriétaire et à la révision source observée. Elle
porte un état borné : `active`, `ready`, `applied`, `discarded`, `conflict` ou `expired`.

Le serveur doit fournir les opérations suivantes, sous RLS et verrou optimiste :

- ouvrir ou reprendre une préparation pour une base ;
- lire le contexte complet (variables, sections, règles, configuration diagnostique, provenance,
  empreinte et révision attendue) ;
- enregistrer un changement de préparation avec une clé d’opération idempotente ;
- prévisualiser l’impact, sans écrire ;
- appliquer la préparation en une transaction ;
- abandonner explicitement une préparation non appliquée ;
- lister l’historique des applications sans exposer de données d’identité non autorisées.

L’application atomique doit créer la nouvelle révision technique, recopier les métadonnées et
règles validées, mettre à jour le formulaire actif de **la même base A**, et enregistrer l’audit.
Une erreur laisse la base et la préparation dans leur état précédent.

### 7.2 Vue d’une fiche existante

La lecture d’un patient ou d’une rencontre doit recevoir un contexte qui distingue :

- les champs présents dans la définition historique de la fiche ;
- les champs additifs désormais disponibles dans la base ;
- les champs applicables selon le moteur de règles et le diagnostic ;
- les champs obligatoires manquants pour le formulaire courant ;
- les valeurs réellement enregistrées et leur provenance.

La mise à jour conserve la version de la fiche, vérifie les droits actuels et accepte les nouveaux
champs seulement si le serveur les classe comme compatibles avec la révision de la fiche. Elle
refuse une clé inconnue, une portée incompatible, une conversion implicite ou une écriture sur une
fiche devenue inaccessible.

### 7.3 Associations diagnostiques

Les associations restent les mêmes objets `validation_rule` que dans L51/L52/L55. La préparation
ne crée pas une seconde table de règles concurrente. Le serveur vérifie :

- le pilote et son scope ;
- la release ou les options référencées ;
- la présence d’un bloc réellement saisissable ;
- l’absence de conflit avec une condition de bloc indépendante ;
- la compatibilité de la règle avec les fiches et la version de la base.

La couverture et la complétude restent deux résultats différents. L’aperçu de l’impact peut
compter les fiches concernées, sans retourner leur identité à un utilisateur qui ne peut pas la
voir.

## 8. Interface utilisateur cible

Le parcours d’une base affiche une action principale **Modifier le formulaire**. Dans l’éditeur :

- un bandeau indique **Aucune modification**, **Modifications en préparation**, **Prêt à
  appliquer**, **Conflit** ou **Erreur** ;
- les espaces Structure, Sections, Règles, Collecte diagnostique et Aperçu restent accessibles ;
- l’aperçu affiche explicitement qu’il n’enregistre rien ;
- l’action principale devient **Appliquer les modifications** lorsque la préparation est valide ;
- **Continuer la préparation**, **Voir l’impact**, **Historique** et **Abandonner** sont proposés
  au bon niveau ;
- le numéro technique de version est secondaire et accompagné d’un libellé compréhensible ;
- une modification non enregistrée protège la navigation exactement comme une saisie clinique ;
- les erreurs apparaissent près de l’action et conservent les valeurs saisies.

Après application, une confirmation résume les conséquences sans vocabulaire SQL :

> Formulaire mis à jour dans la base A. Deux variables ont été ajoutées. 87 dossiers peuvent
> maintenant être complétés. Aucune valeur existante n’a été remplacée.

Le responsable peut ensuite ouvrir une fiche existante et trouver la variable avec l’état **À
renseigner**. L’écran ne transforme pas cet état en erreur clinique et ne propose pas une fausse
valeur pour remplir la case.

## 9. Permissions, sécurité et concurrence

- Seul un utilisateur autorisé à gérer le formulaire de la base peut créer, modifier, appliquer ou
  abandonner une préparation.
- Les collaborateurs gardent leurs permissions de saisie sur les fiches ; l’ajout d’une variable
  ne leur donne aucun accès à l’identité ou aux documents.
- L’identité, l’analytique et les documents restent séparés dans les lectures, préparations,
  journaux, exports et contextes hors connexion.
- Les droits sont vérifiés au moment de l’ouverture, de la sauvegarde de la préparation et de
  l’application. La fermeture de l’éditeur ne vaut pas autorisation durable.
- L’empreinte de la base, la révision attendue et une clé d’opération empêchent l’écrasement,
  le double clic et les applications concurrentes.
- Une application ne met jamais à jour silencieusement une fiche déjà ouverte. La fiche reçoit
  le contexte compatible ou un conflit qui conserve ses inputs locaux.
- Les logs et messages techniques ne contiennent ni identité, ni texte clinique, ni secret.

## 10. Critères d’acceptation

Les contrôles utilisent uniquement des fixtures fictives, dont une base avec plusieurs patients,
rencontres, diagnostics couverts et non couverts, variables communes, blocs et sous-sections.

1. Ajouter une variable facultative dans une base contenant des patients crée une préparation sans
   nouvelle base ni nouveau jeu visible par l’utilisateur.
2. Après application, la variable est visible dans les fiches existantes et nouvelles ; les fiches
   existantes la présentent vide jusqu’à une saisie explicite.
3. Renseigner cette variable dans une fiche existante conserve toutes les anciennes valeurs,
   ajoute une trace d’auteur et de date, et ne change pas silencieusement son statut clinique.
4. Ajouter une variable obligatoire affiche un compteur « à compléter » sans invalider ou
   décurater automatiquement toutes les fiches.
5. Ajouter une association diagnostique rend le bloc disponible pour les fiches correspondantes,
   sans créer de valeur ni de patient/rencontre supplémentaire.
6. Un diagnostic couvert, plusieurs diagnostics, un diagnostic sans bloc, un cas mixte et une
   absence de diagnostic produisent les résultats attendus du moteur existant.
7. Une modification de type, scope, clé, option ou formule déclenche l’assistant ou le refus
   prévu ; aucune valeur historique n’est convertie en silence.
8. Deux responsables appliquant une préparation concurrente obtiennent un conflit explicite et
   aucune perte d’inputs.
9. Une réponse réseau perdue puis rejouée n’applique la préparation qu’une fois.
10. L’aperçu, l’ouverture d’une préparation et son abandon n’écrivent aucune donnée clinique.
11. Les exports et le dictionnaire distinguent une variable absente parce qu’elle n’existait pas
    encore d’une variable existante mais non renseignée.
12. Un utilisateur sans droit de gestion peut renseigner une variable selon ses droits de saisie,
    mais ne peut pas modifier ni appliquer la préparation du formulaire.
13. Les parcours mobiles et bureau ne rendent pas le bouton d’application inaccessible derrière
    un en-tête ou une barre latérale.
14. Les anciennes versions et les clients non migrés continuent à recevoir un refus explicite ou
    une lecture compatible ; aucune écriture destructive n’est déduite d’un champ inconnu.

15. Le propriétaire modifie les paramètres, applique une évolution du formulaire ou effectue une
    opération autorisée sur les patients/rencontres de sa base sans justification textuelle ;
    l’audit reste complet. Un non-propriétaire ne peut obtenir cette dispense en forgeant une requête.
    Les motifs hors périmètre restent inchangés.
16. La suppression définitive exige la recopie du code aléatoire de cinq caractères affiché,
    jamais du nom de la base. Tester code erroné, casse, annulation/réouverture, changement de base,
    stabilité pendant la saisie, double clic, erreur réseau, droits révoqués et accès clavier.

## 11. Lots d’implémentation

Le [plan détaillé E0 à E7](lots-evolution-formulaire.md) est la référence d’exécution et de suivi :
surfaces, dépendances, critères de sortie, risques, vérifications et prompt de reprise.
Tous les lots restent **à réaliser**. Le tableau ci-dessous en donne la synthèse.

Les lots couplés doivent avoir un seul responsable d’écriture pour les interfaces, migrations,
RPC et appelants.

| Lot | Contenu | Dépendances |
|---|---|---|
| E0 — contrats et états | Classification, compatibilité, provenance des compléments, états et messages d’impact | Décision présente |
| E1 — modèle serveur | Préparation liée à la base, empreinte, révision, idempotence, RLS et audit | E0, revue DB |
| E2 — application atomique | Création de révision interne et rattachement à la même base | E1 |
| E3 — contexte compatible | Lecture/écriture des champs additifs pour patients et rencontres | E2 |
| E4 — éditeur | Structure, sections, règles, diagnostic, aperçu et protection des préparations | E2, contrat E3 stabilisé |
| E5 — complétion | Affichage des nouveaux champs dans les fiches existantes, compteur et états « à compléter » | E3, E4 |
| E6 — exports et historique | Dictionnaire, provenance, révisions et distinction absent/non renseigné | E2, E3 |
| E7 — vérification | Tests serveur/RLS, tests web ciblés, fixture multi-dossiers et navigateur réel | E0 à E6 |

Une migration distante, une activation sur des données réelles ou une modification de politique
hors connexion exigent une validation séparée. La présence d’une préparation ou d’une fixture ne
constitue pas une preuve de fonctionnement déployé.

## 12. Décisions à conserver pour la suite

- La base reste l’unité de travail et de gouvernance ; l’utilisateur ne crée pas de base de
  remplacement pour faire évoluer son formulaire.
- Une nouvelle variable est complétable dans les dossiers déjà présents, vide au départ.
- Une nouvelle association diagnostique peut rendre un bloc disponible sans remplir ce bloc.
- L’historique protège les anciennes valeurs ; il ne bloque pas les compléments compatibles.
- Les transformations sémantiques restent explicites et contrôlées.
- Le versionnage technique est automatique et secondaire dans l’interface.
- Le futur parcours de reprise complexe de dossiers, notifications et conversions reste séparé
  du présent lot, conformément au cadrage L57.
