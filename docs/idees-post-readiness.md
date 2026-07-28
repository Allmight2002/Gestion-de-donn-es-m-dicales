# Idées produit post-readiness — file d'attente

- Tenu à jour à partir des échanges avec le porteur (Dr Mbassi)
- Dernière mise à jour : 2026-07-26

Cette liste rassemble les **chantiers concrets** identifiés mais **volontairement non commencés**. Elle est distincte des études `docs/strategie-produit-post-mvp*.md` (stratégie de marché et positionnement) : ici, ce sont des évolutions techniques précises, prêtes à être spécifiées puis construites.

## Cadre commun — à lire avant toute mise en œuvre

Depuis la décision de cadrage du 2026-07-26, la fermeture de B1–B10 n'est plus
une précondition au **développement local**. B2, B6, B7 et B10 sont explicitement
différés : ils restent ouverts et bloquants pour les données réelles, le pilote
clinique et la production, mais ils n'interdisent plus de construire et tester
avec des données entièrement fictives.

La mise en œuvre suit
[`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md).
Toute modification produit un nouveau SHA à revalider ; les preuves antérieures
restent historiques pour leur propre SHA et ne sont pas transférées au nouveau
candidat.

Ordre obligatoire ajouté le 2026-07-26 : aucune idée ni correction UX de cette
file ne commence avant la fin de la Phase 0 puis la finalisation du chantier
antérieur **B3 → B4 → B8 → B1 → B9** sur un même candidat traçable.

## File d'attente

| # | Idée | Ampleur | Où c'est bloqué aujourd'hui | Spécification | Statut |
|---|---|---|---|---|---|
| 1 | **Comptes de mission** (rôle `saisisseur`) — un médecin confie la saisie d'une seule base à un étudiant, pour une durée limitée, en création seule, révocable | Moyenne (base + Edge + UI) | — | [`spec-comptes-mission.md`](spec-comptes-mission.md) | Spec écrite ; 6 décisions en attente du demandeur |
| 2 | **Observabilité des erreurs** — être notifié automatiquement des bugs et de leurs causes, sans exposer de donnée patient | Moyenne (front + base + alerting) | Fait partie du blocage monitoring **B5** | [`spec-observabilite-erreurs.md`](spec-observabilite-erreurs.md) | Spec écrite ; 7 décisions en attente du demandeur |
| 3 | **Bouton de suppression de base** — surface dans l'interface la suppression déjà existante côté serveur | Petite (surtout UI) | — | *(à spécifier si besoin)* | Noté ; capacité serveur complète, UI absente |
| 4a | **Registre « Diagnostic urgences » (noyau)** — base à listes contrôlées (diagnostic, motif, issue) pour produire des diagnostics analysables | **Nulle (configuration, pas de code)** | — | *(canevas à préparer)* | Signal terrain fort (directrice des urgences, Tchad) ; faisable dès maintenant en données fictives |
| 4b | **Terminologie diagnostique (programme)** — typeahead searchable, IDs stables, synonymes, attributs par diagnostic, CIM | Grande (sous-système + UI) | Modèle actuel plat, pas de référentiel gouverné | *(cadrée en séance le 2026-07-26)* | **Lancée** : structure du référentiel livrée (T1) ; contenu, type de champ et interface à suivre |
| 5 | **Bibliothèque de jeux de valeurs** — listes prêtes à l'emploi insérables en un clic dans un champ `select`/`multiselect`, au lieu de saisir chaque valeur à la main | Petite (front, contenu pur) | — | *(cadrée en séance le 2026-07-26)* | **Mécanisme livré le 2026-07-26** ; jeux cliniques à enrichir au fil des retours |
| 6 | **Soupape sur le champ de terminologie** — étendre au type `terminology` la soupape livrée pour les listes contrôlées | Petite (front) | — | *(demandée le 2026-07-27)* | À faire |
| 7 | **Constructeur de règles de cohérence** — remplacer la saisie de JSON brut par un assemblage guidé, compréhensible sans culture technique | Moyenne (front) | — | *(demandée le 2026-07-27)* | À faire |
| 8 | **Modèle d'observation d'une base** — rendre le suivi longitudinal explicite et optionnel : étude transversale, suivi répété, ou registre d'événements | Grande (front + une colonne) | — | *(cadrée le 2026-07-27)* | À faire |
| 9 | **Alléger le chargement de l'application** — 1,7 Mo précachés dès la première visite, dont 837 Ko de tableur | Moyenne (configuration du build) | — | *(signalée le 2026-07-27)* | À faire |
| 10 | **Finition de l'interface** — zone de profil trop discrète, cases à cocher système, absence de retour visuel sur les changements d'état | Moyenne (front, transverse) | — | *(signalée le 2026-07-27)* | À faire |

## Notes par idée

### 1. Comptes de mission

Répond au cycle de vie des comptes étudiants (l'étudiant soutient sa thèse, le compte reste). Le socle existe déjà (`base_access`, invitations expirables, révocation, audit) ; il faut un rôle global dédié `saisisseur`, une permission de création séparée, une expiration d'accès et une Edge Function d'invitation. Décision métier la plus sensible : l'étudiant crée-t-il des patients minimaux, ou remplit-il seulement des consultations ? Détail complet dans la spec.

### 2. Observabilité des erreurs

Aujourd'hui, les plantages d'écran sont captés localement (console + tampon de 20 entrées) mais **rien ne remonte** au porteur, et les erreurs d'arrière-plan ne sont pas captées du tout (filet global manquant). La spec décrit un puits interne privacy-safe (table dédiée, écriture par RPC, épuration), la réutilisation du canal d'alerte du monitor (B5) et un écran « État du système » réservé à l'admin. À traiter dans le même chantier que B5.

### 3. Bouton de suppression de base

Constat du 2026-07-22 : la fonction serveur `soft_delete_base` est **complète et sécurisée** (réservée au propriétaire, suppression douce et réversible, cascade sur tout le contenu, révocation des accès, audit ; migration `20260616096000_soft_delete_base.sql`, inscrite à l'allowlist B9). Mais elle n'est **appelée nulle part dans le frontend** — aucun bouton, aucun câblage. C'est donc un travail d'interface non terminé, pas une fonctionnalité manquante.

Points d'attention pour l'implémentation future :
- action destructrice (emporte tout le contenu de la base) → garde-fous forts : confirmation explicite, saisie du motif, idéalement retaper le nom de la base ;
- prévoir aussi le pendant « restaurer » : la suppression est réversible en base, mais il n'existe ni RPC ni UI de restauration ;
- réservé au propriétaire de la base (déjà imposé côté serveur).

### 4. Registre « Diagnostic urgences » (urgences, Tchad)

Signalé le 2026-07-22 : la directrice des urgences d'un hôpital tchadien décrit le même problème que le neurochirurgien — diagnostics notés en termes globaux (« autres pathologies »), donc non analysables. Deuxième signal terrain indépendant.

**Distinction essentielle** (à ne pas confondre) :
- **4a — noyau, faisable en configuration, zéro code** : le modèle de gabarits gère déjà les listes contrôlées (`select`/`multiselect` + `allowed_values`, contrôlées serveur, `tables.sql:56`). Une base à liste contrôlée (diagnostic, motif, issue) résout l'uniformité par construction et se monte dès maintenant (données fictives). Règle d'or : diagnostic = `select`, **jamais** texte libre.
- **4b — programme, nouvelle ingénierie** : autocomplétion searchable (le `select` est un menu déroulant, inadapté au-delà de ~30 items), référentiel gouverné (ID stable ≠ libellé, synonymes, workflow de validation, historique de fusion, CIM), et plusieurs diagnostics **avec attributs par diagnostic** (principal/associé, certitude, admission/sortie) — impossible dans le modèle plat actuel.

**Corrections MedData au design proposé par un LLM tiers** : l'âge ne se stocke pas via « date de naissance » en zone analytique (calculé depuis l'identité, ou saisi comme âge déclaré si registre sans identité) ; l'ID stable n'existe pas aujourd'hui (le `select` stocke le libellé → un renommage casse l'historique).

**Décision du 2026-07-26 : on passe directement au 4b.** Deux pistes ont été écartées en séance. La liste courte **par service** d'abord : un patient hospitalisé en cardiologie a aussi son diabète et son insuffisance rénale à coder, donc restreindre la liste au service recrée le manque qu'on veut supprimer. Le menu déroulant ensuite, inadapté au-delà de quelques dizaines d'entrées. Reste la recherche incrémentale — le typeahead.

Le porteur a fourni une extraction de 37 152 entrées (35 664 `category`, 1 360 `block`, 28 `chapter`) avec la hiérarchie mais **sans code**, et a accepté de ré-extraire avec les codes. Rôle des codes, puisque la question s'est posée : ils ne sont **ni saisis ni affichés**. Ils sont stockés à la place du libellé, ce qui permet de corriger un libellé sans rendre l'historique incohérent, de regrouper les statistiques sans rapprocher des chaînes de caractères, et de transmettre un jour les données dans un langage commun. La structure du référentiel est livrée par le lot T1 ; le contenu, le type de champ et l'interface suivent.

Voir l'analyse complète et la solution proposée dans l'historique de conversation (2026-07-22).

### 5. Bibliothèque de jeux de valeurs

Née d'une objection du porteur le 2026-07-26, en cadrant le registre urgences : dans MedData, c'est l'**utilisateur** qui crée sa base et ses champs. Lui demander de taper trente ou quarante diagnostics à la main dans un champ de saisie revient à le renvoyer au texte libre — c'est-à-dire au problème que la liste contrôlée devait résoudre.

Le blocage était plus concret encore que prévu : les valeurs autorisées se saisissaient dans un `<input>` d'**une seule ligne**, séparées par des virgules, ce qui rendait impossible toute liste un peu longue et interdisait toute valeur contenant une virgule.

Décisions prises en séance :

- **insertion par copie, jamais par référence** : les valeurs sont recopiées dans le champ. Modifier un jeu de la bibliothèque ne peut donc pas changer rétroactivement le sens de données déjà saisies, ni faire disparaître une valeur présente dans un historique. Le prix assumé : les améliorations ne se propagent pas aux bases existantes ;
- **une valeur par ligne**, avec repli sur les virgules si la saisie tient sur une seule ligne, pour ne pas casser les champs créés auparavant ;
- **fusion sans doublon** : insérer un jeu complète la saisie en cours au lieu de l'écraser ;
- **la CIM sert de source de rédaction, pas de système de codage** : on s'en inspire hors ligne pour écrire des listes conventionnelles et vérifier qu'on n'a rien oublié ; on ne stocke ni code, ni version de référentiel. Les libellés CIM sont écrits pour la classification, pas pour la saisie rapide. **Leur licence reste à vérifier avant toute reprise de contenu** ;
- **aucun jeu de diagnostics livré pour l'instant** : une nomenclature clinique ne s'invente pas depuis le dépôt. Un test garantit d'ailleurs que la bibliothèque n'en contient pas.

Ce chantier dépasse les urgences : tout service qui recueille des données en texte libre pose le même problème. La bibliothèque est le niveau d'abstraction qui les couvre tous, sans anticiper les spécialités.

**Soupape livrée le 2026-07-26.** Le porteur a écarté le « Autre (préciser) » classique, qui aurait laissé entrer des valeurs hors liste dans la colonne analysable : la proposition est désormais recueillie **sans être consignée dans le champ à liste contrôlée**. Choisir « Autre » vide le champ source et ouvre un champ texte compagnon (`<champ>_autre`) créé à côté, où la valeur proposée est décrite. La fiche part alors dans la file de complétion existante, et au traitement on décide d'ajouter la valeur à la liste ou de constater qu'elle existait déjà sous un autre nom.

Conséquence : la colonne analysable ne contient que des valeurs de la liste, et aucune surface serveur n'est nécessaire — `assert_data_valid` refuse toute valeur hors `allowed_values` pour un `select`, mais accepte un champ texte tel quel.

Reste ouvert : la **boucle d'amélioration** (relire les propositions, promouvoir les récurrentes) n'est pas outillée — rien ne liste les propositions en attente à l'échelle d'une base. La soupape n'est proposée que pour les champs de **rencontre**, seul endroit où la saisie couplée est rendue. Au-delà d'environ 30 items, un menu déroulant redevient pénible : cascade catégorie → diagnostic, ou typeahead (4b).

### 6. Soupape sur le champ de terminologie

Demandée par le porteur le 2026-07-27, après avoir essayé la recherche : la soupape livrée par le lot P1S ne s'applique qu'aux champs à liste contrôlée, jamais au type `terminology`.

**Le raisonnement initial était inversé.** J'avais écarté ce cas en supposant qu'un référentiel de 14 000 entrées rendait la soupape moins utile qu'une liste de 20 valeurs. C'est le contraire : sur une liste courte qu'on a écrite soi-même, on sait ce qu'elle contient. Sur un référentiel que personne n'a lu en entier, un saisisseur qui ne trouve pas son diagnostic ne peut pas distinguer « je cherche mal » de « le terme n'existe pas » — et dans le doute, il retiendra le résultat le plus approchant. C'est précisément ce que la soupape doit empêcher.

Mise en œuvre attendue : même mécanique que P1S — champ compagnon, texte jamais écrit dans la colonne analysable, fiche laissée à compléter.

### 7. Constructeur de règles de cohérence

Signalé par le porteur le 2026-07-27 : la zone « règles » de l'onglet variables est **incompréhensible pour quelqu'un du milieu médical**. Le constat est fondé — aujourd'hui, créer une règle exige de taper du JSON à la main dans une zone en police à chasse fixe (`src/screens/staff/RuleForm.tsx`), sur le modèle de l'exemple affiché :

```json
{"operator":"greater_or_equal","left_field":"discharge_date","right_field":"admission_date"}
```

Trois obstacles cumulés : la syntaxe JSON, des noms d'opérateurs en anglais, et les clés techniques des variables plutôt que leurs libellés. Un médecin ne peut pas écrire cela, et n'a aucune raison de le pouvoir.

Mise en œuvre attendue : un assemblage guidé — une liste de variables (par leur **libellé**), une liste d'opérateurs en français (« postérieure à », « égale à », « comprise entre »…), puis une variable ou une valeur — qui produit le JSON en coulisse. Le moteur serveur ne change pas : `templateRules.ts` valide déjà une liste blanche d'opérateurs, et c'est elle qui alimenterait les choix proposés. Prévoir la relecture d'une règle existante dans la même forme, et non en JSON.

La saisie experte peut rester accessible en repli, mais elle ne doit plus être le seul chemin.

### 8. Modèle d'observation d'une base

Signalé par le porteur le 2026-07-27 : **le suivi longitudinal est imposé à toute base**, alors que la plupart des études sont transversales — une seule saisie par participant. Le constat est juste.

Trois modes sont visés :

- **une seule saisie par participant** — enquête de prévalence, étude cas-témoins, revue rétrospective d'une hospitalisation ;
- **suivi répété** — cohorte prospective, mesures à 1, 3 et 6 mois ;
- **registre d'événements** — passages aux urgences, hospitalisations, accouchements : la même personne revient, mais chaque venue est un événement indépendant, pas une étape d'un suivi.

**Corrections apportées à la proposition d'un LLM tiers**, après lecture du code :

1. **Le nom `collection_mode` est déjà pris.** Il existe sur `patient` et `encounter` avec les valeurs `direct / assisted / mixed` — c'est le mode de *recueil*, pas le modèle d'étude. Réutiliser ce nom créerait une confusion durable ; retenir plutôt `observation_model` ou `study_design` sur `base`.
2. **Il n'y a rien à refondre.** La séparation participant / observation / valeurs existe déjà : `patient.data`, `encounter.data`, et des variables portant une portée `patient` ou `encounter`. La proposition décrivait cette architecture comme une cible ; c'est l'état actuel.
3. **Le mode transversal est déjà techniquement possible.** Rien n'oblige un patient à avoir une rencontre : il suffit de placer toutes les variables en portée `patient`. Ce qui manque n'est pas le modèle mais **l'interface**, qui pousse systématiquement vers la création d'une rencontre. Le travail est donc surtout frontal, plus une colonne.
4. **Point non vu par la proposition : l'âge vit sur la rencontre** (`encounter.age_value` / `age_unit`), par conception — c'est l'âge *au moment de l'observation*. En mode « une seule saisie », il faut décider où il va, sinon une étude transversale perd une variable essentielle.
5. **L'éditeur de variables devra masquer la notion de portée** en mode transversal : proposer « patient ou rencontre » dans une base qui n'a pas de rencontres serait déroutant.
6. Le mode **registre d'événements** est proche de l'existant : `encounter_type` distingue déjà consultation, hospitalisation, suivi et autre. Ce mode change surtout le **point d'entrée** — on enregistre un événement puis on rattache une personne, au lieu de partir du patient.

**Ce que le mode « une seule saisie » ne doit pas interdire** : les variables à valeurs multiples ni les groupes répétés dans le même formulaire. Un participant peut avoir cinq diagnostics en une seule observation. La contrainte porte sur le nombre d'**observations**, pas sur la richesse du formulaire.

**Bases existantes** : conserver le suivi répété par défaut. La conversion d'une base **vide** doit être libre ; après saisie de données réelles, elle change le sens de ce qui est enregistré et doit être encadrée — c'est un sujet de sûreté, à traiter avec `meddata-db-safety` le moment venu.

**Parcours simulé par le porteur le 2026-07-27**, qui précise ce que le mode devra produire :

1. clic sur « Nouveau patient » ;
2. un écran unique portant l'identité **et** les données de l'étude ;
3. enregistrement — sans étape « ajouter une rencontre ».

Le contournement actuel consiste à déclarer toutes les variables en portée patient pour qu'elles apparaissent dès la création. Il fonctionne, mais révèle deux manques :

- les variables permanentes s'affichent **sans structure par section** (défaut D4 ci-dessous), alors qu'une rencontre les aurait groupées. Corriger D4 est un préalable pratique à ce mode ;
- le parcours reste celui d'une base longitudinale : rien n'indique à l'utilisateur que ce contournement est la bonne façon de faire, et rien n'empêche la création de rencontres qui n'ont pas de sens pour l'étude.

Le mode « une seule saisie » consisterait donc surtout à rendre ce contournement explicite et guidé : masquer la notion de portée, masquer l'ajout de rencontre, et présenter un formulaire unique correctement sectionné.

### 9. Alléger le chargement de l'application

Signalé par le porteur le 2026-07-27 : Vercel Speed Insights annonce un *Real Experience Score* de **78 sur ordinateur**, sous le seuil de 90, avec moins de 75 % de visites jugées bonnes.

**Ce que la mesure dit et ne dit pas.** Ce score agrège des mesures de navigation réelles, dont nous ne disposons pas ici ; sur un site à faible trafic, il repose de surcroît sur peu d'échantillons et reste bruité. Il n'établit donc pas à lui seul une cause. Ce qui suit est en revanche mesurable dans le dépôt.

**Constat de build**, relevé sur `main` :

| Fichier | Poids |
|---|---|
| `index` | 500 Ko |
| `xlsx` (première copie) | 482 Ko |
| `xlsx` (seconde copie) | 355 Ko |
| `useI18n` | 95 Ko |
| **Total JavaScript** | **1 663 Ko** |

Deux anomalies ressortent :

1. **La bibliothèque de tableur est embarquée deux fois** — 837 Ko à elle seule, soit la moitié du poids total. Une copie sert le worker d'analyse de fichiers, l'autre le fil principal.
2. **Le service worker précache 70 fichiers, xlsx compris.** Dès la première visite, le navigateur télécharge donc environ 1,7 Mo en arrière-plan, y compris de quoi lire et écrire des classeurs Excel — alors que la plupart des visites ne feront ni import ni export.

Ce préchargement ne retarde pas l'affichage initial, mais il consomme bande passante et processeur pendant que l'utilisateur navigue. Sur une connexion limitée — le contexte de déploiement visé — c'est doublement coûteux : lenteur ressentie, et volume de données facturé pour un usage qui n'aura pas lieu.

**Pistes, de la plus rentable à la plus coûteuse :**

- **exclure le tableur du précache** en le laissant en chargement à la demande, au moment d'un import ou d'un export : environ 837 Ko économisés à chaque première visite, sans rien retirer aux fonctionnalités ;
- **dédoublonner** la bibliothèque entre le worker et le fil principal, si le format de module le permet ;
- **découper le fichier principal** de 500 Ko, aujourd'hui au-dessus du seuil d'alerte de l'outil de build ;
- **ne charger que la langue active** : les traductions française et anglaise voyagent ensemble dans un fichier de 95 Ko.

Avant d'optimiser plus loin, mesurer : sans les mesures réelles par métrique, on ignore si le score tient au poids téléchargé, à la latence réseau depuis le lieu d'usage, ou au temps de réponse de la base.

### 10. Finition de l'interface

Signalé par le porteur le 2026-07-27 : l'interface « est bonne dans l'ensemble » mais manque de présence. Trois points précis, tous vérifiés dans le code.

**La zone de profil passe inaperçue en thème clair.** `src/components/AppShell.tsx:170` : le bloc nom + rôle n'a **ni fond ni bordure**, alors que le bloc thème/langue juste au-dessus porte un trait de séparation. Le rôle est rendu en gris moyen sur fond clair. Or c'est l'élément qui répond à « qui suis-je, et avec quels droits » — une question qui compte dans un produit où le rôle détermine ce qu'on a le droit de voir. Correction attendue : lui donner une assise visuelle (fond léger, séparation), et traiter le rôle comme une information portante plutôt que comme une mention secondaire.

**Quinze cases à cocher système**, réparties sur neuf écrans, sans aucun style. Elles jurent avec le reste de l'interface et sont difficiles à viser au doigt sur mobile. Correction attendue : un composant unique, réutilisé partout, avec une cible tactile suffisante et un état de focus visible.

**Vingt-trois transitions dans toute l'application**, presque toutes sur des survols de boutons. Rien n'accompagne les changements d'état : une liste qui se charge, une valeur enregistrée, un panneau qui s'ouvre apparaissent sans transition. D'où l'impression que « rien ne se passe ».

**Ce qui mérite d'être animé, et ce qui ne le mérite pas.** Le dynamisme utile confirme une action ou explique un changement : bouton qui réagit au clic, apparition en fondu d'une liste chargée, brève confirmation après un enregistrement, ouverture glissée d'un panneau. Le dynamisme décoratif — animations d'entrée sur chaque carte, effets permanents — fatigue et ralentit. Le squelette de chargement existe déjà (`src/components/Skeleton.tsx`) mais n'est presque pas employé : le généraliser donnerait déjà beaucoup, sans la moindre animation supplémentaire.

**Deux garde-fous.**

- **`prefers-reduced-motion` n'est respecté nulle part** aujourd'hui. Toute animation ajoutée doit pouvoir être neutralisée pour les personnes qui en souffrent — c'est une exigence d'accessibilité, pas une option.
- **Tension avec l'idée 9** : l'application est déjà lourde et le contexte d'usage suppose des connexions limitées. Le dynamisme doit venir de transitions CSS, pas d'une bibliothèque d'animation supplémentaire.

## Défauts / UX signalés (à corriger, pas des idées)

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D1 | Supprimer un gabarit utilisé par une base **semble ne rien faire** : aucun retour visible au point de clic | Le serveur refuse correctement (`delete_template` → « Gabarit utilisé… », `20260616090700_template_admin.sql:171`). Côté UI (`src/screens/member/MyTemplates.tsx`), le **succès** affiche un toast visible, mais l'**échec** rend le message en haut de page (`:126`), loin du bouton (`:155`) ; de plus la confirmation « Oui/Non » reste ouverte car `setConfirmId(null)` n'est pas atteint | Petite (front) | **Corrigé le 2026-07-26** (lot P1B) |

Correction attendue : uniformiser le retour d'échec sur le même toast visible que le succès, près de l'action ; refermer/réinitialiser la confirmation même en cas d'échec. Vérifier si l'écran admin des modèles (`src/screens/staff/TemplatesAdmin.tsx`) partage le même motif (même méthode `deleteTemplate`).

**Correction appliquée le 2026-07-26.** La suppression passe par une fonction dédiée `removeTemplate` : succès et échec annoncent tous deux un toast (variante `warning` pour l'échec), et `setConfirmId(null)` est déplacé dans le `finally`, donc la confirmation se referme dans tous les cas. L'écran admin partageait bien le même motif — et n'avait même pas de toast de succès ; il est corrigé de la même façon, avec la nouvelle clé `admin.template_deleted`. Deux tests par écran couvrent le refus serveur et le succès.

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D2 | **Vue mobile** : menu latéral ouvert, au défilement de la page un espace vide apparaît sous le panneau — **corrigé le 2026-07-26** (lot P1B) | Le menu mobile (`src/components/AppShell.tsx:200-209`) est une modale (`fixed inset-0`, `aria-modal`) mais **aucun verrou de défilement** n'est posé sur la page (aucune manipulation de `document.body`/`overflow` dans le composant). En scrollant, la page défile derrière la modale et la barre d'adresse du navigateur mobile se replie/déploie ; le panneau, dimensionné au viewport initial, ne correspond plus à la nouvelle hauteur → un espace (fond de page) apparaît sous le panneau | Petite (front) | Signalé 2026-07-22 ; à corriger après le gel |

Correction attendue : verrouiller le défilement de la page tant que le menu est ouvert (poser `overflow:hidden` sur `body` à l'ouverture, restaurer à la fermeture) — corrige l'espace et rétablit le comportement modal correct ; en complément, envisager une hauteur en unités de viewport dynamiques (`dvh`). À confirmer sur un vrai mobile/émulateur au moment de corriger.

**Correction appliquée le 2026-07-26.** Un `useEffect` pose `overflow:hidden` sur `body` à l'ouverture du tiroir et restaure la valeur précédente au démontage comme à la fermeture ; le conteneur de la modale passe en `h-[100dvh]`. Un test vérifie le verrou puis sa restauration. **Vérifié sur un vrai mobile par le porteur le 2026-07-26 : le défaut a disparu.** D2 est clos, y compris côté terrain. Le test automatisé prouve le verrou de défilement ; c'est cette vérification manuelle qui prouve la disparition de l'espace vide, que jsdom ne peut pas reproduire.

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D3 | **Le bandeau « Rendre disponible hors-ligne » occupe trop de place** dans l'écran d'une base | `src/screens/member/BaseHome.tsx:218` : bandeau pleine largeur (`surface-muted`, icône, bouton, date, lien « Retirer ») affiché **en permanence** juste sous le titre, alors que l'action n'est faite qu'occasionnellement. Il repousse vers le bas la liste des patients, qui est le contenu utile de l'écran, à chaque visite | Petite (front) | Signalé 2026-07-27 |

Correction attendue : réduire l'emprise permanente de cette action — la replier dans le menu d'actions de la base, ou n'afficher qu'une icône discrète tant que la copie n'existe pas, en réservant le bandeau au seul cas où une copie est présente et mérite d'être signalée (date, expiration, retrait). Le comportement hors-ligne lui-même ne change pas.

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D4 | **Les variables permanentes ne sont pas groupées par section** : à la création et à l'édition d'un patient, elles s'affichent en une seule liste à plat, sans distinction clinique / biologie / paraclinique | `src/screens/member/NewPatient.tsx:238` place toutes les variables de portée patient dans un unique `fieldset` « données permanentes », et `EditPatient.tsx` n'a aucun regroupement. `EncounterFields.tsx` fait pourtant exactement l'inverse pour les rencontres : un `fieldset` et une légende par section. La section est une propriété **obligatoire** de chaque variable (`check (section in ('clinique','biologie','paraclinique'))`) : l'information existe et est saisie, elle est simplement ignorée à l'affichage | Petite (front) | Signalé 2026-07-27 |

Correction attendue : reprendre pour les variables patient le regroupement déjà écrit pour les rencontres, en n'affichant que les sections non vides. L'identité garde son encadré propre, distinct des sections cliniques.

| # | Défaut | Cause | Ampleur | Statut |
|---|---|---|---|---|
| D5 | **Un diagnostic s'affiche « [object Object] » dans la liste des patients d'une base**, alors qu'il est correct dans la fiche patient | `src/screens/member/BaseHome.tsx:358` termine par `String(v)`. La fonction `displayFieldValue` existe pourtant déjà dans `src/data/types.ts` et est utilisée par `PatientDetail.tsx` — d'où l'écart entre les deux écrans. Une valeur de terminologie est un objet `{code, label}` : `String()` en fait « [object Object] » | Très petite (front) | Signalé 2026-07-27 |

Correction attendue : utiliser `displayFieldValue` dans `BaseHome`, comme la fiche patient le fait déjà. Vérifier au passage les autres écrans qui rendent une valeur : `EditEncounter.tsx` termine lui aussi par `String(v)`.

Ce défaut illustre le risque d'un correctif appliqué à un seul appelant : la fonction partagée existait, mais tous les points d'affichage n'ont pas été repris.

**Ce défaut devient central avec l'idée 8.** En étude transversale, la stratégie naturelle est de déclarer *toutes* les variables en portée patient pour qu'elles apparaissent dès la création — c'est ce qu'a constaté le porteur en simulant le parcours. Le formulaire devient alors une longue liste plate, sans aucune structure, là où une rencontre aurait été correctement organisée. Corriger D4 est donc un préalable pratique au mode « une seule saisie ».

À vérifier au passage : le mode hors-ligne est désactivé par la politique de release standard (`VITE_OFFLINE_MODE=disabled`). Si le bandeau reste visible alors que la fonction est inopérante, c'est une raison supplémentaire de ne pas lui donner cette place.

## Comment utiliser cette liste

Chaque idée se traite désormais comme un lot borné selon la feuille de route :
spécification (si absente) → base/Edge avec `meddata-db-safety` si concernée →
UI → validation `validate-audit-lots`. Ajouter ici toute nouvelle idée au fil
des échanges, avec la même colonne « où c'est bloqué » pour distinguer les
dépendances techniques, les validations de staging et les décisions humaines.
