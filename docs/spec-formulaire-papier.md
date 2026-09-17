# Spécification - formulaire papier compact imprimable

- Révision : **2026-09-14**.
- Statut : 📋 **spécifiée, non implémentée**.
- Découpage opérationnel : [lots PAP-0 à PAP-5](lots-formulaire-papier.md), tous à réaliser sauf
  PAP-5 qui reste conditionnel au contrat des groupes répétables.
- Origine : retours d'étudiants utilisant d'autres applications. Les formulaires imprimés
  occupent parfois beaucoup de pages à cause d'espaces mal répartis, de questions courtes
  présentées une par ligne et de sauts de page qui repoussent une section entière.
- Périmètre : produire un formulaire **vierge**, lisible et remplissable à la main, à partir
  d'une version de formulaire MedData.
- Données autorisées : définition du formulaire et métadonnées de présentation uniquement ;
  les données patient restent hors de ce parcours.

Cette spécification complète le moteur de formulaires et ses sections hiérarchiques. Elle ne crée
pas une nouvelle structure clinique : la disposition papier est une projection de la version du
formulaire. Les blocs, sections, sous-sections, variables, règles et ordres existants gardent
leur sens.

## 1. Décision produit

MedData propose une action **Imprimer le formulaire** depuis l'aperçu d'une version et, lorsque
le contexte le permet, depuis le parcours de saisie. L'action ouvre une prévisualisation papier
avec des pages A4 explicites, puis utilise l'impression du navigateur pour produire le PDF ou le
papier.

La première version ne stocke pas un fichier PDF et ne demande pas de fonction serveur de
génération. Elle construit temporairement le document à partir de la version accessible à
l'utilisateur. Le même résultat doit pouvoir être imprimé ou enregistré avec **Imprimer ->
Enregistrer au format PDF**.

La mise en page obéit à quatre règles :

1. **Le contenu vient du formulaire réel.** Aucun champ ne doit être inventé, supprimé ou
   réordonné pour remplir une page.
2. **La hiérarchie reste visible.** Le bloc, la section et la sous-section structurent la lecture
   et servent de points d'ancrage pour la pagination.
3. **Le type de variable détermine la place naturelle.** Une date ou une mesure peut partager une
   ligne ; une réponse textuelle ou une liste longue prend la largeur nécessaire.
4. **La présentation ne change pas le sens clinique.** Une largeur, un nombre de lignes ou un
   saut de page ne modifie ni la clé, ni le type, ni le requis, ni la règle, ni la portée de la
   variable.

## 2. Objectifs et limites

### Objectifs

- Réduire le nombre de pages sur les formulaires longs sans réduire l'espace nécessaire à
  l'écriture.
- Éviter les grandes zones blanches produites par des sauts de page trop conservateurs.
- Conserver l'ordre de saisie numérique et papier afin de faciliter la ressaisie dans MedData.
- Utiliser les blocs, sections, sous-sections, rubriques communes et variables déjà définis.
- Adapter automatiquement les lignes et colonnes au type de variable, à la longueur des libellés
  et aux options disponibles.
- Donner à l'auteur quelques corrections locales quand l'algorithme ne connaît pas la longueur
  attendue d'une réponse.
- Montrer une prévisualisation paginée avant impression, avec un nombre de pages calculé pour le
  profil choisi.
- Produire un document lisible en noir et blanc, utilisable sur une imprimante ordinaire et
  sans dépendre de la couleur.

### Hors périmètre de la v1

- PDF interactif avec champs AcroForm.
- Réimport automatique d'un PDF rempli à la main ou à l'écran.
- OCR ou reconnaissance d'écriture.
- Préremplissage avec un patient, une rencontre, un nom, une date de naissance ou une identité.
- Archivage du PDF dans Storage ou dans l'historique des exports cliniques.
- Réécriture automatique d'un libellé pour gagner de la place.
- Optimisation qui déplacerait une question hors de sa section ou changerait l'ordre clinique.
- Gestion complète des occurrences d'un futur bloc répétable ; voir §11.

