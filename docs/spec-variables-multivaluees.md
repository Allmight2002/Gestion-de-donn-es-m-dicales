# Spécification — Variables à valeurs multiples

- Statut : 🚧 **implémentation en cours** — socle PostgreSQL L20 livré localement le 2026-08-16 ;
  saisie, export, import, cohortes, conflit hors-ligne et conversion L21 à L26 encore à livrer
- Migration : `20260818045033_multivalue_terminology_foundation.sql`
- Surface serveur : `assert_data_valid`, `jsonb_matches`, `base_completeness_stats`,
  Edge Function `generate-export`
- Surface web : `FieldForm`, `FieldInput` / `ValueInput`, `TerminologyInput`, `CohortBuilder`
- Périmètre autorisé : données fictives uniquement, comme le reste du produit

---

## 1. Besoin

Un patient peut porter plusieurs diagnostics. Aujourd'hui, le seul contournement disponible est
de créer autant de variables que de valeurs attendues : `diagnostic_1`, `diagnostic_2`,
`diagnostic_3`.

Trois conséquences :

1. **Le maximum doit être deviné à l'avance.** Un patient qui porte cinq diagnostics n'entre pas
   dans un formulaire qui en prévoit trois.
2. **Les patients déjà saisis portent des colonnes vides permanentes**, indiscernables d'une
   absence réelle de diagnostic.
3. **L'analyse est dispersée.** Compter les hématomes extraduraux oblige à balayer trois colonnes,
   et un même diagnostic tombe dans `diagnostic_1` chez l'un et `diagnostic_2` chez l'autre.

Le troisième point est le plus coûteux : il touche l'exploitation scientifique, qui est la finalité
du registre.

## 2. Décision : variable multivaluée, pas groupe répétable

Deux besoins voisins sont souvent confondus. Cette spécification n'en traite **qu'un seul**.

| Besoin | Exemple | Solution |
|---|---|---|
| Plusieurs valeurs, chacune réduite à son identité | trois diagnostics | **Cette spécification** |
| Plusieurs occurrences, chacune portant ses propres attributs | deux interventions, chacune avec sa date, son type, son indication | Groupe répétable — spécification distincte |

