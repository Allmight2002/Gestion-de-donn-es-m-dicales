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
patients et de rencontres cliniques, exploitables pour la recherche, **sans jamais exposer
l'identité des patients** au-delà du strict nécessaire.

- **Objectif** : produire des données analytiques **pseudonymisées, validées et reproductibles**,
  prêtes pour l'analyse, à partir de saisies directes, d'imports de fichiers, ou de documents
  source structurés par un pôle de curation.
- **Pari central** : le **patient** est l'objet central, **pas l'étude**. Un même patient peut
  porter plusieurs rencontres dans le temps.
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

**RG-6.** Tout nouveau compte est **médecin** par défaut ; seul un administrateur système peut le
promouvoir curateur. Nul ne peut modifier son propre rôle.

> Les anciens rôles `analyste` et `validateur` ont été **supprimés** : le curateur structure ET
> finalise seul (plus d'étape de validation séparée).

### 3.2 Partage d'une base entre médecins — 5 permissions granulaires

**EF-1.** Le propriétaire d'une base peut la **partager** avec d'autres médecins via une
**invitation par lien** (jeton à usage unique, montré une seule fois). Il choisit un profil de
départ (`viewer` lecture seule / `editor`) puis ajuste **5 permissions indépendantes** :

`voir l'identité` · `voir les documents bruts` · `éditer les données structurées` ·
`exporter` · `gérer les accès`.

**RG-7.** Le propriétaire possède toutes les permissions. Un collaborateur n'a que celles qui lui
sont explicitement accordées. Exemple type : un statisticien reçoit `viewer + exporter` → il
exporte des données **sans identité**.

---

## 4. Exigences fonctionnelles par domaine

### 4.1 Comptes et authentification
- **EF-2.** Connexion par email + mot de passe ; réinitialisation et changement de mot de passe.
- **EF-3.** L'administrateur système attribue les rôles globaux (écran **Admin → Rôles**).
- **HP** : l'auto-inscription en self-service depuis l'app (les comptes sont créés via le back-office
  Supabase ou un script d'administration), cf. §9.

### 4.2 Gabarits (modèles de données cliniques)
- **EF-4.** Un **gabarit** définit les **variables** (champs) d'un registre. Il est **versionné** ;
  une version **publiée devient immuable** (reproductibilité scientifique).
- **EF-5.** Chaque variable porte : libellé, **type** (texte, entier, nombre, date, date-heure,
  booléen, liste, liste multiple), **portée** (donnée **permanente** du patient / donnée de
  **rencontre**), `requise`, **valeurs autorisées**, **bornes** min/max, unité, **types de
  rencontre** concernés, et la gestion des **codes manquants** (`non fait` / `inconnu` /
  `non applicable`).
- **EF-6.** Des **règles de cohérence** (ex. « si X alors Y requis ») peuvent bloquer une donnée
  incohérente. Elles sont contrôlées (opérateurs en liste blanche).
- **EF-7.** Un gabarit est **global** (géré par l'admin) ou **personnel** (créé et versionné par le
  médecin propriétaire). Le médecin peut **créer la version suivante** de son gabarit personnel.
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
  nom et une spécialité.
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
- **EF-28.** Export **CSV / XLSX** d'une cohorte figée, avec **dictionnaire des variables**. Le
  fichier est conservé immuable (empreinte) et **tracé**.
- **RG-15.** L'export **refuse tout champ identifiant** (liste blanche analytique). Un code
  pseudonymisé est exporté, jamais le nom ni la date de naissance.

### 4.10 Mode hors-ligne (application installable / PWA)
- **EF-29.** Une base peut être rendue **disponible hors-ligne** : un **instantané analytique**
  (jamais l'identité ni les images) est stocké sur l'appareil pour consultation sans réseau.
- **EF-30.** Les **corrections de rencontres** faites hors-ligne sont mises en file et **rejouées**
  à la reconnexion, via les mêmes contrôles serveur, avec **détection de conflit** (« garder ma
  version » / « garder la version serveur »).
- **RG-16.** Le cache hors-ligne est **cloisonné par compte** (un autre utilisateur du même
  appareil n'y accède pas), **expire** (7 jours) et est **purgé à la déconnexion**.

### 4.11 Traçabilité (audit)
- **EF-31.** Les **actions sensibles** sont tracées dans un **journal infalsifiable** : consultation
  d'identité, ouverture/téléchargement de document, changement d'accès, invitation, figement de
  cohorte, export, suppression, publication de gabarit.
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
- Création **hors-ligne** de patients / identité / documents (l'outbox se limite volontairement aux
  corrections de rencontres).
- Chiffrement local du cache, politique d'« appareil de confiance », verrouillage de session.
- Détection automatique fine des doublons inter-fichiers au-delà de l'avertissement.

---

## 9. Administration des comptes (état actuel)

- Création d'un compte : via le **back-office Supabase** (Authentication → Add user) ou le script
  d'administration `scripts/create-account.mjs` (utilise la clé `service_role`, **gardée locale**).
- Tout nouveau compte est **médecin** ; l'**administrateur système** le promeut **curateur** via
  **Admin → Rôles**.
- Partage de bases et permissions : en self-service par le **propriétaire** de la base (§3.2).
