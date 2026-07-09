# Cahier des charges — Technique
### Registre clinique pseudonymisé — MedData / registre-clinique v3.0

> Décrit **comment** le système est réalisé : architecture, pile technique, modèle de données,
> mise en œuvre de la sécurité, contrats des procédures serveur, tests et déploiement — tel que
> réellement construit et déployé. Pendant fonctionnel :
> [cahier-des-charges-metier.md](cahier-des-charges-metier.md). Vue d'ensemble :
> [architecture.md](architecture.md).
>
> Convention : **ET** = exigence technique.

---

## 1. Architecture générale

Application **monopage (SPA)** React s'appuyant sur un **Backend-as-a-Service** (Supabase). Il n'y
a pas de serveur applicatif maison : la **logique de sécurité et d'intégrité vit dans la base de
données** (PostgreSQL), via Row-Level Security (RLS), des fonctions `SECURITY DEFINER` et des
triggers. Le frontend ne fait qu'**appeler** ces contrats (RPC) ou lire sous contrôle RLS.

```
Navigateur (PWA React, clé ANON publique)
   │   appels RPC / lectures filtrées par RLS
   ▼
Supabase ── PostgreSQL (schéma + RLS + RPC + triggers)  ← source de vérité
         ├─ Auth (GoTrue : email/mot de passe, JWT)
         ├─ Storage (buckets privés : images, documents bruts)
         └─ Edge Functions / Deno (signed-read : URL signée auditée)
```

