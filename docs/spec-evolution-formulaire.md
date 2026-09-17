# Spécification — évolution fluide du formulaire et complétion des dossiers existants

- Révision : **2026-09-17** (contrat E0 fixé ; E1 à E4 implémentés et contrôlés localement : états,
  révision/empreinte, compatibilité, provenance, application atomique, justification propriétaire,
  purge et éditeur de préparation).
- Statut : **contrat E0 documenté ; E1 à E4 implémentés localement et non déployés, sans preuve
  navigateur ; E5 à E7 à réaliser**.
- Origine : retour d’usage sur le versionnage des jeux de variables. Le responsable d’une base
  ne comprend pas pourquoi une variable ou une règle devient impossible à modifier, et ne doit
  pas avoir à créer un nouveau jeu de variables ni une nouvelle base pour faire évoluer sa
  collecte.
- Périmètre : une base existante, ses patients et ses rencontres, ses variables, ses sections,
  ses règles et ses associations diagnostiques. Les données restent fictives tant que le cadre
  juridique et éthique du projet n’est pas validé.

Cette décision complète UX-14/UX-16, L51 à L56 et le modèle de version décrit dans
[`architecture.md`](architecture.md). Les lots E1 à E3 disposent désormais d’une implémentation
locale additive (migrations, RPC, couche de données et contrôles ciblés), non appliquée à une cible
distante. Les gardes actuelles des versions publiées ou utilisées restent actives pour les autres
parcours. Elle précise le comportement cible qui remplacera l’exposition du versionnage technique
dans le parcours courant ; le code et les migrations observés restent la référence de l’état
présent, documenté au §13.

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

« Préparer l’évolution » signifie uniquement préparer une nouvelle **définition du formulaire**
de la base : par exemple ajouter un champ, le déplacer ou modifier une règle dans une copie de
travail liée à A. Cela ne prépare ni ne modifie les données d’un patient. Tant que le responsable
n’a pas confirmé l’application, le formulaire actif de A reste inchangé ; l’aperçu lit la
préparation sans créer de fiche, de rencontre ou de valeur. Après application, A utilise la
nouvelle définition et les fiches existantes peuvent recevoir les compléments autorisés. B reste
inchangée.

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
| Révision de base | Jeton opaque et monotone de la définition active d’une base ; il ne se confond pas avec `version_number` | Non |
| Révision attendue | Valeur de révision et d’empreinte relue par le client puis exigée par une écriture | Non |
| Empreinte | Hash canonique d’une définition structurelle ou du contenu normalisé d’une préparation | Non |
| État de valeur | État exportable calculé dans le contexte d’une fiche : présente, vide, non applicable ou absence explicitement codée | Indirectement |
| Provenance | Auteur, date, opération, révision de définition et origine d’une définition ou d’une valeur | Historique/export |

Une fiche existante conserve son auteur, ses valeurs, sa provenance et la définition sous laquelle
elles ont été enregistrées. Cela n’empêche pas d’y ajouter une nouvelle valeur compatible. Une
valeur manquante reste manquante jusqu’à une saisie explicite. Une absence structurelle, une valeur
vide et une non-applicabilité sont trois faits différents ; le contrat d’export ne les encode pas
dans une seule cellule vide.

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

- Convertir silencieusement une valeur existante vers un autre type ou une autre unité. Une
  migration sémantique explicite, avec nouvelle variable, aperçu et conservation de l’ancienne,
  est décrite au §5.1 mais reste un parcours distinct de l’évolution additive.
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

**Extension du 2026-09-16 :** la dispense s’applique aux opérations autorisées du propriétaire
sur les patients, rencontres et documents de sa base lorsqu’un motif d’audit est actuellement
exigé : corrections analytiques ou d’identité, changements de statut/curation et suppressions
de fiches ou de pièces jointes. Elle retire uniquement l’obligation de rédiger un motif, sans
accorder de droit supplémentaire sur les données. Une restauration qui n’exige pas aujourd’hui
de motif, comme la restauration de base observée, reste simplement sans motif ; elle n’est pas
transformée en exception implicite. Les contrôles de propriété, droits d’identité, transitions de
statut, concurrence et confirmations des actions destructrices restent applicables. Le journal
conserve la trace réelle des opérations, avec séparation des données d’identité et analytiques ;
aucun motif automatique fictif n’est créé.

Les justifications relatives à l’attribution d’un accès à l’identité à un autre compte et le
motif de suppression de la base elle-même restent hors de cette dispense. La confirmation de
purge est encore un contrôle séparé. Les autres rôles conservent leurs droits et obligations
actuels. L’inventaire E0 couvre les opérations de configuration, patients, rencontres et documents,
leurs appels serveur directs, leurs chemins hors connexion et les opérations explicitement
identifiées sans motif au §7.4.

**Constat local du 2026-09-16 :** dans `BaseSettings.tsx`, le changement de modèle d’observation
ne demande déjà aucun motif ; le motif obligatoire visible dans cet écran concerne la suppression.
La purge de `Trash.tsx` vérifie aujourd’hui le nom exact et ne possède pas encore le challenge à
cinq caractères décrit ci-dessous. Ces constats ne prouvent pas la conformité de tous les
parcours ; ils sont détaillés et bornés par les sources du §13.

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

Le contrat de session de purge est :

1. Une ouverture autorisée obtient du serveur un `challenge_id`, un code d’affichage de cinq
   caractères et une durée d’expiration. Le serveur génère le code avec un générateur
   cryptographiquement sûr, dans un alphabet tel que `ABCDEFGHJKMNPQRSTUVWXYZ23456789` ; le
   code n’est ni dérivé du nom, ni réutilisé entre deux ouvertures.
2. Tant que le même dialogue reste ouvert pour la même base, `challenge_id` et code restent
   stables malgré les rendus et les soumissions répétées. Une réponse perdue se vérifie avec le
   même `operation_id` ; elle ne se rejoue pas avec une nouvelle clé.
3. La fermeture, l’annulation, la réouverture ou le changement de base invalide le challenge et
   en génère un nouveau. Le serveur vérifie à nouveau le propriétaire, l’état de la base et les
   conditions de purge ; le code seul ne donne aucun droit.
