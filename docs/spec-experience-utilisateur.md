# Spécification — saisie protégée, navigation et formulaires sobres

- Révision : **2026-09-11**.
- Statut : **spécifié, non implémenté au titre de ce chantier**. Des composants et protections
  préexistent ; leur présence est distinguée des corrections et extensions demandées.
- Origine : échanges produit sur les sections conditionnelles, la perte de saisie, les champs
  `select` / `multiselect`, puis audit UX du 10 septembre 2026. Retour complémentaire du porteur :
  l'édition d'un jeu de **216 variables et plus de 20 règles** devient difficilement utilisable.
  Gênes précisées : retrouver une règle, créer des règles similaires pour plusieurs variables
  sans les reprendre une à une, naviguer entre sections/variables et choisir une variable dans une règle.
  Autre besoin explicite : donner au diagnostic pilote une place choisie dans une rubrique
  renommable, sans imposer le groupe « Tronc commun » tout en haut du formulaire.
- Lots : **UX-0 à UX-16**. Les identifiants UX restent distincts des lots L et O existants.
- Périmètre : données fictives uniquement ; aucune activation hors connexion, migration distante
  ni modification des droits n'est autorisée par ce document.

## 1. Résultat attendu et articulation documentaire

L'utilisateur doit pouvoir remplir un formulaire long, retrouver une réponse ou une erreur,
changer de bloc et reprendre une saisie interrompue sans perte silencieuse. Il doit savoir
dans quelle base il travaille et distinguer une saisie en mémoire, un brouillon récupérable
et une fiche enregistrée. Les actions utiles restent accessibles sur ordinateur et téléphone.
Le concepteur doit également pouvoir maintenir un modèle de 216 variables et plus de 20 règles
sans parcourir tout l'éditeur pour une modification courante. Ce besoin d'édition est distinct
de la saisie clinique et dimensionne UX-14.

Cette spécification complète :

- [les blocs conditionnels](spec-blocs-pathologies.md), la
  [collecte diagnostique](spec-collecte-diagnostique.md) et
  [les blocs réutilisables](spec-blocs-reutilisables.md) pour leur expérience de saisie/édition ;
- [le cahier métier](cahier-des-charges-metier.md) et
  [le cahier technique](cahier-des-charges-technique.md) pour les états et validations ;
- [la décision de recherche patient](decision-recherche-patient-2026-08-20.md) pour UX-12 ;
- [le plan L61 à L65 de la liste patient](l61-liste-patients-recherche-tri-identite.md) pour
  l'état réel, la décision sur les noms et les prompts d'exécution ;
