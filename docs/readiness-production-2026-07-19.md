# Audit final de readiness production — MedData

- Dernière mise à jour : **2026-07-26 — Africa/Douala**
- Niveau appliqué : **4 — Production readiness**
- Décision technique unique : **production readiness not demonstrated**
- Correspondance LOT 15 : **NO-GO**
- Niveau maximal démontré : **données fictives uniquement, dans un environnement local ou non-production isolé et réinitialisable ; depuis le 26 juillet 2026, un staging fictif directement prouvé sur le SHA `ebee179`, parcours de fichiers exclus**

Ce rapport distingue le fonctionnement logiciel de l'aptitude à un usage
clinique. Il ne constitue ni une autorisation juridique, clinique ou éthique, ni
une acceptation de risque par l'organisation. Aucune note globale ne remplace
les conditions bloquantes.

## 1. Identité du candidat et état déployé

### Candidat courant — interphase du 26 juillet 2026

| Élément | État vérifié |
|---|---|
| Branche de travail | `codex/readiness-b3-b4-b8-b1-b9` |
| Candidat commun | `ebee17910f6de005ab933ee08978d2e97686d19d`, merge de la PR #51 dans `develop` |
| Arbre applicatif | identique à celui du commit de branche `99c7bf5` |
| CI GitHub | PR #51 run `30195837590` vert ; post-merge `develop` run `30196032319` vert |
| Backend staging | run coordonné `30197149574` : 105 migrations, `storage.sql` à l'empreinte `b9e87377…`, six Edge Functions actives, inventaire sans drift |
| Frontend staging | déploiement Vercel `dpl_3WrrxRjX2WgcitJCWJzvHHu28JTJ`, état `READY`, métadonnée Git `ebee179`, route `/login` HTTP 200 |
| Production | ignorée par le run coordonné ; aucun déploiement production effectué |
| Preuves immuables | `continuity-staging-30196157372-1`, `recovery-evidence-staging-ebee17910f6d`, `readiness-evidence-staging-ebee17910f6d`, toutes rattachées à `ebee179` |
| Limite du run | le job frontend est devenu rouge lors de la vérification du scanner ClamAV, **après** un déploiement réussi ; cet échec appartient à B2 et n'est pas reclassé en succès |
| `main` | inchangé à `af71477` ; la promotion `develop` vers `main` reste une décision de release séparée |

Deux incidents de déploiement ont précédé ce candidat et ne sont pas masqués :

- run `30194560179` : le bundling Edge local a rencontré la limite anonyme du
  registre Docker ; la PR #50 (`6338aeb`, merge `44223c0`) a basculé les six
  déploiements sur le bundler API Supabase ;
- run `30195079740` : le bundler distant ne pouvait pas joindre
  `cdn.sheetjs.com` ; la PR #51 (`e1622a9`, `99c7bf5`, merge `ebee179`) a
  embarqué SheetJS 0.20.3 avec sa licence Apache, une empreinte verrouillée et
  un test d'inventaire, sans retour au paquet npm vulnérable.

Les preuves B3, B4 et B8 antérieures à `ebee179` ont été rejouées après ces
incidents, afin qu'aucune ne soit transférée depuis un SHA précédent.

### Candidat du 22 juillet 2026 — conservé comme historique

| Élément | État vérifié |
|---|---|
| Branche finale | `main`, via PR #34 |
| Commit candidat technique | `5239804fd5107b01dff290e9498f8d81ee14398a` |
| Commit de merge validé | `e63499a1caa736d793d2db542cc0eadf7411b4ea` |
| Base de comparaison | `121a866ef95ea4134b402c71c9f0bb4d4f869df1` (`origin/main`, merge-base exact au 2026-07-22) |
| Écart candidat/base | 11 commits techniques et un commit documentaire fusionnés par PR #34 |
| État Git contrôlé | `main` et `origin/main` alignés au merge ; quatre documents utilisateur non suivis ont été exclus |
| GitHub live | PR #34 fusionnée dans `main` le 2026-07-22 ; branche par défaut du dépôt toujours `develop` |
| CI GitHub | PR run `29950997481` vert ; post-merge `main` run `29951322336` vert, scanner et pipeline complet |
| Protections GitHub live | API `main` et `develop` : HTTP 403, fonctionnalité indisponible sans changement de plan/publicité ; environnements `staging` et `Production` sans reviewer, règle de protection ni branche autorisée |
| Dernier staging directement prouvé | SHA `6774c18005cb0b23de7e39e6508e2649f5e0f456`, Supabase 105 migrations et 6 Edge Functions — **preuve périmée pour le candidat actuel** |
| Dernière production directement prouvée | frontend `e6982ceab6dc1ba8a09b371722c489fdb284482a`, Supabase 86/105 migrations, 5/6 Edge, inspection stricte `false` — **incohérente** |
| Supabase/Vercel live au 2026-07-22 | non re-vérifiables : aucun jeton Supabase ou Vercel disponible dans l'environnement local ; les preuves des 18–19 juillet sont conservées mais périmées |
| Scanner candidat | image locale Node 22 construite ; `/health` répond 503 sans `clamd`, conformément au fail-closed ; aucun hébergement distant durable prouvé |

