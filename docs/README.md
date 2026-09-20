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
>
> **Point de départ au 16 septembre 2026 :**
> [etat-actuel-2026-09-16.md](etat-actuel-2026-09-16.md) sépare explicitement l'état du checkout,
> les validations locales consignées et ce qui reste à prouver sur navigateur ou cible. Il remplace
> comme référence vivante l'ancien relevé du 1er août, conservé en archive.

**Vous arrivez sur le projet ?** → [guide-relecture-externe.md](guide-relecture-externe.md)
(parcours développeur et parcours sécurité, ~15 min chacun), puis
[architecture.md](architecture.md).

**Vous voulez plutôt essayer le produit déployé** (sans lire le code) ? →
[guide-decouverte-produit.md](guide-decouverte-produit.md).

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
| [edge-functions.md](edge-functions.md) | Les 8 fonctions serveur : lecture signée auditée, inspection antivirus, export (profils `analysis`/`complete`), comptes de mission et purge D10 |
| [security-definer.md](security-definer.md) | Inventaire normatif des 132 signatures `authenticated` privilégiées (12 `service_role` séparées) + contrôle d'ACL |
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
| [operations-readiness.md](operations-readiness.md) | Preuve de responsabilités et d'exploitation (échec fermé hors dérogation pilote documentée) |
| [controles-github.md](controles-github.md) | Protections GitHub réellement actives, vérifiées en lecture seule |
| [supervision.md](supervision.md) | Supervision et alertes d'exploitation |
| [continuite.md](continuite.md) | Sauvegarde, restauration, reprise |
| [qa-parcours-site.md](qa-parcours-site.md) · [instructions-agent-qa.md](instructions-agent-qa.md) | Plan de test du site déployé et cadrage de l'agent QA |
| [plan-test-preuves-2026-08-19.md](plan-test-preuves-2026-08-19.md) | Plan de test des lots livrés (L14, corbeille, D9/D12, L20-L25, L27-L33, L11) en attente de preuve de fonctionnement sur le site déployé |
| [guide-test-collecte-diagnostique.md](guide-test-collecte-diagnostique.md) | 🟢 Guide de test manuel des lots **L51 à L56** (blocs cliniques, visibilité de bloc, projection d'export, configuration diagnostique et suivi des cas non couverts) — preuve navigateur encore à produire |
| [guide-test-groupes-repetables.md](guide-test-groupes-repetables.md) | 🟢 Guide de test manuel des lots **L66 à L71** (déclaration d’un bloc répétable, saisie en tableau, occurrences tamponnées à la création, applicabilité et complétude, export, hors-ligne) — preuve navigateur encore à produire |
| [redaction-diagnostic-sauvegarde.md](redaction-diagnostic-sauvegarde.md) | Expurger un diagnostic de sauvegarde avant de le journaliser |

## 5. État courant et readiness

| Document | Nature | Contenu |
|---|---|---|
| [etat-actuel-2026-09-16.md](etat-actuel-2026-09-16.md) | 🟢 **référence d'état de source** | État du checkout, limites de preuve et renvois vers les validations locales ou de cible |
| [etat-actuel-2026-08-01.md](etat-actuel-2026-08-01.md) | 🗄️ | Relevé historique du 1er août, remplacé comme référence vivante |
| [readiness-production-2026-07-19.md](readiness-production-2026-07-19.md) | 🗄️ | Audit de readiness niveau 4 (mis à jour le 2026-08-01) |
| [exception-audit-dependances-staging-2026-07-26.md](exception-audit-dependances-staging-2026-07-26.md) | 🗄️ | Exception React Router — **clôturée** |

> ⚠️ Le périmètre autorisé reste **données fictives uniquement**. La cible technique nommée
> `production` est un environnement persistant de tests internes : ni usage clinique, ni
> utilisateur tiers, ni donnée réelle. Voir [etat-actuel-2026-09-16.md](etat-actuel-2026-09-16.md).

## 6. Stratégie, feuille de route et chantiers 🟢

| Document | Contenu |
|---|---|
| [feuille-route-developpement-post-readiness.md](feuille-route-developpement-post-readiness.md) | Reprise du développement malgré les gates de production |
| [feuille-route-offline-saisie.md](feuille-route-offline-saisie.md) | **O0–O5 implémentés localement le 2026-08-23** : création patient/rencontre *intake-only* et synchronisation idempotente ; preuve navigateur O6 et activation O7 encore ouvertes |
| [suivi-execution-feuille-route.md](suivi-execution-feuille-route.md) | Journal d'exécution de cette feuille de route |
| [lots-paralleles.md](lots-paralleles.md) | Découpage des chantiers en lots parallélisables |
| [prompts-lots.md](prompts-lots.md) · [prompt-execution-autonome-feuille-route.md](prompt-execution-autonome-feuille-route.md) | Prompts de travail prêts à l'emploi (outillage interne) |
| [l61-liste-patients-recherche-tri-identite.md](l61-liste-patients-recherche-tri-identite.md) | **Plan révisé par le code le 2026-09-13** — socle colonnes/recherche code/tri technique et recherche nominative contrôlée sont présents localement ; le tri clinique et la preuve navigateur/cible restent distincts |
| [chantiers-interactions-comptes.md](chantiers-interactions-comptes.md) | Problèmes ouverts sur les interactions entre comptes, options écartées comprises |
| [chantiers-export-analyse.md](chantiers-export-analyse.md) | 🟢 **L45 à L49 livrés** (2026-08-28, choix du profil dans l'interface le 2026-09-01) — export directement exploitable dans Excel, R, SPSS ou Stata ; **L50** différé |
| [idees-post-readiness.md](idees-post-readiness.md) | File d'attente produit tenue à jour |
| [idees-fonctionnalites-futures.md](idees-fonctionnalites-futures.md) | Réserve d'idées UX — rien n'y est engagé |
| [spec-experience-utilisateur.md](spec-experience-utilisateur.md) · [suivi-correctifs-ux.md](suivi-correctifs-ux.md) | **Spécification + état d'implémentation** — UX-0 à UX-16 : le premier document conserve les contrats et critères ; le second recense les livraisons/validations locales, notamment brouillons de travail, recherche nominative contrôlée, éditeur et rubriques communes, sans les confondre avec une preuve déployée |
| [design/editeur-registre/](design/editeur-registre/) | 🗄️ Maquette et transmission archivées de l'éditeur ; consulter le suivi UX et le checkout pour l'état courant |
| [spec-evolution-formulaire.md](spec-evolution-formulaire.md) | **Contrat E0 documenté le 2026-09-16 ; E1/E2 implémentés localement et non déployés** — états de préparation, révision/empreinte, compatibilité et provenance, application atomique, classification additive/sémantique, règle d’isolation A/B, erreurs structurées, dispense propriétaire bornée et purge par code |
| [lots-evolution-formulaire.md](lots-evolution-formulaire.md) | **E0 documenté le 2026-09-16 ; E1/E2 contrôlés localement, E3 à E7 à réaliser** — contrats, préparations, application atomique, dossiers compatibles, éditeur, complétion, exports/historique et validation ; justification propriétaire sans élargissement des droits, accès identité et suppression de base séparés ; dépendances, critères, suivi et prompt de reprise |
| [spec-formulaire-papier.md](spec-formulaire-papier.md) | **Spécifiée le 2026-09-14, non implémentée** — formulaire vierge A4, placement compact par blocs/sections/sous-sections et type de variable, profils de densité, pagination et réglages papier |
| [lots-formulaire-papier.md](lots-formulaire-papier.md) | **PAP-0 mesuré le 2026-09-18 ; PAP-1 à PAP-5 à réaliser** — mesure de baseline, modèle de placement, prévisualisation/PDF, persistance éventuelle, réglages éditeur et validation étudiante ; PAP-5 conditionnel aux groupes répétables |
| [pap-0-baseline-formulaire-papier.md](pap-0-baseline-formulaire-papier.md) | 🗄️ **Baseline mesurée le 2026-09-18** — 32 pages et 76 % des variables pour les trois cas fictifs imprimés depuis l'aperçu, coût du contenu séparé de celui de la mise en page, seuils de réduction, de lisibilité et d'exhaustivité pour PAP-1 à PAP-4 ; relevés bruts dans [pap-0-baseline-releves.json](pap-0-baseline-releves.json) |
| [spec-observabilite-erreurs.md](spec-observabilite-erreurs.md) | 🟢 **Implémentée** (L11, 2026-08-13) — journal d'incidents web borné et écran `SystemStatus` ; l'alerting sortant reste rattaché à B5 |
| [spec-variables-multivaluees.md](spec-variables-multivaluees.md) | 🟢 **Implémentée** (L20 à L25, 2026-08-18) — listes de diagnostics : saisie, export, cohortes, hors-ligne. Son **§12 seul** reste une cible non implémentée, close le 2026-08-19 |
| [spec-blocs-pathologies.md](spec-blocs-pathologies.md) | 📋 **Revue le 2026-09-05, partiellement implémentée** — **L51** ([l51-contains-any.md](l51-contains-any.md)), **L54**, **L52** et **L53** ([l53-projection-export.md](l53-projection-export.md)) implémentés et non déployés — blocs cliniques conditionnels dans une base de même gouvernance, tronc commun pour les variables partagées, sections à deux niveaux et projection d’export sûre pour les formules |
| [spec-collecte-diagnostique.md](spec-collecte-diagnostique.md) | 📋 **Partiellement implémentée, revue le 2026-09-05** — **L55** ([l55-configuration-diagnostique.md](l55-configuration-diagnostique.md)) et **L56** ([l56-parcours-et-suivi.md](l56-parcours-et-suivi.md)) implémentés et non déployés : diagnostic pilote versionné et couverture, puis socle enregistrable sans bloc et file des cas non couverts réservée au médecin propriétaire. La preuve navigateur de L56 manque encore ; reprise/notifications en cadrage différé L57 |
| [l56-feuille-de-route.md](l56-feuille-de-route.md) | Support de réalisation et preuves locales de L56 ; ne vaut pas preuve navigateur ou cible |
| [spec-blocs-reutilisables.md](spec-blocs-reutilisables.md) | **L58, L59 et L60 implémentés localement, non déployés** — import serveur d'un bloc par copie, catalogue/aperçu et reconnexion sûre de la règle d'activation ; contrôles locaux détaillés dans la fiche |
| [spec-groupes-repetables.md](spec-groupes-repetables.md) | 📋 **Spécifiée le 2026-09-12, non implémentée** — **L66** à **L71** : plusieurs occurrences portant chacune leurs propres attributs (interventions, lésions, hématomes), projetées sur `encounter` et discriminées par le bloc (`group_section_key`) plutôt que par le type de rencontre ; socle serveur, éditeur, saisie en tableau dans la fiche, export et hors-ligne |
| [l72-groupe-repetable-sous-section.md](l72-groupe-repetable-sous-section.md) | 📋 **Cadré le 2026-09-20, non implémenté** — **L72** : un groupe répétable déclaré **sous** un bloc de diagnostic, pour hériter de son rang et de sa visibilité ; inventaire des trois ruptures silencieuses (résolution des variables, validation de la règle du bloc, agrégation d’export), sémantique du retrait, découpage L72a→e et contournement disponible sans le lot |
| [brief-audit-prochain.md](brief-audit-prochain.md) | Cadrage du prochain audit |
| [strategie-produit-post-mvp.md](strategie-produit-post-mvp.md) · [-claude.md](strategie-produit-post-mvp-claude.md) · [-synthese.md](strategie-produit-post-mvp-synthese.md) | 🗄️ Études de marché datées (juillet) + synthèse d'arbitrage |

## 7. Preuves datées 🗄️

**Ne pas lire comme l'état courant.** Chacun de ces documents prouve un fait à une date donnée.

| Document | Date | Objet |
|---|---|---|
| [audits/audit-technique-complet-2026-08-18.md](audits/audit-technique-complet-2026-08-18.md) | 2026-08-18 | **Audit le plus récent** — 8,8/10 ; 1 constat critique (P0, antivirus `paused` en production) et 1 élevé (P1, brouillons cliniques en clair) ; correctifs découpés en lots L38-L44 dans [`lots-paralleles.md`](lots-paralleles.md) |
| [audits/audit-technique-complet-2026-08-09.md](audits/audit-technique-complet-2026-08-09.md) | 2026-08-09 | Audit précédent — ≈8,8/10, aucun constat critique ou élevé à cette date |
| [audits/audit-technique-complet-2026-07-26.md](audits/audit-technique-complet-2026-07-26.md) | 2026-07-26 | Audit antérieur (référence de comparaison) |
| [audit-complet-2026-07-10.md](audit-complet-2026-07-10.md) | 2026-07-10 | Rapport d'audit consolidé |
| [audit-multiagents-2026-07-10.md](audit-multiagents-2026-07-10.md) | 2026-07-10 | Audit multi-agents |
| [validation-staging-lot-13-2026-07-12.md](validation-staging-lot-13-2026-07-12.md) · [-13.md](validation-staging-lot-13-2026-07-13.md) | 2026-07 | Validations de staging du lot 13 |
| [validation-restauration-staging-2026-07-14.md](validation-restauration-staging-2026-07-14.md) | 2026-07-14 | Validation de restauration |
| [exercice-reprise-staging-2026-07-23.md](exercice-reprise-staging-2026-07-23.md) · [-26.md](exercice-reprise-staging-2026-07-26.md) | 2026-07 | Exercices sauvegarde / restauration / reprise |
| [decision-rpo-rto-staging-2026-07-25.md](decision-rpo-rto-staging-2026-07-25.md) | 2026-07-25 | Décision de continuité (RPO/RTO) |
| [decision-environnement-production-tests-2026-07-29.md](decision-environnement-production-tests-2026-07-29.md) | 2026-07-29 | Décision sur l'environnement `production` persistant |
| [decision-pause-inspection-2026-08-12.md](decision-pause-inspection-2026-08-12.md) | 2026-08-12 | Décision de mise en pause du parcours antivirus (ClamAV non requis) |
| [decision-export-simple-2026-08-17.md](decision-export-simple-2026-08-17.md) | 2026-08-17 | Décision de simplification de l'export (statut non gating, complétude, écran par modèle d'observation) |
| [decision-blocs-pathologies-2026-09-03.md](decision-blocs-pathologies-2026-09-03.md) | 2026-09-03, amendée le 2026-09-05 | Parcours de décision issu d'un problème observé sur le terrain : base bornée par la gouvernance, blocs cliniques conditionnels, options écartées, dix décisions retenues et critères de réévaluation — non implémentée |
| [decision-recherche-patient-2026-08-20.md](decision-recherche-patient-2026-08-20.md) | 2026-08-20 | Décision datée sur la recherche patient dans une base ; consulter [L61 à L65](l61-liste-patients-recherche-tri-identite.md) pour l'état courant et le prolongement tri clinique/nom contrôlé |
| [decision-notifications-v1-2026-08-20.md](decision-notifications-v1-2026-08-20.md) | 2026-08-20 | Décision sur le périmètre v1 des notifications in-app (clarification de curation seulement, médecin + curateur, in-app, table dédiée) — non implémentée |

## 8. Cadre juridique

[juridique/](juridique/) — organisé **par pays**, avec son propre index
([juridique/README.md](juridique/README.md)). Volet **`tchad/`** actif (lancement visé) ;
`cameroun/` conservé pour plus tard.

> Ce volet suit un cycle propre, distinct de la documentation technique : il n'est pas mis à jour
> au rythme du code. Certaines de ses descriptions techniques peuvent donc être en retard sur
> l'état du produit.

## 9. Données d'exemple

Aucun fichier d'exemple d'import n'est actuellement suivi dans le checkout. Préparer un CSV/XLSX
**entièrement fictif**, préfixé `QA-`, à partir des exemples inline de
[checklist-fonctionnalites-site.md](checklist-fonctionnalites-site.md) avant un essai d'import.

---

## Documents hors `docs/`

| Fichier | Contenu |
|---|---|
| [../README.md](../README.md) | Mise en route, structure du dépôt, sécurité en bref |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Flux Git (`main`/`develop`), releases, spécificités du dépôt |
| [../CLAUDE.md](../CLAUDE.md) | Instructions permanentes pour les agents de développement |
| [../supabase/security-definer-allowlist.json](../supabase/security-definer-allowlist.json) | Inventaire normatif des fonctions privilégiées (source, pas doc) |

---

*Index vérifié le 16 septembre 2026. Pour rester juste, il doit être relu à chaque ajout de
document dans `docs/`.*
