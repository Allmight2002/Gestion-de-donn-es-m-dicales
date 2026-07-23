# Stratégie produit post-MVP — Pertinence de MedData et feuille de route

| Cartouche | |
|---|---|
| Date | 2026-07-16 |
| Auteur | Claude — étude indépendante, à confronter avec [strategie-produit-post-mvp.md](strategie-produit-post-mvp.md) (étude parallèle d'un autre agent) |
| Statut | **PROJET — analyse produit/marché, à confronter au terrain** |
| Périmètre | Analyse stratégique non technique ; aucun audit de code ni de sécurité |
| Méthode | Lecture des documents internes du dépôt + recherche web sourcée (consultations du 2026-07-16) |
| Limite | Aucune donnée d'usage réel n'existe (produit jamais utilisé hors développement/QA) ; toute conclusion « marché » repose sur des sources documentaires, pas sur des entretiens |

Convention d'étiquetage des conclusions : **[FAIT]** fait vérifié · **[INF]** inférence raisonnable ·
**[HYP]** hypothèse à tester · **[MANQUE]** information manquante.

---

## 1. Résumé exécutif

**Le problème visé est réel et documenté.** En Afrique subsaharienne, y compris francophone, le
papier et Excel restent les supports dominants de la donnée clinique de recherche, avec des
conséquences mesurées : erreurs de saisie, retards d'analyse, pertes de données, absence de
traçabilité, risques de confidentialité **[FAIT — littérature citée §17]**. La charge de morbidité
(le cancer devrait presque doubler en 20 ans dans la région) accroît le besoin de registres
**[FAIT]**.

**Mais le besoin n'est pas totalement mal couvert.** REDCap — gratuit pour les institutions à but
non lucratif — est déjà implanté au Cameroun (CRENC/CA-IeDEA à Yaoundé) et largement utilisé en
Afrique **[FAIT]**. DHIS2 est le système national d'information sanitaire du Cameroun **et** du
Tchad **[FAIT]**. KoboToolbox et CommCare couvrent la collecte terrain hors-ligne des ONG. Le
déficit réel se situe dans un interstice précis : **le registre longitudinal de service
hospitalier, tenu par un médecin-chercheur sans serveur, sans équipe informatique et sans budget
dédié** — REDCap exige un serveur et un support informatique interne (sa licence interdit la
sous-traitance) **[FAIT]**, les outils ONG ne sont pas des registres patient-centrés, et Excel
reste le concurrent n°1.

**L'état réel du produit impose de la lucidité.** Le MVP est techniquement avancé (déployé en
démo, ~650 tests automatisés, séparation identité/analytique appliquée en base), mais : (i) la
readiness de production n'est **pas démontrée** (sauvegardes, monitoring, release cohérente,
MFA — matrice du 2026-07-16) ; (ii) **aucun utilisateur réel** n'a jamais utilisé le produit ;
(iii) le cadre juridique tchadien et camerounais n'est qu'à l'état de dossiers modèles non
validés ; (iv) le projet dépend d'une seule personne. Un précédent important : pour le projet
CA-IeDEA, le comité d'éthique camerounais a demandé que les données restent **hébergées dans le
pays** — ce qui questionne frontalement l'hébergement UE de MedData **[FAIT pour ce précédent ;
HYP pour sa généralisation]**.

**Recommandation principale : poursuivre en réduisant le périmètre.** Cibler exclusivement le
**registre spécialisé monocentrique d'un service hospitalier, au Tchad d'abord**, porté par un
médecin-chercheur, avec 2 à 3 sites « design partners ». Geler le développement de nouvelles
fonctionnalités. Consacrer les 3 à 6 prochains mois à la **validation terrain** (10 à 15
entretiens non orientés, observation de workflows, pilotes à données fictives) et à la levée des
deux incertitudes qui peuvent tout invalider : la **résidence des données** exigée par les
autorités/comités d'éthique, et la **volonté réelle de quitter Excel**. Définir dès maintenant les
critères d'arrêt. Aucune donnée réelle avant validation juridique complète.

**Décisions à prendre sous 30 jours** : (1) acter le segment d'entrée et lancer les entretiens ;
(2) geler la roadmap fonctionnelle ; (3) trancher la question de l'hébergement/résidence avec
l'ANSICE et le CNBT ; (4) choisir l'ancrage institutionnel tchadien ; (5) budgéter le socle
opérationnel minimal (plan Supabase payant, sauvegardes, monitoring) conditionné aux résultats
des entretiens.

---

## 2. Recommandation principale

