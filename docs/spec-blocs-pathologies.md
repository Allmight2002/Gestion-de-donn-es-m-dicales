# Spécification — blocs pathologiques dans une base unique

- Statut : 📋 **spécifiée, non implémentée** — lots **L51**, **L54**, **L52**, **L53**
  (dans cet ordre d'exécution ; voir §7)
- Origine : [decision-blocs-pathologies-2026-09-03.md](decision-blocs-pathologies-2026-09-03.md)
- Surface serveur : `rule_apply_op`, `rule_holds`, `visibility_hidden_fields`,
  le contrôle de forme des règles, `assert_visibility_acyclic`, `template_section`,
  les fonctions de recopie de version, Edge Function `generate-export`
- Surface web : `src/domain/templateRules.ts`, `src/screens/staff/RuleForm.tsx`,
  l'éditeur de sections, le rendu de formulaire, `src/data/exports.ts`,
  `src/screens/member/ExportPanel.tsx`, `src/i18n/`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

## 1. Besoin

Permettre à une base unique de porter plusieurs **blocs pathologiques**, affichés selon la
situation du patient et exportables séparément — au lieu d'une base et d'un formulaire par
pathologie, qui obligent à saisir plusieurs fois le même patient.

Vocabulaire de cette spécification :

| Terme | Définition |
|---|---|
| **Bloc** | `template_section` **sans parent**. Correspond à une pathologie. Porte la règle d'affichage. |
| **Sous-section** | `template_section` **avec parent**. Regroupement visuel *à l'intérieur* d'un bloc. Ne porte jamais de règle. |
| **Tronc commun** | Variables sans section (`section_id is null`). Toujours applicables, jamais masquées par une règle de section. |

Cible dimensionnante : **12 blocs d'environ 20 variables**, avec recouvrement important entre
blocs. C'est ce chiffre de 20 qui rend les sous-sections nécessaires : 20 variables en liste
continue ne sont pas lisibles.

## 2. Ce qui existe déjà et n'est pas à refaire

Constats de lecture de code, non confirmés par exécution.

- `template_section` est versionnée, recopiée d'une version à l'autre par `section_key`, et
  soumise aux mêmes règles RLS que `template_field`. Elle est **plate** : `section_key`,
  `label`, `display_order`, sans hiérarchie.
- `template_field.section_id` est **nullable**, renseigné au moment où la variable est créée.
- Un miroir texte maintient `template_field.section` à partir de `section_id`, pour les clients
  non rafraîchis.
- Les règles d'affichage conditionnel existent : `{ if: {field, operator, value},
  then: {field, operator: 'visible'} }`.
- L'ordre **visibilité d'abord, obligation ensuite** est imposé côté serveur : un champ masqué
  ne peut pas être obligatoire.
- Le serveur **refuse** à la finalisation une fiche portant encore la valeur d'un champ masqué :
  l'applicabilité n'est pas qu'un affichage.
- `ExportField` porte déjà `section` (code stable) et `sectionLabel`.
- Toute la construction des colonnes, du dictionnaire, de la feuille `Modalités` et des limites
  part d'**un seul tableau** de variables dans le handler d'export.
- `export_options` est déjà déversé tel quel dans `export_log`.

## 3. L51 — Opérateur d'appartenance dans le moteur de règles

### 3.1 Problème résolu

Le moteur n'a **aucune façon d'exprimer « ou »**. Plusieurs règles visant la même variable se
combinent en ET, et l'opérateur `in` compare `a #>> '{}'`, ce qui sur une liste compare le
texte du tableau entier au lieu de ses éléments.

Conséquence : une variable utile à deux blocs est inexprimable, sauf à la remonter dans le
tronc commun — ce que la décision D8 refuse.

### 3.2 Contrat

Un opérateur de condition supplémentaire, `contains_any` :

```json
{ "if":   { "field": "pathologies", "operator": "contains_any",
            "value": ["tuberculose", "malnutrition"] },
  "then": { "field": "etat_hydratation", "operator": "visible" } }
```

### 3.3 Sémantique normative

- **Pilote multivalué** (`multiselect`) : vrai si **au moins un** élément du pilote figure dans
  `value`.
- **Pilote scalaire** (`select`) : vrai si la valeur du pilote figure dans `value`. `contains_any`
  est donc un sur-ensemble de `in` ; `in` reste inchangé pour la compatibilité.
