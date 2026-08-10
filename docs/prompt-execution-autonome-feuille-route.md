# Prompt prêt à envoyer — exécution autonome de la feuille de route

- À joindre au prompt :
  [`feuille-route-developpement-post-readiness.md`](feuille-route-developpement-post-readiness.md)
- Périmètre : développement, Git, GitHub et staging fictif
- Exclusion permanente : production et données réelles/pseudonymisées
- Ce document donne un mandat à utiliser dans une future tâche ; il ne lance
  aucune opération à lui seul.

## Texte à copier et envoyer

Tu travailles dans le dépôt MedData (`registre-clinique`). Lis entièrement
`AGENTS.md`, la feuille de route jointe
`docs/feuille-route-developpement-post-readiness.md`,
`docs/idees-post-readiness.md`, `docs/architecture.md`, le rapport de readiness
actuel et les spécifications directement concernées avant de modifier le
produit.

### Objectif

Exécute la feuille de route post-readiness de bout en bout, dans l'ordre prévu,
en commençant par l'intégration de la documentation actuelle puis par la
Phase 0 React Router. Travaille lot par lot et termine complètement un lot
avant de commencer le suivant.

La fermeture de B1–B10 n'est plus une précondition au développement. B2, B6 et
B10 restent ouverts pour la production, mais ne doivent plus interrompre
le développement, les tests, les opérations Git/GitHub ou un staging isolé
utilisant exclusivement des données fictives, sauf lorsqu'un lot dépend
directement de la capacité absente.

### Autorisation explicite et continue

Ce message constitue l'autorisation explicite requise par la feuille de route
pour exécuter **sans redemander confirmation à chaque étape** l'ensemble des
actions suivantes, tant qu'elles restent dans le périmètre de la feuille de
route et hors production :

1. Inspecter tout le dépôt, l'état Git, les branches, les workflows, les PR, la
   CI et les preuves disponibles.
2. Lire et modifier le code, les tests, les migrations additives, les Edge
   Functions, les workflows, les dépendances, le lockfile et la documentation.
3. Utiliser le terminal, Git, GitHub, les outils disponibles, le réseau et les
   identifiants staging déjà configurés, sans jamais afficher un secret.
4. Créer une nouvelle branche de travail `codex/<nom-du-lot>` depuis le dernier
   `develop` vérifié.
5. Préserver et intégrer les documents actuellement modifiés ou non suivis qui
   décrivent le système, après avoir vérifié qu'ils ne contiennent aucun secret
   ni artefact local à exclure.
6. Installer les dépendances nécessaires, démarrer les services locaux et les
   bases de test, puis exécuter tous les tests, audits et builds pertinents.
7. Corriger automatiquement les échecs causés par le lot, mettre à jour les
   tests et relancer les contrôles jusqu'à obtenir un résultat fiable.
8. Créer autant de commits bornés et lisibles que nécessaire, puis pousser la
   branche de travail sur GitHub.
9. Créer ou mettre à jour une PR de la branche de travail vers `develop`, suivre
   les checks GitHub, diagnostiquer et corriger les échecs, pousser les
   corrections et attendre que la CI soit verte.
10. Fusionner la PR dans `develop` lorsque les critères du lot sont remplis,
    sans push direct vers `develop`.
11. Déclencher et suivre le workflow coordonné avec la cible **staging
    uniquement**, sur le SHA exact, lorsque le lot nécessite une validation
    distante et que les prérequis correspondants sont disponibles. Les
    migrations, Storage, Edge Functions et previews Vercel staging nécessaires
    sont autorisés dans ce cadre.
12. Utiliser uniquement des comptes et données entièrement fictifs sur staging.
    Les alertes de test vers le canal staging déjà configuré sont autorisées si
    elles sont clairement identifiées comme tests et ne contiennent aucune
    donnée sensible.
13. Après validation du lot, créer la PR `develop` vers `main`, attendre sa CI,
    la fusionner, puis vérifier que les arbres de `develop` et `main` sont
    alignés. Cette fusion est une synchronisation du code, pas une autorisation
    de déploiement production.
14. Répéter ce circuit pour chaque lot suivant de la feuille de route sans
    demander de nouvelles autorisations de routine.

Cette autorisation couvre donc explicitement : branche de travail, modifications,
commits, push, PR, suivi et correction de CI, fusion vers `develop`, staging
fictif, PR `develop` vers `main`, fusion et vérification finale des branches.

