# Spécification — blocs réutilisables entre jeux de variables

- Statut : **L58 et L59 implémentés localement, non déployés** (L58 le 2026-09-08, L59 le
  2026-09-09) ; **L60 spécifié, non implémenté**.
- Origine : question du porteur du 2026-09-07 — réduire le temps de réglage d'un jeu de
  variables, une fois les lots L51 à L56 en place
- Prolonge [spec-blocs-pathologies.md](spec-blocs-pathologies.md) (un bloc **est** une section
  racine) et [spec-collecte-diagnostique.md](spec-collecte-diagnostique.md) (pilote diagnostique).
  Ne les révise pas : aucune sémantique de bloc, de visibilité ou d'export n'est modifiée ici
- Surface serveur : deux colonnes de provenance sur `template_section`, une fonction de
  prévisualisation, une RPC d'import, une fonction de catalogue en lecture seule (L59), les
  gardes existantes de section / champ / règle
- Surface web : `src/data/templates.ts`, `src/screens/staff/SectionsEditor.tsx`,
  `src/screens/staff/TemplateVersionEditor.tsx`, `src/domain/templateSections.ts`,
  `src/screens/staff/RuleForm.tsx` (L60 seul), `src/i18n/`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

## 1. Besoin

Un médecin qui règle une deuxième base a besoin des mêmes blocs cliniques que la première.
Aujourd'hui il n'a que deux voies : recopier un gabarit entier puis élaguer, ou ressaisir les
variables une à une. À la cible dimensionnante de la spécification des blocs — **12 blocs
d'environ 20 variables** — ressaisir un seul bloc coûte vingt formulaires de création de
variable, leurs listes de valeurs et leurs règles internes.

### 1.1 Ce qui manque exactement

La plus petite unité réutilisable du produit est **le gabarit entier**. Tout ce qui est
réutilisable est soit plus gros que le besoin (modèle de départ, modèle global, import d'un
tableur), soit plus petit et sans structure (jeu de valeurs de `valueSetLibrary`). Entre les
deux, il n'existe aucun objet — alors que l'objet existe déjà dans le formulaire : c'est le
**bloc**, introduit par L54 comme une `template_section` sans parent.

Le verbe manquant tient en une phrase : **insérer un bloc lisible dans une version en cours
d'édition**, avec ses sous-sections, ses variables et ses règles internes.

### 1.2 Ce que ce chantier ne cherche pas à réduire

Il ne réduit pas le temps de la **première** configuration, qui est du travail de conception
clinique et non de saisie. Il ne réduit pas non plus le temps de réglage du pilote diagnostique
de L55, sauf par la reconnexion décrite en L60.

## 2. Ce qui existe déjà et n'est pas à refaire

Constats de lecture de code au 2026-09-07, non confirmés par exécution.

- Un bloc **est** une `template_section` sans parent ; une sous-section en a un ; le tronc commun
  est l'absence de section (L54, `20260905143319_template_section_hierarchy.sql`).
- `section_key` est unique par version, tous niveaux confondus, et **ne se modifie jamais**
  après création (`guard_template_section_write`).
- `copy_template_fields` est **le point de copie unique** des six voies de recopie de version.
  Sa dernière définition (`20260906061539_diagnosis_configuration.sql`) copie les sections en
  deux passes, les variables avec toutes leurs colonnes, et la configuration diagnostique.
  L'import d'un bloc est une variante restreinte de cette fonction, pas une mécanique neuve.
- Un médecin peut déjà créer un gabarit personnel **non rattaché à une base**
  (`createPersonalTemplate`, `src/data/templates.ts:246`) et en éditer les sections et les
  variables tant que la version est `draft`. Le classeur de blocs existe donc déjà comme objet.
- `can_read_template` donne la lecture d'un gabarit global, de ses propres gabarits et du
  gabarit d'une base partagée. Aucun partage nouveau n'est nécessaire pour lire une source.
- `guard_validation_rule_inuse` **interdit toute écriture de règle** — insertion comprise — sur
  une version portant déjà un patient ou une rencontre.
- `guard_template_field_update` ne verrouille que les modifications ; **ajouter** une variable à
  une version `draft` déjà utilisée reste permis.
