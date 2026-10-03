# Sauvegarder et restaurer MedData

Version préparée le 2 octobre, poursuivie le 3 octobre 2026. **Changements locaux,
non déployés ; exercice fictif local réussi dans le périmètre décrit ; production
non activée et readiness production non validée.** Le rapport de préparation est
[rapport-continuite-production-2026-10-02.md](audits/rapport-continuite-production-2026-10-02.md).
Les résultats actuels sont dans le
[rapport d'exercice du 3 octobre](audits/rapport-exercice-restauration-isolee-2026-10-03.md).
Les preuves historiques staging restent conservées dans [continuite.md](continuite.md).

## 1. Ce que contient la sauvegarde

Six exports chiffrés (format coordonné v2, lecture des quatre exports v1 historiques conservée) : rôles personnalisés, schéma applicatif (fonctions,
triggers, droits, RLS et politiques personnalisées), données, et données publiques
séparées pour diagnostic, et `auth-schema.sql` et `storage-schema.sql` obtenus respectivement avec `--schema auth`
et `--schema storage`.
Ces deux exports conservent les définitions internes, fonctions, droits, RLS et politiques
Auth/Storage que le dump de schéma par défaut exclut. `data.sql` contient notamment Auth (comptes, identités,
éléments de sessions exportables) et métadonnées Storage. Le script exige les
sections COPY `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects` ;
même une table vide doit être exportée. Ce contrôle détecte une omission de ces
tables ; il ne démontre pas la compatibilité de toutes les tables Auth sur une cible.

Tous les octets Storage, noms et métadonnées MIME/cache sont chiffrés en
AES-256-GCM. Le manifeste coordonné lie les exports et le manifeste Storage par
HMAC-SHA256. La vérification déchiffre et contrôle les tailles et empreintes avant
acceptation. Les fichiers SQL temporaires restent sur le runner avec accès privé,
puis sont supprimés. Les transferts sortants des sauvegardes sont chiffrés ; les
lectures depuis Supabase utilisent les connexions sécurisées du service. Cela ne
signifie pas que PostgreSQL chiffre lui-même le dump avant de l'envoyer au runner.

Les schémas internes Auth/Storage et rôles réservés sont initialement fournis par une version
compatible de Supabase sur la cible. Conserver dans un inventaire en coffre les
versions PostgreSQL/Auth/Storage, extensions, configurations Auth/OAuth/SMTP,
URLs de redirection, secrets Edge, scanner, clés des colonnes chiffrées et
`MISSION_CREDENTIALS_ENCRYPTION_KEY` si utilisée. Le dump ne sauvegarde pas la
configuration distante, les mots de passe des rôles DB personnalisés, le DNS ou
l'hébergement frontend. Conserver le code et les versions de déploiement en parallèle.
Les nouveaux JWT/API keys de cible imposent une reconnexion des utilisateurs.

Sources vérifiées via la documentation Supabase :
[restauration CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
et [restauration auto-hébergée](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
Le `--dry-run` de la CLI 2.109.1 confirme que le dump des données inclut Auth et
Storage, hors tables d'historique des migrations internes. La reprise du 3 octobre
a également consulté le changelog et exercé ces exports sur PostgreSQL 17 local.

## 2. Cohérence et conservation

Les dumps puis les téléchargements Storage sont **successifs**. Le manifeste
indique `sequential-best-effort`, sans instantané atomique DB/Storage. Une réussite
cryptographique n'exclut pas un ajout, remplacement ou effacement concurrent. Le
second dump public est diagnostique : **ne pas le rejouer après `data.sql`**.

Avant activation avec des données réelles, faire approuver et tester soit une
suspension effective de tous les writers pendant la fenêtre complète (UI, API,
imports, comptes Auth, Edge, nettoyage, tâches planifiées et uploads en cours),
soit une stratégie versionnée permettant de reconstruire les objets à l'instant
DB. Un simple drapeau de maintenance UI n'est pas suffisant. Le présent changement
n'implémente pas cette suspension ; c'est un blocage avant mise en service réelle.

`BACKUP_RETENTION_DAYS` règle les artefacts Actions, entre 1 et 90 jours, avec
valeur par défaut 30 ; vérifier la limite effective de l'organisation. La copie
release exige `immutable=true`, SHA source exact et digest de l'asset. Elle est
hors Supabase et durable mais **dépend encore des accès et de la survie du dépôt
GitHub**. Sa conservation est indéfinie ; la variable de rétention Actions ne
supprime ni les releases ni les clés.

Pour une copie indépendante de GitHub, préparer une destination organisationnelle
séparée (par exemple stockage objet avec Object Lock en mode compliance), un compte
administrateur distinct, une identité d'écriture sans permission de suppression,
une durée WORM approuvée et un lecteur de secours. Un service de réplication sous
ces accès distincts doit contrôler digest/version/échéance de rétention et tester
la récupération sans connexion GitHub. Aucun service de réplication n'est installé
par ce lot ; ne pas déclarer cette protection acquise. Chiffrer avant réplication,
conserver une preuve bornée de dépôt et de lecture, et surveiller son absence.
Aucune dépense n'est autorisée par cette procédure.

## 3. Clés et suppléant

Dans chaque environnement GitHub : `BACKUP_KEY_SECRET_NAME` sélectionne exactement
le nom du secret, sans repli vers une autre valeur si le secret sélectionné manque.
`BACKUP_KEY_ID` identifie la version dans le manifeste HMAC. Par défaut le staging
périodique utilise le secret `STORAGE_BACKUP_ENCRYPTION_KEY_20260723` et l'identifiant
`staging-20260723`. Les backups pré-release staging conservent leur secret historique
avec identifiant transitoire `staging-legacy-release-key` : vérifier sa correspondance
au coffre avant de l'utiliser. La production exige un identifiant explicite.

1. Le responsable crée une clé aléatoire de 32 octets dans un coffre organisationnel,
   avec identifiant, date, usage et deux personnes autorisées. Ne jamais placer la
   valeur dans une commande, un ticket, un document, une capture ou un log.
2. Depuis un autre poste, le suppléant se connecte au coffre avec ses propres accès
   MFA, récupère la bonne version et l'injecte dans l'environnement du processus
   `STORAGE_BACKUP_ENCRYPTION_KEY` via le mécanisme sécurisé du coffre. Ne pas
   utiliser `echo`, `set -x`, un dump d'environnement ou une valeur littérale shell.
3. Il récupère une archive via les accès de secours hors GitHub, vérifie son digest,
   puis lance la vérification avec `BACKUP_KEY_ID` de cette version. Pour une ancienne
   archive sans identifiant, consulter le registre historique et vérifier par HMAC.
4. Pour la rotation, créer une nouvelle entrée de coffre et un **nouveau** secret
   GitHub, mettre à jour les deux variables de sélection, puis vérifier une nouvelle
   sauvegarde et une ancienne sauvegarde avec leurs clés respectives. Ces changements
   distants demandent une autorisation explicite.
5. Garder chaque ancienne clé tant qu'une sauvegarde conservée l'utilise, y compris
   toute release immuable et toute copie WORM. Ne retirer une clé qu'après inventaire
   approuvé des copies expirées. Documenter accès de secours et procédure si le coffre
   principal est indisponible. Tester périodiquement le suppléant sur un autre poste.

DPAPI sur le poste du porteur ne satisfait pas cet exercice. Aucun coffre ni
suppléant n'a été vérifié dans cette session.

## 4. Sauvegarde et alertes

Après configuration et autorisation, la commande locale existante est :

```sh
npm run backup:coordinated -- --target=staging --output=/CHEMIN_HORS_DEPOT/ensemble
npm run backup:coordinated:verify -- --backup=/CHEMIN_HORS_DEPOT/ensemble
```

Utiliser `--target=production` uniquement après autorisation de la sauvegarde
production. Ne pas lancer ces commandes avec des accès réels pour un exercice.
Les variables source URL/DB/référence doivent toutes désigner la même cible approuvée.

Le workflow proposé conserve le cron staging et ajoute production **uniquement si**
la variable de dépôt `CONTINUITY_PRODUCTION_SCHEDULE_ENABLED=true`. La variable de
l'environnement `CONTINUITY_BACKUP_ENABLED=true` reste une deuxième condition.
Ne modifier aucune de ces variables sans autorisation. Configurer aussi les secrets
source déjà documentés, la clé/version, la rétention et `MONITOR_ALERT_WEBHOOK_URL`.
La protection GitHub production doit être compatible avec un cron autorisé : des
approbations humaines en attente peuvent empêcher une sauvegarde et ses alertes.

Les jobs `backup (cible)`, `preserve-copy (cible)` et `alert (cible)` ont des résultats
séparés. L'alerte inspecte les jobs de **la cible et de la tentative courante**,
pas le résultat global d'une matrice. Un échec de copie durable déclenche un code
spécifique. Un HTTP 2xx prouve l'acceptation par le webhook, pas la réception par
l'opérateur ; conserver une confirmation externe et l'heure de réception.

Les répertoires et artefacts incluent `run_id` **et** `run_attempt`. Relancer tous
les jobs d'une tentative, y compris le backup : une copie ne réutilise pas un
artefact d'une tentative précédente. Le manifeste authentifie également l'empreinte
des fichiers source utilisés et signale un checkout non commité ; le SHA Git seul
ne représente pas ces modifications locales.

Après autorisation du run **et** de la notification, `alert_test=true` exerce le
canal avec un message synthétique. Une panne réelle ne doit pas être fabriquée avec
des données médicales. Les tests locaux utilisent des réponses simulées, sans envoi.

Déployer un second watchdog externe Pipedream avec `target=production`, un compte
GitHub lecteur et un seuil approuvé `maxAgeHours` (0 < seuil <= 36). Sa fréquence et
ce seuil doivent détecter le manque avant dépassement du RPO retenu ; 30 h historique
ne garantit pas un objectif production de 24 h. Le code exige une sauvegarde production
et sa copie durable réussies dans le même run. Une alerte encore en cours/échouée ne
masque pas la sauvegarde. Détecter aussi panne/API indisponible, surveiller le watchdog
lui-même et confirmer le test reçu, puis remettre `forceTestAlert=false`.
Le watchdog staging déployé historiquement n'a pas été modifié à distance.

## 5. Restaurer uniquement les fixtures sur une cible locale neuve

Préparer un Supabase local jetable de versions compatibles, PostgreSQL client
`psql`, tous les services Auth/Storage nécessaires, le code frontend et les fonctions
Edge. Ne pas réutiliser le staging actif ; ne pas brancher la cible sur des services
production. Le lanceur refuse les URL distantes, les options DB dans l'URL et les
surcharges Storage. Vérifier qu'aucun tunnel local ne pointe vers une base distante.

1. Vérifier que **la source entière est fictive**, l'origine de l'archive et son
   digest externe. Choisir la clé par identifiant et vérifier l'ensemble.
2. Injecter par coffre les variables `TARGET_SUPABASE_DB_URL`, `TARGET_SUPABASE_URL`,
   `TARGET_SUPABASE_SERVICE_ROLE_KEY` et la clé de backup. Les URL sont loopback,
   avec port DB explicite. Le lanceur exige zéro table publique applicative, zéro
   compte Auth, zéro bucket et zéro objet sur la cible ; il ne supprime rien.
3. Après ces vérifications locales, exécuter :

```sh
RECOVERY_ALLOW_LOCAL_RESTORE=true RECOVERY_DATA_CLASSIFICATION=fictitious-only \
  npm run recovery:restore:isolated -- --backup=/CHEMIN_HORS_DEPOT/ensemble
```

Le lanceur vérifie **tous** les fichiers avant connexion à la cible, extrait les SQL
hors dépôt avec permissions privées, importe rôles/schéma/données avec arrêt sur
première erreur et transaction DB, puis restaure les fichiers et relit leurs octets.
Il nettoie les SQL temporaires et ne réimporte pas `public-data.sql`. Il exige v2.
Avant toute écriture, il exporte les schémas internes vierges de la cible et prépare
une réconciliation des définitions personnalisées, droits et policies Auth/Storage.
Une structure gérée incompatible ou une modification non prise en charge bloque
l'import ; les objets internes identiques ne sont pas recréés en bloc.

Les objets publics sont créés sous `postgres`. Le lanceur retire les droits par
défaut introduits par la cible, puis rejoue les ACL authentifiées de la source dans
la même transaction. La connexion locale doit pouvoir créer les rôles et schémas
gérés et changer de rôle (l'exercice utilise le rôle local `supabase_admin`).
Après upload, il rétablit ownership, métadonnées et timestamps originaux avec leur
précision PostgreSQL. La version physique Storage nouvellement créée est conservée
pour rester cohérente avec les octets effectivement uploadés.

Pour examiner ces deux exports internes, réaliser **avant l'import** une extraction séparée
sur un volume local protégé, puis la supprimer après réconciliation. L'extraction
éphémère interne du lanceur est nettoyée et n'est pas un dossier de travail conservé :

```sh
BACKUP_ALLOW_PLAINTEXT_EXTRACTION=true npm run backup:coordinated:extract -- \
  --backup=/CHEMIN_HORS_DEPOT/ensemble --output=/CHEMIN_HORS_DEPOT/sql-pour-revue
```

Ne pas rejouer les définitions gérées en bloc. Examiner manuellement les divergences
refusées par le lanceur, sans ajouter les politiques permissives d'anciennes versions ;
vérifier les refus avant de rouvrir la cible.
Une erreur peut laisser la DB restaurée et Storage partiel : conserver cette cible
pour diagnostic ou recréer une autre cible vide, sans jamais nettoyer la production.

4. Comparer les tables, comptes, identités, fonctions, ACL, RLS et policies à la source.
   Compter les FKs et chercher les orphelins ; rapprocher `clinical_attachment` et
   `raw_document` de l'inventaire Storage, vérifier les empreintes de **chaque** objet,
   les chemins, métadonnées/ownership et objets sans dossier. Les uploads de restauration
   peuvent modifier des métadonnées gérées par Storage : comparer et réconcilier sur
   cible isolée avant toute validation.
5. Avec de vrais appels Auth, API, Edge et navigateur, connecter un compte restauré,
   lire un dossier, le modifier via les RPC autorisées et ouvrir un fichier par la voie
   signée auditée. Tester aussi un autre compte refusé, l'anonyme, les rôles restreints,
   la modification interdite et le fichier interdit. Contrôle positif et refus doivent
   porter sur une donnée présente. Rejouer également les parcours historiques de la
   preuve v1 (upload propre/EICAR, import, export, audit et reprise des composants).
6. Mesurer RTO depuis début de prise en charge jusqu'à fin de **tous** les parcours,
   incluant provisionnement et récupération de la clé. Mesurer la perte potentielle
   depuis le début conservateur du backup jusqu'à l'incident simulé ; ne pas prendre
   sa fin comme instantané atomique. Le temps affiché par le lanceur est seulement
   celui de l'import DB/Storage, pas le RTO complet.
7. Consigner les résultats sans identifiant patient, nom d'objet ni secret. Obtenir
   une décision RPO/RTO actuelle pour le futur service ; 24 h / 4 h sont des références
   historiques du staging, pas une approbation production.

La preuve complète `meddata-recovery-evidence/v2` étend v1 avec :
`source.backupStartedAt`, `timing.incidentAt`, comptes attendus/restaurés,
liens contrôlés, orphelins Storage, comparaison contenus/droits/politiques et
parcours `read`, `modify`, `fileOpen`. Les champs hérités et approbations restent requis.

```sh
npm run recovery:evidence:verify -- --file=/CHEMIN_HORS_DEPOT/preuve.json \
  --commit=SHA40_EXERCE --require-complete
```

Ce validateur vérifie les déclarations et calculs, **pas la réalité des observations**.
V1 reste lisible pour préserver les preuves historiques ; le gate de release actuel
accepte encore v1 et comporte une dérogation de pilote fictif. Ne pas utiliser ce gate
seul comme validation du futur service réel. Un import réussi ne produit volontairement
aucune preuve de reprise complète.

## 6. Pilote reproductible de l'exercice cloud local

`scripts/exercise-isolated-recovery.mjs` est un pilote de fixtures, pas un outil de
reprise production. Il attend deux workdirs hors dépôt :
`/tmp/meddata-recovery-source` (API 54321, DB 54322) et
`/tmp/meddata-recovery-target` (API 55321, DB 55322), IDs distincts commençant par
`meddata-recovery-`. Décaler aussi les autres ports de la cible. Copier les migrations
et le seed **uniquement** dans la source ; désactiver le seed de la cible et y laisser
le dossier migrations vide. Copier le code Edge et `deno.json` dans les deux workdirs.
Démarrer Auth, REST, Storage, Kong, PostgreSQL et Edge avec la CLI verrouillée 2.109.1.
Node 22.22.0, `psql` 17, Docker et ImageMagick (`convert`) sont nécessaires.

Le pilote capture les clés locales de la CLI en mémoire, sans les afficher. Il
génère une clé de backup privée dans `/tmp/meddata-recovery-exercise`, avec mode 600
dans un dossier mode 700 ; ce mécanisme **ne teste pas un coffre organisationnel**.
Ne jamais publier le JSON brut de `supabase status` ou des logs de démarrage `-o json`.

```sh
npm run recovery:exercise:isolated -- --phase=prepare
npm run recovery:exercise:isolated -- --phase=backup
npm run recovery:exercise:isolated -- --phase=restore
npm run recovery:exercise:isolated -- --phase=verify
```

`prepare` refuse d'écraser un exercice déjà préparé. Il crée deux fichiers valides
entièrement synthétiques et une fonction Auth avec un droit positif et un refus,
puis capture les tables et schémas avant les parcours. Le statut `accepted` des
fixtures est posé par l'administrateur : **aucun scanner antivirus n'est exercé**.
La cible doit être neuve lors de `restore` ; le pilote ne l'efface jamais.
`verify` compare les données et définitions avant toute connexion utilisateur ou
modification, puis teste Auth, liens, FKs, octets, RLS, modification, signature
auditée et trigger de création de profil. Les tables d'historique internes exclues
par la CLI et la version physique Storage sont exclues de la comparaison de données.

Après un échec de parcours, `--phase=verify --resume=journeys` exige les comparaisons
initiales réussies conservées dans le dossier protégé ; il ne prétend pas que les
données déjà modifiées par les parcours sont encore égales au snapshot initial.
Le navigateur reste une vérification séparée. L'observation JSON ne constitue ni
une preuve de release approuvée ni une décision RPO/RTO production.

Dans le cloud, les conteneurs Edge peuvent nécessiter la configuration du proxy
fourni par la plateforme et un montage CA en lecture seule (`SSL_CERT_FILE`,
`DENO_TLS_CA_STORE=system`). Inclure les noms internes, notamment `kong`, dans
`NO_PROXY` ; conserver la vérification TLS. Pour les URLs signées locales
`http://kong:8000`, le pilote conserve chemin et signature et utilise le port
loopback publié de ce même gateway. Le navigateur doit résoudre `kong` vers le
conteneur local, sans remplacer la réponse Edge par un mock.

Le rapport daté de l'exercice précise les tentatives, adaptations d'images, mesures
et limites. Avec le driver Docker `vfs` et 32 Gio, arrêter les conteneurs jetables
de la source après backup peut être nécessaire avant de provisionner la cible.
Conserver leurs volumes et ne pas lancer de nettoyage Docker global.
