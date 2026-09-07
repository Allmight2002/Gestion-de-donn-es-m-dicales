# Décision — blocs cliniques conditionnels dans une même base (3 septembre 2026)

> **Preuve datée 🗄️.** Ce document consigne le parcours de décision du 2026-09-03.
> **Aucun changement de code n'a été effectué à cette date** : c'est un registre de
> décisions et le point de départ des lots **L51, L54, L52 et L53** (**L51 et L54 en
> parallèle**, puis L52 et L53), spécifiés dans
> [spec-blocs-pathologies.md](spec-blocs-pathologies.md).
>
> **Amendement du 2026-09-04.** Une revue contradictoire du code a corrigé quatre hypothèses :
> une variable partagée ne peut pas rester dans un bloc unique ; le tronc commun n'est pas encore
> créable explicitement dans l'éditeur ; une projection ne doit pas priver une formule de ses
> opérandes ; les invariants de bloc doivent survivre aux mutations et à la concurrence. Les
> décisions ci-dessous intègrent ces corrections avant toute implémentation.

> **Amendement du 2026-09-05, issu du terrain :** les diagnostics sont habituellement connus
> lors de la collecte. Une sélection manuelle supplémentaire de situations ne constitue plus
> le parcours nominal. Correspondance exacte diagnostic → blocs dans L51/L55, enregistrement
> sans bloc et suivi dans L56 ; reprise/notifications cadrées ultérieurement par L57.
> Voir [le complément normatif](spec-collecte-diagnostique.md). Tout reste non implémenté.

## 1. Le problème initial

Aujourd'hui, une pathologie = une base + un formulaire. Un patient polypathologique doit
donc être saisi autant de fois qu'il a de pathologies.

Exemple posé au départ : un patient victime d'un accident de la voie publique, porteur d'un
traumatisme crânien **et** d'un traumatisme vertébro-médullaire, **et** ayant développé une
infection post-opératoire, doit être saisi **trois fois**. Trois fois l'identité, trois fois
les circonstances de l'accident, trois fois la démographie.

Le besoin est donc : **un patient, une saisie, plusieurs blocs de variables spécialisées**,
sans renoncer à exporter chaque pathologie séparément.

Ce besoin vient d'une difficulté observée pendant un stage de test du produit sur le terrain.
Cette observation établit que le problème de ressaisie existe dans ce contexte ; elle n'en mesure
pas encore la fréquence ailleurs et ne suffit pas, à elle seule, à prouver que toutes les
spécialités doivent partager une base ni qu'un système complet de modules est nécessaire. La
généralisation reste donc une hypothèse produit à éprouver avec des scénarios strictement fictifs
tant que le cadre juridique et éthique n'est pas validé.

## 2. Le contexte de collecte, qui cadre toutes les décisions

Quatre faits ont été établis en cours d'analyse. Aucun n'est dérivable du code, et chacun a
invalidé au moins une piste :

1. **La collecte est rétrospective.** Le saisisseur travaille sur un dossier où le
   diagnostic est **déjà posé** ; ce n'est pas lui qui l'établit.
2. **La saisie a lieu une seule fois** par patient, sauf recherche organisée.
3. **Le modèle transversal (`cross_sectional`) domine.** La création d'une nouvelle
   rencontre est très rare.
4. **L'échelle envisagée est d'environ 12 blocs dans un même contexte de collecte, à environ
   20 variables par bloc**, avec un recouvrement important entre blocs.

Conséquence immédiate du point 3 : en base transversale, **toutes** les variables sont de
scope `patient` et les rencontres sont refusées côté base. Le diagnostic est donc un champ
patient, au même étage que les blocs qu'il pilote — ce qui supprime une difficulté entière
présente dans le raisonnement longitudinal.

La frontière d'une base n'est toutefois pas déduite de la spécialité. Dans cette décision,
« une même base » signifie : même finalité de collecte, même équipe responsable, mêmes droits
d'accès, même protocole et mêmes règles de conservation. Si l'un de ces éléments diverge, garder
des bases séparées peut être intentionnel, même si certains patients apparaissent dans les deux.

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

### D1 — Une base par contexte cohérent, pas une base par pathologie

Le patient polypathologique est saisi **une fois dans une même base** lorsque les pathologies
relèvent du même contexte de collecte et de gouvernance. Elles deviennent alors des blocs de
variables à l'intérieur d'un même formulaire.

**Pourquoi :** c'est le problème posé, et le modèle de données le permet déjà — `base` reste
l'unité de sécurité, `patient` reste unique dans sa base. Une base peut couvrir plusieurs
spécialités ou seulement une partie d'une spécialité : ce n'est pas son critère de découpage.

