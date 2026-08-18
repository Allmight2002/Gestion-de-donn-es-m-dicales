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
| T3 | Recherche visible (typeahead) | Terminé et promu | `codex/typeahead-terminologie` | PR #64 et #65 ; CI verte | **Déployé sur staging le 2026-07-26** | Chaque frappe interroge le serveur ; hors ligne non couvert |
| T4 | Copie locale des diagnostics | Terminé localement | `codex/cache-terminologie` | — | À déployer | Téléchargement à la demande ; pas de mise à jour automatique |
| TS | Mise en service staging de la terminologie | Terminé | `main` `147e2c58ba1afdad329133c8caa0b0bc617b9e64` | Run `30220488673` | Migrations appliquées, référentiel importé | B2 bloque l'inspection stricte ; preuves antérieures caduques |
| P1A | Registre « Diagnostic urgences » noyau | **Obsolète** | — | — | — | Remplacé par la terminologie (T1 à T4) : le champ diagnostic ne repose plus sur une liste contrôlée à garnir à la main |
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

## T4 — copie locale des diagnostics

### Périmètre

Le porteur a jugé la vitesse de recherche « moyenne » après essai sur staging.
Sans copie locale, chaque frappe part au serveur : pénible sur une connexion
lente, impossible hors connexion. Le référentiel étant figé entre deux
publications, il se prête naturellement à une copie côté navigateur.

### La décision structurante : une base locale séparée

La copie ne vit **pas** dans la base locale des données patient, et c'est
délibéré :

- un référentiel de diagnostics n'est pas une donnée médicale, c'est un
  dictionnaire. L'héberger avec les instantanés patient brouillerait le
  cloisonnement que le produit protège ;
- la base patient est **purgée à chaque changement d'utilisateur** et désactivée
  par la politique hors-ligne. Le référentiel y serait effacé sans aucune raison,
  et serait indisponible là où il est justement le plus utile.

Aucune donnée de patient n'entre dans cette copie.

### Contenu

- `src/data/terminology.ts` : `activeRelease()` et `listEntries()` — seules les
  entrées **proposables** sont copiées, les regroupements ne pouvant être choisis ;
- `src/data/terminologyCache.ts` : base locale dédiée, téléchargement paginé avec
  progression, recherche locale, et détection d'une copie périmée ;
- `TerminologyInput` : recherche locale dès qu'une copie existe, sinon serveur ;
  téléchargement proposé **à la demande**, jamais imposé — plusieurs milliers
  d'entrées ne se téléchargent pas dans le dos de quelqu'un dont la connexion est
  limitée.

### Le point délicat : ne pas diverger du serveur

La recherche locale doit rendre **exactement** ce que rendrait le serveur. Deux
précautions :

- les libellés arrivent avec leur texte de recherche **déjà normalisé par la
  base** : on ne recalcule pas ce que le serveur a calculé ;
- le classement local reprend celui du serveur — ce qui commence par la saisie
  d'abord, puis le libellé le plus court. Un classement différent proposerait
  autre chose selon qu'on est connecté ou non, ce qui serait pire qu'une absence
  de copie.

Seule la saisie de l'utilisateur est normalisée côté client, et un test compare
cette normalisation à celle du serveur.

### Incident corrigé

La normalisation traitait les ligatures **avant** de passer en minuscules : « Œ »
échappait donc au traitement. C'est exactement le défaut corrigé côté base pour
les majuscules accentuées, reproduit à l'identique côté client. L'ordre suit
désormais celui du serveur.

### Preuves locales

- `npm run typecheck`, `npm run lint`, `npm run build` et `npm run manifest` :
  réussis ;
- `npm run test:web` : 43 fichiers, **228/228**, dont 13 nouveaux — normalisation
  conforme au serveur, téléchargement paginé, progression rapportée, classement
  identique, copie périmée détectée, remplacement complet au rechargement.

### Limites explicites

- le téléchargement est **manuel** : rien ne rafraîchit la copie quand une
  nouvelle publication est activée. La détection existe (`cacheIsCurrent`) mais
  n'est pas encore exploitée par l'interface ;
- la copie est **par navigateur** : un même utilisateur sur deux postes la
  téléchargera deux fois ;
- le bouton vit dans le champ de saisie, faute d'écran de réglages dédié.

## TS — mise en service de la terminologie sur staging

Première opération distante de la série, autorisée explicitement par le porteur
le 26 juillet 2026. Elle porte sur `main`
`147e2c58ba1afdad329133c8caa0b0bc617b9e64`, staging uniquement.

### Faux départ, et ce qu'il a prouvé

Le run `30219877402` a échoué **à la validation**, sur un contrôle de la release
coordonnée : l'instantané de schéma était resté à `20260714215335` alors que les
lots T1 et T2 avaient ajouté deux migrations. Conséquence : `backend-staging`
n'a jamais démarré, **aucune migration n'a été appliquée** et staging est resté
intact.

Cause de fond : ce contrôle ne tourne **que** dans la release coordonnée, pas
dans la CI des pull requests. T1 et T2 sont donc passés verts et ont été promus
jusqu'à `main` en laissant l'instantané en retard. Règle à retenir : un lot qui
ajoute une migration doit lancer `npm run schema`, puis se vérifier avec
`npm run build` et `npm run manifest` — `typecheck`, `lint` et les tests ne
couvrent pas ce point. Correctif : PR #66 puis #67.

### Run de mise en service — `30220488673`

| Étape | Résultat |
|---|---|
| Validation complète | réussie |
| Sauvegarde chiffrée pré-release | créée et vérifiée, artefact `pre-release-backup-staging-30220488673` |
| Migrations appliquées | réussi |
| Storage et six Edge Functions | réussi |
| Contrôle de drift backend | réussi, artefact `backend-drift-30220488673` |
| Déploiement frontend Vercel | réussi |
| Activation de l'inspection stricte | **échec** : « Scanner strict injoignable ou réponse inexploitable » |
| Jobs production | non exécutés (cible `staging`) |

L'échec final appartient à **B2** et n'est pas reclassé : sans scanner joignable,
l'inspection stricte refuse de s'activer plutôt que de laisser passer des
fichiers non vérifiés. Ce comportement fail-closed est correct et ne concerne pas
la terminologie, qui ne touche à aucun fichier.

### Import du référentiel

Exécuté après le run, en contexte privilégié hors API :

- **36 344 concepts** importés, dont **35 015 proposables à la saisie** ;
- 708 entrées écartées faute de libellé, conformément à la règle du lot T1 ;
- référentiel activé, donc interrogeable.

### Vérification de bout en bout

Depuis l'API REST de staging, avec un compte fictif et en anonyme :

- **appelant anonyme : aucun résultat** — la politique de lecture visant les
  comptes authentifiés tient en conditions réelles ;
- compte médecin : résultats réels, par exemple `1A00 Choléra` ou
  `5A10 Diabète sucré de type 1` ;
- une recherche **sans accent trouve les libellés accentués** : la normalisation
  se comporte comme en test, malgré la locale du serveur distant ;
- une recherche sans correspondance rend zéro résultat.

### Constat d'ergonomie à arbitrer

Taper « palu » ne propose pas « Paludisme » seul : le terme générique est un
**regroupement** de la classification, donc non sélectionnable. Seules les formes
précises apparaissent, comme « Paludisme, sans précision ». C'est cohérent avec
l'objectif d'analysabilité, mais cela change la saisie et mérite un retour
terrain avant d'être considéré comme acquis.

### Correction du contenu importé — le même jour

Le porteur, en essayant la recherche, a signalé des propositions qui n'étaient
pas des diagnostics. L'audit du fichier lui a donné raison, et a révélé une
erreur de méthode : **le référentiel avait été importé sans que son contenu soit
examiné**.

Sur 28 chapitres, un seul — les **codes d'extension** — pesait 17 159 entrées sur
35 664, soit près de la moitié. Ce ne sont pas des maladies mais des
qualificatifs que la classification accroche à un diagnostic : substances,
médicaments, agents. D'où des réponses telles que « Érythrocytes », « Antacides »
ou « Composés de magnésium » à une recherche de diagnostic.

Chapitres désormais écartés à l'import : codes d'extension, causes externes de
morbidité, facteurs influant sur l'état de santé, évaluation du fonctionnement,
codes d'utilisation particulière.

Deux chapitres sont **conservés à la demande explicite du porteur** :

- les **symptômes et signes cliniques**, parce qu'aux urgences un patient est
  reçu pour une douleur ou une fièvre bien avant qu'un diagnostic soit posé ;
- les **affections de médecine traditionnelle**, pertinentes dans le contexte de
  déploiement.

Résultat mesuré après réimport : **14 553 concepts, dont 13 964 proposables**,
21 791 entrées écartées, et **plus aucun code de substance**. Vérification en
conditions réelles : « cholera » ne renvoie plus qu'un résultat, `1A00 Choléra`,
là où le vaccin « Choléra, vaccins vivants atténués » apparaissait auparavant.

Enseignement : importer un référentiel tiers sans en auditer le contenu revient à
faire confiance à un fichier sur son nom. Le volume seul ne dit rien de la
pertinence.

### Remise à neuf de la production — 2026-07-27

Opération autorisée explicitement par le porteur, qui a confirmé qu'aucun tiers
n'utilisait la production et que l'ensemble pouvait être supprimé.

**État constaté avant.** 86 migrations appliquées, la dernière datant de juin,
pour 107 attendues par le code : 31 tables au lieu de 38, 150 fonctions au lieu
de 173. La base n'était donc pas seulement en retard sur `main`, elle était
**désaccordée avec son propre frontend**, déployé le 15 juillet. Contenu :
5 comptes, 8 bases, 17 patients, 4 rencontres, 9 gabarits, 7 fichiers stockés,
81 entrées d'audit.

**Déroulé.** Sauvegarde complète prise avant toute écriture (1 088 Ko, conservée
hors dépôt sur le poste du porteur). Puis suppression du schéma applicatif, des
comptes et des fichiers ; réapplication des 107 migrations ; application de
`storage.sql` ; import du référentiel.

**État après.** 107 migrations, 38 tables, 61 policies, 132 fonctions
`SECURITY DEFINER` — le même compte que celui relevé sur staging lors du contrôle
B9 —, 4 buckets privés, 14 553 concepts dont 13 964 proposables. Les six Edge
Functions et le frontend ont été déployés par le porteur. Vérification finale :
le site répond, sert un nouveau bundle, la recherche de diagnostics existe, un
appelant anonyme n'obtient aucun résultat, et les six fonctions répondent.

**Trois garde-fous ont fonctionné pendant l'opération**, et méritent d'être
notés :

- le classificateur de sécurité de l'outil a **refusé d'exécuter** la suppression
  de schéma et l'application des migrations sur une base de production ; ces
  commandes ont donc été lancées par le porteur lui-même, après relecture ;
- Supabase **interdit la suppression directe** des tables de stockage en SQL ;
  les fichiers ont dû être retirés par l'interface ;
- l'ordre initial de suppression était **faux** — les comptes avant le schéma qui
  les référence — et la contrainte de clé étrangère l'a bloqué avant tout dégât.

**Limites explicites.**

- L'opération a été menée **hors procédure officielle** : la release coordonnée
  exige l'identifiant d'un run staging réussi, que B2 empêche d'obtenir. Aucune
  preuve de conformité B1 n'a donc été produite pour cet état de production ;
- il **n'existe plus aucun compte** : l'application ne propose pas d'inscription,
  les comptes se créent depuis l'administration Supabase, le profil et le rôle
  médecin étant posés par déclencheur ;
- la readiness reste inchangée : **B2, B5, B6, B7 et B10 sont ouverts**, et la
  production demeure interdite à toute donnée réelle ou pseudonymisée.

**Suites de sécurité demandées au porteur** : rotation du mot de passe de la base
et des deux jetons de déploiement, tous exposés en clair pendant l'opération, et
suppression du fichier d'accès local.

### Conséquence sur les preuves antérieures

Cette mise en service crée un nouvel état de staging. Les preuves B1, B3, B4, B8
et B9 rattachées à `ebee179` **ne décrivent plus l'état courant** : elles restent
valables pour leur propre SHA, conformément au principe du cadre. Aucune
nouvelle acceptation de readiness n'est prononcée ici, et la production reste
hors périmètre — décision inchangée : **production readiness not demonstrated**.

## Lot L3 — Allègement du chargement de l'application (2026-07-28)

Idée n°9 de la file, ouverte le 2026-07-27 après un *Real Experience Score* de
**78 sur ordinateur** relevé par le porteur. Ce score agrège des navigations
réelles et reste bruité sur un site à faible trafic : il ne prouve pas une cause.
Le lot n'a donc traité que ce qui est **mesurable dans le dépôt**.

### Ce qui était mesuré sur `main`

| | Avant | Après |
|---|---|---|
| Précache du service worker | **1 727,9 Kio** (70 fichiers) | **892,4 Kio** (70 fichiers) |
| Fichier principal `index` | 511,8 Ko | 176,5 Ko |
| Alerte « chunk > 500 Ko » | oui | non |

### Deux corrections

**Le tableur sort du précache.** SheetJS pèse 856 Ko à lui seul — 493 Ko pour le
thread principal, 363 Ko pour le worker de parsing. Le service worker le tirait
dès la première visite, alors qu'il ne sert qu'à l'import d'un classeur : une
action que la plupart des visites ne feront jamais, et qui exige de toute façon
le serveur pour la validation. Le tenir prêt hors-ligne n'apportait rien. Les
deux fichiers restent servis par le réseau au moment du dépôt d'un fichier ;
aucune fonctionnalité n'est retirée. **835 Kio économisés à chaque première
visite** — pertinent dans le contexte de déploiement visé, où la bande passante
est comptée.

**Le socle est isolé du code applicatif.** React, le routeur et le client de base
de données voyageaient dans le fichier principal, au-dessus du seuil d'alerte de
l'outil de build. Séparés, ils gardent leur empreinte d'une version à l'autre :
après une mise à jour, le navigateur ne retélécharge que le code qui a réellement
changé.

### Vérification

`npm run typecheck`, `npm run lint` et `npm run test:web` (**235 tests**) sont
verts. Le service worker généré ne contient plus aucune référence au tableur.
L'application construite a été **chargée et manipulée** depuis `dist/` : écran de
connexion rendu, bascule de langue fonctionnelle, aucune erreur de console — la
séparation du socle n'a pas cassé l'ordre d'initialisation des modules.

### Ce que ce lot ne fait pas

- **Dédoublonner le tableur** entre le worker et le thread principal. Les deux
  copies proviennent de deux graphes de modules distincts que l'outil de build
  compile séparément ; les fusionner supposerait de supprimer le repli sur le
  thread principal, prévu pour les navigateurs sans *Web Worker*. Le gain serait
  nul depuis ce lot : les deux copies sont désormais hors précache et chargées à
  la demande.
- **Ne charger que la langue active.** Les traductions française et anglaise
  voyagent ensemble dans un fichier de 98 Ko. La correction touche
  `src/i18n/messages.ts`, identifié comme source de conflits pour les lots
  parallèles : elle est laissée à un lot ultérieur, seul.
- **Établir une cause au score mesuré.** Sans mesures réelles par métrique, on
  ignore toujours la part du poids téléchargé, de la latence réseau depuis le
  lieu d'usage et du temps de réponse de la base. Le score devra être relu après
  déploiement, sur plusieurs jours.

## Lot L2 — Sections des variables permanentes (2026-07-28)

Le défaut D4 restait visible à la création d'un patient : toutes les variables
permanentes formaient une liste plate. L'édition utilisait déjà le composant des
rencontres, mais sans comportement explicite pour une ancienne variable privée
de section.

Le regroupement de `EncounterFields.tsx` est désormais un composant de rendu
commun. `NewPatient.tsx` l'utilise sans changer ses contrôles de saisie, et
`EditPatient.tsx` continue de passer par `EncounterFields`. Les sections suivent
l'ordre **Clinique → Biologie → Paraclinique**, seules les sections non vides
sont rendues, puis une section **Autre** recueille toute variable dont la section
est absente ou inconnue afin qu'aucune donnée ne disparaisse du formulaire.
L'encadré d'identité reste distinct.

Deux tests web couvrent la création et l'édition : appartenance des variables à
leur section, ordre d'affichage, absence d'une section vide et repli sous
« Autre ». Vérifications locales sur le worktree isolé du lot : tests ciblés
**22/22**, suite web **237/237**, `npm run typecheck`, `npm run lint` et build de
production avec `VITE_USE_SIGNED_READ=true` — tous verts.

Le lot ne modifie ni schéma, ni RLS, ni RPC, ni données. La livraison et la
vérification visuelle de production sont consignées séparément après promotion.

## Lot L1 — Liste d’une base : affichage et bandeau (2026-07-28)

Les constats D5 et D3 ont été reproduits dans `BaseHome`. Une valeur de
terminologie `{code, label}` tombait dans `String(v)` et apparaissait sous la
forme « [object Object] ». Le bandeau d’enregistrement hors-ligne occupait quant
à lui toute la largeur sous l’en-tête, même lorsqu’aucune copie n’existait.

