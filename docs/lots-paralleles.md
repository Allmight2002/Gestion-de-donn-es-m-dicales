# Découpage des chantiers en lots parallélisables

- Établi le 2026-07-27 · **révisé le 2026-09-05**
- Objet : permettre de lancer plusieurs chantiers **dans des sessions distinctes**
  sans que les branches se marchent dessus
- Source des contenus :
  [`idees-post-readiness.md`](idees-post-readiness.md),
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md),
  pour les lots L15 à L19
  [`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md),
  pour les lots L20 à L26
  [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md),
  et pour les lots L38 à L44
  [`audits/audit-technique-complet-2026-08-18.md`](audits/audit-technique-complet-2026-08-18.md)

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

> **Révision du 2026-08-18** : un lot est ajouté, **L35** — variables calculées définies par
> l'utilisateur. Il est découpé dans le chantier « champs calculés » jusqu'ici laissé hors des
> lots : l'arithmétique que l'utilisateur écrit lui-même a un périmètre ; le langage d'expression
> complet et le catalogue de scores validés n'en ont toujours pas.
>
> **Un second lot est ajouté le même jour, L36**, sur un constat distinct : à l'export, un
> `multiselect` n'a pas la parité de format de la terminologie multivaluée livrée par L21/L22.
> **L37** suit le même jour : la feuille de fréquences prête à recopier, qui prolonge L36 vers le
> résultat au lieu de la matière première.

> **Révision du 2026-08-20** : sept lots sont ajoutés, **L38 à L44**, issus de
> [`audits/audit-technique-complet-2026-08-18.md`](audits/audit-technique-complet-2026-08-18.md) —
> les huit priorités de l'audit du 18 août, la priorité 8 (gouvernance, second reviewer humain)
> restant hors lot car elle n'est pas un changement de code. Ces lots sont menés sur un thread
> dédié, **en parallèle de L35** : deux chevauchements de fichier ont été identifiés — **L41**
> (`CohortBuilder.tsx`, commun avec L35) et **L41/L42 entre eux** (`NewPatient.tsx`, même
> `useCallback`) — voir leurs fiches pour l'ordre à respecter.

Le critère de découpage est le **fichier touché**, pas le thème. Deux lots qui
modifient le même fichier produiront un conflit de fusion, même si leurs sujets
n'ont aucun rapport.

Un prompt prêt à l'emploi existe pour chaque lot dans
[`prompts-lots.md`](prompts-lots.md).

**Révision du 2026-08-24, mise à jour le 2026-09-02** : le chantier d'export directement
exploitable pour l'analyse était découpé en **L45 à L50** ; **L45 à L49 sont livrés** et seul
**L50** reste différé. Le détail, les règles de données et les critères d'acceptation sont
dans [`chantiers-export-analyse.md`](chantiers-export-analyse.md). Les anciens **L36** et **L37**
ne doivent pas être lancés séparément pour ce chantier : L36 est requalifié par L47 et L37 est
écarté du profil Analyse ; une feuille de fréquences ne sera réintroduite que si un besoin
analytique explicite la justifie.

> **Révision du 2026-08-24 — alignement sur le code livré** : **L35** (variables calculées) est
> livré depuis le 2026-08-21, avec son support `datetime` et ses unités d'affichage. **L36** a été
> livré le 2026-08-20 dans son périmètre historique (profil Export complet), puis requalifié par
> **L47** pour le profil Export Analyse. Les chantiers **D10** (purge définitive) et **O0 à O5**
> (saisie hors-ligne *intake-only*) sont également déjà présents dans le code ; **O6** (preuve
> navigateur) et **O7** (activation/release) restent à faire. Cette révision corrige aussi l'état
> contradictoire de **L14**, livré le 2026-08-18.

> **Révision du 2026-09-05 — retour terrain** : les blocs cliniques restent des extensions
> conditionnelles d'une base au périmètre cohérent. Le diagnostic déjà établi devient le pilote
> nominal ; l'agent doit pouvoir enregistrer le socle même si aucun bloc ne couvre encore le code.
> **L55/L56** portent cette extension et **L57** cadre ultérieurement la reprise/notification.
> Contrat : [`spec-collecte-diagnostique.md`](spec-collecte-diagnostique.md).

## Vue d'ensemble

| Lot | Objet | Fichiers principaux | Lancer en même temps que |
|---|---|---|---|
| ~~L1~~ | ~~Liste d'une base : affichage et bandeau~~ | **Livré le 2026-07-28** | — |
| ~~L2~~ | ~~Formulaires patient : sections~~ | **Livré le 2026-07-28** | — |
| ~~L3~~ | ~~Allègement du chargement~~ | **Livré le 2026-07-28** | — |
| ~~L4~~ | ~~Soupape sur le champ diagnostic~~ | **Livré le 2026-08-13** (PR #169/#170 ; proposer « Diagnostic absent du référentiel ») | — |
| ~~L5~~ | ~~Constructeur de règles~~ | **Livré le 2026-07-28** | — |
| ~~L6~~ | ~~Finition de l'interface~~ | **Livré le 2026-08-09** | — |
| ~~L7~~ | ~~Protections de branche (B7)~~ | **Livré le 2026-08-01** | — |
| ~~L8~~ | ~~Suppression et restauration de bases (P2)~~ | **Livré le 2026-08-01** | — |
| ~~L9~~ | ~~Modèle d'observation d'une base~~ | **Livré le 2026-08-01** (migration + UI + release) | — |
| ~~L10~~ | ~~Comptes de mission (P4)~~ | **Livré le 2026-07-29** | — |
| ~~L11~~ | ~~Observabilité des erreurs (P3)~~ | **Livré et promu sur `main`** (PR #176, #189, #192, #194) | — |
| ~~L12~~ | ~~Traitement des propositions~~ | **Livré** (PR #172) | — |
| ~~L13~~ | ~~Rafraîchissement de la copie locale~~ | **Livré** (PR #180, #181) | — |
| ~~L14~~ | ~~Chargement de la seule langue active~~ | **Livré le 2026-08-18** (PR #215, `7fc71b3`) | — |
| ~~L15~~ | ~~Comptes de mission : identifiant et mot de passe générés~~ | **Livré le 2026-08-11** (`009ed3c`) | — |
| ~~L16~~ | ~~Compte de mission : création et correction de l'identité~~ | **Livré le 2026-08-11** (`dc90392`, base + interface) | — |
| ~~L17~~ | ~~Messages d'erreur des Edge Functions~~ | **Livré** (`6a453b9`, `src/lib/edgeFunctionError.ts`) | — |
| ~~L18~~ | ~~Cohorte dynamique : compteur vivant et « Figer maintenant »~~ | **Livré** (PR #159, #160) | — |
| ~~L19~~ | ~~Archivage d'une cohorte~~ | **Livré, preuve technique de production** (PR #179, #182, #184, #185, #187) | — |
| ~~L20~~ | ~~Listes de diagnostics : surface base~~ | **Livré le 2026-08-18** (PR #222, `20260818045033_multivalue_terminology_foundation.sql`) | — |
| ~~L21~~ | ~~Listes de diagnostics : saisie et constructeur~~ | **Livré le 2026-08-18** (PR #224) | — |
| ~~L22~~ | ~~Listes de diagnostics : export~~ | **Livré le 2026-08-18** (PR #225, après annulation puis restauration — voir le journal d'exécution) | — |
| ~~L23~~ | ~~Listes de diagnostics : cohortes~~ | **Livré le 2026-08-18** (PR #226, `has_any` / `has_none` seuls) | — |
| ~~L24~~ | ~~Listes de diagnostics : refus au mappage d'import~~ | **Livré le 2026-08-18** (PR #228, tout `terminology` refusé au mappage) | — |
| ~~L25~~ | ~~Conflit hors-ligne : issue « garder les deux »~~ | **Livré le 2026-08-18** (PR #229, `mergeKeepBoth` pure) | — |
| ~~L26~~ | ~~Regroupement des variables `diagnostic_1/2/3`~~ | **Clos sans exécution le 2026-08-19** — la base d'essai qui portait ces variables a été supprimée ; plus rien à convertir. Exigences conservées au §12 de la spécification | — |
| ~~L27~~ | ~~Texte d'aide par variable~~ | **Livré le 2026-08-13** (consigne de saisie ; `description` ajoutée au Dictionnaire) | — |
| ~~L28~~ | ~~Valeur par défaut et unicité~~ | **Livré le 2026-08-14** (valeur proposée ; `is_unique` écartée) | — |
| ~~L29~~ | ~~Prévisualisation du formulaire~~ | **Livré le 2026-08-14** (écran propre, bouton dans l'éditeur de version) | — |
| ~~L30~~ | ~~Options de liste : code interne stable~~ | **Livré le 2026-08-15** (`allowed_options` fait foi, `allowed_values` conservé en miroir) | — |
| ~~L31~~ | ~~Sections personnalisables~~ | **Livré le 2026-08-15** (`template_section` rattachée à la version, `section` conservé en miroir du code) | — |
| ~~L32~~ | ~~Affichage conditionnel~~ | **Livré le 2026-08-15** (valeur masquée effacée, jamais en silence) | — |
| ~~L33~~ | ~~Raisons de valeur manquante par variable~~ | **Livré le 2026-08-14** (`refus` et `non_documente` ajoutés ; `allow_missing_codes` conservé en miroir) | — |
| **L34** | Filtre d'une variable Diagnostic à valeur unique | migration (`jsonb_matches`), `CohortBuilder.tsx` | L24, L25 (L26 étant clos, sa contrainte d'exclusion tombe) |
| ~~L35~~ | ~~Variables calculées : arithmétique définie par l'utilisateur~~ | **Livré le 2026-08-21** (migrations `20260820120000`, `20260821120000`, `20260821130000`, évaluateur partagé navigateur/Edge) | — |
| ~~L36~~ | ~~Parité d'export des listes à choix multiples~~ | **Livré le 2026-08-20 dans le profil Export complet ; requalifié par L47 le 2026-08-24** | — |
| ~~L37~~ | ~~Feuille de fréquences prête à l'analyse~~ | **Écarté du profil Analyse le 2026-08-24** ; à réévaluer seulement sur besoin analytique explicite | — |
| **L38** | Interdire `inspection=paused` en production (audit P0) | `.github/workflows/coordinated-release.yml`, `scripts/release-env-check.mjs`, `scripts/check-inspection-env.mjs`, `.env.production.example` | — |
| **L39** | Durcir la persistance des brouillons cliniques (audit P1) | `src/data/drafts.ts`, `src/screens/member/EncounterForm.tsx` | — |
| **L40** | Limites de dimensions/mégapixels sur les images (audit P2) | `src/domain/imageUpload.ts` | **jamais avec L44** |
| **L41** | `react-hooks/exhaustive-deps` en erreur bloquante (audit P2) | config ESLint, 28 fichiers dont `CohortBuilder.tsx` et `NewPatient.tsx` | **jamais avant L35** (`CohortBuilder.tsx`) ; **jamais avec L42** (`NewPatient.tsx`) |
| **L42** | Génération du code patient côté serveur (audit P2) | migration (RPC d'allocation), `src/screens/member/NewPatient.tsx`, `src/data/patients.ts` | **jamais avec L41** (même fichier) |
| **L43** | Gestion explicite de l'échec de `getSession()` (audit P2) | `src/auth/AuthProvider.tsx` | — |
| **L44** | Validation DOCX/XLSX et nettoyage des métadonnées d'upload locales (audit P3 ×2) | `src/domain/imageUpload.ts`, `src/data/attachments.ts`, `src/data/inspection.ts` | **jamais avec L40** |
| ~~L45~~ | ~~Contrat des profils Export Analyse / Export complet~~ | **Livré le 2026-08-28** (`analysis`/`complete`, Analyse par défaut, profil au journal et au nom de fichier) ; **choix du profil dans l’interface le 2026-09-01** | — |
| ~~L46~~ | ~~Identifiants analytiques, noms de colonnes et feuille `Modalités`~~ | **Livré le 2026-08-28** (repli déterministe `scope__field_key`, collisions refusées, aucune migration) | — |
| ~~L47~~ | ~~Multiselect en indicatrices binaires dans le profil Analyse~~ | **Livré le 2026-08-28** (`has__…` en `0`/`1`, refus 413 au-delà de 100 codes ; Complet inchangé) | — |
| ~~L48~~ | ~~Dates XLSX natives, CSV ISO et unités des durées~~ | **Livré le 2026-08-28** (série Excel UTC, formats posés, date invalide laissée en texte) | — |
| ~~L49~~ | ~~Dictionnaire simplifié et feuille `Métadonnées`~~ | **Livré le 2026-08-28** (classeur Analyse à quatre feuilles ; Complet inchangé) | — |
| **L50** | Concepts diagnostiques et référentiel terminologique dans l'export | référentiel, contrat d'export, tests | **différé ; après L46** |
| **L51** | Blocs cliniques conditionnels : opérateur d’appartenance `contains_any` dans le moteur de règles | moteur SQL, `templateRules.ts`, `validation.ts`, `RuleForm.tsx`, i18n | L54 ; **jamais avec L52** |
| **L55** | Pilote diagnostique et couverture versionnée | règles, templates, éditeurs, copies, RPC | Après L51/L54/L52 ; jamais avec eux |
| **L56** | Socle enregistrable et suivi autorisé | formulaires, patients/bases, RPC, routes | Après L55 ; collisions L41/L42/offline ; preuve avec L53 |
| **L57** | Reprise et notifications : cadrage différé | documentation seulement | Après observations pilote L56 ; pas prêt à coder |
| **L54** | Blocs cliniques conditionnels : deux niveaux de sections et tronc commun créable explicitement | `template_section`, `template_field.section`, primitive de recopie, commandes atomiques, éditeur, rendu, hors-ligne | L51 ; **avant L52 et L53** |
| **L52** | Blocs cliniques conditionnels : visibilité au niveau **bloc** et invariants de version | moteur SQL, `templateRules.ts`, `validation.ts`, mutations de champs/sections, `RuleForm.tsx` | L53 ; **après L51 et L54**, jamais avec L51 |
| **L53** | Blocs cliniques conditionnels : projection d’export par blocs | `exportContract.ts`, `handler.ts`, `exports.ts`, `ExportPanel.tsx` | L52 ; **après L54** ; **jamais avec L50** |
| ~~D10~~ | ~~Purge définitive des bases de la corbeille~~ | **Livré le 2026-08-20** (`20260820210000_base_purge.sql`, Edge `purge-deleted-base`) | — |
| ~~O0–O5~~ | ~~Saisie hors-ligne *intake-only* : création patient/rencontre et rejeu idempotent~~ | **Code livré le 2026-08-23** (migration `20260822000000_offline_intake_idempotency.sql`, `src/data/offlineIntake.ts`) | — |
| **O6** | Preuve navigateur de la saisie hors-ligne | `e2e/offline-intake.spec.ts`, preview isolé, service worker réel | **après O0–O5 ; données fictives uniquement** |
| **O7** | Activation et preuve de release du mode *intake-only* | variables `VITE_OFFLINE_*`, documentation offline, preuve staging | **après O6 ; jamais sur une release clinique sans arbitrage** |

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

### ~~L4 — Soupape sur le champ diagnostic~~ — **livré le 2026-08-13**

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

> ✅ **L22 est restauré depuis le 2026-08-18** (`2cf39f8`), par `git revert 6775a91` et non par
> réécriture. Historique, pour comprendre l'encadré si vous le relisez : `7e83a3f` (2026-08-17)
> avait livré L22 **avant son prérequis L20**, dans le même commit que D13 et D14 ; `6775a91`
> (PR #221) a annulé la seule part L22 en conservant D13 et D14 ; L20 est arrivé ensuite
> (`cde3170`, PR #222) ; la restauration a suivi une fois L20 en place.
>
> Les deux réconciliations qu'on croyait dues à l'écart avec L20 ont été **vérifiées, et aucune
> n'a demandé de code supplémentaire** : `is_multiple` est revenu de lui-même dans le `select` de
> `handler.ts` avec le revert, et le contrat export est déjà cohérent avec les règles serveur de
> L20 — `isTerminologyList` exige une liste non vide de couples `code`/`label` stricts, `nbOf` rend
> vide sur une raison de valeur manquante et `1` sur une valeur unitaire ancienne. Portes vertes :
> `deno test generate-export` 54/54, `edge:test` 123/123, `edge:check`, `edge:lint`, `edge:fmt`,
> `release:edge:check`.

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

> ✅ **L24 est livré le 2026-08-18** (PR vers `develop`). Le refus couvre les champs `terminology`
> **à valeur unique comme multiple** — le manque est antérieur à la famille L20-L26, L21 le rend
> seulement visible. Front seul, aucune migration.

### L25 — Conflit hors-ligne : issue « garder les deux »

§10 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). **Séparable** : rien
dans les lots précédents n'en dépend, et son absence ne produit aucune perte silencieuse — le
conflit est déjà détecté par le jeton optimiste.

Deux appareils hors ligne qui ajoutent chacun un diagnostic produisent aujourd'hui une résolution
binaire, où `resolveKeepMine` écrase la valeur de l'autre. Le lot ajoute une troisième issue
réalisant l'union des deux listes par `code`, ordre local puis nouveautés serveur. Fonction de
domaine pure, testable sans base.

### ~~L26 — Regroupement des variables `diagnostic_1/2/3`~~ — **clos sans exécution le 2026-08-19**

§12 de [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). Ce lot était le seul de
la famille à toucher des **données déjà enregistrées**. Il est clos **sans avoir été implémenté** :
la base qui portait `diagnostic_1`, `diagnostic_2` et `diagnostic_3` était une base d'essai,
supprimée depuis. Il ne restait rien à convertir.

Décision du porteur, prise le 2026-08-19 après vérification de deux faits :

- **l'opération (a)**, créer une version de gabarit portant la variable regroupée, **est déjà
  faisable à la main** depuis L21 — nouvelle version, suppression des trois variables, ajout d'une
  variable `terminology` avec « Accepte plusieurs valeurs » ; L26 n'y aurait ajouté qu'un
  raccourci ;
- **l'opération (b)**, convertir les enregistrements, n'a plus de données à traiter — et c'est la
  surface la plus dangereuse du produit, celle qui réécrit des fiches déjà saisies.

Les exigences (aperçu en lecture seule, opt-in, transactionnel par enregistrement, idempotent,
journalisé, valeur non résoluble bloquante) restent écrites au §12.1 de la spécification, avec le
modèle de mise en œuvre à suivre — `20260815161000_option_key_repair.sql`, qui réalise déjà la même
figure sur les listes d'options. La famille « listes de diagnostics » est **close**.


### ~~L27 — Texte d'aide par variable~~ — **livré le 2026-08-13**

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

### ~~L29 — Prévisualisation du formulaire~~ — **livré le 2026-08-14**

Le seul lot de la famille qui n'entre en collision avec rien : il ouvre son propre écran et ne
touche `TemplateVersionEditor.tsx` que pour y poser un bouton.

Voir son formulaire tel que le verra la personne qui saisit, sans créer un patient d'essai. Utile
surtout en vue mobile, où l'ordre des variables et la longueur des sections décident du confort
réel. À lancer en parallèle de n'importe quel autre lot.

### L30 — Options de liste : code interne stable — **livré**

Livré le 2026-08-15. Une option devient `{ value_key, label, is_active }` dans une **nouvelle**
colonne `allowed_options` ; `allowed_values` est **conservée en miroir** des codes, comme
`allow_missing_codes` l'est à L33 — sans quoi une PWA non rafraîchie rendrait « [object Object] »
dans chaque menu déroulant, et toute la validation serveur aurait été à réécrire.

**Le code d'une option déjà en service est la chaîne elle-même, verbatim.** Les fiches portent donc
déjà leur code : ni les données, ni les règles de cohérence, ni les filtres de cohorte enregistrés,
ni les valeurs proposées ne sont réécrits. La migration est purement additive.

Sur une variable **déjà utilisée**, renommer un libellé, ajouter une option, en désactiver une et
les réordonner deviennent possibles ; retirer une option ou changer un code restent refusés. Avant
ce lot, `guard_template_field_update` refusait **toute** modification de la liste dès qu'une donnée
existait : corriger `hematome` était impossible, pas seulement dangereux.

La conversion (`preview_option_key_repair` / `repair_option_keys`) ne réécrit donc pas les fiches
saines : elle **répare les orphelines** laissées par les renommages antérieurs au lot. Aperçu en
lecture seule, opt-in, transactionnelle par enregistrement, idempotente par construction, tracée
dans `field_change_log` sous la source `option_key_repair`. Une valeur non rapprochable bloque sa
fiche et est rapportée. Détail dans
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md).

État antérieur, pour mémoire — **défaut consigné** dans
[`idees-post-readiness.md`](idees-post-readiness.md) §4 : le `select` stockait le **libellé**, pas
un code. Corriger une option scindait une modalité en deux dans les statistiques, sans que rien ne
le signale.

### L31 — Sections personnalisables — **livré**

Livré le 2026-08-15. Une table `template_section` rattachée à `template_version` : une section est
une structure de gabarit, elle suit le versionnement et le **gel des versions publiées**, comme les
variables. `section` est **conservée en miroir** du code, comme `allowed_values` à L30 et
`allow_missing_codes` à L33 — une PWA non rafraîchie et un instantané déjà téléchargé ne
connaîtront jamais la nouvelle table.

**Une seule notion a été retenue**, décision prise avec le porteur : la section est le regroupement
visuel du formulaire. Aucune catégorie de donnée séparée n'est introduite — rien ne la lirait
aujourd'hui, et l'ajouter reste additif plus tard.

Toute base existante conserve ses trois sections, dans leur ordre, avec leurs codes : un client non
rafraîchi voit exactement ce qu'il voyait. Le filet de `EncounterFields` est préservé et posé aussi
au niveau des données — une variable dont la section est inconnue reste affichée sous « Autre ».
Détail dans [`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md).

