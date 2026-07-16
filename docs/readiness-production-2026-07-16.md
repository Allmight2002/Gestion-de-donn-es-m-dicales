# Audit final de readiness production — MedData

Dernière mise à jour : **2026-07-16 — Africa/Douala**
Niveau appliqué : **4 — Production readiness**
Décision technique unique : **not ready for production**
Correspondance LOT 15 : **NO-GO**
Niveau maximal d’utilisation démontré : **données fictives uniquement, dans un environnement local ou non-production isolé et réinitialisable**

Ce rapport distingue le bon fonctionnement local de l’aptitude à un usage clinique. Il ne constitue ni une autorisation juridique, ni un avis clinique ou éthique, ni une acceptation de risque par l’organisation. Aucune note globale ne remplace les conditions bloquantes.

## 1. Périmètre, branche et versions

| Élément | État constaté le 2026-07-16 |
|---|---|
| Branche de travail | codex/production-readiness |
| Commit candidat technique | 5aaf9d08f24497926167031910236fe43c833784 |
| Base de comparaison de l’audit de readiness | a84dae89bb3a10006976bf86666ddf74dd5a4884 |
| Point de départ de la présente reprise / upstream de branche | 3fc1e2b2541895887b23c43e1e6b89006322b31a |
| Merge-base avec develop et main | 3fc1e2b2541895887b23c43e1e6b89006322b31a |
| develop et main observés | e6982ceab6dc1ba8a09b371722c489fdb284482a, merge de la PR #25 |
| État Git au moment de la décision | candidat en avance de trois commits locaux non poussés ; rapport final non encore poussé ; aucun déploiement effectué |
| CI distante la plus récente applicable au code déjà poussé | verte sur 3fc1e2b et sur le merge e6982ce ; aucune CI distante sur les trois commits locaux |
| Frontend Vercel production | déploiement dpl_mkAfFCEBS3E2X4waK3iUjFCzC6HT, READY, commit e6982ce, URL gestion-de-donn-es-m-dicales.vercel.app |
| Supabase staging | projet gmsxrniiclrheehhoakn ; PostgreSQL 17.6.1.141 ; 103 migrations ; dernière migration 20260714040500 ; 6 Edge Functions |
| Supabase production | projet lrzmbwdnrjjzwossntun ; PostgreSQL 17.6.1.127 ; 86 migrations ; dernière migration 20260616098600 ; 5 Edge Functions |
| Source locale attendue | 105 migrations ; 6 Edge Functions |
| ClamAV | aucune instance durable et actuellement prouvée ; Docker local arrêté ; token staging rejeté par le monitoring |

Le commit documentaire qui contient ce rapport ne change pas le candidat technique indiqué ci-dessus. Toute preuve staging future doit nommer explicitement le SHA de code réellement déployé, pas seulement le commit documentaire.

## 2. Décision et niveaux d’utilisation

La décision est **not ready for production**, car plusieurs non-conformités critiques sont directement prouvées. Il ne s’agit donc pas seulement d’un manque de documentation :

- le frontend production est sur e6982ce tandis que le backend production a 19 migrations de retard sur la source locale, ne possède pas finalize-upload et conserve l’inspection serveur stricte désactivée ;
- le candidat 5aaf9d0 n’a jamais été déployé ni validé en staging ;
- aucune sauvegarde Supabase listée ni aucun PITR actif n’est prouvé sur staging ou production ;
- aucune restauration production n’a été exécutée ;
- le monitoring programmé échoue ;
- les contrôles d’accès, l’astreinte, la procédure d’incident médical et les validations juridiques/éthiques ne sont pas établis.

| Niveau demandé | Conclusion | Restrictions |
|---|---|---|
| 1. Données fictives uniquement | **Démontré sous restrictions** | Local ou non-production isolé, comptes de test, environnement réinitialisable, aucune décision clinique, aucun document réel |
| 2. Pilote contrôlé avec données pseudonymisées | **Interdit / non démontré** | La pseudonymisation ne supprime pas les obligations de sécurité, de continuité, d’accès, d’incident et de gouvernance actuellement bloquantes |
| 3. Données médicales réelles dans un environnement limité | **NO-GO** | Blocages critiques techniques, opérationnels et humains |
| 4. Production complète | **NO-GO** | Toutes les conditions automatiques de production ne sont pas satisfaites |

