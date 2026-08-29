# Audit Technique Complet — Registre Clinique (MedData) — 9 août 2026

**Date :** 9 août 2026 · **Version :** 0.1.0 (état courant du dépôt, HEAD 37d7921)
**Référence :** audit précédent `docs/audits/audit-technique-complet-2026-07-26.md` — le présent rapport couvre l'état actuel et l'évolution depuis juillet (migrations L10 « comptes de mission », référentiel de terminologie, corbeille/restauration de bases, 7e Edge Function `create-mission-account`).

---

## 1. Résumé exécutif

Le projet reste d'un niveau de rigueur exceptionnel pour un MVP clinique : **aucun constat critique ou élevé** dans le code néo-écrit depuis juillet ; l'intégralité des contrôles automatisés lourds passe (111 migrations rejouées depuis zéro, 581/581 tests RLS, typecheck/lint/build et statique des 7 Edge Functions).

Deux sujets émergent, tous deux à gravité limitée :
1. **`npm audit` : 5 vulnérabilités (4 high + 1 moderate), 100 % transitives dans l'outillage de build** (aucune en runtime prod). La vulnérabilité `react-router` (P0 de l'audit de juillet, CVE-2025-68470) est corrigée par la migration vers `react-router` 8.3.0.
2. **1 test web sur 272 échoue** (`CreateFlows.test.tsx`, comportement « doublon patient » — même catégorie qu'en juillet ; l'échec `SyncCenter` de juillet est, lui, corrigé).

**Verdict : production conditionnelle, sous réserve de la mise à jour des dépendances de build et d'un test (avancement par rapport à juillet, où 2 P0/P1 subsistaient).**

---

## 2. Commandes exécutées (résultats réels, ce jour)

| Commande | Résultat | Détail |
|---|---|---|
| `npm run typecheck` | PASS | 0 erreur TS |
| `npm run lint` | PASS | 0 warning (`--max-warnings 0`) |
| `npm run db:verify` | PASS | **111 migrations rejouées depuis zéro** : 38 tables, 219 fonctions, 61 policies RLS, 55 triggers, seed OK (9,0 s) |
| `npm run test:rls` | PASS | **581/581 tests, 58/58 fichiers** (PostgreSQL 18 embarqué, ~7 min) — les `ERROR:` du log sont les tests négatifs attendus |
| `npm run test:web` | PARTIEL | **271/272** (46 fichiers) ; 1 échec : `CreateFlows.test.tsx:107` |
| `npm run release:edge:check` | PASS | Contrat statique OK, 7 Edge Functions découvertes |
| `npm run build` (VITE_USE_SIGNED_READ=true) | PASS | Build Vite + PWA `generateSW` (71 entrées, 923 KiB precache), ~3 s |
| `npm audit --json` | AVERTISSEMENT | 5 vulnérabilités : 4 high + 1 moderate, toutes transitives (dev) |

---

## 3. Constats

### [AUD-2026-08-DEP-01] Vulnérabilités npm dans la chaîne de build — Moyenne
- **Preuve :** `npm audit` : `brace-expansion` <5.0.9 (GHSA-rgw5-rvv9-x895, DoS), `fast-uri` <3.1.5 (GHSA-7p8r-x3mc-p8w7), `nanoid` <3.3.17 (GHSA-2v37-7h3g-55p8), `minimatch`, `postcss` <=8.5.22 (moderate). Aucune n'est `isDirect`, aucune ne touche les 19 dépendances prod ; risque d'exploitation réel : nul pour la PWA servie (outillage uniquement), impact : vérifications CI/qualité, image mentale « reactor ».
- **Détail notable :** l'`override` `"brace-expansion": "5.0.8"` dans `package.json` épingle une version **encore vulnérable** (correctif = 5.0.9) : l'override doit être porté à `5.0.9` minimum.
- **Correctif :** mettre à jour l'override `brace-expansion` → ≥5.0.9 ; `npm audit fix` pour les transitives ; rejouer `npm run audit:dependencies`.
- **Effort :** faible.

### [AUD-2026-08-TST-01] Échec d'assertion web : confirmation explicite de doublon — Faible
- **Preuve :** `src/screens/member/CreateFlows.test.tsx:107` — `waitFor(expect(createPatientCuration).toHaveBeenCalled…)` échoue ; l'UI exige désormais (comportement voulu, cf. docstring du rapport de juillet) la confirmation explicite « un dossier à la même identité existe déjà » avant l'appel RPC.
- **Correctif :** simuler le clic sur la confirmation de doublon avant l'assertion (reprise du rapport de juillet, toujours non appliquée — ticket récurrent).
- **Effort :** faible.

