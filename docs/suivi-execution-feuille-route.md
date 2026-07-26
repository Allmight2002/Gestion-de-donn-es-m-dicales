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
| P0 | React Router et baseline | Validé localement ; promotion en cours | `codex/react-router-v8`, base `5468141a33ad6c7c1596e83e753881cb03ff874f` | À créer après commit | Non requis | Aucun serveur ClamAV requis |
| P0R | Finalisation B3 → B4 → B8 → B1 → B9 | À faire après P0 | — | — | Requis, fictif uniquement | Prérequis à toute nouvelle fonctionnalité |
| P1A | Registre « Diagnostic urgences » noyau | À faire | — | — | Fictif uniquement | Retour métier requis avant 4b |
| P1B | Corrections UX D1/D2 | À faire | — | — | À évaluer | Vérification mobile réelle/émulée |
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
- la CI du commit final reste nécessaire pour lier ces contrôles au SHA publié ;
- aucun staging ni déploiement effectué.

### Ordre suivant imposé

Après clôture et promotion de P0, finaliser B3, B4, B8, B1 puis B9 avant de
commencer le registre urgences, les corrections UX D1/D2 ou une autre nouvelle
fonctionnalité.
