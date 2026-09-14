# Formulaire papier compact - lots PAP-0 à PAP-5

- Révision : **2026-09-15**.
- Statut : **spécifié ; les six lots restent à réaliser**.
- Référence normative : [spécification du formulaire vierge imprimable](spec-formulaire-papier.md).
- Les identifiants **PAP** appartiennent à ce chantier. Ils ne renumérotent pas les lots L, UX,
  E ou O existants.
- Périmètre : produire un formulaire vierge A4 à imprimer ou enregistrer en PDF depuis le
  navigateur, sans patient sélectionné, sans valeur clinique et sans écriture distante.

Ce document transforme le chapitre 12 de la spécification en unités exécutables et traçables. La
spécification reste la source des règles métier et de présentation ; ce document fixe l'ordre, les
responsabilités, les dépendances et les preuves attendues.

## Résultat à livrer

Depuis une version de formulaire autorisée, l'utilisateur ouvre une prévisualisation paginée et
obtient un document vierge lisible. Le document :

- conserve l'ordre des blocs, sections, sous-sections, rubriques communes et variables détachées ;
- utilise le type de variable pour choisir une présentation manuscrite adaptée ;
- compacte les champs compatibles sur une grille de 12 unités sans rendre les réponses
  illisibles ;
- évite les pages presque vides, les coupures de lignes et les titres orphelins ;
- montre clairement l'orientation, le nombre de pages et les paramètres à utiliser pour imprimer ;
- ne modifie ni les clés, ni les règles, ni la version active, ni les données cliniques.

La réduction du nombre de pages ne sera annoncée qu'après la mesure PAP-0. Une page plus courte
mais impossible à remplir ne constitue pas un gain.

## Ordre et suivi

