# Rapport final consolidé — préparation aux utilisateurs et aux données réelles

Date : 2 octobre 2026. Commit examiné : `747adef4363ec4720e9ef79c9c9e3a691af6b057`.

## Décision proposée

**Préparation à la production avec données réelles non démontrée à ce jour dans cette revue.** Je recommande une phase de mise en service suivie d'un pilote fermé, après fermeture des conditions applicables ci-dessous. Cette conclusion signifie que les preuves actuelles manquent ; elle ne signifie pas qu'une vulnérabilité exploitable a été démontrée ou que les services cloud sont nécessairement défaillants.

L'application a déjà un socle important : séparation des zones de données, RLS, validation serveur, gestion des versions et conflits, imports idempotents, inspection/quarantaine, export serveur, journalisation et outils de continuité. Les priorités sont désormais l'exploitation effective, la protection des sessions, le contrôle des transferts IA et la validation des situations terrain.

Ce rapport consolide deux documents conservés intégralement :

- [Audit final de readiness production de juillet, actualisé au 1er août](../readiness-production-2026-07-19.md).
- [Audit ciblé déploiement et utilisateurs réels du 2 octobre](audit-deploiement-utilisateurs-reels-2026-10-02.md).

## Pertinence et limites de l'ancien rapport

**Sa méthode reste pertinente.** Il distingue logiciel fonctionnel et service exploitable, exige des preuves de restauration plutôt qu'une simple sauvegarde annoncée, et couvre les responsabilités, la sécurité SQL et les autorisations de traitement. La matrice B1–B10 doit rester le fil conducteur.

**Ses résultats sont historiques.** Les nombres de tables, migrations, fonctions et tests, les incidents et les SHA de juillet ne décrivent pas le candidat actuel. Les neuf Edge Functions actuelles dépassent les six de sa matrice. Les preuves réussies restent des acquis historiques, sans être transférables automatiquement à ce commit.

**Son état final est difficile à lire.** La matrice conserve une production décrite comme incohérente en juillet, tandis que l'encadré du 1er août rapporte une release coordonnée réussie sur la cible technique production, inspection stricte comprise. La fermeture de B7 est ensuite explicitement ajoutée. Il faut lire les actualisations ensemble ; reprendre « production incohérente » ou « B7 ouvert » comme faits actuels serait incorrect.

**Les décisions d'août changent le contexte.** `docs/derogations-readiness.md` décrit la suspension de l'inspection et l'absence admise de certaines preuves pour les essais fictifs. Le workflow permet encore ces modes. Cette capacité est vérifiée dans le code ; la valeur actuelle des variables cloud ne l'est pas.

**Certaines exigences doivent être proportionnées au service.** Une astreinte 24/7 se justifie par une disponibilité clinique attendue, mais ne doit pas être présentée comme une obligation universelle d'un registre de recherche utilisé sur des horaires définis. Fixer couverture, criticité et escalade avec les responsables. Le validateur opérationnel actuel exige cependant 24/7 : toute adaptation doit être décidée et implémentée explicitement, sans contourner le contrôle.

De même, le choix PITR/sauvegarde périodique dépend d'un RPO/RTO accepté et démontré. La sauvegarde périodique n'est pas un substitut suffisant si les objectifs nécessitent une récupération plus fine. Les objectifs historiques 24 h/4 h ne constituent pas une acceptation pour les futurs établissements.

Les tests techniques et ACL doivent porter sur le candidat exact. Les documents d'hébergement, contrats et formations ont aussi leurs propres dates de validité : ils ne deviennent pas matériellement faux à chaque commit. Les gates actuels demandent néanmoins des manifestes liés au SHA ; actualiser ces manifestes avec références aux justificatifs toujours valides, et refaire les exercices concernés par les changements. Toute évolution de cette politique doit être explicite.

## Matrice B1–B10 réévaluée

Les états ci-dessous décrivent les éléments accessibles dans cette session. Aucun « non vérifié » ne doit être traduit en « inexistant ».

