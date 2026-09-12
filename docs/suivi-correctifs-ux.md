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
| UX-0 | Implémenté | Contrat, matrice de reprise et décisions ci-dessus | Les interactions de l’éditeur sont mesurées en jsdom (UX-14(d)) ; le seuil navigateur de 200 ms reste non prononcé, faute de mesure navigateur |
| UX-1 | Implémenté | Garde de départ commune, conservation après refus, correction de `MyTemplates.saveEdit`, reprise intake | L'identité saisie n'entre dans aucun brouillon : quitter la page la perd, et la garde l'annonce |
| UX-2 | Validé localement | Migration `20260910233212_ux_work_drafts.sql`, contrat de brouillon de travail, repository | Tests DB ciblés et contrôle de schéma réussis sur cible jetable ; rien n'est vérifié sur un environnement déployé |
| UX-3 | Implémenté | Autosauvegarde bornée, états §4.2, reprise et suppression explicites, conflits | Reprise entre appareils non rejouée sur cible déployée |
| UX-4 | Implémenté | Valeurs inapplicables conservées, confirmation accessible avant enregistrement | — |
| UX-5 | Implémenté | `SectionedFields` : blocs repliables, Tout déplier/replier, un bloc à la fois | — |
| UX-6 | Implémenté | Sommaire, avancement calculé par le moteur de validation, prochain champ manquant | La couverture diagnostique garde son indicateur distinct |
| UX-7 | Partiel | Matrice §8.2 close en COUVERTURE : 34 scénarios statués (15 couverts, 18 partiels, 1 non couvert), chacun avec son test exécutable ou le bord qui lui manque ; mode opératoire des preuves d’intégration | La couverture n’est pas une exécution : suite DB complète, build de production et parcours navigateur restent à lancer, et T20 ne peut être fermé que par un navigateur réel |
| UX-8 | Validé localement | Matrice des données locales autorisées et vérifiée à l’écriture, format d’enveloppe versionné et migration, balayage résistant à un enregistrement corrompu et rejoué au retour sur l’onglet, lecture symétrique de l’écriture, purge des traces d’un autre compte indépendante du marqueur de propriétaire, clés d’envoi opaques et migrées, contexte intake expiré balayé, temporisation alignée sur UX-0 | Aucun chiffrement local : la politique ne tranche pas et la décision appartient à son responsable. Aucun changement de support, aucune preuve O6/O7 close, aucune purge sur révocation de droits, aucun parcours navigateur ni environnement déployé |
| UX-9 | Implémenté (option) | Bascule « Un bloc à la fois », réversible | Retour d'usage non collecté |
| UX-10 | Implémenté | `ChoiceInput` : radios, grille, select, seuils de présentation, adaptation mobile | — |
| UX-11 | Implémenté | Recherche dans les longues listes, sélections conservées hors filtre, retrait individuel | La terminologie garde sa propre recherche, non dupliquée |
| UX-12 | Implémenté (a)+(b)+(c) | Contexte de base réinitialisé pendant le rendu, chargement/erreur/introuvable distingués avec reprise, pagination en tête de liste, préférence de colonnes par utilisateur et base, palette relue à chaque ouverture avec erreur réessayable, recherche par code et tri résolus par le serveur avec départage stable ; (c) recherche nominative auditée, rendant des identifiants et jamais un nom | (c) la colonne « Nom complet » reste hors périmètre : chercher un nom et l’afficher sont deux décisions d’exposition distinctes. Aucun parcours navigateur, aucune inspection de cache, aucun environnement déployé |
| UX-13 | Implémenté | `ConfirmDialog` (focus initial, piège de Tab, Échap, fond inerte, restitution du focus), `ValidationSummary`, erreurs au point d'action | Aucun audit d'accessibilité complet |
| UX-14 | Implémenté (a)+(b)+(c)+(d) | Espaces Variables/Sections/Règles avec compteurs, index des sections, blocs repliés par défaut au-delà de 60 variables, tri de consultation sans écriture, réinitialisation des filtres, cinq états du panneau, garde de modification non enregistrée, règles liées à une variable, recherche et filtres de règles, sélecteurs de variables recherchables ; (c) contrat serveur `create_rule_batch` / `preview_rule_batch`, panneau de cibles multiples et duplication guidée ; (d) déplacement direct d’une variable vers une section et avant/après une variable, au clavier, et relevé de réactivité sur 216/24 | (d) mesures faites en jsdom, pas en navigateur : le seuil de 200 ms d’UX-0 reste non prononcé. Les modifications structurelles groupées restent une extension à confirmer après usage, comme la spécification le prévoit |
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
- UX-8, contrôles exécutés localement sur l'arbre final :
  - `npx vitest run --project web src/data/drafts.test.tsx` : **11/11** — matrice refusée avant
    écriture, enregistrement corrompu supprimé sans interrompre le balayage, format antérieur
    relu et migré, format inconnu ni servi ni détruit avant son terme, clé sans compte servie à
    personne, enveloppe tronquée écartée, brouillons d'un autre compte effacés ;
  - `npx vitest run --project web src/data/offline.test.tsx` : **8/8**, dont le balayage des
    contextes intake expirés et celui des enregistrements d'un autre compte ;
  - `npx vitest run --project web src/data/inspection.test.tsx` : **2/2** — clé d'envoi opaque
    et reprise de l'ancien format ;
  - `npx vitest run --project web src/auth/AuthProvider.test.tsx` : **15/15**, dont l'ouverture
    de session sans marqueur de propriétaire ;
  - `npm run typecheck`, `npm run lint` et `npm run test:web -- --maxWorkers=2` : succès et
    **672 tests réussis sur 672**, 82 fichiers, aucune erreur non gérée.
  Deux corrections issues de ces contrôles, notées parce qu'elles changent une règle :
  - une défense en profondeur ne doit ni retarder ni empêcher la garantie qu'elle renforce —
    voir la leçon d'ordonnancement consignée dans la section UX-8 ;
  - fermer la lecture du brouillon local dans le parcours connecté supprimait la protection
    anti-perte A4, que deux tests fixent. La lecture est rétablie et le risque résiduel est
    consigné plutôt qu'arbitré ici.
