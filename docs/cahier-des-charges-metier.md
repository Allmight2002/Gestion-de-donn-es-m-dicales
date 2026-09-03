# Cahier des charges — Métier (fonctionnel)
### Registre clinique pseudonymisé — MedData / registre-clinique v3.0

> Ce document décrit **ce que le système doit faire** et **pourquoi**, tel que réellement
> construit et déployé. Il sert de spécification de référence et de base aux audits. Le pendant
> technique (comment c'est réalisé) est dans [cahier-des-charges-technique.md](cahier-des-charges-technique.md) ;
> la vue d'ensemble développeur dans [architecture.md](architecture.md).
>
> Convention : **EF** = exigence fonctionnelle, **RG** = règle de gestion (non négociable sauf
> mention), **HP** = hors périmètre.

---

## 1. Contexte et objectif

MedData est une **plateforme de données de recherche clinique centrée sur le patient**. Elle
permet à des médecins-chercheurs de constituer des **registres structurés** (« bases ») de
patients, avec une ou plusieurs observations selon le modèle de la base, exploitables pour la
recherche, **sans jamais exposer
l'identité des patients** au-delà du strict nécessaire.

- **Objectif** : produire des données analytiques **pseudonymisées, validées et reproductibles**,
  prêtes pour l'analyse, à partir de saisies directes, d'imports de fichiers, ou de documents
  source structurés par un pôle de curation.
- **Pari central** : le **patient** est l'objet central, **pas l'étude**. Selon la base, il porte
  une saisie unique, des rencontres répétées ou des événements indépendants.
- **Statut** : MVP avancé, **déployé** (Supabase cloud + Vercel). **Données entièrement fictives**
  tant qu'un cadre juridique et éthique n'est pas établi.

---

## 2. Principe fondateur : un registre, trois zones cloisonnées

**RG-1.** Toute la sécurité repose sur la séparation de **trois zones**, appliquée **côté base de
données** (et pas seulement dans l'interface) :

| Zone | Contenu | Qui y accède | Exportable ? |
|---|---|---|---|
| **Identité** (restreinte) | Nom, date de naissance exacte, téléphone, adresse, **images cliniques** | Comptes avec permission d'identité uniquement | **Jamais** |
| **Analytique** | Données structurées, **âge calculé** (jamais la date de naissance) | Selon les permissions de la base | Oui (**sans** identité) |
| **Documents bruts** (restreinte) | Documents source dé-identifiés à structurer | Curateur réservé / permission documents | **Jamais** |

**RG-2.** Aucune donnée identifiante ni image n'apparaît jamais dans un export, ni n'est
accessible à un compte sans permission d'identité.

**RG-3.** La **date de naissance exacte ne quitte jamais la zone identité** : seul l'**âge calculé
par le serveur** entre en zone analytique.

**RG-4.** Le **curateur ne voit jamais l'identité** du patient qu'il structure.

**RG-5.** **Données entièrement fictives uniquement.** Aucune donnée réelle.

---

## 3. Utilisateurs et rôles

### 3.1 Rôles globaux (un compte = un rôle global)

| Rôle | Mission | Accès aux données patient |
|---|---|---|
| **Administrateur système** (`system_admin`) | Gère les gabarits globaux et les rôles des comptes | **Aucun** |
| **Médecin** (`medecin`) | Crée et possède des bases, saisit, importe, exporte, soumet à la curation | Ses bases + bases partagées avec lui |
| **Curateur** (`curateur`) | Structure **et finalise** les cas du pool de curation | Documents bruts des cas **qu'il a réservés** ; **jamais l'identité** |
| **Saisisseur** (`saisisseur`) | **Compte de mission** : saisit sur **une seule** base, pour une durée bornée décidée par le médecin | Saisie seule ; **jamais** d'export ni de documents bruts |

**RG-6.** Tout nouveau compte est **médecin** par défaut ; seul un administrateur système peut le
promouvoir curateur. Nul ne peut modifier son propre rôle.

**RG-6bis.** Un compte `saisisseur` n'est **pas** créé par inscription libre : il est géré
exclusivement par le propriétaire de la base depuis l'écran global « Comptes de mission » ou depuis
la base. Le propriétaire choisit un identifiant unique ; le serveur génère le mot de passe et le
conserve chiffré afin que le propriétaire puisse le consulter, masqué par défaut, puis le remettre à
l'étudiant. Il peut le régénérer ou révoquer le compte. L'accès porte une **échéance obligatoire**
(24 mois maximum), prolongeable ou révocable par le propriétaire. Voir
[spec-comptes-mission.md](spec-comptes-mission.md).

> Les anciens rôles `analyste` et `validateur` ont été **supprimés** : le curateur structure ET
> finalise seul (plus d'étape de validation séparée). Le rôle `saisisseur` a été **ajouté** le
> 2026-07-29 (besoin : un thésard saisit pour son directeur).

### 3.2 Partage d'une base entre médecins — 6 permissions granulaires

**EF-1.** Le propriétaire d'une base peut la **partager** avec d'autres médecins via une
**invitation par lien** (jeton à usage unique, montré une seule fois). Il choisit un profil de
départ (`viewer` lecture seule / `editor`) puis ajuste **6 permissions indépendantes** :

`voir l'identité` · `voir les documents bruts` · `créer des données structurées` ·
`éditer les données structurées` · `exporter` · `gérer les accès`.

**RG-7bis.** `créer` et `éditer` sont deux permissions distinctes : un compte de mission crée et
soumet, mais ne peut plus corriger une donnée soumise. La correction reste réservée au médecin,
avec motif obligatoire et journalisation (`field_change_log`).

**RG-7.** Le propriétaire possède toutes les permissions. Un collaborateur n'a que celles qui lui
sont explicitement accordées. Exemple type : un statisticien reçoit `viewer + exporter` → il
exporte des données **sans identité**.

---

## 4. Exigences fonctionnelles par domaine

### 4.1 Comptes et authentification
- **EF-2.** Connexion par e-mail pour les comptes ordinaires ou par identifiant pour les comptes de
  mission, toujours avec mot de passe. La récupération par e-mail ne concerne pas les comptes de
  mission.
- **EF-3.** L'administrateur système attribue les rôles globaux (écran **Admin → Rôles**).
- **HP** : l'auto-inscription en self-service depuis l'app (les comptes sont créés via le back-office
  Supabase ou un script d'administration), cf. §9.

### 4.2 Gabarits (modèles de données cliniques)
- **EF-4.** Un **gabarit** définit les **variables** (champs) d'un registre. Il est **versionné** ;
  une version **publiée devient immuable** (reproductibilité scientifique).
- **EF-5.** Chaque variable porte : libellé, **type** (texte, entier, nombre, date, date-heure,
  booléen, liste, liste multiple, **référentiel**), **portée** (donnée **permanente** du patient /
  donnée de **rencontre**), `requise`, **valeurs autorisées**, **bornes** min/max, unité, **types
  de rencontre** concernés, et les **raisons de valeur manquante** admises, choisies variable par
  variable parmi `non fait`, `inconnu`, `non applicable`, `refus` et `non documenté` (L33).
- **EF-5 bis (texte d'aide, L27).** Une variable porte un **texte d'aide** facultatif qui dit
  *comment* la renseigner. Il s'affiche au formulaire et figure au **dictionnaire d'export** :
  c'est là qu'un relecteur extérieur cherche la définition d'une variable.
- **EF-5 ter (valeur proposée, L28).** Une variable peut porter une **valeur proposée**, qui
  **préremplit** la saisie sans jamais être écrite d'office. Interdit de proposer une valeur pour
  une variable clinique dont le défaut orienterait la réponse.
- **EF-5 quater (plusieurs valeurs, L20 à L25).** Une variable de type **référentiel** peut
  accepter **plusieurs valeurs** : une liste ordonnée de **1 à 50** couples code/libellé, **sans
  code en double**, dont l'ordre vaut **rang** — la première valeur est le diagnostic principal.
  Une liste vide est refusée : l'absence de valeur s'exprime par l'absence de la variable ou par
  une raison de valeur manquante, qui **remplace** la liste. Réservé au type référentiel : les
  listes fermées recopiées dans le gabarit relèvent de `liste multiple`. Spécification :
  [spec-variables-multivaluees.md](spec-variables-multivaluees.md).
- **EF-5 quinquies (sections et affichage conditionnel, L31, L32).** Les variables se rangent en
  **sections** définies par le médecin, réordonnables tant que la version est en brouillon. Une
  **règle de visibilité** peut masquer une variable selon la valeur d'une autre ; la valeur d'un
  champ ainsi masqué est **effacée, mais jamais en silence** — l'utilisateur en est averti
  (décision du 2026-08-14).
- **EF-6.** Des **règles de cohérence** (ex. « si X alors Y requis ») peuvent bloquer une donnée
  incohérente. Elles sont contrôlées (opérateurs en liste blanche).
- **EF-7.** Un gabarit est **global** (géré par l'admin) ou **personnel** (créé et versionné par le
  médecin propriétaire). Le médecin peut **créer la version suivante** de son gabarit personnel.
- **EF-7 bis (aperçu, L29).** Le constructeur offre un **aperçu du formulaire** tel qu'il sera
  saisi, sans écrire de donnée.
- **RG-8.** Une variable **déjà utilisée** par des données ne peut plus voir son **sens** changer
  (clé, type, portée, requise, bornes, valeurs autorisées…) ni être supprimée ; seuls le libellé,
  la section et l'unité restent modifiables. Pour changer le reste : créer une nouvelle version.
- **RG-8 bis (« édition libre » — choix produit assumé).** En revanche, **ajouter une nouvelle
  variable** à une version `draft` reste autorisé **même si la base contient déjà des données** (les
  anciens enregistrements n'ont simplement pas cette variable). C'est un arbitrage **délibéré**
  (souplesse de constitution d'un registre en cours, pour le pilote) **au détriment d'une
  reproductibilité scientifique stricte**. Un audit externe (v10 §4.4) recommande de l'interdire ;
  la décision **du 2026-06-30 est de conserver l'édition libre**. À reconsidérer avant publication
  scientifique (passer alors à : version utilisée = totalement figée, tout changement par nouvelle version).

### 4.3 Bases (registres)
- **EF-8.** Un médecin **crée une base** rattachée à une version publiée de gabarit, lui donne un
  nom, une spécialité et un modèle d'observation : **une seule saisie par participant**,
  **suivi répété** ou **registre d'événements**.
- **RG-8 ter.** Une base existante reste en suivi répété. Le propriétaire peut modifier le modèle
  d'une base vide ; dès la première saisie, la base verrouille ce choix.
- **RG-8 quater.** En saisie unique, aucune rencontre ne peut être créée, importée ou soumise ;
  le formulaire patient regroupe les variables par section et l'éditeur de variables ne propose
  pas de portée rencontre.
- **EF-9.** Tableau de bord listant ses bases et celles partagées avec lui.
- **EF-10.** Vue d'une base : liste **pseudonymisée** des patients (code + variables analytiques),
  pagination, recherche, accès aux fiches.

### 4.4 Patients
- **EF-11.** Création d'un patient : **code patient** (pseudonyme) obligatoire, **identité** (zone
  restreinte, si permission), et **données permanentes** (analytique).
- **EF-12.** À la création, **avertissement de doublon probable** si un patient au même nom + date
  de naissance existe déjà (décision humaine).
- **EF-13.** Fiche patient : identité (si autorisé et **journalisée à chaque consultation**),
  données permanentes, rencontres regroupées par section.
- **EF-14.** Édition des données permanentes (journalisée, re-validée) ; **finalisation** du patient
  (`draft → curated`) quand les données requises sont complètes.
- **RG-9.** La **liste** des patients est **pseudonymisée** : elle n'affiche que le code ; le nom
  complet n'est révélé que sur la **fiche** (consultation tracée).

### 4.5 Rencontres
- **Portée.** Cette section s'applique aux bases de suivi répété et de registre d'événements. Elle
  n'est pas disponible dans une base à saisie unique.
- **EF-15.** Une rencontre est typée : **consultation, hospitalisation, suivi, autre**. Les
  variables requises dépendent du **type** (ex. `date d'admission` requise en hospitalisation
  seulement).
- **EF-16.** Saisie d'une rencontre avec **âge calculé** automatiquement (jamais la date de
  naissance). Statut `draft / complete / curated`.
- **EF-17.** **Correction** d'une rencontre : chaque modification est **journalisée** (ancienne et
  nouvelle valeur, auteur, **motif obligatoire**).
- **RG-10.** Une donnée **finalisée (`curated`) ne peut pas être rétrogradée** directement vers
  `draft`/`complete` ; une réouverture passe par une procédure explicite.
- **RG-11.** Toute ligne `curated` doit être **complète et valide** (bornes, types, requis, clés
  inconnues interdites, règles de cohérence respectées) — vérifié **côté serveur**.

### 4.6 Import de fichiers (CSV / XLSX)
- **EF-18.** Import par fichier : l'utilisateur **associe** chaque colonne à une cible (par index,
  robuste aux en-têtes vides/dupliqués), obtient un **aperçu** (sans écriture), puis **importe**.
- **EF-19.** Statut cible (`draft/complete/curated`) et **mode de conflit** au choix :
  - `fill` (ne remplit que les valeurs absentes), `overwrite` (écrase, **journalisé**),
    `skip` (**ne modifie aucune donnée existante, identité comprise**).
- **EF-20.** **Idempotence** : un même fichier n'est pas importé deux fois (empreinte). Import par
  **lots** au-delà de 300 lignes, avec **progression** et cycle de vie du lot (un lot abandonné ne
  bloque pas ; un lot incomplet ne peut être déclaré terminé).
- **EF-21.** Détection de doublons **dans le fichier** (rejet) et **avertissement** des doublons
  probables vis-à-vis de rencontres **déjà enregistrées** (décision humaine).
- **RG-12.** L'import **ne rétrograde jamais** un patient déjà `curated`. L'identité importée
  exige la permission d'identité (sinon la ligne est rejetée).
- **RG-12 bis (variables de référentiel, L24).** L'import **ne prend en charge aucune variable de
  type référentiel**, à valeur unique comme à plusieurs valeurs : rien ne résout un concept, et le
  serveur refuserait une chaîne là où il attend un couple code/libellé. Ces cibles ne sont jamais
  proposées automatiquement, le choix manuel ne prend pas, et les colonnes écartées pour ce motif
  sont **nommées** à l'étape de correspondance **et** au rapport d'import — distinctement des
  colonnes ignorées ordinaires. Refus **explicite** plutôt qu'échec serveur opaque en fin
  d'import.

### 4.7 Documents cliniques (images, PDF)
- **EF-22.** Ajout d'un document/image à un patient (libellé obligatoire, **dé-identification
  confirmée**). Les images sont **ré-encodées** (suppression des métadonnées EXIF) ; les fichiers
  sont inspectés (refus d'un fichier déguisé).
- **EF-23.** Consultation d'un document : l'accès passe par une **URL signée temporaire générée au
  clic seulement** et **tracée** (l'audit correspond à une vraie tentative de consultation).
- **RG-13.** Documents et images sont en **zone restreinte** : jamais exportés.

### 4.8 Curation (structuration de documents source)
- **EF-24.** Un médecin **soumet un cas** au pool de curation à partir de documents **dé-identifiés**.
  Le cas n'entre dans le pool qu'avec **au moins un document**.
- **EF-25.** Le pool présente aux curateurs des cas désignés par un **code opaque** (jamais le
  patient). Un curateur **réserve** un cas, le **structure**, peut demander une **clarification**
  (aller-retour question/réponse avec le médecin), puis **finalise**.
- **EF-26.** La finalisation écrit les données en `curated` (validées et complètes), ferme la tâche
  et **referme l'accès** aux documents.
- **RG-14.** Le curateur ne voit **que** les métadonnées minimales nécessaires avant réservation,
  et **jamais l'identité**. Le médecin peut supprimer une demande (la demande seule, ou le patient
  **et** la demande).

### 4.9 Cohortes et exports
- **EF-27.** Constitution de **cohortes** (sélection de patients/rencontres) **dynamiques** ou
  **figées**. Seule une cohorte **figée** est exportable (instantané reproductible).
- **EF-27 ter (exporter sans démarche, 2026-08-19).** Le parcours principal est **un bouton** :
  *Analyse › Exporter › Exporter les données*. L'application fige elle-même la population à cet
  instant, sous un nom daté, puis produit le fichier — la reproductibilité est **conservée**, elle
  cesse d'être une démarche à la charge du médecin. La constitution de cohortes reste offerte, à
  côté, pour choisir une population précise ; la case « Inclure uniquement les données vérifiées »
  y devient un **filtre facultatif, décoché par défaut**, et l'avertissement « cohorte non
  exportable en l'état » disparaît (il n'a plus d'objet).
- **EF-28.** Export **CSV / XLSX** d'une cohorte figée, avec **dictionnaire des variables**. Le
  fichier est conservé immuable (empreinte) et **tracé**.
- **RG-15.** L'export **refuse tout champ identifiant** (liste blanche analytique). Un code
  pseudonymisé est exporté, jamais le nom ni la date de naissance.
- **EF-28 ter (ce qui entre dans le fichier, 2026-08-19).** L'export ne dépend plus du **statut de
  validation** : une fiche s'exporte dès lors qu'elle porte ses **champs obligatoires** — une
  réponse « refus / inconnu / non applicable » compte comme renseignée, un champ masqué n'est pas
  réclamé. Les fiches incomplètes sont **écartées et comptées**, jamais bloquantes. Une fiche de la
  cohorte devenue **introuvable** reste, elle, un refus : partiel par décision, jamais par accident.
- **EF-28 quater (une question de moins, 2026-08-19).** La **forme des lignes** découle du **modèle
  d'observation** de la base, verrouillé dès la première saisie : une ligne par participant en
  transversal, une ligne par événement en registre. Le choix (par patient ou par rencontre, avec la
  règle première/dernière) n'est proposé qu'en **suivi longitudinal**. L'écran ne demande plus la
  portée des rencontres : la cohorte figée dit déjà lesquelles en font partie.
- **EF-27 bis (filtrer une liste, L23).** Sur une variable à plusieurs valeurs, la constitution de
  cohorte n'offre que **« contient l'un de »** et **« ne contient aucun de »**. L'égalité est
  retirée de l'interface plutôt que de produire un résultat faux en silence. Un patient portant
  cinq diagnostics compte pour **un patient**.
- **EF-28 bis (exporter une liste, L22 puis L47).** En profil **Export complet**, une variable à
  plusieurs valeurs produit une colonne de **libellés** joints, une colonne de **codes**, un
  **compteur**, une colonne indicatrice `0/1` par code présent, et une **feuille dédiée** sans
  perte — une ligne par valeur, avec son rang. Une raison de valeur manquante remplit la colonne
  principale et laisse le compteur **vide**, jamais `0`, qui signifierait « aucun diagnostic ». En
  profil **Export Analyse**, seules subsistent les **indicatrices** (voir EF-28 quinquies).
- **EF-28 quinquies (Export Analyse, 2026-08-24 — implémenté le 2026-08-28).** Le profil d'export
  proposé par défaut est destiné à une utilisation directe dans Excel, R, SPSS ou Stata. Il produit
  les feuilles `Données`, `Dictionnaire`, `Modalités` et `Métadonnées`, conserve le code stable des
  `select` dans les données, transforme les multiselect en indicatrices binaires initialisées à
  `0` (une modalité non sélectionnée vaut `0`), écrit des dates Excel natives et réserve les
  colonnes techniques, compteurs et feuilles relationnelles au profil **Export complet**. La
  distinction entre `0`, valeur vide et raison de valeur manquante est obligatoire. **Livré par les
  lots L45 à L49** ; le détail est dans
  [`chantiers-export-analyse.md`](chantiers-export-analyse.md). Seul **L50** (concepts
  diagnostiques et terminologie) reste différé.
- **EF-28 sexies (choisir son profil, L45 — 2026-09-01).** L'écran d'export laisse choisir entre
  **Analyse** (présélectionné) et **Complet**. Le profil retenu est inscrit au journal des exports
  et **visible dans le nom du fichier**, pour qu'un fichier reste identifiable hors de
  l'application. Un export réalisé avant l'introduction des profils est présenté comme « Profil
  antérieur », sans qu'un profil lui soit attribué rétroactivement.
- **RG-15 bis (un profil ne relâche jamais une garantie).** Les deux profils partagent le même
  contrôle d'accès, la même liste anti-identité, le même figeage, la même empreinte et la même
  journalisation. Le profil décide de la **forme** du fichier, jamais de ce qu'un utilisateur a le
  droit d'en sortir. Un export **Analyse** dont un multiselect dépasse le seuil d'indicatrices est
  **refusé explicitement** plutôt que tronqué en silence.

### 4.10 Mode hors-ligne (application installable / PWA)
- **EF-29.** Une base peut être rendue **disponible hors-ligne** : un **instantané analytique**
  (jamais l'identité ni les images) est stocké sur l'appareil pour consultation sans réseau.
- **EF-30.** Les **corrections de rencontres** faites hors-ligne sont mises en file et **rejouées**
  à la reconnexion, via les mêmes contrôles serveur, avec **détection de conflit** (« garder ma
  version » / « garder la version serveur » / **« garder les deux »**).
- **EF-30 bis (garder les deux, L25).** Quand deux appareils ont chacun ajouté une valeur à la
  même liste, une troisième issue **unit les deux listes** par code plutôt que d'en écraser une.
  Elle n'est **proposée que si elle sauve réellement au moins une valeur** : un bouton qui
  promettrait un sauvetage sans l'accomplir serait pire que pas de bouton. L'écran affiche
  l'aperçu exact de ce qui sera écrit.
- **EF-30 ter (intake-only, O0–O5).** Après préparation en ligne du contexte d'une base, un
  utilisateur peut, dans le mode de démonstration autorisé, créer hors-ligne un nouveau patient et
  une première rencontre. La saisie reste dans une file locale dédiée, séparée des patients déjà
  enregistrés ; au retour du réseau, les créations sont rejouées dans l'ordre et une même opération
  ne produit qu'une seule ligne serveur.
- **RG-16.** Le cache hors-ligne est **cloisonné par compte** (un autre utilisateur du même
  appareil n'y accède pas), **expire au bout de 24 heures** (`OFFLINE_TTL_MS`, appliqué à la
  lecture et au démarrage) et est **purgé à la déconnexion**.

### 4.11 Traçabilité (audit)
- **EF-31.** Les **actions sensibles** sont tracées dans un **journal infalsifiable** : consultation
  d'identité, ouverture/téléchargement de document, changement d'accès, création, révélation,
  régénération ou révocation d'un compte de mission, invitation entre médecins, figement de cohorte,
  export, suppression, publication de gabarit. Aucun justificatif secret n'entre dans l'audit.
- **RG-17.** Un utilisateur **ne peut pas fabriquer** d'événement d'audit ni en modifier.

---

## 5. Parcours métier clés

### 5.1 Cycle de vie d'une donnée clinique
```
Saisie (draft) ──► complétée (complete) ──► finalisée (curated, validée + complète)
        ▲                                              │
        └──────────── correction journalisée (motif) ──┘   (pas de rétrogradation directe de curated)
```

### 5.2 Cycle de curation
```
preparing ──soumission (≥1 doc)──► open ──réservation──► in_progress ⇄ clarification
                                                                │ finalisation
                                                                ▼
                                            patient/rencontre en `curated` (âge calculé,
                                            journalisé) ; accès aux documents refermé
```

---

## 6. Exigences non fonctionnelles (vues métier)

- **Confidentialité** : cloisonnement des trois zones **au niveau base de données** (cf. cahier
  technique, RLS). C'est l'exigence n°1.
- **Reproductibilité scientifique** : versions de gabarit immuables une fois publiées ; cohortes
  figées ; exports tracés et empreintés.
- **Intégrité** : toute donnée finalisée est validée côté serveur ; les écritures cliniques
  passent par des procédures contrôlées (pas de contournement par écriture directe).
- **Disponibilité / mobilité** : application **installable** (PWA), consultation et corrections
  **hors-ligne**.
- **Traçabilité** : journal d'audit des accès et actions sensibles.
- **Langues** : interface **français / anglais**.

---

## 7. Contraintes et limites assumées

- **RG-18.** La clé d'administration serveur (`service_role`) **n'apparaît jamais** dans le
  navigateur.
- **Limite honnête** : la sécurité applicative (RLS) empêche l'accès **applicatif** aux identités,
  mais l'**administrateur du serveur** peut techniquement lire la base. Une garantie absolue
  supposerait un **chiffrement côté client** (hors périmètre MVP). D'où la règle **données fictives
  uniquement**.

---

## 8. Hors périmètre (à ce stade)

- Auto-inscription publique depuis l'app ; gestion fine des comptes en self-service.
- Exploitation clinique de l'inspection antivirus : activer le vrai moteur ClamAV, les secrets Edge
  et la politique stricte en production.
- Usage clinique réel de la création **hors-ligne** de patients / identité / documents : le code
  *intake-only* O0–O5 existe pour des previews explicitement autorisés, mais reste désactivé dans
  les builds persistants tant que la preuve navigateur O6, la revue de risque et l'activation O7 ne
  sont pas terminées. Les images et documents hors-ligne restent hors périmètre.
- Chiffrement local du cache, politique d'« appareil de confiance », verrouillage de session.
- Détection automatique fine des doublons inter-fichiers au-delà de l'avertissement.

---

## 9. Administration des comptes (état actuel)

- Création d'un compte : via le **back-office Supabase** (Authentication → Add user) ou le script
  d'administration `scripts/create-account.mjs` (utilise la clé `service_role`, **gardée locale**).
- Tout nouveau compte est **médecin** ; l'**administrateur système** le promeut **curateur** via
  **Admin → Rôles**.
- Partage de bases et permissions : en self-service par le **propriétaire** de la base (§3.2).