| Gate | Pertinence actuelle et état | Condition de fermeture pour le lancement |
|---|---|---|
| **B1 — cohérence de release** | Toujours pertinent. Pipeline coordonné présent ; alignement du frontend, DB, Storage et Edge déployés non vérifié. L'incident de juillet ne peut être affirmé actuel. | Inventaire daté de la cible, SHA du frontend, migrations, empreintes Storage/Edge, drift et parcours critiques réussis pour le candidat. |
| **B2 — fichiers** | Code strict/quarantaine présent. Release et monitor peuvent fonctionner en `paused` ; leur configuration cloud actuelle est inconnue. | Scanner permanent supervisé ; frontend/Edge/DB stricts cohérents ; sain/EICAR/panne/reprise exercés. Si les fichiers sont exclus du premier lancement, désactivation serveur effective de tous les parcours concernés et périmètre explicite. |
| **B3 — sauvegardes** | Acquis staging documentés. Cron, alerte spécifique et publication de copie immuable du workflow actuel ciblent staging. Couverture production externe inconnue. | Sauvegarde automatique production DB/Auth/Storage, alerte et détecteur d'absence, rétention approuvée, copie indépendante adaptée, clés accessibles depuis un poste de reprise distinct. |
| **B4 — restauration** | Exercice historique utile, aucune preuve actuelle examinée sur ce candidat. | Restauration isolée représentative, vérification des fichiers, droits et données ; RPO/RTO mesurés sur volume pertinent et preuve acceptée. |
| **B5 — monitoring** | Workflow et webhook prévus. Les sondes de santé ne vérifient pas un parcours authentifié complet ; réception des alertes et couverture non vérifiées. | Sondes métier synthétiques, alertes réellement reçues, surveillance externe de l'absence de runs, responsables et escalade exercée. |
| **B6 — gouvernance** | Toujours pertinent. Dossiers de préparation présents ; autorisations actuelles non examinées. | Responsabilités, finalités, base légale, résidence/transferts, sous-traitants, conservation et autorisations éthiques applicables validés. Inclure IA et mesure d'audience. |
| **B7 — protections de développement** | Fermeture historique au 1er août reconnue ; pas de nouvelle vérification live. Mode mono-personne documenté. | Contrôle live actuel des protections et environnements, revue d'accès/MFA, revue tierce adaptée aux risques. Ne pas rouvrir B7 au seul motif de son ancien incident. |
| **B8 — reprise et rollback** | Outils et exercice historique présents ; aucune preuve actuelle sur le candidat. | Retour frontend/Edge compatible avec schéma et données, reprise après migration, compatibilité PWA ancienne, procédure et durée exercées. |
| **B9 — RLS/ACL** | Inventaire et tests présents ; preuve distante ancienne. Aucun contournement démontré dans cette revue. | Rejouer contrôle des fonctions, RLS, Storage et droits sur cible actuelle ; refus directs, révocation et cloisonnement inter-bases vérifiés. |
| **B10 — exploitation** | Validateur des responsabilités et runbooks présent ; preuves actuelles non examinées. | Titulaires/suppléants, couverture, support, formation, incidents, QA clinique/scientifique et revue d'accès effectivement réalisés. |

## Éléments supplémentaires identifiés

### 1. Cohorte figée et cohérence scientifique de l'export

**Observation de code, risque à reproduire.** `cohort_member` stocke les identifiants de patients ; `create_cohort_snapshot` fige l'appartenance. `generate-export/handler.ts:454-485` relit ensuite les valeurs courantes de `patient`. La cohorte figée n'est donc pas, à elle seule, une copie figée de toutes les valeurs cliniques.

Le paginateur contrôle nombres et identifiants (`handler.ts:102-147`), ce qui protège contre de nombreux exports tronqués. Des mises à jour de valeurs sans changement de nombre peuvent toutefois passer ces contrôles. Les lectures patient/rencontre/dictionnaire se font par plusieurs requêtes, sans instantané transactionnel commun visible dans ce handler. Le fichier conservé et son hash assurent son intégrité après génération, pas une lecture à un instant unique pendant la génération.

**Action prioritaire avant export scientifique réel :** préciser le contrat « membres figés, valeurs au moment de l'export » et garantir la cohérence des valeurs lues par matérialisation transactionnelle, versionnement ou vérification de révisions avec rejet/reprise. Ne pas imposer une copie complète si le besoin métier ne la nécessite pas.

**Test de sortie :** modifier des valeurs patient et rencontre entre deux pages tout en gardant les mêmes effectifs ; l'export doit correspondre à un état cohérent défini, ou refuser/reprendre. Reproduire ensuite avec changements de gabarit et suppression. Aucun fichier scientifiquement incorrect n'a été généré pendant cette revue statique.

### 2. Révocation et URLs déjà signées

**Limite concrète du modèle d'accès.** `signed-read/handler.ts:135` produit une URL valable 120 secondes, après contrôle RLS et journalisation. Le handler n'ajoute pas `Cache-Control: no-store` à sa réponse JSON. Une autorisation retirée bloque les prochaines signatures, mais ne permet pas de promettre l'invalidation immédiate d'une URL déjà émise ou la suppression d'une copie déjà téléchargée.

**Action :** ajouter `no-store` aux réponses contenant des URLs signées ; vérifier séparément cache des objets, aperçus et comportement réel de Supabase. Documenter la fenêtre résiduelle et choisir une lecture relayée avec contrôle à chaque requête uniquement si une révocation plus immédiate est requise.