4. La confirmation transmet `base_id`, `challenge_id`, le code normalisé et `operation_id`.
   Le serveur compare une représentation protégée du challenge, ne journalise pas le code en
   clair, verrouille la base et renvoie un résultat idempotent. Il ne remplace pas le code par le
   nom de la base envoyé par un client ancien.

Le serveur continue de vérifier les droits et les conditions de purge. Si le contrat existant
vérifie une ressaisie du nom côté serveur, le remplacer par un contrat cohérent avec ce parcours,
sans envoyer discrètement le nom à la place de l’utilisateur pour contourner le contrôle.
Ce changement concerne la suppression définitive ; la mise en corbeille reste une opération
distincte. Les protections de rétention et les éventuels motifs ne sont pas supprimés par ce code.

## 5. Classification des changements

La classification est calculée côté serveur en comparant la définition active et le contenu
normalisé de la préparation. Elle ne dépend ni du libellé saisi dans l’interface ni d’un choix du
navigateur. Une préparation qui contient au moins un changement sémantique est globalement
`semantic`, même si elle contient aussi des ajouts ; elle ne peut pas être appliquée par le
parcours additif. Une préparation exclusivement additive peut passer à `ready`, sous réserve des
règles et droits habituels. Le sous-type `additive_required` signale un effort de complétion mais
ne change pas la compatibilité des anciennes valeurs.

| Changement classé | Classification | Parcours cible | Effet sur les fiches existantes |
|---|---|---|---|
| Ajouter une variable facultative | `additive` | Autorisé dans la préparation | Nouvelle variable vide, renseignable |
| Ajouter une variable obligatoire | `additive_required` | Autorisé avec avertissement et compteur « à compléter » | Aucune invalidation silencieuse ; la fiche peut être complétée |
| Ajouter une section ou sous-section | `additive` | Autorisé | Présentation disponible selon le bloc et ses règles |
| Renommer un libellé sans changer la clé, le type, le scope ni l’applicabilité | `additive` / `presentation` | Autorisé | Valeurs conservées ; la présentation suit la définition active |
| Déplacer une variable en conservant clé, type, scope, `encounter_types` et applicabilité | `additive` / `presentation` | Autorisé | Valeurs conservées ; seul l’ordre ou le regroupement change |
| Ajouter une option à une liste | `additive` | Autorisé après validation du référentiel | Les anciennes valeurs restent valides |
| Ajouter une association diagnostic → bloc qui n’altère aucune interprétation existante | `additive` | Autorisé avec aperçu des fiches concernées | Bloc disponible si le diagnostic correspond, sans valeur créée |
| Modifier une clé interne, un type ou une unité | `semantic` | Refus dans le parcours additif ; duplication et migration explicite possibles | L’ancienne variable et ses valeurs restent intactes |
| Changer un scope, des types de rencontre ou une applicabilité | `semantic` | Refus dans le parcours additif ; nouvelle variable et migration explicite possibles | La portée historique ne change pas |
| Renommer ou supprimer un code d’option, ou retirer une option déjà utilisée | `semantic` | Refus dans le parcours additif ; mapping explicite vers une nouvelle variable | Les anciennes valeurs et codes restent lisibles |
| Changer le sens d’une règle, d’une formule ou d’une association diagnostique existante | `semantic` | Refus dans le parcours additif ; migration contrôlée si un convertisseur est approuvé | Les anciennes valeurs ne sont pas réinterprétées |
| Retirer une variable du formulaire courant | `semantic` (ou `unsupported` si aucune stratégie d’historique n’est définie) | Refus dans le parcours additif ; décision explicite | La saisie courante peut la masquer plus tard, mais l’historique et l’export la conservent |

Une variable obligatoire ajoutée ne modifie pas automatiquement `validation_status` des fiches.
Le système expose un état séparé, par exemple **À compléter pour le formulaire courant**, afin
de distinguer la qualité historique de la nouvelle obligation. Une fiche déjà `curated` ne devient
pas silencieusement non curatée. Une modification de présentation n’est additive que si les
propriétés qui déterminent la signification et l’applicabilité restent strictement identiques.
L’ajout d’une règle est additif seulement s’il rend un bloc nouvellement éligible sans
réinterpréter une valeur existante ; la modification ou la suppression d’une règle existante est
sémantique.

Le résultat de classification comporte au minimum `classification` (`additive`, `semantic` ou
`unsupported`), `subtype` éventuel, les changements détectés, les fiches potentiellement
concernées et la raison d’un refus. Le serveur ne convertit pas une préparation sémantique en
préparation additive par simple renommage de clé ou de libellé.

### 5.1 Migration sémantique explicite et non destructive

Lorsqu’un changement de type, d’unité, de portée, de code d’option, de formule ou de sens est
nécessaire, l’utilisateur peut demander une **migration sémantique** distincte du parcours
additif. La migration ne modifie jamais la variable d’origine :

1. Le serveur duplique la définition sous une nouvelle clé interne stable, par exemple
   `score_v2`, et conserve un lien `derived_from = score` ainsi que les deux révisions de
   définition.
2. L’utilisateur indique ou confirme le mapping et le convertisseur autorisé. Le convertisseur
   est versionné, déterministe et exécuté côté serveur ; aucun code arbitraire fourni par le
   navigateur n’est exécuté.
3. L’aperçu non écrivant montre le rendu de la nouvelle définition et, lorsque les droits le
   permettent, une comparaison source/cible pour des valeurs fictives ou autorisées. Il calcule
   aussi le nombre de valeurs convertibles, vides, non applicables, non convertibles, hors limites
   et déjà migrées. Les exemples de valeurs ne sont retournés que si l’utilisateur possède le droit
   de les voir ; le compteur agrégé ne révèle pas l’identité.
4. L’application exige une confirmation explicite. Elle crée la nouvelle variable et ajoute les
   valeurs converties dans celle-ci, avec une provenance `origin = semantic_migration`, le
   convertisseur, sa version, la variable source, l’auteur, la date et l’opération. La valeur
   source, son audit et son export historique ne sont jamais écrasés.
5. Une valeur non convertible reste dans l’ancienne variable et reste lisible. La nouvelle
   variable reste vide pour cette fiche, avec un résultat de migration `not_convertible` ; si elle
   est obligatoire, la fiche conserve un état séparé « à compléter ». Aucune conversion partielle
   ne doit supprimer ou remplacer une donnée source.
