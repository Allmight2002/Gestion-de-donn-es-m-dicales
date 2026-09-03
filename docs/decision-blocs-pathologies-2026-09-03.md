# Décision — blocs pathologiques dans une base unique (3 septembre 2026)

> **Preuve datée 🗄️.** Ce document consigne le parcours de décision du 2026-09-03.
> **Aucun changement de code n'a été effectué à cette date** : c'est un registre de
> décisions et le point de départ des lots **L51, L54, L52 et L53** (dans cet ordre
> d’exécution), spécifiés dans
> [spec-blocs-pathologies.md](spec-blocs-pathologies.md).

## 1. Le problème initial

Aujourd'hui, une pathologie = une base + un formulaire. Un patient polypathologique doit
donc être saisi autant de fois qu'il a de pathologies.

Exemple posé au départ : un patient victime d'un accident de la voie publique, porteur d'un
traumatisme crânien **et** d'un traumatisme vertébro-médullaire, **et** ayant développé une
infection post-opératoire, doit être saisi **trois fois**. Trois fois l'identité, trois fois
les circonstances de l'accident, trois fois la démographie.

Le besoin est donc : **un patient, une saisie, plusieurs blocs de variables spécialisées**,
sans renoncer à exporter chaque pathologie séparément.

## 2. Le contexte de collecte, qui cadre toutes les décisions

Quatre faits ont été établis en cours d'analyse. Aucun n'est dérivable du code, et chacun a
invalidé au moins une piste :

1. **La collecte est rétrospective.** Le saisisseur travaille sur un dossier où le
   diagnostic est **déjà posé** ; ce n'est pas lui qui l'établit.
2. **La saisie a lieu une seule fois** par patient, sauf recherche organisée.
3. **Le modèle transversal (`cross_sectional`) domine.** La création d'une nouvelle
   rencontre est très rare.
4. **L'échelle cible est d'environ 12 blocs par spécialité, à environ 20 variables par
   bloc**, avec un recouvrement important entre blocs.

Conséquence immédiate du point 3 : en base transversale, **toutes** les variables sont de
scope `patient` et les rencontres sont refusées côté base. Le diagnostic est donc un champ
patient, au même étage que les blocs qu'il pilote — ce qui supprime une difficulté entière
présente dans le raisonnement longitudinal.

## 3. Les options examinées

| # | Option | Sort | Motif |
|---|---|---|---|
| 1 | Bases parentes / bases filles, patient partagé entre bases | **Écartée** | Déplacerait l'unité de sécurité RLS et créerait un second système d'identité. Déjà écartée par la spécification des modules elle-même. |
| 2 | Chantier complet « modules spécialisés » (tables de modules, activations, état `retained`, RPC dédiées, cohortes, complétude, export, hors-ligne) | **Différée** | 8 à 12 semaines. Ses deux apports propres — protection des données à la correction d'un diagnostic, et historique d'activation — sont marginaux dans un mode de collecte rétrospectif où le diagnostic est déjà définitif. |
| 3 | Cases à cocher + règles d'affichage conditionnel existantes | **Retenue comme socle immédiat** | Fonctionne aujourd'hui, sans développement : un patient, un tronc commun, des blocs affichés sous condition. |
| 4 | Tout basculer en scope rencontre | **Écartée** | Reposerait les mêmes variables permanentes à chaque séjour, avec divergence garantie entre séjours. |
| 5 | Groupe répétable dans la fiche patient (examens multiples) | **Écartée pour l'instant** | Stockage, validation, complétude, export et hors-ligne à reprendre : plus lourd que les modules eux-mêmes. Le modèle `event_registry` existant couvre déjà le besoin, au prix d'un écran séparé. |
| 6 | **Sections + visibilité au niveau section + projection d'export par section** | **Retenue** | Réutilise trois mécanismes déjà en place et livre l'essentiel de l'option 2 pour environ un sixième du coût. |

## 4. Les décisions

### D1 — Une base unique par spécialité, pas une base par pathologie

