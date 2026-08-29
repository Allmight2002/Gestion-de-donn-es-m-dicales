# Dossier juridique et éthique — MedData · volet Cameroun

> **Statut : PROJET — déploiement au Cameroun prévu ultérieurement.** Le lancement de
> MedData se fait au **Tchad** ([../tchad/](../tchad/README.md)) ; ce volet est conservé
> complet et prêt pour l'ouverture camerounaise, le moment venu.
>
> **Statut global : PROJET — non validé.** Tant que ce dossier n'est pas validé (conseil
> juridique camerounais, comité d'éthique compétent, autorisation administrative de
> recherche, formalités auprès de l'autorité de protection des données), la règle du
> produit reste inchangée : **données entièrement fictives uniquement** (CLAUDE.md, RG-5,
> [deploiement.md §8](../../deploiement.md)).

Ce dossier rassemble l'ensemble des documents nécessaires à l'établissement du cadre
juridique et éthique de MedData, rédigés pour le contexte **camerounais** (loi
n° 2024/017 sur la protection des données personnelles, loi n° 2022/008 sur la recherche
médicale) avec un hébergement des données en **Union européenne** (Supabase, région AWS
`eu-west-3`, Paris). Chaque document est directement utilisable après remplacement des
champs `[À COMPLÉTER : …]` et validation par les instances compétentes.

**Avertissement.** Ces documents ont été préparés avec une assistance automatisée à
partir des textes et sources cités dans [00-cadre-applicable.md](00-cadre-applicable.md).
Ils constituent une base de travail sérieuse mais **ne valent pas avis juridique**. Leur
validation par un avocat ou juriste camerounais qualifié est une étape obligatoire du
circuit ci-dessous, notamment pour vérifier les numéros d'articles et l'état des décrets
d'application au jour du dépôt.

---

## 1. Inventaire des documents

| # | Document | Objet | Destinataires / usage |
|---|---|---|---|
| 00 | [Cadre applicable](00-cadre-applicable.md) | Étude des textes applicables et stratégie de conformité | Porteur du projet, conseil juridique |
| 01 | [Registre des traitements](01-registre-traitements.md) | Documentation des activités de traitement | Autorité de protection des données, audits |
| 02 | [Analyse d'impact (AIPD)](02-analyse-impact.md) | Évaluation des risques pour les personnes concernées | Autorité, comité d'éthique, gouvernance interne |
| 03 | [Notice d'information](03-notice-information.md) | Information des patients en langage clair | Patients, comité d'éthique |
| 04 | [Formulaire de consentement](04-consentement.md) | Recueil du consentement éclairé | Patients, investigateurs, comité d'éthique |
| 05 | [Politique de confidentialité](05-politique-confidentialite.md) | Information publique sur les traitements de la plateforme | Publication sur le site, utilisateurs |
| 06 | [Politique de sécurité (PSSI)](06-politique-securite.md) | Règles de sécurité techniques et organisationnelles | Équipe projet, auditeurs |
| 07 | [Droits des personnes](07-droits-personnes.md) | Procédure d'exercice des droits (accès, rectification…) | Équipe projet, patients |
| 08 | [Violations de données](08-violations-donnees.md) | Procédure de gestion et de notification des violations | Équipe projet, autorité |
| 09 | [Conservation des données](09-conservation.md) | Durées de conservation et sort final | Équipe projet, autorité, comité d'éthique |
| 10 | [Sous-traitants et transferts](10-sous-traitants-transferts.md) | Cartographie des sous-traitants et des flux internationaux | Conseil juridique, autorité |
| 11 | [Charte utilisateurs](11-charte-utilisateurs.md) | Règles d'usage + engagement individuel de confidentialité | Tous les comptes (médecins, curateurs, admin) |
| 12 | [Dossier éthique](12-dossier-ethique.md) | Trame de protocole et guide de soumission (comité + AAR) | Comité d'éthique, MINSANTE/DROS |
| 13 | [Checklist données réelles](13-checklist-donnees-reelles.md) | Conditions GO/NO-GO avant toute donnée réelle | Décision finale du porteur du projet |

---

## 2. Circuit de validation (ordre recommandé)

1. **Complétion** — remplacer tous les champs `[À COMPLÉTER : …]` : identité du
   responsable du traitement, établissement de rattachement, référent protection des
   données, comité d'éthique visé. Décision structurante : porter le projet à titre
   individuel ou l'adosser à un établissement (recommandé, voir
   [00-cadre-applicable.md §6](00-cadre-applicable.md)).
2. **Revue juridique** — validation de l'ensemble du dossier par un conseil camerounais
   (droit de la santé / données personnelles). Vérifier en particulier : numéros
   d'articles de la loi n° 2024/017, état du décret créant l'autorité de protection des
   données, régime exact des formalités préalables (art. 19) et des transferts (art. 32).
3. **Validation institutionnelle** — accord de l'établissement de rattachement
   (direction, le cas échéant comité médical) sur le rôle de responsable du traitement.
4. **Soumission éthique** — dépôt du dossier ([12-dossier-ethique.md](12-dossier-ethique.md))
   auprès du comité compétent (institutionnel, régional ou CNERSH selon la portée) ;
   obtention de la **clairance éthique**.
5. **Autorisation administrative de recherche (AAR)** — dépôt auprès du MINSANTE
   (Division de la Recherche Opérationnelle en Santé — DROS).
6. **Formalités données personnelles** — dès que l'autorité de protection des données
   est opérationnelle : déclaration/demande d'autorisation du traitement (art. 19) et du
   transfert international vers l'UE (art. 32) ; signature du DPA Supabase et des
   engagements des autres sous-traitants ([10-sous-traitants-transferts.md](10-sous-traitants-transferts.md)).
7. **GO/NO-GO** — exécution complète de la
   [checklist données réelles](13-checklist-donnees-reelles.md), qui croise les volets
   juridique, éthique, technique ([deploiement.md §8](../../deploiement.md)) et
   organisationnel. Tant qu'une case n'est pas cochée avec preuve datée : données
   fictives uniquement.

---

## 3. Tenue du dossier

- Chaque document porte un cartouche (version, date, statut, validations requises).
  Mettre à jour le cartouche à chaque validation obtenue et conserver les preuves
  (avis, autorisations, accusés) dans un dossier `docs/juridique/preuves/` **hors dépôt
  public** ou dans un coffre documentaire de l'établissement.
- Toute évolution du produit touchant aux données (nouvelles catégories, nouveau
  sous-traitant, nouvelle finalité, réactivation du mode hors-ligne…) déclenche la mise
  à jour du registre des traitements, de l'AIPD et, si besoin, un amendement au comité
  d'éthique.
- Revue annuelle programmée du dossier complet (responsable : le référent protection
  des données).
