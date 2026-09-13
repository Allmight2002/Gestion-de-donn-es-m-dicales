# Spécification — Groupes répétables

- Statut : 📋 **spécifiée, non implémentée** — rédigée le 2026-09-12
- Lots : **L66** (socle serveur) → **L67** (éditeur) → **L68** (saisie) → **L69** (création de
  patient) ; **L70** (export) et **L71** (hors-ligne) suivent L66 et se parallélisent
- Surface serveur visée : `encounter`, `template_section`, `missing_required_fields`,
  `base_completeness_stats`, `create_encounter`, `update_encounter`, `copy_template_fields`,
  `replay_encounter_create`, `exportContract.ts`
- Surface web visée : `SectionsEditor`, `FormPreview`, `PatientDetail`, `EditPatient`,
  `NewPatient`, `SectionedFields`, `EncounterFields`, `ExportPanel`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

## 1. Besoin

Trois situations réelles, relevées par le porteur du besoin le 2026-09-12 :

1. **Interventions multiples** — une opération et deux reprises, chacune avec sa date, son
   geste, son indication.
2. **Lésions vertébrales multiples** — C5, T3, L1 chez un même patient, chacune devant porter
   sa gradation AO Spine : niveau, morphologie, modificateur de facettes, M1.
3. **Hématomes multiples** — extradural, sous-dural, hémorragie méningée, chacun avec sa
   localisation, son volume, son effet de masse.

Le contournement actuel est la variable numérotée — `lesion_1_niveau`, `lesion_2_niveau` — dont
[`spec-variables-multivaluees.md`](spec-variables-multivaluees.md) §1 a déjà établi les trois
coûts : le maximum doit être deviné à l'avance, les patients déjà saisis portent des colonnes
vides indiscernables d'une absence réelle, et l'analyse est dispersée sur plusieurs colonnes.

**Le critère de bascule est celui posé au §2 de cette même spécification** : dès qu'une
occurrence porte **deux attributs propres ou plus**, la variable multivaluée ne suffit plus.
Les trois cas ci-dessus en portent trois à quatre.

### 1.1 Ce que la gradation AO Spine apprend sur la forme du besoin

La classification se découpe en deux étages, et ce découpage réduit la charge répétable :

| Étage | Éléments |
|---|---|
| **Patient** | Statut neurologique N (N0–N4, NX), modificateur M2, mécanisme, traitement |
| **Lésion** | Niveau (C1–C7, T1–T12, L1–L5, S1–S5), morphologie (A0–A4, B1–B3, C), modificateur F, M1 |

Le statut neurologique est assigné une fois par patient, pas par vertèbre. La charge réellement
répétable est donc de **deux à trois attributs par occurrence** — petite, mais irréductible à
une valeur unique.

Deux listes multivaluées parallèles (« niveaux atteints » + « types AO ») sont explicitement
écartées : elles perdent l'appariement C5↔A3 dès la deuxième lésion.

## 2. Ce qui existe déjà et n'est pas à refaire

Le produit possède déjà un conteneur répétable par patient, avec ses attributs propres, sa
date, son identité, son cycle de vie et ses garanties : **`encounter`**.

| Mécanisme | Où | Ce qu'il apporte déjà |
|---|---|---|
| Table `encounter` | [tables.sql:166](../supabase/migrations/20260616090200_tables.sql:166) | Plusieurs lignes par patient, `data` JSONB propre, aucune contrainte d'unicité sur `(patient_id, encounter_type)` |
| Écriture RPC exclusive | `create_encounter`, `update_encounter` | RLS, autorisation serveur, journal des corrections |
| Verrou optimiste | [20260616092200:16](../supabase/migrations/20260616092200_encounter_optimistic_lock.sql:16) | `p_expected_updated_at`, conflit structuré par ligne |
| Suppression douce motivée | `soft_delete_encounter` | Corbeille, motif, restauration |
| Validation des valeurs | `assert_data_valid`, `assert_no_unknown_fields` | Types stricts, aucune clé hors dictionnaire |
| Bloc et sous-section | [20260905143319](../supabase/migrations/20260905143319_template_section_hierarchy.sql) | Le bloc racine est déjà l'unité de sens du formulaire |
| Variables d'un bloc | `template_section_field_keys` | Rend les clés d'un bloc racine, sous-sections comprises |
| Projection d'export par bloc | [ExportPanel.tsx:60](../src/screens/member/ExportPanel.tsx:60) | Le bloc est déjà une unité de colonnes à l'export |
| Rejeu hors-ligne ordonné | [20260822000000:219](../supabase/migrations/20260822000000_offline_intake_idempotency.sql:219) | Création patient puis rencontres, empreinte serveur, idempotence |

