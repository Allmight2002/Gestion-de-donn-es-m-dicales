# Pipeline de release coordonnee

La procedure executable est `.github/workflows/coordinated-release.yml`. Elle est manuelle
(`workflow_dispatch`) : aucun de ses jobs ne deploie un cloud depuis ce depot local.

GitHub exige qu'un workflow `workflow_dispatch` existe sur la branche par defaut. Pour conserver
`main` comme branche de production sans y fusionner une release avant validation staging, la
branche par defaut du depot est `develop`. Ce reglage GitHub est independant de la branche de
production Vercel, qui reste `main`.

## Avant et maintenant

Avant, `.github/workflows/ci.yml` executait tests et build, tandis que migrations, Storage,
fonctions Edge, scanner, E2E staging et Vercel etaient manuels. Un frontend pouvait donc etre
publie avant son backend. Le nouveau CI de PR ajoute la validation des variables publiques,
l'application vierge des migrations et le contrat des six fonctions. Le workflow de release fige
un SHA et impose l'ordre backend puis frontend.

## Secrets et environnements

Configurer les environnements GitHub `staging` et `production` avec :

- frontend : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`;
- Supabase : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`,
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- sauvegarde : `STORAGE_BACKUP_ENCRYPTION_KEY`, cle AES-256 en base64 propre a chaque
  environnement, conservee hors du depot et separee des artefacts chiffres;
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
2. `backend-staging` valide les secrets et la cible exacte, cree puis verifie une sauvegarde
   chiffree coordonnee DB + Storage, et conserve cet ensemble hors du runner pendant 30 jours.
   Une erreur de sauvegarde, verification ou archivage bloque toute ecriture cloud. Il pousse
   ensuite les migrations, applique `storage.sql` dans une transaction et verifie buckets/policies.
3. Il découvre et déploie toutes les fonctions déclarées dans `supabase/functions/`
   (dont `finalize-upload`), puis exécute `env:check:cloud`, `release:drift` et E2E.
4. `frontend-staging` reconstruit le frontend depuis le SHA fige (`npm ci` depuis le lockfile +
   memes variables `VITE_*` forcees), produit l'artefact Vercel avec `vercel pull` puis
   `vercel build`, et le deploie avec `--prebuilt` seulement apres ces gates : aucun
   artefact `dist/` n'est promu entre jobs, c'est le meme SHA immuable qui garantit l'egalite.
5. Pour production, un approbateur de l'environnement GitHub protege confirme le rapport staging
   du meme SHA/tag et renseigne son `staging_run_id`; le workflow exige un job
   `backend-staging` reussi pour ce SHA, puis refait une sauvegarde chiffree verifiee avant la
   premiere ecriture production et execute les memes controles avant `vercel deploy --prod`.

Tout echec stoppe les jobs dependants et bloque le frontend. `vercel.json` desactive les
deploiements automatiques issus de Git pour toutes les branches : les previews staging et la
production doivent passer par la CLI du workflow coordonne. Verifier aussi ce comportement dans
le projet Vercel apres chaque changement d'integration. Configurer les reviewers obligatoires
pour `production` et les protections de branche exigeant CI.

Les CLI de release sont figees dans le workflow (`supabase@2.109.1`, `vercel@55.0.0`) afin qu'un
nouveau `latest` publie entre deux releases ne modifie pas silencieusement la procedure.

## Drift, rapports et limites

`release:drift` compare l'historique de migrations, la RPC stricte, les policies Storage et la
presence des fonctions listees par le CLI. `env:check:cloud` compare le mode strict DB/release.
Le manifeste/artifact conserve 30 jours fige le SHA (court et complet), la branche, la cible
(staging/production), le workflow et le run, la liste des migrations attendues, les six fonctions
Edge attendues, le hash SHA-256 de `storage.sql` et l'heure de generation. Ni checksum Storage ni commit source des fonctions ne sont
exposes de facon portable par Supabase : joindre la sortie du workflow comme preuve et effectuer
la validation manuelle explicite; ne pas presenter cette verification comme automatique.

## Rollback et echec partiel

La sauvegarde logique pre-release est une protection complementaire, pas une preuve de readiness
production : les exports DB et Storage ne forment pas un snapshot transactionnel commun. Elle ne
remplace ni les sauvegardes managees/PITR, ni une copie hors site immuable, ni un RPO/RTO approuve,
ni une restauration periodiquement testee. Toute utilisation avec donnees reelles exige aussi que
GitHub soit approuve comme sous-traitant pour la conservation temporaire de l'artefact chiffre et
que la cle reste recuperable depuis un gestionnaire distinct.

- Frontend : redeployer le precedent deployment Vercel, puis smoke tests.
- Functions : redeployer les six fonctions depuis le tag/SHA precedent, puis verifier drift/E2E.
- Configuration : restaurer les secrets precedents, sans les coller dans logs ou tickets.
- Storage : reappliquer le `storage.sql` du SHA precedent et conserver son hash/verification.
- Base : les migrations sont forward-only. Pour une migration reversible, backup teste et migration
  descendante revue sont requis. Pour une migration destructive, isoler via feature flag, restaurer
  un backup ou ecrire une migration corrective compatible; `db push` n'est pas un rollback.

En incident, stopper la promotion, consigner SHA/migration/hash/fonctions atteints, corriger ou
restaurer, puis rejouer staging avant toute nouvelle production.
