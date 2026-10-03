# Restauration fictive isolée — 3 octobre 2026

**Résultat : sauvegarde et restauration DB/Auth/Storage exercées réellement, avec
connexion, lecture, modification et ouverture signée auditée dans le navigateur.
Production non activée et readiness production non approuvée.**

Au terme de l'exercice, le lot était non commité sur `codex/production-continuity`, base
`747adef4363ec4720e9ef79c9c9e3a691af6b057`. L'archive fournie par l'utilisateur a été
vérifiée contre son manifeste et réintégrée ; les corrections suivantes s'y ajoutent.
Pendant cet exercice : aucun push, déploiement, changement distant, notification à un tiers ou dépense.
Les migrations et audits antérieurs sont conservés. Le
`rapport-final-readiness-production-2026-10-02.md` demandé était absent du checkout
initial ; il n'a pas été remplacé. Il est désormais disponible avec l'audit ciblé
dans `develop` après fusion de la PR 402. Le [rapport du 2 octobre](rapport-continuite-production-2026-10-02.md)
décrit la session précédente, dont les blocages ont été réévalués.

## Portée et environnement réellement utilisés

Deux instances Supabase distinctes et locales, entièrement fictives, dans le cloud
de l'agent : source API/DB 54321/54322 et cible 55321/55322. Aucun accès aux projets
MedData actifs. La source rejoue les migrations et le seed ; les cibles démarrent
sans migration applicative, sans seed, sans compte ni bucket. Des IDs distincts ont
été utilisés pour chaque nouvelle cible ; les anciennes données restent en volumes
isolés pour diagnostic, sans nettoyage Docker global.

Le jeu contient **10 dossiers fictifs, 9 comptes et identités, 2 fichiers valides
(JPEG et PDF)**. Une fonction personnalisée Auth avec accès authentifié et refus
anonyme teste la réconciliation des définitions internes. Une création de compte
supplémentaire après restauration teste le trigger de profil ; ce dixième compte
n'est pas compté parmi les 9 comptes restaurés.

Outils : Node 22.22.0, npm 10.9.4, CLI Supabase 2.109.1, client PostgreSQL 17.11,
Docker 28.4 avec driver `vfs`, agent-browser 0.38.2 et Chromium du cloud.
`npm ci` complet a réussi après vérification du réseau courant. Les probes réseau
ont confirmé un accès réel à SheetJS et aux registres ; le refus antérieur n'a pas
été supposé résolu. Aucune politique réseau locale n'a été modifiée.

Le pull PostgreSQL par couches a saturé le disque de 32 Gio avec `vfs`. Pour cet
exercice seulement, le rootfs linux/amd64 a été exporté depuis l'image officielle
immuable puis importé en conservant Env, Entrypoint, Cmd, User, Workdir, ports et
volumes. Le tag local sert à la CLI avec son registre Docker Hub supporté.

- Origine : `docker.io/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453`.
- Rootfs exporté : SHA-256 `1ff6b4a18d9364e2d36be054149953d76c1b7c1e055b94f7992af09c23e86d4f`.
- Image importée : `sha256:77f451874d37012096152a54a10e31900c0ab684c4a4f28261c0326dbf9888d5`.

**Le digest des couches Docker originales n'est pas conservé.** Ce n'est pas un
test du chemin CI de préparation d'image par digest ; son garde-fou production
reste inchangé. Les versions et les adaptations sont des limites de reproductibilité
à reprendre lors d'un exercice dans l'infrastructure de secours prévue.

Les conteneurs Edge ont reçu le proxy de la plateforme, une CA montée en lecture
seule et les noms internes dans `NO_PROXY`. La vérification TLS reste active.
Les URLs locales `kong:8000` ont été résolues vers le même gateway Docker dans le
navigateur ; le pilote API utilise son port loopback publié, avec chemin et signature
inchangés. Aucune réponse Edge/Storage n'a été simulée pour ces parcours.

## Défauts trouvés et corrigés

1. **Réconciliation interne manquante.** Le lanceur compare maintenant les exports
   Auth/Storage à une cible vierge compatible, prépare les définitions personnalisées
   et ACL, et bloque les différences structurelles non prises en charge avant écriture.
2. **Droits publics trop larges lors du premier import.** Les 91 tables correspondaient,
   mais les defaults de `supabase_admin` ajoutaient des droits. L'import crée les objets
   sous `postgres`, retire les ACL automatiques et rejoue les ACL source en transaction.
   Une nouvelle cible a confirmé la correspondance des trois schémas. La comparaison
   utilise le parseur PostgreSQL 17 (`libpg-query` verrouillé à 17.7.4), notamment pour
   distinguer des parenthèses booléennes équivalentes d'une contrainte ou ACL différente.
