# Feuille de route — reprise du développement malgré les gates de production

- Porteur : Dr Mbassi
- Date de cadrage : 2026-07-26
- Statut : cadre documentaire et Phase 0 intégrés ; interphase
  B3 → B4 → B8 → B1 → B9 terminée sur le candidat staging fictif
  `ebee17910f6de005ab933ee08978d2e97686d19d` ; Phase 1 suivante
- Source des idées : [`idees-post-readiness.md`](idees-post-readiness.md)
- Référence de production : [`readiness-production-2026-07-19.md`](readiness-production-2026-07-19.md)
- Prompt d'exécution autonome :
  [`prompt-execution-autonome-feuille-route.md`](prompt-execution-autonome-feuille-route.md)
- Journal d'exécution :
  [`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md)

## 1. Décision de cadrage

La fermeture de tous les blocages B1–B10 n'est plus une précondition pour
concevoir, développer et tester de nouvelles fonctionnalités. Les gates de
readiness servent désormais à décider **jusqu'où un changement peut aller**,
pas à interdire sa construction.

Une contrainte d'ordre a été ajoutée par le porteur le 2026-07-26 : après la
Phase 0, le chantier de readiness déjà engagé doit être finalisé dans l'ordre
**B3 → B4 → B8 → B1 → B9** avant de commencer la Phase 1 ou toute autre
nouvelle fonctionnalité. B2, B6, B7 et B10 restent différés selon les contrôles
compensatoires ci-dessous.

Trois niveaux sont séparés :

1. **Développement local** : autorisé avec données entièrement fictives.
2. **Staging isolé** : possible avec données entièrement fictives, après
   autorisation explicite de déploiement et validation du SHA exact.
3. **Production, pilote clinique ou données réelles/pseudonymisées** : toujours
   interdit tant que tous les gates applicables ne sont pas réellement fermés.

Une modification ne « détruit » pas les anciennes preuves : celles-ci restent
valables pour leur ancien SHA. Elle crée simplement un nouveau candidat qui
doit produire ses propres preuves avant de progresser vers staging ou
production.

## 2. Traitement des blocages différés

Les blocages ci-dessous restent **ouverts pour la production**, mais ne bloquent
plus le développement local.

| Gate | Motif du report | Développement local | Staging fictif isolé | Ce qui reste interdit | Contrôle compensatoire |
|---|---|---|---|---|---|
| **B2 — antivirus** | Aucun serveur ClamAV durable disponible actuellement | Autorisé ; mocks et scanner local possibles | Autorisé pour les parcours sans document ; tout parcours de fichier reste fail-closed si le scanner manque | Document réel, upload non inspecté, pilote et production | Garder l'upload désactivé ou refusé lorsque l'inspection stricte n'est pas disponible ; ne jamais simuler une preuve antivirus distante |
| **B6 — juridique et gouvernance** | Documents, avis et autorisations externes non encore obtenus | Autorisé avec fixtures purement fictives | Autorisé dans un environnement privé, isolé et réinitialisable, avec données fictives seulement | Donnée réelle ou pseudonymisée, utilisateur externe, recherche, décision clinique, publication et production | Étiquetage explicite « démonstration/QA », purge des fixtures et aucune réutilisation d'un dossier réel |
| **B10 — organisation** | Équipe, suppléances, support et QA formelle non encore constitués | Autorisé sous responsabilité directe du porteur | Exercices fictifs autorisés ; le porteur peut assumer les rôles continuité et release manager pour ces exercices | Exploitation clinique ou production sans titulaires, suppléants, support, formation, MFA et QA signée | Un lot à la fois, décisions consignées, runbooks maintenus et acceptation du porteur avant toute promotion |

**B7 est fermé techniquement depuis le 2026-08-01.** Le flux
`branche de travail → develop → main`, les checks CI et les protections live sont
désormais contrôlés par GitHub ; la revue par un tiers reste suspendue par la
dérogation mono-personne documentée.

Les autres gates restent des **portes de validation du candidat**, et non un gel
général du travail local. B3, B4, B8, B1 et B9 font toutefois l'objet de
l'interphase obligatoire demandée par le porteur avant toute nouvelle
fonctionnalité. Toute évolution qui touche directement un gate doit aussi
fournir ses tests et ses preuves ciblées avant fusion dans `develop`.

## 3. Mandat d'autonomie pour les futurs lots

Une fois qu'un lot de cette feuille de route est explicitement lancé par le
porteur, le modèle peut travailler sans demander une confirmation à chaque
étape pour les opérations locales, réversibles et contenues dans ce lot :

- lire et modifier le code, les tests et la documentation du dépôt ;
- créer une branche de travail depuis `develop` ;
- ajouter uniquement des migrations nouvelles, additives et compatibles ;
- installer ou mettre à jour les dépendances nécessaires au lot et son lockfile ;
- lancer les services locaux, la base de test, les tests, audits et builds ;
- corriger les échecs directement causés par le lot ;
- utiliser uniquement des comptes et données fictifs ;
- tenir à jour la présente feuille de route, la file d'idées, l'architecture et
  les procédures affectées ;
- créer des commits locaux bornés lorsque les critères de sortie du lot sont
  remplis, si le lancement du lot autorise le niveau local ci-dessous.

Pour éviter les micro-autorisations, le lancement d'un lot précise une seule
fois son niveau maximal :

| Niveau | Formulation simple | Autorisation continue pendant le lot |
|---|---|---|
| **A — local** | « Lance le lot X en autonomie locale » | Branche de travail, code, migrations additives, tests, documentation et commits locaux ; aucun push |
| **B — GitHub** | « Lance le lot X jusqu'à la PR vers develop » | Niveau A, push de la branche de travail et création/mise à jour de la PR vers `develop` ; aucune fusion |
| **C — staging** | « Lance le lot X jusqu'à la validation staging uniquement » | Niveaux A et B, puis opérations distantes limitées à staging après contrôles de sécurité ; jamais production |

Sans niveau explicite, le niveau A s'applique mais s'arrête avant le commit. Une
réponse « continue » pendant un lot conserve le niveau déjà autorisé ; elle
n'élargit jamais le périmètre vers la production.

L'autonomie s'arrête obligatoirement avant :

- un push ou une pull request, sauf si le niveau B ou C a été explicitement
  autorisé au lancement du lot ;
- toute fusion dans `develop` ou `main`, qui requiert toujours une décision
  séparée ;
- un déploiement, une migration distante, une Edge Function distante ou un
  changement Vercel/Supabase limité à staging, sauf si le niveau C a été
  explicitement autorisé ;
- une rotation de secret ou un changement GitHub qui dépasse le push et la PR
  permis par le niveau B ou C ;
- toute action en production ;
- l'utilisation d'une donnée réelle ou pseudonymisée ;
- une suppression irréversible, un achat, un engagement juridique ou l'envoi
  d'un message à un tiers.

Le modèle doit également s'arrêter si un test de sécurité/RLS échoue, si une
migration risque de perdre des données, si un secret apparaît, si le périmètre
du lot doit être élargi de façon importante ou si une décision métier non
réversible n'est pas couverte par la spécification.

## 4. Cycle commun à chaque fonctionnalité

Chaque évolution suit le même chemin :

1. **Cadrer** — besoin utilisateur, périmètre, critères d'acceptation et risques.
2. **Décider** — utiliser les recommandations déjà documentées lorsque le
   porteur les a approuvées ; regrouper les vraies décisions restantes en une
   seule demande plutôt que d'interrompre le travail plusieurs fois.
3. **Isoler** — créer une branche `codex/<nom-du-lot>` depuis `develop`.
4. **Construire** — domaine/base/Edge avant l'interface lorsque la sécurité ou
   l'intégrité dépend du serveur.
5. **Prouver** — tests ciblés, typecheck, lint, tests pertinents, audit des
   dépendances et build selon le risque.
6. **Documenter** — architecture, migrations, variables, procédures et statut
   de l'idée mis à jour dans le même lot.
7. **Faire accepter** — démonstration locale et résumé en langage simple.
8. **Promouvoir** — seulement après autorisation : branche de travail vers
   `develop`, puis `develop` vers `main` lors d'une décision de release séparée.
9. **Stager** — seulement sur autorisation explicite, avec fixtures fictives,
   SHA exact, smoke tests et plan de retour arrière.

`main` reste une branche de release. L'accumulation des nouvelles fonctions se
fait sur des branches de travail puis dans `develop` ; elle n'oblige pas à
publier une nouvelle production.

Pour tout lot touchant PostgreSQL, RLS, RPC, Storage, concurrence, idempotence,
sauvegarde ou risque de perte, appliquer `meddata-db-safety`. Avant fusion,
utiliser `validate-audit-lots` ; avant staging ou décision de release, utiliser
`meddata-release-check` au niveau approprié.

## 5. Ordre de réalisation proposé

### Phase 0 — assainir le nouveau socle de développement

**Objectif :** repartir d'une base sans exception de dépendance temporaire.

1. Mettre React Router à niveau vers une combinaison réellement corrigée et
   compatible, sans nouvelle exception d'audit.
2. Ajouter les tests de navigation et de redirection internes.
3. Supprimer l'exception CI temporaire React Router après un audit propre.
4. Produire un nouveau baseline local vert et le documenter.

Décision d'exécution du 2026-07-26 : la ligne 7 corrige les trois avis initiaux
en `7.18.1`, mais l'avis `GHSA-qwww-vcr4-c8h2`, publié ensuite et corrigé
uniquement en `8.3.0`, rend impossible un audit propre sur cette ligne. Ajouter
une nouvelle exception étant interdit, le socle passe à React Router 8.3,
React 19.2.8 et Node 22.22 minimum. Le mode déclaratif existant est conservé et
la migration n'est acceptée qu'avec la suite complète verte.

**Sortie :** audit sans vulnérabilité modérée, haute ou critique, routes
critiques testées, typecheck/lint/tests/build verts. Cette phase ne nécessite ni
serveur ClamAV ni GitHub Pro.

### Interphase readiness — finaliser le chantier antérieur

**Objectif :** terminer les preuves déjà engagées avant tout ajout fonctionnel.

1. **B3** — produire et vérifier la sauvegarde coordonnée du SHA candidat avec
   la clé séparée et la copie immuable attendues.
2. **B4** — restaurer cette sauvegarde dans l'environnement isolé, mesurer RPO
   et RTO et valider le JSON de preuve.
3. **B8** — exécuter le rollback puis le forward recovery du même SHA et en
   vérifier l'intégrité.
4. **B1** — démontrer l'alignement exact frontend, base, Storage et six Edge
   Functions sur staging fictif.
5. **B9** — rejouer le contrôle distant des fonctions privilégiées ainsi que
   les tests RLS/RPC, puis consigner l'acceptation sécurité du candidat.

**Sortie :** B3, B4, B8, B1 et B9 disposent de preuves actuelles liées au même
SHA et à staging. Si une capacité distante indispensable manque, tout travail
indépendant est poursuivi puis le point est classé conformément aux conditions
d'arrêt du mandat ; aucune Phase 1 ne commence tant que cette interphase n'est
pas finalisée.

**Résultat du 2026-07-26 :** interphase terminée sur
`ebee17910f6de005ab933ee08978d2e97686d19d`. Les sauvegarde/restauration,
rollback/forward recovery, composants staging et contrôles ACL/RLS/RPC portent
sur ce même candidat ; les preuves immuables et les incidents rencontrés sont
référencés dans
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md).
B2 reste ouvert et les parcours fichiers sont exclus : l'échec réel du scanner
dans le run coordonné n'a pas été transformé en succès. Cette limite ne bloque
plus la Phase 1, qui ne dépend d'aucun upload.

### Phase 1 — valeur rapide et défauts visibles

**Lot 1V — bibliothèque de jeux de valeurs (idée 5, préalable au lot 1A)**

Ajouté le 2026-07-26 pendant le cadrage du lot 1A. Une liste contrôlée ne vaut
que si elle peut être garnie : saisir trente valeurs à la main renvoie
l'utilisateur au texte libre. Ce lot fournit des listes prêtes à l'emploi
insérables dans un champ `select`, par copie et non par référence, et rend la
saisie des valeurs réellement utilisable. Il précède le lot 1A, car livrer un
canevas que personne ne peut adapter n'aurait pas de sens.

**Lot 1A — registre « Diagnostic urgences » noyau (idée 4a)**

- préparer un canevas à listes contrôlées avec données fictives ;
- ne faire aucun développement de référentiel complexe ;
- tester avec un petit jeu de scénarios fictifs ;
- recueillir les retours sur la facilité de saisie et l'utilité analytique.

**Lot 1B — corrections UX D1 et D2**

- rendre visible l'échec de suppression d'un gabarit et fermer correctement la
  confirmation ;
- verrouiller le défilement derrière le menu mobile et vérifier la hauteur
  dynamique sur mobile/émulateur.

**Sortie :** première valeur démontrable sans donnée réelle et deux irritants
connus corrigés.

### Phase 2 — cycle sûr de suppression et restauration des bases

1. Spécifier et construire d'abord la capacité serveur de restauration d'une
   base supprimée, avec permissions, audit et tests RLS.
2. Ajouter ensuite l'interface de suppression avec confirmation forte, motif et
   saisie du nom de la base.
3. Ajouter l'interface de restauration et une vue claire des bases supprimées.
4. Tester propriétaire/non-propriétaire, double clic, retry, concurrence,
   suppression, restauration et audit.

**Sortie :** aucune action de suppression exposée dans l'interface sans chemin
de récupération vérifié.

### Phase 3 — observabilité des erreurs sans donnée patient

Suivre [`spec-observabilite-erreurs.md`](spec-observabilite-erreurs.md) :

1. capture frontend et filet global ;
2. puits DB privacy-safe, RLS/RPC et anti-flood ;
3. écran admin « État du système » ;
4. agrégation, purge et notification expurgée ;
5. capture Edge en phase ultérieure.

Le développement local est autorisé même si B5 n'est pas encore totalement
clos. La fonctionnalité ne sera déclarée opérationnelle à distance qu'après une
alerte staging reçue et une vérification qu'aucun contenu patient ne quitte le
système.

### Phase 4 — comptes de mission

Avant de coder, valider en une seule fois les six choix de
[`spec-comptes-mission.md`](spec-comptes-mission.md). À défaut d'une décision
contraire lors du lancement, les recommandations proposées servent de base de
travail pour le prototype fictif ; les points juridiques restent non
activables en production.

Découpage :

1. migration additive, permissions, expiration et tests RLS ;
2. Edge Function d'invitation idempotente ;
3. parcours médecin et saisisseur ;
4. expiration, prolongation, révocation et soumission ;
5. E2E fictif sur staging après autorisation.

L'upload de documents reste exclu de la v1, ce qui découple ce chantier de B2.

### Phase 5 — terminologie diagnostique avancée

Cette phase ne commence que si le noyau « Diagnostic urgences » démontre un
besoin réel : listes trop longues, synonymes fréquents, analyses impossibles ou
besoin d'interopérabilité.

**Décision du 2026-07-26 : la phase est lancée sans attendre le noyau 4a.** Le
porteur a écarté la liste courte par service, au motif qu'un patient est
hospitalisé dans le service traitant sa pathologie principale mais porte aussi
des comorbidités relevant d'autres spécialités : une liste restreinte au service
recréerait donc le manque qu'elle devait supprimer. Le besoin d'une recherche
incrémentale est ainsi établi par le raisonnement métier, sans qu'un pilote soit
nécessaire pour le démontrer. Le lot T1 pose la structure du référentiel ; le
critère d'arrêt ci-dessous reste applicable aux étapes suivantes.

1. mesurer les limites du noyau ;
2. spécifier les identifiants stables, synonymes, versions et gouvernance ;
3. prototyper la recherche/typeahead ;
4. traiter les diagnostics multiples et leurs attributs ;
5. envisager la CIM seulement après validation du modèle métier.

**Critère d'arrêt :** ne pas construire ce sous-système si la liste contrôlée
simple suffit au pilote fictif.

## 6. Priorités et dépendances

| Priorité | Chantier | Dépendance principale | Peut commencer sans B2/B6/B7/B10 ? |
|---|---|---|---|
| P0 | React Router et baseline | Aucune infrastructure externe | Oui |
| P0R | Finalisation B3 → B4 → B8 → B1 → B9 | Staging fictif et preuves exact-SHA | Oui, sous les limites de chaque gate |
| P1 | Registre urgences 4a | Interphase P0R terminée, puis canevas et retours métier fictifs | Oui |
| P1 | UX D1/D2 | Interphase P0R terminée, puis tests web/mobile | Oui |
| P2 | Suppression + restauration | Revue DB/RLS et garde-fous destructifs | Oui |
| P2 | Observabilité | Règles de minimisation ; B5 seulement pour la preuve distante | Oui |
| P3 | Comptes de mission | Six décisions métier, DB/RLS et Edge | Oui, sans upload ni données réelles |
| P4 | Terminologie 4b | Validation terrain du noyau 4a | Oui pour prototype, mais seulement si le besoin est prouvé |

## 7. Définition de « terminé » pour un lot

Un lot est terminé localement lorsque :

- ses critères d'acceptation sont démontrés avec données fictives ;
- ses chemins d'échec, permissions et cas de rejeu sont testés ;
- aucune sécurité n'est déplacée du serveur vers la seule interface ;
- typecheck, lint et tests pertinents sont verts ;
- les migrations repartent de zéro lorsqu'elles sont affectées ;
- les dépendances et le build sont validés lorsqu'ils sont affectés ;
- la documentation et la file d'idées reflètent l'état réel ;
- les limites staging/production restantes sont explicitement listées.

« Terminé localement » ne signifie jamais « prêt pour la production ».

## 8. Réévaluation des blocages

B2, B6 et B10 sont revus à l'occasion d'un changement de capacité externe,
pas à chaque fonctionnalité :

- **B2** : lorsqu'un hébergement ClamAV durable devient disponible ;
- **B6** : lorsqu'un avis, accord, DPA ou DPIA/AIPD signé est obtenu ;
- **B7** : le gate technique est fermé ; réévaluer uniquement lorsqu'un second
  relecteur existe afin de lever la dérogation mono-personne ;
- **B10** : lorsqu'une équipe réelle, des suppléances, le support, la formation
  et la QA peuvent être nommés et exercés.

Jusqu'à ces événements, ils ne doivent pas provoquer de demandes répétées ni
interrompre les lots locaux. Ils doivent seulement être rappelés lorsque le
travail approche une limite qu'ils protègent.
