# Dossier juridique et éthique — MedData · volet Tchad (pays de lancement)

> **Statut global : PROJET — non validé.** Tant que ce dossier n'est pas validé
> (conseil juridique tchadien, Comité National de Bioéthique du Tchad, autorisation du
> ministère en charge de la santé publique, formalités ANSICE), la règle du produit
> reste inchangée : **données entièrement fictives uniquement** (CLAUDE.md, RG-5,
> [deploiement.md §8](../../deploiement.md)).

Ce volet rassemble les documents nécessaires au lancement de MedData au **Tchad** :
loi n° 007/PR/2015 sur la protection des données personnelles, décret d'application
n° 075/PR/2019, autorité **ANSICE** (opérationnelle), éthique **CNBT** + autorisation
ministérielle, avec hébergement des données en **Union européenne** (Supabase, région
AWS `eu-west-3`, Paris). Chaque document est directement utilisable après remplacement
des champs `[À COMPLÉTER : …]` et validation par les instances compétentes.

**Avertissement.** Ces documents ont été préparés avec une assistance automatisée à
partir des sources citées dans [00-cadre-applicable.md](00-cadre-applicable.md). Ils
constituent une base de travail sérieuse mais **ne valent pas avis juridique**. Le
texte intégral de la loi n° 007/PR/2015 et du décret n° 075/PR/2019 n'étant pas
librement accessible en ligne, la revue par un juriste tchadien est **impérative** pour
vérifier les régimes exacts (déclaration vs autorisation, transferts, délais) avant
tout dépôt.

---

## 1. Inventaire des documents

| # | Document | Objet | Destinataires / usage |
|---|---|---|---|
| 00 | [Cadre applicable](00-cadre-applicable.md) | Étude des textes tchadiens applicables et stratégie de conformité | Porteur du projet, conseil juridique |
| 01 | [Registre des traitements](01-registre-traitements.md) | Documentation des activités de traitement | ANSICE, audits |
| 02 | [Analyse d'impact (AIPD)](02-analyse-impact.md) | Évaluation des risques pour les personnes concernées | ANSICE, CNBT, gouvernance interne |
| 03 | [Notice d'information](03-notice-information.md) | Information des patients en langage clair | Patients, CNBT |
| 04 | [Formulaire de consentement](04-consentement.md) | Recueil du consentement éclairé | Patients, investigateurs, CNBT |
| 05 | [Politique de confidentialité](05-politique-confidentialite.md) | Information publique sur les traitements de la plateforme | Publication sur le site, utilisateurs |
| 06 | [Politique de sécurité (PSSI)](06-politique-securite.md) | Règles de sécurité techniques et organisationnelles | Équipe projet, auditeurs |
| 07 | [Droits des personnes](07-droits-personnes.md) | Procédure d'exercice des droits | Équipe projet, patients |
| 08 | [Violations de données](08-violations-donnees.md) | Gestion et notification des violations | Équipe projet, ANSICE |
| 09 | [Conservation des données](09-conservation.md) | Durées de conservation et sort final | Équipe projet, ANSICE, CNBT |
| 10 | [Sous-traitants et transferts](10-sous-traitants-transferts.md) | Cartographie des sous-traitants et flux internationaux | Conseil juridique, ANSICE |
| 11 | [Charte utilisateurs](11-charte-utilisateurs.md) | Règles d'usage + engagement individuel de confidentialité | Tous les comptes |
| 12 | [Dossier éthique](12-dossier-ethique.md) | Trame de protocole et guide de soumission (CNBT + ministère) | CNBT, ministère de la santé |
| 13 | [Checklist données réelles](13-checklist-donnees-reelles.md) | Conditions GO/NO-GO avant toute donnée réelle | Décision finale du porteur du projet |

---

## 2. Circuit de validation (ordre recommandé)

1. **Complétion** — remplacer tous les champs `[À COMPLÉTER : …]` : responsable du
   traitement (établissement tchadien de rattachement recommandé), référent protection
   des données, site(s) d'inclusion. Décisions D1–D6 du
   [document 00 §7](00-cadre-applicable.md).
2. **Revue juridique** — validation de l'ensemble par un conseil tchadien (droit de la
   santé / données personnelles) sur le texte intégral de la loi n° 007/PR/2015 et du
   décret n° 075/PR/2019 : régime applicable aux données de santé (déclaration ou
   autorisation), articles sur les transferts, secret professionnel du Code pénal 2017,
   éventuel texte spécifique à la recherche en santé.
3. **Validation institutionnelle** — accord de l'établissement tchadien de rattachement
   sur le rôle de responsable du traitement.
4. **Soumission éthique** — dépôt du dossier ([12-dossier-ethique.md](12-dossier-ethique.md))
   auprès du **CNBT** (N'Djamena) ; obtention de la clairance éthique.
5. **Autorisation de recherche** — auprès du ministère en charge de la santé publique
   `[modalités exactes confirmées à l'étape 2]`.
6. **Formalités ANSICE** — déclaration/demande d'autorisation du traitement **et** du
   transfert international vers l'UE (l'ANSICE statue sous un mois — décret
   n° 075/PR/2019) ; signature du DPA Supabase et engagements des autres sous-traitants
   ([10-sous-traitants-transferts.md](10-sous-traitants-transferts.md)).
7. **GO/NO-GO** — exécution complète de la
   [checklist données réelles](13-checklist-donnees-reelles.md) (volets juridique,
   éthique, technique, organisationnel). Tant qu'une case n'est pas cochée avec preuve
   datée : données fictives uniquement.

---

## 3. Tenue du dossier

Identique aux règles communes du [dossier racine](../README.md) : cartouches mis à jour
à chaque validation, preuves conservées hors dépôt public, mise à jour du registre et
de l'AIPD à chaque évolution du produit, revue annuelle.
