# Spécification — blocs cliniques conditionnels dans une même base

- Statut : 📋 **spécifiée, revue le 2026-09-05, non implémentée** — lots **L51**, **L54**, **L52**, **L53**
  (L51 et L54 en parallèle, puis L52 et L53 ; voir §7)
- Origine : [decision-blocs-pathologies-2026-09-03.md](decision-blocs-pathologies-2026-09-03.md)
- Surface serveur : `rule_apply_op`, `rule_holds`, `visibility_hidden_fields`,
  le contrôle de forme des règles, `assert_visibility_acyclic`, `template_section`,
  les fonctions de recopie de version, Edge Function `generate-export`
- Surface web : `src/domain/templateRules.ts`, **`src/domain/validation.ts`**,
  `src/domain/templateSections.ts`, `src/screens/staff/RuleForm.tsx`, l'éditeur de sections,
  le rendu de formulaire, l'instantané hors-ligne, `src/data/exports.ts`,
  `src/screens/member/ExportPanel.tsx`, `src/i18n/`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

> **Retour terrain du 2026-09-05 :** le diagnostic déjà établi pilote désormais les blocs par
> correspondance exacte. Le complément normatif [collecte diagnostique](spec-collecte-diagnostique.md)
> ajoute L55/L56 et le cadrage différé L57 ; il définit la couverture distincte de la complétude.
> Les lots décrits ici sont des fondations et ne suffisent pas seuls au parcours terrain.

## 1. Besoin

Permettre à une même base de porter plusieurs **blocs cliniques conditionnels**, affichés selon
la situation du patient et exportables séparément — au lieu d'une base et d'un formulaire par
pathologie, qui obligent à saisir plusieurs fois le même patient. Ici, « une même base » désigne un
même contexte de collecte et de gouvernance, pas nécessairement une spécialité entière.

Vocabulaire de cette spécification :

| Terme | Définition |
|---|---|
| **Bloc** | `template_section` **sans parent**. Regroupement clinique spécialisé : pathologie, complication, phénotype ou autre situation. Peut porter une règle d'affichage. |
| **Sous-section** | `template_section` **avec parent**. Regroupement visuel *à l'intérieur* d'un bloc. Ne porte jamais de règle. |
| **Tronc commun** | Variables intentionnellement sans section (`section_id` et le miroir `section` nuls). Non masquées par une règle de bloc, mais pouvant porter leur propre règle de champ. |

Cible dimensionnante : **12 blocs d'environ 20 variables dans une même base cohérente**, avec
recouvrement important entre blocs. C'est ce chiffre de 20 qui rend les sous-sections nécessaires :
20 variables en liste continue ne sont pas lisibles.

### 1.1 Variables communes et variables partagées

Une variable reste stockée **une seule fois** et garde une seule position d'affichage.

- utile à tous les patients : tronc commun, sans règle de visibilité ;
- utile à plusieurs blocs pilotés par des valeurs du **même champ contrôlé**, mais pas à tous :
  tronc commun avec **une règle de champ** `contains_any` nommant ces valeurs ;
- propre à un bloc : attachée au bloc ou à l'une de ses sous-sections et couverte par la règle
  du bloc.

Une variable partagée n'est donc jamais enfermée dans un bloc qui serait masqué pour l'un de
ses autres cas d'usage. Elle est toujours présente comme colonne commune dans une projection
d'export, mais reste vide pour les patients auxquels sa règle ne s'applique pas. Ce léger
surcroît de colonnes est le compromis explicite qui évite une seconde relation plusieurs-à-
plusieurs entre variables et blocs. Si les bases pilotes montrent que ce compromis produit des
exports encore trop dispersés, cette relation pourra faire l'objet d'un lot distinct.

Pour la v1, le pilote recommandé est donc un `multiselect` explicite tel que `blocs_actifs` ou
`situations_cliniques`, avec une option stable par bloc. Il décrit ce que le saisisseur doit
recueillir ; il vit dans le tronc commun, est saisi et ne remplace ni le diagnostic détaillé ni
les mesures cliniques. `contains_any` ne résout pas un « ou » entre plusieurs champs pilotes
différents. Une variable partagée entre de tels blocs reste soit visible sans condition dans le
tronc commun, soit différée avec le chantier d'expressions booléennes générales ; elle n'est pas
dupliquée silencieusement.

### 1.2 Frontière de base et validation terrain

Les blocs ne changent pas la frontière de sécurité. Regrouper plusieurs situations dans une base
n'est approprié que si elles partagent la finalité de collecte, l'équipe responsable, les droits
d'accès, le protocole et les règles de conservation. Si ces éléments divergent, des bases séparées
restent préférables ; la déduplication éventuelle entre elles relève d'un autre chantier d'identité
et de gouvernance.