- `template_version_locked` refuse toute écriture sur une version `published` ou `archived`.
- `assert_visibility_acyclic` contrôle l'acyclicité des règles de visibilité d'une version.
- Un bloc **sans règle** est visible sans condition : la règle ajoute une condition, elle ne
  crée pas la visibilité (L52).
- Le serveur refuse déjà `required` sur un champ masqué, et refuse à la finalisation une fiche
  portant la valeur d'un champ masqué.

## 3. Décisions retenues

| # | Décision | Raison |
|---|---|---|
| **D1** | **Un bloc n'est pas un objet nouveau.** Le catalogue est l'ensemble des versions de gabarit déjà lisibles ; un gabarit personnel sans base tient lieu de classeur | Des tables `block` / `block_field` dupliqueraient toutes les colonnes de `template_field`, qui en a gagné six en trois mois. Chaque évolution future se paierait deux fois, et la seconde copie divergerait en silence |
| **D2** | **Insertion par copie, jamais par référence** | Invariant déjà posé pour les jeux de valeurs, et plus fort ici : une référence vivante changerait rétroactivement le sens de données déjà saisies. Prix assumé : les corrections d'un bloc ne remontent pas dans les bases existantes |
| **D3** | **La provenance est enregistrée, pas exploitée** | Deux colonnes sur la section copiée. Elles ne servent à rien en v1 et sont la seule chose irrécupérable après coup si une reprise de bloc est un jour spécifiée |
| **D4** | **Publication personnelle seulement** (choix du porteur, 2026-09-07). Aucun catalogue partagé, aucune promotion, aucun rôle nouveau | La source reste tout gabarit **déjà** lisible — modèle global compris. C'est une lecture existante, pas un partage nouveau |
| **D5** | **Collision de clé : refus typé, jamais de renommage automatique** | `sexe_2` détruit la comparabilité entre bases, qui est la raison d'être du produit |
| **D6** | **Version cible déjà utilisée : refus.** La voie est la version suivante, déjà offerte par l'éditeur | `guard_validation_rule_inuse` interdit d'y écrire une règle. Un bloc importé sans ses règles serait un demi-bloc silencieux — exactement le défaut discret que la centralisation de la recopie avait été faite pour empêcher |
| **D7** | **La règle d'activation du bloc n'est pas copiée par défaut** | Son `if` nomme un pilote du tronc commun de la **source**, qui n'existe pas forcément dans la cible. L60 la propose explicitement, après contrôle de compatibilité |
| **D8** | **Une formule dont un opérande est absent du bloc et de la cible fait refuser l'import** | Une formule muette est pire qu'un refus : elle produit des colonnes vides que personne ne relie à l'import |
| **D9** | **`required` est importé tel quel**, avec avertissement | L'alternative — importer en `required = false` — perdrait en silence une exigence de qualité. Comme D6 borne l'import à une version sans donnée, la conséquence est visible immédiatement et corrigible dans l'éditeur |

> **Deux arbitrages tranchés ici faute de réponse du porteur, et réversibles.** D6, au lieu de
> créer la version suivante à la volée dans la RPC : l'effet de bord caché d'une RPC d'import
> serait un changement de version du jeu de variables, ce qui n'est pas une décision d'import.
> Et, au §4.4, le traitement d'une variable en conflit appartenant à un autre bloc : refus avec
> consigne de la remonter d'abord au tronc commun, plutôt que remontée automatique — la remontée
> exige une règle `contains_any` compensatoire que D6 interdit d'écrire ailleurs que sur une
> version vierge.

## 4. L58 — Import serveur d'un bloc

### 4.1 Contrat

Deux fonctions. La prévisualisation est en lecture seule ; l'import **revalide tout** et ne
fait jamais confiance au rapport de prévisualisation.

```sql
public.preview_template_section_import(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'
) returns jsonb   -- stable, sans écriture

public.import_template_section(
  p_source_version_id  uuid,
  p_source_section_key text,
  p_target_version_id  uuid,
  p_reuse_field_keys   text[] default '{}'
) returns jsonb
```

Rapport renvoyé par les deux, même forme :