6. La création de la révision, du lien entre variables, du journal de migration et des nouvelles
   valeurs validées est atomique. En cas d’échec technique ou de conflit de révision, aucune
   modification de structure ni de valeur nouvelle n’est conservée.

Appeler `apply` sur une préparation `semantic` reste interdit et retourne
`FORM_SEMANTIC_MIGRATION_REQUIRED`. Le parcours dédié peut proposer `preview_migration` puis
`apply_migration`, avec sa propre clé d’opération et sa propre vérification de révision. L’absence
d’un convertisseur sûr, d’un mapping complet ou d’une validation de la nouvelle variable bloque
l’application mais ne supprime pas la préparation ni la donnée source.

## 6. Conservation des données et des versions

Le versionnage technique est conservé, mais il cesse d’être le mécanisme que l’utilisateur doit
manipuler.

1. Chaque patient et chaque rencontre conserve la révision de définition de ses valeurs
   existantes. Une seule révision portée par la ligne de fiche ne suffit pas à décrire un
   complément ajouté après plusieurs évolutions : le contexte de chaque définition et de chaque
   valeur reste consultable.
2. Une évolution additive ajoute des définitions compatibles à la vue du formulaire de la base.
   Une clé absente peut être présentée comme vide dans la projection de saisie, mais le contexte
   typé et l’export indiquent s’il s’agit d’une variable nouvellement définie, d’une variable vide
   ou d’une non-applicabilité ; aucune valeur par défaut n’est inventée.
3. Une écriture de complément est un patch contrôlé : elle conserve les clés historiques et
   ajoute uniquement les champs autorisés par la nouvelle définition. Le serveur valide
   l’ensemble réellement envoyé et exige la révision attendue de la fiche.
4. Les changements de type, de clé, d’unité, de portée, d’applicabilité ou de sens utilisent une
   migration explicite, un nouveau champ ou un nouveau parcours approuvé ; ils ne sont pas déduits
   du seul libellé.
5. Les exports indiquent le contexte demandé, la définition applicable et l’état de valeur de
   chaque colonne. Ils distinguent notamment « variable non définie à la révision de la fiche »,
   « variable définie mais vide » et « variable définie mais non applicable ».
6. Le dictionnaire et l’audit conservent l’auteur, la date, l’opération, la préparation appliquée,
   la définition précédente et la provenance des compléments. Aucun pointeur vivant vers une copie
   source n’est utilisé.

### 6.1 Deux bases qui utilisent le même jeu de variables

Le jeu ou la version source peut être commun à plusieurs bases, ou deux bases peuvent seulement
avoir des définitions identiques. Dans les deux cas, une application est toujours liée à une base
et à sa révision attendue : **une évolution de A ne modifie jamais B implicitement**.

Exemple : A et B utilisent la définition `V` et A ajoute `date_debut_symptomes`. L’application
atomique crée une révision dérivée propre à A, par exemple `V_A`, rattache uniquement A à `V_A` et
enregistre la provenance `V → V_A`. B reste rattachée à `V` avec ses anciennes règles, champs et
droits ; elle ne reçoit la variable que si une action explicite et autorisée est engagée pour B.
Une version source publiée ou utilisée n’est jamais modifiée en place pour satisfaire A.

Le propriétaire de A peut utiliser une source partagée sans avoir le droit de modifier cette
source. Il prépare alors une dérivation propre à A, sous le droit de gérer le formulaire de A.
Cette dérivation n’accorde aucun droit sur B, sur la source partagée, sur l’identité ou sur les
documents. L’empreinte identique de A et B ne remplace pas la liaison serveur à `base_id` et ne
permet pas de rejouer l’opération de A sur B.

La vue compatible doit être calculée côté serveur ou à partir d’un contexte signé et contrôlé.
Le navigateur ne peut pas décider seul qu’une variable est additive, qu’une fiche est compatible
ou qu’une valeur historique peut être convertie.

## 7. Contrat partagé E0 (cible normative)

Les noms et formes ci-dessous constituent le contrat fonctionnel à respecter par E1 à E7. Ils
décrivent les invariants et les résultats attendus, pas une permission d’ajouter des RPC sans
revue de sécurité. La forme physique (tables, colonnes, RPC ou service) sera arrêtée en E1 sans
changer ce contrat. Le contrat d’une préparation de formulaire reste distinct du brouillon
clinique actuel, même si certains mécanismes de sécurité sont réutilisés.

### 7.1 Préparation de formulaire

Une préparation est liée à une base, à son propriétaire et à la révision source observée. Elle
porte un état borné : `active`, `ready`, `applied`, `discarded`, `conflict` ou `expired`.

`Aucune modification` n’est pas une préparation persistée. `local`, `saved` et `error` sont des
états d’affichage ou de transport éventuels du client, jamais des états d’autorisation serveur.
Les transitions persistées sont les suivantes :

| État | Signification et transitions autorisées |
|---|---|
| `active` | Préparation modifiable, ouverte ou sauvegardée ; une modification qui invalide un aperçu revient ici. |
| `ready` | Aperçu serveur réussi et contrôles passés ; une préparation additive est prête pour `apply`, une préparation sémantique est prête uniquement pour `apply_migration` avec son convertisseur approuvé. |
| `applied` | Application atomique réussie ; état terminal avec reçu et révision produite. |
| `discarded` | Abandon explicite sans écriture clinique ni changement de formulaire ; état terminal. |
| `conflict` | Révision, empreinte ou opération devenue incompatible ; les entrées locales sont conservées et aucune application n’est permise avant une reprise explicite. |
| `expired` | Durée de vie dépassée ; lecture limitée à l’historique et nouvelle préparation nécessaire. |

Une préparation `active` peut devenir `ready`, puis `applied`, ou être abandonnée/expirer. Une
préparation `ready` peut revenir à `active` si son contenu change. Un conflit ne déclenche jamais
une fusion automatique : une reprise explicite peut créer un nouvel état `active` en conservant
les choix locaux et le contexte relu. Les états `applied`, `discarded` et `expired` sont
immutables.

### 7.1.1 Révision, empreintes et liaison de base