### [AUD-2026-08-HYG-01] Fichiers parasites non ignorés à la racine — Faible
- **Preuve :** `stdout` (dump hex d'un fichier source, 7,5 Ko) et `tsc_output.txt` (vide) ne sont ni suivis ni dans `.gitignore`. Risque : fuite de sources/artefacts dans un futur `git add -A`.
- **Correctif :** supprimer et/ou ajouter aux `.gitignore` (une entrée `*.txt` ciblée ou les deux noms).

### [AUD-2026-08-MIS-01] Restauration de base : l'appartenance au groupe de recherche n'est pas restaurée — Faible (comportement, à confirmer)
- **Preuve :** `supabase/migrations/20260801140238_restore_deleted_base.sql` : `soft_delete_base` fait `delete from research_group_base` (l. 50-51) ; la restauration ne le restaure pas (le snapshot ne capture que les statuts `raw_submission`/`curation_task`). Le commentaire qualifie ce détachement d'intentionnel « sans effet sur les droits d'accès » — laissé tel quel, mais doit être **explicitement acté** (une base restaurée perd son rattachement de groupe ; cf. la politique RLS d'appartenance de groupe qui pourrait en invisibiliser certains écrans).
- **Correctif :** confirmer la décision produit ; si voulu, documenter dans la spec de la corbeille ; sinon étendre le snapshot.

### Points de vigilance L10 « comptes de mission » (validés, aucune faille démontrée)
- `handle_new_user` lit le rôle dans `raw_app_meta_data` au moment de l'INSERT alors que Supabase écrit `app_metadata` ensuite : **défaut réel documenté dans la migration**, compensé par `reconcile_mission_profile` (service_role seul, refus de rétrograder un compte déjà établi — `20260729153000`). Le scénario « compte né medecin » est couvert par un garde-fou DB + Edge. À conserver tel quel.
- `create_patient` refuse explicitement tout champ nominatif pour un appelant sans `can_write_identity` (refus plutôt que silence) ; `patient_identity.full_name` étant nullable, l'écriture « code seul » est licite.
- Invariant « une seule base par mission » et bornes d'échéance portés **par trigger** (`guard_base_access_medecin`), indépendamment de la voie d'écriture.
- L'Edge `create-mission-account` : pré-vol avec le jeton du médecin, provisionnement re-vérifié par la base (`auth.uid()` = médecin), compensation des échecs partiels, pas d'énumération d'adresses exploitable (les réponses 404/409 sont génériques).
- `signed-read` : autorisation par requêtes RLS, **audit bloquant avant signature**, contrôle `path.startsWith(baseId + '/')`, porte quarantaine/`accepted`. `generate-export` : cohorte `snapshot` uniquement, `can_export_data` en contexte utilisateur, comptages re-vérifiés par page, export restreint aux lignes `curated`, hash enregistré, rollback du fichier si la journalisation échoue. `finalize-upload` : preuve hash/taille/MIME re-vérifiée **après** commit avec compensation `rollback_verified_upload_operation`.

### Évolutions depuis l'audit de juillet (traitées)
- CVE-2025-68470 (`react-router-dom` v6) : **corrigée** (`react-router` 8.3.0, aucun advisories sur `react-router`/`react-router-dom` dans l'audit npm actuel).
- Échec `SyncCenter.test.tsx` : **corrigé**.
- Allowlist `security-definer-allowlist.json` : contient bien `is_saisisseur()`, `can_create_structured_data`, `provision_mission_access`, `extend_mission_access`, `mission_accounts`, `restore_deleted_base`, `list_deleted_bases` ; `mission_account_lookup` et `reconcile_mission_profile` sont correctement réservées à `service_role` (absentes de l'allowlist client). `guard_base_access_medecin`, `guard_profile_role`, `handle_new_user` (déclencheurs) restent sur `search_path = public, pg_temp`.
- CSP stricte définie (`vercel.json`) : `default-src 'self'`, `frame-ancestors 'none'`, HSTS, Referrer-Policy `no-referrer` — cohérente avec l'usage de `blob:`/workers/supabase.

---

## 4. Non vérifiables localement (à faire sur le cloud, avec preuve)

1. Application de `supabase/storage.sql` (buckets + policies Storage) et état réel des buckets sur le projet cible.
2. `npm run db:function-acl:verify` et `npm run github:controls:verify` (nécessitent `SUPABASE_DB_URL`, `GITHUB_REPOSITORY`).
3. Secrets d'environnement de prod (`VITE_USE_SIGNED_READ=true`, `REQUIRE_SERVER_INSPECTION=true`, `MISSION_PASSWORD_REDIRECT_URL`, ClamAV `CLAMAV_URL`) et `e2e:staging`.

---

## 5. Plan de correction suggéré

- **P0 (aucun)** : rien ne bloque la mise en production d'un point de vue sécurité du code.
- **P1 (avant prod long terme)** :
  1. Bump `brace-expansion` 5.0.9+ (override) + `npm audit fix` + re-`npm run audit:dependencies`.
  2. Correction de l'assertion `CreateFlows.test.tsx`.
  3. Nettoyage `stdout` / `tsc_output.txt` (+ `.gitignore`).
- **P2** : acter le comportement « groupe de recherche perdu à la restauration » (spec ou correctif) ; éventuel écran « état du système » adossé à `reportClientError`.

## 6. Synthèse par domaine

| Domaine | Note /10 |
|---|---:|
| Architecture & conception | 9.0 |
| Sécurité (RLS, RPC, Edge, Storage) | 9.0 |
| Qualité & maintenabilité (TS strict, lint) | 9.0 |
| Intégrité & idempotence (111 migrations, verrous, compensations) | 9.0 |
| Tests & régression (581 RLS + 271/272 web) | 8.5 |
| Hygiène & dépendances | 7.5 |
| **Globale pondérée** | **≈ 8.8 / 10** |

**Confiance : élevée** — validations automatisées exécutées sur PostgreSQL 18 réel et TypeScript ; limites ci-dessus (cloud) non vérifiées par choix.