Toute modification du code, des migrations, des policies, de Storage, d'une Edge
Function, des secrets ou de l'hébergement impose une revalidation ciblée puis un
nouveau staging du SHA exact.

## 2. Corrections B1 à B10 réalisées

| Commit | Lot | Correction locale réalisée | Limite restante |
|---|---|---|---|
| `4055f45` | B2 | Santé scanner enrichie : ping, version/signatures, âge maximal et capacité ; monitor fail-closed | Hébergement ClamAV, signatures live et tests staging requis |
| `d328cad`, `d343a1f` | B3 | Sauvegarde quotidienne coordonnée DB/Storage, chiffrée, HMAC, vérifiée et conservée ; alerte staging expurgée en cas d'échec | PITR, offsite et immutabilité externes ; historique quotidien encore court |
| `997e48c` | B4/B8 | Validateur strict de preuve de restauration, RPO/RTO, rollback et forward recovery | Aucun exercice actuel effectué |
| `b855cb3` | B5 | Alertes opérationnelles allowlistées, expurgées et testables ; échec du monitor préservé | Destination, astreinte et accusé de réception réels absents |
| `e121008` | B6 | Production bloquée sans gouvernance signée, actuelle et liée au SHA | Avis, DPA, DPIA/AIPD et autorités non fournis |
| `0dd5966` | B7 | Vérification GitHub live fail-closed : checks, reviews, admins, branches et environnements | Le contrôle live échoue réellement en 403 ; MFA/revue nominative externes |
| `9167b91` | B8 | Production bloquée sans preuve d'exercice de reprise du SHA exact | Exercice staging isolé non effectué |
| `d2d8088` | B9 | Inventaire exact des 85 signatures `SECURITY DEFINER`, justification, ACL/search_path testés et contrôle distant de drift | Contrôle distant du candidat non exécuté |
| `818e178` | B10 | Production bloquée sans titulaires/suppléants, astreinte, support, MFA, runbooks et QA clinique/scientifique | Affectations, simulation et procès-verbal QA externes absents |
| `d5ee798` | B1/B7 | Gate `actionlint` global rendu propre | Ne résout pas la cohérence des composants déployés |
| `5239804` | B1 | Deux dépendances transitives élevées mises à jour | CI distante du PR et du merge réussie ; futurs audits restent requis |

Les corrections utilisent `apply-audit-lot`; les changements PostgreSQL, ACL,
restauration et continuité ont été traités avec `meddata-db-safety`. Aucune
migration historique n'a été modifiée et aucune migration distante, Edge
Function ou configuration cloud n'a été appliquée.

## 3. Résultats actuels et reproductibles

| Contrôle | Résultat actuel au 2026-07-26 | Portée |
|---|---|---|
| Tests ciblés B2–B10 | **réussis** | Scanner, backup, reprise, alerting, gouvernance, GitHub, ACL et opérations |
| `npm ci` | **réussi sous Node 22.23.1 ; 0 vulnérabilité** | Installation propre depuis le lockfile du lot React Router |
| `npm run typecheck` | **réussi** | TypeScript strict |
| `npm run lint` | **réussi, 0 warning** | Dépôt complet |
| `npm run test:web` | **37 fichiers, 174/174** | Frontend, domaine web et régressions de navigation React Router |
| `npm run test:rls` | **couvert dans la suite globale** | PostgreSQL réel embarqué, RLS/RPC/transactions |
| `npm test` | **91 fichiers, 652/652** | Suite globale exacte sous Node 22.23.1 |
| `npm run db:verify` | **réussi** | 105 migrations depuis zéro ; 36 tables, 208 fonctions, 59 policies, 55 triggers |
| `npm run release:edge:check` | **réussi** | Inventaire statique des 6 Edge Functions |
| Edge fmt/lint/check/test | **réussi, 70/70** | Deno frozen et contrats Edge |
| `actionlint` épinglé | **réussi** | Tous les workflows GitHub |
| `npm run audit:dependencies -- --scope=staging` | **réussi ; 0 modérée/haute/critique** | Aucune allowlist ni date d'expiration ; l'ancienne exception React Router est retirée |
| `npm run audit:dependencies -- --scope=production` | **réussi ; 0 modérée/haute/critique** | Même politique stricte ; ce résultat de dépendances ne démontre pas la readiness production |
| `npm run build` | **réussi** | Vite 8.1.4, 1 980 modules, PWA générée avec 68 entrées et lecture signée |
| Image scanner | **construite** | Base Node 22 épinglée ; smoke `/health` = 503 attendu sans `clamd` |

