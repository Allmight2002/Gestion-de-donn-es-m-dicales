# L72 — Groupe répétable en sous-section

- Statut : 📋 **cadré le 20 septembre 2026, arbitré le 22** · **L72a implémenté localement le
  23 septembre 2026** (voir « État de L72a » en fin de document) · L72b à L72e non implémentés
- Prérequis : **L66 à L71 fusionnés** — L71 par la PR #326, présente sur `origin/develop`
- Surface serveur visée : `template_section` (contrainte), `guard_template_section_write`,
  `template_section_field_keys`, `assert_rule_structure`, `create_encounter`,
  `create_encounter_idempotent`, `generate-export/handler.ts`, `exportContract.ts`
- Surface web visée : `SectionsEditor`, `EditorStructure`, `FormPreview`, `templateSections.ts`,
  `SectionedFields`, `EditPatient`, `NewPatient`, `PatientDetail`
- Périmètre autorisé : données fictives uniquement

Complète [spec-groupes-repetables.md](spec-groupes-repetables.md), dont le §12 n'a **pas** tranché
ce cas : il exclut les sous-sections **à l'intérieur** d'un bloc répétable, jamais un bloc
répétable **enfant** d'un bloc. Le §4.1 pose la contrainte racine sans la motiver.

---

> **Arbitrage du porteur du besoin, 22 septembre 2026.** La **grande correction** est retenue :
> le groupe devient une sous-section et hérite du rang **et** de la visibilité de son bloc. La voie
> courte du §3 option 1 — autoriser une règle à cibler un groupe resté racine — est écartée, bien
> qu’elle règle le défaut le plus douloureux pour un coût moindre.
>
> **Ce que cet arbitrage corrige dans la hiérarchie des besoins du §1 :** l’ordre de lecture y est
> présenté en premier, mais c’est la **visibilité** qui fait mal. Un groupe qui s’affiche chez tous
> les patients n’a **aucun contournement** — la seule échappatoire est de renoncer au groupe et de
> revenir aux variables numérotées, c’est-à-dire de perdre l’occurrence comme unité d’analyse.
> L’ordre, lui, a un contournement coûteux (§12). Prioriser en conséquence à l’intérieur du lot :
> **L72c porte la valeur**.

## 1. Besoin

Cas de terrain relevé le 20 septembre 2026, sur une base **longitudinale** dont les variables de
bloc clinique sont en portée **patient**.

Un bloc racine `A` porte un diagnostic et trois sous-sections `A1 A2 A3`. Une règle d'affichage de
bloc, écrite par l'association diagnostic → bloc de L55, fait apparaître `A` et sa descendance
quand le diagnostic est sélectionné. Le groupe répétable `G1` — les lésions vertébrales, avec leur
gradation AO Spine — doit se lire **après `A1`**, à l'intérieur de la logique clinique du bloc.

Aujourd'hui c'est impossible, pour deux raisons distinctes :

1. **L'ordre.** `G1` est nécessairement un bloc racine. `normalize_template_section_order`
   ([hierarchy:61](../supabase/migrations/20260905143319_template_section_hierarchy.sql:61))
   réattribue un `display_order` global en profondeur d'abord, **groupé par racine**, et tourne à
   la fin de chaque réordonnancement et de chaque déplacement. Un bloc racine ne peut donc jamais
   porter un rang **à l'intérieur** de la grappe d'une autre racine. Les seules positions de `G1`
   sont *avant `A`* ou *après `A3`*.
2. **La visibilité.** Un groupe répétable ne peut pas être la cible d'une règle d'affichage
   ([spec §6.5](spec-groupes-repetables.md)). `G1` est donc **toujours visible**, y compris sur la
   fiche d'un patient sans trauma, où il affiche « 0 occurrence(s) ». Avec plusieurs pathologies
   portant chacune son groupe, le formulaire accumule autant de tableaux permanents.

Une sous-section, elle, hérite du rang **et** de la visibilité de sa racine. C'est exactement ce
qui manque, et c'est un seul concept : *le groupe est un enfant*.