**Test de sortie :** signer, révoquer, réutiliser l'URL avant et après échéance ; fermer la session puis vérifier aperçu/cache. Réduire le TTL ne retire pas un fichier déjà acquis.

### 3. Mots de passe de mission récupérables

**Choix fonctionnel sensible, pas une fuite démontrée.** `create-mission-account/handler.ts:354-359` permet l'action `reveal` via une enveloppe chiffrée contrôlée par RPC. Les réponses sont déjà `no-store`. Le propriétaire dispose ainsi d'une voie autorisée pour récupérer le mot de passe du compte de mission.

**Conséquence :** l'attribution d'une action à ce compte ne prouve pas à elle seule quelle personne physique l'a effectuée. Le chiffrement protège le stockage ; il ne supprime pas la possibilité fonctionnelle de récupération.

**Action :** définir si les missions sont des comptes personnels ou des comptes délégués. Pour des comptes personnels, préférer activation et récupération par leur titulaire, affichage initial unique puis régénération sans relecture, et traçabilité des opérations. Évaluer MFA/réauthentification pour révélation et régénération si elles sont conservées.

**Test de sortie :** propriétaire autorisé, utilisateur sans droit, mission révoquée et action directe par API ; vérifier audit et absence de mots de passe dans logs/support. La qualité de l'audit doit refléter le modèle choisi.

### 4. Version PostgreSQL des tests et de l'environnement local

**Écart vérifié.** `supabase/config.toml:18` déclare PostgreSQL 17 ; `package.json` utilise `embedded-postgres ^18.4.0-beta.17`, et le README décrit des tests PostgreSQL 18. La version exacte réellement installée et celle du cloud n'ont pas été interrogées.

**Action :** relever `server_version` de staging et production, puis tester migrations et fonctions sur la même version majeure que la cible. Aligner configuration et documentation ou maintenir explicitement une matrice de compatibilité. Ne pas changer simplement le fichier TOML en supposant que cela met à niveau le cloud.

**Test de sortie :** migration depuis zéro et mise à niveau d'un schéma existant, suites SQL/RLS sur version cible réelle. L'écart ne démontre pas à lui seul une incompatibilité.

### 5. Sonde technique verte et panne métier

**Couverture limitée vérifiée.** `operations-monitor.mjs:179-220` teste HTML HTTP 200, santé Auth, REST avec `profiles?select=id&limit=0` et statut Storage. Ces contrôles ne prouvent ni le rendu React, ni la connexion, ni une sauvegarde autorisée, ni un refus inter-bases. Le nom `supabase-rest-rls` ne signifie pas que toute l'isolation RLS est testée : une liste vide avec `limit=0` n'en apporte pas la démonstration.

**Action :** conserver ces sondes et ajouter un parcours synthétique dans une base exclusivement QA : connexion, lecture autorisée, écriture/relecture, refus inter-base, nettoyage. Utiliser un compte minimal, des données fictives et un environnement de test séparé des patients. Superviser le départ des sondes depuis un système indépendant de GitHub.

**Test de sortie :** panne de rendu, RPC refusée ou oubliée, panne Storage et workflow désactivé doivent chacun être détectés par le contrôle adapté, avec alerte reçue.

### 6. Continuité des clés et dépendance à un seul opérateur

**Limite documentée.** `docs/continuite.md` décrit une enveloppe de clé staging liée au compte Windows via DPAPI et demande une copie en coffre organisationnel. Le workflow de copie immuable ne couvre que staging. Un artefact chiffré est inutilisable si sa clé disparaît ; une copie chez GitHub reste exposée à certains incidents du même compte/dépôt.

**Action :** organiser coffre, suppléance, versions et rotation des clés, conservation des anciennes clés nécessaires et exercice depuis un autre poste. Inventorier aussi secrets mission/IA, expirations et révocations. Distinguer copie hors Supabase et indépendance complète des accès de développement.

**Test de sortie :** un suppléant restaure un jeu fictif sans utiliser le compte ou l'ordinateur du porteur, sans exposer les clés.

## Priorités du premier audit du 2 octobre confirmées et précisées

