# L55 — configuration diagnostique et couverture versionnées

Implémentation locale du contrat de [la collecte diagnostique, §3](spec-collecte-diagnostique.md#3-l55--configuration-diagnostique-et-couverture-versionnées).
Le lot s'appuie sur [L51](l51-contains-any.md), sur la hiérarchie de sections L54 et sur la
visibilité au niveau bloc L52. Il n'ajoute ni table de diagnostics patient, ni statut clinique,
ni écran de saisie : l'enregistrement et le suivi appartiennent à L56.

## Contrat de configuration

`template_version.diagnosis_configuration` est un tableau JSON, vide par défaut, d'au plus un
pilote par `scope`. Une configuration absente rend le comportement historique inchangé.

```json
[
  {
    "scope": "encounter",
    "diagnosisFieldKey": "diagnostics",
    "terminologyReleaseId": "aaaaaaaa-0000-0000-0000-000000000001",
    "commonOnlyCodes": ["CODE_SOCLE_SUFFISANT"]
  }
]
```

Les codes et l'identifiant ci-dessus sont fictifs. Le couple `(scope, field_key)` identifie le
pilote, jamais son libellé. Le pilote appartient au tronc commun du même scope — aucune section —
n'a pas de formule et n'est masqué par aucune règle. `terminologyReleaseId` est obligatoire pour un
pilote terminologique, doit désigner une publication locale existante, et est nul pour `select` et
`multiselect`, dont les options versionnées tiennent lieu de référentiel. Toute règle `contains_any`
de ce pilote doit porter la même publication : aucun recours implicite à la publication active.

**Une seule source pour les associations : les règles L52.** L'éditeur présente une association au
responsable mais écrit une règle `contains_any` canonique par bloc racine — codes alternatifs dans
une liste unique, jamais dans plusieurs règles qui se cumuleraient en ET. Un bloc associé à ce
parcours ne porte aucune autre condition de bloc, ce que le serveur refuse explicitement ; les
conditions de champs internes restent autorisées et les blocs génériques restent indépendants.
Plusieurs blocs peuvent citer le même code. Un bloc sans variable saisissable du bon scope ne peut
pas déclarer un code couvert.

`commonOnlyCodes` exprime une décision explicite : un code qui cible un bloc ne peut pas y figurer.
Tous les codes du référentiel n'ont pas à être configurés. Un diagnostic absent du référentiel suit
la soupape de proposition F5 existante — le champ compagnon `<pilote>_autre`, qui doit exister,
rester facultatif, hors section et sans règle. L55 le transporte et ne le duplique jamais.

## Résultat de couverture

`public.diagnosis_coverage(version, scope, data)` et `calculateDiagnosisCoverage` rendent le même
résultat par diagnostic, puis les compteurs du dossier :

| Résultat | Définition |
|---|---|
| `covered` | Au moins un bloc est associé à ce code dans cette version |
| `common_only` | Le responsable a déclaré que le socle suffit |
| `uncovered` | Code reconnu, sans bloc ni décision de socle suffisant |
| `unclassified` | Proposition diagnostique non encore rattachée à un code |

Le calcul dérive des valeurs, des règles et de la version du dossier : aucune table de statut, aucun
drapeau modifiable par le navigateur, aucun libellé ni texte de proposition dans le résultat. La
comparaison porte sur les codes exacts et une forme invalide n'active rien, exactement comme L51.
L'absence de diagnostic ne produit aucune ligne : c'est une question de saisie. La couverture ne
remplace jamais `draft`/`complete`/`curated` et ne prouve la complétude d'aucun bloc.

## Intégrité et sécurité

La migration est additive et ne réécrit aucune fiche. Les permissions d'édition sont celles du
gabarit (`owns_template`) et la RLS de `template_version` s'applique sans nouvelle politique. Toute
mutation de champs, de sections, de règles ou de la configuration revalide l'ensemble sous le verrou
de version existant : `validate_template_version_invariants` appelle désormais aussi la validation
diagnostique. La configuration gèle à la publication et dès qu'une version est utilisée.

Les six voies de recopie partagent `copy_template_fields`, qui recopie la configuration par valeur —
aucun pointeur vers une autre version. Une recopie forçant le scope patient refuse une configuration
`encounter` plutôt que de la transformer en silence. Une publication déjà référencée par une
configuration est gelée : ni suppression, ni ajout ou retrait de concept, ni changement de `code` ou
de sélectionnabilité. Les libellés et l'indicateur de publication active restent librement
modifiables, car ils n'entrent jamais dans l'appartenance.

## Conséquence de charge à surveiller avant activation

Distinguer `uncovered` d'un code étranger à la publication exige la liste des codes
sélectionnables de cette publication, et le calcul doit rendre le même résultat en SQL et en
TypeScript : `get_diagnosis_context` transporte donc `recognizedCodes`. Pour un pilote `select` ou
`multiselect`, c'est la liste d'options, courte. Pour un pilote terminologique, c'est la publication
entière — un référentiel réel se compte en dizaines de milliers de codes.

La lecture d'une version paie ce volume une fois, en mémoire. L'instantané hors-ligne le paie **par
version présente dans la base**, y compris lorsque plusieurs versions partagent la même publication.
Aucune configuration n'existe tant qu'un responsable n'en crée pas, donc rien n'est payé aujourd'hui ;
mesurer ce volume sur un référentiel réel reste un prérequis avant d'activer un pilote terminologique
sur une base dont l'instantané hors-ligne est utilisé. Réduire ce transport demanderait un contrat
distinct — codes indexés par publication plutôt que par version — hors du périmètre de ce lot.

## Compatibilité et activation

Un client qui ignore ce contrat reçoit un refus explicite, jamais un mode permissif silencieux : il
n'annonce pas l'en-tête `x-meddata-diagnosis-contract`, et le serveur refuse alors de configurer un
pilote, de recopier une version qui en porte un et d'écrire une fiche dont la version en porte un
pour le scope concerné. Le message demande une actualisation ; le détail JSON porte
`{ "code": "DIAGNOSIS_CLIENT_UNSUPPORTED", "action": "refresh_required" }` et aucune valeur clinique.

**Le sens inverse est tenu aussi.** Un frontend L55 posé devant un serveur qui n'a pas encore reçu
la migration ne doit pas casser la consultation d'un gabarit historique. `getVersion` lit donc la
version avec `diagnosis_configuration`, et si — et seulement si — le serveur répond `42703` en
nommant cette colonne, relit une fois sans elle. Le repli est volontairement étroit : ce code
d'erreur **et** cette colonne, jamais un `catch` général qui masquerait une erreur RLS, réseau ou
serveur sous une compatibilité silencieuse. C'est la forme déjà retenue pour `patient.row_version`.

La distinction est portée jusqu'à l'écran : `[]` signifie « serveur L55, aucune configuration » et
`undefined` « serveur qui ignore la colonne ». Dans le second cas l'éditeur diagnostique ne
s'affiche pas — on ne propose pas une configuration que le serveur refuserait d'enregistrer — et le
gabarit reste entièrement consultable et modifiable par ailleurs.

Ordre d'activation obligatoire :

1. Déployer le support serveur additif **sans créer aucune configuration**.
2. Rendre disponible le frontend compatible.
3. Seulement ensuite, configurer un pilote sur une version en brouillon, puis publier.

Le repli ci-dessus rend l'étape 2 tolérante à une inversion accidentelle ; il ne dispense pas de
l'ordre, puisque la RPC d'écriture reste absente d'un serveur antérieur.

Le contexte hors-ligne transporte le contrat et sa version — `diagnosisContextByVersion` dans
l'instantané, `diagnosisContext` dans le contexte de saisie — sans activer le hors-ligne et sans
lever O6/O7. Aucun déploiement, aucune migration distante et aucun changement cloud n'est exécuté
par ce lot local.

## Migration et vérification

`20260906061539_diagnosis_configuration.sql` ajoute la colonne, ses gardes, la RPC d'écriture
`set_diagnosis_configuration`, la lecture `get_diagnosis_context`, le calcul `diagnosis_coverage`,
et remplace `validate_template_version_invariants`, `copy_template_fields` et
`download_base_snapshot` sans changer leurs signatures ni leurs ACL. Une seule fonction
`SECURITY DEFINER` devient exécutable par `authenticated`, `set_diagnosis_configuration`, inscrite
dans `supabase/security-definer-allowlist.json`. Les autres fonctions ajoutées sont soit
`SECURITY INVOKER`, soit révoquées de `public`, `anon` et `authenticated`.

`test/diagnosis-configuration.test.ts` compare SQL et TypeScript sur les trois types de pilote, en
scope `patient` **et** `encounter`, en terminologie simple **et** multiple, avec codes non reconnus,
formes invalides, absences et propositions. Il couvre les invariants, les permissions, l'ancien
client, la publication, le gel du référentiel, une base sans configuration, un code cité par deux
blocs, **les six voies de recopie** — duplication, version personnelle suivante, bundle, deux
créations de base et promotion globale — le refus de déformer une configuration `encounter` lors
d'une copie forçant le scope patient, la concurrence entre configuration et mutation du référentiel
(le supprimeur attend le verrou, puis se voit refuser), le refus de soumission par un ancien client
limité au seul scope configuré, et le transport du contrat dans l'instantané hors-ligne.
`src/data/templates.test.tsx` couvre le repli de lecture : colonne absente, serveur L55 sans
configuration, et trois erreurs qui ne doivent **pas** déclencher le repli. Deux garde-fous de conception
existants ont été mis à jour sciemment : `test/template-formula.test.ts` déclare les deux nouvelles
fonctions qui **lisent** la colonne `formula` sans jamais l'analyser, et `test/security-definer-acl.test.ts`
compte une signature `SECURITY DEFINER` de plus.

### Contrôles réellement exécutés le 2026-09-06, en local

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npm run test:web` | ✅ 69 fichiers, 575 tests, dont `templates` (4, repli de lecture compris) |
| `npm run test:rls` | ✅ 47 fichiers, dont `diagnosis-configuration` (20), `template-formula` (29) et `security-definer-acl` (3) |
| `npm run db:verify` | ✅ 140 migrations appliquées depuis zéro (45 tables, 297 fonctions, 63 policies, 79 triggers) |
| `npm run schema` · `npm run schema:check` | ✅ snapshot régénéré jusqu'à `20260906061539_diagnosis_configuration.sql` |

Les suites complètes ont dû être exécutées en plusieurs passes : cette machine (3,9 Go de RAM)
épuise sa mémoire d'engagement quand le harnais laisse des PostgreSQL embarqués derrière lui. Trois
fichiers `db` sont ainsi tombés sur `out of memory` et `ECONNRESET`, et un fichier web (`ImportData`)
sur une comparaison de découpage — jamais sur une assertion de fond. Après arrêt des processus
orphelins, la suite web complète repasse intégralement en une seule fois ; la ligne `test:rls`
ci-dessus additionne la passe complète et les relances ciblées des fichiers concernés. **Ne pas
conclure à une régression sur `out of memory`, `ECONNRESET` ou « Failed to start forks worker » sans
avoir nettoyé puis rejoué le fichier.** Aucun contrôle de release, aucun test navigateur et aucune
vérification Edge n'ont été exécutés : ce lot ne le demande pas.

**Ce document ne constitue une preuve ni de validation serveur distante, ni de déploiement.** Aucun
commit, aucune poussée, aucune migration distante et aucun changement cloud n'a été effectué.