**ET-1.** Le frontend n'a accès qu'à la clé **ANON** (publique). La clé `service_role` n'est
utilisée que côté serveur (Edge Functions, scripts d'administration locaux) — **jamais** dans le
bundle. Seules les variables `VITE_*` sont injectées à la compilation.

---

## 2. Pile technique

| Couche | Technologie |
|---|---|
| Frontend | **React 18 + TypeScript**, **Vite 5**, **Tailwind CSS v4**, React Router v6 |
| PWA | `vite-plugin-pwa` (installable, service worker) |
| Backend | **Supabase** : **PostgreSQL 18**, Auth (GoTrue), Storage, **Edge Functions** (Deno) |
| Tableurs | **SheetJS `xlsx` 0.20.3** (CDN officiel ; corrige les CVE de 0.18.5), parsing en **Web Worker** |
| Tests | **Vitest 2**, **`embedded-postgres` (PG 18)** pour la RLS, `@testing-library/react` + jsdom, `fake-indexeddb` |
| Hors-ligne | **IndexedDB** (instantanés + file d'écritures) |
| CI | GitHub Actions (typecheck, lint ESLint, tests, build PWA) |
| Hébergement | **Vercel** (frontend) + **Supabase cloud** (backend) |

---

## 3. Principes d'architecture

- **ET-2. Écritures cliniques par RPC uniquement.** Les tables cliniques n'acceptent **aucune
  écriture directe** par un utilisateur ; toute création/modification passe par une fonction
  `SECURITY DEFINER` qui impose : `created_by = auth.uid()`, version de gabarit cohérente,
  validation, calcul d'âge, journalisation. Les politiques RLS d'`INSERT/UPDATE/DELETE` directes
  ont été retirées ; des **triggers de garde** ferment aussi la voie directe (défense en
  profondeur).
- **ET-3. RLS sur toutes les tables.** Une table sans politique = tout est refusé. Sur un `SELECT`,
  la RLS **masque les lignes** (0 ligne) plutôt que de lever une erreur.
- **ET-4. Patron Repository côté frontend.** L'accès aux données est isolé dans `src/data/*`
  (un repository par domaine), **injectable** via `RepositoryProvider` → les écrans sont testables
  avec des doublures, sans réseau.
- **ET-5. Domaine pur séparé.** La validation de saisie, le moteur de règles JSON et l'inspection
  de fichiers sont des fonctions pures (`src/domain/*`), testables en Node, **rejouées côté
  serveur** (la validation client n'est qu'un confort ; le serveur tranche).
- **ET-6. Migrations additives.** Le schéma est une suite de migrations **forward-only** ;
  chaque correctif est une nouvelle migration (jamais d'édition rétroactive), appliquée à
  l'identique en test (PostgreSQL embarqué) et en production (Supabase). Les compteurs courants
  sont fournis par `npm run manifest` et `docs/schema-etat-final.md`.

---

## 4. Modèle de données (trois zones)

### 4.1 Cloisonnement

| Zone | Tables | Particularité |
|---|---|---|
| **Identité** | `patient_identity`, `clinical_attachment` | Restreinte (`can_view_identity`) ; jamais exportée |
| **Analytique** | `patient`, `encounter`, `field_change_log` | `age_value`/`age_unit` en colonnes ; **jamais la DOB** |
| **Documents bruts** | `raw_submission`, `raw_document`, `curation_task`, `curation_draft`, `curation_clarification` | Restreinte ; accès curateur **réservé** |
| Gabarits | `template`, `template_version`, `template_field`, `validation_rule` | Version publiée **immuable** |
| Comptes & bases | `profiles`, `base`, `base_access`, `base_invitation` | `profiles` ↔ `auth.users` |
| Cohortes & export | `cohort`, `cohort_member`, `cohort_encounter_member`, `export_log` | Cohorte figée = instantané |
| Audit & import | `audit_log`, `import_batch`, `import_row_hash` | Journal infalsifiable ; cycle de vie d'import |

**ET-7.** `patient_identity` et `patient` sont **deux tables sans clé étrangère** entre elles ;
le seul lien est la paire `(base_id, patient_code)`. → on ne peut pas joindre identité et
analytique par construction.

**ET-8.** `validation_status ∈ {draft, complete, curated}`, ordonné par un rang
(`validation_rank`) qui **interdit la rétrogradation** d'une donnée `curated`.

### 4.2 Diagramme

Voir le diagramme ER complet dans [architecture.md §3](architecture.md).

---

## 5. Sécurité — mise en œuvre

- **ET-9. Fonctions d'autorisation `SECURITY DEFINER`** (`is_system_admin`, `is_medecin`,
  `is_curateur`, `is_base_owner`, `has_base_access`, `can_view_identity`, `can_edit_structured_data`,
  `can_export_data`, …). Elles lisent `base`/`base_access` **sans déclencher leur propre RLS**
  (pas de récursion) et ne renvoient qu'un booléen sur `auth.uid()`.
- **ET-10. Âge calculé côté serveur** (`compute_age`, `patient_age_at`, `SECURITY DEFINER`) : un
  `editor` sans accès identité saisit des rencontres avec âge **sans jamais voir la date de
  naissance**. Un trigger **recalcule** `age_value` (non falsifiable).
- **ET-11. Validation serveur complète sur `curated`** : bornes, types stricts (entier, date,
  date-heure, booléen, liste multiple = tableau), **codes manquants** en liste blanche, **clés
  inconnues interdites**, **complétude des champs requis** (selon le type de rencontre), et
  **règles de cohérence** (moteur JSON plpgsql répliquant les opérateurs du frontend). Porté à la
  fois par les RPC et par un trigger d'intégrité (toutes voies).
- **ET-12. Journal d'audit infalsifiable** : pas d'`INSERT` direct dans `audit_log` /
  `field_change_log` ; la fonction générique `log_audit` n'est **pas exécutable** par un
  utilisateur (`REVOKE … FROM public, authenticated`). Les lectures sensibles (identité, document)
  sont tracées par une RPC dédiée appelée **au moment de la révélation**.
- **ET-13. Anti-fuite à l'export** (`assert_export_columns_safe`) : liste blanche analytique ; tout
  champ identifiant est **rejeté**.
- **ET-14. Lecture de fichiers privés auditée** : en production, la consultation passe
  **obligatoirement** par l'Edge Function `signed-read` (autorisation RLS → vérification du statut
  d'inspection → écriture de l'audit → URL signée courte). **Le build de production échoue si
  `VITE_USE_SIGNED_READ` n'est pas `true`** ; le repli de signature client est interdit en prod.
  Les URL ne sont générées **qu'au clic** (l'audit correspond à une vraie consultation).
- **ET-15. Intégrité inter-bases** : des triggers vérifient que soumission/patient,
  document/soumission, tâche/soumission, brouillon/tâche, clarification/tâche référencent **la même
  base**.
- **ET-16. Curation cloisonnée** : accès aux documents seulement pour le **curateur réservé** et
  **tant que** la tâche est active ; le pool n'expose qu'un **sous-ensemble minimal** de
  métadonnées (RPC `curation_pool`), jamais le patient ni l'identité.