Le site actuellement étiqueté production ne doit pas être utilisé à des fins cliniques ou comme stockage durable de données, même pseudonymisées.

## 3. Modifications réalisées

### Série déjà poussée et fusionnée par la PR #25

| Commit | Objet |
|---|---|
| b8a8629 | Épinglage de Node 22 et mise à niveau contrôlée Vite/Vitest |
| 2522e3d | Réduction des droits EXECUTE implicites et traçabilité de l’état de release |
| 1378564 | Durcissement ClamAV, inspection stricte et preuve de déploiement |
| 5acdb50 | Sauvegarde coordonnée Storage et supervision programmée |
| 3fc1e2b | Dossiers juridiques Cameroun/Tchad, explicitement non validés |

### Lots locaux créés pendant la reprise finale, non poussés

| Commit | Méthode | Résultat |
|---|---|---|
| 118e2fc | apply-audit-lot | Actions GitHub épinglées à des digests immuables ; tests de non-régression CI |
| 72ffab7 | apply-audit-lot | Empêche le déploiement Git automatique Vercel de contourner la release coordonnée |
| 5aaf9d0 | apply-audit-lot + meddata-db-safety | Garde exacte du projet production ; sauvegarde chiffrée et vérifiée obligatoire avant toute écriture staging/production ; artefact conservé 30 jours |

Pour le dernier lot, les nouveaux tests ont d’abord échoué comme attendu — 3 échecs et 11 succès — puis 18/18 ont réussi après correction. La sauvegarde pré-release GitHub réduit le risque d’une migration, mais ne constitue ni un snapshot transactionnel commun base/objets, ni un PITR, ni une sauvegarde production hors site et immuable, ni une preuve de restauration production.

Une revue spécialisée indépendante, strictement en lecture seule, a confirmé avant correction que le workflow pouvait écrire sans sauvegarde préalable. Après correction, elle confirme aussi que le nouveau gate est utile mais ne ferme pas les exigences résiduelles de continuité listées ci-dessus.

Aucun secret, projet cloud, environnement distant, déploiement, migration distante ou donnée médicale réelle n’a été modifié pendant cette reprise.

## 4. Validations exécutées

| Contrôle | Résultat | Portée / observation |
|---|---|---|
| Tests ciblés du dernier lot | **Réussi : 18/18** | Release, garde de cible et sauvegarde ; Node 22.23.1 confirmé |
| npm run typecheck | **Réussi** | Candidat local |
| npm run lint | **Réussi** | Zéro avertissement admis |
| npm run test:web | **Réussi : 36 fichiers, 169/169** | Les messages jsdom de navigation et ErrorBoundary sont attendus par les tests |
| npm run test:rls | **Réussi** | 44 fichiers DB inventoriés, 418 tests ; PostgreSQL embarqué |
| npm test | **Non rejoué en agrégat** | Les deux projets Vitest web et DB ont été exécutés séparément sur le même arbre ; 587 tests au total |
| npm run db:verify | **Réussi** | 105 migrations locales ordonnées et vérifiées |
| npm run edge:fmt / edge:lint / edge:check | **Réussi** | 23 fichiers Deno/Edge |
| npm run edge:test | **Réussi : 70/70** | Tests Edge locaux |
| npm run release:edge:check | **Réussi** | 6 fonctions attendues trouvées |
| npm audit --audit-level=moderate | **Réussi** | 0 vulnérabilité déclarée par la source npm disponible |
| actionlint | **Réussi** | Workflows GitHub, y compris les nouveaux gates de sauvegarde |
| npm run build | **Réussi** | Node 22.23.1, Vite 8.1.4, 1 925 modules ; variables publiques fictives ; hors-ligne désactivé |
| Inspection du bundle | **Réussi localement** | Aucun motif service_role, clé privée ou URL DB ; index HTML SHA-256 E3EEB3E1B82B7E765FDF1F8C4D9BE7CE3090142BA37D0C38AE81EF036A4B2079 |
| E2E critiques locaux sans authentification | **Réussi : 2/2** | Refus et parcours ne nécessitant pas le staging candidat |
| E2E critiques staging authentifiés | **Indisponible : 7 scénarios** | Candidat absent de staging et comptes/fixtures exacts non utilisables ; ils ne sont pas comptés comme réussis |
| Garde négative de cible Supabase | **Réussi** | Une cible production utilisant le ref staging est refusée avant toute écriture |
| État final du diff du lot | **Réussi** | git diff --cached --check sans erreur avant commit |