## 3. Utilisateurs et autorisations

Un utilisateur peut imprimer une version s'il peut déjà lire le formulaire correspondant. La
permission d'exporter des données cliniques n'est pas requise pour un formulaire vierge, car le
document ne contient aucune ligne patient. Les restrictions de lecture de la base et du gabarit
restent applicables.

Le propriétaire ou le gestionnaire d'un formulaire peut modifier ses réglages de présentation
uniquement lorsque la version est encore modifiable. Une version publiée ou déjà utilisée reste
figée pour que son rendu papier puisse être reproduit. Une nouvelle présentation nécessite alors
une nouvelle version ou le mécanisme d'évolution du formulaire prévu par le projet.

Le nom du fichier produit ne doit contenir aucune donnée patient. Pour un formulaire vierge, le
nom peut reprendre le nom du formulaire, sa version et la langue, par exemple
registre-neurochirurgie-v3-fr.pdf.

## 4. Vocabulaire de mise en page

| Terme | Définition |
|---|---|
| Bloc racine | Section sans parent, unité principale de lecture et de règles cliniques |
| Section | Bloc ou sous-section identifiée par sa clé stable et son libellé versionné |
| Sous-section | Section ayant un parent ; elle reste sous le bloc parent dans le papier |
| Rubrique commune | Groupe de présentation de variables communes ; il ne devient pas un bloc clinique |
| Élément imprimable | Titre, consigne, question, choix, zone d'écriture ou champ calculé |
| Ligne papier | Ensemble d'éléments placés sur une même ligne physique |
| Page papier | Conteneur A4 de hauteur et de marges connues dans la prévisualisation |
| Profil | Réglages généraux de densité, orientation, marges et visibilité des consignes |
| Surcharge | Réglage précis appliqué à une section, une sous-section ou une variable |

Les clés techniques restent invisibles dans le document, sauf lorsqu'elles sont nécessaires à une
feuille de codage ou explicitement demandées par l'auteur. Le formulaire affiche les libellés
humains et les unités existantes.

## 5. Parcours utilisateur

### 5.1 Ouvrir l'impression

Depuis **Aperçu**, l'utilisateur choisit **Imprimer le formulaire**. L'écran prépare la version
courante et affiche un panneau de réglages puis les pages A4.

Depuis un formulaire de rencontre, l'action est proposée avec le type de rencontre déjà choisi.
Depuis l'éditeur, l'utilisateur doit choisir la portée à imprimer et le type de rencontre si la
version contient plusieurs parcours.

Le formulaire vierge ne contient aucune valeur proposée comme si elle avait été saisie. Une
defaultValue électronique peut éventuellement être affichée comme consigne séparée, mais la
v1 ne la coche ni ne la préremplit sur le papier.

### 5.2 Réglages globaux

Le panneau propose les réglages suivants :

| Réglage | Valeurs v1 | Valeur par défaut |
|---|---|---|
| Portée | Patient, rencontre, patient + rencontre | Selon l'écran d'origine |
| Type de rencontre | Un type connu, ou tous les types depuis l'éditeur | Type déjà sélectionné ; sinon choix explicite |
| Densité | Compacte, confortable | Compacte |
| Orientation | Automatique, portrait, paysage | Automatique |
| Consignes | Afficher, masquer, afficher seulement les consignes non vides | Afficher les consignes non vides |
| Marqueurs requis | Afficher ou masquer * avec légende | Afficher |
| Sauts de bloc | Automatique, commencer certains blocs sur une page | Automatique |

La modification d'un réglage actualise les pages et le nombre de pages sans recharger la version.
Elle ne sauvegarde pas une saisie clinique et ne crée aucun brouillon.

### 5.3 Prévisualisation

La prévisualisation montre :

- la taille A4 et l'orientation choisies ;
- les limites de chaque page ;
- le titre du formulaire, la version et la langue ;
- les blocs, sections et sous-sections dans leur ordre ;
- les zones réservées à l'écriture et les choix à cocher ;
- un avertissement lorsqu'une variable conditionnelle reste visible parce que le scénario n'est
  pas déterminé ;
