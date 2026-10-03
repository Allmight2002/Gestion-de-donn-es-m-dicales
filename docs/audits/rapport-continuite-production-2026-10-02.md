# Préparation sauvegarde et restauration production — 2 octobre 2026

> **Document historique conservé.** La suite du travail cloud, les corrections et
> résultats réellement observés le 3 octobre figurent dans le
> [rapport d'exercice isolé](rapport-exercice-restauration-isolee-2026-10-03.md).
> Les blocages réseau et validations ci-dessous décrivent la session du 2 octobre.

**Verdict : changements locaux prêts à relire ; production non activée ; restauration
complète non validée.** Branche `codex/production-continuity`, base du checkout
`747adef`. Aucun commit, push, déploiement, notification, dépense ou changement distant
n'a été effectué. Les audits et migrations existants sont conservés.

## Constats vérifiés avant modification

- Aucun `AGENTS.md` trouvé ; instructions lues dans `CLAUDE.md`, `CONTRIBUTING.md`,
  README et documentation de continuité. Les skills locaux mentionnés dans CLAUDE
  ne sont pas présents dans ce checkout.
- `docs/audits/rapport-final-readiness-production-2026-10-02.md` est absent du checkout.
  Ce rapport n'est ni remplacé ni reconstitué ; il reste à fournir pour confrontation.
- Cron staging deux fois par jour, production manuelle uniquement ; alertes de backup,
  watchdog Pipedream et copies en releases immuables limités au staging dans le code.
- Mécanisme complémentaire : `coordinated-release.yml` sauvegarde aussi la production
  avant release. Ce mécanisme ne couvre pas l'absence de release ni la périodicité.
- Schéma par défaut excluant Auth/Storage et leurs droits : lacune confirmée par `--dry-run`, corrigée par deux exports explicites supplémentaires.
- Dumps historiques rôles/schéma/data/public-data, AES-256-GCM, HMAC coordonné, fichiers Storage,
  restauration Storage avec inventaire et contrôle après lecture déjà existants.
- Exercices des 23/26 juillet et objectifs 24 h/4 h sont des preuves datées du staging
  fictif ; ils ne valident ni ce checkout ni une production avec données réelles.

## Implémenté et testé localement

| Changement | Portée et limites |
|---|---|
| Cron production conditionnel | Désactivé par défaut ; exige variable de dépôt explicite et politique d'environnement activée |
| Copie release pour chaque cible | Exige immutabilité, commit et digest ; reste dépendante de GitHub |
| Rétention Actions configurable | 1–90 jours, par défaut 30 ; releases indéfinies et limite organisationnelle à vérifier |
| Version de clé authentifiée | Identifiant HMAC, secret sélectionné par nom, rotation sans écraser l'ancien ; coffre non installé |
| Schémas et droits internes | Deux exports explicites séparés `auth` et `storage`, chiffré et lié par HMAC ; format v2 avec compatibilité lecture v1 ; réconciliation sur cible encore manuelle et non exercée |
| Couverture Auth/Storage | Refuse les dumps sans COPY des quatre tables essentielles ; inventaire DB exact sans doublons |
| Alertes séparées | Contrôle par cible/tentative ; backup et copie distincts ; HTTP accepté ≠ notification reçue |
| Watchdog production préparé | Exige backup et copie durable ; ignore les échecs d'alerte pour mesurer le backup ; pas déployé |
| Restauration locale préparée | Cible neuve, fictive, loopback ; vérification avant écritures ; import transactionnel puis octets Storage ; réconciliation des droits internes encore manuelle |
| Protections Storage | Refus des deux projets MedData actifs même avec override distant ; vérification de tous les blobs avant upload |
| Preuve v2 | Comptes, liens, droits, policies, orphelins Storage, lecture/modification/fichier et cohérence des temps |
| Runbook | [Procédure](../continuite-production-runbook.md), coffre/suppléant, rotation, rétention, exercice et blocages |

Validation : **41 tests ciblés réussis dans 9 fichiers** ; lint ciblé sans erreur ni
avertissement ; typecheck ciblé des tests et interfaces modifiés réussi. Exécution sous Node **22.22.0**, avec outils isolés dans `/tmp`.
L'installation complète `npm ci` est bloquée par HTTP 403 sur
`cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Les tests utilisent un sous-ensemble
installé séparément de versions ciblées ; ni lockfile ni dépendances du dépôt n'ont
été remplacés. La CI complète, le build et le typecheck global ne sont pas revendiqués.
Le contrôle `git diff --check` réussit. `actionlint` 1.7.9 réussit pour le workflow
continuité et pour une copie du workflow release dont les ancres YAML existantes ont
été développées hors dépôt (ce parseur refuse les aliases `env` du fichier original).
ShellCheck/Pyflakes externes n'ont pas été exécutés. Les tests CLI vérifient aussi un
ensemble DB/Storage entièrement synthétique chiffré, son extraction, le refus d'une
clé/version incorrecte, d'un blob altéré et l'absence de contenu JSON brut dans les erreurs.
Ils ne réalisent aucune restauration PostgreSQL ni connexion Auth.

## Exercice isolé : bloqué, sans preuve inventée

Un workdir Supabase local neuf a été préparé hors dépôt, avec ID
`meddata-recovery-source`, les migrations et le seed fictif du checkout. Le démarrage
local a été tenté avec la CLI 2.109.1. Les pulls PostgreSQL/Auth/Storage/API échouent
sur **`public.ecr.aws` : Forbidden** dans cet environnement à réseau restreint.
La tentative a été interrompue après constat du refus ; aucun conteneur Supabase
n'est resté actif. Aucun accès cloud, secret source ou identité externe n'est
configuré dans l'environnement de travail.

| Observation requise | Résultat de cette session |
|---|---|
| Données/comptes effectivement restaurés | Non exécuté |
| Connexion Auth et parcours UI sur restauration | Non exécuté |
| Fichiers, hashes, liens, orphelins sur cible | Non exécuté |
| Droits, accès autorisés et refus sur cible | Non exécuté |
| RPO/RTO observés | **Non mesurables**, aucune restauration complète |
| Réception d'alerte production | Non envoyée, non vérifiée |
| Récupération par suppléant depuis coffre | Non exécutée |

Les tests du lanceur sont des tests de garde-fous, pas une preuve d'import effectif.
Le rapport ne produit aucun JSON de reprise validée. Il faut une cible locale avec
images disponibles et `psql`, ou une cible isolée autorisée, sans services production.

## Configuration externe nécessaire / dernières actions avant activation

1. Fournir l'audit final demandé et vérifier ses constats contre ce lot. Relancer
   `npm ci`, CI complète et validation des workflows dans un environnement autorisé.
2. Approuver les RPO/RTO et rétentions du futur service, volumétrie et durée maximale
   d'une sauvegarde (timeouts actuels 60 min, Storage plafonné par défaut à 10 000 objets
   et 1 Gio). Dimensionner et tester les limites avant croissance réelle.
3. Résoudre et exercer la cohérence DB/Storage : suspension de tous les writers ou
   versions d'objets récupérables. Les exports restent **non atomiques** ; cette
   condition n'est pas résolue par le code proposé.
4. Vérifier backups DB managés/PITR du plan Supabase et restauration Auth/Storage
   compatible ; inventorier séparément configurations/secrets non exportés par SQL.
5. Installer le coffre, nommer un suppléant avec accès indépendant, conserver toutes
   les versions et tester depuis un autre poste une ancienne et une nouvelle archive.
6. Préparer et tester la copie hors site indépendante des accès GitHub, compte séparé,
   WORM/retention, permissions sans effacement, réplication et lecture de secours.
   Les releases seules ne satisfont pas ce point ; aucun service n'a été provisionné.
7. Configurer les secrets/variables production : références/URLs source, service role,
   `BACKUP_KEY_SECRET_NAME`, `BACKUP_KEY_ID`, `BACKUP_RETENTION_DAYS`, webhook. Ajuster
   aussi le pré-release à la même version enregistrée de clé. Vérifier les protections
   d'environnement et leur compatibilité avec l'automatisation autorisée.
8. Déployer le watchdog production dans un ordonnanceur externe, fréquence/seuil
   alignés sur le RPO, permissions GitHub de lecture et supervision du watchdog.
   Tester panne, absence et API indisponible ; confirmer la réception des deux canaux
   avec autorisation explicite de notification. Remettre le test forcé à false.
9. Réaliser la restauration entièrement fictive avec Auth, fichiers, liens, orphelins,
   droits et navigateur, mesurer les temps jusqu'à fin des parcours et produire une
   preuve v2 avec approbations actuelles. Revoir le gate production pour exiger cette
   preuve complète et empêcher l'utilisation de la dérogation pilote pour le réel.
10. Après revue et **autorisation explicite finale seulement**, publier les changements,
    activer `CONTINUITY_BACKUP_ENABLED=true` pour production puis
    `CONTINUITY_PRODUCTION_SCHEDULE_ENABLED=true` au dépôt ; vérifier première sauvegarde,
    copie immuable, réplication indépendante et fonctionnement quotidien du watchdog.

Aucun de ces points externes n'est implicitement validé par les tests locaux.