- **Sessions :** aucune intégration MFA ou contrôle `aal2` identifié dans le parcours d'authentification étudié ; aucun verrouillage après inactivité identifié. Cela n'établit pas l'absence de MFA dans les consoles des fournisseurs. Prioriser MFA privilégiée avec contrôle serveur, puis verrouillage sur postes partagés avec conservation sûre du travail.
- **IA :** l'appel s'active selon clé/fournisseur et authentification ; absence de permission par base et de quota applicatif dans le handler examiné. Ajouter autorisation serveur, fournisseur approuvé, plafond de coût/concurrence et arrêt global. Le nettoyage des identifiants par expressions régulières n'est pas une anonymisation garantie.
- **Qualité du codage :** scores et calibrage fictif ne prouvent pas une probabilité clinique générale. Commencer avec confirmation humaine si nécessaire, évaluer erreurs par spécialité et abréviation, conserver provenance et conditions du modèle. Ne pas transformer le codage en aide à la décision clinique sans évaluation adaptée.
- **Hors-ligne :** déjà désactivé par la politique de build ordinaire. Sa réactivation nécessiterait une revue séparée des appareils perdus, durées de conservation, révocation hors réseau et expiration des saisies ; ce n'est pas un prérequis si le pilote reste en ligne.
- **Données et support :** clarifier doublons et rapprochements patients avec le métier ; vérifier import partiel/reprise, suppressions/purges, conservation des exports et sauvegardes. Éviter les pièces médicales dans le canal général de support ; utiliser identifiant d'incident et version.

## Plan de mise en service et critères d'acceptation

| Étape | Travaux | Résultat reviewable attendu |
|---|---|---|
| **1 — cadrage** | Définir établissements/pays, données, utilisateurs, volumes, finalité recherche/soin, horaires et responsabilités. Fixer RPO/RTO et traitement externe autorisé. | Périmètre signé et décisions applicables ; aucune dérogation fictive interprétée comme autorisation de données réelles. |
| **2 — exploitation** | Profil de release réelle sans dispense ; inspection stricte si fichiers ; sauvegardes/copie/alertes production ; coffre et restauration isolée. | Preuves actuelles B1–B8 applicables, alerte reçue, restauration et reprise mesurées. |
| **3 — application** | Sessions/MFA, autorisations et quotas IA ; contrat/cohérence d'export ; politique des comptes de mission ; cache des URLs. | Changements revus et tests comportementaux ciblés réussis, dont requêtes directes. |
| **4 — validation terrain** | Jouer les scénarios ci-dessous avec fixtures synthétiques et utilisateurs représentatifs. Vérifier version DB et composants déployés. | Résultats datés sur le candidat, aucune anomalie critique ouverte, validation métier/scientifique adaptée à l'usage. |
| **5 — pilote fermé** | Un établissement, groupe réduit et support identifié ; suivi incidents, sauvegardes échouées, conflits, erreurs d'import, latence/coûts et corrections de codage. | Seuils et conditions d'arrêt fixés avant pilote, bilan partagé avant élargissement. |

Scénarios minimaux : réseau coupé pendant une écriture et double clic ; modifications simultanées et export concurrent ; droits révoqués sur session/URL déjà ouvertes ; mission expirée ; changement de compte sur poste partagé ; import avec doublons/dates invalides/encodages variés ; fichier sain/EICAR/scanner en panne ; IA indisponible/ambiguë/quota épuisé ; mise à jour et retour PWA pendant saisie ; perte du backend et restauration ; montée en charge à 1×/5×/10× du volume prévu ; téléphone modeste et réseau lent ; récupération SMTP et compte privilégié avec facteur perdu.

Les critères doivent être mesurables : absence de perte silencieuse ou doublon inattendu, conflits expliqués, refus directs conformes, valeurs d'export cohérentes, réception d'alertes, RPO/RTO respectés et temps des parcours acceptables pour les utilisateurs. Aucun seuil arbitraire de performance n'est imposé sans volume et usage connus.

## Périmètre des vérifications et preuves manquantes

Revue statique ciblée : ancien audit et actualisations, rapport du 2 octobre, guides déploiement/supervision/continuité/exploitation, workflows, configuration Supabase, parcours Auth, fonctions signed-read, export, codage, comptes de mission et purge, migrations de cohorte, politique hors-ligne.

Les vérifications statiques antérieures sur politique hors-ligne, cron et parcours de codage sont conservées comme contrôles de source. Aucun test d'exploitation, tentative de pénétration, export concurrent ou transfert de texte réel n'a été réalisé. Aucun message à un tiers ni changement cloud n'a été effectué.

Pas de dépendances installées dans le checkout et Node disponible 24.19.0 contre 22.x demandé ; suites complètes, migrations et navigateur non relancés. Aucun accès authentifié aux cibles Supabase/Vercel/GitHub : secrets, protections live, version DB, historique des sauvegardes, activation du scanner, autorisations et destinataires d'alerte restent à vérifier. Cette limite interdit de conclure à leur absence actuelle ou à un GO de production.

Le nouveau rapport ajoute donc une analyse consolidée et des conditions de fermeture ; il ne remplace ni les preuves historiques ni les vérifications sur la cible finale.