Le contexte retourné à l’ouverture et la demande d’écriture portent au minimum :

| Champ | Contrat |
|---|---|
| `base_id` | Liaison obligatoire, vérifiée côté serveur pour chaque opération. |
| `preparation_id` | Identifiant de la préparation ; il ne peut pas être utilisé sur une autre base ou par un autre propriétaire sans droit. |
| `created_by` / `owner_id` | Acteur qui a ouvert la préparation et propriétaire serveur de la base ; ces identités ne sont jamais acceptées depuis une valeur déclarée par le client. |
| `source_revision` / `source_fingerprint` | Valeurs capturées par le serveur à l’ouverture ; elles sont renvoyées comme contexte et recopiées dans les champs `expected_*` exigés par les mutations. |
| `expected_revision` | Jeton opaque, monotone et propre à la définition active de la base au moment de la lecture. Ce n’est pas `template_version.version_number`. |
| `expected_fingerprint` | Empreinte canonique de la définition structurelle observée ; elle doit correspondre à la révision attendue. |
| `content_fingerprint` | Empreinte canonique du contenu normalisé de la préparation, conservée avec la clé d’opération pour détecter un rejeu différent. |
| `operation_id` | Clé d’idempotence fournie par l’appelant pour chaque mutation ; même clé et même contenu rendent le même reçu, même clé et contenu différent produisent un conflit. |
| `classification` / `state` | Résultat serveur de la classification et état borné ci-dessus. |
| `created_at`, `updated_at`, `expires_at` | Horodatage serveur et durée de vie contrôlée ; jamais une date fournie par le navigateur pour contourner l’expiration. |

L’empreinte de définition est calculée sur une représentation canonique, ordonnée et normalisée
(sections, hiérarchie, groupes communs, champs, clés et attributs, options/codes, règles,
formules, configuration diagnostique, références de release et provenance structurelle). Elle ne
contient ni identité, ni valeur clinique, ni document brut. Les identifiants techniques générés
par une copie ne doivent pas rendre deux structures identiques artificiellement différentes, mais
la liaison `base_id`, la révision attendue et les droits restent vérifiés séparément. Une empreinte
ne constitue ni une autorisation ni une preuve que deux bases ont le même propriétaire.

`expected_revision` et `expected_fingerprint` sont exigés par les opérations qui sauvegardent,
prévisualisent, appliquent ou abandonnent une préparation lorsque la base a pu changer. Le serveur
retourne le contexte courant dans un conflit, sans données non autorisées. L’application ne
remplace jamais silencieusement une révision périmée.

### 7.1.2 Interfaces et brouillons existants

Le contrat partagé expose les opérations conceptuelles `open_or_resume`, `read`, `save`, `preview`,
`preview_migration`, `apply`, `apply_migration` et `discard`. Chaque réponse retourne l’état réel,
la révision/empreinte courante, le résultat de classification et un reçu éventuel. `preview` et
`preview_migration` ne créent ni fiche, ni valeur, ni révision active ; `apply` et
`apply_migration` sont les seules transitions qui rattachent une nouvelle définition à la base.

Le `work_draft` actuel est un brouillon clinique : ses types sont
`patient_create`, `patient_update`, `encounter_create` et `encounter_update`, son payload contient
des valeurs et son `commit_work_draft` écrit des lignes cliniques. Il ne peut donc pas être
réutilisé tel quel pour une préparation de structure. E1 peut reprendre ses motifs éprouvés
(révision optimiste, hash de requête, opération idempotente, tombstone, expiration, RLS et codes
`DRAFT_*`), mais doit isoler le type/payload et le chemin d’application de formulaire ; jamais une
préparation E0 ne doit atteindre `commit_work_draft` ou contenir une identité, une valeur clinique
ou un document.

Le serveur doit fournir les opérations suivantes, sous RLS et verrou optimiste :

- ouvrir ou reprendre une préparation pour une base ;
- lire le contexte complet (variables, sections, règles, configuration diagnostique, provenance,
  empreinte et révision attendue) ;
- enregistrer un changement de préparation avec une clé d’opération idempotente ;
- prévisualiser l’impact, sans écrire ;
- appliquer la préparation en une transaction ;
- abandonner explicitement une préparation non appliquée ;
- lister l’historique des applications sans exposer de données d’identité non autorisées.

Seule une préparation additive `ready` peut être appliquée par `apply`. Une préparation
`semantic` ou `unsupported` appelée par ce parcours retourne `FORM_SEMANTIC_MIGRATION_REQUIRED`
ou `FORM_CHANGE_UNSUPPORTED` ; elle ne convertit aucune valeur. La préparation sémantique ne peut
passer par `apply_migration` qu’après aperçu, mapping et convertisseur approuvé au §5.1.
L’application atomique doit créer la nouvelle révision technique, recopier les métadonnées et
règles validées, produire les métadonnées de provenance, mettre à jour le formulaire actif de
**la même base A**, et enregistrer l’audit. Une erreur laisse la base et la préparation dans leur
état précédent. Aucun écrit sur les patients, rencontres, identités ou documents n’est implicite.

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

Le contexte de lecture/écriture doit être explicite, y compris après plusieurs évolutions. Pour
chaque patient ou rencontre autorisé, il comprend `record_kind`, `record_id` analytique,
`record_revision`, `base_id`, `active_revision`, `record_definition_revision` et une liste de
champs dont chaque élément contient au minimum `field_key`, `definition_revision`, `scope`,
`applicability`, `value_state` et `provenance`. Les données d’identité et le contenu brut des
documents restent dans leurs parcours autorisés ; l’absence d’accès n’est jamais transformée en
`not_applicable`.

Les états de valeur sont distincts et exportables :

| Métadonnée exportée | Signification |
|---|---|
| `definition_state = not_defined` | La variable n’existait pas dans la définition applicable à la révision de la fiche ; elle ne constituait pas une attente historique. |
| `definition_state = defined` + `value_state = empty` | La variable est définie et applicable dans le contexte demandé, mais aucune valeur n’a été saisie. |
| `definition_state = defined` + `value_state = not_applicable` | La variable existe dans la définition, mais sa portée ou la règle diagnostique ne la rend pas applicable à cette fiche. |
| `definition_state = defined` + `value_state = present` | Une valeur autorisée est présente ; sa provenance est fournie séparément. |
| `definition_state = defined` + `value_state = explicit_missing` | L’utilisateur a choisi un code de valeur manquante autorisé (`non_fait`, `inconnu`, `non_applicable`, `refus` ou `non_documente`) ; `missing_code` est exporté séparément. |