La liste des patients et l’historique d’une rencontre utilisent désormais la
fonction partagée `displayFieldValue` : le libellé lisible est affiché, tandis
que les formats existants des valeurs vides, booléennes et des codes de valeur
manquante sont conservés. Sans copie locale, l’action hors-ligne devient un
bouton secondaire compact dans l’en-tête. Lorsqu’une copie existe, une ligne
d’état compacte conserve sa date, son actualisation et son retrait. Le message
de politique de sécurité reste affiché si le mode hors-ligne est désactivé.

La régression a d’abord été exécutée seule sur le code non corrigé : elle
échouait en montrant « [object Object] » au lieu du libellé fictif
« Glioblastome ». Après correction, les 7 tests ciblés passent. Les validations
locales sont vertes : `npm run typecheck`, `npm run lint`, `npm run test:web`
(237 tests) et `npm run build` avec la lecture signée obligatoire.

## Lot L5 — Constructeur de règles de cohérence (2026-07-28)

Idée n°7 de la file. Pour poser une règle de cohérence sur une base, l'utilisateur
devait taper du JSON à la main — le gabarit affiché en exemple donnait le ton :

    {"operator":"greater_or_equal","left_field":"discharge_date",
     "right_field":"admission_date"}

Le produit s'adresse à des médecins-chercheurs. Cette zone leur était fermée,
alors que c'est là que se joue la qualité des données.

### Ce qui est livré

Un mode **guidé** devient le mode par défaut : on choisit un type de règle
(comparaison entre deux variables, ou règle conditionnelle), puis les variables
et l'opérateur dans des listes. Les opérateurs sont libellés en langage clinique,
et adaptés au type de la variable — une date ne se compare pas avec les mêmes
mots qu'un nombre.

La règle en construction est rendue sous forme de **phrase lisible**
(`ruleSentence`), ce qui permet de vérifier ce qu'on vient d'assembler sans
relire du JSON. Le même rendu est réutilisé par l'éditeur de version de gabarit
pour afficher les règles déjà enregistrées (`RuleSummary`).

Le mode **expert** conserve la saisie JSON directe, pour les cas que l'assemblage
guidé ne couvre pas.

### Ce qui n'a pas changé

La sortie reste exactement le même JSON qu'avant : les règles déjà enregistrées
continuent de fonctionner sans reprise. `parseRule` demeure la validation côté
client, et **le serveur reste la source de vérité** — aucun contrôle n'a été
déplacé vers l'interface seule.

### Reprise

Le chantier a été mené par Codex, dont le quota s'est épuisé après le push, avant
l'ouverture de la pull request et avant la consigne au journal. La section
ci-dessus a été écrite lors de la reprise ; la vérification est celle de la CI
sur le SHA de la pull request, qui exécute la suite complète.

## Lot B7 — Dérogation mono-personne sur les contrôles GitHub (2026-07-29)

Constaté en tentant la première release de production depuis la remise à neuf :
le job `production` s'arrête sur *Verify live GitHub protections*, avant toute
écriture. Deux manques distincts, et un blocage de fond.

### Ce que la tentative a révélé

1. Le secret `GITHUB_CONTROLS_TOKEN` est **absent** — le script refuse de
   démarrer.
2. **Aucune protection n'existe** sur `main` ni sur `develop` : l'API répond
   *Branch not protected* pour les deux.
3. Surtout : les protections exigées **ne peuvent pas être posées** sur ce dépôt.

Le troisième point est le vrai sujet. Trois exigences du contrôle supposent une
**seconde personne** — review approuvée, approbation distincte après le dernier
push, interdiction de s'auto-approuver sur un environnement. GitHub interdit
d'approuver sa propre pull request. Sur un dépôt tenu par une seule personne, les
activer n'aurait rien renforcé : elles auraient rendu toute fusion et tout
déploiement impossibles. Un contrôle qui bloque l'exploitation au lieu de la
sécuriser n'est pas un contrôle.

### Décision du porteur

Assouplir le script pour un dépôt mono-personne, plutôt que d'ajouter un second
relecteur ou de laisser B7 — et donc la production — ouvert indéfiniment.

### Ce qui a été fait

`GITHUB_CONTROLS_SOLO=true` suspend exactement trois vérifications, et rien
d'autre. Restent exigés : **pull request obligatoire** sur les deux branches,
`build-test` et `scanner-image` verts, règles applicables aux administrateurs, ni
force-push ni suppression, résolution des conversations, reviewer d'environnement
présent, et politique de branche stricte par environnement.

La dérogation retire la **relecture par un tiers**, pas la **barrière
technique**. Le mécanisme qui empêche de livrer du code à CI rouge est intact.

Trois choix pour que la dérogation ne se dissolve pas dans le temps :

- elle est portée par une **variable de dépôt**, pas écrite en dur : la retirer
  suffit à rétablir le contrôle complet ;
- en mode dérogé, le script **n'écrit pas « OK »** — il consigne dans le journal
  de release que la dérogation est active et ce qu'elle suspend, pour que la
  preuve porte la restriction au lieu de la masquer ;
- un test vérifie qu'une protection acceptée en mode dérogé est **toujours
  refusée** hors dérogation, et un autre qu'un contournement administrateur reste
  refusé **même** en mode dérogé.

### Vérification

`npm run typecheck`, `npm run lint` et les tests de `test/github-controls.test.ts`
(**7 tests**, dont 4 nouveaux) sont verts.

### Reste à faire, hors dépôt

Les protections de branche et les règles d'environnement ont été **posées et
vérifiées le 2026-07-29** : `npm run github:controls:verify` passe en mode
mono-personne. La variable de dépôt `CONTROLS_SOLO_MODE=true` est posée.

Reste à poser le secret **`CONTROLS_ADMIN_TOKEN`** : un jeton d'accès personnel à
portée fine, en lecture seule sur l'administration et les environnements du seul
dépôt.

**Mais ce n'est pas le seul manque**, contrairement à ce qui était écrit ici dans
un premier temps. L'inventaire des secrets fait ensuite montre que
l'environnement `Production` **n'a jamais été approvisionné** : il porte 5
secrets, contre 30 pour `staging`.

| Manquant en production | Rôle |
|---|---|
| `CONTROLS_ADMIN_TOKEN` | contrôle B7 |
| `GOVERNANCE_EVIDENCE_JSON` | preuve de gouvernance signée pour le SHA promu |
| `RECOVERY_EVIDENCE_JSON` | exercice de restauration pour ce même SHA |
| `OPERATIONS_EVIDENCE_JSON` | affectations d'exploitation et QA clinique |
| `STORAGE_BACKUP_ENCRYPTION_KEY` | sauvegarde chiffrée avant toute écriture |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` | écriture base |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | déploiement du frontend |

Les trois preuves de gouvernance, de restauration et d'exploitation ne sont pas
des identifiants : ce sont des **pièces du dossier de readiness**, qui n'existent
pas encore. La release coordonnée de production est donc bloquée non par un
oubli de configuration, mais par le dossier lui-même — ce qui est exactement ce
que ce garde-fou est censé produire.

**Conséquence pratique** : `main` porte L1, L2, L3, L5 et B7, tous **déployés sur
staging et vérifiés**, sans chemin vers la production tant que le dossier de
readiness n'est pas constitué. La production continue de servir sa version
antérieure.

Note de plate-forme découverte au passage : GitHub **réserve le préfixe
`GITHUB_`** pour les secrets comme pour les variables. Le nom
`GITHUB_CONTROLS_TOKEN` inscrit dans le workflow n'était donc pas créable, ce qui
explique la valeur vide reçue par le job. Le secret s'appelle désormais
`CONTROLS_ADMIN_TOKEN`, et seule la variable d'environnement lue par le script
garde son nom d'origine.

Cette dérogation devra être déclarée telle quelle dans le dossier ANSICE : elle
se justifie par la taille de l'équipe, pas par une analyse de risque.

## B7 — fermeture du gate technique (2026-08-01)

Le dépôt étant public depuis le 2026-07-28, la protection des branches est
disponible sans plan payant. Le contrôle live a été vérifié sur le dépôt
`Allmight2002/Gestion-de-donn-es-m-dicales`.

### Configuration vérifiée

- `main` et `develop` exigent une pull request ;
- `build-test` et `scanner-image` sont des checks obligatoires sur les deux
  branches ;
- les règles s'appliquent aux administrateurs ; le force-push et la suppression
  de branche sont interdits ; les conversations doivent être résolues ;
- `staging` autorise `develop` et `main`, tandis que `production` autorise
  uniquement `main` ;
- `Allmight2002` est reviewer requis sur les deux environnements.

### Vérification et limite explicite

Avec `GITHUB_CONTROLS_SOLO=true`, `npm run github:controls:verify` termine par
`Controles GitHub: OK en mode MONO-PERSONNE`. La dérogation suspend uniquement la
relecture par un tiers, l'approbation distincte après le dernier push et
l'interdiction de l'auto-approbation d'environnement. La barrière technique
contre une fusion à CI rouge reste active.

B7 est **fermé pour la protection technique**. La variable de dépôt
`CONTROLS_SOLO_MODE=true` devra être retirée dès qu'un second relecteur existe ;
la revue complète reprendra alors sans changement de script. La MFA, la revue
nominative et le moindre privilège restent des preuves RSSI externes.

Le circuit de promotion de la preuve suit `branche de travail → develop → main`.
Les protections ont été vérifiées avant sa mise en œuvre ; aucune fusion directe
vers `develop` ou `main` n'est utilisée.

### Traçabilité du circuit et test négatif

- PR #111 (`codex/b7-branch-protections` → `develop`) fusionnée le 2026-08-01
  en `2f96f5c425c99238c5b349905e39aa2c4f54d8f9` ; run CI `30703062832`,
  `build-test` et `scanner-image` verts ;
- PR #112 (`develop` → `main`) fusionnée le 2026-08-01 en
  `f24b91c69c5145854891b3f31fe56ced5ac7d14e` ; runs `30703195018` (PR) et
  `30703175979` (push sur `develop`), checks verts ;
- PR négative #113, ouverte contre `main` depuis `codex/b7-red-ci-probe` :
  run `30703348177` avec `build-test=FAILURE` et `scanner-image=SUCCESS` ;
  `gh pr merge 113 --merge` a été refusé avec `MERGE_EXIT=1` et le message
  GitHub `base branch policy prohibits the merge` ; la PR a été fermée sans
  fusion et la branche temporaire supprimée.

## Dérogation pilote sur les trois preuves de readiness (2026-07-29)

Décidée par le porteur après l'inventaire des secrets de production, dans le
prolongement de la dérogation B7.

**Une différence de nature doit rester consignée.** B7 était une
**impossibilité** : GitHub interdit d'approuver sa propre pull request, et aucun
travail n'aurait permis de satisfaire le contrôle sur un dépôt à une personne.
Les trois preuves suspendues ici — gouvernance, reprise, exploitation — sont au
contraire **réalisables** ; elles manquent parce qu'elles n'ont pas été faites.
C'est une dette assumée, pas une adaptation à une contrainte de plate-forme.

### Forme retenue

La dérogation ne s'applique **qu'à l'absence** de preuve. Chaque garde-fou teste
d'abord si la preuve existe :

- fournie → vérifiée intégralement, y compris la correspondance au SHA exact ;
- absente et dérogation active → la release continue, après avoir écrit au
  journal ce qui n'est pas prouvé ;
- absente et dérogation inactive → échec, comme avant.

Produire **une seule** des trois preuves la remet donc immédiatement sous
contrôle, sans rien reconfigurer : la dette se rembourse par tiers.

### Ce qui reste bloquant

La sauvegarde **chiffrée, vérifiée et conservée** avant toute écriture n'est pas
touchée — c'est le filet qui rend une erreur réparable. Ni la preuve de staging
réussi pour le même SHA, ni la vérification de cible, de dérive de schéma, d'ACL
de fonctions et d'inventaire Edge.

### Vérification

`test/deployment.test.ts` (**11 tests**) vérifie que la sortie anticipée exige
les **deux** conditions, que le contrôle d'origine subsiste pour une preuve
fournie, que la dérogation passe par une variable de dépôt et n'est jamais écrite
en dur, et que la sauvegarde chiffrée reste inconditionnelle.

Détail et condition de levée : [`derogations-readiness.md`](derogations-readiness.md).

**Limite d'acceptabilité** : cette dérogation ne vaut que pour une production à
**données fictives**, sans utilisateur tiers. Elle tombe à la première donnée
réelle, au premier patient, et au premier utilisateur qui n'est pas le porteur.

## 2026-07-29 — L10, comptes de mission : livré, vérifié sur staging, bloqué en production

Un médecin peut confier la saisie d'**une** base à une personne de terrain, pour une
durée bornée et révocable. Conception : [`spec-comptes-mission.md`](spec-comptes-mission.md).

### Ce qui a été construit

Le socle existait — `base_access`, révocation, audit. Quatre pièces manquaient, ajoutées
par la migration additive `20260729104500_mission_accounts.sql` :

- un **rôle global `saisisseur`** : toute policy écrite `is_medecin() and …` l'exclut par
  défaut, donc il ne peut ni créer de base ni de gabarit — le défaut échoue fermé ;
- `can_create_structured_data`, qui **sépare créer de modifier**. Les RPC de création
  acceptent `can_create` **ou** `can_edit` : aucun éditeur existant ne change de
  comportement, aucun backfill ;
- `base_access.expires_at`, vérifiée par la base à **chaque requête** — seule façon de
  couper un jeton déjà émis. `null` pour toutes les lignes existantes = permanent ;
- un **trigger de garde** : échéance obligatoire, plafond 24 mois, permissions élargies
  refusées, justification exigée pour ouvrir l'identité, **une seule base** par compte.

`create_patient` n'exige plus `can_write_identity` : elle **refuse explicitement** tout
champ nominatif venant d'un appelant qui ne l'a pas, et n'écrit que le code. C'est cette
exclusion qui rend la permission de création acceptable.

Côté serveur : l'Edge Function idempotente `create-mission-account` (septième fonction).
Côté interface : écran « Comptes de mission », bandeau d'échéance, écran de fin de mission.

### Les cinq décisions restantes, tranchées le jour même

24 mois maximum prolongeables · lecture des noms **réglée à la création, case décochée par
défaut**, justification consignée à l'activation · pas de téléversement en v1 · purge des
comptes échus **12 mois** après l'échéance, en opération d'entretien manuelle · rôle
`saisisseur` en base, « compte de mission » à l'écran.

### Trois défauts trouvés, et ce qu'ils enseignent

**Deux régressions de la même famille**, prises par la suite de tests : *redéfinir un objet
à partir d'une migration périmée*. La policy `el_select` avait été durcie en
`20260616095700` ; la recréer depuis `20260616090400` l'aurait rouverte. Les fonctions
`can_*` avaient été redéfinies en `20260616096000` avec la garde « base non supprimée » ;
les réécrire depuis `20260616094200` aurait rendu accessible une base mise à la corbeille.
**Toujours repartir de la dernière définition**, jamais de la première trouvée.

**Un défaut que seul le cloud pouvait révéler.** Supabase n'écrit pas `app_metadata` dans
la même instruction que l'insertion dans `auth.users` : `handle_new_user` ne voyait donc
pas le rôle et créait un profil `medecin`. **Le compte de mission naissait médecin**,
capable de créer ses propres bases — l'escalade même que le lot doit empêcher. Le shim de
test local écrit tout d'un coup : le défaut était structurellement invisible en local.
Correctif : `reconcile_mission_profile` (migration `20260729153000`), appelée par l'Edge
Function avant tout provisionnement, qui relit `app_metadata` côté serveur et refuse de
toucher un compte déjà établi.

Leçon : **une suite de tests verte ne remplace pas un passage sur un projet réel.** Ici,
841 tests passaient pendant que la propriété de sécurité centrale était fausse en
production.

### Vérification sur staging — 22/22, par le vrai chemin

`scripts/verify-mission-account.mjs` crée un compte via l'Edge Function déployée, appelée
avec le jeton d'un médecin, puis l'exerce **avec son propre jeton** — donc sous RLS réelle,
jamais en `service_role`. Vérifié : le rôle obtenu, l'idempotence d'un rejeu, la saisie sur
sa base, l'absence totale d'identité nominative, le cloisonnement inter-bases, le refus
d'export, de curation, de gestion d'accès et de création de base, et la révocation
immédiate malgré un jeton encore valide.

### Ce qui reste bloqué

**Constat historique au moment de cette section.** Une release coordonnée réussie était alors
absente et le site servait un build antérieur. Ce constat a été dépassé le 1er août 2026 : voir la
clôture L9 ajoutée à la fin de ce journal et
[`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md).