## 2. Ce que le produit refuse aujourd'hui

### 2.1 Les quatre gardes explicites

Elles se lèvent, et c'est la partie facile du lot.

| # | Garde | Où | Refus |
|---|---|---|---|
| G-a | Contrainte de table `template_section_repeatable_root_only` | [L66:5](../supabase/migrations/20260918191752_repeatable_groups.sql:5) | `check (not is_repeatable or parent_section_id is null)` |
| G-b | `guard_template_section_write` | [L66:36](../supabase/migrations/20260918191752_repeatable_groups.sql:36) | `Un groupe répétable est un bloc racine` |
| G-c | `create_encounter` et `create_encounter_idempotent` : le groupe doit désigner un bloc **racine** répétable | [L66:131](../supabase/migrations/20260918191752_repeatable_groups.sql:131), [L66:393](../supabase/migrations/20260918191752_repeatable_groups.sql:393) | même message |
| G-d | `assert_rule_structure` : cible répétable refusée, et symétriquement `is_repeatable` refusé sur un bloc déjà ciblé | [L66:1154](../supabase/migrations/20260918191752_repeatable_groups.sql:1154), [L66:53](../supabase/migrations/20260918191752_repeatable_groups.sql:53) | `Regle d'affichage : un groupe repetable ne peut pas etre la cible d'une regle` |

G-d **reste** en place après L72 : un groupe enfant n'a pas besoin d'être ciblé, il hérite. C'est
précisément ce qui rend ce lot moins invasif que « autoriser une règle à cibler un groupe ».

### 2.2 Les trois ruptures silencieuses — c'est ça le lot

Aucune ne lève d'erreur. Chacune rend un **verdict faux**. C'est la raison pour laquelle ce lot
n'est pas « retirer une contrainte » : le faire sans les trois correctifs ci-dessous produirait un
produit qui se tait en mentant.

#### Rupture 1 — `template_section_field_keys` ne résout **que** les racines

Son CTE `root` porte `and parent_section_id is null`
([block_visibility:25](../supabase/migrations/20260905160000_block_visibility.sql:25)). Appelée
avec une clé de **sous-section**, elle rend **zéro ligne**.

Or cette fonction est l'**unique** implémentation de la sémantique d'applicabilité du §5 :

- branche « dans le groupe » de `missing_required_fields`
  ([L66:186](../supabase/migrations/20260918191752_repeatable_groups.sql:186)) : une occurrence d'un
  groupe en sous-section n'aurait **aucune variable applicable**. Rien ne serait jamais requis ;
- branche « hors groupe » ([L66:192](../supabase/migrations/20260918191752_repeatable_groups.sql:192)) :
  l'union des variables des blocs répétables serait vide pour ce groupe, donc ses variables
  seraient **de nouveau réclamées sur une consultation ordinaire** — exactement la régression que
  la seconde branche du §5 existe pour empêcher, et que la spec désigne comme « le test qui manque
  le plus facilement » ;
- mêmes conséquences dans `base_completeness_stats`, `assert_required_complete` et
  `export_incomplete_records`, qui s'appuient sur le même appel.

#### Rupture 2 — le sous-arbre d'une racine inclut ses enfants, donc la règle de `A` devient invalide

Le contrôle de portée d'une règle de bloc parcourt
`template_section_field_keys(version, 'a')`, qui rend les variables de `A` **plus celles de ses
sous-sections** (`s.id = r.id or s.parent_section_id = r.id`,
[block_visibility:35](../supabase/migrations/20260905160000_block_visibility.sql:35)).

Dès que `G1` devient enfant de `A`, l'ensemble mélange du patient (`A1 A2 A3`) et de la rencontre
(`G1`, dont toutes les variables sont en portée rencontre par obligation). Le contrôle refuse
alors : `Regle d'affichage : le bloc et son pilote doivent appartenir a la meme fiche (patient ou
visite)`.

