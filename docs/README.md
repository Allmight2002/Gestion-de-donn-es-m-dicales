# Index de la documentation MedData

> **Comment lire ce dossier.** Il contient deux natures de documents qu'il ne faut pas confondre :
>
> - 🟢 **Documents vivants** — ils décrivent le produit **tel qu'il est aujourd'hui** et sont mis
>   à jour avec le code.
> - 🗄️ **Preuves datées** — audits, validations de staging, décisions, exercices de reprise. Ils
>   conservent leurs constats **à leur date** et ne doivent **jamais** être lus comme une
>   description de l'état courant. La plupart portent déjà un bandeau « Archive datée ».
>
> En cas d'écart entre un document et le code, **le code et les migrations font foi**. L'état du
> schéma est **généré** dans [schema-etat-final.md](schema-etat-final.md) par `npm run schema` :
> il prévaut sur toute description manuelle.

**Vous arrivez sur le projet ?** → [guide-relecture-externe.md](guide-relecture-externe.md)
(parcours développeur et parcours sécurité, ~15 min chacun), puis
[architecture.md](architecture.md).

---

## 1. Comprendre le produit 🟢

| Document | Contenu |
|---|---|
| [architecture.md](architecture.md) | ⭐ **À lire en premier.** Modèle de données, rôles, cloisonnement RLS, cycle de curation, sous-systèmes serveur, carte du code |
| [cahier-des-charges-metier.md](cahier-des-charges-metier.md) | Spécification **fonctionnelle** : ce que le système doit faire et pourquoi (EF / RG) |
| [cahier-des-charges-technique.md](cahier-des-charges-technique.md) | Spécification **technique** : comment c'est réalisé (ET) |
| [schema-etat-final.md](schema-etat-final.md) | **Généré** (`npm run schema`) : tables, colonnes, policies RLS, triggers, fonctions |
| [checklist-fonctionnalites-site.md](checklist-fonctionnalites-site.md) | Inventaire exhaustif des fonctionnalités, écran par écran |

## 2. Sécurité 🟢

| Document | Contenu |
|---|---|
| [edge-functions.md](edge-functions.md) | Les 7 fonctions serveur : lecture signée auditée, inspection antivirus, export, comptes de mission |
| [security-definer.md](security-definer.md) | Inventaire normatif des 110 fonctions privilégiées + contrôle d'ACL |
| [upload-inspection-operations.md](upload-inspection-operations.md) | Exploitation de la chaîne d'inspection des fichiers déposés |
| [xlsx-security.md](xlsx-security.md) | Risques propres au traitement des tableurs |
| [securite-mode-hors-ligne.md](securite-mode-hors-ligne.md) | Ce que le mode hors-ligne autorise et interdit de stocker localement |
| [spec-comptes-mission.md](spec-comptes-mission.md) | Rôle `saisisseur` : besoin, alternatives écartées, invariants — **implémentée** |
| [derogations-readiness.md](derogations-readiness.md) | Contrôles de production **volontairement suspendus** et à quelle condition les rétablir |

## 3. Faire tourner le projet 🟢

| Document | Contenu |
|---|---|
| [tester-en-local.md](tester-en-local.md) | Lancer le produit bout-en-bout sur son poste (Supabase local + Docker) |
| [tests-multicomptes.md](tests-multicomptes.md) | Tester les flux **entre plusieurs comptes** + pièges de poste documentés |
| [configurer-supabase.md](configurer-supabase.md) | Créer un projet Supabase cloud (voie sans Docker) |
| [e2e-browser.md](e2e-browser.md) | Suite Playwright : authentification, cloisonnement des rôles, parcours bornés |
| [e2e-staging.md](e2e-staging.md) | Preflight clinique sur staging (Storage réel, Edge Functions réelles) |
| [reprise-import-historique.md](reprise-import-historique.md) | Reprendre un import ancien marqué `historical_unsafe` |

## 4. Déployer et exploiter 🟢

