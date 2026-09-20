# Guide de test — groupes répétables (L66 → L71)

> 🟢 **Document vivant**, rédigé le 20 septembre 2026. Il décrit **comment éprouver** les groupes
> répétables sur un environnement portant leurs migrations. Il ne constitue **aucune preuve** par
> lui-même : la preuve est la feuille de relevé du §8, remplie et datée.
>
> ⚠️ **Données fictives uniquement.** Le périmètre autorisé n'a pas changé
> ([etat-actuel-2026-09-16.md](etat-actuel-2026-09-16.md)).

La spécification est [spec-groupes-repetables.md](spec-groupes-repetables.md) ; son §14 énonce le
plan de tests, ce guide en donne les **gestes**. Les contrôles automatisés sont passés en local
(§6) ; **le parcours navigateur ne l'a pas été** — c'est exactement ce que ce guide sert à combler.

---

## 0. Périmètre

| Lot | Ce que ce guide éprouve | Série |
|---|---|---|
| **L66** | Socle serveur : `template_section.is_repeatable`, `encounter.group_section_key`, date nullable, gardes, borne à 50 | B |
| **L67** | Éditeur : déclarer un bloc répétable, conséquences annoncées avant de cocher, marqueur de structure, aperçu | A |
| **L68** | Saisie en tableau dans une fiche existante : ajouter, modifier, supprimer une occurrence | C, D |
| **L69** | Création de patient : occurrences tamponnées, rejeu ordonné, échec partiel repris sans doublon | F |
| **L70** | Export : `group_section_key`, exclusion des occurrences de la ligne patient, colonnes `nb__<bloc>` | G |
| **L71** | Hors-ligne : lire et corriger une occurrence depuis la copie locale, rejeu et fusion de conflit | H |
| **§5 de la spec** | Sémantique d'applicabilité et complétude — **la partie qu'on oublie le plus facilement** | E |

> **La limite de L71, à ne pas confondre avec un manque.** La **saisie** d’une occurrence hors
> ligne reste fermée, dans une fiche existante comme à la création de patient. L71 livre la
> **lecture**, la **correction** et le **rejeu** d’une occurrence déjà écrite. La série H éprouve
> les deux faces.

**Hors périmètre de ce guide :**

- Sous-sections dans un bloc répétable, `required` au niveau du groupe, réordonnancement manuel,
  déplacement d'une occurrence d'un groupe à l'autre, groupes imbriqués, mappage d'import :
  **hors périmètre de la v1** ([spec §12](spec-groupes-repetables.md)).
- Reprise des variables numérotées existantes vers un groupe : chantier distinct.
- Déploiement, migration distante, charge, performance.

---

## 1. Règles impératives

- **Données fictives** : noms, codes et valeurs inventés. Aucune donnée réelle, même « de test ».
- **Préfixer `QA-`** tout ce qui est créé (base `QA-REPET`, patients `QA-P1…`), et ne supprimer que
  ce qui porte ce préfixe.
- **Console navigateur et onglet Réseau ouverts** en permanence : noter toute erreur rouge et toute
  réponse 4xx/5xx (hors 401 attendus).
- **Un refus attendu est un succès de test.** Les séries B et D vérifient surtout ce que le
  produit *refuse* : un refus explicite est le résultat recherché, un succès silencieux est un
  échec.
- Statut par étape : **OK / KO / BLOQUÉ / NON TESTÉ**, plus une observation. Capture d'écran exigée
  pour toute anomalie.
- **Ne rien déployer, ne rien pousser, n'appliquer aucune migration distante** depuis ce guide.

> ⚠️ **L'ordre du montage n'est pas négociable.** `is_repeatable` se fige dès que la version du
> jeu de variables porte **une seule** fiche ou rencontre (`template_version_in_use`). Déclarer les
> blocs répétables **avant** de créer le premier patient, sans exception. Le §3 respecte cet ordre ;
> le contourner rend la déclaration impossible et, avec elle, toute série qui en dépend : il faut
> alors repartir d’une base neuve.

---

## 2. Environnement requis

### 2.1 Où se trouve la fonctionnalité

Au 20 septembre 2026, **L66 à L71 sont sur `origin/develop`** — L71 par la PR #326, fusionnée le
jour même. `origin/main` porte L66 à L70. Les références **locales** `develop` et `main` sont
souvent en retard d’un lot : `git fetch` avant de conclure quoi que ce soit sur la présence d’un lot.

La branche de travail courante d'un autre chantier (par exemple la chaîne E4–E6) **ne porte pas
forcément ces lots**. Vérifier le commit réellement servi avant de commencer : c'est l'objet de P-1,
et c'est la cause la plus fréquente d'un « la case n'existe pas » qui n'est pas une anomalie.

### 2.2 Migrations attendues

Le serveur doit porter ces cinq migrations, dans cet ordre :

| Migration | Lot | Ce qu'elle apporte |
|---|---|---|
| `20260918191752_repeatable_groups.sql` | **L66** | `is_repeatable`, `group_section_key`, `encounter_date` nullable sous garde, gardes, borne 50, `missing_required_fields` / `base_completeness_stats` / `assert_required_complete` / `export_incomplete_records` |
| `20260919103000_form_compatible_group_context.sql` | E3 | Contexte de groupe dans les dossiers compatibles |
| `20260919110000_form_compatible_group_write_guards.sql` | E3 | Gardes d'écriture associées |
| `20260919190252_create_encounter_idempotent.sql` | **L69** | `create_encounter_idempotent` : une occurrence tamponnée rejouée avec la même clé n'insère jamais de doublon |
| `20260920090000_repeatable_groups_offline_replay.sql` | **L71** | `replay_encounter_create` gagne la clé de groupe en dernière position ; `replay_encounter_update` cesse de refuser une occurrence. Aucune table touchée, aucune donnée clinique réécrite |

