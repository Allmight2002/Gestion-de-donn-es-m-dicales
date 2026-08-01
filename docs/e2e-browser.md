# Socle E2E critique — authentification, cloisonnement des rôles et parcours métier bornés

Cette suite Playwright vise **uniquement** un environnement local contrôlé ou le **staging**, avec
des comptes dédiés et des données **fictives**. Elle ne doit **jamais** viser la production. Elle ne
prétend pas être une couverture E2E complète de MedData : elle couvre le socle de sécurité (auth /
rôles) et quelques **parcours métier critiques** ; le reste est explicitement listé comme absent.

## Exécution

Variables requises pour le socle auth/rôles : `E2E_TARGET=staging`, `E2E_BASE_URL`, puis
`E2E_MEDECIN_EMAIL/PASSWORD`, `E2E_CURATEUR_EMAIL/PASSWORD` et `E2E_ADMIN_EMAIL/PASSWORD`. Les secrets
sont injectés par l'environnement ou GitHub Actions et ne sont **jamais** écrits dans le dépôt. Une URL
externe est refusée sans la cible explicite `staging` ; toute autre cible, notamment `production`, est
refusée (`playwright.config.ts`).

```bash
npx playwright install chromium
npm run e2e:browser:critical   # tous les scénarios @critical
```

Sans `E2E_BASE_URL`, Playwright démarre Vite sur `127.0.0.1:5173` ; il faut alors fournir une
configuration Supabase locale/test. Les échecs conservent trace, capture et vidéo (`retain-on-failure`),
jamais en cas de succès. Les retries sont désactivés (`retries: 0`) : une erreur d'infrastructure doit
être identifiée et corrigée, pas masquée par des relances.

## Couverture réellement disponible

| Domaine | Scénario | Couvert |
|---|---|---|
| Authentification | login valide / invalide, alerte d'erreur | oui |
| Session | persistance au refresh, expiration → retour au login | oui |
| Redirection | route protégée sans session → `/login` | oui |
| Contrôle d'accès par rôle | médecin / curateur / administrateur confinés à leur zone | oui |
| Garde anti-production | cible `staging`/`local` seulement, allowlist projet Supabase | oui |
| Exécution staging | job dédié dans le workflow de release coordonnée | oui |
| **Parcours patient** | création → présence → modification → refresh → persistance → suppression logique | oui (correction lot 10) |
| **Modèle d'observation** | création transverse, formulaire unique sans rencontre ; régression longitudinale | contrôle manuel déployé le 2026-08-01 ; E2E dédié à ajouter |
| **Parcours export** | UI → Edge `generate-export` → historique → téléchargement (CSV) | oui (correction lot 10) |
| **Refus d'export** | rôle sans droit ne peut ni atteindre l'écran ni lancer d'export | oui (correction lot 10) |

Les parcours patient et export exercent **réellement l'interface** (aucune RPC n'est appelée pour
simuler le parcours ; la couche serveur ne sert qu'au montage et au nettoyage de fixtures).

## Couverture encore absente

Les scénarios suivants **ne sont pas** couverts par cette suite navigateur. Ils ne doivent pas être
considérés comme implicitement couverts par les tests unitaires, RLS ou par le préflight API : ce sont
des couvertures **complémentaires et distinctes**, pas un substitut au parcours navigateur.

- Parcours patient avancé : conflit de version concurrent, complétion, rencontres, images.
- Import : reprise d'un lot, CSV/XLSX, historique, refus d'un export forgé côté client.
- Fichiers / upload : dépôt navigateur, états `pending` → accepté/rejeté, lecture refusée puis autorisée.
- Hors-ligne : instantané, réécritures/outbox, reconnexion, verrou optimiste.
- Révocation dynamique de permissions et changement de compte.
- API indisponible / dégradée côté navigateur.

## Stratégie de fixtures et nettoyage (`e2e/fixtures.ts`)

- **Identifiants** chargés uniquement depuis l'environnement ; aucun secret ni mot de passe dans le dépôt.
- **Données fictives**, préfixées et **uniques par run** (`uniquePatientCode`, `RUN_ID`) : pas de
  collision entre exécutions concurrentes ou rejouées, et résidu identifiable.
