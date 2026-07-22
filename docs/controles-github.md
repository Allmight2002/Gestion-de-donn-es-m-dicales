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
- uniquement `develop` autorisée sur `staging` et uniquement `main` sur
  `production`.

Le workflow production utilise le secret `GITHUB_CONTROLS_TOKEN`. Ce jeton doit
être finement limité à la lecture des règles d'administration/Actions du dépôt ;
il ne doit permettre ni écriture de contenu, ni modification des protections.
Un HTTP 403, une fonctionnalité indisponible sur le plan souscrit ou une règle
manquante bloque la release.

Ce préflight ne prouve pas la MFA de chaque personne ni la légitimité des accès.
Une revue nominative datée, la MFA et la suppression des droits inutiles restent
des preuves RSSI externes obligatoires.
