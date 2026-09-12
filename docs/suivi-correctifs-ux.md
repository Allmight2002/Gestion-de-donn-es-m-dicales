# Correctifs UX — contrat et preuves locales

Travail ouvert le 11 septembre 2026 sur `e589b72`, branche `codex/ux-correctifs`.
La spécification de référence reste `spec-experience-utilisateur.md`. Ce document
consigne les choix d'implémentation et les contrôles effectivement exécutés ; une
ligne planifiée n'est pas une preuve de validation ni de déploiement.

## Contrat UX-0

- Brouillons de travail analytiques séparés des fiches métier, de l'identité,
  des documents bruts, des brouillons de curation et de la file intake.
- Durée maximale serveur et locale : **24 heures depuis la création**, sans
  prolongation à chaque frappe. Les anciens brouillons locaux utilisent leur date
  enregistrée comme origine ; ceux déjà âgés de 24 heures expirent. La purge
  conserve les règles de changement de compte, déconnexion et révocation.
- Payload analytique : **256 Kio maximum**, clés du formulaire/version/scope
  exclusivement. Valeurs incomplètes autorisées dans un brouillon ; validation
  métier obligatoire lors de l'enregistrement. L'identité n'entre pas dans ce payload.
- Autosauvegarde après **750 ms** d'inactivité, au plus **5 secondes** pendant
  une saisie continue ; un seul envoi en vol, accusé associé à sa révision.
- Identifiant stable pour une création ; révision attendue et clé d'opération
  stable pour chaque écriture ; conflit explicite entre onglets/appareils.
- Consommation du brouillon et enregistrement métier dans une transaction ;
  tombstone sans valeurs après suppression/consommation pour refuser un autosave tardif.
- Les valeurs temporairement inapplicables restent dans la saisie et son
  brouillon. Seule la projection active, confirmée par l'utilisateur, est soumise.
- Aucun nouveau cache de patients serveur ni activation hors connexion.
- Recherche nominative uniquement avec rôle médecin et accès identité actuel,
  audit sans terme recherché et résultats présentés par code/analytique (RG-9).
- Import : arrêt entre unités atomiques, sans annulation des unités déjà écrites.
  Conflits : présenter les décisions serveur existantes sans inventer de fusion.
- Performance : fixture fictive minimale 216 variables / 24 règles. Mesures
  navigateur locales à 1440 px et 390 px ; cible d'interaction locale 200 ms
  pour recherche/navigation hors réseau. Mesurer avant toute virtualisation.
- UX-9 est une option de présentation réversible ; les blocs restent librement
  accessibles. Aucune modification structurelle groupée facultative n'est ajoutée
  sans besoin observé ; les déplacements explicites UX-14/16 sont inclus.

## Matrice de reprise et limites

| Écran | Zone et droits | Protection cible | Limite explicite |
|---|---|---|---|
| Nouveau patient, saisie manuelle | Analytique ; création autorisée dans la base | Brouillon serveur ; garde de départ ; file intake existante si autorisée | Identité en mémoire, sauf file intake cloisonnée existante |
| Patient à confier | Identité et parcours de soumission existant | Garde de départ, opération idempotente existante | Aucun brouillon d'identité générique |
| Modification patient | Analytique ; correction autorisée de cette fiche | Brouillon serveur lié à la version métier ; conflit sans perte | Aucune lecture supplémentaire hors connexion |
| Nouvelle rencontre | Analytique ; création autorisée, parent valide | Brouillon serveur ; reprise locale autorisée, y compris parent local | Parent rejeté : rencontre bloquée, jamais orpheline |
| Modification rencontre | Analytique ; correction autorisée | Brouillon serveur avec révision métier attendue | Statut curated jamais rétrogradé |
| Identité / documents / curation | Zone dédiée, droits actuels | Protections et stockages dédiés existants, garde de départ | Exclu du payload analytique |
| Aperçu / simulation | Formulaire fictif | État en mémoire seulement | Aucune écriture de brouillon |

Navigation et refus conservent la saisie. Rechargement/fermeture ne promettent une
reprise qu'après accusé d'un support relisible. Réseau coupé, quota ou stockage
refusé affichent un état non protégé ; une ancienne sauvegarde ne masque pas la
dernière erreur. Une expiration ou perte de droits bloque la reprise et l'écriture.

## Ordre et responsabilités