**Rien de tout cela n'est à réécrire.** Ce que le produit ne sait pas faire, c'est exactement
une chose : dire, pour une ligne de rencontre, **à quel groupe de variables elle appartient**.

## 3. Décision : une projection sur `encounter`, pas un stockage nouveau

Un groupe répétable est une **présentation** d'un ensemble de rencontres partageant un même
bloc, et non une nouvelle forme de stockage.

### 3.1 Les options examinées

| # | Option | Sort | Motif |
|---|---|---|---|
| 1 | Tableau d'objets dans `patient.data` | **Écartée** | `assert_data_valid` est strict par type et n'admet que scalaires, tableau de textes et tableau de `{code,label}` ([20260616095800](../supabase/migrations/20260616095800_strict_json_scalar_types.sql)). Reprendre validation, complétude, export, cohortes, import et hors-ligne : le chantier que [`lots-paralleles.md`](lots-paralleles.md) chiffre « de la taille de L20 à L26 réunis » |
| 2 | Nouvelle table d'occurrences | **Écartée** | Duplique RLS, RPC, verrou, corbeille, audit et rejeu hors-ligne déjà portés par `encounter`, sans rien apporter que `encounter` n'ait |
| 3 | Un `encounter_type` par groupe | **Écartée** | L'enum ne porte que 4 valeurs ([tables.sql:170](../supabase/migrations/20260616090200_tables.sql:170)). Plafond à 4 groupes, libellés faux dans l'export, et le type ferait un travail qui revient au bloc |
| 4 | Table de types d'occurrence par base | **Différée** | Transforme une contrainte `check` en référence, touche `template_field.encounter_types`, la complétude, l'export et l'instantané hors-ligne. Plus lourd que l'option 5 pour le même résultat |
| 5 | **Colonne de groupe sur `encounter`, discriminée par le bloc** | **Retenue** | Le nombre de blocs n'est pas borné ; le bloc est déjà l'unité de sens. Une colonne, deux fonctions, un paramètre de RPC |
| 6 | Variables numérotées bornées | **Conservée comme repli** | Reste le bon choix quand l'unité d'analyse est le patient et non l'occurrence (§3.3) |

### 3.2 Pourquoi le discriminant est le bloc

`encounter_type` n'est pas une étiquette : c'est la clé qui sélectionne le jeu de variables
applicable, via `template_field.encounter_types`. Deux fonctions serveur en dépendent
littéralement — `missing_required_fields`
([20260820120000:379](../supabase/migrations/20260820120000_template_field_formula.sql:379)) et
`base_completeness_stats`
([20260820120000:424](../supabase/migrations/20260820120000_template_field_formula.sql:424)).

Mettre plusieurs groupes sous un même type ferait donc réclamer, sur chaque ligne, les
variables requises de tous les groupes, et calculerait la complétude d'une variable de lésion
sur le dénominateur de **toutes** les lignes du patient. Ce n'est pas une gêne cosmétique :
ce calcul alimente la file de complétion et la couverture diagnostique L55.

Le bloc, lui, partitionne proprement : une variable appartient à exactement un bloc.

### 3.3 Quand ne PAS utiliser un groupe répétable

La question qui tranche est **l'unité d'analyse** :

> Le tableau de résultats commence-t-il par « n = 120 patients » ou « n = 187 lésions » ?

- **Unité patient** — « taux de reprise », « délai index→reprise », « nombre de niveaux
  atteints ». Les variables numérotées bornées, avec une variable de comptage portant toujours
  le compte réel, restent plus simples **et** directement exploitables en tableur. Ne pas
  ouvrir de groupe répétable pour cela.
- **Unité occurrence** — « distribution des morphologies AO sur n lésions », « comparaison de
  deux techniques sur n interventions ». Le groupe répétable est alors la bonne forme, et
  l'export une ligne par occurrence donne le format long directement.

Cette section est normative : elle doit être citée en revue de tout bloc déclaré répétable.

## 4. Modèle de données

### 4.1 Déclarer un bloc répétable

```sql
alter table public.template_section
  add column is_repeatable boolean not null default false;

alter table public.template_section
  add constraint template_section_repeatable_root_only
  check (not is_repeatable or parent_section_id is null);
```

Trois gardes accompagnent la colonne, portées par `guard_template_section_write`
([20260905143319:13](../supabase/migrations/20260905143319_template_section_hierarchy.sql:13)) :

1. **Toutes les variables d'un bloc répétable sont en portée `encounter`.** Une variable de
   portée `patient` dans un bloc répétable est refusée, à l'insertion comme au déplacement.
2. **Un bloc répétable n'accepte pas de sous-section** en v1 — une sous-section deviendrait un
   groupe de colonnes dans le tableau, présentation non spécifiée ici.
