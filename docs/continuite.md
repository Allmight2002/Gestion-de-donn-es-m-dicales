# Continuité, sauvegarde et reprise

## Sauvegarde périodique

Le workflow `.github/workflows/continuity-backup.yml` crée deux fois par jour pour
`staging` un ensemble coordonné comprenant les rôles, le schéma, les données
PostgreSQL et tous les octets Storage. Les contenus sont chiffrés avant leur
sortie du runner, liés par HMAC, vérifiés, puis conservés dans un artefact GitHub
pendant 30 jours. La marge de deux passages quotidiens maintient l'intervalle
nominal sous le RPO approuvé de 24 heures, même si un passage échoue ou démarre
avec retard.

Le job `production` n'est jamais lancé par le cron. Il reste disponible uniquement
par déclenchement manuel explicite avec `target=production` ou `target=all`, après
autorisation production distincte.

Le job refuse de démarrer tant que la variable d'environnement GitHub
`CONTINUITY_BACKUP_ENABLED` ne vaut pas exactement `true`. Chaque environnement
doit fournir `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_DB_URL`,
`SUPABASE_SERVICE_ROLE_KEY` et `STORAGE_BACKUP_ENCRYPTION_KEY`. L'URL DB doit être
le Session pooler sur le port 5432. Les secrets ne sont pas transmis au processus
de dump et aucune donnée en clair n'est téléversée comme artefact.

Une exécution manuelle bornée est disponible :

```text
gh workflow run continuity-backup.yml --ref <BRANCHE_APPROUVEE> -f target=staging -f alert_test=true
```

Pour `staging`, le workflow exige aussi le secret d'environnement
`MONITOR_ALERT_WEBHOOK_URL`. Toute exécution qui échoue après le checkout tente
d'envoyer une alerte expurgée contenant uniquement la cible, l'identifiant du
run et le code borné `continuity-backup: backup-failed`. L'option
`alert_test=true` exerce le même canal après une sauvegarde réussie sans provoquer
de panne volontaire.

Cette alerte couvre les échecs d'un run démarré. Elle ne détecte pas à elle seule
la disparition complète d'un run planifié, par exemple si le workflow est
désactivé. Ce deuxième cas est surveillé par un workflow Pipedream indépendant.

### Détecteur externe d'absence

Le workflow Pipedream `MedData staging - Backup watchdog` (`p_QPCkDbn`) est actif
depuis le 23 juillet 2026 en version 10. Il s'exécute chaque jour à 09 h 30 dans
le fuseau `Africa/Douala`, soit plus de six heures après le cron GitHub. Son
unique étape de code reprend
`scripts/pipedream-backup-watchdog.mjs` et utilise le compte GitHub connecté dans
Pipedream. Aucun jeton GitHub n'est copié dans le code, les logs ou ce document.

Le détecteur résout d'abord la branche par défaut courante auprès de GitHub, puis
interroge ses dix derniers runs de `continuity-backup.yml` et vérifie le résultat
exact du job `backup (staging)`. Il reste ainsi aligné sur la branche depuis laquelle
GitHub exécute le cron, même si son nom change. Il reste
donc correct si le run global est rouge uniquement parce que le job production
est désactivé. Une réussite de moins de 30 heures termine silencieusement le
workflow. Ce délai détecte la disparition de plusieurs passages attendus ; chaque
échec d'un passage effectivement démarré déclenche déjà l'alerte immédiate du
workflow GitHub. Sinon, Pipedream envoie à l'adresse de son propriétaire :

- `backup-missing` si aucune sauvegarde staging récente n'est prouvée ;
- `github-api-unavailable` si le dépôt privé ne peut pas être interrogé.

L'alerte ne contient ni réponse GitHub brute, ni jeton, ni donnée médicale. Pour
tester le circuit, régler temporairement `Forcer l'alerte de test` à `true`,
exécuter l'étape, confirmer l'e-mail `expected-test-alert`, puis remettre
obligatoirement la valeur à `false` avant de déployer le workflow. Une seconde
exécution avec `false` doit retourner `ok: true` et ne doit envoyer aucun e-mail.

Le workflow Pipedream doit rester **actif**. Son historique quotidien et la
réception du test constituent la preuve externe ; le code versionné seul ne
prouve pas que cette surveillance est déployée.

Preuves initiales du 23 juillet 2026 :

