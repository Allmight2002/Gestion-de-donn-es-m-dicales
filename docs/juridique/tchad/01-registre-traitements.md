# 01 — Registre des activités de traitement

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (conseil juridique, puis tenue à jour permanente) |
| Responsable du traitement | `[À COMPLÉTER : établissement / Dr Raymond Mbassi]`, `[adresse]`, `[contact]` |
| Référent protection des données | `[À COMPLÉTER : nom, qualité, email, téléphone]` |
| Représentant légal | `[À COMPLÉTER]` |

Ce registre documente les traitements de données à caractère personnel opérés via la
plateforme MedData, conformément aux obligations de documentation de la loi n° 007/PR/2015
et de son décret d'application n° 075/PR/2019.
Il est mis à jour à chaque évolution (nouvelle finalité, nouvelle catégorie de données,
nouveau sous-traitant, changement de durée) et présenté à l'ANSICE sur demande.

**Convention.** Les mesures de sécurité communes à tous les traitements sont décrites
dans la [PSSI (06)](06-politique-securite.md) ; chaque fiche n'en cite que les éléments
saillants. Les durées renvoient à la [politique de conservation (09)](09-conservation.md).

---

## Fiche T1 — Tenue du registre clinique (collecte, saisie, curation, consultation)

| Rubrique | Contenu |
|---|---|
| Finalité principale | Constitution et exploitation de registres de patients à des fins de **recherche scientifique en santé** : description de cohortes, études observationnelles, production de statistiques |
| Finalités secondaires | Suivi de la qualité et de la complétude des données (statuts `draft`/`complete`/`curated`) ; traçabilité scientifique des corrections |
| Base de licéité | Consentement éclairé écrit de la personne (loi n° 007/PR/2015 ; Déclaration d'Helsinki 2024, CIOMS 2016) ; recherche autorisée par clairance éthique du CNBT + autorisation du ministère en charge de la santé publique. Import rétrospectif : selon décision du CNBT (consentement ou dispense motivée) |
| Personnes concernées | Patients inclus dans un registre (majeurs et, le cas échéant, mineurs via représentant légal selon le protocole approuvé) |
| Catégories de données — zone identité | Nom, prénom(s), date de naissance exacte, téléphone, adresse, images cliniques (`patient_identity`, `clinical_attachment`) |
| Catégories de données — zone analytique | Code patient pseudonyme, âge calculé, sexe, variables cliniques définies par les gabarits versionnés (`patient`, `encounter`), historique des corrections (`field_change_log`) |
| Catégories de données — documents bruts | Documents source **dé-identifiés** téléversés pour structuration (`raw_submission`, `raw_document`) |
| Destinataires internes | Médecins habilités sur la base concernée (selon les 5 permissions granulaires) ; curateurs affectés (documents bruts uniquement, jamais l'identité) ; aucun accès patient pour l'administrateur système |
| Destinataires externes | Aucun. Les données ne sont ni cédées, ni vendues, ni transmises à des tiers |
| Sous-traitants | Supabase (hébergement, cf. fiche T7 et [10](10-sous-traitants-transferts.md)) ; hébergeur du scanner antiviral pour les fichiers téléversés |
| Transfert hors du Tchad | Oui — hébergement en Union européenne (France, région `eu-west-3`). Garanties : formalité de transfert accomplie auprès de l'ANSICE, consentement explicite, DPA, chiffrement en transit et au repos |
| Durée de conservation | Durée de vie du registre approuvée par le comité d'éthique, puis archivage/purge — voir (09). Repère proposé : 15 ans après la dernière inclusion `[À VALIDER]` |
| Mesures de sécurité saillantes | Cloisonnement RLS en 3 zones ; lien identité↔analytique limité à `(base_id, patient_code)` sans clé étrangère ; date de naissance jamais exposée hors zone identité (âge calculé côté serveur) ; écritures via RPC contrôlées ; journalisation d'audit infalsifiable |

## Fiche T2 — Exports scientifiques pseudonymisés

| Rubrique | Contenu |
|---|---|
| Finalité | Extraction de jeux de données **pseudonymisés** pour analyse statistique (cohortes figées uniquement) |
| Base de licéité | Identique à T1 (l'export est une modalité d'exploitation du registre) |
| Personnes concernées | Patients membres de la cohorte figée exportée |
| Données | Variables analytiques en **liste blanche serveur** (`assert_export_columns_safe()`); âge et non date de naissance ; **jamais** de nom, coordonnées, images ni documents bruts |
| Destinataires | Utilisateur titulaire de la permission `can_export_data` sur la base ; diffusion ultérieure encadrée par le protocole approuvé et la charte (11) |
| Transfert | Le fichier est généré côté serveur (`generate-export`), conservé avec empreinte (`file_hash`) et tracé dans `export_log` |
| Durée | Fichiers d'export conservés à des fins de reproductibilité — voir (09) |
| Mesures saillantes | Refus serveur de tout champ identifiant ; export réservé aux cohortes figées ; journalisation systématique (auteur, date, contenu, hash) |

## Fiche T3 — Gestion des comptes et des habilitations

| Rubrique | Contenu |
|---|---|
| Finalité | Création et gestion des comptes professionnels, attribution des rôles (`system_admin`, `medecin`, `curateur`) et des permissions par base ; invitations de partage |
| Base de licéité | Exécution de la relation d'habilitation avec le professionnel (nécessité de gestion des accès) ; obligation de sécurité |
| Personnes concernées | Professionnels utilisateurs (médecins, curateurs, administrateurs) |
| Données | Nom d'affichage, adresse e-mail professionnelle, rôle global, permissions par base, horodatages de connexion (Supabase Auth), hash des jetons d'invitation |
| Destinataires | Administrateur système (gestion) ; propriétaire de base (accès qu'il délègue) |
| Transfert | Hébergement UE identique à T1 |
| Durée | Compte actif + `[3 ans]` après désactivation (traçabilité), voir (09) |
| Mesures saillantes | Comptes nominatifs ; mot de passe fort ; MFA (exigée avant données réelles) ; nul ne modifie son propre rôle ; jeton d'invitation à usage unique stocké en hash |

## Fiche T4 — Journalisation de sécurité et d'audit

| Rubrique | Contenu |
|---|---|
| Finalité | Imputabilité des actions sensibles : consultation d'identité, visualisation/téléchargement d'images et documents, changements d'accès, invitations, figement de cohorte, exports, suppressions, publications de gabarits |
| Base de licéité | Obligation légale de sécurité (loi n° 007/PR/2015 ; loi n° 009/PR/2015) et intérêt légitime de traçabilité scientifique |
| Personnes concernées | Utilisateurs professionnels (auteurs des actions) ; indirectement les patients (objet des actions) |
| Données | `audit_log` (acteur, action, cible, horodatage), `field_change_log` (ancienne/nouvelle valeur, motif), `export_log` |
| Destinataires | Propriétaire de la base et référent protection des données (investigations) ; autorité sur demande légale |
| Durée | `[5 ans]` glissants minimum, voir (09) |
| Mesures saillantes | Journaux non modifiables par les utilisateurs (« logs infalsifiables », migration `092400`) ; consultation elle-même tracée |

## Fiche T5 — Sauvegardes et continuité d'activité

| Rubrique | Contenu |
|---|---|
| Finalité | Restauration en cas d'incident ; prévention de la perte de données de recherche |
| Base de licéité | Obligation de sécurité et d'intégrité |
| Données | Copies de l'ensemble des zones (identité incluse) au sein de l'infrastructure Supabase |
| Destinataires | Aucun accès en usage courant ; restauration par l'exploitant sous contrôle du responsable du traitement |
| Transfert | Même région d'hébergement que la production `[À CONFIRMER : les sauvegardes Supabase restent dans la région du projet]` |
| Durée | Rétention des sauvegardes selon le plan Supabase souscrit `[7–30 jours, à documenter]` ; un test de restauration doit être **prouvé** avant données réelles ([deploiement.md §8](../../deploiement.md)) |
| Mesures saillantes | Chiffrement au repos ; restauration testée en environnement isolé ; procédure de rollback écrite |

## Fiche T6 — Import de données existantes (reprise d'historique)

| Rubrique | Contenu |
|---|---|
| Finalité | Reprise de dossiers/registres antérieurs (CSV/XLSX) dans un registre MedData |
| Base de licéité | **Suspendue à la décision du comité d'éthique** : consentement des personnes ou dispense motivée pour données rétrospectives ; à défaut, pas d'import de données réelles |
| Personnes concernées | Patients des dossiers repris |
| Données | Identité + variables analytiques selon le mappage validé ; validation serveur (`import_records`), avertissements de doublons, idempotence inter-lots |
| Destinataires / transfert / durée | Identiques à T1 |
| Mesures saillantes | Validation serveur des lots ; journalisation ; le fichier source est détruit après intégration contrôlée `[procédure à formaliser]` |

## Fiche T7 — Traitements techniques induits (plateforme)

| Rubrique | Contenu |
|---|---|
| Finalité | Fonctionnement technique : authentification (jetons), e-mails de service (confirmation, réinitialisation), journaux techniques d'hébergement, analyse antivirale des fichiers téléversés (ClamAV, quarantaine) |
| Base de licéité | Nécessité technique au service demandé ; obligation de sécurité |
| Personnes concernées | Utilisateurs professionnels ; patients (fichiers analysés) |
| Données | Jetons de session ; e-mail ; adresses IP et journaux techniques (Supabase, Vercel) ; contenu des fichiers en transit d'inspection |
| Sous-traitants | Supabase, Vercel, fournisseur SMTP `[À COMPLÉTER]`, hébergeur ClamAV `[À COMPLÉTER]` |
| Durée | Journaux techniques : rétention des plateformes (documenter) ; quarantaine : purge après verdict et réconciliation |
| Mesures saillantes | Bucket privés + RLS Storage ; lecture par URL signée auditée (`signed-read`) ; inspection stricte activable et exigée avant données réelles |

---

## Annexe — Traitements exclus ou hors périmètre

- **Prospection, publicité, profilage** : non pratiqués, aucune donnée n'est utilisée à
  ces fins.
- **Décision individuelle automatisée** : aucune — MedData n'automatise aucune décision
  de soin ni d'inclusion ; les statuts de validation sont des états documentaires.
- **Mode hors-ligne** : désactivé pour toute donnée réelle
  ([securite-mode-hors-ligne.md](../../securite-mode-hors-ligne.md)). Une réactivation
  créerait un traitement local sur appareil à inscrire ici au préalable.

## Historique des mises à jour du registre

| Date | Version | Modification | Auteur |
|---|---|---|---|
| 2026-07-14 | 1.0 | Création (7 fiches) | `[À COMPLÉTER]` |