- le nombre de pages du profil courant et les éléments ayant reçu une surcharge.

Le nombre de pages est celui de la pagination MedData pour le profil choisi. Les navigateurs et
les pilotes d'imprimante peuvent ajouter leurs propres en-têtes ou modifier l'échelle ; l'écran
affiche donc aussi les paramètres recommandés : A4, échelle 100 %, marges du pilote désactivées
si les marges sont déjà portées par la page.

## 6. Construction du document

La construction se fait en deux temps : un modèle de document temporaire, puis son rendu HTML
imprimable. Le modèle temporaire sert à calculer les lignes et les pages ; le CSS seul ne doit
pas décider silencieusement de la structure, car cela rendrait le nombre de pages imprévisible.

Le constructeur reçoit :

- la version du formulaire ;
- les variables et leurs types ;
- les sections et leur hiérarchie ;
- les rubriques communes éventuelles ;
- les règles et le contexte diagnostique ;
- le profil et les surcharges de présentation.

Il produit une liste ordonnée de pages contenant des éléments référencés par fieldKey ou
sectionKey. Cette représentation reste en mémoire et n'est jamais enregistrée comme une donnée
patient.

### 6.1 Ordre de construction

L'ordre est déterministe :

1. portée patient, si elle est demandée ;
2. rubriques communes dans l'ordre de commonLayout ; à défaut, le rendu historique du tronc
   commun en tête ;
3. blocs racine selon displayOrder ;
4. sous-sections de chaque bloc selon leur displayOrder ;
5. variables directes de la section selon leur displayOrder ;
6. variables dont la section est inconnue dans une zone de secours visible, sans les supprimer ;
7. portée rencontre, si elle est demandée, avec le type de rencontre choisi.

Le commonLayout reste une organisation de présentation. Une rubrique commune ne peut pas devenir
une cible de règle de visibilité, une unité clinique ou un faux bloc uniquement pour obtenir un
meilleur alignement visuel.

### 6.2 Conditions d'affichage sur un formulaire vierge

Un formulaire vierge ne possède pas de réponse permettant d'évaluer toutes les règles. En mode
**générique** :

- une variable dont la visibilité dépend d'une réponse inconnue reste imprimée ;
- la question reçoit une mention courte, par exemple « Selon réponse précédente » ;
- un bloc conditionnel reste présent avec son indication de condition ;
- aucune variable n'est omise simplement parce qu'elle serait probablement masquée.

Depuis l'aperçu, un mode **scénario papier** peut fixer localement un type de rencontre ou un code
diagnostique reconnu. Le moteur de visibilité existant peut alors retirer les éléments dont la
condition est entièrement résolue. Les conditions encore indéterminées restent visibles. Le
scénario est uniquement en mémoire et ne crée ni patient, ni rencontre, ni brouillon.

Cette distinction empêche de gagner artificiellement des pages en imprimant un formulaire
incomplet.

## 7. Règles de placement selon les variables

### 7.1 Grille horizontale

La largeur utile d'une ligne est représentée par **12 unités** :

- pleine largeur : 12 unités ;
- demi-largeur : 6 unités ;
- tiers de largeur : 4 unités.

Le constructeur parcourt les variables dans l'ordre et ajoute une variable à la ligne tant que sa
largeur minimale et sa hauteur tiennent. Il ne réordonne jamais les variables. Un élément dont le
libellé, les choix ou la zone d'écriture est trop grand commence une nouvelle ligne en pleine
largeur.

Une ligne ne doit jamais descendre sous une largeur minimale de 4 unités pour une question
lisible. Une surcharge tiers est refusée ou ramenée à demi-largeur si le libellé ou les choix
ne tiennent pas.

### 7.2 Présentation naturelle par type