| Vague | Lots | Dépendances et sortie |
|---|---|---|
| 1 | UX-0, UX-1, fondations UX-13, UX-2, UX-12 | Contrat ; protections immédiates ; serveur autorisé ; navigation indépendante |
| 2 | UX-3/4 ; UX-10/11 ; UX-14(a/b/c) | Accusés/reprise puis valeurs retirées ; champs communs ; éditeur sous un seul responsable |
| 3 | UX-5/6 ; UX-15 ; UX-16(a/b) | Navigation formulaire ; opérations ; présentation versionnée compatible |
| 4 | UX-7 puis UX-8/9 | Vérification intégrée, durcissement local et option de présentation, nouvelle vérification ciblée |

Les migrations, RPC et appelants couplés ont un responsable unique. Les tests DB
s'exécutent en série sur PostgreSQL embarqué jetable ; aucune cible distante.
Le snapshot sera généré puis inspecté et contrôlé après les migrations.

## État des lots

Chaque ligne indique l'état réellement atteint : *spécifié*, *implémenté* (code et tests écrits),
*validé localement* (contrôles exécutés et réussis sur cette machine). Aucun lot n'est validé sur
une cible déployée ; aucune migration distante n'a été appliquée.

| Lot | État | Contenu livré | Limite explicite |
|---|---|---|---|
| UX-0 | Implémenté | Contrat, matrice de reprise et décisions ci-dessus | Seuils de performance non mesurés (UX-14(d)) |
| UX-1 | Implémenté | Garde de départ commune, conservation après refus, correction de `MyTemplates.saveEdit`, reprise intake | L'identité saisie n'entre dans aucun brouillon : quitter la page la perd, et la garde l'annonce |
| UX-2 | Validé localement | Migration `20260910233212_ux_work_drafts.sql`, contrat de brouillon de travail, repository | Tests DB ciblés et contrôle de schéma réussis sur cible jetable ; rien n'est vérifié sur un environnement déployé |
| UX-3 | Implémenté | Autosauvegarde bornée, états §4.2, reprise et suppression explicites, conflits | Reprise entre appareils non rejouée sur cible déployée |
| UX-4 | Implémenté | Valeurs inapplicables conservées, confirmation accessible avant enregistrement | — |
| UX-5 | Implémenté | `SectionedFields` : blocs repliables, Tout déplier/replier, un bloc à la fois | — |
| UX-6 | Implémenté | Sommaire, avancement calculé par le moteur de validation, prochain champ manquant | La couverture diagnostique garde son indicateur distinct |
| UX-7 | Partiel | Contrôles ciblés exécutés (voir journal) ; matrice §8 non close | UX-8 non livré, donc hors validation |
| UX-8 | Non livré | — | Extension de la reprise locale : hors périmètre de cette étape |
| UX-9 | Implémenté (option) | Bascule « Un bloc à la fois », réversible | Retour d'usage non collecté |
| UX-10 | Implémenté | `ChoiceInput` : radios, grille, select, seuils de présentation, adaptation mobile | — |
| UX-11 | Implémenté | Recherche dans les longues listes, sélections conservées hors filtre, retrait individuel | La terminologie garde sa propre recherche, non dupliquée |
| UX-12 | Implémenté (a)+(b) | Contexte de base réinitialisé pendant le rendu, chargement/erreur/introuvable distingués avec reprise, pagination en tête de liste, préférence de colonnes par utilisateur et base, palette relue à chaque ouverture avec erreur réessayable, recherche par code et tri résolus par le serveur avec départage stable | (c) recherche nominative non livrée : l'écran annonce l'indisponibilité sans émettre de requête |
| UX-13 | Implémenté | `ConfirmDialog` (focus initial, piège de Tab, Échap, fond inerte, restitution du focus), `ValidationSummary`, erreurs au point d'action | Aucun audit d'accessibilité complet |
| UX-14 | Implémenté (a)+(b)+(c) | Espaces Variables/Sections/Règles avec compteurs, index des sections, blocs repliés par défaut au-delà de 60 variables, tri de consultation sans écriture, réinitialisation des filtres, cinq états du panneau, garde de modification non enregistrée, règles liées à une variable, recherche et filtres de règles, sélecteurs de variables recherchables ; (c) contrat serveur `create_rule_batch` / `preview_rule_batch`, panneau de cibles multiples et duplication guidée | (d) déplacement direct et mesures de réactivité non livrés |
| UX-15 | Implémenté | Conflits présentés champ par champ, arrêt d'import entre unités atomiques avec bilan d'exécution, état de génération d'export, historique structuré avec projection et exclusions consignées | Un arrêt d'import n'annule aucune écriture ; la projection d'un export ancien peut ne pas avoir été consignée, et l'écran le dit |
| UX-16 | Validé localement | Migration `20260912090000_ux_common_group.sql`, organisation versionnée des rubriques communes, éditeur staff, rendu repris dans les formulaires, aperçu, détail et contexte intake ; lecture sécurisée, écriture atomique, défaut et copie de version ; critères d'éligibilité de la variable diagnostique rendus lisibles ; rubriques portées par le dictionnaire d'export dans leurs propres colonnes | Aucun parcours navigateur ni environnement déployé ; l'import de bloc clinique reste volontairement limité à son bloc et ne déplace pas de variables communes ; la fonction d'export exige que sa migration soit appliquée avant son déploiement, comme toute colonne ajoutée avant elle |

