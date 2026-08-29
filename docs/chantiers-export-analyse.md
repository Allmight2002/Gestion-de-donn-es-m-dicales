# Chantier — Export directement exploitable pour l’analyse

- Statut : **cible décidée, non implémentée**
- Dernière mise à jour : **2026-08-24**
- Nature : document vivant de spécification et de suivi des lots
- Périmètre : export CSV/XLSX des données analytiques ; données fictives uniquement tant que le
  cadre juridique et éthique n’est pas validé

> Ce document complète la décision datée
> [`decision-export-simple-2026-08-17.md`](decision-export-simple-2026-08-17.md). La décision
> datée conserve le raisonnement et l’état de son jour ; ce document décrit la cible actuelle et
> les lots à réaliser. En cas d’écart avec le code, le code et les migrations font foi jusqu’à la
> livraison d’un lot.

## 1. Décision de cadrage

Le parcours quotidien doit produire par défaut un **Export Analyse**, immédiatement exploitable
dans Excel, R, SPSS ou Stata. Un **Export complet** conserve la structure nécessaire à la
traçabilité, à la réimportation et aux usages techniques.

Les deux profils utilisent les mêmes contrôles d’accès, la même pseudonymisation, le même
figeage/reproductibilité, le même hash et la même journalisation. Aucun profil ne peut exporter
l’identité, la date de naissance exacte, les images ou les documents bruts.

### Export Analyse — feuilles et règles

Feuilles produites :

```text
Données
Dictionnaire
Modalités
Métadonnées
```

Règles principales :

- une ligne par unité d’observation déterminée par le modèle de la base ;
- `patient_code` comme identifiant pseudonymisé, aucun identifiant technique ;
- noms de variables courts, ASCII, uniques et stables ;
- pour un `select`, le code stable dans `Données`, le libellé une seule fois dans `Modalités` ;
- pour un multiselect, une indicatrice par modalité (`1` sélectionnée, `0` non sélectionnée) ;
- dans un champ applicable, chaque indicatrice est initialisée à `0` : une liste vide ou une
  modalité non choisie reste donc analysable sans recodage manuel ;
- une cellule vide est réservée à un champ non applicable ou absent de la version de gabarit ; une
  raison explicite de valeur manquante suit le codage documenté dans le dictionnaire et ne peut
  jamais être interprétée comme une sélection ;
- les variables conditionnelles restent présentes même lorsqu’elles sont vides ;
- les dates sont de vraies cellules date/datetime en XLSX et restent ISO en CSV ;
- toute durée calculée possède une unité explicite ;
- les exclusions décidées par complétude et les versions de gabarit restent explicables dans
  `Métadonnées` ou `Dictionnaire`.

Les représentations concaténées, compteurs, feuilles relationnelles multiselect, UUID, versions
techniques et détails de réimportation restent disponibles dans l’**Export complet**.

## 2. Lots de mise en œuvre

Les lots sont séquentiels lorsqu’ils touchent le même contrat ou le même générateur. Ils ne sont
pas à lancer en parallèle avec un ancien lot qui modifie les mêmes fichiers.

| Lot | Objet | Dépendances | État |
|---|---|---|---|
| **L45** | Contrat `analyse` / `complet`, profil Analyse par défaut, feuilles et sémantique des valeurs manquantes | aucune | Livré (2026-08-28) |
| **L46** | Identifiants analytiques stables, noms de colonnes et feuille `Modalités` pour les `select` | L45 | Livré (2026-08-28) |
| **L47** | Multiselect analytique : indicatrices binaires initialisées à `0`, distinction stricte de `0`/vide, seuil de cardinalité | L45 ; requalifie l’ancien L36 | Livré (2026-08-28) |
| **L48** | Types temporels et numériques : dates XLSX natives, ISO CSV, unités de durée | L45 | Livré (2026-08-28) |
| **L49** | Dictionnaire et feuille `Métadonnées`, sans perte des variables conditionnelles ni de la traçabilité | L45 à L48 | Livré (2026-08-28) |
| **L50** | Concepts diagnostiques, libellé préféré, synonymes et codes terminologiques | L46 ; chantier référentiel distinct | Différé |