- exécution normale à `17:03:43Z` : `ok: true`, sauvegarde staging
  `30005845353` reconnue, aucun e-mail produit ;
- exercice à `17:02:58Z` : `expected-test-alert`, `emailQueued: true` ;
- réception de l'e-mail de l'exercice confirmée par l'opérateur le 23 juillet
  2026 ;
- configuration déployée : `Forcer l'alerte de test = false`, version 10 active.

Le watchdog est donc opérationnellement testé pour la cible staging. Cette preuve
ne remplace ni l'historique quotidien à accumuler, ni le PITR, ni une copie
indépendante et immuable.

### Copie immuable hors Supabase

L'option GitHub **immutable releases** est activée sur le dépôt privé depuis le
23 juillet 2026. Après chaque sauvegarde staging réussie, le workflow fabrique une
archive contenant uniquement l'ensemble déjà chiffré et HMAC-vérifié, crée une
release en brouillon, attache l'archive, publie la release, puis exige par API :

- `immutable: true` ;
- le SHA source exact ;
- le digest SHA-256 exact de l'asset.

La première copie est la release `continuity-staging-30030132468`, issue du run
`30030132468` et du SHA `6f0c87daee6d15938f8cc0dd2f62203e21dcc15d`.
L'asset privé `487460922` est confirmé immuable avec le digest
`sha256:117c0c1474b1e0ba9bf29b9f80d6a66569e5cc25787b3af340245a39ffe18005`.
Cette copie est hébergée hors Supabase et n'expire pas avec l'artefact Actions de
30 jours. La suppression volontaire de tout le dépôt GitHub reste un scénario
catastrophe à couvrir organisationnellement.

La copie du candidat d'interphase est la release
`continuity-staging-30196157372-1`, issue du run `30196157372` et ciblant le SHA
`ebee17910f6de005ab933ee08978d2e97686d19d`. Son archive porte le digest
`sha256:168c2359efff8af901b9359c8cd077d10c8f13144f56584cffa2c5aa3d398cd3`.
L'ensemble sauvegardé comprend quatre exports DB, 117 objets Storage et
16 969 octets ; le HMAC et l'extraction ont été vérifiés, et le manifeste Storage
a l'empreinte
`sha256:5165598301022387588fe380d205b0f02509c48abb2bc00c87fea3893c157dbd`.
L'artefact Actions `continuity-backup-staging-30196157372` est conservé jusqu'au
25 août 2026. La clé a été rouverte depuis l'enveloppe DPAPI séparée décrite
ci-dessous, sans affichage de sa valeur. Cette sauvegarde est celle qui a été
restaurée lors de l'exercice du 26 juillet 2026.

### Clé de récupération staging

Les sauvegardes staging créées après la publication de cette procédure utilisent
le secret versionné `STORAGE_BACKUP_ENCRYPTION_KEY_20260723`. La même clé est
conservée hors de GitHub dans l'enveloppe Windows DPAPI suivante :

```text
C:\Users\USER\AppData\Local\MedData\continuity-keys\staging-backup-key-20260723.dpapi
```

L'enveloppe a l'empreinte
`sha256:574f3b557abdf9edc6c6049a6cb322ca02b4a58a0d1bac6449568740761841f9`.
Elle a été rouverte dans un second processus avant l'installation du secret
staging. La valeur de la clé n'a pas été affichée, inscrite dans le dépôt ou
envoyée dans un log.

DPAPI lie cette enveloppe au compte Windows courant. Elle sépare bien la clé de
GitHub pour l'exercice staging, mais elle ne résiste pas à la perte simultanée de
ce profil Windows. Avant toute donnée réelle, une seconde enveloppe chiffrée doit
être placée dans un coffre organisationnel hors de cette machine. L'ancien secret
GitHub n'est pas écrasé afin de ne pas rendre les sauvegardes précédentes
illisibles.

L'activation distante de ce workflow, sa première exécution et toute sauvegarde
de production nécessitent une autorisation opérationnelle explicite. Aucun run
local ou CI ne constitue une preuve de sauvegarde cloud.

## Limites qui restent bloquantes

Les artefacts GitHub sont un contrôle complémentaire, pas un remplacement des
backups managés Supabase ou du PITR. Avant des données pseudonymisées ou réelles,
il faut encore prouver :