Les contrôles locaux du lot du 26 juillet ont utilisé Node 22.23.1, conforme à
la plage `>=22.22.0 <23` imposée par le projet et par les workflows. Après
réinstallation propre, les 21 tests ciblés, les 174 tests web, les audits, le
typecheck, le lint et le build ont été rejoués avec succès. La suite globale de
652 tests, `db:verify` et les 70 tests Edge ont réussi sur le même code et le
même lockfile avant cette réinstallation ; la CI du SHA final doit les rejouer
avant toute promotion de branche.

## 4. Matrice unique de readiness

États autorisés : **prouvé conforme**, **prouvé non conforme**, **partiellement
prouvé**, **non vérifié**, **preuve périmée**, **vérification externe requise**.

| Gate | État | Preuve | Date | Environnement | Commit/version | Risque | Bloquant | Responsable | Action suivante |
|---|---|---|---|---|---|---|---|---|---|
| Release et versions | partiellement prouvé | Le candidat `ebee179` est aligné sur staging pour le frontend, la DB, Storage et les six Edge Functions ; la dernière production connue mélange toujours frontend `e6982ce`, 86 migrations, 5 Edge et strict `false` | 2026-07-26 | GitHub/Vercel/Supabase | `ebee179` sur staging ; production historique incohérente et non touchée | Critique tant que la production reste dans cet état | Oui | Release manager | Conserver la production intacte jusqu'à la fermeture des gates, puis une promotion coordonnée unique du SHA approuvé |
| Sécurité | prouvé conforme sur staging | `db:function-acl:verify` exécuté sur la base distante du candidat : 132 fonctions `SECURITY DEFINER` conformes à l'inventaire, aucune exécutable par `anon`, `search_path` bornés ; 36/36 tables publiques sous RLS et 59 policies ; lecture autorisée visible, base invisible pour un sujet sans accès ; RPC autorisée au médecin fictif, refusée à l'anonyme et au sujet sans droit ; politique DB d'inspection stricte active | 2026-07-26 | Staging distant | `ebee179` | Critique tant que la production n'est pas alignée sur ce même SHA | Oui pour la production | RSSI + responsable DB | Rejouer ce contrôle sur le SHA finalement promu, et n'accepter aucune preuve issue d'un autre SHA |
| Intégrité scientifique | partiellement prouvé | Tests locaux d'export/import et historiques verts ; dernier staging scientifique porte sur un ancien SHA | 2026-07-22 | Local ; staging périmé | `5239804`; ancien `6774c18` | Résultat non revalidé sur artefact candidat | Oui pour clinique | QA scientifique | Rejouer jeux de référence et faire signer l'interprétation scientifique |
| Données | partiellement prouvé | 630 tests globaux et 105 migrations sans perte/altération observée ; aucune continuité cloud actuelle | 2026-07-22 | Local | `5239804` | Perte possible si backup cloud absent | Oui | Responsable données | Staging exact puis sauvegarde et restauration représentatives |
| Concurrence | partiellement prouvé | Conflits, retries, idempotence, atomicité et verrous passent sur PostgreSQL embarqué | 2026-07-22 | Local | `5239804` | Drift/performance cloud non exclus | Oui pour production | Responsable PostgreSQL | Rejouer la matrice concurrente sur staging exact |
| Migrations, RLS, RPC et Storage | prouvé sur staging | 105 migrations depuis zéro en local, et 105 migrations appliquées sur la cible staging du candidat ; `storage.sql` à l'empreinte `b9e87377…` ; 36/36 tables sous RLS, 59 policies et inventaire sans drift | 2026-07-26 | Local + staging distant | `ebee179`, dernière migration `20260714215335` | Aucune preuve équivalente sur la cible de production | Oui pour la production | Responsable Supabase | Rejouer backup, `db push`, Storage, ACL, drift et tests de refus sur la cible réellement promue |
| Fichiers | prouvé non conforme | Scanner et Edge locaux fail-closed ; aucun ClamAV durable distant ni fraîcheur de signatures live | 2026-07-22 | Local/cloud | image locale candidate | Fichier non inspecté ou service indisponible | Oui | Infrastructure + RSSI | Héberger, superviser, puis tester sain/EICAR/panne/capacité sur staging |
| Hors-ligne | prouvé conforme | Release standard et build candidat imposent `disabled/false` | 2026-07-22 | Local/CI statique | `5239804` | Faible tant que désactivé | Non si maintenu désactivé | RSSI + release manager | Conserver désactivé pour toute donnée pseudonymisée ou réelle |
| Tests | prouvé conforme | 169 web, 461 DB, 630 globaux, 70 Edge, build et workflows verts ; PR et post-merge CI verts | 2026-07-22 | Local/GitHub | `5239804`, merge `e63499a` | QA humaine, staging exact et charge non couverts | Non technique ; oui clinique | QA | Exiger E2E staging, charge adaptée et QA manuelle signée |
| Edge Functions | prouvé sur staging | Les six fonctions sont déployées sur staging depuis `ebee179` via le bundler API Supabase et actives, inventaire sans drift ; 70/70 tests locaux, rejoués sur le SHA courant et le SHA précédent lors de l'exercice de reprise | 2026-07-26 | Local + staging distant | `ebee179` | Fonction critique absente ou ancienne en production | Oui pour la production | Responsable Edge | Vérifier hashes et E2E sur le SHA promu ; l'E2E des parcours de fichiers reste impossible tant que B2 est ouvert |
| CI/CD | prouvé non conforme | Workflows locaux valides ; API live confirme protections indisponibles et environnements sans règles | 2026-07-22 | GitHub | plan/configuration live | Bypass de review ou de promotion | Oui | Administrateur GitHub + RSSI | Plan compatible ou contrôle équivalent approuvé ; branches/checks/reviewers/MFA |
| Staging | prouvé pour le périmètre sans fichiers | Run coordonné `30197149574` : validation complète réussie, backend staging réussi, frontend Vercel `dpl_3WrrxRjX2WgcitJCWJzvHHu28JTJ` en état `READY` avec métadonnée Git `ebee179` et `/login` HTTP 200 ; production ignorée | 2026-07-26 | Staging | `ebee179` | Le job frontend est ensuite devenu rouge sur la vérification ClamAV, après déploiement réussi : aucun parcours de fichier n'est validé | Oui pour tout parcours de fichier et pour la production | Release manager | Rejouer le run coordonné complet une fois B2 fermé, scanner compris |
| Sauvegardes | prouvé sur staging pour le SHA candidat | Run `30196157372` réussi : 4 exports DB, 117 objets et 16 969 octets, HMAC et extraction vérifiés, manifeste Storage `sha256:5165598…` ; artefact `continuity-backup-staging-30196157372` retenu jusqu'au 25 août 2026 ; release immuable `continuity-staging-30196157372-1` ciblant `ebee179`, digest `sha256:168c2359…` ; clé rouverte depuis l'enveloppe DPAPI séparée, sans affichage ; historique, alerte d'échec et watchdog Pipedream antérieurs conservés | 2026-07-26 | GitHub staging + Pipedream + poste de reprise | `ebee179` | Ni PITR ni backups managés (`pitr_enabled: false`) ; copie immuable hébergée chez GitHub, donc non indépendante ; coffre organisationnel requis avant données réelles | Oui pour la production | Continuité + infrastructure | Souscrire PITR/backups managés et placer une seconde enveloppe de clé hors de la machine du porteur |
| Restauration | prouvé sur le SHA candidat | Rejeu dans le projet local isolé `meddata-recovery-30196157372` : 5 comptes Auth, 36 tables publiques toutes sous RLS, 4 buckets et 117/117 objets restaurés ; 111 FK contrôlées, 0 orphelin, 0 divergence sur les 35 tables de données publiques ni sur les hash Storage ; lecture propriétaire autorisée et lecture croisée refusée ; RPO observé 77 s et RTO observé 1 587 s, sous les objectifs 24 h/4 h approuvés le 25 juillet ; preuve JSON `sha256:4ab7a20d…` publiée dans `recovery-evidence-staging-ebee17910f6d` | 2026-07-26 | Local isolé, source staging fictive | exercice `ebee179` | Cible locale, non représentative d'un environnement clinique ; toute modification du candidat impose un nouveau replay | Oui pour la production | Continuité + exploitation | Rejouer l'exercice sur le SHA finalement promu ; n'installer `RECOVERY_EVIDENCE_JSON` en environnement `production` qu'après autorisation production distincte |
| Monitoring | prouvé non conforme | Alerting local expurgé ; aucune destination/astreinte live ni série de probes vertes | 2026-07-22 | Local/cloud | `5239804` | Incident silencieux | Oui | Exploitation | Configurer destination, tester panne et accusé de réception, mesurer escalade |
| Accès | prouvé non conforme | RLS local vert ; GitHub live sans protections ; MFA et revue nominative non prouvées | 2026-07-22 | Local/GitHub | état live | Accès privilégié non maîtrisé | Oui | RSSI + propriétaires de services | Revue nominative, MFA, moindre privilège et exports de configuration datés |
| Rollback et forward recovery | prouvé sur le SHA candidat | Rollback de la migration `20260714215335`, forward par `supabase db push`, réapplication de `storage.sql`, puis état final identique ; frontend courant → précédent `b5a0369` → courant en HTTP 200/200/200 ; six Edge Functions contrôlées sur les deux versions, 70/70 tests chacune | 2026-07-26 | Local isolé, staging fictif | exercice `ebee179` | Aucun parcours de fichier exercé ; toute modification du candidat impose une nouvelle preuve chronométrée | Oui pour la production | Release manager + continuité | Rejouer les contrôles sur le SHA promu et publier la preuve immuable correspondante |
| Conformité | vérification externe requise | Gate signé présent ; dossiers Cameroun/Tchad restent des projets, sans DPA/DPIA/AIPD/avis éthique prouvés | 2026-07-22 | Organisation | documents projet | Usage médical non autorisé | Oui | Responsable de traitement + juridique + DPO + éthique | Archiver décisions signées et générer le manifeste de gouvernance |
| Incident médical | vérification externe requise | Gate opérationnel exige annuaire, autorité, astreinte et simulation ; aucune preuve réelle fournie | 2026-07-22 | Organisation | `5239804` | Notification/prise en charge tardive | Oui | Direction + DPO + RSSI | Nommer titulaires/suppléants, simuler et faire accepter la procédure |
| Exploitation | vérification externe requise | Gate B10 exige RACI, support, formation, MFA, runbooks et QA ; secret de preuve absent | 2026-07-22 | Organisation | `5239804` | Service dépendant d'une personne/non soutenable | Oui | Direction + responsable exploitation | Produire les affectations et preuves puis valider le manifeste opérationnel |

