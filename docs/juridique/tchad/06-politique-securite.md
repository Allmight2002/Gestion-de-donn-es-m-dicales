# 06 — Politique de sécurité du système d'information (PSSI MedData)

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (responsable du traitement, référent technique) |
| Périmètre | Plateforme MedData : Supabase (base, auth, storage, Edge Functions), frontend Vercel, scanner ClamAV, postes des utilisateurs, dépôt de code |
| Références | Loi n° 007/PR/2015 (sécurité des données) ; lois n° 008/PR/2015 et n° 009/PR/2015 (transactions électroniques, cybersécurité) ; [architecture.md](../../architecture.md) ; [deploiement.md](../../deploiement.md) ; [securite-mode-hors-ligne.md](../../securite-mode-hors-ligne.md) |

La présente politique fixe les règles de sécurité **opposables** à toute personne
intervenant sur MedData. Elle décrit d'abord ce que le produit **garantit
techniquement** (§3–§8), puis ce que l'organisation **doit garantir** autour du produit
(§9–§15). Les règles marquées **[EXIGÉ AVANT DONNÉES RÉELLES]** sont bloquantes et
reprises dans la [checklist (13)](13-checklist-donnees-reelles.md).

---

## 1. Gouvernance et responsabilités

| Rôle | Titulaire | Responsabilités sécurité |
|---|---|---|
| Responsable du traitement | `[établissement]` | Arbitrages, moyens, validation de la PSSI et des dérogations |
| Référent protection des données | `[nom]` | Conformité, registres (droits, violations), sensibilisation |
| Référent technique / exploitation | `[nom]` | Application de la PSSI, secrets, déploiements, supervision, sauvegardes |
| Investigateur principal (par registre) | `[nom]` | Gouvernance des accès de sa base, qualité de la dé-identification des documents |
| Utilisateurs (médecins, curateurs, admin) | Tous | Respect de la [charte (11)](11-charte-utilisateurs.md), signalement des incidents |

Cumul de rôles accepté pendant le pilote, à documenter. La séparation entre
`system_admin` (aucune donnée patient) et les rôles cliniques est **structurelle** et ne
souffre aucune exception.

## 2. Classification des données

| Niveau | Contenu | Règles principales |
|---|---|---|
| **C3 — Identité** | `patient_identity`, `clinical_attachment` | Accès `can_view_identity` uniquement ; jamais exporté ; consultation journalisée |
| **C2 — Santé pseudonymisée** | `patient`, `encounter`, documents bruts, exports | Accès par permissions de base ; export en liste blanche uniquement |
| **C1 — Interne** | Comptes, journaux, gabarits, configuration | Accès selon rôle ; pas de diffusion externe |
| **C0 — Public** | Code source (dépôt), documentation générique | Aucune donnée C1–C3 ne doit y figurer |

Règle de contamination : un support contenant plusieurs niveaux est traité au niveau le
plus élevé. Les données C2 restent des données personnelles : toute demande de
« ré-identification » passe exclusivement par le médecin autorisé via la zone identité.

## 3. Contrôle d'accès (garanti par le produit)

- **Tout refus par défaut** : RLS active sur toutes les tables ; une table sans
  politique ne renvoie rien.
- **Trois rôles globaux** (`system_admin`, `medecin`, `curateur`) ; nul ne modifie son
  propre rôle ; promotion curateur par l'administrateur uniquement.
- **Cinq permissions granulaires par base** (`can_view_identity`,
  `can_view_raw_documents`, `can_edit_structured_data`, `can_export_data`,
  `can_manage_access`), vérifiées **en base** par fonctions SECURITY DEFINER.
- **Invitations** par jeton à usage unique, stocké **hashé**, montré une seule fois.
- **Curation** : accès aux documents limité au curateur affecté et seulement pendant
  `in_progress`/`clarification_requested` ; jamais d'accès identité.
- Organisationnel : le propriétaire n'accorde que les permissions **minimales
  nécessaires** ; revue des accès de chaque base tous les `[6 mois]` **[EXIGÉ AVANT
  DONNÉES RÉELLES : première revue consignée]**.