**Option retenue : poursuivre en réduisant le périmètre à un segment précis** (parmi :
poursuivre à l'identique / réduire le périmètre / repositionner / pivoter / suspendre / arrêter).

- **Pourquoi.** Le problème est documenté et le produit est objectivement proche du cas d'usage
  visé ; mais aucune preuve de demande n'existe encore, et deux hypothèses létales (résidence des
  données, inertie d'Excel) ne se lèvent que par le terrain. Continuer à élargir le produit sans
  ces preuves serait investir à l'aveugle ; arrêter maintenant serait ignorer un interstice de
  marché réel et un actif technique déjà construit.
- **Pour quel segment.** Registre spécialisé de service hospitalier, monocentrique, prospectif,
  au Tchad (pays de lancement déjà acté juridiquement), porté par un médecin-chercheur.
- **Avec quelle proposition de valeur.** « Votre registre de service, structuré et traçable, sans
  serveur ni informaticien, en français, qui tolère les coupures réseau. »
- **Contre quelles alternatives.** D'abord Excel/papier (statu quo), ensuite REDCap auto-hébergé
  (là où une institution a l'infrastructure), enfin les outils de collecte ONG (Kobo/CommCare)
  détournés en pseudo-registres.
- **Hypothèses non validées.** Volonté de changer d'outil ; acceptabilité de l'hébergement UE ;
  volonté/capacité de payer ; capacité d'une équipe d'une personne à assurer support et
  exploitation ; adéquation réelle du workflow de curation.
- **Ce qui ferait changer la recommandation.** Voir §15 (critères de pivot/arrêt).

---

## 3. Définition du problème et des utilisateurs

### 3.1 Le problème

- **Quel problème ?** Des médecins-chercheurs constituent des registres de patients (suivis
  longitudinaux, séries de cas, cohortes de service) sur papier puis Excel : structure de
  variables instable, doublons, valeurs aberrantes non détectées, aucune traçabilité des
  corrections, identité et données cliniques mélangées dans un même fichier qui circule par
  clé USB ou WhatsApp, perte de données, impossibilité de collaborer proprement **[INF — motif
  récurrent de la littérature LMIC citée §17 ; à confirmer par entretiens locaux]**.
- **Qui le rencontre ?** Médecins investigateurs hospitaliers, internes/doctorants (thèses),
  équipes de recherche clinique, data managers là où ils existent **[HYP pour la pondération
  relative de ces profils au Tchad/Cameroun]**.
- **À quelle fréquence ?** À chaque projet de recherche, mémoire ou registre de service ; la
  saisie est quotidienne ou hebdomadaire pendant des mois à années **[INF]**.
- **Conséquences.** Heures perdues en nettoyage, analyses retardées ou invalides, publications
  compromises, risques déontologiques (fichiers identifiants non protégés), perte définitive de
  données à un départ ou une panne **[FAIT au niveau général — littérature ; HYP pour la
  quantification locale]**.
- **Comment est-il résolu aujourd'hui ?** Papier + Excel majoritairement ; REDCap dans les
  institutions connectées à des réseaux internationaux (IeDEA, universités partenaires) ; Kobo
  pour les collectes d'enquête ; DHIS2 pour le suivi programmatique national **[FAIT]**.
- **Le problème est-il assez douloureux pour provoquer un changement ?** **[HYP — c'est LA
  question centrale des entretiens.]** La douleur est réelle mais chronique et tolérée ; le coût
  du changement (paramétrage, formation, discipline de saisie) est immédiat, le bénéfice différé.

### 3.2 Utilisateur, bénéficiaire, prescripteur, décideur, payeur

| Rôle | Qui (probable) | Remarque |
|---|---|---|
| Utilisateur quotidien | Médecin, interne, infirmier de recherche, data clerk | Saisit et corrige ; sa friction décide de l'adoption |
| Bénéficiaire | Investigateur principal (publications), service, patients (indirect) | |
| Prescripteur | Chef de service, collègue déjà convaincu, réseau de recherche | Le bouche-à-oreille académique compte |
| Décideur | Chef de service / investigateur principal (mono-site) ; direction + comité d'éthique dès que institutionnel | Cycle court en mono-site, long en institutionnel |
| Payeur | Financement de projet (grant), ONG, université, budget de service, ou personne (auto-financement) | **[MANQUE — aucune donnée sur les budgets réellement disponibles au Tchad/Cameroun ; à documenter en entretien]** |

Cette dissociation est structurante : l'utilisateur qui souffre d'Excel n'est souvent **pas**
celui qui peut payer. Le modèle économique devra viser le payeur (projet financé, ONG,
partenariat institutionnel), pas le médecin isolé **[INF]**.

### 3.3 Ce que MedData est réellement aujourd'hui (statut par fonctionnalité)

Distinction exigée : envisagé / implémenté / déployé / validé / dépendant d'un processus humain.

| Capacité | Statut réel |
|---|---|
| Registre patient-centré, gabarits versionnés, saisie contrôlée, corrections journalisées | Implémenté, déployé (démo), testé automatiquement ; **jamais validé par un usage réel** |
| Séparation identité / analytique / documents bruts (RLS), âge calculé serveur | Implémentée et testée (suites RLS) ; déployée ; non confrontée à un audit externe indépendant récent ni à un usage réel |
| Curation (structuration de documents dé-identifiés par un curateur) | Implémentée ; **aucun curateur réel ne l'a jamais utilisée** — adéquation au terrain = hypothèse |
| Import CSV/XLSX + assistant « gabarit depuis mon Excel » | Implémenté (Phase 1 + F1) ; validé par tests ; non validé par de vrais fichiers de terrain |
| Cohortes figées, exports CSV/XLSX sans identité, codebook | Implémenté ; preuve staging du candidat actuel incomplète (readiness 2026-07-16) |
| Hors-ligne (lecture + corrections avec conflits) | Implémenté ; **désactivé par principe pour toute donnée réelle** tant que chiffrement/MDM non traités → promesse conditionnelle |
| Antivirus strict, sauvegardes, monitoring, release cohérente, MFA | **Non conformes ou non prouvés** (matrice readiness) — bloquants avant tout usage sérieux |
| Cadre juridique Tchad/Cameroun | Dossiers modèles v0 ; **aucune validation par conseil local, aucun avis éthique, aucun DPA signé** — entièrement dépendant de processus humains |
| DocAssist (aide documentaire), quarantaine physique complète, règles inter-champs côté serveur | Envisagés, non intégrés |

**Conclusion honnête** : MedData est un **prototype avancé et déployable**, pas un produit
exploitable. Le marketing devra dire « pilote », pas « production ».

---

## 4. Hypothèses importantes (héritées du brief, confirmées ou corrigées)

| Hypothèse initiale | Verdict après recherche |
|---|---|
| Marché initial : Cameroun et Tchad | Plausible mais asymétrique. Tchad : autorité (ANSICE) opérationnelle, pas de REDCap documenté, DHIS2 national récent **[FAIT]** ; Cameroun : loi 2024/017 en vigueur avec échéance de conformité juin 2026, autorité en cours d'installation, **REDCap déjà implanté** (CRENC/IeDEA) **[FAIT]** → le Tchad comme porte d'entrée est cohérent |
| Extension : Afrique francophone subsaharienne | Cohérente à long terme (registres cancer AFCRN/GFAOP actifs dans ≥6 pays francophones **[FAIT]**), mais prématurée : rien avant preuve mono-pays |
| Utilisateurs : médecins investigateurs, équipes hospitalières, data managers, universités, ONG, réseaux de registres | Liste trop large. Les ONG sont bien servies (Kobo/CommCare/DHIS2) ; les réseaux de registres cancer ont CanReg5 (IARC, gratuit, français) **[FAIT]** → recentrer sur médecins investigateurs et équipes hospitalières de recherche |
| Connectivité irrégulière, ressources limitées, Excel/papier dominants | Confirmé par la littérature (coupures électriques et réseau citées comme obstacles majeurs à REDCap au Cameroun même) **[FAIT]** |
| Exigences de confidentialité et traçabilité | Confirmées et croissantes (lois 2015 Tchad / 2024 Cameroun) **[FAIT]** ; mais attention : la conformité est une **exigence d'entrée**, pas un argument de vente suffisant |

Hypothèse **non listée dans le brief mais critique** : l'hébergement UE (Supabase `eu-west-3`)
sera accepté par les autorités et comités d'éthique. Le précédent CA-IeDEA (données exigées
dans le pays au Cameroun) montre que ce n'est pas acquis **[HYP à lever en priorité absolue]**.

---

## 5. Paysage des solutions existantes

Panorama (12 solutions représentatives examinées, sources §17) :

1. **Excel / papier / Google Forms** — statu quo dominant.
2. **REDCap** (Vanderbilt) — EDC académique de référence, gratuit pour institutions à but non
   lucratif membres du consortium ; auto-hébergement obligatoire, support informatique **interne**
   exigé (la licence interdit les prestataires tiers) ; app mobile hors-ligne à synchronisation
   manuelle **[FAIT]**.
3. **REDCap hébergé (fee-based)** — Vanderbilt et des tiers proposent l'hébergement payant pour
   qui ne peut pas rejoindre le consortium **[FAIT ; tarifs non publics — MANQUE]**.
4. **OpenClinica** — Community Edition open source (sans support), Enterprise commercial
   (~1 000 $/mois selon agrégateurs tiers, **tarif officiel non public**) ; orienté essais
   réglementés **[FAIT/INF]**.
5. **KoboToolbox** — collecte d'enquêtes humanitaire, hors-ligne, plan gratuit ONG
   (5 000 soumissions/mois) puis 21–166 $/mois ; orienté formulaires, pas registre patient
   **[FAIT]**.
6. **ODK** — même famille que Kobo ; auto-hébergement gratuit, cloud 199–499 $/mois **[FAIT]**.
7. **DHIS2 + Tracker** — gratuit open source, **système national au Cameroun et au Tchad** ;
   Tracker gère du longitudinal individuel hors-ligne ; conçu pour le suivi programmatique de
   santé publique, pas pour l'EDC de recherche ; nécessite un implémenteur (HISP, Bluesquare…)
   **[FAIT]**.
8. **CommCare** (Dimagi) — case management hors-ligne first, 100 $+/mois + 2 $/utilisateur ;
   orienté agents de santé communautaires et programmes ONG **[FAIT]**.
9. **Castor EDC** — commercial ; gratuité limitée (étude mono-institut ≤ 12 mois ≤ 125
   inclusions ; programme Impact très restreint) ; jugé cher pour chercheurs indépendants de pays
   à revenu intermédiaire **[FAIT]**.
10. **Dacima Clinical Suite** — CRO/EDC tuniso-canadien, bilingue FR/EN, registres et essais,
    conforme CFR 21 Part 11 ; **tarifs non publics** ; présence maghrébine plutôt que
    subsaharienne **[FAIT/INF]**.
11. **Voozanoo/Epistudy** (Epiconcept, France) — plateforme francophone d'études épidémiologiques
    et registres, hébergement certifié HDS/ISO 27001 ; projets sur mesure, **tarifs non publics**,
    marché principalement français/européen **[FAIT/INF]**.
12. **Epi Info** (CDC) — historiquement répandu ; **développement et support arrêtés depuis
    septembre 2025, sans remplaçant CDC** — un vide se crée pour ses utilisateurs **[FAIT]**.
13. **CanReg5** (IARC) — gratuit, open source, hors-ligne, en français ; **spécifique aux
    registres du cancer en population** ; standard de fait du réseau AFCRN **[FAIT]**.
14. **Développement interne / prestataire local** — possible mais rare (coût, pérennité) ;
    l'exemple ouest-africain montre la difficulté de maintenir un système maison **[INF]**.

Le marché mondial de l'EDC (~1,5–1,9 Md$ en 2025, croissance ~9–14 %/an selon analystes —
**estimations commerciales à fiabilité limitée**) confirme la dynamique globale mais ne dit rien
de la solvabilité du segment Cameroun/Tchad **[INF]**.

