# Contrôles GitHub exigés avant production

Le script `scripts/verify-github-controls.mjs` vérifie en lecture seule les
protections réellement actives, pas seulement la présence des workflows dans le
dépôt. Il exige :

- `main` et `develop` protégées, avec `build-test` et `scanner-image` obligatoires ;
- au moins une review, invalidation des reviews obsolètes et approbation distincte
  après le dernier push ;
- règles applicables aux administrateurs, sans force-push ni suppression ;
- résolution des conversations ;
- reviewers d'environnement avec auto-approbation interdite ;
- exactement `develop` et `main` autorisées sur `staging`, et uniquement `main`
  sur `production`. L'autorisation de `main` sur staging permet de rejouer la
  validation sur le SHA exact ensuite promu en production ; aucune autre branche
  n'est acceptée.

Le workflow production utilise le secret **`CONTROLS_ADMIN_TOKEN`**, passé au
script sous le nom d'environnement `GITHUB_CONTROLS_TOKEN`. Les deux noms
diffèrent pour une raison de plate-forme : GitHub **réserve le préfixe
`GITHUB_`** et refuse tout secret ou variable qui commence par là. Un secret
nommé `GITHUB_CONTROLS_TOKEN` ne peut pas exister — c'est pourquoi le job
recevait une valeur vide. Ce jeton doit
être finement limité à la lecture des règles d'administration/Actions du dépôt ;
il ne doit permettre ni écriture de contenu, ni modification des protections.
Un HTTP 403, une fonctionnalité indisponible sur le plan souscrit ou une règle
manquante bloque la release.

Ce préflight ne prouve pas la MFA de chaque personne ni la légitimité des accès.
Une revue nominative datée, la MFA et la suppression des droits inutiles restent
des preuves RSSI externes obligatoires.

## Dérogation mono-personne

Décidée le 2026-07-29 par le porteur, après constat en conditions réelles : la
release de production s'arrêtait sur ce contrôle, et les protections exigées ne
pouvaient pas être posées.

**Le problème.** Trois des exigences ci-dessus supposent une **seconde
personne** : la review approuvée, l'approbation distincte après le dernier push,
et l'interdiction de s'auto-approuver sur un environnement. GitHub interdit
d'approuver sa propre pull request. Sur un dépôt tenu par une seule personne, les
activer ne renforce rien — elles rendent toute fusion et tout déploiement
**impossibles**. Un contrôle qui bloque l'exploitation au lieu de la sécuriser
n'est pas un contrôle, c'est une panne.

**Ce qui est suspendu**, et uniquement cela, quand la variable de dépôt
`CONTROLS_SOLO_MODE` vaut `true` :

> Deux noms, volontairement : GitHub **interdit** qu'une variable de dépôt
> commence par `GITHUB_`. La variable de dépôt s'appelle donc
> `CONTROLS_SOLO_MODE`, et le workflow la passe au script sous le nom
> d'environnement `GITHUB_CONTROLS_SOLO`.

- `required_approving_review_count >= 1` ;
- `dismiss_stale_reviews` et `require_last_push_approval` ;
- `prevent_self_review` sur les environnements.

**Ce qui reste exigé, sans changement :**

- pull request **obligatoire** sur `main` et `develop` — la fusion directe reste
  refusée, c'est le cœur du contrôle ;
- `build-test` et `scanner-image` verts avant fusion ;
- règles applicables aux administrateurs ;
- ni force-push ni suppression de branche ;
- résolution des conversations ;
- reviewer d'environnement **présent** — l'approbation de déploiement reste un
  geste délibéré ;
- exactement `develop` et `main` sur `staging`, seule `main` sur `production`.

Autrement dit, la dérogation retire la **relecture par un tiers**, pas la
**barrière technique**. Le mécanisme qui empêche de livrer du code dont la CI est
rouge est intact.

**Traçabilité.** En mode dérogé, le script ne dit pas « OK » : il écrit dans le
journal de release que la dérogation est active et ce qu'elle suspend. La preuve
porte donc la restriction, au lieu de la masquer.

**Condition de levée.** Dès qu'un second relecteur existe, retirer la variable de
dépôt `CONTROLS_SOLO_MODE` : le contrôle complet reprend sans autre modification.
Cette dérogation devra être déclarée telle quelle dans le dossier ANSICE — elle
ne se justifie que par la taille de l'équipe, pas par une analyse de risque.