**Conséquence :** les bases par pathologie **existantes ne fusionnent pas**. Reprendre les
patients déjà saisis plusieurs fois est un chantier de reprise de données distinct, non
couvert ici.

### D2 — Un bloc clinique est une section, pas un objet nouveau

`template_section` existe, est versionnée, est recopiée d'une version à l'autre par sa clé
stable, et `template_field.section_id` est renseigné **au moment où la variable est créée**.

**Pourquoi :** l'étiquetage principal « où cette variable est-elle présentée ? » est déjà
résolu. Créer un second mécanisme général de regroupement à côté des sections dupliquerait la
même idée. Une variable propre à un bloc reste dans cette section ; une variable partagée est
placée dans le tronc commun et garde une règle de champ lorsque ses cas partagent le même pilote ;
avec des pilotes hétérogènes, elle reste commune sans condition ou le cas est différé. Une relation
plusieurs-à-plusieurs de projection n'est justifiée que si les bases pilotes montrent que les
colonnes communes résiduelles sont réellement gênantes.

Le bloc est volontairement générique : il peut représenter une pathologie, une complication,
un phénotype ou une autre situation clinique. Le nom historique « bloc pathologique » décrit le
premier cas d'usage, pas une contrainte du modèle.

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

### D4 — Le moteur a besoin d'un « ou » entre valeurs d'un même pilote

Vérifié dans `visibility_hidden_fields` : plusieurs règles visant la même cible se combinent
en **ET** — il suffit qu'une échoue pour masquer, et une cible masquée n'est plus réévaluée.
Il n'existe aucune façon d'exprimer « ou », ni entre règles, ni dans une règle : l'opérateur
`in` compare `a #>> '{}'`, ce qui, sur une liste, compare le texte du tableau entier.

**Conséquence pratique :** une variable utile à deux valeurs du même pilote ne peut pas être
décrite par deux règles, et ne peut pas rester dans un bloc unique : la règle de ce bloc la
masquerait dans l'autre. Elle rejoint donc le tronc commun, avec une règle de champ nommant
**plusieurs valeurs déclencheuses**. Visibilité et obligation étant évaluées dans cet ordre, elle
n'est pas exigée pour les patients auxquels elle ne s'applique pas.

**Décision :** une seule règle de champ `contains_any` pour la variable partagée. L'évolution
se fait par extension de cette règle, jamais par duplication de la variable. Depuis le retour
terrain du 5 septembre, le pilote nominal est le diagnostic, y compris `terminology` multivalué,
avec des associations exactes de codes. Il est saisi dans le tronc commun et n'est jamais une
formule. Les sélecteurs manuels restent possibles ; seule l'inférence de famille reste différée.

**Limite assumée :** cet opérateur n'exprime pas un `OR` entre plusieurs champs différents. Si
une variable est partagée par des blocs ayant des pilotes hétérogènes, la v1 la laisse visible
sans condition dans le tronc commun ou diffère le cas ; elle ne prétend pas l'avoir résolu.

Une cible masquée par `contains_any` refuse sa valeur côté serveur quel que soit le statut de la
fiche. Cette règle nouvelle ne s'applique pas rétroactivement aux opérateurs historiques ; elle
ferme seulement l'écart créé par un ancien client qui ne comprendrait pas le nouvel opérateur.

### D5 — Tous les blocs ne se déclenchent pas sur un diagnostic

Une malnutrition aiguë sévère se **mesure** (périmètre brachial, œdèmes) plutôt qu'elle ne se
lit dans un champ diagnostic. Les comparaisons numériques existent déjà dans le moteur : ce
bloc-là ne demande aucun développement.

**Décision :** le pilote d'un bloc est choisi selon la clinique — une mesure saisie, une case,
ou un diagnostic. L'inférence de familles terminologiques (différée, voir §6) sert les blocs pilotés par
un diagnostic, pas tous les blocs.

Pour le pilote terrain v1, une activation explicite via le `multiselect` commun reste le chemin
le plus prévisible. Les mesures et diagnostics peuvent piloter directement un bloc lorsque ce
gain d'automatisation est utile, avec la limite de partage décrite en D4.

**Contrainte associée :** le pilote doit être une variable **saisie**, jamais **calculée** —
voir §7.

### D6 — La projection d'export par bloc est la vraie priorité

Le problème de duplication à la **saisie** se règle dès aujourd'hui, sans développement
(option 3). Ce qui reste impossible, c'est de **ressortir** les données d'une pathologie
seule : l'export rend l'union de toutes les variables, donc un fichier large et clairsemé.

