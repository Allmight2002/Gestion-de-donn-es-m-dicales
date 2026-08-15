# Découpage des chantiers en lots parallélisables

- Établi le 2026-07-27 · **révisé le 2026-08-14**
- Objet : permettre de lancer plusieurs chantiers **dans des sessions distinctes**
  sans que les branches se marchent dessus
- Source des contenus :
  [`idees-post-readiness.md`](idees-post-readiness.md),
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md),
  pour les lots L15 à L19
  [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md),
  et pour les lots L20 à L26
  [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md)

> **Révision du 2026-08-10** : trois lots étaient livrés sans être marqués comme tels —
> **L6** (2026-08-09), **L8** (2026-08-01) et **L9** (2026-08-01). Cinq lots sont ajoutés,
> **L15 à L19**, issus de la campagne de vérification manuelle des flux multi-comptes.

> **Révision du 2026-08-11** : sept lots sont ajoutés, **L20 à L26**, issus de
> [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md) — les listes de diagnostics
> en remplacement des variables `diagnostic_1/2/3`. **L21 entre en collision avec L4 et L13**, et
> **L23 avec L18 et L19** : voir l'ordre suggéré.

> **Seconde révision du 2026-08-11** — deux corrections et un ajout.
>
> **Trois lots étaient livrés sans être marqués**, pour la deuxième fois : **L15** et **L16**
> (migrations `20260811120000` et `20260811130000` sur `main`, commits `009ed3c` et `dc90392` ;
> la phase interface de L16 est également en place dans `NewPatient.tsx`) et **L17** (utilitaire
> `src/lib/edgeFunctionError.ts`, commit `6a453b9`). Les étapes 1 et 2 de l'ordre suggéré sont
> donc soldées.
>
> **Sept lots sont ajoutés, L27 à L33** : le reste des améliorations du moteur de formulaires,
> après vérification de chaque point contre le code. Beaucoup de ce qui était réputé manquant
> existe déjà — min/max, unités, obligation conditionnelle, avertissement non bloquant,
> duplication d'une variable, réorganisation par glisser-déposer, affichage compact du
> constructeur, versionnement.

Le critère de découpage est le **fichier touché**, pas le thème. Deux lots qui
modifient le même fichier produiront un conflit de fusion, même si leurs sujets
n'ont aucun rapport.

Un prompt prêt à l'emploi existe pour chaque lot dans
[`prompts-lots.md`](prompts-lots.md).

## Vue d'ensemble