Les validations locales montrent que l’application et les protections codées fonctionnent sur le candidat. Elles ne prouvent pas l’état des composants cloud déployés, l’exploitabilité 24/7 ou l’aptitude clinique.

## 5. Matrice unique de readiness

Les seuls états employés sont : prouvé conforme, prouvé non conforme, partiellement prouvé, non vérifié, preuve périmée et vérification externe requise.

| Gate | État | Preuve | Date | Environnement | Commit/version | Risque | Bloquant | Responsable | Action suivante |
|---|---|---|---|---|---|---|---|---|---|
| Release et versions | prouvé non conforme | Frontend production sur e6982ce ; backend production à 86/105 migrations, 5/6 Edge et inspection non stricte ; trois correctifs locaux non poussés | 2026-07-16 | Git, Vercel, Supabase production | candidat 5aaf9d0 ; Vercel e6982ce | Critique : composants incompatibles | Oui | Release manager | Pousser/revoir le candidat, valider staging exact ; aucune promotion production avant fermeture des autres gates |
| Sécurité | prouvé non conforme | Durcissements locaux testés ; migration ACL absente des deux projets ; production non stricte ; advisors signalent encore fonctions privilégiées largement exécutables | 2026-07-16 | Local, Supabase staging/production | local 105 ; staging 103 ; production 86 migrations | Élevé : surface de privilèges et contrôle non déployé | Oui | RSSI et responsable Supabase | Déployer d’abord en staging fictif, inventorier chaque RPC/EXECUTE et prouver les refus |
| Intégrité scientifique | partiellement prouvé | Tests locaux des exports, unités, CSV/XLSX et formules réussis ; aucune matrice scientifique staging sur le candidat exact | 2026-07-16 | Local ; ancien staging | 5aaf9d0 ; ancienne preuve a07869d | Élevé : résultat incomplet ou interprétation erronée si drift | Oui | Référent scientifique et QA | Rejouer la matrice multi-version/multi-unité sur staging exact et faire accepter les résultats |
| Données : imports, modèles, suppressions, historique, traçabilité | partiellement prouvé | RPC et tests locaux couvrent reprise, provenance et suppressions ; scénarios cloud de réponse perdue, historique et erreurs visibles non rejoués | 2026-07-16 | Local ; staging requis | 5aaf9d0 | Élevé : doublon, lot bloqué ou traçabilité incomplète | Oui | QA fonctionnelle et responsable données | E2E staging avec données fictives, erreurs injectées et vérification des journaux |
| Concurrence, atomicité et idempotence | partiellement prouvé | Tests DB locaux réussis ; migrations/RPC candidates absentes du staging et de la production | 2026-07-16 | Local, cloud non aligné | 5aaf9d0 | Élevé : état partiel ou perte silencieuse non exclue à distance | Oui | Responsable PostgreSQL/Supabase | Tests staging à deux comptes, retries, réponse perdue et contention |
| Fichiers et antivirus | prouvé non conforme | Buckets privés observés ; staging strict mais scanner durable/token non valides ; production require_server_inspection = false ; policy d’insert export cliente encore présente en production | 2026-07-16 | Supabase/ClamAV | Edge staging 24–30 ; production 2–14 | Critique : fichier non inspecté ou export falsifiable | Oui | RSSI, exploitation, responsable Supabase | ClamAV durable, secret robuste, tests sain/EICAR/fail-closed et attestation Storage sur staging |
| Hors-ligne | partiellement prouvé | Politique, TTL, purge et tests locaux réussis ; build candidat avec mode désactivé ; aucune preuve MDM/chiffrement appareil/effacement distant | 2026-07-16 | Local ; terminaux non vérifiés | 5aaf9d0 | Élevé avec toute donnée sensible locale | Oui pour pseudonymisé/réel | RSSI et exploitation poste client | Maintenir VITE_OFFLINE_MODE désactivé ; n’envisager le mode demo qu’après preuve terminal et gouvernance |
| Tests | partiellement prouvé | Typecheck, lint, 169 web, 418 DB, 70 Edge, build et tests ciblés verts ; 7 E2E staging critiques indisponibles | 2026-07-16 | Local | 5aaf9d0, Node 22.23.1 | Élevé tant que les parcours cloud exacts manquent | Oui | QA et mainteneur | Obtenir CI distante du SHA puis exécuter les 7 E2E sur l’artefact staging exact |
| Migrations, RLS, RPC et Storage | prouvé non conforme | 105 migrations locales contre 103 staging et 86 production ; release_component_state absent ; ACL corrective et hash Storage non attestés à distance | 2026-07-16 | Local, Supabase | dernières distantes 20260714040500 / 20260616098600 | Critique : migration/policy non vérifiée et drift | Oui | Responsable DB/Supabase | Sauvegarde vérifiée, db push staging coordonné, drift zéro, tests RLS/RPC/Storage |
| Edge Functions | prouvé non conforme | 6 fonctions en staging mais bundles non rattachés au candidat ; 5 en production, finalize-upload manquante ; aucun test runtime du SHA candidat | 2026-07-16 | Supabase | staging v24–30 ; production v2–14 | Critique : fonction critique manquante ou incohérente | Oui | Responsable Edge/Supabase | Déployer les 6 fonctions en staging via workflow, enregistrer versions/hashes et tester |
| CI/CD et supply chain | prouvé non conforme | Digests et blocage Git corrigés localement ; remote reste sur 3fc1e2b/e6982ce ; aucune protection de branche ni reviewer d’environnement prouvés | 2026-07-16 | GitHub/Vercel | local 118e2fc + 72ffab7 + 5aaf9d0 | Élevé : correctifs sans effet distant et contournement organisationnel | Oui | Mainteneur CI et administrateurs GitHub/Vercel | Push + PR revue, CI verte, protections/reviewers et vérification qu’aucune production n’est auto-promue |
| Staging candidat | preuve périmée | Dernière validation documentée sur a07869d et déjà incomplète ; candidat 5aaf9d0 jamais déployé ; staging a deux migrations de retard | 2026-07-16 | Staging | ancien a07869d ; distant 103 migrations | Critique : artefact candidat non validé | Oui | Release manager et QA | Release staging coordonnée autorisée, matrice complète et rapport rattaché au SHA |
| Sauvegardes base et objets | prouvé non conforme | Supabase renvoie backups null et pitr_enabled false sur les deux projets ; une sauvegarde chiffrée staging ponctuelle de 97 objets existe ; aucune preuve périodique production | 2026-07-16 | Supabase, laboratoire staging | exercice 2026-07-14 | Critique : reprise non garantie | Oui | Propriétaire infrastructure | Niveau de service adapté, backup DB géré, objets hors site/immuables, rétention et supervision |
| Restauration, RPO et RTO | partiellement prouvé | Exercice isolé staging DB/Auth/Storage réussi, 97/97 objets, RTO laboratoire 3 min 10 s ; pas sur le candidat ni sur une sauvegarde production ; RPO/RTO non approuvés | 2026-07-16 | Laboratoire staging | état du 2026-07-14 | Critique pour données réelles | Oui | Continuité, direction, exploitation | Définir RPO/RTO, refaire après staging candidat puis tester périodiquement une sauvegarde production représentative |
| Monitoring, logs et alertes | prouvé non conforme | Neuf exécutions programmées en échec ; dernière 29477543749 ; APP_URL staging absent, token ClamAV invalide, production non configurée ; aucune astreinte/alerte testée | 2026-07-16 | GitHub Actions, cloud | workflow distant 3fc1e2b | Critique : incident non détecté ou non traité | Oui | Responsable exploitation | Configurer variables/secrets, obtenir plusieurs runs verts, injecter une panne et prouver la réception d’alerte sans donnée sensible |
| Accès, MFA, moindre privilège et secrets | prouvé non conforme | 5 collaborateurs directs avec push ; aucune branch protection/ruleset utilisable sur le plan ; aucun reviewer d’environnement ; MFA/rotation non prouvés ; environnement production GitHub vide | 2026-07-16 | GitHub, Vercel, Supabase | état live | Élevé : changement non approuvé ou compromission | Oui | Propriétaire organisation et RSSI | Plan adapté, revue nominative, MFA, moindre privilège, reviewers, rotation et gestionnaire de secrets |
| Rollback et forward recovery | partiellement prouvé | Déploiement Vercel précédent disponible et procédure écrite ; aucun exercice coordonné DB/Storage/Edge ; migrations additives mais retour fonctionnel non mesuré | 2026-07-16 | Vercel/Supabase | frontend antérieur a84dae8 disponible | Élevé : interruption prolongée ou récupération improvisée | Oui | Release manager et continuité | Exercice staging chronométré, critères de choix rollback/forward recovery et preuve d’intégrité |
| Conformité, hébergement, DPA, juridique et éthique | vérification externe requise | Modèles Cameroun/Tchad marqués projet non validé ; 39 cases non cochées dans chaque checklist ; aucun DPA, avis éthique, autorité ou signature prouvé | 2026-07-16 | Organisation, Cameroun/Tchad/UE | documents v0 | Critique pour toute donnée réelle ou pseudonymisée | Oui | Responsable de traitement, juridique, DPO, comité éthique | Compléter, faire statuer les autorités compétentes et archiver les décisions signées |
| Procédure d’incident médical | prouvé non conforme | Modèles présents mais aucun contact 24/7, titulaire, délai validé, autorité de notification ou exercice réel renseigné | 2026-07-16 | Organisation | documents v0 | Critique : réponse médicale et réglementaire non opérable | Oui | Direction, DPO et RSSI à nommer | Procédure approuvée, annuaire, astreinte, exercice de crise et compte rendu |
| Exploitation et responsabilités | prouvé non conforme | Documentation technique disponible ; propriétaires, suppléants, astreinte, runbooks acceptés et capacité de support non nommés | 2026-07-16 | Organisation | N/A | Élevé : service sans responsabilité opposable | Oui | Direction et responsable exploitation | Affecter chaque rôle, faire accepter les runbooks, former et tester l’escalade |