- UX-12(c), contrôles exécutés localement :
  - `npx vitest run --project db test/patient-identity-search.test.ts` : **10/10** — P05 et P06,
    isolement inter-base sur un homonyme, insensibilité à la casse et aux accents, terme traité
    comme du texte, terme trop court, pagination et total, journal sans terme, aucune trace
    d'accès sur un refus, fermeture à l'anonyme et à l'aide interne de normalisation ;
  - `npx vitest run --project db test/security-definer-acl.test.ts` : **3/3** après inscription
    de la signature dans l'allowlist ;
  - `npm run schema`, inspection du diff, puis `npm run schema:check` : le diff n'ajoute que
    les deux fonctions — aucune table, aucune policy, aucun déclencheur modifiés ;
  - `npx vitest run --project web src/screens/member/Patients.test.tsx` : **22/22**, dont P05
    à l'écran, le refus de moins de deux caractères, l'absence de mode nominatif sans droit et
    le retour au code après révocation ;
  - `npm run typecheck` et `npm run lint` : succès.
- UX-14(d), contrôles exécutés localement sur l'arbre final :
  - `npx vitest run --project web src/domain/templateFields.test.tsx` : **3/3** — la conversion
    « variable lue → charge d'écriture » reporte chaque attribut, dans les deux sens ;
  - `npx vitest run --project web src/screens/staff/FieldMoveDialog.test.tsx` : **8/8** — ordre
    calculé (après, avant, en tête, en fin, section vide, repère effacé), destination annoncée,
    repères remis à zéro au changement de section, déplacement mené entièrement au clavier ;
  - `npx vitest run --project web src/screens/staff/TemplateVersionEditor.test.tsx` : **16/16**,
    dont le déplacement vers une autre section sans réécriture d'attribut et le refus sous tri
    de consultation ;
  - `npx vitest run --project web src/screens/staff/TemplateVersionEditor.mesures.test.tsx
    --reporter=verbose` : **1/1**, relevé reporté dans la section UX-14(d) ci-dessous ;
  - `npm run typecheck` et `npm run lint` : succès.
  Deux constats issus de ces contrôles :
  - envelopper un `waitFor` dans un `act` bloque la file de rendu : l'écriture restait sur
    « Enregistrement en cours… » et la mesure ne mesurait plus que son propre délai d'attente ;
  - la mise à jour de la liste après un enregistrement dépasse la seconde sur 216 variables,
    donc le délai d'attente par défaut de la bibliothèque de test ne suffit pas à l'observer.
