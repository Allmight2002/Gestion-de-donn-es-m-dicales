# Audit final de readiness production — MedData

- Dernière mise à jour : **2026-07-22 — Africa/Douala**
- Niveau appliqué : **4 — Production readiness**
- Décision technique unique : **production readiness not demonstrated**
- Correspondance LOT 15 : **NO-GO**
- Niveau maximal démontré : **données fictives uniquement, dans un environnement local ou non-production isolé et réinitialisable**

Ce rapport distingue le fonctionnement logiciel de l'aptitude à un usage
clinique. Il ne constitue ni une autorisation juridique, clinique ou éthique, ni
une acceptation de risque par l'organisation. Aucune note globale ne remplace
les conditions bloquantes.

## 1. Identité du candidat et état déployé

| Élément | État vérifié |
|---|---|
| Branche de correction | `codex/b1-b10-remediation` |
| Commit candidat technique | `5239804fd5107b01dff290e9498f8d81ee14398a` |
| Base de comparaison | `121a866ef95ea4134b402c71c9f0bb4d4f869df1` (`origin/main`, merge-base exact au 2026-07-22) |
| Écart candidat/base | 11 commits techniques avant le présent commit documentaire |
| État Git contrôlé | seuls le présent rapport et quatre documents utilisateur non suivis étaient hors commit ; les documents utilisateur ont été exclus |
| GitHub live | dépôt privé, branche par défaut `develop`; aucun PR ouvert avant publication du lot |
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
| `d328cad` | B3 | Sauvegarde quotidienne coordonnée DB/Storage, chiffrée, HMAC, vérifiée et conservée | Workflow non activé/exécuté ; PITR, offsite et immutabilité externes |
| `997e48c` | B4/B8 | Validateur strict de preuve de restauration, RPO/RTO, rollback et forward recovery | Aucun exercice actuel effectué |
| `b855cb3` | B5 | Alertes opérationnelles allowlistées, expurgées et testables ; échec du monitor préservé | Destination, astreinte et accusé de réception réels absents |
| `e121008` | B6 | Production bloquée sans gouvernance signée, actuelle et liée au SHA | Avis, DPA, DPIA/AIPD et autorités non fournis |
| `0dd5966` | B7 | Vérification GitHub live fail-closed : checks, reviews, admins, branches et environnements | Le contrôle live échoue réellement en 403 ; MFA/revue nominative externes |
| `9167b91` | B8 | Production bloquée sans preuve d'exercice de reprise du SHA exact | Exercice staging isolé non effectué |
| `d2d8088` | B9 | Inventaire exact des 85 signatures `SECURITY DEFINER`, justification, ACL/search_path testés et contrôle distant de drift | Contrôle distant du candidat non exécuté |
| `818e178` | B10 | Production bloquée sans titulaires/suppléants, astreinte, support, MFA, runbooks et QA clinique/scientifique | Affectations, simulation et procès-verbal QA externes absents |
| `d5ee798` | B1/B7 | Gate `actionlint` global rendu propre | Ne résout pas la cohérence des composants déployés |
| `5239804` | B1 | Deux dépendances transitives élevées mises à jour | CI Node 22 distante encore à exécuter sur le commit fusionné |

Les corrections utilisent `apply-audit-lot`; les changements PostgreSQL, ACL,
restauration et continuité ont été traités avec `meddata-db-safety`. Aucune
migration historique n'a été modifiée et aucune migration distante, Edge
Function ou configuration cloud n'a été appliquée.

## 3. Résultats actuels et reproductibles

| Contrôle | Résultat au 2026-07-22 | Portée |
|---|---|---|
| Tests ciblés B2–B10 | **réussis** | Scanner, backup, reprise, alerting, gouvernance, GitHub, ACL et opérations |
| `npm run typecheck` | **réussi** | TypeScript strict |
| `npm run lint` | **réussi, 0 warning** | Dépôt complet |
| `npm run test:web` | **36 fichiers, 169/169** | Frontend et domaine web |
| `npm run test:rls` | **52 fichiers, 461/461** | PostgreSQL réel embarqué, RLS/RPC/transactions |
| `npm test` | **88 fichiers, 630/630** | Suite globale exacte |
| `npm run db:verify` | **réussi** | 105 migrations depuis zéro ; 36 tables, 208 fonctions, 59 policies, 55 triggers |
| `npm run release:edge:check` | **réussi** | Inventaire statique des 6 Edge Functions |
| Edge fmt/lint/check/test | **réussi, 70/70** | Deno frozen et contrats Edge |
| `actionlint` épinglé | **réussi** | Tous les workflows GitHub |
| `npm audit --audit-level=moderate` | **0 vulnérabilité** | Source npm disponible ; `brace-expansion` 5.0.7 et `fast-uri` 3.1.4 |
| `npm run build` | **réussi** | Vite 8.1.4, 1 925 modules, offline désactivé, inspection stricte |
| Image scanner | **construite** | Base Node 22 épinglée ; smoke `/health` = 503 attendu sans `clamd` |