```json
{ "sectionKey": "tuberculose",
  "subsections": ["clinique", "biologie"],
  "importedFields": ["bk_crachats", "duree_traitement"],
  "reusedFields": ["poids"],
  "copiedRules": 3,
  "activationRule": { "field": "diagnostic", "operator": "contains_any",
                      "value": ["A15.0"], "terminologyReleaseId": "..." },
  "conflicts": [] }
```

`activationRule` décrit la règle **non copiée** (D7) : c'est la matière de L60. `conflicts` est
vide quand l'import passerait ; sinon la prévisualisation le remplit et l'import échoue.

### 4.2 Ce que l'import copie

Dans une seule transaction, en réutilisant la liste de colonnes de `copy_template_fields` — et
**pas** une seconde liste, sous peine de reproduire le défaut que la centralisation de L28 a
corrigé :

1. la section racine, avec `display_order` en fin de version, puis renumérotation par
   `normalize_template_section_order` ;
2. ses sous-sections, résolues en **deux passes** comme dans `copy_template_fields` ;
3. les variables attachées au bloc ou à l'une de ses sous-sections, avec leurs options, unités,
   bornes, raisons de valeur manquante, valeur proposée, description, formule et release
   terminologique ;
4. les règles de `validation_rule` dont **toutes** les clés citées — `if.field`, `then.field`,
   `then.section` — appartiennent au bloc importé.

`assert_visibility_acyclic` est rejouée sur la version cible avant le commit.

### 4.3 Ce qu'il ne copie jamais

- La règle d'activation du bloc (D7), ni aucune règle citant une clé extérieure au bloc.
- `diagnosis_configuration` de la version cible, qui n'est pas une propriété de bloc.
- Le miroir texte `template_field.section` en écriture directe : il est posé par le trigger de
  synchronisation existant, comme partout ailleurs.

### 4.4 Refus typés

Chaque refus porte un code stable, à traduire côté web comme les codes de L55.

| Code | Cas |
|---|---|
| `IMPORT_SOURCE_FORBIDDEN` | la version source n'est pas lisible (`can_read_template`) |
| `IMPORT_TARGET_FORBIDDEN` | la version cible n'appartient pas à l'appelant (`owns_template`) |
| `IMPORT_SOURCE_NOT_A_BLOCK` | `p_source_section_key` désigne une sous-section, pas un bloc |
| `IMPORT_TARGET_LOCKED` | version cible `published` ou `archived` |
| `IMPORT_TARGET_IN_USE` | version cible portant déjà un patient ou une rencontre (D6) |
| `IMPORT_SECTION_EXISTS` | `section_key` déjà pris dans la cible, à quelque niveau que ce soit |
| `IMPORT_FIELD_CONFLICT` | une clé de variable est déjà prise et n'est pas dans `p_reuse_field_keys` |
| `IMPORT_REUSE_INCOMPATIBLE` | variable réutilisée de `type`, `is_multiple` ou `scope` différents |
| `IMPORT_REUSE_IN_BLOCK` | la variable réutilisée vit dans un **autre bloc** de la cible |
| `IMPORT_FORMULA_OPERAND_MISSING` | une formule cite un opérande absent du bloc et de la cible |
| `IMPORT_FORMULA_OPERAND_INCOMPATIBLE` | un opérande présent dans la cible a une portée incompatible, est calculé, ou change la nature nombre/date de la formule |
| `IMPORT_VISIBILITY_CYCLE` | l'ensemble des règles de visibilité existantes et importées forme un cycle, y compris à travers une règle de bloc |

`IMPORT_REUSE_IN_BLOCK` est le refus le plus important à ne pas contourner : réutiliser une
variable enfermée dans un autre bloc rendrait le bloc importé troué dès que cet autre bloc est
masqué. Le §1.1 de [spec-blocs-pathologies.md](spec-blocs-pathologies.md) donne la seule
résolution correcte — remonter la variable au tronc commun et lui donner une règle de champ
`contains_any` — et c'est une action explicite de l'éditeur, pas un effet de l'import.

### 4.5 Provenance

Deux colonnes additives sur `template_section`, nulles pour tout l'existant :

