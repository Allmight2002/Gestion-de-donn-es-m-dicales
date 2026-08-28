# Dossier juridique et éthique — MedData

> **Règle produit inchangée : données entièrement fictives tant que le volet pays
> concerné n'est pas intégralement validé** (conseil juridique local, comité d'éthique,
> autorisations, checklist GO/NO-GO soldée).

Le dossier est organisé **par pays de déploiement**. Chaque volet est complet et
autoporteur : mêmes quatorze documents (index 00 à 13), ancrés dans le droit national
concerné. Les principes, l'architecture de sécurité et la méthode sont communs ; seuls
les ancrages nationaux changent (lois, autorité de protection des données, circuit
éthique, sanctions).

| Volet | Statut | Contenu |
|---|---|---|
| **[tchad/](tchad/README.md)** | **Pays de lancement** — dossier actif à compléter et faire valider | Loi n° 007/PR/2015 + décret n° 075/PR/2019 ; autorité **ANSICE** (opérationnelle) ; éthique **CNBT** + autorisation du ministère en charge de la santé publique |
| **[cameroun/](cameroun/README.md)** | Déploiement **prévu ultérieurement** — dossier prêt, conservé à jour | Loi n° 2024/017 + loi n° 2022/008 ; autorité en cours d'installation ; éthique CNERSH/comités régionaux + AAR (MINSANTE/DROS) |

## Principes communs à tous les volets

- **Un responsable de traitement par pays** (établissement ou investigateur local),
  qui porte les formalités et validations de son pays.
- **Hébergement Supabase en Union européenne** (région `eu-west-3`, Paris) : constitue
  un transfert international **vu de chaque pays** — chaque volet contient son dossier
  de justification et sa formalité de transfert.
- **Consentement élargi gouverné** (CIOMS 2016) : inclusion au registre + études
  futures supervisées par le comité d'éthique + consentements distincts pour les images
  et le transfert international.
- Les documents 06 (PSSI), 02 (analyse de risques) et 11 (charte) décrivent le
  **produit** : leurs versions nationales ne diffèrent que par les références légales.

## Vision d'extension (scénario cible)

MedData a vocation à être mis à disposition de chercheurs d'autres pays à revenu
faible ou intermédiaire : chaque chercheur devient **responsable de traitement dans son
pays** ; l'équipe MedData agit comme **sous-traitant** (opérateur de plateforme). Le
moment venu, deux pièces s'ajouteront au dossier : un **contrat de sous-traitance
plateforme ↔ chercheur** (DPA, rédigé une fois au standard le plus strict) et un
**gabarit de module pays** industrialisant la création de nouveaux volets (corpus
légal, autorité, circuit éthique, vérification d'une éventuelle exigence de
localisation des données de santé — seul point susceptible de bloquer un pays).

## Registre multicentrique (si plusieurs pays participent au même registre)

1. Un responsable de traitement par pays, liés par une **convention de collaboration**
   (protocole commun, gouvernance conjointe, règles de publication, sortie d'un site).
2. Une **base MedData par site** ; partage inter-sites uniquement par exports
   pseudonymisés couverts par un **accord de transfert de données (DTA)**.
3. Notices et consentements **nationaux** ; clairances éthiques et formalités
   **dans chaque pays** ; l'hébergement UE déclaré dans chaque dossier national.

## Tenue du dossier

Preuves (avis, autorisations, contrats signés) dans `docs/juridique/preuves/` **hors
dépôt public** ou dans le coffre documentaire de l'établissement. Toute évolution du
produit touchant aux données (nouvelle catégorie, nouveau sous-traitant, nouvelle
finalité, réactivation du mode hors-ligne) met à jour le registre des traitements et
l'AIPD **de chaque volet actif**. Revue annuelle par volet.