Pour une variable ajoutée après la création d’une fiche, un export courant peut donc porter
`definition_state = not_defined` à la révision historique et `value_state = empty` dans la vue
active si le champ est aujourd’hui applicable. Un champ ancien simplement non renseigné porte
`defined/empty`. Une non-applicabilité structurelle porte `defined/not_applicable` et ne doit pas
être confondue avec le code clinique explicite `missing_code = non_applicable`. L’export ne réduit
aucun de ces cas à une cellule vide sans métadonnée ; une demande historique doit prendre comme
référence une révision ou une date et ne doit jamais inventer une variable absente.

Les écritures de complément sont des patches fusionnés côté serveur. Elles portent
`expected_record_revision`, la révision de définition et une clé d’opération ; elles ne remplacent
pas tout le JSON de la fiche. Les clés historiques absentes de l’écran sont conservées, et un
conflit de fiche conserve les inputs locaux au lieu de choisir silencieusement une version.

La provenance minimale d’un complément est `origin` (`initial`, `completion`, `correction`,
`import` ou `offline_replay`), `captured_by`, `captured_at`, `definition_revision` et
`operation_id`. Lorsque la valeur provient d’un document, la référence au document reste limitée
au contexte autorisé de lecture des documents bruts. Les changements successifs restent dans
l’audit ; la nouvelle valeur ne réécrit pas l’origine historique.

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

Ajouter une nouvelle association vers un bloc existant est `additive` seulement si l’association
est représentée par le modèle `validation_rule` existant et si elle ne retire, ne recode et ne
réévalue aucune valeur déjà enregistrée. Les règles doivent respecter le pilote diagnostique, le
scope, la release et les contraintes de bloc saisissable déjà imposées par L51/L52/L55. Changer ou
supprimer une association existante, ou modifier une règle de manière à changer l’interprétation
d’une fiche déjà renseignée, est `semantic`.

### 7.4 Inventaire des motifs de justification actuels

Cet inventaire sépare le motif d’audit d’une correction des **raisons de valeur manquante** d’une
variable ou du message expliquant qu’une règle est invalide. Il décrit les contrats observés dans
les appelants et les migrations au 2026-09-16. « Non identifié » signifie qu’aucun champ ou
paramètre de motif n’a été trouvé dans le parcours inspecté ; cela ne crée pas une exigence
nouvelle pour l’opération.

| Domaine et opération | Exigence observée aujourd’hui | Règle E0 pour le propriétaire de la base |
|---|---|---|
| Configuration du formulaire : sections, champs, règles, ordre, publication/archivage, duplication et création de version | Les appels `templates.ts` et les RPC d’administration de version inspectés n’exposent pas de `p_reason` | Dispense de texte pour l’opération autorisée ; classification, droits, verrouillage et audit restent obligatoires. |
| Configuration de la base : modèle d’observation, rattachement de version, cible d’inclusion et réglages associés | `setObservationModel`, `setTemplateVersion` et `set_base_inclusion_target` n’exigent pas de motif textuel identifié | Aucun champ de motif à ajouter pour cette seule raison ; les gardes existantes et la révision attendue restent applicables. |
| Gestion des accès ordinaires : invitation, révocation, permissions | Aucun motif textuel identifié dans les repositories/RPC inspectés | La dispense n’ajoute ni ne retire un droit d’accès ; l’autorisation de gérer les accès reste contrôlée séparément. |
| Évolution de formulaire E0 | Aucun contrat persistant correspondant n’existe encore | Le propriétaire autorisé n’a pas à rédiger de justification ; l’empreinte, la classification, l’audit et l’application atomique restent requis. |
| Patient : correction des données analytiques (`update_patient`) | `EditPatient.tsx`, `patients.ts` et le RPC transmettent `p_reason`; le formulaire le rend obligatoire | Le propriétaire peut omettre le texte après vérification serveur de sa propriété et de `can_edit_structured_data`; aucun droit supplémentaire. |
| Patient : correction d’identité (`update_patient_identity`) | `EditPatientIdentity.tsx`, `patients.ts` et le RPC transmettent `p_reason`; le formulaire le rend obligatoire | Même dispense limitée pour l’opération d’écriture d’identité déjà autorisée ; elle ne donne pas `can_view_identity` ni ne change l’audit de lecture. |
| Patient : mise en corbeille (`soft_delete_patient`) | `DeleteWithReason.tsx`, `patients.ts` et `20260616091300_soft_delete.sql` exigent un motif | Le propriétaire peut omettre le texte pour cette suppression autorisée ; confirmation, droit, verrouillage, audit et conséquences restent séparés. |
| Patient : création, finalisation et import inspectés | Aucun motif de justification textuel identifié dans les appels de création/finalisation/import | Ne pas inventer de champ ; les contrôles d’identité, validation, provenance et idempotence restent inchangés. |
| Rencontre : correction (`update_encounter`) | `EditEncounter.tsx`, `patients.ts` et l’optimistic lock transmettent `p_reason` | Dispense propriétaire selon le même allowlist ; `expected_updated_at`, validation et conflit restent obligatoires. |
| Rencontre : rejeu de correction hors connexion | L’outbox porte un `reason` requis et `replay_encounter_update` l’intègre à son hash et à son audit | Un nouveau rejeu propriétaire peut représenter l’absence selon le contrat serveur ; les opérations déjà en file gardent leur motif et leur clé, sans suppression ni invention. |
| Brouillon clinique de correction et son commit | `work_draft`/`WorkDraftPayload` portent un `reason` pour les corrections ; le commit écrit ensuite dans le chemin clinique | L’exception éventuelle porte sur l’opération clinique autorisée, jamais sur le stockage de préparation de formulaire ; les brouillons déjà ouverts et leur clé restent compatibles. |
| Rencontre : mise en corbeille (`soft_delete_encounter`) | `DeleteWithReason.tsx`, `patients.ts` et `soft_delete_encounter` exigent un motif | Dispense propriétaire limitée à cette action autorisée ; statut, accès, concurrence et audit persistent. |
| Rencontre : création inspectée | Aucun motif de justification textuel identifié dans `create_encounter` | Ne pas ajouter une exigence par effet de bord. |
| Document : suppression d’une pièce jointe clinique (`soft_delete_attachment`) | `PatientDetail.tsx`, `attachments.ts` et `soft_delete_attachment` exigent un motif | Dispense propriétaire si le droit de supprimer cette pièce existe déjà ; elle n’accorde pas `can_view_raw_documents` et ne contourne pas les contrôles de stockage. |
| Document : suppression d’une demande de curation, avec ou sans suppression du patient | Le formulaire et `curation.ts` exigent un motif ; le SQL accepte actuellement `null` et retombe sur `Demande supprimee` | Le propriétaire autorisé est dispensé du texte ; E1 doit supprimer le faux motif de repli et auditer `owner_exempt`, sans autoriser un autre rôle. La suppression du patient reste une décision de portée distincte. |
| Document brut : ajout/upload, inspection, finalisation, lecture signée | Aucun motif de justification textuel identifié dans les appelants inspectés ; la lecture signée exige toutefois les droits et l’audit de lecture | Ne pas confondre absence de motif avec absence de permission. Une future suppression de document brut devra conserver son contrat de sécurité et être ajoutée à l’allowlist avant dispense. |
| Base : mise en corbeille (`soft_delete_base`) | `BaseSettings.tsx`, `bases.ts` et `soft_delete_base` utilisent un motif ; le SQL accepte actuellement un défaut `Base supprimee` | **Hors dispense** : la suppression de la base elle-même conserve une justification textuelle distincte, en plus des droits propriétaire. Le repli textuel est un point E1 à traiter, pas une justification fournie par le propriétaire. |
| Base : restauration de la corbeille | `restoreDeletedBase` n’exige pas de motif textuel identifié | Rester sans motif ; restaurer ne confère aucun droit nouveau et reste soumis au propriétaire/serveur. |
| Base : purge définitive | Le parcours actuel vérifie le nom exact dans l’UI et transmet une clé d’opération à l’Edge ; aucun motif de correction ne remplace cette confirmation | Contrat séparé du §4.6 : code à cinq caractères, vérification serveur, rétention et idempotence. Le code n’est ni une justification ni une authentification, et ne dispense pas du motif de mise en corbeille. |
| Accès à l’identité d’un compte de mission | `provision_mission_access` exige `p_identity_justification` lorsque `can_view_identity` est accordé | **Jamais dispensé** par le statut de propriétaire : l’attribution d’un accès à l’identité reste une justification dédiée. Les droits `can_view_identity`, `can_write_identity` et `can_manage_access` sont séparés. |

