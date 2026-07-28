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

## Vue d'ensemble

| Lot | Objet | Fichiers principaux | Lancer en même temps que |
|---|---|---|---|
| **L1** | Liste d'une base : affichage et bandeau | `BaseHome.tsx` | L2, L3, L5, L7 |
| **L2** | Formulaires patient : sections | `NewPatient.tsx`, `EditPatient.tsx` | L1, L3, L5, L7 |
| **L3** | Allègement du chargement | `vite.config.ts` | tous |
| **L4** | Soupape sur le champ diagnostic | `proposalField.ts`, `EncounterFields.tsx`, `TerminologyInput.tsx`, `FieldForm.tsx` | L1, L2, L3, L7 |
| **L5** | Constructeur de règles | `RuleForm.tsx`, `templateRules.ts` | L1, L2, L3, L7 |
| **L6** | Finition de l'interface | `AppShell.tsx`, composant de case à cocher, **9 écrans** | **seul** |
| **L7** | Protections de branche (B7) | *aucun fichier* | tous |
| **L8** | Suppression et restauration de bases (P2) | migration, `BaseHome.tsx`, nouveaux écrans | L3, L5, L7 |
| **L9** | Modèle d'observation d'une base | migration, `NewPatient.tsx`, `FieldForm.tsx`, `BaseHome.tsx` | **seul** |
| **L10** | Comptes de mission (P4) | migration, nouvelle Edge Function, `access.ts`, `AccessManagement.tsx` | L1, L2, L3, L5, L7 |
| **L11** | Observabilité des erreurs (P3) | migration, `ErrorBoundary.tsx`, nouvel écran admin | L1, L2, L3, L5, L7 |
| **L12** | Traitement des propositions | nouvel écran, `BaseLayout.tsx` | L2, L3, L5, L7 |
| **L13** | Rafraîchissement de la copie locale | `terminologyCache.ts`, `TerminologyInput.tsx` | L1, L2, L3, L5, L7 |

## Deux fichiers à surveiller

- **`src/i18n/messages.ts`** est touché par presque tous les lots qui ajoutent du
  texte. Les conflits y sont fréquents mais faciles : ce sont des ajouts de
  lignes en des endroits différents. Pour les limiter, ajouter ses clés **à la
  fin** de la section française puis anglaise, plutôt qu'au milieu.
- **`docs/suivi-execution-feuille-route.md`** est modifié par chaque lot qui se
  termine. Même remarque : ajouter sa section à la fin.

## Détail des lots

### L1 — Liste d'une base : affichage et bandeau

Deux corrections dans le même fichier, donc indissociables en pratique.

- **D5** : un diagnostic s'affiche « [object Object] » dans la liste des
  patients. La fonction `displayFieldValue` existe déjà et est utilisée par la
  fiche patient ; il suffit de l'employer ici. Vérifier au passage
  `EditEncounter.tsx`, qui termine lui aussi par `String(v)`.
- **D3** : le bandeau « Rendre disponible hors-ligne » occupe toute la largeur en
  permanence pour une action occasionnelle.

Petit lot, bon candidat pour commencer.

### L2 — Formulaires patient : sections

**D4** : les variables permanentes ne sont pas groupées par section, alors que
les rencontres le sont. Reprendre le regroupement écrit dans
`EncounterFields.tsx`, en n'affichant que les sections non vides.

Préalable pratique à L9.

### L3 — Allègement du chargement

**Idée 9** : sortir la bibliothèque de tableur du préchargement, dédoublonner ses
deux copies, découper le fichier principal. N'affecte que la configuration de
build : aucun conflit possible avec les autres lots.

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

**Six décisions métier restent en attente du porteur**, détaillées dans
[`spec-comptes-mission.md`](spec-comptes-mission.md). La plus structurante :
l'étudiant crée-t-il des patients, ou remplit-il seulement des rencontres
existantes ? Ce lot ne peut pas démarrer avant cet arbitrage.

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

1. **En parallèle immédiat** : L1, L2, L3, L5, L7 — aucun ne partage de fichier.
2. **Après arbitrage du porteur** : L10 et L11, qui attendent respectivement six
   et sept décisions métier.
3. **Ensuite** : L4, L8, L12, L13.
4. **Seuls, l'un après l'autre** : L6 puis L9.