## 5. Blocages B1 à B10 après correction

| ID | État après correction | Bloquant production | Condition de fermeture |
|---|---|---|---|
| B1 | Alignement exact démontré sur staging pour `ebee179` : frontend Vercel `READY`, 105 migrations, `storage.sql` et six Edge Functions sans drift ; production toujours incohérente et volontairement non touchée | Oui, critique pour la production | Même SHA approuvé puis déployé en production après fermeture des autres gates |
| B2 | Durcissement local réalisé, service distant absent ; le job frontend du run coordonné `30197149574` a réellement échoué sur la vérification du scanner, après le déploiement — échec conservé comme tel, jamais reclassé | Oui, critique | ClamAV durable, strict, signatures/capacité et monitors prouvés |
| B3 | Sauvegarde du SHA candidat exécutée et vérifiée (run `30196157372`), copie immuable `continuity-staging-30196157372-1` publiée, clé rouverte depuis l'enveloppe DPAPI séparée ; satisfait pour le staging fictif | Oui pour la production | PITR ou backups managés, copie réellement indépendante de GitHub et coffre organisationnel hors de la machine du porteur |
| B4 | Restauration complète réussie sur `ebee179`, RPO/RTO 77 s/1 587 s sous les objectifs approuvés 24 h/4 h, JSON validé et publié ; satisfait pour le staging fictif | Oui pour la production | Même exercice réussi sur le SHA promu, dans une cible représentative et avec autorisation production |
| B5 | Alerting prêt, supervision opérationnelle absente | Oui, critique | Probes durables, alerte reçue, astreinte et incident exercé |
| B6 | Gate fail-closed prêt, autorisations absentes | Oui, critique | Documents et décisions signés des autorités compétentes |
| B7 | Gate live prêt et échoue comme attendu | Oui, élevé | Protections/reviewers ou contrôle compensatoire formel, MFA et moindre privilège |
| B8 | Rollback/forward recovery complet réussi sur `ebee179`, chronométré, intègre et validé ; satisfait pour le staging fictif | Oui pour la production | Rollback/forward recovery du SHA promu, et secret `RECOVERY_EVIDENCE_JSON` installé en environnement `production` sur autorisation distincte |
| B9 | **Conforme sur la base distante du candidat** : 132 fonctions `SECURITY DEFINER` conformes, aucune exécutable par `anon`, 36/36 tables sous RLS, 59 policies, RPC autorisée/refusée conformes ; acceptation bornée au staging fictif | Oui pour la production | Même contrôle rejoué sur le SHA promu, sans aucun parcours de fichier accepté tant que B2 est ouvert |
| B10 | Gate fail-closed prêt, organisation absente | Oui, élevé | RACI, suppléances, support, formation, simulation, MFA et QA signés |