La difficulté observée en stage justifie un pilote, pas une généralisation immédiate. Avant un
déploiement large, éprouver le parcours sur quelques blocs représentatifs avec des données
strictement fictives et relever au minimum : ressaisies évitées, durée et erreurs de saisie,
fréquence des patients multiblocs, corrections d'activation, compréhension des effacements et
utilité réelle des projections d'export. Relever aussi les besoins de répétition dans le temps :
s'ils deviennent fréquents, le modèle rencontre/événement est plus adapté qu'un bloc patient. Le
résultat peut confirmer cette architecture, justifier des modules réutilisables et historisés, ou
conduire à conserver des bases séparées.

## 2. Ce qui existe déjà et n'est pas à refaire

Constats de lecture de code, non confirmés par exécution sauf mention contraire.

- `template_section` est versionnée, recopiée d'une version à l'autre par `section_key`, et
  soumise aux mêmes règles RLS que `template_field`. Elle est **plate** : `section_key`,
  `label`, `display_order`, sans hiérarchie.
- `template_field.section_id` est **nullable**, mais le miroir `template_field.section` est
  encore `not null` et les contrats web exigent une section. Le tronc commun n'est donc pas
  encore un choix d'édition de premier rang : L54 doit le rendre explicite.
- Un miroir texte maintient `template_field.section` à partir de `section_id`, pour les clients
  non rafraîchis. Une ligne avec `section_id is null` et `section is not null` est un rattachement
  ancien non résolu, pas une variable commune créée volontairement ; elle reste sur le filet.
- La suppression d'une section portant encore des variables est **déjà refusée** par
  `guard_template_section_write`, malgré le `on delete set null` de la clé étrangère.
- Les règles d'affichage conditionnel existent : `{ if: {field, operator, value},
  then: {field, operator: 'visible'} }`.
- L'ordre **visibilité d'abord, obligation ensuite** est imposé côté serveur : un champ masqué
  ne peut pas être obligatoire.
- Le serveur **refuse** à la finalisation une fiche portant encore la valeur d'un champ masqué :
  l'applicabilité n'est pas qu'un affichage.
- `ExportField` porte déjà `section` (code stable) et `sectionLabel`.
- Toute la construction des colonnes, du dictionnaire, de la feuille `Modalités` et des limites
  part d'**un seul tableau** de variables dans le handler d'export.
- Le calcul des formules construit également son index d'opérandes depuis ce tableau : L53 ne
  doit donc pas supprimer les opérandes avant le calcul.
- `export_options` est déjà déversé tel quel dans `export_log`.
- L'évaluation React des opérateurs et des champs masqués vit dans
  `src/domain/validation.ts`; `src/domain/templateRules.ts` porte surtout le contrat et la
  validation de forme.

## 3. L51 — Opérateur d'appartenance dans le moteur de règles

### 3.1 Problème résolu

Le moteur n'a **aucune façon d'exprimer « ou » sur les valeurs d'un même pilote**. Plusieurs
règles visant la même variable se combinent en ET, et l'opérateur `in` compare `a #>> '{}'`,
ce qui sur une liste compare le texte du tableau entier au lieu de ses éléments.

Conséquence : une variable commune à deux valeurs du même pilote ne peut pas rester unique et
porter une seule règle de champ. `contains_any` rend précisément cette règle possible. Il ne
constitue pas un langage général de conditions `OR` entre plusieurs champs.

### 3.2 Contrat

Un opérateur de condition supplémentaire, `contains_any` :

```json
{ "if":   { "field": "situations_cliniques", "operator": "contains_any",
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

Le pilote du parcours terrain est le diagnostic du tronc commun, configuré explicitement
par L55. L51 accepte aussi `terminology` simple ou multiple : comparer les codes des objets
`{code,label}` valides, jamais leurs libellés ni le JSON sérialisé. La comparaison est exacte
dans la release liée à la configuration ; aucune inférence de famille CIM ni dépendance L50.
Les sélecteurs `select`/`multiselect` restent pris en charge. Une proposition hors référentiel
ne déclenche pas automatiquement de bloc et relève du suivi L55/L56.

L51 livre déjà `if.terminologyReleaseId` pour les règles terminologiques, obligatoire,
validé et recopié avec la règle ; les autres types ne portent pas cette propriété. L55
validera son égalité avec la release du pilote. L51 ne dépend donc pas de L55 pour définir
une règle et ne prend jamais silencieusement la release courante.

### 3.4 Contrôles à la définition de la règle

Refuser, avec un message nommant la variable :

- un pilote dont le type n'est ni `select`, ni `multiselect`, ni `terminology` ;
- un `value` absent, non-tableau, ou **vide** — une règle qui ne peut jamais être vraie ;
- un code de `value` absent des options ou de la release terminologique explicitement liée ;
- des codes configurés dupliqués ou une configuration de release incohérente.

Valider les objets terminologiques sans coercition et préserver le rang diagnostique existant.
La normalisation des codes pour l'évaluation ne réécrit jamais les valeurs enregistrées.

### 3.5 Points de vigilance

Implémentation L51 et procédure d’activation : [l51-contains-any.md](l51-contains-any.md).

- Ne **pas** ajouter `contains_any` à la liste des opérateurs de comparaison
  `{operator, left_field, right_field}` : il n'a de sens que dans une clause `if`.
- Ne pas réutiliser `a #>> '{}'` sur un pilote multivalué : c'est exactement le défaut à éviter.
- **Parité stricte** entre `rule_apply_op` (PL/pgSQL) et l'évaluateur de
  **`src/domain/validation.ts`**. Une divergence produit un aperçu différent de la décision
  serveur ; `templateRules.ts` doit également connaître l'opérateur pour valider et typer la
  règle.
