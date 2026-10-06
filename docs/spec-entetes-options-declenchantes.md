# Spécification — En-têtes d'option pour les variables dépendantes d'une liste multiple

- Statut : 📋 **spécifiée le 2026-10-06, décisions arrêtées le même jour (§9), non implémentée** — lot **L74**
- Nature : **présentation seule**. Aucune migration, aucune RPC, aucun changement de stockage,
  de validation, de complétude, d'export, de cohorte ni d'instantané hors-ligne
- Surface web visée : `src/domain/templateSections.ts` (ou un module de domaine voisin),
  `src/screens/member/SectionedFields.tsx`
- Hérite sans code propre : `EncounterFields`, `RepeatableGroup` (occurrence d'un groupe),
  `NewPatient`, `EditPatient`, `EditEncounter`, `CurationTask`, `FormPreview`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

## 1. Besoin

Relevé par le porteur du besoin le 2026-10-06. Une liste multiple pilote des règles d'affichage,
une règle par option :

| Pilote | Option cochée | Variables affichées |
|---|---|---|
| Complications (liste multiple) | infection | Germe, Date de l'infection |
| | hémorragie | Volume, Reprise chirurgicale |

Dès que **deux options ou plus** sont cochées, les variables qu'elles font apparaître s'affichent
**mélangées**, dans leur ordre d'affichage global, et **rien n'indique à l'utilisateur à quelle
option chacune se rapporte**. « Date » ou « Volume » ne disent pas de quelle complication il
s'agit.

Le contournement par le libellé (« Infection — Germe ») fonctionne mais alourdit chaque
libellé, l'export et le dictionnaire, pour un problème qui n'est que d'affichage. Le
contournement par un bloc par option (règle d'affichage ciblant une section) n'est possible
qu'en dehors d'un groupe répétable, qui n'accepte pas de sous-section
(`20260923120000_repeatable_group_subsection.sql:159`).

### 1.1 Constat dans le code

- `EncounterFields` retire les variables masquées puis délègue à `SectionedFields`
  (`src/screens/member/EncounterFields.tsx:254`).
- `SectionedFields` rend les variables d'un bloc dans l'ordre de `groupFieldsBySection`, à plat
  (`src/screens/member/SectionedFields.tsx:397`). Aucune information de la règle ne parvient au
  rendu.
- L'information qui manque **existe déjà** : la règle `{ if: { field, operator: 'contains_any',
  value: [code] }, then: { field, operator: 'visible' } }` dit exactement quelle option fait
  apparaître quelle variable.

## 2. Décision

**L'application déduit des règles d'affichage existantes un regroupement visuel des variables
dépendantes, placé juste sous la liste multiple qui les pilote, avec le libellé de l'option comme
en-tête.**

```
Complications : ☑ Infection  ☑ Hémorragie

  Infection
    Germe                 [            ]
    Date de l'infection   [            ]
  Hémorragie
    Volume (mL)           [            ]
    Reprise chirurgicale  [ oui / non  ]