- **ET-17. Cloisonnement hors-ligne** (cf. §8) : instantanés et file d'écritures **estampillés par
  utilisateur** ; aucune lecture ni synchronisation inter-comptes.

---

## 6. Contrats serveur (RPC principaux)

| RPC | Rôle |
|---|---|
| `create_patient`, `create_encounter` | Création clinique (autorisation explicite, validation, âge, journal) |
| `update_encounter`, `update_patient` | Correction journalisée + **verrou optimiste** (`expected_updated_at`) |
| `finalize_patient`, `finalize_curation_task` | Passage en `curated` (validé + complet) |
| `import_records` | Import par lignes/lots (validation, conflit, idempotence, journal) |
| `begin_import_batch` / `complete_import_batch` / `cancel_import_batch` | Cycle de vie d'un lot (statut cible **verrouillé**, complétude) |
| `detect_import_duplicates` | Avertissement de doublon probable à l'aperçu (lecture seule) |
| `create_curation_submission`, `submit_curation_request`, `claim/release_curation_task`, `request/answer_clarification` | Machine d'état de la curation |
| `curation_pool` | Pool minimal (métadonnées non identifiantes) |
| `cohort_preview`, `create_cohort_snapshot` | Cohortes dynamiques / figées |
| `download_base_snapshot` | **Instantané hors-ligne en 1 appel** (analytique seul, RLS) |
| `log_sensitive_read` | Trace d'une lecture sensible (identité, document) |
| `compute_age`, `patient_age_at` | Âge serveur (DOB jamais exposée) |

**ET-18. Verrou optimiste.** `update_encounter` accepte un jeton `expected_updated_at` ; si la
rencontre a changé entre-temps → conflit (`CONFLIT_VERSION`). Ce mécanisme sert aussi à la
synchronisation hors-ligne.

---

## 7. Validation des données

- **Côté domaine (`src/domain/validation.ts`, `import.ts`)** : types, bornes, requis, codes
  manquants, règles — confort de saisie + aperçu d'import. La validation peut **autoriser un
  brouillon incomplet** (les contrôles « requis » ne s'appliquent qu'au-delà de `draft`).
- **Côté serveur** : **rejoue** systématiquement la validation pour `curated` (ET-11). Le client
  ne peut pas contourner.

---

## 8. Mode hors-ligne (PWA)