## 6. Blocages critiques et élevés encore ouverts

| ID | Sévérité | Constat actuel | Condition fermée seulement lorsque |
|---|---|---|---|
| B1 | Critique | Candidat exact absent de staging | Déploiement coordonné staging du SHA, drift zéro, E2E et matrice complète réussis |
| B2 | Critique | Release production incohérente | Frontend, DB, Storage et Edge sont rattachés au même SHA validé, sans bypass |
| B3 | Critique | Production sans finalize-upload et inspection antivirus stricte désactivée | Six fonctions cohérentes, ClamAV durable, tests sain/EICAR/fail-closed et strict = true |
| B4 | Critique | Sauvegarde gérée/PITR et sauvegarde objets production non prouvés | Backups périodiques supervisés, rétention/offsite/immutabilité et preuve horodatée |
| B5 | Critique | Restauration production non testée, RPO/RTO non approuvés | Exercice réussi, mesures enregistrées et objectifs acceptés |
| B6 | Critique | Monitoring en échec et procédure d’incident médical inopérante | Runs verts, alertes testées, contacts/astreinte et exercice d’incident |
| B7 | Critique | Cadre juridique, éthique et DPA non validé | Décisions humaines signées par les autorités compétentes |
| B8 | Élevé | Deux migrations manquent en staging et dix-neuf en production ; ACL/RLS/RPC/Storage candidats non attestés | Validation staging additive, tests d’autorisation et manifeste de drift exact |
| B9 | Élevé | Contrôles GitHub, reviewers, MFA et moindre privilège non prouvés | Protections actives, accès revus, MFA et approbations d’environnement attestés |
| B10 | Élevé | Preuves scientifiques/concurrence/import sur staging exact absentes | Scénarios complets réussis, sans perte silencieuse ni résultat incorrect |

