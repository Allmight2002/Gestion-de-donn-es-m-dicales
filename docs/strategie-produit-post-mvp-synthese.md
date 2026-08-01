# Synthèse d'arbitrage — confrontation des deux études stratégiques post-MVP

> **Synthèse datée.** Les éléments de marché restent historiques ; l'état de la plateforme au
> 1er août est consigné dans [`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md).

| Cartouche | |
|---|---|
| Date | 2026-07-16 |
| Objet | Confronter deux études indépendantes menées en parallèle sur la même mission, arbitrer leurs divergences point par point et consolider une position unique |
| Étude A | [strategie-produit-post-mvp.md](strategie-produit-post-mvp.md) (agent parallèle) |
| Étude B | [strategie-produit-post-mvp-claude.md](strategie-produit-post-mvp-claude.md) (Claude) |
| Statut | PROJET — les arbitrages restent des recommandations à valider par le porteur |
| Limite | L'étude A était **inachevée** au moment de la confrontation (elle s'arrête au programme de validation : pas de KPI, de feuille de route par horizons, de sources consolidées ni de sections finales). Si elle est complétée, réviser les points 7 et 11 ci-dessous |

**Valeur de la confrontation** : les deux études ont été produites sans se voir, avec des
recherches externes partiellement différentes. Leurs **convergences constituent donc les
conclusions les plus solides du dossier** (deux chemins indépendants, même résultat), et leurs
**divergences délimitent exactement ce qui reste à arbitrer ou à tester**.

---

## 1. Verdict commun — conclusions consolidées (haute confiance)

Les deux études aboutissent indépendamment aux mêmes conclusions structurantes :

1. **Même recommandation principale** : *poursuivre en réduisant le périmètre à un segment
   précis* — le registre spécialisé mono-site d'un service hospitalier (universitaire), porté
   par un investigateur, avec une phase de validation terrain d'environ 90 jours, à données
   fictives, 3 sites pilotes maximum, et des critères d'arrêt fixés **avant** de commencer.
2. **Même lecture concurrentielle** : le concurrent n°1 est le statu quo Excel/papier ; REDCap
   est le benchmark académique institutionnel ; DHIS2 Tracker occupe le programmatique national
   (il est déjà national au Cameroun et au Tchad) ; Kobo/ODK/CommCare dominent la collecte
   terrain ONG.
3. **Mêmes segments exclus** : essais cliniques réglementés (GCP/CFR 21), surveillance
   épidémiologique nationale, programmes ONG de collecte de masse, remplacement du dossier de
   soins.
4. **Même lucidité sur le produit** : MVP riche ≠ service exploitable ; la readiness de
   production n'est pas démontrée (matrice du 2026-07-16) ; la checklist fonctionnelle est un
   plan de test, pas une preuve ; **le hors-ligne actuel est une faiblesse, pas un argument de
   vente** ; les mesures de sécurité (RLS, audit, permissions) sont des exigences minimales du
   domaine, pas une différenciation commerciale.
5. **Même différenciation crédible** : face à Excel (structure, traçabilité, séparation
   d'identité, cohortes/exports reproductibles), pas face aux EDC établis. Face à REDCap,
   l'avantage n'existe que là où l'institution **n'a pas** de DSI capable de l'héberger.
6. **Même méthode de validation** : entretiens non orientés sur les derniers projets réellement
   menés (jamais « utiliseriez-vous ce produit ? »), volonté de payer objectivée par les budgets
   passés et les signataires, lettres d'intention à contenu exigeant, pilotes fictifs mesurés.
7. **Même règle absolue** : aucune donnée réelle avant un GO juridique, éthique, technique et
   organisationnel formalisé.

Ces sept points sont considérés comme **acquis pour la suite du projet** (au niveau « inférence
raisonnable consolidée » — la preuve terrain reste à faire).

---

## 2. Arbitrages point par point

### 2.1 Pays d'entrée — la divergence principale

| | Position | Arguments |
|---|---|---|
| Étude A | **Cameroun provisoire** ; Tchad seulement si un design partner qualifié se présente sous 30 jours | Connectivité nationale (Banque mondiale 2024 : ~46 % d'utilisateurs Internet au Cameroun vs ~13 % au Tchad) ; écosystème numérique documenté ; hors-ligne MedData partiel = risque accru au Tchad |
| Étude B | **Tchad d'abord** | Dossier juridique tchadien déjà actif (choix acté du projet) ; ANSICE opérationnelle statuant sous un mois vs autorité camerounaise en cours d'installation ; REDCap **déjà implanté** au Cameroun = concurrence installée ; précédent camerounais défavorable sur la résidence des données |

**Arbitrage retenu : une règle de décision unique plutôt qu'un pays par principe.**

> Lancer immédiatement (J0–J30) la qualification d'un design partner **tchadien** selon les
> critères d'éligibilité de l'étude A (registre actif <12 mois, ~100 dossiers ou flux régulier,
> décideur disponible, personne responsable des données, budget identifiable, accord de mesure)
> **plus** une mesure de connectivité **du site** (coupures, débit, électricité, appareils).
>
> - **Si un site tchadien qualifié existe → Tchad.** On capitalise sur le dossier juridique déjà
>   construit, sur une autorité qui répond, et sur une concurrence REDCap non documentée.
> - **Sinon → Cameroun**, en assumant trois surcoûts : réouverture et priorisation du volet
>   juridique camerounais (autorité en installation, échéance de conformité juin 2026),
>   confrontation directe à REDCap existant (CRENC/IeDEA), et vérification préalable de la
>   question de résidence (précédent CA-IeDEA).

**Motif.** Les deux études disent en réalité la même chose — « le design partner décide » ;
elles ne divergent que sur le **défaut**. Le défaut Tchad se justifie par l'actif juridique déjà
constitué et l'argument concurrentiel ; l'objection de connectivité de l'étude A est valide mais
se traite **au niveau du site, pas du pays** (l'étude A le reconnaît elle-même : « la
connectivité impose un choix de site, pas seulement de pays »).

### 2.2 Désaccord factuel résolu : présence de REDCap

- Étude A : « présence active au Cameroun/Tchad non confirmée publiquement ».
- Étude B : source primaire — implémentation REDCap documentée au Cameroun (CRENC, Yaoundé,
  projet CA-IeDEA, serveurs locaux avec batteries pour pallier les coupures) :
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6790220/

**Tranché : REDCap est implanté au Cameroun (fait vérifié) ; sa présence au Tchad reste
inconnue (information manquante).** Conséquences : (i) renforce le Tchad comme défaut ;
(ii) impose d'inclure au moins un utilisateur REDCap camerounais dans les entretiens
contradicteurs ; (iii) le précédent CA-IeDEA (le comité d'éthique a demandé que les données
restent hébergées **dans le pays**) devient un fait de dossier, pas une rumeur.

### 2.3 Risque de résidence des données

- Étude A : risque listé parmi d'autres (« méfiance envers l'hébergement ou résidence »).
- Étude B : **risque létal n°1**, avec le précédent CA-IeDEA et une action dédiée (consultation
  ANSICE/CNBT immédiate, plan B d'hébergement à chiffrer).

**Arbitrage : adopter la position de l'étude B.** Un refus de l'hébergement UE invalide
l'architecture actuelle quel que soit le reste de l'analyse ; c'est la définition d'un risque
létal, il se traite en premier et en parallèle de tout le reste.

### 2.4 Volume et structure des entretiens

- Étude A : 24 entretiens principaux dans ≥12 organisations + 4–6 contradicteurs (structure
  forte : 8 investigateurs, 8 data managers, 4 fonctions support/éthique, 4 payeurs).
- Étude B : 10–15 entretiens (calibré sur la capacité d'une personne seule).

**Arbitrage : 16–18 entretiens en deux vagues, structure de A, volume proche de B.**
Vague 1 (semaines 1–6) : 10 entretiens dont ≥2 payeurs et ≥2 contradicteurs (dont ≥1 utilisateur
REDCap et ≥1 équipe satisfaite de son processus actuel). Vague 2 (semaines 6–10) : 6–8
entretiens ciblés sur les signaux ambigus de la vague 1. **Motif** : la structure de A
(payeurs + contradicteurs obligatoires) est méthodologiquement supérieure ; son volume est
irréaliste pour une personne seule dans le délai.

### 2.5 Protocole de test produit

- Étude A : test comparatif **tête-à-tête** — le même mini-registre fictif monté sur MedData
  **et** sur l'alternative réelle du site (Excel, REDCap, DHIS2 ou CommCare), avec un seuil de
  supériorité d'**au moins 30 % sur un résultat critique choisi avant le test**, coupure réseau
  simulée incluse.
- Étude B : test de tâches — chaque participant apporte **son propre fichier Excel**
  (anonymisé/fictif) et le transforme en registre (création, saisie, correction, export),
  mesures de temps et de blocages.

**Arbitrage : fusion des deux — c'est le point où la confrontation apporte le plus.**
Le test utilise **le fichier réel (fictivisé) du participant** (réalisme et effet
démonstratif de B) **et** exécute les mêmes tâches sur l'outil actuel du site (rigueur
comparative de A), avec le seuil provisoire de ≥30 % d'amélioration sur un critère choisi avant
le test, sans dégradation de qualité ni surcoût de support.

### 2.6 Seuils de validation chiffrés

| Mesure | Étude A | Étude B | **Consolidé** |
|---|---|---|---|
| Activation pilote | ≥75 % des sites à J14 | >60 % des comptes à 30 j | **≥75 % des sites activés à J14** (définition d'activation écrite avant le pilote) |
| Rétention | ≥2 sites/3 actifs à S8 **et** S12 | >70 % à S+8 | **≥2 sites/3 actifs à S8 et S12** |
| Support | ≤2 h/site/semaine à S8 | <4 h/site/mois après M1 | **≤2 h/site/semaine à S8, en décroissance, cible <4 h/mois à M3** (trajectoire, pas photo) |
| Douleur en entretien | 8/12 équipes qualifiées avec incident/coût récurrent | ≥60 % avec douleur forte documentée | **≥2/3 des équipes qualifiées, avec artefact montré** (fichier, cahier, workflow) |
| Payeur | 2 organisations nomment budget + signataire + calendrier | ≥1 LOI conditionnelle payante | **Les deux** : 2 payeurs nommés dont ≥1 LOI conditionnelle payante |
| Supériorité produit | Gain ≥30 % pré-déclaré | <1 h pour créer son registre accompagné | **Les deux** (le second devient un sous-critère du premier) |

### 2.7 KPI, feuille de route, sources, sections finales

L'étude A s'arrête avant ces volets. **Arbitrage : reprendre l'étude B comme référence** pour
les KPI post-MVP (§12), la feuille de route en 4 horizons (§13), les décisions à 30 jours
(§14), les sources consolidées (§17) et les trois sections finales — en y injectant les seuils
consolidés du §2.6 ci-dessus. Si l'étude A est complétée ultérieurement, confronter à nouveau
ces volets.

### 2.8 Exclusions et risques — union des apports propres

Apports propres de l'étude A, **adoptés** :
- Exclure explicitement le **dossier de soins** (SIH, OpenMRS/Bahmni) et traiter le **risque de
  double saisie avec le soin** comme critère d'observation obligatoire (arrêter un site si
  aucune source fiable n'évite la double saisie).
- Méthode de tarification par **coût plancher complet** (infrastructure, onboarding, migration,
  formation, support, conformité, déplacements) puis deux offres explicites (plancher /
  plancher + marge et risque) avec SLA.
- Contenu exigé d'une **LOI utile** : site, cas d'usage, champion, data manager, date cible,
  ressources réservées, fourchette budgétaire, autorisations requises, KPI, conditions de
  conversion et motifs de retrait.
- Données de contexte : Banque mondiale (connectivité 46 %/13 %), mise en garde OMS (un outil
  numérique ne compense pas un système de santé), inventaire camerounais (plan e-santé).
- Critères d'éligibilité design partner en 8 points (§8 de A).

Apports propres de l'étude B, **adoptés** :
- **Précédent CA-IeDEA** et priorité absolue à la question de résidence (§2.3).
- Contrainte de licence REDCap (support informatique **interne** exigé, sous-traitance
  interdite) — c'est le fondement factuel de l'interstice « sans DSI ».
- Paysage complété : **Epi Info abandonné** (09/2025 — base installée orpheline, opportunité),
  **CanReg5** (standard gratuit des registres cancer — segment à éviter), **Dacima** et
  **Voozanoo/Epistudy** (rivaux francophones sur appels d'offres institutionnels), REDCap
  hébergé payant (à documenter).
- Segment « thèses/mémoires » traité comme **canal d'évangélisation**, pas comme cible
  commerciale.
- Sources consolidées avec dates de consultation et signalement des sources intéressées.

### 2.9 Scénarios de pivot — union (5 scénarios documentés)

1. **Service géré** (A) : les équipes paient surtout la configuration, la migration et la
   curation — MedData devient une offre de service outillée.
2. **Couche au-dessus de REDCap/DHIS2** (A) : les établissements refusent une nouvelle
   plateforme mais veulent le modèle de registre, la gouvernance ou les exports.
3. **Bien commun subventionné** (B) : usage enthousiaste mais volonté de payer nulle →
   financement ONG/coopération/sociétés savantes.
4. **Pivot d'hébergement** (B) : résidence locale exigée → instance locale ou partenaire
   régional, si finançable.
5. **Pivot hors-ligne** (B) : la demande dominante est la création hors-ligne (pas seulement la
   correction) → reprioriser la technique avant d'élargir.

---

## 3. Programme de validation consolidé (v2)

Fusion opérationnelle des deux programmes — remplace les versions A et B :

- **Semaines 0–4 — Qualification pays et risque létal.** Qualification d'un design partner
  tchadien (critères §2.1) avec mesure de connectivité de site ; en parallèle, consultation
  ANSICE/CNBT sur l'hébergement UE via conseil juridique. Décision pays à J+30.
- **Semaines 1–6 — Entretiens vague 1.** 10 entretiens (structure §2.4), guide non orienté
  (les 12 questions de A englobent les 7 de B ; y ajouter la question résidence de B :
  « que dirait votre comité d'éthique d'un hébergement en Europe ? »).
- **Semaines 4–10 — Observation et test comparatif.** ≥4 workflows observés (6 si accessibles) ;
  test fusionné §2.5 sur 3–5 participants ; entretiens vague 2 (6–8) sur les signaux ambigus.
- **Semaines 8–12 — Engagements.** Coût plancher + deux offres ; 2–3 LOI à contenu nommé
  (§2.8) dont ≥1 conditionnelle payante ; sélection finale de 2–3 sites.
- **Semaines 12–20 — Pilote fantôme.** 6–8 semaines, 3 sites max, données strictement
  fictives, socle opérationnel minimal prouvé (sauvegardes, monitoring, MFA, release cohérente),
  KPI de l'étude B avec les seuils consolidés §2.6.
- **Ensuite seulement** : décision de productisation (Horizon 2 de l'étude B), dépôts
  réglementaires, et pilote opérationnel limité après GO formel.

**Critères de falsification consolidés** = table de l'étude A (§12) **plus** deux lignes de B :
la ligne « résidence » (aucun chemin d'hébergement acceptable et finançable → pivot ou arrêt
pays) et la ligne « onboarding » (registre non créé en <1 h accompagnée → retravailler avant
tout pilote).

---

## 4. Décisions consolidées à prendre sous 30 jours

| # | Décision | Recommandation consolidée | Conséquence d'un report |
|---|---|---|---|
| 1 | Recentrage segment + gel de la roadmap fonctionnelle | **Oui, immédiatement** (unanime A+B) | Dispersion sans preuve de demande |
| 2 | Règle pays (§2.1) : qualifier un design partner tchadien sous 30 jours, sinon bascule Cameroun | **Lancer la qualification maintenant** ; décision pays à J+30 | Le choix de pays reste un débat d'opinion au lieu d'un fait |
| 3 | Consultation ANSICE/CNBT sur l'hébergement UE (risque létal n°1) | **Oui, en parallèle, dès maintenant** | Découverte tardive d'une contrainte qui invalide l'architecture |
| 4 | Entretiens vague 1 (10, structure §2.4, guide fusionné) | **Oui — meilleur ratio information/coût** | Pilotage à l'aveugle prolongé |
| 5 | Budget du socle opérationnel du pilote | **Conditionner aux 5 premiers entretiens** ; le chiffrer dès maintenant par la méthode du coût plancher (A) | Trop tôt = coût à vide ; trop tard = pilote décalé de 4–6 semaines |

---

## 5. Ce que la confrontation ne peut pas trancher

Aucun arbitrage documentaire ne remplace le terrain sur : la douleur réelle et sa priorité, la
volonté de payer, l'acceptabilité de l'hébergement UE, la valeur perçue de la séparation
d'identité et de la curation, l'adéquation du hors-ligne actuel, et la capacité d'une équipe
d'une personne à soutenir les pilotes. Ces points restent le cœur du programme §3 — et les
critères de falsification s'appliquent quel que soit le document préféré.