- `source_template_version_id uuid references template_version(id) on delete set null`
- `source_section_key text`

Elles sont posées à l'import, recopiées telles quelles par `copy_template_fields` — une version
suivante conserve la provenance de son bloc — et ne sont lues par personne en v1.

### 4.6 Concurrence et immuabilité

L'import précontrôle les droits, puis verrouille les versions source et cible par ordre
d'identifiant et revalide les droits. Il utilise ensuite le verrou déjà employé par les
commandes de section (`lock_template_section_version`). Les triggers d'invariants prennent
aussi ce verrou avant de valider les modifications de champs et règles : leurs changements
ne peuvent être commités entre le rapport et la copie. Deux imports concurrents du même bloc ne peuvent réussir tous deux,
et les imports croisés prennent les verrous de version dans le même ordre. Il ne modifie
aucune migration appliquée, ne réécrit aucune donnée clinique, et n'a aucun effet observable
tant que l'interface ne l'appelle pas.

## 5. L59 — Choisir un bloc dans l'éditeur

Une commande « Importer un bloc » à côté de « Ajouter une section », dans
`TemplateVersionEditor` — donc disponible aussi bien au médecin sur le gabarit de sa base
(`BaseTemplateEditor`) qu'à l'administrateur.

**Liste des blocs importables.** Une fonction de lecture `stable security invoker` renvoyant, par
version lisible, ses blocs racines avec le nombre de variables portées, bloc et sous-sections
comprises. La RLS filtre naturellement ; aucune permission nouvelle n'est introduite. Ne pas
charger toutes les versions côté client pour les recouper : ce serait N+1 sur un catalogue qui
grandit avec l'usage.

**Aperçu avant écriture.** Le panneau montre les variables du bloc, le nombre de règles internes,
la règle d'activation non copiée, et le rapport de conflits issu de
`preview_template_section_import`.

**Résolution des conflits.** Pour chaque clé en conflit, une seule proposition : réutiliser la
variable déjà présente — offerte **uniquement** si le serveur l'a jugée compatible et située dans
le tronc commun. Sinon, l'écran énonce la clé, où vit la variable, et la raison du refus. Aucun
renommage, aucune fusion partielle, aucune écriture avant confirmation.

**Avertissement obligatoire (D9).** Si le bloc importé porte des variables `required` et qu'aucune
règle ne l'active, l'écran annonce, avant confirmation, que ces variables deviendront obligatoires
**pour tous les patients** tant que le bloc n'est pas conditionné. C'est le prix de D7 et il doit
être dit, pas découvert au premier formulaire.

**Après succès.** Le bloc apparaît en fin de version, un compte rendu reprend le rapport, et le
passage à l'activation (L60) est proposé immédiatement.

## 6. L60 — Reconnexion de l'activation

À la suite d'un import dont le rapport porte une `activationRule`, proposer de recréer la règle
sur la version cible.

**Contrôles de compatibilité**, tous exigés avant de proposer quoi que ce soit : la cible possède
une variable de même `field_key`, même `scope`, même `type` et même `is_multiple` ; cette variable
est dans le tronc commun et n'est pas elle-même masquée ; pour un pilote `terminology`, la
`terminologyReleaseId` de la règle est identique à celle du pilote de la cible ; chaque code cité
existe dans la release ou dans les options de la variable.

Si tout est réuni, la règle est créée par le chemin de règles existant, avec ses contrôles de
forme, d'acyclicité et d'ordre visibilité-puis-obligation — aucun chemin d'écriture parallèle.
Sinon, l'écran nomme la condition qui manque et propose la seule alternative honnête : choisir un
autre pilote dans le constructeur de règles.

Un refus laisse le bloc **visible sans condition**, ce qui est l'état sûr : rien n'est masqué,
rien n'est effacé, et l'avertissement de L59 reste affiché tant qu'aucune règle ne porte le bloc.

## 7. Ordre, dépendances et collisions

```text
L58 ──→ L59 ──→ L60
```

| Lot | Dépend de | Peut tourner avec |
|---|---|---|
| **L58** | L54 et L52, fusionnés | tout lot n'ouvrant ni la recopie ni les gardes de section |
| **L59** | **L58** | — |
| **L60** | **L59** | — |