- Proposition d'interface reçue pendant ce chantier : `docs/design/editeur-registre/` décrit une
  évolution des trois espaces de l'éditeur vers quatre espaces (Structure, Règles, Diagnostic,
  Aperçu). Elle s'appuie sur l'état livré ici et n'est pas implémentée : elle appartient à une
  session dédiée, avec ses propres critères d'acceptation.

## UX-7 — matrice §8.2 : couverture des scénarios

**Ce tableau dit ce qui est COUVERT par un test exécutable, pas ce qui a été exécuté.** La
distinction est le risque même que le lot nomme : « succès de composants isolés confondu avec
validation complète ». Les exécutions sont reprises par le porteur du projet ; le mode
opératoire est donné après le tableau.

Lecture des statuts :

- **Couvert** — un test exécutable vérifie le scénario de bout en bout.
- **Partiel** — une partie est vérifiée ; la colonne dit précisément ce qui ne l'est pas.
- **Non couvert** — aucun test exécutable ne le vérifie ; du code qui en a l'air ne compte pas.

Un scénario qui exige un vrai navigateur — peinture, clavier virtuel, PWA, zoom, thèmes,
téléphone — ne peut pas dépasser « partiel » avec les outils locaux : jsdom ne peint pas.

| Test | Statut | Preuve exécutable | Ce qui n'est pas vérifié |
|---|---|---|---|
| T01 | Couvert | `SectionedFields.test.tsx` — « collapse and one-block navigation preserve answers » | — |
| T02 | Partiel | `test/work-drafts.test.ts` — « révision attendue, rejeu exact » ; `workDraftSession.test.tsx` | Le rechargement réel de la page n'est pas rejoué : le remontage jsdom l'approche, il ne le reproduit pas |
| T03 | Partiel | `drafts.test.tsx` — quota et durée de vie ; `saveDraft` rend `false` | Le bandeau « Sauvegarde locale impossible » n'a pas de test qui l'observe après un refus de quota |
| T04 | Partiel | `drafts.test.tsx` (cloisonnement par compte) ; `test/offline-intake.test.ts` (isolation) | Le parcours intake complet — créer, quitter, revenir, reprendre — n'est pas rejoué à l'écran |
| T05 | Couvert | `test/work-drafts.test.ts` — « deux onglets concurrents » ; `workDraftSession.test.tsx` — « a conflicting second tab » | — |
| T06 | Couvert | `test/work-drafts.test.ts` — « commit et réponse perdue » ; `workDraftSession.test.tsx` — « a lost commit response » | — |
| T07 | Couvert | `test/work-drafts.test.ts` — « suppression idempotente et expiration ne ressuscitent pas » | — |
| T08 | Partiel | `AuthProvider.test.tsx` — purge A→B, traces d'un autre compte ; `test/work-drafts.test.ts` — isolation des auteurs | Une révocation de droits **pendant** la session n'est pas rejouée : rien ne purge sur révocation (limite UX-8) |
| T09 | Couvert | `EncounterFields.test.tsx` — retrait annoncé, annuler conserve, confirmer enregistre la projection | — |
| T10 | Partiel | `ChoiceInput` / options — option désactivée conservée, valeur hors liste gardée | La reprise d'un brouillon dont la **version de gabarit a changé** n'a pas de test : le refus existe dans `EncounterForm`, rien ne l'observe |
| T11 | Couvert | `SectionedFields.test.tsx` — « an error summary opens a collapsed block » | — |
| T12 | Couvert | `SectionedFields.test.tsx` — « counts follow visibility, permitted missing codes… » | — |
| T13 | Couvert | `ChoiceInput.test.tsx` — « search filters options without moving or dropping selections » ; tests de terminologie | — |
| T14 | Couvert | `Patients.test.tsx` — changement de base, base illisible, pagination | — |
| T15 | Couvert | `Patients.test.tsx` — recherche serveur au-delà de la page ; `test/patient-identity-search.test.ts` — 10 cas | — |
| T16 | Couvert | `AppShell.test.tsx` (trois rôles) ; `CommandPalette.test.tsx` ; `Patients.test.tsx` P06 | — |
| T17 | Partiel | `ConfirmDialog.test.tsx` — piège de Tab, Échap, focus rendu ; `AppShell.test.tsx` — tiroir mobile | Le lien d'accès direct au contenu principal n'a pas de test ; la navigation clavier réelle reste hors jsdom |
| T18 | Partiel | Garde de modification non enregistrée dans `TemplateVersionEditor.test.tsx` | Le **refus serveur** d'un renommage, panneau gardé ouvert et valeurs conservées, n'a pas de test qui l'observe |
| T19 | Couvert | `ImportData.test.tsx` — arrêt entre unités, lot ambigu, double clic ; `test/import.test.ts` — idempotence et lots | — |
| T20 | **Non couvert** | — | Le formulaire cible (12 blocs × 20 variables, sous-sections, choix longs) sur ordinateur, mobile, zoom et thèmes exige un navigateur réel |
| T21 | Partiel | `FormPreview.test.tsx` — aucune écriture locale, aucune clé de brouillon | La fidélité du rendu sur le modèle cible relève du navigateur |
| T22 | Partiel | Séparation structurelle : `work_draft` est une table distincte des fiches exportées | Aucun test n'affirme l'absence du brouillon de travail dans un export ou une statistique |
| T23 | Couvert | `TemplateVersionEditor.test.tsx` — fixture 216, variable en fin de modèle, « T23 : passer à la variable suivante ne perd pas une édition » | — |
| T24 | Couvert | `TemplateVersionEditor.test.tsx` — recherche et filtres de règles ; `RuleForm.test.tsx` — sélecteur recherchable | — |
| T25 | Partiel | `FieldMoveDialog.test.tsx` (8 tests) ; `TemplateVersionEditor.test.tsx` — déplacement sans réécriture ; `templateFields.test.tsx` — conversion exhaustive | L'**échec intermédiaire** (section écrite, rang refusé) n'est pas provoqué par un test : l'ordre des deux écritures est raisonné, pas éprouvé |
| T26 | Partiel | `TemplateVersionEditor.mesures.test.tsx` — sept interactions relevées, écran non remis en chargement | Les durées sont mesurées en jsdom ; le seuil de 200 ms d'UX-0 exige une mesure navigateur |
| T27 | Couvert | `test/rule-batch.test.ts` T27 ; `RuleBatchPanel.test.tsx` | — |
| T28 | Couvert | `test/rule-batch.test.ts` T28 — cible inconnue, cycle, empreinte périmée, refus en bloc | — |
| T29 | Partiel | `test/rule-batch.test.ts` T29 — rejeu et clé réutilisée ; `RuleBatchPanel.test.tsx` — conflit | « Modifier ensuite une règle générée ne modifie pas les autres » n'a pas de test dédié |
| T30 | Partiel | `test/common-layout.test.ts` T30 ; `SectionedFields.test.tsx` — intercalation ; `CommonLayoutEditor.test.tsx` | Les cinq surfaces (saisie, édition, consultation, aperçu, sommaire) ne sont pas comparées entre elles dans un même test |
| T31 | Partiel | `CommonLayoutEditor.test.tsx` — la variable diagnostique emmène son compagnon | Couverture diagnostique et projection L53 inchangées après déplacement : aucun test ne le vérifie |
| T32 | Partiel | `test/common-layout.test.ts` — copie sans référence à la source ; repli historique dans `templateSections` | L'import L58 d'un bloc réutilisant une variable commune n'est pas rejoué |
| T33 | Partiel | `test/common-layout.test.ts` — version gelée, refus, rejeu, rubrique vidée ; `CommonLayoutEditor.test.tsx` | Le **déplacement concurrent** (deux sessions simultanées) n'est pas rejoué : la sérialisation repose sur le verrou de version, vérifié par lecture |
| T34 | Partiel | `DiagnosisConfigurationEditor.test.tsx` — trois motifs d'inéligibilité ; `exportContract_test.ts` — rubrique ≠ bloc au dictionnaire | Le renommage d'une variable diagnostique sans changement de clé n'a pas de test qui l'observe à l'écran |