**Le constat d'entrée sous-estimait la surface.** Trois sites de production supplémentaires
portaient la liste en dur, dont `create_template_bundle` (recopie n° 3, dans
`20260814090000`) et les trois fonctions de `20260815160000` qui transportent `section`. Avec
`messages.ts` et `exportContract.ts`, la surface réelle est base + Edge + i18n + hors-ligne, pas
« relativement localisé ».

### L32 — Affichage conditionnel — **livré**

Livré le 2026-08-15. Une troisième forme de règle, dans la même structure JSON à liste blanche
d'opérateurs : `{ if: {field, operator, value}, then: {field, operator: 'visible'} }`.
`then.operator` n'accepte que deux verbes, `required` et `visible`.

**La décision bloquante est tranchée : la valeur d'un champ qui devient masqué est effacée, jamais
en silence.** L'écran annonce le nombre de valeurs concernées et n'efface qu'à l'enregistrement ;
abandonner la saisie ne perd donc rien. Une condition non vérifiable vaut « masqué ». L'ordre
d'évaluation — visibilité d'abord, obligation ensuite — est imposé par la base, et les cycles sont
refusés à l'enregistrement de la règle. Détail dans
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md).

État antérieur, pour mémoire : le moteur savait rendre un champ **obligatoire** sous condition
(`then.operator = 'required'`, seul opérateur autorisé), comparer deux champs, et distinguer
blocage et avertissement. Il ne savait pas **montrer ou masquer**.