Le patient polypathologique est saisi **une fois**. Les pathologies deviennent des blocs de
variables à l'intérieur d'un même formulaire.

**Pourquoi :** c'est le problème posé, et le modèle de données le permet déjà — `base` reste
l'unité de sécurité, `patient` reste unique dans sa base.

**Conséquence :** les bases par pathologie **existantes ne fusionnent pas**. Reprendre les
patients déjà saisis plusieurs fois est un chantier de reprise de données distinct, non
couvert ici.

### D2 — Un bloc est une section, pas un objet nouveau

`template_section` existe, est versionnée, est recopiée d'une version à l'autre par sa clé
stable, et `template_field.section_id` est renseigné **au moment où la variable est créée**.

**Pourquoi :** l'étiquetage « à quel bloc appartient cette variable » — l'apport principal
que des modules auraient fourni — est **déjà résolu**. Créer un second mécanisme de
regroupement à côté des sections dupliquerait la même idée.

### D3 — La visibilité doit s'appliquer à un groupe, pas seulement à une variable

> Le niveau exact est précisé par **D9** : la règle vise un **bloc**, jamais une sous-section.

Vérifié : une règle d'affichage vise `then.field`, **jamais une section**, et il n'existe
aucune visibilité au niveau section.

Simuler un bloc avec les règles actuelles impose donc **une règle par variable** : à 12 blocs
de 20 variables, environ **240 règles** à écrire et à maintenir. Avec la visibilité de
section : **12 règles**.

**Pourquoi c'est la décision structurante :** c'est le seul écart réel entre l'état actuel et
ce que des modules apporteraient, pour la définition du formulaire. Le combler coûte un lot ;
le contourner coûte 240 objets à maintenir, avec un mode de défaillance silencieux — une
règle oubliée n'échoue pas, elle **affiche la variable à tout le monde**, c'est-à-dire
exactement la surcharge que le chantier cherche à supprimer.

### D4 — Le moteur de règles a besoin d'un « ou »

Vérifié dans `visibility_hidden_fields` : plusieurs règles visant la même cible se combinent
en **ET** — il suffit qu'une échoue pour masquer, et une cible masquée n'est plus réévaluée.
Il n'existe aucune façon d'exprimer « ou », ni entre règles, ni dans une règle : l'opérateur
`in` compare `a #>> '{}'`, ce qui, sur une liste, compare le texte du tableau entier.

**Conséquence pratique :** une variable utile à deux blocs ne peut pas être décrite par deux
règles. La première réponse envisagée — la remonter dans le tronc commun — a été **abandonnée**
parce qu'elle la rend obligatoire pour tous les patients et fait enfler le tronc à mesure que
les blocs se recoupent.

**Décision :** une seule règle nommant **plusieurs déclencheurs**. L'évolution se fait alors
par extension d'une règle existante, jamais par réorganisation du formulaire.

### D5 — Tous les blocs ne se déclenchent pas sur un diagnostic

Une malnutrition aiguë sévère se **mesure** (périmètre brachial, œdèmes) plutôt qu'elle ne se
lit dans un champ diagnostic. Les comparaisons numériques existent déjà dans le moteur : ce
bloc-là ne demande aucun développement.

**Décision :** le pilote d'un bloc est choisi selon la clinique — une mesure saisie, une case,
ou un diagnostic. La détection terminologique (différée, voir §6) sert les blocs pilotés par
un diagnostic, pas tous les blocs.

**Contrainte associée :** le pilote doit être une variable **saisie**, jamais **calculée** —
voir §7.

### D6 — La projection d'export par bloc est la vraie priorité

Le problème de duplication à la **saisie** se règle dès aujourd'hui, sans développement
(option 3). Ce qui reste impossible, c'est de **ressortir** les données d'une pathologie
seule : l'export rend l'union de toutes les variables, donc un fichier large et clairsemé.

