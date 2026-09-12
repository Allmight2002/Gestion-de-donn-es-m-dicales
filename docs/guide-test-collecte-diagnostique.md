# Guide de test — blocs cliniques et collecte diagnostique (L51 → L56)

> 🟢 **Document vivant**, rédigé le 7 septembre 2026, révisé le 8 après une première campagne
> d'essai — d'où le §2.3, le §3.2 et la réserve de la série C. Il décrit **comment éprouver** les lots
> L51 à L56 et la projection d'export L53 sur un environnement portant leurs migrations.
> Il ne constitue **aucune preuve** par lui-même : la preuve est la feuille de relevé du §7,
> remplie et datée.
>
> ⚠️ **Données fictives uniquement.** Le périmètre autorisé n'a pas changé
> ([etat-actuel-2026-08-01.md](etat-actuel-2026-08-01.md)).

Ce guide comble la lacune consignée dans [l56-parcours-et-suivi.md](l56-parcours-et-suivi.md) :
les contrôles automatisés, la migration et le build sont passés en local, **le parcours navigateur
ne l'a pas été**, faute d'un serveur portant les migrations sur le poste de développement. Le §4.3
de [spec-collecte-diagnostique.md](spec-collecte-diagnostique.md) et le §9 de
[spec-blocs-pathologies.md](spec-blocs-pathologies.md) restent donc ouverts.

---

## 0. Périmètre

| Lot | Ce que ce guide éprouve | Détail d'implémentation |
|---|---|---|
| **L51** | Règle « contient au moins un de ces codes » (`contains_any`) entre valeurs d'un même pilote | [l51-contains-any.md](l51-contains-any.md) |
| **L54** | Sections à deux niveaux : blocs racines, sous-sections, tronc commun | [spec-blocs-pathologies.md §4](spec-blocs-pathologies.md) |
| **L52** | Visibilité au **niveau bloc**, et retrait d'un diagnostic qui masque des valeurs saisies | [spec-blocs-pathologies.md §5](spec-blocs-pathologies.md) |
| **L53** | Projection d'export par blocs (colonnes, jamais population) | [l53-projection-export.md](l53-projection-export.md) |
| **L55** | Configuration diagnostique versionnée, couverture, refus et gels | [l55-configuration-diagnostique.md](l55-configuration-diagnostique.md) |
| **L56** | Socle enregistrable sans bloc, information de couverture, file « Diagnostics » | [l56-parcours-et-suivi.md](l56-parcours-et-suivi.md) |
| — | En-tête `x-meddata-diagnosis-contract` accepté par le CORS des Edge Functions | commit `b4e0ffc` |

**Hors périmètre de ce guide :**

- **L57** (reprise versionnée, notifications) : non implémenté, aucune reprise automatique n'est
  attendue nulle part — c'est même un **résultat à vérifier** (série F).
- **Pilote terminologique sur un référentiel réel** : la mesure de charge exigée par L55 avant
  activation reste due. Le montage ci-dessous utilise un pilote **liste de choix**, qui n'exige
  aucun identifiant de publication et se monte entièrement depuis l'interface.
- **Hors-ligne** : le contrat est transporté par l'instantané, mais O6/O7 ne sont pas levés. Seule
  une vérification de non-régression est proposée (série H).
- **Déploiement, migration distante, charge, performance.**

---

## 1. Règles impératives

- **Données fictives** : noms, codes et valeurs inventés. Aucune donnée réelle, même de test.
- **Préfixer `QA-`** tout ce qui est créé (base `QA-DIAG`, patients `QA-P1…`), et ne supprimer que
  ce qui porte ce préfixe.
- **Console navigateur et onglet Réseau ouverts** en permanence : noter toute erreur rouge et toute
  réponse 4xx/5xx (hors 401 attendus).
- **Un refus attendu est un succès de test.** Les séries D, F et G vérifient surtout ce que le
  produit *refuse* : un refus explicite est le résultat recherché, un succès silencieux est un
  échec.
- Statut par étape : **OK / KO / BLOQUÉ / NON TESTÉ**, plus une observation. Capture d'écran exigée
  pour toute anomalie.
- **Ne rien déployer, ne rien pousser, n'appliquer aucune migration distante** depuis ce guide.

---

## 2. Environnement requis

### 2.1 Migrations attendues

Le serveur doit porter ces cinq migrations, dans cet ordre :

| Migration | Lot |
|---|---|
| `20260905133549_rule_contains_any.sql` | L51 |
| `20260905143319_template_section_hierarchy.sql` | L54 |
| `20260905160000_block_visibility.sql` | L52 |
| `20260906061539_diagnosis_configuration.sql` | L55 |
| `20260906143000_diagnosis_followup.sql` | L56 |

Deux voies possibles :