La dispense est une propriété de l’acteur et de l’opération, pas une permission générale. Pour
chaque action allowlistée, le serveur vérifie d’abord `is_base_owner(base_id)` puis les mêmes
droits de domaine, états, révisions, concurrence et confirmations que pour les autres comptes.
Il accepte une justification absente uniquement dans ce cas et écrit dans l’audit un statut
structuré tel que `justification_status = owner_exempt`, avec acteur, date, base, cible, action et
changements. Il n’envoie pas un texte factice et ne prend pas le nom de la base comme motif.

Un collaborateur, un curateur ou un compte de mission conserve l’exigence de motif lorsqu’elle
existe aujourd’hui. Un appel RPC forgé ne peut pas obtenir la dispense en déclarant un rôle de
propriétaire. L’accès à l’identité, l’écriture d’identité, l’accès aux documents, l’export et la
suppression de la base restent des contrôles indépendants ; la dispense ne les élargit jamais.

### 7.5 Erreurs structurées et résultats sûrs

Toute opération E0 à E7 retourne, en succès comme en erreur, un contrat borné. Une erreur a au
minimum cette forme :

```json
{
  "code": "FORM_PREPARATION_CONFLICT",
  "message": "La définition de la base a changé depuis l’ouverture de la préparation.",
  "retryable": false,
  "operation_id": "op-fictif-001",
  "details": {
    "kind": "stale_revision",
    "expected_revision": "rev-12",
    "expected_fingerprint": "sha256:fictif-attendu",
    "current_revision": "rev-13",
    "current_fingerprint": "sha256:fictif-courant",
    "changed_scopes": ["fields", "rules"]
  }
}
```

`code` est stable et exploitable par un client ; `message` est localisable et ne contient pas de
SQL, de stack trace, de secret, d’identité ou de valeur clinique ; `details` est borné à ce qui est
nécessaire pour agir sans divulguer les données. `retryable` signifie qu’un nouvel envoi est
possible avec la même intention et, pour une mutation idempotente, la même `operation_id`. Une
réponse réseau inconnue ne justifie jamais une nouvelle clé avant une vérification du reçu.

Les codes cibles sont :

