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
gh workflow run continuity-backup.yml --ref <SHA_APPROUVE> -f target=staging
```

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