**La fonctionnalité casserait le montage qu'elle est censée servir** : la règle qui rendait `A`
conditionnel ne serait plus créable.

#### Rupture 3 — à l'export, `blockKey` est la clé de la **racine**

`handler.ts` attribue à une variable de sous-section le `blockKey` de son **parent**
([handler.ts:782](../supabase/functions/generate-export/handler.ts:782)), et `blockIsRepeatable`
suit la racine. Conséquences si `G1` devient enfant de `A` sans correctif :

- `repeatableBlocksOf` ne trouve **aucun** bloc répétable
  ([exportContract:224](../supabase/functions/generate-export/exportContract.ts:224)) : plus de
  colonne `nb__<bloc>` ;
- l'exclusion des occurrences de la ligne patient teste `!field.blockIsRepeatable`
  ([exportContract:1538](../supabase/functions/generate-export/exportContract.ts:1538)) : les
  variables de `G1` **réintègrent** la ligne patient et sont agrégées par `first`/`last` — c'est-à-dire
  **une lésion choisie au hasard**, présentée comme LA lésion du patient. C'est la violation directe
  du critère 7 de la spec ;
- `mergeExportFields` propage `blockIsRepeatable` par `blockKey`
  ([exportContract:938](../supabase/functions/generate-export/exportContract.ts:938)) : le drapeau
  de `G1` contaminerait `A`.

## 3. Options examinées

| # | Option | Sort | Motif |
|---|---|---|---|
| 1 | Laisser `G1` racine et relâcher seulement G-d (règle ciblant un groupe) | **Écartée pour ce besoin** | Rend `G1` conditionnel mais **pas** ordonnable : il reste avant `A` ou après `A3`. La moitié du besoin, pour une revue de sécurité de même ampleur |
| 2 | Aplatir `A1 A2 A3` en blocs racines + une association diagnostic par racine | **Contournement documenté, pas une solution** | Donne l'ordre **aujourd'hui, sans code**. Coûte le regroupement à deux niveaux, quatre associations au lieu d'une, et `G1` reste toujours visible. Exige une nouvelle version du jeu de variables (§4.3) |
| 3 | Rendre l'ordre des sections libre, une racine pouvant s'intercaler dans la grappe d'une autre | **Écartée** | Défait `normalize_template_section_order`, dont la grappe par racine est ce qui rend l'ordre stable et lisible. Et ne règle pas la visibilité |
| 4 | **`is_repeatable` autorisé sur une sous-section** | **Retenue** | L'ordre vient de la hiérarchie, la visibilité de l'héritage. Un seul concept nouveau, et G-d reste en place |
| 5 | Rendre le groupe dans le formulaire de **rencontre** au lieu de la fiche patient | **Différée** | Autre question — *où se saisit une occurrence* — indépendante de celle-ci, et qui la compliquerait sans la résoudre |

## 4. Décision et sémantique normative

**Un bloc répétable peut être une sous-section d'un bloc racine.** Un seul niveau : pas de groupe
répétable sous un groupe répétable — les groupes imbriqués restent hors périmètre.

### R1 — Résolution des variables d'un groupe

`template_section_field_keys` doit résoudre une clé de **sous-section** par ses propres variables.
La voie recommandée est de **lever `parent_section_id is null`** du CTE `root`, sans toucher au
reste :

- pour une **racine**, le comportement reste identique bit pour bit (racine + enfants) ;
- pour une **sous-section**, la jointure `s.id = r.id or s.parent_section_id = r.id` rend ses
  propres variables et celles de ses enfants — or un groupe répétable **n'a pas d'enfants**, la
  garde du §4.1 de la spec le garantit. Elle rend donc exactement ses variables.

Aucun appelant ne passe aujourd'hui une clé de sous-section : le contrôle de règle refuse une cible
non racine (`Une sous-section ne peut pas porter une regle`), et les autres appels itèrent des
blocs répétables, racines par construction. La lève est donc **sans effet sur le comportement
existant** — à établir par test, pas par lecture.