Deux voies possibles :

- **Local avec Docker** — [tester-en-local.md](tester-en-local.md) : `npm run supabase:start`,
  `npm run supabase:storage`, `npm run dev`. C'est la voie recommandée : tout est jetable.
- **Environnement d'essai déployé** — le serveur doit avoir reçu les migrations **avant** que le
  frontend correspondant ne soit servi.

### 2.3 Edge Function

`generate-export` doit être **redéployée** : elle porte L70 (`group_section_key` dans la méta de
rencontre, colonnes de comptage, lignes de dictionnaire). Sans redéploiement, la série G échoue
entièrement alors que la base est correcte — vérifier ce point avant d'ouvrir une anomalie.

### 2.4 Contrôles d'entrée (avant toute saisie)

| # | Action | Attendu |
|---|---|---|
| P-1 | Rechargement forcé (`Ctrl+Shift+R`), puis **Synchronisation → « État du système »** | Version et commit affichés correspondent à une livraison contenant L66–L71 (§2.1). Sans L71, la série H se lit à l’envers : consigner alors la version exacte et marquer H-2 à H-6 **NON TESTÉ** |
| P-2 | Se connecter en médecin propriétaire, ouvrir une base **longitudinale** → **Paramètres → Formulaire → Sections** | Chaque **bloc racine** porte une case **« Groupe répétable »** |
| P-3 | Si la case est **absente** | Le frontend servi est antérieur à L67. **Ce n'est pas une panne** : arrêter ici et corriger l'environnement (§2.1) |
| P-4 | `npm run db:verify` puis `npm run schema:check` (poste de développement) | Migrations appliquées depuis zéro ; snapshot à jour |

### 2.5 Comptes (jeu de démonstration local)

Mot de passe commun `Password123!`.

| Compte | Rôle global | Usage dans ce guide |
|---|---|---|
| `alice@demo.test` | médecin | Propriétaire de `QA-REPET` : éditeur, saisie, export |
| `editor@demo.test` | médecin | Collaborateur avec édition : sert au conflit de version (D-1) |
| `curator1@demo.test` | curateur | Lecture seule sur la fiche : sert à D-6 |
| compte de mission | mission | Saisie terrain, complétude imposée (série E) |

---

## 3. Montage du jeu d'essai `QA-REPET` (~30 min, une seule fois)

Le montage est lui-même un test : chaque étape porte son attendu. Tout se fait en
`alice@demo.test`, **dans cet ordre**.

**Ce que le montage construit** — trois blocs racines, qui servent chacun un but distinct :

- **`Lésions vertébrales`** — répétable, **4 variables** : reste sous la barre des six colonnes,
  donc rendu **en tableau**. C'est le cas de référence.
- **`Interventions`** — répétable, **7 variables** dont une **date**, donc rendu **en cartes**
  (bascule au-delà de six colonnes) et preuve qu'une date d'occurrence est une variable ordinaire.
- **`Bloc ordinaire`** — **non répétable**, une variable de rencontre **sans type de rencontre
  restreint** : c'est lui qui rend la série E possible, dans les deux sens.
- Au **tronc commun**, `statut_neuro`, obligatoire : il prouve qu'une occurrence ne réclame **pas**
  les variables obligatoires hors de son groupe.

| # | Action | Attendu |
|---|---|---|
| M-1 | Tableau de bord → créer la base **`QA-REPET`**, modèle d'observation **« Suivi répété »** | Base créée. ⚠️ Ce choix **se verrouille à la première fiche** : une base **« Une seule saisie par participant »** n'acceptera jamais de bloc répétable (voir A-7) |
| M-2 | Base → **Paramètres → Formulaire** | Éditeur de version en **brouillon**, éditable, avec ses espaces **Structure du formulaire**, **Sections**, **Collecte diagnostique**, **Aperçu** et **Toutes les variables** |
| M-3 | Espace **Sections** → créer trois **blocs racines** : `Lésions vertébrales`, `Interventions`, `Bloc ordinaire` | Trois sections racines ; le code interne est dérivé du libellé puis **figé** : `lesions_vertebrales`, `interventions`, `bloc_ordinaire` |
| M-4 | Créer les **treize variables** du §3.1 | Toutes présentes, aux bonnes sections et portées |
| M-5 | Espace **Sections** → cocher **« Groupe répétable »** sur `Lésions vertébrales` | Une **confirmation** s'ouvre : « Déclarer « Lésions vertébrales » répétable ? » (détail en A-2). Valider par **« Déclarer répétable »** |
| M-6 | Idem sur `Interventions` | Même confirmation, même validation |
| M-7 | **Ne pas** cocher la case sur `Bloc ordinaire` | Il reste un bloc ordinaire : c'est le témoin de la série E |
| M-8 | Espace **Structure du formulaire** → lire le sommaire | `Lésions vertébrales` et `Interventions` portent le marqueur **« Répétable »** ; `Bloc ordinaire` n'en porte pas. Le panneau du bloc sélectionné ajoute : « Saisie en tableau, une ligne par occurrence. » |
| M-9 | Espace **Aperçu** | Les deux blocs répétables sont rendus sous leur **forme de saisie** : « Aperçu : la forme de saisie du bloc, sans aucune occurrence. L'ajout est inactif et rien n'est créé. », une « Ligne d'exemple, vide » et un bouton **« Ajouter une occurrence » inactif** |
| M-10 | Ouvrir une variable de `Lésions vertébrales` dans l'éditeur | Le réglage « types de rencontre concernés » est **remplacé** par : « Variable d'un groupe répétable : ce sont les lignes du bloc qui la portent, pas un type de rencontre. » |
| M-11 | **Seulement maintenant** : créer le patient **`QA-P1`** (identité fictive minimale) | Fiche créée. À partir de cet instant la version est « utilisée » et `is_repeatable` ne bouge plus |
| M-12 | Créer `QA-P2` et `QA-P3` de la même façon | Trois fiches : `QA-P2` servira la série E, `QA-P3` restera **sans aucune occurrence** (contrôle du `0` en G-4) |