- **Valeur absente, nulle ou liste vide** : faux. Jamais vrai par défaut.
- **Valeur manquante codifiée** (`{"__missing__": "..."}`) : **faux**. Une raison de valeur
  manquante ne déclenche pas un bloc.
- `value` compare des **codes d'option**, jamais des libellés — comme partout ailleurs dans le
  produit.

### 3.4 Contrôles à la définition de la règle

Refuser, avec un message nommant la variable :

- un pilote dont le type n'est ni `select` ni `multiselect` ;
- un `value` absent, non-tableau, ou **vide** — une règle qui ne peut jamais être vraie ;
- un code de `value` absent des codes d'option du pilote.

### 3.5 Points de vigilance

- Ne **pas** ajouter `contains_any` à la liste des opérateurs de comparaison
  `{operator, left_field, right_field}` : il n'a de sens que dans une clause `if`.
- Ne pas réutiliser `a #>> '{}'` sur un pilote multivalué : c'est exactement le défaut à éviter.
- **Parité stricte** entre `rule_apply_op` (PL/pgSQL) et `src/domain/templateRules.ts`. Une
  divergence produit un aperçu différent de la décision serveur.
- **Compatibilité descendante à établir explicitement.** Vérifier ce que fait un client non
  rafraîchi face à un opérateur `if` inconnu, et le documenter. Contrairement à un `then`
  inconnu — traité comme « respecté » — un `if` inconnu peut masquer. Conséquence de
  déploiement : livrer le frontend **avant** de publier la moindre version utilisant
  l'opérateur.

## 4. L54 — Deux niveaux de sections : bloc et sous-section

### 4.1 Problème résolu

En faisant d'un bloc pathologique une section (décision D2), le chantier consomme le **seul**
niveau de regroupement existant. Un bloc de 20 variables devient une liste continue, sans
séparation clinique / biologie / imagerie / traitement — c'est-à-dire exactement le problème de
lisibilité que les sections servaient à résoudre.

Aucune convention de nommage ne remplace ce niveau : un préfixe dans `section_key` deviendrait
porteur de sémantique, ce que le produit refuse ailleurs.

### 4.2 Modèle

```sql
alter table public.template_section
  add column parent_section_id uuid references public.template_section(id) on delete restrict;
```

- `parent_section_id is null` → **bloc** (racine) ;
- `parent_section_id is not null` → **sous-section**.

`section_key` reste unique par version, tous niveaux confondus : le miroir texte en dépend.

Index de lecture par niveau :

```sql
create index template_section_parent_order_idx
  on public.template_section (template_version_id, parent_section_id, display_order, section_key);
```

### 4.3 Contraintes normatives

Refusées côté serveur, par trigger ou contrainte :

1. **Parent d'une autre version.** Le parent doit appartenir à la même `template_version`.
2. **Un seul niveau d'imbrication.** Le parent doit lui-même être une racine : une sous-section
   ne peut jamais être parent. C'est la contrainte qui garde le rendu, la recopie, la
   visibilité et l'export simples.
3. **Auto-parenté.** `id <> parent_section_id`.
4. **Suppression d'un bloc portant des sous-sections.** Refusée (`on delete restrict`) : il faut
   vider le bloc d'abord, explicitement.

### 4.4 Une garde supplémentaire, à ne pas oublier

`template_field.section_id` est `on delete set null`. Aujourd'hui, supprimer une section
**détache** ses variables, qui retombent sur le filet. Dans le modèle à blocs, une variable
détachée devient du **tronc commun**, donc visible pour **tous les patients** — l'inverse exact
de l'intention.

Exiger donc un refus supplémentaire : **la suppression d'une section qui est la cible d'une
règle d'affichage est refusée**, avec un message explicite. Cette garde est additive et sans
effet sur une base ne portant aucune règle de section.

### 4.5 Rattachement des variables

`template_field.section_id` reste inchangé et peut désigner **un bloc ou une sous-section**.

Une variable peut rester attachée directement à un bloc qui possède par ailleurs des
sous-sections : refuser ce cas forcerait à créer des sous-sections artificielles. L'ordre de
rendu est alors normatif :

```text
bloc
 ├── variables attachées directement au bloc, par display_order
 └── sous-sections par display_order
      └── leurs variables par display_order
```

### 4.6 Miroir texte et clients non rafraîchis