- **Garde anti-production** (`assertNonProductionSupabase`) : exige `E2E_TARGET=staging` et une URL
  Supabase dont le projet est **dans l'allowlist** (staging connu, extensible via
  `E2E_ALLOWED_PROJECT_REFS`). Toute autre cible, dont la production, provoque un **échec bruyant**.
- **Isolation** : chaque test est indépendant de l'ordre ; aucune donnée partagée mutable.
- **Nettoyage** : la suppression logique du patient **est** le nettoyage du parcours patient ; en cas
  d'échec avant cette étape, `afterEach` supprime le résidu en **best-effort** via la RPC applicative
  (`cleanupPatient`), sans jamais masquer l'échec. L'export réutilise une cohorte semée et ne crée pas
  de base/cohorte jetable ; l'`export_log` est **volontairement immuable** (trace en ajout seul), il
  n'y a donc rien à supprimer.
- **Fixture requise indisponible** : le test est **marqué indisponible** (`test.skip` avec message
  explicite listant les variables manquantes), jamais compté comme un succès silencieux.

### Variables des parcours métier (staging)

| Variable | Usage | Absente ⇒ |
|---|---|---|
| `E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` | client de nettoyage best-effort + garde anti-prod | parcours patient marqué indisponible |
| `E2E_MEDECIN_BASE_ID` | base de test possédée par le médecin (gabarit **sans champ patient obligatoire**) | parcours patient marqué indisponible |
| `E2E_EXPORT_BASE_ID` / `E2E_EXPORT_COHORT_ID` | cohorte figée **éligible** semée côté staging | parcours export marqué indisponible |

## Scénarios différés (documentés, non instables)

Ces scénarios sont volontairement **reportés** pour ne pas introduire de test instable. Leur absence
n'est pas un succès silencieux : elle est tracée ici.

### Upload navigateur (correction recommandée 5)

Parcours cible : dépôt d'un petit fichier fictif autorisé → état `pending` → progression → lecture
refusée tant que non accepté → lecture autorisée après acceptation. **Reporté** : le scanner
ClamAV staging est désormais vérifié joignable par l'Edge, mais ce parcours navigateur n'est pas
encore automatisé. Le préflight API
`npm run e2e:staging` (`scripts/e2e-staging.mjs`) exerce déjà **de bout en bout** la chaîne
inspection / quarantaine / scanner sur du vrai cloud ; il ne remplace pas un parcours navigateur, qui
reste à ajouter lorsque les prérequis seront réunis (condition explicite `E2E_UPLOAD_ENABLED`).

### Révocation dynamique de rôle (correction recommandée 6)

Parcours cible : utilisateur avec accès confirmé → permission révoquée côté serveur → refresh / nouvelle
requête → accès refusé sans donnée sensible visible. **Reporté** : il exige une orchestration cloud plus
lourde (second utilisateur, octroi puis révocation d'un `base_access` croisé). La révocation **côté
serveur** est déjà prouvée par les tests RLS (`test/access.test.ts`, `test/exports.test.ts`) ; le
parcours **navigateur** reste à ajouter avec une fixture administrative dédiée.

## Intégration continue

- La **CI de PR** (`.github/workflows/ci.yml`) ne lance pas Playwright : elle vérifie les versions XLSX
  et la suite embarquée (RLS + UI). Les E2E navigateur ne ralentissent donc pas la PR.
- Le workflow **de release coordonnée** (`.github/workflows/coordinated-release.yml`, job
  `browser-e2e-staging`) exécute `npm run e2e:browser:critical` contre le frontend staging déployé,
  **après** les portes backend. Les parcours métier ne s'exécutent que si leurs variables de fixture
  (ci-dessus) sont configurées ; sinon ils sont marqués indisponibles.
- L'accès au déploiement protégé est amorcé par Vercel CLI dans un répertoire temporaire. Playwright
  reçoit uniquement un cookie HttpOnly/Secure limité au domaine exact du déploiement ; le jeton Vercel,
  le cookie et son fichier d'état ne sont ni placés dans le dépôt, ni conservés dans les artefacts.
