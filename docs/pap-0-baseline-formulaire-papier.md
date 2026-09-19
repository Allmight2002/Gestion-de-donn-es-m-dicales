# PAP-0 — baseline mesurée de l'impression d'un formulaire

- Mesure du : **2026-09-18**.
- Statut : 🗄️ **preuve datée** — elle décrit ce que produit le dépôt à cette date, pas une cible.
- Lot : [PAP-0](lots-formulaire-papier.md#pap-0) du chantier
  [formulaire papier compact](spec-formulaire-papier.md).
- Cible de mesure : **poste local**, serveur de développement Vite, Chromium de Playwright
  (`chromium_headless_shell-1228`). Aucune cible distante, aucune donnée réelle.
- Relevés bruts reproductibles : [`pap-0-baseline-releves.json`](pap-0-baseline-releves.json).

**Ce que ce document prouve.** Combien de pages coûte aujourd'hui l'impression d'un formulaire
vierge MedData, ce que cette hauteur contient réellement, et où passe le reste. Les seuils de
PAP-1 à PAP-4 en découlent.

**Ce qu'il ne prouve pas.** Aucun formulaire papier n'a été implémenté, aucune impression
physique n'a eu lieu, aucun étudiant n'a rempli d'exemplaire. Le confort réel de remplissage
reste à établir par PAP-4.

## 1. Point de départ : il n'existe aucun rendu papier

Le dépôt ne contient, à cette date, **aucune** règle `@media print`, **aucune** règle `@page`
et **aucun** appel à `window.print()` : la recherche sur `src/`, `index.html` et les bancs de
vérification ne remonte que des occurrences du mot `fingerprint`. Il n'existe donc ni action
« Imprimer le formulaire », ni page A4, ni feuille d'impression.

La seule façon d'obtenir aujourd'hui un formulaire vierge sur papier est d'ouvrir l'aperçu
(`FormPreview`) et de demander l'impression au navigateur. **C'est cet état qui est mesuré
ici**, et c'est lui que PAP-1 à PAP-4 devront battre.

Une précision qui change la mesure : `SectionedFields` affiche par défaut **un seul bloc à la
fois** (case « Un bloc à la fois » cochée). Imprimer l'aperçu tel qu'il s'ouvre ne donnerait
qu'une section. La mesure décoche donc cette case et clique « Tout déplier » : elle relève le
**meilleur résultat qu'un utilisateur peut obtenir aujourd'hui**, pas le plus mauvais.

## 2. Méthode

### 2.1 Reproduire la mesure

```bash
npm run paper:baseline
```

Le script démarre le serveur de développement s'il n'écoute pas déjà, puis, pour chacun des
trois cas et chacune des deux portées : ouvre le banc, choisit l'onglet, déplie tout, retire le
bandeau propre au banc, bascule en média `print`, relève le DOM, imprime le PDF et compte ses
pages. Options utiles : `--cas court,moyen`, `--out`, `--pdf-dir`.

| Élément | Chemin |
|---|---|
| Script de mesure | [`scripts/paper-baseline.mjs`](../scripts/paper-baseline.mjs) |
| Banc | [`paper-baseline-harness.html`](../paper-baseline-harness.html) + [`src/dev/PaperBaselineHarness.tsx`](../src/dev/PaperBaselineHarness.tsx) |
| Cas mesurés | [`src/test/fixtures/paperForms.ts`](../src/test/fixtures/paperForms.ts) |
| Invariants des cas | [`src/test/fixtures/paperForms.test.tsx`](../src/test/fixtures/paperForms.test.tsx) |
| Relevés | [`pap-0-baseline-releves.json`](pap-0-baseline-releves.json) |
| PDF de contrôle | `test-results/pap-0-baseline/` (non versionné) |

Le banc monte le **vrai** `FormPreview`, avec le vrai i18n, les vrais composants de saisie et le
vrai moteur de règles. Il n'ajoute ni page A4, ni style d'impression : ajouter l'un d'eux
fabriquerait la baseline au lieu de la mesurer.

### 2.2 Paramètres de page

| Paramètre | Valeur |
|---|---|
| Format | A4 portrait, 210 × 297 mm |
| Marges | 10 mm sur les quatre côtés |
| Échelle | 100 % |
| Surface utile | 190 × 277 mm, soit 718 × 1047 px CSS à 96 dpi |
| Fonds imprimés | oui (`printBackground`) |

La fenêtre de mesure a exactement la largeur utile : le DOM mesuré est donc disposé comme à
l'impression. Changer un de ces paramètres change la baseline ; ils sont figés dans le script.

### 2.3 Fiabilité du comptage de pages

Pour les six relevés, **le nombre de pages du PDF produit par Chromium est égal au nombre de
pages dérivé du DOM** (hauteur du document ÷ hauteur utile). Les positions relevées dans le DOM
décrivent donc bien la pagination réelle, ce qui rend exploitables les mesures par page
(remplissage, coupures, titres en bord de page). Le nombre de pages est lu deux fois dans chaque
PDF — `/Count` de l'arbre de pages et objets `/Type /Page` — et un désaccord interrompt la
mesure.

## 3. Les trois cas fictifs

Les trois cas vivent dans un module unique, partagé par toute la campagne ; leurs tailles sont
figées par un test, pour qu'un gain de PAP-1 à PAP-4 reste comparable à cette baseline.

| Cas | Contenu | Variables | Sections | Règles |
|---|---|---|---|---|
| `court` | Consultation de suivi | 18 | 3 (dont 1 sous-section) | 2 |
| `moyen` | Registre de suivi post-opératoire | 77 | 10 (dont 4 sous-sections) | 9 |
| `volumineux` | Registre multipathologies | **216** | **24** (dont 16 sous-sections) | **26** |

Le cas volumineux **réutilise la fixture d'éditeur existante** (`editorRegistry`, 216 variables /
24 sections / 26 règles) : il satisfait la cible du lot (≥ 216 variables, ≥ 21 sections, > 20
règles) sans créer un second contenu concurrent.