**Compte rendu honnête : 15 couverts, 18 partiels, 1 non couvert.** Aucun scénario n'est
masqué par un test ignoré — aucun `skip` n'a été introduit par ce chantier. Les dix-huit
« partiels » ne sont pas des échecs : ce sont des bords non éprouvés, chacun nommé.

### Mode opératoire des preuves

Chaque commande, ce qu'elle démontre, et ce qu'elle ne démontre pas. Le détail des règles de
lecture d'un résultat est dans le skill `meddata-release-check`.

| Preuve | Commande | Portée réelle |
|---|---|---|
| Types | `npm run typecheck` | Inclut la parité stricte des clés i18n ; ne dit rien des Edge Functions |
| Lint | `npm run lint` | `--max-warnings 0` : un avertissement bloque |
| Suite web | `npm run test:web -- --maxWorkers=1` | jsdom : ni peinture, ni mise en page, ni clavier virtuel, ni PWA |
| Suite DB complète | `npx vitest run --project db` | ~88 fichiers sérialisés, un PostgreSQL embarqué chacun. Prévoir large, et tuer les `postgres.exe` orphelins ensuite : sinon `tsc` et les tests suivants tombent en mémoire |
| Edge | `npm run edge:check && npm run edge:lint && npm run edge:test` | Deno ; le typecheck frontend ne les couvre pas |
| Schéma | `npm run schema:check` | Vérifie seulement que le snapshot suit les migrations |
| Build de production | `$env:VITE_USE_SIGNED_READ='true'; npm run build` | Le garde-fou refuse le build sans cette variable ; il ne prouve rien du déploiement |
| Parcours navigateur | `npm run e2e:browser` avec `E2E_TARGET=local`, `E2E_MEDECIN_EMAIL`/`_PASSWORD` (idem `CURATEUR`, `ADMIN`) | Exige un Supabase joignable et des comptes fictifs. C'est la seule preuve qui ferme T20, et elle conditionne T17, T21 et T26 |