Aucun export scientifiquement incorrect, contournement RLS ou perte silencieuse
n'a été observé dans les tests actuels. Cela ne compense aucun des blocages
automatiques ci-dessus.

## 6. Périmètre autorisé

### Données et utilisateurs

Uniquement des données entièrement fictives, sans document, identifiant ou
élément réel et sans possibilité raisonnable de ré-identification. Utilisateurs :
développeurs et QA explicitement affectés, avec comptes de test dédiés, dans un
environnement isolé et réinitialisable.

### Fonctionnalités désactivées ou interdites

- mode hors-ligne pour toute release standard ;
- upload hébergé tant que ClamAV durable et monitor vert ne sont pas prouvés ;
- import ou document issu d'un système réel ;
- export utilisé pour une décision scientifique, publication ou décision clinique ;
- comptes/invitations de production et utilisateurs externes ;
- usage clinique de toute URL actuellement étiquetée production ;
- déploiement production avant fermeture de tous les gates.

### Risques acceptés et contrôles compensatoires

Aucun risque clinique, réglementaire ou de confidentialité n'est accepté. Seul
un risque de démonstration technique fictive, isolée et jetable est tolérable :
comptes minimaux, offline désactivé, inspection fail-closed, environnement
non-production, surveillance manuelle et purge des fixtures.