| Document | Contenu |
|---|---|
| [deploiement.md](deploiement.md) | Mettre le service en ligne (pilote à données fictives) + prérequis avant données réelles |
| [deploiement-on-premise.md](deploiement-on-premise.md) | Installer **tout le projet chez une institution** : serveur local + Supabase self-hosted + WiFi (sans prérequis réseau) |
| [pipeline-release-coordonnee.md](pipeline-release-coordonnee.md) | Le workflow de release coordonnée (manuel, `workflow_dispatch`) |
| [gouvernance-release.md](gouvernance-release.md) | Preuve de gouvernance exigée avant une release clinique |
| [operations-readiness.md](operations-readiness.md) | Preuve de responsabilités et d'exploitation (échoue fermé sans elle) |
| [controles-github.md](controles-github.md) | Protections GitHub réellement actives, vérifiées en lecture seule |
| [supervision.md](supervision.md) | Supervision et alertes d'exploitation |
| [continuite.md](continuite.md) | Sauvegarde, restauration, reprise |
| [qa-parcours-site.md](qa-parcours-site.md) · [instructions-agent-qa.md](instructions-agent-qa.md) | Plan de test du site déployé et cadrage de l'agent QA |
| [plan-test-preuves-2026-08-19.md](plan-test-preuves-2026-08-19.md) | Plan de test des lots livrés (L14, corbeille, D9/D12, L20-L25, L27-L33, L11) en attente de preuve de fonctionnement sur le site déployé |
| [redaction-diagnostic-sauvegarde.md](redaction-diagnostic-sauvegarde.md) | Expurger un diagnostic de sauvegarde avant de le journaliser |

## 5. État courant et readiness

| Document | Nature | Contenu |
|---|---|---|
| [etat-actuel-2026-08-01.md](etat-actuel-2026-08-01.md) | 🟢 **référence d'état** | Ce qui est vrai de l'environnement courant, du périmètre autorisé et des limites actives |
| [readiness-production-2026-07-19.md](readiness-production-2026-07-19.md) | 🗄️ | Audit de readiness niveau 4 (mis à jour le 2026-08-01) |
| [exception-audit-dependances-staging-2026-07-26.md](exception-audit-dependances-staging-2026-07-26.md) | 🗄️ | Exception React Router — **clôturée** |

> ⚠️ Le périmètre autorisé reste **données fictives uniquement**. La cible technique nommée
> `production` est un environnement persistant de tests internes : ni usage clinique, ni
> utilisateur tiers, ni donnée réelle. Voir [etat-actuel-2026-08-01.md](etat-actuel-2026-08-01.md).

## 6. Stratégie, feuille de route et chantiers 🟢

| Document | Contenu |
|---|---|
| [feuille-route-developpement-post-readiness.md](feuille-route-developpement-post-readiness.md) | Reprise du développement malgré les gates de production |
| [suivi-execution-feuille-route.md](suivi-execution-feuille-route.md) | Journal d'exécution de cette feuille de route |
| [lots-paralleles.md](lots-paralleles.md) | Découpage des chantiers en lots parallélisables |
| [prompts-lots.md](prompts-lots.md) · [prompt-execution-autonome-feuille-route.md](prompt-execution-autonome-feuille-route.md) | Prompts de travail prêts à l'emploi (outillage interne) |
| [chantiers-interactions-comptes.md](chantiers-interactions-comptes.md) | Problèmes ouverts sur les interactions entre comptes, options écartées comprises |
| [idees-post-readiness.md](idees-post-readiness.md) | File d'attente produit tenue à jour |
| [idees-fonctionnalites-futures.md](idees-fonctionnalites-futures.md) | Réserve d'idées UX — rien n'y est engagé |
| [spec-observabilite-erreurs.md](spec-observabilite-erreurs.md) | 🟢 **Implémentée** (L11, 2026-08-13) — journal d'incidents web borné et écran `SystemStatus` ; l'alerting sortant reste rattaché à B5 |
| [spec-variables-multivaluees.md](spec-variables-multivaluees.md) | 🟢 **Implémentée** (L20 à L25, 2026-08-18) — listes de diagnostics : saisie, export, cohortes, hors-ligne. Son **§12 seul** reste une cible non implémentée, close le 2026-08-19 |
| [brief-audit-prochain.md](brief-audit-prochain.md) | Cadrage du prochain audit |
| [strategie-produit-post-mvp.md](strategie-produit-post-mvp.md) · [-claude.md](strategie-produit-post-mvp-claude.md) · [-synthese.md](strategie-produit-post-mvp-synthese.md) | 🗄️ Études de marché datées (juillet) + synthèse d'arbitrage |

