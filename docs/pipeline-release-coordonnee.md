# Pipeline de release coordonnee

La procedure executable est `.github/workflows/coordinated-release.yml`. Elle est manuelle
(`workflow_dispatch`) : aucun de ses jobs ne deploie un cloud depuis ce depot local.

## Avant et maintenant

Avant, `.github/workflows/ci.yml` executait tests et build, tandis que migrations, Storage,
fonctions Edge, scanner, E2E staging et Vercel etaient manuels. Un frontend pouvait donc etre
publie avant son backend. Le nouveau CI de PR ajoute la validation des variables publiques,
l'application vierge des migrations et le contrat des cinq fonctions. Le workflow de release fige
un SHA et impose l'ordre backend puis frontend.

## Secrets et environnements

Configurer les environnements GitHub `staging` et `production` avec :

- frontend : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`;
- Supabase : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- scanner : `CLAMAV_SCAN_URL`, `CLAMAV_SCAN_TOKEN`;
- préflight API staging : `STAGING_MEDECIN_EMAIL`, `STAGING_MEDECIN_PASSWORD`;
- E2E navigateur (facultatif) : `STAGING_CURATEUR_EMAIL/PASSWORD`, `STAGING_ADMIN_EMAIL/PASSWORD` ;
  fixtures des parcours métier : `STAGING_E2E_BASE_ID`, `STAGING_E2E_EXPORT_BASE_ID`,
  `STAGING_E2E_EXPORT_COHORT_ID` (absents ⇒ parcours patient/export marqués indisponibles, cf.
  `docs/e2e-browser.md`);
- Vercel : `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

Le pipeline force `VITE_USE_SIGNED_READ`, `VITE_REQUIRE_SERVER_INSPECTION`,
`REQUIRE_SERVER_INSPECTION` et `DB_REQUIRE_SERVER_INSPECTION` a `true`. Les scripts
`release:env` valident presence, formats et coherence sans afficher de valeurs. Seules les
variables `VITE_*` sont publiques; une cle service-role, URL DB ou token scanner ne doit jamais
etre prefixe `VITE_`.

## Staging et production

1. `validate` execute CI, fige le SHA, construit `dist/` comme simple controle de build (le
   frontend n'est PAS deploye depuis ce job) et archive uniquement `deploy-manifest.json`
   (preuve technique de release conservee 30 jours).
2. `backend-staging` valide les secrets, pousse les migrations, applique `storage.sql` dans une
   transaction et verifie buckets/policies.
3. Il découvre et déploie toutes les fonctions déclarées dans `supabase/functions/`
   (dont `finalize-upload`), puis exécute `env:check:cloud`, `release:drift` et E2E.
4. `frontend-staging` reconstruit le frontend depuis le SHA fige (`npm ci` depuis le lockfile +
   memes variables `VITE_*` forcees) puis deploie Vercel, seulement apres ces gates : aucun
   artefact `dist/` n'est promu entre jobs, c'est le meme SHA immuable qui garantit l'egalite.
5. Pour production, un approbateur de l'environnement GitHub protege confirme le rapport staging
   du meme SHA/tag et renseigne son `staging_run_id`; le workflow exige un job
   `backend-staging` reussi pour ce SHA, puis execute les memes controles avant `vercel deploy --prod`.

Tout echec stoppe les jobs dependants et bloque le frontend. Configurer les reviewers obligatoires
pour `production`, les protections de branche exigeant CI, et desactiver toute auto-promotion
Vercel de `main`; ces reglages distants ne sont pas verifiables depuis ce depot.

## Drift, rapports et limites

`release:drift` compare l'historique de migrations, la RPC stricte, les policies Storage et la
presence des fonctions listees par le CLI. `env:check:cloud` compare le mode strict DB/release.
Le manifeste/artifact conserve 30 jours fige le SHA (court et complet), la branche, la cible
(staging/production), le workflow et le run, la liste des migrations attendues, les cinq fonctions
Edge attendues, le hash SHA-256 de `storage.sql` et l'heure de generation. Ni checksum Storage ni commit source des fonctions ne sont
exposes de facon portable par Supabase : joindre la sortie du workflow comme preuve et effectuer
la validation manuelle explicite; ne pas presenter cette verification comme automatique.

## Rollback et echec partiel

- Frontend : redeployer le precedent deployment Vercel, puis smoke tests.
- Functions : redeployer les cinq fonctions depuis le tag/SHA precedent, puis verifier drift/E2E.
- Configuration : restaurer les secrets precedents, sans les coller dans logs ou tickets.
- Storage : reappliquer le `storage.sql` du SHA precedent et conserver son hash/verification.
- Base : les migrations sont forward-only. Pour une migration reversible, backup teste et migration
  descendante revue sont requis. Pour une migration destructive, isoler via feature flag, restaurer
  un backup ou ecrire une migration corrective compatible; `db push` n'est pas un rollback.

En incident, stopper la promotion, consigner SHA/migration/hash/fonctions atteints, corriger ou
restaurer, puis rejouer staging avant toute nouvelle production.
