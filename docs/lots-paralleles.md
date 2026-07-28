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

## Ordre suggéré

1. **En parallèle immédiat** : L1, L2, L3, L5, L7 — aucun ne partage de fichier.
2. **Ensuite** : L4 et L8.
3. **Seuls, l'un après l'autre** : L6 puis L9.