Cause : l'environnement GitHub `production` ne contient que **5 des 18 secrets** requis. Il
manque `CONTROLS_ADMIN_TOKEN`, `STORAGE_BACKUP_ENCRYPTION_KEY` (à générer, distincte de
staging), `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, plus les trois preuves de readiness que la dérogation pilote couvrira.
La dérogation mono-personne `CONTROLS_SOLO_MODE` **ne dispense pas** du jeton
d'administration : le script échoue avant.

Ces valeurs sont des identifiants : leur pose revient au porteur du projet.

L'environnement `production` n'accepte par ailleurs que la branche `main` : le SHA promu
doit y être fusionné avant toute tentative.

### État à la clôture de la session

`main` porte le lot (`f1211ab`). La production, elle, n'a pas bougé : deux verrous
tiennent, et aucun ne relève du code.

**Verrou 1 — les secrets.** L'environnement GitHub `production` n'a que 5 des 18 secrets
requis (liste ci-dessus). Ce sont des identifiants : leur pose revient au porteur.

**Verrou 2 — le scanner antivirus.** La dernière étape du déploiement, staging comme
production, exige un ClamAV joignable : elle lui fait scanner un fichier sain puis un EICAR
et vérifie les deux verdicts. Le scanner tourne bien sur le poste (conteneurs actifs, santé
`ok`, base de signatures à jour), mais il est exposé par un **tunnel `trycloudflare`
gratuit**, et celui-ci s'est révélé instable au-delà de ce que la documentation annonçait :
son nom de domaine a **cessé de résoudre en quelques minutes alors que le processus
`cloudflared` était toujours vivant**. Une URL fraîche, vérifiée joignable et posée dans le
secret, était déjà morte au passage suivant.

Conséquence : tant que le point d'entrée du scanner n'est pas stable, **aucune exécution
staging ne peut aboutir complètement**, donc la porte de production — qui exige un staging
vert sur le SHA exact promu — ne peut pas être franchie, secrets ou pas.

La correction durable est déjà écrite dans [`e2e-staging.md`](e2e-staging.md) : un tunnel
**nommé** (compte Cloudflare, nom de domaine stable) ou un petit VPS. Le tunnel éphémère
convient à une démonstration, pas à une chaîne de release.

**Ce qui est acquis malgré cela** : le backend de staging a bien reçu la migration et les
sept fonctions Edge, et la vérification de bout en bout y est passée **22/22** par le vrai
chemin. Le lot est donc vérifié sur un Supabase réel ; seule la publication reste bloquée.

**Prochain pas, une fois les deux verrous levés** : relancer un staging sur le SHA de `main`
— la porte de production compare le SHA exact, et `f1211ab` n'a pas encore le sien — puis
promouvoir avec ce `staging_run_id`.

## Lot L9 — Modèle d'observation d'une base (2026-08-01, validation locale)

Décisions métier : trois modèles — `cross_sectional`, `longitudinal` et
`event_registry` ; le choix est fait à la création, modifiable seulement tant que la
base ne contient aucune saisie. Les bases existantes restent `longitudinal`. Le mode
transversal ne crée pas de champ âge dédié : l'âge reste une variable de la base si
l'étude en a besoin.

La migration additive `20260801185149_observation_model_base.sql` ajoute la colonne
`base.observation_model` avec défaut longitudinal, une RPC atomique de création et une
RPC réservée au propriétaire pour changer le modèle d'une base vide. Les gardes SQL
empêchent les rencontres et soumissions de portée rencontre dans une base transversale,
y compris par import, URL directe ou RPC ; elles empêchent aussi un retour à une portée
rencontre dans son jeu de variables. Lors du passage au transversal, les variables du
jeu de variables deviennent des variables participant, sans toucher à des données.

L'interface propose le modèle à la création ; une base vide peut encore le changer.
Pour le transversal, « Nouveau patient » ouvre directement le formulaire unique
sectionné, la portée est masquée dans l'éditeur de variables et tous les accès visibles
à l'ajout de rencontre sont retirés.

Vérifications locales vertes : `npm run typecheck`, `npm run lint`, `npm run build`
avec `VITE_USE_SIGNED_READ=true`, `npm run schema`, `npm run manifest`,
`npm run db:verify` (112 migrations appliquées depuis zéro), les 39 tests ciblés L9 et
`npm run test:web` (46 fichiers, 274 tests). La suite RLS exhaustive a dépassé la
limite locale de 124 s sans résultat final ; la CI devra donc fournir cette preuve.
Le contrôle ACL distant requiert `SUPABASE_DB_URL` et reste à effectuer après le retour
du réseau, avant staging puis production.

### Clôture staging et production (2026-08-01)

La CI du correctif a été verte, puis le SHA `f0bf2af5910f5b4ebf985adf1724b9dcc69745ce`
a été validé par la release staging `30718950416`. La release coordonnée de production
`30720194028`, liée à cette même preuve staging, a réussi : sauvegarde chiffrée pré-release,
migrations, Storage, inventaire des fonctions Edge, déploiement frontend, activation stricte de
l'inspection et vérification cloud. Le scanner ClamAV utilise l'URL HTTPS terminée par `/scan` ;
son URL et son jeton ont été synchronisés vers les cibles staging et production avec
l'autorisation explicite du porteur.

Contrôle manuel sur l'application de production déployée, avec un compte médecin et des
données fictives : création de la base transverse « L9 contrôle transverse 2026-08-01 »,
sélection de « Une seule saisie par participant », et ouverture directe du formulaire
patient unique, sectionné, sans ajout de rencontre ni choix de portée. Une base longitudinale
antérieure « Urgences pédiatriques » reste opérationnelle : son patient existant conserve
l'action « Ajouter une rencontre », qui ouvre le parcours « Nouvelle rencontre ».

Cette preuve concerne la production technique du pilote et n'autorise ni usage clinique ni
données réelles.

## Remise en cohérence documentaire — 2026-08-01

La documentation vivante a été relue et mise à jour au-delà de L9 : README, architecture,
cahiers métier et technique, QA, checklists, E2E, feuille de route, lots et procédures de release.
Les rapports datés restent des archives de leurs candidats respectifs et renvoient désormais vers
[`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md), qui distingue la release technique
réussie des conditions encore requises pour toute donnée réelle.

## Chantier A — justificatifs des comptes de mission (clôture du 2026-08-11)

La décision produit est livrée : le seul propriétaire de la base choisit l'identifiant du compte
de mission ; le serveur génère un mot de passe robuste. Aucun e-mail n'est requis ou montré pour
ce rôle. Le mot de passe reste consultable par le propriétaire, masqué par défaut, mais n'est
conservé qu'en enveloppe AES-256-GCM côté serveur. La clé dédiée et les secrets d'administration
ne sont jamais envoyés au navigateur.

L'interface propose désormais un écran global `/missions`, également accessible depuis chaque
base, avec la base liée, le nom du compte, l'identifiant, le mot de passe masqué, l'échéance et les
actions révéler/copier, prolonger, régénérer et révoquer. La connexion accepte un identifiant de
mission ou l'e-mail d'un compte ordinaire. Les invitations, renvois et réinitialisations par
e-mail ont été retirés du parcours mission.

La migration additive `20260811120000_managed_mission_credentials.sql` porte l'unicité, le coffre,
l'idempotence et l'audit. La génération courante est vérifiée par RLS à chaque accès : une
régénération supprime les sessions Auth, invalide immédiatement les anciens jetons et remplace le
mot de passe sans changer l'identifiant. Les anciens comptes de mission fondés sur l'e-mail sont
bannis, leurs sessions sont supprimées et leur absence de justificatif géré les fait échouer
fermés. Les RPC de réservation et de finalisation restent réservées à `service_role` ; l'acteur
propriétaire est revérifié en base.

### Preuves locales et CI

- parcours réel local médecin → compte de mission dans deux profils, avec régénération pendant une
  session ouverte : ancien jeton et ancien mot de passe refusés, nouveau mot de passe accepté ;
- vérificateur Edge/Auth/RLS : **29/29** ; tests Edge : **100/100** ; tests web : **282/282** ;
- suites RLS/DB, ACL, typecheck, lint, build, dépendances, schéma, manifeste et actionlint : vertes ;
- aucune valeur de mot de passe retrouvée dans les tables en clair, l'audit, les logs Edge/Vite ou
  le stockage persistant du navigateur ;
- PR fonctionnelle `#133`, promotions `#134`, puis correctifs ACL hébergés `#135` à `#138`, tous
  fusionnés uniquement après `build-test` et `scanner-image` verts.

Deux staging ont révélé un faux positif du scanner ACL : sur Supabase hébergé, `service_role` peut
exécuter les fonctions internes sans qu'elles soient des endpoints Edge. Le contrôle final exige
positivement les onze RPC Edge inventoriées, leur exécution serveur et leur refus à
`anon`/`authenticated`, tout en conservant l'inventaire exhaustif des signatures authentifiées et
des `search_path`. Un troisième run a été annulé avant déploiement lorsque l'ancien tunnel ClamAV
a été confirmé injoignable malgré un processus local vivant. Aucun de ces runs n'a été utilisé
comme preuve de promotion.

### Promotion coordonnée

- SHA applicatif déployé : `bb99ac72ba46541904d255f7bf129ecd2ad3ca4e` ;
- staging réussi : `31475841694` — sauvegarde chiffrée, 113 migrations, Storage conforme,
  154 fonctions `SECURITY DEFINER` conformes, sept Edge Functions, justificatifs mission **29/29**,
  frontend, scanner strict et navigateur E2E ;
- production technique réussie : `31476792936`, liée au staging `31475841694` pour le même SHA ;
- le tunnel ClamAV a été renouvelé dans le conteneur
  `meddata-cloudflared-20260811-0938`, puis l'URL et le jeton effectif du scanner ont été
  synchronisés vers GitHub et Supabase sur staging et production, sans exposition de valeur ;
- la production confirme `require_server_inspection() = true`, 113 migrations, l'empreinte Storage
  attendue et l'inventaire distant exact des sept Edge Functions.

Cette clôture concerne la production technique et des données fictives. Elle ne vaut ni
autorisation juridique/éthique, ni autorisation d'usage clinique ou de données réelles. Le tunnel
`trycloudflare` reste temporaire : une terminaison stable demeure requise pour une exploitation
durable.

## Chantier D — un refus d'Edge Function redevient lisible (2026-08-11)

**Problème.** Quand une Edge Function refusait une demande, l'interface affichait
`Edge Function returned a non-2xx status code` — le message de *transport* de la bibliothèque
cliente — au lieu de la phrase courte que la fonction avait elle-même choisie. Un refus légitime
était donc indiscernable d'une panne ; ce défaut a coûté deux diagnostics complets pendant la
campagne de test manuel du 2026-08-09.

**Cause, désormais établie sur les deux chemins.** `functions.invoke` lève un `FunctionsHttpError`
dont le `.message` est toujours cette phrase ; le corps réel (`{ error, code, resource }`) est porté
par `error.context`, qui **est l'objet `Response`**. `src/data/exports.ts` ne le lisait pas ;
`src/data/mission.ts` croyait le lire mais interrogeait `context.body`, c'est-à-dire un
`ReadableStream`, et retombait donc systématiquement sur le message de transport. La lecture n'est
possible qu'en asynchrone.

**Correction — une fois, pas appelant par appelant.** `src/lib/edgeFunctionError.ts` lit le corps,
n'en retient que la phrase du serveur et son code technique, et compose « phrase (CODE) ». Le
message de transport ne sert qu'en dernier recours. Rien d'autre du corps n'est affiché : ni erreur
interne, ni objet — le `[object Object]` d'un lot antérieur devient structurellement impossible. Les
cinq appels frontend (`generate-export`, `create-mission-account`, `signed-read`, `inspect-upload`,
`finalize-upload`) passent par cet utilitaire ; `signed-read` cesse d'avaler son erreur et son motif
remonte jusqu'à la vignette. `cleanup-upload` et `reconcile-quarantine` ne sont pas appelées depuis
le navigateur et restent hors périmètre.

**Garde anti-récidive.** Un test d'inventaire échoue si un nouvel appel direct à `functions.invoke`
apparaît hors de l'utilitaire partagé, et vérifie que les deux dérogations inscrites sont encore
justifiées.

**Vérifications.** `npm run typecheck`, `npm run lint`, `npm run test:web` (51 fichiers, 309 tests)
et `npm run build` (avec `VITE_USE_SIGNED_READ=true`) verts. 26 tests nouveaux : contrat de
l'utilitaire, un test de refus par appelant, et le message rendu à l'écran pour `signed-read`.

**Refus réels provoqués sur la pile locale**, message lu dans l'application : `cohortId invalide`
(export), `Base invalide` puis `Cet identifiant est deja utilise` (comptes de mission),
`Inspection antivirus impossible : Acces refuse.` (inspect-upload), `Acces refuse` sous la vignette
(signed-read, chemin auparavant muet), `Objet Storage incoherent` (finalize-upload). Les deux
premiers sont exactement les incidents du 2026-08-09. Sur demande du porteur, la preuve est **locale
uniquement** ; aucun refus n'a été rejoué en production.

**Découverte d'environnement.** Sur la pile locale, `service_role` n'a aucun privilège DML sur les
tables de `public`, là où un projet hébergé les accorde par défaut : toute Edge Function lisant une
table côté serveur échoue localement par un refus trompeur. Consigné comme sixième piège de poste
dans `docs/chantiers-interactions-comptes.md` §5.5.

**Déploiement.** Aucun. Sur instruction du porteur, la release coordonnée n'a pas été lancée : le
correctif s'arrête à la fusion, qui ne déploie rien (`vercel.json` porte `git.deploymentEnabled:
false`). La mise en production reste à faire par le workflow **Coordinated release**, staging puis
production pour le même commit.

## Chantiers B/C — identité complète du compte de mission (clôture du 2026-08-11)

Le renversement décidé par le porteur le 2026-08-10 est livré. Il s'agit d'un **retournement
délibéré**, et non d'une régression : lorsqu'un médecin accorde l'option identité à une mission,
le saisisseur peut créer un patient avec le nom complet, la date de naissance, le téléphone,
l'adresse et l'identifiant externe. Sans cette option, la zone reste masquée et la base refuse les
valeurs nominatives. La branche médecin de `can_write_identity()` n'a pas été relâchée.

La migration additive `20260811130000_mission_identity_write_correction.sql` ajoute la branche
saisisseur hors de `is_medecin()` et la RPC `update_patient_identity`. Cette RPC vérifie côté
serveur l'accès, le rôle, l'auteur, le statut `draft` et la version ; elle exige un motif, journalise
les champs et versions sans conserver les anciennes ou nouvelles valeurs nominatives, et laisse
les écritures directes fermées. Les pièces jointes restent réservées aux médecins malgré
l'élargissement de `can_write_identity`.

L'interface masque ou montre toute la zone identité selon l'option, distingue la correction
d'identité de l'édition analytique, réserve la correction du saisisseur à son propre brouillon,
pilote « Nouveau patient » par la création, réserve la suppression à l'édition, borne le mode
hors-ligne des accès à échéance et réduit la barre latérale du rôle `saisisseur`. Le défaut
« Modèle : — » est resté hors périmètre comme décidé.

### Preuves locales

- `npm run typecheck`, `npm run lint` et build de production avec lecture signée : verts ;
- `npm run test:web` : **318/318** ; `npm run test:rls` : **601/601** ;
- `npm run db:verify` : **114 migrations** applicables depuis zéro ; snapshot de schéma et
  manifeste à jour ;
- `npm run db:function-acl:verify` : **155 fonctions `SECURITY DEFINER` conformes** ; sept Edge
  Functions inventoriées ;
- parcours réel sur Supabase local : **37/37** — création et activation de la mission, patient avec
  les cinq champs d'identité, correction des cinq champs sur son brouillon, vérification directe en
  base, refus du saisisseur après soumission, correction du même patient par le médecin ;
- nettoyage vérifié : aucune base QA active et aucune mission QA active restantes.

### Git, CI et release coordonnée

- commit fonctionnel `dc90392` ; PR `#145` vers `develop`, CI `31489555015` verte ; PR `#146`
  vers `main`, CI `31489777013` et `31489806008` vertes ; CI du merge `main` `31490024107` verte ;
- le premier staging `31490265593` a été bloqué dans `validate`, avant tout déploiement, parce que
  le snapshot de schéma versionné s'arrêtait à la migration précédente ;
- correction ciblée `10c1473` ; PR `#147` vers `develop`, CI `31490622129` verte ; PR `#148` vers
  `main`, CI `31490839240` et `31490860582` vertes ; CI du merge `main` `31491126538` verte ;
- SHA applicatif finalement promu : `fae091a3f2a9b6537be53573923986daec563325` ;
- staging réussi : `31491345747` — validation, sauvegarde chiffrée, migrations, Storage, ACL,
  Edge Functions, dérive, vérificateur mission, frontend et E2E navigateur verts ;
- production technique réussie : `31492429206`, liée au staging `31491345747` pour le **même SHA**
  et passée par les preuves de gouvernance, restauration et responsabilités opérationnelles avant
  la sauvegarde et la promotion.