```

- **Aucune configuration.** Le médecin n'a rien à déclarer : ses règles actuelles suffisent, et
  tout jeu de variables existant en bénéficie sans modification.
- **Une seule implémentation.** Toutes les saisies passent par `SectionedFields`, qu'il s'agisse
  de la fiche patient, d'une rencontre, d'une occurrence de groupe répétable, de la curation ou
  de l'aperçu de l'éditeur.

### 2.1 Options écartées

| Option | Sort | Motif |
|---|---|---|
| Sous-sections dans un groupe répétable | **Écartée** | Structure statique : ne dit pas quelle option a déclenché quoi. Touche gardes, visibilité, export et hors-ligne (spec-groupes-repetables §4.1) |
| Attribut « intertitre » saisi sur la variable | **Écartée** | Configuration redondante avec la règle, à maintenir à la main et susceptible de la contredire |
| Préfixe automatique du libellé (« Infection — Germe ») | **Écartée** | Allonge chaque ligne et répète l'option autant de fois qu'elle a de variables |
| **En-têtes déduits des règles** | **Retenue** | Zéro configuration, présentation seule, un seul point de rendu |

## 3. Règle de rattachement

Une variable **cible** est rattachée à une liste multiple **pilote** si et seulement si toutes
les conditions suivantes sont vraies :

1. la cible porte **exactement une** règle d'affichage, et cette règle cible la **variable**
   (`then.field`) — pas une section ;
2. l'opérateur de cette règle est `contains_any` ;
3. le pilote est de type `multiselect` (liste fermée, libellés disponibles dans le gabarit) ;
4. pilote et cible sont rendus dans le **même bloc** du formulaire (même `SectionGroup` de
   `groupFieldsBySection`, mise en page commune comprise) ;
5. la cible n'est ni une variable compagnon (`proposalKeysOf`), ni une variable de groupe
   répétable vue depuis la fiche.

Toute autre variable reste **à sa place actuelle, sans en-tête**. En particulier :

| Cas | Comportement | Raison |
|---|---|---|
| Plusieurs règles sur la même cible | Pas de rattachement | Les règles se cumulent en ET (`hiddenFieldKeys`, `validation.ts:259`) : aucun en-tête unique ne décrit la condition |
| Règle de bloc (`then.section`) | Inchangé | Le titre du bloc joue déjà ce rôle |
| Pilote `select` simple, `terminology`, nombre, date | Inchangé en v1 | Une seule option à la fois pour `select` : pas de mélange. `terminology` : libellés hors gabarit, chargés à part. Comparaisons numériques : pas d'« option » à nommer |
| Pilote et cible dans deux blocs différents | Inchangé | Déplacer une variable d'un bloc à l'autre changerait la structure perçue du formulaire |

### 3.1 Règle à plusieurs codes

Une règle `contains_any` peut porter plusieurs codes (`[infection, hemorragie]`). La cible est
alors rattachée à un **en-tête combiné** : « Infection / Hémorragie », libellés dans l'ordre
des options du pilote, séparés par « / » (choix du porteur, §9). Le séparateur est neutre
vis-à-vis de la langue : aucun libellé à traduire. La clé du regroupement est l'ensemble trié des codes ;
deux cibles portant le même ensemble partagent le même en-tête.

L'en-tête est **stable** : il ne dépend que de la règle, jamais des cases cochées. Une variable
ne change donc jamais de place quand l'utilisateur coche une option supplémentaire.

## 4. Ordre et placement

Dans un bloc, l'ordre rendu devient :

1. les variables non rattachées, dans leur ordre actuel ;
2. **immédiatement après chaque pilote**, ses regroupements :
   - d'abord les regroupements à un seul code, **dans l'ordre des options du pilote** ;
   - puis les regroupements combinés, dans l'ordre de leur première option ;
   - à l'intérieur d'un regroupement, les cibles dans leur ordre d'affichage actuel.

Un regroupement n'est rendu que s'il contient **au moins une variable visible**. Les variables
masquées restent retirées en amont, exactement comme aujourd'hui : un en-tête ne peut donc
jamais apparaître pour une option décochée.

### 4.1 Cascades

Une cible peut être elle-même un pilote (liste multiple dans le regroupement « Infection » qui
pilote d'autres variables). Ses propres regroupements se placent alors sous elle, **à
l'intérieur** du regroupement parent, avec un retrait supplémentaire. L'acyclicité est déjà
garantie à l'enregistrement des règles (`assert_visibility_acyclic`, `findVisibilityCycle`) ;
le calcul garde néanmoins un ensemble de pilotes visités pour ne jamais boucler sur un gabarit
incohérent.

### 4.2 Un seul ordre pour le rendu et la navigation

L'ordre calculé au §4 est produit **une fois**, par une fonction de domaine pure, et sert à la
fois :

- au rendu des variables du bloc ;
- à l'ordre de parcours « champ manquant suivant » / « à renseigner suivant »
  (`nextMissing`, `nextToFill` de `SectionedFields`) ;
- à l'ordre du résumé de validation.

Sans cela, le bouton « suivant » sauterait d'un regroupement à l'autre dans un ordre différent
de celui affiché.

## 5. Rendu et accessibilité

- Chaque regroupement est un `fieldset` imbriqué dont la `legend` est le libellé de l'option
  (ou l'en-tête combiné). Un lecteur d'écran annonce « Infection, groupe » avant « Germe ».
- Retrait visuel léger et filet vertical à gauche, sans bordure complète : le regroupement doit
  se lire comme une précision du pilote, pas comme un nouveau bloc.
- Le libellé de l'en-tête est le **libellé** de l'option (`optionLabel`,
  `src/domain/fieldOptions.ts:95`), jamais son code. Une option devenue inactive dans le
  gabarit garde son libellé tel que le gabarit le porte.
- Les identifiants de champ (`fieldId`, `data-field-key`) ne changent pas : la navigation vers
  un champ, la mise au point et les messages d'erreur fonctionnent sans adaptation.
- Mobile : même rendu, le retrait est réduit pour ne pas rogner les champs à 320 px.

## 6. Ce qui ne change pas

- Données enregistrées, clés, valeurs, journal des corrections.
- Masquage, effacement des valeurs masquées et confirmation de retrait (`HiddenValuesNotice`,
  `HiddenValuesConfirmation`).
- Complétude, file de complétion, validation serveur.
- Export, dictionnaire, cohortes, instantané hors-ligne.
- Éditeur de jeu de variables : l'ordre d'affichage configuré reste celui que le médecin a
  saisi. Seul l'**aperçu** (`FormPreview`) montre le regroupement, puisqu'il réutilise les
  composants de saisie.
- Formulaire papier (`spec-formulaire-papier.md`) : hors périmètre. Son placement est spécifié
  séparément ; il pourra réutiliser la fonction de domaine du §4.

## 7. Découpage

Un seul lot, **L74**, côté web uniquement.

| Étape | Fichiers | Contenu |
|---|---|---|
| Domaine | `src/domain/templateSections.ts` ou nouveau `src/domain/optionGroups.ts` | Fonction pure : `(fields d'un bloc, règles, champs du gabarit) → arbre ordonné { champ \| regroupement(en-tête, enfants) }` et sa liste aplatie pour la navigation |
| Rendu | `src/screens/member/SectionedFields.tsx` | Rendu de l'arbre ; `nextMissing` / `nextToFill` sur la liste aplatie |

## 8. Critères d'acceptation

Tests de domaine (fonction pure) :

1. Deux options cochées, deux règles `contains_any` à un code : deux regroupements, dans
   l'ordre des options du pilote, placés immédiatement après le pilote.
2. Ordre d'affichage global entrelacé (Germe 3, Volume 4, Date 5, Reprise 6) : le rendu
   regroupe Germe + Date sous « Infection », Volume + Reprise sous « Hémorragie ».
3. Règle `contains_any [infection, hemorragie]` : en-tête combiné « Infection / Hémorragie »,
   placé après les regroupements à un code.
4. Cible portant deux règles d'affichage : non rattachée, à sa place d'origine.
5. Règle de bloc, pilote `select` simple, pilote `terminology`, comparaison numérique : rendu
   strictement identique à l'actuel.
6. Pilote et cible dans deux blocs différents : non rattachée.
7. Cascade : un pilote dans un regroupement place ses propres regroupements sous lui.
8. Gabarit incohérent avec cycle : la fonction termine et ne rattache pas les variables du
   cycle.
9. Aucune règle d'affichage : sortie identique à l'entrée (non-régression).

Tests de composant :

10. Option décochée : son en-tête disparaît avec ses variables.
11. `legend` du regroupement = libellé de l'option, pas son code.
12. « Champ manquant suivant » suit l'ordre affiché.
13. Occurrence de groupe répétable (`RepeatableGroup`) : regroupement présent.
14. `FormPreview` : regroupement présent, sans code propre à l'aperçu.

Vérifications : `npm run typecheck`, `npm run lint`, `npm run test:web` sur les fichiers touchés.
Aucune migration, donc ni `npm run schema` ni suite `db` requise.

## 9. Décisions du porteur du besoin — 2026-10-06

| # | Question | Décision |
|---|---|---|
| D1 | Placement des variables dépendantes | **Déplacées juste sous la liste pilote**, dans l'ordre de ses options (§4). L'ordre configuré dans l'éditeur ne s'applique plus à ces variables lors de la saisie |
| D2 | Règle déclenchée par plusieurs options | **En-tête combiné**, libellés séparés par **« / »** : « Infection / Hémorragie » (§3.1) |
| D3 | Variable soumise à plusieurs règles d'affichage | **Pas d'en-tête**, la variable reste à sa place (§3) |
| D4 | Types de pilotes | **Liste multiple seulement** en v1. Choix unique et diagnostics de nomenclature exclus (§3) |
| D5 | Pilote et cible dans deux blocs | **Laisser en place**, sans en-tête (§3) |
| D6 | Cascades | **Imbriquer** sous la variable pilote, à l'intérieur du groupe parent (§4.1) |
| D7 | Signalement dans l'éditeur | **Aperçu seulement** (`FormPreview`), aucune indication dans la liste des variables (§6) |
| D8 | Aspect visuel | **Retrait léger et filet vertical à gauche**, titre en petit gras, sans encadré (§5) |

Extensions possibles, non retenues pour la v1 : pilotes `terminology` à liste multiple
(diagnostics) et formulaire papier une fois PAP-1 réalisé.