Le miroir `template_field.section` continue de porter la `section_key` de la **feuille** —
sous-section si la variable y est attachée, bloc sinon. Un client non rafraîchi voit donc une
liste plate de sections : vue dégradée mais cohérente, sans perte de donnée.

À **vérifier**, pas à supposer : le trigger de synchronisation existant doit continuer de
fonctionner à l'identique sur les deux niveaux.

### 4.7 Recopie d'une version

Toutes les voies de duplication passent à **deux passes** :

1. insérer toutes les sections de la version source, comme aujourd'hui, par `section_key` ;
2. une fois toutes les sections présentes dans la version cible, résoudre
   `parent_section_id` en rapprochant la `section_key` du parent source.

Un rattachement en une seule passe échouerait ou produirait un pointeur vers l'ancienne version
selon l'ordre d'insertion. Redéfinir dans une nouvelle migration la version courante de
`copy_template_fields`, `duplicate_template_version`, `create_next_personal_template_version`,
`promote_template_to_global`, `create_base_from_model_observation` et `create_template_bundle`.

**Aucune section d'une version ne doit jamais pointer vers une section d'une autre version.**

### 4.8 Éditeur

- Créer une sous-section sous un bloc existant.
- Réordonner à l'intérieur d'un niveau.
- Déplacer une section d'un niveau à l'autre, uniquement sur une version encore inutilisée.
- Distinguer visuellement les deux niveaux, sans laisser croire qu'une sous-section peut porter
  une règle.

## 5. L52 — Visibilité au niveau bloc

> **Dépend de L54.** Une règle qui vise « un bloc » n'a de sens qu'une fois les deux niveaux
> définis. Livrer L52 avant L54 produirait des règles visant n'importe quelle section, qu'il
> faudrait ensuite restreindre après coup.

### 5.1 Problème résolu

Une règle d'affichage vise `then.field`, jamais une section. Simuler 12 blocs de 20 variables
impose donc environ **240 règles**. La visibilité de bloc ramène ce chiffre à **12**.

Le mode de défaillance actuel aggrave le problème : une règle oubliée n'échoue pas, elle
**affiche la variable à tout le monde**.

### 5.2 Contrat

```json
{ "if":   { "field": "pathologies", "operator": "contains_any", "value": ["tuberculose"] },
  "then": { "section": "tuberculose", "operator": "visible" } }
```

`then.section` porte la **`section_key`** stable d'un **bloc**, jamais l'UUID, jamais une
sous-section.

### 5.3 Sémantique normative

- Si la règle n'est pas satisfaite, **toutes** les variables du bloc sont masquées dans cette
  version — celles attachées directement au bloc **et** celles de toutes ses sous-sections.
- Une **sous-section est visible si et seulement si son bloc l'est**. Elle ne porte jamais de
  condition propre.
- Les variables **sans section** ne sont jamais concernées : elles sont le tronc commun.
- Une variable est masquée si **son bloc est masqué** ou si **sa propre règle** échoue. Les deux
  mécanismes se cumulent, ils ne se remplacent pas.
- La cascade existante s'applique : un pilote lui-même masqué est traité comme absent, donc le
  bloc qu'il commande est masqué. Le point fixe actuel doit continuer de converger.
- `then.section` n'accepte que `visible`. **Pas** de `required` au niveau bloc : c'est une autre
  sémantique, hors de ce lot.

### 5.4 Contrôles à la définition de la règle

Refuser, avec un message explicite :

- une `section_key` inexistante dans la version ;
- une `section_key` désignant une **sous-section** — seul un bloc peut porter une règle ;
- un pilote **appartenant au bloc qu'il commande**, sous-sections comprises : il se masquerait
  lui-même et le bloc ne réapparaîtrait jamais ;
- un bloc contenant des variables de **scope différent** de celui du pilote. Le refus est
  préféré à une application partielle silencieuse.

### 5.5 Acyclicité

`assert_visibility_acyclic` doit être étendue : une règle de bloc crée une arête du pilote vers
**chaque variable du bloc, sous-sections comprises**. Un cycle existe si, en remontant les
dépendances depuis le pilote, on retombe sur une de ces variables.

C'est la partie la plus délicate du lot : elle doit rester vérifiée **à l'enregistrement de la
règle**, comme aujourd'hui, et non au moment de la saisie.

### 5.6 Effacement — rayon d'action