### Conditions de suspension

Suspendre immédiatement si une donnée réelle ou pseudonymisée apparaît, si un
compte n'est pas identifié, si le scanner/monitor échoue, si le backup vérifié
manque avant une écriture, si un secret est exposé, si le SHA dérive, si un accès
interdit réussit ou si un test critique régresse.

## 7. Actions externes restantes

| Action | Responsable attendu | Procédure exploitable | Preuve acceptable | Niveau interdit tant qu'ouverte |
|---|---|---|---|---|
| Protéger GitHub et les environnements | Administrateur GitHub + RSSI | Passer à un plan permettant les règles privées ou faire approuver un contrôle compensatoire ; configurer checks/reviews/admins et reviewers/branches d'environnement | Export API daté, run de `npm run github:controls:verify`, revue MFA nominative | Production |
| Héberger ClamAV | Infrastructure + RSSI | Déployer HTTPS authentifié ; secrets staging ; probes `/health`, sain, EICAR, panne et âge des signatures | Inventaire/SLA, logs expurgés, tests et plusieurs monitors verts | Pseudonymisé, réel, production |
| Exécuter les sauvegardes | Infrastructure + continuité | Activer `CONTINUITY_BACKUP_ENABLED`, lancer staging, vérifier HMAC/chiffrement ; activer backups managés/PITR et copie objets indépendante | Runs et artefacts chiffrés, historique live, rétention, alertes | Pseudonymisé, réel, production |
| Exercer la restauration et la reprise | Continuité + release manager | Cible vide isolée, données fictives, restore DB/Auth/Storage, rollback/forward, puis `npm run recovery:evidence:verify -- --file=<preuve> --commit=<SHA>` | Preuve exacte, hashes/comptes, zéro orphelin, RPO/RTO et signatures | Pseudonymisé, réel, production |
| Valider staging exact | Release manager + QA | Workflow coordonné sur le SHA fusionné ; ACL distant, drift, E2E backend/navigateur, antivirus et monitors | Runs/artefacts immuables rattachés au SHA | Pseudonymisé, réel, production |
| Rendre monitoring/incident opérables | Exploitation + DPO + RSSI | Destination d'alerte, titulaire/suppléant, panne injectée, ticket et escalade mesurée | Alerte reçue, accusé, chronologie et compte rendu signé | Pseudonymisé, réel, production |
| Obtenir la gouvernance | Direction, responsable de traitement, juridique, DPO, clinique, scientifique, éthique | Finaliser DPA, résidence/transferts, DPIA/AIPD, base légale, protocole et avis ; valider le manifeste contre le SHA | Documents signés, empreintes et `governance:evidence:verify` vert | Pseudonymisé, réel, production |
| Établir l'exploitation | Direction + responsable exploitation | Affectations et suppléances, astreinte, support, formation, accès/MFA, acceptation runbooks et QA manuelle ; valider le manifeste | Références signées, procès-verbal QA et `operations:evidence:verify` vert | Pseudonymisé, réel, production |
| Promouvoir en production | Autorités de release, juridique, clinique, éthique et opérations | Seulement après tous les gates : release coordonnée avec run staging du même SHA, backup pré-release et plan de reprise exercé | Tous jobs verts, versions/hashes exacts, décisions archivées | Production |

