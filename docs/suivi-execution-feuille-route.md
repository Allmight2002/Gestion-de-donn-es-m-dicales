# Suivi d'exécution de la feuille de route post-readiness

- Démarrage : 2026-07-26
- Porteur : Dr Mbassi
- Circuit autorisé : branche de travail → `develop` → `main`, staging fictif
  lorsque pertinent, jamais production
- Feuille de route :
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md)
- Mandat :
  [`prompt-execution-autonome-feuille-route.md`](prompt-execution-autonome-feuille-route.md)

Ce journal consigne l'état réellement observé. Un lot n'est déclaré terminé
qu'après ses validations et sa traçabilité Git/GitHub. Les preuves restent liées
au SHA et à l'environnement indiqués.

## Vue d'ensemble

| Ordre | Lot | Statut | Branche / SHA | PR et CI | Staging | Limites restantes |
|---|---|---|---|---|---|---|
| D0 | Intégration du cadre documentaire | Terminé | `main` `70798f65017cbcea6b6f348cc9a24f90d0299dd7` ; `develop` `5468141a33ad6c7c1596e83e753881cb03ff874f` | PR #46 et #47 ; CI verte | Non requis | Production exclue |
| P0 | React Router et baseline | Terminé et promu | `973f1bc`, merges `c64061e` (`develop`) et `af71477` (`main`) | PR #48 et #49 ; CI verte | Non requis | Aucun serveur ClamAV requis |
| P0R | Finalisation B3 → B4 → B8 → B1 → B9 | Terminé pour le staging fictif | candidat `ebee17910f6de005ab933ee08978d2e97686d19d` | PR #50 et #51 ; CI verte ; preuves immuables | B3/B4/B8/B1/B9 liés au même SHA | B2 reste ouvert ; aucun parcours fichier ni production accepté |
| P1V | Bibliothèque de jeux de valeurs (préalable à P1A) | Terminé et promu | `codex/valueset-library` | PR #56 et #57 ; CI verte | Non requis | Aucun jeu de diagnostics |
| P1S | Soupape « valeur proposée » | Terminé et promu | `codex/soupape-valeur-proposee` | PR #58 et #59 ; CI verte | Non requis | Champs de rencontre seulement ; propositions non listées |
| T1 | Référentiel de terminologie — structure | Terminé et promu | `codex/terminologie-referentiel` | PR #60 et #61 ; CI verte | Non requis | Aucun type de champ ni interface |
| T2 | Champ de terminologie — contrat serveur | Terminé et promu | `codex/champ-terminologie` | PR #62 et #63 ; CI verte | Non requis | Aucune interface ; création en bloc non couverte |
| T3 | Recherche visible (typeahead) | Terminé localement | `codex/typeahead-terminologie` | — | **Requis pour essayer** | Chaque frappe interroge le serveur ; hors ligne non couvert |
| P1A | Registre « Diagnostic urgences » noyau | À faire | — | — | Fictif uniquement | En attente des valeurs métier ; retour terrain requis avant 4b |
| P1B | Corrections UX D1/D2 | Terminé localement | `codex/ux-d1-d2` | — | Non requis | Vérification mobile réelle/émulée non faite |
| P2 | Suppression et restauration sûres | À faire | — | — | À évaluer | Revue DB/RLS obligatoire |
| P3 | Observabilité privacy-safe | À faire | — | — | À évaluer | B5 reste requis pour la preuve distante complète |
| P4 | Comptes de mission | À faire | — | — | Fictif uniquement | Aucun upload en v1 |
| P5 | Terminologie avancée | Conditionnel | — | — | — | Seulement si le noyau 4a démontre le besoin |

## D0 — intégration du cadre documentaire

### Objectif

Remplacer le gel global B1–B10 par un cadre qui autorise le développement et le
circuit Git/GitHub/staging fictif, sans lever les interdictions de production ou
de données réelles.

### État initial vérifié

- `origin/develop`, `origin/main` et le HEAD de départ sont alignés sur
  `b5a0369f8b1f7dc731f48b856f86a47f042d39a4`.
- Dépôt GitHub : `Allmight2002/Gestion-de-donn-es-m-dicales`, branche par défaut
  `develop`.
- Authentification GitHub CLI disponible au démarrage.
- `vercel.json` impose `git.deploymentEnabled=false` ; le workflow de release
  coordonnée reste manuel et sépare les cibles staging/production.
- Les cinq changements utilisateur présents au démarrage sont tous des
  documents du cadre post-readiness ; aucun autre fichier modifié ou non suivi.

### Documents inclus

- feuille de route post-readiness ;
- mandat/prompt d'exécution autonome ;
- file d'idées post-readiness ;
- spécification des comptes de mission ;
- spécification d'observabilité des erreurs ;
- présent journal de suivi.

### Contrôles effectués avant commit

- `git diff --check` : réussi ;
- liens Markdown locaux de la feuille de route et du prompt : réussis ;
- recherche bornée de motifs de secrets dans les documents : aucun motif
  détecté ;