Les variables d'un bloc masqué suivent le sort des variables masquées : leur valeur est
effacée, l'interface annonçant le nombre **avant** l'enregistrement.

À 20 variables par bloc, un décochage efface 20 valeurs d'un coup, réparties sur plusieurs
sous-sections. **Vérifier que le décompte annoncé couvre l'intégralité du bloc**, sous-sections
comprises, et pas seulement les variables visées nommément par une règle. Un effacement non
annoncé serait une régression grave.

### 5.7 Rendu

- Un bloc dont toutes les variables sont masquées ne doit rien rendre — ni titre, ni cadre.
- Une sous-section sans aucune variable visible ne doit rien rendre non plus.

À vérifier sur le rendu existant, et à corriger dans ce lot si ce n'est pas déjà le comportement.

## 6. L53 — Projection d'export par blocs

> **Dépend de L54.** La projection filtre sur le **bloc racine** : sélectionner `tuberculose`
> doit ramener les variables de la sous-section `tb_biologie`.

### 6.1 Problème résolu

L'export rend l'union de toutes les variables de la population. Avec 12 blocs, le fichier
devient large et clairsemé, et il n'existe aucun moyen d'extraire « le tronc commun plus une
pathologie ».

### 6.2 Contrat

Extension de `export_options` :

```json
{
  "sectionProjection": {
    "mode": "selected",
    "blockKeys": ["tuberculose", "malnutrition"]
  }
}
```

`mode: "all"` est le **défaut** et reproduit exactement le comportement actuel. L'absence de
`sectionProjection` équivaut à `all`. Les clés désignent des **blocs**, jamais des
sous-sections.

### 6.3 Les deux niveaux dans le contrat d'export

`ExportField` conserve `section` et `sectionLabel` avec leur sens actuel — la **feuille**, donc
la sous-section quand il y en a une — et gagne deux champs pour la racine :

```text
section       // feuille : sous-section si elle existe, sinon le bloc  (inchangé)
sectionLabel  //                                                        (inchangé)
blockKey      // bloc racine ; égal à `section` quand la section est plate
blockLabel
```

Pour une base à sections plates, `blockKey === section` : la compatibilité descendante est
acquise par construction.

Le dictionnaire XLSX gagne une colonne **bloc** à côté de sa colonne section.

### 6.4 Sémantique normative

- Le filtre porte sur **`blockKey`**, jamais sur la feuille.
- Les variables **sans section** sont **toujours** exportées, quelle que soit la projection.
  Elles ne se listent pas dans `blockKeys` et ne peuvent pas être retirées.
- La **population n'est jamais filtrée** par la projection : c'est la cohorte qui définit les
  lignes. Un patient ne relevant d'aucun bloc sélectionné ressort avec ses seules colonnes
  communes renseignées.
- Le filtre s'applique en un point unique, juste après la fusion des variables et avant la
  construction des colonnes, pour que dictionnaire, `Modalités`, métadonnées, limites et garde
  anti-identité suivent sans traitement particulier.
- La projection résolue est journalisée dans `export_log.export_options` — automatique, les
  options y étant déjà déversées.

### 6.5 Contrôles

Refuser l'export, avant génération, avec une erreur structurée :

- `mode: "selected"` avec `blockKeys` absent ou vide ;
- une clé inconnue de **toutes** les versions présentes dans la cohorte ;
- une clé désignant une **sous-section** et non un bloc ;
- **un même `field_key` rattaché à des blocs différents selon les versions présentes.**

Ce dernier point mérite une explication. La fusion des variables d'export se fait par
`field_key` et retient la section de la **première version rencontrée**. Une variable ayant
changé de bloc entre deux versions serait donc classée arbitrairement, sans que rien ne le
signale. Le refus transforme un résultat faux et silencieux en une erreur visible, pour un coût
négligeable.

Le contrôle porte sur le **bloc**, pas sur la feuille : déplacer une variable d'une
sous-section à une autre **à l'intérieur du même bloc** ne doit pas provoquer de refus.

Un traitement complet — un bloc par version, sur le modèle de ce qui est déjà fait pour les
formules, qui ne fusionnent délibérément pas — est une **suite possible**, pas une exigence de
ce lot.

### 6.6 Interface

