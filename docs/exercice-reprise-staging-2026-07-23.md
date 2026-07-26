# Exercice de sauvegarde, restauration et reprise staging — 23 juillet 2026

## Verdict actuel

L'exercice technique sur cible locale éphémère et isolée est **réussi** pour le
SHA `6f0c87daee6d15938f8cc0dd2f62203e21dcc15d` avec uniquement les fixtures du
staging. La base, Auth, les métadonnées Storage et les octets ont été restaurés,
puis les accès autorisés et interdits ont été exercés.

Cette preuve ne ferme pas encore à elle seule B3/B4/B8 :

- les objectifs RPO 24 h et RTO 4 h ont été approuvés le 25 juillet 2026 dans
  `docs/decision-rpo-rto-staging-2026-07-25.md` ;
- la preuve finale doit porter sur le SHA de merge définitif ;
- le secret de preuve ne doit pas être installé dans l'environnement GitHub
  `production` sans une autorisation production distincte.

**Rejeu du 26 juillet 2026.** La deuxième réserve est levée : le même exercice a
été rejoué sur le SHA de merge définitif
`ebee17910f6de005ab933ee08978d2e97686d19d` et est décrit dans
`docs/exercice-reprise-staging-2026-07-26.md`. Le présent document n'est pas
modifié pour autant : il reste la preuve de son propre SHA
`6f0c87daee6d15938f8cc0dd2f62203e21dcc15d`, avec ses propres chiffres.

## Source et copie immuable

Deux sauvegardes complémentaires portent sur le même SHA :

| Élément | Preuve |
|---|---|
| Sauvegarde GitHub | run `30030132468`, job `backup (staging)` réussi |
| Artefact Actions | `8573000410`, digest `sha256:5472a6d9f2a00bab35358a2bcff9feda5056654dec58a3bc091b3e125427d6c9`, expiration 22 août 2026 |
| Copie hors Supabase | release privée `continuity-staging-30030132468` |
| Immutabilité vérifiée par API | `immutable: true`, asset `487460922` |
| Archive immuable | `sha256:117c0c1474b1e0ba9bf29b9f80d6a66569e5cc25787b3af340245a39ffe18005` |
| Sauvegarde de l'exercice local | manifest `sha256:b900f41e45c35ce78926ba9b493406c0ef06b388238c792322183e3815add61f` |
| Fenêtre de la sauvegarde exercée | `2026-07-23T18:03:51.406Z` → `2026-07-23T18:09:44.941Z` |

La sauvegarde locale de l'exercice a utilisé une clé distincte. Cette clé a été
placée dans une enveloppe DPAPI liée au compte Windows, puis rouverte dans un
nouveau processus avant la vérification et l'extraction. Ni la clé, ni les noms
d'objets, ni le contenu des lignes ne sont reproduits dans ce document.

Pour les sauvegardes automatiques staging futures, la clé versionnée
`STORAGE_BACKUP_ENCRYPTION_KEY_20260723` a également été créée sans affichage,
installée dans l'environnement GitHub `staging` et conservée hors GitHub dans
`C:\Users\USER\AppData\Local\MedData\continuity-keys\staging-backup-key-20260723.dpapi`.
L'empreinte de cette enveloppe est
`sha256:574f3b557abdf9edc6c6049a6cb322ca02b4a58a0d1bac6449568740761841f9`.
Son utilisation réelle devra être prouvée par un run du workflow publié, puis par
une vérification/extraction utilisant l'enveloppe locale.

## Isolation

- source : projet `meddata-staging`, PostgreSQL 17, données contrôlées comme
  fixtures (`example.com`, `demo.test`, `meddata-staging.invalid`) ;
- cible : projet local `meddata-recovery-30030132468`, ports dédiés et volumes
  Docker dédiés ;
- PostgreSQL cible : `17.6.1.143` ;
- Auth cible : `v2.192.0` ;
- Storage API cible : `v1.62.5` ;
- aucune connexion de la cible à la production ;
- aucun ancien volume local PostgreSQL 15 supprimé ou réinitialisé.

## Restauration et intégrité

| Contrôle | Résultat |
|---|---|
| Manifest HMAC, quatre exports DB et sauvegarde Storage | PASS |
| Réouverture de la clé dans un processus distinct | PASS |
| Restauration des 65 tables présentes dans le dump | PASS |
| Clés étrangères contrôlées | 111 |
| Orphelins référentiels | 0 |
| Tables publiques | 36 |
| Tables publiques sans RLS | 0 |
| Comptes Auth restaurés | 5 |
| Buckets restaurés | 4 |
| Objets restaurés et relus | 117/117 |
| Octets restaurés | 16 969 |
| Divergences SHA-256 Storage | 0 |
| Santé Auth et Storage après restauration | HTTP 200 |
| Connexion avec un compte fixture restauré | PASS |
| Lecture de la base par son propriétaire | PASS |
| Lecture de la même base par un autre compte | refus RLS, zéro ligne |

L'empreinte synthétique de la cible, calculée uniquement à partir du SHA et des
compteurs ci-dessus, est
`07cc23236abba6d5977cc4e8623cdca1d9cb25d49a3efc39cd02eb2410e532b6`.

## Reprise et rollback

| Scénario | Résultat |
|---|---|
| Réapplication de `supabase/storage.sql` | PASS |
| Retrait local de la dernière migration non clinique puis `supabase db push` | PASS |
| Table, RLS, policy deny-all et historique après forward recovery | PASS |
| Frontend courant → précédent `024b3f4` → courant, trois previews HTTP | 200/200/200 |
| Six Edge Functions, SHA courant | format, lint, check et 70/70 tests |
| Six Edge Functions, SHA précédent | format, lint, check et 70/70 tests |
| Import rejoué, audit, export et inspection | 65/65 tests ciblés |

L'exercice Edge couvre notamment fichier sain, fichier infecté, timeout scanner,
export scientifique, journalisation et refus d'accès. Il ne prétend pas qu'un
scanner ClamAV distant permanent a été déployé.

## Temps observés et objectifs proposés

- début de restauration : `2026-07-23T18:13:15.391Z` ;
- fin des contrôles principaux : `2026-07-23T18:21:51.426Z` ;
- RPO observé pour cet exercice : **211 secondes** ;
- RTO observé : **517 secondes** ;
- RPO approuvé pour la politique actuelle : **86 400 secondes (24 h)** ;
- RTO approuvé : **14 400 secondes (4 h)**.

Le RPO de 24 h correspond à la sauvegarde quotidienne. Il est accepté pour ce
staging fictif par le responsable de continuité et le release manager de
l'exercice. Il ne vaut pas approbation pour un usage clinique. Un objectif
inférieur à 24 h imposerait le PITR Supabase ou une fréquence de sauvegarde
complémentaire.

## État Supabase managé observé

La commande Supabase CLI `2.109.1` exécutée le 23 juillet 2026 sur
`meddata-staging` retourne :

- `pitr_enabled: false` ;
- `backups: null` ;
- `walg_enabled: true`.

La fermeture de B3 repose donc actuellement sur la sauvegarde coordonnée
quotidienne et sa copie GitHub immuable, pas sur une capacité PITR managée.
L'absence de PITR n'est compatible qu'avec un RPO approuvé d'au moins 24 h.
