# Décision — mise en pause du parcours d'inspection antivirus (12 août 2026)

## Ce qui est décidé

Le parcours d'inspection antivirus (ClamAV) **n'est plus obligatoire** pour les preuves
staging ni pour la cible technique `production`. Il devient un mode explicite, choisi à
chaque release :

| `INSPECTION_MODE` | Scanner | Effet |
|---|---|---|
| `paused` *(défaut du pipeline)* | aucun | Les fichiers déposés ne sont pas analysés ; ils restent lisibles sur le seul contrôle navigateur (`accepted_client`). |
| `strict` | exigé et prouvé | Comportement antérieur intégral : `/health`, fichier sain, EICAR, puis activation transactionnelle de la base. |

Non renseignée, la variable vaut `strict` : **l'antivirus ne se désactive jamais par oubli**.
Seul le pipeline, ou un opérateur, peut déclarer la pause.

## Pourquoi

Le scanner tourne dans un conteneur local exposé par un tunnel `trycloudflare` éphémère.
Chaque release imposait donc de relancer Docker, d'ouvrir un tunnel, de relever la nouvelle
URL et de reposer `CLAMAV_SCAN_URL` — une séquence manuelle, longue et rejouée à chaque
fois, pour un environnement qui ne contient que des données fictives. Le coût de la
procédure était devenu sans rapport avec ce qu'elle protégeait aujourd'hui.

Ce n'est pas une impossibilité technique : héberger ClamAV de façon pérenne reste faisable.
C'est une **dette assumée**, au même titre que `PILOT_EVIDENCE_WAIVER`.

## Ce qui n'est plus prouvé

- aucune **détection virale** : un fichier infecté déposé est conservé et relu tel quel ;
- aucune **quarantaine physique** : le déplacement inter-buckets et le pointeur forensique
  ne sont pas exercés ;
- le préflight `npm run e2e:staging` devient **partiel** : les familles EICAR et la reprise
  d'un `accepted_client` sont déclarées `NON EXECUTE`, jamais comptées comme vertes.

## Ce qui reste inchangé

La pause ne touche **que** le verdict antivirus. Restent intégralement en vigueur :

- `VITE_USE_SIGNED_READ=true` — la lecture des fichiers privés reste auditée par
  `signed-read`, RLS comprise ;
- le contrôle **magic-bytes** et le sous-format Office, côté navigateur comme côté serveur ;
- la limite de taille des buckets (20 Mio) et la policy `storage.objects` qui refuse tout
  objet sans ticket ;
- la sauvegarde chiffrée vérifiée avant toute écriture cloud, la vérification de cible, la
  dérive de schéma, les ACL de fonctions et l'inventaire Edge ;
- l'interdiction des données réelles.

## Périmètre et condition de levée

Admissible **uniquement** sur des données entièrement fictives, sans utilisateur tiers, dans
le cadre déjà posé par la
[`décision d'utilisation de l'environnement production pour les tests`](decision-environnement-production-tests-2026-07-29.md).

Pour rétablir le contrôle complet : lancer la release avec `inspection: strict`. Le scanner
est alors reprouvé (`/health`, fichier sain, EICAR) avant que la base ne repasse en mode
strict, et le préflight rejoue ses six familles. Aucune autre modification n'est requise.

**À déclarer telle quelle dans le dossier ANSICE**, et à lever avant la première donnée
réelle, le premier patient et le premier utilisateur qui n'est pas le porteur. Le suivi de
cette dérogation vit dans [`derogations-readiness.md`](derogations-readiness.md).
