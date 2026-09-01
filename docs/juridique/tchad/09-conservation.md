# 09 — Politique de conservation et de fin de vie des données

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (CNBT pour les durées de recherche ; conseil juridique ; responsable du traitement) |
| Principe | Aucune conservation indéfinie par défaut ; chaque catégorie a une durée justifiée, un déclencheur et un sort final |

**Note de méthode.** La loi n° 007/PR/2015 pose le principe d'une conservation limitée
à la durée nécessaire aux finalités ; les durées chiffrées par catégorie relèvent de la
justification du responsable du traitement. Les durées ci-dessous s'appuient sur les
usages de la recherche clinique (conservation longue des données sources pour
vérifiabilité scientifique, généralement 10 à 15 ans) et doivent être **arrêtées
définitivement avec le CNBT et le conseil juridique**, puis reportées dans la notice
d'information (03).

---

## 1. Tableau des durées

| Catégorie | Contenu (tables/supports) | Durée active proposée | Déclencheur | Sort final |
|---|---|---|---|---|
| Zone identité | `patient_identity`, correspondance consentement↔code | Durée de participation + suivi | Clôture du registre ou retrait/effacement | **Suppression définitive** (ou suppression anticipée sur demande — voir 07) ; après quoi le dossier est définitivement non ré-identifiable |
| Images cliniques | `clinical_attachment` (Storage) | Identique à la zone identité | Idem | Suppression définitive des objets Storage |
| Zone analytique | `patient`, `encounter` | **`[15 ans]` après la dernière inclusion** du registre | Décision de clôture consignée | Suppression définitive **ou** anonymisation irréversible (après suppression de la zone identité et revue des champs libres) pour archive scientifique |
| Documents bruts | `raw_submission`, `raw_document` (Storage) | Jusqu'à finalisation de la curation + `[2 ans]` (vérifiabilité de la structuration) | Finalisation (`completed`) | Suppression définitive (les données structurées subsistent en zone analytique) |
| Fichiers en quarantaine | Bucket `quarantined-uploads` | `[90 jours]` après verdict | Verdict + réconciliation | Suppression définitive |
| Exports scientifiques | `export_log` + fichiers hashés | Durée du registre (reproductibilité des analyses publiées) | Clôture du registre | Suppression ; le journal (métadonnées, hash) est conservé comme trace |
| Journal d'audit | `audit_log` | **`[5 ans]` glissants**, et au minimum jusqu'à clôture de tout incident/contentieux ouvert | Écoulement | Purge périodique documentée `[procédure technique à créer — aucune purge automatique n'existe aujourd'hui]` |
| Journal des corrections | `field_change_log` | Durée de la donnée corrigée (fait partie de la traçabilité scientifique) | Suit la zone analytique | Supprimé avec elle |
| Comptes professionnels | `profiles`, `base_access`, invitations | Durée d'activité + **`[3 ans]`** après désactivation | Désactivation du compte | Suppression ; les actions passées restent dans `audit_log` (imputabilité) |
| Invitations | `base_invitation` (hash de jeton) | Expiration du jeton + `[1 an]` | Expiration/consommation | Suppression |
| Journaux techniques hébergeurs | Logs Supabase/Vercel (IP, requêtes) | Rétention par défaut des plateformes `[à documenter : consulter les politiques Supabase/Vercel]` | — | Géré par les sous-traitants (DPA) |
| Sauvegardes | Sauvegardes Supabase | **`[7–30 jours]` glissants selon le plan** `[à documenter]` | Expiration automatique | Écrasement/expiration ; une donnée supprimée disparaît des sauvegardes à l'issue de la rétention |
| Consentements papier | Originaux signés + registre des consentements | Durée du registre + **`[5 ans]`** (preuve de licéité) | Clôture | Destruction confidentielle (broyage) consignée |
| Registres de conformité | Registre des traitements, des demandes de droits, des violations | Permanent pendant l'activité + `[5 ans]` après clôture | Clôture | Archivage par le responsable du traitement |
| Données du pilote fictif | Comptes `*@demo.test`, patients de `seed.sql` | Jusqu'à la mise en production réelle | GO données réelles | **Purge complète obligatoire avant toute donnée réelle** (checklist 13) |

## 2. Règles de mise en œuvre

1. **Suppression applicative en deux temps.** La suppression dans l'application est un
   *soft delete* (récupérable, tracé), suivi d'une **purge définitive** sous
   `[90 jours]` `[procédure de purge périodique à formaliser côté exploitation ;
   vérifier l'outillage existant avant de fixer le délai]`. Les demandes d'effacement
   au titre des droits (07) suivent ce même circuit, avec confirmation écrite après
   purge.
2. **Sauvegardes.** On ne modifie pas une sauvegarde : une donnée supprimée disparaît
   des sauvegardes par expiration naturelle de leur rétention. En cas de restauration
   d'une sauvegarde contenant des données supprimées entre-temps, rejouer les
   suppressions (utiliser le registre des demandes et `audit_log`).
3. **Clôture d'un registre.** Décision écrite de l'investigateur principal et du
   responsable du traitement, notifiée au comité d'éthique (rapport final). Ordre des
   opérations : gel des accès (retrait des permissions d'écriture) → suppression de la
   zone identité → décision archive anonymisée vs suppression totale → exécution
   documentée → mise à jour du registre des traitements.
4. **Anonymisation.** N'est réputée anonyme qu'une donnée **non ré-identifiable par
   aucun moyen raisonnable** : suppression de la zone identité **et** revue des champs
   libres/documents (aucun identifiant résiduel), et appréciation du risque de
   ré-identification par croisement (petites cohortes, combinaisons rares :
   date + âge + commune peuvent suffire à identifier). En cas de doute : traiter comme
   pseudonymisé (= données personnelles).
5. **Traçabilité des destructions.** Toute purge (base, Storage, papier) fait l'objet
   d'un procès-verbal simple : date, périmètre, opérateur, méthode — classé avec les
   registres de conformité.
6. **Revue annuelle.** Le référent PD vérifie chaque année l'application effective des
   durées (échantillonnage) et ajuste la présente politique.

## 3. Information des personnes

Les durées retenues figurent dans la [notice (03)](03-notice-information.md) §7 et la
[politique de confidentialité (05)](05-politique-confidentialite.md) §5 ; toute
modification substantielle est répercutée dans ces documents et, si nécessaire, soumise
au comité d'éthique en amendement.
