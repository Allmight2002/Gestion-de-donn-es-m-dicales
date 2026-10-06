# L74 — Variables permanentes comme contexte des occurrences de groupe répétable

- Statut : 📋 **cadré le 6 octobre 2026, non arbitré, non implémenté**
- Prérequis : L66 à L72 fusionnés (groupes répétables, groupe en sous-section, retrait de bloc)
- Surface serveur visée : `assert_rule_structure`, `assert_curated_complete` (branche rencontre),
  `guard_group_occurrence_block_visible`, fonctions de complétude (`missing_required_fields` et
  ses appelants), `form_record_context_json`, retrait côté fiche patient (L72e)
- Surface web visée : `RepeatableGroup`, `PendingRepeatableGroup`, `EditPatient`, `NewPatient`,
  `PatientDetail`, `CurationTask`, `recordCompletion`, `RuleForm`, `FormPreview`
- Périmètre autorisé : données fictives uniquement

---

## 1. Besoin

La fluidité de saisie repose sur les règles d'affichage. Le cas clinique qui bloque est le
suivant : **montrer ou exiger une variable d'occurrence selon une variable permanente du
patient**. Exemples :

- n'afficher la gradation AO Spine d'une lésion que si le patient a un diagnostic de trauma ;
- exiger le côté d'une lésion que si la pathologie du patient est latéralisée ;
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
| P3 | `required` : variable permanente → variable de groupe ou de rencontre | Ne se déclenche **jamais** (`rule_holds` : pilote absent → respectée) |
| P4 | Comparaison entre une variable permanente et une variable de rencontre | Jamais évaluée (opérande absent → respectée) |
| P5 | Bloc racine piloté par une variable de **rencontre** et portant un groupe enfant | Groupe **toujours masqué** : `repeatable_group_root_visible` lit `patient.data` (déduit de la lecture, non testé) |

Côté écran, `rulesForRepeatableSection` ([templateSections.ts:472](../src/domain/templateSections.ts))
était prévue pour écarter les règles inter-fiches d'une occurrence. **Aucun appelant ne
l'utilise** : l'occurrence reçoit toutes les règles actives. Le serveur et l'écran restent
cohérents entre eux (les deux masquent), mais rien ne prévient le concepteur.

## 3. Principe retenu : le contexte patient en lecture seule

> **Une occurrence s'évalue sur `contexte ⊕ occurrence`**, où le contexte est le sous-ensemble
> **de portée `patient`** de `patient.data`, lu au moment de l'évaluation. Le contexte n'est
> jamais écrit dans l'occurrence, jamais exporté avec elle et jamais validé par elle.

Ce principe tient sans renommer de clé : `field_key` est unique par version, **toutes portées
confondues** (`unique (template_version_id, field_key)`,
[tables:69](../supabase/migrations/20260616090200_tables.sql)). La fusion ne peut donc pas
produire de collision.

Les fonctions qui filtrent déjà par portée restent justes sans modification :
`assert_required_complete`, `missing_required_fields`, `assert_no_hidden_values`,
`assert_block_hidden_values` et `assert_contains_any_hidden_values` ne retiennent que les
variables `encounter` (ou celles du groupe). Seuls deux points demandent un traitement
spécifique :

1. **`assert_validation_rules` / `rule_holds`.** Sur des données fusionnées, une règle qui ne
   porte **que** sur des variables permanentes (« si diabète alors HbA1c requise », toutes deux
   permanentes) serait réévaluée dans l'occurrence. Une fiche patient incomplète bloquerait alors
   la finalisation d'une lésion. **Règle :** dans une occurrence, on n'évalue que les règles qui
   désignent au moins une variable **du groupe**.
2. **Les appelants.** Chaque site qui évalue une occurrence doit lui passer les données
   fusionnées. C'est l'inventaire du §5, et c'est le vrai coût du lot.

Une seule fonction SQL porte la fusion, et tous les sites l'appellent :

```
occurrence_evaluation_data(p_version uuid, p_patient_data jsonb, p_data jsonb) returns jsonb
  -- p_data || (clés de p_patient_data dont la variable est de portée 'patient' dans p_version)
```