| Code | Cas et action attendue |
|---|---|
| `FORM_PREPARATION_FORBIDDEN` | Base, acteur ou opération non autorisé ; ne pas révéler le contexte caché. |
| `FORM_PREPARATION_NOT_FOUND` | Préparation inconnue ou non visible. |
| `FORM_PREPARATION_INVALID` | Payload ou empreinte de contenu invalide ; conserver les entrées locales. |
| `FORM_PREPARATION_CLOSED` / `FORM_PREPARATION_EXPIRED` | Préparation terminale ou expirée ; ouvrir une nouvelle préparation. |
| `FORM_PREPARATION_CONFLICT` | Révision/empreinte de base périmée ; relire et comparer explicitement. |
| `FORM_PREPARATION_OPERATION_CONFLICT` | Même clé d’opération avec un contenu différent ; ne pas appliquer la seconde intention. |
| `FORM_SEMANTIC_MIGRATION_REQUIRED` | Changement sémantique détecté ; conserver la préparation, refuser l’application additive. |
| `FORM_MIGRATION_CONVERTER_UNAVAILABLE` / `FORM_MIGRATION_MAPPING_INVALID` | Migration explicite impossible ou mapping incomplet ; ne rien convertir et conserver la préparation. |
| `FORM_MIGRATION_CONFLICT` | Révision ou résultat de migration concurrent ; conserver la variable source et les entrées locales. |
| `FORM_CHANGE_UNSUPPORTED` | Changement hors contrat, par exemple suppression sans stratégie historique. |
| `FORM_RULE_INVALID` | Règle ou association incompatible avec les validations existantes. |
| `FORM_CONTEXT_CHANGED` | Contexte de fiche ou de définition modifié depuis la lecture. |
| `FORM_FIELD_UNKNOWN` / `FORM_SCOPE_INCOMPATIBLE` / `FORM_VALUE_CONVERSION_REQUIRED` | Écriture de complément non compatible ; ne pas supprimer les anciennes clés. |
| `FORM_RECORD_FORBIDDEN` / `FORM_RECORD_CONFLICT` | Fiche inaccessible ou révision de fiche concurrente. |
| `JUSTIFICATION_REQUIRED` | Motif encore requis pour un acteur ou une opération hors allowlist propriétaire. |
| `PURGE_FORBIDDEN` / `PURGE_CODE_REQUIRED` / `PURGE_CODE_INVALID` | Purge interdite, code absent ou code incorrect ; ne pas révéler le code attendu. |
| `PURGE_CHALLENGE_EXPIRED` | Challenge fermé ou expiré ; rouvrir le dialogue et obtenir un nouveau code. |
| `PURGE_CONFLICT` / `PURGE_OPERATION_CONFLICT` | État de base concurrent ou clé réutilisée avec une intention différente. |
| `PURGE_ALREADY_COMPLETED` | Résultat idempotent d’une purge déjà confirmée ; ne pas relancer une suppression. |

Les codes existants `DRAFT_*` restent ceux des brouillons cliniques. Les erreurs actuelles
`CONFLIT_VERSION`, `CLIENT_UPDATE_REQUIRED` et `OFFLINE_OPERATION_*` peuvent être traduites par
un adaptateur vers cette enveloppe pour les parcours concernés, sans exposer leur message interne
et sans faire croire que le contrat de préparation existe déjà.

Exemples complémentaires :

```json
{
  "code": "FORM_SEMANTIC_MIGRATION_REQUIRED",
  "message": "Cette modification peut changer le sens de données existantes.",
  "retryable": false,
  "operation_id": "op-fictif-002",
  "details": {
    "classification": "semantic",
    "changes": [{"field_key": "score", "kind": "type_changed"}],
    "preparation_preserved": true
  }
}
```

```json
{
  "code": "PURGE_CODE_INVALID",
  "message": "Le code de confirmation ne correspond pas.",
  "retryable": false,
  "operation_id": "purge-op-fictif-001",
  "details": {"challenge_id": "purge-challenge-fictif-001", "length": 5}
}
```

Le résultat d’une prévisualisation additive peut au contraire être :

```json
{
  "state": "ready",
  "classification": "additive_required",
  "expected_revision": "rev-12",
  "expected_fingerprint": "sha256:fictif-attendu",
  "impact": {"added_fields": 1, "potentially_completable_records": 100}
}
```

Le nombre d’impact est une métadonnée agrégée soumise aux droits ; il ne vaut pas divulgation de
l’identité des dossiers et ne constitue pas une preuve d’application.

## 8. Interface utilisateur cible

Cette section reste une cible de parcours et ne simule ni ne livre le comportement. E0 ne modifie
aucun composant, ne remplace pas les contrôles actuels et ne considère pas une maquette, un test
isolé ou la présence d’un bouton comme une preuve serveur.

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
7. Une modification de type, scope, clé, option ou formule est classée sémantique ; le parcours
   additif la refuse, tandis qu’une migration explicite peut dupliquer la variable, prévisualiser
   les conversions et ajouter les résultats validés sans écraser aucune valeur historique. Les
   valeurs non convertibles restent dans la variable source et sont signalées.
8. Deux responsables appliquant une préparation concurrente obtiennent un conflit explicite et
   aucune perte d’inputs.
9. Une réponse réseau perdue puis rejouée n’applique la préparation qu’une fois.
10. L’aperçu, l’ouverture d’une préparation et son abandon n’écrivent aucune donnée clinique.
11. Les exports et le dictionnaire distinguent une variable non définie à la révision de la fiche,
    une variable définie mais vide, une variable non applicable et une absence clinique explicitement
    codée ; aucune de ces situations n’est réduite à une cellule vide sans métadonnée.
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
Les lots **E0 à E3 sont documentés et contrôlés localement** ; E4 à E7 restent à réaliser. Le tableau
ci-dessous en donne la synthèse.

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
- Les transformations sémantiques restent explicites et contrôlées : une nouvelle variable peut
  être créée avec un convertisseur approuvé et un aperçu, sans jamais écraser la variable source.
- Le versionnage technique est automatique et secondaire dans l’interface.
- Le futur parcours de reprise complexe de dossiers, notifications et conversions reste séparé
  du présent lot, conformément au cadrage L57.

## 13. Preuves E0, état observé et points bloquants pour E1

### 13.1 Sources réellement inspectées

La vérification du 2026-09-16 a porté sur les instructions et documents demandés, puis sur les
contrats exécutés du dépôt :