| Type | Présentation automatique compacte | Présentation confortable |
|---|---|---|
| number, integer | Champ court avec unité, souvent en demi ou tiers de ligne | Demi-largeur, avec espace plus large |
| date, datetime | Champ court en demi ou tiers de ligne | Demi-largeur |
| boolean | Libellé suivi de « □ Oui  □ Non » ou de la convention du formulaire | Même contenu avec espacement accru |
| select court | Choix sur une ligne ou en petite grille | Petite grille ou demi-largeur |
| select long | Liste sur toute la largeur, avec retour à la ligne | Toute la largeur |
| multiselect court | Cases sur deux colonnes si les libellés tiennent | Grille plus espacée |
| multiselect long | Liste sur toute la largeur | Toute la largeur |
| terminology | Ligne « Code : ____  Libellé : ____ » si le référentiel n'est pas imprimable | Même ligne avec espace accru |
| text | Une ou plusieurs lignes selon le profil et la surcharge | Zone plus haute sur toute la largeur |
| formule calculée | Résultat identifié comme calculé, sans contrôle de saisie | Même présentation |

Les options actives et les raisons de valeur manquante autorisées sont imprimées avec leur
libellé. Les codes techniques ne remplacent pas les libellés. Un référentiel de terminologie
volumineux n'est pas recopié intégralement dans le formulaire ; l'auteur peut fournir une liste
papier ciblée dans un chantier séparé.

Le libellé, l'unité, la consigne et le marqueur requis contribuent à la hauteur estimée. La
longueur du libellé n'autorise pas à réduire le texte sous le seuil lisible : l'élément passe sur
une ligne plus large ou sur une nouvelle ligne.

### 7.3 Réponses textuelles

Le type text ne permet pas à lui seul de savoir si la réponse attend un mot ou un paragraphe.
Les valeurs suivantes sont donc appliquées :

- profil compact : une ligne par défaut ;
- profil confortable : deux lignes par défaut ;
- surcharge de variable : de 0 à 12 lignes, avec une valeur recommandée de 3 à 6 pour une
  description ;
- une consigne longue ou une variable explicitement configurée en pleine largeur ne partage pas
  sa ligne avec un autre champ.

0 ligne signifie que la réponse est donnée par des cases ou une liste et ne demande pas de
zone manuscrite supplémentaire. La hauteur minimale d'une ligne d'écriture doit rester compatible
avec une écriture manuscrite ordinaire ; la compacité ne se fait pas en écrasant les lignes.

### 7.4 Regroupement des variables

Deux variables peuvent partager une ligne seulement si elles sont compatibles :

- leurs contrôles sont courts ;
- aucun choix ne nécessite une liste verticale ;
- aucune consigne longue ne doit être lue entre les deux ;
- chacune conserve une largeur minimale lisible ;
- leur unité reste directement attachée à son champ.

Une sous-section peut donc contenir plusieurs lignes de mesures compactes, puis une question
textuelle en pleine largeur. La sous-section n'impose pas une seule grille à tous ses enfants.

## 8. Pagination et gestion des espaces

### 8.1 Principes

Chaque page possède une zone A4 connue, avec des marges internes du profil. Le constructeur place
les lignes dans la page courante puis ouvre une nouvelle page lorsqu'une ligne complète ne tient
plus.

Les règles sont les suivantes :

- le titre d'un bloc ou d'une sous-section reste avec sa première ligne de contenu ;
- un bloc n'est pas déplacé en entier sur la page suivante par défaut ;
- une sous-section peut continuer sur une page suivante ;
- une ligne ne se coupe pas entre deux pages ;
- une grande zone de texte peut être scindée uniquement entre deux lignes d'écriture, avec une
  mention « suite » ;
- un élément plus haut qu'une page déclenche un avertissement et est fractionné selon une règle
  explicite ;
- un saut avant un bloc n'est utilisé que sur demande ou lorsque le titre et la première ligne ne
  tiennent pas ensemble ;
- les marges et les espaces verticaux sont communs à toutes les pages d'un même profil.

