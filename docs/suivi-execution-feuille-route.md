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