C'est le plus gros gain ressenti sur un formulaire long : ne montrer les variables d'imagerie que
si une imagerie a été faite.

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

### L34 — Filtre d'une variable Diagnostic à valeur unique

Défaut **antérieur** à la famille L20-L26, nommé pendant L23 le 2026-08-18 et volontairement non
corrigé par lui. `jsonb_matches` compare `p_data ->> field` ; or une variable Diagnostic à valeur
unique enregistre un couple `{code, label}`, si bien que la comparaison porte sur sa représentation
JSON entière. « est » et « figure dans » ne renvoient donc jamais personne, et surtout **« n'est
pas » renvoie tout le monde — y compris les patients portant le diagnostic censé être exclu**, sans
que rien ne le signale.

L23 a retiré ces opérateurs de l'interface : c'est un garde-fou, pas une réparation. Ce lot les
rétablit en les rendant justes, ce qui **exige une migration** — d'où sa sortie du périmètre « front
seul » de L23.

**La décision à trancher avant de coder** : corriger `eq`/`neq`/`in` en place, auquel cas les
cohortes dynamiques existantes changent de population sans que leur critère ait bougé ; ou ajouter
des opérateurs distincts, auquel cas rien ne bouge mais deux syntaxes cohabitent. Le lot impose par
ailleurs un **inventaire en lecture seule** des cohortes bâties sur une variable Diagnostic : leur
population a été calculée avec le défaut.