### Pré-vol obligatoire, sans interruption inutile

Avant le premier changement :

1. vérifie la branche courante, `git status`, les remotes, les écarts avec
   `origin/develop` et `origin/main`, ainsi que l'identité exacte du dépôt ;
2. préserve toutes les modifications utilisateur, suivies ou non suivies ; ne
   fais jamais de reset destructeur, de force-push ou de suppression destinée à
   obtenir artificiellement un arbre propre ;
3. transfère proprement la documentation actuelle vers une nouvelle branche de
   travail issue de `develop`, puis publie d'abord ce cadre documentaire par le
   circuit PR vers `develop`, puis `develop` vers `main` ;
4. vérifie avant toute fusion dans `main` que `vercel.json` conserve
   `git.deploymentEnabled=false` et qu'aucun workflow déclenché par un push sur
   `main` ne déploie en production ;
5. si ce garde-fou a changé, ne fusionne pas dans `main` et classe ce point
   comme blocage nécessitant une décision humaine.

Une fois le cadre documentaire intégré, crée une branche distincte pour chaque
lot fonctionnel. Ne mélange pas plusieurs fonctionnalités indépendantes dans
un même commit ou une même PR.

### Règles de réalisation

- Respecte le flux `branche de travail → develop → main`.
- Utilise un seul agent principal par défaut, conformément à `AGENTS.md`.
- Pour PostgreSQL, migrations, RLS, RPC, Storage, concurrence, idempotence,
  sauvegardes ou risque de perte, applique `meddata-db-safety` et n'édite jamais
  une migration historique.
- Pour un lot de correction borné, applique `apply-audit-lot` lorsque pertinent.
- Avant fusion, applique `validate-audit-lots` ; avant staging ou promotion,
  applique `meddata-release-check` au niveau approprié.
- La base et l'autorisation serveur restent la source de vérité. Ne déplace
  jamais une protection dans l'interface seule.
- N'affaiblis jamais RLS, les tests, l'audit de dépendances, l'inspection
  fail-closed ou un workflow pour rendre un résultat vert.
- Pour les choix réversibles d'un prototype fictif, utilise les recommandations
  inscrites dans les spécifications et consigne-les comme hypothèses. Ne
  m'interromps pas pour ces choix.
- Pour les comptes de mission, les recommandations documentées peuvent servir
  de valeurs par défaut du prototype : patient minimal autorisé, mission de
  24 mois prolongeable, identité désactivée par défaut, aucun upload en v1,
  purge à 12 mois provisoire et rôle technique `saisisseur`.
- Ne fabrique jamais une preuve distante. Distingue clairement ce qui est passé,
  échoué, ignoré, indisponible ou à vérifier extérieurement.

### Traitement des blocages connus

- **B2** : l'absence de serveur ClamAV ne bloque pas les lots sans documents.
  Pour les parcours de fichiers, conserve le refus fail-closed, utilise des
  mocks/tests locaux si utile et marque la preuve distante indisponible. Ne
  contourne pas le scanner.
- **B6** : aucune donnée réelle ou pseudonymisée, aucun utilisateur clinique,
  aucune décision médicale, recherche ou publication. Les données fictives
  restent autorisées.
- **B7** : l'absence de GitHub Pro est compensée par les PR, la CI contrôlée
  manuellement, l'absence de push direct vers `develop`/`main` et la
  traçabilité des SHA. Elle ne doit pas provoquer une pause automatique.
- **B10** : pour les exercices fictifs, j'assume les rôles de porteur,
  responsable continuité et release manager. Cela ne vaut pas organisation de
  production.

Un gate externe différé et sans lien direct avec le lot n'empêche pas la fusion
du code dans `develop` puis l'alignement de `main`, si les tests locaux et la CI
sont verts. Dans ce cas, indique expressément que le staging complet ou la
production readiness n'est pas démontré.

### Validation minimale par lot

Commence par les tests ciblés, puis élargis selon le risque. Utilise les scripts
réels du dépôt, notamment lorsque pertinents :

- `npm run typecheck` ;
- `npm run lint` ;
- `npm run test:web` ;
- `npm run test:rls` ;
- `npm test` ;
- `npm run db:verify` ;
- `npm run release:edge:check` ;
- contrôles Edge fmt/lint/check/test ;
- audit des dépendances dans la portée adaptée ;
- build avec les variables de sécurité attendues.