### R2 — L'applicabilité du §5 n'a **rien** à changer

Le code du §5 itère `where s.template_version_id = p_version and s.is_repeatable`, **sans** filtre
racine ([L66:192](../supabase/migrations/20260918191752_repeatable_groups.sql:192)). Une fois R1
posée, les deux branches fonctionnent inchangées, à quelque profondeur que soit le groupe.

C'est le bon signe sur la taille de ce lot : la sémantique normative du §5 était déjà écrite pour
ce cas ; seul son outil ne l'était pas.

### R3 — Le contrôle de portée d'une règle ignore les descendants répétables

Le contrôle de portée sur le sous-arbre d'une racine doit **exclure** les variables appartenant à
un descendant répétable : elles ne figurent jamais dans la fiche évaluée, donc elles ne peuvent pas
rendre le bloc « partiellement évalué ». Sans R3, déclarer `G1` enfant de `A` invalide la règle de
`A` (rupture 2).

Le contrôle « le pilote ne peut pas appartenir au bloc qu'il commande » est traité de la même
façon, pour la même raison.

### R4 — La visibilité s'hérite, et la décision à prendre côté serveur

Côté écran, l'étape du groupe disparaît quand sa racine est masquée. Le mécanisme existant ne peut
pas s'en charger seul : il masque par **clés de variables**
(`visibility_hidden_fields`), et les variables d'un groupe ne sont pas dans la fiche. Le rendu doit
donc masquer **l'étape**, pas des champs.

Côté serveur, une décision reste à prendre, et elle n'est pas cosmétique :

| Option | Effet |
|---|---|
| **Refuser** l'écriture d'une occurrence dont le bloc parent est masqué pour cette fiche | Cohérent avec l'échec fermé du dépôt ; coûte l'évaluation de la visibilité dans `create_encounter`, contre les données du patient |
| **Ne pas évaluer** la visibilité parente à l'écriture en v1 | Moins de surface ; un client non conforme peut écrire dans un groupe masqué, et rien ne le dit |

**Recommandation : refuser**, en réutilisant `visibility_hidden_fields` sur la fiche patient. C'est
le seul choix qui ne dépend pas de l'UI pour tenir une propriété.

### R5 — L'export distingue le **bloc de projection** du **groupe**

`blockKey` reste la clé de la **racine** : c'est ce qui fait marcher la projection par bloc de L53,
et sélectionner `A` doit continuer de rendre `A`, ses sous-sections **et** le comptage de son
groupe. Il faut donc exposer, en plus, la clé du **bloc répétable** de la variable — racine ou
sous-section.

- `repeatableBlocksOf` et `groupCountColumnId` se clavent sur cette nouvelle clé, pas sur
  `blockKey` : la colonne reste `nb__g1`, jamais `nb__a` ;
- l'exclusion de la ligne patient teste le drapeau **du groupe**, pas celui de la racine ;
- `mergeExportFields` ne propage plus `blockIsRepeatable` par `blockKey` ;
- `group_section_key` sur la ligne d'occurrence porte déjà la clé de la section du groupe : rien à
  changer, mais à vérifier explicitement sur un groupe enfant.

Le garde-fou anti-collision de `nb__` reste en place et couvre le nouveau cas sans modification.

## 5. Le retrait du diagnostic — la partie dure

Le diagnostic est décoché alors que `G1` porte trois lésions. Les occurrences sont des **lignes**
`encounter`, pas des valeurs dans `patient.data`. La confirmation de retrait de L52 compte des
*valeurs masquées* dans la fiche et les retire avec le diagnostic, en une écriture : **elle ne voit
pas des lignes.**