### ~~L35 — Variables calculées : arithmétique définie par l'utilisateur~~ — **livré le 2026-08-21**

> **État vérifié dans le code** : le lot est livré. La formule est versionnée avec le gabarit,
> évaluée par un contrat partagé entre le navigateur et `generate-export`, jamais stockée dans les
> données cliniques ; les variables calculées sont exclues de la complétude, de l'import et des
> cohortes. Les migrations additives `20260820120000_template_field_formula.sql`,
> `20260821120000_template_field_formula_datetime.sql` et
> `20260821130000_template_field_formula_units.sql` couvrent la grammaire, `datetime` et les
> unités d'affichage. Le détail de l'implémentation et des contrôles exécutés est consigné dans
> [`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md#lot-l35--variables-calculées--arithmétique-définie-par-lutilisateur-2026-08-20).

L'utilisateur définit une variable dont la valeur est un calcul sur d'autres variables du même
gabarit : `duree_sejour = date_sortie − date_entree`, `delta_score = score_j7 − score_j0`. Il
l'obtient aujourd'hui en calculant hors de l'outil, ou en saisissant une colonne redondante qui se
désynchronise dès qu'un opérande est corrigé.

**Ce lot ne livre aucune formule : il livre la calculatrice.** La formule appartient à celui qui
définit le gabarit, au même titre que le libellé, les bornes et les valeurs autorisées. C'est ce
qui sépare ce lot de l'idée A3 « scores automatiques » : livrer un IMC ou un Glasgow, c'est nous
qui écrivons le calcul, et le registre répond alors de sa version, de sa validité et des droits
d'usage de l'échelle. Ici, non.

**Périmètre.** `+ − × ÷` entre variables `number`/`integer` et constantes littérales, plus
`date/date-heure − date/date-heure` qui rend un nombre de jours (potentiellement fractionnaires
si une date-heure intervient). Rien d'autre : pas de condition, pas d'imbrication, pas d'appel de
fonction. Les opérandes sont des variables **saisies** du même gabarit — une variable
calculée ne peut pas en référencer une autre, ce qui **supprime** la détection de cycles au lieu de
la traiter. Le type de sortie est déduit et affiché par le constructeur, jamais choisi.

**Le résultat n'est jamais stocké**, et c'est ce qui rend le lot petit. `src/domain/export.ts`
n'est qu'un ré-export de `supabase/functions/generate-export/exportContract.ts` : le front et
l'Edge Function de production lisent le **même** module TypeScript. Un évaluateur posé là tourne à
l'identique aux deux endroits, et les « trois implémentations d'une même sémantique » redoutées au
chantier resté hors des lots tombent à une seule — à la condition exacte que PL/pgSQL n'ait jamais
à évaluer la formule. Le hors-ligne suit sans travail supplémentaire, l'évaluateur étant déjà
côté client.

**Le prix, à assumer explicitement** : on ne peut pas bâtir de cohorte sur une variable calculée.
`jsonb_matches` compare `p_data ->> field`, et la clé n'existe pas. Le filtre serait muet, pas
faux — mais l'interface doit le dire, sans quoi la variable sera cherchée dans le constructeur de
cohortes. C'est aussi la porte de sortie du lot : le jour où le filtrage devient nécessaire, un lot
suivant devra porter la formule en PL/pgSQL et affronter la question du recalcul.

**Valeurs manquantes (L33).** Si un opérande est absent ou porte l'un des cinq codes — `non_fait`,
`inconnu`, `non_applicable`, `refus`, `non_documente` — le résultat est **absent**, jamais zéro.
Une division par zéro donne également un résultat absent, ni erreur ni infini. Corollaire à ne pas
manquer : une variable calculée doit être **exclue de la complétude** (B1) et de la file « à
compléter » (B2). Rien n'étant stocké, elle y apparaîtrait à 0 % chez tout le monde, et personne
ne pourrait « aller la compléter ».

**Import.** Une variable calculée ne doit pas être proposée au mappage (`src/domain/import.ts`) :
la colonne importée serait ignorée en silence, ou contredirait la formule. Refus explicite, sur le
modèle de L24.

**La décision à trancher avant de coder** : la formule appartient-elle à la version de gabarit,
comme les autres attributs de variable ? Si oui, corriger une formule fausse ne répare pas les
fiches saisies sous l'ancienne version — cohérent avec la complétude, qui évalue déjà chaque
dossier contre sa propre version, mais contre-intuitif pour une valeur qui n'est pas une donnée
saisie. Si non, toute correction réécrit rétroactivement des résultats déjà lus et cités.
Recommandation : rattacher à la version, et rendre la republication du gabarit visible.

Taille comparable à L27 ou L28. **Jamais avec L21 à L24 ni L34** : `FieldForm.tsx`,
`exportContract.ts`, `import.ts` et `CohortBuilder.tsx` sont exactement leurs fichiers.

### ~~L36 — Parité d'export des listes à choix multiples~~ — **livré le 2026-08-20, requalifié par L47 le 2026-08-24**

> Cette analyse reste conservée comme historique du constat. Pour la cible actuelle, L47 porte la
> représentation des multiselect dans le profil **Export Analyse** ; L36 ne doit plus être lancé
> séparément.

Un `multiselect` sort en **deux colonnes** — libellés et codes, joints par `; ` (`optionCells`,
`exportContract.ts:155`). La terminologie multivaluée livrée par L21/L22 en sort avec, en plus, une
colonne `nb__`, des indicatrices `has__…` en 1/0 et une feuille dédiée au format long. Pour compter
les dossiers portant un signe, l'analyste doit donc découper une cellule à la main — exactement le
travail que le format long existe pour éviter.

**Ce n'est pas un oubli, c'est structurel.** Cinq portes se ferment successivement.
`columnsForFields` (`:219`) teste `type === 'terminology'` **avant** `isMultiple` : un `multiselect`
n'atteint jamais la branche multivaluée, il tombe dans `isOptionList` et repart avec ses deux
colonnes. `assignField` (`:326`) sort par `if (field.type !== 'terminology') return;` avant d'écrire
`nb__`. `extractMultivalueCodes` (`:362`) et la construction des feuilles dans `handler.ts` (`:576`)
filtrent tous deux sur `isMultiple`. Or `is_multiple` est hors d'atteinte : la contrainte
`template_field_multiple_terminology_only`
(`20260818045033_multivalue_terminology_foundation.sql:13-15`) impose
`check (not is_multiple or type = 'terminology')`. Enfin `buildMultivalueTable` (`:542`) ne sait
lire que `isTerminologyList`/`isTerminologyValue`, alors qu'un `multiselect` stocke un `string[]` de
codes d'option — une forme de valeur qu'elle ne reconnaît pas.

**La double garde de `columnsForFields` est le point à ne pas manquer** : relâcher `isMultiple` ne
suffirait pas, puisque le test de type se ferme en amont. Il faut ajouter une branche, pas assouplir
un filtre.

L30 avait livré les codes d'option stables (`option_code__`), pas la parité de format — d'où la
confusion légitime : la moitié visible du travail était faite.

**Décision retenue — option A, la couche export seule.** `is_multiple` reste réservé à la
terminologie ; c'est `generate-export` qui reconnaît `multiselect` comme une liste multivaluée. Le
lot ne touche donc **ni migration, ni validation serveur, ni constructeur, ni instantané
hors-ligne**. Cette propriété vaut d'être protégée : c'est elle qui sépare un lot d'export d'un
chantier de la taille de L20.

**L'option B — étendre `is_multiple` au `multiselect` — est écartée** : elle exigerait une
migration, la validation, le constructeur et l'instantané hors-ligne pour un besoin exclusivement
d'analyse.

**Ce que le lot ajoute** : `nb__<champ>`, les indicatrices `has__<champ>__<code>` en 1/0 sous le
même plafond `MAX_INDICATOR_CODES` (100 codes distincts, `:342`) et la même normalisation
`normalizeIndicatorSuffix` (`:344`), une feuille dédiée au format long
`patient_code/encounter_id/rang/code/label` par généralisation de `buildMultivalueTable`, et les
lignes de dictionnaire correspondantes. Les libellés viennent de `allowed_options` via
`labelOfOption` (L30) ; **un code inconnu reste rendu tel quel**, règle verrouillée par le test
`exportContract_test.ts:200-205` — dans la feuille longue il ressortira donc identique en `code` et
en `label`. Une valeur manquante codifiée met les indicatrices à 0, comme pour la terminologie
(`:449-450`).

**Le dictionnaire nomme les indicatrices par leur code, pas par leur libellé.** `buildDictionary`
écrit `label: ${f.label} — ${ind.code}` (`:694`) alors que `IndicatorMeta` porte déjà un champ
`label`, renseigné en `:399` par `labelByCode.get(code) ?? code`. Le libellé est donc calculé,
transporté, puis ignoré : le médecin qui ouvre le dictionnaire lit « Signes — fievre » au lieu de
« Signes — Fièvre », et sur un diagnostic « Diagnostics — S06.5 » sans son intitulé. Correction
d'une ligne, à porter par ce lot puisqu'elle est dans la fonction qu'il modifie — en notant qu'elle
**améliore aussi la sortie de la terminologie multivaluée**, pas seulement celle du `multiselect`.

**Le test à réécrire, pas à supprimer.** « liste multiple : libelles et codes voyagent dans le meme
ordre » (`exportContract_test.ts:207-220`) fige aujourd'hui les deux colonnes. Ce qu'il garantit de
précieux, c'est l'**ordre** partagé entre libellés et codes ; seul le nombre de colonnes attendu
change.

**Historique de la mise en œuvre (avant requalification).** Le `select` à valeur unique restait
**exclu de ce lot** : sa colonne
`option_code__` est déjà analysable telle quelle, et une feuille longue d'une ligne par dossier
n'apporterait rien. La feuille de fréquences envisagée par l'ancien L37 a depuis été écartée du
profil Analyse ; les modalités des `select` relèvent désormais du contrat L46. La valeur de `nb__`
pour un code de valeur manquante était 0, comme les indicatrices.

**Effet de bord à surveiller** : le plafond de cellules XLSX. `handler.ts` compte déjà les cellules
des feuilles multivaluées (`:594`) ; généraliser au `multiselect` multiplie les feuilles et
rapproche donc le plafond sur les bases larges. Le mécanisme existe, c'est son déclenchement qui
devient plus probable.

**Règle de collision historique :** jamais avec L22 ni L35 ; les trois lots écrivaient dans
`exportContract.ts`. L36 étant livré et requalifié, cette règle ne déclenche plus un lancement.

### ~~L37 — Feuille de fréquences prête à l'analyse~~ — écarté du profil Analyse

> Une feuille de fréquences n'appartient pas au MVP de simplification. Elle pourra être réévaluée
> dans un lot ultérieur si un besoin analytique explicite le justifie ; L37 ne doit pas être lancé
> séparément de la cible L45-L49.

L36 donne au médecin des colonnes qu'il peut sommer ; ce lot lui donne la somme. Une feuille
`Fréquences` dans le classeur, une ligne par valeur : `variable`, `code`, `libellé`, `n` (dossiers
portant la valeur), `dénominateur`, `%`, `n_manquants`. C'est le tableau de fréquences d'un
article, prêt à recopier — le geste que l'analyste refait à la main à chaque étude.

**Le dénominateur est tranché** (décision du 2026-08-18). Un dossier où la variable ne s'applique
pas, ou qui porte l'un des cinq codes de valeur manquante (`non_fait`, `inconnu`,
`non_applicable`, `refus`, `non_documente`), **sort du dénominateur** et est compté dans
`n_manquants`. Deux fièvres sur trois dossiers renseignés font 67 %, avec « 1 non documenté »
à côté — et non 2 sur 4 = 50 %, qui ferait baisser le pourcentage à cause d'une donnée absente
plutôt que d'un signe absent. Le dénominateur et le nombre de manquants sont **des colonnes**, pas
une note de bas de page : le pourcentage doit être vérifiable sans quitter la feuille.

**L'unité de comptage est la ligne de la feuille principale, et c'est le piège du lot.** En mode
rencontre, une ligne égale une rencontre. En mode patient, `buildPatientExport` ne retient
**qu'une seule** rencontre par patient — `pickEncounter` avec `AggregationRule = 'first' | 'last'`
(`:461`) — alors que `extractMultivalueCodes` (`:477-478`) et `buildMultivalueTable`
(`handler.ts:587`) reçoivent **toutes** les rencontres. Compter sur toutes les rencontres en mode
patient donnerait à un patient suivi cinq fois un poids de cinq dans un tableau dont la feuille
principale ne le montre qu'une fois. Les fréquences se calculent sur les lignes **effectivement
produites**, jamais sur les données d'entrée.

**Couverture uniforme envisagée dans l'ancien périmètre** : `select`, `multiselect`, terminologie
à valeur unique et terminologie multivaluée. C'était ce qui distinguait ce lot de L36 et ce qui
était présenté comme le point laissé ouvert par lui : un `select` n'a pas besoin d'indicatrices,
mais il a autant besoin d'une table de fréquences que les autres. Cette extension n'est toutefois
pas livrée dans le profil Export Analyse : L37 reste écarté et les modalités des `select` relèvent
du contrat L46.

**Le plafond de 100 codes ne s'applique pas ici.** `MAX_INDICATOR_CODES` (`:342`) existe parce
qu'une colonne coûte cher ; une ligne ne coûte rien. Une variable écartée des indicatrices par
`omittedFieldKeys` doit donc **quand même** recevoir ses fréquences — ce lot rend analysables
précisément les variables sur lesquelles L36 renonce.

**Valeurs jamais observées.** Pour un `select` et un `multiselect`, l'espace des valeurs est connu
du gabarit (`allowed_options`, L30) : une valeur jamais cochée peut figurer avec `n = 0`, ce qui
est une information (« aucun dossier ne porte X »). Pour la terminologie, l'espace est le
référentiel entier : seules les valeurs observées sont listées.

**Sur une variable multivaluée, la somme des pourcentages dépasse 100 %.** C'est normal — un
dossier porte plusieurs valeurs — mais la feuille doit l'écrire, faute de quoi un relecteur y
verra une erreur de calcul.

**XLSX seulement.** Les feuilles annexes n'existent pas en CSV (`handler.ts:593-594`, et
`dictionary_included: format === 'xlsx'` en `:659`). Un export CSV ne portera donc pas la feuille
de fréquences, ce qui est cohérent : le CSV s'adresse à qui sait programmer, et c'est précisément
le lecteur qui n'a pas besoin de ce lot.

Poser le calcul dans un **module dédié** plutôt que dans `exportContract.ts` limiterait la surface
de conflit, conformément au critère de découpage de ce document ; `handler.ts` et le décompte de
cellules XLSX restent partagés de toute façon.

**Jamais avec L22, L35 ni L36.**

### L38 — Interdire `inspection=paused` en production

Priorité 1 de l'audit du 18 août, seul constat coté **critique**. Le workflow de release
coordonnée accepte aujourd'hui `inspection=paused` quel que soit `target` : une release
`production` peut donc s'exécuter sans verdict antivirus serveur strict sur les fichiers
téléversés, alors que le mode `paused` a été conçu pour le staging fictif (voir
[`project-deploiement`](../CLAUDE.md) et le journal B2 de
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md), qui documente déjà
`paused` comme état exceptionnel, jamais comme réglage de production).

À faire échouer le workflow, pas à corriger en silence : `target=production` et
`inspection != strict` doit être un refus explicite, avant tout job de déploiement, avec
`.env.production.example` aligné sur `strict` par défaut. La demande d'un mode « break-glass »
séparé pour les cas exceptionnels est une décision à trancher avec le porteur avant de l'ajouter
— elle ouvrirait volontairement une dérogation, à ne pas faire sans arbitrage.

Fichiers principaux (confirmés) : `.github/workflows/coordinated-release.yml`,
`scripts/release-env-check.mjs`, `scripts/check-inspection-env.mjs`,
`scripts/activate-strict-inspection.mjs`, `.env.production.example`. Aucun code applicatif
React ni migration : lot CI/config, isolé de tous les autres.

### L39 — Durcir la persistance des brouillons cliniques

Priorité 2 de l'audit (sévérité élevée). **Point à vérifier avant de coder** : `src/data/drafts.ts`
documente déjà que le brouillon « ne stocke QUE des données ANALYTIQUES (jamais d'identité) » et
qu'il est partitionné par utilisateur courant — donc une partie du risque décrit par l'audit
(confusion avec l'identité patient) ne s'applique pas tel quel ; ce qui reste vrai, c'est que les
valeurs cliniques analytiques (résultats, dates, observations) restent lisibles en clair dans le
profil navigateur pendant 72 heures.

**La recommandation principale de l'audit — déplacer le brouillon vers le serveur — contredit un
choix produit délibéré** : MedData est hors-ligne d'abord, et le formulaire de rencontre doit
rester utilisable sans réseau (voir [`project-hors-ligne`](../CLAUDE.md)). Un brouillon
serveur-only romprait cette garantie. Les pistes de repli listées par l'audit lui-même
conviennent mieux : réduire fortement le TTL (72 h est long pour une anti-perte), migrer de
`localStorage` vers une base locale déjà chiffrée/partitionnée comme celle utilisée pour la
copie de terminologie ou l'outbox hors-ligne plutôt qu'un `localStorage` brut, et purger plus
agressivement (à la sortie de l'écran réussie, pas seulement au logout).

**Décision à trancher avant de coder** : quel support de repli (IndexedDB dédié vs. TTL réduit
seul) et quel nouveau TTL. Fichiers principaux : `src/data/drafts.ts`, `src/data/drafts.test.tsx`,
`src/screens/member/EncounterForm.tsx`. Aucune surface base.

### L40 — Limites de dimensions/mégapixels sur les images

Priorité 3 de l'audit (sévérité moyenne). `src/domain/imageUpload.ts` borne déjà
`MAX_IMAGE_BYTES` (8 Mo) mais rien ne borne les dimensions décodées : une image très compressée
mais énorme peut coûter cher en mémoire au décodage, avant même l'envoi. Ajouter une vérification
`naturalWidth`/`naturalHeight` (ou équivalent `createImageBitmap`) avant réencodage, avec des
plafonds explicites, et libérer la ressource de décodage une fois la validation faite.

Fichier principal : `src/domain/imageUpload.ts`, qui porte déjà `ALLOWED_ATTACHMENT_FORMATS` —
**partagé avec L44**, à ne pas lancer ensemble.

### L41 — `react-hooks/exhaustive-deps` en erreur bloquante

Priorité 4 de l'audit (sévérité moyenne). La règle est aujourd'hui en `warn` dans la config
ESLint, et 28 fichiers portent une suppression explicite — dont `CohortBuilder.tsx`.

**Collision structurelle avec L35** : `CohortBuilder.tsx` est l'un des cinq fichiers de L35. Ce
lot ne doit **jamais démarrer avant que L35 soit fusionné** — sans quoi une correction de
dépendances et l'ajout de la logique de variable calculée modifieraient le même `useEffect` en
parallèle, avec un risque de conflit sémantique et pas seulement textuel.

Chaque suppression doit être vérifiée une par une, pas juste basculée en `error` globalement : une
dépendance manquante ajoutée sans réflexion peut déclencher une boucle de rendu ou une requête en
trop. C'est le plus long des sept lots de cette famille.

**Seconde collision, avec L42** : la suppression à corriger dans `NewPatient.tsx:121` porte
exactement sur le `useEffect`/`useCallback` dont L42 réécrit le contenu (retrait du calcul local
du code patient, ligne 114). Ne pas lancer les deux ensemble sur ce fichier.

### L42 — Génération du code patient côté serveur

Priorité 5 de l'audit (sévérité moyenne-faible). `NewPatient.tsx:114` calcule
`` `P-${String(existing + 1).padStart(4, '0')}` `` côté client à partir du dernier compte connu :
deux créations simultanées sur la même base peuvent proposer le même code. La contrainte
d'unicité en base empêche la corruption des données, mais l'utilisateur reçoit une erreur au lieu
d'un code correct du premier coup.

Migration additive portant une fonction/RPC transactionnelle d'allocation (`nextval` sur une
séquence par base, ou verrou en lecture sur le dernier code), appelée par `src/data/patients.ts`
à la création ; `NewPatient.tsx` perd son calcul local et affiche le code retourné par le serveur.
Surface base : appliquer `meddata-db-safety`.

**Collision avec L41** : la ligne 114 retirée par ce lot est dans le même `useCallback` que la
suppression `exhaustive-deps` de la ligne 121, que L41 traite. Ne pas lancer les deux ensemble.

### L43 — Gestion explicite de l'échec de `getSession()`

Priorité 6 de l'audit (sévérité moyenne-faible). `src/auth/AuthProvider.tsx` initialise la
session à partir d'une Promise sans traitement explicite du rejet dans le chemin principal :
un échec réseau au démarrage peut laisser l'application en chargement indéfini plutôt que de
retomber proprement sur l'écran de connexion. Ajouter un `.catch` (ou bloc `try/catch` sous
`await`) qui bascule sur l'état déconnecté — comportement fail-closed cohérent avec le reste de
l'authentification. Petit lot isolé, aucune surface base.

### L44 — Validation DOCX/XLSX et nettoyage des métadonnées d'upload locales

Regroupe les priorités 7a et 7b de l'audit (sévérité faible chacune), toutes deux dans le
périmètre Storage/upload — sur le modèle de L24, petit lot isolé à faible risque :

- la validation des documents Office s'appuie sur l'**extension**, pas sur une inspection de la
  structure OOXML (`[Content_Types].xml`, `word/`, `xl/`) ; un fichier renommé avec la bonne
  extension mais un contenu différent passe le contrôle client. Le porteur voudra peut-être
  confirmer que l'inspection serveur (ClamAV, scanner strict) reste la vraie ligne de défense ici
  — le contrôle client n'a jamais eu vocation à être une validation de format faisant autorité ;
- certaines clés d'idempotence d'upload dans `src/data/inspection.ts` transportent des métadonnées
  en clair (scope, hash, label) ; les remplacer par des clés opaques et nettoyer après
  finalisation.

Fichiers principaux : `src/domain/imageUpload.ts` (catalogue de formats — **partagé avec L40**,
à ne pas lancer ensemble), `src/data/attachments.ts`, `src/data/inspection.ts`.

### ~~D10 — Purge définitive des bases de la corbeille~~ — **livré le 2026-08-20**

Le chantier D10 est déjà livré hors de la séquence L1–L50. La migration additive
`20260820210000_base_purge.sql`, l'Edge Function `purge-deleted-base` et l'interface de corbeille
gèrent une purge immédiate, explicite et irréversible, avec manifeste Storage, reprise idempotente,
conservation des preuves d'audit/export et suppression PostgreSQL transactionnelle. Le détail et
les vérifications sont dans la section D10 du
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md#lot-d10--purge-définitive-des-bases-de-la-corbeille-2026-08-20).

### ~~O0 à O5 — Saisie hors-ligne *intake-only*~~ — **code livré le 2026-08-23**

Le contrat local, le contexte de formulaire préparé en ligne, les créations patient/rencontre,
le rejeu ordonné et le Centre de synchronisation sont implémentés dans
`src/data/offlineIntake.ts` et les écrans patient. La migration
`20260822000000_offline_intake_idempotency.sql` ajoute les reçus serveur et les RPC
`replay_patient_create` / `replay_encounter_create`, avec empreinte recalculée côté serveur,
verrou de rejeu et transaction avec la création clinique. Le mode reste protégé par
`VITE_OFFLINE_MODE=demo`, `VITE_OFFLINE_ADMIN_ACK=true` et `VITE_OFFLINE_INTAKE=demo` ; il ne
constitue donc pas une autorisation de données réelles.

La preuve navigateur O6 (`e2e/offline-intake.spec.ts`) et l'activation/release O7 restent ouverts.
Tant qu'ils ne sont pas validés, les builds persistants gardent le mode hors-ligne désactivé.

## Deux chantiers volontairement laissés hors des lots

**Langage d'expression et catalogue de scores validés.** Le sous-ensemble utile — une
arithmétique que l'utilisateur écrit lui-même — est sorti d'ici et fait l'objet de **L35**. Ce qui
reste dehors, ce sont les deux extrémités. D'un côté un langage complet (`DATEDIFF`, `IF`
imbriqués, conditions), qui devrait tourner à l'identique en TypeScript, en PL/pgSQL et en Deno —
trois implémentations d'une même sémantique sur des valeurs cliniques. De l'autre un catalogue
fermé de scores livrés avec leur formule — IMC, Glasgow, clairance : c'est alors nous qui écrivons
le calcul, et le registre répond de sa version, de sa validité et des droits d'usage de l'échelle.
Les deux restent en file d'idées (`idees-fonctionnalites-futures.md` A3).

**Groupes répétables.** Plusieurs occurrences portant chacune leurs propres attributs — des
interventions avec date, type, indication. Le critère de bascule est posé au §2 de
[`spec-variables-multivaluees.md`](spec-variables-multivaluees.md) : deux attributs propres ou plus
par occurrence. C'est un chantier de la taille de L20 à L26 réunis ; il lui faut sa spécification
avant ses lots.

## Ce qui n'a pas besoin de lot


- **P5, terminologie avancée** : couverte par les lots T1 à T4 déjà livrés.
- **P1A, registre urgences** : marqué obsolète, remplacé par la terminologie.
- **Idée 5, bibliothèque de jeux de valeurs** : livrée le 26 juillet.
- **Priorité 8 de l'audit du 18 août, gouvernance GitHub (second reviewer humain)** : ce n'est pas
  un changement de code, mais une décision organisationnelle (qui relit, quand la dérogation
  mono-personne saute) qui revient au porteur. À consigner comme décision plutôt qu'à découper en
  lot le jour où un second relecteur rejoint le projet.

## Complément terrain — L55 à L57

**Non implémenté, révision du 2026-09-05.** [Contrat détaillé](spec-collecte-diagnostique.md)
et [prompts](prompts-lots.md). L51 inclut désormais les codes terminologiques exacts ; L52
confirme les retraits de données après changement diagnostique ; L53 conserve les cas non
couverts éligibles. L55 configure le pilote et calcule la couverture sans statut redondant.
L56 livre le parcours et la file sécurisée. L57 cadre ultérieurement la reprise des versions
et les notifications, sans implémentation anticipée. La mission reste mono-base.

Ordre conseillé avec un agent : **L51 → L54 → L52 → L55 → L56 → L53 → preuve pilote**,
puis cadrage L57. L53 peut être avancé après L54. Les compatibilités de fichiers indiquent
des possibilités, pas une consigne de déléguer. Les travaux de L55 partagent aussi les copies
de version ; séquencer avec L54. La preuve intégrée L56 inclut l’export après L53.

## Ordre suggéré — état documentaire au 2026-09-05

**Niveau atteint.** Les lots **L1 à L33** sont soldés : 32 sont livrés et **L26 est clos sans
exécution**. **L14 est bien livré le 2026-08-18**. **L35** est livré le 2026-08-21. **L36** a
été livré dans son périmètre historique le 2026-08-20, puis requalifié par L47 pour le profil
Export Analyse. **D10** et **O0 à O5** sont livrés hors de la séquence L1–L50. Le chantier
d'export **L45 à L49** est livré : contrat serveur le 2026-08-28, choix du profil dans
l'interface le 2026-09-01.

**Travail actif.** Aucun lot fonctionnel n'est actuellement en cours ni en PR ouverte. Le fichier
`.freebuff/` non suivi dans le checkout principal n'appartient à aucun lot et doit être préservé.

Restent ouverts : **L34**, les lots d'audit **L38 à L44**, **L50** (différé, il attend un
référentiel diagnostique gouverné), les blocs cliniques conditionnels **L51 à L54**, la collecte **L55/L56**, le cadrage différé
**L57**, ainsi que **O6** et
**O7** pour la preuve et l'activation du mode *intake-only*. **L37** est écarté du profil Analyse
et **L36** ne doit plus être relancé séparément ; voir les révisions en tête du document.

1. ~~**Famille « moteur de formulaires »**~~ — **close le 2026-08-15** :
   1. ~~**L27**~~ — texte d'aide par variable — **livré** ;
   2. ~~**L29**~~ — prévisualisation — **livré** ;
   3. ~~**L28**~~ — valeur proposée — **livré** ;
   4. ~~**L33**~~ — raisons de valeur manquante par variable — **livré le 2026-08-14** ;
   5. ~~**L32**~~ — affichage conditionnel — **livré le 2026-08-15** ; la décision sur les valeurs
      masquées est prise : effacées, jamais en silence ;
   6. ~~**L30**~~ — codes d'options — **livré le 2026-08-15** ; la reprise est additive (le code
      d'une option en service est la chaîne elle-même), la conversion ne traite que les
      orphelines ;
   7. ~~**L31**~~ — sections personnalisables — **livré le 2026-08-15** ; une seule notion (la
      section visuelle), gel total sur version publiée, miroir sur le code.
2. ~~**Famille « listes de diagnostics »**~~ (L20 à L26) — **close le 2026-08-19** :
   1. ~~**L20**~~ — surface base — **livré le 2026-08-18** ;
   2. ~~**L21**, **L22**, **L24**~~ — saisie, export, refus au mappage — **livrés le 2026-08-18** ;
   3. ~~**L23**~~ et ~~**L25**~~ — cohortes et conflit hors-ligne — **livrés le 2026-08-18** ;
   4. ~~**L26**~~ — **clos sans exécution le 2026-08-19** : la base d'essai qui portait
      `diagnostic_1/2/3` a été supprimée, il n'y a plus rien à convertir.
3. ~~**L35**~~ — variables calculées — **livré le 2026-08-21** ; ses fichiers partagés ne sont
   plus une collision active pour les lots futurs.
4. **L34**, seul sur sa migration et sa surface `CohortBuilder.tsx` ; il ne doit pas réactiver les
   opérateurs retirés par L23 sans inventaire des cohortes concernées.
5. **L38 à L44**, dans l'ordre décidé par l'audit et en respectant les collisions L40/L44 et
   L41/L42. L38 reste prioritaire : il n'est pas couvert par la livraison offline, qui demeure
   désactivée en production.
6. ~~**L45 à L49**~~ — **livrés** ; le jalon MVP de l'Export Analyse est atteint. Le détail par
   lot est dans [`chantiers-export-analyse.md`](chantiers-export-analyse.md). La preuve sur le
   site déployé reste à produire.
7. **L50**, différé après L46 : il dépend du référentiel diagnostique et ne doit pas retarder le
   jalon MVP de l'Export Analyse.
8. **L51** et **L54** peuvent être menés en parallèle : opérateur `contains_any` d'un côté,
   hiérarchie de sections et tronc commun créable explicitement de l'autre. **L54** doit être fusionné avant
   L52 et L53 ; L51 et L52 ne tournent jamais ensemble.
9. Après L51 + L54, **L52** sécurise la visibilité de bloc et les invariants de version. Après
   L54, **L53** peut avancer en parallèle de L52 ; ne pas le lancer avec L50.
10. **O6**, preuve navigateur sur un preview isolé avec données fictives ; puis **O7**, décision
   d'activation et preuve de release. Aucun de ces deux lots n'autorise l'usage de données réelles.

> **Historique de coordination** : L21, L22 et L24 ont été livrés le 2026-08-18, puis L23 et L25 ;
> la famille diagnostics n'est donc plus une file d'attente. Les anciennes notes sur la restauration
> de L22 et son absence de fusion décrivaient l'état du 2026-08-18 avant sa livraison ; elles ne
> constituent plus une consigne opérationnelle.

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
