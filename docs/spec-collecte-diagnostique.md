# Spécification — collecte avec diagnostics et couverture progressive

- Révision : **2026-09-05** ; **non implémentée**.
- Origine : retour du porteur pendant les essais de terrain. Les patients disposent
  habituellement déjà d'un diagnostic, mais le saisisseur ne trouve pas toujours une base ou
  un formulaire spécialisé approprié.
- Complète et révise [les blocs cliniques](spec-blocs-pathologies.md) et la
  [décision du 3 septembre](decision-blocs-pathologies-2026-09-03.md).
- Lots : **L55** configuration et couverture ; **L56** parcours et suivi ; **L57** cadrage
  différé de la reprise et des notifications. L51–L54 restent les fondations.
- Ce document définit du travail futur. Il ne décrit ni une migration appliquée ni le cloud.

## 1. Résultat attendu et limites

Dans sa base autorisée, l'agent enregistre le socle et les diagnostics d'un cas même si aucun
bloc spécialisé ne correspond. La base représente un contexte cohérent de collecte, pas
nécessairement une pathologie. Une mission reste limitée à une base ; aucune extension des
droits, fusion de bases, identité inter-bases ou collecte hors périmètre n'est introduite.

Le mode est **optionnel et versionné**. Les collectes ciblées et leurs obligations actuelles
restent inchangées. Le responsable définit le socle ; aucun catalogue universel de questions
cliniques n'est inventé par le logiciel. Diagnostic déjà établi est le parcours nominal, sans
transformer un diagnostic absent en code fictif ni contourner les valeurs manquantes autorisées.

La sélection de diagnostics reste indépendante des blocs disponibles. Le diagnostic détaillé
est saisi une seule fois : aucune seconde sélection obligatoire de « situations cliniques ».
Les blocs manuels historiques restent possibles hors de ce parcours.

Un diagnostic de passage relève du scope `encounter`, une caractéristique permanente peut
relever du scope `patient`. Le concepteur le choisit explicitement ; aucun diagnostic d'une
rencontre ne se propage automatiquement à toutes les suivantes. Le modèle transversal garde
son refus des rencontres. La v1 ne crée pas de nouvel objet « hospitalisation ».

## 2. L51–L54 : amendements nécessaires

- **L51** accepte aussi `terminology`, simple ou multiple : compare les `code` des objets
  `{code,label}` valides aux codes configurés, jamais les libellés, préfixes ou chaînes JSON.
  Les formes invalides sont refusées par la validation des données ; l'évaluateur ne les active
  jamais par coercition. `select`/`multiselect` conservent leur contrat. Absence et raison de
  valeur manquante ne déclenchent aucun bloc. Les listes de codes configurées sont non vides,
  sans doublons et validées dans le référentiel explicitement résolu pour la version.
- L'appartenance exacte ne dépend pas de L50 : aucune inférence CIM, parcours d'ancêtres,
  normalisation de codes ou appel externe à chaque saisie. Une version du référentiel doit
  être disponible localement avant de configurer ses associations. Sa référence est conservée
  par la configuration versionnée ; une nouvelle release ne réinterprète pas l'historique.
- Pour éviter une dépendance circulaire avec L55, **L51 porte déjà la référence de release
  dans `if.terminologyReleaseId` des règles terminologiques** et sa validation/copie. Elle est
  obligatoire pour ces règles, absente pour les listes d'options. L55 impose ensuite que cette
  référence égale celle du pilote configuré. L'évaluateur compare les codes ; la validation de
  définition résout la release. Aucun recours implicite à la release « courante ».
- **L54** conserve sa hiérarchie bornée, le tronc commun explicite et les garanties de recopie.
- **L52** conserve `then.section` et la parité SQL/React. Le retrait d'un diagnostic qui masque
  un bloc déjà renseigné exige un aperçu des valeurs retirées et une confirmation explicite
  avant soumission. Annuler conserve diagnostic et valeurs ; échec réseau ou conflit conserve
  le travail local. Aucun effacement serveur implicite. Les journaux techniques ne reçoivent
  aucune valeur clinique. Cette confirmation concrétise la décision historique « jamais en silence ».
- **L53** reste une projection de colonnes, pas un filtre de population. Le pilote diagnostique
  du tronc commun demeure exporté ; un diagnostic sans bloc ne disparaît ni de la population
  ni des colonnes communes pour ce seul motif. Les règles usuelles de complétude continuent
  de s'appliquer et ne sont pas contournées.

## 3. L55 — Configuration diagnostique et couverture versionnées

**Dépend de L51, L54 et L52.** Lot serveur, domaine et éditeur. Pas de nouvelle table de
diagnostics patient : réutiliser les valeurs et la terminologie existantes.

### 3.1 Contrat de configuration

Ajouter une configuration optionnelle par `template_version`, avec au plus un pilote par
scope. Noms de propriétés ci-dessous proposés pour le contrat, à aligner sur les conventions
du dépôt pendant l'implémentation :

```json
{
  "scope": "encounter",
  "diagnosisFieldKey": "diagnostics",
  "terminologyReleaseId": "<release locale existante>",
  "commonOnlyCodes": ["<code pour lequel le socle suffit>"]
}
```