Les deux dernières lignes sont ce qui manque au journal depuis l'ouverture du chantier, et la
raison pour laquelle UX-7 reste **partiel** : la couverture est cartographiée, les exécutions
d'intégration ne sont pas faites ici.

## UX-12(c) — recherche nominative auditée

Retrouver un patient par son nom sans faire sortir ce nom. C'est la contrainte qui a dicté la
forme du contrat : l'opération serveur rend des **identifiants**, jamais une identité, et la
ligne affichée ensuite est la ligne analytique habituelle, relue par le client sous la RLS
existante. RG-9 est ainsi tenu par la séparation, pas par une précaution d'écran.

- Migration additive `20260912160000_ux_patient_identity_search.sql` : aucune table, aucune
  policy, aucun déclencheur modifiés — deux fonctions, dont une seule exposée.
- `search_patient_ids_by_identity(base, terme, limite, décalage)` vérifie, dans cet ordre :
  authentification, terme d'au moins deux caractères, **rôle `medecin`**, existence de la base,
  **`can_view_identity` sur CETTE base**. Les deux verrous viennent de la décision du
  2026-08-20 : le rôle gouverne l'affichage du champ, la permission gouverne ce que la
  recherche peut faire remonter. Un médecin éditeur de la base d'un confrère, sans droit
  d'identité sur celle-ci, ne retrouve donc personne par son nom.
- **Non-divulgation par construction** : un refus rend exactement ce que rend une recherche
  sans résultat — aucune ligne, aucun total, aucun message distinctif. C'est la convention déjà
  suivie par `get_patient_identity`, et elle vaut mieux qu'une erreur qui confirmerait
  l'existence de la base ou du patient. Une base inexistante répond comme un refus.
- **L'ordre est celui du code patient**, jamais celui du nom : trier par nom ferait de la
  position d'une ligne un indice alphabétique sur une donnée que l'appel ne rend pas. Le tri de
  consultation est donc désactivé pendant une recherche nominative, plutôt que laissé inerte.
- **Le terme est du texte, jamais un motif** : `%` et `_` sont échappés avant comparaison.
  Sans cela, un seul caractère ramènerait toute la base et la recherche deviendrait un listage.
  Aucun SQL n'est construit dynamiquement.
- La comparaison ignore la casse **et les accents**, par une table de correspondance explicite
  plutôt que par l'extension `unaccent`, dont la présence n'est pas garantie sur la cible :
  sans cela, « Andre » ne trouverait pas « André » et le champ serait inutilisable dès la
  première frappe rapide.
- **Le journal consigne l'accès, pas la recherche** : une ligne `identity_search` par recherche
  autorisée, avec l'auteur et la base, et une charge vide. Ni le terme saisi, ni ce qu'il a
  révélé n'y entrent — le journal ne doit pas devenir l'endroit où l'identité cherchée reste
  lisible. Un refus n'écrit aucune ligne : il n'y a pas eu d'accès.
- Côté écran, le mode nominatif n'apparaît qu'à un médecin disposant du droit sur cette base,
  en ligne, et seulement si le serveur sait répondre. Un droit retiré, un changement de base ou
  un passage hors connexion ramènent le champ au code **pendant le rendu**, avant qu'une requête
  ne parte encore en nominatif.