- identité du dépôt, remotes, branches et alignement des SHA : vérifiés ;
- aucune suite applicative exécutée, car le lot D0 est exclusivement
  documentaire.

### Traçabilité Git/GitHub

- commit documentaire de branche : `b42aaa248f392b9d61339b6d2c884da8264d0eb0` ;
- PR #46, branche de travail vers `develop` : fusionnée, run CI
  `30190224299` réussi ;
- merge `develop` : `5468141a33ad6c7c1596e83e753881cb03ff874f` ;
- PR #47, `develop` vers `main` : fusionnée, runs CI `30190336141` et
  `30190359302` réussis ;
- merge `main` : `70798f65017cbcea6b6f348cc9a24f90d0299dd7`, run CI
  `30190462165` réussi ;
- arbres `origin/develop` et `origin/main` comparés : contenu identique ;
- `vercel.json` conservé avec `git.deploymentEnabled=false`, aucun déploiement
  production déclenché.

## P0 — React Router et baseline

### Objectif et décision technique

Supprimer l'exception temporaire liée aux trois avis React Router sans affaiblir
l'audit. L'installation de React Router 7.18.1 a bien supprimé ces trois avis,
mais a révélé `GHSA-qwww-vcr4-c8h2`, publié le 2026-07-22, qui couvre toute la
ligne 7 récente et n'est corrigé qu'en 8.3.0. L'avis vise les API RSC instables,
absentes de MedData, mais l'accepter aurait nécessité une nouvelle exception
non autorisée.

Décision réversible retenue : React Router 8.3.0, React/React DOM 19.2.8,
imports depuis `react-router`, Testing Library compatible React 19 et moteur
Node `>=22.22.0 <23`. MedData reste en mode déclaratif client, sans RSC ni SSR.

### Changements et preuves locales

- `npm audit --json` : zéro vulnérabilité publiée ;
- politique CI/release : aucune allowlist ni expiration, refus des niveaux
  modéré, haut et critique dans les scopes staging et production ;
- tests de navigation : doubles barres et séparateurs mixtes normalisés vers une
  route interne, redirection `<Navigate>` interne vérifiée ;
- audit strict staging/production, 12 tests du validateur, 5 tests routeur,
  typecheck, lint et build : réussis ;
- installation propre par `npm ci` sous Node 22.23.1 : 561 paquets installés
  depuis le lockfile, 0 vulnérabilité ;
- suite web complète : 37 fichiers et 174/174 tests réussis après
  réinstallation propre ;
- suite globale : 91 fichiers et 652/652 tests réussis ; `db:verify` rejoue
  105 migrations depuis zéro, et les 70 tests Edge sont verts ;
- build Vite 8.1.4/PWA : 1 980 modules et 68 entrées précachées, réussi avec la
  lecture signée imposée ;
- commit de branche : `973f1bc5b3e17242ab217136b36014fab1e5ee43` ;
- PR #48 vers `develop`, run `30192877870` vert, merge
  `c64061ed191bda6b12b6739430151e8f6d33c3bf` ;
- PR #49 `develop` vers `main`, runs `30192979109` et `30193080397` verts,
  merge `af71477519a62f30677588115a28aae62f11ae48` ;
- aucun staging requis et aucun déploiement production effectué.

### Ordre suivant imposé

Après clôture et promotion de P0, finaliser B3, B4, B8, B1 puis B9 avant de
commencer le registre urgences, les corrections UX D1/D2 ou une autre nouvelle
fonctionnalité. Cette interphase est consignée ci-dessous.

## P0R — finalisation B3, B4, B8, B1 et B9

### Candidat commun et incidents corrigés

Le candidat commun retenu est
`ebee17910f6de005ab933ee08978d2e97686d19d`, merge de la PR #51 dans
`develop`. Son arbre applicatif est identique à celui du commit de branche
`99c7bf5`.

Deux échecs réels ont précédé ce candidat :

- run `30194560179` : le bundling Edge local a rencontré la limite anonyme du
  registre Docker ; la PR #50 (`6338aeb`, merge `44223c0`) a basculé les six
  déploiements sur le bundler API Supabase ;
- run `30195079740` : le bundler distant ne pouvait pas joindre
  `cdn.sheetjs.com` ; la PR #51 (`e1622a9`, `99c7bf5`, merge `ebee179`) a
  embarqué SheetJS 0.20.3 avec licence Apache, empreinte verrouillée et test
  d'inventaire, sans retour au paquet npm vulnérable.

La CI de la PR #51 (`30195837590`) et la CI post-merge `develop`
(`30196032319`) sont vertes. Ces incidents ne sont pas masqués : les preuves
B3/B4/B8 antérieures à `ebee179` ont été rejouées.

### B3 — sauvegarde exacte et copie immuable

- workflow continuité `30196157372` réussi ;
- sauvegarde coordonnée DB/Auth/Storage : 4 exports DB, 117 objets et
  16 969 octets, HMAC et extraction vérifiés ;