La clé de l'occurrence l'emporte (`||` à droite), ce qui reste sans effet puisqu'il n'y a pas de
collision. Côté web, le miroir est une fonction pure de `templateSections.ts` utilisée par tous
les écrans d'occurrence.

## 4. Décisions à prendre

### D1 — Périmètre : occurrences seules, ou aussi les rencontres ordinaires ?

| Option | Effet |
|---|---|
| **Occurrences seules** (recommandé) | Répond au besoin. Les rencontres ordinaires gardent leur sémantique actuelle. Surface web limitée aux écrans de groupe, qui sont déjà affichés **dans** la fiche patient : les valeurs permanentes y sont disponibles |
| Occurrences et rencontres ordinaires | Même mécanisme serveur, mais `EncounterForm`, `EditEncounter` et la file hors ligne des visites doivent charger la fiche patient. Change aussi le sens des règles P3/P4 déjà écrites sur des visites |

**Recommandation : occurrences seules en v1.** La fonction de fusion est écrite pour pouvoir être
étendue ensuite sans changer de forme.

### D2 — Quels verbes bénéficient du contexte ?

La fusion rend le contexte disponible pour tous les verbes. La question est ce que l'éditeur
autorise à créer :

| Verbe, pilote permanent → cible de groupe | Proposition |
|---|---|
| `visible` | **Autorisé**. C'est le besoin |
| `required` | **Autorisé**. Il devient enfin effectif (P3) |
| Comparaison permanent ↔ groupe (« date de lésion ≥ date de naissance ») | **Autorisé**, sans coût supplémentaire |
| Toute règle dont la **cible** est permanente et le pilote dans un groupe | **Refusé** : une fiche patient ne lit pas ses occurrences (agrégat sur plusieurs lignes, hors périmètre) |

### D3 — Règles dormantes déjà enregistrées (P3, P4)

Des règles `required` ou de comparaison entre une variable permanente et une variable de groupe
peuvent déjà exister. Elles n'ont jamais rien fait. Avec L74, **elles s'activent** : des
occurrences « complètes » peuvent apparaître incomplètes dans la file de complétion, et une
nouvelle finalisation peut être refusée.

| Option | Effet |
|---|---|
| **Activer, après audit** (recommandé) | Une requête de readiness compte ces règles par version avant déploiement. Si le compte est nul, il n'y a rien à décider. Sinon, on décide version par version |
| Ne contextualiser que les règles créées après L74 | Exige un marqueur sur `validation_rule` et laisse deux sémantiques coexister pour la même forme de règle. Écarté sauf si l'audit révèle un cas réel |

Le dépôt ne porte que des données fictives : l'activation n'a pas de conséquence clinique
aujourd'hui. C'est le bon moment pour le faire.

### D4 — La fiche patient change et masque des valeurs d'occurrences

C'est **la partie dure**, comme le retrait de L72e. Exemple : on décoche « trauma » alors que
trois lésions portent une gradation AO. La gradation est désormais masquée dans ces trois
occurrences, mais ses valeurs restent dans trois **autres lignes**.

Aujourd'hui, à l'intérieur d'une même fiche, l'écran retire les valeurs masquées à
l'enregistrement après confirmation (`withoutHiddenValues`, `HiddenValuesConfirmation`). Le
serveur tolère une valeur masquée en brouillon, mais la refuse à la finalisation
(`assert_no_hidden_values`). Pour une cible `contains_any`, il la refuse à **tout** statut
(`assert_contains_any_hidden_values`).