## Journal de preuve

- Départ : arbre Git propre ; HEAD `e589b72`. Aucun contrôle applicatif exécuté à ce moment.
- Reprise de l'arbre de travail : 13 erreurs de `tsc` et 7 tests web en échec provenaient du
  chantier en cours. Ils ont été corrigés avant toute nouvelle fonctionnalité.
- Textes visibles : les composants introduits par ce chantier portaient des chaînes françaises
  en dur. Elles ont été déplacées dans `messages.fr.ts` et `messages.en.ts` ; la parité des clés
  est vérifiée dans les deux sens, sans doublon.
- Deux corrections de fond issues des tests, notées ici parce qu'elles changent une règle :
  - l'écoute d'événements posée par un écran parent sur un formulaire perturbe ses contrôles
    contrôlés ; `FieldForm` signale donc lui-même s'il diffère de son état initial ;
  - l'état d'ouverture des blocs de l'éditeur est ajusté pendant le rendu, pas dans un effet :
    un effet affichait d'abord un écran replié, puis le bon.
- Contrôles exécutés localement sur l'arbre courant, machine locale, PostgreSQL embarqué jetable :
  - `npm run typecheck` : succès.
  - `npm run lint` : succès.
  - `npm run test:web -- --maxWorkers=2` : 79 fichiers, **653 tests réussis sur 653**, aucune
    erreur non gérée. Une exécution antérieure avait signalé `ImportData > rafraichissement :
    relit le serveur…` : son `waitFor` d'une seconde dépend de la charge de la machine, et le
    test passe désormais dans la suite complète comme isolément. À retenir comme test fragile
    sous charge, non comme régression.
  - `npx vitest run --project db test/work-drafts.test.ts` : 8/8 — isolation des auteurs, refus
    de l'identité et des clés hors dictionnaire, quota de taille, révisions, rejeu idempotent et
    consommation atomique du brouillon.
  - `npx vitest run --project db test/rule-batch.test.ts` : 8/8 — contrat de la création groupée
    de règles (voir la section UX-14(c) plus bas).
  - `npx vitest run --project db test/security-definer-acl.test.ts` : 3/3 — allowlist des
    fonctions privilégiées, y compris les nouvelles fonctions de brouillon et de lot de règles.
  - `npm run schema`, inspection du diff, puis `npm run schema:check` : snapshot à jour
    (`20260911210000_ux_rule_batch.sql`). Le diff ajoute `work_draft`, `work_draft_operation` et
    `rule_batch_operation`, RLS activée et **aucune policy** — ces tables sont fermées aux clients
    et écrites seulement par les RPC `SECURITY DEFINER` —, quatorze fonctions, et une expiration
    par défaut à 24 heures des brouillons conforme au contrat UX-0. Aucun processus PostgreSQL
    orphelin laissé après ces exécutions.
- Contrôles NON exécutés à ce stade : suite DB complète (85 fichiers, PostgreSQL embarqué par
  fichier), build de production avec `VITE_USE_SIGNED_READ=true`, parcours navigateur Playwright,
  et toute vérification sur environnement déployé. Aucune migration distante n'a été appliquée.
- Poursuite UX-16, contrôles exécutés localement sur l'arbre courant, PostgreSQL embarqué
  jetable quand la base est concernée :
  - `npm.cmd exec vitest run --project db test/common-layout.test.ts` : **11/11** — rendu
    historique, organisation complète, rejeu idempotent, empreinte périmée, charges invalides,
    retour au repli, déplacement vers un bloc, lecture par collaborateur, écriture réservée,
    version gelée, défaut à l'ajout et copie sans référence vers la source ;
  - `npm.cmd exec vitest run --project db test/security-definer-acl.test.ts` : **3/3** —
    allowlist, privilèges et `search_path` des fonctions UX-16 ;
  - `npm.cmd exec vitest run --project web src/screens/staff/CommonLayoutEditor.test.tsx
    src/screens/member/SectionedFields.test.tsx src/data/templates.test.tsx` : **13/13** ;
  - `npm.cmd run typecheck` et lint ciblé des fichiers UX-16 : succès ;
  - `npm.cmd run schema`, inspection du diff, puis `npm.cmd run schema:check` : snapshot à
    jour jusqu'à `20260912090000_ux_common_group.sql` (50 tables, 64 policies, 79 triggers,
    326 fonctions).
  Aucun build de production, parcours navigateur, contrôle DB complet, migration distante ou
  vérification sur un environnement déployé n'a été exécuté dans cette poursuite.