**Ce qui n'est pas livré, et pourquoi.** La **colonne « Nom complet »** dans la liste reste hors
périmètre : UX-0 exige que les résultats soient présentés par code et par variables analytiques,
et afficher le nom est une décision d'exposition distincte de celle de le chercher. Elle
appartient au reste de L64, avec ses propres preuves. Les scénarios P07 (révocation) et P08
(export, cache, URL) ne sont couverts ici qu'au niveau de l'écran et du contrat : la vérification
navigateur et l'inspection du cache restent à faire, comme L65 le prévoit.

## UX-14(d) — déplacement direct et réactivité mesurée

### Déplacer sans glisser

Sur 216 lignes, le glisser-déposer traverse plusieurs écrans et la paire de flèches demande
autant de clics que de rangs franchis. Les deux restent ; ils ne sont plus la seule voie.

- Chaque variable porte une commande **Déplacer** qui ouvre un panneau : section d'arrivée,
  position — en tête, avant une variable, après une variable, en fin — et repère choisi dans
  un sélecteur **recherchable**, celui de l'éditeur de règles, sorti dans son propre module
  plutôt que dupliqué. Tout est natif : clavier et tactile fonctionnent par construction, sans
  geste de précision, et un groupe de boutons radio reste un seul arrêt de tabulation.
- La **phrase de destination** est affichée avant la confirmation : « *Tension artérielle* sera
  placée après *Hémoglobine*, dans Biologie ». Sans elle, « avant/après » sur une liste filtrée
  est une devinette. Tant que le repère manque, la confirmation reste désactivée.
- Le rang enregistré est global à la version alors que le formulaire regroupe par section au
  rendu : `computeMovedOrder` est donc exporté et testé seul, parce que c'est lui qui décide ce
  qui part au serveur. Une section d'arrivée vide, un repère effacé entre-temps et le tronc
  commun ont chacun leur cas.
- Deux écritures, dans cet ordre : la section, puis le rang. Si la seconde échoue, la variable
  est dans la bonne section à son ancien rang — visible et corrigeable. L'inverse laisserait un
  rang correct dans la mauvaise section, que rien à l'écran ne signalerait.
- La modification de section passe par `templateFieldToNewField`, conversion **exhaustive**
  couverte par son propre test : la RPC remplace la ligne entière, donc un attribut oublié —
  options, formule, raisons de valeur manquante, valeur proposée, cardinalité — disparaîtrait
  du gabarit au premier déplacement, sans message et sans que personne ne le voie avant la
  saisie suivante.
- Un tri de consultation ne propose pas le déplacement, exactement comme les flèches : il
  n'écrit jamais d'ordre, et le déplacement y resterait invisible.

### Relevé de réactivité sur 216 variables / 24 règles

Mesures prises par `TemplateVersionEditor.mesures.test.tsx`, **dans jsdom**, sur cette machine :

| Interaction | Durée relevée |
|---|---|
| Rendu initial (216 variables, blocs repliés) | 715 ms |
| Ouverture d'un bloc (36 variables) | 901 ms |
| Recherche d'un terme | 276 ms |
| Filtrage par section | 2 140 ms |
| Ouverture du panneau de variable | 1 964 ms |
| Navigation vers la variable suivante | 976 ms |
| Enregistrement et mise à jour de la liste | 1 102 ms |

**Ce que ce relevé vaut, et ce qu'il ne vaut pas.** jsdom ne peint pas, ne met pas en page, et
ne connaît ni 1440 px ni 390 px : ces durées mesurent le rendu et la réconciliation React, pas
ce que voit une personne devant un navigateur. Le seuil de 200 ms d'UX-0 ne peut donc pas être
prononcé ici — il exige la mesure navigateur, qui reste ouverte. Le test sert de garde contre
un effondrement, avec un plafond volontairement large : un seuil serré sur une machine chargée
ferait un test instable, et un test instable finit ignoré.

**Décision : aucune virtualisation.** La spécification ne l'autorise que si le rendu mesuré la
justifie, et ce relevé ne l'établit pas — il n'est pas une mesure navigateur. Les deux
interactions les plus coûteuses sont celles qui re-rendent toute la liste (filtrage, ouverture
du panneau) ; un enregistrement relit en outre la version entière. C'est la piste à mesurer en
navigateur avant toute optimisation, pas à optimiser à l'aveugle.