Ainsi, l'espace restant en bas d'une page peut être utilisé par le début du bloc suivant. Une page
presque vide n'est acceptée que si l'élément suivant ne peut pas tenir sans couper une question ou
si l'auteur a demandé un saut.

### 8.2 En-tête et pied de page

Chaque page affiche au minimum :

- le nom court du formulaire ;
- la version et la langue ;
- une indication « Formulaire vierge » ;
- le numéro de page produit par la prévisualisation.

Le pied de page ne doit pas contenir d'identifiant patient. Si le navigateur ajoute ses propres
en-têtes ou pieds de page, l'interface explique comment les désactiver dans la boîte d'impression.

### 8.3 Profils de densité

Le profil **Compact** réduit les espacements entre questions courtes et regroupe les contrôles
compatibles. Il ne réduit pas la taille minimale du texte, des cases ou des lignes d'écriture.

Le profil **Confortable** ajoute de l'espace vertical et privilégie la pleine largeur pour les
réponses ouvertes. Il est recommandé quand le formulaire est rempli sur le terrain ou par une
personne ayant besoin de davantage d'espace manuscrit.

L'utilisateur peut comparer les deux nombres de pages avant d'imprimer. Le produit ne doit pas
présenter le profil compact comme obligatoire.

## 9. Réglages de présentation et versionnage

L'algorithme automatique fonctionne pour les versions existantes sans réglage supplémentaire. Pour
les exceptions, la version peut porter un état de présentation papier versionné, nommé ici
TemplatePrintLayout.

Le contrat logique est :

~~~ts
interface TemplatePrintLayout {
  fingerprint: string;
  locked: boolean;
  inUse: boolean;
  profile: {
    density: 'compact' | 'comfortable';
    orientation: 'auto' | 'portrait' | 'landscape';
    marginMm: 8 | 10 | 12 | 15;
    showDescriptions: 'all' | 'non_empty' | 'none';
    showRequiredMarkers: boolean;
  };
  sections: Record<string, {
    columns: 'auto' | 1 | 2;
    breakBefore: boolean;
  }>;
  fields: Record<string, {
    width: 'auto' | 'full' | 'half' | 'third';
    answerLines: number | null;
    breakBefore: boolean;
  }>;
}
~~~

Les clés de sections et fields sont les clés stables de la version, jamais des indices de
tableau. Une absence de réglage signifie auto. Le niveau le plus précis l'emporte :

~~~text
variable > sous-section > bloc > profil global
~~~

Les réglages d'une variable ne peuvent pas modifier son type, son unité, ses options, son requis,
sa portée, sa règle ou sa provenance. Les réglages d'une section ne peuvent pas la déplacer dans
une autre section.

Si ce contrat est persisté, il doit suivre les garanties déjà utilisées pour les métadonnées de
présentation :

- migration additive, sans modifier une migration appliquée ;
- lecture complète par getVersion() ;
- sauvegarde atomique avec clé d'opération et empreinte attendue ;
- refus des clés inconnues, doublons, valeurs hors bornes et sections inexistantes ;
- copie explicite des réglages lors de la création d'une nouvelle version ;
- verrouillage d'une version publiée ou utilisée ;
- conservation des choix locaux en cas de conflit ;
- aucune inclusion dans les données patient, les brouillons cliniques ou l'export analytique.

La première implémentation peut livrer l'algorithme automatique et les réglages temporaires de
prévisualisation avant d'ajouter la persistance de TemplatePrintLayout. La persistance devient
nécessaire dès qu'un auteur doit retrouver ses lignes et largeurs après fermeture de l'éditeur.

## 10. Accessibilité, langue et impression

Le rendu papier doit rester compréhensible sans couleur :

- les états requis et conditionnels utilisent du texte ou des symboles accompagnés d'une légende ;
- les cases à cocher restent distinctes après photocopie en niveaux de gris ;
- les libellés longs se replient sans être tronqués ;
- le contraste et la taille de caractères restent lisibles sur une imprimante ordinaire ;
- les choix sont imprimés avec une zone de coche suffisamment grande pour un stylo ;
- les consignes ne reposent pas sur une infobulle ou un élément visible seulement à l'écran.