Aucun export scientifiquement incorrect ni perte silencieuse n’a été observé dans les tests locaux du candidat. Cela ne ferme pas B10 : l’environnement distant et les versions déployées diffèrent du candidat.

## 7. Périmètre autorisé tant que les blocages restent ouverts

### Données autorisées

Uniquement des données entièrement fictives, sans reprise d’un dossier réel, sans identifiant réel, sans document réel et sans possibilité raisonnable de ré-identification d’une personne.

### Utilisateurs autorisés

Développeurs et QA explicitement affectés, avec comptes de test dédiés. Aucun patient, professionnel en activité clinique, partenaire externe ou utilisateur production ne doit y traiter un cas réel.

### Fonctionnalités à désactiver ou à tenir interdites

- mode hors-ligne, sauf essai local explicite avec VITE_OFFLINE_MODE = demo, reconnaissance administrateur et données fictives jetables ;
- import de dossiers ou fichiers issus d’un système réel ;
- upload de documents réels ;
- export utilisé pour une publication, une décision scientifique ou clinique ;
- envoi d’invitations à des utilisateurs externes ou création de comptes de production ;
- promotion vers production, migration distante et déploiement Edge ;
- usage clinique de l’URL Vercel actuellement en production.

### Risques acceptés

Aucun risque clinique, réglementaire ou de confidentialité n’est accepté par ce rapport. Le seul risque résiduel tolérable est celui d’une démonstration technique isolée avec données fictives et réinitialisables, sans dépendance opérationnelle.