## 8. Décision finale

- Décision : **production readiness not demonstrated**.
- Décision LOT 15 : **NO-GO** pour pilote pseudonymisé, données médicales
  réelles limitées et production complète.
- Périmètre autorisé : démonstration et QA avec données fictives uniquement.
- Nouvelle réévaluation : obligatoirement à chaque preuve
  backup/restauration, monitoring/incident, accès ou gouvernance, et à toute
  modification du candidat.

Mise à jour du 26 juillet 2026 : le staging exact demandé par la précédente
réévaluation a été réalisé, non pas sur `e63499a` mais sur le candidat
`ebee17910f6de005ab933ee08978d2e97686d19d`, qui lui est postérieur. B1, B3, B4,
B8 et B9 disposent désormais de preuves actuelles rattachées à ce seul SHA, pour
un staging fictif et sans aucun parcours de fichier.

Cela ne change pas la décision : **B2, B5, B6, B7 et B10 restent ouverts**, et
chacun suffit à lui seul à interdire la production, le pilote clinique et toute
donnée réelle ou pseudonymisée. La readiness production demeure **non
démontrée**.

La prochaine réévaluation ne peut conclure `ready for production` que si chaque
gate bloquant possède une preuve actuelle, directe, rattachée au même SHA, au
même environnement et à une décision humaine compétente lorsque nécessaire.

## 9. Sources examinées

- audit initial et global : `docs/audit-complet-2026-07-10.md`,
  `docs/audit-multiagents-2026-07-10.md` ;
- rapports staging : `docs/validation-staging-lot-13-2026-07-12.md`,
  `docs/validation-staging-lot-13-2026-07-13.md` ;
- restauration historique : `docs/validation-restauration-staging-2026-07-14.md` ;
- supervision, déploiement et continuité : `docs/supervision.md`,
  `docs/deploiement.md`, `docs/continuite.md` ;
- preuves nouvelles : historique des 11 commits techniques B1–B10, PR #34,
  runs `29950997481` et `29951322336`, résultats locaux ci-dessus, inventaire
  `supabase/security-definer-allowlist.json` et validateurs de preuve ;
- état live GitHub lu le 2026-07-22 ; versions Supabase/Vercel et monitor issues
  des dernières preuves directes des 18–19 juillet, explicitement marquées
  périmées lorsqu'elles ne portent pas sur le candidat ;
- interphase du 26 juillet 2026 : `docs/suivi-execution-feuille-route.md`
  (lot P0R), `docs/exercice-reprise-staging-2026-07-23.md` et
  `docs/exercice-reprise-staging-2026-07-26.md`,
  `docs/decision-rpo-rto-staging-2026-07-25.md`, runs `30195837590`,
  `30196032319`, `30196157372` et `30197149574`, et les trois releases
  immuables `continuity-staging-30196157372-1`,
  `recovery-evidence-staging-ebee17910f6d` et
  `readiness-evidence-staging-ebee17910f6d`.