Le cas moyen porte la variété que le volumineux n'a pas : consignes courtes et longues, listes de
3, 4, 6, 10 et 12 options, multisélection, terminologie multivaluée, formules calculées, libellés
longs, unités, raisons de valeur manquante, variables détachées et rubriques communes. Chaque cas
comporte au moins une variable sans section, pour exercer la zone de secours.

Toutes les données sont fictives ; aucune ne propose de valeur par défaut, le formulaire imprimé
reste donc vierge.

## 4. Baseline mesurée

### 4.1 Pages et exhaustivité

Un formulaire complet demande les deux portées : la fiche patient **et** la rencontre.

| Cas | Pages patient | Pages rencontre | **Total** | Variables imprimées | Variables du cas |
|---|---|---|---|---|---|
| court | 1 | 3 | **4** | 17 | 18 |
| moyen | 2 | 7 | **9** | 60 | 77 |
| volumineux | 15 | 4 | **19** | 160 | 216 |
| **Ensemble** | 18 | 14 | **32** | **237** | **311** |

**24 % des variables ne sont pas imprimées** (74 sur 311). Elles ne sont pas perdues par erreur :
sur un formulaire vierge, aucune valeur ne permet d'évaluer une règle de visibilité, et le moteur
masque donc toutes les cibles conditionnelles — 49 variables pour la seule fiche patient du cas
volumineux (deux blocs entiers), 16 pour la rencontre du cas moyen. La variable « valeur
proposée » qui accompagne une liste contrôlée n'est jamais imprimée non plus : elle est repliée
derrière une case à cocher.

C'est exactement ce que le mode générique de la spécification corrige — et cela veut dire que la
baseline de 32 pages correspond à un formulaire **incomplet**.

### 4.2 Où passe la hauteur

| Cas / portée | Hauteur du document | Contenu (questions + titres) | Décor applicatif | Reste (espacement, cadres, fin de page) |
|---|---|---|---|---|
| court / patient | 277 mm | 30 mm (11 %) | 60 mm (22 %) | 187 mm (68 %) |
| court / rencontre | 633 mm | 374 mm (45 %) | 60 mm (7 %) | 397 mm (48 %) |
| moyen / patient | 297 mm | 121 mm (22 %) | 48 mm (9 %) | 385 mm (69 %) |
| moyen / rencontre | 1 836 mm | 1 312 mm (68 %) | 60 mm (3 %) | 567 mm (29 %) |
| volumineux / patient | 3 961 mm | 2 869 mm (69 %) | 48 mm (1 %) | 1 238 mm (30 %) |
| volumineux / rencontre | 962 mm | 551 mm (50 %) | 60 mm (5 %) | 497 mm (45 %) |
| **Ensemble** | — | **5 257 mm (59 %)** | **337 mm (4 %)** | **3 270 mm (37 %)** |

