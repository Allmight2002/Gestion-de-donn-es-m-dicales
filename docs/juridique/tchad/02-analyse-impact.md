# 02 — Analyse d'impact relative à la protection des données (AIPD)

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (référent protection des données, conseil juridique, avis du comité d'éthique) |
| Traitement évalué | Registre clinique MedData (fiches T1 à T7 du [registre des traitements](01-registre-traitements.md)) |
| Responsable du traitement | `[À COMPLÉTER]` |
| Rédaction / contributions | `[porteur scientifique]`, `[référent protection des données]`, `[référent technique]` |

**Pourquoi une AIPD.** Le traitement porte sur des **données de santé** (catégorie
sensible), **à grande échelle potentielle**, sur des **personnes vulnérables** (patients),
avec **transfert international** : il cumule les critères qui rendent une analyse
d'impact nécessaire et attendue par l'ANSICE et le CNBT. Méthode : trame en quatre
parties inspirée des standards internationaux (description / nécessité-proportionnalité
/ mesures / risques), adaptée au contexte tchadien.

---

## 1. Description du traitement

### 1.1 Vue d'ensemble

MedData est une application web (PWA) permettant à des médecins-chercheurs de constituer
des registres de patients structurés et pseudonymisés, alimentés par saisie directe,
import de fichiers ou curation de documents sources, et exploités via des cohortes et des
exports sans identité. Architecture détaillée : [architecture.md](../../architecture.md).

### 1.2 Cycle de vie de la donnée

| Étape | Description | Données concernées |
|---|---|---|
| Inclusion | Le médecin recueille le consentement, crée le patient : identité en zone restreinte, code pseudonyme généré | Identité + code |
| Saisie / import | Variables cliniques saisies par rencontre, ou importées (CSV/XLSX) avec validation serveur | Analytique |
| Curation (optionnelle) | Documents source **dé-identifiés** téléversés, analysés (antivirus), structurés par un curateur qui ne voit jamais l'identité, puis finalisés | Documents bruts → analytique |
| Consultation | Accès selon 5 permissions granulaires par base ; consultation d'identité et d'images journalisée | Toutes zones selon droits |
| Exploitation | Cohortes dynamiques puis **figées** ; export serveur pseudonymisé en liste blanche, hashé et tracé | Analytique uniquement |
| Correction | Modifications tracées champ par champ (ancienne/nouvelle valeur, auteur, motif) | Analytique |
| Fin de vie | Soft delete applicatif, purge/archivage selon la [politique de conservation (09)](09-conservation.md) | Toutes zones |

### 1.3 Supports et flux

- **Base de données, authentification, stockage de fichiers, fonctions serveur** :
  Supabase cloud, région `[eu-west-3 — Paris, à confirmer]` ; chiffrement en transit
  (TLS) et au repos.
- **Frontend** : build statique servi par Vercel ; les données patients transitent
  directement du navigateur vers Supabase (Vercel ne les stocke pas).
- **Analyse antivirale** : service ClamAV opéré sur `[À COMPLÉTER : hébergeur/VPS]`,
  appelé par les fonctions Edge pour tout fichier téléversé ; fichiers suspects mis en
  quarantaine (`quarantined-uploads`).
- **Postes clients** : navigateurs des professionnels habilités ; mode hors-ligne
  **désactivé** pour les données réelles ; purge du stockage local à la déconnexion.
- **E-mails** : uniquement de service (comptes) via `[fournisseur SMTP à compléter]` ;
  jamais de donnée patient.

### 1.4 Acteurs

Voir [00-cadre-applicable.md §2.3](00-cadre-applicable.md). Points saillants :
l'administrateur système n'a **aucun accès** aux données patients ; le curateur n'accède
qu'aux documents bruts des cas qu'il a réservés, jamais à l'identité ; chaque permission
est vérifiée **en base** (RLS), pas seulement à l'écran.

## 2. Nécessité et proportionnalité

| Principe | Analyse |
|---|---|
| Finalité déterminée et légitime | Recherche scientifique en santé, encadrée par clairance éthique du CNBT et autorisation ministérielle ; finalités documentées au registre (01) ; aucun usage commercial, publicitaire ou décisionnel individuel |
| Licéité | Consentement éclairé écrit (03/04) ; import rétrospectif suspendu à la décision du CNBT ; formalités de déclaration/autorisation du traitement et du transfert auprès de l'ANSICE |
| Minimisation | Le gabarit définit **limitativement** les variables collectées, typées et bornées ; la date de naissance ne quitte jamais la zone identité (seul l'**âge calculé** entre en zone analytique) ; les exports n'exposent qu'une liste blanche analytique ; le pool de curation n'expose que des métadonnées minimales |
| Exactitude | Validation de saisie (types, bornes, valeurs autorisées, règles de cohérence) ; statuts de complétude ; corrections tracées avec motif |
| Durées | Définies et justifiées en (09) ; pas de conservation indéfinie par défaut |
| Information et droits | Notice (03), consentement (04), procédure des droits (07) ; retrait de consentement organisé |
| Proportionnalité du transfert international | Hébergement UE choisi pour le niveau de garanties (RGPD, SOC 2, DPA) supérieur aux alternatives disponibles localement pour un pilote ; compensé par autorisation, consentement explicite et clauses contractuelles |

**Alternative écartée.** Un hébergement local (serveur d'établissement) réduirait le
transfert international mais dégraderait significativement la sécurité opérationnelle
(sauvegardes, disponibilité, correctifs, RLS gérée) pour un pilote sans équipe
d'exploitation dédiée. Cette option reste réévaluable à la montée en charge.

## 3. Mesures existantes et prévues

### 3.1 Mesures techniques (existantes dans le produit)

| Mesure | Effet |
|---|---|
| Cloisonnement en 3 zones appliqué par RLS en base | Un compte sans permission d'identité **ne peut pas** lire l'identité, quelle que soit l'UI |
| Absence de clé étrangère identité↔analytique ; lien limité à `(base_id, patient_code)` | Ré-identification impossible par simple jointure |
| Âge calculé côté serveur (`compute_age`, SECURITY DEFINER) | La date de naissance n'est jamais exposée hors zone identité |
| Liste blanche d'export serveur (`assert_export_columns_safe`) + export réservé aux cohortes figées, généré côté serveur, hashé, journalisé | Aucune identité/image exportable ; exports reproductibles et imputables |
| Écritures cliniques exclusivement par RPC contrôlées ; verrou optimiste ; idempotence des imports et des rejeux | Intégrité et non-répudiation des écritures |
| `audit_log` infalsifiable (consultation d'identité, images, accès, exports, suppressions…) + `field_change_log` | Imputabilité complète des actions sensibles |
| Jetons d'invitation à usage unique stockés en hash | Pas de jeton réutilisable en cas de fuite de la base |
| Inspection antivirale des téléversements (ClamAV), quarantaine, lecture par URL signée auditée (`signed-read`) | Maîtrise des fichiers entrants et des consultations |
| `service_role` jamais présent dans le frontend ; seules les clés publiques `VITE_*` sont dans le bundle | Pas de clé d'administration exposée côté client |
| Mode hors-ligne désactivé pour données réelles ; purge complète du stockage navigateur à la déconnexion | Pas de donnée clinique persistante sur les postes |
| Chiffrement TLS en transit ; chiffrement au repos par l'hébergeur | Confidentialité des flux et des supports |

### 3.2 Mesures organisationnelles (prévues par ce dossier)

Charte et engagement de confidentialité signés (11) ; procédure des droits (07) ;
procédure de violation (08) ; gouvernance des accès (le propriétaire délègue des
permissions minimales) ; formation des utilisateurs ; revue annuelle du dossier ;
comité de gouvernance du registre pour les usages secondaires (12).

### 3.3 Mesures exigées avant données réelles (non encore en place)

Reprises de [deploiement.md §8](../../deploiement.md) : MFA pour tous les comptes ;
Edge Functions déployées et vérifiées ; inspection stricte activée
(`require_server_inspection=true`) ; sauvegarde **restaurée et prouvée** (RPO/RTO
observés) ; monitoring/alerting avec destinataire et escalade ; scanner ClamAV supervisé ;
DPA signés ; formalités autorité. La [checklist (13)](13-checklist-donnees-reelles.md)
en fait la liste opposable.

## 4. Analyse des risques

Échelles : gravité et vraisemblance de 1 (négligeable) à 4 (maximal). Évaluation
**après** mesures existantes (§3.1) et **avec** le plan d'action (§5) appliqué.

| # | Scénario redouté | Sources de risque | G | V | Risque résiduel et justification |
|---|---|---|---|---|---|
| R1 | **Accès illégitime à l'identité** (consultation par un compte sans droit) | Erreur d'habilitation, compte compromis | 4 | 1 | Faible : RLS testée (contrôles positifs/négatifs), MFA, journalisation dissuasive, procédure de revue des accès |
| R2 | **Ré-identification à partir des données analytiques ou documents bruts** | Identifiants saisis en champ libre ; documents mal dé-identifiés ; croisement externe | 4 | 2 | **Modéré** : interdictions chartées + contrôle du soumetteur ; risque humain persistant → action A3 |
| R3 | **Fuite d'un export** (fichier pseudonymisé diffusé hors cadre) | Négligence du détenteur de `can_export_data` | 3 | 2 | Modéré : exports sans identité, tracés et hashés ; charte + engagement ; diffusion encadrée par protocole |
| R4 | **Lecture par l'opérateur d'infrastructure** (admin Supabase/AWS) | Accès privilégié de l'hébergeur ; réquisition étrangère | 3 | 1 | Faible-modéré : DPA, SOC 2, chiffrement au repos, région UE ; **limite documentée** (pas de chiffrement applicatif) → action A5 |
| R5 | **Compromission d'un compte professionnel** (hameçonnage, mot de passe faible) | Facteur humain | 4 | 2 | Modéré : MFA obligatoire, comptes nominatifs, rate limiting, sessions révocables, journalisation ; sensibilisation A4 |
| R6 | **Perte de données** (suppression accidentelle, panne, corruption) | Erreur humaine, incident hébergeur | 3 | 1 | Faible : soft delete, sauvegardes testées (exigence 13), verrou optimiste, PITR selon plan |
| R7 | **Altération non détectée de données de recherche** | Bug, action malveillante | 3 | 1 | Faible : écritures RPC-only, `field_change_log`, journaux infalsifiables, exports hashés |
| R8 | **Fuite via poste client** (session ouverte, cache, appareil partagé) | Postes non maîtrisés | 3 | 2 | Modéré : hors-ligne désactivé, purge à la déconnexion, verrouillage exigé par charte ; MDM recommandé si appareils mobiles → A6 |
| R9 | **Fichier malveillant téléversé** | Document piégé | 2 | 2 | Faible : ClamAV + quarantaine + inspection stricte exigée avant données réelles |
| R10 | **Transfert international non couvert** (défaut de formalité ANSICE) | Risque juridique | 3 | 2 | Traité par la voie de conformité : pas de donnée réelle avant formalité ANSICE + consentement + DPA (blocant dans la checklist 13) |
| R11 | **Violation non détectée ou non notifiée dans les délais** | Absence de monitoring | 3 | 2 | Modéré : procédure (08), monitoring exigé (13), registre des violations |
| R12 | **Curateur remontant à l'identité** | Contenu résiduel des documents | 3 | 1 | Faible : RLS (aucun accès identité), documents dé-identifiés à la source, engagement signé, accès refermé après finalisation |

**Risques jugés inacceptables sans action** : R2, R5, R8, R10, R11 → couverts par le plan
d'action ci-dessous ; la mise en production réelle est conditionnée à sa réalisation.

## 5. Plan d'action

| # | Action | Porteur | Échéance | Lien |
|---|---|---|---|---|
| A1 | Compléter et faire valider le dossier juridique (revue conseil, clairance CNBT, autorisation ministérielle, formalités ANSICE) | Porteur du projet | Avant toute donnée réelle | README §2 |
| A2 | Signer le DPA Supabase (plan Team recommandé), documenter la région de production et les engagements SMTP/ClamAV/Vercel | Porteur + conseil | Avant données réelles | (10) |
| A3 | Déployer les garde-fous anti-ré-identification : consigne de dé-identification des documents avant téléversement (procédure + case à cocher de responsabilité), interdiction chartée des identifiants en champ libre, revue périodique par échantillonnage | Référent PD + investigateurs | Avant données réelles, puis continu | (11) |
| A4 | Former chaque utilisateur (sécurité, charte, procédure incident) et recueillir les engagements signés | Référent PD | Avant ouverture des comptes réels | (11) |
| A5 | Étudier le chiffrement applicatif de la zone identité (clé hors hébergeur) — décision documentée à la montée en charge | Référent technique | Revue à `[6 mois]` après pilote | — |
| A6 | Encadrer les postes : verrouillage automatique, interdiction des postes partagés/publics ; MDM si usage mobile | Établissement | Avant données réelles | (06) |
| A7 | Exécuter et prouver les contrôles techniques de [deploiement.md §8](../../deploiement.md) (MFA, Edge, inspection stricte, sauvegarde restaurée, monitoring) | Référent technique | Avant données réelles | (13) |
| A8 | Mettre en place le registre des demandes de droits et le registre des violations | Référent PD | Avant données réelles | (07)(08) |
| A9 | Ajouter la traçabilité du consentement (référence du formulaire signé) en zone identité — migration additive `[consent_ref]` | Développement | Avant données réelles | (04) |
| A10 | Réviser l'AIPD après le pilote, à chaque évolution majeure, et au minimum annuellement | Référent PD | Continu | — |

## 6. Consultation et validation

| Partie | Rôle | Avis / date | Signature |
|---|---|---|---|
| Référent protection des données `[nom]` | Avis de conformité | `[À COMPLÉTER]` | |
| Porteur scientifique `[Dr Raymond Mbassi]` | Validation du plan d'action | | |
| Responsable du traitement `[établissement]` | Approbation et arbitrage des risques résiduels | | |
| Comité National de Bioéthique du Tchad (CNBT) | Avis (joint au dossier 12) | | |
| Représentants des personnes concernées | Modalité : `[avis d'association de patients / non recueilli — motiver]` | | |

**Conclusion (à confirmer à la validation).** Sous réserve de l'exécution complète du
plan d'action §5 et des validations §6, les risques résiduels sont jugés acceptables au
regard des finalités de recherche et des garanties mises en œuvre. Toute donnée réelle
reste interdite tant que la [checklist (13)](13-checklist-donnees-reelles.md) n'est pas
intégralement satisfaite.