- une politique RPO/RTO et une rétention approuvées ;
- les backups DB managés et le PITR selon le plan souscrit ;
- une copie indépendante, hors site et réellement immuable ;
- la séparation et la récupération testée de la clé de chiffrement ;
- des alertes reçues après échec ou absence d'un backup attendu ;
- un exercice de restauration représentatif dans une cible isolée.

Tant que ces preuves manquent, B3 et B4 restent ouverts et les données autorisées
restent entièrement fictives.

État au 26 juillet 2026 : la politique RPO/RTO est approuvée, la copie immuable
existe pour le SHA candidat, la séparation puis la réouverture effective de la
clé ont été exercées, les alertes d'échec et d'absence ont été reçues, et
l'exercice de restauration a été rejoué dans une cible isolée. Restent non
prouvés les backups DB managés et le PITR — `pitr_enabled: false` sur
`meddata-staging` — ainsi qu'une copie réellement indépendante de GitHub et un
coffre organisationnel hors de la machine du porteur. Les données autorisées
demeurent donc entièrement fictives.

## Preuve d'un exercice de restauration et de reprise

L'exercice du 23 juillet 2026 est décrit dans
`docs/exercice-reprise-staging-2026-07-23.md`. Il a restauré DB, Auth, Storage et
117/117 objets dans une cible locale PostgreSQL 17 isolée, contrôlé 111 clés
étrangères sans orphelin, toutes les tables publiques avec RLS, un accès autorisé
et un refus croisé, puis le rollback/forward frontend, Edge, Storage et migration.
RPO observé : 211 s ; RTO observé : 517 s.

Les objectifs RPO 24 h et RTO 4 h ont été approuvés le 25 juillet 2026 par le
porteur du projet, agissant pour cet exercice comme responsable continuité et
release manager. La décision et ses limites sont archivées dans
`docs/decision-rpo-rto-staging-2026-07-25.md`.

Cet exercice a été rejoué le 26 juillet 2026 sur le SHA de merge définitif de
l'interphase, `ebee17910f6de005ab933ee08978d2e97686d19d`, à partir de la
sauvegarde immuable ci-dessus. Le compte rendu est
`docs/exercice-reprise-staging-2026-07-26.md` : 5 comptes Auth, 36 tables
publiques toutes sous RLS, 4 buckets et 117/117 objets restaurés, 111 clés
étrangères contrôlées sans orphelin, aucune divergence sur les 35 tables de
données publiques ni sur les hash Storage, RPO observé 77 s et RTO observé
1 587 s. La preuve JSON validée porte l'empreinte
`sha256:4ab7a20d858d36465ed4588fe798a2ca3770b826d911f891d8f903dc1c0ce228` et est
publiée dans la release immuable `recovery-evidence-staging-ebee17910f6d`.

B3, B4 et B8 disposent donc de preuves actuelles rattachées au même SHA, **pour
le staging fictif uniquement**. Cela ne les ferme pas pour la production : les
limites listées ci-dessus restent applicables, et la cible de reprise est un
projet local isolé, pas un environnement représentatif d'un usage clinique.

Après un exercice réel sur une cible isolée, la preuve JSON doit être contrôlée
contre le commit exercé :

```text
npm run recovery:evidence:verify -- --file=<preuve.json> --commit=<SHA40>
```

Le validateur refuse notamment une cible reliée à la production, une preuve
périmée ou rattachée à un autre commit, une restauration partielle DB/Auth/Storage,
un objet manquant, une divergence de hash, un orphelin, un dépassement RPO/RTO,
un parcours critique absent ou une approbation non référencée. La preuve ne doit
contenir ni donnée patient, ni nom d'objet, ni secret : uniquement des compteurs,
empreintes, dates, résultats booléens et références de décisions externes.

Ce contrôle valide la forme et la cohérence de la preuve ; il ne réalise pas la
restauration et ne signe pas les objectifs à la place des responsables.

Le job `production` exige en plus le secret d'environnement
`RECOVERY_EVIDENCE_JSON`. Son contenu est vérifié avec la commande ci-dessus
contre le SHA exact du candidat avant la validation de cible, la sauvegarde
pré-release et toute écriture Supabase ou Vercel. Une checklist, un exemple JSON
ou une preuve portant sur un autre commit ne déverrouille pas la release.

La création de cette preuve nécessite un exercice réel et autorisé sur une cible
staging isolée, avec uniquement des données fictives. Tant que cet exercice n'a
pas été réalisé et que la preuve n'est pas installée dans l'environnement GitHub
`production`, B8 reste ouvert.