---

## 6. Matrice comparative

### 6.1 Matrice synthétique

| Solution | Segment principal | Forces | Limites | Hors ligne | Personnalisation | Registre longitudinal | Coût connu | Support régional | Pertinence face à MedData |
|---|---|---|---|---|---|---|---|---|---|
| Excel / papier | Tout le monde | Zéro barrière, universel, déjà là | Erreurs, doublons, aucune traçabilité, confidentialité nulle | Oui (natif) | Totale mais indisciplinée | Médiocre (manuel) | ~0 (licences déjà payées) | N/A | **Concurrent n°1** — l'inertie |
| REDCap (consortium) | Recherche académique institutionnelle | Gratuit, standard mondial, riche, communauté | Serveur + IT interne obligatoires (pas de sous-traitance), app mobile à sync manuelle | Partiel (app mobile) | Élevée | Oui (longitudinal + repeating) | Licence 0 $ ; coût réel = serveur + personnel | Via institutions partenaires (existe au Cameroun) | Rival direct **là où l'institution a une DSI** ; inaccessible au service isolé |
| REDCap hébergé payant | Équipes sans consortium | Même produit sans serveur | Tarif non public, hors consortium | Partiel | Élevée | Oui | **[MANQUE]** | Faible | Rival potentiel ; à documenter |
| OpenClinica CE / Enterprise | Essais cliniques réglementés | Open source (CE) ; conformité GCP (Ent.) | CE sans support ; Ent. ~1 000 $/mois (non officiel) | Limité | Moyenne | Moyen (orienté étude, pas patient) | Partiellement | Faible | Peu pertinent pour un registre de service |
| KoboToolbox | ONG, humanitaire, enquêtes | Gratuit ONG, hors-ligne robuste, très connu en Afrique | Formulaire-centré : pas de dossier patient, pas de rôles fins, pas de séparation identité | **Oui (fort)** | Formulaires seulement | Faible (contournements fragiles) | Oui (0–166 $/mois) | Fort (communauté humanitaire) | Rival pour la **collecte**, pas pour le **registre** |
| ODK | Enquêtes terrain | Open source, hors-ligne éprouvé | Même limite formulaire-centrée ; self-host technique | **Oui (fort)** | Formulaires | Faible | Oui (0 ou 199–499 $/mois) | Moyen | Idem Kobo |
| DHIS2 Tracker | Programmes nationaux de santé | Gratuit, **déjà national au Cameroun et Tchad**, longitudinal, hors-ligne Android | Conçu pour le programmatique ; paramétrage recherche lourd ; nécessite implémenteur ; gouvernance ministérielle | **Oui** | Élevée mais experte | Oui (case-based) | Licence 0 ; coût = implémenteur/hébergement | **Fort** (HISP, ministères) | Rival sérieux pour registres **institutionnels/programmatiques** ; peu adapté au registre de recherche d'un service |
| CommCare | Programmes ONG, ASC | Hors-ligne first, case management longitudinal | Orienté programmes ; coût par utilisateur ; pas un outil de recherche clinique | **Oui (fort)** | Moyenne | Oui (cases) | Oui (100 $+/mois + 2 $/util.) | Moyen | Rival sur programmes ONG — segment à ne pas viser |
| Castor EDC | Essais académiques/industriels | UX moderne, conformité | Gratuité très limitée ; cher pour PRFI | Limité | Élevée | Moyen | Partiel (free tier public) | Faible | Peu accessible dans le contexte cible |
| Dacima | Registres/essais, francophone | FR/EN, CFR 21, registres | Tarif non public ; empreinte maghrébine | **[MANQUE]** | Élevée | Oui | Non | Maghreb | Rival francophone crédible sur appels d'offres |
| Voozanoo/Epistudy | Épidémiologie francophone | Plateforme registres FR, hébergement HDS | Sur mesure, coût probable élevé, focalisée France | **[MANQUE]** | Élevée (low-code) | Oui | Non | Faible en Afrique | Rival sur projets institutionnels financés |
| Epi Info | Épidémiologie de terrain | Gratuit, historique | **Abandonné (09/2025)** | Oui | Moyenne | Faible | 0 | Nul désormais | Opportunité : base installée orpheline |
| CanReg5 | Registres du cancer en population | Gratuit, IARC, français, standard AFCRN | Cancer uniquement, saisie type registre population | Oui | Faible (cancer) | Oui (cancer) | 0 | Fort (AFCRN, Abidjan) | Ne pas concurrencer frontalement ; segment cancer-population à éviter |

### 6.2 Comparaison approfondie (MedData vs 4 alternatives les plus pertinentes)

Importance : ★★★ critique · ★★ importante · ★ secondaire. Pas de score chiffré : les données
publiques ne permettent pas une notation fiable ; les cellules décrivent l'état des preuves.

