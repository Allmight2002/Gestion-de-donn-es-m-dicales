# Évolution du formulaire — lots E0 à E7

- Révision : **2026-09-17**.
- Statut : **E0 documenté ; E1 à E5 implémentés localement et contrôlés ; E6 et E7 à réaliser**.
- Référence métier : [spécification de l’évolution du formulaire](spec-evolution-formulaire.md).
- Prompts d’exécution : [prompts-lots.md](prompts-lots.md), sections **E0 à E7**.
- Ce document porte le découpage et le suivi des lots E. Les identifiants L, UX et O existants ne sont pas renumérotés.

## Résultat à livrer

Dans la même base, le responsable choisit **Modifier le formulaire**, prépare une évolution et
l’applique. Les variables ajoutées sont ensuite renseignables dans les patients et rencontres
existants, selon leur portée et leur applicabilité. Les valeurs anciennes restent conservées.
Le responsable n’a pas à créer ni rattacher manuellement une version.

## Ordre et suivi

| Lot | Résultat | Prérequis | État | Preuves |
|---|---|---|---|---|
| [E0](#e0) | Contrats et classification des changements | Spécification métier | **Documenté le 2026-09-16 ; aucune implémentation** | Inspection code/migrations, `git diff --check`, contrôle des liens |
| [E1](#e1) | Préparations persistantes et droits serveur | E0 | **Implémenté localement ; non déployé** | `form-preparations.test.ts` (10/10), snapshot/schema:check |
| [E2](#e2) | Application atomique dans la même base | E1 | **Implémenté localement ; non déployé** | `form-preparation-apply.test.ts` (7/7), ACL (3/3), typecheck/lint |
| [E3](#e3) | Lecture et écriture compatibles des dossiers existants | E2 | **Implémenté localement ; non déployé** | `form-compatible-records.test.ts` (11/11), web E3 (2/2), ACL (3/3), schema/schema:check, typecheck/lint |
| [E4](#e4) | Éditeur avec versionnage en arrière-plan | E2, contrat E3 stabilisé | **Implémenté localement ; non déployé ; sans preuve navigateur** | `form-preparation-editor-payload.test.ts` (4/4), `FormPreparationEditor.test.tsx` (6/6), `Trash.test.tsx` (9/9), éditeur/aperçu/coquille (5 fichiers), typecheck, lint, build `VITE_USE_SIGNED_READ=true` |
| [E5](#e5) | Complétion dans les formulaires patients et rencontres | E3, E4 | **Implémenté localement ; non déployé ; sous-lot justification propriétaire ouvert** | `RecordCompletion.test.tsx` (11/11), suites web des écrans touchés, `npm run test:web`, typecheck, lint, preuve navigateur bureau/mobile sur banc fictif |
| [E6](#e6) | Exports, provenance et historique | E3 | À réaliser | Aucune |
| [E7](#e7) | Validation intégrée et dossier de preuves | E0 à E6 | À réaliser | Aucune |

Ordre conseillé : **E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7**.
E4 et E6 peuvent avancer séparément après stabilisation de E3 uniquement si leurs fichiers
et contrats sont distincts. Les migrations, RPC et appelants couplés ont un seul responsable
d’écriture. Les revues indépendantes sont en lecture seule.

Les contrôles ciblés appartiennent à chaque lot ; E7 vérifie leur intégration et les parcours
complets. Lors d’une exécution groupée, terminer les implémentations successives avant la campagne
de tests demandée par le porteur ; aucun lot n’est déclaré validé avant exécution de ses contrôles.
La mise à disposition du parcours complet attend E7 : E2 seul ne suffit pas à autoriser une
évolution qui rendrait les anciens dossiers incompatibles avec les lecteurs ou exports.

## E0

### Contrats et classification des changements

**Objectif.** Fixer le contrat partagé avant les modifications du serveur et de l’interface.
Le livrable E0 est documentaire : il ne simule pas l’interface, ne crée pas de migration et ne
déclare pas le comportement cible implémenté.

**Travail et surfaces.** Relire le code actuel des versions, bases, patients, rencontres,
règles, exports et brouillons. Documenter les interfaces de préparation, d’impact, de lecture
compatible et d’écriture. Réutiliser les mécanismes existants après vérification plutôt que
créer un système de brouillons concurrent. Définir les états et erreurs structurées.

Préciser la définition applicable à chaque champ et valeur, y compris après plusieurs évolutions
successives ; une seule version portée par la fiche ne décrit pas tous ses compléments. Le contrat
finalisé dans la spécification (§§5 à 7) fixe les états `active`/`ready`/`applied`/`discarded`/
`conflict`/`expired`, `expected_revision`, `expected_fingerprint`, `content_fingerprint`, la
classification additive/sémantique et les erreurs bornées. Il définit aussi les états exportables
`not_defined`, `empty`, `not_applicable`, `present` et `explicit_missing`, ainsi que la provenance
par définition et par valeur.
Définir le cas de deux bases utilisant le même jeu : appliquer à A ne doit jamais faire évoluer B
implicitement ; une dérivation propre à A et sa provenance sont obligatoires. Vérifier le cas d’un
jeu partagé ou publié que le responsable de A peut utiliser sans avoir le droit de modifier sa
source. Les associations diagnostiques restent les objets `validation_rule` existants.

**Sortie attendue.** Contrats et matrice de compatibilité documentés avec exemples pour ajout,
renommage, déplacement, ajout d’option, association diagnostique et changement sémantique ;
contrat de purge par code à cinq caractères ; inventaire des motifs exigés par domaine et règle
d’exception propriétaire. Un déplacement qui change l’applicabilité ne peut pas être classé
comme pure présentation. Une nouvelle association vers un bloc déjà rempli conserve les valeurs
de ce bloc. Une modification sémantique peut suivre un parcours distinct : duplication à nouvelle
clé, convertisseur approuvé, aperçu sans écriture et ajout non destructif des valeurs converties.
Les erreurs de conflit, de refus sémantique, de fiche et de purge ont un code stable, un indicateur
de rejeu et des détails bornés.

**Risques et vérification.** Revue des parcours de lecture/écriture réellement exécutés et des
permissions. Les preuves E0 sont l’inspection en lecture des migrations, contrats et appelants,
un contrôle de liens documentaires et `git diff --check`; aucun test runtime, navigateur, schéma
ou cloud n’est déclaré. Les tâches techniques à réaliser en E1 sont listées au §13.2 de la
spécification. Les conversions heuristiques ou silencieuses restent hors périmètre : en
l’absence d’un convertisseur approuvé, refuser clairement l’opération incompatible, conserver la
préparation et expliquer la marche à suivre. Le parcours non destructif de duplication/conversion
est décrit au §5.1 de la spécification et sera implémenté dans les lots serveur concernés.

**Livraison E0 du 2026-09-16 — justification propriétaire et purge.** L’inventaire du §7.4 de la
spécification couvre les opérations de configuration, patients, rencontres et documents, de
l’écran au serveur, y compris la synchronisation hors connexion. La dispense retire seulement le
texte pour les opérations allowlistées du propriétaire après contrôle serveur ; elle ne s’applique
ni à l’attribution d’un accès à l’identité ni à la suppression de la base elle-même. Le contrat du
§4.6 fixe la confirmation de purge par code aléatoire de cinq caractères, stable dans le dialogue
et renouvelé à sa réouverture.

## E1

### Préparations persistantes et droits serveur

**Objectif.** Préparer les changements sans modifier le formulaire actif ni les données cliniques.

**Travail et surfaces.** Migrations additives, opérations serveur, types et appels dans la couche
de données. Ouvrir/reprendre, lire, sauvegarder et abandonner une préparation liée à la base,
à son auteur et à `expected_revision`/`expected_fingerprint`. Définir expiration, nettoyage,
idempotence, `content_fingerprint` et rétention de l’audit. Choisir un stockage de préparation
dédié, ou un type strictement isolé, qui conserve variables, sections, rubriques UX-16, règles et
provenance sans pouvoir atteindre `commit_work_draft`.
Adapter les contrats de configuration identifiés par E0 pour accepter l’absence de motif du
propriétaire uniquement sur l’allowlist, y compris pour les opérations patient/rencontre/document
concernées, vérifiée côté serveur, sans motif artificiel ni suppression de l’audit. Tester la
dispense et les tentatives de contournement par les autres rôles ; préserver les appelants
existants et les motifs déjà en file hors connexion. Adapter le contrat de purge au challenge
court, sans remplacer les contrôles de propriétaire, rétention, concurrence, audit et rejeu.

**Acceptation.** Une préparation survit à la fermeture après sauvegarde confirmée ; une erreur
ne fait pas afficher « sauvegardé ». Abandonner ne touche aucune fiche. Les droits sont revérifiés
à chaque opération. Un autre compte ne peut ni lire ni modifier cette préparation sans droit.

**Risques et vérification.** Tests serveur des accès croisés, droits révoqués, révisions périmées,
double envoi, clé d’opération réutilisée avec un contenu différent et expiration. Vérifier que
la préparation ne contient aucune identité ni valeur clinique. Après migration : génération
et inspection du snapshot puis contrôle de cohérence du schéma.

## E2

### Application atomique dans la même base

**Objectif.** Appliquer une préparation en une opération cohérente et rejouable.

**Travail et surfaces.** Même responsable pour migration/RPC, couche de données et contrats.
Calculer l’impact côté serveur, classifier les changements, créer la révision interne,
copier/remapper sections, rubriques communes, champs et règles, rattacher A et auditer dans une
transaction. Pour une modification sémantique, appliquer uniquement le parcours explicite du §5.1 :
nouvelle clé, mapping/convertisseur approuvé, aperçu puis ajout des valeurs converties sans toucher
à la source. Les associations diagnostiques restent des règles du modèle existant.

**Acceptation.** Échec à n’importe quelle étape : aucune application partielle. Deux applications
concurrentes : une seule réussit, l’autre reçoit un conflit. Réponse perdue : le rejeu retrouve
le résultat de la même opération. Aucune fiche ni valeur n’est créée par l’application.
Une autre base B liée au même jeu conserve son formulaire jusqu’à sa propre évolution explicite.
Une migration sémantique non convertible ne supprime ni ne remplace les valeurs de la variable
source ; les dossiers concernés restent signalés comme à compléter ou `not_convertible`.

**Risques et vérification.** Tests transactionnels, concurrence, idempotence, refus sémantiques,
provenance et fidélité des copies. Vérifier les groupes UX-16 sans faux blocs cliniques et les
références entre règles et champs. Contrôles de migrations, RLS et privilèges serveur.

**État local au 2026-09-16.** La migration E2 ajoute `apply_form_preparation` et ses contrôles
de provenance, recalcule l’impact côté serveur, copie les métadonnées dans une révision technique
autonome, remappe les sections/rubriques UX-16/règles, puis rattache uniquement la base A. Les
contrôles ciblés PostgreSQL embarqué, snapshot, ACL, typecheck et lint sont passés ; aucune preuve
navigateur, cible distante ou déploiement n’est déclarée.

## E3

### Lecture et écriture compatibles des dossiers existants

**Objectif.** Autoriser réellement les compléments sur les fiches historiques.

**Travail et surfaces.** Contextes de lecture patients/rencontres, lectures signées, validation
serveur et opérations d’enregistrement. Exposer les champs historiques et les ajouts compatibles
avec leur définition, applicabilité et provenance, avec `definition_state`/`value_state` distincts
(`not_defined`, `empty`, `not_applicable`, `present`, `explicit_missing`). Valider la totalité de
l’écriture avec `expected_record_revision` sans supprimer les clés historiques absentes d’un
écran. Refuser les clés et conversions inconnues.

**Acceptation.** Après ajout, un patient existant peut recevoir la nouvelle valeur en conservant
ses valeurs antérieures. Même résultat pour une rencontre existante, avec respect des portées.
Le comportement reste correct après plusieurs évolutions. Un client ancien ou une fiche déjà
ouverte reçoit un contexte compatible ou un conflit explicite conservant les inputs.

**Risques et vérification.** Tests avec champs masqués, valeurs historiques, règles conditionnelles,
formules, diagnostics multiples ou sans bloc, droits révoqués et payload d’un ancien client.
Un ajout d’association ne vide jamais un bloc déjà renseigné. Vérifier le contexte signé réel,
pas uniquement des objets simulés dans les tests React.

**État local au 2026-09-17.** La migration additive `20260916140000_form_compatible_records.sql`
ajoute la révision de fiche des rencontres, la provenance des valeurs et les RPC de lecture et de
complément pour les patients et les rencontres. Le contexte est calculé par le serveur sous
`SECURITY DEFINER`, lié à la base et à la fiche, puis protégé par une empreinte de contexte ; il
n’embarque aucune identité. La fusion du patch conserve les clés historiques, n’autorise que les
clés et portées validées, refuse les conversions implicites et revalide droits, définition,
révision, empreinte et idempotence. Les ajouts requis apparaissent comme `not_defined`/`empty` et
ne modifient pas rétroactivement le statut clinique ; couverture diagnostique et complétude sont
calculées séparément.

Les tests PostgreSQL embarqué couvrent patients et rencontres, champs masqués, valeurs historiques,
association vers un bloc déjà renseigné, diagnostics unique/multiples/absent/sans bloc, concurrence,
anciens payloads, réutilisation d’opération, contexte altéré, portée/conversion, révocation et fuite
d’identité. Les tests web ciblés couvrent les deux écrans avec dépôt de brouillons disponible et
vérifient le chemin E3 direct ; le chemin hors-ligne reste inchangé. Le contexte réel est exercé par
les RPC SQL, mais aucun navigateur réel, Edge de lecture signée de contexte ou environnement distant
n’est validé par ce lot ; l’empreinte E3 ne doit pas être présentée comme une URL signée de fichier.

## E4

### Éditeur avec versionnage en arrière-plan

**Objectif.** Remplacer le parcours manuel de versions par une modification compréhensible.

**Travail et surfaces.** Éditeur de base, éditeur de version et composants Structure, Sections,
Règles, Collecte diagnostique, Aperçu ; traductions et couche de données associée. Brancher
« Modifier le formulaire », reprise, impact, application et abandon sur E1/E2. Conserver recherche,
Toutes les variables, navigation section/variable/règle, provenance et actions existantes.

**Acceptation.** Le responsable ajoute une variable sans choisir une version ni recréer de base.
Les états préparation locale/enregistrée/conflit sont honnêtes. Changement d’espace, fermeture,
Escape, erreur et conflit préservent la saisie. L’aperçu utilise le moteur réel sans écriture.
La création de nouvelles associations reste accessible par la préparation autorisée.
Les écrans de paramètres concernés et l’application du formulaire ne demandent plus de
justification au propriétaire ; les confirmations d’impact restent distinctes et utilisables.

**Risques et vérification.** Tests web ciblés des actions, droits, retours de navigation et inputs.
Vérification visuelle bureau/mobile : barre latérale escamotable, en-têtes non envahissants,
actions atteignables. Aucun bouton factice pour une dépendance serveur manquante.

**État local au 2026-09-17.** `BaseTemplateEditor` ouvre désormais l’écran de préparation :
ouverture/reprise, enregistrement, impact serveur, application et abandon passent par les RPC
E1/E2. L’éditeur de version existant est réutilisé tel quel, avec un dépôt de préparation injecté :
les cinq espaces, la recherche globale, « Toutes les variables », la provenance et la navigation
section/variable/règle sont conservés ; le numéro technique devient une mention secondaire et
l’aperçu réutilise le moteur réel avec ses dépôts inertes. La définition rendue par le serveur est
l’état de référence du candidat : une partie du formulaire que personne n’a modifiée repart telle
qu’elle est venue, clés inconnues comprises. Sans cette fidélité, la comparaison objet par objet de
E1 classait toute ouverture comme sémantique et aucune évolution n’était applicable.

La corbeille demande le code aléatoire à cinq caractères du §4.6 avec le nom de la base affiché ;
la confirmation serveur du challenge **précède** la purge Edge D10, qui garde sa clé d’opération
rejouable et ses contrôles de propriétaire, de rétention et d’audit. Aucune justification textuelle
n’est demandée au propriétaire pour la configuration du formulaire ni pour son application :
l’inventaire du §7.4 est vérifié dans le code, aucun `p_reason` n’existe sur ces chemins. Le motif
de mise en corbeille d’une base et la justification d’accès à l’identité restent hors dispense.

Les trois captures de maquette `.tmp-editor-maquette*.png`, relevées comme non suivies par E0
(§13.3 de la spécification) et sans lien avec ce lot, ont été supprimées à la demande du porteur.

**Limites déclarées.** Aucune preuve navigateur bureau ni mobile : ce poste n’a ni Docker ni cible
Supabase locale/jetable, et le projet cloud configuré ne porte pas les migrations E1 à E3 ; la
vérification visuelle demandée reste donc ouverte. Le classifieur E1 durci traite libellé,
description, section, rubrique commune et ajout d’option comme de la présentation ; retirer une
variable, changer son type ou déplacer une variable commune vers un bloc clinique reste sémantique
et refusé, avec la préparation conservée. Si le serveur ne publie pas les RPC de préparation,
l’écran annonce l’indisponibilité et n’offre aucun repli vers l’ancien parcours de versions.

## E5

### Complétion des patients et rencontres

**Objectif.** Rendre les champs ajoutés faciles à trouver et à renseigner.

**Travail et surfaces.** Formulaires patients/rencontres et composants de champs partagés.
Afficher les ajouts vides, l’état « À renseigner » et les obligations du formulaire courant.
Préserver le parcours par blocs avec identité en tête et sous-sections parcourues séparément.
Calculer les compteurs sur les données et l’applicabilité réelles, côté serveur lorsque requis.

**Acceptation.** Compléter un nouveau champ n’impose pas de recopier les anciennes réponses.
Ajouter un champ obligatoire ne modifie pas silencieusement le statut clinique existant.
La validation d’une nouvelle saisie et la revalidation explicite suivent le contrat E0 ;
une correction indépendante ne force pas à remplir tous les ajouts avant toute sauvegarde.
Le parcours brouillon, la reprise et les conflits conservent les inputs.

**Risques et vérification.** Tests d’enregistrement et de complétion distincts de la couverture
diagnostique. Scénarios patient/rencontre, fiche curatée, champ obligatoire conditionnel,
plusieurs diagnostics, aucun diagnostic et diagnostic sans bloc. Aucun nouveau droit de saisie
hors connexion n’est introduit ; contexte obsolète traité explicitement au retour en ligne.

**Extension propriétaire.** Retirer les champs de justification obligatoires des opérations patient,
rencontre et document concernées, après livraison des contrats E1 ; conserver l’audit et les
confirmations. Vérifier propriétaire d’une autre base, collaborateur, droits d’identité absents,
statuts cliniques, suppression/restauration et erreurs réseau sans perte de saisie.

**Confirmation de purge.** Dans la corbeille des bases, remplacer la ressaisie du nom par le code
aléatoire de cinq caractères du §4.6. Garder le nom visible, l’avertissement d’irréversibilité et
les conditions de purge. Tester génération à l’ouverture, stabilité, renouvellement, validation,
clavier et absence de double envoi. Ce sous-lot dépend aussi du contrat E1.

**État local au 2026-09-17.** Le contexte E3 d’une fiche est désormais traduit en présentation par
`src/domain/recordCompletion.ts` : le serveur décide seul ce qui est un ajout applicable et ce que
le formulaire courant attend ; l’écran ne fait que retirer du compte ce qui vient d’être saisi.
Chaque ajout encore vide porte la mention « À renseigner » à côté de son libellé, chaque bloc
affiche « n à renseigner » dans son en-tête, le résumé du formulaire ajoute le total et un bouton
« Prochaine variable ajoutée » conduit d’un ajout au suivant. Une annonce non bloquante nomme les
ajouts, isole ceux que le formulaire courant attend et rappelle qu’aucune valeur n’est créée et
que le statut du dossier ne change pas. `PatientDetail` porte la même annonce pour le patient et
pour chaque rencontre, avec « Compléter cette fiche » ; hors connexion, aucun ajout n’est annoncé
et aucun droit de saisie n’est ouvert.

Un ajout obligatoire compte mais ne devient pas une obligation rétroactive : les formulaires sont
rendus avec la liste déjà utilisée par la validation locale (`fieldsForLocalValidation`), donc
aucune erreur bloquante n’apparaît pour une variable que l’enregistrement accepte, et une fiche
`curated` conserve son statut. L’écriture reste le patch compatible E3 : seul le complément saisi
part, les valeurs et la provenance historiques ne sont jamais renvoyées, et un contexte périmé
rend `FORM_CONTEXT_CHANGED` avec conservation des saisies et bouton de rechargement.

Preuves : `RecordCompletion.test.tsx` (11/11 — ajout facultatif et obligatoire, patient et
rencontre, fiche curatée, plusieurs diagnostics avec sous-section, diagnostic sans bloc, absence de
diagnostic, portée par type de rencontre, contexte périmé, annonce et lien de la fiche),
`npm run test:web` (777/778 ; `OfflineIntake.test.tsx` a échoué une fois sur un `findByText` dans
la campagne complète en parallèle, puis a repassé seul et dans une reprise ciblée de dix fichiers —
flake de rythme, hors périmètre E5), `npm run typecheck`, `npm run lint`. La saisie réelle a été vérifiée au
navigateur sur `completion-harness.html`, banc local sans serveur monté sur la même fixture
fictive que les tests : ajouts vides marqués, compteurs par bloc, navigation « Prochaine variable
ajoutée », enregistrement d’un complément dont le patch ne portait que la clé saisie, statut
`Finalisé` conservé, rendu bureau et mobile sans débordement ni action hors d’atteinte.

**Limites déclarées.** Aucune cible Supabase locale ou distante n’a été exercée : le banc navigateur
et les tests web rejouent le contrat E3, ils ne prouvent pas le comportement d’un serveur déployé.
Le sous-lot **Extension propriétaire** reste ouvert : le contrat serveur existe depuis E1
(`form_justification_status`, statut d’audit `owner_exempt`), mais les écrans patient, rencontre
et document demandent toujours un motif obligatoire. La **confirmation de purge** a été livrée avec
E4 et n’est pas rouverte ici.

## E6

### Exports, provenance et historique

**Objectif.** Expliquer chaque valeur et chaque absence après l’évolution du formulaire.

**Travail et surfaces.** Exports serveur, dictionnaires et écran d’historique. Exposer la
définition applicable, les dates d’application/complétion, la provenance et les états d’absence
selon le contrat E0. Préserver les profils d’export et le cloisonnement d’identité. Garder lisibles
les variables retirées et les anciennes options, sans les remettre implicitement en saisie.

**Acceptation.** Exporter une cohorte mêlant anciennes et nouvelles fiches conserve toutes les
valeurs autorisées et distingue les différents états d’absence. L’historique indique auteur,
date, impact et révision. Les définitions d’anciennes valeurs restent consultables après plusieurs
évolutions. La liste des dossiers affectés respecte les droits de lecture.

**Risques et vérification.** Fixtures d’export avant/après complétion, options retirées, champs
masqués, formules, retrait de variable et périmètres patient/rencontre. Tests de non-divulgation
entre bases et profils. Vérifier le fichier exporté, pas uniquement le composant de téléchargement.

## E7

### Validation intégrée et dossier de preuves

**Objectif.** Prouver le parcours complet avec les données et le moteur réels.

**Fixture.** Base A avec au moins **216 variables, 21 sections et 26 règles**, rubriques communes,
sous-sections, patients et rencontres déjà renseignés ; base B partageant le jeu initial.
Inclure dossiers curatés, plusieurs diagnostics, diagnostic sans bloc, cas mixte et absence de
diagnostic. Ajouter un champ facultatif, un obligatoire et une association, puis compléter une
ancienne fiche. Toutes les données sont fictives.

**Campagne.** Exécuter les contrôles de E1 à E6 sur une cible locale/jetable identifiée ; tests
serveur/RLS et web pertinents, typecheck, lint, build avec `VITE_USE_SIGNED_READ=true`, et vérification
du schéma si migrations. Examiner l’application réelle au navigateur et capturer les parcours
éditeur → impact → application → ancien dossier → complément → export/historique.

**Acceptation.** Les 16 critères du §10 de la spécification ont chacun une preuve, un résultat
et une limite éventuelle. Aucun succès n’est déduit d’une maquette ou d’un compteur fixe.
Conflits, droits révoqués, rejeux et absence d’écriture dans l’aperçu sont vérifiés.

**Traçabilité.** Mettre à jour le tableau de ce document avec SHA testé, commandes, codes de sortie,
scénarios, chemins des captures et environnement. Distinguer implémenté, validé localement,
preuve navigateur et validation distante. Un contrôle impossible reste explicitement ouvert.
Commit, push, fusion, déploiement et migration distante nécessitent la demande correspondante.

## Prompt de reprise d’un lot

Remplacer `E<n>` par le lot visé :

```text
Implémente E<n> de docs/lots-evolution-formulaire.md selon docs/spec-evolution-formulaire.md.
Lis AGENTS.md, inspecte git status, les diffs et les contrats réels des lots prérequis.
Préserve le travail local. Vérifie les prérequis avant de modifier leurs appelants.
Garde un seul responsable d’écriture pour les migrations/RPC/interfaces couplées.
Réutilise les règles, rubriques UX-16, provenance, permissions et moteurs existants.
N’invente ni valeur clinique ni prise en charge d’une dépendance manquante.
Implémente le lot et exécute ses contrôles sur une cible locale/jetable identifiée.
Mets à jour le suivi avec preuves et limites sans déclarer les autres lots livrés.
Ne committe, ne pousse et ne modifie aucun environnement distant sans demande explicite.
```