### 3.1 Détail des variables à créer (M-4)

Chaque ligne = un passage par **« Ajouter une variable »**. Le formulaire demande **Clé
technique**, **Libellé**, **Portée**, **Section**, **Type**, case **Obligatoire**.

| # | Clé technique | Libellé | Portée | Section | Type | Obligatoire |
|---|---|---|---|---|---|---|
| 1 | `p_sexe` | Sexe | **Patient** | **Tronc commun** | Liste de choix (`M`, `F`) | non |
| 2 | `statut_neuro` | Statut neurologique | Rencontre | **Tronc commun** | Liste de choix (`N0`…`N4`, `NX`) | **oui** |
| 3 | `l_niveau` | Niveau | Rencontre | `Lésions vertébrales` | Liste de choix (`C5`, `T3`, `L1`) | **oui** |
| 4 | `l_morphologie` | Morphologie AO | Rencontre | `Lésions vertébrales` | Liste de choix (`A1`, `A3`, `B2`, `C`) | non |
| 5 | `l_facette_f` | Modificateur F | Rencontre | `Lésions vertébrales` | Liste de choix (`F1`, `F2`) | non |
| 6 | `l_m1` | M1 | Rencontre | `Lésions vertébrales` | Oui/Non | non |
| 7 | `i_date` | Date d'intervention | Rencontre | `Interventions` | **Date** | non |
| 8 | `i_geste` | Geste | Rencontre | `Interventions` | Texte | non |
| 9 | `i_indication` | Indication | Rencontre | `Interventions` | Texte | non |
| 10 | `i_voie` | Voie d'abord | Rencontre | `Interventions` | Liste de choix (`antérieure`, `postérieure`) | non |
| 11 | `i_duree` | Durée (min) | Rencontre | `Interventions` | Nombre | non |
| 12 | `i_complication` | Complication | Rencontre | `Interventions` | Oui/Non | non |
| 13 | `o_motif` | Motif de consultation | Rencontre | `Bloc ordinaire` | Texte | non |

> **Pourquoi `o_motif` ne porte aucune restriction de type de rencontre** : c’est la condition des
> tests E-1 et E-5. La règle d’applicabilité a deux branches — une variable de bloc répétable ne doit
> **pas** être réclamée sur une consultation ordinaire, et une variable ordinaire doit continuer de
> l’être. `o_motif` sans restriction éprouve la seconde ; `l_niveau`, obligatoire et sans restriction
> lui aussi, éprouve la première. Laisser le réglage par défaut sur les deux.
>
> **Pourquoi sept variables dans `Interventions`** : la bascule en cartes se déclenche **au-delà de
> six colonnes**, ou sous 768 px de large. Sept variables la rendent observable sur un écran de
> bureau, sans redimensionner la fenêtre (C-7).

---

## 4. Séries de tests — éditeur et socle

### Série A — L67 : déclarer un bloc répétable

À rejouer sur une **version de brouillon non utilisée** (une base `QA-REPET2` neuve si la version
de `QA-REPET` porte déjà des fiches).

