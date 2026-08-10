# Découpage des chantiers en lots parallélisables

- Établi le 2026-07-27 · **révisé le 2026-08-10**
- Objet : permettre de lancer plusieurs chantiers **dans des sessions distinctes**
  sans que les branches se marchent dessus
- Source des contenus :
  [`idees-post-readiness.md`](idees-post-readiness.md),
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md)
  et, pour les lots L15 à L19,
  [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md)

> **Révision du 2026-08-10** : trois lots étaient livrés sans être marqués comme tels —
> **L6** (2026-08-09), **L8** (2026-08-01) et **L9** (2026-08-01). Cinq lots sont ajoutés,
> **L15 à L19**, issus de la campagne de vérification manuelle des flux multi-comptes.

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
| **L11** | Observabilité des erreurs (P3) | migration, `ErrorBoundary.tsx`, nouvel écran admin | L4, L12, L13, L15 |
| **L12** | Traitement des propositions | nouvel écran, `BaseLayout.tsx` | L4, L11, L13, L15 |
| **L13** | Rafraîchissement de la copie locale | `terminologyCache.ts`, `TerminologyInput.tsx` | L11, L12, L15, L18 |
| **L14** | Chargement de la seule langue active | `messages.ts`, `useI18n.ts` | **seul** |
| **L15** | Redirection du mot de passe des comptes de mission | `create-mission-account/index.ts`, `edge-functions.md`, `supabase/functions/.env` | **tous** (aucun écran) |
| **L16** | Compte de mission : écriture de l'identité **et** écarts d'interface | migration, `test/mission-accounts.test.ts`, `spec-comptes-mission.md`, `NewPatient.tsx`, `BaseHome.tsx`, `PatientDetail.tsx`, `AppShell.tsx` | **seul** |
| **L17** | Messages d'erreur des Edge Functions | `src/data/exports.ts`, `src/data/mission.ts`, utilitaire partagé | L11, L14, L18, L19 |
| **L18** | Cohorte dynamique : compteur vivant et « Figer maintenant » | `src/data/cohorts.ts`, `CohortBuilder.tsx` | L11, L12, L15, L16 |
| **L19** | Archivage d'une cohorte | migration, `src/data/cohorts.ts`, `CohortBuilder.tsx` | L11, L12, L15, L16 |

> **L18 et L19 touchent les deux mêmes fichiers** : ne jamais les lancer ensemble. Traiter L18
> d'abord (front seul, gain immédiat), L19 ensuite (surface base).

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

### L15 — Redirection du mot de passe des comptes de mission

**Chantier A** de [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md) §2.
Sans `MISSION_PASSWORD_REDIRECT_URL`, l'Edge Function envoie le courriel d'activation **sans**
`redirectTo` : le lien ouvre une session sur le tableau de bord, l'écran de définition du mot de
passe n'est jamais atteint, et l'étudiant se retrouve sans mot de passe à l'expiration de sa
session.

Le lot documente la variable, l'ajoute à la configuration locale, vérifie (**en lecture seule**)
la valeur configurée en production, et tranche une question ouverte : le repli silencieux
doit-il devenir une erreur explicite au démarrage de la fonction ?

Ne touche **aucun écran** : parallélisable avec n'importe quel autre lot.

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
conditionnée à `canViewIdentity`, et les quatre corrections d'écran déjà écrites sont finies et
testées.

> **Rien n'existe en code.** Une première implémentation des points d'écran avait été écrite puis
> **effacée le 2026-08-10** : elle datait d'avant que le renversement du §4 ne soit tranché, et ne
> comportait aucun test. La spécification de chaque correction reste intégralement dans le
> registre. Le lot part de zéro, avec ses tests.

Surface base : appliquer `meddata-db-safety`. Touche `AppShell.tsx`, `BaseHome.tsx`,
`PatientDetail.tsx`, `NewPatient.tsx` et `messages.ts` : à lancer **seul**.

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

## Ce qui n'a pas besoin de lot

- **P5, terminologie avancée** : couverte par les lots T1 à T4 déjà livrés.
- **P1A, registre urgences** : marqué obsolète, remplacé par la terminologie.
- **Idée 5, bibliothèque de jeux de valeurs** : livrée le 26 juillet.

## Ordre suggéré

Neuf lots sont livrés : **L1, L2, L3, L5, L6, L7, L8, L9 et L10**. Il en reste **dix** :
L4, L11, L12, L13, L14, et les cinq nouveaux L15 à L19.

1. **D'abord, et en parallèle** : **L15** (aucun écran, donc compatible avec tout) et **L17**
   (messages d'erreur). L17 mérite de passer tôt : c'est lui qui rend les prochaines séances de
   test manuel exploitables, au lieu d'obliger à ouvrir les outils de développement à chaque
   refus.
2. **Ensuite, seul** : **L16** — c'est le seul lot porteur d'une décision produit déjà tranchée
   qui n'a pas encore de traduction en base. Tant qu'elle n'est pas portée par une migration, la
   spécification et le code disent le contraire l'un de l'autre.
3. **Puis en parallèle** : L4, L12, **L18**.
4. **Ensuite** : L11, L13, **L19**. L11 attend encore sept décisions, mais ses étapes locales
   sont réalisables sans elles. L19 ne doit pas suivre L18 de trop près : mêmes fichiers.
5. **Seul, en dernier** : L14.

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