| Option | Sort proposé | Motif |
|---|---|---|
| **Effacement déclaré, atomique** | **Recommandé** | Même logique que L72e : l'écran annonce « 3 lésions perdront la valeur *Gradation AO* ». L'enregistrement de la fiche efface ces valeurs dans les occurrences, dans la **même transaction**, avec une correction journalisée par occurrence. Le serveur exige que la déclaration corresponde **exactement** à ce qu'il calcule, sinon conflit et rien n'est écrit |
| Refuser la modification tant que des valeurs existent | Repli | Peu coûteux et honnête, mais oblige à ouvrir chaque occurrence avant de pouvoir corriger un diagnostic saisi par erreur. Contraire à l'objectif de fluidité |
| Tolérer les valeurs masquées | Écarté | La donnée dirait une chose et le formulaire une autre. Une occurrence finalisée dans la version active ne pourrait plus être réenregistrée (`assert_no_hidden_values` la refuse) et l'export continuerait d'émettre la valeur. C'est la divergence silencieuse que L72e a déjà écartée |

**Forme technique à trancher dans L74b** : L72e a ajouté des surcharges
`update_patient(…, p_withdrawn_occurrences)` pour éviter les ambiguïtés PostgREST. La voie la
plus simple est d'**étendre le contenu** de cette déclaration (champs effacés par occurrence) plutôt
que d'ajouter un nouveau paramètre, qui créerait une troisième famille de surcharges.

### D5 — Fermer les règles dormantes à la création

Puisque `assert_rule_structure` est réécrite, elle peut refuser les règles qui ne fonctionneront
jamais (P1, P2, P5), avec un message qui dit pourquoi.

**Contrainte impérative :** `validate_template_version_invariants` rejoue `assert_rule_structure`
sur **toutes** les règles d'une version à chaque modification de structure
([20260927121847](../supabase/migrations/20260927121847_batch_visibility_graph_validation.sql)).
Durcir la fonction sans précaution rendrait non modifiable toute version qui porte déjà une règle
dormante. Le refus doit donc s'appliquer **à l'écriture d'une règle** (création ou modification),
pas au rejeu des invariants. Les règles existantes sont signalées dans l'éditeur, sans blocage.

**Recommandation :** l'inclure, en sous-lot séparé (L74e). Sinon le concepteur continuera de
créer des règles sans effet, ce qui est l'inverse du but de ce lot.

## 5. Inventaire des sites d'évaluation d'une occurrence

Chaque ligne rend un **verdict faux sans erreur** si elle est oubliée : la variable reste masquée
ou n'est pas réclamée. C'est le risque principal du lot.

### 5.1 Serveur