- **Local avec Docker** — [tester-en-local.md](tester-en-local.md) : `npm run supabase:start`,
  `npm run supabase:storage`, `npm run dev`. C'est la voie recommandée : tout est jetable.
- **Environnement d'essai déployé** — le serveur doit avoir reçu les migrations **avant** que le
  frontend correspondant ne soit servi, puis la configuration diagnostique est créée **en dernier**
  (ordre d'activation obligatoire de L55, § « Compatibilité et activation »).

> **Vérifié le 8 septembre 2026 :** l'environnement déployé (`gestion-de-donn-es-m-dicales.
> vercel.app`) porte bien L51 à L56, côté base — refus `DIAGNOSIS_*` observés — comme côté
> frontend : le bundle servi contient `contains_any`, `parentSectionKey`, `sectionProjection`,
> `x-meddata-diagnosis-contract`, `set_diagnosis_configuration` et `diagnosis_followup`. Il ne
> portait pas encore, ce jour-là, les deux correctifs du §2.3. Revérifier avant chaque campagne
> plutôt que se fier à cette ligne : c'est l'objet de E-1.

### 2.2 Edge Functions

`generate-export` doit être redéployée : elle porte la projection L53 **et** la liste CORS
actualisée. Le client navigateur envoie désormais `x-meddata-diagnosis-contract` sur **toutes** ses
requêtes (`src/lib/supabase.ts`). Une Edge Function restée sur une liste CORS antérieure fait donc
échouer le *preflight* — export, dépôt de fichier et comptes de mission tombent ensemble. C'est
l'objet de la série H.

### 2.3 Correctifs frontend requis

Deux correctifs conditionnent la campagne. Vérifier le commit servi avant de commencer (E-1) :

| Commit | Sans lui |
|---|---|
| `f76a5c8` | **Aucune liste munie de la soupape n'est renseignable** : la case se décoche seule, et aucun bloc conditionnel ne s'ouvre. Deux mises à jour partaient du même gestionnaire — poser la valeur, effacer la proposition — et la seconde écrasait la première. Le pilote diagnostique étant nécessairement muni de la soupape, les séries C, E, F et G sont bloquées d'un coup |
| `dad237d` | La soupape n'est pas offerte en portée **patient** pour une liste de choix : la variante transversale du §3.2 impose alors de créer le champ compagnon à la main |

### 2.4 Contrôles d'entrée (avant toute saisie)

| # | Action | Attendu |
|---|---|---|
| E-1 | Rechargement forcé (`Ctrl+Shift+R`), puis **Synchronisation** → « État du système » | Version et commit affichés correspondent à la livraison testée |
| E-2 | Se connecter en médecin propriétaire, ouvrir une base → **Paramètres → Variables** | Le bloc **« Collecte diagnostique optionnelle »** est présent |
| E-3 | Si ce bloc est **absent** | Le serveur ignore la colonne `diagnosis_configuration` : migration L55 non appliquée. **C'est le comportement attendu face à un serveur antérieur**, pas une panne — le gabarit reste consultable et modifiable. Arrêter ici et corriger l'environnement |
| E-4 | `npm run db:verify` puis `npm run schema:check` (poste de développement) | Migrations appliquées depuis zéro ; snapshot à jour |

### 2.5 Comptes (jeu de démonstration local)

Mot de passe commun `Password123!`.

| Compte | Rôle global | Usage dans ce guide |
|---|---|---|
| `alice@demo.test` | médecin | Propriétaire de `QA-DIAG` : gabarit, configuration, file de suivi, export |
| `editor@demo.test` | médecin | Collaborateur avec permissions d'édition : doit être **refusé** sur la file |
| `curator1@demo.test` | curateur | Doit être refusé par le garde de rôle de la route |
| `bob@demo.test` | médecin | Médecin d'une autre base : ne doit rien voir |
| compte de mission | mission | Saisie terrain (créé en M-10) |

---

## 3. Montage du jeu d'essai `QA-DIAG` (~25 min, une seule fois)

Le montage est lui-même un test : chaque étape porte son attendu. Tout se fait en
`alice@demo.test`.

**Ce que le montage construit**, et c'est toute la logique du guide : trois natures de variables.

- Un **pilote** au tronc commun (`diagnostic`) : la liste de diagnostics qui décide quels blocs
  s'affichent. C'est lui que la configuration L55 désigne.
- Un **socle** au tronc commun (`temperature`) : toujours affiché, toujours obligatoire, quel que
  soit le diagnostic. Il sert à prouver qu'un diagnostic non couvert ne dispense de rien.
- Des **variables de blocs** (`tb_frottis`, `mn_pb_brachial`…) : elles n'existent à l'écran que
  lorsque leur bloc est déclenché par le pilote.

« Au tronc commun » signifie que le champ **Section** du formulaire de variable vaut
**« Tronc commun »** — la variable n'appartient à aucun bloc. C'est une **condition** pour être
pilote, et c'est ce qui rend une colonne toujours présente à l'export (série G).

| # | Action | Attendu |
|---|---|---|
| M-1 | Tableau de bord → créer la base **`QA-DIAG`**, modèle d'observation **« Suivi répété »** | Base créée, plusieurs rencontres possibles par patient |
| M-2 | Base → **Paramètres → Variables** | Éditeur de version en **brouillon**, éditable |
| M-3 | Créer quatre **blocs racines** : `Tuberculose`, `Malnutrition`, `Bloc générique`, `Bloc vide` | Quatre sections racines ; le code interne est dérivé du libellé, puis **figé** : `tuberculose`, `malnutrition`, `bloc_generique`, `bloc_vide` |
| M-4 | Créer une **sous-section** `Biologie TB` avec **Bloc parent = Tuberculose** | La sous-section apparaît **sous** son bloc ; elle n'est jamais proposée comme racine |
| M-5 | Créer le **pilote** `diagnostic` — détail au §3.1, ligne 1 | La variable existe, et le champ compagnon `diagnostic_autre` est créé **automatiquement** à côté d'elle |
| M-6 | Créer le **socle** `temperature` — §3.1, ligne 3 | Variable obligatoire du tronc commun : elle sera exigée dans tous les cas |
| M-7 | Créer les **quatre variables de blocs** — §3.1, lignes 4 à 7 | `Bloc vide` reste sans aucune variable : c'est voulu (test D-6) |
| M-8 | Bloc **« Collecte diagnostique optionnelle »** : *Fiche concernée* = **Rencontre**, *Variable diagnostique* = `diagnostic`, *Codes pour lesquels le socle suffit* = `anemie_ferriprive`, puis **Enregistrer la configuration** | Enregistré. La ligne « Champ de proposition existant : … (`diagnostic_autre`) » s'affiche. Aucun champ *Identifiant de la release* n'apparaît : il est réservé aux pilotes de type diagnostic |
| M-9 | Section **« Associations diagnostic → blocs »** : *Bloc racine* = `Tuberculose`, codes = `tuberculose_pulmonaire` → **Enregistrer cette association**. Recommencer avec `Malnutrition` ← `malnutrition_aigue` | Deux règles de visibilité de bloc existent, opérateur **« contient au moins un de ces codes »**, cible **bloc** |
| M-10 | Barre latérale → **Comptes de mission** → **Ouvrir un compte de mission** sur `QA-DIAG` | Identifiant et mot de passe temporaires remis une seule fois : les noter |

### 3.1 Détail des variables à créer (M-5 à M-7)

Chaque ligne = un passage par **« Ajouter une variable »** dans l'éditeur. Le formulaire demande
toujours les mêmes champs : **Clé technique**, **Libellé**, **Portée**, **Section**, **Type**, case
**Obligatoire**, puis un volet **« Choix et valeurs possibles »** pour les listes.

| # | Clé technique | Libellé | Portée | Section | Type | Obligatoire | À faire en plus |
|---|---|---|---|---|---|---|---|
| 1 | `diagnostic` | Diagnostics | Rencontre | **Tronc commun** | Liste de choix **multiple** | non | Saisir les 4 options (ci-dessous) **et** cocher « Permettre de proposer une valeur hors liste » |
| 2 | `diagnostic_autre` | — | — | — | — | — | **Ne pas la créer** : la case cochée en ligne 1 la crée pour vous, en texte facultatif, au tronc commun |
| 3 | `temperature` | Température | Rencontre | **Tronc commun** | Nombre | **oui** | — |
| 4 | `tb_frottis` | Frottis positif | Rencontre | **Tuberculose** | Liste de choix | non | Deux options : `Oui`, `Non` |
| 5 | `tb_genexpert` | GeneXpert | Rencontre | **Biologie TB** | Liste de choix | non | Deux options : `Oui`, `Non` — c'est la variable **de sous-section** |
| 6 | `mn_pb_brachial` | Périmètre brachial | Rencontre | **Malnutrition** | Nombre | **oui** | Elle prouve qu'un bloc affiché réimpose ses obligations (C-4) |
| 7 | `gen_note` | Note libre | Rencontre | **Bloc générique** | Texte | non | Sert au test D-7 (bloc portant déjà une condition) |

**Les quatre options du pilote (ligne 1).** Dans « Choix et valeurs possibles », ajouter les
libellés suivants. Le **code** n'est pas saisi : il est dérivé du libellé, affiché sous l'option et
figé une fois créé.

| Libellé saisi | Code obtenu | Rôle dans les tests |
|---|---|---|
| `Tuberculose pulmonaire` | `tuberculose_pulmonaire` | Sera **couvert** (associé au bloc Tuberculose) |
| `Malnutrition aiguë` | `malnutrition_aigue` | Sera **couvert** (associé au bloc Malnutrition) |
| `Paludisme grave` | `paludisme_grave` | Restera **non couvert** : aucun bloc |
| `Anémie ferriprive` | `anemie_ferriprive` | Sera déclaré **« le socle suffit »** |

> ⚠️ **Vérifier les codes affichés avant de continuer.** Ce sont eux, et non les libellés, qui sont
> saisis en M-8 et M-9 : un code différent de celui affiché est refusé (`DIAGNOSIS_CODE_UNKNOWN`).
> Ne pas confondre non plus le **code de diagnostic** `tuberculose_pulmonaire` avec la **clé du
> bloc** `tuberculose` : ce sont deux objets distincts, et c'est l'association M-9 qui les relie.

**`DIAGNOSIS_CODE_UNKNOWN` en M-8 ou M-9**, par ordre de fréquence : le **libellé** a été saisi à
la place du code ; **plusieurs codes sur une même ligne** (la zone découpe uniquement sur les
retours à la ligne — une virgule produit un seul code inexistant) ; une option **renommée** après
coup, dont le code n'a pas changé et ne change jamais ; une différence de casse ou un caractère
parasite, la comparaison étant une égalité de chaînes exacte.

> La case « Permettre de proposer une valeur hors liste » n'apparaît **qu'à la création** d'une
> variable de type liste ou diagnostic. Oubliée, il faut supprimer la variable et la recréer — ou
> créer `diagnostic_autre` à la main, en texte, facultatif, au tronc commun, sans règle.

**Cartographie attendue après montage** — `tuberculose_pulmonaire` → couvert (bloc `tuberculose` et
sa sous-section **Biologie TB**) ; `malnutrition_aigue` → couvert ; `paludisme_grave` → **non
couvert** ; `anemie_ferriprive` → **socle suffit** ; texte libre dans `diagnostic_autre` →
**proposition non rattachée**.

### 3.2 Variante en base transversale (« une seule saisie par participant »)

Toute la campagne tient en transversal, à condition de basculer le montage en portée **patient**.
Ce n'est pas cosmétique : en `cross_sectional`, les rencontres et toute donnée de portée rencontre
sont **refusées par les gardes SQL**, pas seulement masquées
([architecture.md](architecture.md)). Le formulaire de variable remplace alors le sélecteur
*Portée* par la mention figée « Données du formulaire unique ».

| Étape | Ce qui change |
|---|---|
| M-1 | Modèle d'observation **« Une seule saisie par participant »** |
| M-5 à M-7 | Plus de choix de portée : tout est patient. Le reste — section, type, options, soupape — est identique |
| M-8 | *Fiche concernée* = **Patient (permanent)**. Laisser « Rencontre » donne une liste de pilotes **vide** : aucune variable de cette portée n'existe. Ce n'est pas une panne |
| Séries C et E | Mêmes tests sur les formulaires patient : le bandeau de couverture et la confirmation de retrait y sont câblés comme sur les rencontres |
| Série F | Filtre **Données permanentes** au lieu de « Rencontres » ; « Ouvrir la fiche » mène à la fiche patient |
| Série G | La forme du fichier est figée à « Une ligne par participant » ; la projection par blocs est inchangée |

**Ce que le transversal ne permet pas de prouver** : le scénario « retour du même patient avec un
diagnostic différent » du §4.3 — impossible par construction, un second passage est un autre
patient. Ni le pilote de portée rencontre, ni la coexistence de deux pilotes (un par portée).

**Deux pièges propres à cette variante :**

- **Ne pas créer la base transversale à partir du gabarit `QA-DIAG`** monté en suivi répété :
  `create_base_from_model_observation` force la portée patient et **refuse** une configuration
  `encounter` avec `DIAGNOSIS_SCOPE_COPY_CONFLICT`, plutôt que de la déformer en silence. Repartir
  d'un gabarit vierge — et cocher ce refus comme un test à part entière.
- **La soupape en portée patient exige un frontend récent.** Sur une version antérieure au
  correctif, la case « Permettre de proposer une valeur hors liste » n'est offerte qu'en portée
  rencontre pour les listes de choix ; sans champ compagnon, M-8 est refusé
  (`DIAGNOSIS_PROPOSAL_INVALID`). Contournement sans code : créer le compagnon à la main — clé
  exactement `<pilote>_autre`, type texte, facultatif, tronc commun, sans règle.

---

## 4. Séries de tests

### Série A — L54 : sections à deux niveaux

| # | Action | Attendu |
|---|---|---|
| A-1 | Éditeur de variables : lire l'arborescence des sections | `Biologie TB` apparaît **sous** `Tuberculose` ; les autres sections sont racines |
| A-2 | Ouvrir **Aperçu du formulaire** | Le rendu respecte les deux niveaux ; les variables sans section apparaissent hors bloc (tronc commun) |
| A-3 | Tenter de donner un **bloc parent** à une section qui porte déjà une sous-section | Refusé : la hiérarchie reste à deux niveaux |
| A-4 | Créer une rencontre (série C) et observer l'ordre des blocs | L'ordre d'affichage suit l'ordre défini dans l'éditeur |

### Série B — L51 : appartenance `contains_any`

| # | Action | Attendu |
|---|---|---|
| B-1 | Éditeur → règles : lire la règle écrite par l'association `Tuberculose` | Condition sur `diagnostic`, opérateur **« contient au moins un de ces codes »**, valeur = liste `["tuberculose_pulmonaire"]`, cible = **bloc** `tuberculose` |
| B-2 | Créer une règle `contains_any` à la main sur une variable qui n'est **pas** une liste (ex. `temperature`) | Refusé : « Choisissez une variable de type liste de choix ou diagnostic » |
| B-3 | Ajouter à la main une **seconde** règle d'affichage sur le bloc `tuberculose` | Refusé — `DIAGNOSIS_BLOCK_NONCANONICAL` : un bloc associé à un diagnostic ne porte qu'une seule condition de bloc. Les conditions de champs **internes** au bloc restent autorisées |
| B-4 | Modifier l'association `Tuberculose` pour y mettre **deux codes** (`tuberculose_pulmonaire`, `paludisme_grave`), enregistrer, revenir sur l'écran | Une **liste unique** de deux codes (OR), jamais deux règles qui se cumuleraient en ET. **Remettre `tuberculose_pulmonaire` seul avant de continuer** |
| B-5 | Dans l'aperçu, sélectionner un code hors association | Le bloc reste masqué ; aucune erreur console |

### Série C — L52 : visibilité au niveau bloc et retrait de diagnostic

Créer d'abord un patient `QA-P1`, puis une rencontre.

> ⚠️ **C-6 à C-9 exigent un pilote de type diagnostic (terminologie).** La confirmation de retrait
> n'est armée que pour une règle dont la condition porte sur un champ `terminology`
> ([useVisibilityWithdrawal.ts:39](../src/screens/member/useVisibilityWithdrawal.ts)). Avec le
> pilote **liste de choix** du montage, retirer un diagnostic qui masque un bloc rempli affiche le
> bandeau « valeurs masquées » — informatif, non bloquant — mais **aucune boîte de confirmation** :
> les valeurs partent à l'enregistrement sans qu'on ait à confirmer. Ce n'est donc pas un KO à
> consigner. Pour éprouver C-6 à C-9 réellement, il faut monter un pilote terminologique, ce qui
> suppose une publication locale créée en SQL ; sinon, marquer ces quatre lignes **NON TESTÉ** et
> s'en remettre à `test/template-block-visibility.test.ts`.

| # | Action | Attendu |
|---|---|---|
| C-1 | Nouvelle rencontre, ne rien choisir dans `diagnostic` | Aucun bloc affiché ; seules les variables du tronc commun sont visibles |
| C-2 | Choisir `tuberculose_pulmonaire` | Le bloc **Tuberculose** apparaît **avec sa sous-section** `Biologie TB` |
| C-3 | Remplir `temperature`, `tb_frottis`, `tb_genexpert`, enregistrer en **complet** | Enregistrement accepté |
| C-4 | Rouvrir la rencontre, ajouter `malnutrition_aigue`, enregistrer en **complet** sans remplir `mn_pb_brachial` | **Refusé** : la variable obligatoire d'un bloc **affiché** reste exigée |
| C-5 | Remplir `mn_pb_brachial`, enregistrer | Accepté |
| C-6 | Retirer `malnutrition_aigue` alors que son bloc est rempli, puis enregistrer | Une **confirmation** apparaît : « Retrait du diagnostic : confirmation nécessaire », annonçant le nombre de valeurs masquées |
| C-7 | Cliquer **« Annuler et conserver la saisie »** | Rien n'est écrit : le diagnostic **et** les valeurs du bloc sont conservés |
| C-8 | Refaire le retrait, puis **« Confirmer le retrait et enregistrer »** | Le diagnostic et les valeurs du bloc partent **ensemble** ; aucune valeur orpheline |
| C-9 | Ouvrir la même rencontre dans **deux onglets**, enregistrer dans l'onglet 1, puis confirmer un retrait dans l'onglet 2 | Échec en **conflit de version** : message demandant de recharger, saisies locales conservées, **rien d'écrasé** |
| C-10 | Reprendre C-8 sur une rencontre au statut `curated` (via la curation) | Même règle : pas d'effacement silencieux, refus ou retrait explicite |

### Série D — L55 : configuration, refus et gels

Chaque refus s'affiche en bandeau rouge dans l'éditeur. **Le code technique est affiché tel quel**
(ex. `DIAGNOSIS_BLOCK_EMPTY`) : à consigner comme observation d'ergonomie, pas comme un échec
fonctionnel.

| # | Action | Attendu |
|---|---|---|
| D-1 | Éditeur → *Variable diagnostique* : dérouler la liste | Seules apparaissent les variables **liste/diagnostic**, de la portée choisie, **communes** (quelle que soit leur rubrique UX-16), sans formule et non gouvernées par une règle d'affichage. Les variables communes refusées sont listées sous la liste, avec leur motif |
| D-2 | Déplacer le pilote `diagnostic` dans un bloc | **La modification elle-même est refusée** — `DIAGNOSIS_DRIVER_INVALID` : toute mutation de champ, de section ou de règle revalide la configuration sous le verrou de version. Le pilote reste au tronc commun |
| D-3 | Supprimer la soupape `diagnostic_autre`, ou la rendre **obligatoire**, ou la déplacer dans un bloc | **Refusé** — `DIAGNOSIS_PROPOSAL_INVALID` : le champ compagnon doit exister, rester facultatif, hors section et sans règle |
| D-3b | Sur une version **sans** soupape, choisir un pilote dans l'éditeur | Le bouton **Enregistrer la configuration** est **désactivé**, avec « Ajoutez la soupape "valeur hors liste" au pilote… » |
| D-4 | Ajouter `tuberculose_pulmonaire` (déjà associé à un bloc) dans les *codes pour lesquels le socle suffit* | Refusé — `DIAGNOSIS_COMMON_BLOCK_OVERLAP` : un code qui cible un bloc ne peut pas être déclaré « socle suffit » |
| D-5 | Mettre un code absent des options (ex. `ZZZ`) dans les codes socle | Refusé — `DIAGNOSIS_CODE_UNKNOWN` |
| D-6 | Associer le **`Bloc vide`** à un code | Refusé — `DIAGNOSIS_BLOCK_EMPTY` : un bloc sans variable saisissable de la bonne portée ne couvre rien |
| D-7 | Poser à la main une règle d'affichage quelconque sur `Bloc générique`, puis tenter de l'associer à un diagnostic | L'écran affiche « Ce bloc porte déjà une autre condition d'affichage… » et le bouton reste **désactivé** |
| D-8 | Créer une rencontre utilisant la version, puis revenir à l'éditeur | Le bloc de configuration devient **non modifiable** (version en usage). Côté serveur : `DIAGNOSIS_VERSION_FROZEN` |
| D-9 | Cliquer **« Créer la version suivante »** | Nouvelle version brouillon **portant la configuration recopiée par valeur** : pilote, codes socle et associations identiques |
| D-10 | Dupliquer le gabarit, ou créer une base à partir de lui | La configuration suit la copie ; aucune référence croisée vers la version d'origine |

### Série E — L56 : couverture affichée pendant la saisie

L'information est **non bloquante** et n'affiche **que des codes**.

| # | Action | Attendu |
|---|---|---|
| E-1 | Nouvelle rencontre, choisir `tuberculose_pulmonaire` | **Aucun** message de couverture : le diagnostic est couvert |
| E-2 | Choisir `paludisme_grave` seul, remplir `temperature`, enregistrer en **complet** | Bandeau bleu : « 1 diagnostic(s) sans bloc spécialisé dans cette version : `paludisme_grave` » suivi de « Information seulement… ». **L'enregistrement en complet réussit** : aucun bloc n'est exigé |
| E-3 | Choisir `anemie_ferriprive` seul | **Aucun** message : « le socle suffit » est une décision du responsable, pas un manque |
| E-4 | Choisir `tuberculose_pulmonaire` **et** `paludisme_grave` (cas mixte) | Le bloc Tuberculose s'affiche et ses obligations s'appliquent ; le bandeau ne cite que `paludisme_grave` |
| E-5 | Laisser `diagnostic` vide et écrire un texte libre dans `diagnostic_autre` | « Une proposition de diagnostic n'est pas encore rattachée à un code. » — **le texte saisi n'est jamais repris** dans le message |
| E-6 | Vérifier le bandeau sur : nouveau patient, formulaire de rencontre, édition patient, édition rencontre, **fiche patient** | Même information, chaque fiche évaluée **dans sa version** |
| E-7 | Vider `temperature` et enregistrer en complet | **Refusé** : le socle reste exigé ; la couverture ne remplace jamais `draft`/`complete`/`curated` |
| E-8 | Se connecter avec le **compte de mission**, saisir un socle plus `paludisme_grave`, soumettre | Accepté, en brouillon comme en complet. Le compte ne gagne **ni identité, ni curation, ni correction après soumission** |
| E-9 | Rechercher un diagnostic dans le champ pilote | La liste propose **tous** les codes, jamais seulement ceux qui portent un bloc |

### Série F — L56 : file « Diagnostics » et cloisonnement

| # | Action | Attendu |
|---|---|---|
| F-1 | `alice` → base → **À compléter → Diagnostics** | Écran « Diagnostics sans bloc ». Les rencontres `paludisme_grave` et la proposition libre y figurent ; celles en `tuberculose_pulmonaire` et `anemie_ferriprive` **non** |
| F-2 | Lire une ligne | Code patient, type et date de rencontre, **statut**, **numéro de version source**, codes non couverts en pastilles, lien « Ouvrir la fiche ». **Aucun nom, aucun document, aucun texte de proposition** |
| F-3 | Lire les agrégats en haut | Un compte par code (`paludisme_grave · n dossier(s)`) et « Proposition à rattacher · n ». Une proposition est **comptée, jamais citée** |
| F-4 | Filtrer par **Fiche concernée**, par **Code diagnostique**, puis par **Version du dossier** | Les trois filtres restreignent la liste ; le sélecteur de codes continue de proposer tous les codes |
| F-5 | Cliquer « Ouvrir la fiche » | Ouvre la rencontre (ou la fiche patient) dans le parcours autorisé existant |
| F-6 | Créer une **nouvelle version** associant un bloc à `paludisme_grave`, la mettre en version courante, revenir à la file | Les anciens dossiers **restent** dans la file, avec « Un bloc existe désormais dans la version courante pour : `paludisme_grave` · Aucune reprise automatique ». **Aucune donnée déplacée, aucune notification** |
| F-7 | Se connecter en `editor@demo.test` (collaborateur, permissions d'édition) | L'entrée **Diagnostics** n'apparaît pas ; en forçant `/bases/<id>/diagnostics`, l'écran affiche « Cet écran est réservé au médecin responsable de la base » |
| F-8 | Idem avec `curator1@demo.test` (curateur) | Bloqué par le garde de rôle global de la route |
| F-9 | Idem avec `bob@demo.test` (autre médecin) et avec le **compte de mission** | Aucun accès ; le compte de mission ne reçoit **aucune** file de patients supplémentaire |
| F-10 | Mettre à la corbeille un patient présent dans la file, recharger | La ligne disparaît : lignes et bases supprimées sont exclues |

### Série G — L53 : projection d'export par blocs

Base → **Analyse → Exporter**, profil **Analyse**.

| # | Action | Attendu |
|---|---|---|
| G-1 | Laisser **« Tous les blocs »**, exporter en CSV puis en XLSX | Fichier identique à celui d'avant le lot : toutes les colonnes |
| G-2 | Choisir **« Choisir des blocs »** sans rien cocher | Le bouton d'export est **désactivé** et « Choisissez au moins un bloc… » s'affiche |
| G-3 | Cocher **Tuberculose** seul, exporter | Colonnes = tronc commun (`diagnostic`, `diagnostic_autre`, `temperature`) + `tb_frottis` + **`tb_genexpert`** — la sous-section suit son bloc. Aucune colonne de `Malnutrition` |
| G-4 | Compter les lignes de G-3 | **Identique** à G-1 : la projection retire des colonnes, **jamais des participants**. Une rencontre `malnutrition_aigue` ressort avec ses seules colonnes communes |
| G-5 | Vérifier qu'une rencontre au diagnostic **non couvert** (`paludisme_grave`) figure dans le fichier | Présente, avec son socle : les cas non couverts éligibles restent exportés |
| G-6 | Ouvrir le **dictionnaire** de l'export G-3 | Colonnes `block` et `block_label` juste après `section_label` ; vides pour les variables du tronc commun. Sur cette base, elles apparaissent **aussi** en mode « tous les blocs », puisqu'une sous-section existe — c'est la règle : projection demandée **ou** sous-section présente |
| G-7 | Onglet **Métadonnées** (profil Analyse) de G-3 | Une ligne `section_projection_blocks` listant les blocs choisis ; `row_count` = cohorte **entière** |
| G-8 | Métadonnées de G-1 (mode « tous les blocs ») | **Pas** de ligne `section_projection_blocks` |
| G-9 | « Exports conservés » | La projection résolue est journalisée pour les deux exports, y compris `{ "mode": "all" }` |
| G-10 | *(optionnel, appel direct de la fonction)* projection avec une clé inconnue, puis avec la clé d'une **sous-section** | `400` `EXPORT_PROJECTION_UNKNOWN_BLOCK`, puis `400` `EXPORT_PROJECTION_NOT_A_BLOCK` — **aucun fichier produit** |
| G-11 | *(optionnel)* déplacer une variable du tronc commun vers un bloc dans une nouvelle version, puis exporter en mode `selected` une cohorte couvrant les deux versions | `409` `EXPORT_BLOCK_AMBIGUOUS` — refus visible plutôt qu'un classement au hasard de l'ordre de lecture |

### Série H — Compatibilité, CORS et hors-ligne

| # | Action | Attendu |
|---|---|---|
| H-1 | Onglet Réseau : déclencher un export, puis un dépôt de fichier | Les *preflight* `OPTIONS` répondent avec `x-meddata-diagnosis-contract` dans `Access-Control-Allow-Headers`. **Aucune** erreur CORS |
| H-2 | Créer un compte de mission et lancer une inspection de fichier | Mêmes fonctions, même absence d'erreur CORS |
| H-3 | *(si un frontend antérieur est disponible)* soumettre une fiche sur une version portant une configuration | Refus explicite demandant une actualisation (`DIAGNOSIS_CLIENT_UNSUPPORTED`), jamais un enregistrement partiel |
| H-4 | Sur une base **historique à sections plates et sans configuration** (ex. la base de démonstration), parcourir saisie, export et fiche patient | Comportement **strictement inchangé** : aucun bandeau de couverture, et un export sans `sectionProjection` produit exactement la structure d'avant L53 — CSV comme XLSX, dictionnaire compris |
| H-5 | Télécharger l'instantané hors-ligne d'une base configurée, passer hors-ligne, ouvrir un formulaire | L'information de couverture s'affiche à l'identique ; aucune capacité hors-ligne nouvelle (O6/O7 restent fermés) |

---

## 5. Contrôles automatisés à rejouer

À lancer sur le poste de développement, **jamais contre la production** :

```bash
npm run typecheck && npm run lint && npm run test:web
```

```bash
npx vitest run --project db test/diagnosis-configuration.test.ts test/diagnosis-followup.test.ts test/contains-any.test.ts test/template-block-visibility.test.ts test/template-section-hierarchy.test.ts
```

```bash
npm run edge:test
```

```bash
npm run db:verify && npm run schema:check
```

> **Piège de poste connu.** Sur une machine à faible mémoire, le harnais laisse des PostgreSQL
> embarqués derrière lui : `out of memory`, `ECONNRESET` et « Failed to start forks worker »
> viennent de là, **pas** d'une régression. Tuer les processus orphelins, puis rejouer le fichier
> isolément avant de conclure. Même consigne pour un `waitFor` dépassé côté web.

Un build de production exige `VITE_USE_SIGNED_READ=true` ; ne pas contourner ce garde-fou.

---

## 6. Limites connues (à ne pas consigner comme anomalies)

- **Les codes de refus s'affichent bruts** (`DIAGNOSIS_*`) : ils ne sont traduits nulle part à ce
  jour.
- **L'écran d'export ne propose que les blocs de la version courante.** Un bloc retiré du gabarit
  courant reste projetable côté serveur mais n'est pas cochable depuis l'interface : limite assumée
  de L53.
- **Aucune reprise, aucune notification** : c'est le périmètre de L57, non implémenté.
- **Un pilote terminologique transporte toute la publication** (`recognizedCodes`), une fois par
  version. Sur un référentiel réel, mesurer ce volume avant d'activer, surtout si l'instantané
  hors-ligne est utilisé.
- La file de suivi paie ce contexte **une fois par version présente**, jamais par dossier.

---

## 7. Feuille de relevé

| Série | Étapes | OK | KO | BLOQUÉ | NON TESTÉ | Observations |
|---|---|---|---|---|---|---|
| Contrôles d'entrée | 4 | | | | | |
| M — montage | 10 | | | | | |
| A — L54 sections | 4 | | | | | |
| B — L51 appartenance | 5 | | | | | |
| C — L52 blocs et retrait | 10 | | | | | |
| D — L55 refus et gels | 11 | | | | | |
| E — L56 couverture | 9 | | | | | |
| F — L56 file de suivi | 10 | | | | | |
| G — L53 export | 11 | | | | | |
| H — compatibilité | 5 | | | | | |

**Environnement testé** : ……… · **Commit** : ……… · **Date** : ……… · **Opérateur** : ………

Une campagne n'est probante que si le §4.3 de
[spec-collecte-diagnostique.md](spec-collecte-diagnostique.md) est couvert de bout en bout. En cas
de KO, consigner le constat dans
[suivi-execution-feuille-route.md](suivi-execution-feuille-route.md) sans corriger dans la foulée :
la correction est un lot, pas une retouche de campagne.