Dans l'écran d'export : la liste des **blocs** présents dans la cohorte, sélectionnables. Les
sous-sections ne sont pas proposées séparément — elles suivent leur bloc. Les variables sans
section sont mentionnées comme toujours incluses et ne sont pas décochables. Traductions
française et anglaise.

### 6.7 Dispersion — décision différée

Un export `all` sur une base à 12 blocs sort plus de 240 colonnes, très majoritairement vides
ligne à ligne. La projection le règle **si elle est utilisée**.

Un mode « blocs présents dans la cohorte », restreignant automatiquement aux blocs effectivement
renseignés, a été envisagé et **écarté pour l'instant** : le jeu de colonnes deviendrait
dépendant des données, et deux exports de la même cohorte à deux dates pourraient ne plus avoir
la même forme. À reprendre seulement si la dispersion gêne réellement à l'usage.

Sur les volumes, aucune inquiétude : 240 variables restent très loin des limites déclarées de
l'export, qui plafonnent à 25 000 champs de dictionnaire.

## 7. Ordre, dépendances et collisions

```text
L51  →  L54  →  L52
                 ↘  L53   (parallélisable avec L52 une fois L54 fusionné)
```

| Lot | Dépend de | Peut tourner avec |
|---|---|---|
| **L51** | — | L54 |
| **L54** | — | L51 |
| **L52** | **L51 et L54** | L53 |
| **L53** | **L54** | L52 |

- **L51 et L52 écrivent tous deux** dans le moteur de règles, `src/domain/templateRules.ts` et
  `src/screens/staff/RuleForm.tsx` : ne jamais les lancer ensemble.
- **L54 touche les fonctions de recopie de version**, que personne d'autre n'ouvre dans cette
  série. Il est parallélisable avec L51.
- **L53 est isolé** côté fichiers : contrat et générateur d'export, plus l'écran d'export. Il
  partage `exportContract.ts` et `handler.ts` avec **L50**, différé — ne pas lancer les deux
  ensemble le jour où L50 sera repris.
- **L53 dépend de L54** pour la notion de bloc racine, mais pas de L51 ni de L52 : il peut être
  livré avant que les règles de bloc n'existent, sur des blocs pilotés par de simples cases à
  cocher.

## 8. Hors périmètre

- Tables de modules, tables d'activation, état « conservé », historique d'activation.
- Détection automatique d'un bloc depuis un code CIM-11 : différée, voir §6 du document de
  décision.
- Plus d'un niveau de sous-section.
- Règle d'affichage portée par une sous-section.
- `required` au niveau d'un bloc ou d'une sous-section.
- Filtre de cohorte par bloc : la cohorte continue de filtrer sur les champs, conformément à D7.
- Reprise des bases par pathologie existantes.
- Groupes répétables dans la fiche patient.

## 9. Plan de tests

### 9.1 PostgreSQL et RLS

**L51**

1. `contains_any` sur pilote multivalué : un élément correspond, aucun élément ne correspond,
   pilote vide.
2. `contains_any` sur pilote scalaire : correspondance et non-correspondance.
3. Pilote absent, `null`, ou valeur manquante codifiée : condition fausse dans les trois cas.
4. Refus à la définition : pilote de type incompatible, `value` vide, code hors des options.

**L54**

5. Parent appartenant à une autre version : refusé.
6. Sous-section prise comme parent : refusé (un seul niveau).
7. Auto-parenté : refusée.
8. Suppression d'un bloc portant des sous-sections : refusée.
9. Suppression d'une section cible d'une règle d'affichage : refusée.
10. Recopie de version : parents remappés par `section_key`, aucun pointeur inter-versions ;
    à vérifier sur **les six** voies de duplication.
11. Miroir texte : porte la clé de la feuille, aux deux niveaux.
12. Variable attachée directement à un bloc possédant des sous-sections : acceptée.
13. Ordre par niveau : blocs entre eux, sous-sections dans leur parent.

**L52**

14. Bloc masqué ⇒ toutes ses variables masquées, sous-sections comprises.
15. Variable sans section : jamais masquée par une règle de bloc.
16. Cumul : variable dont le bloc est visible mais dont la règle propre échoue ⇒ masquée.
17. Cascade : pilote lui-même masqué ⇒ bloc masqué ; le point fixe converge.
18. Refus à la définition : clé inconnue, clé désignant une sous-section, pilote interne au bloc
    (sous-sections comprises), scopes mélangés.