| Option | Sort | Motif |
|---|---|---|
| Lignes **conservées, masquées** | **Écartée** | Le patient garde trois lésions qu'aucun écran ne montre et que l'export continue d'émettre. La donnée dit une chose, le formulaire une autre : c'est la divergence silencieuse que le dépôt refuse |
| **Suppression douce motivée**, dans la même transaction que le retrait | **Retenue** | Corbeille et restauration existent déjà ; le motif est engendré (« retrait du diagnostic X »). Coût : le retrait devient une écriture multi-lignes — une RPC dédiée, fiche + N suppressions douces, atomique |
| **Refuser** le retrait tant que des occurrences existent | **Repli** | Le moins cher et honnête, mais dresse un mur devant une correction légitime (diagnostic saisi par erreur). À retenir seulement si l'option 2 déborde |

C'est le sous-lot qui porte le risque du chantier, et il doit être estimé **avant** d'ouvrir les
autres : si l'option retenue ne passe pas, le repli change l'ergonomie promise.

## 6. Découpage

| Sous-lot | Objet | Pourquoi séparé |
|---|---|---|
| **L72a** | Socle serveur : migration additive (G-a, G-b, G-c), R1, R2 *(vérification)*, R3, R4 côté serveur | Migration, fonctions de complétude et RPC sont **couplées** : un seul responsable d'écriture, conformément à la règle du dépôt |
| **L72b** | Éditeur : case « Groupe répétable » offerte sur une sous-section, conséquences annoncées, marqueur de structure, aperçu | Surface entièrement distincte (`src/screens/staff`) |
| **L72c** | Rendu et héritage : `repeatableSectionsOf` / `withRepeatableSteps` / `groupFieldsBySection` / `SectionedFields`, place du groupe dans la grappe de sa racine et masquage avec elle | C'est ici qu'atterrit la valeur du chantier. Territoire `src/domain` + `src/screens/member` |
| **L72d** | Export : R5 | Territoire `handler.ts` + `exportContract.ts`, à isoler |
| **L72e** | Retrait du diagnostic (§5) | Porte le risque ; dépend de L72c pour l'affichage de l'état réel |

**Ordre.** L72a est bloquant pour tous. L72b, L72c et L72d se parallélisent ensuite (surfaces
disjointes). L72e vient après L72c. **Jalon utilisable : après L72c** — le groupe se lit au bon
rang et disparaît avec son bloc ; L72d et L72e ferment respectivement la justesse du fichier et la
sémantique du retrait.

> ⚠️ **L72d n'est pas optionnel avant une campagne d'export.** Sans lui, la ligne patient choisit
> une occurrence au hasard (rupture 3). Un jalon « L72a→c seulement » impose donc de ne pas exporter
> en « 1 ligne / patient » d'ici là, et de l'écrire noir sur blanc.

## 7. Ce qui ne change pas

RLS et cloisonnement ; écriture RPC exclusive ; `assert_data_valid` et `assert_no_unknown_fields` ;
journal des corrections ; corbeille et restauration ; verrou optimiste par occurrence ; borne à 50 ;
`encounter_date` nullable sous garde ; sémantique des cohortes ; la projection d'export par **bloc
racine** ; le gel des versions publiées ; l'interdiction d'une sous-section **dans** un groupe
répétable ; l'interdiction de cibler un groupe par une règle (G-d) ; le fait qu'un groupe ne
contient que des variables de rencontre.

## 8. Hors périmètre

- Groupes répétables imbriqués.
- Sous-sections à l'intérieur d'un bloc répétable (inchangé depuis la spec §12).
- Règle d'affichage ciblant directement un groupe répétable (l'héritage suffit).
- Déplacement d'une occurrence d'un groupe à l'autre ; le groupe d'une ligne ne se modifie jamais.
- `required` au niveau du groupe.
- Rendu du groupe dans le formulaire de rencontre (option 5 du §3).
- Hors-ligne : **rien à écrire**, mais un test à ajouter. La couche hors-ligne de L71 résout déjà
  le groupe d’une variable en **remontant la hiérarchie** jusqu’à la première section répétable, à
  quelque profondeur qu’elle soit ([offline.ts:188](../src/data/offline.ts:188)) : un groupe enfant
  y est traité sans modification. À prouver (test 19 bis), pas à supposer.