- Reprise UX-16 après interruption, contrôles exécutés localement :
  - `npx vitest run --project db test/common-layout.test.ts` : **11/11**, processus PostgreSQL
    orphelins tués avant et après l'exécution ;
  - `npx vitest run --project web src/screens/staff/CommonLayoutEditor.test.tsx` : **5/5** —
    charge complète et empreinte remises au serveur, personnalisation du rendu historique,
    déplacement conjoint de la variable diagnostique et de son compagnon, refus qui conserve
    les choix locaux et rejoue la MÊME clé d'opération, version gelée sans commande d'écriture ;
  - `npx vitest run --project web src/screens/staff/DiagnosisConfigurationEditor.test.tsx` :
    **1/1** — rôle nommé sans emplacement imposé, trois motifs d'inéligibilité distincts,
    variables compatibles rangées dans un bloc comptées à part ;
  - `npm run edge:check`, `npm run edge:lint` et `npm run edge:test` : **214/214**, dont deux
    nouveaux contrôles — le dictionnaire porte la rubrique à part du bloc, et n'ajoute aucune
    colonne quand aucune rubrique n'est déclarée ;
  - `npx vitest run --project db test/security-definer-acl.test.ts` : **3/3** ;
  - `npm run schema:check` : « Snapshot de schéma à jour
    (`20260912090000_ux_common_group.sql`) », sans régénération nécessaire ;
  - `npm run typecheck`, `npm run lint` et `npm run test:web -- --maxWorkers=2` sur l'arbre
    final : succès et **662 tests réussis sur 662**, 81 fichiers, aucune erreur non gérée.
    Une exécution antérieure avait signalé un échec sur le repli de rubrique : le fichier de
    domaine avait été modifié PENDANT l'exécution, dont le cache de transformation servait
    encore l'ancienne version. À retenir comme règle de vérification, non comme régression.
  Limite de déploiement à respecter : la fonction `generate-export` lit désormais
  `template_common_group` et `template_field.common_group_id`. Sa migration doit être appliquée
  AVANT son déploiement, comme pour les colonnes ajoutées avant elle ; l'ordre inverse ferait
  échouer les exports. Aucun déploiement n'a été effectué ici.
- Proposition d'interface reçue pendant ce chantier : `docs/design/editeur-registre/` décrit une
  évolution des trois espaces de l'éditeur vers quatre espaces (Structure, Règles, Diagnostic,
  Aperçu). Elle s'appuie sur l'état livré ici et n'est pas implémentée : elle appartient à une
  session dédiée, avec ses propres critères d'acceptation.

## UX-16 — rubriques communes versionnées

La rubrique historique unique « Tronc commun » n'est pas réécrite dans les données cliniques :
une variable reste commune tant que sa section est nulle. La présentation est portée par des
rubriques nommées, ancrées avant ou après les blocs racines, et reliées à leurs variables par la
version du jeu de variables.

- Migration additive `20260912090000_ux_common_group.sql` :
  `template_common_group`, rattachement composite `template_field.common_group_id`, RLS de
  lecture identique à celle des champs, et reçu idempotent `common_layout_operation`. Aucune
  migration existante n'est modifiée.
- `common_layout_state` livre le contrat de rendu seulement à un lecteur déjà autorisé par
  `can_read_template`. `set_common_layout` réserve la modification au propriétaire, verrouille
  la version, compare son empreinte et valide la charge entière avant toute écriture. Un conflit,
  une version gelée ou déjà employée, une charge incomplète, un doublon ou une clé d'opération
  réutilisée avec une autre charge est refusé sans écriture partielle.
- Le déclencheur refuse un rattachement isolé provenant du client. Lorsqu'une nouvelle variable
  rejoint le tronc commun, elle intègre la rubrique par défaut ; les déplacements vers un bloc
  clinique retirent à l'inverse son rattachement commun. La copie partagée des versions recrée
  les rubriques et les rattachements avec les identifiants de la copie.
- L'éditeur de version propose de nommer, placer, désigner la rubrique par défaut, rechercher,
  déplacer et réordonner les variables. Il conserve son brouillon local et son identifiant
  d'opération tant que le serveur n'a pas accusé l'écriture. Le rendu de même contrat est repris
  pour la création et l'édition patient/rencontre, la curation, le détail, l'aperçu et le contexte
  intake hors ligne déjà autorisé ; sans contrat UX-16, tous restent sur le repli historique.