- Une modification ultérieure des options du pilote doit relancer la validation des règles de
  la version : retirer un code encore cité par `contains_any` est refusé, y compris par une voie
  d'écriture directe autorisée.
- Pour une cible gouvernée par au moins une règle `contains_any`, le serveur refuse une valeur
  lorsque la cible est masquée, **quel que soit le statut de la fiche**. Cette garantie est bornée
  au nouvel opérateur : les règles de champ historiques conservent leur sémantique. Comme
  `contains_any` n'existe dans aucune version historique et qu'une règle ne s'ajoute pas à une
  version déjà utilisée, aucune donnée existante n'est invalidée au déploiement.
- **Compatibilité descendante établie par lecture du client actuel.** Un client non rafraîchi
  rejette l'opérateur inconnu lors de `validateRule`, ignore donc la règle d'affichage et montre
  sa cible. Le serveur mis à jour peut au contraire la masquer. Déployer d'abord le support
  serveur additif sans créer de telle règle, puis le client compatible ; ne publier une version
  utilisant `contains_any` qu'après cette disponibilité. Un ancien client qui tente malgré tout
  d'enregistrer une valeur masquée doit recevoir un refus structuré lui demandant de rafraîchir,
  jamais perdre une valeur en silence.
- Ajouter les libellés français et anglais de l'opérateur dans le même lot.

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
  add column parent_section_id uuid;

alter table public.template_field
  alter column section drop not null;