| Site | Rôle | Changement |
|---|---|---|
| `assert_curated_complete`, branche rencontre avec `group_section_key` ([repeatable_groups](../supabase/migrations/20260918191752_repeatable_groups.sql)) | Valeurs masquées (insertion), requis, règles bloquantes et valeurs masquées à la finalisation | Lire `patient.data` sous `for share`, puis passer les données fusionnées à `assert_block_hidden_values`, `assert_contains_any_hidden_values`, `assert_required_complete`, `assert_validation_rules` (filtrée, §3) et `assert_no_hidden_values` |
| `form_record_assert_no_changed_hidden_values` (mise à jour E3) | Valeur masquée **modifiée** | Données fusionnées pour `old` et `new` |
| RPC qui vérifient en amont : `create_encounter`, `update_encounter`, `update_encounter_compatible`, brouillons de mission ([20261001150000](../supabase/migrations/20261001150000_mission_partial_encounter_drafts.sql)), `commit_work_draft` | Contrôle anticipé de valeurs masquées | Données fusionnées, ou suppression du contrôle anticipé s'il double le déclencheur. **À trancher site par site, sans perdre les codes d'erreur attendus par les clients** |
| `form_record_context_json` (contexte E3 d'une occurrence) | Variables masquées et manquantes rendues au client | Données fusionnées |
| `missing_required_fields`, appelée par `base_completeness_stats`, `export_incomplete_records`, `base_completion_queue_page`, `my_todo_counts` | Complétude, file de complétion, filtre d'export | Chaque appelant joint déjà `patient p on p.id = e.patient_id` : il passe les données fusionnées |
| `record_completion_summary` ([20261003230000:404](../supabase/migrations/20261003230000_completion_queue_visibility_rate.sql)) | Taux d'affichage et de documentation | Idem |
| `assert_rule_structure` | Contrat des règles | Autoriser D2 ; refus D5 à l'écriture |
| Retrait côté patient (`guard_patient_group_withdrawal`, `update_patient(…, p_withdrawn_occurrences)`) | D4 | Calculer les valeurs d'occurrence qui deviennent masquées et exiger la déclaration |

**Concurrence.** Une occurrence s'évalue désormais contre la fiche patient. Toute écriture
d'occurrence doit donc lire `patient.data` sous `for share`, et la mise à jour de la fiche
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
| `RepeatableGroup.tsx` (`hiddenFieldKeys` l. 286 et 313, `evaluateRules`, `validateValues`) | Évaluer sur `contexte ⊕ brouillon`, n'enregistrer **que** le brouillon |
| `PendingRepeatableGroup.tsx` (création de patient, L69) | Contexte = valeurs **locales non enregistrées** de la fiche. Au rejeu, le serveur évalue contre la fiche créée juste avant : même verdict |
| `EditPatient.tsx`, `NewPatient.tsx` | Transmettre les valeurs courantes de la fiche aux groupes. **C'est ce qui donne la fluidité** : cocher « trauma » fait apparaître la colonne dans le tableau des lésions sans recharger. Annonce D4 avant l'enregistrement |
| Tableau d'occurrences (`RepeatableGroup.tsx`, `visibleColumns`) | Une colonne masquée par le contexte l'est pour toutes les lignes : on retire la colonne. Un masquage interne à l'occurrence reste au niveau de la cellule |
| `PatientDetail.tsx`, `CurationTask.tsx`, `recordCompletion.ts`, `localWorkDrafts.ts` | Même fusion pour la lecture, la curation et la complétude locale |
| Hors ligne (`offline.ts`) | L'instantané contient déjà `patient.data`. À prouver par test : correction hors ligne d'une occurrence, puis rejeu après un changement de contexte → conflit classé, aucune écriture partielle |
| `RuleForm.tsx` | Proposer les variables permanentes comme pilotes d'une cible de groupe. Libellé explicite : « condition lue sur la fiche patient » |
| `FormPreview.tsx` | L'aperçu d'un groupe simule le contexte avec les valeurs permanentes saisies dans l'aperçu |
| `rulesForRepeatableSection` | Code mort : le supprimer, ou le réécrire comme filtre de §3.1 et l'utiliser |

### 5.3 Export

L'export ne réévalue pas la visibilité : il émet les valeurs stockées
([exportContract.ts:95](../supabase/functions/generate-export/exportContract.ts)). Avec D4
(effacement déclaré), aucune valeur masquée ne subsiste, donc **rien à changer** dans
`handler.ts`. Seul `export_incomplete_records` (§5.1) est concerné. Un test le vérifie.

## 6. Découpage

| Sous-lot | Objet | Pourquoi séparé |
|---|---|---|
| **L74a** | Socle serveur : `occurrence_evaluation_data`, filtre des règles, tous les sites du §5.1 sauf le retrait, `assert_rule_structure` (D2), verrou `for share` | Migration, déclencheurs et fonctions de complétude sont **couplés** : un seul responsable d'écriture |
| **L74b** | Retrait D4 : calcul serveur, déclaration, effacement journalisé | Porte le risque, comme L72e. **À estimer avant d'ouvrir L74c**, car le repli change l'ergonomie promise |
| **L74c** | Écrans de saisie : fusion web, tableau, création de patient, curation, hors ligne | Territoire `src/screens/member` + `src/domain` |
| **L74d** | Éditeur : `RuleForm`, `FormPreview`, messages | Territoire `src/screens/staff`, disjoint de L74c |
| **L74e** | D5 : refus des règles dormantes à l'écriture, signalement des existantes | Indépendant, mais touche `assert_rule_structure` : **après** L74a, jamais en parallèle |

**Ordre.** L74a d'abord. L74b, L74c et L74d peuvent ensuite avancer en parallèle (surfaces
disjointes). L74e vient après L74a. **Jalon utilisable : L74a + L74c + L74d**, et L74b avant
toute utilisation réelle. Sans L74b, décocher un diagnostic laisse des valeurs masquées dans les
occurrences.