La file est strictement séquentielle : L59 appelle la RPC de L58, L60 part du rapport rendu par
L59. Il n'y a rien à paralléliser, et le découpage ne vaut que pour borner chaque session.

- **L58 ouvre `copy_template_fields` et les gardes de section**, territoire de L54. Personne
  d'autre ne les touche aujourd'hui, mais ne jamais le lancer en même temps qu'un lot qui
  redéfinit la primitive de recopie.
- **L59 touche `TemplateVersionEditor.tsx`, qui porte un `eslint-disable` de
  `react-hooks/exhaustive-deps`** : c'est l'un des fichiers de **L41**. Ne pas lancer les deux
  ensemble.
- **L60 écrit dans le moteur de règles** (`templateRules.ts`, `RuleForm.tsx`) : jamais en même
  temps qu'un lot du même moteur.

Déploiement : migration additive et **dormante** d'abord — aucune interface ne l'appelle —, puis
le client. Le frontend ne doit jamais dépendre d'une RPC absente.

## 8. Hors périmètre

- Toute table `block`, `block_version`, `block_field` (D1).
- Toute référence vivante et toute propagation d'une correction de bloc vers les bases qui l'ont
  importé (D2). La provenance de D3 est posée pour rendre ce chantier possible plus tard, pas
  pour l'ouvrir.
- Catalogue partagé, promotion d'un bloc en modèle global, rôle ou permission nouvelle (D4).
- Import dans une version portant des données, et création automatique de la version suivante
  (D6).
- Import de plusieurs blocs en une opération : rien ne l'interdit à terme, rien ne le justifie
  tant qu'un import unitaire n'a pas été éprouvé.
- Fusion de deux blocs, import partiel d'un bloc, choix variable par variable à l'import.
- Rattachement plusieurs-à-plusieurs d'une variable à plusieurs blocs, toujours différé par
  [spec-blocs-pathologies.md](spec-blocs-pathologies.md).
- Toute modification de la sémantique de visibilité, d'effacement, de couverture ou d'export.

## 9. Plan de tests

### 9.1 PostgreSQL et RLS

**L58**

1. Import nominal : bloc à deux sous-sections et douze variables, dont une `multiselect` à codes
   d'option, une `terminology`, une à formule interne et une à raisons de valeur manquante —
   toutes les colonnes retrouvées à l'identique dans la cible.
2. Deux passes de parenté : aucune sous-section importée ne pointe vers une section de la version
   source.
3. Règles : une règle interne au bloc est copiée ; une règle citant une clé extérieure ne l'est
   pas ; la règle d'activation ne l'est jamais ; l'acyclicité est revérifiée.
4. Chacun des douze refus du §4.4, un test par code.
5. Réutilisation : clé compatible dans le tronc commun acceptée ; type différent refusé ; scope
   différent refusé ; variable située dans un autre bloc refusée.
6. Version cible `published`, `archived`, et `draft` portant un patient : trois refus distincts.
7. Prévisualisation et import donnent le même rapport sur la même entrée ; la prévisualisation
   n'écrit rien (comparaison des compteurs de lignes avant et après).
8. Deux imports concurrents du même bloc dans la même version : un seul réussit.
9. Provenance posée, puis conservée par les six voies de recopie de version.
10. Échec en cours d'import : aucune section, variable ni règle partielle ne subsiste.
11. RLS : source lisible via base partagée acceptée ; version d'un autre médecin refusée à la
    cible même en lecture autorisée.

### 9.2 Domaine et frontend

**L59** — liste des blocs importables non vide et filtrée par lisibilité ; aperçu fidèle ;
rapport de conflits rendu clé par clé ; réutilisation proposée seulement quand le serveur l'a
jugée compatible ; avertissement `required` affiché quand et seulement quand il s'applique ;
aucune écriture avant confirmation ; message d'erreur pour chacun des douze codes ; état de
chargement et double clic sans double import.