**Pourquoi c'est prioritaire :** c'est le seul apport que rien dans l'existant ne remplace, et
le contrat d'export porte **déjà** la section de chaque variable (`section`, `sectionLabel`).
Il manque un filtre, pas une architecture.

### D7 — Un bloc n'est pas une cohorte

Le bloc décide ce qu'on **recueille** ; la cohorte décide qui on **étudie**. Un enfant peut
avoir un bloc « pneumonie » rempli sans devoir entrer dans une cohorte « pneumonies
communautaires ».

**Décision :** ne jamais faire dépendre l'un de l'autre. Le filtre de cohorte reste un filtre
de champ ; la projection d'export reste un choix de colonnes. Les deux se combinent, ils ne se
remplacent pas.

### D8 — Une variable partagée reste dans une section

Corollaire de D4. Une variable utile à plusieurs blocs n'est **pas** remontée dans le tronc
commun : elle reste dans sa section, et c'est la section qui porte plusieurs déclencheurs.

**Pourquoi :** remonter les variables partagées ferait converger le formulaire vers « tout
demander à tout le monde », par simple accumulation.

### D9 — Les blocs ont besoin d’un second niveau de regroupement

En faisant d’un bloc une section (D2), le chantier consomme le **seul** niveau de
regroupement existant : `template_section` est plate. Un bloc de 20 variables devient une
liste continue, sans séparation clinique / biologie / imagerie / traitement — c’est-à-dire
le problème de lisibilité que les sections servaient précisément à résoudre.

**Décision :** ajouter `parent_section_id` à `template_section`, **borné à un seul niveau**.
Une section sans parent est un **bloc** et porte la règle d’affichage ; une section avec
parent est une **sous-section**, purement visuelle, qui ne porte jamais de règle.

**Pourquoi borner à un niveau :** le rendu, la recopie de version, la visibilité et la
projection d’export restent simples, et rien dans le besoin exprimé ne réclame un troisième
niveau. La contrainte est vérifiée côté serveur, pas seulement dans l’éditeur.

**Pourquoi la règle reste au bloc :** c’est ce qui préserve « 12 blocs = 12 règles »,
seule justification de D3. Autoriser une règle sur une sous-section reste additif plus tard.

**Conséquence sur l’ordre des lots :** L54 doit précéder L52 et L53. Livrer L52 d’abord
produirait des règles visant n’importe quelle section, qu’il faudrait ensuite restreindre
après coup, sur des règles déjà créées.

**Conséquence découverte au passage :** `template_field.section_id` est `on delete set null`.
Supprimer une section **détache** donc ses variables, qui deviennent du tronc commun — donc
visibles pour **tous** les patients, l’inverse exact de l’intention. Une garde supplémentaire
est exigée : refuser la suppression d’une section cible d’une règle d’affichage.

### D10 — La complexité se déplace vers l’export, et c’est assumé

Simplifier la saisie déplace la complexité vers l’export, qui doit désormais porter une
projection, des colonnes clairsemées et deux niveaux de regroupement.

**Décision :** assumer ce déplacement. La saisie est faite des centaines de fois par des
utilisateurs pressés ; l’export est fait quelques fois par quelqu’un qui peut réfléchir.
Déplacer la complexité de la première vers le second est un gain, pas un report de dette.

**Ce qui reste borné :** la projection par bloc (L53) traite le cas nominal. Le mode
« blocs présents dans la cohorte », qui restreindrait automatiquement aux blocs
effectivement renseignés, est **écarté** : le jeu de colonnes deviendrait dépendant des
données, et deux exports de la même cohorte à deux dates pourraient ne plus avoir la même
forme. À reprendre seulement si la dispersion gêne réellement à l’usage.

Les volumes ne sont pas un obstacle : 240 variables restent très loin des 25 000 champs de
dictionnaire admis par l’export.

## 5. Ce qui a été vérifié dans le dépôt

Ces constats sont issus de la lecture du code à la date du document. Sauf mention contraire,
ils n'ont pas été confirmés par exécution.