19. Cycle détecté à l'enregistrement d'une règle de bloc.
20. Une variable masquée par bloc n'est jamais exigée par la complétude.
21. Refus serveur d'une fiche portant la valeur d'une variable d'un bloc masqué.
22. Gel de version : refus d'ajout d'une règle sur une version portant des données.
23. Duplication : règles de bloc recopiées et rattachées aux nouvelles sections.

### 9.2 Domaine et frontend

- Parité stricte serveur / client de `contains_any`, sur les mêmes jeux de valeurs.
- Rendu à deux niveaux : variables directes du bloc avant les sous-sections, ordre respecté.
- Bloc entièrement masqué non rendu, titre compris ; sous-section sans variable visible non
  rendue.
- Décompte des valeurs effacées couvrant **l'intégralité du bloc**, sous-sections comprises.
- Éditeur : création d'une sous-section, réordonnancement par niveau, déplacement entre niveaux
  refusé sur une version déjà utilisée, refus lisibles.
- Éditeur de règles : choix d'un bloc comme cible, sous-sections non proposées, choix de
  plusieurs déclencheurs.
- Sélecteur de projection : blocs seuls proposés, variables sans section non décochables.
- Traductions française et anglaise.

### 9.3 Edge Function d'export

- Export sans projection : strictement identique à aujourd'hui.
- Base à sections plates : `blockKey === section`, aucun changement de sortie.
- Projection d'un bloc, puis de plusieurs.
- Variables d'une sous-section incluses quand leur bloc est sélectionné.
- Variables sans section toujours présentes.
- Population inchangée : un patient hors des blocs sélectionnés reste une ligne.
- Dictionnaire portant les deux niveaux ; `Modalités` et métadonnées cohérents.
- Garde anti-identité appliquée au jeu de colonnes filtré.
- Refus : `blockKeys` vide, clé inconnue, clé désignant une sous-section, `field_key` à blocs
  divergents entre versions.
- **Non-refus** : variable déplacée d'une sous-section à une autre dans le même bloc.
- `export_log.export_options` porte la projection résolue ; hash de fichier stable.

### 9.4 Commandes

Dans l'ordre adapté au lot :

```text
npm run db:verify
npm run test:rls
npm run test:web
npm run typecheck
npm run lint
npm test
npm run release:edge:check
npm run build
```

Ne déclarer passée qu'une vérification réellement exécutée. Régénérer
[schema-etat-final.md](schema-etat-final.md) après la migration de L54.

## 10. Critères d'acceptation

- **AC-1** — Une base sans règle de bloc, sans sous-section et sans projection d'export se
  comporte exactement comme avant les quatre lots. Aucun `jsonb` clinique n'est modifié.
- **AC-2** — Une variable utile à deux blocs est décrite par **une** règle nommant deux
  déclencheurs, et reste dans son bloc. L'ajout d'un troisième bloc l'utilisant se fait en
  étendant cette règle, sans déplacer la variable.
- **AC-3** — Douze blocs de vingt variables se définissent avec **douze** règles, quel que soit
  le nombre de sous-sections.
- **AC-4** — Un bloc contient des sous-sections ordonnées ; aucune sous-section ne peut avoir
  d'enfant, porter une règle, ni pointer vers une autre version.
- **AC-5** — La duplication d'une version reproduit la hiérarchie complète des sections et
  rattache les variables aux nouvelles sections, sur les six voies de duplication.
- **AC-6** — Un bloc masqué n'affiche rien, n'exige rien, et le nombre de valeurs à effacer,
  sous-sections comprises, est annoncé avant l'enregistrement.
- **AC-7** — Le serveur refuse une fiche portant la valeur d'une variable d'un bloc masqué, y
  compris en brouillon.
- **AC-8** — Supprimer une section cible d'une règle est refusé : aucune variable ne peut
  devenir du tronc commun par détachement silencieux.
- **AC-9** — Un export « tronc commun + un bloc » contient les variables de toutes les
  sous-sections de ce bloc, laisse la population inchangée, reste pseudonymisé et journalise sa
  projection.
- **AC-10** — Un `field_key` rattaché à des blocs différents selon les versions présentes dans
  la cohorte provoque un refus explicite ; un déplacement entre sous-sections d'un même bloc n'en
  provoque pas.
- **AC-11** — Aperçu client et décision serveur coïncident sur `contains_any` pour tous les jeux
  de valeurs testés.
