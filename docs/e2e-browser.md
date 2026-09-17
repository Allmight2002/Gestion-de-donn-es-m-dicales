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
jamais en cas de succès. Les retries sont à `0` en local et à `2` en CI : la reprise CI distingue un
incident réseau transitoire d'une régression, sans masquer une erreur locale au premier essai.

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
| **Saisie hors-ligne *intake-only*** | préparation du contexte → création patient/rencontre locale → rechargement → rejeu idempotent | spécification `e2e/offline-intake.spec.ts` présente ; exécution conditionnelle sur preview isolé, O6 encore à prouver |
| **LOT13 dédié** | révocation dynamique, indisponibilité/reconnexion Supabase, idempotence après réponse perdue, import, retry d'upload, hors-ligne historique et suppression | scénarios présents dans `e2e/lot13-complete.spec.ts`, exécutés seulement par le job staging dédié ; leur présence ne vaut pas preuve actuelle d'un run réussi |

Les parcours patient et export exercent **réellement l'interface** (aucune RPC n'est appelée pour
simuler le parcours ; la couche serveur ne sert qu'au montage et au nettoyage de fixtures).

## Hors du socle `@critical`

Les scénarios suivants ne font pas partie de la suite navigateur `@critical`. Ils ne doivent pas
être considérés comme implicitement couverts par les tests unitaires, RLS ou le préflight API : ce
sont des couvertures **complémentaires et distinctes**, pas un substitut au parcours navigateur.

- Parcours patient avancé : conflit de version concurrent, complétion, rencontres, images.
- Import : un scénario nominal est présent dans LOT13 ; reprise de lot, XLSX, historique et refus
  d'un export forgé côté client restent hors du socle.
- Fichiers / upload : LOT13 couvre un upload navigateur avec réponse Storage perdue puis retry
  idempotent ; les états complets `pending` → accepté/rejeté et la lecture refusée restent à couvrir.
- Hors-ligne historique : LOT13 couvre instantané, démarrage à froid, outbox, reconnexion,
  expiration et changement de compte ; il reste hors du socle `@critical`.
- Saisie hors-ligne *intake-only* : le scénario O6 existe, mais exige un preview construit avec
  `VITE_OFFLINE_MODE=demo`, `VITE_OFFLINE_ADMIN_ACK=true`, `VITE_OFFLINE_INTAKE=demo` et des
  fixtures staging ; sa présence dans le dépôt ne vaut pas preuve d'exécution.
- Révocation dynamique de permissions et changement de compte : scénario LOT13 dédié.
- API indisponible / dégradée côté navigateur : scénario LOT13 dédié.

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

## Scénarios dédiés hors socle

Ces scénarios sont volontairement **reportés** pour ne pas introduire de test instable. Leur absence
n'est pas un succès silencieux : elle est tracée ici.

### Upload navigateur (LOT13 dédié)

`e2e/lot13-complete.spec.ts` couvre le dépôt d'un fichier fictif dont la réponse Storage est perdue,
puis le retry du même fichier sans doublon. Ce scénario est réservé au job staging LOT13 et ne
prouve pas un run récent. Le parcours complet `pending` → accepté/rejeté, lecture refusée puis
autorisée reste à ajouter ; le préflight API `npm run e2e:staging` couvre une chaîne serveur
complémentaire, sans remplacer le navigateur.

### Révocation dynamique de rôle (LOT13 dédié)

`e2e/lot13-complete.spec.ts` exerce l'absence d'accès, l'octroi, le refresh puis la révocation
d'un `base_access` croisé. Il reste hors de la suite `@critical` et exige le job staging dédié ; la
révocation côté serveur est aussi couverte par les tests RLS (`test/access.test.ts`,
`test/exports.test.ts`).

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