3. **`is_repeatable` ne change plus dès que la version est utilisée**
   (`template_version_in_use`, [20260616093100:56](../supabase/migrations/20260616093100_template_rule_versioning.sql:56)) :
   basculer un bloc ordinaire en bloc répétable après saisie changerait le sens des lignes
   déjà écrites.

**Recopie de version.** `copy_template_fields` recopie les sections avec une **liste de
colonnes explicite**
([20260905143319:161](../supabase/migrations/20260905143319_template_section_hierarchy.sql:161)).
Oublier `is_repeatable` ferait perdre silencieusement le caractère répétable à la version
suivante. C'est le piège que la centralisation de L58 signalait déjà ; il est ici rappelé
comme critère d'acceptation.

**Modèle d'observation.** Les variables de portée `encounter` sont refusées sur une base
transversale par `enforce_observation_model_on_template_field`
([20260801185149](../supabase/migrations/20260801185149_observation_model_base.sql)). Un bloc
répétable exige donc une base `longitudinal` ou `event_registry`, **et ce choix se verrouille
au premier patient saisi**. C'est la seule décision irréversible de toute cette spécification ;
elle doit être prise avant la première fiche.

`longitudinal` est recommandé : il conserve le choix de la forme d'export (une ligne par
patient **ou** par occurrence), là où `event_registry` impose la seconde.

### 4.2 L'occurrence

```sql
alter table public.encounter add column group_section_key text;
```

Nullable, sans clé étrangère : le `section_key` est un code stable par version, et la rencontre
porte déjà son `template_version_id`. Une rencontre existante reste à `null` et se comporte
exactement comme aujourd'hui.

Pour une occurrence de groupe :

```
encounter(
  patient_id, template_version_id,
  encounter_type    = 'autre',      -- constante, plomberie, jamais affichée
  encounter_date    = null,         -- sauf si le bloc porte une date (§4.3)
  group_section_key = 'lesions',    -- LE discriminant
  data = { l_niveau: 'C5', l_morphologie: 'A3', l_facette_f: 'F2' }
)
```

Garde : `group_section_key` doit désigner un bloc racine **de la version de la rencontre**, et
ce bloc doit porter `is_repeatable`. Sinon, refus.

### 4.3 Date d'occurrence

`encounter_date` est `not null` aujourd'hui. Une intervention a une date ; **une lésion n'en a
pas**. Trois options ont été examinées :

| Option | Sort | Motif |
|---|---|---|
| Le bloc désigne une de ses variables comme date d'occurrence | **Écartée** | Impose une variable de date à des blocs qui n'en ont pas de sens, et ajoute une configuration à valider |
| `encounter_date` = date de saisie | **Écartée** | Écrit une date sans signification clinique dans une colonne qui en porte une partout ailleurs, et elle ressort telle quelle à l'export |
| **Rendre la colonne nullable, sous garde** | **Retenue** | Préserve l'invariant exactement là où il portait |

```sql
alter table public.encounter alter column encounter_date drop not null;
alter table public.encounter add constraint encounter_date_required_outside_groups
  check (encounter_date is not null or group_section_key is not null);
```

Une vraie rencontre reste donc datée obligatoirement ; seule une occurrence de groupe peut ne
pas l'être.

**Ondes de choc à traiter dans L66, pas à découvrir plus tard :**

- `compute_age(dob, encounter_date, unit)` est appelée par `create_encounter` et
  `update_encounter`. Sur une date nulle, `age_value` et `age_unit` valent `null` — l'âge à
  l'occurrence n'a pas de sens pour une lésion.
- `exportContract.ts` porte `encounter_date`, `age_value` et `age_unit` dans `ENCOUNTER_META`
  ([exportContract.ts:1176](../supabase/functions/generate-export/exportContract.ts:1176)) :
  ces colonnes sortent vides pour une occurrence non datée, ce qui est l'information juste.
- Toute lecture qui trie ou filtre sur `encounter_date` doit traiter le `null` explicitement.