**Garantie structurelle, elle indépendante de la machine :** une petite modification ne remet
pas l'écran en chargement. Le squelette n'apparaît qu'au tout premier chargement ; pendant la
relecture qui suit un enregistrement, la liste, la recherche et les filtres restent affichés.
Le test l'exige explicitement.

**Non livré, et volontairement :** les modifications structurelles groupées. La spécification
les pose comme « une extension à confirmer après usage de (a)/(b), pas un prérequis » ; les
livrer sans besoin observé contredirait aussi l'invariant UX-0 sur les modifications groupées
facultatives.

## UX-8 — contrat du support local

Le support local n'est pas étendu : il reste celui du parcours intake déjà autorisé, et aucune
lecture de patients hors connexion n'est ouverte. Ce lot borne ce qui est écrit sur l'appareil,
ce qui en repart, et quand.

### Matrice des données autorisées sur l'appareil

| Enregistrement | Contenu | Cloisonnement | Durée | Effacement |
|---|---|---|---|---|
| `meddata:draft:encounter:<compte>:<patient>` (localStorage) | version de gabarit, type, date, statut et valeurs analytiques ; compartiments **vérifiés à l'écriture** | par compte | 24 h depuis la création, jamais prolongée | lecture expirée, balayage au démarrage **et au retour sur l'onglet**, enregistrement réussi, déconnexion, changement de compte, **connexion d'un autre compte** |
| `work_drafts` (IndexedDB) | charge analytique du brouillon de travail | par compte | 24 h | balayage au démarrage, purge globale, **purge des enregistrements d'un autre compte** |
| `outbox` (IndexedDB) | opérations intake en attente ; identité restreinte d'une création, prévue par la politique | par compte | 24 h | idem, plus le rejeu réussi |
| `intake_context` (IndexedDB) | nom de base, variables, règles et permissions résolues | par compte | 24 h | **nouveau** : balayage au démarrage, en plus de la lecture et de la purge globale |
| `snapshots` (IndexedDB) | instantané analytique d'une base autorisée | par compte | 24 h | balayage au démarrage, purge globale |
| `upload-operation:<empreinte>` (localStorage) | identifiant d'une opération d'envoi | clé **opaque** depuis ce lot | jusqu'à la purge | purge globale |
| `meddata:offline-profile:<compte>`, `meddata:offline-cache-owner`, `meddata:theme`, `meddata:columns:…`, `meddata:recent-bases:…` | marqueur de rôle borné, marqueur de propriétaire, préférences de présentation | selon la clé | marqueur de rôle borné ; préférences permanentes | purge globale |
| `registre.lang` | langue de l'interface | aucun | permanente | **non effacée** — exception assumée, déjà fixée par un test |

Ce qui n'entre dans aucun de ces enregistrements : nom, date de naissance exacte, image,
document brut, réponse API complète. **Ce que cette matrice ne garantit pas** : une variable
analytique de type texte libre contient ce que la personne y écrit. La matrice garantit
l'absence de *compartiment* d'identité, pas l'absence d'identité saisie dans une valeur.

### Ce que ce lot change

- La matrice est **exécutable** : `saveDraft` refuse un `kind` non déclaré ou un compartiment
  inconnu, avant toute écriture. Un appelant ne peut plus glisser une identité dans un brouillon
  local par inadvertance ; l'écran annonce alors une saisie non protégée.
- Un enregistrement **illisible** n'interrompt plus le balayage : chaque enregistrement est
  traité pour lui-même. Auparavant, un seul octet corrompu conservait indéfiniment tous les
  brouillons expirés suivants, et la purge rendait `0` comme s'il n'y avait rien à faire.
- L'enveloppe porte un **numéro de format**. Un enregistrement antérieur reste lisible et se
  réécrit au format courant sans repartir son délai ; un enregistrement d'un format inconnu
  n'est ni servi ni détruit avant son terme — un onglet ancien ne doit pas effacer ce qu'un
  onglet à jour vient d'écrire pendant une mise à jour.
- La **lecture** exige désormais un compte actif, comme l'écriture. Une clé sans segment de
  compte — écrite par l'ancien format, avant le cloisonnement — n'est donc servie à personne :
  elle était jusqu'ici lisible par le premier compte ouvrant la même fiche sur ce poste.