Les pourcentages rapportent chaque poste à la surface imprimée (pages × 277 mm).

Le décor applicatif — bandeau « aucune donnée n'est enregistrée », onglets de portée, en-tête de
rencontre, compteur de champs requis, boutons « Sections », « Tout déplier », « Prochain champ
obligatoire manquant », navigation entre blocs — coûte 48 à 60 mm par document. Peu de chose sur
un registre de 15 pages, mais **22 % de la page** d'un formulaire court.

### 4.3 Remplissage page par page

Même au cœur des formulaires longs, le contenu ne dépasse jamais **80 %** de la hauteur utile :

- volumineux / patient : 40 %, puis 72 à 78 % de la page 2 à la page 14, puis **19 %** en page 15 ;
- moyen / rencontre : 42 %, puis 75 à 80 %, puis 43 % en dernière page ;
- volumineux / rencontre : 39 %, 67 %, 65 %, **28 %**.

**Cinq des six documents finissent sur une page presque vide** (moins de 30 % de contenu) ; le
seul qui y échappe, `moyen / rencontre`, termine à 43 %. Deux cas extrêmes méritent d'être cités :
`court / patient` occupe 11 % d'une page entière pour **une** variable, et `moyen / patient`
dépasse la première page de 20 mm, ce qui lui coûte **une seconde page sans aucun contenu**.

### 4.4 Coupures, titres et zones d'écriture