| # | Action | Attendu |
|---|---|---|
| A-1 | Lire le libellé secondaire de la case | « À cocher quand l'analyse comptera les occurrences elles-mêmes, et non les patients. » — c'est la règle de décision du §3.3 de la spec, rendue à l'écran |
| A-2 | Cocher la case sur un bloc dont **toutes** les variables sont déjà en portée rencontre | Confirmation « Déclarer « … » répétable ? » portant **« Toutes les variables de ce bloc sont déjà en portée rencontre. »** et la note « Le réglage "types de rencontre concernés" disparaît pour ces variables : ce n'est plus lui qui filtre, mais le bloc. » |
| A-3 | Cocher la case sur un bloc contenant une variable de portée **patient** | La confirmation liste ces variables sous **« Ces variables passeront en portée rencontre »**. Après validation, leur portée est bien rencontre |
| A-4 | Cocher la case sur un bloc **vide** | « Ce bloc ne porte encore aucune variable. » ; la déclaration reste possible |
| A-5 | Dans la confirmation, cliquer **Annuler** | La case **se décoche** : rien n'est écrit, le bloc reste ordinaire |
| A-6 | Sur une version **déjà utilisée**, cocher la case sur un bloc dont une variable porte des données (`Bloc ordinaire` après E-1) | **Refusé.** Deux formes acceptables, à distinguer dans l'observation : la confirmation affiche « Refusé : ces variables portent déjà des données » + « Une ligne déjà saisie décrit le patient ; la rendre répétable lui donnerait un autre sens. Créez une nouvelle version du jeu de variables pour repartir d'un bloc vierge. » et le bouton est **désactivé** ; ou, si aucune variable du bloc n'a été remplie, le serveur refuse par « Version deja utilisee : creez une nouvelle version » |
| A-7 | Base **transversale** (« Une seule saisie par participant ») → même écran | Case **désactivée**, description remplacée par « Réservé aux bases longitudinales et aux registres d'événements. Cette base est transversale : le modèle d'observation s'est verrouillé à sa première fiche et ne se change plus. » |
| A-8 | Tenter d’ajouter une **sous-section** sous un bloc répétable, ou d’y déplacer une sous-section existante | Refusé : « Un groupe répétable n’accepte pas de sous-section ». Le sélecteur de bloc parent **propose** les blocs répétables : le refus vient du serveur, pas de l’interface |
| A-8 bis | Cocher « Groupe répétable » sur un bloc qui **porte déjà une sous-section** | Refusé, même message. La case est offerte et la confirmation s’ouvre sans annoncer cette conséquence : la fermeture est côté serveur |
| A-8 ter | Tenter de rendre **une sous-section** répétable | La case n’est **pas rendue** sur une sous-section. Côté serveur : « Un groupe répétable est un bloc racine », doublé de la contrainte de table `template_section_repeatable_root_only` |
| A-9 | Tenter de déplacer une variable de portée **patient** dans un bloc répétable | Refusé : « Un groupe répétable ne contient que des variables de rencontre » |
| A-10 | Espace **règles** → créer une règle d'affichage de bloc **ciblant** `Lésions vertébrales` | Le bloc **est proposé** dans la liste des cibles, puis le serveur **refuse** : « Regle d'affichage : un groupe repetable ne peut pas etre la cible d'une regle ». Le refus est le résultat attendu ; noter en observation que la cible est offerte avant d'être refusée, et que le message est brut |
| A-11 | Créer la **version suivante** du jeu de variables (recopie) | `is_repeatable` **survit** à la recopie : les deux blocs restent marqués « Répétable » et leurs variables restent rattachées à leur bloc |
| A-12 | Sur une version **déjà utilisée**, **décocher** « Groupe répétable » | Refusé : « Version deja utilisee : creez une nouvelle version » |

### Série B — L66 : gardes serveur

Ces gardes protègent la base contre un client qui n'obéirait pas. **La plupart ne sont pas
atteignables depuis le navigateur** — l'interface ne propose pas le geste. Les vérifier par
lecture de code et par les tests automatisés du §6 est le contrôle attendu ; ne pas consigner
« NON TESTÉ » comme une anomalie.