3. **Droits serveur de `signed-read` absents sur la source aussi.** La vérification du
   catalogue réel a confirmé la même absence de SELECT sur `patient` et d'INSERT sur
   `audit_log`, donc un défaut antérieur au backup. La migration additive
   `20261003090000_signed_read_server_privileges.sql` accorde au seul `service_role`
   SELECT sur `patient(id, base_id)` et INSERT sur les cinq colonnes utilisées pour
   l'audit. Elle n'ajoute aucun droit anonyme/utilisateur ni UPDATE/DELETE serveur.
   Après application uniquement sur la source fictive, une **nouvelle sauvegarde**
   a été restaurée sur une nouvelle cible, sans correction SQL manuelle de cette cible.
4. **Métadonnées Storage.** Après upload et vérification des octets, ownership,
   métadonnées et timestamps sont rétablis avec précision PostgreSQL ; seule la version
   physique du backend est renouvelée pour correspondre aux fichiers uploadés.
5. **Provenance et tentatives.** La source `isolated-local` exige loopback explicite
   et classification fictive ; les projets actifs restent protégés. Les six exports
   v2 exigent la couverture COPY Auth/Storage lors de génération et vérification.
   Le manifeste authentifie l'empreinte des fichiers source et signale le checkout
   non commité. Les artefacts de workflow incluent désormais la tentative du run.

## Observations du dernier exercice

Les comparaisons initiales précèdent les connexions et modifications de test ; elles
n'ont pas été sautées ou reprises pour le dernier exercice.

| Contrôle réel | Résultat |
|---|---|
| Exports chiffrés, HMAC et déchiffrement | 6 exports v2 vérifiés |
| Tables public/Auth/Storage | 91 comparées, compte et hash des lignes identiques |
| Définitions, propriétaires, droits, RLS et policies | 3 schémas comparés, aucune différence |
| Comptes / identités / connexions Auth | 9 / 9 / 9 réussies |
| Objets et hashes relus sur cible | 2 / 2, aucune différence |
| Liens dossiers ↔ Storage | 2 vérifiés, aucun objet orphelin |
| Clés étrangères | 175 contrôlées, aucun orphelin |
| Lecture et modification API | Autorisées pour le propriétaire ; refus du second compte |
| URL signée Edge | Octets relus et hash correct ; refus du second compte |
| Audit après signature | Nouvel événement observé, pas seulement un événement restauré |
| Fonction Auth personnalisée | Authentifié autorisé, anonyme refusé |
| Trigger de création de profil Auth | Exécuté réellement après création du compte de test |
| Navigateur | Connexion, dossier, correction persistée après reload, image chargée 32×32 |
| Refus navigateur | Le second compte voit « Page introuvable », sans dossier ni image |
| Audit de l'ouverture navigateur | Nouvel événement DB après les parcours API |
| Erreurs navigateur | Aucune exception JS ; console sans catégorie erreur |

Les tables d'historique internes exclues par la CLI ne sont pas comparées. La version
physique `storage.objects.version` est exclue du hash des lignes ; les autres champs,
y compris ownership et précision des timestamps, sont comparés. Les contrôles de
données sont des observations avant les écritures volontaires des parcours.

Les [observations JSON](observations-restauration-isolee-2026-10-03.json) contiennent
uniquement des agrégats, dates et empreintes, sans clé ni nom d'objet/dossier.
Leur format est `meddata-local-recovery-observations/v1` : **ce n'est pas une preuve
de release approuvée**. Les captures fictives sont conservées hors dépôt dans
`/workspace/artifacts`, avec leurs empreintes dans les observations.

## Mesures, sans effacer les échecs précédents

Toutes les heures sont UTC le 3 octobre 2026.

| Événement du nouvel exercice après correction de la source | Heure / durée |
|---|---|
| Début du backup | 08:58:44.233 |
| Fin du backup | 08:59:50.954 — 66,721 s |
| Incident simulé / début de prise en charge | 08:59:51.123 |
| Import DB/Storage | 09:02:40.552 → 09:03:09.258 — 29 s arrondies |
| Fin des parcours API | 09:04:11.641 |
| Fin contrôlée des parcours navigateur | 09:06:57.946 |
| Reprise locale observée jusqu'à fin des parcours | **427 s — 7 min 07 s** |
| Perte potentielle conservatrice depuis début du backup | **67 s arrondies** |

La fenêtre de 67 s n'est pas une perte constatée : la source fictive était au repos
pendant la sauvegarde. Les exports successifs ne prouvent toujours pas un instantané
atomique ni la suspension des writers d'un futur service réel.