- **ET-19. Stockage** : IndexedDB (`meddata-offline`), deux magasins — `snapshots` (instantané
  **analytique** d'une base : patients + rencontres + champs ; **jamais** identité ni images) et
  `outbox` (corrections de rencontres préparées hors-ligne).
- **ET-20. Construction de l'instantané** : `buildSnapshot` ne recopie **que** les champs
  analytiques (garantie par construction). Téléchargement en **un appel** via
  `download_base_snapshot` (repli transparent sur l'ancien chemin si la RPC est absente).
- **ET-21. Synchronisation** : chaque entrée de l'outbox est rejouée via la **même** RPC validée
  (`update_encounter`) avec le verrou optimiste ; **conflit** → choix « garder ma version »
  (forçage) / « garder la version serveur ».
- **ET-22. Cloisonnement & cycle de vie** : `ownerUserId` sur chaque instantané/entrée ;
  `get/list` filtrent l'utilisateur courant ; **expiration** 7 jours appliquée à la lecture ;
  **purge au démarrage** et **effacement des instantanés à la déconnexion** (la file d'écritures
  non synchronisées est conservée mais cloisonnée).

---

## 9. Internationalisation

Messages **français / anglais** centralisés (`src/i18n/`), via un `I18nProvider` et un hook
`useI18n`. Aucune chaîne en dur dans les écrans.

---

## 10. Tests

- **Pas de Docker** sur le poste : les tests démarrent un **PostgreSQL 18 embarqué** et appliquent
  **exactement les mêmes migrations** que Supabase. Un mince *shim*
  (`test/harness/000_supabase_shim.sql`) recrée `auth.uid()` / rôles ; jamais appliqué en réel.
- **Deux projets Vitest** : `db` (Node, RLS + domaine ; exécution **sérialisée** — une instance PG
  à la fois) et `web` (jsdom, rendu UI + `fake-indexeddb`).
- **État actuel** : les suites Vitest et `npm run db:verify` valident les tests et l'application
  propre des migrations depuis zéro ; les compteurs exacts sont volontairement laissés aux sorties
  de commande et au manifeste.
- **ET-23. Tests adversariaux** : chaque refus RLS est doublé d'un **contrôle positif** ; des
  scénarios d'attaque sont des tests permanents (insertion directe interdite, `log_audit` non
  appelable, champ utilisé non modifiable directement, tâche ouverte sans document interdite, cache
  hors-ligne isolé, instantané expiré supprimé, `skip` ne modifie pas l'identité, statut d'import
  verrouillé, lecture de fichier au clic, etc.).

```bash
npm test          # tout (db + web)
npm run test:rls  # sécurité RLS uniquement
npm run test:web  # rendu UI uniquement
npm run db:verify # applique toutes les migrations depuis zéro
```

---

## 11. Déploiement

- **ET-24. Frontend** : **Vercel** (`https://gestion-de-donn-es-m-dicales.vercel.app`). Variables
  d'environnement : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, **`VITE_USE_SIGNED_READ=true`**
  (Production **et** Preview) — sans quoi le build échoue (ET-14).
- **ET-25. Backend** : **Supabase cloud** (projet `lrzmbwdnrjjzwossntun`). Les migrations sont
  poussées par `npx supabase db push` (source de vérité du schéma/RLS). Données **fictives**.
- **ET-26. Edge Function `signed-read`** déployée (`verify_jwt = false`, l'autorisation est faite
  par la RLS à l'intérieur).
- **Administration des comptes** : back-office Supabase ou `scripts/create-account.mjs`
  (`service_role`, gardé local). Promotion des rôles via **Admin → Rôles**.

---

## 12. Exigences non fonctionnelles

- **Performance** : requêtes regroupées (jointures PostgREST pour les bases ; instantané
  hors-ligne en un appel) ; `xlsx` chargé à la demande et **parsé en Web Worker** ; découpage du
  bundle. La latence résiduelle est principalement liée à la distance réseau (≈ Afrique de
  l'Ouest ↔ région Supabase).
- **Limites de charge** : import borné (5000 lignes), traité par lots de 300 avec progression.
- **PWA** : application installable, manifeste + icônes, mise à jour automatique du service worker.
- **Robustesse** : les nouveaux chemins serveur dégradent **proprement** si une migration n'est pas
  encore appliquée (ex. instantané hors-ligne → repli ; avertissement de doublon → silencieux).

---

## 13. Carte du code & migrations

| Couche | Emplacement |
|---|---|
| Migrations SQL (source de vérité) | `supabase/migrations/` ; état résultant : `docs/schema-etat-final.md` |
| Edge Functions | `supabase/functions/` (`signed-read`, `inspect-upload`, `cleanup-upload`, `generate-export`, `reconcile-quarantine`) |
| Repositories (accès données) | `src/data/` (`patients`, `templates`, `bases`, `curation`, `cohorts`, `exports`, `attachments`, `access`, `admin`, `audit`, `offline`, `signedRead`) |
| Domaine pur | `src/domain/` (validation, règles, import, inspection de fichiers, tableur) |
| Écrans | `src/screens/member/`, `src/screens/staff/` |
| Auth & rôles | `src/auth/` |
| i18n | `src/i18n/` |
| Tests | `test/` (db) + `src/**/*.test.tsx` (web) |

Liste ordonnée des migrations : voir le dossier `supabase/migrations/` et le snapshot
`docs/schema-etat-final.md`. Les commentaires `§X.Y` dans le SQL renvoient aux exigences du
présent cahier et des audits successifs.

---

## 14. Limites connues et dette technique

- **Confidentialité** : la RLS protège l'accès **applicatif** ; l'administrateur du serveur peut
  techniquement lire la base. Garantie forte = chiffrement côté client (hors MVP) → **données
  fictives uniquement**.
- **À durcir au déploiement** (déjà documenté/partiel) : activer le moteur antivirus réel et
  l'inspection stricte en cloud ; politique d'« appareil de confiance » + chiffrement local du
  cache hors-ligne.
- **Dépendances** : avis `npm audit` restants limités à l'**outillage de développement**
  (esbuild/vite/vitest) — aucun au **runtime** (`npm audit --omit=dev` = 0).