| # | Garde | Refus attendu | Atteignable au navigateur ? |
|---|---|---|---|
| B-1 | `group_section_key` inconnu de la version | `Groupe inconnu pour cette version` | Non — `test/repeatable-groups.test.ts` |
| B-2 | Bloc désigné non répétable | `Ce bloc n'est pas un groupe répétable` | Non — idem |
| B-3 | Bloc désigné non racine | `Un groupe répétable est un bloc racine` | Non — idem |
| B-4 | 51ᵉ occurrence | `Nombre maximal d'occurrences atteint pour ce groupe` | **Oui, mais** l'interface désactive le bouton d'ajout dès 50 (D-3) : le refus serveur est le filet, pas le parcours |
| B-5 | Variable de portée `patient` dans un bloc répétable | `Un groupe répétable ne contient que des variables de rencontre` | **Oui** — A-9 |
| B-6 | Sous-section sous un bloc répétable, **dans les deux sens** | `Un groupe répétable n’accepte pas de sous-section` | **Oui** — A-8, A-8 bis |
| B-7 | Bascule `is_repeatable` sur version utilisée | `Version deja utilisee : creez une nouvelle version` | **Oui** — A-6, A-12 |
| B-8 | Changement de groupe d'une rencontre existante | `Le groupe d'une rencontre ne se modifie pas` | Non — `update_encounter` ne transporte pas le groupe. Corollaire à vérifier : une occurrence mal classée **se supprime et se ressaisit** |
| B-9 | `encounter_date` nulle **sans** groupe | Contrainte `encounter_date_required_outside_groups` | Non — une vraie rencontre reste datée obligatoirement dans l'interface |
| B-10 | Aucun message ne nomme une valeur clinique | Relire les refus obtenus en A et D | **Oui** — contrôle de lecture, à cocher explicitement |

---

## 5. Séries de tests — saisie, applicabilité et export

### Série C — L68 : saisie dans une fiche existante

Écran : `QA-P1` → **« Modifier les données permanentes »**. Les blocs répétables sont rendus **à leur
place dans le formulaire**, pas sur un écran séparé.

> **Deux chemins de rendu, tous deux à éprouver.** Avec `p_sexe` au tronc commun, le groupe se rend
> **dans** le formulaire, à sa place parmi les blocs. Sur une base **sans aucune variable
> permanente**, l’écran affiche « Aucune variable permanente dans ce jeu de variables. » et rend
> chaque groupe dans son propre encadré titré. Le second cas se vérifie sur une base où `p_sexe`
> n’existe pas ; à défaut, le noter **NON TESTÉ**.

| # | Action | Attendu |
|---|---|---|
| C-1 | Ouvrir l'écran, groupe `Lésions vertébrales` encore vide | En-tête **« 0 occurrence(s) »**, message **« Aucune occurrence saisie. »**, bouton **« Ajouter une occurrence »**. **Jamais un tableau d'en-têtes nu** |
| C-2 | **« Ajouter une occurrence »** → remplir `l_niveau = C5`, `l_morphologie = A3`, `l_facette_f = F2` → **« Enregistrer l'occurrence »** | Le panneau se referme, la ligne apparaît, le compte passe à **« 1 occurrence(s) »**. Le reste du formulaire n'a **pas** été enregistré : une occurrence est une écriture **atomique et isolée** |
| C-3 | Ajouter deux autres lésions (`T3 / B2`, `L1 / A1`) | Trois lignes, dans l'ordre de saisie. Une colonne **Rang**, une colonne par variable, une colonne **Actions** |
| C-4 | Lire les valeurs rendues | Des **libellés d'option**, pas des codes ; jamais `[object Object]` ni une valeur brute |
| C-5 | **Modifier** la deuxième lésion | Le panneau s'ouvre pré-rempli et exige un **« Motif de la correction »**. Sans motif, l'enregistrement est refusé |
| C-6 | Modifier puis **Annuler** avec des saisies en cours | Confirmation : « Les saisies non enregistrées de cette occurrence seront abandonnées. Les autres occurrences sont conservées. » |
| C-7 | Groupe `Interventions` : ajouter deux occurrences dont une avec `i_date` | Rendu **en cartes** (7 colonnes > 6), une carte par occurrence, variables empilées en `libellé : valeur`. Aucun **défilement horizontal du document** : s'il défile, c'est dans le conteneur du bloc |
| C-8 | Réduire la fenêtre sous **768 px** sur `Lésions vertébrales` | Bascule en cartes également. Au-delà de 768 px, retour au tableau |
| C-9 | **Supprimer** la troisième lésion | Dialogue de **motif** ; après confirmation la ligne quitte le tableau et le compte se met à jour |
| C-10 | **Corbeille** de la base → restaurer l'occurrence supprimée | Elle **revient dans son groupe**, à sa place, pas en rencontre ordinaire |
| C-11 | Ouvrir la **fiche patient** `QA-P1` (consultation, pas modification) | Les groupes sont rendus **en lecture** : tableau, compte, **aucune action d'écriture** |
| C-12 | Lecteur d'écran ou inspection des `aria-label` | Les actions portent le **rang** : « Modifier l'occurrence 2 de Lésions vertébrales », « Supprimer l'occurrence 2 de Lésions vertébrales » — jamais un « Modifier » nu répété. Le tableau est un vrai `table` avec en-têtes associés et une légende « Occurrences de Lésions vertébrales » |
| C-13 | Ajouter puis supprimer une occurrence, lecteur d'écran actif | Le compte est **annoncé** : « Occurrence ajoutée. N occurrence(s) dans ce bloc. » puis « Occurrence supprimée. … ». Rien n'est annoncé au simple chargement de la page |

### Série D — L68 : conflit, borne, lecture seule

| # | Action | Attendu |
|---|---|---|
| D-1 | Ouvrir `QA-P1` dans **deux onglets** (ou deux comptes ayant l'édition). Modifier **la même** occurrence dans l'onglet 1, enregistrer, puis enregistrer la même dans l'onglet 2 | **Conflit sur cette ligne seule** : « Cette occurrence a été modifiée entre-temps. Vos saisies sont conservées ; rechargez les occurrences avant de recommencer. » + bouton **« Recharger les occurrences »**. **Rien n'est écrasé**, les saisies locales sont préservées |
| D-2 | Dans le même état, modifier une **autre** occurrence du même groupe | **Aucun conflit** : chaque ligne porte son propre verrou |
| D-3 | Atteindre **50 occurrences** dans un groupe *(voir la note ci-dessous)* | Bouton d'ajout **désactivé** + « Nombre maximal d'occurrences atteint pour ce bloc (50). Supprimez-en une avant d'en ajouter une autre. » — **jamais un refus serveur nu** |
| D-4 | Supprimer une occurrence depuis cet état | Le bouton d'ajout redevient actif |
| D-5 | Ouvrir la fiche avec un compte **sans droit d'écriture** | Tableau et compte rendus ; **aucune action** d'ajout, de modification ou de suppression |
| D-6 | Ouvrir une fiche au statut **`curated`** | Même règle : le groupe se lit, il ne s'écrit pas |

> **D-3 à la main coûte 50 saisies.** Le contrôle le plus économique est de cocher D-3 sur la borne
> d'interface avec un nombre réduit d'occurrences *si l'environnement le permet*, et de s'en
> remettre à `test/repeatable-groups.test.ts` pour la 51ᵉ refusée côté serveur. Consigner laquelle
> des deux voies a été suivie.

### Série E — Applicabilité (§5) et complétude

**C'est la série qui décide si la fonctionnalité est juste.** Les deux branches de la règle sont
nécessaires, et la seconde est celle qu'on oublie.

| # | Action | Attendu |
|---|---|---|
| E-1 | `QA-P1` → **« Ajouter une rencontre »** : remplir `statut_neuro` et `o_motif`, enregistrer en **complet** | **Accepté.** Aucune variable de `Lésions vertébrales` ni d'`Interventions` n'est **rendue** dans ce formulaire, et `l_niveau` — obligatoire, sans restriction de type — n'est **pas réclamé**. ⚠️ Un refus ici est la régression la plus grave possible |
| E-2 | Ajouter une occurrence de `Lésions vertébrales` **sans** remplir `l_niveau` | **Refusé** : « Champ requis manquant : Niveau ». Seules les variables **du groupe** sont exigées |
| E-3 | Même occurrence, `l_niveau` rempli, **sans** `statut_neuro` ni `o_motif` | **Accepté** : une occurrence ne réclame **rien** hors de son groupe, même obligatoire |
| E-4 | Onglet **« À compléter »** de la base | Une occurrence à laquelle il manque une variable requise **de son groupe** y figure ; une occurrence complète n'y figure **jamais**, même si `statut_neuro` est vide ailleurs |
| E-5 | **Analyse → Statistiques → « Complétude par variable »** | Le dénominateur de `l_niveau` ne compte que les **lignes du groupe** `Lésions vertébrales`, pas toutes les rencontres du patient. `o_motif` conserve le dénominateur des rencontres ordinaires |
| E-6 | Cohortes : filtrer sur `l_morphologie = A3` | Sélectionne les patients ayant **au moins une** occurrence correspondante — sémantique inchangée |
| E-7 | Base **sans aucun bloc répétable** (base de démonstration) : parcourir saisie, « À compléter », statistiques, export | Comportement **strictement inchangé**. C'est le contrôle de non-régression du critère 2 de la spec |

### Série F — L69 : création de patient avec occurrences tamponnées

Écran : **« Nouveau patient »**. Les occurrences y sont **tamponnées** puis rejouées dans l'ordre,
juste après la création de la fiche.

| # | Action | Attendu |
|---|---|---|
| F-1 | Ouvrir « Nouveau patient » sur `QA-REPET` | Les blocs répétables sont saisissables. Bandeau **« Occurrences non confirmées »** et son explication : « Les occurrences saisies ici sont conservées puis enregistrées, dans l'ordre, juste après la fiche. » |
| F-2 | Saisir **trois** lésions sans enregistrer la fiche | Trois lignes marquées **« Non enregistrée »**, dans l'ordre de saisie |
| F-3 | Tenter d'enregistrer le patient **avec un panneau d'occurrence encore ouvert** | Refusé, avec : « Conservez ou annulez l'occurrence en cours avant d'enregistrer le patient. » |
| F-4 | Tenter d'ajouter une **deuxième** occurrence alors qu'une est en cours d'édition | Refusé : « Conservez ou annulez cette occurrence avant d'en ajouter, d'en modifier ou d'en supprimer une autre. » |
| F-5 | **« Conserver l'occurrence »**, puis enregistrer le patient | La fiche est créée, **puis** les trois occurrences, **dans l'ordre**. Les lignes passent à **« Enregistrée »** |
| F-6 | Quitter l'écran avec des lignes non confirmées | **Confirmation demandée** : « Les lignes non confirmées restent seulement dans cette page. Une réponse perdue peut signifier qu'une occurrence est déjà écrite ; reprenez-les avant de quitter pour retrouver leur état. » |
| F-7 | **Échec partiel** — couper le réseau (onglet Réseau → hors ligne) juste après l'écriture de la première occurrence, puis enregistrer | « Fiche `QA-Pn` enregistrée. 1 occurrence(s) sur 3 écrite(s) ; les suivantes ne le sont pas. » La fiche **et** la première occurrence existent réellement ; les deux autres sont marquées non enregistrées, avec **« Pas encore tentée : elle part après celle qui la précède. »** |
| F-8 | Rétablir le réseau → **« Reprendre les lignes restantes »** | Les deux lignes s'écrivent. **Aucun doublon, aucune ligne perdue** : la reprise réutilise la même clé (`create_encounter_idempotent`) |
| F-9 | Provoquer une **réponse perdue** (couper pendant l'appel, pas avant) | Ligne marquée **« Confirmation incertaine »** + « La réponse du serveur a pu se perdre après l'écriture. Reprenez la ligne avec la même clé pour retrouver son état sans doublon. » Après reprise, **une seule** occurrence existe |
| F-10 | **« Ouvrir la fiche »** depuis l'écran d'échec partiel, puis compter les occurrences | Le nombre affiché est le **nombre réel** en base — l'écran ne promet rien qu'il n'ait vérifié |
| F-11 | **« Abandonner cette ligne »** sur une ligne non tentée | La ligne disparaît du tampon, les autres restent |

### Série G — L70 : export

Écran : **Analyse → Exporter**. Générer chaque fichier, l'ouvrir, et **lire les colonnes** — c'est
la seule vérification qui prouve quoi que ce soit.

| # | Action | Attendu |
|---|---|---|
| G-1 | Export **« 1 ligne / rencontre »**, tous les blocs, profil *Analyse* | La colonne **`group_section_key`** existe, **en fin** de la méta de rencontre (aucune colonne existante n'a bougé). Elle vaut `lesions_vertebrales` / `interventions` sur les occurrences, et **vide** sur les rencontres ordinaires |
| G-2 | Sur les lignes d'occurrence, lire `encounter_date`, `age_value`, `age_unit` | **Vides.** Jamais `1970-01-01`, jamais une date inventée, jamais un âge calculé. La date d'intervention, elle, est dans `i_date` — une variable comme une autre |
| G-3 | Export **« 1 ligne / patient »** | Les variables des blocs répétables sont **absentes** du fichier — aucune lésion n'est choisie au hasard. À la place, **`nb__lesions_vertebrales`** et **`nb__interventions`**, en **fin** de colonnes |
| G-4 | Lire la ligne de `QA-P3` (aucune occurrence) | Les colonnes de comptage valent **`0`**, pas une case vide : `0` est une observation, le vide serait « on ne sait pas » |
| G-5 | Vérifier les comptes de `QA-P1` | Ils correspondent exactement au nombre d'occurrences non supprimées de chaque bloc |
| G-6 | **« Télécharger le dictionnaire »** | Une ligne par colonne de comptage, libellée « *Lésions vertébrales* — nombre d'occurrences », dont la description **énonce la règle** : `0` signifie aucune occurrence, les variables du bloc ne figurent pas dans ce fichier parce qu'elles ne s'agrègent pas, et une ligne par occurrence les restitue toutes, distinguées par `group_section_key` |
| G-7 | **« Blocs à exporter » → « Choisir des blocs »**, ne cocher que `Lésions vertébrales`, en « 1 ligne / occurrence » | Le fichier ne porte que les colonnes de ce bloc, plus le tronc commun et la méta. **Aucune fuite d'identité** |
| G-8 | Même projection en « 1 ligne / patient » | Seule **`nb__lesions_vertebrales`** subsiste pour les blocs répétables ; `nb__interventions` disparaît avec son bloc |
| G-9 | Export d'une base **sans bloc répétable** | Structure **identique** à celle d'avant L70 : aucune colonne de comptage, `group_section_key` présente et systématiquement vide |
| G-10 | Profil **« Complet — structure actuelle »** sur les mêmes exports | Mêmes règles de groupe ; le profil ne change pas le sort des occurrences |

### Série H — L71 : hors-ligne

L71 ouvre la **lecture** et la **correction** d’une occurrence depuis la copie locale, et son rejeu au
retour du réseau. Il n’ouvre **pas** la saisie d’une occurrence nouvelle : cette série éprouve donc
autant ce que le hors-ligne autorise que ce qu’il continue de refuser.

> **Prérequis.** Télécharger la copie hors-ligne de `QA-REPET` **après** L71 : c’est elle qui porte le
> marqueur de groupe par rencontre. Une copie plus ancienne est le **cas dégradé** de H-6, qui n’est
> reproductible que si l’on dispose d’un instantané antérieur au lot.

| # | Action | Attendu |
|---|---|---|
| H-1 | Hors ligne, `QA-P1` → **« Modifier les données permanentes »** | Le groupe se **lit** (tableau, compte) mais **ne s’écrit pas** : bandeau ambre « Les blocs répétables ne sont pas disponibles hors ligne : une occurrence saisie ici ne pourrait pas être synchronisée. Reconnectez-vous pour la saisir. » Ni ajout, ni modification, ni suppression depuis ce tableau |
| H-2 | Hors ligne, ouvrir la **fiche** `QA-P1` depuis la copie locale | Les valeurs des occurrences **sont rendues**, chaque groupe avec son compte. **Aucun** bandeau ambre sur un instantané récent : c’est le gain de L71 |
| H-3 | Hors ligne, ouvrir **une occurrence** depuis la fiche et la corriger | **Autorisé et mis en file** : « Hors-ligne : votre correction sera mise en file d’attente et synchronisée au retour du réseau. » Le formulaire ne rend que les variables **de son groupe**, son bloc présenté comme une section ordinaire |
| H-4 | Hors ligne, ouvrir une **rencontre ordinaire** de `QA-P1` | Seules les variables **d’aucun groupe** sont rendues ; celles des blocs répétables sont absentes. La règle d’applicabilité (§5) tient aussi hors ligne, dans les deux sens |
| H-5 | **Centre de synchronisation**, puis retour en ligne | L’entrée de correction affiche ses données, propose **« Retenter »** et **« Copier les données »**, et se synchronise. Rouvrir l’occurrence : la correction est appliquée **une seule fois** |
| H-6 | *(cas dégradé)* Même parcours sur une copie hors-ligne **antérieure au marqueur de groupe** | La fiche masque les valeurs concernées : « Le cache ne permet pas de vérifier le groupe de cette rencontre. Reconnectez-vous et actualisez la copie hors-ligne pour consulter ses valeurs. » La correction est refusée : « Cette copie hors-ligne ne précise pas à quel groupe cette rencontre appartient. Reconnectez-vous pour la modifier en ligne, ou actualisez la copie hors-ligne avant de la corriger. » Dans le centre de synchronisation, une telle entrée **cache ses données** et n’offre ni « Retenter » ni « Copier » : « Cette correction vient d’une copie hors-ligne sans marqueur de groupe fiable. Elle n’a pas été synchronisée; reconnectez-vous pour la modifier en ligne. » Sans instantané ancien sous la main, marquer **NON TESTÉ** |
| H-7 | Hors ligne, **« Nouveau patient »** avec un bloc répétable | Le groupe est **inactif**, même bandeau ambre que H-1 : une occurrence tamponnée hors réseau resterait irrécupérable. La création de patient hors ligne elle-même reste ce qu’elle était |
| H-8 | Retour en ligne, recharger, recompter les occurrences de `QA-P1` | Le compte est celui d’avant la coupure, **plus** les corrections rejouées. **Aucune ligne fantôme** créée hors ligne, aucun doublon |

---

## 6. Contrôles automatisés à rejouer

À lancer sur le poste de développement, **jamais contre la production**. Vérifier la cible locale
avant tout test qui écrit des données.

```bash
npm run typecheck && npm run lint
```

```bash
npx vitest run --project web src/screens/member/RepeatableGroup.test.tsx src/screens/member/PatientRepeatableGroups.test.tsx src/screens/member/NewPatientRepeatableGroups.test.tsx src/data/patients.repeatable.test.tsx src/screens/staff/SectionsEditor.test.tsx src/screens/staff/EditorStructure.test.tsx src/screens/staff/FormPreview.test.tsx
```

```bash
npx vitest run --project db test/repeatable-groups.test.ts test/repeatable-groups-regression.test.ts test/repeatable-groups-export.test.ts test/repeatable-groups-offline.test.ts
```

```bash
npm run edge:test
```

```bash
npm run db:verify && npm run schema:check
```

> Sur le projet `db`, lire la ligne **`Tests N passed`** : le teardown du harnais échoue de façon
> systématique sur ce poste et n'indique rien.
>
> **Piège de poste connu.** Sur une machine à faible mémoire, le harnais laisse des PostgreSQL
> embarqués derrière lui : `out of memory`, `ECONNRESET` et « Failed to start forks worker »
> viennent de là, **pas** d'une régression. Tuer les processus orphelins, puis rejouer le fichier
> isolément avant de conclure.

Un build de production exige `VITE_USE_SIGNED_READ=true` ; ne pas contourner ce garde-fou.

---

## 7. Limites connues (à ne pas consigner comme anomalies)

- **Les refus serveur s'affichent bruts**, en français non typographié (`Version deja utilisee : …`,
  `Regle d'affichage : …`) : ils ne passent par aucun catalogue de traduction. Observation
  d'ergonomie, pas échec fonctionnel.
