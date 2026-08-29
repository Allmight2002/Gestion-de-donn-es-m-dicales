# LOT 13 — Rapport de validation staging

> **Archive datée.** Le verdict du 12 juillet reste une preuve de ce candidat ; il est dépassé
> pour le SHA actuel par les releases du 1er août, référencées dans
> [`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md).

Date : 2026-07-12 (Africa/Douala)  
Décision : **staging non validé**

## Cible et provenance

- Supabase staging : `meddata-staging`, ref `gmsxrniiclrheehhoakn`, région `eu-west-3`, PostgreSQL 17.6.1.141, état plateforme `ACTIVE_HEALTHY`.
- Branche locale : `fix/post-audit-regressions`.
- HEAD : `5417bfeb2ab10947f02311b9970d4504e5d32064`.
- Version frontend : `registre-clinique@0.1.0`.
- Arbre non immuable : 62 fichiers non suivis et de nombreux fichiers suivis modifiés. Le build ne correspond donc pas à un commit exact.
- Empreinte des 377 fichiers non ignorés au moment du contrôle : `sha256:3f67f83454a8885a920526b1ee781c401cf518317ab1eec89bd732aa7d84b1a9`.
- Build local : 56 fichiers, empreinte agrégée `sha256:581b839f148de1d98660c604fcd43569b1169b546622d292f96d9149c9707548`.
- Storage attendu : `supabase/storage.sql`, `sha256:30ff1d94108d34de3e6382825d84cdede50fff017de5d0017add16f9fb872f82`.
- Frontend staging : aucun déploiement Vercel correspondant à la branche ou au HEAD ci-dessus. Le dernier déploiement observé cible `production` depuis `main`; il n'a pas été utilisé pour les tests.

Le CLI Supabase local est lié à `lrzmbwdnrjjzwossntun` (`registre-clinique`, non staging). Toute action future doit donc fournir explicitement `--project-ref gmsxrniiclrheehhoakn` ou `--db-url` staging. Aucun relink n'a été effectué.

## Résultats réussis

- `npm run db:verify` : les 98 migrations et le seed fictif s'appliquent depuis zéro, 19,5 s.
- `npm run test:rls -- --reporter=verbose` : 368 tests DB/RLS/RPC dans 36 fichiers, code 0, 10 min 24 s.
- `npm run release:edge:check` : six fonctions locales découvertes et conformes au manifeste.
- `npm run edge:fmt`, `edge:lint`, `edge:check` : 23 fichiers contrôlés, succès.
- `npm run edge:test` : 64 tests Deno réussis.
- `npm run typecheck` : succès, 49,4 s.
- `npm run lint` : succès, 40,2 s.
- `npm run test:web` : 139 tests dans 34 fichiers, succès, 94,2 s.
- Build Vite/PWA local avec les variables publiques staging et les drapeaux stricts attendus : succès, 33,92 s. Réserve : chunk principal de 537,60 kB après minification.
- Supabase distant : 30 tables `public` observées avec RLS activée.
- Storage distant : quatre buckets privés présents (`clinical-attachments`, `raw-documents`, `scientific-exports`, `quarantined-uploads`), limite de 20 Mio ; trois policies d'insert avec ticket d'upload ; aucune policy utilisateur sur la quarantaine.
- Comptes distants : deux profils fictifs seulement, un `medecin` et un `curateur`; aucun compte non `@demo.test` observé.
- Scanner local isolé : ClamAV épinglé par digest, conteneur sain, fichier synthétique déclaré `clean`, EICAR déclaré `infected` avec `Eicar-Test-Signature`.
- Inventaire Playwright : neuf scénarios `@critical` disponibles dans trois fichiers, sans exécution distante.

## Contrôles échoués

### Variables et mode strict

Le gate `release:env --target=staging` échoue : `SUPABASE_ACCESS_TOKEN`, `CLAMAV_SCAN_URL`, `VITE_USE_SIGNED_READ=true`, `VITE_REQUIRE_SERVER_INSPECTION=true`, `REQUIRE_SERVER_INSPECTION=true` et `DB_REQUIRE_SERVER_INSPECTION=true` ne sont pas tous fournis dans le contexte local. La base distante confirme `require_server_inspection() = false`.

Les identifiants curateur/admin et les fixtures E2E métier ne sont pas configurés dans `.env.staging`. Seul le compte médecin est directement utilisable depuis ce poste. Les secrets Edge et Vercel distants n'ont pas pu être listés; leur présence n'est pas revendiquée.

### Migrations

Le staging contient 83 migrations, dernière `20260616098300`; le dépôt en attend 98. Les 15 migrations manquantes sont :

1. `20260616098400_quarantine_reconciliation.sql`
2. `20260616098500_server_generated_exports.sql`
3. `20260616098600_import_source_idempotence.sql`
4. `20260710000100_export_integrity_security.sql`
5. `20260710000200_import_chunk_resume_idempotence.sql`
6. `20260710000300_patient_concurrency_atomic_curation.sql`
7. `20260711000100_upload_operation_idempotence.sql`
8. `20260711000200_template_transactionality.sql`
9. `20260711000300_import_resume_historical_guard.sql`
10. `20260712000100_upload_operation_hardening.sql`
11. `20260712000200_cohort_membership_integrity.sql`
12. `20260712000300_verified_upload_finalization.sql`
13. `20260712000400_patient_update_compatibility.sql`
14. `20260712000500_historical_import_replacement.sql`
15. `20260712000600_curation_draft_uniqueness.sql`

Aucune migration distante n'a été appliquée faute d'autorisation explicite.

### Edge Functions

Attendu : `cleanup-upload`, `finalize-upload`, `generate-export`, `inspect-upload`, `reconcile-quarantine`, `signed-read`.

Déployé : uniquement `cleanup-upload` v3, `inspect-upload` v3 et `signed-read` v3. `finalize-upload`, `generate-export` et `reconcile-quarantine` sont absentes. Aucune correspondance entre versions Edge et commit source n'est démontrable.

### Scanner et frontend

- Scanner staging non démontré : aucun tunnel vers le scanner local, aucun log Edge sur les dernières 24 h, base en mode non strict.
- Le token de `.env.staging` diffère du token chargé dans le conteneur local; le test local a été effectué avec le token du conteneur sans l'afficher.
- Frontend staging de cette release absent. Aucun smoke test navigateur n'a donc été lancé.

### Conseillers Supabase

Le conseiller sécurité remonte 189 éléments : 185 `WARN` et 4 `INFO`, notamment 87 fonctions `SECURITY DEFINER` exécutables par `anon`, 92 par `authenticated`, cinq `search_path` mutables et la protection contre mots de passe compromis non activée. Ces éléments doivent être triés avant toute promotion; le présent lot n'est pas un audit global et ne les déclare pas corrigés.

## Tests staging non exécutés

Les tests ci-dessous n'ont pas été exécutés contre la release demandée, car les étapes préalables migrations, fonctions, scanner strict et frontend staging ne sont pas satisfaites.

- Authentification/rôles : médecin, curateur, administrateur, utilisateur sans permission, expiration, révocation, route protégée directe.
- Export : multi-versions, variable retirée/renommée, libellés identiques, âges jours/mois/années, CSV, XLSX, requête forgée, historique, neutralisation des formules.
- Import : multi-chunks, réponse perdue après commit, retry, refresh/reprise, double retry concurrent, clôture exacte, absence de doublons.
- Patients/curation : mise à jour, conflit concurrent, création atomique, échec interne/rollback, double clic, réponse perdue/retry, absence d'orphelin.
- Fichiers : upload accepté/rejeté/pending, timeouts avant/après verdict, retry, absence de doublon, refus de lecture pending/rejetée, EICAR de bout en bout via Edge.
- Hors-ligne : activation, minimisation, refresh, reconnexion, expirations cache/outbox, logout, changement de compte, purge.
- Modèles/suppression : création transactionnelle, clonage, échec intermédiaire/rollback/retry, suppression réussie/refusée, conservation du motif.
- Réseau réel : forte latence, réponse perdue, timeout, coupure pendant écriture, `navigator.onLine === true` avec Supabase indisponible, reconnexion, double soumission.
- Smoke tests, neuf E2E navigateur critiques, treize assertions du preflight API/Storage/ClamAV et tests manuels critiques.

Les suites locales couvrent une part importante de ces règles, mais elles ne remplacent pas les preuves staging.

## Anomalies et risques

1. Release non immuable : HEAD + fichiers suivis modifiés + 62 fichiers non suivis.
2. Drift base : 15 migrations absentes.
3. Drift Edge : trois fonctions attendues absentes.
4. Inspection stricte désactivée; scanner non joignable depuis l'Edge.
5. Aucun frontend staging correspondant au code testé.
6. Comptes/fixtures E2E incomplets, notamment administrateur.
7. 185 avertissements du conseiller sécurité Supabase à qualifier.
8. Premier lancement RLS interrompu à dix minutes, laissant 81 enfants PostgreSQL orphelins; ils ont été arrêtés. Relance propre réussie en série.
9. `npx supabase --version` a échoué sur une incohérence du cache npm local; utiliser CI ou réparer le cache avant une opération CLI locale.

## Actions cloud restantes — ordre obligatoire

1. Produire un commit/tag immuable et un arbre propre; inclure le workflow coordonné actuellement non suivi si cette procédure doit être utilisée.
2. Configurer l'environnement GitHub `staging` avec toutes les variables listées dans `docs/pipeline-release-coordonnee.md`, sans exposer leurs valeurs.
3. Héberger ClamAV sur une URL stable joignable par Supabase Edge et vérifier `/health`.
4. Définir les secrets Edge staging, puis déployer les 15 migrations manquantes avec une cible explicite staging. Ne jamais utiliser le projet lié par défaut.
5. Réappliquer `supabase/storage.sql` dans une transaction et joindre son hash au rapport.
6. Déployer les six fonctions avec `--project-ref gmsxrniiclrheehhoakn`; vérifier l'inventaire et les versions.
7. Activer le mode strict dans l'ordre documenté : scanner, secrets Edge, frontend strict, puis drapeau DB.
8. Exécuter `release:env`, `env:check:cloud`, `release:drift` et `e2e:staging`.
9. Déployer un preview Vercel depuis le même SHA, jamais `--prod`.
10. Exécuter smoke, `e2e:browser:critical`, scénarios réseau et tests manuels; conserver captures/vidéos d'échec.
11. Relever les logs expurgés, durées, versions et anomalies; générer un nouveau manifeste.

Commande recommandée une fois le SHA et les secrets prêts : déclencher `.github/workflows/coordinated-release.yml` avec `target=staging` et `ref=<SHA exact>`. Ne pas sélectionner `production`.

## Rollback et sécurité base

- Aucun changement cloud n'a été effectué pendant cette validation; aucun rollback n'est requis pour cette exécution.
- Frontend : redéployer le preview staging précédent, puis smoke tests.
- Edge : redéployer les six fonctions depuis le SHA précédent.
- Storage : réappliquer le `storage.sql` précédent et vérifier son hash.
- Base : migrations forward-only; prévoir backup/restauration testés ou migration corrective additive. Aucune preuve de restauration staging n'a été fournie.
- Migration créée pendant ce contrôle : aucune.
- Compatibilité démontrée : application depuis zéro avec seed fictif; application sur la base staging peuplée non démontrée.
- RLS/grants : structure distante inspectée, tests fonctionnels de rôles exécutés uniquement localement; avertissements `SECURITY DEFINER` non soldés.
- Décision sécurité base : **unsafe pour promouvoir cette release sur le staging actuel** tant que le drift et les contrôles externes ne sont pas corrigés.

## Conclusion

**Staging non validé.** Aucun problème de logique locale bloquant n'a été observé dans les suites exécutées, mais la release testée localement n'est ni immuable ni déployée; le staging est en retard sur la base et les Edge Functions, l'inspection stricte n'est pas active et les E2E/manuels obligatoires n'ont pas pu être exécutés.
