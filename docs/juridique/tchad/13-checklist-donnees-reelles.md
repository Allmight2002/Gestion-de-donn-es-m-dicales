# 13 — Checklist GO/NO-GO avant toute donnée réelle

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | Document opérationnel — décision finale du responsable du traitement |
| Règle | **Tant qu'une seule case n'est pas cochée avec preuve datée : données entièrement fictives uniquement.** La décision GO est écrite, signée et archivée avec toutes les preuves. |

Chaque ligne exige : ☐ fait — **preuve datée** (document, capture, référence) —
responsable nommé. Les preuves sont archivées dans `docs/juridique/preuves/` (hors
dépôt public) ou le coffre documentaire de l'établissement.

---

## A. Volet juridique (données personnelles)

| ✔ | Exigence | Preuve attendue | Resp. | Date |
|---|---|---|---|---|
| ☐ | Dossier juridique (docs 00 à 11) complété (plus aucun `[À COMPLÉTER]`) et **validé par un conseil juridique tchadien** (régimes et articles vérifiés sur les textes officiels de la loi n° 007/PR/2015 et du décret n° 075/PR/2019) | Avis écrit du conseil | | |
| ☐ | Responsable du traitement désigné (décision D1) et référent protection des données nommé (D2) | Décision écrite / lettre de mission | | |
| ☐ | Registre des traitements (01) approuvé et daté | Version signée | | |
| ☐ | AIPD (02) validée, plan d'action A1–A9 soldé | AIPD signée + suivi d'actions | | |
| ☐ | Formalités **ANSICE** accomplies : déclaration/autorisation du traitement **et** formalité de transfert international, décisions/récépissés datés obtenus (l'ANSICE statue sous un mois — décret n° 075/PR/2019) | Récépissés / autorisations | | |
| ☐ | DPA Supabase signé ; plan adapté souscrit ; région de production confirmée et documentée | Contrat + capture des réglages projet | | |
| ☐ | Engagements des autres sous-traitants archivés (Vercel, SMTP, hébergeur ClamAV) | Contrats/CGV + tableau (10) à jour | | |
| ☐ | Politique de confidentialité (05) publiée sur la plateforme | URL + capture | | |

## B. Volet éthique (recherche)

| ✔ | Exigence | Preuve attendue | Resp. | Date |
|---|---|---|---|---|
| ☐ | Protocole finalisé (12 §3) avec dictionnaire des variables (gabarit versionné publié) | Protocole versionné | | |
| ☐ | **Clairance éthique** obtenue du **CNBT** | Original de l'avis (référence reportée dans 03/04) | | |
| ☐ | **Autorisation de recherche** du ministère en charge de la santé publique obtenue | Original de l'autorisation | | |
| ☐ | Accord(s) écrits des structures sanitaires d'accueil | Lettres d'accord | | |
| ☐ | Notice (03) et consentement (04) imprimés dans leur version approuvée par le comité ; circuit de recueil organisé (qui informe, où sont stockés les originaux, registre des consentements prêt) | Documents versionnés + classeur en place | | |
| ☐ | Le cas échéant : décision du comité sur le volet rétrospectif (consentement/dispense) — **sinon, aucun import de données réelles** | Avis mentionnant le volet | | |

## C. Volet technique (reprend [deploiement.md §8](../../deploiement.md) — preuves datées exigées)

| ✔ | Exigence | Preuve attendue | Resp. | Date |
|---|---|---|---|---|
| ☐ | Migrations et `supabase/storage.sql` appliqués sur le projet de production ; état vérifié (`npm run db:verify`, drift check) | Sorties de commandes datées | | |
| ☐ | Edge Functions déployées depuis le commit attendu et vérifiées (`signed-read`, `inspect-upload`, `finalize-upload`, `cleanup-upload`, `generate-export`, `reconcile-quarantine`) | `npm run release:edge:check` + inventaire | | |
| ☐ | Inspection stricte active de bout en bout : secret Edge `REQUIRE_SERVER_INSPECTION=true`, `app_security_setting.require_server_inspection=true`, frontend `VITE_REQUIRE_SERVER_INSPECTION=true` + `VITE_USE_SIGNED_READ=true` | `npm run env:check:cloud` | | |
| ☐ | Scanner ClamAV pérenne, joignable, supervisé (`/health`, signatures à jour), jeton fort configuré | Supervision + test daté | | |
| ☐ | Test réel : fichier sain accepté, fichier EICAR mis en quarantaine avec lecture refusée | Compte rendu du test | | |
| ☐ | **MFA activée et vérifiée pour tous les comptes** (app + dashboards Supabase/Vercel/GitHub) | Liste des comptes vérifiés | | |
| ☐ | SMTP de production opérationnel (réinitialisation de mot de passe testée) | Test daté | | |
| ☐ | Monitoring/alerting applicatif, Edge et DB avec destinataire nommé et procédure d'escalade | Config + test d'alerte | | |
| ☐ | **Restauration de sauvegarde réellement exécutée** en environnement isolé : date, RPO/RTO observés, contrôle d'intégrité | Procès-verbal de restauration | | |
| ☐ | `npm run e2e:staging` réussi contre la cible ; smoke test de mise en ligne (deploiement.md §7) rejoué | Sorties datées | | |
| ☐ | Protections de branche GitHub + gates de déploiement Vercel actives | Captures de configuration | | |
| ☐ | Mode hors-ligne désactivé en production (`VITE_OFFLINE_MODE` absent/inerte) | Vérification de build | | |
| ☐ | Rotation des secrets effectuée avant ouverture (aucun secret de la phase démo réutilisé) | Journal de rotation | | |
| ☐ | **Purge complète des données de démonstration** : comptes `*@demo.test`, patients fictifs, bases de test — la production réelle démarre vide | Vérification en base datée | | |

## D. Volet organisationnel

| ✔ | Exigence | Preuve attendue | Resp. | Date |
|---|---|---|---|---|
| ☐ | PSSI (06) validée ; revue des accès initiale consignée | PSSI signée + PV de revue | | |
| ☐ | Charte (11) signée par **tous** les titulaires de compte + engagements individuels archivés | Originaux signés | | |
| ☐ | Session de sensibilisation réalisée pour chaque utilisateur (émargement) | Feuilles d'émargement | | |
| ☐ | Procédure des droits (07) opérationnelle : canaux ouverts, registre des demandes créé | Registre initialisé | | |
| ☐ | Procédure de violation (08) opérationnelle : contact incident nommé, registre créé, **exercice simulé réalisé** | PV d'exercice | | |
| ☐ | Politique de conservation (09) : durées arrêtées, procédure de purge périodique définie | Version validée | | |
| ☐ | Comité de gouvernance du registre constitué (12 §3.11) | Composition écrite | | |
| ☐ | Calendrier des obligations récurrentes posé : rapport annuel au comité d'éthique, renouvellement de clairance, revue des accès, revue annuelle du dossier, exercice incident, revue AIPD | Échéancier partagé | | |

## E. Décision

| | Nom | Qualité | Date | Signature |
|---|---|---|---|---|
| Avis du référent protection des données | | | | |
| Avis du référent technique | | | | |
| Avis de l'investigateur principal | | | | |
| **Décision GO / NO-GO** du responsable du traitement | | | | |

Décision : ☐ **GO — ouverture aux données réelles** (périmètre : `[registre, site(s)]`)
☐ **NO-GO** (points bloquants : `[liste]` ; nouvelle échéance : `[date]`)

> Après le GO : conserver la présente checklist signée et ses preuves ; toute évolution
> majeure ultérieure (nouveau site, nouvelle finalité, nouveau sous-traitant,
> réactivation hors-ligne) rouvre les volets concernés avant mise en œuvre.