- **L’interface propose des gestes que le serveur refuse ensuite**, faute de filtrage côté écran :
  un bloc répétable est offert comme cible de règle d’affichage (A-10) et comme **bloc parent** d’une
  sous-section (A-8), et la case « Groupe répétable » reste cochable sur un bloc qui porte déjà une
  sous-section (A-8 bis). Le refus est juste, l’ergonomie est perfectible.
- **Un bloc répétable est plat.** Ses variables sont directement ses colonnes ; regrouper des
  variables *à l’intérieur* d’une occurrence n’est pas exprimable en v1. Les blocs **non**
  répétables conservent leurs sous-sections et cohabitent sans gêne avec les groupes.
- **`is_repeatable` se fige à la première fiche de la version.** Il n'y a pas de correction en
  place : la voie est une nouvelle version du jeu de variables.
- **Le groupe d'une occurrence ne se modifie jamais.** Une occurrence mal classée se supprime et se
  ressaisit — même règle que la clé technique d'une variable déjà utilisée.
- **Le choix `longitudinal` / `event_registry` est irréversible** après la première fiche. C'est la
  seule décision définitive de toute la fonctionnalité.
- **Hors ligne, un bloc répétable se lit et se corrige, mais ne se saisit pas.** Ajouter une
  occurrence exige le réseau, à la création de patient comme dans une fiche existante ; une
  correction passe par l’occurrence elle-même, pas par le tableau du groupe. Une copie locale
  antérieure au marqueur de groupe masque les valeurs plutôt que de les exposer sans portée
  prouvée (série H).