## 4. Authentification et comptes

- Comptes **nominatifs** exclusivement ; comptes de démonstration (`*@demo.test`)
  interdits en production réelle et jamais mélangés à des comptes réels.
- Mot de passe : longueur ≥ `[12]`, politique Supabase renforcée, rate limiting activé.
- **MFA obligatoire pour tous les comptes** (à activer côté Supabase Auth et vérifier
  compte par compte) **[EXIGÉ AVANT DONNÉES RÉELLES]**.
- Cycle de vie : création par l'administrateur (pas d'auto-inscription) ; désactivation
  le jour du départ d'un utilisateur ; revue semestrielle des comptes dormants.
- SMTP de production configuré et testé (réinitialisation de mot de passe) **[EXIGÉ
  AVANT DONNÉES RÉELLES]**.
- Accès au **tableau de bord Supabase** et à Vercel : restreints au référent technique
  et au responsable désigné, MFA activée, comptes personnels (pas de compte partagé),
  liste tenue à jour **[EXIGÉ AVANT DONNÉES RÉELLES]**.

## 5. Sécurité applicative (garantie par le produit)

- Écritures cliniques **exclusivement via RPC** contrôlées (pas d'écriture directe de
  table depuis le client) ; validation serveur des types, bornes, valeurs autorisées et
  règles de cohérence.
- **Verrou optimiste** sur les modifications concurrentes ; imports **idempotents**
  (reprise sans doublons) ; rejeux hors-ligne à accusé idempotent.
- **Âge calculé côté serveur** ; la date de naissance ne quitte jamais la zone identité.
- **Exports** : cohortes figées uniquement, génération côté serveur
  (`generate-export`), liste blanche analytique (`assert_export_columns_safe`),
  empreinte `file_hash`, journal `export_log`.
- La clé `service_role` n'est **jamais** dans le frontend ; contrôle à chaque build
  (recherche dans `dist/`).

## 6. Fichiers téléversés

- Buckets **privés** avec politiques RLS (`supabase/storage.sql`).
- **Inspection antivirale** de tout téléversement (ClamAV) avec quarantaine
  (`quarantined-uploads`) et réconciliation (`reconcile-quarantine`).
- Mode strict `require_server_inspection=true` (DB + secrets Edge + frontend
  `VITE_REQUIRE_SERVER_INSPECTION`) **[EXIGÉ AVANT DONNÉES RÉELLES]**, avec test réel
  fichier sain + EICAR consigné.
- Lectures de fichiers via **URL signées auditées** (`signed-read`,
  `VITE_USE_SIGNED_READ=true`) **[EXIGÉ AVANT DONNÉES RÉELLES]**.
- Scanner ClamAV : hébergement pérenne, jeton `CLAMAV_SCAN_TOKEN` fort, signatures à
  jour, supervision `/health` **[EXIGÉ AVANT DONNÉES RÉELLES]**.
- Dé-identification des documents **avant** téléversement : responsabilité du médecin
  soumetteur (charte 11) ; contrôle par échantillonnage trimestriel `[référent PD]`.

## 7. Journalisation et surveillance

- `audit_log` **infalsifiable** : consultation d'identité, vue/téléchargement de
  fichiers, changements d'accès, invitations, figements, exports, suppressions,
  publications de gabarits.
- `field_change_log` : toute correction avec ancienne/nouvelle valeur, auteur, motif.
- Monitoring et alerting applicatif/Edge/DB avec **destinataire nommé** et procédure
  d'escalade **[EXIGÉ AVANT DONNÉES RÉELLES]**.
- Revue mensuelle des journaux sensibles (échantillon consultations d'identité +
  exports) par l'investigateur principal ; anomalies → [procédure (08)](08-violations-donnees.md).

## 8. Mode hors-ligne et postes de travail

- **Mode hors-ligne désactivé pour toute donnée réelle** (Option A de
  [securite-mode-hors-ligne.md](../../securite-mode-hors-ligne.md)) ; les variables
  `VITE_OFFLINE_MODE=demo` sont interdites en production réelle. Toute exception future
  exige : chiffrement + TTL strict + revue référent PD + MDM, et mise à jour de l'AIPD.