- Reprise des montages existants : un groupe déjà racine **reste** racine. Aucune conversion
  automatique, aucune donnée clinique réécrite.

## 9. Plan de tests

### 9.1 PostgreSQL

1. **Non-régression du §5, groupe racine.** Une version dont le groupe est racine rend exactement
   les mêmes résultats qu'avant L72 pour `missing_required_fields`, `base_completeness_stats`,
   `assert_required_complete` et `export_incomplete_records`. *(La rupture 1 se manifeste comme un
   verdict faux, jamais comme une erreur : ce test est le seul filet.)*
2. `template_section_field_keys` sur une clé de **sous-section** rend ses propres variables ; sur
   une **racine**, rend racine + enfants, à l'identique d'avant.
3. Occurrence d'un groupe en sous-section : ses variables requises sont réclamées, **et elles
   seules** — ni celles du tronc commun, ni celles de `A1 A2 A3`.
4. Les variables d'un groupe en sous-section ne sont **pas** réclamées sur une rencontre ordinaire,
   `encounter_types` nul compris. *(Branche 2 du §5, sous sa nouvelle profondeur.)*
5. **La règle d'affichage de `A` reste créable et valide** alors que `A` porte un groupe répétable.
   *(Rupture 2.)* Et le refus d'origine subsiste quand une vraie sous-section non répétable mélange
   les portées.
6. Complétude : le dénominateur d'une variable du groupe ne compte que les lignes du groupe, à
   profondeur quelconque.
7. Groupe répétable sous groupe répétable : refusé.
8. `group_section_key` désignant une sous-section **non** répétable : refusé.
9. Recopie de version : `is_repeatable` **et** le rattachement au parent survivent ensemble.
10. R4 : écriture d'une occurrence dont le bloc parent est masqué — comportement de la décision
    retenue, sans exception silencieuse.
11. Retrait du diagnostic avec N occurrences : comportement du §5, motif journalisé, lignes en
    corbeille, restauration rendant les lignes à leur groupe.
12. Gardes déjà en place, rejouées : sous-section dans un groupe, variable de portée patient dans un
    groupe, bascule sur version utilisée.

### 9.2 Domaine et frontend

13. `A` masqué → l'étape du groupe **n'est pas rendue** ; `A` affiché → elle est rendue **à son
    rang**, entre `A1` et `A2`.
14. Le rang est celui déclaré, après `normalize_template_section_order` : vérifier sur une
    hiérarchie de trois sous-sections et deux groupes.
15. Groupe racine : rendu inchangé par rapport à L68 (non-régression de présentation).
16. Bascule tableau → carte : inchangée, à profondeur quelconque.
17. Création de patient (L69) avec un groupe **enfant** : occurrences tamponnées, rejeu ordonné,
    échec partiel repris sans doublon.
18. Lecture seule, conflit par ligne, borne atteinte : inchangés.
19. Éditeur : la case est offerte sur une sous-section, et la confirmation annonce les mêmes
    conséquences qu'à la racine.
19 bis. **Hors-ligne, groupe enfant.** Lecture des valeurs d’une occurrence depuis la copie
    locale, correction hors ligne puis rejeu : comportement identique à un groupe racine, **sans
    modification de `offline.ts`**. `repeatableRootByFieldKey` remonte déjà la hiérarchie jusqu’à la
    première section répétable ([offline.ts:188](../src/data/offline.ts:188)) ; ce test vérifie que
    ce chemin, jamais exercé sur un groupe enfant, l’est correctement.

### 9.3 Export

20. `group_section_key` porte la clé de la **sous-section** du groupe.
21. `nb__g1` présent et exact, y compris à zéro — **jamais** `nb__a`.
22. Ligne patient : les variables du groupe enfant sont **absentes**, aucune agrégation
    `first`/`last` sur une occurrence. *(Rupture 3, critère 7 de la spec.)*
23. Projection par bloc sur `A` : rend `A`, ses sous-sections, et le comptage de son groupe ;
    aucune fuite d'identité.