- **Aucun `required` au niveau du groupe** : « au moins une occurrence » n'est pas exprimable, et
  zéro occurrence est un état normal.
- **Aucun réordonnancement** : l'ordre est celui de la saisie.

---

## 8. Feuille de relevé

| Série | Étapes | OK | KO | BLOQUÉ | NON TESTÉ | Observations |
|---|---|---|---|---|---|---|
| P — contrôles d’entrée | 4 | | | | | |
| M — montage | 12 | | | | | |
| A — L67 éditeur | 14 | | | | | |
| B — L66 gardes | 10 | | | | | |
| C — L68 saisie | 13 | | | | | |
| D — L68 conflit et borne | 6 | | | | | |
| E — applicabilité et complétude | 7 | | | | | |
| F — L69 occurrences tamponnées | 11 | | | | | |
| G — L70 export | 10 | | | | | |
| H — L71 hors-ligne | 8 | | | | | |

**Environnement testé** : ……… · **Commit** : ……… · **Date** : ……… · **Opérateur** : ………

### Les neuf critères d'acceptation, à cocher explicitement

Une campagne n'est probante que si les critères du §15 de
[spec-groupes-repetables.md](spec-groupes-repetables.md) sont couverts :

| # | Critère | Prouvé par |
|---|---|---|
| 1 | Six blocs répétables ou plus sans toucher à `encounter_type` ; chaque occurrence n'attend que les variables de son groupe | A-2, E-2, E-3 |
| 2 | Version sans bloc répétable : résultats identiques avant et après migration | E-7, G-9 |
| 3 | Une variable de bloc répétable n'est **jamais** réclamée sur une rencontre ordinaire | **E-1** |
| 4 | `is_repeatable` survit à la recopie de version | A-11 |
| 5 | Aucune occurrence perdue ni dupliquée sur une création partiellement échouée ; l'écran affiche l'état réel | F-7 à F-10 |
| 6 | Un conflit porte sur une ligne et n'en bloque aucune autre | D-1, D-2 |
| 7 | L'export une ligne par patient ne choisit jamais une occurrence au hasard | G-3, G-6 |
| 8 | Aucun message d'erreur ne nomme une valeur clinique | B-10 |
| 9 | Aucune migration déjà appliquée modifiée, aucune donnée clinique réécrite | P-4, revue de `supabase/migrations/` |

En cas de KO, consigner le constat dans
[suivi-execution-feuille-route.md](suivi-execution-feuille-route.md) **sans corriger dans la
foulée** : la correction est un lot, pas une retouche de campagne.