### L45 — Contrat et profils

Ajouter `analysis` et `complete` au contrat de génération, avec `analysis` par défaut. Le profil
doit être enregistré dans les options de `export_log` et visible dans le nom du fichier. Le
comportement actuel est conservé sous `complete` pendant la transition.

Acceptation : un appel sans profil produit Analyse ; un appel explicite `complete` conserve les
colonnes et feuilles techniques ; les contrôles d’accès et anti-fuite restent inchangés.

Livré le 2026-08-28 :
- `options.profile` (`'analysis' | 'complete'`) dans `parseExportRequest`, défaut `analysis`,
  refus 400 d'un profil inconnu ; un ancien appel sans profil reste accepté.
- Segment `_analyse_` / `_complet_` dans le nom du fichier et `profile` dans
  `export_log.export_options` (le journal propage déjà `options` en l'état).
- Le repository frontend (`src/data/exports.ts`) expose `profile` (entrant facultatif et sortant
  `ExportLogItem.profile`) ; aucun appel ne modifie le format des colonnes à ce stade.
- Testé en Deno (`contracts_test`, `handler_test`) et vitest (`edgeFunctionCallers.test.tsx`).

### L46 — Colonnes analytiques et modalités

Chaque variable reçoit un identifiant analytique court, unique et immuable. Un identifiant déjà
présent dans les anciens gabarits doit rester interprétable ; si l’identifiant devient une donnée
persistée du gabarit, la migration doit être additive et compatible avec l’historique.

Acceptation : le libellé peut changer sans changer la catégorie ; `Modalités` documente code,
libellé, ordre et état actif ; les collisions sont refusées ou résolues explicitement.

Livré le 2026-08-28 :

- Identifiant analytique : repli déterministe `scope__field_key` (même règle que la colonne de
  données, `analyticId`/`columnId`), court, ASCII, unique par version et stable entre versions ;
  il reste dérivé des données, donc **aucune migration** nécessaire (décision de stockage : pas de
  nouvelle colonne quand un repli suffit et reste interprétable). L’unicité effective est garantie
  par `assertNoAnalyticIdCollisions`, qui refuse l’export si deux `field_key` distincts se
  normalisent vers le même identifiant (échec explicite ; aucun fichier produit).
- En **Analyse**, un `select` rend une seule colonne portant son **code stable** ; une raison de
  valeur manquante reste explicite (`missing ?? code`). Les libellés ne figurent plus en colonne
  principale et ne sont répétés qu’une seule fois dans la feuille `Modalités`.
- Feuille `Modalités` (XLSX Analyse uniquement) : colonnes `variable`, `code`, `label`, `order`,
  `is_active` — une ligne par option active ou non, fournie pour `select` et `multiselect`,
  terminologie exclue. Elle est dérivée des mêmes options que le dictionnaire (`optionsOf`), donc
  toujours cohérente. Le CSV garde une seule feuille : code stable en colonne principale.
- **Complet** inchangé : libellé en colonne principale et code dans `option_code__<variable>`
  pour reprise/import ; pas de feuille `Modalités`.
- Couverture ajoutée : 8 tests contrat + 1 test handler (feuille présente en Analyse, absente en
  Complet, code en colonne principale). Suite Edge : **90 tests verts** ; `deno check`/`fmt`/`lint`
  et `eslint` global verts respectivement.

### L47 — Multiselect

Dans Analyse, supprimer les colonnes concaténées, le compteur et les feuilles relationnelles.
Conserver ces formes dans Complet. Pour chaque indicatrice, la valeur par défaut est `0` ; elle
devient `1` si le code est sélectionné. Une liste vide et une modalité non sélectionnée produisent
donc `0`. Une cellule vide est réservée à un champ non applicable ou absent de la version de
gabarit. Une raison explicite de valeur manquante suit le codage documenté et ne doit jamais être
prise pour une sélection.

Au-delà du seuil de cardinalité, l’export doit échouer explicitement ou demander une sélection de
modalités ; il ne doit jamais produire un fichier tronqué sans le signaler.

Livré le 2026-08-28 :

- **Analyse** : un `multiselect` ne rend que ses indicatrices binaires dans `Données` — une
  colonne `has__<variable>__<modalité>` par code effectivement exporté, `1` si sélectionné, `0`
  sinon. Ni libellé/codes concaténés, ni compteur, ni feuille relationnelle pour ces champs.
- Sémantique stricte : `0` = champ applicable sans cette modalité (listes vide, valeur absente,
  modalité non sélectionnée) ; cellule vide réservée au champ non applicable ou absent de la
  version de la fiche ; une raison explicite de valeur manquante (`non_documente`, …) met toutes
  les indicatrices à `0` et ne devient jamais une sélection. Les `0`/`1` sont des nombres.
- Codes inconnus historiques : une indicatrice existe aussi pour eux (jamais effacés) ; les
  collisions de suffixe normalisé sont désambiguïsées par un compteur (`_2`), sans colonne
  dupliquée.
- Seuil de cardinalité : au-delà de 100 codes par multiselect, le profil **Analyse refuse
  explicitement** (HTTP 413 `EXPORT_INDICATOR_CARDINALITY`, jamais de fichier tronqué) ;
  **Complet** conserve les codes concaténés, exhaustivement, sans seuil.
- **Complet** inchangé : libellé concaténé, `option_code__<variable>`, `nb__<variable>`, feuille
  relationnelle et indicatrices restent toutes présentes ; les terminologies multivaluées ne sont
  pas touchées (hors périmètre, L50).
- Couverture ajoutée : 5 tests contrat + 2 tests handler (feuille absente en Analyse / présente en
  Complet, formes concaténées conservées, refus 413, suite Complet 200). Suite Edge :
  **96 tests verts** (generate-export + `_shared`) ; `deno check`/`fmt`/`lint`, `eslint` et
  `typecheck` verts.

### L48 — Dates, datetime et durées

En XLSX, écrire des valeurs Excel natives avec un format d’affichage lisible. En CSV, conserver
le format ISO. Les nombres, compteurs et indicatrices restent numériques. Toute formule de durée
déclare son unité dans le dictionnaire et dans le nom analytique lorsque c’est utile
(`duree_hospitalisation_jours`).

**Chiffrage retenu (livré, 2026-08-28) :**
- Une valeur date/datetime est chiffrée en **nombre de série Excel** (système 1900, origine au
  1970-01-01 + 25 569 jours) : cellules de type nombre, triables et soustraisables.
- Les datetime sont rendues **en heure UTC** (fraction de jour = heure/minute/seconde UTC,
  secondes comprises), offsets de fuseau normalisés : reproductible quel que soit le fuseau du
  lecteur. Le CSV conserve l’ISO tel que stocké.
- Formats d’affichage posés sur les cellules : `yyyy-mm-dd` (date), `yyyy-mm-dd hh:mm:ss`
  (datetime) ; l’écriture passe par `cellStyles` pour que SheetJS sérialise réellement les
  formats (`xl/styles.xml`).
- Une date **invalide reste du texte lisible** — jamais masquée par un zéro, jamais convertie.
- L’unité d’un calcul de durée est documentée par la colonne `unit` du dictionnaire (ex.
  `days`) ; le `field_key` la porte quand c’est utile (`duree_hospitalisation_jours`).
- Seule la feuille principale est concernée : pas d’impact sur les feuilles `Dictionnaire`,
  `Modalités` ni les feuilles relationnelles.
- Couverture ajoutée : 4 tests contrat (série date/datetime, fuseau normalisé, invalide →
  absente/texte, CSV jamais converti, unité de durée au dictionnaire) + 1 test handler (relecture
  du classeur : types natifs `t:n`, invalide en `t:s`, flux de styles présent). Suite Edge :
  **96 tests verts** (generate-export + `_shared`), **171 verts** sur `supabase/functions` ;
  `deno check`/`fmt`/`lint`, `eslint` et `typecheck` verts.

### L49 — Dictionnaire et métadonnées

Le dictionnaire Analyse conserve uniquement les propriétés utiles à l’interprétation : variable,
libellé, description, section, type, unité, formule, valeurs autorisées et valeurs manquantes.
Les informations globales vont dans `Métadonnées` : profil, date, modèle d’observation, population,
versions de gabarit, nombre de lignes, exclusions et règle de sélection.

Chaque colonne de `Données` doit être documentée. Une variable ne disparaît pas parce qu’elle est
vide pour une population donnée.

**Classeur Analyse livré (2026-08-28) — quatre feuilles :**
- `Données` (nouveau nom de la feuille principale en Analyse ; `Export` conservé en Complet),
  `Dictionnaire`, `Modalités`, `Métadonnées`, dans cet ordre.
- **Dictionnaire Analyse réduit** à `column_id`, `label`, `description`, `section`,
  `section_label`, `type`, `unit`, `formula`, `allowed_values`, `missing_reasons` : la portée se
  lit dans le préfixe de la variable ; `field_key`, `scope`, `is_multiple` et
  `template_versions` sortent (ces dernières migrent vers `Métadonnées`).
- Chaque colonne de `Données` reste documentée : les indicatrices `has__…` (`computed_indicator`),
  les colonnes calculées (formule + unité, ex. `duree_hospitalisation` en `days`), les modalités
  inactives (`(inactif)`), et les colonnes dérivées absentes en Analyse (`option_code__`,
  `nb__` d’un multiselect) ne figurent plus au dictionnaire puisque absentes du fichier.
- **`Métadonnées`** (attribut/valeur) : `export_profile`, `generated_at`, `base_name`,
  `cohort_name`, `export_mode`, `selection_rule`, `template_versions`, `row_count`,
  `excluded_patients_incomplete`, `excluded_encounters_incomplete` — un export partiel reste
  explicable, sans identité (aucun UUID, code patient ou date de naissance).
- Les variables conditionnelles vides restent des colonnes de `Données` (cellules vides) et des
  lignes du dictionnaire ; l’export vide conserve aussi son dictionnaire.
- **Complet inchangé** : dictionnaire détaillé historique, feuille `Export`, pas de `Métadonnées`.
- Couverture ajoutée : 5 tests contrat + 1 test handler (ordre des feuilles, colonnes réduites,
  indicateurs et calculs documentés, `Métadonnées` complète, Complet conservé). Suite Edge :
  **96 tests verts** (generate-export + `_shared`), **177 verts** sur `supabase/functions` ;
  `deno check`/`fmt`/`lint`, `eslint`, `typecheck` et 513 tests web verts.

### L50 — Terminologie diagnostique

Ce lot est différé du MVP de simplification. Il nécessite un référentiel gouverné : identifiant de
concept stable, libellé préféré, synonymes explicitement validés, système et code terminologique,
avec historique des versions. Aucune fusion ne doit être faite sur simple ressemblance lexicale.

## 3. Ordre et vérification

```text
L45 → L46 → L47 → L48 → L49
             └──────────────→ L50 (différé)
```

Chaque lot doit ajouter ou adapter des tests ciblés CSV et XLSX. Le jalon MVP est atteint après
L49, avec un fichier Analyse lisible sans connaissance de l’architecture interne. L50 pourra être
livré ensuite sans réintroduire les colonnes techniques dans le profil Analyse.
