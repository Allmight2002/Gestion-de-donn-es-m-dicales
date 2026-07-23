# Continuité, sauvegarde et reprise

## Sauvegarde périodique

Le workflow `.github/workflows/continuity-backup.yml` crée chaque jour, séparément
pour `staging` et `production`, un ensemble coordonné comprenant les rôles, le
schéma, les données PostgreSQL et tous les octets Storage. Les contenus sont
chiffrés avant leur sortie du runner, liés par HMAC, vérifiés, puis conservés dans
un artefact GitHub pendant 30 jours.

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

Le détecteur interroge les dix derniers runs de `continuity-backup.yml` sur
`develop`, puis vérifie le résultat exact du job `backup (staging)`. Il reste
donc correct si le run global est rouge uniquement parce que le job production
est désactivé. Une réussite de moins de 30 heures termine silencieusement le
workflow. Sinon, Pipedream envoie à l'adresse de son propriétaire :

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

## Preuve d'un exercice de restauration et de reprise

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