## 7. Preuves datées 🗄️

**Ne pas lire comme l'état courant.** Chacun de ces documents prouve un fait à une date donnée.

| Document | Date | Objet |
|---|---|---|
| [audits/audit-technique-complet-2026-08-09.md](audits/audit-technique-complet-2026-08-09.md) | 2026-08-09 | **Audit le plus récent** — ≈8,8/10, aucun constat critique ou élevé |
| [audits/audit-technique-complet-2026-07-26.md](audits/audit-technique-complet-2026-07-26.md) | 2026-07-26 | Audit précédent (référence de comparaison) |
| [audit-complet-2026-07-10.md](audit-complet-2026-07-10.md) | 2026-07-10 | Rapport d'audit consolidé |
| [audit-multiagents-2026-07-10.md](audit-multiagents-2026-07-10.md) | 2026-07-10 | Audit multi-agents |
| [validation-staging-lot-13-2026-07-12.md](validation-staging-lot-13-2026-07-12.md) · [-13.md](validation-staging-lot-13-2026-07-13.md) | 2026-07 | Validations de staging du lot 13 |
| [validation-restauration-staging-2026-07-14.md](validation-restauration-staging-2026-07-14.md) | 2026-07-14 | Validation de restauration |
| [exercice-reprise-staging-2026-07-23.md](exercice-reprise-staging-2026-07-23.md) · [-26.md](exercice-reprise-staging-2026-07-26.md) | 2026-07 | Exercices sauvegarde / restauration / reprise |
| [decision-rpo-rto-staging-2026-07-25.md](decision-rpo-rto-staging-2026-07-25.md) | 2026-07-25 | Décision de continuité (RPO/RTO) |
| [decision-environnement-production-tests-2026-07-29.md](decision-environnement-production-tests-2026-07-29.md) | 2026-07-29 | Décision sur l'environnement `production` persistant |
| [decision-pause-inspection-2026-08-12.md](decision-pause-inspection-2026-08-12.md) | 2026-08-12 | Décision de mise en pause du parcours antivirus (ClamAV non requis) |
| [decision-export-simple-2026-08-17.md](decision-export-simple-2026-08-17.md) | 2026-08-17 | Décision de simplification de l'export (statut non gating, complétude, écran par modèle d'observation) |

## 8. Cadre juridique

[juridique/](juridique/) — organisé **par pays**, avec son propre index
([juridique/README.md](juridique/README.md)). Volet **`tchad/`** actif (lancement visé) ;
`cameroun/` conservé pour plus tard.

> Ce volet suit un cycle propre, distinct de la documentation technique : il n'est pas mis à jour
> au rythme du code. Certaines de ses descriptions techniques peuvent donc être en retard sur
> l'état du produit.

## 9. Données d'exemple

`exemple-import-neurochirurgie.csv` et `.xlsx` — jeux **fictifs** pour essayer la fonction d'import.

---

## Documents hors `docs/`

| Fichier | Contenu |
|---|---|
| [../README.md](../README.md) | Mise en route, structure du dépôt, sécurité en bref |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Flux Git (`main`/`develop`), releases, spécificités du dépôt |
| [../CLAUDE.md](../CLAUDE.md) | Instructions permanentes pour les agents de développement |
| [../supabase/security-definer-allowlist.json](../supabase/security-definer-allowlist.json) | Inventaire normatif des fonctions privilégiées (source, pas doc) |

---

*Index vérifié le 19 août 2026. Pour rester juste, il doit être relu à chaque ajout de document
dans `docs/`.*