| Constat | Ensemble des six documents |
|---|---|
| Questions coupées par un saut de page | **19** |
| Titres de bloc à moins de 20 mm du bas de page | 5 |
| dont titres séparés de leur première question | **2** |
| Pages presque vides (< 30 %) | 5 |
| Hauteur médiane d'une zone de réponse | **11,6 mm** (44 px) |
| Largeur médiane d'une zone de réponse | **168,3 mm**, soit 89 % de la largeur utile |
| Zones de réponse plus petites que 8 mm | 0 |
| Cases à cocher isolées, sans « Oui / Non » imprimé | **43** |
| Questions demandant deux contrôles (valeur + raison d'absence) | 2 |
| Listes dont les options ne s'impriment pas (menu déroulant) | **2** |
| Listes dont les options s'impriment | 20 |
| Consignes imprimées | **0 sur 8** |

Trois de ces lignes sont des problèmes de **lisibilité**, pas d'encombrement :

- **Les consignes n'existent pas sur le papier.** `FieldLabel` les place dans une infobulle
  ouverte au clic : imprimées, les huit consignes des trois cas disparaissent. La spécification
  l'interdit explicitement (§10) — mais les rétablir **ajoutera** de la hauteur.
- **Les listes de six ou sept options ne s'impriment pas.** Jusqu'à cinq choix courts,
  `FieldInput` rend des boutons radio, imprimés et cochables. À partir de huit options — ou avec
  un libellé long — il passe à une présentation « recherche » qui réaffiche toute la liste en
  cases, imprimée elle aussi, mais accompagnée d'une boîte de recherche inutile sur papier.
  **Entre les deux**, six ou sept options courtes deviennent un menu déroulant natif : sur le
  papier il ne reste qu'une case portant « — ». Mesuré sur `Score ASA` (6 options) et `Grade de
  la complication la plus sévère` (6 options) ; `Voie d'abord` (12 options) imprime bien ses
  douze choix, et `Comorbidités` (4 options) ses quatre cases.
- **Une case à cocher seule est ambiguë.** 43 questions booléennes s'impriment comme une case
  unique, sans « Oui / Non » : une case vide ne distingue pas « non » de « non renseigné ».

À l'inverse, les zones de réponse actuelles sont **confortables, et uniformément** : 11,6 mm de
haut et 168,3 mm de large — 89 % de la largeur utile — que la réponse soit un paragraphe, une
date, un nombre ou une température. Les six documents donnent exactement les mêmes médianes : la
mise en page ne tient aucun compte du type de la variable. C'est là que se trouve la marge de
compaction.

### 4.5 Coût du contenu, coût de la mise en page

Le script mesure séparément la hauteur qu'occupent les mêmes libellés, consignes, options et
zones d'écriture rendus **sans décor, sans cadre et sans espacement**, à la même police et à la
même largeur — avec, cette fois, **toutes** les variables du cas, consignes et options comprises.
Deux largeurs sont mesurées : une question par ligne, et les réponses courtes par deux (la
grille de 12 unités de la spécification).

| Cas / portée | Rendu actuel | Contenu, une colonne | Contenu, deux colonnes |
|---|---|---|---|
| court / patient | 277 mm | 13 mm | 13 mm |
| court / rencontre | 633 mm | 229 mm | 164 mm |
| moyen / patient | 297 mm | 69 mm | 61 mm |
| moyen / rencontre | 1 836 mm | 943 mm | 675 mm |
| volumineux / patient | 3 961 mm | 2 439 mm | 2 030 mm |
| volumineux / rencontre | 962 mm | 458 mm | 445 mm |

Rapporté à la variable :

| Cas / portée | Rendu actuel | Contenu, une colonne | Contenu, deux colonnes |
|---|---|---|---|
| court / rencontre | 39,6 mm | 13,5 mm | 9,6 mm |
| moyen / rencontre | 32,8 mm | 13,1 mm | 9,4 mm |
| volumineux / patient | 28,1 mm | 12,8 mm | 10,7 mm |
| volumineux / rencontre | 50,6 mm | 17,6 mm | 17,1 mm |

**Le contenu coûte 13 à 18 mm par variable ; le formulaire en consomme 28 à 51.** L'écart n'est
pas dû au nombre de variables mais à la mise en page : une question par ligne quelle que soit la
longueur de la réponse, une zone de saisie de 168 mm pour une date, 20 px d'espacement entre deux
questions, un cadre par bloc, et le décor de l'écran.

En pages, à contenu **complet**. Deux lectures, selon que la partie rencontre suit la partie
patient sur la même page ou commence sur une page neuve :

| Cas | Baseline (contenu incomplet) | Contenu, une colonne | Contenu, deux colonnes |
|---|---|---|---|
| court | 4 | 1 à 2 | 1 à 2 |
| moyen | 9 | 4 à 5 | 3 à 4 |
| volumineux | 19 | 11 | 9 à 10 |

Ces deux dernières colonnes sont des **bornes basses strictes** : elles ne comptent ni
espacement entre questions, ni cadre de section, ni en-tête ou pied de page, ni saut de page
évité. Aucune mise en page réelle ne les atteindra.

## 5. Seuils retenus

Les seuils ci-dessous sont dérivés des mesures de la section 4, jamais d'un gain annoncé
d'avance. Ils s'appliquent au document complet — portée patient **et** rencontre — et à contenu
complet.

### 5.1 Seuil de réduction

| Cas | Baseline | Borne basse mesurée | **Plafond PAP-1 à PAP-4** | Réduction minimale |
|---|---|---|---|---|
| court | 4 pages | 1 à 2 pages | **2 pages** | −50 % |
| moyen | 9 pages | 3 à 5 pages | **6 pages** | −33 % |
| volumineux | 19 pages | 9 à 11 pages | **13 pages** | −32 % |

Règle générale : **au moins 30 % de pages en moins que la baseline, sur chacun des trois cas**,
en imprimant davantage de contenu qu'aujourd'hui.

Le plafond n'est pas la borne basse : il lui laisse de quoi payer l'espacement, les cadres, les
en-têtes et les sauts de page — environ une page sur le cas court, une à trois sur le moyen, deux
à quatre sur le volumineux. Le cas court est le plus exigeant en pourcentage parce que son
gaspillage est surtout du décor et des pages presque vides ; le cas volumineux est le plus
contraint en valeur absolue.

Un gain obtenu en **retirant** du contenu ne compte pas. Toute comparaison se fait à contenu au
moins égal à celui de la section 5.3.

### 5.2 Seuil de lisibilité

Ces valeurs sont des **planchers**, dérivés de ce que le produit offre aujourd'hui. Elles sont
provisoires : PAP-4 doit les confirmer en faisant remplir des exemplaires.

| Grandeur | Mesure actuelle | **Plancher papier** |
|---|---|---|
| Hauteur d'une ligne d'écriture manuscrite | 11,6 mm (`.input`, `min-h-11`) | **8 mm** |
| Largeur d'une zone de réponse | 168,3 mm, quel que soit le type | **4 unités sur 12, soit ≈ 60 mm** |
| Côté d'une case à cocher | 5,3 mm (`h-5 w-5`) | **4 mm**, avec un espace de coche dégagé |
| Corps du texte d'une question | 14 px ≈ 10,5 pt | **≥ 9 pt** |
| Corps d'une consigne | 12 px ≈ 9 pt | **≥ 8 pt** |

La borne basse de contenu de la section 4.5 est calculée avec la ligne d'écriture de 8 mm :
descendre sous ce plancher ne « gagnerait » donc rien qui soit déjà compté.

S'y ajoutent quatre règles binaires, chacune adossée à un défaut mesuré :

1. **Aucune question coupée** par un saut de page (19 aujourd'hui).
2. **Aucun titre séparé** de sa première question (2 aujourd'hui).
3. **Toute consigne définie est imprimée** (0 sur 8 aujourd'hui).
4. **Toute option de liste est imprimée et cochable**, quel que soit le nombre d'options
   (2 listes muettes aujourd'hui) ; une question booléenne imprime ses deux réponses possibles
   (43 cases isolées aujourd'hui).

### 5.3 Seuil d'exhaustivité

**100 % des variables applicables à la portée doivent être imprimées**, contre 76 % aujourd'hui
(237 sur 311). Une variable dont la condition n'est pas résolue reste imprimée, avec sa mention
de condition ; une variable sans section reste visible dans la zone de secours ; la variable
« valeur proposée » d'une liste contrôlée est imprimée avec sa source.

## 6. Limites de cette mesure

- **Mesure locale, navigateur unique.** Chromium headless de Playwright, sur un seul poste. Les
  autres navigateurs et les pilotes d'imprimante peuvent paginer autrement.
- **Baseline favorable.** Le banc monte `FormPreview` seul, sans l'en-tête de navigation ni le
  cadre applicatif qui l'entourent dans le produit. Une impression réelle depuis l'application
  porterait **plus** de décor, pas moins.
- **Aucun papier réel.** Rien n'a été imprimé physiquement ni rempli à la main. Le confort
  d'écriture, la lisibilité après photocopie et le temps de remplissage restent à établir en
  PAP-4.
- **Inspection visuelle partielle.** Le rendu paginé a été inspecté à la largeur utile A4 dans un
  navigateur, et les PDF de contrôle sont conservés ; ils n'ont pas été relus page à page.
- **Les bornes de contenu ne sont pas une mise en page.** L'instrument qui les mesure ignore
  sauts de page, titres orphelins et compatibilité entre champs. Il ne préfigure pas le modèle de
  PAP-1 et ne doit pas être réutilisé comme tel.
- **Les seuils de lisibilité sont provisoires.** Ils viennent des dimensions actuelles du
  produit, pas d'un essai de remplissage.
- **Fixtures fictives.** Un registre réel peut avoir des libellés plus longs, davantage de texte
  libre ou des listes plus grandes ; les trois cas encadrent l'usage attendu, ils ne l'épuisent
  pas.

## 7. Ce que PAP-1 à PAP-4 réutilisent

| Lot | Réutilise |
|---|---|
| PAP-1 | Les trois cas via `PAPER_FORM_CASES` ; les tests du modèle portent sur eux, sections imbriquées, variables détachées, conditions non résolues, libellés longs et listes nombreuses comprises |
| PAP-2 | Les mêmes cas dans le parcours réel ; la comparaison des pages se fait contre le tableau 4.1 |
| PAP-3 | Les mêmes cas pour vérifier qu'un réglage persistant ne change ni les clés ni l'ordre |
| PAP-4 | Les mêmes cas imprimés puis remplis par des étudiants ; le seuil 5.1 est la cible, le seuil 5.2 la limite à ne pas franchir |

La réutilisation est garantie mécaniquement : `paperForms.test.tsx` fige la taille des trois cas,
l'unicité des clés, la cohérence des sections et des règles, l'absence de valeur par défaut et la
présence d'une variable détachée. Un cas qui dériverait ferait échouer ce test avant de fausser
une comparaison.

**Aucune modification du produit, du schéma, des versions de formulaire ou des données n'a été
faite par ce lot.** Les seuls fichiers ajoutés sont les trois cas fictifs, leur test, le banc de
mesure, le script de mesure et le présent document.