| Lot | Objet | Fichiers principaux | Lancer en même temps que |
|---|---|---|---|
| ~~L1~~ | ~~Liste d'une base : affichage et bandeau~~ | **Livré le 2026-07-28** | — |
| ~~L2~~ | ~~Formulaires patient : sections~~ | **Livré le 2026-07-28** | — |
| ~~L3~~ | ~~Allègement du chargement~~ | **Livré le 2026-07-28** | — |
| **L4** | Soupape sur le champ diagnostic | `proposalField.ts`, `EncounterFields.tsx`, `TerminologyInput.tsx`, `FieldForm.tsx` | L1, L2, L3, L7 |
| ~~L5~~ | ~~Constructeur de règles~~ | **Livré le 2026-07-28** | — |
| ~~L6~~ | ~~Finition de l'interface~~ | **Livré le 2026-08-09** | — |
| ~~L7~~ | ~~Protections de branche (B7)~~ | **Livré le 2026-08-01** | — |
| ~~L8~~ | ~~Suppression et restauration de bases (P2)~~ | **Livré le 2026-08-01** | — |
| ~~L9~~ | ~~Modèle d'observation d'une base~~ | **Livré le 2026-08-01** (migration + UI + release) | — |
| ~~L10~~ | ~~Comptes de mission (P4)~~ | **Livré le 2026-07-29** | — |
| ~~L11~~ | ~~Observabilité des erreurs (P3)~~ | **Livré et promu sur `main`** (PR #176, #189, #192, #194) | — |
| ~~L12~~ | ~~Traitement des propositions~~ | **Livré** (PR #172) | — |
| ~~L13~~ | ~~Rafraîchissement de la copie locale~~ | **Livré** (PR #180, #181) | — |
| **L14** | Chargement de la seule langue active | `messages.ts`, `useI18n.ts` | **seul** |
| ~~L15~~ | ~~Comptes de mission : identifiant et mot de passe générés~~ | **Livré le 2026-08-11** (`009ed3c`) | — |
| ~~L16~~ | ~~Compte de mission : création et correction de l'identité~~ | **Livré le 2026-08-11** (`dc90392`, base + interface) | — |
| ~~L17~~ | ~~Messages d'erreur des Edge Functions~~ | **Livré** (`6a453b9`, `src/lib/edgeFunctionError.ts`) | — |
| ~~L18~~ | ~~Cohorte dynamique : compteur vivant et « Figer maintenant »~~ | **Livré** (PR #159, #160) | — |
| ~~L19~~ | ~~Archivage d'une cohorte~~ | **Livré, preuve technique de production** (PR #179, #182, #184, #185, #187) | — |
| **L20** | Listes de diagnostics : surface base | migration, `test/validation.test.ts`, `test/templates.admin.test.ts`, `src/data/types.ts`, `src/data/templates.ts` | **seul** (prérequis de L21 à L26) |
| **L21** | Listes de diagnostics : saisie et constructeur | `TerminologyInput.tsx`, `FieldForm.tsx`, `FieldInput.tsx`, `ValueInput.tsx`, `src/domain/validation.ts` | L22, L24, L25 — **jamais avec L4 ni L13** |
| **L22** | Listes de diagnostics : export | `exportContract.ts`, `handler.ts` et leurs tests Deno | L21, L23, L24, L25 |
| **L23** | Listes de diagnostics : cohortes | `CohortBuilder.tsx`, `src/data/cohorts.ts` | L21, L22, L24 — **jamais avec L18 ni L19** |
| **L24** | Listes de diagnostics : refus au mappage d'import | `src/domain/import.ts`, `ImportData.tsx` | L21, L22, L23, L25 |
| **L25** | Conflit hors-ligne : issue « garder les deux » | `src/data/offline.ts`, `SyncCenter.tsx` | L21, L22, L23, L24 |
| **L26** | Regroupement des variables `diagnostic_1/2/3` | migration, RPC d'aperçu et de conversion, écran du constructeur | **seul**, en dernier |
| **L27** | Texte d'aide par variable | migration, `FieldForm.tsx`, `EncounterFields.tsx`, `exportContract.ts` | L29 |
| ~~L28~~ | ~~Valeur par défaut et unicité~~ | **Livré le 2026-08-14** (valeur proposée ; `is_unique` écartée) | — |
| **L29** | Prévisualisation du formulaire | nouvel écran, `TemplateVersionEditor.tsx` | tous |
| **L30** | Options de liste : code interne stable | migration + conversion, `FieldForm.tsx`, `FieldInput.tsx`, `exportContract.ts` | L29 |
| **L31** | Sections personnalisables | migration, `FieldForm.tsx`, `EncounterFields.tsx`, `ImportData.tsx`, `TemplateFromFile.tsx`, `templateLibrary.ts`, `seed.sql`, `exportContract.ts` | L29 |
| **L32** | Affichage conditionnel | migration, `RuleForm.tsx`, `EncounterFields.tsx`, `validation.ts`, `exportContract.ts` | L28, L29 |
| ~~L33~~ | ~~Raisons de valeur manquante par variable~~ | **Livré le 2026-08-14** (`refus` et `non_documente` ajoutés ; `allow_missing_codes` conservé en miroir) | — |

> **L27 à L33 ne sont PAS parallélisables entre eux.** `FieldForm.tsx` est touché par L27, L28,
> L30, L31 et L33 — et déjà par L4 et L21 ; `exportContract.ts` par L27, L30, L31, L32 et L33 — et
> déjà par L22. Cette famille est une **file d'attente**, à traiter un lot à la fois. Seul **L29**
> échappe à la règle : il n'ouvre que son propre écran.

> **L18 et L19 touchent les deux mêmes fichiers** : ne jamais les lancer ensemble. Traiter L18
> d'abord (front seul, gain immédiat), L19 ensuite (surface base).

> **L21 touche `TerminologyInput.tsx` et `FieldForm.tsx`** — les deux fichiers de **L4**, et le
> premier est aussi celui de **L13**. **L23 touche les deux fichiers de L18 et L19.** Ces
> collisions sont structurelles, pas circonstancielles : elles décident de l'ordre, pas
> l'inverse.

## Deux fichiers à surveiller

- **`src/i18n/messages.ts`** est touché par presque tous les lots qui ajoutent du
  texte. Les conflits y sont fréquents mais faciles : ce sont des ajouts de
  lignes en des endroits différents. Pour les limiter, ajouter ses clés **à la
  fin** de la section française puis anglaise, plutôt qu'au milieu.
- **`docs/suivi-execution-feuille-route.md`** est modifié par chaque lot qui se
  termine. Même remarque : ajouter sa section à la fin.

## Détail des lots

### L1 — Liste d'une base : affichage et bandeau — **livré**

Livré le 2026-07-28. **D5** : `String(v)` remplacé par `displayFieldValue` dans
`BaseHome.tsx` et `EditEncounter.tsx`, qui portaient le même défaut — un
diagnostic s'affichait « [object Object] » dans la liste des patients. **D3** :
bandeau hors-ligne resserré. Tests ajoutés dans `Patients.test.tsx`.

### L2 — Formulaires patient : sections — **livré**

**D4**, livré le 2026-07-28. Le regroupement d'`EncounterFields.tsx` est devenu
un composant commun, utilisé par la création de patient. Ordre **Clinique →
Biologie → Paraclinique**, sections vides non rendues, et une section **Autre**
qui recueille toute variable sans section connue — pour qu'aucune donnée ne
disparaisse silencieusement du formulaire.

Le préalable de L9 est donc levé.

### L3 — Allègement du chargement — **livré**

**Idée 9**, livrée le 2026-07-28 : le tableur est sorti du préchargement et le
socle applicatif isolé du code métier. Précache **1 728 → 892 Kio**, fichier
principal **512 → 177 Ko**. Le dédoublonnement est abandonné (deux graphes de
modules distincts, gain nul une fois les copies hors précache).

**Reste ouvert, dans un lot à part** : ne charger que la langue active — les deux
traductions voyagent ensemble dans 98 Ko. La correction touche
`src/i18n/messages.ts`, signalé ci-dessus comme source de conflits : ce lot doit
tourner **seul**, ou au moins sans aucun lot qui ajoute du texte.

### L4 — Soupape sur le champ diagnostic

**Idée 6** : étendre au type `terminology` la soupape des listes contrôlées.
Touche `FieldForm.tsx`, que L9 modifie aussi — ne pas lancer les deux ensemble.

### L5 — Constructeur de règles — **livré**

**Idée 7**, livrée le 2026-07-28. Un mode **guidé** remplace la saisie de JSON :
on choisit un type de règle, puis les variables et l'opérateur dans des listes,
libellés en langage clinique et adaptés au type de la variable. La règle en
construction s'affiche en **phrase lisible**, réutilisée par l'éditeur de version
pour les règles déjà enregistrées. Un mode **expert** conserve le JSON pour les
cas non couverts. La sortie reste le même JSON qu'avant.

### L6 — Finition de l'interface — **livré**

**Idée 10**, livrée le 2026-08-09 en deux temps : « Améliore et harmonise tous les écrans »
(PR #122) puis « Finalise l'accessibilité mobile » (PR #125). Le lot a débordé des neuf écrans
annoncés — une trentaine de fichiers d'écran ont été touchés.

Livré : un composant `Checkbox` commun (`src/components/Checkbox.tsx`, avec ses tests) qui
remplace les cases à cocher système, la zone de profil de `AppShell.tsx` refondue, les
squelettes de chargement généralisés (`Skeleton.tsx`), et un travail de densité et de gabarits
sur le tableau de bord et les vues de base. L'accessibilité mobile (cibles tactiles, focus
visible) a été reprise dans un second passage.

> Le prompt qui a produit ce lot a été réécrit avant lancement et est conservé dans
> [`prompts-lots.md`](prompts-lots.md) : il est plus détaillé que la version d'origine et sert
> de modèle pour les lots transversaux d'interface.

### L7 — Protections de branche — **livré**

**B7**, livré le 2026-08-01 : le dépôt étant public, les règles de protection
sont actives sur `main` et `develop`. La pull request et `build-test`/
`scanner-image` sont obligatoires, les règles s'appliquent aux administrateurs,
le force-push et la suppression sont interdits, et le script de contrôle live est
vert en mode mono-personne. Le circuit `branche de travail → develop → main`
reste obligatoire ; la revue par un tiers demeure suspendue jusqu'à l'arrivée
d'un second relecteur.

Aucun fichier de code n'est modifié : ce lot documentaire et de configuration
peut être mené à tout moment, en parallèle de n'importe quel autre.

### L8 — Suppression et restauration de bases — **livré**

**P2**, livré le 2026-08-01 (PR #116, commit `dc1ce9a`). `soft_delete_base` existait déjà ;
le lot a ajouté la RPC de restauration (migration `20260801140238_restore_deleted_base.sql`),
la corbeille et le geste de restauration dans `Dashboard.tsx` et `BaseHome.tsx`, l'entrée
correspondante dans `security-definer-allowlist.json`, et les tests
(`test/bases.test.ts`, `Dashboard.test.tsx`, `Patients.test.tsx`).

### L9 — Modèle d'observation d'une base — **livré**

**Idée 8**, livrée le 2026-08-01. La migration additive ajoute les trois modèles
d'observation, conserve les bases existantes en suivi répété et verrouille tout changement après
la première saisie. En transversal, le formulaire patient est unique et sectionné ; la portée et
l'ajout de rencontre disparaissent aussi bien de l'interface que des voies serveur. Le SHA a été
validé en staging puis sur la cible technique production. Détail dans
[`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md).

### L10 — Comptes de mission — **livré**

**P4**, livré le 2026-07-29. Un médecin confie la saisie d'une seule base à une
personne de terrain, pour une durée bornée et révocable.

Ce qui a été ajouté au socle existant (`base_access`, révocation, audit) : un rôle
global `saisisseur`, une permission de création `can_create_structured_data` distincte
de la modification, une **expiration d'accès** (`base_access.expires_at`) vérifiée par
la base à chaque requête, et l'Edge Function idempotente `create-mission-account`.

Les cinq décisions restantes ont été tranchées : **24 mois** maximum prolongeables,
lecture des noms **réglée à la création et décochée par défaut** avec justification
consignée, **pas de téléversement** en v1, purge à **12 mois** après échéance
(opération manuelle), rôle `saisisseur` / libellé « compte de mission ».

Deux régressions ont été prises au vol par la suite de tests, toutes deux de la même
famille — **redéfinir un objet à partir d'une migration périmée** : la policy
`el_select` avait été durcie en `20260616095700` et les fonctions `can_*` en
`20260616096000` (garde « base non supprimée »). Toujours repartir de la **dernière**
définition, pas de celle qu'on trouve en premier.

### L11 — Observabilité des erreurs

**P3**, et l'idée n°2 de la file. Aujourd'hui les plantages d'écran sont captés
localement mais **rien ne remonte** au porteur, et les erreurs d'arrière-plan ne
sont pas captées du tout. Voir
[`spec-observabilite-erreurs.md`](spec-observabilite-erreurs.md) : filet global,
puits interne respectueux de la vie privée, écran « État du système » réservé à
l'administration.

Les étapes locales sont réalisables dès maintenant ; seule l'alerte distante
dépend de **B5**, encore ouvert. **Sept décisions** sont en attente dans la spec.

Surface base : appliquer `meddata-db-safety`.

### L12 — Traitement des propositions

Dette laissée par le lot P1S. La soupape écrit les valeurs proposées dans un
champ compagnon, mais **rien ne les liste** à l'échelle d'une base : elles dorment
dans les fiches, et personne ne peut décider de les promouvoir en valeurs de la
liste. Sans cet écran, la boucle d'amélioration annoncée n'existe pas.

Lot de lecture seule : un écran qui parcourt les propositions non vides et permet
d'ouvrir la fiche correspondante.

### L13 — Rafraîchissement de la copie locale

Dette laissée par le lot T4. La détection d'une copie périmée existe
(`cacheIsCurrent`), et une copie périmée est déjà ignorée au profit du serveur —
mais **rien ne propose de la mettre à jour**. L'utilisateur doit deviner qu'il
faut retélécharger.

Touche `TerminologyInput.tsx`, comme L4 : ne pas lancer les deux ensemble.

### L15 — Comptes de mission : identifiant et mot de passe générés (à lancer SEUL)

**Chantier A** de [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md) §2.
Décision du 2026-08-11 : pour **tous** les comptes de mission, le médecin reçoit un identifiant et
un mot de passe générés à remettre à l'étudiant ; l'e-mail n'est pas requis. La création, la
connexion et la régénération remplacent le flux actuel d'invitation par courriel.

Le lot touche l'Edge Function, les tests de son contrat, l'écran de gestion des comptes et la
connexion. Il doit garantir côté serveur l'unicité, l'idempotence, l'absence de secret dans les
traces, la régénération explicitement confirmée et l'invalidation des anciens accès. Il ne modifie
ni migration distante ni paramètre cloud sans demande explicite.

Il est traité **seul** : Auth et accès aux données sont une surface de sécurité, et il touche des
écrans qui doivent être vérifiés ensemble.

### L16 — Compte de mission : écriture de l'identité et écarts d'interface (à lancer SEUL)

**Chantiers B et C** de [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md)
§3 et §4. Les deux sont réunis en un seul lot parce que **l'ordre les lie** : la migration doit
précéder l'écran, sinon l'interface proposerait une saisie que la base refuse encore.

Phase base — une migration additive redéfinit `can_write_identity()` pour y ajouter une branche
`saisisseur` (accès actif, `can_view_identity` accordée, `can_create_structured_data`), retourne
délibérément les tests correspondants et réécrit §4, §9 et §12 de
[`spec-comptes-mission.md`](spec-comptes-mission.md). **Décision déjà prise par le porteur
(option A)** : ne pas la rouvrir, la mettre en œuvre.

Phase interface — la section « Identité (zone restreinte) » de `NewPatient.tsx` devient
conditionnée à `canViewIdentity`. La zone complète (nom, date de naissance, téléphone, adresse,
identifiant externe) devient aussi corrigeable après création : le saisisseur seulement sur son
propre brouillon autorisé, le médecin autorisé sur les patients de sa base. Les quatre corrections
d'écran déjà écrites sont finies et testées.

> **Rien n'existe en code.** Une première implémentation des points d'écran avait été écrite puis
> **effacée le 2026-08-10** : elle datait d'avant que le renversement du §4 ne soit tranché, et ne
> comportait aucun test. La spécification de chaque correction reste intégralement dans le
> registre. Le lot part de zéro, avec ses tests.

Surface base : appliquer `meddata-db-safety`. Touche `AppShell.tsx`, `BaseHome.tsx`,
`PatientDetail.tsx`, `EditPatient.tsx`, `NewPatient.tsx` et `messages.ts` : à lancer **seul**.

### L17 — Messages d'erreur des Edge Functions

**Chantier D** de [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md) §5.
Tout refus d'une Edge Function s'affiche « Edge Function returned a non-2xx status code » : le
vrai motif est dans `error.context`, que les appelants ne lisent pas. **Un refus légitime est
donc indiscernable d'une panne** — ce défaut a coûté deux diagnostics complets pendant la
campagne de test manuel.

À corriger **une fois, dans un utilitaire partagé**, et non appelant par appelant : un correctif
partiel du même genre avait déjà laissé d'autres chemins afficher `[object Object]`. Contrainte à
préserver : ne jamais exposer d'erreur interne brute — n'afficher que ce que le serveur a déjà
choisi de dire.

### L18 — Cohorte dynamique : compteur vivant et « Figer maintenant »

**Défauts D6 et D8** de [`idees-post-readiness.md`](idees-post-readiness.md), chantier E §6.3 et
§6.4. La carte d'une cohorte à mise à jour automatique n'affiche ni compteur ni action, parce que
son compte est lu depuis `cohort_member`, table vide par construction pour ce type de cohorte. Et
rien n'avertit qu'une cohorte figée en incluant des brouillons ne sera **jamais** exportable.

Front seul, sans migration. Le refus d'export d'une cohorte dynamique est **délibéré et doit le
rester** : le lot donne à la carte ce qui lui manque, il ne lève pas la règle.

### L19 — Archivage d'une cohorte

**Idée 11** de [`idees-post-readiness.md`](idees-post-readiness.md), chantier E §6.2. Une cohorte
créée ne peut plus être retirée. Les policies de suppression existent, mais
`export_log.cohort_id` est en `on delete cascade` : un `DELETE` direct **effacerait le journal
des exports**. Archivage recommandé (`deleted_at`) plutôt que suppression dure.

Surface base : appliquer `meddata-db-safety`. Décider dans le même mouvement du sort des fichiers
du bucket `scientific-exports`. **Ne pas lancer avec L18** : mêmes fichiers.

### L20 — Listes de diagnostics : surface base (à lancer SEUL)

§4, §5, §8 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). **Prérequis de
tous les lots L21 à L26** : tant que la base refuse un tableau, l'interface qui en écrit un est
inutilisable.

Une seule migration additive porte toute la surface serveur — colonne `is_multiple` sur
`template_field` avec contrainte la réservant au type `terminology`, branche multivaluée dans
`assert_data_valid`, garde `jsonb_array_length > 0` dans `base_completeness_stats`, opérateurs
`has_any` et `has_none` dans `jsonb_matches`. Les regrouper évite trois migrations successives sur
les mêmes fonctions et permet une seule revue.

Invariants à démontrer par les tests : tableau vide refusé, code en double refusé, clé
surnuméraire refusée, couple code/libellé incohérent refusé, concept d'une publication conservée
mais non active accepté, code de donnée manquante toujours accepté à la place du tableau,
`is_multiple` refusé sur un autre type que `terminology`, longueur bornée à 50.

Surface base : appliquer `meddata-db-safety`. Aucune table nouvelle, donc aucune policy RLS à
écrire — c'est précisément ce que le choix de stockage cherchait à obtenir.

### L21 — Listes de diagnostics : saisie et constructeur

§6 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). Case « Accepte plusieurs
valeurs » dans `FieldForm.tsx`, rendue seulement pour le type `terminology` et soumise à
`lockStructural`. Mode multivalué de `TerminologyInput.tsx` : étiquettes numérotées, zone de
recherche maintenue sous elles, concept déjà choisi écarté des résultats, retrait de la dernière
valeur **supprimant la clé** plutôt qu'écrivant `[]`.

**Ne jamais lancer avec L4** (mêmes deux fichiers) **ni avec L13** (`TerminologyInput.tsx`). L4
étend la soupape au type `terminology` et L21 en change la cardinalité : les traiter ensemble
mélangerait deux raisonnements sur le même composant.

### L22 — Listes de diagnostics : export

§7 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). Surface Deno isolée :
aucun fichier commun avec les lots front, donc parallélisable largement.

**Commencer par le test de non-régression.** `formatValue` teste `isTerminologyValue` avant
`Array.isArray` ; une liste de diagnostics tomberait dans `v.join('; ')` et rendrait
`[object Object]` sur toute la colonne. Le même défaut a déjà frappé les codes manquants et
l'affichage des listes de patients (L1) : il doit être verrouillé par un test avant que la
fonctionnalité existe.

Puis les colonnes `nb__…`, les colonnes indicatrices `has__…` avec leur seuil de 100 codes
distincts et leur règle de normalisation, la feuille dédiée, et les lignes de dictionnaire des
colonnes dérivées.

### L23 — Listes de diagnostics : cohortes

§8 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). Front seul : les
opérateurs serveur arrivent avec L20. `operatorsFor` renvoie `has_any` et `has_none` — et eux
seuls — pour un champ multivalué. Retirer `eq` de l'interface pour ce cas n'est pas cosmétique :
une égalité sur une liste produirait un résultat faux sans le signaler.

**Ne pas lancer avec L18 ni L19** : mêmes deux fichiers.

### L24 — Listes de diagnostics : refus au mappage d'import

§9 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). L'import ne prend en
charge aucun champ `terminology`, même à valeur unique. Le lot ne l'ajoute pas : il **refuse la
cible au mappage avec un message clair**, au lieu de laisser l'utilisateur découvrir un échec
serveur opaque en fin d'import.

Petit lot, isolé, à faible risque. Il évite une régression d'usage introduite par L21 : dès qu'une
variable multivaluée existe, elle apparaît dans la liste des cibles d'import.

### L25 — Conflit hors-ligne : issue « garder les deux »

§10 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). **Séparable** : rien
dans les lots précédents n'en dépend, et son absence ne produit aucune perte silencieuse — le
conflit est déjà détecté par le jeton optimiste.

Deux appareils hors ligne qui ajoutent chacun un diagnostic produisent aujourd'hui une résolution
binaire, où `resolveKeepMine` écrase la valeur de l'autre. Le lot ajoute une troisième issue
réalisant l'union des deux listes par `code`, ordre local puis nouveautés serveur. Fonction de
domaine pure, testable sans base.

### L26 — Regroupement des variables `diagnostic_1/2/3` (à lancer SEUL, en dernier)

§12 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). **Seul lot de cette
famille qui touche des données déjà enregistrées.** À traiter après que tout le reste soit en
service, et précédé d'une sauvegarde vérifiée.

Deux opérations qui ne doivent jamais être fusionnées : créer une version de gabarit portant la
variable regroupée (n'affecte que les saisies futures), et convertir les enregistrements existants
(facultative, explicitement cochée). Une fonction d'aperçu en lecture seule précède l'exécution et
rend les valeurs non résolubles, les doublons entre `diagnostic_1` et `diagnostic_2`, et les
enregistrements déjà convertis.

L'exécution est transactionnelle par enregistrement et idempotente : une reprise après
interruption ne doit ni dupliquer une valeur ni retraiter un enregistrement. Chaque conversion est
tracée dans `field_change_log`, dont la contrainte `source` doit accueillir une valeur
supplémentaire — modification additive d'une contrainte `check` sur une table portant des données.

Surface base : appliquer `meddata-db-safety`.

### L27 — Texte d'aide par variable

Une variable n'a aujourd'hui qu'un libellé. Rien ne dit **comment** la renseigner, alors que la
réponse dépend de la définition : « score de Glasgow à l'admission » signifie-t-il le premier score
documenté, ou celui après sédation ? Deux personnes qui saisissent la même base répondent
différemment, et l'écart ne se voit jamais.

Une colonne `description` sur `template_field`, un champ dans le constructeur, une icône d'aide
dans le formulaire, et **une colonne de plus au dictionnaire d'export** — `buildDictionary` n'en
porte pas aujourd'hui, alors que c'est précisément l'endroit où un relecteur extérieur cherche la
définition d'une variable.

Le plus petit lot de la famille, et celui qui pèse le plus sur la qualité des données.

### ~~L28 — Valeur par défaut et unicité~~ — **livré le 2026-08-14** (valeur proposée seule)

`default_value` est un **préremplissage à la saisie**, jamais une valeur écrite d'office : une date
de consultation proposée à aujourd'hui, un pays proposé à Tchad. Ne jamais préremplir une variable
clinique dont la valeur par défaut orienterait la réponse.

Livré : colonne `default_value` nullable, validée au moment où la variable est enregistrée (type,
bornes, liste de valeurs) ; deux jetons dynamiques `__today__` et `__now__`, résolus **à la saisie**
en heure locale ; refus de toute proposition sur `multiselect` et `terminology` ; préremplissage à
la **création seulement**, jamais à la correction ni à l'import ; mention « proposé » qui disparaît
dès qu'on touche au champ ; **une proposition effacée ne laisse aucune clé**. Le constructeur
avertit — sans interdire — quand l'intitulé désigne un jugement clinique (complication, issue,
décès, évolution…) ou quand la forme oui/non ou liste fait de la proposition la réponse.

> **`is_unique` est écartée — décision du porteur, 2026-08-14.** Le registre ne manipule aucun
> identifiant externe saisi à la main : le seul identifiant en circulation est le code patient,
> généré par le produit et déjà protégé par `uq_patient_base_code` / `uq_identity_base_code`. Une
> contrainte d'unicité paramétrable n'aurait donc aucune variable à protéger. Le risque réel du
> registre est le doublon de **personne**, que la détection nom + date de naissance traite déjà, et
> qu'une contrainte d'unicité ne traite pas. À rouvrir seulement si un numéro de cahier de
> consultation ou un code d'inclusion saisi à la main entre dans le recueil.

Effet de bord assumé du lot : la liste des colonnes recopiées d'une version de gabarit à l'autre
était **dupliquée dans six fonctions**, et la consigne de saisie de L27 n'y avait pas été reportée
— dupliquer un gabarit perdait silencieusement toutes les consignes, et `promote_template_to_global`
perdait en plus les types de rencontre. Cette liste vit désormais dans `copy_template_fields`.

### L29 — Prévisualisation du formulaire

Le seul lot de la famille qui n'entre en collision avec rien : il ouvre son propre écran et ne
touche `TemplateVersionEditor.tsx` que pour y poser un bouton.

Voir son formulaire tel que le verra la personne qui saisit, sans créer un patient d'essai. Utile
surtout en vue mobile, où l'ordre des variables et la longueur des sections décident du confort
réel. À lancer en parallèle de n'importe quel autre lot.

### L30 — Options de liste : code interne stable

**Défaut déjà consigné** dans [`idees-post-readiness.md`](idees-post-readiness.md) §4 : le `select`
stocke le **libellé**, pas un code. Corriger une option — `hematome` en `hématome` — rend les
fiches déjà saisies invalides à la prochaine écriture et scinde une modalité en deux dans les
statistiques.

C'est le même problème que le référentiel de terminologie a résolu pour les diagnostics, resté
entier pour les listes ordinaires. Le lot lui applique la même solution : `allowed_values` devient
une liste d'objets `{ value_key, label, is_active }`, le code part en base, le libellé reste
modifiable, et une option retirée peut être désactivée sans détruire l'historique.

Il emporte donc une **conversion des données existantes**, avec les mêmes exigences que L26 :
aperçu en lecture seule, opt-in, idempotence, journalisation. Surface base : appliquer
`meddata-db-safety`.

### L31 — Sections personnalisables

`section` est un `check (section in ('clinique','biologie','paraclinique'))`, et ces trois valeurs
sont **répliquées dans neuf fichiers** : `types.ts`, `templateLibrary.ts`, `EncounterFields.tsx`,
`ImportData.tsx`, `TemplateFromFile.tsx`, `FieldForm.tsx`, `seed.sql`, la migration d'origine et
`20260711000200_template_transactionality.sql`.

Le lot le plus lourd de la famille, et le seul dont le document d'orientation sous-estimait le
coût en le qualifiant de « relativement localisé ». Une table `template_section` rattachée à
`template_version`, avec une migration de repli conservant les trois sections actuelles comme
sections par défaut de toute base existante.

Ne pas confondre la **section** — le regroupement visuel du formulaire, propre à chaque base — avec
la **catégorie de donnée** ; les deux peuvent coexister, et c'est même l'intérêt du lot.

### L32 — Affichage conditionnel

Le moteur de règles sait aujourd'hui rendre un champ **obligatoire** sous condition
(`then.operator = 'required'`, seul opérateur autorisé), comparer deux champs, et distinguer
blocage et avertissement. Il ne sait pas **montrer ou masquer**.

C'est le plus gros gain ressenti sur un formulaire long : ne montrer les variables d'imagerie que
si une imagerie a été faite.

**Décision à prendre avant de coder, et elle ne peut pas être remise à plus tard** : que devient la
valeur d'un champ déjà renseigné qui devient masqué ? Conservée et exportée — au risque qu'une
analyse compte une valeur que l'utilisateur croit avoir retirée. Ou effacée — au risque de perdre
une saisie sur un simple changement d'avis. Les deux se défendent ; le choix change la migration,
l'export et les tests. C'est le piège classique des systèmes de recueil clinique.

Le moteur reste une **structure JSON à liste blanche d'opérateurs**, jamais évaluée comme du code :
c'est la ligne posée par `templateRules.ts` et il ne faut pas en sortir.

### L33 — Raisons de valeur manquante par variable — **livré**

Livré le 2026-08-14. Une colonne `missing_reasons` porte, variable par variable, les raisons
proposées parmi cinq — les trois historiques, plus `refus` et `non_documente`.
`allow_missing_codes` est **conservé en miroir** : la liste fait foi, un déclencheur tient le
booléen à jour. Il n'est pas supprimé parce que les instantanés hors-ligne déjà téléchargés et les
PWA installées le lisent encore. Retirer une raison d'une variable en service est refusé (ajouter
reste libre), ce qui rend toute fiche ancienne modifiable par construction. `MISSING_CODES` n'est
plus recopié : `validation.ts` importe la liste du contrat d'export, et un test vérifie l'identité
de référence. Détail dans
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md).

État antérieur, pour mémoire : les trois codes (`non_fait`, `inconnu`, `non_applicable`) étaient **figés en dur** côté serveur,
identiques pour toutes les variables, et le seul réglage disponible est un booléen les autorisant
ou non en bloc.

Le lot permet de choisir, variable par variable, lesquelles proposer, et d'en ajouter deux qui
manquent à un registre clinique : **refus** du patient et **non documenté** — distinct de
« inconnu », qui laisse croire que l'information a été cherchée.

Les codes existants ne changent ni de nom ni de sens : la migration est additive et les données
déjà saisies restent lisibles telles quelles.

## Deux chantiers volontairement laissés hors des lots

**Champs calculés.** Un langage d'expression (`DATEDIFF`, `IF` imbriqués) devrait tourner à
l'identique en TypeScript, en PL/pgSQL et en Deno — trois implémentations d'une même sémantique sur
des valeurs cliniques. La bifurcation à trancher d'abord : catalogue fermé de calculs paramétrés,
ou calcul uniquement à l'export sans jamais être stocké. Tant que ce choix n'est pas fait, le lot
n'a pas de périmètre. Reste en file d'idées (`idees-fonctionnalites-futures.md` A3).

**Groupes répétables.** Plusieurs occurrences portant chacune leurs propres attributs — des
interventions avec date, type, indication. Le critère de bascule est posé au §2 de
[`spec-variables-multivaluees.md`](spec-variables-multivaluees.md) : deux attributs propres ou plus
par occurrence. C'est un chantier de la taille de L20 à L26 réunis ; il lui faut sa spécification
avant ses lots.

## Ce qui n'a pas besoin de lot


- **P5, terminologie avancée** : couverte par les lots T1 à T4 déjà livrés.
- **P1A, registre urgences** : marqué obsolète, remplacé par la terminologie.
- **Idée 5, bibliothèque de jeux de valeurs** : livrée le 26 juillet.

## Ordre suggéré — état au 2026-08-14

**Niveau atteint.** L1–L19 sont livrés, à l'exception de L14. L11 a été intégré puis promu sur
`main` (PR #176, #189, correctifs #192 et #194). Dans la famille moteur de formulaires, L27,
L28, L29 et L33 sont également livrés (PR #191/#193, #197/#198, #199/#200 et #201–#204).
Cela porte à **vingt-deux lots livrés/intégrés**.

**Travail actif.** Aucun lot fonctionnel n'est actuellement en cours ni en PR ouverte. Le fichier
`.freebuff/` non suivi dans le checkout principal n'appartient à aucun lot et doit être préservé.

L'ordre suivant reflète la priorité confirmée : terminer la famille moteur de formulaires, puis
L14 seul, puis la famille diagnostics.

1. **Famille « moteur de formulaires »**, un lot à la fois :
   1. ~~**L27**~~ — texte d'aide par variable — **livré** ;
   2. ~~**L29**~~ — prévisualisation — **livré** ;
   3. ~~**L28**~~ — valeur proposée — **livré** ;
   4. ~~**L33**~~ — raisons de valeur manquante par variable — **livré le 2026-08-14** ;
   5. **L32** — affichage conditionnel, **prochain lot** après décision explicite sur les valeurs masquées ;
   6. **L30** — codes d'options, après le reste car il convertit des données existantes ;
   7. **L31** — sections personnalisables, dernier et plus lourd.
2. **L14**, seul, après les autres ajouts de textes i18n.
3. **Famille « listes de diagnostics »** (L20 à L26), dans cet ordre :
   1. **L20 seul** — surface base, prérequis de tous les autres ;
   2. puis en parallèle **L21, L22 et L24** — à condition que **L4 et L13** soient soldés ou non
      lancés ;
   3. puis **L23** — à condition que **L18 et L19** soient soldés ou non lancés — et **L25**,
      qui ne dépend de rien ;
   4. **L26 seul, en dernier**, après sauvegarde vérifiée.

> L13, L18 et L19 sont déjà soldés. Après L20, L21, L22 et L24 peuvent donc démarrer ensemble ;
> L23 et L25 suivent ensuite. Cette famille reste reportée après les formulaires, car L21 et L22
> partagent des fichiers avec cette dernière.

> **Les deux familles se gênent aussi entre elles** : L21 et L27, L28, L30, L31, L33 touchent tous
> `FieldForm.tsx` ; L22 et L27, L30, L31, L32, L33 touchent tous `exportContract.ts`. En pratique,
> **une seule session à la fois sur le moteur de formulaires**, sauf L29 ; ne pas entamer L21/L22
> avant la fin de cette file. La priorité retenue exclut donc tout lancement de la famille
> diagnostics avant L32, L30 et L31 ; L14 suit ensuite seul.

### Leçon des trois lots menés en parallèle

L1, L2 et L5 ont tourné en même temps, et **tous trois ont fini en conflit** sur
`docs/suivi-execution-feuille-route.md`. La consigne « ajouter sa section à la
fin » ne suffit pas : quand deux lots se terminent le même jour, ils ajoutent au
même endroit. Les conflits étaient purement additifs et sans risque, mais ils ont
coûté deux résolutions manuelles et bloqué la CI d'une pull request — GitHub
n'exécute pas les contrôles tant que la fusion est impossible, ce qui donne
l'illusion trompeuse d'une PR sans vérification.

Pour la suite : soit consigner au journal **dans un commit séparé, après
fusion**, soit accepter la résolution comme une étape normale du lot.