| Constat | Emplacement |
|---|---|
| Une base `cross_sectional` force toutes les variables en scope `patient` et refuse les rencontres | `20260801185149_observation_model_base.sql` |
| Une règle d'affichage vise une variable ; aucune visibilité au niveau section | `20260815090000_template_rule_visibility.sql` |
| Plusieurs règles sur la même cible se combinent en ET ; une cible masquée n'est plus réévaluée | `visibility_hidden_fields` |
| L'opérateur `in` ne compare pas élément par élément sur une liste | `rule_apply_op`, `20260616091900_validation_rules.sql` |
| `is_multiple` est réservé au type `terminology` | `20260818045033_multivalue_terminology_foundation.sql` |
| Une règle ne peut pas être ajoutée à une version portant déjà des données | `guard_validation_rule_inuse` |
| `ExportField` porte déjà `section` (code stable) et `sectionLabel` | `generate-export/exportContract.ts` |
| Toute la construction des colonnes, du dictionnaire et des modalités part d'un seul tableau | `generate-export/handler.ts` |
| `mergeExportFields` fusionne par `field_key` et retient la section de la première version rencontrée | `generate-export/exportContract.ts` |
| Les profils d'export `analysis` / `complete` existent, et `export_options` est déjà journalisé | `generate-export/handler.ts` |
| `terminology_concept` porte `parent_id` et `depth` ; chapitres et blocs n'ont pas toujours de code | `20260726120000_terminology_reference.sql` |
| La copie locale du référentiel télécharge la publication entière, mais ne transporte que `code`, `label`, `searchText` | `src/data/terminologyCache.ts`, `src/data/terminology.ts` |
| Le script d'import maintient déjà la chaîne d'ancêtres en mémoire | `scripts/import-terminology.mjs` |
| Le résultat d'une variable calculée n'est jamais stocké | `20260820120000_template_field_formula.sql` |

## 6. Ce qui est différé, et à quelle condition le reprendre

**Détection automatique depuis la CIM-11** (chemin d'ancêtres sur `terminology_concept`, plus
un opérateur d'appartenance à une famille). Estimé 7 à 11 jours. À reprendre quand le
cochage manuel des pathologies sera constaté comme une gêne réelle sur une base pilote — c'est
du confort de saisie, pas une fonction manquante.

Point de conception déjà acquis pour ce jour-là : la question « ce code appartient-il à cette
famille ? » se résout en **remontant** les ancêtres du code saisi, jamais en précalculant tous
les descendants d'une racine. Le chemin doit être bâti sur les **identifiants** de concepts et
non sur les codes, puisque chapitres et blocs n'en ont pas toujours — ce qui rend le gel de la
publication terminologique obligatoire, un identifiant n'étant stable qu'à l'intérieur d'une
publication.

**Chantier complet des modules spécialisés.** À reprendre si, et seulement si, l'un des deux
signaux suivants apparaît sur la base pilote : des données de bloc effacées à tort par un
décochage, ou un nombre de règles devenu ingérable malgré la visibilité de section.

**Reprise des bases par pathologie existantes.** Chantier de données distinct, non planifié.

## 7. Un défaut du produit découvert en chemin

Une règle d'affichage dont le champ pilote est une variable **calculée** est acceptée à
l'enregistrement, puis **masque sa cible de façon permanente et silencieuse** : le résultat
d'une variable calculée n'est jamais stocké, donc le moteur voit le pilote comme absent et
masque. Ni le contrôle serveur de la forme des règles — antérieur de cinq jours à
l'introduction des formules — ni l'éditeur `RuleForm.tsx` ne l'empêchent.

Le cas est réaliste : un Z-score ou un IMC est le pilote naturel d'un bloc nutritionnel.

Constat obtenu par lecture de code, **non confirmé par exécution**. À traiter séparément des
lots L51 à L54, en commençant par le test qui l'établit ou l'infirme.

**Contournement en attendant :** piloter un bloc sur une mesure **saisie** (le périmètre
brachial en millimètres), jamais sur un calcul.