### Contrôles compensatoires

- environnement non-production isolé et réinitialisable ;
- données synthétiques et documents factices uniquement ;
- comptes de test minimaux ;
- hors-ligne désactivé par défaut ;
- aucune décision clinique ou scientifique fondée sur les sorties ;
- sauvegarde avant toute future écriture staging ;
- surveillance manuelle de la session de test et purge après essai.

### Conditions de suspension immédiate

Suspendre même la démonstration si une donnée réelle ou pseudonymisée est détectée, si l’identité d’un compte est inconnue, si le scanner/monitoring échoue, si la sauvegarde vérifiée manque, si un secret est exposé, si le SHA ou l’environnement dérive, si un accès interdit réussit, ou si un test critique régresse.

## 8. Actions externes restantes

### Autorisation groupée A — Publier les correctifs pour revue, sans déploiement

- Service : GitHub, dépôt MedData.
- Cible : branche codex/production-readiness puis PR brouillon vers develop.
- Commandes proposées après autorisation :
  - git push origin codex/production-readiness
  - gh pr create --draft --base develop --head codex/production-readiness --title "Production readiness hardening" --body-file FICHIER_DESCRIPTION_VALIDE
- Effets attendus : publication des commits locaux, exécution de la CI, revue des gates ; aucun merge, aucune migration et aucune promotion production.
- Risques : création éventuelle d’un preview Vercel ; erreur de cible de PR ; exposition de métadonnées non sensibles du rapport.
- Prérequis : relire le diff final, confirmer que les trois documents stratégie non liés restent hors commit, vérifier que Vercel ne peut pas promouvoir automatiquement la production.
- Retour arrière : fermer la PR et supprimer la branche distante ; aucun rollback de données n’est nécessaire puisqu’aucune écriture cloud métier n’est prévue.
- Preuve à collecter : SHA distant, URL PR, checks CI, manifeste, absence de promotion production et revue humaine.

### Autorisation groupée B — Préparer puis exécuter un staging fictif exact

Cette action ne doit être demandée qu’après revue et intégration contrôlée de A.

- Services : GitHub Actions, Supabase staging, ClamAV staging et Vercel preview/staging.
- Configuration requise avant exécution :
  - gh variable set APP_URL --env staging --body URL_STAGING_HTTPS
  - gh secret set STORAGE_BACKUP_ENCRYPTION_KEY --env staging
  - rotation/configuration de CLAMAV_SCAN_URL et CLAMAV_SCAN_TOKEN, puis vérification des autres secrets du workflow sans les afficher.
- Déclenchement proposé :
  - gh workflow run coordinated-release.yml --ref develop -f target=staging -f ref=SHA_IMMUABLE_APPROUVE
- Effets attendus : validation complète, sauvegarde chiffrée et vérifiée, migrations additives staging, Storage, six Edge Functions, inspection stricte, frontend de staging, drift et E2E.
- Risques : indisponibilité staging, migration additive défectueuse, perte d’un objet staging, coût et exposition temporaire d’un preview.
- Prérequis : données fictives, scanner durable, sauvegarde vérifiable hors runner, comptes E2E dédiés, fenêtre de test et responsables présents.
- Retour arrière : frontend précédent ; versions Edge précédentes si compatibles ; restauration du backup pré-release ou forward recovery pour la DB ; aucune migration destructive.
- Preuves à collecter : SHA, run ID, manifestes frontend/backend, backup chiffré, rapport de vérification, liste des 105 migrations, hash Storage, six versions Edge, strict = true, tests RLS/RPC/AV, 7 E2E critiques et rapport staging signé.