| Lot | Résultat | Prérequis | État | Preuves attendues |
|---|---|---|---|---|
| [PAP-0](#pap-0) | Mesure du gaspillage papier et fixtures fictives | Spécification | À réaliser | Baseline de trois formulaires et seuil documenté |
| [PAP-1](#pap-1) | Modèle de document et algorithme déterministe de placement | PAP-0 | À réaliser | Tests purs du modèle et des règles de placement |
| [PAP-2](#pap-2) | Prévisualisation A4 et impression navigateur | PAP-1 | À réaliser | Parcours réel, PDF de contrôle et vérification d'absence d'écriture |
| [PAP-3](#pap-3) | Réglages de présentation persistants, si retenus | PAP-1 ; décision de persistance | À réaliser | Migration, RLS/ACL, concurrence, snapshot et tests |
| [PAP-4](#pap-4) | Réglages dans l'éditeur et validation terrain | PAP-2 ; PAP-3 pour la sauvegarde | À réaliser | Tests web, PDF, impression papier et retour étudiant |
| [PAP-5](#pap-5) | Compatibilité des groupes répétables | Contrat L66 à L71 ou équivalent stabilisé | Conditionnel | Cas d'occurrences, pagination et preuve de ressaisie |

Ordre critique recommandé : **PAP-0 -> PAP-1 -> PAP-2 -> PAP-4**. PAP-3 s'insère entre PAP-1
et PAP-4 si les réglages doivent être conservés au-delà de la session. PAP-5 est hors du chemin
critique du formulaire non répétable et ne doit pas inventer son propre contrat d'occurrences.

PAP-1 et PAP-2 peuvent rester sans migration si les réglages sont automatiques ou temporaires.
PAP-3 devient obligatoire dès qu'un réglage est présenté comme enregistré, partagé par les
utilisateurs autorisés ou rattaché à une version. PAP-4 peut être prototypé avant PAP-3, mais sa
version finale ne doit pas promettre une persistance qui n'existe pas.

## Contraintes communes à tous les lots

1. **Vierge et confidentiel.** Le scénario générique ne charge pas de patient, d'identité, de
   rencontre, de réponse, de brouillon ou de valeur de terminologie. Une valeur choisie pour
   tester une condition est locale à la prévisualisation et n'est jamais enregistrée.
2. **Sémantique inchangée.** Le placement ne change aucune clé, portée, règle, applicabilité,
   unité, option, ordre métier ou définition de variable. Une variable non affectée à une section
   va dans la zone de secours prévue par la spécification.
3. **Moteur partagé.** Les types, conditions, validations et options affichés doivent être lus
   depuis les contrats existants après inspection du code. Le moteur papier ne recopie pas une
   seconde définition des champs cliniques.
4. **Données fictives.** Les fixtures, captures et essais étudiants utilisent uniquement des
   données de démonstration. Aucun formulaire papier réel ne doit devenir un nouveau dépôt de
   données cliniques dans l'application.
5. **Preuve honnête.** La présence de composants ou d'une maquette ne prouve ni la pagination
   réelle, ni le PDF, ni l'impression physique. Chaque lot conserve le résultat, la cible, le SHA
   et les limites de sa vérification.

## PAP-0

### Mesurer le problème papier

**Objectif.** Établir une référence mesurée avant de choisir une stratégie de compactage. Ce lot
ne modifie pas le produit et ne crée pas de schéma.

**Travail.**

- choisir trois formulaires représentatifs : court, moyen et volumineux ;
- inclure, lorsque la fixture est disponible, un cas d'au moins 216 variables, 21 sections et
  plus de 20 règles ;
- relever le nombre de pages, la hauteur réellement utilisée par page, les pages presque vides,
  les titres orphelins, les zones de réponse trop petites et les endroits où une coupure rend la
  lecture ambiguë ;
- distinguer le problème de contenu (trop de variables) du problème de mise en page (marges,
  espaces, titres ou lignes de réponse) ;
- fixer un objectif de réduction et un seuil de lisibilité à partir de cette mesure.

**Sortie.** Une fiche de baseline liée aux trois fixtures fictives, avec le nombre de pages de
référence, les contraintes d'écriture et le seuil de succès proposé pour PAP-1 à PAP-4.

**Acceptation.** Un tiers peut reproduire la mesure et comprendre pourquoi un gain est ou n'est
pas accepté. Aucun pourcentage de réduction théorique n'est utilisé comme preuve.

**Risques.** Mesurer uniquement un formulaire court masquerait le coût des sections imbriquées,
des consignes longues, des listes nombreuses et des variables textuelles. Le cas volumineux doit
rester dans la campagne jusqu'à la validation finale.

## PAP-1

### Modèle de document et algorithme de placement

**Objectif.** Construire un modèle pur et déterministe de lignes, éléments et pages, réutilisable
par la prévisualisation et, si nécessaire, par un export ultérieur. L'algorithme reçoit une version
de formulaire et des réglages de présentation ; il ne reçoit pas de données patient.

**Surfaces à inspecter avant écriture.** Les contrats et composants existants comprennent
notamment `src/data/types.ts`, `src/domain/validation.ts`, `src/domain/fieldOptions.ts` et
`src/screens/staff/FormPreview.tsx`. Le lot doit confirmer les interfaces courantes avant de
créer un nouveau module ; il ne doit pas supposer que le composant d'aperçu actuel possède déjà
la pagination papier.

**Travail.**

- représenter explicitement le format A4, les marges, l'orientation, la zone utile et la hauteur
  consommée par les en-têtes et pieds de page ;
- appliquer l'ordre déterministe : portée patient, rubriques communes, blocs racines, sections,
  sous-sections, variables directes, variables non affectées dans la zone de secours, puis portée
  rencontre ;
- placer les champs sur une grille de 12 unités : 12 pour une largeur complète, 6 pour une
  demi-largeur et 4 pour un tiers, avec retour à la ligne quand la combinaison devient illisible ;
- définir une présentation par type : choix et multisélection avec cases, booléen avec deux
  cases, date/date-heure avec zones calibrées, numérique avec unité, texte avec lignes, formule
  comme valeur affichée non éditable ;
- gérer les descriptions, marqueurs d'obligation, options nombreuses, texte long, sections vides,
  conditions non résolues et blocs sans variable applicable ;
- calculer les sauts de page sans modifier l'ordre ni la sémantique : titres avec leur premier
  élément, rangées indivisibles, sous-section continuable et zone de texte fractionnable lorsque
  cela est prévu ;
- rendre l'algorithme idempotent : mêmes entrées et mêmes réglages, mêmes pages et mêmes
  positions.

**Tests.** Tester sans navigateur les trois fixtures de PAP-0, un formulaire avec sections et
sous-sections, un formulaire avec variables détachées, des conditions non résolues, des libellés
longs, une liste de grande taille et des lignes de texte qui franchissent une page. Vérifier les
clés et l'ordre de sortie, pas seulement le nombre de pages.

**Acceptation.** Tous les éléments applicables apparaissent exactement une fois ; aucun type
connu ne tombe dans une présentation vide ; les lignes et pages sont déterministes ; le modèle ne
contient ni identité ni valeur clinique et n'appelle ni Supabase ni le moteur de terminologie.

**Risques et coordination.** Ne pas modifier en même temps les contrats de champs ou la structure
des sections sans propriétaire commun. Si `src/data/types.ts` ou `FormPreview.tsx` est déjà réservé
par un autre lot, le responsable doit rebaser ou attendre ; il ne doit pas résoudre le conflit en
dupliquant les types.

## PAP-2

### Prévisualisation A4 et impression navigateur

**Objectif.** Exposer le résultat de PAP-1 dans un parcours utilisable : réglages, pages A4
visibles, nombre de pages, puis impression du formulaire vierge ou enregistrement en PDF par la
boîte de dialogue du navigateur.

**Travail.**

- ajouter ou compléter l'action **Imprimer le formulaire** depuis un contexte de formulaire
  autorisé ;
- afficher chaque page A4 avec une séparation visuelle en aperçu et une version imprimable sans
  décor applicatif ;
- appliquer les mécanismes CSS d'impression appropriés (`@media print`, `@page`, règles de
  coupure) et les paramètres recommandés : format A4, échelle 100 %, marges du pilote maîtrisées ;
- rendre les titres, consignes, choix, cases, unités, lignes manuscrites et formules selon le
  modèle de PAP-1 ;
- proposer l'orientation automatique et permettre un choix explicite lorsque l'utilisateur veut
  contrôler le résultat ;
- indiquer que le document est vierge et que le PDF est produit localement par l'impression du
  navigateur.

**Garde-fous.** L'ouverture, la recomposition et l'impression ne doivent créer ni brouillon,
ni rencontre, ni opération distante, ni journal clinique, ni requête de terminologie. Une
prévisualisation de condition ne doit jamais être confondue avec une réponse enregistrée.

**Acceptation.** Le parcours réel affiche toutes les pages annoncées ; le PDF produit depuis le
navigateur contient les mêmes pages et le même ordre ; le changement de réglage ne modifie pas la
version du formulaire. Vérifier au moins le cas compact, le cas confortable, le portrait, le
paysage et un formulaire long.

**Preuves.** Capturer le parcours dans un navigateur réel sur une cible locale/jetable, conserver
un PDF de contrôle issu de données fictives et inspecter les appels réseau ou les effets locaux
pertinents. Un test de composant seul ne suffit pas à prouver le PDF.

## PAP-3

### Réglages de présentation persistants

**Objectif.** Ajouter une configuration durable uniquement si le produit doit mémoriser le profil,
les sauts de page, les largeurs ou les overrides par bloc, sous-section ou variable.

**Décision préalable.** PAP-3 est inutile pour des réglages automatiques ou temporaires à la
session. Si l'utilisateur peut enregistrer ou partager un réglage, le contrat doit être versionné
et attaché à la version de formulaire correcte ; un réglage de présentation ne doit pas devenir
une modification clinique implicite.

**Travail.**

- reprendre le contrat `TemplatePrintLayout` de la spécification et vérifier sa compatibilité
  avec les versions, brouillons et copies actuels ;
- créer une migration additive seulement si le code courant ne fournit pas déjà une persistance
  appropriée ;
- contrôler côté serveur le rôle, la base, la version et la révision attendue ;
- enregistrer de façon atomique, avec empreinte de contenu, clé d'idempotence si nécessaire et
  conflit explicite en cas de révision périmée ;
- définir la copie d'un réglage lors d'une nouvelle version, sans réutiliser silencieusement un
  réglage incompatible ;
- exclure toute identité, valeur clinique, réponse ou donnée de patient du contrat de mise en
  page.

**Acceptation.** Un réglage autorisé est relu identiquement après fermeture et réouverture ; une
  erreur n'est pas affichée comme une sauvegarde réussie ; deux écritures concurrentes ne peuvent
  pas s'écraser silencieusement ; le client ne peut pas écrire sur une version ou une base non
  autorisée.

**Vérification obligatoire si migration.** Lire les instructions de sécurité DB du dépôt, faire
  relire migration/RPC/appelants par un seul propriétaire, puis exécuter `npm run schema`, inspecter
  le snapshot et exécuter `npm run schema:check` sur la cible locale/jetable prévue. Ajouter les
  tests RLS/ACL, concurrence, idempotence et révision périmée. Ne rien appliquer à distance dans
  le cadre de ce plan documentaire.

**Risque.** Une persistance présentée comme une simple préférence d'écran peut être réutilisée par
  une autre version ou un autre responsable. La version et la révision source doivent rester
  explicites.

## PAP-4

### Réglages dans l'éditeur et validation terrain

**Objectif.** Donner un contrôle proportionné sur la densité sans transformer l'éditeur clinique
  en logiciel de PAO, puis vérifier que le résultat convient réellement aux étudiants qui
  impriment et remplissent les feuilles.

**Travail.**

- exposer au niveau global le profil compact/confortable, l'orientation et les éléments de titre ;
- exposer, selon le besoin mesuré par PAP-0, les réglages de bloc, section, sous-section et
  variable : saut de page avant, largeur, lignes de texte, visibilité de la description et
  présentation adaptée au type ;
- afficher l'impact sur le nombre de pages avant l'enregistrement ;
- utiliser le modèle réel de PAP-1 dans `FormPreview` ; ne pas créer une maquette divergente ;
- conserver les règles, les clés et l'ordre clinique lorsque l'utilisateur déplace ou compacte la
  présentation ;
- signaler les choix qui peuvent rendre une zone de réponse trop petite au lieu de les accepter
  silencieusement.

**Surfaces à coordonner.** Le code courant comprend
`src/screens/staff/TemplateVersionEditor.tsx`, `src/screens/staff/SectionsEditor.tsx`,
`src/screens/staff/FieldForm.tsx` et `src/screens/staff/FormPreview.tsx`. PAP-4 ne doit pas être
lancé en parallèle d'un lot qui modifie ces mêmes surfaces, notamment E4, UX-16, L59, L60 ou L67.
Le tableau de [lots parallèles](lots-paralleles.md) doit être relu au moment du lancement.

**Validation terrain.** Imprimer les trois fixtures fictives avec les profils retenus, puis faire
remplir des exemplaires par des étudiants pilotes. Relever temps de remplissage, erreurs de
lecture, cases ambiguës, ruptures de section, espaces insuffisants et pages inutiles. Comparer
ces résultats à la baseline PAP-0 ; ne pas optimiser uniquement le nombre de pages.

**Acceptation.** Les réglages sont compréhensibles, réversibles et bornés ; l'aperçu, le PDF et le
papier ont le même ordre ; aucun réglage ne supprime une variable ou ne change son sens ; le seuil
de PAP-0 est atteint sans franchir le seuil de lisibilité défini avec les étudiants.

## PAP-5

### Compatibilité avec les groupes répétables

**Objectif.** Étendre le papier aux groupes répétables uniquement lorsque le nombre d'occurrences,
leur saisie et leur projection sont stabilisés par le chantier groupes répétables.

**Dépendance.** Le lot attend le contrat et les preuves de **L66 à L71**. Il ne doit pas déduire
un nombre d'occurrences à partir d'une fiche patient, d'une rencontre ou d'un exemple non autorisé.
Pour un formulaire vierge, le produit doit choisir explicitement entre un gabarit d'occurrence, un
nombre d'occurrences demandé par l'utilisateur et une autre règle documentée.

**Travail.**

- représenter le groupe comme un bloc identifiable, sans fabriquer de nouvelles clés de variable ;
- produire une occurrence vierge avec ses attributs et ses consignes ;
- traiter le nombre d'occurrences, les titres répétés, la continuité de page et les espaces de
  réponse selon le contrat L66-L71 ;
- vérifier le cas zéro occurrence, une occurrence, plusieurs occurrences et une occurrence
  franchissant une page ;
- prouver qu'une impression vierge reste sans données patient et que la ressaisie papier peut être
  rattachée sans ambiguïté au bon groupe lors d'un futur parcours autorisé.

**Acceptation.** Les occurrences sont distinguables sur papier, leur ordre est déterministe et
aucune répétition ne modifie le modèle clinique. Si le contrat répétable n'est pas prêt, PAP-5
reste explicitement conditionnel et ne bloque pas la version non répétable.

## Matrice de dépendances et collisions

| Surface ou décision | Lots concernés | Règle de coordination |
|---|---|---|
| Mesures, fixtures et critères | PAP-0, PAP-1, PAP-2, PAP-4 | PAP-0 est la référence commune ; ne pas remplacer ses fixtures par des exemples plus simples |
| Contrats de champs et sections | PAP-1, L51/L52/L54, L58 à L60, E3/E4 | Relire le code et désigner un seul propriétaire si les mêmes types ou éditeurs sont modifiés |
| Aperçu et éditeur | PAP-2, PAP-4, UX-16, E4, L59, L60, L67 | Une seule session d'écriture à la fois sur `FormPreview.tsx` et les éditeurs concernés |
| Versionnage et persistance | PAP-3, E1/E2/E4, autres migrations | Migration/RPC/appelants couplés par un seul responsable ; vérifier le snapshot avant tout statut livré |
| Groupes répétables | PAP-5, L66 à L71 | Attendre le contrat répétable ; ne pas créer un second modèle d'occurrences |
| CSS et impression | PAP-2, PAP-4 | Vérifier le navigateur et le papier réels ; une capture de l'aperçu ne prouve pas le PDF |

Les collisions sont à confirmer contre l'état du dépôt au lancement. Le tableau global reste dans
[lots-paralleles.md](lots-paralleles.md) ; ce plan ne donne pas de permission de modifier une
surface déjà réservée à un autre lot.

## Critères transversaux de clôture

- **Présence :** chaque variable applicable apparaît exactement une fois ; les variables détachées
  restent visibles dans la zone de secours.
- **Hiérarchie :** blocs, sections, sous-sections et rubriques communes conservent leur ordre.
- **Placement :** le type de variable guide la présentation ; la largeur compacte les éléments
  compatibles sans créer de ligne illisible.
- **Pagination :** pas de titre orphelin, de rangée coupée ou de page vide ; les longs champs
  disposent de l'espace défini par le profil.
- **Conditions :** en mode générique, une condition non résolue est traitée selon la règle de la
  spécification, sans masquer silencieusement une variable.
- **Confidentialité :** aucun patient, identité, réponse, brouillon ou valeur de terminologie ne
  fuit dans le modèle, le PDF, le stockage local ou les logs.
- **Parité :** nombre de pages et ordre de la prévisualisation, du PDF Chromium et de l'impression
  pilote cohérents avec les paramètres recommandés.

## Dossier de preuves et statut initial

| Lot | Code présent | Test ciblé | Navigateur/PDF | Papier étudiant | Cible/cloud |
|---|---|---|---|---|---|
| PAP-0 | Non vérifié | Aucune | Aucune | Aucune | Aucune |
| PAP-1 | Non vérifié | Aucune | Aucune | Aucune | Aucune |
| PAP-2 | Non vérifié | Aucune | Aucune | Aucune | Aucune |
| PAP-3 | Non vérifié | Aucune | Aucune | Aucune | Aucune |
| PAP-4 | Non vérifié | Aucune | Aucune | Aucune | Aucune |
| PAP-5 | Non vérifié | Aucune | Aucune | Aucune | Aucune |

Un lot ne passe de « À réaliser » à « validé » que lorsque la preuve correspondante est exécutée
sur la cible annoncée. La présente intégration documentaire ne constitue ni une implémentation,
ni une validation navigateur, ni une validation papier.

## Prompt de reprise d'un lot

Le prompt générique ci-dessous est à compléter avec l'identifiant et la section du lot visé. Les
prompts détaillés sont également repris dans [prompts-lots.md](prompts-lots.md#pap-0---mesurer-le-problème-papier).

```text
Tu reprends le lot PAP-N du projet MedData (registre-clinique).

Lis d'abord AGENTS.md, docs/spec-formulaire-papier.md, docs/lots-formulaire-papier.md
et la ligne PAP correspondante de docs/lots-paralleles.md. Inspecte ensuite l'état réel
du code, le statut Git, les diffs locaux, les tests et les migrations avant toute écriture.

Respecte strictement le périmètre de PAP-N et ses prérequis. Utilise uniquement des
fixtures et données fictives. Le formulaire est vierge : aucune identité, réponse,
rencontre, valeur clinique ou donnée de terminologie ne doit être chargée, persistée,
exportée ou écrite depuis l'aperçu papier.

Réutilise les contrats et moteurs existants après vérification. Si une migration, une RPC
ou une modification d'autorisation est nécessaire, applique les règles DB du dépôt,
désigne un seul propriétaire pour migration/RPC/appelants et vérifie le schéma sur une
cible locale/jetable. Préserve les modifications hors périmètre et n'invente pas de
contrat pour les groupes répétables.

Exécute les contrôles propres au lot, distingue tests locaux, navigateur/PDF, papier et
cible distante, puis consigne les résultats, le SHA et les limites dans
docs/suivi-execution-feuille-route.md. Ne committe, ne pousse, ne fusionne, ne déploie
et n'applique aucune migration distante que sur demande explicite.
```