Un bloc répétable **peut** porter une date parmi ses variables (la date d'intervention). Elle
est alors une variable comme une autre ; `encounter_date` reste nulle. La v1 ne recopie rien
automatiquement de l'une vers l'autre.

### 4.4 Bornes

**50 occurrences par groupe et par patient**, refusées au-delà côté serveur. Même borne que la
liste multivaluée, et pour la même raison : une borne serveur contre une charge non maîtrisée,
suffisante pour tout usage clinique observé.

Aucune borne minimale : zéro occurrence est un état normal et signifie « aucune », comme une
clé absente.

## 5. Sémantique normative d'applicabilité

C'est le cœur de la spécification. Une variable de portée `encounter` s'applique à une ligne
selon la règle suivante, **et aucune autre** :

```
applicable(variable, rencontre) =

  si rencontre.group_section_key est non nul :
      variable ∈ template_section_field_keys(version, rencontre.group_section_key)

  sinon :
      variable ∉ (union des variables de tous les blocs répétables de la version)
      ET ( variable.encounter_types est nul ou vide
           OU rencontre.encounter_type ∈ variable.encounter_types )
```

Les deux branches sont nécessaires, et la seconde est celle qu'on oublie : sans elle, une
variable de groupe dont `encounter_types` est nul (= tous les types) serait réclamée sur une
**vraie** consultation. La symétrie est donc obligatoire.

Conséquences directes :

- `template_field.encounter_types` reste **nul** sur les variables d'un bloc répétable : ce
  n'est plus lui qui filtre. L'éditeur masque le réglage pour ces variables.
- Les deux systèmes cohabitent sans interférence : consultations et hospitalisations réelles
  continuent d'être discriminées par leur type.
- La complétude d'une variable de lésion a pour dénominateur les seules lignes du groupe
  « lésions ».

## 6. L66 — Socle serveur

### 6.1 Migration

Une migration horodatée, additive, qui ne réécrit aucune donnée clinique :

1. `template_section.is_repeatable` + contrainte racine (§4.1) ;
2. `encounter.group_section_key` (§4.2) ;
3. `encounter_date` nullable + contrainte de garde (§4.3) ;
4. index `encounter (patient_id, group_section_key)` — c'est l'accès réel : rendre les
   occurrences d'un groupe pour une fiche ;
5. remplacement des fonctions du §6.2 et du §6.3 ;
6. `copy_template_fields` : ajouter `is_repeatable` à la liste de colonnes de sections.

### 6.2 Fonctions adaptées

**`missing_required_fields(p_version, p_scope, p_data, p_encounter_type)`** gagne un paramètre
`p_group_section_key text default null` et applique le §5. Le comportement existant est
inchangé quand le paramètre est nul **et** que la version ne déclare aucun bloc répétable —
condition à vérifier par test, pas par lecture.

L'ordre interne est préservé : le filtre d'applicabilité s'applique avant le retrait des
variables masquées par `visibility_hidden_fields`, comme aujourd'hui.

**`base_completeness_stats(p_base_id, p_mode)`** : la jointure sur les rencontres remplace le
filtre `encounter_types` par le §5, dans ses deux branches (`historical` et `current`).

**Deux appelants indirects, à ne pas oublier** — ils sont la vraie surface du changement, et
les manquer ne casse rien visiblement : ça rend un verdict faux.

| Fonction | Où | Ce qu'elle devient |
|---|---|---|
| `assert_required_complete(p_version, p_scope, p_data, p_encounter_type)` | [20260819103000:88](../supabase/migrations/20260819103000_export_completeness_filter.sql:88) | Gagne le paramètre de groupe et le relaie. C'est elle que `create_encounter` et `update_encounter` appellent au passage en `complete` : sans elle, enregistrer une occurrence complète réclamerait les variables requises des autres groupes |
| `export_incomplete_records(p_cohort_id)` | [20260819103000:139](../supabase/migrations/20260819103000_export_completeness_filter.sql:139) | Passe `e.group_section_key` en plus de `e.encounter_type`. Sans ce relais, **toute** occurrence de groupe serait comptée incomplète et le filtre d'export deviendrait inexploitable |

### 6.3 RPC

**`create_encounter`** gagne `p_group_section_key text default null`, en dernière position
après `p_age_unit` ([20260817120000:131](../supabase/migrations/20260817120000_required_complete_at_complete.sql:131)).
Un paramètre à valeur par défaut préserve les clients non rafraîchis. La fonction :

1. refuse un `group_section_key` qui ne désigne pas un bloc racine répétable de la version ;
2. refuse au-delà de 50 occurrences du même groupe pour ce patient, sous verrou de la fiche ;
3. impose `encounter_type = 'autre'` lorsque le groupe est renseigné — la valeur transmise par
   le client est ignorée, pas refusée, pour ne pas faire dépendre le contrat d'un détail de
   plomberie ;
4. tolère `p_encounter_date` nul dans ce seul cas, et laisse alors `age_value` / `age_unit`
   nuls.

**`update_encounter`** ne change pas de signature : le groupe d'une ligne ne se modifie jamais.
Une occurrence saisie dans le mauvais groupe se supprime et se ressaisit — même règle que le
`field_key` d'une variable déjà utilisée.

**`soft_delete_encounter`** est inchangée : supprimer une ligne de groupe est une suppression
douce motivée ordinaire, visible en corbeille et restaurable.

### 6.4 Gardes

| Garde | Refus attendu |
|---|---|
| `group_section_key` inconnu de la version | `Groupe inconnu pour cette version` |
| Bloc désigné non répétable | `Ce bloc n'est pas un groupe répétable` |
| Bloc désigné non racine | `Un groupe répétable est un bloc racine` |
| 51ᵉ occurrence | `Nombre maximal d'occurrences atteint pour ce groupe` |
| Variable de portée `patient` dans un bloc répétable | `Un groupe répétable ne contient que des variables de rencontre` |
| Sous-section sous un bloc répétable | `Un groupe répétable n'accepte pas de sous-section` |
| Bascule `is_repeatable` sur version utilisée | `Version deja utilisee : creez une nouvelle version` |

Aucun message ne nomme une valeur clinique.

### 6.5 Règles de visibilité

Une règle `then.section` exige que le bloc et son pilote appartiennent à la même fiche
([20260905160000:314](../supabase/migrations/20260905160000_block_visibility.sql:314)). Un
pilote de portée `patient` ne peut donc pas commander un bloc répétable, dont les variables
sont toutes de portée `encounter`.

**Décision v1 : un bloc répétable ne peut pas être la cible d'une règle de visibilité.** Refus
explicite à la définition de la règle. Un groupe vide se lit de lui-même : zéro ligne. Les
règles **internes** au groupe — entre variables d'une même occurrence — continuent de
fonctionner sans changement.

## 7. L67 — Éditeur : déclarer un bloc répétable

Fichiers : `SectionsEditor.tsx`, `FieldForm.tsx`, `FormPreview.tsx`, `EditorStructure.tsx`.

**Déclaration.** Un bloc racine reçoit une case « Groupe répétable ». Le libellé secondaire
énonce la règle de décision du §3.3, en une phrase : *« À cocher quand l'analyse comptera les
occurrences elles-mêmes, et non les patients. »*

**Conséquences rendues visibles au moment de cocher**, avant confirmation :

1. les variables du bloc passeront en portée rencontre — l'éditeur liste celles qui sont
   concernées et refuse si l'une d'elles porte déjà des données ;
2. la base doit être `longitudinal` ou `event_registry` — si elle est transversale, la case est
   désactivée et l'écran explique que ce choix est verrouillé depuis la première fiche ;
3. le réglage « types de rencontre concernés » disparaît pour ces variables (§5).

**Sommaire.** Dans `EditorStructure`, un bloc répétable porte un marqueur distinct du bloc
ordinaire — les deux ne se saisissent pas de la même façon, la structure doit le dire.

**Aperçu.** `FormPreview` rend le bloc sous sa forme de saisie : l'en-tête de tableau et une
ligne d'exemple vide, avec le bouton d'ajout inactif. L'aperçu ne crée rien.

## 8. L68 — Saisie : le groupe dans une fiche existante

Fichiers : `PatientDetail.tsx`, `EditPatient.tsx`, `NewPatient.tsx`, `SectionedFields.tsx`,
un nouveau composant `RepeatableGroup.tsx`.

### 8.1 Rendu du groupe

Le bloc répétable est rendu **à sa place dans le formulaire**, comme les autres blocs — pas sur
un écran séparé. `SectionedFields` détecte `is_repeatable` et délègue à `RepeatableGroup` au
lieu de rendre les variables une à une.

Forme par défaut, **une ligne par occurrence** :

```
┌ Lésions vertébrales ──────────────────────────────────── 3 occurrences ┐
│  Niveau   Morphologie   Facettes   M1        │                          │
│  C5       A3            F2         —         │  [modifier] [supprimer]  │
│  T3       B2            —          oui       │  [modifier] [supprimer]  │
│  L1       A1            —          —         │  [modifier] [supprimer]  │
│                                                                         │
│  [+ Ajouter une lésion]                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

- Une colonne par variable du bloc, dans l'ordre d'affichage de l'éditeur.
- Le compte d'occurrences est affiché dans l'en-tête, y compris à zéro.
- Groupe vide : une seule ligne d'invite et le bouton d'ajout. Jamais un tableau d'en-têtes nu.
- Les valeurs sont rendues par `displayFieldValue`, comme partout ailleurs hors saisie : un
  libellé d'option, pas un code ; un diagnostic, pas `[object Object]`.

**Au-delà de six colonnes**, ou sous 768 px de large, le tableau bascule en **carte par
occurrence** : un bloc par ligne, variables empilées en `libellé : valeur`. Le tableau ne
provoque jamais de défilement horizontal du document ; s'il défile, c'est dans son propre
conteneur.

### 8.2 Ajouter, modifier, supprimer

**Ajouter.** Le bouton ouvre un formulaire d'occurrence — les variables du bloc, rendues par le
moteur de champs existant, avec ses règles internes, ses valeurs par défaut, ses codes de donnée
manquante et sa validation. Enregistrer appelle `create_encounter` avec le groupe. La ligne
apparaît dans le tableau ; le formulaire se referme.

**Modifier.** Ouvre le même formulaire, pré-rempli, et appelle `update_encounter` en
transmettant `p_expected_updated_at`. **Chaque ligne porte son propre verrou** : une occurrence
modifiée ailleurs déclenche un conflit sur cette ligne seule, les autres restent modifiables.
Le conflit est présenté comme partout ailleurs — inputs locaux préservés, rechargement ou
résolution explicite, jamais d'écrasement silencieux.

**Supprimer.** Passe par le dialogue de motif existant (`DeleteWithReason`) et
`soft_delete_encounter`. La ligne quitte le tableau et reste en corbeille.

**Une occurrence = une écriture atomique.** Il n'y a pas d'enregistrement global du tableau,
donc pas d'écriture partielle possible sur plusieurs lignes.

### 8.3 L69 — Création d'un patient : occurrences tamponnées

Une rencontre exige un patient existant. Deux comportements possibles ; **la v1 retient le
second** :

| Comportement | Sort | Motif |
|---|---|---|
| Groupes inactifs tant que la fiche n'est pas enregistrée | Écarté | Coupe la saisie en une séance, qui est le mode de collecte rétrospectif visé |
| **Lignes tamponnées, puis rejeu ordonné après création** | **Retenu** | Reprend exactement le motif éprouvé du mode hors-ligne : créer le patient, puis rejouer les occurrences dans l'ordre |

Dans `NewPatient`, les occurrences saisies sont conservées en mémoire et marquées **« non
enregistrée »**. À la validation de la fiche : `create_patient`, puis `create_encounter` pour
chaque ligne, dans l'ordre de saisie.

Si une ligne échoue, la fiche et les lignes déjà écrites existent bel et bien ; l'écran affiche
**précisément quelles lignes ne sont pas enregistrées**, avec leur message et une reprise ligne
par ligne. Aucune ligne n'est perdue, aucune n'est écrite deux fois, et l'état affiché est
l'état réel. Quitter l'écran avec des lignes non enregistrées demande confirmation.

### 8.4 États

| État | Rendu |
|---|---|
| Chargement | Le tableau rend ses en-têtes et un indicateur ; le reste du formulaire n'est pas bloqué |
| Vide | Ligne d'invite + bouton d'ajout |
| Ligne non enregistrée *(L69 seulement)* | Marqueur explicite sur la ligne + action de reprise |
| Conflit de version sur une ligne | Bandeau sur la ligne seule ; les autres restent modifiables |
| Borne atteinte | Bouton d'ajout désactivé + explication ; jamais un refus serveur nu |
| Lecture seule (rôle, version gelée, fiche curée) | Tableau rendu, actions absentes |

### 8.5 Complétude et file

Une occurrence incomplète se comporte comme une rencontre incomplète : elle apparaît dans la
file de complétion, et `missing_required_fields` ne réclame que les variables **de son groupe**
(§5). Une occurrence sans aucune variable requise manquante n'y apparaît jamais.

### 8.6 Accessibilité et i18n

- Le tableau est un vrai `table` avec en-têtes associés ; la forme carte reste une liste
  d'items nommés. Chaque action porte un nom accessible incluant le rang — « modifier la
  lésion 2 » — jamais un « modifier » nu répété.
- Le compte d'occurrences est annoncé lors d'un ajout ou d'un retrait.
- Nouvelles clés dans les deux catalogues, `fr` et `en` : titre de groupe, compte, ajout, vide,
  non enregistré, borne atteinte, confirmation de sortie. Le nom du groupe vient du **libellé
  du bloc**, jamais d'une chaîne traduite.

## 9. L70 — Export

1. **`group_section_key` rejoint `ENCOUNTER_META`**
   ([exportContract.ts:1176](../supabase/functions/generate-export/exportContract.ts:1176)).
   C'est ce qui rend les lignes séparables en analyse, et c'est le discriminant *juste* —
   là où `encounter_type` aurait dit `autre` pour tout le monde.
2. **Forme une ligne par occurrence** : inchangée, elle donne déjà le format long attendu par
   une analyse par lésion ou par intervention.
3. **Forme une ligne par patient** : l'agrégation `first`/`last` n'a aucun sens sur un groupe —
   elle choisirait une lésion au hasard. Les occurrences de groupe en sont donc **exclues**, et
   remplacées par **une colonne de comptage par bloc répétable**, `nb__<bloc>`. Le dictionnaire
   d'export l'énonce explicitement.
4. La projection de colonnes par bloc existante se combine sans modification : sélectionner le
   bloc « lésions » produit le fichier des lésions.

## 10. L71 — Hors-ligne

1. L'instantané transporte `is_repeatable` par section et `group_section_key` par rencontre.
2. `replay_encounter_create` gagne le paramètre de groupe, avec l'empreinte recalculée côté
   serveur comme aujourd'hui.
3. L'ordre de rejeu existant — patient puis rencontres — couvre déjà le cas.
4. La fusion de conflits traite chaque occurrence comme une rencontre : le motif est inchangé.

Tant que ce lot n'est pas livré, un bloc répétable est **inutilisable hors ligne** ; l'écran
doit le dire au lieu de laisser saisir des lignes irrécupérables.

## 11. Ce qui ne change pas

RLS et cloisonnement ; écriture RPC exclusive ; `assert_data_valid` et `assert_no_unknown_fields` ;
journal des corrections ; corbeille et restauration ; verrou optimiste ; sémantique des cohortes
(un filtre sur une variable de groupe sélectionne les patients ayant **au moins une** occurrence
correspondante) ; import (les groupes restent hors mappage, comme les rencontres) ; terminologie ;
gel des versions publiées.

## 12. Hors périmètre

- Sous-sections à l'intérieur d'un bloc répétable.
- Règle de visibilité ciblant un bloc répétable (§6.5).
- `required` au niveau du groupe (« au moins une occurrence »).
- Enregistrement transactionnel unique de la fiche et de ses occurrences.
- Réordonnancement manuel des occurrences ; l'ordre est celui de la saisie.
- Déplacement d'une occurrence d'un groupe à l'autre.
- Groupes imbriqués.
- Mappage d'import vers un groupe.
- Table de types d'occurrence nommés par base (option 4 du §3.1).
- Reprise des variables numérotées existantes vers un groupe : chantier de reprise de données
  distinct, non couvert ici.

## 13. Ordre, dépendances et collisions

```
L66 (serveur) ──┬── L67 (éditeur) ── L68 (saisie) ── L69 (création patient)
                ├── L70 (export)
                └── L71 (hors-ligne)
```

### 13.1 Découpage

| Lot | Objet | Pourquoi il est séparé |
|---|---|---|
| **L66** | Socle serveur : migration, §5, fonctions, RPC, gardes | Migration, fonctions et RPC sont **couplées** : un seul responsable d'écriture, conformément à la règle du dépôt sur les changements migration/RPC/appelants |
| **L67** | Éditeur : déclarer un bloc répétable | Aucune saisie n'est possible tant qu'aucun écran ne sait déclarer le bloc. Surface entièrement distincte de L66 |
| **L68** | Saisie : le groupe dans une fiche **existante** | Livre la valeur à lui seul — on crée le patient, puis on ajoute ses occurrences. C'est le lot qui rend le pilote utilisable |
| **L69** | Création de patient : occurrences tamponnées et rejeu ordonné | Supprime l'étape en deux temps. Logique de tampon et de reprise indépendante du rendu du groupe, et sur un autre écran |
| **L70** | Export : métadonnée de groupe et colonnes de comptage | Ne dépend que du socle. Territoire `exportContract.ts`, à isoler |
| **L71** | Hors-ligne : instantané et rejeu | Ne dépend que du socle. Territoire `offlineIntake.ts` |

### 13.2 Ordre

- **L66 est bloquant pour tous les autres.**
- **L67 → L68 → L69** est une file strictement séquentielle : chacun suppose le précédent.
- **L70 et L71 se parallélisent** entre eux et avec la file L67–L69, dès L66 fusionné.
- **Jalon utilisable** : après **L68**, un pilote peut saisir des groupes répétables. L69 à L71
  sont des améliorations, pas des conditions.

### 13.3 Collisions connues

| Lot | Fichiers | À ne jamais lancer avec |
|---|---|---|
| L66 | migration, `copy_template_fields` | Tout lot rouvrant `copy_template_fields` — territoire de **L54** et **L58** |
| L67 | `SectionsEditor.tsx`, `FormPreview.tsx`, `FieldForm.tsx`, `EditorStructure.tsx` | Les **correctifs UX en cours sur `codex/ux-correctifs`**, qui modifient ces quatre fichiers en ce moment ; **L59** (`SectionsEditor`) et **L41** (`TemplateVersionEditor`) |
| L68 | `SectionedFields.tsx`, `PatientDetail.tsx`, `EditPatient.tsx` | Tout lot ouvrant la fiche patient |
| L69 | `NewPatient.tsx` | **L41** et **L42**, qui touchent tous deux le même `useCallback` de `NewPatient.tsx` |
| L70 | `exportContract.ts`, Edge `generate-export` | **L50** (différé) et **L53** |
| L71 | `offlineIntake.ts`, RPC d'instantané et de rejeu | **O6** et **O7** |

## 14. Plan de tests

### 14.1 PostgreSQL et RLS

1. Applicabilité, branche groupe : une variable du bloc est réclamée sur une ligne du groupe.
2. Applicabilité, branche hors groupe : une variable de bloc répétable n'est **pas** réclamée
   sur une consultation ordinaire, `encounter_types` nul compris. *(Le test qui manque le plus
   facilement.)*
3. Complétude : le dénominateur d'une variable de lésion ne compte que les lignes de son groupe.
4. Non-régression : version sans aucun bloc répétable — `missing_required_fields` et
   `base_completeness_stats` rendent exactement les mêmes résultats qu'avant la migration.
4 bis. **Appelants indirects du §6.2.** Passage d'une occurrence en `complete` via
   `assert_required_complete` : seules les variables requises de son groupe sont exigées. Et
   `export_incomplete_records` sur une cohorte contenant des occurrences complètes : aucune
   n'est signalée incomplète.
5. Gardes du §6.4, une par une.
6. 50 occurrences acceptées, la 51ᵉ refusée.
7. `encounter_date` nul accepté avec groupe, refusé sans ; `age_value` nul dans le premier cas.
8. Recopie de version : `is_repeatable` survit ; les variables restent rattachées à leur bloc.
9. Bascule `is_repeatable` refusée sur version utilisée.
10. Suppression douce d'une occurrence puis restauration : la ligne revient dans son groupe.
11. Verrou optimiste : deux modifications concurrentes de **la même** ligne → conflit ; de deux
    lignes différentes → aucun conflit.
12. Base transversale : création d'une variable dans un bloc répétable refusée.

### 14.2 Domaine et frontend

13. Rendu d'un groupe vide, à une ligne, à cinquante lignes.
14. Bascule tableau → carte sous 768 px et au-delà de six colonnes.
15. Création de patient avec trois occurrences tamponnées : les trois sont écrites dans l'ordre.
16. Même scénario, échec sur la deuxième : la fiche et la première existent, les deux autres
    sont marquées non enregistrées, la reprise les écrit sans doublon.
17. Conflit sur une ligne : les autres restent modifiables, les saisies locales sont préservées.
18. Lecture seule : aucune action d'écriture rendue.
19. Noms accessibles des actions incluant le rang ; annonce du compte après ajout et retrait.
20. Éditeur : cocher « groupe répétable » sur un bloc contenant une variable déjà utilisée est
    refusé avec explication.

### 14.3 Export

21. Une ligne par occurrence : `group_section_key` présent et juste.
22. Une ligne par patient : occurrences de groupe absentes, `nb__<bloc>` présent et exact,
    y compris à zéro.
23. Projection par bloc sur un bloc répétable : colonnes attendues, aucune fuite d'identité.
24. Occurrence non datée : `encounter_date`, `age_value`, `age_unit` vides, jamais `1970-01-01`
    ni une date inventée.

### 14.4 Commandes

`npm run schema` puis inspection du snapshot, `npm run schema:check`, tests ciblés sur les
fichiers touchés, puis lint et typecheck. Vérifier la cible locale avant tout test écrivant des
données. Détail dans `meddata-release-check`.

## 15. Critères d'acceptation

1. Une base longitudinale peut déclarer **six blocs répétables ou plus** sans toucher à
   `encounter_type`, et chaque occurrence n'attend que les variables de son groupe.
2. Une version sans bloc répétable produit, avant et après migration, des résultats identiques
   pour `missing_required_fields` et `base_completeness_stats`.
3. Une variable de bloc répétable n'est jamais réclamée sur une rencontre ordinaire.
4. `is_repeatable` survit à la recopie de version.
5. Aucune occurrence n'est perdue ni dupliquée lors d'une création de patient partiellement
   échouée, et l'écran affiche l'état réel ligne par ligne.
6. Un conflit de version porte sur une ligne et n'en bloque aucune autre.
7. L'export une ligne par patient ne choisit jamais une occurrence au hasard.
8. Aucun message d'erreur ne nomme une valeur clinique.
9. Aucune migration déjà appliquée n'est modifiée ; aucune donnée clinique n'est réécrite.

## 16. Risques résiduels

| Risque | Portée | Traitement |
|---|---|---|
| Le choix `longitudinal` est irréversible après la première fiche | Élevée | L67 le dit à l'écran au moment de cocher, et le §3.3 sert de garde-fou en revue |
| `encounter_date` devient nullable sur une table clinique centrale | Moyenne | Contrainte de garde (§4.3) + tests 7 et 24 ; toute lecture triant sur cette colonne est à recenser en L66 |
| Un groupe ouvert alors que l'unité d'analyse est le patient | Moyenne | §3.3 normatif ; les variables numérotées bornées restent le bon choix dans ce cas |
| Saisie de cinquante occurrences en tableau sur mobile | Faible | Bascule en cartes (§8.1) et borne serveur |
| Blocs répétables utilisés hors ligne avant L70 | Moyenne | L68 désactive le groupe et l'explique tant que L70 n'est pas livré |
