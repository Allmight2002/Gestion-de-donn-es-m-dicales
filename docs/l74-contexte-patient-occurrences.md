# L74 — Variables permanentes comme contexte d'affichage des occurrences de groupe répétable

- Statut : 📋 **cadré le 6 octobre 2026, arbitré le 6 octobre 2026** ; L74a (socle serveur) implémenté, en revue (§13) ; L74b (effacement déclaré) implémenté, en revue (§14)
- Prérequis : L66 à L72 fusionnés (groupes répétables, groupe en sous-section, retrait de bloc)
- Surface serveur visée : `assert_rule_structure`, `assert_curated_complete` (branche rencontre),
  `guard_group_occurrence_block_visible`, fonctions de complétude (`missing_required_fields` et
  ses appelants), `form_record_context_json`, retrait côté fiche patient (L72e)
- Surface web visée : `RepeatableGroup`, `PendingRepeatableGroup`, `EditPatient`, `NewPatient`,
  `PatientDetail`, `CurationTask`, `recordCompletion`, `RuleForm`, `FormPreview`
- Périmètre autorisé : données fictives uniquement

---

> **Arbitrages du porteur du besoin, 6 octobre 2026.**
>
> - **D1 — Occurrences de groupe seules.** Les rencontres ordinaires gardent leur sémantique
>   actuelle. Une extension aux visites ferait l'objet d'un lot séparé.
> - **D2 — Affichage seulement.** Une variable permanente peut commander l'**affichage** d'une
>   variable de groupe, et rien d'autre : ni obligation, ni comparaison.
> - **D3 — Sans objet.** Le contexte ne servant qu'à la visibilité, les règles `required` et de
>   comparaison inter-fiches déjà enregistrées restent inertes, comme aujourd'hui. Aucune
>   occurrence ne change de statut et aucun audit préalable n'est nécessaire.
> - **D4 — Effacement déclaré, atomique.** Décocher un pilote annonce les valeurs d'occurrences
>   qui seront effacées, puis les efface dans la même transaction que la fiche.
> - **D5 — Retenue.** Les règles qui ne peuvent jamais fonctionner sont refusées **à leur
>   écriture** ; celles qui existent déjà sont signalées, jamais bloquées.

## 1. Besoin

La fluidité de saisie repose sur les règles d'affichage. Le cas clinique qui bloque est le
suivant : **montrer une variable d'occurrence selon une variable permanente du patient**.
Exemples :

- n'afficher la gradation AO Spine d'une lésion que si le patient a un diagnostic de trauma ;
- n'afficher le côté d'une lésion que si la pathologie du patient est latéralisée ;
- ne proposer le type de matériel dans une occurrence « intervention » que si le patient est
  opéré.

L72 apporte seulement l'héritage au niveau du **bloc entier** : le groupe disparaît avec son
bloc. Il ne permet pas d'agir variable par variable à l'intérieur d'une occurrence.

## 2. Constat : trois espaces d'évaluation étanches

Chaque règle s'évalue sur **une seule** fiche :

| Espace | Données lues | Évaluation |
|---|---|---|
| Fiche patient | `patient.data` (portée `patient`) | `visibility_hidden_fields(version, patient.data)` |
| Rencontre ordinaire | `encounter.data` | idem, sur la rencontre |
| Occurrence de groupe | `encounter.data` de la ligne, `group_section_key` renseigné | idem, sur l'occurrence **seule** |

Dans les trois cas, une condition non vérifiable masque la cible : pilote vide, masqué ou absent
de la fiche ([templateRules.ts:41](../src/domain/templateRules.ts),
[block_visibility:44](../supabase/migrations/20260905160000_block_visibility.sql)).

### 2.1 Ce qui est refusé aujourd'hui

`assert_rule_structure` ([repeatable_groups](../supabase/migrations/20260918191752_repeatable_groups.sql))
refuse une règle `visible` dont le pilote et la cible n'ont pas la même portée : « les deux
variables doivent appartenir à la même fiche ». Une variable permanente ne peut donc pas
commander l'affichage d'une variable de groupe, qui est toujours de portée `encounter`.

### 2.2 Ce qui est accepté mais ne fonctionne jamais (règles dormantes)

Le contrôle de portée ne distingue que `patient` et `encounter`. Il ignore que l'occurrence et la
rencontre ordinaire sont deux fiches différentes, et il ne s'applique pas à `required`.