```

- `parent_section_id is null` → **bloc** (racine) ;
- `parent_section_id is not null` → **sous-section**.
- `template_field.section_id is null` et `template_field.section is null` → **tronc commun
  intentionnel**, désormais proposé par l'éditeur.
- `section_id is null` avec un ancien code `section` non nul reste un rattachement non résolu :
  le champ reste visible et exporté via le filet, mais l'éditeur ne crée plus cet état.

`section_key` reste unique par version, tous niveaux confondus : le miroir texte en dépend.

La même-version est garantie déclarativement, pas seulement par un `select` de trigger : ajouter
la clé unique technique nécessaire puis une clé étrangère composite
`(parent_section_id, template_version_id) → template_section(id, template_version_id)` avec
`on delete no action deferrable initially deferred`.

Le choix différable est intentionnel : supprimer un bloc seul échoue encore si ses sous-sections
subsistent à la fin de la transaction, mais la cascade qui supprime toute une version peut retirer
parents et enfants dans la même transaction. `restrict`, non différable, risquerait de bloquer ce
chemin de suppression global.

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
4. **Suppression d'un bloc portant des sous-sections.** Refusée par la FK `no action` différable
   si les enfants subsistent au commit : il faut les supprimer ou les déplacer explicitement.

Les mutations de hiérarchie d'une même version sont **sérialisées** par verrouillage de la ligne
`template_version` (ou mécanisme équivalent) avant validation. Sans cela, deux transactions
pourraient chacune voir l'autre section comme racine et valider simultanément `A → B` et
`B → A`. Le contrôle « un seul niveau » doit être réévalué sous ce verrou.

La suppression d'une version ou d'un gabarit doit continuer de cascader sur tout l'arbre. Ce
parcours est testé explicitement après l'ajout de l'auto-référence ; les gardes de section ne
doivent pas confondre cette cascade globale avec la suppression isolée d'un bloc.

### 4.4 Une garde supplémentaire, à ne pas oublier

`template_field.section_id` est `on delete set null`, mais la garde actuelle refuse déjà la
suppression d'une section non vide. La nouvelle garde répond à un autre risque : une section
vidée de ses variables mais encore nommée par `then.section` laisserait une règle orpheline,
susceptible de se rattacher silencieusement si la même clé était recréée.

Exiger donc : **la suppression ou la transformation en sous-section d'un bloc qui est la cible
d'une règle d'affichage est refusée** tant que la règle existe. Le message nomme la section,
jamais une donnée clinique.

### 4.5 Rattachement des variables

`template_field.section_id` peut désigner **un bloc ou une sous-section**, ou être explicitement
nul pour le tronc commun. L'éditeur propose ce dernier choix et les contrats TypeScript/RPC
acceptent `section: null` sans le confondre avec un code inconnu.

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
liste plate de sections. Pour que cette vue reste déterministe, `display_order` conserve un
ordre total en préordre dans la version, même si le client récent réordonne par fratrie. Un
champ commun porte `section = null` ; le client actuel le place sur son filet « Autre », donc il
reste visible sans être présenté comme un bloc spécialisé.

À **vérifier**, pas à supposer : le trigger de synchronisation existant doit continuer de
fonctionner sur les deux niveaux, distinguer le détachement intentionnel du code ancien non
résolu et ne jamais créer silencieusement un état hybride.

### 4.7 Recopie d'une version

La primitive commune `copy_template_fields` passe à **deux passes** :

1. insérer toutes les sections de la version source, comme aujourd'hui, par `section_key` ;
2. une fois toutes les sections présentes dans la version cible, résoudre
   `parent_section_id` en rapprochant la `section_key` du parent source.

Un rattachement en une seule passe échouerait ou produirait un pointeur vers l'ancienne version
selon l'ordre d'insertion. Redéfinir dans une nouvelle migration **la version courante de
`copy_template_fields`**. Les wrappers `duplicate_template_version`,
`create_next_personal_template_version`, `promote_template_to_global` et
`create_base_from_model_observation` appellent déjà cette primitive : ne les redéfinir que si
la lecture de leur version courante établit un besoin réel. Le chemin explicite de
`create_template_bundle` doit, lui, accepter pour chaque section un `parentKey` nullable et
résoudre les parents après l'insertion de toutes les sections.

**Aucune section d'une version ne doit jamais pointer vers une section d'une autre version.**

### 4.8 Éditeur

- Créer une sous-section sous un bloc existant ; le payload porte une clé stable `parentKey`,
  jamais un UUID provenant d'une autre version.
- Proposer explicitement « Tronc commun » comme position d'une variable.
- Conserver la RPC historique de réordonnancement pour les clients plats. Ajouter une commande
  serveur atomique de réordonnancement des **frères** et une commande atomique de déplacement ;
  le navigateur ne réalise jamais ces opérations par plusieurs écritures indépendantes. Avant
  commit, chaque commande renumérote toute la version selon le préordre canonique afin que
  `display_order` reste aussi un ordre total cohérent pour les anciens clients.
- La RPC plate historique garde son comportement exact sur une version plate. Sur une version
  hiérarchique, elle ne reparente jamais une section : elle reprend seulement l'ordre relatif
  demandé entre frères, puis recalcule le préordre canonique.
- Déplacer une section d'un niveau à l'autre uniquement sur une version encore inutilisée, sous
  verrou de version, puis revalider toutes les règles de visibilité avant commit.
- Distinguer visuellement les deux niveaux, sans laisser croire qu'une sous-section peut porter
  une règle.

L'instantané hors-ligne transporte `parentSectionKey` dans `sections` et
`sectionsByVersion`. Le client actuel ignore ce champ supplémentaire ; le client récent le
conserve et reconstruit le même arbre en ligne et hors ligne.

## 5. L52 — Visibilité au niveau bloc

> **Dépend de L51 et L54.** L54 définit le bloc racine ; L51 apporte le « ou » multivalué utilisé
> par le pilote diagnostique et les variables partagées. Livrer L52 avant eux créerait un contrat
> incomplet, ou des règles visant n'importe quelle section qu'il faudrait restreindre après coup.

### 5.1 Problème résolu

Une règle d'affichage vise `then.field`, jamais une section. Simuler 12 blocs de 20 variables
impose donc environ **240 règles**. La visibilité de bloc ramène ce chiffre à **12**.

Le mode de défaillance actuel aggrave le problème : une règle oubliée n'échoue pas, elle
**affiche la variable à tout le monde**.

### 5.2 Contrat

```json
{ "if":   { "field": "situations_cliniques", "operator": "contains_any", "value": ["tuberculose"] },
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
  Une variable partagée entre plusieurs valeurs du même pilote y porte sa propre règle de champ
  `contains_any` ; elle n'est jamais placée dans un bloc qui la masquerait pour l'un de ses
  autres usages. Le partage entre pilotes différents reste hors de la v1.
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

Ces propriétés sont des **invariants de la version**, pas seulement des contrôles à la création
de la règle. Une fonction serveur unique valide l'ensemble du graphe et est appelée :

- après l'ajout ou la modification d'une règle ;
- après l'ajout, le déplacement ou la modification de scope d'une variable ;
- après le rattachement ou le déplacement d'une sous-section ;
- après une modification des options d'un pilote `contains_any` ;
- une dernière fois par `publish_template_version`.

Une opération atomique portant plusieurs mutations peut valider à la fin de sa transaction ;
une écriture directe autorisée doit néanmoins être couverte par un trigger. Aucun état publié ne
peut dépendre de l'ordre des actions dans l'éditeur.

### 5.5 Acyclicité

`assert_visibility_acyclic` doit être étendue : une règle de bloc crée une arête du pilote vers
**chaque variable du bloc, sous-sections comprises**. Un cycle existe si, en remontant les
dépendances depuis le pilote, on retombe sur une de ces variables.

C'est la partie la plus délicate du lot : elle doit rester vérifiée **à l'enregistrement de la
règle**, puis être réévaluée après toute mutation qui change implicitement les arêtes du graphe.
Les mutations sont sérialisées par version comme en L54, afin que deux déplacements concurrents
ne valident pas chacun un graphe périmé.

### 5.6 Effacement — rayon d'action

Les variables d'un bloc masqué suivent le sort des variables masquées : leur valeur est
effacée, l'interface annonçant le nombre **avant** l'enregistrement.

À 20 variables par bloc, un décochage efface 20 valeurs d'un coup, réparties sur plusieurs
sous-sections. **Vérifier que le décompte annoncé couvre l'intégralité du bloc**, sous-sections
comprises, et pas seulement les variables visées nommément par une règle. Un effacement non
annoncé serait une régression grave.

Le serveur refuse une valeur appartenant à un **bloc masqué quel que soit le statut** de la
fiche, brouillon compris. Ce durcissement ne s'applique qu'aux nouvelles règles de bloc : une
règle de bloc ne pouvant être ajoutée à une version portant déjà des données, aucune valeur
historique n'est réécrite ni invalidée au déploiement. Le comportement historique des règles de
champ reste hors de ce lot. Le refus est structuré et indique qu'un client obsolète doit être
rafraîchi ; le serveur n'efface jamais à la place de l'utilisateur.

Pour le parcours diagnostique, retirer un diagnostic qui masque des valeurs exige un aperçu
et une confirmation explicite avant soumission. Annulation ou conflit ne perd aucune saisie.
Ne pas effacer au simple changement du sélecteur ; conserver la décision serveur de refus
des valeurs non applicables. Voir L52 amendé dans le complément de collecte.

### 5.7 Rendu

- Un bloc dont toutes les variables sont masquées ne doit rien rendre — ni titre, ni cadre.
- Une sous-section sans aucune variable visible ne doit rien rendre non plus.

À vérifier sur le rendu existant, et à corriger dans ce lot si ce n'est pas déjà le comportement.

### 5.8 Déploiement et clients non rafraîchis

Le client actuel exige `then.field` et ignore donc une règle portant `then.section` : il montre
le bloc que le serveur considère masqué. Le support serveur additif est d'abord déployé sans règle
de bloc active, puis le frontend et le support PWA de la hiérarchie ; aucune version utilisant une
règle de bloc n'est publiée avant cette seconde étape. Le filet serveur sur les brouillons empêche
ensuite un ancien client de persister des valeurs sous un bloc masqué.

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
blockKey      // bloc racine ; égal à `section` quand la section est plate ; null au tronc commun
blockLabel    // null au tronc commun
```

Pour une base à sections plates, `blockKey === section` : la compatibilité descendante est
acquise par construction. Pour un champ commun ou un rattachement ancien non résolu,
`blockKey` est nul et le champ reste toujours exporté.

Le dictionnaire XLSX gagne les colonnes **bloc** et **libellé du bloc** lorsqu'une projection
est demandée ou que la cohorte contient au moins une sous-section. Sur une base historique à
sections plates, sans `sectionProjection`, ces colonnes ne sont pas ajoutées : la structure de
sortie reste strictement identique à celle d'avant L53.

### 6.4 Sémantique normative

- Le filtre porte sur **`blockKey`**, jamais sur la feuille.
- Les variables **sans section** sont **toujours** exportées, quelle que soit la projection.
  Elles ne se listent pas dans `blockKeys` et ne peuvent pas être retirées.
- Les variables partagées suivent cette règle : leur colonne est présente dans toutes les
  projections, mais leur règle de champ garantit qu'aucune valeur ne subsiste pour un patient
  auquel elles ne s'appliquent pas.
- La **population n'est jamais filtrée** par la projection : c'est la cohorte qui définit les
  lignes. Un patient ne relevant d'aucun bloc sélectionné ressort avec ses seules colonnes
  communes renseignées.
- Le handler conserve deux tableaux : `allFields`, fusionné mais non projeté, pour valider et
  calculer les formules ; `projectedFields`, filtré depuis `allFields`, pour les colonnes, le
  dictionnaire, `Modalités`, les feuilles multivaluées, les limites et la garde anti-identité.
  Les index d'opérandes de formule sont construits depuis `allFields`, par scope, même si seuls
  les résultats de `projectedFields` sont restitués.
- La projection résolue est journalisée dans `export_log.export_options` — automatique, les
  options y étant déjà déversées.

### 6.5 Contrôles

Pour `mode: "selected"`, refuser l'export avant génération, avec une erreur structurée :

- `mode: "selected"` avec `blockKeys` absent ou vide ;
- une clé inconnue de **toutes** les versions présentes dans la cohorte ;
- une clé qui désigne une **sous-section** dans au moins une version où elle existe, ou dont le
  rôle racine/sous-section diverge entre versions.

Lorsque la projection est `selected` **ou** que la présence d'une sous-section ajoute les
métadonnées de bloc au dictionnaire, refuser également :

- une même variable analytique — couple `(scope, field_key)` — rattachée à des blocs différents
  selon les versions présentes, **y compris un passage tronc commun ↔ bloc**.

Ce dernier point mérite une explication. La fusion des variables d'export se fait par
`(scope, field_key)` et retient la section de la **première version rencontrée**. Une variable
ayant changé de bloc, ou étant passée du tronc commun à un bloc, serait donc classée
arbitrairement sans que rien ne le signale. Le refus transforme un résultat faux et silencieux
en une erreur visible, pour un coût négligeable.

Le contrôle porte sur le **bloc**, pas sur la feuille : déplacer une variable d'une
sous-section à une autre **à l'intérieur du même bloc** ne doit pas provoquer de refus.

Sur une base historique plate, sans `sectionProjection`, ces nouveaux contrôles de bloc ne sont
pas activés : même une variable anciennement déplacée entre sections continue de suivre le contrat
d'export historique. Aucun bloc n'influence alors ni la sélection ni les colonnes du dictionnaire.

Un traitement complet — un bloc par version, sur le modèle de ce qui est déjà fait pour les
formules, qui ne fusionnent délibérément pas — est une **suite possible**, pas une exigence de
ce lot. L53 doit néanmoins refuser toute ambiguïté au lieu de dépendre de l'ordre de lecture.

### 6.6 Interface

Dans l'écran d'export : la liste des **blocs** présents dans la cohorte, sélectionnables. Les
sous-sections ne sont pas proposées séparément — elles suivent leur bloc. Les variables sans
section sont mentionnées comme toujours incluses et ne sont pas décochables. Traductions
française et anglaise.

Une clé absente de certaines versions mais racine dans toutes celles où elle existe reste
sélectionnable. Si son libellé varie, l'interface affiche celui de la version courante et signale
que plusieurs libellés historiques existent ; la clé stable reste la valeur envoyée.

Pour une collecte configurée par L55, le pilote diagnostique reste dans le tronc commun
exporté. Un diagnostic non couvert ne constitue pas une cause d'exclusion : seules les
règles de complétude applicables décident. L56 fournit la preuve intégrée de ce comportement.

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
L51 ───────────────┐
                   ├──→ L52
L54 ───────────────┘
  └──────────────────→ L53   (parallélisable avec L52 une fois L54 fusionné)
```

| Lot | Dépend de | Peut tourner avec |
|---|---|---|
| **L51** | — | L54 |
| **L54** | — | L51 |
| **L52** | **L51 et L54** | L53 |
| **L53** | **L54** | L52 |

Le parcours complet ajoute **L55 après L51/L54/L52**, puis **L56 après L55**, avec preuve
d'export après L53. **L57** est un cadrage différé. Ordre recommandé à un agent :
L51 → L54 → L52 → L55 → L56 → L53 → preuve pilote → cadrage L57. L53 peut être avancé après L54.
L55 entre en collision avec les règles, types et copies de L51/L52/L54 ; L56 avec les
formulaires de L41/L42 et les travaux offline. Les possibilités de parallélisation du tableau
ne constituent pas une consigne de créer des agents.

Déploiement commun aux quatre lots : **extension serveur additive et dormante**, puis client/PWA
compatible, puis seulement activation dans l'éditeur et publication d'un gabarit utilisant les
nouveaux contrats. Une release coordonnée peut regrouper les deux premières étapes, mais
l'activation reste dernière. Le frontend ne doit jamais dépendre d'une colonne ou d'une RPC
absente, et une migration seule ne doit modifier aucun formulaire existant.

- **L51 et L52 écrivent tous deux** dans le moteur de règles,
  `src/domain/templateRules.ts`, `src/domain/validation.ts` et
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
- Identité patient partagée ou liaison automatique entre bases de gouvernance différente.
- Expression booléenne générale entre plusieurs champs pilotes (`OR`/groupes de conditions).
- Détection par familles/ancêtres CIM : différée. L'association exacte de codes aux blocs
  est incluse dans L51/L55 ; ne pas la confondre avec ce chantier.
- Plus d'un niveau de sous-section.
- Règle d'affichage portée par une sous-section.
- `required` au niveau d'un bloc ou d'une sous-section.
- Filtre de cohorte par bloc : la cohorte continue de filtrer sur les champs, conformément à D7.
- Reprise des bases par pathologie existantes.
- Groupes répétables dans la fiche patient.
- Rattachement plusieurs-à-plusieurs d'une variable à des projections de blocs. La v1 place les
  variables partagées dans le tronc commun et accepte leur présence comme colonnes dans toutes
  les projections ; ne reprendre ce chantier que si les bases pilotes prouvent que cette
  dispersion résiduelle est gênante.

## 9. Plan de tests

### 9.1 PostgreSQL et RLS

**L51**

1. `contains_any` sur pilote multivalué : un élément correspond, aucun élément ne correspond,
   pilote vide.
2. `contains_any` sur pilote scalaire : correspondance et non-correspondance.
3. Pilote absent, `null`, ou valeur manquante codifiée : condition fausse dans les trois cas.
4. Refus à la définition : pilote de type incompatible, `value` vide, code hors des options.
5. Modification ultérieure des options : retirer un code encore référencé est refusé ; une
   mise à jour sans rapport reste permise. Une valeur de cible masquée par `contains_any` est
   refusée en brouillon, `complete` et `curated`, sans changer les règles historiques.

**L54**

6. Parent appartenant à une autre version : refusé par la FK composite.
7. Sous-section prise comme parent : refusé (un seul niveau).
8. Auto-parenté : refusée.
9. Deux reparentages concurrents `A → B` / `B → A` : un seul peut réussir ; aucun cycle final.
10. Suppression d'un bloc portant des sous-sections : refusée ; suppression de version et de
    gabarit : cascade complète toujours possible.
11. Suppression ou transformation en sous-section d'un bloc cible d'une règle : refusée.
12. Recopie de version : parents remappés par `section_key`, aucun pointeur inter-versions ;
    à vérifier sur **les six** voies de duplication.
13. Miroir texte : porte la clé de la feuille aux deux niveaux ; tronc commun canonique avec
    `section_id` et `section` nuls ; ancien code non résolu conservé sur le filet.
14. Variable attachée directement à un bloc possédant des sous-sections : acceptée.
15. Ordre par niveau et préordre total déterministe pour un ancien client.
16. Payload `parentKey`, réordonnancement de frères et déplacement : transaction atomique,
    renumérotation globale en préordre et rollback complet sur erreur.
17. Instantané en ligne/hors-ligne : même arbre ; un ancien instantané plat reste lisible.
18. RPC plate historique : résultat inchangé sur une version plate ; sur une hiérarchie, aucun
    reparentage implicite et préordre final canonique.

**L52**

19. Bloc masqué ⇒ toutes ses variables masquées, sous-sections comprises.
20. Variable sans section : jamais masquée par une règle de bloc ; sa propre règle continue de
    s'appliquer.
21. Cumul : variable dont le bloc est visible mais dont la règle propre échoue ⇒ masquée.
22. Cascade : pilote lui-même masqué ⇒ bloc masqué ; le point fixe converge.
23. Refus à la définition : clé inconnue, clé désignant une sous-section, pilote interne au bloc
    (sous-sections comprises), scopes mélangés.
24. Après création de la règle : déplacements de champ/section, changement de scope ou d'options
    qui rendraient le graphe invalide sont refusés, y compris sous concurrence.
25. Cycle détecté à l'enregistrement et à toute mutation ultérieure des arêtes implicites.
26. Une variable masquée par bloc n'est jamais exigée par la complétude.
27. Refus serveur, brouillon compris, d'une fiche portant la valeur d'une variable d'un bloc
    masqué ; aucune valeur historique n'est réécrite.
28. Gel de version : refus d'ajout d'une règle sur une version portant des données.
29. Duplication : règles de bloc recopiées par clé stable et résolues dans la nouvelle version.

### 9.2 Domaine et frontend

- Parité stricte serveur / client de `contains_any`, sur les mêmes jeux de valeurs.
- Client ancien : cible montrée, enregistrement d'une valeur masquée refusé avec demande de
  rafraîchissement explicite.
- Rendu à deux niveaux : variables directes du bloc avant les sous-sections, ordre respecté.
- Tronc commun créable explicitement et rendu avant les blocs ; variable partagée conditionnelle
  rendue une seule fois.
- Bloc entièrement masqué non rendu, titre compris ; sous-section sans variable visible non
  rendue.
- Décompte des valeurs effacées couvrant **l'intégralité du bloc**, sous-sections comprises.
- Éditeur : création d'une sous-section, réordonnancement par niveau, déplacement entre niveaux
  refusé sur une version déjà utilisée, refus lisibles.
- Éditeur de règles : choix d'un bloc comme cible, sous-sections non proposées, choix de
  plusieurs valeurs d'un même pilote.
- Sélecteur de projection : blocs seuls proposés, variables sans section non décochables.
- Traductions française et anglaise.

### 9.3 Edge Function d'export

- Export sans projection : strictement identique à aujourd'hui.
- Base à sections plates : `blockKey === section`, aucun changement de sortie ni de colonnes du
  dictionnaire tant qu'aucune projection n'est demandée.
- Base historique plate, variable déplacée entre deux sections au fil des versions, sans
  projection : l'export continue de réussir comme avant L53.
- Projection d'un bloc, puis de plusieurs.
- Variables d'une sous-section incluses quand leur bloc est sélectionné.
- Variables sans section toujours présentes.
- Population inchangée : un patient hors des blocs sélectionnés reste une ligne.
- Dictionnaire portant les deux niveaux ; `Modalités` et métadonnées cohérents.
- Garde anti-identité appliquée au jeu de colonnes filtré.
- Refus : `blockKeys` vide, clé inconnue, clé désignant une sous-section, `field_key` à blocs
  divergents entre versions, passage tronc commun ↔ bloc, rôle racine/feuille divergent.
- **Non-refus** : variable déplacée d'une sous-section à une autre dans le même bloc.
- Variable calculée projetée dont les deux opérandes vivent dans des blocs non projetés : valeur
  toujours calculée, opérandes absents des colonnes restituées.
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
- **AC-2** — Une variable utile à deux blocs pilotés par le même champ reste unique dans le
  **tronc commun** et est décrite par une règle de champ nommant deux valeurs déclencheuses.
  L'ajout d'un troisième cas d'usage sur ce pilote étend la règle sans déplacer ni dupliquer la
  variable. Sa colonne reste commune à toutes les projections.
- **AC-3** — Douze blocs de vingt variables se définissent avec **douze** règles, quel que soit
  le nombre de sous-sections.
- **AC-4** — Un bloc contient des sous-sections ordonnées ; aucune sous-section ne peut avoir
  d'enfant, porter une règle, ni pointer vers une autre version.
- **AC-5** — La duplication d'une version reproduit la hiérarchie complète des sections et
  rattache les variables aux nouvelles sections, sur les six voies de duplication.
- **AC-6** — Un bloc masqué n'affiche rien, n'exige rien, et le nombre de valeurs à effacer,
  sous-sections comprises, est annoncé avant l'enregistrement.
- **AC-7** — Le serveur refuse une fiche portant la valeur d'une variable d'un bloc masqué, y
  compris en brouillon, sans étendre rétroactivement ce changement aux règles de champ existantes.
- **AC-8** — Supprimer une section cible d'une règle est refusé : aucune variable ne peut
  devenir du tronc commun par détachement silencieux.
- **AC-9** — Un export « tronc commun + un bloc » contient les variables de toutes les
  sous-sections de ce bloc, laisse la population inchangée, reste pseudonymisé et journalise sa
  projection.
- **AC-10** — Lorsqu'une projection est sélectionnée ou que le dictionnaire expose la hiérarchie,
  un couple `(scope, field_key)` rattaché à des blocs différents selon les versions — y compris
  tronc commun ↔ bloc — provoque un refus explicite ; un déplacement entre sous-sections d'un même
  bloc n'en provoque pas. Un export historique plat sans projection reste inchangé.
- **AC-11** — Aperçu client et décision serveur coïncident sur `contains_any` pour tous les jeux
  de valeurs testés ; un client obsolète ne peut persister une valeur de cible masquée, même en
  brouillon.
- **AC-12** — Une formule projetée reste calculable quand ses opérandes appartiennent à des blocs
  non projetés ; ces opérandes ne deviennent pas pour autant des colonnes de sortie.
- **AC-13** — Toute mutation de champ, section, option ou règle laisse la version dans un état où
  les règles de bloc sont résolues, de même scope et acycliques, y compris sous concurrence.

### Complément de validation terrain du 2026-09-05

Les tests L51 couvrent aussi les objets de terminologie simples et multiples, les codes
exacts, les libellés modifiés, les formes invalides et la release de référence. Les tests
L52 couvrent le retrait de diagnostic avec aperçu, confirmation, annulation et conflit.
Les tests L53 couvrent un diagnostic non couvert toujours exportable lorsque les données
requises applicables sont présentes. L55/L56 et les limites de L57 sont spécifiés dans
[la collecte diagnostique](spec-collecte-diagnostique.md).