**Pourquoi c'est prioritaire :** c'est le seul apport que rien dans l'existant ne remplace, et
le contrat d'export porte **déjà** la section de chaque variable (`section`, `sectionLabel`).
Il manque principalement une projection, pas une architecture nouvelle. Le générateur doit
toutefois conserver le dictionnaire complet des champs pour calculer une formule dont les
opérandes vivent hors de la projection.

### D7 — Un bloc n'est pas une cohorte

Le bloc décide ce qu'on **recueille** ; la cohorte décide qui on **étudie**. Un enfant peut
avoir un bloc « pneumonie » rempli sans devoir entrer dans une cohorte « pneumonies
communautaires ».

**Décision :** ne jamais faire dépendre l'un de l'autre. Le filtre de cohorte reste un filtre
de champ ; la projection d'export reste un choix de colonnes. Les deux se combinent, ils ne se
remplacent pas.

### D8 — Une variable partagée reste unique dans le tronc commun

Corollaire de D4. Une variable utile à plusieurs valeurs d'un même pilote est sortie de tout bloc
conditionnel et placée dans le tronc commun. Elle porte sa propre règle `contains_any`, donc elle
n'est ni affichée ni exigée pour tout le monde.

**Pourquoi :** `template_field.section_id` est mono-valué. Laisser la variable dans le bloc A
la masquerait pour un patient relevant seulement du bloc B ; déclencher tout A pour B
afficherait au contraire les variables propres à A. Le tronc commun conditionnel est la seule
solution complète qui réutilise les mécanismes présents sans introduire une relation de
projection plusieurs-à-plusieurs.

**Compromis assumé :** sa colonne figure dans toutes les projections et reste vide hors de ses
cas d'application. Ce coût est mesuré sur les bases pilotes avant d'envisager un autre modèle.

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

**Rectification issue de la revue :** `template_field.section_id` est `on delete set null`, mais
`guard_template_section_write` refuse déjà la suppression d'une section non vide. La garde
supplémentaire reste nécessaire pour une section vidée mais encore ciblée par une règle : sa
suppression ou sa transformation en sous-section laisserait `then.section` orphelin.

La même-version est garantie par clé étrangère composite `no action`, différable afin de ne pas
bloquer la cascade qui supprime une version entière. Les mutations de hiérarchie sont sérialisées
par version : deux reparentages concurrents ne doivent jamais pouvoir construire un cycle que
chaque transaction aurait validé sur un état périmé.

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

Les variables partagées placées dans le tronc commun restent elles aussi dans toutes les
projections. C'est un compromis volontaire : quelques colonnes vides supplémentaires évitent
un second modèle d'appartenance. Lui seul pourra justifier ce modèle si le pilote le rend
nécessaire.

Les volumes ne sont pas un obstacle : 240 variables restent très loin des 25 000 champs de
dictionnaire admis par l’export.

**Conséquence UX :** l'utilisateur ne doit pas percevoir un formulaire géant de 240 variables.
Le parcours présente d'abord le tronc commun, puis les blocs activés sous forme d'étapes, d'onglets
ou de cartes clairement identifiées. Cette navigation peut rester une évolution d'interface : elle
ne justifie pas, à elle seule, un nouveau modèle de stockage.

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
| Le `multiselect` contrôlé est un type distinct de `terminology + is_multiple` | `src/data/types.ts`, `src/screens/staff/FieldForm.tsx` |
| Une règle ne peut pas être ajoutée à une version portant déjà des données | `guard_validation_rule_inuse` |
| L'évaluateur React des opérateurs et du masquage vit dans `validation.ts`, pas dans `templateRules.ts` | `src/domain/validation.ts` |
| La garde existante refuse déjà de supprimer une section portant une variable | `guard_template_section_write`, `20260815180000_template_section.sql` |
| `ExportField` porte déjà `section` (code stable) et `sectionLabel` | `generate-export/exportContract.ts` |
| Toute la construction des colonnes, du dictionnaire et des modalités part d'un seul tableau | `generate-export/handler.ts` |
| Les index d'opérandes de formule sont construits depuis le tableau de champs transmis à l'export | `formulaFieldIndex`, `buildPatientExport`, `buildEncounterExport` |
| `mergeExportFields` fusionne par `(scope, field_key)` et retient la section de la première version rencontrée | `generate-export/exportContract.ts` |
| Les profils d'export `analysis` / `complete` existent, et `export_options` est déjà journalisé | `generate-export/handler.ts` |
| `terminology_concept` porte `parent_id` et `depth` ; chapitres et blocs n'ont pas toujours de code | `20260726120000_terminology_reference.sql` |
| La copie locale du référentiel télécharge la publication entière, mais ne transporte que `code`, `label`, `searchText` | `src/data/terminologyCache.ts`, `src/data/terminology.ts` |
| Le script d'import maintient déjà la chaîne d'ancêtres en mémoire | `scripts/import-terminology.mjs` |
| Le résultat d'une variable calculée n'est jamais stocké | `20260820120000_template_field_formula.sql` |

