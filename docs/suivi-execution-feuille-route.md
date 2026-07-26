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
| D0 | Intégration du cadre documentaire | En cours | `codex/post-readiness-autonomy`, base `b5a0369f8b1f7dc731f48b856f86a47f042d39a4` | À créer | Non requis | Production exclue |
| P0 | React Router et baseline | À faire | — | — | À évaluer | Aucun serveur ClamAV requis |
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

À compléter après commit, push, PR, CI et fusions.