**L60** — proposition affichée seulement si toutes les compatibilités sont réunies ; release
terminologique différente refusée avec le motif exact ; code absent de la release refusé ;
création de la règle par le chemin existant ; refus laissant le bloc visible sans condition et
l'avertissement en place.

### 9.3 Commandes

Contrôles ciblés SQL et web d'abord, puis `npm run typecheck`, `npm run lint`, les tests base et
web des surfaces touchées. Après la migration de L58 : `npm run schema`, inspection du snapshot,
puis `npm run schema:check`. Aucun test écrivant des données contre autre chose qu'une cible
locale ou jetable.

## 10. Critères d'acceptation

- Un bloc de vingt variables est inséré dans une version vierge en une opération, avec ses
  sous-sections, ses options, ses formules internes et ses règles internes, sans ressaisie.
- Aucune donnée clinique n'est réécrite, aucune base existante ne change d'apparence tant que
  l'import n'est pas appelé.
- Chaque refus du §4.4 est atteignable par un test et porte un message compréhensible.
- Aucune clé de variable n'est renommée automatiquement, jamais.
- Un import dans une version portant des données est refusé, et l'utilisateur est renvoyé vers la
  création de la version suivante, qui existe déjà.
- La provenance est présente sur toute section importée et survit à une nouvelle version.
- Un bloc importé sans activation est visible sans condition, et l'utilisateur en a été averti
  avant l'écriture.
- `docs/schema-etat-final.md` est régénéré et `npm run schema:check` passe.

## 11. État de l'implémentation L58 — 2026-09-08

La migration locale `20260908090000_reusable_block_import.sql` ajoute les deux RPC,
les colonnes de provenance et la primitive partagée de copie des champs. Les fonctions
internes ne sont pas exécutables par les rôles clients ; les deux entrées vérifient les
droits source/cible. L59 et L60 ne sont pas implémentés et aucune interface n'appelle
encore l'import.

Contrôles exécutés sur PostgreSQL embarqué jetable, avec données fictives :

- Passe finale import, formules et ACL : **63 tests réussis**
  (`test/template-section-import.test.ts`, `test/template-formula.test.ts`,
  `test/security-definer-acl.test.ts`). Elle comprend le refus d'une clé de réutilisation
  `NULL`, la protection de la source pendant l'import, les imports croisés, l'absence de
  verrou de ligne en ordre inverse de l'éditeur, le refus typé d'un opérande incompatible,
  l'annulation après erreur injectée et le refus d'effacer manuellement la provenance
  d'une version publiée.
- Régressions sections, hiérarchie, administration des gabarits et configuration
  diagnostique, avec les tests d'import : **122 tests réussis** avant le dernier
  renforcement des verrous source et du contrôle des clés `NULL` ; les tests d'import
  ont été rejoués dans la passe finale ci-dessus.
- `npm run typecheck`, `npm run lint`, `npm run schema`, inspection du snapshot,
  `npm run schema:check` et `git diff --check` : réussis.

Validation locale uniquement : aucune migration distante appliquée ni aucun déploiement.
Le rafraîchissement GitHub, initialement bloqué par le réseau, a réussi le 2026-09-09
avant préparation de la PR. Le contenu de `origin/develop` est identique à celui de la
révision utilisée pour ces contrôles ; seuls deux commits de fusion les séparent.

### Correction de revue — 2026-09-09

La migration additive `20260909025040_reusable_block_preview_guards.sql` complète
la prévisualisation par le contrôle du graphe de visibilité proposé : règles cibles et
règles importées sont examinées ensemble, avec expansion des cibles de bloc. Un cycle
produit `IMPORT_VISIBILITY_CYCLE` dans l'aperçu et le même refus typé à l'import, avant
toute écriture. Les gardes d'invariants à l'écriture restent actives.

L'exception d'immuabilité pour la suppression d'une source exige maintenant l'égalité
de toutes les autres colonnes, `created_at` compris. Les tests vérifient le refus d'un
changement simultané de timestamp, la conservation de la provenance après ce refus et
le succès d'un effacement de provenance légitime.

Validation de cette correction, avec Vitest `4.1.11` :

- **64 tests réussis** : import, formules et ACL, dont les deux variantes de cycle et
  le refus d'une modification simultanée de `created_at`.