Pour `select`/`multiselect`, les options versionnées remplacent la release et cette référence
est nulle. Le pilote appartient au tronc commun du même scope, ne porte aucune formule et ne
peut être masqué par une règle. Le couple `(scope, field_key)` l'identifie, jamais son libellé.

**Une seule source pour les associations diagnostic → blocs : les règles L52.** L'éditeur
présente une association compréhensible au responsable mais écrit une règle `contains_any`
canonique par bloc diagnostique ; les codes alternatifs sont dans une seule liste, pas dans
plusieurs règles qui se cumuleraient en ET. Plusieurs blocs peuvent citer le même code.
Un bloc diagnostique de ce parcours ne porte pas d'autre condition de bloc ; les conditions
de champs internes restent autorisées. Les blocs génériques existants restent indépendants.

La liste `commonOnlyCodes` exprime une décision explicite du concepteur. Un code qui cible un
bloc ne peut simultanément y figurer. Tous les codes du référentiel n'ont pas à être configurés.
Un diagnostic absent du référentiel suit la soupape/proposition existante, sans faux code : il
est « à qualifier », reste enregistrable selon ce contrat, et n'active aucun bloc automatique.
L55 doit inventorier et transporter le champ compagnon de proposition existant, sans le dupliquer.

### 3.2 Résultat de couverture

Le calcul renvoie **par diagnostic**, puis agrège au dossier :

| Résultat | Définition |
|---|---|
| `covered` | Au moins un bloc est associé à ce code dans cette version |
| `common_only` | Le responsable a déclaré que le socle suffit |
| `uncovered` | Code reconnu sans bloc ni décision de socle suffisant |
| `unclassified` | Proposition diagnostique non encore rattachée à un code |

Un cas peut contenir simultanément un diagnostic couvert et un autre non couvert. L'absence
de diagnostic est une question de saisie, pas un diagnostic non couvert. Un bloc vide de
variables saisissables ne peut pas servir à déclarer artificiellement un code couvert.

Calculer depuis les valeurs, les règles et **la version du dossier**, sans table de statut
clinique redondante ni drapeau modifiable par le navigateur. La couverture ne remplace jamais
`draft/complete/curated` et ne prouve pas la complétude d'un bloc. La décision `common_only`
ne rétroagit pas sur les versions utilisées.

### 3.3 Intégrité, sécurité et surfaces

Migration additive ; configuration absente = comportement historique. RLS et permissions
d'édition identiques à celles du gabarit. Toute mutation des champs, codes, règles, sections
ou référence terminologique revalide la configuration sous le verrou de version existant.
Gel à la publication, copie fidèle dans les voies de duplication/bundle/création de base,
aucun pointeur vers une autre version. Nouvelle release = nouvelle configuration validée.

Surfaces : `src/data/types.ts`, `src/data/templates.ts`, `src/domain/templateRules.ts`,
`src/domain/validation.ts`, éditeurs de gabarits et de règles ; migrations, tests de gabarits,
terminologie et règles. Le contexte hors-ligne transporte le contrat et sa version sans
activer le hors-ligne. Un client ne comprenant pas ce contrat reçoit un refus explicite à
l'activation/soumission concernée ; jamais de mode permissif silencieux.

**Acceptation :** même résultat SQL/TypeScript sur diagnostics simples, multiples, non couverts,
propositions et absences ; associations stables après changement de libellé ; release différente
non substituée ; configuration incohérente et édition non autorisée refusées ; anciennes bases
inchangées ; copie et publication validées. Pas de L50 requis.

## 4. L56 — Enregistrement du socle et suivi des cas non couverts

**Dépend de L55 ; preuve pilote complète après L53.** Lot écran, RPC de suivi et adaptations
bornées des validations. Le mode de collecte est préparé par le responsable, pas créé à la
volée par l'agent. L'entrée de mission conduit à sa base active selon les droits existants.

### 4.1 Enregistrement

Afficher socle et diagnostics, puis blocs applicables. Ne jamais filtrer la recherche de
diagnostics sur les seules associations. Afficher une information non bloquante pour les
diagnostics sans bloc ; enregistrer socle et diagnostic sans créer de patient en doublon.

Le socle constitue les champs communs ; les obligations communes et celles des blocs
applicables restent évaluées côté serveur. Un diagnostic non couvert n'invente aucune variable
requise. Pour un cas mixte, l'absence d'un bloc ne dispense pas de compléter un autre bloc
applicable si le statut demandé exige la complétude. Un enregistrement partiel n'est possible
que par le parcours brouillon déjà autorisé, sans le présenter comme complet.

Les comptes de mission gardent leurs contraintes actuelles : pas de nouveaux droits d'édition
après soumission, d'export, de curation ou d'accès inter-bases. L56 doit prouver qu'un socle valide
avec diagnostic non couvert s'enregistre avec ces contraintes, plutôt que rendre tout champ
facultatif. Si le code réclame une donnée spécialisée non applicable, corriger l'applicabilité
dans le mode optionnel côté SQL et frontend, pas l'autorisation de mission.