| Critère de décision | Importance | MedData | REDCap (auto-hébergé) | KoboToolbox | DHIS2 Tracker | Excel/papier | Niveau de preuve |
|---|---:|---|---|---|---|---|---|
| Registre longitudinal patient-centré | ★★★ | Cœur du modèle (patient + rencontres) | Oui (longitudinal) | Non (formulaires) | Oui (case-based, orienté programme) | Manuel, fragile | FAIT (docs produits) |
| Fonctionne sans serveur ni DSI locale | ★★★ | Oui (SaaS mutualisé) | **Non** (serveur + IT interne exigés par licence) | Oui (cloud) | Non (implémenteur requis) | Oui | FAIT |
| Hors-ligne réel sur le terrain | ★★★ | Lecture + corrections (PWA) ; **désactivé pour données réelles** tant que MDM/chiffrement absents | App mobile, sync manuelle, réputée délicate | Fort (ODK-based) | Fort (Android) | Total | FAIT pour les capacités ; HYP pour l'adéquation terrain de MedData |
| Séparation identité / données d'analyse | ★★ | Structurelle (2 tables sans FK, RLS, curation sans identité) | Possible par paramétrage (DDE, DAGs), non structurel | Non | Partielle (attributs), non conçue pour ça | Aucune | FAIT (docs internes) ; la **valeur perçue** par les utilisateurs = HYP |
| Curation / qualité (complétude, corrections tracées, règles) | ★★ | Implémenté (files « à compléter », motifs, journal) | Data quality module, requêtes | Basique | Validation de formulaires | Aucune | FAIT ; efficacité réelle = HYP |
| Démarrage depuis un fichier Excel existant | ★★ | Assistant dédié (gabarit + base depuis fichier) | Import dictionnaire (format à préparer) | Import XLSForm (technique) | Non trivial | N/A | FAIT |
| Interface et accompagnement en français | ★★ | FR natif + porteur francophone | Modules de langue existants ; support = anglophone majoritaire | FR disponible | FR disponible | N/A | FAIT pour MedData ; INF pour la qualité comparée |
| Coût total pour un service hospitalier | ★★★ | Potentiellement bas (mutualisé) ; **modèle tarifaire inexistant à ce jour** | Licence 0 mais serveur + électricité + personnel IT | 0 à ~166 $/mois | 0 licence mais projet d'implémentation | ~0 | INF ; MANQUE (tarif MedData non défini) |
| Conformité protection des données / résidence | ★★★ | Dossiers Tchad/Cameroun préparés mais non validés ; hébergement UE = transfert international à autoriser | Hébergement **dans le pays possible** (atout décisif si résidence exigée) | Cloud (UE/US) ou self-host | Hébergement national (ministère) possible | Aucune conformité | FAIT pour les architectures ; HYP pour l'acceptabilité MedData |
| Essais réglementés (GCP, CFR 21) | ★ | Non visé | Partiel (dépend de l'instance) | Non | Non | Non | FAIT |
| Maturité, pérennité, communauté | ★★★ | **Très faible** (équipe d'une personne, produit jamais utilisé) | Très forte (consortium mondial, 20 ans) | Forte | Très forte (70+ pays) | Maximale | FAIT |
| Audit, traçabilité, rôles fins | ★★ | Journal infalsifiable, 5 permissions granulaires | Fort (audit trail, rôles) | Basique | Moyen | Nul | FAIT (docs) — sur ce critère MedData atteint la **parité**, pas un avantage |

**Lecture.** MedData ne gagne ni sur la maturité, ni sur le prix (REDCap/DHIS2 sont gratuits en
licence), ni sur la conformité formelle. Son espace défendable est la **combinaison** : registre
patient-centré + zéro infrastructure locale + français + tolérance au réseau + import Excel +
séparation d'identité pensée pour la collaboration pseudonymisée. Aucun concurrent ne coche ces
six cases ensemble **[INF]** — mais personne n'a encore prouvé que des utilisateurs paieraient
pour cette combinaison **[HYP]**.

---

## 7. Segments et cas d'usage prioritaires

### 7.1 Évaluation des segments

| Segment | Besoin | Fréquence | Solutions actuelles | Capacité/volonté de payer | Cycle de décision | Exigences réglementaires | Adéquation MVP | Potentiel d'expansion |
|---|---|---|---|---|---|---|---|---|
| **Registre spécialisé d'un service hospitalier** | Fort | Continu | Excel/papier | Faible-moyenne (budget service/projet) | Court (chef de service) | Éthique + autorité DP | **Élevée** — le produit a été conçu pour ça | Bon (essaimage par spécialité) |
| Recherche monocentrique (étude ponctuelle, thèse) | Fort | Épisodique | Excel, Kobo, Google Forms | Très faible | Très court | Éthique allégée | Bonne | Volume élevé mais LTV faible ; canal d'évangélisation |
| Réseau multicentrique | Fort | Continu | REDCap, plateformes ad hoc | Moyenne-forte (grants) | Long (12-24 mois) | Lourdes (multi-pays, DTA) | Partielle (multi-sites non éprouvé) | Fort mais prématuré |
| Registre de pathologie national (ex. cancer) | Fort | Continu | CanReg5, DHIS2 | Institutionnelle | Très long | Lourdes | Faible (CanReg5 = standard) | À éviter frontalement |
| Projet universitaire (encadrement de thèses) | Moyen | Récurrent | Excel | Faible mais mutualisable (convention) | Moyen | Éthique académique | Bonne | Canal de distribution intéressant |
| Programme d'ONG | Moyen | Continu | Kobo, CommCare, DHIS2 | **Bonne** (budgets bailleurs) | Moyen | Bailleur-dépendantes | Moyenne (pas un outil programme) | Risque de dispersion produit |
| Étude clinique réglementée | Fort | Épisodique | OpenClinica, Castor, CRO | Bonne | Long | **Très lourdes (GCP/CFR 21)** | **Nulle à ce stade** | Hors de portée MVP |
| Surveillance épidémiologique | Fort | Continu | DHIS2 (national) | Étatique | Très long | Souveraineté | Faible | Territoire DHIS2 |

### 7.2 Segment prioritaire et cas d'usage d'entrée

**Segment prioritaire** : le **service hospitalier tchadien (puis camerounais) tenant ou voulant
tenir un registre de sa spécialité**, porté par un médecin-chercheur identifié, 1 à 5
utilisateurs, monocentrique, prospectif.

**Cas d'usage d'entrée** : « **J'ai déjà un fichier Excel de mes patients ; transformez-le en
registre propre.** » — l'assistant d'import existant (fichier → gabarit → base → données) est
exactement ce geste ; c'est le chemin de moindre résistance psychologique, car il valorise le
travail déjà accompli au lieu de le nier **[INF]**.

**Segment secondaire assumé (canal, pas cible commerciale)** : thèses et mémoires encadrés — ils
forment les futurs prescripteurs, à coût marginal quasi nul, si et seulement si le support reste
soutenable.

---

## 8. Jobs-to-be-done, proposition de valeur et positionnement

### 8.1 Jobs-to-be-done principaux

| Job | Excel | REDCap auto-hébergé | Kobo | MedData (état actuel) |
|---|---|---|---|---|
| Créer rapidement un registre à partir de l'existant | Immédiat mais informe | Lent (serveur, dictionnaire) | Rapide mais formulaire | Rapide (assistant Excel) — **à chronométrer en pilote** |
| Harmoniser et versionner les variables | Non | Oui | Partiel | Oui (gabarits versionnés) |
| Saisir/corriger au quotidien avec le réseau qui tombe | Oui (local) | Moyen | Oui | Partiel (lecture+corrections hors-ligne ; création en ligne seulement) |
| Collaborer sans exposer l'identité | Non | Configurable | Non | Oui (structurel) |
| Produire une cohorte/un export exploitable et reproductible | Manuel | Oui | Export brut | Oui (cohortes figées, dictionnaire) |
| Démontrer la traçabilité aux pairs/à l'éthique | Non | Oui | Partiel | Oui (journal) |
| Ne dépendre de personne pour l'infrastructure | Oui | **Non** | Oui | Oui |

### 8.2 Phrase de positionnement (à tester, non validée)

> « Pour **le médecin-chercheur hospitalier d'Afrique francophone** qui **tient le registre de
> son service sur Excel au prix d'erreurs, de pertes et de risques de confidentialité**, MedData
> est **une plateforme de registre clinique pseudonymisé** qui **transforme ce fichier en base
> structurée, traçable et prête pour la publication, sans serveur ni équipe informatique**.
> Contrairement à **Excel ou à REDCap auto-hébergé**, MedData **sépare l'identité des données
> d'analyse au niveau même de la base, tolère les coupures de réseau et s'accompagne en
> français**. »

Règle d'usage : ne pas employer cette phrase en externe tant qu'elle n'a pas survécu à une
dizaine d'entretiens et à un pilote.

---

## 9. Forces et faiblesses de MedData

**Forces (réelles, vérifiables)**
- Modèle registre/patient conçu pour le cas d'usage cible, pas adapté après coup **[FAIT]**.
- Séparation identité/analytique structurelle + curation sans identité : design distinctif sur le
  marché étudié **[FAIT pour l'existence ; HYP pour la valeur commerciale]**.
- Barrière d'entrée basse : import Excel, bibliothèque de gabarits, PWA installable, fr/en **[FAIT]**.
- Coût d'infrastructure marginal très bas (mutualisation Supabase) → peut viser un prix
  soutenable pour la région **[INF]**.
- Discipline d'ingénierie (tests RLS systématiques, audits itératifs, honnêteté documentaire) —
  un actif de crédibilité vis-à-vis d'un comité d'éthique **[FAIT]**.

**Faiblesses (à ne pas minimiser)**
- **Zéro usage réel, zéro preuve de demande.** Tout le reste est secondaire **[FAIT]**.
- Readiness opérationnelle non démontrée : sauvegardes, monitoring, release cohérente, MFA,
  secrets — matrice du 2026-07-16 **[FAIT]**.
- Dépendance à une personne (développement, support, exploitation, juridique) **[FAIT]**.
- Cadre juridique entièrement à l'état de projet ; hébergement UE potentiellement inacceptable
  selon les autorités (précédent camerounais de résidence locale) **[FAIT/HYP]**.
- Pas de modèle économique, pas d'entité de portage, pas de structure de support **[FAIT]**.
- Hors-ligne réel bridé (désactivé pour données réelles sans MDM) alors que c'est un argument
  d'appel — risque de promesse déceptive **[FAIT]**.
- La sécurité (RLS, audit) est en grande partie une **exigence minimale du domaine santé**, pas
  un différenciateur commercial : elle permet d'exister, pas de gagner **[INF]**.

---

## 10. Risques d'adoption

| Friction | Gravité | Commentaire / mitigation envisageable |
|---|---|---|
| Inertie d'Excel (« ça marche assez bien ») | **Critique** | Seul l'import sans douleur + un bénéfice visible en <1 semaine peuvent la vaincre ; à mesurer en pilote |
| Résidence des données (hébergement UE) | **Critique** | À trancher avec ANSICE/CNBT **avant** d'investir ; plan B à chiffrer : instance Supabase self-hosted ou hébergeur régional — coût et faisabilité **[MANQUE]** |
| Temps de paramétrage initial + discipline de saisie | Élevée | Assistant Excel + gabarits de spécialité ; onboarding accompagné obligatoire au début |
| Formation et rotation du personnel | Élevée | Sessions courtes, guides FR, comptes de démo ; mesurer le volume de support/site |
| Connectivité et électricité | Élevée | PWA + hors-ligne (mais bridé pour données réelles → à résoudre avant de le vendre) |
| Confiance dans un outil « d'une seule personne » | Élevée | Transparence, engagement de réversibilité (export complet), à terme structure de portage |
| Administration des comptes non self-service | Moyenne | Friction assumée du MVP ; acceptable en pilote accompagné, bloquante à l'échelle |
| Financement local de l'abonnement | Élevée | Cibler les payeurs solvables (projets financés, conventions universitaires, ONG partenaires) |
| Conformité (autorisation ANSICE, éthique CNBT, DPA) | Élevée | Chemin critique administratif : démarrer tôt, en parallèle du pilote fictif |
| Intégration au flux clinique (saisie pendant le soin) | Moyenne | Mode « tournée » mobile = plus tard, seulement si le pilote le réclame |

---

## 11. Programme de validation terrain

Objectif : remplacer les hypothèses par des preuves, en ~90 jours, à coût minimal, **sans aucune
donnée réelle**.

### 11.1 Entretiens (phase 1, semaines 1–6)

- **Profils** : 8–10 médecins-chercheurs hospitaliers (Tchad prioritairement, Cameroun ensuite),
  2–3 internes/doctorants en fin de thèse, 2 data managers/statisticiens travaillant sur des
  études locales, 1–2 responsables d'établissement ou de comité scientifique, 1 représentant ONG
  santé, si possible 1 personne ayant utilisé REDCap ou Kobo localement.
- **Critères de recrutement** : avoir mené ou tenté un recueil de données cliniques dans les 24
  derniers mois ; diversité de spécialités et de niveaux d'équipement ; inclure des sceptiques,
  pas seulement le réseau proche du porteur (biais de complaisance — le porteur étant lui-même
  l'archétype de l'utilisateur cible, il faut des contradicteurs).
- **Guide d'entretien non orienté** (jamais « utiliseriez-vous MedData ? ») :
  1. « Parlez-moi du dernier recueil de données que vous avez mené : comment avez-vous fait,
     concrètement, du premier patient à l'analyse ? »
  2. « Montrez-moi le fichier/le cahier. Qui y touche ? Où est-il stocké ? Que s'est-il déjà
     perdu ? »
  3. « Qu'est-ce qui vous a coûté le plus de temps ? Le plus d'argent ? Qu'avez-vous bricolé
     pour contourner ? »
  4. « Avez-vous déjà essayé un outil (REDCap, Kobo, autre) ? Pourquoi avez-vous continué /
     arrêté ? »
  5. « Sur votre dernier projet, quel budget existait pour les données ? Qui l'a décidé ? »
  6. « Qui devrait dire oui pour qu'un nouvel outil entre dans votre service ? Racontez la
     dernière fois qu'un outil a été adopté (ou rejeté). »
  7. « Que dirait votre comité d'éthique d'un hébergement des données en Europe ? Cela s'est-il
     déjà posé ? »
- **Signaux recherchés** : récits de pertes de données, contournements coûteux, budgets déjà
  dépensés (preuve de volonté de payer passée), citations verbatim sur la résidence des données.

### 11.2 Observation et test (phase 2, semaines 4–10)

- **Observation de workflow** : 2–3 demi-journées dans un service (saisie réelle sur Excel/
  papier), chronométrage du circuit d'une donnée.
- **Test du MVP en conditions réelles simulées** : 3–5 utilisateurs recrutés en entretien,
  chacun apporte **son propre fichier Excel anonymisé/fictif** ; tâches mesurées : créer le
  registre depuis le fichier, saisir 5 rencontres, corriger une valeur, produire un export.
  Mesures : temps, blocages, aide nécessaire, verbalisation.
- **Pilote à données fictives** (2–3 semaines par site, 2–3 sites design partners) : usage
  quotidien simulé (données fictives ou pseudo-données générées), avec le socle opérationnel
  minimal en place ; mesure des KPI d'activation (§12).

### 11.3 Preuves d'engagement (phase 3, semaines 8–12)

- **Test de volonté de payer** : présenter 2–3 formules tarifaires hypothétiques (par base/an,
  par site/an, adossée à un projet financé) et demander non pas « paieriez-vous ? » mais « sur
  quel budget de votre dernier projet cela aurait-il été imputé, et qui signait ? ».
- **Lettres d'intention** : viser 2–3 LOI de sites pilotes (engagement non financier : temps,
  terrain, données fictives, feedback) et si possible 1 LOI conditionnelle payante.
- **Validation réglementaire parallèle** : consultation formelle ANSICE + avis préliminaire CNBT
  sur l'architecture (hébergement UE, pseudonymisation) — c'est une validation terrain au même
  titre que les entretiens.

### 11.4 Critères d'abandon ou de révision d'hypothèse (fixés à l'avance)

- <30 % des interviewés racontent spontanément une douleur forte (perte, erreur coûteuse,
  budget dépensé) → réviser le problème.
- Aucun site ne signe de LOI après 12 entretiens et 3 démos → réviser le segment ou suspendre.
- ANSICE/CNBT indiquent qu'un hébergement hors du pays est rédhibitoire **et** qu'aucun plan B
  d'hébergement local n'est finançable → pivot d'architecture ou arrêt.
- Les testeurs n'arrivent pas à créer leur registre en <1 h accompagnée → retravailler
  l'onboarding avant tout pilote.
- Personne ne peut nommer un budget imputable → repositionner le modèle économique (subventions,
  partenariats) ou suspendre l'ambition commerciale.

---

## 12. KPI post-MVP

Petit ensemble mesurable, chaque KPI rattaché à une décision. Source principale : la base
elle-même (`audit_log`, journaux applicatifs) + un journal de support tenu manuellement.

| KPI | Définition / calcul | Source | Fréquence | Cible provisoire (pilote) | Limite d'interprétation | Décision éclairée |
|---|---|---|---|---|---|---|
| Sites/équipes pilotes actifs | Sites avec ≥1 écriture / 14 jours | Base (audit) | Hebdo | 2–3 | Petit n : lecture qualitative | Poursuivre/élargir le pilote |
| Délai de création du 1er registre | Inscription → base créée avec gabarit | Base + journal onboarding | Par site | < 1 h accompagnée ; < 1 j en autonomie | Dépend de l'accompagnement | Investir (ou non) dans l'onboarding |
| Délai jusqu'au 1er patient correctement enregistré | Base créée → 1er patient complet valide | Base | Par site | < 7 jours | « Correct » = champs requis valides | Friction de démarrage |
| Taux d'activation | % comptes créés ayant ≥1 patient + ≥3 rencontres sous 30 j | Base | Mensuel | > 60 % | Comptes de curiosité inclus | Qualité du ciblage |
| Utilisateurs actifs par rôle | Actifs 7 j / 30 j, par rôle global | Base | Hebdo | Tendance stable/croissante | Vacances, saisonnalité clinique | Santé d'usage |
| Rétention des équipes | % sites actifs à S+8 après onboarding | Base | Mensuel | > 70 % | n faible | **Signal PMF principal** |
| Fréquence d'utilisation | Jours avec ≥1 saisie / semaine / site | Base | Hebdo | ≥ 2 j/sem | Dépend du flux de patients du service | Ancrage dans la routine |
| Complétude des données | % champs requis renseignés (vue complétude existante) | Base (RPC complétude) | Mensuel | > 80 % à S+8 | Gabarits trop ambitieux la biaisent | Valeur scientifique produite |
| Temps de correction/curation | Délai médian détection → correction ; délai de finalisation | Base (`field_change_log`) | Mensuel | Baisse tendancielle | Peu de cas au début | Utilité du workflow qualité |
| Réussite imports/exports | % imports aboutis sans assistance ; % exports téléchargés | Base + support | Mensuel | > 80 % / > 90 % | Fichiers sources très variables | Robustesse du geste d'entrée |
| Volume de support par site | Heures de support / site / mois | Journal de support | Mensuel | < 4 h/mois après M1 | Sous-déclaration probable | **Scalabilité du modèle** |
| Satisfaction / recommandation | Question unique type NPS ou CSAT en fin de pilote + verbatims | Entretien de sortie | Fin de pilote | ≥ 8/10 chez ≥ 2 sites | Complaisance (relation directe) | Renouvellement du pilote |
| Conversion pilote → engagement | % pilotes signant une suite (convention, LOI payante) | Contrats | Fin de pilote | ≥ 1 site sur 3 | n minuscule | **Go/no-go productisation** |
| Coût d'accompagnement par site | Heures totales (onboarding+support+déplacements) × coût horaire / site | Journal | Par pilote | Documenter (pas de cible) | Première mesure = référence | Modèle économique réaliste |

---

## 13. Feuille de route par horizons

Organisée par **résultats à atteindre**. Effort : S ≈ jours · M ≈ 1–2 semaines · L ≈ 1 mois+
(travail du porteur, développement inclus le cas échéant). Classement : **maintenant / ensuite /
plus tard / à ne pas faire sans preuve**.

### Horizon 0 — Décider et préparer le pilote (mois 0–2) — « maintenant »

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Segment confirmé ou infirmé | Service hospitalier TD | 10–15 entretiens non orientés (guide §11.1) | Douleur récurrente + budgets passés + décideur identifié | ≥ 60 % d'entretiens avec douleur forte documentée | P0 | M | Accès au réseau médical | Biais de complaisance | Verdict écrit : segment confirmé / corrigé |
| Question de résidence tranchée | Tous | Consultation ANSICE + avis préliminaire CNBT sur hébergement UE | Position écrite ou orientation claire | — | **P0 (létal)** | M | Conseil juridique tchadien | Réponse lente ou défavorable | Décision : UE acceptable / plan B chiffré / stop |
| 2–3 design partners engagés | Service hospitalier | Sélection + LOI non financières | LOI signées | 2–3 LOI | P0 | S | Entretiens | Engagements de politesse | LOI avec temps/terrain nommés |
| Socle opérationnel minimal du pilote | Produit | Plan Supabase payant, sauvegardes prouvées, monitoring vert, MFA, release cohérente (reprendre la matrice readiness) | Preuves datées par gate | Runs monitoring verts | P0 | L | Budget (~25–599 $/mois selon plan + outillage) | Sous-estimation du travail d'exploitation | Matrice readiness : gates bloquants du pilote fictif au vert |
| KPI et critères d'arrêt actés | — | Formaliser §12 + §11.4, outiller la mesure | Tableau de bord minimal | — | P1 | S | — | Mesure oubliée en cours de pilote | Document signé par le porteur |
| Positionnement figé pour le pilote | — | Tester la phrase §8.2 en entretiens, la corriger | Reformulations spontanées des interviewés | — | P1 | S | Entretiens | Sur-promesse (hors-ligne, « sécurité ») | Pitch d'une page validé |

### Horizon 1 — Valider l'usage réel (mois 2–6) — « ensuite »

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Un registre fictif vivant par site | Design partners | Pilotes à données fictives, onboarding accompagné, support tracé | Usage répété sans sollicitation | Activation > 60 % ; rétention S+8 > 70 % | P0 | L | H0 complet | Essoufflement post-démo | 2 sites sur 3 actifs à S+8 |
| Frictions principales corrigées | Design partners | Corriger uniquement les blocages observés (pas la roadmap d'idées) | Baisse du support et du temps de tâche | Support < 4 h/site/mois | P0 | M | Pilotes | Retomber dans le développement plaisir | Top-3 frictions closes, mesurées |
| Valeur scientifique démontrée | Design partners | Chaque site produit 1 export/cohorte exploitable présenté à son équipe | Export utilisé dans une réunion/abstract | Complétude > 80 % | P1 | S | Pilotes | Valeur invisible pour le décideur | 1 artefact scientifique par site |
| Volonté de payer objectivée | Payeurs | Entretiens tarifaires (§11.3) + 1 LOI conditionnelle payante | Budget nommé, signataire nommé | ≥ 1 LOI payante | P0 | S | Pilotes en cours | Réponses de politesse | Décision de modèle tarifaire fondée |
| Dossier juridique tchadien en instruction | Tchad | Vérification des textes (ANSICE/JO), finalisation dossiers 00–13, dépôt éthique CNBT préparé | Textes vérifiés ; dossier déposable | — | P0 | L | Conseil juridique local ; **validation professionnelle obligatoire** | Coûts/délais sous-estimés | Dossier prêt à déposer (dépôt = décision H2) |

### Horizon 2 — Productiser (mois 6–12) — « plus tard », conditionné aux preuves H1

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Onboarding répétable sans le fondateur | Nouveaux sites | Guides FR, vidéos, gabarits de spécialité enrichis, comptes self-service sécurisés | Un site onboardé par un tiers | Délai 1er registre < 1 j sans accompagnement | P0 | L | H1 validé | Dépendance au fondateur persistante | 1 onboarding « sans les mains » réussi |
| Modèle économique arrêté | Payeurs | Tarification (site/an ou projet), conventions types, canal (direct, universités, ONG) | 1ers engagements payants | Conversion pilote → contrat ≥ 1/3 | P0 | M | Preuves H1 | Prix insoutenable pour le terrain | 1er revenu contractualisé |
| Exploitation de niveau clinique | Produit | Solder la matrice readiness complète (Edge, ClamAV durable, sauvegardes production, astreinte, secrets) | Toutes gates bloquantes au vert | RPO/RTO approuvés | P0 | L | Budget, éventuel renfort | Charge d'exploitation pour une personne | Readiness « prouvé conforme » |
| Autorisations pour données réelles (Tchad) | Tchad | Dépôts ANSICE + CNBT + ministère ; DPA Supabase signé ; checklist GO/NO-GO | Autorisations obtenues | — | P0 | L (calendrier externe) | H1, conseil juridique | Refus ou conditions coûteuses | **Première donnée réelle autorisée** |
| Réduction du coût d'accompagnement | Tous sites | Formation de relais locaux (super-utilisateurs), FAQ, communauté | Support décroissant | Coût/site en baisse ×2 | P1 | M | Sites actifs | Qualité de support dégradée | Coût/site soutenable au tarif choisi |

### Horizon 3 — Étendre (année 2+) — « à ne pas faire sans preuve supplémentaire »

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| 2e pays (Cameroun) | Services hospitaliers CM | Activer le volet juridique camerounais (loi 2024/017, autorité en installation) + 2 sites | Reproduction du playbook tchadien | Mêmes KPI qu'H1 | P1 | L | PMF tchadien démontré | Autorité DP camerounaise en cours d'installation = incertitude | 2 sites CM actifs et conformes |
| Multi-sites réels (réseau de recherche) | Réseaux | Multicentrique outillé (conventions, DTA, comparabilité inter-sites) | 1 réseau pilote | Sites/réseau actifs | P2 | L | Demande avérée | Complexité gouvernance | 1 réseau signé |
| Interopérabilité | Institutionnels | Exports/API vers outils d'analyse ; étudier passerelle DHIS2 **si demandée** | Demande payée | — | P2 | L | Usage réel | Feature-driven sans preuve | Client qui la finance |
| Fonctionnalités avancées (mode tournée mobile, scores calculés, hors-ligne étendu) | Utilisateurs actifs | Prioriser par usage observé uniquement (réserve d'idées existante) | Demande récurrente mesurée | Usage de la feature | P2 | M–L | H1/H2 | Développer pour un concurrent imaginaire | ≥ 3 sites demandeurs |
| Industrialisation commerciale | — | Structure de portage, équipe, partenariats (universités, sociétés savantes, GFAOP-like) | Pipeline reproductible | CAC mesuré | P2 | L | Revenus H2 | Prématuré = dispersion | Traction payante démontrée |

**À ne pas faire (sans preuve nouvelle)** : viser les essais réglementés (GCP/CFR 21), viser les
registres cancer en population (CanReg5), viser les programmes ONG de collecte terrain
(Kobo/CommCare), développer des fonctionnalités « parce que REDCap les a », étendre à d'autres
pays avant un PMF tchadien, réactiver la promesse hors-ligne clinique avant chiffrement/MDM.

---

## 14. Décisions à prendre dans les 30 prochains jours

1. **Acter le recentrage** sur le segment « registre de service hospitalier monocentrique,
   Tchad » et **geler la roadmap fonctionnelle** (hors frictions bloquantes de pilote).
2. **Lancer le programme d'entretiens** : liste de 15 contacts, guide §11.1, objectif 10
   entretiens réalisés sous 6 semaines.
3. **Engager la consultation ANSICE/CNBT** sur l'hébergement UE (via conseil juridique tchadien)
   — c'est le risque létal n°1, il se lève en parallèle, pas après.
4. **Choisir l'ancrage institutionnel** du pilote (établissement de rattachement tchadien,
   responsable de traitement pressenti) — décision D1 du dossier juridique.
5. **Budgéter le socle du pilote** : plan Supabase payant + sauvegardes + monitoring + temps
   d'accompagnement ; décider si ce budget (ordre de grandeur : quelques centaines de $/mois +
   du temps) est engagé maintenant ou conditionné aux 5 premiers entretiens.

---

## 15. Éléments qui justifieraient un pivot ou un arrêt

**Pivot (changement d'architecture, de segment ou de modèle)** :
- Exigence ferme de résidence des données dans le pays → pivot d'hébergement (instance locale /
  partenaire régional) si finançable ; sinon arrêt du pays concerné.
- Douleur confirmée mais uniquement chez les réseaux financés multicentriques → pivot vers un
  modèle « plateforme de projet » adossée aux grants, cycle plus long.
- Volonté de payer nulle partout mais usage enthousiaste → pivot vers un modèle subventionné
  (ONG, coopération, sociétés savantes) avec MedData comme bien commun accompagné.
- Les utilisateurs veulent avant tout de la collecte mobile hors-ligne de création (pas
  seulement correction) → reconsidérer la priorité technique hors-ligne avant d'élargir.

**Arrêt (ou mise en sommeil)** :
- Critères §11.4 atteints : pas de douleur dominante, pas de LOI, pas de budget nommable.
- Impossibilité juridique durable dans les deux pays cibles.
- REDCap (ou un acteur régional) déployé et supporté dans les établissements cibles avec
  satisfaction — l'interstice se referme.
- Le coût d'exploitation/support dépasse durablement ce qu'une personne peut porter sans
  financement, sans perspective de renfort.

---

## 16. Incertitudes et informations manquantes

- **[MANQUE]** Toute donnée primaire terrain : entretiens, observations, budgets réels des
  équipes de recherche tchadiennes et camerounaises.
- **[MANQUE]** Position de l'ANSICE et du CNBT sur l'hébergement UE ; texte intégral vérifié de
  la loi tchadienne 007/PR/2015 et de son décret (les régimes exacts cités proviennent de
  sources secondaires — validation par un professionnel du droit obligatoire).
- **[MANQUE]** Tarifs réels de REDCap hébergé, Dacima, Voozanoo (non publics) ; présence
  effective de REDCap dans les établissements **tchadiens**.
- **[MANQUE]** Coût et faisabilité d'un plan B d'hébergement local (self-host au Tchad/Cameroun).
- **[HYP]** Valeur perçue de la séparation identité/analytique et du workflow de curation par de
  vrais utilisateurs ; adéquation du hors-ligne actuel aux usages réels.
- **[HYP]** Généralisation du précédent CA-IeDEA (résidence locale) à d'autres comités/autorités.
- **[INF fragile]** Les chiffres de marché EDC proviennent de cabinets d'études commerciaux
  (sources potentiellement biaisées, méthodologies opaques) — utilisés ici comme contexte, pas
  comme preuve.

---

## 17. Sources (consultées le 2026-07-16)

**Internes (dépôt)** : `README.md` ; `docs/cahier-des-charges-metier.md` ;
`docs/readiness-production-2026-07-16.md` ; `docs/deploiement.md` ;
`docs/checklist-fonctionnalites-site.md` ; `docs/idees-fonctionnalites-futures.md` ;
`docs/juridique/README.md` ; `docs/juridique/tchad/00-cadre-applicable.md`.

**REDCap**
- Conditions de licence et consortium : https://projectredcap.org/join/ · https://projectredcap.org/about/faq/
- App mobile hors-ligne : https://projectredcap.org/software/mobile-app/
- Implémentation au Cameroun (CRENC/CA-IeDEA, exigence d'hébergement en pays) : https://pmc.ncbi.nlm.nih.gov/articles/PMC6790220/
- Expérience LMIC (défis personnel/électricité/coût) : https://pubmed.ncbi.nlm.nih.gov/35251887/ · https://pmc.ncbi.nlm.nih.gov/articles/PMC8896572/
- Adoption Tanzanie 2025 : https://www.medrxiv.org/content/10.1101/2025.10.25.25338769.full.pdf

**Autres solutions**
- OpenClinica (CE gratuite sans support ; site éditeur — source intéressée) : https://www.openclinica.com/get-free-community-edition-software/ · tarif Enterprise via agrégateur tiers (non officiel) : https://softwarefinder.com/emr-software/openclinica
- KoboToolbox (tarifs publics) : https://www.kobotoolbox.org/pricing/
- ODK (tarifs publics) : https://getodk.org/
- DHIS2 — transition du Tchad : https://dhis2.org/chad-hmis-transition/ · plan opérationnel Cameroun : http://onsp.minsante.cm/sites/default/files/publications/306/CIS_Cameroon%20DHIS2%20operational%20Plan%202022%20to%202024.pdf · Tracker : https://dhis2.org/tracker-in-action/
- CommCare (tarifs publics ; site éditeur) : https://dimagi.com/commcare-pricing/
- Castor EDC (conditions de gratuité) : https://helpdesk.castoredc.com/hc/en-us/articles/27224738221085 · https://www.castoredc.com/castor-impact-program/
- Dacima (site éditeur — source intéressée) : https://www.dacimasoftware.com/
- Voozanoo/Epistudy (site éditeur) : https://epiconcept.fr/produit/etudes-epidemiologiques
- Epi Info — arrêt du support (09/2025) : https://www.cdc.gov/epiinfo/sunsetnews.html
- CanReg5 (IARC) : https://www.ncbi.nlm.nih.gov/books/NBK566958/ · https://github.com/IARC-CSU/CanReg5

**Contexte problème et registres en Afrique**
- Système de données Afrique de l'Ouest (défis, pérennité) : https://idpjournal.biomedcentral.com/articles/10.1186/s40249-018-0494-4
- Registres cancer Afrique francophone (AFCRN/GFAOP) : https://afcrn.org/index.php/activities/150-projet-registre-du-cancer-pediatrique-des-pays-francophones-d-afrique-subsaharienne · https://www.sciencedirect.com/science/article/abs/pii/S0007455125003807
- Charge du cancer en Afrique subsaharienne (ONU/CIRC) : https://news.un.org/fr/story/2022/05/1119792

**Juridique (interprétation à valider par un professionnel compétent)**
- Cameroun, loi n° 2024/017 du 23/12/2024 (texte officiel) : https://prc.cm/fr/multimedia/documents/10258-loi-n-2024-017-du-23-12-2024-web · échéance de conformité juin 2026 : https://cio-mag.com/protection-des-donnees-au-cameroun-la-course-contre-la-montre-avant-juin-2026/
- Tchad, loi n° 007/PR/2015 (fiche AFAPDP) : https://www.afapdp.org/archives/download-view/tchad-loi-007-pr-2015 · ANSICE : https://ansice.td

**Coûts d'infrastructure MedData**
- Supabase (tarifs publics) : https://supabase.com/pricing

**Marché EDC (contexte, fiabilité limitée — cabinets commerciaux)**
- https://www.grandviewresearch.com/industry-analysis/electronic-data-capture-edc-systems-market · https://www.fortunebusinessinsights.com/electronic-data-capture-market-115364

---

## Ce que nous savons

- Le papier et Excel dominent encore la donnée clinique de recherche en Afrique subsaharienne,
  avec des problèmes de qualité, de traçabilité et de confidentialité documentés (littérature).
- REDCap est gratuit en licence mais exige un serveur et un support informatique **interne**
  (sous-traitance interdite par la licence) — inaccessible à un service sans DSI ; il est déjà
  implanté au Cameroun (CRENC/IeDEA).
- Au moins un comité d'éthique camerounais a exigé l'hébergement des données **dans le pays**
  (précédent CA-IeDEA) ; l'hébergement UE de MedData n'est donc pas acquis.
- DHIS2 est le système national du Cameroun et du Tchad (programmatique) ; CanReg5 est le
  standard gratuit des registres cancer ; Kobo/CommCare/ODK couvrent la collecte ONG hors-ligne ;
  Epi Info est abandonné depuis septembre 2025.
- Aucune solution étudiée ne combine : registre patient-centré + zéro infrastructure locale +
  français + tolérance réseau + import Excel + séparation structurelle de l'identité.
- MedData est un prototype avancé, déployé en démo avec ~650 tests, mais sa readiness de
  production n'est pas démontrée (sauvegardes, monitoring, release, MFA), son cadre juridique
  est à l'état de projet, il n'a **aucun utilisateur réel** et dépend d'une seule personne.
- Le Cameroun dispose depuis décembre 2024 d'une loi de protection des données avec échéance de
  conformité en juin 2026 ; le Tchad a une autorité opérationnelle (ANSICE) qui statue sous un
  mois.

## Ce que nous supposons encore

- Que la douleur d'Excel est assez forte pour provoquer un changement d'outil et de discipline
  de saisie — à tester par entretiens et pilotes, pas par démos.
- Que des payeurs identifiables (projets financés, conventions, ONG) existent au Tchad et au
  Cameroun pour un abonnement de l'ordre de quelques centaines d'euros par site et par an.
- Que l'hébergement UE sera acceptable pour l'ANSICE et le CNBT (ou qu'un plan B local est
  finançable).
- Que la séparation identité/analytique et la curation sans identité ont une valeur perçue par
  les utilisateurs, et pas seulement une valeur de conformité.
- Que le hors-ligne actuel (lecture + corrections) suffit aux usages réels de terrain.
- Qu'une équipe d'une personne peut assurer onboarding, support et exploitation de 2–3 pilotes
  sans dégrader le produit.

## Ce que nous devons décider maintenant

| # | Décision | Recommandation | Conséquence d'un report |
|---|---|---|---|
| 1 | Recentrer le périmètre sur le registre de service hospitalier monocentrique (Tchad) et geler la roadmap fonctionnelle | **Oui, immédiatement** | Dispersion continue ; l'énergie part dans des fonctionnalités sans preuve de demande |
| 2 | Lancer les entretiens terrain (10–15, guide §11.1) | **Oui — c'est l'investissement au meilleur ratio information/coût** | Chaque mois sans données primaires prolonge le pilotage à l'aveugle |
| 3 | Consulter ANSICE/CNBT sur l'hébergement UE via un conseil juridique tchadien | **Oui, en parallèle des entretiens** | Risque de découvrir tard qu'une contrainte létale invalide l'architecture ; tout le reste serait à refaire |
| 4 | Choisir l'ancrage institutionnel tchadien (responsable de traitement pressenti) | **Oui — conditionne l'éthique, les LOI et la crédibilité** | Sans établissement, ni dépôt éthique ni pilote crédible ne sont possibles |
| 5 | Engager le budget du socle opérationnel du pilote (plan Supabase payant, sauvegardes, monitoring) | **Conditionner aux 5 premiers entretiens** : si la douleur se confirme, engager ; sinon, réévaluer | L'engager trop tôt = coût à vide ; trop tard = pilote retardé de 4–6 semaines |