- À la connexion, les brouillons **et** les enregistrements IndexedDB d'un autre compte sont
  effacés. Le cloisonnement reposait entièrement sur le marqueur de propriétaire : perdu, il
  laissait la file d'un autre compte sur l'appareil, invisible pour l'application mais lisible
  dans l'inspecteur. Les rendre inaccessibles ne suffit pas, ils doivent partir.
  Leçon de l'implémentation, consignée parce qu'elle se reproduirait : ce balayage a d'abord été
  placé avant la décision de propriétaire. La connexion qu'il ouvrait **bloquait la suppression
  de la base** — donc la purge inter-comptes elle-même, celle qui compte —, et l'ouverture de
  session échouait pour un ménage facultatif. Il s'exécute désormais après, et sans être
  attendu : une défense en profondeur ne doit jamais retarder ni empêcher la garantie principale.
- Le **nom** des clés d'opération d'envoi ne porte plus la base, le patient, la rencontre,
  l'empreinte du document ni le libellé libre saisi. Les enregistrements de l'ancien format
  sont repris puis effacés, sinon une relance créerait une seconde opération serveur.
- Le contexte intake expiré est balayé au démarrage, et non plus seulement à la lecture de sa
  base : préparé pour une base qu'on ne rouvre jamais, il gardait ses permissions résolues.
- Une seule temporisation pour les deux supports : 750 ms d'inactivité, 5 secondes au plus en
  saisie continue, comme le contrat UX-0 et le brouillon serveur.

### Ce que ce lot ne fait pas, et pourquoi

- **Aucun chiffrement local.** La politique ne tranche pas : elle constate qu'un chiffrement
  Web Crypto ne protège ni l'inspecteur, ni XSS, ni une session active, qu'une clé permanente
  ne doit pas être embarquée dans le frontend, et qu'une exception « données réelles »
  exigerait clé de session, TTL strict, revue RSSI/DPO et MDM. Livrer une clé locale donnerait
  une protection apparente ; la décision appartient au responsable de la politique.
- **Aucun changement de support.** La fiche L39 propose de migrer vers « une base locale déjà
  chiffrée/partitionnée comme celle utilisée pour la terminologie ou l'outbox » : aucune de ces
  bases n'est chiffrée. Bâtir sur cette phrase ferait croire qu'un chiffrement existe déjà.
- **Aucune preuve O6/O7 close.** O6 exige un aperçu isolé avec service worker réel, parcours
  navigateur, captures et vérifications en base ; une preuve de tests unitaires ne la remplace
  pas. O7 en dépend et relève de l'activation, explicitement hors de ce lot.
- **Aucune purge sur révocation de droits.** Elle demanderait un signal serveur et un contrat
  propre ; aujourd'hui, seuls la durée de vie, la déconnexion et le changement de compte
  effacent. À consigner comme suite, pas à déduire ici.
- **Les marqueurs d'enregistrements consommés, supprimés ou expirés** (charge vidée, contexte
  et horodatages conservés) ne sont jamais supprimés avant un changement de compte. Leur donner
  un second seuil de rétention est une décision, pas une déduction.
- **Une purge bloquée par un autre onglet** reste signalée sans être résolue : la personne peut
  quitter le poste en croyant avoir purgé. La résolution demande une coordination entre onglets.
- **Le fichier exporté par « télécharger les saisies non synchronisées »** échappe ensuite à
  toute purge et à toute durée de vie ; il ne contient pas d'identité, mais il reste sur le
  disque du poste.
- **La lecture du brouillon local reste ouverte dans le parcours connecté**, alors que
  l'écriture n'a lieu que dans le parcours intake. Un poste ayant fait tourner une build de
  démonstration peut donc, en production, proposer la reprise d'un brouillon écrit par l'autre
  build. Fermer cette lecture supprimerait la protection anti-perte A4 là où elle est encore
  attendue — et ses tests le fixent. Le risque est borné par le cloisonnement par compte, la
  purge à la connexion d'un autre compte et les 24 heures de durée de vie ; l'arbitrage
  appartient au responsable du parcours, pas à ce durcissement.
- **Aucun nouveau type d'opération dans la file.** La « synchronisation des révisions » existe
  déjà : chaque entrée de mise à jour porte la révision vue hors connexion (`baseUpdatedAt`),
  rejouée telle quelle comme verrou optimiste, et une création n'a pas de révision à porter.
  Ajouter une opération à la file serait une modification du contrat intake, pas un durcissement.
- **Écart à corriger hors de ce lot** : la politique de confidentialité publique énumère trois
  stockages locaux techniques et ne mentionne aucun brouillon clinique. Ce texte est opposable :
  sa mise à jour appartient à son responsable, pas à ce chantier.

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
