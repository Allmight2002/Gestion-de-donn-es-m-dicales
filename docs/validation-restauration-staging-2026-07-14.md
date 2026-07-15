# Validation de sauvegarde et restauration staging — 14 juillet 2026

## Verdict

**Sauvegarde et restauration logique complètes du staging : validées sur le jeu
fictif observé le 14 juillet 2026.** Une cible entièrement neuve a restauré les
rôles, PostgreSQL, Auth, les données applicatives, les métadonnées Storage et les
97 fichiers Storage. Chaque fichier restauré a été relu et comparé à son SHA-256.

Cette preuve clôt le défaut de l'ancien export du 13 juillet, qui contenait huit
métadonnées `storage.objects` mais aucun octet. Elle ne valide pas les sauvegardes
managées du projet de production, leur rétention, leur région, le PITR, ni un
objectif contractuel RPO/RTO. Elle n'autorise donc pas à elle seule des données
médicales réelles.

## Périmètre et isolation

- Source : projet staging MedData, données déclarées et contrôlées comme fictives.
- Fenêtre d'export : `2026-07-14T22:55:28.396Z` à
  `2026-07-14T23:00:22.085Z`.
- Cible : nouveau réseau, nouveau volume PostgreSQL et nouveau volume fichiers
  Docker ; aucun volume Supabase local existant n'a été supprimé.
- PostgreSQL cible : image Supabase `17.6.1.141`.
- Auth : `v2.193.0` ; Storage API : `v1.65.1`.
- Aucune ressource distante n'a été modifiée pendant le test.
- Aucun contenu de ligne, nom d'objet, secret ou clé serveur n'est reproduit dans
  ce rapport.

## Protection et chaîne de preuve

- les quatre exports SQL ont été chiffrés immédiatement en AES-256-GCM ;
- les objets et leur manifest nominatif ont été chiffrés individuellement en
  AES-256-GCM ;
- `backup-set.json` lie les exports DB et le manifest Storage par empreintes et
  HMAC-SHA-256 ;
- la clé de l'exercice est conservée dans une enveloppe DPAPI liée au compte
  Windows courant ; une réouverture dans un second processus a réussi ;
- DPAPI locale convient à cette preuve staging, mais pas à une sauvegarde
  production hors site : la clé production doit résider dans un gestionnaire de
  secrets séparé et testé.

Empreintes non sensibles de l'ensemble :

| Élément | SHA-256 |
|---|---|
| `backup-set.json` | `ab471f66dc9534c63795dc8b9d8d6a5513925c1f0c9754dc02136449dd89f59b` |
| enveloppe DPAPI | `bf8346e5e2260aa0bc906f04a077e10a6ec22a217dc4650c89bda9a778759996` |
| en-tête Storage chiffré | `a9e41106286bf33ff937168e20e21488d37bfa5a404b38b42932cda085467459` |

## Résultats

| Contrôle | Résultat | Preuve synthétique |
|---|---|---|
| Manifest coordonné | PASS | HMAC valide ; quatre exports DB et un export Storage liés |
| Chiffrement et réouverture | PASS | AES-256-GCM vérifié ; clé DPAPI rouverte dans un second processus |
| Rôles et schéma | PASS | application avec arrêt à la première erreur |
| Données | PASS | 64 tables `COPY`, aucune divergence de cardinalité |
| Dump public redondant | PASS | aucune divergence avec les tables `public` du dump complet |
| Intégrité référentielle | PASS | 111 clés étrangères contrôlées, zéro orphelin |
| Schéma applicatif | PASS | 35 tables, 171 fonctions, 58 politiques et 54 triggers, égalité exacte avec le dump |
| RLS | PASS | 35/35 tables sauvegardées avec RLS activée |
| Auth | PASS | migrations officielles puis service `/health` HTTP 200 après restauration |
| Inventaire Storage | PASS | inventaires DB et sauvegarde strictement identiques avant écriture |
| Octets Storage | PASS | 97/97 objets, 14 173 octets, relecture et SHA-256 exacts |
| API Storage | PASS | endpoint `/status` HTTP 200 avant et après restauration |
| Données fictives | PASS staging | cinq comptes Auth, aucune adresse hors domaines réservés aux fixtures |

Cardinalités de contrôle, sans contenu : 5 utilisateurs Auth, 5 profils,
11 patients, 0 rencontre, 4 buckets et 97 objets Storage.

## Temps observés

- création de la sauvegarde coordonnée : environ **4 min 54 s** ;
- création de la cible de restauration : `2026-07-14T23:01:33.519Z` ;
- restauration et contrôles principaux achevés :
  `2026-07-14T23:04:43.563Z` ;
- RTO de laboratoire observé : environ **3 min 10 s** ;
- restauration et relecture des 97 objets : environ **6 s**.

Le RPO n'est pas défini par cette preuve : les exports logiques et objets ont une
fenêtre d'environ cinq minutes et ne constituent pas un snapshot transactionnel
commun. Avant production, il faut approuver un objectif RPO, geler ou contrôler
les écritures pendant l'export complémentaire, et prouver les sauvegardes
managées/PITR réellement souscrites.

## Artefacts et reproductibilité

- Orchestrateur : `scripts/coordinated-backup.mjs`.
- Sauvegarde/restauration des octets : `scripts/storage-object-backup.mjs`.
- Commandes npm : `backup:coordinated`, `backup:coordinated:verify`,
  `backup:coordinated:extract`, `storage:backup`, `storage:backup:verify` et
  `storage:restore`.
- Les restaurations distantes sont refusées par défaut ; il faut une autorisation
  explicite par variable dédiée.
- L'inventaire DB/objets doit être identique ; aucune création implicite de bucket
  n'est autorisée.

## Limites et actions restantes

1. Prouver sur le projet de production la fréquence, la rétention, la région, le
   chiffrement et le PITR du plan Supabase souscrit.
2. Définir et approuver RPO/RTO, conservation et responsable de la clé hors site.
3. Automatiser l'export complémentaire dans une fenêtre sans écritures, avec
   alerte, rétention et copie hors site immuable.
4. Rejouer périodiquement l'exercice sur une cible isolée et conserver les preuves.
5. Ajouter un parcours applicatif post-restauration complet avec Auth, RLS, audit
   et téléchargement, sans utiliser de donnée réelle avant validation juridique.

La condition « restauration staging complète testée » est satisfaite. La condition
« sauvegarde production prouvée » demeure ouverte.