- Éligibilité et placement restent deux sujets. L'écran de collecte diagnostique nomme désormais
  « Variable diagnostique » — l'ancien titre désignait un emplacement que le lot rend libre —,
  explique à quoi sert ce rôle, et liste les variables communes qui ne peuvent pas le porter avec
  leur motif : calculée, type incompatible, ou masquée par une règle d'affichage. Une variable
  compatible rangée dans un bloc est comptée à part, avec ce qui la rendrait éligible. La liste
  proposée et l'explication d'un refus lisent la même fonction : l'écran ne peut pas expliquer
  autre chose que ce qu'il offre.
- Le dictionnaire d'export transporte la rubrique dans ses propres colonnes `common_group` et
  `common_group_label`, ajoutées seulement si une version exportée déclare des rubriques. Les
  écrire dans `section` ou `block` les ferait passer pour des blocs cliniques auprès de tout
  consommateur du fichier. Une variable commune garde donc ses colonnes de section et de bloc
  vides, et la projection d'export, la couverture diagnostique et les colonnes L53 ne lisent
  aucune métadonnée de placement.

Les rubriques communes ne sont pas importées par l'import de bloc réutilisable : ce flux importe
un bloc clinique avec ses variables de bloc, et ne doit ni saisir ni déplacer de variable commune
de la version cible.

## UX-14(c) — contrat serveur de la création groupée

La création groupée n'a pas été livrée comme une boucle d'écritures pilotée par le navigateur :
une erreur sur la troisième cible aurait laissé deux règles créées, exactement ce que la
spécification exclut. Le lot passe donc par une opération serveur unique.

- Migration additive `20260911210000_ux_rule_batch.sql` : table de reçus `rule_batch_operation`
  (fermée aux clients, RLS activée et aucune policy), `preview_rule_batch` et `create_rule_batch`
  exposées à `authenticated`, le reste révoqué. Aucune migration existante n'a été modifiée.
- Ce que le serveur garantit : propriété du gabarit revérifiée, version ni gelée ni déjà servie
  à des dossiers, empreinte de version attendue (aperçu périmé = conflit structuré, sans
  écriture), validation de CHAQUE cible par les assertions existantes — `assert_rule_structure`,
  `assert_rule_calculated_operands`, `assert_visibility_acyclic` —, doublons exacts signalés et
  laissés inchangés, insertion de tout le lot dans une transaction, rejeu idempotent par clé
  d'opération et empreinte de charge, refus explicite si la même clé revient avec une autre charge.
- Ce que le serveur ne réécrit pas : les règles créées sont des règles ordinaires, identiques à
  celles du formulaire guidé. Aucun langage multicible n'existe en base, et le déclencheur
  d'invariants de version continue de vérifier l'ensemble après chaque insertion — ce qui couvre
  les cycles formés par les nouvelles règles entre elles.
- Côté écran : le panneau reprend la condition d'une règle existante, présente les cibles
  groupées par section, laisse chercher et cocher sans perdre la sélection hors filtre, annonce
  exactement combien de résultats « Sélectionner les résultats » ajouterait, montre les phrases
  à créer, les doublons et les cibles refusées avec leur motif, et n'annonce aucune création
  avant le reçu du serveur. Après succès, chaque règle créée est atteignable dans la liste. Une
  comparaison ou une condition de bloc n'ouvre pas ce panneau : elle se duplique dans le
  formulaire guidé, où ses opérandes se modifient explicitement.
- Preuves exécutées : `test/rule-batch.test.ts` 8/8 sur PostgreSQL embarqué jetable (T27, T28 —
  cible inconnue, cycle, version modifiée —, T29, autorisation d'un autre compte, refus anonyme,
  charges hors contrat, version gelée) ; `test/security-definer-acl.test.ts` 3/3 après inscription
  des deux nouvelles signatures dans l'allowlist ; `npm run schema`, inspection du diff puis
  `npm run schema:check` ; `src/screens/staff/RuleBatchPanel.test.tsx` 5/5 et
  `src/screens/staff/TemplateVersionEditor.test.tsx` 14/14.
- Limites : aucun test de concurrence réelle à plusieurs connexions simultanées n'a été écrit —
  la sérialisation repose sur le verrou de version et le verrou consultatif par auteur, vérifiés
  par lecture. Rien n'est vérifié sur un environnement déployé, et aucune migration distante
  n'a été appliquée.
