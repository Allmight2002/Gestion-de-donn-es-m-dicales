# 12 — Dossier de soumission éthique et autorisation administrative de recherche

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — trame à compléter puis soumettre** |
| Fondement | Loi n° 2022/008 du 27/04/2022 (recherche médicale impliquant la personne humaine, y compris les données de santé) ; arrêté n° 0977/A/MINSANTE (comités d'éthique) ; Déclaration d'Helsinki (rév. 2024) ; lignes directrices CIOMS 2016 |

---

## 1. Circuit d'approbation au Cameroun

Deux validations distinctes et successives sont nécessaires **avant** toute donnée
réelle :

1. **Clairance éthique**, délivrée par le comité compétent selon la portée :

| Portée du registre | Comité compétent |
|---|---|
| Étude interne à un établissement, risque minimal | Comité d'éthique **institutionnel** de l'établissement (s'il existe) |
| Étude limitée à une région | **Comité régional** d'éthique de la recherche pour la santé humaine (CRERSH) de la région concernée |
| Multicentrique, nationale, financement externe ou collaboration internationale | **CNERSH** (Comité National d'Éthique de la Recherche pour la Santé Humaine, Yaoundé — contact : +237 222 23 45 79, minsanterecherche@yahoo.fr `[vérifier les coordonnées au dépôt]`) |

   > Un registre hébergé hors du Cameroun (UE) peut être considéré comme comportant une
   > dimension internationale : valider le choix du comité **avant dépôt** auprès de la
   > DROS ou du comité pressenti.

2. **Autorisation administrative de recherche (AAR)**, obligatoire, délivrée par le
   **MINSANTE via la Division de la Recherche Opérationnelle en Santé (DROS)**, qui
   vérifie : complétude du dossier, légitimité du comité d'éthique saisi, capacité
   institutionnelle, cohérence protocole/avis.

En complément : **autorisation du responsable de chaque structure sanitaire** où des
patients sont inclus (directeur d'hôpital), et le cas échéant avis du comité médical
d'établissement.

**Vie du dossier après approbation** : tout changement substantiel (nouvelles
variables sensibles, nouveau site, réactivation du mode hors-ligne, changement
d'hébergeur, import rétrospectif non prévu) fait l'objet d'un **amendement** soumis au
comité ; un **rapport d'avancement** est fourni selon la périodicité fixée par le
comité (souvent annuelle), et la clairance est **renouvelée** selon sa durée de
validité. À la clôture : rapport final ([09-conservation.md §2.3](09-conservation.md)).

## 2. Pièces du dossier de soumission (liste type — vérifier la liste propre au comité choisi)

- ☐ Lettre de demande adressée au président du comité, signée par l'investigateur
  principal ;
- ☐ **Protocole de recherche** (trame complète §3) ;
- ☐ **Notice d'information** ([03](03-notice-information.md)) et **formulaire de
  consentement** ([04](04-consentement.md)), versionnés et datés ;
- ☐ Outils de collecte : **dictionnaire des variables** du registre (exporter la
  définition du gabarit MedData : libellés, types, bornes, valeurs autorisées, portée
  patient/rencontre) ;
- ☐ CV et attestations de l'investigateur principal et des co-investigateurs
  (+ formation en bonnes pratiques cliniques/éthique si disponible) ;
- ☐ Engagements de confidentialité de l'équipe ([11, annexe](11-charte-utilisateurs.md)) ;
- ☐ Accord(s) de la ou des structures sanitaires d'accueil ;
- ☐ Documentation de la protection des données : synthèse du dossier juridique
  (AIPD [02](02-analyse-impact.md), conservation [09](09-conservation.md), transferts
  [10](10-sous-traitants-transferts.md)) ;
- ☐ Budget et sources de financement ; déclaration de conflits d'intérêts ;
- ☐ Quittance des frais d'examen `[montant selon comité — à renseigner]` ;
- ☐ `[Si collaboration internationale : accords de collaboration, le cas échéant
  accord de transfert de données (DTA)]`.

## 3. Trame de protocole — registre observationnel MedData

> Remplacer chaque rubrique par le contenu propre au registre. La trame est conçue pour
> un **registre observationnel prospectif** (avec option rétrospective §3.9).

**Page de garde** : titre complet et acronyme ; version/date du protocole ;
investigateur principal (nom, qualifications, service, contacts) ; co-investigateurs ;
établissement(s) ; promoteur (le cas échéant) ; financement.

**3.1 Résumé** (1 page) : question de recherche, population, méthode (registre
observationnel), taille visée, durée, retombées attendues.

**3.2 Contexte et justification** : état des connaissances sur `[pathologie/domaine]` ;
insuffisance des données locales ; intérêt d'un registre structuré et pseudonymisé pour
`[épidémiologie descriptive, résultats de prise en charge, qualité des soins…]`.

**3.3 Objectifs** : objectif principal (ex. décrire les caractéristiques cliniques,
les prises en charge et l'évolution des patients atteints de `[…]` vus à `[site]`) ;
objectifs secondaires (facteurs associés, tendances temporelles, base pour études
futures approuvées).

**3.4 Type d'étude** : registre observationnel, `[prospectif / ambispectif]`,
`[monocentrique / multicentrique]`, sans aucune modification de la prise en charge des
patients (les soins restent inchangés ; seules des données sont recueillies).

**3.5 Population** : critères d'inclusion (`[diagnostic, âge, site]`, consentement
éclairé signé) ; critères de non-inclusion (refus, `[…]`) ; modalités de recrutement
(consultation/hospitalisation) ; effectif attendu `[N/an]` et justification.

**3.6 Données recueillies** : renvoyer au dictionnaire des variables (gabarit MedData
versionné — préciser nom et version du gabarit ; toute variable est typée, bornée et
contrôlée) ; catégories : identification (zone restreinte : nom, date de naissance,
coordonnées), données cliniques par rencontre (âge calculé, `[examens, traitements,
scores…]`) ; images cliniques `[si option C du consentement]` ; **aucune** donnée sans
rapport avec les objectifs.

**3.7 Circuit des données** (spécifique MedData — reprendre tel quel et adapter) :
les données sont saisies par le médecin dans une application web sécurisée qui sépare
techniquement l'identité (accessible aux seuls comptes autorisés par le médecin
responsable) des données cliniques pseudonymisées (code patient, âge calculé — la date
de naissance n'est jamais visible hors de la zone identité) ; les documents sources
éventuels sont dé-identifiés avant téléversement et structurés par des curateurs qui
n'ont jamais accès à l'identité ; toutes les consultations d'identité, exports et
suppressions sont journalisés de façon infalsifiable ; les analyses sont réalisées sur
des extractions pseudonymisées dont le contenu est contrôlé par une liste blanche
serveur excluant toute donnée identifiante ; hébergement sécurisé en Union européenne
(France) encadré par la loi n° 2024/017 (autorisation de transfert, consentement
explicite, contrat de sous-traitance).

**3.8 Gestion et analyse** : plan d'analyse `[statistiques descriptives ; logiciels]` ;
contrôle qualité (statuts de complétude, validation des saisies, traçabilité des
corrections) ; conservation et fin de vie : [politique (09)](09-conservation.md).

**3.9 Volet rétrospectif** `[le cas échéant]` : périmètre des dossiers existants à
reprendre (`[période, service]`) ; modalité proposée : `[recueil du consentement lors
d'un contact de suivi / demande de dispense de consentement pour les patients perdus de
vue ou décédés, motivée par …]` — **à l'appréciation du comité** ; procédure d'import
contrôlée et journalisée.

**3.10 Considérations éthiques** : respect de la Déclaration d'Helsinki (rév. 2024 —
qui exige l'approbation et le suivi des bases de données de recherche par un comité
d'éthique) et des lignes CIOMS 2016 (consentement élargi gouverné pour les usages
futurs) ; consentement éclairé écrit préalable (04), y compris consentements distincts
pour les études futures, les images et le transfert international ; participation
volontaire sans impact sur les soins ; risques : essentiellement informationnels,
mesures détaillées dans l'AIPD (02) ; bénéfices : collectifs (connaissances, qualité
des soins) ; populations vulnérables : `[mineurs via représentant légal / exclus]` ;
conflits d'intérêts : `[déclaration]`.

**3.11 Gouvernance du registre et usages futurs** : comité de gouvernance
`[investigateur principal + `[2–4]` membres, dont si possible un représentant des
patients]` ; toute étude secondaire utilisant le registre fait l'objet d'un protocole
soumis au comité d'éthique et d'une décision de ce comité de gouvernance ; accès des
chercheurs limité à des extractions pseudonymisées approuvées ; publication des
résultats sans aucune donnée identifiante, mention du registre et de ses approbations.

**3.12 Calendrier** : soumission éthique `[T0]` ; AAR `[T0+…]` ; formalités données
personnelles ; ouverture des inclusions ; points annuels ; durée du registre
`[indéterminée avec renouvellements / N ans]`.

**3.13 Budget** : coûts d'hébergement (`[plan Supabase]`), matériel, personnel,
frais de dossier ; sources de financement.

**3.14 Références** : textes ([00-cadre-applicable.md §8](00-cadre-applicable.md)) et
littérature scientifique du domaine.

**Annexes du protocole** : notice (03) ; consentement (04) ; dictionnaire des
variables ; engagements (11) ; synthèse sécurité/AIPD ; accords de structures.

## 4. Conseils de dépôt

- Prendre contact en amont avec le secrétariat du comité visé pour la liste exacte des
  pièces, le nombre d'exemplaires, les frais et le calendrier des sessions.
- Prévoir des délais réalistes : `[plusieurs semaines à quelques mois]` entre dépôt,
  demandes de clarification et avis ; puis le délai propre à l'AAR.
- Répondre aux demandes du comité par une lettre point par point + documents révisés
  en versionnage apparent (v1.1, v1.2…).
- Conserver l'original de la clairance et de l'AAR dans `docs/juridique/preuves/`
  (hors dépôt public) et reporter leurs références dans la notice (03), le formulaire
  (04) et la [checklist (13)](13-checklist-donnees-reelles.md).