- Installation propre par `npm ci` et audit strict des dépendances réussis. La mise à
  jour de Vitest `4.1.10` vers `4.1.11` corrige l'avis `GHSA-82fw-gwwq-j7x9`, qui bloquait
  la CI ; aucune exception d'audit n'est ajoutée.
- Schéma régénéré et inspecté, `schema:check`, typecheck et `git diff --check` réussis.
- Lint global réussi, sans avertissement.

## 12. État de l'implémentation L59 — 2026-09-09

La migration locale `20260909170000_importable_block_catalog.sql` ajoute **une seule**
fonction, `list_importable_template_sections()` — `stable security invoker`, révoquée de
`anon`, accordée à `authenticated`. Elle rend, pour chaque version lisible, ses blocs
racines avec le nombre de sous-sections et le nombre de variables portées. Aucune table,
aucune donnée, aucune garde et aucune des deux RPC de L58 n'est touchée.

Deux points ne relèvent pas du détail :

- **`template` n'est pas joint en `inner join`.** Sa policy `template_read`
  (`is_global or owner or admin`) est strictement plus étroite que `can_read_template`, qui
  couvre en plus le gabarit d'une base partagée et le staff de curation. Un `inner join`
  aurait donc amputé le catalogue de sources que l'import accepte. Le nom du gabarit est un
  confort d'affichage : il arrive quand la RLS le laisse passer, il est nul sinon, et
  l'écran retombe sur le numéro de version. Un test le vérifie dans les deux sens.
- **Le compte de variables réutilise `template_section_field_keys`**, la primitive
  d'appartenance de l'import, et non un second comptage. Un compte établi autrement finirait
  par diverger de ce que l'import copie, et l'écart se lirait sur l'aperçu.

Côté web : trois méthodes de dépôt (`listImportableSections`, `previewSectionImport`,
`importSection`, cette dernière vidant le cache de version comme toute autre écriture de
gabarit), un module de domaine pur `templateSectionImport.ts`, le panneau
`SectionImportDialog.tsx`, la commande « Importer un bloc » à côté de « Ajouter une
section » dans `SectionsEditor`, et 49 clés de message en français et en anglais dont les
douze refus du §4.4. La commande n'est rendue que sur une version éditable et seulement si
le dépôt sait lister les blocs : le frontend ne dépend jamais d'une RPC absente.

**Écart assumé avec le §5.** `RuleForm.tsx`, que la liste de surfaces réservait à L60, reçoit
une seule propriété optionnelle d'affichage, `initialSectionTarget` : après un import, le
constructeur de règles s'ouvre sur le bloc qui vient d'arriver. Aucune sémantique de L60 n'y
entre — ni contrôle de compatibilité, ni reprise de la règle d'activation de la source ; le
pilote reste choisi par l'utilisateur.

Contrôles exécutés sur PostgreSQL embarqué jetable, avec données fictives :

- Base — `test/template-section-catalog.test.ts` : **7 tests réussis**, dont le parcours
  complet d'un bloc de vingt variables (catalogue, aperçu sans écriture, import en une
  opération) depuis un gabarit lisible par base partagée, le filtrage RLS dans les deux
  sens, le comptage d'une variable rattachée par le seul code texte, et l'ACL de la
  fonction. Régressions L58 et ACL rejouées : **42 tests réussis** au total avec
  `template-section-import` et `security-definer-acl`.
- Web — `SectionImportDialog.test.tsx` : **11 tests réussis** couvrant le §9.2 point par
  point, plus le catalogue vide ; `TemplateVersionEditor.test.tsx` : **5 tests**, dont la
  version non éditable (commande absente) et le serveur sans catalogue ;
  `templates.test.tsx` : **6 tests**, dont le vidage du cache après import et son absence
  après une simple prévisualisation. Suite web complète : **601 tests réussis**.
- `npm run typecheck`, `npm run lint`, `npm run schema`, inspection du snapshot
  (une fonction `INVOKER` de plus, rien d'autre), `npm run schema:check` et
  `git diff --check` : réussis.

Validation locale uniquement : aucune migration distante appliquée, aucun déploiement.