- manifeste Storage :
  `sha256:5165598301022387588fe380d205b0f02509c48abb2bc00c87fea3893c157dbd` ;
- artefact Actions `continuity-backup-staging-30196157372`, rétention jusqu'au
  25 août 2026 ;
- release immuable
  [`continuity-staging-30196157372-1`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/releases/tag/continuity-staging-30196157372-1),
  ciblant `ebee179`, digest
  `sha256:168c2359efff8af901b9359c8cd077d10c8f13144f56584cffa2c5aa3d398cd3` ;
- clé rouverte depuis l'enveloppe DPAPI séparée, sans affichage.

### B4 et B8 — restauration, rollback et forward recovery

La sauvegarde ci-dessus a été restaurée dans le projet local isolé
`meddata-recovery-30196157372` :

- 5 comptes Auth, 36 tables publiques toutes sous RLS, 4 buckets et 117/117
  objets restaurés ;
- 111 clés étrangères contrôlées, 0 orphelin, 0 divergence des 35 tables de
  données publiques et 0 divergence de hash Storage ;
- authentification de deux comptes fictifs, lecture propriétaire autorisée et
  lecture croisée refusée ;
- RPO observé 77 s et RTO observé 1 587 s, sous les objectifs approuvés de
  24 h et 4 h ;
- rollback de la migration `20260714215335`, forward par `supabase db push`,
  réapplication Storage, puis état final identique ;
- frontend courant → précédent `b5a0369` → courant : HTTP 200/200/200 ;
- six fonctions Edge contrôlées sur les deux versions, 70/70 tests chacune.

La preuve JSON validée porte l'empreinte
`sha256:4ab7a20d858d36465ed4588fe798a2ca3770b826d911f891d8f903dc1c0ce228`
et est publiée dans la release immuable
[`recovery-evidence-staging-ebee17910f6d`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/releases/tag/recovery-evidence-staging-ebee17910f6d).
Les conteneurs ont été arrêtés ; les volumes isolés sont conservés. Les dumps
en clair ont été envoyés dans la Corbeille Windows et restent récupérables.

### B1 — alignement exact du staging

Le run coordonné
[`30197149574`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/30197149574)
a produit les résultats suivants :

- validation complète : réussie ;
- backend staging : réussi, 105 migrations, `storage.sql` à l'empreinte
  `b9e87377…`, six fonctions Edge actives et inventaire sans drift ;
- frontend Vercel `dpl_3WrrxRjX2WgcitJCWJzvHHu28JTJ` : état `READY`, métadonnée
  Git `ebee179`, route `/login` HTTP 200 ;
- production : ignorée.

Le job frontend est ensuite devenu rouge lors de la vérification du scanner
ClamAV, après le déploiement réussi. Cet échec appartient à B2, explicitement
différé ; il n'est ni reclassé en succès ni utilisé comme preuve antivirus. Le
frontend, la base, Storage et les six fonctions Edge sont néanmoins directement
prouvés sur le même SHA pour le périmètre staging fictif sans fichiers.

### B9 — ACL, RLS/RPC et acceptation bornée

Le job backend a exécuté `db:function-acl:verify` sur la base distante. Une
seconde sonde en lecture seule a ensuite confirmé :

- 132 fonctions `SECURITY DEFINER` conformes à l'inventaire, aucune exécutable
  par `anon` et `search_path` bornés ;
- 36/36 tables publiques sous RLS et 59 policies ;
- lecture autorisée visible, même base invisible pour un sujet sans accès ;
- RPC autorisée pour le médecin fictif, refusée à l'anonyme et à un sujet sans
  droit ;
- politique DB d'inspection stricte active.

L'acceptation est limitée au candidat de staging fictif, sans parcours fichier
et sans valeur d'approbation production. Les JSON, leurs digests et le harnais
reproductible sont publiés dans la release immuable
[`readiness-evidence-staging-ebee17910f6d`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/releases/tag/readiness-evidence-staging-ebee17910f6d).

### Décision d'interphase

B3, B4, B8, B1 et B9 satisfont les critères de l'interphase sur le même SHA
`ebee179` et pour le staging fictif. B2 reste ouvert : aucun scanner distant
durable n'est prouvé, les parcours de fichiers sont exclus et restent
fail-closed. B6, B7 et B10 restent également ouverts pour la production. La
Phase 1 peut commencer ; la production readiness reste **non démontrée**.

### Traçabilité documentaire

Les documents suivants ont été mis à jour le 26 juillet 2026 pour refléter le
candidat `ebee179`, les deux incidents de déploiement et la limite B2 :

- `docs/continuite.md` : copie immuable du candidat, rejeu de l'exercice de
  reprise et état des limites encore bloquantes ;
- `docs/exercice-reprise-staging-2026-07-26.md` : nouveau compte rendu du rejeu
  sur le SHA de merge définitif ;