- [la politique hors connexion](securite-mode-hors-ligne.md),
  [la feuille de route intake-only](feuille-route-offline-saisie.md) et
  [L39](lots-paralleles.md#l39--durcir-la-persistance-des-brouillons-cliniques) pour les données locales.

Les règles de gouvernance, d'identité, de version et d'export de ces documents restent
applicables. Les historiques de livraison ne sont pas réécrits par ce chantier.
UX-16 révise la seule contrainte de présentation « tronc commun en tête » de L54 :
l'appartenance commune demeure inchangée, sa mise en page devient configurable (§5.3).
Les protections de reprise doivent être coordonnées avec L39 et O0–O7 ; créer un second
mécanisme concurrent sur les mêmes écrans est exclu.

La politique hors connexion consigne une **dérogation de démonstration datée du 2026-09-05**,
limitée aux données fictives, tandis que la feuille de route garde les preuves O6/O7 ouvertes.
Cette mention documentaire n'est pas une vérification de l'environnement déployé actuel et
ne vaut pas autorisation d'usage de données réelles. Cette spec ne modifie aucune activation.

## 2. État constaté et limites de preuve

Référence de l'audit : code local **`f6abd00`**, branche `codex/l60-reconnexion-activation`,
le 10 septembre 2026. Les constats sont à revérifier avant l'implémentation de chaque lot.

| Réf. | Constat dans le code ou le rendu | Source principale | Lot |
|---|---|---|---|
| C01 | La création d'une rencontre possède déjà une autosauvegarde locale analytique et une reprise ; `NewPatient` / `EditPatient` n'utilisent pas ce mécanisme | [drafts.ts](../src/data/drafts.ts), [EncounterForm](../src/screens/member/EncounterForm.tsx) | UX-0/1/3 |
| C02 | Le parcours de rencontre d'un patient local sort du chargement avant `loadDraft`, alors que l'autosauvegarde couvre aussi cet identifiant | [EncounterForm](../src/screens/member/EncounterForm.tsx) | UX-1 |
| C03 | L'échec de stockage local est silencieux ; la durée existante est de 72 h | [drafts.ts](../src/data/drafts.ts) | UX-0/3 |
| C04 | Des erreurs sont rendues après tous les champs, loin de l'action ; certaines restent présentes après correction jusqu'à la soumission suivante | [EncounterForm](../src/screens/member/EncounterForm.tsx), [EditPatient](../src/screens/member/EditPatient.tsx), [PatientDetail](../src/screens/member/PatientDetail.tsx) | UX-13 |
| C05 | `ConfirmDialog` laisse le focus derrière la fenêtre ; la confirmation des valeurs masquées est placée après les champs sans gestion de focus | [ConfirmDialog](../src/components/ConfirmDialog.tsx), [EncounterFields](../src/screens/member/EncounterFields.tsx) | UX-4/13 |
| C06 | Type/date/statut restent sur trois colonnes sans breakpoint ; les choix suivent un retour à la ligne selon leur largeur | [EncounterForm](../src/screens/member/EncounterForm.tsx), [FieldInput](../src/screens/member/FieldInput.tsx) | UX-10 |
| C07 | Le checkout courant réinitialise déjà page, recherche, tri et données de liste lors d'un changement direct de base ; ce comportement doit être prouvé avec une sortie de runner saine avant d'être qualifié de validé | [BaseHome](../src/screens/member/BaseHome.tsx), [Patients.test](../src/screens/member/Patients.test.tsx) | L61 / UX-12 |
| C08 | Le checkout courant possède une recherche par code et les tris serveur `created_at` / `patient_code` avant pagination ; le tri par variable clinique et l'identité nominative restent absents | [BaseHome](../src/screens/member/BaseHome.tsx), [patients.ts](../src/data/patients.ts) | L61 à L64 / UX-12 |
| C09 | La palette charge les bases une seule fois, mémorise un échec comme liste vide et propose des destinations non adaptées à tous les rôles | [CommandPalette](../src/components/CommandPalette.tsx) | UX-12 |
| C10 | Le renommage d'un modèle ferme l'édition même après échec ; les erreurs de l'éditeur peuvent être éloignées de son panneau de saisie | [MyTemplates](../src/screens/member/MyTemplates.tsx), [TemplateVersionEditor](../src/screens/staff/TemplateVersionEditor.tsx) | UX-1/14 |
| C11 | Les conflits de synchronisation sont comparés en JSON ; les sections sont principalement distinguées par indentation | [SyncCenter](../src/screens/member/SyncCenter.tsx), [SectionsEditor](../src/screens/staff/SectionsEditor.tsx) | UX-14/15 |
| C12 | L'import possède un compteur mais ne permet pas d'arrêt pendant `busy` ; le bouton d'export ne nomme pas l'attente | [ImportData](../src/screens/member/ImportData.tsx), [ExportPanel](../src/screens/member/ExportPanel.tsx) | UX-15 |
| C13 | L'éditeur possède déjà recherche label/clé/description, filtres section/type/scope/requis, tableau, sections repliables, panneau et navigation entre variables. Les sections sont initialement ouvertes, les règles restent après la liste des variables et leur formulaire choisit les variables dans des listes natives | [TemplateVersionEditor](../src/screens/staff/TemplateVersionEditor.tsx), [RuleForm](../src/screens/staff/RuleForm.tsx) | UX-14 |
| C14 | Le porteur signale devoir créer une à une des règles similaires pour plusieurs variables ; la simplification de cette opération devient une priorité fonctionnelle explicite | Retour utilisateur du 2026-09-10 | UX-14(c) |
| C15 | Les champs dont `section` est explicitement nulle sont regroupés sous `__common__`, avec le titre traduit fixe « Tronc commun » et un tri qui place ce groupe avant tous les blocs | [templateSections](../src/domain/templateSections.ts), [SectionedFields](../src/screens/member/EncounterFields.tsx) | UX-16 |

**Déjà utile, à conserver :** primitives communes, focus visible, cases à libellé cliquable
et cible tactile, sections en `fieldset`, aide des champs à la demande, annonces de retrait
de valeurs, états vides, recherche de terminologie et cloisonnement de l'identité.
UX-10/11 n'ajoutent pas une seconde recherche de terminologie.
UX-14 s'appuie sur la recherche, les filtres et la navigation de variables déjà présents ;
le retour sur 216 variables ne prouve pas une lenteur technique ni l'absence de ces outils.
Il impose de vérifier leur découvrabilité, le maintien du contexte et l'accès aux règles.

**Vérification réalisée pendant l'audit :** rendu des composants actuels `AppShell`,
`Dashboard`, `BaseLayout` / `BaseHome`, `FormPreview` et `ConfirmDialog` par Playwright/Chrome,
avec des fournisseurs de données et d'authentification fictifs, à 1440 px et 390 px.
Aucune erreur JavaScript ni requête externe collectée ; pas de débordement horizontal
du document dans ces fixtures. Le dernier onglet de base est néanmoins partiellement masqué
par son défilement interne sur mobile. Le défaut de focus de `ConfirmDialog` a été reproduit.
Un aperçu comprenant cinq variables de rencontre, dont trois multiselect de 12/7/9 options,
mesurait environ 2 128 px de haut sur mobile, en incluant l'en-tête d'aperçu.

Cette preuve ne constitue ni un parcours authentifié serveur, ni un benchmark de production,
ni une validation exhaustive d'accessibilité. Les autres constats de flux proviennent de la
lecture du code. Aucun test unitaire, DB/RLS, Edge ou de déploiement n'a été exécuté pour cet audit.

## 3. Vocabulaire et invariants

| Terme | Sens et conséquence |
|---|---|
| Saisie en cours | Valeurs actuellement présentes dans le formulaire, pouvant être incomplètes ou invalides |
| Brouillon de travail | Copie récupérable de cette saisie ; ne crée pas une fiche métier et n'alimente pas listes cliniques, statistiques, cohortes ou exports |
| Fiche enregistrée au statut `draft` | Donnée métier persistée selon le contrat existant ; son éligibilité à un export dépend des règles d'export existantes, pas de cette spec |
| Saisie hors connexion en attente | Opération `patient_create` / `encounter_create` de la file intake ; pas encore une fiche serveur ; états et reprise propres à la file |
| Enregistrement métier | Validation et écriture explicites de la fiche au statut autorisé demandé |
| Finalisation | Transition métier vers `curated`, avec les contrôles et permissions existants ; ne désigne pas chaque clic sur Enregistrer |
| Bloc replié | Présentation seulement : valeurs actives, obligations et validation conservées |
| Bloc inapplicable | Condition fausse ou non vérifiable selon le moteur existant ; valeurs exclues des données actives et traitées explicitement à l'enregistrement |
| Avancement | État de saisie des champs applicables ; distinct de la couverture diagnostique, du statut et de la qualité clinique |

Un **bloc** est une section racine ; une **sous-section** a un parent ; le **tronc commun**
regroupe les variables sans section. Le tronc commun n'est jamais masqué par une condition
de bloc, même si ses variables peuvent porter leurs propres règles. Une **rubrique commune**
(UX-16) organise visuellement ces variables sans devenir un bloc clinique. Le diagnostic
pilote désigne le rôle d'une variable dans la collecte, pas un emplacement du formulaire.
Les clés de section
restent stables et aucune référence vivante entre versions n'est créée.

Les invariants suivants s'appliquent à tous les lots :

1. Préserver les réponses après navigation interne, erreur et conflit ; ne jamais présenter
   comme sauvegardé ce qui n'a pas reçu un accusé du support concerné.
2. Respecter la version du formulaire/dossier et ses champs, options, règles, formules et scopes.
   Une reprise ne remappe jamais implicitement les réponses vers une nouvelle version.
3. Une modification devenue invisible ne disparaît pas silencieusement pendant la saisie.
4. Les droits serveur, RLS, transactions, idempotence et concurrence restent les garanties finales.
   Masquer une action ne remplace pas son autorisation serveur.
5. Identité, analytique et documents bruts restent séparés. Un brouillon analytique ne reçoit
   ni nom, ni date de naissance exacte, ni image, ni document brut, ni réponse API complète.
6. Aucun nom ni valeur clinique dans les URL, la télémétrie ou les messages techniques.
   Les préférences persistées contiennent des clés de présentation, pas des réponses.
7. Les mêmes composants doivent porter ces comportements dans la création, l'édition et
   l'aperçu lorsqu'ils s'y appliquent. **L'aperçu reste sans écriture**, y compris sans brouillon.
8. Une donnée enregistrée `curated` n'est pas rétrogradée par une reprise ou une sauvegarde.

## 4. Protection de la saisie et contrat des brouillons

### 4.1 Couverture des interruptions

| Situation | Comportement cible |
|---|---|
| Replier/déplier, changer de bloc ou filtrer des options | Valeurs conservées et obligations inchangées |
| Erreur de validation, refus serveur ou conflit | Formulaire ouvert, saisie préservée, cause et action de résolution visibles |
| Quitter volontairement la fiche | Rester, conserver un brouillon si le support est disponible, ou abandonner explicitement |
| Recharger/fermer le navigateur | Avertissement natif si possible ; récupération à hauteur de la dernière sauvegarde confirmée |
| Arrêt brutal | Reprise de la dernière révision récupérable ; aucune promesse sur les frappes non encore sauvegardées |
| Expiration de session ou changement de compte | Arrêt des écritures, politique de purge appliquée ; aucune conservation de droits pour permettre la reprise |
| Mise à jour de l'application | Ne pas recharger une saisie non protégée sans décision explicite ; annoncer les conséquences |
| Modèle ou fiche modifiés depuis la sauvegarde | Conflit explicite, sans écrasement de la fiche ni perte du brouillon |

L'avertissement navigateur n'est pas une garantie de récupération. La temporisation
d'autosauvegarde doit rester courte et bornée ; sa valeur et la taille maximale des payloads
sont arrêtées dans UX-0 à partir des mesures et limites du projet.

### 4.2 Supports, états et confidentialité

Le serveur est le support cible pour la reprise connectée et entre appareils.
Le support local reste nécessaire dans le parcours hors connexion **déjà autorisé**.
La cible n'est donc pas « serveur uniquement » ; UX-8 concerne l'extension/durcissement
du support local, pas le report d'une correction de reprise déjà nécessaire en UX-1.

| État réel | Texte utilisateur indicatif |
|---|---|
| Modifications plus récentes que l'accusé disponible | Modifications non sauvegardées |
| Requête de sauvegarde active | Sauvegarde du brouillon… |
| Copie locale confirmée et relisible selon le contrat local | Brouillon conservé sur cet appareil à 14 h 32 |
| Révision serveur confirmée | Brouillon sauvegardé à 14 h 32 |
| Serveur indisponible, copie locale autorisée confirmée | Brouillon sur cet appareil — synchronisation en attente |
| Aucun support récupérable disponible | Sauvegarde impossible — modifications non protégées |
| Reprise proposée | Un brouillon du 10 septembre à 14 h 32 est disponible : Reprendre / Supprimer |

Un état peut préciser « données cliniques uniquement » lorsque l'identité saisie n'est pas
couverte. « En ligne » ne signifie pas « sauvegardé ». Une ancienne sauvegarde réussie ne
doit pas masquer l'échec de la dernière révision.

La durée de 72 h de `drafts.ts` est un **constat**, pas une décision de reconduction.
UX-0 fixe un TTL serveur, un TTL local et leur application aux brouillons déjà présents,
en cohérence avec L39 et les TTL de l'intake. IndexedDB n'implique pas à lui seul un chiffrement.
La politique hors connexion prévoit déjà une file de création contenant une identité restreinte,
dans IndexedDB : ce mécanisme ne devient pas un stockage générique d'identité pour tous les brouillons.

Les brouillons expirés ne sont pas synchronisés ni restaurés automatiquement. L'expiration,
la révocation et la déconnexion ne peuvent prolonger un accès sous prétexte de préserver la saisie.
Informer avant une purge prévisible lorsque possible ; appliquer la politique de purge même
si l'utilisateur n'est plus autorisé. Les échecs de purge restent visibles et traités.
Une opération intake expirée/rejetée reste identifiée comme bloquée ou rejetée, avec les
éléments de résolution autorisés par la politique de conservation ; elle ne disparaît pas
silencieusement de l'expérience de synchronisation. Cela ne dispense pas de la purge de sécurité.

### 4.3 Contrat serveur minimal de travail

Le détail SQL/RPC appartient à UX-2 ; le contrat doit déjà garantir :

- Identifiant stable du brouillon ; propriétaire authentifié ; base ; type d'opération ;
  cible existante ou identifiant temporaire stable pour une création ; version de formulaire ;
  révision métier attendue ; révision du brouillon ; dates serveur et expiration.
- Charges utiles bornées, propres à chaque zone de données. Les brouillons peuvent conserver
  des entrées incomplètes ou invalides pour le métier, sans contourner le contrôle de forme,
  la taille, le cloisonnement et les droits. Les convertir en données métier exige leur validation.
- Lecture, création, modification et suppression soumises à l'auteur **et** aux droits actuels
  sur la cible ; un propriétaire de base ne reçoit pas automatiquement tous les brouillons privés.
  Rôle de mission, durée et restrictions de correction/soumission sont revérifiés côté serveur.
- Aucune extension implicite des droits du saisisseur, du curateur ou de l'administrateur système.
  Le brouillon du curateur reste lié à son parcours de tâche existant, s'il est couvert.
- Révision attendue à chaque sauvegarde ; une réponse tardive n'écrase ni une révision plus récente
  ni les frappes réalisées après l'envoi. Deux onglets/appareils divergents produisent un conflit.
- Rejeu idempotent avec clé d'opération stable et empreinte du payload : même opération,
  même résultat ; même clé avec contenu différent, refus explicite.
- Enregistrement métier et consommation de la révision correspondante du brouillon dans une
  opération serveur atomique. Une validation refusée ne produit aucune écriture partielle.
  Une réponse perdue après commit est récupérable sans doublon.
- Protection contre une autosauvegarde tardive qui ressusciterait un brouillon consommé/supprimé.
  Les nouvelles frappes postérieures au clic Enregistrer sont préservées dans une révision
  de travail distincte ou bloquées explicitement pendant l'opération, sans être effacées.
- Conflits structurés, sans erreur SQL brute ni valeur restreinte dans la réponse ou les logs.
  Aucun stockage de jeton privilégié côté client ; ACL/RLS des nouveaux points d'accès vérifiées.

Pour l'intake existant, la rencontre dépend de l'acceptation du patient parent et du mapping
de son identifiant local vers l'identifiant serveur. Un parent rejeté laisse sa rencontre
signalée comme bloquée ; ne pas créer une rencontre orpheline ni l'annoncer enregistrée.
Une suppression de copie locale après succès attend l'accusé de l'opération correspondante.

### 4.4 Conditions et valeurs retirées

Conserver séparément les valeurs temporairement inapplicables dans la saisie/le brouillon.
Elles n'alimentent ni les calculs actifs, ni l'avancement, ni les données métier soumises.
Si la condition redevient vraie dans la même version, les réponses peuvent être restaurées.

Avant l'enregistrement, annoncer le nombre et les champs concernés, avec accès aux détails
autorisés, puis demander confirmation du traitement prévu. Le serveur contrôle la projection
active. Après succès, ne pas garder indéfiniment un double historique de valeurs retirées
dans un brouillon consommé. Si un conflit survient, conserver l'ensemble de la saisie en attente.

Le bloc racine porte la condition ; ses sous-sections héritent de son applicabilité.
Ce chantier ne crée pas une condition indépendante sur chaque sous-section.
Un bloc inapplicable ne laisse pas de titre/cadre vide dans le formulaire ou le sommaire.
À l'export, les sous-sections suivent leur bloc et le tronc commun reste inclus conformément à L53.

## 5. Formulaires longs et champs à choix

### 5.1 Blocs et actions

- Blocs repliables à navigation libre ; plusieurs peuvent rester ouverts. Commandes Tout déplier /
  Tout replier. Les sous-sections structurent sans multiplier les panneaux imbriqués.
- En-tête de bloc : titre, champs requis restants et erreurs, avec texte et pas seulement couleur.
- Sommaire latéral sur ordinateur ; bouton Sections sur téléphone. Clic = ouverture du bloc
  et déplacement/focus adapté. Le bloc courant est identifiable.
- Annonce sobre d'un bloc nouvellement applicable avec action « Y accéder » ; pas de déplacement
  automatique pendant une frappe. Si le bloc courant disparaît, garder un point de navigation cohérent.
- Action « Prochain champ obligatoire manquant » et accès direct aux erreurs. Les champs d'un
  bloc replié sont dépliés avant déplacement ; les champs inapplicables ne sont pas ciblés.
- État de sauvegarde et bouton Enregistrer faciles à retrouver. Une barre persistante est
  permise si elle ne masque ni le champ actif, ni les erreurs, ni le clavier/safe area mobile.
  Éviter l'empilement avec l'en-tête mobile, les toasts et l'invite de mise à jour PWA.

L'avancement se calcule dans la version et le scope courants : champs requis applicables,
valeurs manquantes codifiées et obligation conditionnelle selon les règles existantes.
Une valeur présente mais invalide reste une erreur ; les champs facultatifs ne bloquent pas
la complétion. Afficher « 8 champs requis renseignés sur 12 — 1 erreur », et non une promesse
de qualité clinique. Aucun champ requis : l'indiquer sans pourcentage ni division par zéro.
La couverture diagnostique conserve son indicateur distinct.

### 5.2 Select et multiselect

| Situation | Présentation cible |
|---|---|
| Choix unique, 2 à 5 options courtes | Radios avec zones cliquables |
| Choix unique intermédiaire | Select lisible |
| Longue liste à choix unique | Sélecteur avec recherche |
| Choix multiples courts/intermédiaires | Grille de cases alignées, options visibles |
| Longue liste à choix multiples | Recherche et résumé des choix retenus avec retrait individuel |

Ces seuils sont indicatifs ; la longueur des libellés et la largeur disponible priment.
Le choix est stable pendant l'interaction et ne dépend pas du nombre de réponses déjà choisies.
Une colonne par défaut sur téléphone ; deux ou trois quand la largeur et les libellés le permettent.
Les groupes type/date/statut et identité suivent la même règle responsive.

Exigences communes :

- Zone entière cliquable, contrôle natif ou comportement clavier équivalent ; focus visible.
  Sélection indiquée par coche/radio et fond/bordure discrets, jamais par la seule couleur.
- Libellés entiers avec retour à la ligne ; espacement régulier et cible tactile conservée.
- « Une seule réponse » / « Plusieurs réponses possibles » et compteur de sélections utile.
- Recherche sans effacement des choix hors filtre ; ordre stable, aucune remontée soudaine
  des options cochées sous le pointeur. Effacer la recherche ne signifie pas effacer les réponses.
- Pour une liste distante : chargement, aucun résultat, erreur et reprise explicites ; les choix
  déjà retenus restent identifiables hors de la page de résultats. Respecter la terminologie existante.
- Valeurs/identifiants enregistrés inchangés : ne pas sauvegarder un libellé à la place d'une clé.
  Une option historique inconnue/inactive n'est ni perdue ni remplacée arbitrairement.
- « Autre » ouvre « Préciser » seulement si le modèle fournit ce compagnon et son obligation.
  Aucune exclusivité « Aucun » / « Inconnu » déduite du texte : elle doit être définie et validée.

### 5.3 Diagnostic pilote et rubriques communes libres — UX-16

**Besoin :** pouvoir nommer les rubriques selon le vocabulaire de la collecte et placer le
diagnostic après les premières questions utiles. « Commun » signifie que les variables
n'appartiennent à aucun bloc spécialisé ; cela n'impose ni un titre, ni un unique emplacement.

Exemple fictif dans un même scope, entièrement personnalisable :

| Ordre choisi | Titre visible | Contenu et rôle |
|---|---|---|
| 1 | Contexte de la consultation | Variables communes |
| 2 | Évaluation initiale | Variables communes |
| 3 | Diagnostics retenus | Variable jouant le rôle de diagnostic pilote et son compagnon de proposition |
| 4 | Bilan spécifique | Bloc clinique, applicable selon ses règles |
| 5 | Synthèse | Autres variables communes |

Cet exemple ne déplace pas des données d'identité dans l'analytique et ne fusionne pas les
scopes patient/rencontre. Chaque écran présente uniquement les variables qui lui sont applicables.

**Libertés de présentation retenues.**

- Renommer la rubrique commune par défaut et la placer avant/après un bloc racine via une
  commande explicite. Le titre « Tronc commun » devient la valeur de repli des anciens modèles.
- Créer plusieurs rubriques communes, y répartir les variables communes et les ordonner avec
  les blocs racines. Elles restent au premier niveau ; aucune imbrication sous un bloc conditionnel.
- Déplacer une variable commune, dont le pilote, vers une rubrique commune ou avant/après une
  autre variable de cette rubrique. Choix recherchable, destination explicite et équivalent clavier.
  Le compagnon de proposition diagnostique garde sa relation fonctionnelle ; l'éditeur montre
  son emplacement et permet de déplacer ensemble les éléments liés sans dupliquer leurs valeurs.
- Modifier le libellé de la variable diagnostique sans changer sa clé ni son rôle. Dans l'éditeur,
  utiliser « Variable diagnostique » avec une aide expliquant qu'elle sert à associer diagnostics,
  blocs et couverture ; garder « pilote » dans l'explication si utile, pas comme titre clinique imposé.
- Rendre cette organisation dans la création, l'édition, la consultation, l'aperçu et le sommaire.
  Une rubrique sans champ applicable n'affiche pas de cadre vide ; repli et erreurs suivent UX-5/6/13.
- Ne pas déplacer le focus lorsqu'un diagnostic active un bloc. Conserver l'annonce et l'action
  « Y accéder » de §5.1 ; un pilote placé plus bas ne remonte pas automatiquement lors de la saisie.

**Contrat de présentation, distinct des règles métier.**

L'option retenue est une métadonnée de présentation limitée aux variables communes et à
l'ordre des groupes racines. Réaffecter le pilote à une `template_section` changerait son
appartenance clinique et sa projection d'export ; généraliser toute l'arborescence en un moteur
de mise en page ajouterait un chantier inutile à ce besoin. UX-16 conserve donc les sections
cliniques actuelles et leur hiérarchie bornée.

- Persister dans la version les clés stables, titres et rangs des rubriques communes, le
  rattachement visuel de chaque variable commune et un ordre déterministe partagé avec les
  blocs racines. Titres modifiables et clés stables sont distincts. Un même rang a un départage stable.
- La forme SQL/RPC est arrêtée en UX-16(a). Elle doit garantir côté serveur la même version,
  des références valides, une seule rubrique effective par variable et l'absence de doublon au rendu.
  Une variable commune sans rattachement explicite rejoint la rubrique commune par défaut.
- Un déplacement visuel laisse `section_id` et le miroir `section` nuls, ainsi que les clés,
  scopes, valeurs, règles et provenance inchangés. Une rubrique ne porte aucune condition,
  n'est pas une cible `then.section` et n'est pas une unité de projection/import de bloc.
- Le diagnostic configuré reste disponible indépendamment des blocs qu'il active : aucune
  formule ni règle de masquage sur le pilote. Le repli manuel d'une rubrique est une préférence
  visuelle réversible, pas une condition d'applicabilité.
- L53 inclut toujours les mêmes colonnes communes, quel que soit leur emplacement. Le calcul
  de couverture et les associations diagnostic → blocs ne lisent aucune métadonnée de placement.
  Un export de dictionnaire qui décrit le formulaire transporte les nouvelles rubriques dans
  des attributs de présentation explicites, sans les confondre avec les blocs cliniques.
- Versions publiées/utilisées gelées selon le contrat actuel ; modifier leur organisation passe
  par une nouvelle version modifiable. La copie d'une version remappe les rattachements vers
  la copie, sans référence vivante à la source ; l'historique conserve sa propre présentation.
- L'import L58 d'un bloc conserve les rubriques communes de la cible ; la réutilisation d'une
  variable commune ne la déplace pas. Un bloc importé obtient une position déterministe dans
  l'ordre existant, sans réordonner silencieusement les groupes déjà présents.
- Sans nouvelle métadonnée, conserver le rendu historique « Tronc commun » en premier. Une
  configuration invalide est refusée à l'écriture ; un contexte incomplet à la lecture garde les
  variables accessibles via un repli explicite, jamais par omission. Un ancien client peut garder
  son ordre historique, mais ne doit pas effacer les métadonnées inconnues lors d'une écriture.
- Enregistrer un déplacement/réordonnancement dans une opération atomique, avec droits actuels,
  révision attendue et rejeu sans doublon. Conflit/échec = aucune modification structurelle partielle
  et conservation des choix locaux. Supprimer une rubrique ne supprime jamais ses variables :
  exiger une destination explicite pour ses membres ou refuser tant qu'elle n'est pas vide.
  La rubrique par défaut reste définie ; son remplacement éventuel est atomique avec les rattachements.

**Éligibilité diagnostique et placement sont deux sujets.** Le contrat L55 accepte déjà
`select`, `multiselect` et `terminology` simple ou multiple, avec au plus un pilote par scope.
La configuration exige le compagnon de proposition prévu par L55 et, pour une terminologie,
une release explicite ; un déplacement visuel ne supprime pas ces prérequis.
Une variable simplement intitulée « diagnostic » ne reçoit pas ce rôle automatiquement.
UX-16 rend les critères et les raisons d'inéligibilité compréhensibles, sans imposer de recréer
une variable compatible. L'usage de plusieurs variables diagnostiques dans un même scope,
de texte libre comme source automatique ou d'une source calculée demande un contrat distinct
d'activation, de couverture et de conflits ; ces changements ne sont pas déduits du seul besoin
de déplacement. Leur éventuel périmètre est consigné dans les décisions §9.

## 6. Navigation, visibilité et outils de gestion

### 6.1 Bases, listes et palette

Dans une base, rendre lisibles le nom courant, l'écran actif et le retour vers la liste.
Le passage à une autre base démarre sur sa première page sans afficher l'ancien contexte.
Le retour à la même liste peut restaurer page, tri et défilement, sous réserve que les résultats
et droits soient encore valides. Une page devenue vide après suppression/filtre est recalée.

Séparer chargement, aucun résultat, accès refusé, introuvable et erreur récupérable.
Ne pas transformer un refus serveur opaque en information révélant l'existence d'une base interdite.
Un onglet hors écran doit être découvrable ; le choix actif est amené en vue sans perturber la saisie.
Prévoir un accès à la pagination en tête de liste ; sur mobile, garder les actions de ligne atteignables.

Recherche patient séparée de la palette, **réservée au rôle `medecin`** selon la décision existante.
Le checkout courant fournit déjà le premier socle : préférence de colonnes locale par utilisateur
et base, recherche par code et tris techniques côté serveur avant pagination. L61 le vérifie sans
le recopier ; L62/L63 ajoutent ensuite seulement le tri par variable analytique autorisée, avec
ordre stable, valeurs absentes explicites et retour page 1 après filtre/tri.

La recherche/présentation de noms demeure un sous-périmètre identité distinct, possédé par L64 :
droits `can_view_identity`, accès contrôlé/audité, tests de non-divulgation, aucune valeur ou terme
identifiant dans URL, préférence persistée, offline ou export. Elle n'est jamais implémentée par
une lecture directe de `patient_identity`. La décision produit du 2026-09-11 autorise désormais le
nom sélectionnable dans cette limite, et révise RG-9 dans le cahier métier ; le nom reste absent
pour tout compte sans permission et de toutes les surfaces hors ligne/export.
En mode intake-only, aucune recherche/liste de patients serveur n'est rétablie hors connexion.

Les colonnes visibles sont une préférence par utilisateur et base ; éliminer les clés devenues
inexistantes ou interdites. Ne conserver aucun contenu clinique dans cette préférence.
La palette reste consacrée aux bases/écrans : permissions alignées sur les routes, actualisation
ciblée à l'ouverture/après changement, erreurs réessayables et raccourci clavier conservé.

### 6.2 Erreurs, clavier et états communs

Après soumission, afficher un résumé concis et navigable des erreurs, puis le détail local
associé au contrôle (`aria-invalid` / description appropriée). Corriger une valeur met à jour
l'erreur obsolète sans annoncer toute la validation à chaque frappe. Un refus serveur reste
visible près de l'action. Ne fermer une édition qu'après réussite confirmée.

Les confirmations modales gèrent focus initial, Tab/Shift+Tab, fond inerte, Échap quand permis
et restitution du focus. Une confirmation inline n'emploie pas abusivement le rôle de dialogue.
Prévoir un accès direct au contenu principal et nommer la navigation globale comme telle.

Boutons longs : état occupé visible, prévention des doubles soumissions, libellé compréhensible.
Les informations exigeant une action ne reposent pas uniquement sur un toast éphémère.
Les erreurs internes restent traduites en messages utiles, sans détails techniques sensibles.

### 6.3 Édition des modèles

Conserver les champs du panneau après refus ; afficher l'erreur dans ce panneau.
Regrouper les sous-sections sous leur parent, afficher le nombre de variables et une phrase
résumant la condition, avec accès direct à la règle. Garder les clés techniques dans les détails
quand elles sont nécessaires. Respecter les versions modifiables et la provenance des blocs importés.
L'aperçu fidèle demeure disponible ; ni simulation ni aperçu ne sauvegardent de brouillon réel.

**Cas dimensionnant : 216 variables, plus de 20 règles.** La fixture reproductible utilisera
au minimum 216 variables et 24 règles fictives, réparties en blocs, sous-sections et tronc commun.
Elle comprendra des libellés proches, des variables calculées, plusieurs règles concernant une
même variable et des types/scopes différents. Ne pas copier des données réelles pour cet essai.

**UX-14(a) — Se repérer et modifier sans perdre sa place.**

- Donner un accès direct à trois espaces : **Variables**, **Sections**, **Règles**, avec leurs
  nombres. La liste des règles ne doit plus exiger de traverser 216 variables. Le changement
  d'espace conserve la saisie et l'état de recherche sans déclencher une sauvegarde métier implicite.
- Maintenir la barre de recherche/filtres déjà disponible et rendre leur remise à zéro évidente.
  Afficher « 12 variables affichées sur 216 » ; inclure une entrée explicite Tronc commun dans
  le filtre de section. La recherche par libellé, clé et description existante reste disponible.
- Une ligne compacte présente les informations de repérage ; le détail vit dans le panneau
  d'édition. Permettre une vue d'ensemble par blocs avec compteurs, sans ouvrir tous les détails
  par défaut pour un grand modèle ; l'accès aux variables du tronc commun reste évident.
- Ajouter un index compact des sections parent/enfants avec compteurs total/filtré. Choisir une
  section y conduit directement et ouvre son groupe ; cela ne nécessite pas de parcourir les
  sections précédentes. L'index reste accessible au clavier et dans un panneau mobile.
- Un tri de consultation par libellé, clé, section, type ou scope est possible avec départage
  stable et retour à « ordre du formulaire ». Trier l'affichage ne réordonne jamais les données.
- Ouvrir une variable conserve la liste et sa position sur grand écran. Sur petit écran, un
  panneau dédié propose un retour explicite à la même liste filtrée et au même emplacement.
- Après enregistrement, garder recherche, filtres, blocs ouverts, variable active et position.
  Si la modification fait sortir la variable du filtre, l'annoncer et proposer « Voir la variable ».
- Les commandes Précédente/Suivante et Enregistrer puis suivante existent déjà : les conserver,
  préciser leur périmètre filtré et protéger les changements non enregistrés avant de changer
  de variable. Fin de résultat filtré = fin annoncée, pas passage silencieux à une variable hors filtre.
  Le panneau donne la position dans les résultats et la section de la variable. Fermer par X,
  Échap ou clic sur le fond protège les modifications de la même manière que Précédente/Suivante.
- Distinguer « aucune modification », « modifications non enregistrées », « enregistrement en
  cours », « enregistré » et « échec ». Un simple retour de `busy` à faux n'est pas une preuve de succès.

**UX-14(b) — Retrouver les règles et comprendre leur portée.**

- Dans l'espace Règles, proposer recherche par libellé de variable/bloc et filtres par type
  de règle, variable source/cible, bloc concerné et sévérité lorsqu'elle s'applique. Afficher la
  portée du filtre et le total ; conserver une action Ajouter une règle accessible sans traverser
  toutes les règles. Après création/modification, revenir à la règle concernée.
- Une ligne résume chaque règle en langage lisible avec source, condition, cible et effet ;
  conserver l'accès au détail et au formulaire guidé. Ne pas imposer du JSON pour une tâche courante.
- Dans le panneau d'une variable, afficher ses règles liées, en distinguant « cette variable
  déclenche » et « cette variable est concernée ». Depuis une règle, accéder directement à ses
  variables/blocs ; depuis une section, afficher ses conditions et règles pertinentes.
- Les sélecteurs de variables de RuleForm deviennent recherchables par libellé/clé, avec
  contexte de section, type et scope pour distinguer deux libellés proches. Cette recherche vaut
  pour les deux variables d'une comparaison, le champ de condition et la cible. Ils conservent les exclusions
  de type/scope/formule et la validation existantes ; ils ne deviennent pas des entrées libres.
- Montrer les dépendances utiles avant une suppression ou modification structurelle. Un refus
  doit permettre de retrouver la règle concernée ; aucune suppression en cascade n'est inventée.
- Une recherche ou un déplacement dans cet espace ne change ni l'ordre métier des variables,
  ni les clés de règles, ni leurs effets. Les résumés doivent refléter le moteur réel.

**UX-14(c) — Créer des règles similaires sans les ressaisir une à une.**

Deux actions répondent au besoin : **Dupliquer la règle**, pour une variante, et **Appliquer
à plusieurs variables**, pour une même condition et un même effet sur plusieurs cibles.
Exemple fictif : « Si chirurgie = Oui, rendre date d'intervention, technique et opérateur
obligatoires ». L'utilisateur saisit la condition une seule fois, recherche/coche les trois
cibles, vérifie trois phrases puis confirme une seule création.

- La v1 de l'application multiple couvre les effets conditionnels existants « obligatoire »
  et « visible » sur des variables compatibles. Une comparaison entre deux variables reste
  duplicable avec modification explicite de ses opérandes ; aucun sens de cible multiple
  n'est déduit arbitrairement pour un autre type de règle.
- Si l'objectif est d'afficher tout un bloc, proposer la **règle de visibilité de bloc existante**
  avant de créer une règle par variable. Un sous-ensemble ou une obligation par variable utilise
  les cibles multiples. Pas de nouvelle obligation globale de section inventée.
- Sélecteur de cibles recherchable et groupé par section, avec sélection conservée hors filtre,
  compteur et liste récapitulative. « Sélectionner les résultats » indique exactement combien
  et quel ensemble sera sélectionné ; ne jamais sélectionner implicitement des éléments masqués.
- Préremplir les paramètres de la règle dupliquée, mais exiger le choix/contrôle de la cible.
  La source n'est pas modifiée. L'édition ultérieure d'une règle créée ne change pas ses voisines.
- **Réutiliser les règles unitaires actuelles.** L'opération produit des règles ordinaires,
  sans introduire un nouveau langage de règles multicibles ni changer l'évaluation des dossiers.
  Un regroupement visuel par condition commune n'implique pas un lien mutable entre règles.
- L'aperçu montre les règles à créer, les doublons exacts déjà présents, les cibles incompatibles
  et les conflits. Les doublons exacts sont signalés et laissés inchangés ; une règle différente
  sur la même cible n'est pas écrasée. Une cible invalide empêche la confirmation jusqu'à
  correction ou retrait explicite ; aucune réussite partielle cachée.
- **Un contrat serveur dédié à l'opération groupée** vérifie les droits et l'état modifiable
  de la version, sa révision attendue, l'appartenance et la compatibilité de chaque cible,
  les règles existantes et l'ensemble des règles proposées, notamment leurs cycles combinés.
  Création dans une transaction ; erreur = aucune règle créée/modifiée par cette opération.
- Rejeu idempotent après double clic ou réponse perdue, avec même clé et même payload.
  Une version modifiée depuis l'aperçu produit un conflit structuré et conserve condition/cibles
  côté UI. La révision/version et le résultat réel sont revérifiés à la confirmation.
- Après succès : « 3 règles créées, 1 règle identique déjà présente », lien vers les règles
  concernées et maintien du contexte de travail. Aucun état « créé » avant l'accusé serveur.

La présentation peut précéder l'implémentation, mais ce sous-lot n'est pas livré tant que
l'écriture atomique, l'autorisation et les tests de concurrence ne sont pas exécutés. Une boucle
de créations depuis le navigateur, avec conservation de la moitié en cas d'échec, est exclue.

**UX-14(d) — Réorganisation et réactivité mesurée.**

- Prévoir un déplacement explicite « vers une section » ou « avant/après une variable » sans
  glisser un élément sur plusieurs écrans. Maintenir un équivalent clavier/tactile du glisser-déposer.
  Montrer la destination et préserver clés, règles, provenance et restrictions d'usage.
- Les modifications groupées sont une extension à confirmer après usage de (a)/(b), pas un
  prérequis au soulagement initial. Si retenues : sélection et périmètre visibles, aperçu des effets,
  contrôle serveur et écriture atomique de l'opération ; aucun changement structurel partiel.
- Mesurer recherche, filtrage, ouverture du panneau, navigation, sauvegarde et mise à jour de la
  liste sur la fixture 216/24. Éviter qu'une petite modification remette tout l'écran en chargement.
- La pagination/virtualisation de la liste n'est introduite que si le rendu mesuré le justifie ;
  elle doit alors préserver le focus, les résultats de recherche et les accès aux règles/variables.
  Le nombre de variables seul n'est pas une preuve de problème de performance.

Les priorités exprimées sont (b) retrouver les règles et leurs variables, (c) appliquer une
condition à plusieurs cibles, et (a) naviguer entre sections/variables. La réorganisation (d),
les modifications structurelles groupées et les optimisations non mesurées viennent ensuite.
Le placement du diagnostic et les rubriques communes constituent toutefois un besoin explicite
supplémentaire traité par UX-16, qui n'attend pas ces optimisations facultatives.
Ces quatre sous-livraisons partagent UX-14 et ses propriétaires de fichiers ; ce ne sont pas
quatre réécritures parallèles de l'éditeur.

### 6.4 Synchronisation, import et export

Présenter d'abord les différences de conflit sous forme de tableau : champ, réponse locale,
réponse serveur, résultat proposé. Utiliser les libellés/options de la bonne version.
Si cette version n'est pas disponible, signaler la limite et éviter une résolution aveugle.
Un « garder les deux » n'est présenté que lorsque sa signification métier est définie.
Les décisions par champ ou nouvelles fusions nécessitent le contrat serveur correspondant.

Conserver le compteur d'import existant, ajouter l'état d'exécution et un bilan final lisible.
Si un arrêt est proposé, préciser qu'il intervient entre unités atomiques et ce qui a déjà été
enregistré ; arrêter n'est pas annuler les écritures passées. Reprise et annulation utilisent
les opérations de lot existantes ou un contrat serveur explicitement étendu.

Pour l'export : « Génération en cours », résultat/échec accessible et historique structuré avec
date, format, population, profil et projection utiles. Détails techniques secondaires.
Ne pas inventer de pourcentage si le serveur ne fournit pas de progression exploitable.

### 6.5 Sobriété visuelle

Conserver la palette, la typographie et les primitives du projet. Une action principale
identifiable par zone ; bordures/surfaces limitées ; textes cliniques lisibles ; détails à la
demande ; couleur réservée aux sélections et états utiles. Éviter les cartes imbriquées,
badges répétitifs, animations décoratives et barres fixes superposées.
Vérifier contrastes et lisibilité en thèmes clair/sombre, sans prétendre à une conformité
globale avant les contrôles d'accessibilité. Respecter la réduction des animations.

## 7. Lots, dépendances, charge et sortie

Toutes les lignes ci-dessous sont **à réaliser/valider** dans ce chantier. UX-0 dispose d'un
audit initial, mais son contrat complet et sa matrice de reprise ne sont pas déclarés achevés.
Les charges sont relatives et seront affinées après UX-0 ; elles ne sont pas des délais.

| Lot | Objet | Dépendances de livraison | Charge |
|---|---|---|---|
| UX-0 | Diagnostic et contrat commun | — | Faible à moyenne |
| UX-1 | Conservation de saisie et corrections immédiates | UX-0 | Moyenne |
| UX-2 | Brouillons serveur sécurisés | UX-0 | Élevée |
| UX-3 | Autosauvegarde, états et reprise | UX-1 + UX-2 | Élevée |
| UX-4 | Valeurs des blocs devenus inapplicables | UX-3 + socle confirmations UX-13 | Moyenne à élevée |
| UX-5 | Blocs repliables et actions accessibles | UX-1 + UX-4 + UX-13 | Moyenne |
| UX-6 | Sommaire, avancement et champs manquants | UX-5 | Moyenne |
| UX-7 | Validation intégrée du périmètre retenu | Lots livrés UX-1 à UX-6 et UX-10 à UX-16 | Moyenne, à ajuster |
| UX-8 | Extension/durcissement de la reprise locale | UX-7 + décisions de support/politique | Élevée ; extension |
| UX-9 | Un seul bloc affiché à la fois | UX-7 + retour d'usage | Moyenne ; extension |
| UX-10 | Présentation des champs à choix et adaptation mobile | UX-1 | Moyenne |
| UX-11 | Recherche dans les longues listes d'options | UX-10 | Moyenne à élevée |
| UX-12 | Navigation des bases et recherche/listes patients | UX-0 ; contrat serveur pour recherche/tri | Moyenne à élevée |
| UX-13 | Erreurs, confirmations, focus et attente | UX-0 ; coordination UX-1 | Moyenne |
| UX-14 | Édition des modèles volumineux et création groupée de règles, référence 216 variables / plus de 20 règles | UX-1 + UX-13 ; contrat serveur pour (c) | Élevée, sous-livraisons (a)/(b)/(c)/(d) |
| UX-15 | Conflits, import/export et résultats | UX-13 ; contrats serveur selon action | Moyenne à élevée |
| UX-16 | Rubriques communes renommables/déplaçables et placement libre du diagnostic | Contrat UX-0 + UX-1/13 ; socle L54/L55 revérifié ; coordination UX-14 et UX-5/6 | Élevée, (a) contrat puis (b) édition/rendu |

### UX-0 — Diagnostic et contrat

- **Contenu :** matrice par écran, rôle, zone de données, interruption et support disponible ;
  actualiser C01–C15 et les reprises existantes ; fixer TTL, limites de payload, cadence,
  identité couverte/non couverte, traitement des anciens brouillons et preuves attendues.
- **Surface :** formulaires, `data/drafts.ts`, politique offline, versions et contrats métiers.
- **Sortie :** décisions §9 closes pour les lots dépendants ; un scénario reproductible par perte
  identifiée, sans modifier encore les garanties métier.
- **Risque :** confusion entre brouillon de travail, fiche `draft`, outbox et brouillon de curation.

### UX-1 — Conservation et reprises existantes

- **Contenu :** conservation entre blocs, après refus/conflit, avertissements de départ,
  correction de la restauration intake déjà autorisée ; aucune fermeture sur échec de sauvegarde.
  Préserver les brouillons préexistants lors d'un changement de version de l'application.
- **Surface :** création/édition patient et rencontre, état partagé et protections de navigation ;
  correction ciblée de `MyTemplates.saveEdit` avant son amélioration visuelle en UX-14.
- **Sortie :** scénarios de saisie/navigation/échec reproduits puis corrigés ; limites de récupération
  de l'identité annoncées. Pas de nouvelle persistance sensible décidée par l'interface seule.
- **Risque :** réinitialisation au rechargement ou démontage ; avertissement de départ pris pour sauvegarde.

### UX-2 — Brouillons serveur

- **Contenu :** implémenter le contrat §4.3, compatibilité des anciens clients, migration additive,
  nettoyage expiré et récupération après commit à réponse perdue.
- **Surface :** stockage/RPC/policies et contrat repository couplés sous un responsable unique.
- **Sortie :** tests autorisation, isolation, révisions, concurrence, idempotence et atomicité
  réussis sur cible locale/jetable ; `npm run schema`, inspection du snapshot, `npm run schema:check`.
  Si fonction privilégiée : ACL/allowlists applicables et tests correspondants.
- **Risque :** droits étendus, brouillon ressuscité, écrasement récent, doublon métier ou suppression partielle.

### UX-3 — Autosauvegarde et reprise

- **Contenu :** appels coordonnés, accusé associé à la bonne révision, états §4.2, reprise/suppression
  explicite, conflits multi-onglets/appareils, reconnexion, gestion des champs non couverts.
- **Surface :** couche de brouillons commune et formulaires ; réutiliser les protections UX-1.
- **Sortie :** après accusé, récupération identique ; après échec, aucun état trompeur ; ancienne
  réponse sans effet sur les nouvelles frappes ; modèle incompatible conservé pour résolution.
- **Risque :** « sauvegardé » affiché trop tôt ou confusion entre copie locale et serveur.

### UX-4 — Conditions et retrait de valeurs

- **Contenu :** distinguer repli/applicabilité, conserver les valeurs retirées dans le brouillon,
  réactivation dans la même version, confirmation accessible et projection serveur (§4.4).
- **Surface :** moteur de valeurs actives, hook de retrait, formulaires et contrat de sauvegarde.
- **Sortie :** remplir → masquer → réactiver restitue les réponses ; enregistrement confirmé et
  exports excluent les valeurs inapplicables ; conflit conserve toute la saisie.
- **Risque :** fuite vers les calculs/exports ou perte silencieuse de données.

### UX-5 — Blocs repliables

- **Contenu :** plusieurs blocs ouverts, Tout déplier/replier, en-têtes utiles, actions accessibles,
  ouverture du bloc nécessaire à une correction et maintien du focus.
- **Surface :** `SectionedFields` / `EncounterFields`, création/édition et aperçu.
- **Sortie :** toutes les variables accessibles au clavier/mobile sans perte au repli ; erreurs
  des blocs fermés visibles ; barre d'action sans recouvrement du champ actif.
- **Risque :** démontage destructeur, erreur cachée, multiplication de niveaux visuels.

### UX-6 — Sommaire et avancement

- **Contenu :** sommaire ordinateur/mobile, position courante, accès au prochain manque,
  compteurs selon applicabilité/version, annonces des nouveaux blocs sans déplacement imposé.
- **Surface :** formulaires et helpers de complétude existants, sans moteur parallèle contradictoire.
- **Sortie :** compteurs cohérents avec les validations pour chaque type/statut et condition ;
  couverture diagnostique distincte ; zéro champ requis traité ; retour clavier correct.
- **Risque :** pourcentage trompeur, double comptage de variables communes, recalcul coûteux.

### UX-7 — Validation intégrée

- **Contenu :** matrice §8 pour tous les lots effectivement retenus, scénarios de reprise et de
  navigation, accessibilité ciblée, mesures sur longs formulaires et lots d'opérations.
- **Surface :** tests ciblés web/DB/Edge selon changements, parcours navigateur fictifs, rapport de preuve.
- **Sortie :** chaque scénario critique possède résultat, environnement et version ; aucun échec
  non résolu masqué par un test ignoré ; preuves locales et déployées séparées.
- **Risque :** succès de composants isolés confondu avec validation complète. UX-8/9 repassent
  ensuite la partie pertinente d'UX-7 ; ils ne sont pas requis pour sa première livraison.

### UX-8 — Reprise locale complémentaire

- **Contenu :** support/TTL/purge/chiffrement éventuel selon décisions UX-0/L39 et politique,
  migration des anciens brouillons et synchronisation des révisions dans l'intake autorisé.
- **Surface :** stockage local, outbox, reprise et tests de poste partagé ; identité séparée.
- **Sortie :** matrice de données autorisées, migration/purge et reprise vérifiées ; aucune ouverture
  de lecture des patients existants hors connexion, aucune activation cloud implicite.
- **Risque :** exposition sur poste partagé ou régression de l'intake. Ce lot n'est pas une autorisation
  d'usage de données réelles ni un prérequis au correctif C02.

### UX-9 — Un seul bloc à l'écran

- **Contenu :** extension après retour d'usage : un bloc visible, Précédent/Suivant et sommaire
  à accès libre ; maintien intégral de la saisie, état de reprise et bloc courant.
- **Surface :** présentation des formulaires après UX-5/6, sans assistant linéaire obligatoire.
- **Sortie :** aller-retour entre blocs, correction d'erreur et reprise sans perte ; utilisateur
  libre de revenir à une partie déjà remplie.
- **Risque :** étapes rigides inadaptées à la saisie clinique ou destruction d'état au démontage.

### UX-10 — Champs à choix et mobile

- **Contenu :** §5.2, grilles/radios/select, compteur, Autre existant, sélection lisible,
  colonnes responsive y compris type/date/statut et identité ; réutiliser les cibles tactiles.
- **Surface :** `FieldInput`, `ValueInput`, `ChoiceWithProposal`, composants communs et aperçu.
- **Sortie :** mêmes valeurs métier avant/après ; choix utilisables au clavier/toucher, texte
  entier sur téléphone, états requis/erreurs compréhensibles ; thèmes clair/sombre vérifiés.
- **Risque :** changement involontaire de valeur, exclusivité inventée ou sélection indiquée seulement par couleur.

### UX-11 — Longues listes d'options

- **Contenu :** recherche, sélections persistantes hors filtre, retrait individuel, chargement/reprise
  et options historiques ; réutiliser la recherche de terminologie sans double implémentation.
- **Surface :** champs à choix et leurs sources ; aucune recherche patient dans ce lot.
- **Sortie :** filtrer/sélectionner/effacer filtre/retirer/reprendre fonctionne sans perte, y compris
  avec résultats paginés, réponses tardives et option déjà enregistrée absente du résultat courant.
- **Risque :** choix masqué oublié, clé remplacée par libellé, pagination incomplète.

### UX-12 — Navigation et listes de patients

- **Contenu :** le plan [L61 à L65](l61-liste-patients-recherche-tri-identite.md) découpe désormais
  UX-12 : (L61) preuve du contexte/page/erreurs, préférences de colonnes, recherche code et tri
  technique déjà présents ; (L62) contrat serveur de tri par variable ; (L63) commande accessible ;
  (L64) recherche nominative et nom sélectionnable avec preuves identité ; (L65) validation
  intégrée. Rendre onglets et pagination accessibles sur mobile (§6.1).
- **Surface :** `BaseHome`, `BaseLayout`, `CommandPalette`, repositories et contrat de recherche.
  Un seul responsable possède simultanément une RPC et ses appelants ; les lots L61/L63/L64 ne
  modifient pas `BaseHome` en parallèle.
- **Sortie :** base A page 3 → base B donne le bon contexte/page ; patient hors page trouvé ;
  résultats stables ; filtres/colonnes périmés purgés ; variable interdite refusée ; refus d'identité
  testé sans nom, résultat, compteur ou tri révélateur.
- **Risque :** filtre limité aux 20 lignes, état périmé, mélange de bases, tri JSON coercitif ou
  fuite par recherche/tri/compteur.

### UX-13 — Erreurs, confirmations et attente

- **Contenu :** §6.2, résumé/liens/champ, erreur au point d'action, messages actualisés,
  confirmations accessibles, navigation clavier et états de sauvegarde/opération cohérents.
- **Surface :** primitives communes, formulaires et fiche patient ; interfaces partagées avec UX-3/4/5.
- **Sortie :** clavier maintenu dans la modale et restauré ; erreur hors écran accessible ; correction
  enlève le message obsolète ; aucune action réputée réussie après échec.
- **Risque :** focus déplacé à chaque frappe, toasts trop courts, double confirmation.

### UX-14 — Éditeur de modèles

- **Contenu :** §6.3 : erreurs de panneau, hiérarchie lisible, conditions résumées et accès direct,
  conservation des renommages et éditions refusés ; réutiliser le correctif immédiat UX-1.
  Sous-livraisons : (a) espaces Variables/Sections/Règles et contexte conservé ; (b) recherche
  et liens des règles, sélecteurs de variables recherchables ; (c) duplication et application
  d'une condition à plusieurs cibles avec aperçu/transaction ; (d) déplacement direct et réactivité
  mesurée. Les outils existants sont améliorés, pas recréés.
- **Surface :** `MyTemplates`, `TemplateVersionEditor`, `SectionsEditor`, `RuleForm`, `FieldForm`.
  Pour (c), contrat repository/RPC, migration additive éventuelle et tests ACL/RLS/concurrence
  sous un responsable d'écriture unique avec l'appelant ; les nouvelles migrations suivent
  génération/inspection/contrôle de schéma comme UX-2.
- **Sortie :** section/parent/règle retrouvables, édition refusée encore modifiable, versions et
  provenance préservées ; aperçu fidèle sans effet de bord. Sur 216 variables / 24 règles,
  accès direct à une variable/règle éloignée, retour à la même liste après édition et navigation
  entre éléments filtrés sans perte ; création de règles similaires en une opération confirmée,
  sans doublon ni création partielle ; temps d'interaction mesurés et comparés au seuil UX-0.
- **Risque :** conflit avec L58–L60, clés métier modifiées par une retouche de présentation,
  dépendance/cycle combiné omis, création partielle de règles, perte de contexte ou optimisation
  qui casse clavier et recherche.

### UX-15 — Opérations et résultats

- **Contenu :** §6.4 : conflits en libellés, états et bilan d'import/export, historique lisible ;
  séparer présentation des décisions existantes et nouvelles opérations d'arrêt/fusion.
- **Surface :** `SyncCenter`, `ImportData`, `ExportPanel` ; opérations serveur si contrat étendu.
- **Sortie :** différence et effet de chaque choix compréhensibles ; aucun pourcentage fictif ;
  échec/reprise sans doublon ni écriture partielle dans une unité atomique ; bilan explicite
  des unités déjà validées. Un arrêt entre unités ne prétend pas les annuler ; toute annulation
  suit le contrat du lot. Projection/permissions d'export inchangées.
- **Risque :** arrêt pris pour rollback, fusion clinique ambiguë, décision sur mauvaise version.

### UX-16 — Rubriques communes et placement diagnostique

- **Contenu :** §5.3 ; (a) contrat de présentation versionné, migration additive, lectures,
  copies et écritures atomiques ; (b) renommer/déplacer/répartir les rubriques et variables,
  diagnostic compris, avec aperçu fidèle et raisons d'inéligibilité lisibles.
- **Surface :** métadonnées de version, repository/RPC, copies/imports concernés,
  `templateSections`, `SectionsEditor`, `FieldForm`, `DiagnosisConfigurationEditor`,
  `TemplateVersionEditor`, `SectionedFields`, `PatientDetail`, sommaire et dictionnaire de modèle.
  Un responsable unique possède le contrat, ses appelants et le rendu couplé.
- **Sortie :** exemple §5.3 réalisable au clavier/mobile ; diagnostic déplacé après l'évaluation
  sans modifier couverture, déclenchements ou colonnes communes exportées ; ancienne version
  inchangée, copie autonome, conflit sans écriture partielle. Tests ciblés web/DB/ACL, export et
  copies ; après migration, `npm run schema`, inspection du snapshot, puis `npm run schema:check`.
  Les scénarios T30–T34 sont exécutés avant de déclarer ce lot validé.
- **Risque :** rubrique visuelle traitée comme bloc clinique, pilote masqué, variable dupliquée
  ou omise, copie interversion incorrecte, métadonnées effacées par un ancien client.

## 8. Ordre d'exécution, responsabilités et validation

### 8.1 Ordre et collisions

1. UX-0 ; préparer la matrice de reprise et les décisions sans déclarer l'audit initial suffisant.
2. UX-1 et fondations UX-13. UX-2 peut avancer indépendamment après son contrat UX-0.
3. UX-3 puis UX-4 ; UX-10 peut avancer après UX-1, puis UX-11.
4. UX-5 puis UX-6 ; UX-12/14/15 avancent selon contrats et propriétaires de fichiers.
   UX-16(a) puis (b) peut avancer après son socle ; séquencer ses changements partagés avec
   UX-14 et UX-5/6, sans attendre les optimisations facultatives d'UX-14(d).
5. UX-7 sur le périmètre livré ; UX-8 et UX-9 restent des extensions, suivies de leur validation.

Le premier jalon de protection réunit UX-1/2/3/4 et le socle de confirmations UX-13, avec leurs
tests ciblés. Il n'est pas une validation de tous les lots ni une autorisation de déploiement.

| Surface couplée | Lots à coordonner |
|---|---|
| État des formulaires et reprise | UX-1/3/4/5/6/13 ; L39 et O0–O7 |
| Champs et rendu de sections | UX-4/5/6/10/11/13/16 |
| Contrat brouillon, RPC, policies, repository | UX-2/3/8 : un seul responsable d'écriture couplée |
| BaseHome et recherche serveur | UX-12 et chantier historique de recherche ; vérifier chevauchements L42/L56 sur repositories/RPC, pas deux RPC concurrentes |
| Éditeur de modèles | UX-1/14/16 et L54/L55/L58–L60 ; UX-14(c) et UX-16 couplent contrat serveur et appelants, à séquencer sur les copies et sections |
| Opérations de conflit/import/export | UX-15 et contrats métiers déjà livrés |

Le parallélisme n'est permis que sur des fichiers/responsabilités indépendants. Une revue
indépendante reste en lecture seule. Le coordinateur intègre et vérifie les interfaces communes.

### 8.2 Scénarios d'acceptation transversaux

| Test | Scénario et résultat attendu | Lots |
|---|---|---|
| T01 | Saisir, replier, changer de bloc, revenir : réponses et obligations inchangées | 1/5/9/10 |
| T02 | Après accusé de brouillon, recharger : reprise de la bonne révision et du bon contexte | 2/3 |
| T03 | Stockage local indisponible ou quota atteint : aucune fausse confirmation ; support de repli explicitement annoncé | 1/3/8 |
| T04 | Brouillon de rencontre d'un patient local intake : reprise dans le même compte et contexte autorisé | 1/3/8 |
| T05 | Deux onglets/appareils, réponses inversées : conflit structuré, aucune saisie écrasée | 2/3 |
| T06 | Commit métier réussi, réponse perdue, rejeu : une seule fiche/écriture et accusé récupérable | 2/3 |
| T07 | Autosave tardif après consommation/suppression : aucun brouillon ressuscité ; nouvelles frappes préservées | 2/3 |
| T08 | Expiration, changement de compte, rôle retiré : pas d'accès croisé, pas d'écriture automatique interdite, purge conforme | 2/3/8/12 |
| T09 | Remplir → condition fausse → vraie : réponses retrouvées ; retrait annoncé avec nombre/champs et détails autorisés ; annuler conserve la saisie sans écriture métier ; confirmer puis enregistrer donne la projection active correcte | 4/5/13 |
| T10 | Version modifiée, option historique retirée, fiche éditée ailleurs : reprise sans remappage silencieux | 2/3/4/11 |
| T11 | Erreur dans un bloc fermé : résumé cliquable, bloc ouvert, focus visible ; après correction, message actualisé | 5/6/13 |
| T12 | Aucun requis, requis conditionnels, valeurs manquantes codifiées, valeur invalide : compteurs conformes au moteur | 6 |
| T13 | Filtrer une liste puis changer le filtre/page : sélection conservée ; terminologie sans régression | 10/11 |
| T14 | Base A page 3 → B ; retour A ; filtre modifié ; erreur réseau : contexte/page/message justes | 12 |
| T15 | Patient au-delà de la première page retrouvé ; recherche/tri/total ne révèlent aucune donnée interdite | 12 |
| T16 | Rôle saisisseur, curateur, médecin et administrateur : palette et routes cohérentes ; recherche patient selon décision | 12 |
| T17 | Tab/Shift+Tab/Échap dans confirmations et tiroir ; fermeture rend le focus ; accès au contenu principal | 13 |
| T18 | Renommage/édition de variable refusés : panneau ouvert et valeurs conservées | 1/14 |
| T19 | Distinguer arrêt utilisateur et interruption technique d'un import ; reprise/conflit/export en échec : aucune écriture partielle dans une unité atomique ni duplication ; bilan des unités déjà validées, sans prétendre à leur annulation | 15 |
| T20 | Long formulaire cible : 12 blocs d'environ 20 variables, sous-sections, choix longs, ordinateur/mobile/zoom/thèmes | 5/6/10/11/13 |
| T21 | Aperçu du même modèle : rendu fidèle, aucune écriture locale ou distante | 5/6/10/11/14 |
| T22 | Brouillon de travail absent des exports/statistiques ; fiche métier `draft` conserve les règles d'export actuelles | 2/3/4/15 |
| T23 | Fixture 216 variables / 24 règles : retrouver une variable en fin de modèle, modifier, enregistrer et retrouver filtre/position ; navigation Précédente/Suivante ne perd pas une édition non enregistrée | 1/14 |
| T24 | Retrouver une règle au-delà des 20 premières ; filtrer par source/cible/bloc, accéder aux variables liées et sélectionner une variable parmi 216 sans parcourir une liste native entière | 14 |
| T25 | Déplacer une variable distante via commande explicite ; références et provenance inchangées, destination lisible, échec sans modification structurelle partielle | 14 |
| T26 | Mesurer recherche, panneau et sauvegarde sur fixture 216/24 ; aucun écran entier réinitialisé inutilement, erreur locale visible et indicateur « enregistré » uniquement après succès | 13/14 |
| T27 | Créer une condition et sélectionner plusieurs cibles réparties dans les sections : aperçu de chaque règle, filtrage sans perte des choix, un seul geste de confirmation, règles unitaires correctes | 14(c) |
| T28 | Une cible invalide/cycle, accès refusé, version modifiée ou échec intermédiaire : aucune règle partiellement créée ; condition/cibles conservées ; doublons exacts annoncés et inchangés | 14(c) |
| T29 | Réponse perdue/double clic sur création groupée : rejeu sans doublon ; modifier ensuite une règle générée ne modifie pas les autres ; visibilité d'un bloc entier reste exprimable en une règle de bloc | 14(b)/(c) |
| T30 | Renommer le tronc commun « Diagnostics retenus », le placer après un bloc, puis répartir les variables en plusieurs rubriques : ordre et titres identiques en saisie/édition/consultation/aperçu/sommaire, une seule occurrence par variable | 5/6/14/16 |
| T31 | Déplacer le pilote et son compagnon dans une rubrique commune : association, couverture, valeurs et projection L53 identiques ; rubrique non ciblable par condition de bloc ; aucune activation ne déplace le focus | 4/6/16 |
| T32 | Ancienne version sans métadonnées, copie de version, import d'un bloc réutilisant une variable commune : repli historique, copie autonome, placement cible conservé et aucun champ omis/dupliqué | 16 |
| T33 | Version gelée, accès refusé, déplacement concurrent, réponse perdue ou suppression d'une rubrique occupée : refus/choix explicites, aucune perte de saisie ni écriture partielle, rejeu sans doublon | 1/13/16 |
| T34 | Variable diagnostique select/multiselect/terminology déjà compatible retrouvable ; variable inéligible accompagnée d'une raison ; renommage sans changement de clé, scopes distincts et dictionnaire sans confusion rubrique/bloc | 14/16 |

Pour T20, mesurer temps de réaction à la frappe, coût des recalculs, nombre de requêtes de
sauvegarde et taille des données ; fixer les seuils de non-régression dans UX-0 à partir d'une
mesure de référence. Ajouter un appareil/téléphone réel pour le clavier virtuel et la PWA.
Ne pas confondre l'aperçu responsive de l'audit et un test de ces parcours complets.

Les tests DB utilisent une cible locale/jetable vérifiée. Après migration : génération du
schéma, inspection et `schema:check`. Build de production avec `VITE_USE_SIGNED_READ=true`.
Les migrations/RPC touchant l'autorisation nécessitent une revue indépendante ciblée et les
tests ACL/RLS correspondants. Toute validation sur environnement déployé est rapportée séparément.

## 9. Décisions à fermer en UX-0 et suivi des preuves

| Décision | Bornes déjà retenues | Condition de sortie |
|---|---|---|
| TTL, support et migration des brouillons | Serveur connecté + local dans périmètre autorisé ; L39, TTL intake et politique de purge applicables | Valeurs, migration des 72 h existantes, comportement d'expiration et quota consignés |
| Couverture par écran et zone | Analytique et identité séparées ; création sans cible persistée prise en compte | Matrice explicite, limites affichées ; protection de l'identité traitée par un mécanisme autorisé distinct |
| Contrat de concurrence | Révisions, idempotence, droits actuels, consommation atomique | Échanges repository/RPC et erreurs structurées arrêtés avant UX-2/3 |
| Recherche nominative UX-12(c) | Décision du 20 août complétée le 2026-09-11 : nom sélectionnable seulement pour un médecin avec `can_view_identity` ; preuve identité distincte | L64 réalise le contrat audit/RLS, puis L65 rattache les tests d'accès, révocation et non-divulgation |
| Arrêt d'import et fusion par champ | Aucune nouvelle sémantique inventée dans l'UI | Contrat serveur retenu ou présentation des seules actions existantes |
| Objectifs de performance | Fixture dimensionnante et appareil de référence | Mesure initiale et seuils reproductibles consignés, sans score UX arbitraire |
| Éditeur volumineux | Priorités précisées : retrouver règles/variables, réutiliser une condition sur plusieurs cibles, naviguer par sections ; outils de recherche/édition déjà présents | Référence 216/24 ; (a)/(b)/(c) prioritaires, contrat atomique de (c) arrêté ; optimisations et modifications structurelles groupées seulement si justifiées |
| Présentation du tronc commun UX-16 | Renommage, position libre et plusieurs rubriques communes décidés ; sémantique commune préservée | Métadonnées versionnées, ordre commun avec les blocs, copie, compatibilité des anciens clients et contrat atomique arrêtés avant UX-16(a) |
| Définition du diagnostic pilote | Placement découplé du rôle ; types déjà pris en charge et un pilote par scope conservés | Préciser tout besoin au-delà du placement ; un éventuel contrat multisource est spécifié séparément et ne bloque pas UX-16 |

Pour chaque lot, enregistrer **spécifié / implémenté / validé localement / validé sur la cible**,
commit ou empreinte du diff, commandes/scénarios exécutés, résultat et limites. Une spec,
une capture, des tests écrits ou une CI sans le scénario concerné ne suffisent pas à valider le lot.

Références de conception : [notifications de formulaire W3C](https://www.w3.org/WAI/tutorials/forms/notifications/)
et [dialogues modaux W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
Ces références ne constituent pas une certification d'accessibilité du projet.