Un échec lié au lot doit être diagnostiqué et corrigé sans me demander
immédiatement quoi faire. Un échec externe ou sans lien doit être caractérisé,
documenté et ne doit bloquer la suite que s'il compromet réellement le niveau
visé.

### Traçabilité obligatoire

La transparence documentaire est une condition de réussite, pas une tâche de
fin facultative :

1. Tiens à jour `docs/idees-post-readiness.md` et la feuille de route au fur et à
   mesure, sans déclarer commencé ou terminé ce qui ne l'est pas.
2. Crée un journal de suivi durable dans
   `docs/suivi-execution-feuille-route.md`. Pour chaque lot, enregistre : date,
   objectif, décisions et hypothèses, branche, commits, PR, fichiers et
   migrations, tests exécutés, résultats, CI/run IDs, staging éventuel, limites
   et prochain lot.
3. Documente dans le même commit toute modification d'architecture, de schéma,
   de variable, de workflow, de procédure ou de comportement utilisateur.
4. N'inscris jamais de valeur de secret, de jeton, de mot de passe, de donnée
   médicale ou de journal interne brut dans la documentation ou le compte rendu.
5. Les anciennes preuves restent rattachées à leur ancien SHA ; toute nouvelle
   preuve doit indiquer son SHA et son environnement exacts.

### Seules conditions autorisant un arrêt et une question

Ne t'arrête pas pour les opérations Git ordinaires, les choix techniques
réversibles, les corrections CI dans le périmètre ou les gates externes déjà
différés. Arrête-toi uniquement si au moins une de ces situations est réelle :

- une action toucherait la production ou pourrait la déclencher indirectement ;
- une donnée réelle ou pseudonymisée apparaît ;
- une migration ou opération peut causer une perte de données non prévue ;
- un secret a été exposé ou doit être remplacé ;
- une décision métier, clinique ou juridique irréversible n'est pas couverte ;
- les identifiants/permissions indispensables sont absents et aucune voie sûre
  disponible ne permet de continuer ;
- un test critique de sécurité, RLS ou intégrité reste rouge après diagnostic ;
- le travail exigerait un achat, GitHub Pro, un nouveau serveur ou une action
  d'un tiers.

En cas d'arrêt, préserve l'état, n'annule aucun travail valide et pose une seule
question précise indiquant l'action minimale attendue. Poursuis tout ce qui
reste indépendant du blocage avant de t'arrêter.

### Interdictions non levées

Même avec ce mandat complet :

- ne déclenche jamais la cible `production` du workflow coordonné ;
- ne déploie, ne migre et ne modifie jamais Supabase ou Vercel production ;
- n'utilise jamais de donnée médicale réelle ou pseudonymisée ;
- ne contourne jamais un contrôle par une exception temporaire non approuvée ;
- ne force-push jamais et ne réécris pas l'historique partagé ;
- ne supprime ni n'écrase les modifications utilisateur hors périmètre ;
- ne prétends jamais qu'un test, un staging ou un service distant a été vérifié
  s'il ne l'a pas été.

### Terminé lorsque

Pour chaque lot :

- le comportement demandé et ses chemins d'échec sont implémentés ;
- les tests pertinents et la CI sont verts, ou chaque indisponibilité externe
  est explicitement classée sans masquer un échec logiciel ;
- la documentation et le journal sont à jour ;
- les commits, branches, PR, fusions et SHA sont traçables ;
- `develop` puis `main` ont été mis à jour dans cet ordre et leurs arbres sont
  comparés ;
- aucun déploiement production n'a eu lieu ;
- le lot suivant peut commencer sans dette implicite.

### Compte rendu final obligatoire

À la fin de chaque lot et à la fin de la tâche, donne un compte rendu en français
simple contenant :

1. résultat utilisateur obtenu ;
2. décisions et hypothèses appliquées ;
3. fichiers, migrations et documentation modifiés ;
4. tests exécutés avec nombres réussis/échoués/ignorés ;
5. branche de travail, SHA des commits, liens des PR et état des fusions ;
6. runs CI et staging, URL de preview si elle existe, sans secret ;
7. état comparé de `develop` et `main` ;
8. gates encore ouverts et portée exacte de ce qu'ils interdisent ;
9. état final du worktree ;
10. prochain lot prévu.

Ne confonds jamais « code fusionné », « CI verte », « staging validé » et « prêt
pour la production ». Continue de manière autonome tant que le travail reste
dans le mandat ci-dessus.