- `docs/exercice-reprise-staging-2026-07-23.md` : renvoi vers ce rejeu, chiffres
  et verdict d'origine conservés puisqu'ils prouvent leur propre SHA ;
- `docs/readiness-production-2026-07-19.md` : candidat courant, matrice de
  readiness, blocages B1 à B10, décision finale et sources ;
- `docs/feuille-route-developpement-post-readiness.md` et le présent journal.

Aucune preuve antérieure n'a été réécrite ou transférée d'un SHA à un autre. La
décision de readiness reste **production readiness not demonstrated**, B2, B5,
B6, B7 et B10 étant ouverts.

Ces mises à jour ont été portées par la PR #52, fusionnée dans `develop`
(`af2f477`), puis promues vers `main` par la PR #53 (`2f44f33`). Les runs CI
`30201193093`, `30201364005`, `30201419728` et `30201549373` sont verts.
`origin/develop` et `origin/main` sont alignés. Aucun déploiement n'a été
déclenché : `vercel.json` conserve `git.deploymentEnabled=false`.

## P1B — corrections UX D1 et D2

### Périmètre

Premier lot fonctionnel après l'interphase. Deux défauts signalés le 22 juillet
2026, tous deux frontend, sans surface base, Edge ou Storage : aucun gate de
readiness n'est touché et aucune preuve d'interphase n'est invalidée.

### D1 — refus de suppression d'un gabarit invisible

Le serveur refuse correctement de supprimer un gabarit utilisé par une base,
mais l'interface rendait ce refus invisible : le message tombait en haut de
page, loin du bouton, et la confirmation « Oui/Non » restait ouverte parce que
`setConfirmId(null)` était placé après l'appel réseau.