| # | Règle acceptée | Effet réel |
|---|---|---|
| P1 | `visible` : variable de rencontre ordinaire → variable de groupe | Cible **toujours masquée** dans l'occurrence |
| P2 | `visible` : variable de groupe → variable de rencontre ordinaire (ou d'un autre groupe) | Cible **toujours masquée** sur la rencontre |
| P3 | `required` entre deux espaces différents (ex. permanent → groupe) | Ne se déclenche **jamais** (`rule_holds` : pilote absent → respectée) |
| P4 | Comparaison entre deux espaces différents | Jamais évaluée (opérande absent → respectée) |
| P5 | Bloc racine piloté par une variable de **rencontre** et portant un groupe enfant | Groupe **toujours masqué** : `repeatable_group_root_visible` lit `patient.data` (déduit de la lecture, non testé) |

Après L74, P3 et P4 restent dormantes (D2, D3) ; D5 empêche d'en créer de nouvelles.

Côté écran, `rulesForRepeatableSection` ([templateSections.ts:472](../src/domain/templateSections.ts))
était prévue pour écarter les règles inter-fiches d'une occurrence. **Aucun appelant ne
l'utilise** : l'occurrence reçoit toutes les règles actives. Le serveur et l'écran restent
cohérents entre eux (les deux masquent), mais rien ne prévient le concepteur.

## 3. Principe retenu : le contexte patient, pour la visibilité seulement

> **La visibilité d'une occurrence se calcule sur `contexte ⊕ occurrence`**, où le contexte est
> le sous-ensemble **de portée `patient`** de `patient.data`, lu au moment de l'évaluation.
> **Tout le reste** — obligations conditionnelles, comparaisons, validation des valeurs — se
> calcule sur l'occurrence **seule**, comme aujourd'hui. Le contexte n'est jamais écrit dans
> l'occurrence, jamais exporté avec elle et jamais validé par elle.

La fusion ne peut pas produire de collision : `field_key` est unique par version, **toutes
portées confondues** (`unique (template_version_id, field_key)`,
[tables:69](../supabase/migrations/20260616090200_tables.sql)).

Une seule fonction SQL porte la fusion :

```
occurrence_evaluation_data(p_version uuid, p_patient_data jsonb, p_data jsonb) returns jsonb
  -- p_data || (clés de p_patient_data dont la variable est de portée 'patient' dans p_version)
```

Côté web, le miroir est une fonction pure de `templateSections.ts`, utilisée par tous les écrans
d'occurrence.

### 3.1 Ce que « visibilité seulement » impose aux appelants

Les fonctions serveur actuelles reçoivent **un seul** jeu de données et en dérivent à la fois
l'ensemble masqué et leurs contrôles. On distingue donc deux familles :

| Fonction | Données passées | Pourquoi c'est juste |
|---|---|---|
| `visibility_hidden_fields` | **fusionnées** | C'est le cœur du lot |
| `missing_required_fields`, `assert_required_complete`, `record_completion_summary` | **fusionnées** | Elles ne réclament que les variables de rencontre du groupe (`required = true` du gabarit) ; le contexte ne sert qu'à leur calcul de masquage interne. Une variable masquée par le contexte n'est pas réclamée : « masqué = non obligatoire », inchangé |
| `assert_no_hidden_values`, `assert_block_hidden_values`, `assert_contains_any_hidden_values`, `form_record_assert_no_changed_hidden_values` | **fusionnées** | Filtrées par portée `encounter` : seules les valeurs de l'occurrence sont contrôlées |
| `assert_validation_rules` → `rule_holds` | **ensemble masqué calculé sur les données fusionnées, règles évaluées sur l'occurrence seule** | Sinon une règle `required` permanent → groupe s'activerait (contraire à D2/D3), et une règle purement patient pourrait bloquer une lésion. Il faut une variante qui reçoive l'ensemble masqué séparément (`rule_holds(rule, data, hidden)` le permet déjà) |

Côté web, la même séparation existe déjà : `evaluateRules(rules, data, hidden)` reçoit les
données et l'ensemble masqué séparément. On lui passe le **brouillon seul** et l'ensemble masqué
calculé sur `contexte ⊕ brouillon`.

## 4. Décisions arbitrées

### D1 — Périmètre : occurrences seules ✅

Les écrans de groupe s'affichent déjà **dans** la fiche patient : les valeurs permanentes y sont
disponibles sans chargement supplémentaire. Le formulaire de visite, la correction de visite et
la file hors ligne des visites ne changent pas.

Raison principale de ne pas étendre aux visites maintenant : avec D4, décocher un pilote
effacerait des valeurs dans **toutes les visites passées** d'un suivi longitudinal, et une visite
décrit le patient tel qu'il était ce jour-là. Une extension éventuelle sera cadrée séparément ;
la fonction de fusion est écrite pour pouvoir l'accueillir sans changer de forme.

### D2 — Affichage seulement ✅

| Règle, pilote permanent → cible de groupe | Sort |
|---|---|
| `visible` sur une variable | **Autorisée** — c'est le besoin |
| `required` | **Refusée à l'écriture** (D5) : elle ne se déclencherait jamais |
| Comparaison permanent ↔ groupe | **Refusée à l'écriture** (D5), même raison |
| Toute règle dont la **cible** est permanente et le pilote dans un groupe | **Refusée** : une fiche patient ne lit pas ses occurrences (agrégat sur plusieurs lignes, hors périmètre) |

Une variable de groupe marquée **obligatoire** dans le gabarit et masquée par le contexte n'est
pas réclamée. C'est l'application de la règle existante « masqué = non obligatoire ».

### D3 — Règles dormantes existantes : sans objet ✅

Le contexte n'entrant pas dans `rule_holds`, les règles `required` et de comparaison inter-fiches
déjà enregistrées gardent exactement leur comportement actuel (inertes). Aucune occurrence ne
change de statut, la file de complétion et l'export ne bougent pas. Elles sont seulement
**signalées** dans l'éditeur (D5).

### D4 — Effacement déclaré, atomique ✅

Exemple : on décoche « trauma » alors que trois lésions portent une gradation AO. La gradation
devient masquée dans ces trois occurrences, mais ses valeurs restent dans trois **autres lignes**.

1. **À l'écran**, avant l'enregistrement de la fiche : « 3 lésions perdront la valeur
   *Gradation AO* », avec confirmation ou annulation.
2. **En base**, la fiche et les occurrences sont écrites dans la **même transaction**. Chaque
   effacement est une correction journalisée par occurrence, avec un motif engendré qui nomme la
   variable pilote, jamais une valeur clinique.
3. Le serveur recalcule lui-même les valeurs qui deviennent masquées. Il exige que la
   déclaration envoyée par l'écran corresponde **exactement** à ce calcul ; sinon conflit
   structuré, et **rien** n'est écrit. Les entrées locales sont préservées.
4. Recocher le pilote ne fait **pas** revenir les valeurs effacées : l'écran le dit, et le
   journal des corrections les conserve.

Les options écartées : le refus tant que des valeurs existent (oblige à ouvrir chaque lésion pour
corriger un diagnostic saisi par erreur), et la tolérance des valeurs masquées (la donnée dirait
une chose et le formulaire une autre ; une occurrence finalisée ne pourrait plus être
réenregistrée, et l'export émettrait la valeur).

**Forme technique à trancher dans L74b** : L72e a ajouté des surcharges
`update_patient(…, p_withdrawn_occurrences)` pour éviter les ambiguïtés PostgREST. La voie la
plus simple est d'**étendre le contenu** de cette déclaration (champs effacés par occurrence)
plutôt que d'ajouter un paramètre, qui créerait une troisième famille de surcharges. Le retrait
d'un bloc entier (L72e, suppression douce des occurrences) et l'effacement de variables (L74)
doivent pouvoir figurer dans la **même** déclaration : décocher un diagnostic peut produire les
deux à la fois.

### D5 — Refus des règles sans effet, à l'écriture ✅

On raisonne par **espace d'évaluation** : fiche patient, rencontre ordinaire, et chaque groupe
répétable. `assert_rule_structure` refuse, avec un message qui dit pourquoi :

| Règle | Exigence |
|---|---|
| `visible` sur une variable | Pilote et cible dans le même espace, **ou** pilote permanent et cible dans un groupe (nouveau) |
| `required`, comparaison | Pilote et cible (ou les deux opérandes) dans le **même** espace |
| `visible` sur un bloc racine portant un groupe enfant | Pilote **permanent** (P5) |

**Contrainte impérative :** `validate_template_version_invariants` rejoue `assert_rule_structure`
sur **toutes** les règles d'une version à chaque modification de structure
([20260927121847](../supabase/migrations/20260927121847_batch_visibility_graph_validation.sql)).
Durcir la fonction sans précaution rendrait non modifiable toute version qui porte déjà une règle
dormante. Le refus s'applique donc **à l'écriture d'une règle** (création ou modification), pas
au rejeu des invariants. Les règles existantes sont **signalées** dans l'éditeur, sans blocage.

Cas symétrique de P5 : rendre répétable une sous-section, ou y déplacer un groupe, sous un bloc
déjà piloté par une variable de rencontre. Le refus doit figurer dans la garde d'écriture des
sections, avec la même réserve sur le rejeu des invariants.

## 5. Inventaire des sites d'évaluation d'une occurrence

Chaque ligne rend un **verdict faux sans erreur** si elle est oubliée : la variable reste masquée
ou n'est pas réclamée. C'est le risque principal du lot.

### 5.1 Serveur

| Site | Rôle | Changement |
|---|---|---|
| `assert_curated_complete`, branche rencontre avec `group_section_key` ([repeatable_groups](../supabase/migrations/20260918191752_repeatable_groups.sql)) | Valeurs masquées (insertion), requis, règles bloquantes et valeurs masquées à la finalisation | Lire `patient.data` sous `for share`, puis passer les données fusionnées aux contrôles de masquage et de complétude ; règles bloquantes selon §3.1 |
| `form_record_assert_no_changed_hidden_values` (mise à jour E3) | Valeur masquée **modifiée** | Données fusionnées pour `old` et `new` |
| RPC qui vérifient en amont : `create_encounter`, `update_encounter`, `update_encounter_compatible`, brouillons de mission ([20261001150000](../supabase/migrations/20261001150000_mission_partial_encounter_drafts.sql)), `commit_work_draft` | Contrôle anticipé de valeurs masquées | Données fusionnées, ou suppression du contrôle anticipé s'il double le déclencheur. **À trancher site par site, sans perdre les codes d'erreur attendus par les clients** |
| `form_record_context_json` (contexte E3 d'une occurrence) | Variables masquées et manquantes rendues au client | Données fusionnées |
| `missing_required_fields`, appelée par `base_completeness_stats`, `export_incomplete_records`, `base_completion_queue_page`, `my_todo_counts` | Complétude, file de complétion, filtre d'export | Chaque appelant joint déjà `patient p on p.id = e.patient_id` : il passe les données fusionnées |
| `record_completion_summary` ([20261003230000:404](../supabase/migrations/20261003230000_completion_queue_visibility_rate.sql)) | Taux d'affichage et de documentation | Idem |
| `assert_rule_structure` | Contrat des règles | D2 (pilote permanent → variable de groupe, `visible` seulement) ; refus D5 à l'écriture |
| Retrait côté patient (`guard_patient_group_withdrawal`, `update_patient(…, p_withdrawn_occurrences)`) | D4 | Calculer les valeurs d'occurrence qui deviennent masquées et exiger la déclaration |

**Concurrence.** La visibilité d'une occurrence dépend désormais de la fiche patient. Toute
écriture d'occurrence lit donc `patient.data` sous `for share`, et la mise à jour de la fiche
verrouille déjà ses occurrences (L72e, `patient_group_withdrawal_prepare`). Les deux écritures
sont ainsi sérialisées : une occurrence ne peut pas être validée contre un contexte qu'une
transaction concurrente est en train de changer. `guard_group_occurrence_block_visible` lit
aujourd'hui `patient.data` **sans** verrou : à aligner.

**Version.** L'occurrence s'évalue dans **sa** version historique, comme aujourd'hui. Le
contexte est filtré sur les variables permanentes de cette même version. Les clés étant stables
d'une version à l'autre, une fiche patient sur une version plus récente reste lisible.

### 5.2 Web

| Site | Changement |
|---|---|
| `RepeatableGroup.tsx` (`hiddenFieldKeys` l. 286 et 313, `evaluateRules`, `validateValues`) | Ensemble masqué calculé sur `contexte ⊕ brouillon` ; règles et validation sur le brouillon seul ; enregistrer **le brouillon seul** |
| `PendingRepeatableGroup.tsx` (création de patient, L69) | Contexte = valeurs **locales non enregistrées** de la fiche. Au rejeu, le serveur évalue contre la fiche créée juste avant : même verdict |
| `EditPatient.tsx`, `NewPatient.tsx` | Transmettre les valeurs courantes de la fiche aux groupes. **C'est ce qui donne la fluidité** : cocher « trauma » fait apparaître la colonne dans le tableau des lésions sans recharger. Annonce D4 avant l'enregistrement |
| Tableau d'occurrences (`RepeatableGroup.tsx`, `visibleColumns`) | Une colonne masquée par le contexte l'est pour toutes les lignes : on retire la colonne. Un masquage interne à l'occurrence reste au niveau de la cellule |
| `PatientDetail.tsx`, `CurationTask.tsx`, `recordCompletion.ts`, `localWorkDrafts.ts` | Même fusion pour la lecture, la curation et la complétude locale |
| Hors ligne (`offline.ts`) | L'instantané contient déjà `patient.data`. À prouver par test : correction hors ligne d'une occurrence, puis rejeu après un changement de contexte → conflit classé, aucune écriture partielle |
| `RuleForm.tsx` | Pour une cible de groupe, proposer les variables permanentes comme pilotes **du seul verbe « afficher »**. Libellé explicite : « condition lue sur la fiche patient ». Signaler les règles existantes refusées par D5 |
| `FormPreview.tsx` | L'aperçu d'un groupe simule le contexte avec les valeurs permanentes saisies dans l'aperçu |
| `rulesForRepeatableSection` | Code mort : le supprimer |

### 5.3 Export

L'export ne réévalue pas la visibilité : il émet les valeurs stockées
([exportContract.ts:95](../supabase/functions/generate-export/exportContract.ts)). Avec D4
(effacement déclaré), aucune valeur masquée ne subsiste, donc **rien à changer** dans
`handler.ts`. Seul `export_incomplete_records` (§5.1) est concerné. Un test le vérifie.

## 6. Découpage

| Sous-lot | Objet | Pourquoi séparé |
|---|---|---|
| **L74a** | Socle serveur : `occurrence_evaluation_data`, séparation §3.1, tous les sites du §5.1 sauf le retrait, `assert_rule_structure` (D2), verrou `for share` | Migration, déclencheurs et fonctions de complétude sont **couplés** : un seul responsable d'écriture |
| **L74b** | Retrait D4 : calcul serveur, déclaration commune avec L72e, effacement journalisé | Porte le risque, comme L72e. **À estimer en premier** |
| **L74c** | Écrans de saisie : fusion web, tableau, création de patient, curation, hors ligne, annonce D4 | Territoire `src/screens/member` + `src/domain` |
| **L74d** | Éditeur : `RuleForm`, `FormPreview`, messages | Territoire `src/screens/staff`, disjoint de L74c |
| **L74e** | D5 : refus à l'écriture des règles sans effet, signalement des existantes, garde symétrique sur les sections | Touche `assert_rule_structure` : **après** L74a, jamais en parallèle |

**Ordre.** Estimation de L74b, puis L74a. L74b, L74c et L74d peuvent ensuite avancer en
parallèle (surfaces disjointes). L74e vient après L74a. **Jalon utilisable : L74a à L74d.**
Sans L74b, décocher un diagnostic laisserait des valeurs masquées dans les occurrences : L74b
n'est pas optionnel avant une utilisation réelle.

## 7. Ce qui ne change pas

RLS et cloisonnement ; écriture par RPC uniquement ; journal des corrections ; verrou optimiste
par occurrence ; borne à 50 occurrences ; héritage de visibilité du bloc (L72) ; interdiction de
cibler un groupe par une règle (G-d) ; une occurrence ne contient que des variables de rencontre ;
sémantique des rencontres ordinaires ; comportement des règles `required` et de comparaison
existantes ; export.

## 8. Hors périmètre

- Obligation ou comparaison pilotée par une variable permanente sur une variable de groupe (D2).
- Les rencontres ordinaires (D1) : cadrage séparé si le besoin apparaît.
- Une variable permanente qui dépend du contenu des occurrences (« si au moins une lésion est
  instable ») : agrégat sur plusieurs lignes.
- Une occurrence qui dépend d'une autre occurrence ou d'une rencontre ordinaire.
- Une règle de bloc dans un groupe (un groupe n'a pas de sous-section).
- Restauration des valeurs effacées par D4 en recochant le pilote.

## 9. Plan de tests

### 9.1 PostgreSQL

1. **Non-régression stricte.** Une version sans règle permanent → groupe donne, avant et après
   L74, des résultats identiques pour les quatre fonctions de complétude,
   `record_completion_summary` et le contexte E3.
2. `visible` permanent → groupe : contexte vrai → la valeur est acceptée et réclamée si la
   variable est requise ; contexte faux → la variable n'est pas réclamée, et une valeur est
   refusée à la finalisation.
3. `contains_any` sur le diagnostic patient → variable de groupe : une valeur est refusée **à tout
   statut** quand le diagnostic est absent, et acceptée quand il est présent.
4. **D3, inertie conservée** : une règle `required` permanent → groupe déjà enregistrée ne
   réclame toujours rien, quelle que soit la fiche patient.
5. **Isolation des règles patient** : une règle bloquante qui ne porte que sur des variables
   permanentes, violée sur la fiche, **ne bloque pas** la finalisation d'une occurrence.
6. Cascade : un pilote permanent masque une variable de groupe, qui pilote elle-même une autre
   variable du groupe → les deux sont masquées.
7. Le contexte **n'est jamais écrit** : `encounter.data` ne contient aucune clé permanente après
   création, correction, rejeu et brouillon de travail.
8. Complétude, file de complétion et filtre d'export utilisent la fiche patient **courante**.
9. Concurrence : modification de la fiche et écriture d'occurrence concurrentes → sérialisées,
   jamais validées contre un contexte périmé.
10. D4 : décocher le pilote avec N occurrences valorisées → déclaration exacte acceptée, valeurs
    effacées, une correction journalisée par occurrence. Déclaration inexacte → conflit, rien
    n'est écrit. Retrait de bloc (L72e) et effacement de variables dans la même écriture.
11. `assert_rule_structure` : `visible` permanent → groupe accepté ; `required` et comparaison
    permanent → groupe refusés à l'écriture ; cible permanente pilotée par une variable de groupe
    refusée ; règles D5 refusées à l'écriture mais **pas** au rejeu des invariants d'une version
    existante.
12. Version historique d'occurrence ≠ version de la fiche : le contexte est lu avec les clés
    permanentes de la version de l'occurrence.

### 9.2 Web

13. Cocher le pilote sur la fiche fait apparaître la colonne et le champ dans le formulaire
    d'occurrence, **sans recharger**. Le décocher les masque et annonce l'effacement (D4).
14. Création de patient : les occurrences en attente sont évaluées contre la fiche locale. Le
    rejeu ordonné donne le même verdict.
15. Le payload envoyé pour une occurrence ne contient **aucune** clé permanente.
16. Hors ligne : correction d'une occurrence puis changement du contexte côté serveur → conflit
    classé, aucune perte d'entrée locale.
17. Éditeur : un pilote permanent est proposé pour une cible de groupe, **uniquement** avec
    « afficher », et avec le bon libellé. L'aperçu simule correctement. Une règle existante
    refusée par D5 est signalée sans bloquer l'édition de la version.
18. Non-régression : un groupe sans règle de contexte s'affiche à l'identique de L72.

### 9.3 Commandes

`npm run schema`, inspection du snapshot, puis `npm run schema:check` ; tests ciblés ;
`npm run edge:test` pour le filtre d'export ; lint et typecheck. Vérifier la cible locale avant
tout test qui écrit des données. Détail dans `meddata-release-check`.

## 10. Critères d'acceptation

1. Une variable de groupe peut être montrée ou masquée selon une variable permanente, et l'effet
   est visible **pendant** la saisie de la fiche.
2. Aucune valeur permanente n'est copiée dans une occurrence.
3. Une règle qui ne porte que sur la fiche patient n'affecte jamais une occurrence ; les règles
   `required` et de comparaison existantes gardent leur comportement.
4. Une version sans règle de contexte donne des résultats identiques avant et après L74.
5. Décocher un pilote ne laisse aucune valeur masquée dans une occurrence, et l'effacement est
   annoncé avant l'enregistrement.
6. L'écran et le serveur rendent le même verdict, y compris hors ligne et à la création de
   patient.
7. Une règle qui ne peut pas fonctionner est refusée à sa création, avec un message qui dit
   pourquoi ; aucune version existante ne devient non modifiable.
8. Aucune migration déjà appliquée n'est modifiée ; aucun message d'erreur ne nomme une valeur
   clinique.

## 11. Risques

| Risque | Portée | Traitement |
|---|---|---|
| Un site du §5 oublié : verdict faux, sans erreur | **Élevée** | Inventaire du §5 relu dans L74a ; tests 1, 2 et 8 bloquants |
| Contexte passé par erreur à `rule_holds` : règles dormantes activées, règles patient réévaluées | **Élevée** | Séparation §3.1, tests 4 et 5 |
| D4 déborde et impose le repli (refus) | Moyenne | Estimer L74b en premier |
| Durcissement D5 qui bloque des versions existantes | Moyenne | Refus à l'écriture seulement, test 11 |
| Coût de la fusion dans les requêtes de complétude (une évaluation de visibilité par occurrence) | Faible à moyenne | `record_completion_summary` saute déjà l'évaluation quand la version n'a aucune règle `visible` ; mesurer sur le jeu de 402 variables / 238 règles de L73 |

## 12. Estimation de L74b (effacement déclaré) — 6 octobre 2026

**Verdict : faisable sans repli.** L72e a déjà construit presque toute la mécanique. L74b
l'**étend** au lieu de la dupliquer, et l'option « refuser la modification » n'est pas
nécessaire. Taille estimée : une migration d'environ 350 à 450 lignes, soit les deux tiers de
L72e (631 lignes), et une retouche limitée de l'écran.

### 12.1 Ce qui est réutilisé tel quel

| Pièce existante (L72e, [20260924090000](../supabase/migrations/20260924090000_group_block_visibility_withdrawal.sql)) | Rôle dans L74b |
|---|---|
| Déclencheur `trg_patient_group_withdrawal` sur `patient.data` | Couvre **déjà tous** les chemins d'écriture de la fiche : `update_patient`, `update_patient_compatible`, import, curation, réparation des clés, brouillon de travail. Il suffit de lui faire calculer aussi les effacements |
| Surcharges `update_patient(…, p_withdrawn_occurrences)` et `update_patient_compatible(…, p_withdrawn_occurrences)` | **Aucune nouvelle signature** : seul le contenu JSON de la déclaration s'enrichit. Pas de troisième famille de surcharges, pas d'ambiguïté PostgREST |
| `patient_group_withdrawal_prepare` | Verrouille déjà la fiche (`for update`) puis **toutes** les occurrences vivantes du patient. Aucune occurrence ne peut être créée, corrigée ou supprimée pendant l'enregistrement : la concurrence est réglée |
| `patient_group_withdrawal_commit` | Comparaison **exacte** déclaration / calcul serveur, conflit structuré sinon, tout ou rien |
| `group_withdrawal_error` et codes `GROUP_WITHDRAWAL_*` | Mêmes codes, même classement côté écran (`EditPatient.tsx` gère déjà conflit et rechargement en préservant les saisies) |
| `guard_base_version_group_withdrawal` | Un changement de version qui ferait apparaître des effacements est refusé avec des comptes, comme pour les blocs |
| `pendingGroupWithdrawals` ([groupWithdrawal.ts](../src/domain/groupWithdrawal.ts)) et la confirmation d'`EditPatient` | La confirmation existe déjà ; elle ajoute une ligne par variable effacée |
| Effacement journalisé de `delete_template_field` ([20261005010000](../supabase/migrations/20261005010000_in_use_field_and_rule_edits.sql)) | Précédent exact : journal **avant** effacement dans `field_change_log` avec une source dédiée, puis réécriture de `encounter.data` |

### 12.2 Ce qui est à écrire

**Serveur (migration additive) :**

1. `patient_context_erasures(patient, version, ancienne fiche, nouvelle fiche)` : pour chaque
   occurrence vivante **qui n'est pas retirée avec son bloc**, les variables de l'occurrence,
   renseignées, masquées avec la nouvelle fiche et visibles avec l'ancienne (cascade comprise :
   point fixe de `visibility_hidden_fields` sur `contexte ⊕ occurrence`). Rend identifiants,
   révisions et clés, jamais de valeur.
2. Déclaration enrichie : à côté de `occurrences` (retrait de bloc), une entrée
   `clearedFields: [{id, recordRevision, fieldKeys}]` par groupe. Contrôle de forme dans
   `prepare`, comparaison exacte dans `commit`.
3. Application dans `commit`, **après** les suppressions douces de L72e : pour chaque
   occurrence, journal `field_change_log` (ancienne valeur, nouvelle nulle, motif engendré qui
   nomme la variable pilote par son **libellé**), puis retrait des clés de `encounter.data`.
4. Nouvelle source `visibility_withdrawal` dans la contrainte `field_change_log_source_check`
   (même procédé que `field_deletion` : suppression et recréation de la contrainte).
5. `guard_patient_group_withdrawal` et `guard_base_version_group_withdrawal` : ajouter les
   effacements au calcul ; le détail d'erreur porte `clearedFields`.

**Web :**

6. `pendingContextErasures` dans `groupWithdrawal.ts`, miroir du calcul serveur, et extension du
   type `GroupWithdrawalDeclaration`.
7. `EditPatient.tsx` : la confirmation annonce « 3 lésions perdront *Gradation AO* » et précise
   que recocher le pilote ne restaure rien.

### 12.3 Points à vérifier au démarrage de L74b

| Point | Pourquoi | Piste |
|---|---|---|
| **Brouillons de curation** (`curation_draft.encounters`) | Ils gardent une copie des valeurs d'occurrence. Une finalisation ultérieure pourrait réécrire la valeur effacée, ou échouer sur une valeur masquée | Réécrire les brouillons concernés dans la même transaction, comme `rewrite_curation_drafts_for_field`, ou vérifier que la finalisation d'un brouillon périmé est déjà refusée |
| **Occurrence ancienne ou incohérente** | L'effacement réécrit l'occurrence, donc rejoue tous ses contrôles d'écriture. Une occurrence devenue invalide pour une autre raison (changement de version) ferait échouer tout l'enregistrement de la fiche | Test dédié ; si le cas existe, message qui nomme l'occurrence bloquante plutôt qu'un refus opaque |
| **Brouillons de travail** (`work_draft`, `encounter_update`) | Ils portent `entity_revision` | L'effacement fait avancer la révision : le brouillon périmé est déjà refusé comme conflit. À confirmer par test |
| **Chemin `work.commit()` d'`EditPatient`** | Il n'envoie pas de déclaration (limite connue de L72e) | Le déclencheur le refuse (`GROUP_WITHDRAWAL_REQUIRED`) : rien n'est perdu, mais le message est générique. Inchangé par L74b |

### 12.4 Ce qui ne pose pas de difficulté

- **Hors ligne :** la fiche patient ne se modifie pas hors ligne (seules la création de patient
  et les écritures de rencontre sont mises en file). Aucun effacement ne naît donc hors ligne.
  Une correction d'occurrence mise en file avant un effacement est rejouée contre une révision
  qui a avancé : `CONFLIT_VERSION`, déjà classé en conflit par `classifySyncError`, et la saisie
  locale est conservée.
- **Ancien client :** il envoie l'ancienne forme de déclaration. Le serveur refuse avec
  `GROUP_WITHDRAWAL_REQUIRED`, que l'écran actuel traite déjà par un rechargement. Rien n'est
  écrit à moitié.
- **Coût :** au plus 50 occurrences par groupe, deux évaluations de visibilité par occurrence,
  et seulement quand la fiche change **et** que le patient a des occurrences.

### 12.5 Tests propres à L74b

En plus du test 10 du §9 :

- décocher un pilote qui masque à la fois un bloc (L72e) et des variables d'un autre groupe :
  une seule déclaration, une seule transaction ;
- une occurrence retirée avec son bloc n'apparaît **pas** dans les effacements ;
- cascade : la variable effacée pilotait une autre variable de l'occurrence → les deux sont
  déclarées et effacées ;
- import, curation et changement de version qui provoqueraient un effacement → refus
  structuré, rien n'est écrit ;
- journal : une ligne `field_change_log` par variable effacée, source `visibility_withdrawal`,
  aucun motif ne contient de valeur clinique ;
- brouillon de curation et brouillon de travail après effacement : comportement retenu au §12.3.

## 13. État de L74a — socle serveur (7 octobre 2026)

Statut : **implémenté, en revue** (PR brouillon vers `develop`). Migration additive unique
`20261006120000_occurrence_patient_context.sql` ; aucune migration existante modifiée ;
rien n'est appliqué à distance.

### 13.1 Ce qui est livré

- `occurrence_evaluation_data(version, patient.data, occurrence)` : l'occurrence complétée par
  les clés de portée `patient` **dans la version évaluée** (§3). Invoker, exécutable par
  `authenticated` (les requêtes de complétude sont invoker).
- Séparation §3.1 : nouvelle surcharge `assert_validation_rules(version, data, hidden)`. Les
  règles bloquantes lisent l'occurrence **seule** ; l'ensemble masqué vient des données
  fusionnées. La signature historique `assert_validation_rules(version, data)` est inchangée.
- `assert_rule_structure` accepte `visible` d'une variable permanente vers une variable d'un
  groupe répétable (racine ou sous-section). Les autres combinaisons inter-fiches gardent le
  même refus et le même message ; aucun durcissement D5 (L74e).

### 13.2 Sites branchés (§5.1)

| Site | Branchement |
|---|---|
| `assert_curated_complete`, branche occurrence | Fiche lue `for share`. Insertion : `assert_block_hidden_values` et `assert_contains_any_hidden_values` sur les données fusionnées (version historique). Mise à jour : `form_record_assert_no_changed_hidden_values` sur ancienne **et** nouvelle valeur fusionnées avec la même fiche (version active). Complétude et `assert_no_hidden_values` fusionnées (version historique). Règles bloquantes : variante §3.1. Valeurs connues et `assert_data_valid` : occurrence seule |
| `form_record_assert_no_changed_hidden_values` | Reçoit les données fusionnées de ses deux appelants (déclencheur, `update_encounter_compatible`) ; fonction elle-même inchangée |
| `create_encounter` (corps de mission 20261001150000) | Complétude anticipée fusionnée ; la fiche est déjà verrouillée `for update` |
| `update_encounter` (idem) | Fiche `for share` **avant** la ligne ; contrôles anticipés de bloc, de `contains_any` et de complétude fusionnés ; codes d'erreur inchangés |
| `update_encounter_compatible` (idem) | Fiche `for share` entre la base et la ligne ; complétude et contrôle E3 fusionnés |
| `commit_work_draft` (correction d'occurrence) | La projection serveur retirait les réponses masquées calculées **sans** contexte : une variable révélée par la fiche aurait été retirée en silence. Masquage calculé sur `contexte ⊕ brouillon` ; fiche `for share` avant `assert_work_draft_context`, qui verrouille la ligne |
| `form_record_context_json` (contexte E3) | Contexte fusionné avec les clés permanentes des versions historique et active ; les `values` et `fields` rendus restent ceux des variables de rencontre |
| `export_incomplete_records` | `missing_required_fields` reçoit les données fusionnées avec la fiche **courante** |
| `base_completion_queue_page`, `my_todo_counts` | `record_completion_summary_in_context` reçoit les données fusionnées |
| `guard_group_occurrence_block_visible` | Fiche lue `for share` (§5.1, concurrence) |

Les rencontres ordinaires (`group_section_key` nul) et la fiche patient passent exactement
les mêmes données qu'avant (D1). `create_encounter_idempotent`, `replay_encounter_create`
et `replay_encounter_update` délèguent aux RPC ci-dessus : couverts sans redéfinition.

### 13.3 Constats faits en route (hors inventaire initial)

1. **`commit_work_draft`** n'est pas un simple contrôle anticipé : c'est une projection qui
   **retire** des valeurs (voir 13.2). Sans branchement, perte silencieuse de saisie.
2. **Suppression douce d'une occurrence.** `assert_curated_complete` rejoue tous ses contrôles
   sur une suppression. Avec le contexte, un changement de fiche (pilote décoché ou coché)
   pouvait rendre une occurrence **impossible à supprimer**, y compris par le retrait L72e.
   Une suppression douce pure (données et statut inchangés) d'une occurrence ne rejoue donc
   plus ces contrôles. Rencontres ordinaires inchangées.
3. **Ordre des verrous.** Les écritures interactives d'occurrence prennent la fiche avant la
   ligne, comme `patient_group_withdrawal_prepare` (L72e) : pas d'interblocage. Les
   réécritures en masse d'administration (`delete_template_field`, renommage de clés) mettent
   à jour des occurrences sans verrouiller la fiche d'abord : un interblocage avec un retrait
   concurrent reste possible, détecté par PostgreSQL (une transaction annulée, rien d'écrit
   à moitié). Rare ; non traité ici.
4. **`base_completeness_stats`** n'évalue pas la visibilité (comptes de valeurs par variable) :
   rien à brancher. **`record_completion_summary`** n'a aucun appelant en base ni côté web ;
   la file et les compteurs appellent `record_completion_summary_in_context`, branché.
5. **`finalize_curation_task`** et **`import_records_legacy`** ne créent que des rencontres
   ordinaires : hors D1.
6. **Empreinte de contexte E3.** `form_record_context_fingerprint` ne porte pas la fiche
   patient : après un changement de contexte, un client garde une empreinte valide. Le serveur
   rejuge sous verrou avec la fiche engagée ; l'écriture est alors refusée
   (`block_hidden_value` ou `contains_any_hidden_value`, action `refresh_required`). À
   connaître pour L74c (classement en conflit, entrées locales préservées).
7. **Avant L74b**, décocher un pilote laisse des valeurs masquées dans les occurrences ; une
   occurrence finalisée concernée ne peut plus être réenregistrée tant qu'elle les porte
   (refus `Variable masquee`). Comportement attendu, levé par L74b.

### 13.4 Tests (`test/occurrence-patient-context.test.ts`)

Tests §9.1 couverts : 1 (deux bases, avant et après la migration, mêmes identifiants :
`export_incomplete_records`, file, compteurs, `missing_required_fields`,
`record_completion_summary` et contexte E3 identiques), 2, 3, 4, 5, 6, 7 (création,
`update_encounter`, `update_encounter_compatible`, brouillon de travail ; le rejeu hors ligne
délègue à `update_encounter`), 8, 9 (verrou observé dans `pg_stat_activity`, puis refus sur
le contexte engagé), 11 partie D2, 12. Hors L74a : 10 (L74b), 11 partie D5 (L74e).

## 14. État de L74b — effacement déclaré (7 octobre 2026)

Statut : **implémenté, en revue** (PR brouillon vers `develop`). Migration additive unique
`20261007120000_occurrence_context_withdrawal.sql` ; aucune migration existante modifiée ;
rien n'est appliqué à distance.

### 14.1 Ce qui est livré

- **Calcul serveur** `patient_context_erasures` : pour chaque occurrence vivante non retirée
  avec son bloc, les variables renseignées (clé présente, valeur non nulle), masquées avec la
  nouvelle fiche et visibles avec l'ancienne. Point fixe de `visibility_hidden_fields` sur
  `occurrence_evaluation_data`, dans la version **active** de la base (celle du retrait L72e).
  Seules comptent les variables atteignables depuis un pilote permanent
  (`context_driven_field_keys`) : un masquage purement interne à l'occurrence garde la
  tolérance d'avant L74, et une version sans règle de contexte ne calcule rien.
- **Déclaration commune** : à côté des entrées L72e `{sectionKey, occurrences}`, des entrées
  `{sectionKey, clearedFields: [{id, recordRevision, fieldKeys}]}`, une par groupe, exactement
  l'une des deux listes par entrée. Mêmes surcharges `update_patient(…, p_withdrawn_occurrences)`
  et `update_patient_compatible(…, p_withdrawn_occurrences)`, **aucune nouvelle signature**.
  Comparaison exacte dans `patient_group_withdrawal_commit` : toute divergence donne
  `GROUP_WITHDRAWAL_CONFLICT`, rien n'est écrit.
- **Application**, après les suppressions douces : une ligne `field_change_log` par variable
  effacée **avant** l'effacement (ancienne valeur, nouvelle nulle, source
  `visibility_withdrawal`), motif engendré « Variable masquée par « *libellé du pilote* » :
  valeur effacée avec l'enregistrement de la fiche ». La révision de l'occurrence avance.
- **Gardes** : `guard_patient_group_withdrawal` refuse tout effacement non déclaré
  (`GROUP_WITHDRAWAL_REQUIRED`, détail `clearedFields` quand il y en a ; détail d'un retrait
  seul inchangé). `guard_base_version_group_withdrawal` refuse un changement de version qui
  effacerait des valeurs, avec des comptes (`clearedOccurrences`, `clearedValues`,
  `clearedSectionKeys`).
- **Web** : `pendingContextErasures` (miroir) dans `groupWithdrawal.ts`, intégré à
  `pendingGroupWithdrawals` (une seule déclaration). `EditPatient` passe les variables de groupe
  et ouvre la confirmation existante, qui annonce « *Lésions* : 2 occurrence(s) perdront
  « Gradation AO » » et précise que rétablir la variable ne restaure rien. Nouveau message
  pour `GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED`.

### 14.2 Points du §12.3, décidés le 7 octobre 2026

| Point | Décision | Conséquence |
|---|---|---|
| Brouillons de curation | **Refus**, comme L72e | Les rencontres d'un brouillon sont insérées comme rencontres ordinaires : elles ne réécrivent jamais une occurrence. La fiche du brouillon passe par le déclencheur : une finalisation qui décocherait un pilote est refusée (`GROUP_WITHDRAWAL_REQUIRED`), rien n'est écrit. Il faut corriger d'abord la fiche dans l'écran d'édition, qui annonce l'effacement |
| Occurrence ancienne ou incohérente | **Obligation historique levée pour un effacement seul** | Une donnée validée ne repasse jamais en brouillon (`guard_no_curated_downgrade`) : sans cela, une lésion née dans une version qui exigeait la variable rendait la fiche impossible à corriger. `assert_curated_complete` (corps L74a) ne rejoue pas `assert_required_complete` historique quand l'écriture est un effacement déclaré : réglage local posé par le commit pour cette occurrence, **et** écriture qui ne fait que retirer des clés, statut inchangé. Tous les autres contrôles restent ; si l'un refuse (par exemple une règle bloquante `required` de l'ancienne version), `GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED` nomme le groupe et l'occurrence, sans message interne |
| Brouillons de travail | Confirmé | Un brouillon d'occurrence lu avant l'effacement est refusé (`DRAFT_CONTEXT_CHANGED`, `refresh_required`) |
| `work.commit()` d'`EditPatient` | Inchangé | Refus `GROUP_WITHDRAWAL_REQUIRED` (le code devient `DRAFT_VALIDATION` dans `commit_work_draft`) |

### 14.3 Constats faits en route

1. **Tests L74a adaptés.** Deux tests de `occurrence-patient-context.test.ts` décochaient un
   pilote par écriture directe en laissant les valeurs en place. Depuis L74b, cette écriture
   exige une déclaration : les tests posent désormais explicitement le réglage local des
   surcharges pour simuler un état hérité d'avant L74b. Leur objet (refus d'une correction
   jugée sur le contexte engagé, sérialisation) est inchangé.
2. **Valeur héritée masquée.** Une valeur déjà masquée avant l'écriture (déposée hors RPC, ou
   laissée avant L74b) n'est ni comptée ni effacée, comme un bloc déjà masqué (D10).
3. **Collision L74c.** `EditPatient.tsx` n'est touché qu'autour de la déclaration et de la
   confirmation.

### 14.4 Tests

- `test/occurrence-context-withdrawal.test.ts` (PostgreSQL embarqué, données fictives) :
  test 10 du §9.1 (non déclaré, déclaré exact, six déclarations inexactes, occurrence corrigée
  entre-temps, forme invalide, droit d'écriture) et §12.5 (retrait et effacement dans une
  déclaration, groupe retiré absent des effacements, cascade, valeur déjà masquée, voie
  compatible et rejeu, écriture directe, import, brouillon de fiche, changement de version
  refusé avec comptes et masquage interne toléré, occurrence ancienne « complète » ou
  « validée », occurrence bloquée par une règle, garde du réglage, brouillon d'occurrence,
  brouillon de curation).
- `src/screens/member/ContextErasure.test.tsx` : calcul miroir et confirmation.

