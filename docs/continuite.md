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
désactivé : un contrôle externe de l'absence de sauvegarde reste nécessaire.

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