La suppression passe désormais par une fonction dédiée `removeTemplate` :
succès et échec produisent le même toast visible près de l'action — variante
`warning` pour l'échec — et la réinitialisation de la confirmation est déplacée
dans le `finally`, donc elle s'applique dans tous les cas. `src/screens/staff/
TemplatesAdmin.tsx` partageait le même motif et n'avait aucun toast de succès ;
il est corrigé de la même manière, avec la clé `admin.template_deleted` ajoutée
en français et en anglais.

### D2 — espace vide sous le tiroir mobile

Le tiroir mobile est une modale `aria-modal`, mais rien ne bloquait le
défilement de la page derrière lui : en scrollant, la barre d'adresse du
navigateur mobile se repliait, la hauteur du viewport changeait et un espace
apparaissait sous le panneau.

Un `useEffect` pose `overflow: hidden` sur `document.body` à l'ouverture et
restaure la valeur précédente à la fermeture comme au démontage ; le conteneur
de la modale passe en `h-[100dvh]`.

### Preuves locales

- `npm run typecheck` : réussi ;
- `npm run lint` : réussi, 0 warning ;
- `npm run test:web` : 37 fichiers, **178/178** tests, dont 4 nouveaux — refus
  serveur et succès sur les deux écrans de gabarits, verrou de défilement et sa
  restauration.

### Vérification terrain

Le porteur a confirmé le 26 juillet 2026, sur un vrai mobile, que l'espace vide
a disparu. D2 est donc clos de bout en bout : le test automatisé prouve le
verrou de défilement, la vérification manuelle prouve le résultat visuel, que
jsdom ne peut pas reproduire.

### Traçabilité Git

PR #54 fusionnée dans `develop` (`bc0a9fc`), PR #55 promue vers `main`
(`74bdcb8`), runs CI verts de bout en bout dont `30203580640` après merge.

## P1V — bibliothèque de jeux de valeurs

### Origine

Ce lot ne figurait pas dans la feuille de route. Il naît d'une objection du
porteur pendant le cadrage du registre urgences : dans MedData, c'est
l'utilisateur qui crée sa base et ses champs. Lui demander de saisir trente ou
quarante diagnostics à la main le renvoie au texte libre, donc au problème même
que la liste contrôlée devait résoudre.

L'examen du code a confirmé un blocage plus concret : les valeurs autorisées se
saisissaient dans un `<input>` d'une seule ligne, séparées par des virgules.
Toute liste un peu longue était illisible, et une valeur contenant une virgule
était impossible à saisir.

Le lot est donc inséré **avant** P1A : livrer un canevas urgences que personne
ne pourrait adapter n'aurait pas de sens.

### Contenu

- `src/domain/valueSetLibrary.ts` : jeux de valeurs prêts à l'emploi, contenu
  pur sans I/O, sur le modèle de `templateLibrary.ts`. Les six jeux livrés
  reprennent des listes **déjà présentes** dans les modèles de gabarits, afin de
  n'introduire aucune nomenclature qui n'ait pas déjà un usage réel ;
- `parseAllowedValues` : une valeur par ligne, avec repli sur les virgules quand
  la saisie tient sur une seule ligne, pour ne pas casser les champs antérieurs ;
- `mergeValues` : insertion sans doublon, insensible à la casse, qui complète la
  saisie en cours au lieu de l'écraser ;
- `FieldForm.tsx` : zone multi-lignes, compteur de valeurs et sélecteur
  d'insertion, visibles uniquement pour un champ `select`/`multiselect` et
  masqués lorsque la variable est structurellement verrouillée.

### Décision de conception

L'insertion se fait **par copie, jamais par référence**. Une base reste donc
autonome : modifier un jeu de la bibliothèque ne peut pas changer
rétroactivement le sens de données déjà saisies, ni retirer une valeur présente
dans un historique. Le prix assumé est que les améliorations de la bibliothèque
ne se propagent pas aux bases existantes.

Aucune surface base, Edge, Storage ou migration : `allowed_values` reste une
liste de chaînes, exactement comme avant.

### Preuves locales

- `npm run typecheck` : réussi ;
- `npm run lint` : réussi, 0 warning ;
- `npm run test:web` : 39 fichiers, **191/191** tests, dont 13 nouveaux —
  intégrité des jeux, découpage et fusion des valeurs, et quatre tests
  d'interface sur l'insertion.

### Limites explicites

- **Aucun jeu de diagnostics n'est livré** : une nomenclature clinique ne
  s'invente pas depuis le dépôt. Un test garantit que la bibliothèque n'en
  contient pas tant que les valeurs métier ne sont pas fournies ;
- la **soupape « Autre (préciser) »** et la **boucle d'amélioration** (relire
  les « Autre », promouvoir les récurrents) ne sont pas traitées ; sans elles,
  une liste locale vieillit et redevient du texte libre ;
- au-delà d'environ 30 items, un menu déroulant reste pénible : la cascade ou le
  typeahead relèvent de l'idée 4b.

### Traçabilité Git

PR #56 fusionnée dans `develop` (`f4b4516`), PR #57 promue vers `main`
(`b4ca810`), run post-merge `30204624464` vert.

## P1S — soupape « valeur proposée »

### Décision de conception

Le porteur a écarté le « Autre (préciser) » classique : il aurait laissé entrer
des valeurs hors liste dans la colonne analysable, qu'il aurait fallu dépouiller
après coup. La règle retenue est plus stricte — **la valeur hors liste n'entre
jamais dans le champ à liste contrôlée**.

Choisir « Autre » vide le champ source et ouvre un champ texte compagnon
`<champ>_autre`, créé à côté du champ source, où la proposition est décrite. La
fiche part alors dans la file de complétion existante tant que le champ source
reste vide. Au traitement, on lit la proposition et on décide : ajouter la
valeur à la liste, ou constater qu'elle existait déjà sous un autre nom.

Cette conception a une conséquence importante : **aucune surface serveur n'est
nécessaire**. `assert_data_valid` refuse toute valeur hors `allowed_values` pour
un `select`, et n'accepte d'objet balisé que `{__missing__: …}` avec une liste
blanche stricte ; un champ texte, lui, est accepté tel quel. Aucune migration,
aucune preuve d'interphase invalidée.

Le champ compagnon n'est **jamais obligatoire** : une fiche bloquée pousserait
le saisisseur à choisir une valeur fausse pour avancer, c'est-à-dire exactement
ce que la soupape doit empêcher.

### Contenu

- `src/domain/proposalField.ts` : conventions de clé, construction du champ
  compagnon et association source/compagnon ;
- `src/screens/member/ChoiceWithProposal.tsx` : saisie couplée, avec
  avertissement non bloquant ;
- `EncounterFields.tsx` : le compagnon n'est plus rendu comme un champ autonome,
  mais avec son champ source ;
- `FieldForm.tsx` et `TemplateVersionEditor.tsx` : case à cocher à la création
  d'un champ à choix, qui demande la création du second champ. Si la clé est
  déjà prise, le champ source est créé seul et un message l'indique.

### Preuves locales

- `npm run typecheck` : réussi ;
- `npm run lint` : réussi, 0 warning ;
- `npm run test:web` : 41 fichiers, **208/208** tests, dont 14 nouveaux — le
  texte proposé ne part jamais dans le champ à liste, le champ source est vidé,
  le compagnon n'est jamais obligatoire, et une proposition déjà enregistrée est
  relue sans redemander la soupape.

### Limites explicites

- la soupape n'est proposée **que pour les champs de rencontre** : la saisie
  couplée n'est rendue que là. Elle n'est volontairement pas offerte pour les
  champs patient plutôt que de promettre un comportement absent ;
- **rien ne liste les propositions en attente** à l'échelle d'une base : le
  traitement repose sur la file de complétion et la relecture des fiches. C'est
  la boucle d'amélioration, qui reste à outiller ;
- l'ajout effectif d'une valeur à la liste reste un geste humain via l'éditeur
  de gabarit, une version publiée étant figée par conception.

### Traçabilité Git

PR #58 fusionnée dans `develop` (`56bebcb`), PR #59 promue vers `main`
(`a9b6478`).

## T1 — référentiel de terminologie, structure

### Pourquoi ce chantier commence

Le porteur a écarté deux pistes en connaissance de cause. D'abord la liste
courte par service : un patient hospitalisé en cardiologie a aussi son diabète
et son insuffisance rénale à coder, donc une liste restreinte au service
recréerait le manque qu'on cherche à supprimer. Ensuite la saisie dans un menu
déroulant, inadaptée à un référentiel de plusieurs milliers d'entrées. Reste la
recherche incrémentale (typeahead), c'est-à-dire l'idée 4b de la file.

Le fichier fourni le 26 juillet 2026 contient 37 052 entrées — 35 664
`category`, 1 360 `block`, 28 `chapter` — organisées en hiérarchie. Après deux
ré-extractions demandées puis fournies par le porteur, il porte un identifiant
par entrée :

- les 35 664 catégories ont toutes un code, **sans aucun doublon** ;
- 788 blocs portent un identifiant technique dans une colonne distincte, repris
  comme identifiant de repli ;
- 28 chapitres et 572 blocs n'ont aucun identifiant. Sans conséquence : ce sont
  des regroupements, jamais proposables à la saisie, donc jamais stockés dans
  une donnée ;
- 708 entrées ont un libellé vide, là où une section n'a pas été traduite. Elles
  sont écartées à l'import : un concept sans libellé serait invisible.

Le porteur a demandé le 26 juillet 2026 qu'aucune mention de la source ne figure
dans le dépôt, en prenant cette décision à son compte, et indiquera s'il faut y
revenir. Les colonnes `license` et `attribution` existent et restent vides.

### Contenu du lot

Migration `20260726120000_terminology_reference.sql`, strictement additive :

- `terminology_release` : une publication de référentiel identifiée (source,
  version, licence, date d'import). Un index unique partiel garantit qu'un seul
  référentiel est actif à la fois ;
- `terminology_concept` : les concepts, avec `code` (identifiant stable),
  `label`, `kind`, `depth`, `parent_id` et `is_selectable`. La colonne
  `search_text` est **générée** à partir du libellé, donc jamais désynchronisée ;
- `terminology_normalize(text)` : normalisation immutable partagée par la colonne
  générée et par la recherche ;
- `search_terminology(text, integer)` : recherche incrémentale, minimum deux
  caractères, 50 résultats au maximum, les correspondances par préfixe d'abord.

### Décisions de sûreté

- **Lecture seule côté client.** RLS activée sur les deux tables, politique de
  `select` pour les comptes authentifiés, et grant limité à `select`. Aucune
  politique d'écriture n'existe : tout `insert`, `update` ou `delete` client est
  refusé, y compris pour un propriétaire de base. Le chargement d'un référentiel
  passe par `service_role`, hors API. À noter : le `grant ... on all tables` de
  `20260616090400_rls.sql` ne couvre que les tables existant à cette date, d'où
  des grants explicites.
- **`SECURITY INVOKER` et non `DEFINER`.** Aucune élévation n'est nécessaire
  puisque la RLS autorise déjà la lecture. Conséquence directe : l'inventaire des
  fonctions privilégiées de B9 n'est pas modifié — le contrôle ne retient que les
  fonctions `prosecdef`.
- **Aucune extension nouvelle.** Le projet n'active que `pgcrypto` ; la recherche
  s'appuie sur une colonne normalisée et un index de préfixe, sans `pg_trgm` ni
  `unaccent`, pour ne rien imposer au PostgreSQL embarqué des tests.
- **Jokers neutralisés.** `%`, `_` et `\` fournis par l'appelant sont échappés :
  une recherche reste une recherche de texte, jamais un motif arbitraire.

### Import et contenu versionné

Le référentiel est versionné dans le dépôt sous
`supabase/terminology/diagnostics-fr.tsv.gz` : converti en UTF-8, fins de ligne
normalisées, compressé de 2,33 Mo à 436 Ko. Le script
`scripts/import-terminology.mjs` lit indifféremment ce format compressé ou un
export brut en UTF-16, reconstruit la hiérarchie et écrit le référentiel **dans
une seule transaction** — un import partiel rendrait la recherche silencieusement
incomplète, ce qui est pire qu'un échec visible. Recharger un référentiel
existant exige `--replace`, pour qu'un référentiel déjà utilisé ne disparaisse
pas par accident.

### Incidents corrigés pendant le lot

**Recherche dépendante de la locale.** La première version de la normalisation
ne traduisait que les minuscules accentuées, en s'en remettant à `lower()` pour
le reste. Le test a montré que « DIABÈTE » ne trouvait pas « Diabète » : la base
de test tourne en locale `C`, où `lower()` laisse les caractères non ASCII
intacts. Les majuscules accentuées sont désormais traduites explicitement. La
migration n'ayant jamais été appliquée, elle a été corrigée sur place plutôt que
complétée par une seconde.

**Rattachements faux dans la hiérarchie.** Lorsqu'une entrée était écartée faute
de libellé, la pile des parents conservait l'entrée précédente au même niveau :
les entrées suivantes risquaient d'être rattachées à une **branche voisine**,
c'est-à-dire à une hiérarchie inventée — plus grave qu'un rattachement manquant.
Les enfants remontent désormais au plus proche ancêtre valide. L'effet est
mesurable sur le fichier réel : **128 concepts orphelins ramenés à 1**, celui
dont tous les ancêtres ont été écartés. Un test vérifie explicitement qu'une
entrée ne peut pas être adoptée par le bloc précédent.

**Assertion trop faible corrigée plutôt qu'ajustée.** Le seuil initial
« moins de 100 racines » était arbitraire et a échoué à 128. Il a été remplacé
par une invariante vraie et vérifiable sur les 36 000 lignes : *aucun concept
n'a un parent de profondeur supérieure ou égale à la sienne*, qui vaut zéro.

### Preuves locales

- `npm run db:verify` : **106 migrations appliquées depuis zéro**, 38 tables,
  210 fonctions, 61 policies — soit exactement les deux tables, deux fonctions et
  deux policies ajoutées ;
- `test/terminology.test.ts` et `test/terminology-import.test.ts` : **26/26** —
  écriture client refusée sur les deux tables, recherche insensible aux accents
  et à la casse, priorité au préfixe, référentiel inactif ignoré, entrées non
  sélectionnables exclues, minimum de deux caractères, jokers neutralisés, borne
  de résultats, unicité du référentiel actif, code obligatoire dès qu'un concept
  est sélectionnable, stabilité du code lors d'un changement de libellé,
  reconstruction de la hiérarchie et refus d'adoption par une branche voisine ;
- import de bout en bout du **fichier réellement versionné**, et non d'un
  échantillon : plus de 36 000 concepts insérés, hiérarchie cohérente, recherche
  fonctionnelle sur le référentiel activé.

### Parcours utilisateur cible, validé le 26 juillet 2026

1. Le médecin ajoute un champ et choisit le type « diagnostic (référentiel) » :
   **aucune valeur à saisir**, contrairement à une liste contrôlée ;
2. le saisisseur tape deux caractères et choisit dans les propositions ; le
   libellé s'affiche, le code part en base sans être montré ;
3. si rien ne correspond, la soupape du lot P1S prend le relais.

Décisions du porteur, prises le 26 juillet 2026 :

- plusieurs diagnostics se traitent par **deux champs distincts** pointant vers
  le référentiel, le modèle restant plat ;
- le type référentiel **s'ajoute** à `select` sans le remplacer : les listes
  courtes restent pertinentes pour une issue, un sexe, une gravité ;
- **l'activation d'un référentiel reste hors application.** Aucun écran ne
  permet de basculer de version, pas même pour un administrateur : l'opération
  se fait avec un accès direct à la base. Un clic ne doit pas pouvoir changer ce
  que voient tous les saisisseurs, pour une manipulation qui survient tous les
  deux ou trois ans ;
- **la donnée stockera le code ET le libellé du moment.** Le code sert au
  comptage, le libellé garantit qu'une fiche reste lisible même si le
  référentiel change ou est retiré. Cette redondance est délibérée : elle
  protège l'historique, qui était précisément la faiblesse du stockage par
  libellé seul.

### Limites explicites

- il n'existe **ni type de champ** exploitant le référentiel, **ni interface** de
  recherche : `assert_data_valid` ignore encore ces tables, et l'utilisateur ne
  voit aucun changement dans l'application ;
- la **copie locale** nécessaire au fonctionnement hors ligne n'est pas faite :
  en l'état, une recherche exigerait le réseau ;
- le stockage conjoint du code et du libellé est **décidé mais pas encore
  implémenté** : il dépend du type de champ, qui reste à construire ;
- rien n'est déployé : ces preuves sont locales.

## T2 — champ de terminologie, contrat serveur

### Périmètre

Le référentiel posé par T1 n'était relié à rien. Ce lot crée le type de champ
`terminology` et la règle serveur qui gouverne ce qui peut entrer dans la
donnée. Il s'arrête volontairement au **contrat** : aucune interface, la
recherche visible relève du lot suivant.

### Ce qui est stocké, et pourquoi

Un objet `{"code": …, "label": …}`, et rien d'autre :

- le **code** est l'identifiant stable, celui sur lequel les statistiques
  regroupent. Il survit à une correction de libellé, qui sinon scinderait une
  maladie en deux dans les analyses ;
- le **libellé** est un instantané pris à la saisie. Il garantit qu'une fiche
  reste lisible même si le référentiel change ou est retiré du service.

### Le contrôle qui compte

Le serveur ne vérifie pas seulement que le code existe : il vérifie que **le
couple est cohérent**. Un code valide accompagné d'un autre libellé est refusé.
Sans cela, un appelant pourrait stocker un libellé trompeur à côté d'un code
correct, et la fiche mentirait sur elle-même — le libellé affiché ne
correspondrait pas au code compté.

Contrepartie assumée : après une correction de libellé dans le référentiel, un
client dont le cache est périmé se voit refuser l'écriture et doit rafraîchir.
C'est le comportement voulu ; la base reste la source de vérité.

Sont également refusés : une clé surnuméraire dans l'objet, un code ou un
libellé vide ou non textuel, un texte simple, un concept non sélectionnable, et
un concept appartenant à un référentiel devenu inactif.

### Contrainte de type

La liste des types autorisés est élargie. Le nom de la contrainte est **recherché
dans le catalogue plutôt que supposé** : une contrainte déclarée en ligne porte
un nom généré, et un `drop constraint if exists` sur un nom erroné échouerait en
silence, laissant l'ancienne règle refuser le nouveau type. La migration échoue
bruyamment si elle ne trouve pas la contrainte.

### Preuves locales

- `npm run typecheck`, `npm run lint` : réussis ;
- `npm run db:verify` : **107 migrations depuis zéro** ;
- `test/terminology-field.test.ts` : **12/12**, dont neuf chemins de refus.

### Limites explicites

- **Aucune interface.** Le type n'apparaît pas dans le formulaire de création de
  variable : aucun champ de terminologie ne peut être créé depuis l'application,
  et la recherche visible reste à construire ;
- `create_template_bundle`, qui crée un gabarit **en bloc**, ne connaît pas le
  nouveau type. Le chemin utilisé par le parcours validé — ajouter une variable
  dans l'éditeur — insère directement dans la table et n'est donc pas concerné.
  Réécrire cette fonction de 150 lignes pour une seule ligne de liste aurait fait
  courir un risque de transcription supérieur au bénéfice ;
- la validation **client** (`src/domain/validation.ts`) ne connaissait pas encore
  ce type au moment de ce lot ; c'est corrigé par T3 ;
- rien n'est déployé : ces preuves sont locales.

## T3 — recherche visible

### Périmètre

Premier lot de la série que l'utilisateur peut voir. Le porteur a choisi de
livrer la recherche **avant** la copie locale, pour juger tôt de l'ergonomie
quitte à ce que ce soit lent, plutôt que de bâtir un cache sur une interface non
éprouvée.

### Contenu

- `src/data/terminology.ts` : accès au référentiel, sur le modèle des autres
  dépôts de données du projet, donc injectable et testable. La recherche n'est
  même pas tentée en deçà de deux caractères ;
- `src/screens/member/TerminologyInput.tsx` : zone de recherche, propositions,
  choix. Une valeur choisie s'affiche par son **libellé** et reste modifiable ;
- `FieldInput` rend ce composant pour le type `terminology` ; `FieldForm` propose
  désormais ce type à la création d'une variable ;
- `src/data/types.ts` : le type `TerminologyValue` et son garde ;
- `src/domain/validation.ts` : contrôle de **forme** seulement — le serveur reste
  seul juge de l'existence du concept et de la cohérence du couple. Le contrôle
  client sert à signaler une saisie incomplète sans aller-retour réseau.

### Deux détails qui décident de l'usage réel

**La dernière frappe gagne.** Sur une connexion lente, une réponse ancienne peut
arriver après une plus récente ; afficher la première donnerait des propositions
sans rapport avec ce qui est tapé. Chaque requête porte un numéro d'ordre et
seule la plus récente peut écrire dans la liste. Un test le vérifie en faisant
délibérément répondre la première requête après la seconde.

**Une panne se voit.** Une recherche qui échoue affiche l'erreur au lieu de
rester muette : sans cela, l'utilisateur croirait que le diagnostic n'existe pas
et saisirait autre chose.

### Correction pendant le lot

Le rôle d'accessibilité `option` était porté par la ligne de liste et non par le
bouton qu'on active. Conséquence : un clic sur la ligne ne déclenchait rien, et
une technologie d'assistance aurait annoncé une option impossible à choisir. Le
rôle porte désormais sur l'élément activable.

### Preuves locales

- `npm run typecheck`, `npm run lint` : réussis ;
- `npm run test:web` : 42 fichiers, **215/215**, dont 7 nouveaux.

### Limites explicites

- **Rien n'est essayable en ligne.** Les migrations T1 à T3 ne sont pas
  appliquées sur la base distante et le référentiel n'y est pas importé : le
  champ s'afficherait, mais toute recherche resterait vide. Il faut une opération
  de déploiement staging autorisée pour l'éprouver ;
- **chaque frappe interroge le serveur** : la copie locale est le lot suivant, et
  sans elle la saisie hors ligne est impossible ;
- la **soupape** du lot P1S ne s'applique pas à ce type : elle est offerte aux
  champs à liste contrôlée. Avec des dizaines de milliers de concepts le besoin
  est moindre, mais le cas « diagnostic absent du référentiel » n'est pas couvert ;
- l'affichage d'une valeur hors formulaire de saisie — listes, exports,
  statistiques — n'est pas traité : ces vues montreront l'objet brut.