## 6. Ce qui est différé, et à quelle condition le reprendre

**Inférence de familles CIM-11** (chemin d'ancêtres sur `terminology_concept`, plus
un opérateur d'appartenance à une famille). Différée jusqu'à preuve que les associations
exactes de codes deviennent insuffisantes. L'association exacte est désormais incluse dans
L51/L55 ; le diagnostic n'est pas ressaisi dans un sélecteur manuel obligatoire.

Point de conception déjà acquis pour ce jour-là : la question « ce code appartient-il à cette
famille ? » se résout en **remontant** les ancêtres du code saisi, jamais en précalculant tous
les descendants d'une racine. Le chemin doit être bâti sur les **identifiants** de concepts et
non sur les codes, puisque chapitres et blocs n'en ont pas toujours — ce qui rend le gel de la
publication terminologique obligatoire, un identifiant n'étant stable qu'à l'intérieur d'une
publication.

**Chantier complet des modules spécialisés.** À reprendre si au moins un signal structurel
apparaît sur la base pilote : des données de bloc doivent survivre à une désactivation ; un
historique d'activation devient nécessaire ; un même bloc doit être réutilisé et versionné
indépendamment dans plusieurs bases ; ou le nombre de règles devient ingérable malgré la
visibilité de section.

**Rattachement plusieurs-à-plusieurs des variables aux projections.** Différé. La v1 place une
variable partagée dans le tronc commun et l'inclut donc dans tous les exports projetés. À
reprendre seulement si le nombre de colonnes communes vides reste réellement gênant après L53 ;
ne pas introduire préventivement une table de liaison et tout son cycle de versionnement.

**Expressions booléennes entre plusieurs champs pilotes.** Différées. `contains_any` couvre
seulement plusieurs valeurs d'un même pilote. À reprendre si le pilote montre fréquemment des
variables ou des blocs dont l'applicabilité exige un `OR` entre diagnostic, mesure et autre champ ;
ne pas transformer L51 en langage de règles général sans cette preuve.

**Reprise des bases par pathologie existantes.** Chantier de données distinct, non planifié.

**Lien d'un même patient entre bases distinctes.** Hors de cette décision. À reconsidérer
uniquement si le terrain montre que la ressaisie se produit surtout entre contextes ayant des
équipes, permissions, finalités ou durées de conservation différentes. Ce cas demande une
décision propre sur l'identité, le consentement, la sécurité et la gouvernance ; il ne doit pas
être résolu en élargissant artificiellement une base.

### Validation terrain de l'hypothèse

Avant généralisation, tester une base pilote bornée à deux ou trois blocs représentatifs, avec
des scénarios fictifs. Comparer le parcours actuel et le parcours proposé sur :

- le temps et le nombre de champs ressaisis pour un patient relevant de plusieurs blocs ;
- les erreurs de choix, retours arrière et changements d'activation d'un bloc ;
- la compréhension du tronc commun, des blocs et de l'avertissement avant effacement ;
- la fréquence réelle des variables partagées et des colonnes communes vides ;
- la capacité à produire puis exploiter un export « tronc commun + un bloc » ;
- la fréquence des données répétées dans le temps ou des cycles de vie propres à un bloc ;
- l'existence éventuelle de conflits de permissions ou de finalité entre les blocs envisagés.

Le pilote peut alors conduire à trois décisions explicites : conserver les sections
conditionnelles ; investir dans des modules réutilisables et historisés ; ou maintenir des bases
séparées et ouvrir un chantier de liaison inter-bases. Il sert à choisir entre ces architectures,
pas seulement à valider celle déjà dessinée.

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

## 8. Décision de collecte progressive — 5 septembre 2026

Le jalon terrain devient : socle et diagnostic enregistrables dans la base autorisée même
sans bloc spécialisé. Couverture et complétude restent distinctes ; mission mono-base et
collectes ciblées préservées. L55 configure le pilote et les décisions de couverture ; L56
livre la saisie et la file autorisée ; L57 cadre seulement les reprises versionnées et leurs
notifications. La disponibilité d’un bloc ne transforme jamais silencieusement un dossier
historique. Le [complément](spec-collecte-diagnostique.md) porte le contrat et les tests.