Limite de reproductibilité : les commandes Node locales ont utilisé Node
24.16.0 alors que le projet cible Node 22.x. L'image scanner a bien utilisé Node
22. La CI distante Node 22 doit donc réussir après publication avant que le merge
soit considéré techniquement validé.

## 4. Matrice unique de readiness

États autorisés : **prouvé conforme**, **prouvé non conforme**, **partiellement
prouvé**, **non vérifié**, **preuve périmée**, **vérification externe requise**.

| Gate | État | Preuve | Date | Environnement | Commit/version | Risque | Bloquant | Responsable | Action suivante |
|---|---|---|---|---|---|---|---|---|---|
| Release et versions | prouvé non conforme | Le candidat `5239804` n'est déployé nulle part ; la dernière production connue mélange frontend `e6982ce`, 86 migrations, 5 Edge et strict `false` | 2026-07-22 | Vercel/Supabase | candidat `5239804`; production historique incohérente | Critique : composants incompatibles | Oui | Release manager | Produire un staging exact après fermeture des gates, puis une promotion coordonnée unique |
| Sécurité | partiellement prouvé | ACL locales : 0 `SECURITY DEFINER` pour `anon`, 85 signatures authentifiées inventoriées, search_path bornés ; production distante non alignée | 2026-07-22 | Local + production historique | 105 migrations locales | Critique tant que production n'est pas alignée | Oui | RSSI + responsable DB | Exécuter `db:function-acl:verify` sur staging exact, advisors et tests d'accès interdits |
| Intégrité scientifique | partiellement prouvé | Tests locaux d'export/import et historiques verts ; dernier staging scientifique porte sur un ancien SHA | 2026-07-22 | Local ; staging périmé | `5239804`; ancien `6774c18` | Résultat non revalidé sur artefact candidat | Oui pour clinique | QA scientifique | Rejouer jeux de référence et faire signer l'interprétation scientifique |
| Données | partiellement prouvé | 630 tests globaux et 105 migrations sans perte/altération observée ; aucune continuité cloud actuelle | 2026-07-22 | Local | `5239804` | Perte possible si backup cloud absent | Oui | Responsable données | Staging exact puis sauvegarde et restauration représentatives |
| Concurrence | partiellement prouvé | Conflits, retries, idempotence, atomicité et verrous passent sur PostgreSQL embarqué | 2026-07-22 | Local | `5239804` | Drift/performance cloud non exclus | Oui pour production | Responsable PostgreSQL | Rejouer la matrice concurrente sur staging exact |
| Migrations, RLS, RPC et Storage | partiellement prouvé | 105 migrations depuis zéro, 461 tests DB, inventaire ACL exact ; cible distante du candidat non vérifiée | 2026-07-22 | Local | dernière `20260714215335` | Migration/policy non prouvée dans la cible | Oui | Responsable Supabase | Backup, `db push` staging autorisé, Storage, ACL, drift et tests de refus |
| Fichiers | prouvé non conforme | Scanner et Edge locaux fail-closed ; aucun ClamAV durable distant ni fraîcheur de signatures live | 2026-07-22 | Local/cloud | image locale candidate | Fichier non inspecté ou service indisponible | Oui | Infrastructure + RSSI | Héberger, superviser, puis tester sain/EICAR/panne/capacité sur staging |
| Hors-ligne | prouvé conforme | Release standard et build candidat imposent `disabled/false` | 2026-07-22 | Local/CI statique | `5239804` | Faible tant que désactivé | Non si maintenu désactivé | RSSI + release manager | Conserver désactivé pour toute donnée pseudonymisée ou réelle |
| Tests | prouvé conforme | 169 web, 461 DB, 630 globaux, 70 Edge, build et workflows verts | 2026-07-22 | Local | `5239804` | Node local 24 ; QA humaine/charge non couvertes | Non local ; oui clinique | QA | Exiger CI Node 22, E2E staging et QA manuelle signée |
| Edge Functions | partiellement prouvé | 6 fonctions attendues et 70 tests locaux ; version distante candidate non déployée/testée | 2026-07-22 | Local ; cloud non vérifié | `5239804` | Fonction critique absente ou ancienne en production | Oui | Responsable Edge | Déployer uniquement sur staging, vérifier hashes et E2E avant promotion |
| CI/CD | prouvé non conforme | Workflows locaux valides ; API live confirme protections indisponibles et environnements sans règles | 2026-07-22 | GitHub | plan/configuration live | Bypass de review ou de promotion | Oui | Administrateur GitHub + RSSI | Plan compatible ou contrôle équivalent approuvé ; branches/checks/reviewers/MFA |
| Staging | preuve périmée | Dernier staging exact `6774c18`; 11 commits techniques supplémentaires | 2026-07-22 | Staging | ancien `6774c18` | Artefact candidat non validé | Oui | Release manager | Nouvelle release staging sur le SHA fusionné, E2E et monitors verts |
| Sauvegardes | prouvé non conforme | Workflow et vérificateurs locaux présents ; aucune exécution actuelle, PITR ou copie objets live prouvée | 2026-07-22 | Local/cloud | `5239804` | Perte de données | Oui | Continuité + infrastructure | Activer, exécuter, vérifier historique, rétention, offsite/immutabilité et alertes |
| Restauration | prouvé non conforme | Validateur strict présent ; aucun exercice du backup candidat ni RPO/RTO approuvé | 2026-07-22 | Local seulement | `5239804` | Reprise non garantie | Oui | Continuité + exploitation | Exercice isolé fictif, preuve JSON exacte et approbation RPO/RTO |
| Monitoring | prouvé non conforme | Alerting local expurgé ; aucune destination/astreinte live ni série de probes vertes | 2026-07-22 | Local/cloud | `5239804` | Incident silencieux | Oui | Exploitation | Configurer destination, tester panne et accusé de réception, mesurer escalade |
| Accès | prouvé non conforme | RLS local vert ; GitHub live sans protections ; MFA et revue nominative non prouvées | 2026-07-22 | Local/GitHub | état live | Accès privilégié non maîtrisé | Oui | RSSI + propriétaires de services | Revue nominative, MFA, moindre privilège et exports de configuration datés |
| Rollback et forward recovery | prouvé non conforme | Production exige désormais une preuve exacte, mais aucun exercice n'existe pour le candidat | 2026-07-22 | Local/staging requis | `5239804` | Reprise improvisée/corruption | Oui | Release manager + continuité | Exercer frontend, Edge, Storage et migration corrective/restauration |
| Conformité | vérification externe requise | Gate signé présent ; dossiers Cameroun/Tchad restent des projets, sans DPA/DPIA/AIPD/avis éthique prouvés | 2026-07-22 | Organisation | documents projet | Usage médical non autorisé | Oui | Responsable de traitement + juridique + DPO + éthique | Archiver décisions signées et générer le manifeste de gouvernance |
| Incident médical | vérification externe requise | Gate opérationnel exige annuaire, autorité, astreinte et simulation ; aucune preuve réelle fournie | 2026-07-22 | Organisation | `5239804` | Notification/prise en charge tardive | Oui | Direction + DPO + RSSI | Nommer titulaires/suppléants, simuler et faire accepter la procédure |
| Exploitation | vérification externe requise | Gate B10 exige RACI, support, formation, MFA, runbooks et QA ; secret de preuve absent | 2026-07-22 | Organisation | `5239804` | Service dépendant d'une personne/non soutenable | Oui | Direction + responsable exploitation | Produire les affectations et preuves puis valider le manifeste opérationnel |

