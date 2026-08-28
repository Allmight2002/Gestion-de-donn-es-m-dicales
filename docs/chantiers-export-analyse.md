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
| **L45** | Contrat `analyse` / `complet`, profil Analyse par défaut, feuilles et sémantique des valeurs manquantes | aucune | À faire |
| **L46** | Identifiants analytiques stables, noms de colonnes et feuille `Modalités` pour les `select` | L45 | À faire |
| **L47** | Multiselect analytique : indicatrices binaires initialisées à `0`, distinction stricte de `0`/vide, seuil de cardinalité | L45 ; requalifie l’ancien L36 | À faire |
| **L48** | Types temporels et numériques : dates XLSX natives, ISO CSV, unités de durée | L45 | À faire |
| **L49** | Dictionnaire et feuille `Métadonnées`, sans perte des variables conditionnelles ni de la traçabilité | L45 à L48 | À faire |
| **L50** | Concepts diagnostiques, libellé préféré, synonymes et codes terminologiques | L46 ; chantier référentiel distinct | Différé |

### L45 — Contrat et profils

Ajouter `analysis` et `complete` au contrat de génération, avec `analysis` par défaut. Le profil
doit être enregistré dans les options de `export_log` et visible dans le nom du fichier. Le
comportement actuel est conservé sous `complete` pendant la transition.

Acceptation : un appel sans profil produit Analyse ; un appel explicite `complete` conserve les
colonnes et feuilles techniques ; les contrôles d’accès et anti-fuite restent inchangés.

### L46 — Colonnes analytiques et modalités

Chaque variable reçoit un identifiant analytique court, unique et immuable. Un identifiant déjà
présent dans les anciens gabarits doit rester interprétable ; si l’identifiant devient une donnée
persistée du gabarit, la migration doit être additive et compatible avec l’historique.

Acceptation : le libellé peut changer sans changer la catégorie ; `Modalités` documente code,
libellé, ordre et état actif ; les collisions sont refusées ou résolues explicitement.

### L47 — Multiselect

Dans Analyse, supprimer les colonnes concaténées, le compteur et les feuilles relationnelles.
Conserver ces formes dans Complet. Pour chaque indicatrice, la valeur par défaut est `0` ; elle
devient `1` si le code est sélectionné. Une liste vide et une modalité non sélectionnée produisent
donc `0`. Une cellule vide est réservée à un champ non applicable ou absent de la version de
gabarit. Une raison explicite de valeur manquante suit le codage documenté et ne doit jamais être
prise pour une sélection.

Au-delà du seuil de cardinalité, l’export doit échouer explicitement ou demander une sélection de
modalités ; il ne doit jamais produire un fichier tronqué sans le signaler.

### L48 — Dates, datetime et durées

En XLSX, écrire des valeurs Excel natives avec un format d’affichage lisible. En CSV, conserver
le format ISO. Les nombres, compteurs et indicatrices restent numériques. Toute formule de durée
déclare son unité dans le dictionnaire et dans le nom analytique lorsque c’est utile
(`duree_hospitalisation_jours`).

### L49 — Dictionnaire et métadonnées

Le dictionnaire Analyse conserve uniquement les propriétés utiles à l’interprétation : variable,
libellé, description, section, type, unité, formule, valeurs autorisées et valeurs manquantes.
Les informations globales vont dans `Métadonnées` : profil, date, modèle d’observation, population,
versions de gabarit, nombre de lignes, exclusions et règle de sélection.

Chaque colonne de `Données` doit être documentée. Une variable ne disparaît pas parce qu’elle est
vide pour une population donnée.

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