Patients et rencontres, saisie et correction, aperçu, curation, RPC de création/finalisation,
imports déjà pris en charge et rejeu hors-ligne doivent partager la même décision. Les limites
actuelles d'import de terminologie multiple ne sont pas élargies. Aucun contournement par
appel RPC direct ou ancien client. La preuve terrain de ce lot est en ligne ; les modes démo
hors-ligne conservent leurs propres portes O6/O7.

### 4.2 Suivi pour le responsable

Ajouter une RPC paginée filtrée par base, scope, version et code, qui retourne les cas
`uncovered`/`unclassified` et leurs comptes. Réutiliser le calcul L55. Accès réservé au
propriétaire médecin pour cette v1, vérifié dans la RPC ; ni saisisseur ni administrateur
système ne gagnent une vue clinique transversale. Même règle pour les agrégats et les totaux.

Exclure les lignes supprimées et bases supprimées ; ne retourner ni identité, ni document,
ni texte libre dans les agrégats. Les propositions restent consultables seulement dans leur
parcours autorisé existant. Le saisisseur voit le résultat du cas qu'il est autorisé à saisir,
pas une file de patients supplémentaire. Aucun message externe ni notification dans L56.

La file distingue couverture dans la version source et éventuelle évolution du gabarit.
Publier un bloc ne retire pas automatiquement les anciens cas de la file et n'annonce pas
qu'ils sont désormais complétables : cette capacité appartient à L57.

### 4.3 Surfaces et acceptation

Surfaces : `NewPatient`, `EncounterForm`, formulaires d'édition, `EncounterFields`, fiche patient,
accès mission au tableau de bord, repositories patients/bases, routes et nouvel écran de suivi,
RPC/validations SQL, traductions fr/en. Réutiliser le rendu et les erreurs existants.

Scénarios avec données fictives : diagnostic couvert ; non couvert ; proposition hors liste ;
couvert + non couvert ; plusieurs blocs pour un diagnostic ; retour du même patient avec un
diagnostic différent ; transversal ; mission expirée/révoquée ; utilisateur d'une autre base ;
retrait de diagnostic avec annulation, confirmation et conflit ; dossier historique.

**Terminé signifie :** socle valide enregistrable sans bloc, obligations applicables préservées,
couverture distincte de complétude, file sécurisée, export L53 conservant les cas non couverts
éligibles, test navigateur du parcours complet. Une preuve locale ne vaut pas preuve déployée.

## 5. L57 — Reprise versionnée et notifications : cadrage différé

**Statut : lot de conception seulement, non prêt à implémenter.** Après retour du pilote L56,
étudier les dossiers concernés et spécifier le complément d'une collecte existante. Aucune
migration, transfert de données ou notification n'est autorisé par ce lot de cadrage.

Livrable attendu : décision entre complément historisé et changement explicite de version,
avec exemples avant/après, invariants et lots d'implémentation bornés. Il doit traiter :

- correspondance des clés et types, conservation des valeurs et de leur provenance ;
- dossier complet/curaté, exports et cohortes figés, formules et référentiels historiques ;
- droits du responsable et du saisisseur, notamment mission expirée ou donnée déjà soumise ;
- transaction, verrou optimiste, idempotence, échec partiel et annulation ;
- information impossible à recueillir après le départ du patient, sans valeur inventée ;
- notification de disponibilité seulement lorsqu'une action autorisée existe réellement,
  destinataires, déduplication, révocation et absence de contenu clinique dans le message.

Articuler ce futur périmètre avec la [décision notifications existante](decision-notifications-v1-2026-08-20.md),
limitée aux clarifications de curation. Ni réutilisation implicite de ce consentement, ni emails
ou messages externes. La publication d'un bloc ne met jamais à jour les fiches historiques.

## 6. Ordre et vérification

Ordre recommandé avec un seul agent : **L51 → L54 → L52 → L55 → L56 → L53**, puis preuve pilote
complète, puis cadrage L57. L53 peut être livré plus tôt après L54 ; L56 ne déclare pas le
parcours complet tant que la preuve d'export manque. L51/L54 et L52/L53 ont des possibilités
techniques de séparation, pas une consigne de créer des agents.

L55 partage règles, types, éditeurs et copie de version avec L51/L52/L54 : pas simultanément.
L56 partage les formulaires avec L41/L42 et les travaux offline : séquencer ces modifications.
L53 partage l'export avec L50. Préserver tous les changements locaux hors périmètre.

Pour chaque futur lot : contrôles ciblés SQL/RLS, domaine et composants, puis typecheck/lint,
tests web/DB et vérification migrations selon la surface ; tests Edge pour L53 ; scénario
Playwright complet pour L56 ; build et contrôles release lors d'une release explicitement
demandée. Les fonctions privilégiées doivent être justifiées et leurs ACL vérifiées.

Le présent travail est documentaire : aucune de ces validations d'implémentation n'est déclarée
exécutée. Activation optionnelle après serveur additif et client compatibles ; aucune ancienne
collecte transformée par la seule livraison technique.