## 5. Blocages B1 à B10 après correction

| ID | État après correction | Bloquant production | Condition de fermeture |
|---|---|---|---|
| B1 | Correctifs locaux réalisés, état distant toujours incohérent | Oui, critique | Même SHA approuvé pour frontend, DB, Storage et 6 Edge après staging exact |
| B2 | Durcissement local réalisé, service distant absent | Oui, critique | ClamAV durable, strict, signatures/capacité et monitors prouvés |
| B3 | Automatisation prête, aucune sauvegarde cloud prouvée | Oui, critique | Historique DB/Storage, PITR selon RPO, offsite/immutabilité et alertes |
| B4 | Validateur prêt, restauration non exercée | Oui, critique | Exercice exact réussi et RPO/RTO approuvés |
| B5 | Alerting prêt, supervision opérationnelle absente | Oui, critique | Probes durables, alerte reçue, astreinte et incident exercé |
| B6 | Gate fail-closed prêt, autorisations absentes | Oui, critique | Documents et décisions signés des autorités compétentes |
| B7 | Gate live prêt et échoue comme attendu | Oui, élevé | Protections/reviewers ou contrôle compensatoire formel, MFA et moindre privilège |
| B8 | Gate de preuve prêt, exercice absent | Oui, élevé | Rollback/forward recovery staging chronométré et intègre |
| B9 | **Conforme localement** | Oui tant que staging non revalidé | Contrôle distant exact, tests RLS/RPC et acceptation sécurité sur le candidat |
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
- Nouvelle réévaluation : après le merge et la CI Node 22, puis obligatoirement
  après un staging exact ; ensuite à chaque preuve backup/restauration,
  monitoring/incident, accès ou gouvernance, ou à toute modification du candidat.

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
- preuves nouvelles : historique des 11 commits B1–B10, résultats locaux ci-dessus,
  inventaire `supabase/security-definer-allowlist.json` et validateurs de preuve ;
- état live GitHub lu le 2026-07-22 ; versions Supabase/Vercel et monitor issues
  des dernières preuves directes des 18–19 juillet, explicitement marquées
  périmées lorsqu'elles ne portent pas sur le candidat.