Cette clôture prouve la production technique avec données fictives ; elle ne vaut pas autorisation
d'utiliser des données réelles ni autorisation clinique. L'élargissement de ce qu'un compte de
mission peut connaître doit encore être répercuté dans le registre des traitements
(`docs/juridique/`, volet Tchad) et dans la charte utilisateurs.

## Motif de l'identifiant de mission — validation navigateur rétablie (2026-08-11)

**Constat.** Le champ « Identifiant de connexion » de l'écran *Comptes de mission* portait
`pattern="[A-Za-z0-9](?:[A-Za-z0-9.-]{1,46}[A-Za-z0-9])?"`. Les navigateurs compilent l'attribut
`pattern` avec le drapeau `v`, dans lequel `.-` en classe de caractères est invalide. L'expression
ne compilant pas, la spécification impose d'**ignorer entièrement l'attribut** : le champ n'était
donc plus validé côté navigateur, sans le moindre signe visible hormis une ligne dans la console.

**Conséquence.** Un identifiant non conforme partait jusqu'au serveur, y était refusé par
`IDENTIFIER_RE` (`create-mission-account/handler.ts`) sous la forme d'une `RequestValidationError`,
rendue par `validationResponse`. Or cette réponse ne portait pas d'en-têtes CORS avant la
correction serveur `fix: expose Edge validation errors to browsers` : le navigateur bloquait alors
la lecture du corps et la bibliothèque levait un `FunctionsFetchError` **sans corps du tout**. Ni
l'utilisateur ni l'utilitaire du chantier D ne pouvaient voir le motif — le refus se présentait
comme une panne. Les trois défauts se composaient ; c'est la piste à garder en tête pour le
diagnostic des créations de comptes de mission observé en test.

**Correction.** Le tiret est échappé (`[A-Za-z0-9.\-]`), forme qui compile sous `v`, sous `u` et
sans drapeau, et qui laisse la règle inchangée — identique à celle du serveur, la saisie étant déjà
mise en minuscules. Aucune modification du contrat serveur.

**Vérifications.** `npm run typecheck`, `npm run lint` et `npm run test:web` (51 fichiers,
320 tests) verts. Deux gardes ajoutées dans `src/screens/member/MissionAccounts.test.tsx` : le motif
rendu doit compiler sous le drapeau `v` et appliquer la règle attendue, et **aucun autre**
`pattern` du frontend ne doit casser silencieusement. Les deux échouent bien sur l'ancienne
écriture — vérifié en la rétablissant temporairement.

**Déploiement.** Aucun de mon fait : la mise en ligne reste à déclencher par le porteur, en même
temps que la correction CORS, pour rendre enfin lisible le refus réel.

## L4 — soupape pour un diagnostic absent du référentiel (2026-08-13)

Une variable de type `terminology` peut désormais activer, **à sa création**, la même soupape que
les listes contrôlées. Elle crée atomiquement un champ texte compagnon `<cle>_autre`, jamais
obligatoire, et fonctionne pour les variables de rencontre comme pour les données permanentes du
patient. Les variables existantes ne sont pas modifiées.

Lorsque le saisisseur ne trouve pas un diagnostic, il choisit « Diagnostic absent du référentiel »
et décrit le terme recherché dans ce compagnon. La clé du diagnostic est alors **retirée** du
payload — elle n'est même pas envoyée avec `null` — afin que seul un couple `{code,label}` choisi
dans le référentiel puisse occuper la colonne analysable. La sélection ultérieure d'un vrai
diagnostic retire réciproquement la proposition. Le même comportement est porté par les parcours
de création, correction et curation ; la soupape préexistante des listes reste limitée aux
rencontres.

### Preuves locales

- tests ciblés : **51/51** ; tests web complets : **330/330** ; `npm run typecheck` et
  `npm run lint` verts ;
- build de production vert avec `VITE_USE_SIGNED_READ=true` ;
- `npm test` global n'a pas terminé avant la limite locale de cinq minutes et n'est donc pas
  compté comme preuve ; aucune fusion ne sera faite tant que la CI distante n'est pas verte.

La preuve de staging, de production et l'essai sur l'application déployée seront ajoutés ici après
le workflow manuel **Coordinated release** pour le même SHA.

## Cohortes D6/D8 — effectif vivant, figeage explicite et avertissement d'export (clôture 2026-08-13)

Le défaut signalé le 2026-08-09 est clos : une cohorte à mise à jour automatique n'est plus une
carte vide. `listCohorts` remonte désormais son filtre enregistré et son choix
`validated_only`; la carte calcule alors l'effectif courant par `cohort_preview`, sans tenter de
matérialiser des membres qui n'existent pas pour ce type de cohorte.

**D6.** Chaque carte dynamique montre les patients et rencontres actuellement éligibles, explique
qu'elle doit être figée avant export, et propose **Figer maintenant**. L'action reprend exactement
le filtre et le choix de validation de la carte pour créer une cohorte figée, avec un nom
prérempli et modifiable. Le refus d'exporter une cohorte dynamique reste volontairement inchangé :
un export reste attaché à une population reproductible et à ses décomptes figés.

**D8.** Quand le figeage inclut des brouillons, le dialogue prévient désormais : « Cette cohorte
contient N fiches non validées et ne sera pas exportable en l'état. » Le choix reste non bloquant,
comme décidé : l'utilisateur peut créer la cohorte figée puis corriger ou valider les fiches avant
l'export, sans que l'UI ne masque l'incompatibilité avec la règle serveur.

### Vérifications

- aucun schéma, migration, RPC, RLS, Storage ou Edge Function n'a été modifié ;
- tests ciblés `CohortBuilder` : **5/5** ; `npm run typecheck`, lint ciblé et build de production
  avec `VITE_USE_SIGNED_READ=true` verts ;
- PR fonctionnelle `#159` vers `develop`, puis `#160` vers `main` ; le correctif E2E qui avait
  différé la release a été intégré avant la promotion ;
- SHA finalement promu : `be948689a4ab10b056e5d26d2262911059ce4307` ; staging
  `31659772160` puis production `31687476980` réussis pour ce même SHA, avec validation,
  sauvegarde, promotion backend/frontend et contrôles cloud du workflow ;
- essai navigateur en production technique, après actualisation du bundle : création d'une
  cohorte dynamique explicitement nommée pour la vérification sur données fictives ; sa carte
  affiche **1 patient, 0 rencontre**, le message d'absence d'export et **Figer maintenant**. Le
  dialogue de figeage s'ouvre avec le nom prérempli ; aucun figement supplémentaire n'a été
  confirmé pendant cet essai ;
- le cas D8 a aussi été contrôlé sur une cohorte dynamique incluant un brouillon : l'avertissement
  indique **1 fiche non validée** et le bouton « Créer la cohorte figée » reste actif. Le dialogue
  a été annulé, afin de ne pas laisser une cohorte volontairement non exportable.

Cette clôture prouve une production technique avec données fictives. Elle ne vaut ni autorisation
clinique, ni autorisation d'utiliser des données réelles.

## L4 — soupape pour un diagnostic absent du référentiel — clôture (2026-08-13)

Le lot L4 est livré pour les **nouvelles** variables `terminology`, de rencontre ou permanentes.
L'activation crée un champ texte compagnon `<cle>_autre`, non obligatoire. Une proposition retire
la clé du diagnostic du payload (elle n'est pas écrite, même à `null`) et ne conserve le texte que
dans le compagnon ; choisir ensuite un diagnostic du référentiel retire la proposition.

### Preuves

- commit fonctionnel `e74269b` ; PR `#169` vers `develop`, puis PR `#170` vers `main` ; les
  contrôles obligatoires `build-test` et `scanner-image` sont verts pour les deux promotions ;
- SHA applicatif promu par le workflow : `2a2b4f1e185faf4c12f4e38beb1d2db7028fcbdc` ; staging
  [`31699252690`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/31699252690)
  vert (validation complète, backend, frontend et E2E navigateur) ; production
  [`31702390264`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/31702390264)
  verte, explicitement liée à ce staging et contrôlant ce même SHA avant la promotion ;
- essai manuel sur `gestion-de-donn-es-m-dicales.vercel.app`, avec données fictives : création de
  `diagnostic_absent_test_14` en `terminology` permanent, avec compagnon
  `diagnostic_absent_test_14_autre` ; saisie de « Diagnostic fictif L14 » dans l'option
  « Diagnostic absent du référentiel » ; après enregistrement et réouverture, le diagnostic
  contrôlé reste vide et seule la « valeur proposée » contient ce texte.

Le mode d'inspection des fichiers de cette release était volontairement `paused` : cette preuve
concerne exclusivement les données fictives et le parcours sans fichier. Elle ne vaut ni
autorisation clinique, ni autorisation d'utiliser des données réelles.

## 2026-08-13 — Idée 11 : suppression réelle d'une cohorte, preuve d'export conservée

Décision du porteur : aucune corbeille de cohortes. Une cohorte peut être supprimée de la liste et
de la base, même si elle a déjà été exportée. La migration
`20260813150000_delete_cohort_preserve_export_evidence.sql` rend le journal autonome : chaque
`export_log` conserve le `base_id` et le nom de cohorte historiques ; la référence à `cohort` passe
à `ON DELETE SET NULL`. Les fichiers déjà produits dans `scientific-exports` restent immuables et
accessibles par lecture signée aux utilisateurs autorisés de cette base.

La RPC `delete_cohort` verrouille la cohorte, vérifie `can_curate`, supprime dans une transaction,
et inscrit `cohort_deleted` avec le nombre d'exports préservés. Le DELETE direct RLS de `cohort` est
fermé. Le frontend propose une confirmation explicite et explique que les exports et leur preuve
restent conservés.

Preuve locale : le test base crée une cohorte figée et un `export_log`, appelle la RPC sous un
compte curateur, puis vérifie l'absence de cohorte et de membres, avec journal intact (`cohort_id`
nul, `base_id`, nom, chemin Storage et empreinte conservés) et trace d'audit présente. Tests ciblés
verts : `test/cohorts.test.ts`, `test/exports.test.ts`, `test/audit.test.ts` (**22/22**),
`CohortBuilder.test.tsx` (**6/6**) et `signed-read` Edge (**14/14**), plus `typecheck`, lint,
`db:verify` et build avec `VITE_USE_SIGNED_READ=true`.