| Surface | Sources inspectées | Faits établis pour E0 |
|---|---|---|
| Versions, bases et droits | `supabase/migrations/20260616090200_tables.sql`, `20260616090700_template_admin.sql`, `20260616094800_base_template_version_same_template.sql`, `20260616095600_base_template_version_rpc_guard.sql`, `20260616096000_soft_delete_base.sql`, `src/data/bases.ts`, `src/data/templates.ts` | `base.current_template_version_id`, versions publiées protégées, copie de modèle à la création de base, droits propriétaire/identité distincts ; aucun contrat E0 de préparation existant. |
| Patients, rencontres et corrections | `src/data/patients.ts`, `src/screens/member/EditPatient.tsx`, `EditPatientIdentity.tsx`, `EditEncounter.tsx`, `PatientDetail.tsx`, `supabase/migrations/20260616091300_soft_delete.sql`, `20260616092200_encounter_optimistic_lock.sql`, `20260712000400_patient_update_compatibility.sql` | Motifs actuellement transmis pour les corrections et mises en corbeille ; révisions/erreurs de concurrence existantes à préserver. |
| Hors connexion et brouillons | `src/data/offline.ts`, `src/data/workDrafts.ts`, `src/data/workDraftSession.ts`, `src/data/localWorkDrafts.ts`, `supabase/migrations/20260713195422_offline_encounter_replay_idempotency.sql`, `20260910233212_ux_work_drafts.sql` | L’outbox et `work_draft` portent des écritures cliniques ; `work_draft` ne doit pas devenir une préparation de structure. |
| Règles et diagnostic | `supabase/migrations/20260905160000_block_visibility.sql`, `20260906061539_diagnosis_configuration.sql`, `20260911210000_ux_rule_batch.sql`, `20260912090000_ux_common_group.sql`, `src/data/templates.ts` | Les associations diagnostiques restent des `validation_rule` ; des empreintes et opérations existent pour certaines surfaces, mais pas pour E0. |
| Documents et stockage | `src/data/attachments.ts`, `src/data/curation.ts`, `src/screens/member/CurationBoard.tsx`, `CurationTask.tsx`, `supabase/storage.sql`, fonctions Edge d’upload/inspection/lecture signée | Suppression de pièce jointe et suppression de demande ont un motif ; upload, inspection, finalisation et lecture signée ont des contrats de permission/audit distincts. |
| Exports | `supabase/functions/generate-export/exportContract.ts`, `supabase/functions/generate-export/handler.ts`, `src/data/signedRead.ts` | Les profils, identifiants et codes de valeur manquante existent ; le format actuel ne porte pas encore de triplet explicite `not_defined`/`empty`/`not_applicable` par valeur. |
| Motifs et purge | `src/screens/member/DeleteWithReason.tsx`, `BaseSettings.tsx`, `Trash.tsx`, `src/data/bases.ts`, `src/data/mission.ts`, `supabase/migrations/20260729104500_mission_accounts.sql` | Dispense propriétaire à appliquer seulement aux actions allowlistées ; accès à l’identité, suppression de base et purge restent séparés. La purge actuelle ressaisit le nom et transmet une clé d’opération, sans challenge à cinq caractères. |

Ces constats décrivent l’état observé au cadrage E0 et ne constituent pas, à eux seuls, une preuve
de fonctionnalité déployée. Le snapshot `docs/schema-etat-final.md` a depuis été régénéré pour les
migrations locales E1 à E3 ; les preuves ciblées sont suivies dans `lots-evolution-formulaire.md`.

### 13.2 Bloqueurs techniques à fermer avant E1

Le besoin produit est décidé par les §§5 à 7. Les éléments ci-dessous ne sont donc pas six
questions à renvoyer à l’utilisateur : ce sont les décisions déjà prises et les tâches techniques
qu’E1 doit réaliser avant d’écrire une migration sûre.

| Décision E0 | Réalisation attendue en E1 |
|---|---|
| Une table dédiée aux préparations de formulaire | Créer le stockage, sa RLS, son audit et un chemin d’application qui ne peut pas appeler `commit_work_draft`. |
| Une révision propre à chaque base et une empreinte canonique | Choisir les colonnes exactes, l’algorithme de canonisation, l’incrément atomique et le contrôle qui garantit qu’une évolution de A ne change jamais B. |
| États de valeur et provenance explicites | Implémenter le calcul/stockage de `not_defined`, `empty`, `not_applicable`, `present` et `explicit_missing`, avec provenance par définition et par valeur, sans fuite d’identité. |
| Compatibilité des clients et de l’hors-connexion | Conserver les motifs et clés déjà en file, traduire les erreurs existantes dans l’enveloppe E0 et remplacer les replis textuels par un statut structuré lorsque l’absence de motif est autorisée. |
| Challenge de purge à cinq caractères | Implémenter génération, durée de vie, invalidation à la réouverture, vérification serveur, RLS, audit et idempotence de l’Edge. |
| Migration sémantique non destructive | Implémenter un duplicata à nouvelle clé, un mapping et un convertisseur serveur approuvés, un aperçu sans écriture, puis une application explicite qui ajoute les valeurs converties sans toucher à la variable source. |

Le dernier point fixe aussi le comportement des valeurs non convertibles : elles restent dans la
variable source, la nouvelle variable reste vide pour la fiche concernée et le résultat
`not_convertible` est exposé. E1/E2 doivent définir le registre des convertisseurs, les mappings,
les contrôles de révision et l’atomicité ; ils ne doivent pas inventer de conversion heuristique ou
silencieuse.

E1 peut donc démarrer avec ce contrat. Les « points à fermer » désignent la traduction de ces
décisions en schéma, RPC, RLS et tests, pas une nouvelle fonctionnalité à simuler dans l’interface.

### 13.3 Preuves de travail et limites

- `git status --short --branch` a confirmé la branche `codex/spec-evolution-formulaire` et trois
  fichiers PNG non suivis (`.tmp-editor-maquette*.png`) ; ils appartiennent au travail local du
  formulaire papier/éditeur et ont été préservés.
- La vérification finale montre également des modifications locales dans d’autres documents du
  checkout et le fichier non suivi `docs/etat-actuel-2026-09-16.md`. Ils n’ont été ni modifiés ni
  réinitialisés dans E0 ; les documents `spec-formulaire-papier.md` et `lots-formulaire-papier.md`
  n’ont pas été touchés.
- `git diff --stat` et `git diff --cached --stat` étaient vides avant cette mise à jour ; aucune
  modification suivie ou indexée étrangère n’a été écrasée.
- Aucun code applicatif, migration, test, snapshot ou environnement distant n’a été modifié.
- Aucun test, lint, typecheck, build, navigateur réel, base jetable ou contrôle cloud n’a été
  exécuté dans E0 : la preuve obtenue est documentaire et issue de l’inspection en lecture du
  code/migrations. Le contrôle local des cinq documents de référence et de leurs ancres a retourné
  `LINK_CHECK_OK files=5 paths_and_anchors=true`, et `git diff --check` n’a signalé aucune erreur
  de contenu (Git a seulement affiché ses avertissements habituels de conversion LF/CRLF). Ces
  contrôles documentaires ne sont pas une preuve runtime.