**Critère de bascule.** Dès qu'une occurrence porte **deux attributs propres ou plus**, la variable
multivaluée ne suffit plus et le groupe répétable devient nécessaire. Un attribut unique
(le rang, porté par l'ordre) reste dans le périmètre présent.

Le rang couvre le cas « diagnostic principal » : la première valeur de la liste. Cette convention
évite de créer une variable supplémentaire pour la porter.

**Le modèle d'observation `event_registry`**, déclaré sur `base` depuis
`20260801185149_observation_model_base.sql`, n'a aujourd'hui aucun comportement propre. C'est le
futur moteur de groupes répétables qui lui en donnera un — pas la présente spécification.

## 3. Décisions de conception

| Décision | Conséquence |
|---|---|
| Un attribut `is_multiple` sur `template_field`, pas un nouveau type | Aucune branche à dupliquer dans les 41 fichiers qui lisent `template_field` ; la contrainte `template_field_type_check` reste inchangée. |
| `is_multiple` réservé au type `terminology` | `multiselect` couvre déjà les listes fermées recopiées dans le gabarit. Deux façons de faire la même chose seraient une dette. |
| Les valeurs restent dans `patient.data` / `encounter.data` | RLS, écriture RPC exclusive, verrou optimiste, journal des corrections, hors-ligne et audit s'appliquent sans modification. |
| L'ordre du tableau est le rang | Il est conservé tel que saisi ; le serveur ne réordonne jamais. |
| Codes en double refusés | Sans cette règle, `nb_diagnostics` et les colonnes indicatrices deviennent faux. |
| Tableau vide refusé | Une seule représentation de « pas de valeur » : la clé est absente, ou elle porte un code de donnée manquante. |
| Longueur bornée à 50 | Borne serveur contre une charge non maîtrisée ; suffisante pour tout usage clinique observé. |

## 4. Modèle de données

Migration additive :

```sql
alter table public.template_field
  add column is_multiple boolean not null default false;

alter table public.template_field
  add constraint template_field_multiple_terminology_only
  check (not is_multiple or type = 'terminology');
```

Aucune donnée existante n'est touchée : la valeur par défaut reproduit le comportement actuel.

Valeur stockée pour un champ `terminology` multivalué :

```json
{
  "diagnostic": [
    { "code": "S06.4", "label": "Hématome extradural" },
    { "code": "S72.0", "label": "Fracture du fémur" }
  ]
}
```

Un code de donnée manquante reste possible et **remplace** le tableau :

```json
{ "diagnostic": { "__missing__": "non_fait" } }
```

## 5. Validation serveur

`assert_data_valid` (version courante :
`20260728043556_preserve_historical_terminology.sql`) reçoit une branche supplémentaire. La
lecture de `template_field` doit désormais inclure `is_multiple`.

Ordre d'évaluation, inchangé : la branche `__missing__` reste évaluée **avant** la branche de
type, donc un code de donnée manquante continue de fonctionner sans traitement particulier.

Pour un champ `terminology` avec `is_multiple = true` :

1. `jsonb_typeof(v) = 'array'`, sinon → *« Liste de diagnostics attendue pour "%" »* ;
2. `jsonb_array_length(v)` compris entre 1 et 50 ; `0` → *« Liste vide : retirez la variable ou
   indiquez une donnée manquante »* ;
3. chaque élément est un objet dont les seules clés sont `code` et `label`, tous deux chaînes non
   vides — mêmes contrôles que le cas unitaire ;
4. chaque couple existe dans `terminology_concept` avec `is_selectable`, **toutes publications
   conservées confondues** — règle identique à celle posée par
   `20260728043556` pour ne pas rendre une ancienne fiche impossible à corriger ;
5. aucun `code` répété dans le tableau → *« Diagnostic en double dans la liste »*.

Le message d'erreur nomme le libellé de la variable, jamais une valeur clinique.

## 6. Saisie

`FieldForm` (constructeur) reçoit une case **« Accepte plusieurs valeurs »**, rendue uniquement
lorsque `type = 'terminology'`. Elle est structurelle : soumise à `lockStructural`, donc modifiable
seulement tant que la version du gabarit est en `draft`.

`TerminologyInput` reçoit un mode multivalué :

- les valeurs déjà choisies s'affichent en étiquettes, chacune avec son rang et un bouton de
  retrait ;
- la zone de recherche **reste visible** sous les étiquettes au lieu d'être remplacée ;
- un concept déjà présent est écarté des résultats de recherche ;
- retirer la dernière étiquette **supprime la clé** de `data` — le client n'écrit jamais `[]` ;
- le sélecteur de code manquant de `ValueInput` est conservé tel quel.

Le cache local de terminologie et la saisie hors connexion fonctionnent sans modification : ils
portent sur la recherche, pas sur la cardinalité du champ.

## 7. Export

C'est la partie la plus exposée. `formatValue` teste `isTerminologyValue(v)` **avant**
`Array.isArray(v)` ; un tableau de couples tomberait donc dans `v.join('; ')` et produirait
`[object Object]; [object Object]` sur toute la colonne. Cette régression a déjà été rencontrée
sur les codes manquants : elle doit être couverte par un test avant toute autre chose.

### 7.1 Feuille principale

Pour un champ multivalué `diagnostic` de portée `encounter`, trois colonnes remplacent les deux
colonnes actuelles :

| Colonne | Contenu |
|---|---|
| `encounter__diagnostic` | libellés joints par `; ` — lecture |
| `terminology_code__encounter__diagnostic` | codes joints par `; ` — regroupement stable |
| `nb__encounter__diagnostic` | nombre de valeurs |

Un code de donnée manquante remplit la colonne principale avec son code (`non_fait`, `inconnu`,
`non_applicable`) et laisse `nb__…` vide — jamais `0`, qui signifierait « aucun diagnostic ».

### 7.2 Colonnes indicatrices

Une colonne `0/1` par code **effectivement présent dans l'export** :

```
has__encounter__diagnostic__s06_4
has__encounter__diagnostic__s72_0
```

- le suffixe est le code normalisé (minuscules, tout caractère hors `[a-z0-9]` remplacé par `_`) ;
- une collision de suffixes après normalisation est résolue par un indice numérique, et la
  correspondance figure au dictionnaire ;
- au-delà de **100 codes distincts**, les colonnes indicatrices ne sont pas produites et le
  dictionnaire porte la mention correspondante. La feuille dédiée reste, elle, exhaustive ;
- `assertNoIdentity` s'applique à ces colonnes comme aux autres.

### 7.3 Feuille dédiée

Une feuille par champ multivalué, nommée d'après son libellé, une ligne par valeur :

| Colonne | Contenu |
|---|---|
| `patient_code` | code du patient |
| `encounter_id` | rencontre, vide pour un champ de portée patient |
| `rang` | position dans la liste, à partir de 1 |
| `code` | code du concept |
| `label` | libellé enregistré |

C'est la forme sans perte : elle survit au seuil de 100 codes et sert les analyses par diagnostic.

### 7.4 Dictionnaire

`buildDictionary` gagne une colonne `is_multiple`, et une ligne par colonne dérivée
(`nb__…`, `has__…`) documentant sa nature calculée et le code d'origine.

## 8. Statistiques, complétude et cohortes

**Complétude.** `base_completeness_stats` teste `nullif(data ->> field_key, '') is not null`. Pour
un tableau, `->>` renvoie sa représentation textuelle : `[]` serait compté comme rempli. Le
tableau vide étant refusé à l'écriture, le cas ne devrait pas survenir ; la fonction doit
néanmoins exiger `jsonb_array_length > 0` pour un champ multivalué — défense en profondeur sur des
données antérieures à la garde.

**Cohortes.** `jsonb_matches` (évaluateur serveur, appelé par `cohort_preview` et
`create_cohort_snapshot`) reçoit deux opérateurs :

| Opérateur | Sémantique |
|---|---|
| `has_any` | au moins une valeur dont le `code` figure dans la liste fournie |
| `has_none` | aucune valeur dont le `code` figure dans la liste fournie |

Côté web, `operatorsFor` renvoie ces deux opérateurs — et **eux seuls** — pour un champ
multivalué : `eq` sur une liste n'a pas de sens et doit disparaître de l'interface plutôt que
produire un résultat faux silencieusement.

**Statistiques descriptives.** Un patient portant cinq diagnostics compte pour **un patient**.
Toute agrégation par patient doit dédupliquer avant comptage.

## 9. Import

**Hors périmètre de cette version.** L'import ne prend aujourd'hui en charge aucun champ
`terminology`, même unitaire : `src/domain/import.ts` transmet les cellules sans résoudre de
concept, et la validation serveur rejette une chaîne là où un couple est attendu.

Conséquence à assumer explicitement : une colonne mappée sur un champ multivalué doit être
**refusée au mappage** avec un message clair, plutôt que produire un échec serveur opaque en fin
d'import.

> ✅ **Ce refus est livré par L24 le 2026-08-18.** `autoMapColumns` ne propose plus aucune cible de
> type `terminology`, à valeur unique comme multiple ; le choix manuel de cette cible ne prend pas,
> et la colonne garde le mappage qu'elle avait ; l'étape de correspondance **et** le rapport
> d'import nomment les colonnes écartées pour ce motif, distinctement des colonnes ignorées
> ordinaires. L'import lui-même reste **hors périmètre** : rien ne résout un concept, et
> `buildImportRows` est inchangé — un chemin qui contournerait l'écran obtiendrait toujours le refus
> du serveur, ce qui est la place correcte pour cette garantie.

Deux points sont à noter pour la version ultérieure qui traitera l'import :

- le format d'entrée naturel est celui de la sortie — libellés séparés par `; ` dans une colonne
  unique — pour que le cycle export → correction dans un tableur → réimport soit cohérent ;
- la route « plusieurs colonnes vers un même champ » est aujourd'hui bloquée par
  `duplicateTargets`, qui traite toute cible assignée deux fois comme un conflit. La règle devrait
  être assouplie pour les seuls champs multivalués.

## 10. Hors-ligne

**Aucune modification nécessaire.** Le tableau voyage à l'intérieur de `encounter.data`, et
l'`OutboxEntry` transporte déjà l'objet `data` complet, sous garde de `baseUpdatedAt` (jeton
optimiste) et d'un `operationId` (idempotence du rejeu). Le snapshot hors-ligne et le cache de
terminologie sont inchangés.

**Amélioration recommandée, séparable.** Deux appareils hors ligne qui ajoutent chacun un
diagnostic produisent un conflit correctement détecté, mais dont la résolution actuelle est
binaire : `resolveKeepMine` écrase la valeur de l'autre. Une troisième issue, **« garder les
deux »**, réalise l'union des deux listes par `code` en préservant l'ordre local puis les
nouveautés serveur. C'est une fonction de domaine pure, testable sans base, et elle ne devient
possible que parce que chaque valeur porte un identifiant stable — son code.

Cette amélioration peut être livrée après le reste sans rien invalider.

## 11. Versionnement

`is_multiple` est un attribut de `template_field`, donc porté par `template_version`. Les gardes
existantes s'appliquent sans ajout :

- une version publiée est immuable (`Version publiee immuable : creez une nouvelle version`) ;
- chaque patient et chaque rencontre conserve son `template_version_id` ;
- `mergeExportFields` unionne déjà les versions sur `scope + field_key`, donc un export mixte
  reste possible.

Une rencontre saisie avant le changement reste lisible avec le formulaire qui était actif à sa
saisie. Rien à construire.

## 12. Regroupement des variables existantes

C'est la **seule partie qui touche des données déjà enregistrées**. Elle doit être implémentée en
dernier, après que le reste soit en service, et précédée d'une sauvegarde vérifiée.

Deux opérations distinctes, jamais fusionnées :

**a. Regrouper la variable** — crée une version de gabarit en `draft` où `diagnostic_1`,
`diagnostic_2` et `diagnostic_3` sont remplacées par un `diagnostic` multivalué. N'affecte que les
saisies futures.

**b. Convertir les enregistrements existants** — déplace les valeurs des trois clés vers le
tableau, dans l'ordre des suffixes, et rattache l'enregistrement à la nouvelle version.
Facultative, explicitement cochée, jamais déclenchée par la première.

Contraintes sur (b) :

- une fonction d'**aperçu en lecture seule** précède l'exécution et rend : nombre
  d'enregistrements concernés, valeurs non résolubles en concept du référentiel, doublons entre
  `diagnostic_1` et `diagnostic_2`, et enregistrements déjà convertis ;
- l'exécution est **transactionnelle par enregistrement** et **idempotente** : une reprise après
  interruption ne doit ni dupliquer une valeur ni reconvertir un enregistrement déjà traité ;
- chaque conversion est tracée dans `field_change_log` avec l'ancienne et la nouvelle valeur.
  La contrainte `source` de cette table devra accueillir une valeur supplémentaire dédiée —
  modification additive d'une contrainte `check` sur une table portant des données, à traiter avec
  la procédure `meddata-db-safety` ;
- une valeur non résoluble **bloque** la conversion de l'enregistrement concerné et est rapportée,
  plutôt que d'être écartée silencieusement.

**Recommandation.** Regrouper sans convertir laisse coexister les deux formes : anciennes
rencontres en `diagnostic_1/2/3`, nouvelles en `diagnostic`, et un export coupé en deux. Tant que
les bases ne contiennent que des données fictives, la conversion est sans risque et il n'y aura
pas de meilleur moment.

## 13. Couverture de test exigée

**Base de données** (`test/`)

- écriture d'une liste valide, à 1 puis à N valeurs ;
- refus : tableau vide, code en double, élément sans `label`, clé surnuméraire, concept inexistant,
  couple code/libellé incohérent, plus de 50 valeurs ;
- code de donnée manquante accepté à la place du tableau, et refusé si
  `allow_missing_codes = false` ;
- `is_multiple = true` refusé sur un type autre que `terminology` ;
- concept issu d'une publication conservée mais non active : accepté ;
- complétude : une liste non vide compte comme renseignée, un code manquant ne compte pas ;
- cohortes : `has_any` et `has_none` sur des listes de tailles 0, 1 et N ;
- RLS : aucune régression sur les politiques de `patient` et `encounter` — ce lot n'introduit
  aucune table.

**Contrat d'export** (`supabase/functions/generate-export/exportContract_test.ts`)

- **non-régression `[object Object]`** sur la colonne principale et sur la colonne de codes ;
- `nb__…` correct, et vide en présence d'un code manquant ;
- colonnes indicatrices : génération, normalisation des suffixes, collision, seuil de 100 ;
- feuille dédiée : rangs, portée patient sans `encounter_id`, ordre stable ;
- dictionnaire : `is_multiple` et lignes des colonnes dérivées ;
- export mixte v1 / v2 : une rencontre antérieure au regroupement reste correctement rendue.

**Web** (`src/**/*.test.tsx`)

- ajout, retrait, ordre des étiquettes ; retrait de la dernière valeur supprimant la clé ;
- un concept déjà choisi n'est plus proposé ;
- la case du constructeur n'apparaît que pour `terminology` et se verrouille hors `draft` ;
- `CohortBuilder` n'offre que `has_any` et `has_none` sur un champ multivalué.

## 14. Risques résiduels

| Risque | Traitement |
|---|---|
| `[object Object]` à l'export | Test de non-régression écrit **avant** l'implémentation |
| Explosion du nombre de colonnes indicatrices | Seuil de 100, feuille dédiée exhaustive en repli |
| Perte d'une valeur lors d'une synchronisation concurrente | Conflit déjà détecté ; issue « garder les deux » recommandée |
| Conversion des données historiques | Aperçu obligatoire, opt-in, idempotente, journalisée, sauvegarde préalable |
| Confusion avec les groupes répétables | Critère de bascule fixé au §2 ; spécification distincte à venir |

---

*Cette spécification décrit la cible complète. Pendant l'exécution séquentielle de L20 à L26, le
statut en tête et les migrations indiquent la partie réellement disponible.*
