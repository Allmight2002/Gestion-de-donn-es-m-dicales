# Découpage des chantiers en lots parallélisables

- Établi le 2026-07-27
- Objet : permettre de lancer plusieurs chantiers **dans des sessions distinctes**
  sans que les branches se marchent dessus
- Source des contenus :
  [`idees-post-readiness.md`](idees-post-readiness.md) et
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md)

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
| **L6** | Finition de l'interface | `AppShell.tsx`, composant de case à cocher, **9 écrans** | **seul** |
| ~~L7~~ | ~~Protections de branche (B7)~~ | **Livré le 2026-08-01** | — |
| **L8** | Suppression et restauration de bases (P2) | migration, `BaseHome.tsx`, nouveaux écrans | L3, L5, L7 |
| **L9** | Modèle d'observation d'une base | migration, `NewPatient.tsx`, `FieldForm.tsx`, `BaseHome.tsx` | **seul** |
| ~~L10~~ | ~~Comptes de mission (P4)~~ | **Livré le 2026-07-29** | — |
| **L11** | Observabilité des erreurs (P3) | migration, `ErrorBoundary.tsx`, nouvel écran admin | L1, L2, L5, L7 |
| **L12** | Traitement des propositions | nouvel écran, `BaseLayout.tsx` | L2, L5, L7 |
| **L13** | Rafraîchissement de la copie locale | `terminologyCache.ts`, `TerminologyInput.tsx` | L1, L2, L5, L7 |
| **L14** | Chargement de la seule langue active | `messages.ts`, `useI18n.ts` | **seul** |

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

### L6 — Finition de l'interface

**Idée 10** : zone de profil, cases à cocher, retours visuels. Ce lot touche
**neuf écrans** pour remplacer les cases à cocher système par un composant
commun. Il entrera en conflit avec presque tout : à traiter **seul**, de
préférence quand les autres lots d'interface sont fusionnés.

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

### L8 — Suppression et restauration de bases

**P2**. La fonction serveur `soft_delete_base` existe déjà, complète et
sécurisée ; il manque la RPC de restauration et l'interface. Touche `BaseHome.tsx`
comme L1 — enchaîner après lui plutôt qu'en parallèle.

Lot à surface base : appliquer `meddata-db-safety`.

### L9 — Modèle d'observation d'une base

**Idée 8** : rendre le suivi longitudinal explicite et optionnel. Le plus large
des lots — migration, création de patient, éditeur de variables, écran de base.
À traiter **seul**, après L2 qui lui sert de préalable.

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

## Ce qui n'a pas besoin de lot

- **P5, terminologie avancée** : couverte par les lots T1 à T4 déjà livrés.
- **P1A, registre urgences** : marqué obsolète, remplacé par la terminologie.
- **Idée 5, bibliothèque de jeux de valeurs** : livrée le 26 juillet.

## Ordre suggéré

Six lots sont livrés : **L1, L2, L3, L5, L7 et L10**. Il en reste huit.

1. **En parallèle immédiat** : L4, L12 — aucun ne partage de fichier.
2. **Ensuite** : L8, L11, L13. L11 attend encore sept décisions, mais ses étapes
   locales sont réalisables sans elles.
3. **Seuls, l'un après l'autre** : L6, L9, L14. Le préalable de L9 est levé
   depuis la livraison de L2.

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