Le **premier incident** a été marqué à 08:34:45.392. Son backup a restauré les données,
mais les droits supplémentaires puis le défaut source de `signed-read` ont empêché
la validation complète. Il n'a donc pas de RTO de reprise complète réussi.
Du premier incident à la fin du nouvel exercice, corrections, diagnostic et nouvelle
sauvegarde compris : **1 933 s — 32 min 13 s**. Les 7 min 07 s du second exercice
ne représentent pas cette durée totale et ne récupèrent pas rétroactivement le point
de sauvegarde du premier incident.

Le RTO local inclut le provisionnement de la cible et les parcours réellement décrits.
Il utilise des images déjà disponibles et une clé locale déjà préparée ; l'installation
initiale, le coffre organisationnel, un suppléant et une infrastructure froide ne sont
pas exercés. Avec deux petits fichiers et dix dossiers, aucune capacité à volumétrie
production ou SLA organisationnel n'est démontrée.

Le manifeste authentifié du dernier backup indique un checkout non commité et
l'empreinte de génération
`7a981ddc0c07f316d5a6e3b26e24fbab4cb39e178f1cb111895806debd666c47`.
Le pilote de vérification a ensuite renforcé le contrôle d'audit nouveau ; l'archive
de code finale porte ses propres empreintes. Le SHA Git de base seul ne représente
aucun de ces lots non commités.

## Validation du code et limites restantes

Après autorisation de l'utilisateur, le lot a été repris sans conflit dans une
branche issue de `develop` à `019e765b78568daee47a696525b98f559fcfdec4` (PR 401 et 402
conservées), pour publication d'une PR vers **develop**. Les observations de
restauration ci-dessus restent datées et liées à leur base et empreinte de génération ;
elles ne deviennent pas une preuve de release du nouveau SHA. La publication de la
PR ne déploie pas la migration et n'active aucune configuration production.

- **51 tests ciblés dans 13 fichiers** réussis, dont 3 tests PostgreSQL d'upgrade
  vérifiant les droits serveur limités et la conservation des droits clients.
- **9 contrôles supplémentaires dans 2 fichiers** réussis sur audit et ACL des
  fonctions SECURITY DEFINER.
- Lint global sans warning, typecheck global, build frontend avec les deux flags
  stricts, génération et vérification du snapshot, `git diff --check` réussis.
- Actionlint 1.7.9 réussi pour continuité et pour la copie de release avec ses ancres
  YAML développées hors dépôt ; ShellCheck/Pyflakes externes non exécutés.
- Les tests cloud distants et les autres parcours réels (scanner
  propre/EICAR, import, export, etc.) ne sont pas revendiqués. Le statut `accepted`
  des deux fixtures a été posé par l'administrateur ; aucune inspection antivirus
  effective n'est validée par cet exercice.

Contrôles d'intégration exécutés sur la branche issue de `develop`, distincts de
l'exercice de restauration historique :

- Suite complète Vitest : **2 648 tests réussis dans 246 fichiers**, trois tests et
  un fichier ignorés (2 651 tests recensés dans 247 fichiers), aucun échec.
- 306 tests Edge Deno réussis ; format, lint et vérification typée Edge réussis
  avec Deno 2.9.2 et son lock synchronisé.
- 189 migrations appliquées depuis zéro par le vérificateur local PostgreSQL 18 ;
  snapshot du schéma et inventaire des neuf fonctions Edge conformes. L'exercice
  de restauration reste celui réalisé avec PostgreSQL 17, comme décrit plus haut.
- Lint et typecheck globaux, build avec flags stricts, préflight environnement,
  audit de dépendances strict staging et actionlint 1.7.12 sur tous les workflows
  réels réussis.
- Les contrôles de déploiement ont été adaptés au cron production conditionnel,
  aux clés identifiées, à la rétention validée et aux alertes indépendantes ; l'ordre
  sauvegarde/vérification/conservation avant écriture est conservé.

Ces validations de code ne démontrent ni le déploiement ni les parcours du cloud
production. Le statut distant de la CI est porté par la PR, séparément de ces
résultats locaux.

Avant usage réel restent nécessaires : fermeture des conditions des audits de la
PR 402, cohérence DB/Storage avec
writers suspendus ou versions récupérables, backups managés/PITR et inventaire des
configurations/secrets hors SQL, coffre et suppléant depuis un autre poste, copie
immuable indépendante des accès GitHub, watchdog production déployé et réception
humaine des alertes, approbations RPO/RTO/rétention et exercice à volumétrie prévue.
Le gate historique acceptant v1 et sa dérogation pilote ne valide pas le futur réel.
Le [runbook](../continuite-production-runbook.md) expose ces étapes ; aucune activation
distante n'est autorisée ou effectuée par la présente validation locale.
