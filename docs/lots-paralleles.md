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
| **L2** | Formulaires patient : sections | `NewPatient.tsx`, `EditPatient.tsx` | L1, L3, L5, L7 |
| ~~L3~~ | ~~Allègement du chargement~~ | **Livré le 2026-07-28** | — |
| **L4** | Soupape sur le champ diagnostic | `proposalField.ts`, `EncounterFields.tsx`, `TerminologyInput.tsx`, `FieldForm.tsx` | L1, L2, L3, L7 |
| **L5** | Constructeur de règles | `RuleForm.tsx`, `templateRules.ts` | L1, L2, L3, L7 |
| **L6** | Finition de l'interface | `AppShell.tsx`, composant de case à cocher, **9 écrans** | **seul** |
| **L7** | Protections de branche (B7) | *aucun fichier* | tous |
| **L8** | Suppression et restauration de bases (P2) | migration, `BaseHome.tsx`, nouveaux écrans | L3, L5, L7 |
| **L9** | Modèle d'observation d'une base | migration, `NewPatient.tsx`, `FieldForm.tsx`, `BaseHome.tsx` | **seul** |
| **L10** | Comptes de mission (P4) | migration, nouvelle Edge Function, `access.ts`, `AccessManagement.tsx` | L1, L2, L5, L7 |
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

### L2 — Formulaires patient : sections

**D4** : les variables permanentes ne sont pas groupées par section, alors que
les rencontres le sont. Reprendre le regroupement écrit dans
`EncounterFields.tsx`, en n'affichant que les sections non vides.

Préalable pratique à L9.

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

### L5 — Constructeur de règles

**Idée 7** : remplacer la saisie de JSON par un assemblage guidé. Fichiers
isolés, aucun recoupement avec les autres lots.

### L6 — Finition de l'interface

**Idée 10** : zone de profil, cases à cocher, retours visuels. Ce lot touche
**neuf écrans** pour remplacer les cases à cocher système par un composant
commun. Il entrera en conflit avec presque tout : à traiter **seul**, de
préférence quand les autres lots d'interface sont fusionnés.

### L7 — Protections de branche

**B7**, désormais déblocable : le dépôt étant public, les règles de protection
sont gratuites. Exiger la CI verte avant fusion remplacerait par un mécanisme
technique la discipline tenue à la main depuis le 26 juillet.

Aucun fichier du dépôt n'est modifié : ce lot peut être mené à tout moment, en
parallèle de n'importe quel autre.

### L8 — Suppression et restauration de bases

**P2**. La fonction serveur `soft_delete_base` existe déjà, complète et
sécurisée ; il manque la RPC de restauration et l'interface. Touche `BaseHome.tsx`
comme L1 — enchaîner après lui plutôt qu'en parallèle.

Lot à surface base : appliquer `meddata-db-safety`.

### L9 — Modèle d'observation d'une base

**Idée 8** : rendre le suivi longitudinal explicite et optionnel. Le plus large
des lots — migration, création de patient, éditeur de variables, écran de base.
À traiter **seul**, après L2 qui lui sert de préalable.

### L10 — Comptes de mission

**P4**, et l'idée n°1 de la file. Un médecin confie la saisie d'une seule base à
un étudiant, pour une durée limitée, en création seule, révocable. Le socle
existe déjà — `base_access`, invitations expirables, révocation, audit ; il
manque un rôle global dédié, une permission de création séparée, une expiration
d'accès et une Edge Function d'invitation idempotente.

**La décision structurante est tranchée** (2026-07-28) : l'étudiant **crée des
patients**, en création minimale, sans jamais accéder à l'identité nominative.
C'est cette exclusion qui rend la permission acceptable — le saisisseur alimente
le registre sans savoir de qui il s'agit.

**Cinq décisions secondaires restent ouvertes** dans
[`spec-comptes-mission.md`](spec-comptes-mission.md) : durée maximale d'une
mission, lecture de l'identité sur option, upload de documents, délai de purge
des comptes échus, nom du rôle. Chacune a une recommandation ; aucune ne bloque
le démarrage du lot, qui peut donc **commencer**.

L'upload de documents est exclu de la v1, ce qui découple ce chantier de B2.
Surface base et Edge : appliquer `meddata-db-safety`.

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

1. **En parallèle immédiat** : L7, L10 — aucun ne partage de fichier. L10 est
   désormais débloqué : sa décision structurante est tranchée. L2 et L5 sont
   déjà en cours sur leurs branches respectives.
2. **Ensuite** : L4, L8, L11, L12, L13. L11 attend encore sept décisions, mais
   ses étapes locales sont réalisables sans elles.
3. **Seuls, l'un après l'autre** : L6, L9, L14.