- Purge complète des stockages navigateur à la déconnexion/expiration/changement de
  compte (garantie produit ; ne pas ignorer les erreurs de purge affichées).
- Postes : session verrouillée en cas d'absence (verrouillage automatique ≤ `[5 min]`),
  **interdiction des postes publics/partagés** (cybercafés), navigateur à jour, pas
  d'extension non maîtrisée sur le profil utilisé pour MedData.
- Appareils mobiles/portables utilisés pour MedData : chiffrement disque activé,
  code de verrouillage, effacement à distance si géré (MDM recommandé — AIPD action A6).
- Capture d'écran des zones identité : interdite (charte 11).

## 9. Sauvegardes et continuité

- Sauvegardes automatiques Supabase selon le plan souscrit `[documenter : fréquence,
  rétention, PITR]`.
- **Un test de restauration complet, daté, en environnement isolé, avec RPO/RTO
  observés et contrôle d'intégrité** — une mention « backups activés » ne suffit pas
  **[EXIGÉ AVANT DONNÉES RÉELLES]**.
- Procédure de rollback applicatif écrite (frontend + migrations) ; releases
  coordonnées via le pipeline dédié ([pipeline-release-coordonnee.md](../../pipeline-release-coordonnee.md)).
- Objectifs proposés : RPO ≤ `[24 h]`, RTO ≤ `[72 h]` `[à valider]`.

## 10. Gestion des secrets

- Secrets (clé `service_role`, `CLAMAV_SCAN_TOKEN`, secrets Edge, SMTP) : stockés
  uniquement dans les coffres des plateformes (Supabase secrets, variables Vercel,
  GitHub Actions secrets) ; jamais en clair dans le dépôt, les tickets ou les échanges.
- Rotation : à chaque départ d'une personne y ayant eu accès, à chaque suspicion de
  fuite, et au minimum tous les `[12 mois]`.
- Le dépôt GitHub ne contient **aucune donnée patient** (données de seed fictives
  uniquement) ; règle de revue : refuser tout commit contenant des données C1–C3.

## 11. Développement et déploiement

- Migrations **additives uniquement**, jamais de modification d'une migration
  appliquée (règle CLAUDE.md) ; vérification `npm run db:verify` avant poussée.
- CI verte exigée avant fusion (typecheck, lint, tests web + RLS — les tests RLS
  incluent des contrôles positifs et négatifs par table).
- Protections de branche GitHub et gates de déploiement Vercel actives **[EXIGÉ AVANT
  DONNÉES RÉELLES]**.
- Environnement de staging distinct (projet Supabase séparé) pour les validations ;
  aucune donnée réelle en staging, jamais.
- Revue des dépendances : images Docker épinglées par digest ; `npm audit` mensuel.

## 12. Sous-traitants

Exigences contractuelles, garanties et suivi : voir
[10-sous-traitants-transferts.md](10-sous-traitants-transferts.md). DPA Supabase signé
et région de production confirmée **[EXIGÉ AVANT DONNÉES RÉELLES]**.

## 13. Incidents

Tout événement de sécurité (suspicion comprise) suit la
[procédure de violation (08)](08-violations-donnees.md) : signalement immédiat à
`[contact incident]`, endiguement, qualification, notification légale le cas échéant,
registre, retour d'expérience.

## 14. Sensibilisation

Chaque utilisateur reçoit avant son premier accès : la charte (11) + engagement signé,
une session de prise en main sécurité (`[30–60 min]` : permissions, dé-identification,
signalement), et un rappel annuel. Émargement conservé par le référent PD.

## 15. Dérogations et révision

Toute dérogation à la présente politique est écrite, motivée, limitée dans le temps,
approuvée par le responsable du traitement après avis du référent PD, et consignée dans
le tableau ci-dessous. La PSSI est revue annuellement et après tout incident majeur.

| Date | Dérogation | Motif | Échéance | Approbation |
|---|---|---|---|---|
| — | — | — | — | — |