Livraison : le snapshot de schéma a été régénéré ; le commit
`3092302402dce580706c9c0ca6d138e845f8177b` a été promu par le workflow **Coordinated release** :
staging [`31709473891`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/31709473891)
puis production [`31711004972`](https://github.com/Allmight2002/Gestion-de-donn-es-m-dicales/actions/runs/31711004972)
verts, avec sauvegarde chiffrée, backend, frontend, E2E navigateur et contrôle de dérive cloud.

Cette clôture prouve une production technique avec données fictives. Elle ne vaut ni autorisation
clinique, ni autorisation d'utiliser des données réelles.

## L12 — propositions hors liste à l'échelle d'une base (clôture 2026-08-13)

Le médecin responsable dispose désormais, dans **À compléter > Propositions**, d'une vue en
lecture seule des valeurs non vides saisies dans les champs compagnons `<clé>_autre`. La vue
regroupe les occurrences par variable, conserve les doublons demandés et ouvre directement la
fiche patient ou la rencontre correspondante. Elle ne propose ni promotion dans le référentiel,
ni statut « traité » : l'évolution de la liste reste du ressort de l'éditeur de variables.

La RPC paginée `base_proposals` rapproche chaque compagnon de sa variable source contrôlée
(`select`, `multiselect` ou `terminology`) dans la version historique du modèle utilisée par la
fiche. Elle ignore les valeurs vides, les fiches supprimées et les clés `_autre` arbitraires. Elle
est `SECURITY INVOKER`, accordée au seul rôle authentifié, et refuse explicitement tout appel qui
ne vient pas du propriétaire médecin de la base. La migration est additive ; aucune donnée
clinique ni interface existante n'est réécrite.

### Preuves de validation et de livraison

- tests web L12 ciblés : **18/18** ; tests PostgreSQL L12 : **4/4** ; `typecheck`, lint,
  `audit:dependencies -- --scope=staging`, `db:verify`, `release:edge:check`, contrôles Edge,
  suite `npm test` et build de production verts ; le build produit le chunk dédié
  `BaseProposals` et le manifeste de déploiement attendu ;
- PR fonctionnelle `#172` puis synchronisation du schéma `#174` vers `develop`, toutes deux avec
  CI verte ; promotion `develop` vers `main` par la PR `#175`, CI de PR `31702615803` et CI du
  merge `main` `31702862708` vertes ;
- SHA applicatif promu : `03c0a1c68e30f4a741c3ad281b501827a6dce7d8` ; staging manuel
  **Coordinated release** `31703117067` réussi, puis production `31706350267` réussie avec ce même
  SHA et l'identifiant du run staging ; le checkout, la preuve staging immuable, la sauvegarde
  chiffrée préalable, la promotion backend/frontend et le contrôle cloud sont verts ;
- vérification dans Chrome sur l'application de production, après activation du nouveau bundle :
  la base fictive **Urgences pédiatriques** affiche **1 proposition** regroupée sous
  **Diagnostic absent test 14**, valeur fictive **Diagnostic fictif L14**, fiche `P-0003` ;
  **Ouvrir la fiche** mène bien à la fiche correspondante, où le champ compagnon porte cette
  valeur. L'onglet a été laissé ouvert sur la liste des propositions déployée.

Cette clôture prouve le fonctionnement en production technique avec des données fictives. Elle ne
vaut ni autorisation clinique, ni autorisation d'utiliser des données réelles.

## L11 — observabilité des erreurs (implémentation locale 2026-08-13)

Le navigateur capte les plantages React, les erreurs globales et les promesses rejetées. Pour
préserver la confidentialité, il ne transmet jamais de message d'erreur brut : le journal conserve
un nom technique borné, un résumé fixe et des emplacements de pile expurgés. La base réapplique
cette réduction, impose une liste blanche de contextes, limite le débit à dix occurrences par
minute et par compte, puis regroupe les doublons. La lecture passe exclusivement par une RPC
réservée à `system_admin`; l'écran **État du système** n'offre aucun export.

Preuves locales : typecheck, lint, build, `npm run schema`, `npm run manifest`, le test RLS ciblé
et le test web de l'ErrorBoundary sont verts. Le test RLS vérifie qu'un e-mail, un numéro long, un
jeton et un paramètre d'URL synthétiques n'apparaissent pas dans l'enregistrement stocké. La purge
à 30 jours est prévue par RPC de service; son ordonnanceur et l'alerte distante restent à la
frontière B5. Les preuves staging et production seront ajoutées après la release coordonnée.
## L27 — Texte d'aide par variable (2026-08-13)

Une consigne de saisie nullable est ajoutée à `template_field`, sans valeur par défaut ni réécriture des variables existantes. Le constructeur l'enregistre et la laisse modifiable après première saisie, comme le libellé ; le formulaire la présente à la demande par une aide clavier et lecteur d'écran. L'export XLSX ajoute `description` à la feuille **Dictionnaire**.

Validation locale : tests web ciblés (11), RLS ciblé (40), tests Edge (102), `db:verify`, `typecheck`, `lint`, `edge:check` et build avec `VITE_USE_SIGNED_READ=true` verts. Publication et preuve staging/production du même SHA restent à consigner.

## L28 — Valeur proposée à la saisie (2026-08-14)

Une variable peut désormais porter une **valeur proposée** à la création d'une fiche : une date de
consultation proposée à aujourd'hui, un pays proposé à Tchad. La proposition décrit la **saisie**,
jamais la donnée — c'est la propriété centrale du lot, et elle est vérifiée côté base sur les deux
voies d'écriture : une fiche enregistrée sans la clé reste sans la clé, et une proposition effacée
par la personne qui saisit ne laisse aucune trace. Le serveur n'écrit cette valeur nulle part de
lui-même.

La colonne `default_value` est nullable et sans valeur par défaut : aucune variable existante n'est
réécrite. La proposition est validée au moment où la variable est enregistrée — type, bornes, liste
de valeurs — par un déclencheur et non par la seule RPC, parce que le constructeur écrit en direct
dans `template_field`. Deux jetons dynamiques, `__today__` et `__now__`, sont résolus **à la saisie**
en heure locale : une date figée dans le gabarit vieillirait. Aucune proposition n'est acceptée sur
`multiselect` ni sur `terminology`.

Le constructeur **avertit sans interdire** quand la proposition risque d'orienter la réponse : soit
l'intitulé désigne un jugement clinique (complication, issue, décès, évolution…), soit la forme
oui/non ou liste fait de la proposition la réponse tant que personne ne la change. La décision reste
au médecin, qui connaît sa variable. Le préremplissage n'a lieu qu'à la **création**, jamais à la
correction d'une fiche, jamais à l'import, et jamais par-dessus un brouillon restauré ; la mention
« proposé » disparaît dès qu'on touche au champ.

### `is_unique` écartée

La seconde moitié prévue du lot n'est pas livrée, sur décision du porteur du besoin : le registre ne
manipule aucun identifiant externe saisi à la main. Le seul identifiant en circulation est le code
patient, généré par le produit et déjà protégé par `uq_patient_base_code` et `uq_identity_base_code`.
Une contrainte d'unicité paramétrable n'aurait donc eu aucune variable à protéger. Le risque réel du
registre est le doublon de **personne**, que la détection nom + date de naissance traite déjà et
qu'une contrainte d'unicité ne traite pas. À rouvrir seulement si un numéro de cahier de consultation
ou un code d'inclusion saisi à la main entre dans le recueil. La preuve de concurrence exigée par la
commande initiale devient sans objet ; la preuve produite à la place est celle de la non-réécriture
serveur, décrite ci-dessus.

### Défaut réparé au passage

La liste des colonnes recopiées d'une version de gabarit à l'autre était **dupliquée dans six
fonctions**. La consigne de saisie ajoutée par L27 n'y avait pas été reportée : dupliquer un gabarit
ou en créer la version suivante perdait silencieusement toutes les consignes, et
`promote_template_to_global` perdait en plus les types de rencontre. Cette liste vit désormais dans
`copy_template_fields`, appelée par les six fonctions.

### Preuves de validation

Le déploiement ne suit pas la fusion — `vercel.json` porte `git.deploymentEnabled: false` — il a
donc fallu les deux runs manuels, le second recevant l'identifiant du premier.

- validation locale : `db:verify` (122 migrations appliquées depuis zéro), `test:rls` **641/641**
  (63 fichiers), `test:web` **366/366** (56 fichiers), `typecheck`, `lint`, `npm run schema` et build
  de production avec `VITE_USE_SIGNED_READ=true` — tous verts ; tests dédiés au lot : 15 en base,
  11 sur le domaine, 5 sur le constructeur, 4 sur la saisie de rencontre, 2 sur la saisie patient ;
- PR fonctionnelle `#199` vers `develop`, CI `31814837312` verte ; promotion `develop` vers `main`
  par la PR `#200`, CI `31815378593` verte, puis CI du merge `main` `31815689454` verte ;
- SHA applicatif promu : `a169377ab04a328270be73ada9ab9c4f8269cafd` ; staging manuel **Coordinated
  release** `31815747009` réussi (validation, backend, frontend et parcours navigateur), puis
  production `31819047497` réussie avec ce même SHA et l'identifiant du run staging ; le contrôle
  cloud final rapporte **122 migrations distantes** conformes
  (`sha256=d6b2471613009c805448f7b3fc5516424e64af000ed6a0a5dc1a014f40b940c7`) et les sept Edge
  Functions attendues ;
- application déployée vérifiée sans authentification : le bundle servi en production contient les
  nouveaux libellés (« Valeur proposée », mention « proposé »), preuve que le frontend promu est
  bien celui de ce lot. La vérification **dans** l'application, qui demande une connexion, reste à
  la charge du porteur.

Comme les précédentes, cette clôture prouve le fonctionnement en production technique avec des
données fictives. Elle ne vaut ni autorisation clinique, ni autorisation d'utiliser des données
réelles. La dérogation d'inspection antivirus reste en vigueur pour cette release.

## L33 — Raisons de valeur manquante par variable (2026-08-14)

Les trois codes `non_fait`, `inconnu` et `non_applicable` étaient **figés en dur** dans
`assert_data_valid`, identiques pour toutes les variables, et le seul réglage était un booléen
les autorisant ou les refusant en bloc. Une variable choisit désormais **les raisons qu'elle
propose**, parmi cinq : les trois précédentes, plus le **refus** de la personne et **non
documenté** — distinct d'« inconnu », qui laisse croire que l'information a été cherchée.

**Les trois codes existants ne changent ni de nom ni de sens.** La reprise de données donne
exactement les trois codes historiques aux variables qui les acceptaient, et aucune raison à
celles qui les refusaient : aucune variable existante ne change de comportement, et aucune fiche
déjà saisie ne devient invalide.

### `allow_missing_codes` conservé, en miroir

`missing_reasons` devient la source de vérité ; le booléen n'est plus une seconde décision mais
son **reflet**, tenu à jour par un déclencheur (vrai = liste non vide). Il n'est pas supprimé
parce qu'il est **déjà recopié sur des appareils hors de portée** : `download_base_snapshot`
l'écrit dans l'instantané hors-ligne stocké sur le téléphone, une PWA installée garde son ancien
JavaScript jusqu'au prochain rafraîchissement, et `src/data/offline.ts` retombe sur `?? true`
quand la clé manque. Le retirer aurait fait basculer un appareil non rafraîchi vers « valeurs
manquantes autorisées partout », y compris sur les variables où elles sont interdites — sans
aucune erreur visible. L'instantané émet désormais **les deux**, et l'ancienne signature de
`update_template_field` reste en place : la transition n'a pas de fenêtre de bascule.

### Retirer une raison d'une variable en service : refusé

Ajouter reste libre à tout moment — élargir ce qui est acceptable ne peut invalider aucune fiche,
et c'est un assouplissement par rapport à l'état antérieur, où toute modification du booléen était
refusée sur une variable utilisée. Retirer est refusé tant que la variable porte des données.
La conséquence est celle qui était recherchée : **aucune fiche ne peut porter une raison absente
de la liste de sa propre version de gabarit**, donc une fiche ancienne reste modifiable *par
construction*, sans cas particulier dans la validation, qui reste sans état. Pour restreindre, on
crée une nouvelle version du gabarit ; les fiches existantes restent rattachées à l'ancienne.

Ce refus vit dans le déclencheur de la migration et non dans `guard_template_field_update`, pour
une raison d'**ordre d'exécution** : deux déclencheurs `BEFORE UPDATE` sur la même table
s'exécutent par ordre alphabétique de nom, et un garde placé ailleurs verrait, selon l'ordre, un
`missing_reasons` non encore réconcilié — donc un retrait invisible venant d'un client qui n'envoie
que le booléen. Le contrôle est placé là où la réconciliation a lieu ; il est alors juste quel que
soit l'ordre.

### Une seule liste, vérifiée par un test

`MISSING_CODES` n'est plus recopié : `src/domain/validation.ts` **importe** la liste du contrat
d'export, via `src/domain/export.ts` qui l'exposait déjà au navigateur. Le test correspondant
vérifie l'**identité de référence** (`toBe`) et non l'égalité de contenu : il échouerait si
quelqu'un redupliquait la liste, ce qui est précisément le risque à couvrir — une raison
saisissable mais inconnue de l'export produirait une colonne que personne ne sait relire.

L'export rend les nouveaux codes **tels quels** dans la colonne, et le dictionnaire gagne une
colonne `missing_reasons`. Quand une colonne traverse plusieurs versions dont les listes diffèrent,
le dictionnaire documente leur **union** : sinon un code lu en face d'une fiche ancienne resterait
inexpliqué.

### Interface

`ValueInput.tsx` ne propose que les raisons de la variable en cours, et **conserve la raison déjà
enregistrée** même si la variable ne la propose plus — sans quoi le sélecteur s'ouvrirait vide et
la fiche deviendrait illisible, puis inmodifiable au premier enregistrement. `FieldForm.tsx` garde
sa case maîtresse, décochée par défaut : une variable neuve n'accepte toujours aucune valeur
manquante tant que rien n'est demandé. Cochée, elle pré-coche les trois raisons historiques, puis
laisse choisir. Sur une variable déjà utilisée, les raisons en service sont grisées et les autres
restent cochables — l'interface reflète la règle serveur au lieu de laisser tenter un retrait qui
finirait en erreur. Le libellé de la case, « Codes manquants (non fait / inconnu) », nommait deux
raisons sur cinq : il devient « Accepter une valeur manquante ».

### Preuves de validation

- validation locale : `typecheck`, `lint`, `test:web` **377/377** (57 fichiers), `edge:test`
  **102**, `edge:check`, `edge:lint`, `release:edge:check`, `db:verify` (**123 migrations
  appliquées depuis zéro**), `npm run schema` et build de production avec
  `VITE_USE_SIGNED_READ=true` — tous verts ; tests dédiés au lot : **17 en base**, 5 sur le
  domaine, 5 sur le contrat d'export, 5 sur la saisie, 4 sur le constructeur ;
- `test:rls` compte **668 tests sur 64 fichiers**, tous verts, mais **aucune exécution locale
  unique ne les a portés ensemble** : la première a buté sur le compte figé de la liste blanche
  des fonctions privilégiées — c'est le garde-fou prévu, la nouvelle signature de
  `update_template_field` devant être inventoriée —, et la seconde, lancée après correction, a
  perdu `test/mission-credentials.test.ts` dont le PostgreSQL embarqué s'est arrêté sous la
  contention de trois instances simultanées. Ce fichier repasse **9/9** seul, et il ne touche
  ni `template_field` ni les valeurs manquantes. La preuve d'ensemble est donc la CI, verte ;
- PR fonctionnelle `#201` vers `develop`, CI `31826895445` verte ; promotion `develop` vers
  `main` par la PR `#202`, CI `31827351462` verte, puis CI du merge `main` `31827836723` verte ;
- SHA applicatif promu : `3a145c7e66416fd2899b615d9491fbf78307c5a0` ;
- release coordonnée du **même SHA**, en mode `inspection=paused` et sur données fictives :
  staging `31828221111` (validate, backend, frontend et parcours navigateur verts), puis
  production `31831096560` en lui donnant l'identifiant du run staging. Les deux réussis.
  La migration est donc appliquée sur la base cloud de production.

Cette branche a aussi porté deux commits de documentation de **L28** (`5e9b542`, `c5effe1`) : son
rapport était resté non committé dans la copie de travail, avec une section de preuves vide alors
que le lot était déjà déployé.

## L32 — Affichage conditionnel (2026-08-15)

Le moteur de règles savait rendre une variable **obligatoire** sous condition, comparer deux
variables et distinguer blocage et avertissement. Il ne savait pas **montrer ou masquer**. Une
troisième forme de règle s'ajoute aux deux existantes, dans la **même structure JSON à liste
blanche d'opérateurs**, jamais évaluée comme du code :

```json
{ "if":   { "field": "imagerie_faite", "operator": "equals", "value": true },
  "then": { "field": "imagerie_type",  "operator": "visible" } }
```

`then.operator` n'accepte désormais que deux verbes, et toujours aucun autre : `required`
(l'existant) et `visible` (ce lot).

### La décision bloquante : la valeur d'un champ masqué est effacée, jamais en silence

C'est le piège classique des systèmes de recueil clinique, et il ne se rattrape pas après coup.
**Conserver** la valeur ferait raconter deux histoires différentes au formulaire et à l'export :
une colonne pourrait porter une valeur que le médecin croit avoir retirée, et une analyse la
compterait. L'incohérence serait silencieuse, donc plus dangereuse que la perte de saisie.

La valeur est donc **effacée**, mais l'action est annoncée avant d'être produite. La variable
disparaît de l'écran dès que la condition bascule ; la valeur, elle, n'est retirée qu'à
**l'enregistrement**, après un bandeau qui nomme le nombre de valeurs concernées et les variables
en cause (« 2 valeur(s) déjà saisie(s) seront retirées à l'enregistrement… »). Abandonner la saisie
avant d'enregistrer ne perd donc rien. Une valeur manquante codifiée (« refus ») compte comme une
saisie délibérée et se voit annoncée comme les autres ; une case restée vide n'est pas annoncée,
puisqu'il n'y a rien à retirer.

### Une condition non vérifiable vaut « masqué »

Lecture stricte de « ne montrer les variables d'imagerie que si une imagerie a été faite » : sur
une fiche vierge, les variables conditionnelles n'apparaissent pas, et surgissent quand la
condition devient vraie. Trois propriétés complètent la règle, identiques côté navigateur et côté
base :

- plusieurs règles portant sur une même variable se cumulent en **ET** — une seule non satisfaite
  masque ;
- une variable pilote elle-même masquée est lue comme **absente**, d'où un **point fixe** : masquer
  une variable masque en cascade celles qu'elle commande. Sans cela, une variable de second rang
  réapparaîtrait toute seule parce que sa pilote garde une valeur qu'on est justement en train de
  retirer ;
- l'ensemble des variables masquées ne fait que grandir à chaque passe, et le nombre de passes est
  borné par le nombre de règles : l'évaluation se termine même face à un gabarit incohérent.

### Visibilité d'abord, obligation ensuite — imposé par la base

Un champ masqué ne peut pas être obligatoire, sinon une fiche devient **impossible à valider pour
un champ que personne ne voit**. L'ordre est imposé là où il ne peut pas être contourné :
`assert_required_complete` et `assert_validation_rules` **gardent leur signature** et écartent les
champs masqués. Leurs appelants — saisie directe, curation, import, déclencheur de finalisation —
en héritent sans qu'une seule ligne change chez eux. Une règle « obligatoire sous condition » qui
vise une variable masquée devient inapplicable, comme une comparaison dont un opérande manque ; et
une règle d'affichage ne se « viole » pas : elle dit ce qu'on montre, elle n'exige rien.

Le filet complémentaire est `assert_no_hidden_values`, appelé à la **finalisation** : une fiche
`curated` portant encore la valeur d'un champ masqué est refusée. Ce contrôle ne remplace pas
l'effacement produit par l'interface, il attrape ce qui a contourné le formulaire — appel API
direct, instantané hors-ligne périmé. Il refuse au lieu d'effacer, pour ne pas réintroduire par la
porte de derrière l'effacement silencieux que la décision écarte. Le message nomme le **libellé**
de la variable et jamais son contenu, qui est une donnée de dossier.

### Cycles refusés à l'enregistrement de la règle

« A masqué par B, B masqué par A » rend les deux variables définitivement invisibles : aucune ne
peut être renseignée, donc aucune ne peut satisfaire la condition de l'autre. Le graphe de
dépendances est validé **quand la règle est écrite** — `assert_visibility_acyclic`, en remontant
les dépendances depuis la variable pilote pour voir si l'on retombe sur la variable pilotée, les
cycles indirects compris. Une fiche n'a jamais à se défendre contre un gabarit incohérent. Le
constructeur refuse le même cycle avant l'envoi, en nommant les variables fautives ; la base reste
seule juge.

Deux autres refus structurels accompagnent celui-là : une variable ne peut pas commander son propre
affichage, et les deux variables d'une règle d'affichage doivent appartenir à la **même fiche**
(patient ou visite) — une condition portée par l'autre fiche n'est jamais vérifiable, donc
masquerait la variable pour toujours sans que personne comprenne pourquoi.

### L'export n'a aucune règle à évaluer, et c'est voulu

`guard_validation_rule_inuse` interdit déjà d'ajouter une règle à une version de gabarit qui porte
des données. Une règle d'affichage **ne peut donc pas masquer rétroactivement des fiches déjà
saisies** : il faut une nouvelle version, et les anciennes fiches gardent la leur. Comme l'export
ne lit que des fiches `curated`, et qu'une fiche `curated` ne peut pas porter la valeur d'un champ
masqué, une variable masquée arrive simplement **absente des données**.

La colonne reste donc **présente** — d'autres fiches montrent la variable, et une forme de fichier
qui change d'un export à l'autre casserait le script d'analyse — et la cellule est **vide**. Elle
n'emprunte pas le vocabulaire des raisons de valeur manquante, qui décrivent une saisie délibérée.
Une troisième réimplémentation de l'évaluation des règles, en Deno cette fois, aurait été le vrai
risque : elle aurait fini par diverger des deux autres.

### Compatibilité descendante

Le code d'avant ce lot — `rule_holds` en base comme le moteur React — répond « règle respectée » à
toute clause `then` dont l'opérateur n'est pas `required`. Une PWA installée non rafraîchie ou un
instantané hors-ligne déjà téléchargé **montrent** la variable au lieu de la masquer : ils
n'échouent pas et n'effacent rien. Le serveur reste seul juge. La signature historique
`rule_holds(rule, data)` est conservée et délègue à la nouvelle, sans masquage.

### Interface

Le constructeur guidé gagne un troisième type, « N'afficher une variable que sous condition », qui
réutilise les champs de la forme conditionnelle et n'expose toujours aucun JSON. La **sévérité
n'est pas demandée** pour une règle d'affichage : elle ne bloque ni n'avertit, et l'étiquette
« Bloquant » la décrirait faux — la liste des règles la masque également. Un encart rappelle, au
moment d'écrire la règle, ce qu'elle produira sur les valeurs déjà saisies.

`EncounterFields` accepte les clés masquées et ne rend pas ces variables du tout. La visibilité est
appliquée partout où l'on saisit : création et correction d'une rencontre, création et correction
d'un patient, poste de curation — qui charge désormais les règles avec les champs, sans quoi il
proposerait des variables que le serveur refusera à la finalisation — et l'aperçu du formulaire, où
elle permet de vérifier une règle qu'on vient d'écrire sans créer de fiche d'essai. Dans le
formulaire de rencontre, la visibilité s'évalue sur **exactement ce qui partira au serveur** — les
champs applicables au type de visite —, sans quoi l'écran divergerait du serveur dès qu'une
variable pilote cesse de s'appliquer au type choisi.

### Preuves de validation

## L30 — Options de liste : code interne stable (2026-08-15)

Défaut consigné le 2026-07-22 dans [`idees-post-readiness.md`](idees-post-readiness.md) §4, jamais
corrigé pour les listes ordinaires. Une option de `select` / `multiselect` était stockée **en
texte** : la chaîne elle-même partait dans `patient.data` / `encounter.data`, et la validation la
comparait à `allowed_values`. Corriger une option — `hematome` en `hématome` — rendait les fiches
déjà saisies invalides à la prochaine écriture et scindait une modalité en **deux** dans les
statistiques. Rien ne le signalait.

C'est le problème que le référentiel de terminologie avait résolu pour les diagnostics
(`20260726210000`). Le lot lui applique la même solution.

### Ce qui a été trouvé en ouvrant le code, et qui change la forme du lot

**Le serveur interdisait déjà le geste.** `guard_template_field_update` classait tout changement
d'`allowed_values` comme sémantique et le refusait dès que la variable portait des données. Sur une
base réelle, renommer une option n'échouait donc pas en silence : c'était **impossible**. La
première pièce du lot est de rouvrir cette porte, précisément — et seulement pour les gestes qui ne
peuvent invalider aucune fiche.

**La valeur d'option ne vit pas que dans les fiches.** Elle est recopiée telle quelle dans les
règles de cohérence (`{if: {field, operator, value}}`), dans les filtres de cohorte enregistrés et
dans la valeur proposée de L28. Une conversion qui aurait changé les valeurs stockées devait les
suivre toutes — faute de quoi une règle d'affichage conditionnel, livrée la veille, aurait cessé de
se déclencher **sans erreur visible**.

### Décision de fond : le code d'une option existante est la chaîne elle-même

Retenue avec le porteur avant d'écrire une ligne. Le `value_key` d'une option **déjà en service**
est le texte déjà stocké, verbatim. Conséquence recherchée : les fiches portent **déjà** leur code.
Rien n'est réécrit — ni les données, ni les règles, ni les filtres de cohorte, ni les valeurs
proposées. La reprise se résume à une requête qui remplit la nouvelle colonne à partir de
l'ancienne.

L'alternative — normaliser les codes en `hematome`, sans accent — aurait produit une colonne de
code plus propre à l'export au prix d'une réécriture de **toutes** les fiches et de tout ce qui les
référence. Le gain était cosmétique, le risque ne l'était pas.

### `allowed_values` est conservée, en miroir

`allowed_options` porte la vérité ; `allowed_values` devient le tableau de ses `value_key`, tenu à
jour par un déclencheur. Même raisonnement qu'à L33 pour `allow_missing_codes`, et pour des raisons
tout aussi concrètes :

- `download_base_snapshot` a déjà déposé `allowed_values` sur des téléphones, et une PWA installée
  garde son ancien JavaScript jusqu'au prochain rafraîchissement. Changer la forme de la colonne
  sous elle aurait rendu « [object Object] » dans chaque menu déroulant — le défaut **D5**, déjà
  payé une fois ;
- `assert_data_valid`, `enforce_template_field_default_value` et toute la validation serveur
  continuent de lire `allowed_values`. **Aucune ligne de validation n'est réécrite par ce lot**,
  donc aucune fiche existante ne change de verdict.

La réconciliation est bidirectionnelle : un client antérieur au lot n'envoie que la liste de clés,
et le déclencheur **conserve les libellés déjà corrigés** pour les clés qu'il reconduit. Sans cela,
une seule modification faite depuis un onglet non rafraîchi aurait effacé tous les libellés.

### Une option désactivée reste valide à l'écriture

C'est le point qui décide de « la fiche reste modifiable ». Une option retirée du formulaire sort
de la saisie mais **reste dans `allowed_values`** : la validation reste **sans état**, elle ne
compare jamais une fiche à son passé, et une fiche qui porte une option désactivée reste écrivable
sans aucun cas particulier. Le même choix qu'à L33.

Sur une variable **déjà utilisée** sont désormais autorisés : renommer un libellé, ajouter une
option, en désactiver une, les réordonner. Restent refusés : **retirer** une option et **changer**
un code — les deux seules opérations qui rendraient une fiche existante invalide. Le refus vit dans
le déclencheur qui réconcilie les deux colonnes, et non dans le garde générique : deux déclencheurs
`before update` s'exécutent par ordre alphabétique, et un garde placé ailleurs aurait vu une liste
non encore réconciliée — donc un retrait invisible venant d'un client qui n'envoie que les clés.

Un refus s'ajoute, non demandé mais nécessaire : **désactiver l'option qui sert de valeur proposée**
est refusé, avec un message qui dit quoi faire. Sans lui, les nouvelles fiches auraient été
préremplies avec une modalité qu'on venait de retirer de la saisie.

### Conversion des données existantes

Puisque rien n'est à réécrire, la conversion sert ce qu'elle doit servir : **réparer le dégât déjà
commis**. Avant ce lot, un renommage laissait derrière lui des fiches portant l'ancienne chaîne,
absente de la liste — invalides à la prochaine écriture, comptées comme une modalité distincte.

`preview_option_key_repair(base)` **ne modifie rien** (fonction `stable` : le moteur refuserait
toute écriture) et rend, variable par variable, les rapprochements proposés, les fiches
convertibles et les valeurs bloquantes. `repair_option_keys(base, confirm)` refuse d'agir sans
`confirm => true`. Les deux partagent **la même** fonction de plan : l'aperçu ne peut donc pas
annoncer autre chose que ce qui sera fait.

Une valeur orpheline n'est rattachée que si, après normalisation (minuscules, accents ramenés à la
lettre de base — `terminology_normalize`, déjà présente, aucune extension nouvelle), elle
correspond à **exactement une** option, par son libellé ou par son code. Zéro correspondance ou
plusieurs : la fiche est **bloquée** et rapportée. Une seule valeur non rapprochable bloque la
fiche entière, pour ne jamais laisser cohabiter deux codages dans le même enregistrement.

Les exigences de L26 sont tenues : chaque fiche est traitée dans sa propre **sous-transaction**, la
ligne est **verrouillée puis relue** avant écriture et laissée intacte si elle a bougé depuis
l'aperçu, la fiche convertie repasse par `assert_data_valid`, et chaque changement est tracé dans
`field_change_log` avec l'ancienne et la nouvelle valeur sous la source dédiée
`option_key_repair`. L'**idempotence est portée par l'état** : une fiche dont la valeur est déjà un
code connu n'apparaît pas au plan. Rejouer la conversion après une interruption ne reconvertit rien
et ne journalise rien — il n'y avait donc pas de clé d'opération à inventer.

L'élargissement du `check` sur `field_change_log.source` porte sur une table qui contient des
données : la nouvelle liste est un surensemble, et la contrainte est posée `not valid` puis
validée, pour ne pas tenir de verrou exclusif pendant le parcours.

### Interface

L'éditeur d'options remplace la zone de texte libre, qui confondait le libellé et la valeur
stockée : ajouter, renommer, réordonner, désactiver, et le **code affiché en lecture seule** à côté
de chaque option. Le montrer n'est pas un détail technique gratuit — c'est lui qui apparaîtra dans
la colonne de code de l'export, donc dans l'analyse. L'éditeur **reste actif** sur une variable déjà
utilisée ; seule la suppression d'une option en disparaît.

À la saisie, les options inactives ne sont plus proposées, mais celle que la fiche porte déjà reste
offerte — la retirer du menu aurait effacé sa valeur au premier enregistrement. Une valeur hors
liste est conservée et montrée telle quelle, jamais remplacée en silence.

Trois consommateurs ont été repris parce que les laisser aurait créé un bug silencieux : le
constructeur de règles et le constructeur de cohortes proposent désormais le **libellé** et
soumettent le **code** (une règle bâtie sur le libellé ne se serait jamais déclenchée), et les
écrans de lecture — liste des patients, fiche patient — affichent le libellé de l'option au lieu
du code. C'est la leçon de **D5**, déjà payée : un correctif appliqué à un seul appelant ne clôt
pas ce genre de défaut.

L'aperçu et la conversion sont posés dans les réglages de la base, réservés à qui peut corriger ses
données. Analyser et convertir sont **deux boutons distincts** ; après conversion, l'aperçu est
rejoué pour que ce qui reste affiché soit l'état réel, et non la photo d'avant.

### Export

Même convention que la terminologie, pour la même raison : la colonne principale porte le
**libellé**, une colonne `option_code__<portée>__<clé>` porte le **code**. Elle est produite pour
toute liste, y compris celles où code et libellé se confondent encore — la forme du fichier ne doit
pas dépendre de l'historique des renommages d'une base. Le dictionnaire gagne la ligne de codes
correspondante, décrit les options **inactives** comme telles, et unionne les listes d'une colonne
qui traverse plusieurs versions de gabarit.

### Limite connue, laissée hors périmètre

Un import dont le fichier contient les **libellés** d'une liste dont les codes en diffèrent sera
refusé par le serveur (« Valeur non autorisée pour X »). Le refus est visible et n'écrit rien, mais
la correspondance libellé → code à l'import relève de **L24**, non de ce lot.

### Preuves de validation

## L31 — Sections personnalisables (2026-08-15)

`template_field.section` était un `check (section in ('clinique','biologie','paraclinique'))`. Un
registre de traumatisme crânien ne se structure pas ainsi : il lui faut « identification /
circonstances / examen initial / imagerie / prise en charge / évolution », créées, renommées et
réordonnées par le propriétaire de la base.

### Le constat d'entrée était incomplet

Le document d'orientation annonçait neuf fichiers. Vérification faite avant d'écrire une ligne,
**trois sites de production supplémentaires** portaient la même liste en dur, et deux d'entre eux
étaient les plus dangereux :

- `20260814090000_template_field_default_value.sql` — la liste des trois valeurs avait été
  **recopiée une troisième fois** dans `create_template_bundle`. C'est cette copie qui était en
  vigueur, pas celle de `20260711000200` citée par le constat.
- `20260815160000_template_field_option_codes.sql` — `copy_template_fields`, `update_template_field`
  et `download_base_snapshot` transportent tous `section`. Une structure oubliée là se perd **en
  silence** à la duplication d'un gabarit : leçon déjà payée à L28, L30 et L33.
- `templateFromSheet.ts:75` et `EditEncounter.tsx:81` — deux replis en dur sur `'clinique'`.

S'y ajoutaient `messages.ts` (deux langues) et `exportContract.ts`. La qualification de « lot
relativement localisé » était fausse : la surface réelle est base + Edge + i18n + hors-ligne.

### Quatre décisions prises avec le porteur avant d'écrire

**Une seule notion.** La section est le regroupement **visuel** du formulaire. Aucune « catégorie de
donnée » séparée n'est introduite : rien dans le produit ne la lirait aujourd'hui, elle imposerait
un second menu obligatoire dans quatre écrans de création, et l'ajouter plus tard reste additif.

**Gel total sur une version publiée.** La section pend à `template_version` : elle hérite
mécaniquement du verrou existant. Autoriser le renommage aurait exigé une **dérogation délibérée**
dans la garde — c'était l'exception, pas le défaut. Le gel est aussi le régime réel des variables :
contrairement à ce qui avait été avancé d'abord dans la discussion, une version publiée refuse
**toute** modification de ses variables, libellé compris (`20260815160000:266`). Le lot s'aligne au
lieu d'inventer un second régime.

**Le miroir porte le code de la section.** Le `check` devient un contrôle de **forme**. Une PWA non
rafraîchie et un instantané hors-ligne déjà téléchargé ne connaîtront jamais la nouvelle table :
ils lisent la colonne texte. Les trois sections existantes **gardent leurs codes**, donc un client
non rafraîchi voit exactement ce qu'il voyait. Une section créée après le déploiement tombe chez lui
dans « Autre » — dégradation honnête plutôt qu'affichage faux.

**Liste de sections partagée** entre variables patient et variables rencontre. Chaque écran n'affiche
que les sections non vides, ce qui était déjà le comportement de `SectionedFields`.

### Le repli, et ce qu'il garantit

`20260815180000_template_section.sql` crée `template_section` (rattachée à `template_version`,
`section_key` + `label` + `display_order`), ajoute `template_field.section_id` **nullable**, relâche
le `check`, puis dote **chaque version existante** des trois sections historiques dans leur ordre et
rattache chaque variable à celle de même code. Aucune variable ne change de section, aucun libellé
affiché ne change — le front préfère la **traduction** pour ces trois codes, de sorte qu'un lecteur
anglophone garde « Clinical » et non le « Clinique » stocké par la migration.

### Le miroir marche dans les deux sens

Deux familles de clients écrivent la table, et la bascule ne devait avoir aucune fenêtre : un client
à jour envoie `section_id` et le code texte en est déduit ; un client non rafraîchi n'envoie que le
code et le lien est retrouvé dans la même version. Sur `UPDATE`, c'est **celui des deux qui a
changé** qui fait foi — sans cette distinction, une écriture ancienne aurait été silencieusement
annulée par l'ancien lien.

### Le filet, préservé et durci

Un code non rapprochable **ne fait pas échouer l'écriture** : `section_id` reste nul et la variable
retombe sur « Autre ». Refuser aurait fait disparaître la variable du formulaire — un champ
invisible n'est jamais saisi, et personne ne s'en aperçoit. Le filet est aussi posé **au niveau des
données** (`on delete set null`), et il ferme toujours la marche à l'affichage, quel que soit
l'ordre nominal des sections.

### Deux trous trouvés par les tests, pas par la relecture

**`seed.sql` s'exécute après les migrations.** La reprise de la migration ne pouvait donc pas doter
ses versions de sections : la base de démonstration naissait sans aucune section, et 7 tests sur 16
tombaient. Les sections y sont désormais explicites, créées **avant** les variables.

**Une table neuve ne reçoit aucun privilège.** Le `grant ... on all tables` de
`20260616090400_rls.sql` ne couvre que les tables existantes à cette date : sans `grant` propre,
la RLS n'est jamais atteinte et tout client reçoit « permission denied ». Même piège que
`research_group` et `terminology_reference` avant elle.

### Interface

Un gestionnaire de sections (`SectionsEditor.tsx`) ouvre le constructeur, **avant** la liste des
variables : on choisit ses regroupements, puis on range. Créer, renommer, réordonner ; le **code
interne est affiché en lecture seule** — c'est lui que portent les fiches et les instantanés. Une
section encore peuplée n'est pas supprimable, et l'écran le dit avant le clic plutôt que de laisser
le serveur refuser. L'ensemble disparaît hors brouillon, comme le reste de l'édition.

`FieldForm`, `ImportData` et `TemplateFromFile` proposent désormais les sections **de la version**
au lieu des trois valeurs figées, et retombent sur les trois historiques quand aucune liste n'est
chargée. Leur valeur par défaut est la **première section de la version** : une base qui a retiré
« clinique » ne se voit plus proposer une section qui n'existe plus.

### Export

Le dictionnaire garde la colonne `section` portant le **code** — inchangée pour une base qui n'a pas
touché aux siennes — et gagne `section_label`. Sans lui, une section personnalisée n'apparaîtrait
que sous forme de code. Les sections sont lues **par version**, comme les champs : deux versions
peuvent nommer différemment le même code, et c'est celui de la version de la fiche qui fait foi. À
la fusion d'une colonne traversant plusieurs versions, le premier libellé connu tient.

L'instantané hors-ligne émet `sections` et `sectionsByVersion`, en plus du `section` de chaque
variable conservé tel quel.

### Preuves de validation

Exécutées sur cette branche, le 2026-08-15 :

- `npm run typecheck` · `npm run lint` — sans erreur ni avertissement.
- `npm test` — **1167 tests, 125 fichiers, tous verts**, dont `test/template-sections.test.ts`
  (**23 tests** propres au lot).
- `npm run db:verify` — le jeu de **127 migrations** s'applique proprement depuis zéro (10,3 s) ;
  42 tables, 63 policies, 64 triggers.
- `deno test supabase/functions/generate-export/` — **43 tests verts**, dont deux ajoutés pour la
  section personnalisée au dictionnaire et la survie du libellé à la fusion entre versions.
- `npm run edge:fmt` · `npm run edge:lint` · `npm run edge:check` · `npm run release:edge:check` —
  verts (7 fonctions découvertes).
- `npm run build` — vert. Le refus initial venait du garde-fou d'environnement
  `VITE_USE_SIGNED_READ`, sans rapport avec le lot ; le build passe dès qu'il est fourni.
- `npm run schema` — instantané régénéré jusqu'à `20260815180000_template_section.sql`.

Ce que les tests ont réellement attrapé, et que la relecture n'avait pas vu : les deux trous
ci-dessus (`seed.sql` et les privilèges de table), plus l'inventaire `SECURITY DEFINER` à compléter
pour `reorder_template_sections`. Le contrôle n'a pas été contourné : la signature a été **ajoutée à
l'allowlist** et les compteurs mis à jour.

Un risque identifié à la relecture a été éprouvé plutôt que supposé : `template_section` et
`template_field` pendent tous deux à la version avec `on delete cascade`, et l'ordre des cascades
n'est pas garanti — si les sections partaient en premier, la garde « section non vide » aurait fait
échouer la suppression d'une version légitime. Le comportement est correct, et deux tests de
non-régression le figent.

## Lot L14 — Chargement de la seule langue active (branche d'intégration, 2026-08-16)

Les dictionnaires français et anglais sont maintenant deux modules dynamiques distincts. Au
premier affichage, seul le dictionnaire choisi dans `registre.lang` est demandé. Lors d'une
bascule, l'écran courant reste rendu pendant le chargement puis le contenu, la langue du document
et la préférence locale changent ensemble. Les modules de langue sont exclus du précache initial
et mis en cache à leur premier usage.

### Mesure avant / après

- fichier applicatif principal : **220 498 → 124 248 octets** ;
- dictionnaire français à la demande : **51 395 octets** ;
- dictionnaire anglais à la demande : **45 967 octets** ;
- précache PWA : **1 023,70 → 929,71 Kio** ;
- entrées du précache : **73 → 73** ; aucune référence à un dictionnaire dans `sw.js`.

### Validation locale — niveau 1

- test ciblé de bascule atomique : **1/1 vert** ;
- `npm run typecheck` et `npm run lint` : verts ;
- `npm run test:web` : **402 tests, 59 fichiers, tous verts** ;
- tests de configuration/build ciblés : **15/15 verts** ;
- build de production avec `VITE_USE_SIGNED_READ=true` : vert ;
- contrôle des chunks : aucun dictionnaire dans le fichier principal et aucune langue croisée
  entre les deux chunks.

La publication et la vérification multi-écrans en staging puis en production restent volontairement
reportées à la release unique de la branche d'intégration.

## Corbeille des bases dans la barre latérale (2026-08-18)

Demande du porteur, hors file des défauts : déplacer la corbeille des bases de l'écran d'accueil
vers la barre latérale. Branche de travail locale `codex/lot-d9-d12` (niveau A : aucun commit
effectué pour ce chantier).

### Réalisation

- page `src/screens/member/Trash.tsx` (route `/trash`, `ProtectedRoute` réservée au rôle
  `medecin` — seul rôle à créer/posséder des bases, `canCreateBase`) : liste des bases supprimées
  avec motif, dates de suppression et d'éligibilité à la purge, restauration via la modale de
  confirmation existante ; états vide et hors-ligne ;
- entrée « Corbeille » dans la barre latérale du médecin (`AppShell.tsx`), avec badge du nombre
  chargé par `list_deleted_bases` au montage et au retour de focus de la fenêtre ; un échec réseau
  laisse le badge à zéro sans faire échouer la coquille ; jamais de chargement hors-ligne ni hors
  du rôle ;
- suppression de la section `<details>` et de son chargement (`listDeletedBases`,
  `restoreTarget`, `ConfirmDialog`) dans `Dashboard.tsx` — l'accueil ne porte plus que les bases
  actives et la copie hors-ligne ;
- clés i18n ajoutées : `nav.trash`, `base.trash_offline` (fr + en).

### Validation locale — niveau 1

- `npm run typecheck` : vert ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **61 fichiers, 409/409 tests verts** — test corbeille déplacé de
  `Dashboard.test.tsx` vers `Trash.test.tsx` (3 tests : liste, restauration après confirmation,
  état vide) ; assertions sidebar ajoutées à `AppShell.test.tsx` (médecin voit l'entrée, curateur
  et saisisseur ne la voient pas) ;
- build de production avec `VITE_USE_SIGNED_READ=true` : vert, `Trash` en chunk différé
  (2,1 kB), PWA régénérée (73 entrées précachées).

### Limites

La corbeille reste vide hors-ligne (RPC serveur). Le libellé « Purge manuelle possible à partir du
{date} » reste affiché sans action correspondante : c'est D10, toujours ouvert, qui exige une
décision produit avant tout travail. Publication non engagée : niveau A — s'arrête avant le commit,
en attente de la validation du porteur.

## Lot D9/D12 — menus flottants et retour visuel des boutons (2026-08-18)

Lot de correction des défauts D9 et D12 de la file d'idées post-readiness, sur la branche de
travail locale `codex/lot-d9-d12`. Niveau A : aucun commit effectué, publication non engagée.

### D9 — fermeture des menus flottants

Le composant partagé `src/components/Menu.tsx` (avec `MenuItem`) remplace les trois `<details>`
flottants (`MyTemplates.tsx`, `TemplatesAdmin.tsx`, sélecteur de colonnes de `BaseHome.tsx`) :
fermeture au `pointerdown` extérieur, à Échap (focus restitué au déclencheur) et à la sélection ;
un seul menu peut rester ouvert à la fois. `popover="auto"` est écarté (non garanti sur téléphones
anciens) ; les entrées restent des boutons tabulables, sans `role="menu"`, pour préserver les tests
existants. Les dépliants en flux et la liste de suggestions de terminologie sont laissés intacts,
comme prescrit. Cinq tests dédiés (`src/components/Menu.test.tsx`).

### D12 — retour visuel des boutons

Chaque `hover:` des cinq primitives est doublé d'un `active:` de même intention (clair et sombre) ;
`disabled:opacity-60` complète `.btn-ghost` et `.icon-button`. La primitive `.btn-pending` (anneau
`currentColor`, `pointer-events-none`, rotation coupée sous `prefers-reduced-motion`) marque
l'attente des actions longues : création et sauvegarde de gabarits, confirmation de
`ConfirmDialog.tsx` (dont le bouton danger reprend la primitive `btn-danger` au lieu du style
inline).

### Validation locale — niveau 1

- `npm run typecheck` : vert ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **60 fichiers, 407/407 tests verts**, dont 5 nouveaux pour `Menu` ;
- build de production avec `VITE_USE_SIGNED_READ=true` : vert (4,64 s), PWA régénérée
  (74 entrées précachées) ;
- contrôle du CSS compilé dans `dist/` : états `:active`/`:disabled` et `.btn-pending` présents
  dans le bundle.

La publication (commit, PR, staging) reste volontairement non engagée : niveau A — s'arrête avant
le commit, en attente de la validation du porteur.

## Lot L20 ÔÇö Socle PostgreSQL des listes de diagnostics (branche d'int├®gration, 2026-08-16)

La migration additive `20260818045033_multivalue_terminology_foundation.sql` ajoute
`template_field.is_multiple`, faux par d├®faut et r├®serv├® au type `terminology`. Une liste valide
porte de 1 ├á 50 couples `code`/`label`, sans code r├®p├®t├® ; chaque couple est v├®rifi├® dans toutes les
publications conserv├®es. Une raison de valeur manquante continue de remplacer la liste.

`jsonb_matches` comprend d├®sormais `has_any` et `has_none`. La compl├®tude n'a pas ├®t├® r├®├®crite :
sa d├®finition actuelle utilise d├®j├á `rule_value_present`, qui distingue correctement `[]` d'une
liste non vide. La duplication de version, la nouvelle surcharge de modification et l'instantan├®
hors-ligne conservent tous `isMultiple`.

### Synth├¿se `meddata-db-safety`

- compatibilit├® : les champs et donn├®es existants restent unitaires par d├®faut ; aucune donn├®e
  clinique n'est convertie par L20 ;
- int├®grit├® : contrainte de type, cardinalit├®, forme stricte, unicit├® des codes et validation du
  r├®f├®rentiel sont impos├®es c├┤t├® serveur ;
- RLS et privil├¿ges : aucune table ni policy nouvelle ; **42 tables et 63 policies inchang├®es** ;
  la nouvelle RPC reste refus├®e ├á `anon` et accord├®e ├á `authenticated` ;
- concurrence et idempotence : aucune ├®criture de donn├®es ni traitement de reprise ; la migration
  est transactionnelle et sa valeur par d├®faut constante n'impose pas de conversion ;
- sauvegarde et r├®cup├®ration : aucune sauvegarde de donn├®es requise pour ce lot non destructif ;
  toute correction ult├®rieure doit rester additive. Aucune migration distante n'a ├®t├® appliqu├®e.

### Validation locale ÔÇö niveau 1

- tests L20 : **10/10 verts** ;
- non-r├®gression terminologie, statistiques et cohortes : **30/30 verts** ;
- `npm run db:verify` : **128 migrations** appliqu├®es depuis z├®ro, 42 tables, 63 policies et
  64 triggers ;
- `npm run typecheck` et `npm run lint` : verts.

D├®cision du contr├┤le de lot : **pr├¬t pour la suite s├®quentielle L21**, sous r├®serve de la validation
ind├®pendante commune avant publication.

## Incident de séquence — D13/D14 livrés hors lot, L22 annulé, L20 livré (2026-08-18)

Entrée consignée après coup, à la demande du porteur. **Aucun code n'a été modifié pour la
produire** : elle existe parce que trois commits successifs ont laissé le dépôt dans un état que ni
la file d'idées ni la carte des lots ne décrivaient plus, et qu'un prochain agent l'aurait
redécouvert à ses frais.

### Ce qui s'est passé

| Commit | Date | Contenu |
|---|---|---|
| `68adb9e` | 2026-08-15 | D13 à D16 consignés, avec la consigne « ne pas traiter D13/D14/D15 tant que L22 n'est pas livré » |
| `7e83a3f` (PR #215) | 2026-08-17 | **D13, D14 et L22 dans un seul commit** — L22 livré sans son prérequis L20 |
| `6775a91` (PR #221) | 2026-08-18 | **Annulation de la seule part L22** ; D13 et D14 conservés |
| `cde3170` (PR #222) | 2026-08-18 | L20 livré (`20260818045033_multivalue_terminology_foundation.sql`) |
| `0d94a23` (PR #223) | 2026-08-18 | L'ensemble sur `main` |

L'ordre prévu est donc rétabli pour la famille « listes de diagnostics » : L20 est livré, L21 et
L22 restent à faire **ensemble**. Ce qui n'a pas été remis dans l'ordre, ce sont **D13 et D14** :
livrés hors de leur lot, et restés silencieux dans la documentation jusqu'à cette entrée.

### État réel du code

- **D13 livré** : `mergeExportFields` trie par `displayOrder` puis par clé (`exportContract.ts:230`
  et `:269`), et non plus alphabétiquement. Test : `exportContract_test.ts:299`.
- **D14 livré, mais partiel** : `formatValue` renvoie un nombre natif pour `number` et `integer`
  (`:183`), `formatAgeValue` de même pour `age_value` (`:310`). Tests : `exportContract_test.ts:313`
  et `:328`. **Les booléens n'ont pas été convertis** (`:180` renvoie toujours `'1'` / `'0'`) alors
  que la correction attendue les citait.
- **D15 non livré, et devenu bloquant** : la raison de valeur manquante est renvoyée avant la
  branche numérique (`:171-183`), si bien qu'une colonne numérique mélange désormais des cellules
  `t='n'` et `t='s'`. Avant D14 elle était uniformément en texte. Le bénéfice de D14 ne tient donc
  que pour les variables où aucune raison n'a jamais été saisie. Aucun test ne couvre ce cas, et la
  correction demande une décision du porteur sur la forme du fichier.
- **L22 absent** : aucune trace de `is_multiple` dans `exportContract.ts` ni dans le `select` de
  `handler.ts:517`.
- **L20 présent** : la base accepte les listes de 1 à 50 couples `code`/`label`.

### Ce qu'un prochain agent doit en faire

1. **Travailler sur `origin/main`** et vérifier l'état de L20 et de L22 dans le code, pas dans un
   répertoire de travail local : plusieurs copies de ce dépôt sont restées en arrière de la
   séquence ci-dessus et contiennent encore le code L22 annulé.
2. **Ne pas recorriger D13 ni D14** : livrés, verrouillés par tests.
3. **Reprendre L22 par `git revert 6775a91`**, pas par réécriture — le code restitué est déjà
   cohérent avec D13 et D14. Restent ensuite deux réconciliations, détaillées dans
   [`lots-paralleles.md`](lots-paralleles.md) : aligner le contrat export sur les règles que L20
   impose côté serveur, et remettre `is_multiple` dans le `select` de `handler.ts:517`.
4. **Ne pas fusionner L21 sans L22.** La phrase « prêt pour la suite séquentielle L21 » de l'entrée
   L20 ci-dessus ne veut pas dire *L21 seul* : la base accepte désormais des listes que l'export ne
   sait plus lire, et une variable multivaluée saisie sans L22 sortirait en `[object Object]`, code
   vide, sans erreur ni avertissement. Les deux lots ne partagent aucun fichier et se développent en
   parallèle ; c'est leur mise en ligne qui doit être commune.
5. **Traiter D15 comme une condition du bénéfice de D14**, pas comme un défaut indépendant.

### Restauration de L22 (2026-08-18, `2cf39f8`)

Faite dans la foulée, à la demande du porteur, sur la branche
`codex/l22-restore-multivalue-export` : `git revert 6775a91`, appliqué sans conflit, aucun fichier
réécrit à la main. Les deux réconciliations annoncées plus haut ont été **vérifiées, et aucune n'a
demandé de code supplémentaire** :

- `is_multiple` est revenu de lui-même dans le `select` de `handler.ts:521` — c'est l'annulation
  qui l'avait retiré, le revert le remet ;
- le contrat export est déjà cohérent avec les règles serveur de L20 : `isTerminologyList` exige
  une liste **non vide** de couples `code`/`label` stricts, `nbOf` rend vide sur une raison de
  valeur manquante — jamais `0`, qui signifierait « aucun diagnostic » — et `1` sur une valeur
  unitaire ancienne, ce qui couvre l'export mixte d'une variable devenue multivaluée entre deux
  versions de gabarit ; `formatValue` traite la liste **avant** la branche `Array` générique.

D13 et D14 sont ressortis intacts de l'opération, avec leurs trois tests.

Portes exécutées : `deno test supabase/functions/generate-export/` **54/54**, `npm run edge:test`
**123/123**, `npm run edge:check`, `npm run edge:lint`, `npm run edge:fmt`,
`npm run release:edge:check` (7 fonctions découvertes) — toutes vertes.

Non exécuté, et volontairement : `typecheck`, `lint`, `test:web` et `build`. Une autre session
écrivait L21 dans le même répertoire de travail au même moment ; leurs résultats auraient porté sur
du code en cours d'écriture, pas sur ce lot. La surface Deno, elle, est isolée de L21 — aucun
fichier commun. Ces portes restent à passer sur la branche d'intégration, quand L21 et L22 s'y
retrouveront.

**Publication non engagée** : commit fait, ni poussé ni fusionné.

### Défaut d'encodage à corriger

L'entrée « Lot L20 » qui précède a été écrite avec un encodage erroné (`ÔÇö` pour `—`, `├®` pour
`é`). La corruption est **non réversible automatiquement** : la remettre d'aplomb suppose de
retaper le texte. Le fond reste exact ; seule la lecture est pénible.

## Lot L21 — Listes de diagnostics : saisie et constructeur (2026-08-18)

Front seul, aucune migration. Le socle L20 (`20260818045033_multivalue_terminology_foundation.sql`)
était fusionné et vérifié avant de commencer : `template_field.is_multiple`, contrainte de type,
surcharge `update_template_field(..., p_is_multiple, ...)` et `isMultiple` dans
`download_base_snapshot`.

### Ce qui est livré

- **Constructeur** (`FieldForm.tsx`) : case « Accepte plusieurs valeurs », rendue pour le seul type
  `terminology` et soumise à `lockStructural` comme le type et la portée. Revenir à un autre type
  dépose la cardinalité en chemin, plutôt que de provoquer le refus de la contrainte serveur.
- **Saisie** (`TerminologyInput.tsx`) : mode multivalué. Étiquettes **numérotées** — le numéro est le
  rang, et c'est lui qui porte « le premier est le diagnostic principal » — bouton de retrait nommé,
  et **la zone de recherche reste visible en dessous**. Un concept déjà choisi sort des résultats.
  L'ordre est celui de la saisie : ni l'écran ni le serveur ne retrient.
- **Retrait de la dernière valeur** : le composant émet `null`, jamais `[]`, et les conteneurs
  (`EncounterFields.tsx`, `NewPatient.tsx`) **suppriment la clé** via le mécanisme `onRemove` qui
  existait déjà. `ChoiceWithProposal` traitait déjà ce cas et n'a pas été touché.
- **Validation** (`domain/validation.ts`) : le partage est conservé. En multivalué, on vérifie que
  c'est un tableau de couples bien formés — rien de plus. Existence des concepts, doublons et borne
  de 50 restent au serveur.
- **`ValueInput.tsx` inchangé** : un code de donnée manquante remplace la liste, il ne s'y ajoute
  pas. Point couvert par test, pas par modification.
- **Câblage** : `isMultiple` traverse `TemplateField`/`NewField`, `mapField`, l'insertion de
  `addField` et la RPC de `updateField` — c'est la clé `p_is_multiple` qui sélectionne la surcharge
  L20 ; sans elle, PostgREST résout la signature antérieure et la cardinalité n'est jamais écrite.

### Deux points hors des cinq demandés, validés par le porteur

- `displayFieldValue` testait `isTerminologyValue` avant `Array.isArray` : un tableau de couples
  tombait dans `join(', ')` et aurait affiché « [object Object] » dans `BaseHome`, `PatientDetail` et
  `EditEncounter` — la régression que la spécification signale pour l'export, dans un autre fichier.
- `OfflineField` ne transportait pas `isMultiple` alors que `download_base_snapshot` l'émet déjà :
  hors connexion, une liste se serait ouverte dans le formulaire unitaire, ses valeurs invisibles, et
  la première saisie aurait produit un couple unique refusé à la synchronisation.

### Validation locale — niveau 1

- `npm run typecheck` : vert ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **63 fichiers, 437/437 tests verts**, dont 20 nouveaux pour ce lot
  (`TerminologyInput`, `FieldForm`, `EncounterFields`, et deux fichiers créés :
  `domain/validation.test.tsx`, `data/types.test.tsx`) ;
- `npm run build` avec `VITE_USE_SIGNED_READ=true` : vert, PWA régénérée (73 entrées préchargées).

La suite RLS/PostgreSQL embarquée n'est pas touchée par ce lot front ; la CI la joue sur la PR.

### Publication

PR ouverte vers `develop`, **non fusionnée** : la fusion revient au porteur, sur sa consigne.

Incident sans conséquence sur le contenu livré : le répertoire de travail est partagé avec une autre
session, qui y a basculé la branche `codex/l22-restore-multivalue-export` en cours de lot. Le lot L21
a donc été committé depuis un `git worktree` dédié, à partir de `develop`, et les fichiers L21 ont
été retirés du répertoire partagé pour ne pas polluer le travail L22.

### Ce qui reste aux lots suivants

L23 (`has_any`/`has_none` dans `CohortBuilder`), L24 (refus au mappage d'import), L26 (regroupement
de `diagnostic_1/2/3`). L22 (export) a été fusionné le même jour par la session voisine (PR #225) :
`develop` porte donc le socle, l'export et la saisie dès que cette PR sera fusionnée à son tour. Le réordonnancement des étiquettes n'est pas offert : la
spécification fixe l'ordre à celui de la saisie.

## Lot L23 — Listes de diagnostics : cohortes (2026-08-18)

Front seul, aucune migration. Dernier maillon de la chaîne : L20 a livré les opérateurs serveur,
L21 la saisie, L22 l'export — il manquait de quoi **filtrer** ces listes, c'est-à-dire de quoi les
exploiter.

### Ce qui est livré

- **`operatorsFor` ne propose plus que « porte au moins un de » et « ne porte aucun de »** sur une
  variable multivaluée. Retirer l'égalité n'est pas cosmétique : sur une liste, la comparaison
  porterait sur la représentation JSON du tableau entier, et « n'est pas » serait vrai pour tout le
  monde. Une cohorte fausse ne se voit pas — elle se publie.
- **La valeur du critère est une liste de concepts du référentiel**, saisie par le MÊME composant que
  la fiche patient (`TerminologyInput` en mode multivalué, livré par L21). Aucun second sélecteur
  n'a été écrit. Seuls les **codes** partent dans le filtre, car c'est sur eux que `jsonb_matches`
  compare ; le critère enregistré les affiche tels quels, comme le font déjà les listes à choix.

### Deux pièges rencontrés en chemin

- `draftOp` valait `eq` à l'initialisation et n'était recalculé que par le changement de variable.
  Une base dont la **première** variable est un diagnostic multivalué affichait donc « porte au moins
  un de » pendant que l'état disait `eq` — et c'est un `eq` qui serait parti dans le critère. Un test
  dédié couvre ce cas.
- Une variable de terminologie **unitaire** se voyait offrir « est », « n'est pas » et « figure dans
  la liste », qui ne peuvent pas fonctionner sur un couple `{code, libellé}`. Aucun opérateur n'est
  plus proposé pour ce cas, et l'écran explique pourquoi. Le rendre juste demanderait un opérateur
  serveur, donc une migration : **candidat pour un lot ultérieur**, hors périmètre ici.

### Aperçu et figeage — le point 4 du lot

`cohort_preview` et `create_cohort_snapshot` sont deux fonctions distinctes qui découpent les
conditions par portée avec la même expression et appellent la même `jsonb_matches` : les deux
héritent donc ensemble des opérateurs de L20. Mais rien dans le schéma n'empêche l'une de dériver de
l'autre, et un filtre qui marcherait à l'aperçu sans marcher au figeage produirait une cohorte
silencieusement différente de celle qui a été montrée. `test/cohort-multivalue.test.ts` verrouille
l'égalité : effectifs **et** identité des patients, pas seulement le compte.

### Validation locale — niveau 1

- `npm run typecheck` : vert ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **63 fichiers, 442/442 tests verts** (437 avant ce lot) ;
- `npm run build` avec `VITE_USE_SIGNED_READ=true` : vert, PWA régénérée (74 entrées préchargées).

La suite base de données a été lancée localement mais n'a pas pu aboutir dans un délai utile : une
session voisine occupait la machine avec dix-neuf instances PostgreSQL embarquées simultanées. C'est
la CI qui joue `npm test`, donc le test ci-dessus, sur la PR.

**Incident de vérification, à retenir.** Le premier passage de CI est parti rouge sur `typecheck` :
deux mocks de ce lot étaient déclarés sans paramètres, et `tsc` était le seul des trois outils à le
voir. La cause est un ordre de vérification fautif — `typecheck` avait été lancé **avant** l'écriture
des tests, puis seulement `vitest` et `eslint` après. Relancer `typecheck` après TOUTE écriture de
test, y compris quand le test passe.

### Publication

PR #226 ouverte vers `develop`, **non fusionnée** : la fusion revient au porteur, sur sa consigne.

### Ce qui reste

L24 (refus au mappage d'import) et L26 (regroupement de `diagnostic_1/2/3`, à lancer seul et en
dernier). S'y ajoute le filtrage des diagnostics unitaires, qui demande un opérateur serveur.

## Lot L24 — Listes de diagnostics : refus au mappage d'import (2026-08-18)

Front seul, aucune migration. Ce lot **n'ajoute pas** l'import des diagnostics : il pose un refus
honnête à la place d'un échec tardif.

### Le constat, et ce qu'il n'est pas

L'import ne prend en charge **aucun** champ de type `terminology`, même à valeur unique :
`src/domain/import.ts` transmet la cellule telle quelle, et la validation serveur rejette une chaîne
là où elle attend un couple `{code, libellé}`. Ce n'est pas une régression de L21 — c'est un manque
**antérieur**, que L21 rend simplement visible : dès qu'une variable multivaluée existe, elle
apparaît dans la liste des cibles de mappage. Le lot traite donc les deux cardinalités, pas
seulement la nouvelle.

### Ce qui est livré

- **`autoMapColumns` ne propose plus une cible de terminologie.** La résolution d'un en-tête est
  passée par une fonction unique, `matchColumn`, qui distingue trois issues : cible utilisable,
  variable de terminologie, ou rien. Les priorités d'avant sont conservées telles quelles — alias
  méta d'abord, puis champ patient, puis champ rencontre — et un test verrouille le cas d'une
  variable de terminologie nommée « Date », que l'alias méta continue de gagner.
- **Le choix manuel est refusé, et refuser ne change rien.** Tenter cette cible sur une colonne
  déjà mappée ne l'écrase pas : la colonne garde son mappage. Écraser par « ignorer » ferait perdre
  une colonne valide à cause d'une action refusée — une perte de données provoquée par un
  garde-fou. Le message dit ce qui se passe et quoi faire, sans terme technique : la variable ne
  peut pas encore être importée, l'import ne sait pas retrouver un diagnostic du référentiel à
  partir du texte d'un fichier, ces diagnostics sont à saisir à la main sur la fiche du patient.
- **Le rapport nomme les colonnes écartées pour ce motif**, au lieu de les fondre dans les colonnes
  ignorées ordinaires — c'est le point qui manquait le plus : un utilisateur qui importe un fichier
  contenant une colonne « Diagnostic » doit comprendre pourquoi elle n'est pas arrivée. La liste
  réunit deux sources, les en-têtes reconnus et les tentatives manuelles refusées, et n'y garde que
  les colonnes **réellement restées ignorées** : une colonne qui a conservé un mappage valide n'y
  figure pas, sinon le rapport mentirait dans l'autre sens. Elle apparaît à l'étape de
  correspondance (donc **avant** de lancer quoi que ce soit) et dans la carte de résultat, aperçu
  comme import.

### Deux détails qui n'étaient pas dans la consigne

- Le bouton « Créer la variable » disparaît sur une colonne dont l'en-tête désigne **déjà** une
  variable de terminologie : à côté d'un message disant que cette variable se saisit à la main,
  proposer de la créer inviterait à fabriquer un doublon. Il reste en place sur une colonne
  inconnue, même après une tentative refusée : un refus ne doit pas priver la colonne de ses
  options normales.
- **`buildImportRows` est laissé intact.** Y filtrer les valeurs de terminologie aurait fait
  disparaître des cellules en silence sur un chemin qui contourne l'écran. Le refus vit au mappage,
  où il s'explique ; le rejet de dernier recours reste au serveur, où il est la source de vérité.

### À noter pour le lot qui traitera vraiment l'import

Rien de tout cela n'est implémenté ici : le format d'entrée naturel sera celui de la sortie —
libellés séparés par `; ` dans une colonne unique — et la route « plusieurs colonnes vers un même
champ » reste bloquée par `duplicateTargets`, qui traite toute cible assignée deux fois comme un
conflit.

### Validation locale — niveau 1

- `npm run typecheck` : vert, relancé **après** l'écriture des tests (leçon de L23) ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **63 fichiers, 443/443 tests verts** (442 avant ce lot) ;
- `npx vitest run --project db test/import-domain.test.ts` : **13/13** (6 avant ce lot) — test pur,
  sans base ;
- `npm run build` avec `VITE_USE_SIGNED_READ=true` : vert, PWA régénérée (74 entrées préchargées).

La suite base de données complète n'a pas été relancée : le lot ne touche ni SQL, ni RPC, ni RLS.
C'est la CI qui joue `npm test` sur la PR.

### Publication

Travail mené dans un `git worktree` dédié, par précaution contre les détournements de branche déjà
constatés en session parallèle. PR ouverte vers `develop` ; la fusion revient au porteur.

### Ce qui reste

L26 (regroupement de `diagnostic_1/2/3`, à lancer seul et en dernier), l'import réel des
diagnostics, et le filtrage des diagnostics unitaires nommé pendant L23 (L34). La ligne « Statut »
en tête de `spec-variables-multivaluees.md` cite encore L21 à L26 comme « à livrer » : elle sera à
rafraîchir d'un coup quand la famille sera close, pas lot par lot.

## Lot L25 — Conflit hors-ligne : issue « garder les deux » (2026-08-18)

Front seul, aucune migration. Lot **séparable** : rien n'en dépend et son absence ne produisait
aucune perte silencieuse — le conflit était déjà correctement détecté par le jeton optimiste. Le
lot améliore une résolution, il ne répare pas un trou.

Deux appareils hors ligne ajoutent chacun un diagnostic à la même rencontre. Le premier
synchronise ; le second voit son `baseUpdatedAt` périmé et le conflit remonte. La résolution était
binaire : garder la sienne écrasait le diagnostic ajouté par l'autre.

### Ce qui est livré

- **`mergeKeepBoth` (`src/domain/conflictMerge.ts`)** : fonction de domaine **pure**, testée sans
  base, sans navigateur et sans IndexedDB. Union des listes de terminologie par `code`, ordre
  local puis nouveautés serveur. L'union n'est possible que parce que chaque valeur porte un
  identifiant stable — son code ; sur un champ à valeur unique, deux versions ne se fusionnent pas.
- **La fusion est une variante de « garder ma version »**, pas un troisième arbitrage : toutes les
  clés viennent de ma version, seules les clés portant une liste **des deux côtés** sont unies. Le
  libellé d'un code partagé reste le mien — le code est l'identité, le libellé n'est que
  l'instantané pris à la saisie. Une liste face à un code de donnée manquante n'a rien à unir, et
  une clé présente seulement côté serveur n'est pas reprise : sans valeur de base, un ajout de
  l'autre appareil ne se distingue pas d'une suppression de ma part.
- **`resolveKeepBoth` (`src/data/offline.ts`)** appelle la fonction de domaine et rien de plus.
  `resolveKeepMine` et elle partagent désormais `applyResolution` — un seul chemin d'écriture,
  donc pas de divergence possible entre les deux issues.
- **`SyncCenter.tsx`** : le bouton, plus un **aperçu du résultat fusionné** à côté des deux
  versions, avec le nombre de valeurs récupérées. L'écran ne réimplémente aucune règle : il
  affiche exactement ce que l'action écrira.

### Le point 3 : quand l'issue a-t-elle un sens

Le bouton n'apparaît **que si la fusion change quelque chose**, c'est-à-dire si elle sauve au moins
une valeur que « garder ma version » détruirait. Un conflit qui ne porte que sur des champs à
valeur unique n'a rien à fusionner ; proposer une fusion impossible serait pire que ne rien
proposer, parce que le bouton promettrait un sauvetage qui n'a pas lieu. Le cas « la liste serveur
est déjà incluse dans la mienne » tombe sous la même règle.

La visibilité est **dérivée de la fusion elle-même** (`mergedKeys` non vide), jamais d'un prédicat
parallèle : le bouton et l'action ne peuvent pas se contredire. Aucun dictionnaire de champs n'est
requis — la forme de la valeur suffit, ce qui vaut aussi hors connexion et pour une rencontre
saisie sous une version de gabarit antérieure.

### Le point 4 : idempotence du rejeu, vérifiée

`OutboxEntry` est inchangé — c'est cette forme, l'objet `data` complet sous garde de
`baseUpdatedAt` et d'un `operationId`, qui a fait que les listes de diagnostics n'ont demandé aucun
travail hors-ligne.

L'empreinte serveur (`replay_encounter_update`) porte sur `encounter_id + data + validation_status
+ reason + expected_updated_at`. Réutiliser l'`operationId` avec une charge différente lèverait
`OFFLINE_OPERATION_MISMATCH` — **sauf que la tentative en conflit a été intégralement annulée** :
l'insertion de l'accusé et `update_encounter` sont dans la même transaction, donc aucune ligne ne
survit à un conflit et la clé est libre. C'est déjà ce qui autorise `resolveKeepMine` à rejouer
sous la même clé en passant `expected` de `baseUpdatedAt` à `null`.

Reste la vraie garantie : si le commit réussit et que la réponse réseau se perd, un rejeu doit
retrouver l'accusé au lieu de réécrire. Cela exige une charge **déterministe** — d'où la fonction
pure, calculée depuis la seule entrée d'outbox et jamais depuis un nouvel appel réseau. Trois tests
le verrouillent : deux appels produisent la même charge à l'octet près ; refusionner un résultat
déjà fusionné ne le change plus ; un second déclenchement ne rejoue rien, l'entrée ayant disparu.

**Limite assumée**, conforme à la décision prise avant l'écriture : l'écriture est forcée
(`expected = null`), comme « garder ma version ». Une écriture d'un troisième appareil survenue
entre la détection du conflit et le clic serait écrasée. La rendre détectable demanderait de
conserver le jeton serveur sur l'entrée et d'écrire un chemin de re-conflit — c'est un autre lot.

### Validation locale — niveau 1

- `npm run typecheck` : vert (relancé **après** l'écriture des tests, leçon de L23) ;
- `npm run lint` : vert, 0 warning ;
- `npm run test:web` : **65 fichiers, 466/466 tests verts** (442 avant ce lot, +24) ;
- `npm run build` avec `VITE_USE_SIGNED_READ=true` : vert, PWA régénérée (74 entrées préchargées).

La suite PostgreSQL/RLS n'est pas touchée : ce lot ne crée ni table, ni politique, ni migration.
C'est la CI qui joue `npm test` sur la PR.

### Publication

PR #229 ouverte vers `develop`, **non fusionnée** : la fusion revient au porteur, sur sa consigne.
Lot mené dans un `git worktree` dédié dès le départ — le répertoire de travail est partagé avec
d'autres sessions, et L24 y était en cours. L24 ayant été fusionné (PR #228) pendant la CI de
celle-ci, la branche a intégré `develop` : le seul conflit portait sur la fin de ce document, où
les deux lots ajoutaient leur compte rendu.

### Ce qui reste

L26 (regroupement de `diagnostic_1/2/3`, à lancer seul et en dernier), seul lot de la famille
encore ouvert après L24. S'y ajoutent le filtrage des diagnostics unitaires (L34, opérateur
serveur), l'import réel des diagnostics, et — pour qui voudra le pousser — la détection d'un
troisième écrivain à la résolution d'un conflit.
