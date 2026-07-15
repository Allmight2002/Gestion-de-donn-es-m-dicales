# 08 — Procédure de gestion des violations de données

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (référent PD, référent technique) |
| Fondement | Loi n° 007/PR/2015 (sécurité et notification des violations `[modalités exactes à confirmer sur le texte]`) ; loi n° 009/PR/2015 (cybersécurité) |
| Contact incident (24/7 pendant le pilote) | `[nom, téléphone, e-mail]` |

**Définition.** Violation de données : tout incident de sécurité entraînant, de manière
accidentelle ou illicite, la **destruction**, la **perte**, l'**altération**, la
**divulgation** ou l'**accès non autorisé** à des données personnelles — que l'incident
soit avéré ou raisonnablement suspecté.

---

## 1. Exemples concrets dans le contexte MedData

| Scénario | Type |
|---|---|
| Fichier d'export transmis à une personne non autorisée ou déposé sur un support public | Divulgation (données pseudonymisées) |
| Compte professionnel compromis (hameçonnage, mot de passe volé) avec accès identité | Accès non autorisé (C3) |
| Permission accordée par erreur (`can_view_identity` à un compte qui ne devait pas l'avoir) et utilisée | Accès non autorisé |
| Document brut téléversé **non dé-identifié** (nom visible) et consulté par un curateur | Divulgation interne |
| Vol/perte d'un ordinateur avec session MedData active non verrouillée | Accès non autorisé potentiel |
| Incident chez un sous-traitant (Supabase, hébergeur ClamAV) touchant nos données | Selon notification du sous-traitant |
| Suppression massive accidentelle sans possibilité de restauration | Perte/destruction |
| Données réelles saisies alors que le cadre ne l'autorise pas (violation de la règle « données fictives ») | Traitement illicite — traiter par cette procédure |

## 2. Détection

Sources : alertes du monitoring (applicatif, Edge, DB) ; revue mensuelle des journaux
(`audit_log`, `export_log`) ; signalement par un utilisateur (obligation de la charte
11, sans sanction pour signalement de bonne foi) ; notification d'un sous-traitant
(le DPA Supabase prévoit la notification des incidents) ; réclamation d'un patient.

## 3. Réaction immédiate (heure 0 → heure 24)

1. **Signaler** au contact incident ; ouvrir une fiche au registre des violations (§6)
   avec horodatage.
2. **Endiguer** — actions selon le scénario, dans l'ordre le moins destructeur de
   preuves :
   - compte compromis : désactiver le compte / révoquer ses sessions (Supabase Auth),
     réinitialiser le mot de passe, vérifier la MFA ;
   - permission erronée : la retirer immédiatement (l'historique des accès reste dans
     `audit_log`) ;
   - fuite de secret (`service_role`, jeton ClamAV, secrets Edge) : **rotation
     immédiate** de la clé concernée puis redéploiement ;
   - document non dé-identifié : le retirer de la soumission (suppression de la
     demande), vérifier qui l'a consulté via `audit_log` ;
   - export égaré : identifier le fichier par `export_log` (auteur, date, hash),
     demander destruction attestée au détenteur ;
   - incident d'infrastructure : suivre le statut Supabase, ouvrir un ticket support.
3. **Préserver les preuves** : extraire et sauvegarder les journaux pertinents
   (`audit_log`, `field_change_log`, `export_log`, journaux Auth) **avant** toute
   manipulation ; noter les heures exactes.
4. **Ne pas communiquer** publiquement à ce stade ; informations limitées aux personnes
   chargées de l'incident.

## 4. Qualification (heure 24 → jour 3)

Évaluer et consigner :

| Critère | Questions |
|---|---|
| Nature | Confidentialité / intégrité / disponibilité ; catégories de données (C3 identité ? C2 santé pseudonymisée ? C1 comptes ?) |
| Périmètre | Nombre de patients/bases/comptes concernés ; période d'exposition |
| Ré-identifiabilité | Les données exposées permettent-elles d'identifier quelqu'un ? (données pseudonymisées sans zone identité = risque réduit mais non nul) |
| Conséquences potentielles | Discrimination, stigmatisation (données de santé !), atteinte à la vie privée, préjudice moral ou matériel |
| Réversibilité | Données récupérées/détruites ? Accès clos ? |

**Grille de gravité** : *Faible* (données fictives, ou pseudonymisées sans identité, exposition
brève, destinataire de confiance) ; *Moyenne* (données pseudonymisées exposées largement, ou
identité d'un petit nombre exposée en interne) ; *Élevée* (identité + données de santé
exposées hors du cercle autorisé, ou perte définitive).

## 5. Notification

1. **À l'ANSICE** : toute violation présentant un risque pour les droits des
   personnes est notifiée **sans retard injustifié** — objectif interne :
   **72 heures** après la qualification `[délai légal exact de la loi n° 007/PR/2015
   à confirmer par le conseil juridique]`. L'ANSICE est opérationnelle : la
   notification est effective, pas différée. Contenu type : voir modèle §7.
2. **Aux personnes concernées** : si le risque est **élevé** (notamment exposition de
   l'identité + données de santé), information individuelle **sans retard**, par le
   médecin investigateur, en termes clairs (modèle §7). Si l'information individuelle
   exige des efforts disproportionnés, information générale via l'établissement, avec
   l'accord du référent PD.
3. **Au responsable du traitement** et, si un contrat l'exige, aux partenaires
   (établissement, promoteur, comité d'éthique en cas d'impact sur la recherche).
4. Ne jamais retarder une notification au motif que l'enquête n'est pas terminée : une
   notification initiale peut être complétée.

## 6. Registre des violations (tenu par le référent PD — conservation `[5 ans]`)

| N° | Détection (date/h) | Description factuelle | Données/personnes concernées | Gravité | Mesures d'endiguement (avec heures) | Notification autorité (O/N, date, réf.) | Information personnes (O/N, date) | Clôture et REX |
|---|---|---|---|---|---|---|---|---|
| 2026-V01 | | | | | | | | |

**Toutes** les violations y figurent, y compris celles jugées sans risque (avec la
motivation de l'absence de notification).

## 7. Modèles

**Notification à l'autorité** — « Le `[date/heure]`, `[responsable du traitement]` a
détecté une violation de données affectant le traitement « registre clinique MedData »
(déclaré sous la réf. `[…]`). Nature : `[accès non autorisé/divulgation/perte]`.
Catégories de données : `[identité / données de santé pseudonymisées / comptes]`.
Personnes concernées : `[nombre, catégorie]`. Conséquences probables : `[…]`. Mesures
prises : `[endiguement, avec heures]`. Mesures pour éviter la répétition : `[…]`.
Contact : `[référent PD]`. Cette notification sera complétée le cas échéant. »

**Information d'un patient** — « Madame/Monsieur, nous vous informons qu'un incident de
sécurité survenu le `[date]` a pu exposer certaines de vos informations (`[nature
exacte, sans jargon]`). Voici ce qui s'est passé : `[2 phrases factuelles]`. Voici ce
que nous avons fait : `[mesures]`. Conséquences possibles pour vous : `[…]`. Ce que
vous pouvez faire : `[recommandations]`. Nous vous présentons nos excuses ; votre
médecin `[nom]` et notre référent `[contact]` sont à votre disposition pour toute
question. Vous pouvez également saisir l'autorité de protection des données. »

## 8. Retour d'expérience (clôture)

Sous `[15 jours]` après clôture : réunion référent PD + référent technique +
investigateur concerné ; causes racines ; actions correctives datées et suivies
(mise à jour PSSI/AIPD/charte si nécessaire) ; enregistrement au registre. Un incident
majeur déclenche la révision immédiate de l'AIPD (action A10).

## 9. Exercice annuel

Une fois par an, dérouler cette procédure sur un scénario simulé (ex. compromission
d'un compte médecin) et consigner les écarts. Premier exercice exigé **avant données
réelles** ([checklist (13)](13-checklist-donnees-reelles.md)).