24. Dictionnaire : la ligne de comptage nomme le **groupe**, et son bloc de rattachement.
25. Base sans aucun groupe en sous-section : fichier identique à avant L72, dictionnaire compris.

### 9.4 Commandes

`npm run schema` puis inspection du snapshot, `npm run schema:check`, tests ciblés sur les fichiers
touchés, `npm run edge:test`, puis lint et typecheck. Vérifier la cible locale avant tout test
écrivant des données. Détail dans `meddata-release-check`.

## 10. Critères d'acceptation

1. Un groupe répétable déclaré sous un bloc de diagnostic se lit **à son rang** parmi les
   sous-sections de ce bloc.
2. Il **n'apparaît pas** quand son bloc racine est masqué, et n'apparaît que pour les patients dont
   le diagnostic l'ouvre.
3. La règle d'affichage du bloc racine reste valide et créable en présence d'un groupe enfant.
4. Une version sans groupe en sous-section produit, avant et après L72, des résultats **identiques**
   pour les quatre fonctions de complétude et pour l'export, dictionnaire compris.
5. Une variable d'un groupe en sous-section n'est **jamais** réclamée sur une rencontre ordinaire.
6. L'export « 1 ligne / patient » ne choisit **jamais** une occurrence au hasard, et le comptage
   porte la clé du groupe.
7. Aucune occurrence n'est perdue ni silencieusement masquée lors d'un retrait de diagnostic ;
   l'état affiché est l'état réel.
8. `is_repeatable` et le parent survivent ensemble à la recopie de version.
9. Un groupe déjà racine continue de fonctionner sans intervention.
10. Aucune migration déjà appliquée n'est modifiée ; aucune donnée clinique n'est réécrite ; aucun
    message d'erreur ne nomme une valeur clinique.

## 11. Risques et collisions

| Risque | Portée | Traitement |
|---|---|---|
| Les trois ruptures du §2.2 ne lèvent aucune erreur : un lot livré à moitié rend des verdicts et des fichiers faux sans le dire | **Élevée** | Tests 1, 5 et 22 sont bloquants ; aucun jalon n'est « utilisable » sans eux |
| `template_section_field_keys` est appelée par la visibilité, la complétude et l'export : la lève de R1 touche trois sous-systèmes d'un coup | **Élevée** | Test 2 en non-régression stricte, et revue de tous ses appelants dans L72a |
| L72d absent alors qu'un export par patient est lancé | Moyenne | Jalon écrit noir sur blanc (§6) |
| L'option de retrait retenue déborde et impose le repli | Moyenne | Estimer L72e **avant** d'ouvrir L72b à L72d |
| La couche hors-ligne paraît agnostique mais n’a jamais vu de groupe enfant | Faible | Test 19 bis ; aucune modification attendue dans `offline.ts`, et toute modification qui s’y révèle nécessaire est un signal à remonter |

**Collisions connues :**

| Sous-lot | Fichiers | À ne jamais lancer avec |
|---|---|---|
| L72a | migration, `template_section_field_keys`, `missing_required_fields`, `create_encounter` | Tout lot rouvrant les fonctions de L66, et les migrations de contexte de groupe E3 |
| L72b | `SectionsEditor.tsx`, `EditorStructure.tsx`, `FormPreview.tsx` | Correctifs UX sur ces fichiers, **L59** |
| L72c | `SectionedFields.tsx`, `EditPatient.tsx`, `NewPatient.tsx`, `PatientDetail.tsx`, `templateSections.ts` | Tout lot ouvrant la fiche patient. **L71 est fusionné** : la collision qui existait sur `PatientDetail.tsx` est levée |
| L72d | `exportContract.ts`, `handler.ts` | **L70** si rouvert, **L53** |
| L72e | RPC de retrait, `soft_delete_encounter` | Tout lot touchant la corbeille ou la curation |