Le document utilise la langue sélectionnée dans l'application. Les libellés de sections, les
valeurs d'options, les raisons de valeur manquante, les unités et les textes de pagination passent
par l'i18n existante. Les chaînes techniques et les clés internes restent absentes du papier par
défaut.

## 11. Blocs répétables et évolutions futures

Les blocs et sous-sections ordinaires sont pris en charge par cette spécification. Un bloc
répétable nécessite une règle supplémentaire : le papier doit savoir combien d'occurrences vierges
imprimer et comment rattacher les réponses à une occurrence.

Tant que le support des groupes répétables n'est pas livré, la v1 doit soit :

- afficher une occurrence modèle avec la mention « répéter cette fiche pour chaque occurrence » ;
- soit signaler que l'impression complète du bloc répétable n'est pas encore disponible.

Elle ne doit pas imprimer plusieurs occurrences implicites ni transformer les variables en colonnes
numérotées. Un futur lot devra ajouter un nombre d'occurrences demandé par l'utilisateur, la
pagination de chaque occurrence et une vérification spécifique de la ressaisie.

Les rubriques communes UX-16 suivent leur ordre de présentation, tout en restant hors des règles
cliniques et des blocs d'export.

## 12. Architecture proposée et lots

### PAP-0 - Mesurer le problème papier

- Inventorier trois formulaires représentatifs : court, moyen et formulaire de grande taille.
- Produire le rendu actuel et mesurer le nombre de pages, les pages presque vides et les zones de
  réponse insuffisantes.
- Conserver ces formulaires comme fixture fictive ; inclure la fixture éditeur de 216 variables,
  au moins 21 sections et plus de 20 règles lorsqu'elle est disponible.
- Fixer le seuil de réduction de pages après cette mesure, plutôt que d'annoncer un gain théorique.

### PAP-1 - Modèle de document et algorithme de placement

- Ajouter un constructeur pur de lignes, éléments et pages.
- Implémenter l'ordre hiérarchique et les règles de largeur par type.
- Implémenter les profils compact et confortable, les lignes de réponse et les règles de
  compatibilité entre champs.
- Tester l'algorithme sans navigateur sur des cas courts, longs, imbriqués et conditionnels.

### PAP-2 - Prévisualisation et impression navigateur

- Ajouter la vue paginée A4 et l'action **Imprimer le formulaire**.
- Rendre les titres, consignes, choix, cases, unités, lignes manuscrites et champs calculés.
- Ajouter le CSS d'impression, l'orientation automatique et les paramètres recommandés.
- Vérifier qu'aucune écriture, requête de terminologie ou création de brouillon ne part de cette
  vue.

### PAP-3 - Réglages persistants de présentation

- Ajouter le contrat versionné TemplatePrintLayout si les réglages doivent survivre à la session.
- Ajouter la sauvegarde atomique, l'empreinte, le verrouillage et la copie de version.
- Rejouer les vérifications de schéma, du snapshot et de concurrence prévues par le dépôt.
- Garder un propriétaire d'écriture unique pour migration, RPC et appelants.

### PAP-4 - Éditeur de mise en page et validation terrain

- Ajouter les réglages au niveau profil, bloc, sous-section et variable.
- Montrer la conséquence sur le nombre de pages avant l'enregistrement.
- Tester avec des libellés longs, des listes nombreuses, des consignes absentes, des sections
  vides, des variables détachées et des conditions non résolues.
- Faire imprimer puis remplir des exemplaires par des étudiants et relever le temps de remplissage,
  les erreurs de lecture et les espaces insuffisants.

### PAP-5 - Compatibilité avec les groupes répétables

- À ouvrir seulement lorsque le contrat des groupes répétables définit le nombre d'occurrences et
  leur saisie.
- Ajouter la copie d'occurrences, la pagination dédiée et la preuve de ressaisie.