### Actions organisationnelles et infrastructure

| Action | Responsable attendu | Preuve acceptable | Niveau interdit tant que l’action reste ouverte |
|---|---|---|---|
| Choisir un plan Supabase avec sauvegardes adaptées, définir PITR si le RPO l’exige, et sauvegarder aussi les objets | Propriétaire infrastructure + direction | Configuration live, historique de backups, rétention, chiffrement, alertes | Pilote pseudonymisé et données réelles |
| Exécuter une restauration représentative et approuver RPO/RTO | Continuité + exploitation + direction | Rapport horodaté, checks d’intégrité, temps mesurés, signatures | Pilote pseudonymisé et données réelles |
| Mettre GitHub/les clouds sous protections, reviewers, MFA et moindre privilège | RSSI + administrateurs | Exports de configuration et revue nominative datée | Toute production |
| Rendre le monitoring opérationnel et tester une alerte | Exploitation | Plusieurs runs verts et compte rendu d’injection de panne | Toute production |
| Nommer les titulaires/suppléants et l’astreinte | Direction | RACI accepté et annuaire d’escalade | Données réelles |
| Valider procédure d’incident, DPA, hébergement, AIPD/DPIA, base légale et avis éthique | Responsable de traitement, DPO, juridique, éthique | Documents signés et décisions des autorités compétentes | Pilote pseudonymisé et données réelles |

Aucune action production n’est proposée à ce stade.

## 9. Réévaluation

Nouvelle évaluation obligatoire à l’événement le plus proche parmi :

1. déploiement du candidat exact en staging et achèvement de toutes les preuves demandées ;
2. modification du code, d’une migration, d’une policy RLS/Storage, d’une Edge Function, d’un secret, du scanner, du pipeline ou de l’hébergement ;
3. mise en place de sauvegardes/restauration, monitoring, accès et validations humaines ;
4. au plus tard le **2026-08-15** si aucun changement n’est intervenu, car les observations cloud et les accès devront être rafraîchis.

Un GO futur nécessitera la fermeture de chaque condition bloquante. La seule réussite de la CI ou le simple fait que l’application s’ouvre ne suffira pas.

## 10. Sources examinées

- rapport initial : docs/audit-complet-2026-07-10.md ;
- audit multi-agents et revues indépendantes : docs/audit-multiagents-2026-07-10.md et docs/brief-audit-prochain.md ;
- rapports staging : docs/validation-staging-lot-13-2026-07-12.md et docs/validation-staging-lot-13-2026-07-13.md ;
- preuve de sauvegarde/restauration : docs/validation-restauration-staging-2026-07-14.md et artefact local chiffré 20260714T225528Z-coordinated, revérifié ;
- exploitation : docs/supervision.md, docs/pipeline-release-coordonnee.md, docs/deploiement.md, docs/e2e-staging.md et docs/e2e-browser.md ;
- architecture, Storage et Edge : docs/architecture.md, docs/edge-functions.md, supabase/storage.sql, migrations et fonctions versionnées ;
- conformité : docs/juridique/README.md et dossiers Cameroun/Tchad ;
- rapports de lots : historique Git et tests associés entre 29030bc, a84dae8, 3fc1e2b et 5aaf9d0 ;
- résultats locaux de tests et builds du 2026-07-16 ;
- inventaires live GitHub, Supabase et Vercel du 2026-07-16 ;
- documentation Supabase officielle sur les sauvegardes et la mise en production : https://supabase.com/docs/guides/platform/backups et https://supabase.com/docs/guides/deployment/going-into-prod.

Il n’existait pas de fichier séparé intitulé « audit global de validation » ou « matrice opérationnelle » dans l’historique examiné. Les rapports staging, restauration, supervision, l’historique des lots, les tests et les inventaires live ont donc été consolidés ici en une matrice opérationnelle unique, sans inventer de preuve manquante.
