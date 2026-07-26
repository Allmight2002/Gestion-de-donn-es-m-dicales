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
| P1A | Registre « Diagnostic urgences » noyau | À faire | — | — | Fictif uniquement | Retour métier requis avant 4b |
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

### Limite explicite

La vérification sur un vrai mobile ou un émulateur **n'a pas été faite**. jsdom
ne reproduit ni le repli de la barre d'adresse ni les unités de viewport
dynamiques : le test prouve le verrou de défilement, pas la disparition visuelle
de l'espace. D2 reste à confirmer visuellement.