PAP-1 et PAP-2 peuvent être livrés sans migration si les réglages restent automatiques ou
temporaires. PAP-3 doit être séquencé avec les changements de version et de présentation du
moteur de formulaires. PAP-4 touche l'éditeur et doit être coordonné avec les autres travaux qui
modifient TemplateVersionEditor, SectionsEditor ou FormPreview.

## 13. Critères d'acceptation

### Présence et ordre

- Chaque variable applicable à la portée et au scénario choisis apparaît exactement une fois.
- Les variables non affectées à une section restent visibles dans une zone de secours.
- Les blocs, sections, sous-sections et rubriques communes respectent leur ordre actuel.
- Un changement de largeur ou de saut de page ne change aucune clé ni aucune règle.

### Utilisation sur papier

- Aucun libellé, choix, unité ou consigne n'est tronqué ou superposé.
- Chaque question possède une zone de réponse adaptée à son type et à son réglage.
- Les cases sont cochables et les lignes sont assez espacées pour une écriture ordinaire.
- Le rendu reste lisible en noir et blanc et après photocopie.
- Les valeurs proposées électroniquement ne sont pas imprimées comme des réponses déjà données.

### Pagination et espace

- Aucun saut automatique ne crée une page vide.
- Une section n'est pas repoussée entière à la page suivante lorsqu'une partie de son contenu
  tient dans l'espace restant.
- Une question et sa zone de réponse restent ensemble, sauf fractionnement explicite d'une grande
  zone de texte.
- Le nombre de pages affiché dans la prévisualisation correspond au document imprimé par Chromium
  avec les paramètres recommandés.
- Le profil compact réduit les espaces entre éléments compatibles sans réduire les tailles
  minimales de lecture et d'écriture.

### Conditions et confidentialité

- Une règle non résolue ne fait pas disparaître silencieusement une question du formulaire
  générique.
- Le scénario papier reste local à la prévisualisation et ne crée aucune donnée clinique.
- Aucun nom, identifiant patient, document brut, secret ou message interne n'apparaît dans le PDF
  vierge, son titre ou son nom de fichier.
- L'impression ne crée pas de ligne d'export clinique et ne demande pas un droit d'export de
  données.

### Preuves attendues

- Tests web ciblés du constructeur de mise en page et des composants imprimables.
- Typecheck et lint des surfaces modifiées.
- Rendu PDF Chromium du formulaire court, moyen et 216 variables ; inspection visuelle des pages.
- Extraction de texte pour vérifier la présence et l'ordre des libellés, complétée par une
  inspection visuelle du PDF, car l'extraction seule ne prouve pas la mise en page.
- Validation manuelle sur papier par des étudiants avec comparaison du nombre de pages et du
  confort de remplissage.

## 14. Risques et décisions à conserver

| Risque | Réponse retenue |
|---|---|
| Compactage trop agressif | Profil compact réversible, tailles minimales et profil confortable |
| Texte libre de longueur imprévisible | Surcharge de lignes au niveau de la variable |
| Libellé ou choix trop longs | Passage automatique en pleine largeur, jamais de texte tronqué |
| Page presque vide | Pagination par lignes et sections continuables, pas de saut systématique de bloc |
| Conditions inconnues sur un formulaire vierge | Mode générique qui conserve la question, mode scénario explicite |
| Divergence entre écran et papier | Constructeur partagé avec les mêmes variables, sections et règles ; tests PDF |
| Différences entre navigateurs et imprimantes | Pages A4 explicites, paramètres recommandés et validation Chromium + papier |
| Réglage de présentation interprété comme sens clinique | Contrat séparé et clés stables ; aucune surcharge ne modifie le modèle clinique |
| Futur groupe répétable imprimé de façon ambiguë | Lot distinct avec nombre d'occurrences explicite |

La décision centrale est donc : **la hiérarchie du formulaire définit l'ordre et les repères ; le
type, la longueur et les réglages de présentation définissent la place ; la pagination remplit
l'espace restant sans casser une question ni déplacer le contenu.**