> **Le checkout est partagé.** Vérifier `git fetch` et l’état réel de `origin/develop` avant de
> couper une branche : plusieurs lots de ce chantier ont été fusionnés le même jour, et une
> référence locale en retard fait conclure à tort qu’un lot manque.

## 12. Contournement disponible sans ce lot

À documenter pour l'utilisateur tant que L72 n'est pas livré, et à retirer ensuite.

Sur une **nouvelle version** du jeu de variables — les trois gestes sont refusés sur une version
déjà utilisée : changement de parent, création de règle, bascule `is_repeatable` :

1. promouvoir `A1 A2 A3` en blocs **racines** ;
2. ordonner les racines `A, A1, G1, A2, A3` ;
3. créer **une** association diagnostic → bloc **par racine**, avec le même code (un code porte
   bien une liste de blocs) ;
4. `G1` ne reçoit aucune association : il reste **toujours visible**.

Donne l'ordre de lecture voulu, sans code. Coûte le regroupement à deux niveaux, quatre
associations à maintenir, et un tableau permanent chez les patients sans ce diagnostic.

## 13. État de L72a — 23 septembre 2026

Migration [`20260923120000_repeatable_group_subsection.sql`](../supabase/migrations/20260923120000_repeatable_group_subsection.sql),
tests [`repeatable-group-subsection.test.ts`](../test/repeatable-group-subsection.test.ts).
Validé localement sur PostgreSQL embarqué ; **rien n'est appliqué à distance**.

**Écart assumé avec R1/R3 : l'exclusion des descendants répétables est posée dans
`template_section_field_keys`, pas dans le seul contrôle de règle.** La même expansion
alimente `visibility_hidden_fields` et `assert_block_hidden_values`. Évaluées sur les données
d'une occurrence, où le pilote patient du bloc est absent, elles auraient masqué toutes les
variables du groupe : rien de requis dans l'occurrence, et **toute valeur saisie refusée** comme
« valeur d'un bloc masqué », chez tous les patients. Une racine rend donc désormais racine +
enfants **non répétables** ; une racine sans groupe enfant — toute version antérieure — rend
exactement le même ensemble (test 1).

**Sites non inventoriés au §2, traités :**

- `form_record_field_group_applicable` (E3) portait son propre filtre racine, dans ses deux
  branches : une occurrence de groupe enfant aurait été refusée à la correction
  (`FORM_SCOPE_INCOMPATIBLE`), et ses variables admises sur une rencontre ordinaire ;
- le déclencheur `guard_repeatable_encounter` portait la même garde racine que
  `create_encounter` ;
- l'import de bloc (L58) copie les sous-sections **sans** `is_repeatable`, et les variables par
  l'expansion ci-dessus : un groupe enfant serait arrivé vide. Il est désormais **refusé**
  (`IMPORT_SOURCE_HAS_REPEATABLE_GROUP`), sous le verrou du plan, dans le même ordre que lui.
  Le code n'a pas encore de libellé côté web (L72b).

`create_encounter_idempotent` et `replay_encounter_create` délèguent à `create_encounter` :
non redéfinies. `src/data/offline.ts` n'a pas été modifié ; le test hors-ligne du groupe enfant
passe tel quel.

**Non traité, décision ouverte :** R4 côté serveur (refus d'une occurrence dont le bloc parent
est masqué). Aujourd'hui une occurrence s'écrit quelle que soit la visibilité de sa racine.

**Pour L72b/L72c :** les miroirs web de l'expansion d'un bloc — cibles d'une règle de bloc dans
`templateRules.ts` (y compris son repli par `parentSectionKey`), `blockSectionKeys` dans
`blockActivation.ts` — doivent exclure à leur tour les enfants répétables, sans quoi l'écran
masquera des variables que le serveur ne masque plus ; `templateSections.ts` cite encore la
contrainte racine supprimée. Un bloc dont le seul contenu est un groupe est refusé par la
configuration diagnostique (`DIAGNOSIS_BLOCK_EMPTY`) : le bloc doit porter au moins une
variable de la portée du diagnostic.