## 7. Ce qui ne change pas

RLS et cloisonnement ; écriture par RPC uniquement ; journal des corrections ; verrou optimiste
par occurrence ; borne à 50 occurrences ; héritage de visibilité du bloc (L72) ; interdiction de
cibler un groupe par une règle (G-d) ; une occurrence ne contient que des variables de rencontre ;
sémantique des rencontres ordinaires (si D1 = occurrences seules) ; export.

## 8. Hors périmètre

- Une variable permanente qui dépend du contenu des occurrences (« si au moins une lésion est
  instable ») : agrégat sur plusieurs lignes.
- Une occurrence qui dépend d'une autre occurrence ou d'une rencontre ordinaire.
- Les rencontres ordinaires (si D1 est confirmée).
- Une règle de bloc dans un groupe (un groupe n'a pas de sous-section).

## 9. Plan de tests

### 9.1 PostgreSQL

1. **Non-régression stricte.** Une version sans règle permanent → groupe donne, avant et après
   L74, des résultats identiques pour les quatre fonctions de complétude,
   `record_completion_summary` et le contexte E3.
2. `visible` permanent → groupe : contexte vrai → la valeur est acceptée et réclamée si requise ;
   contexte faux → la variable n'est pas réclamée, et une valeur est refusée à la finalisation.
3. `contains_any` sur le diagnostic patient → variable de groupe : une valeur est refusée **à tout
   statut** quand le diagnostic est absent, et acceptée quand il est présent.
4. `required` permanent → groupe : exigé à la sortie du brouillon quand la condition est vraie.
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
    n'est écrit.
11. `assert_rule_structure` : D2 acceptée ; cible permanente pilotée par une variable de groupe
    refusée ; D5 refusée à l'écriture mais **pas** au rejeu des invariants d'une version
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
17. Éditeur : un pilote permanent est proposé pour une cible de groupe, avec le bon libellé.
    L'aperçu simule correctement.
18. Non-régression : un groupe sans règle de contexte s'affiche à l'identique de L72.

### 9.3 Commandes

`npm run schema`, inspection du snapshot, puis `npm run schema:check` ; tests ciblés ;
`npm run edge:test` pour le filtre d'export ; lint et typecheck. Vérifier la cible locale avant
tout test qui écrit des données. Détail dans `meddata-release-check`.

## 10. Critères d'acceptation

1. Une variable de groupe peut être montrée, exigée ou comparée selon une variable permanente, et
   l'effet est visible **pendant** la saisie de la fiche.
2. Aucune valeur permanente n'est copiée dans une occurrence.
3. Une règle qui ne porte que sur la fiche patient n'affecte jamais une occurrence.
4. Une version sans règle de contexte donne des résultats identiques avant et après L74.
5. Décocher un pilote ne laisse aucune valeur masquée dans une occurrence, et l'effacement est
   annoncé avant l'enregistrement.
6. L'écran et le serveur rendent le même verdict, y compris hors ligne et à la création de
   patient.
7. Aucune migration déjà appliquée n'est modifiée ; aucun message d'erreur ne nomme une valeur
   clinique.

## 11. Risques

| Risque | Portée | Traitement |
|---|---|---|
| Un site du §5 oublié : verdict faux, sans erreur | **Élevée** | Inventaire du §5 relu dans L74a ; tests 1, 2 et 8 bloquants |
| Règles patient réévaluées dans l'occurrence | **Élevée** | Filtre du §3, test 5 |
| Règles dormantes activées (D3) | Moyenne | Requête d'audit en readiness avant déploiement |
| D4 déborde et impose le repli | Moyenne | Estimer L74b avant L74c |
| Durcissement D5 qui bloque des versions existantes | Moyenne | Refus à l'écriture seulement, test 11 |
| Coût de la fusion dans les requêtes de complétude (une évaluation de visibilité par occurrence) | Faible à moyenne | `record_completion_summary` saute déjà l'évaluation quand la version n'a aucune règle `visible` ; mesurer sur le jeu de 402 variables / 238 règles de L73 |
