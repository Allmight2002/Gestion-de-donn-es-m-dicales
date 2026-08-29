# Registre clinique orienté recherche

Plateforme de bases de données cliniques structurées pour la recherche, en contexte à
ressources limitées. Modèle **registre-centré** : le patient est l'objet central (pas
l'étude). Le produit couvre la chaîne **collecte → curation → structuration**. Cœur du
produit : **séparation des zones** (identité / analytique / documents bruts) et
**cloisonnement appliqué côté base (Row-Level Security), testé automatiquement**.

> 🧭 **Nouvelle arrivée ?** Lisez d'abord **[docs/architecture.md](docs/architecture.md)** :
> vue d'ensemble du modèle de données, des rôles, du cloisonnement RLS et du
> cycle de curation. Le présent README est le guide de mise en route.
>
> 🔍 **Vous venez relire le projet de l'extérieur ?** Commencez par
> **[docs/guide-relecture-externe.md](docs/guide-relecture-externe.md)** (parcours développeur et
> parcours sécurité, ~15 min chacun). L'ensemble de `docs/` est indexé dans
> **[docs/README.md](docs/README.md)**.

État actuel : **4 rôles globaux** (`system_admin` / `medecin` / `curateur` / `saisisseur`),
**2 rôles de partage** (`viewer` / `editor`) + **6 permissions granulaires** par base. Chaîne de
curation complète (pool → finalisation **par le curateur**, sans étape de validation séparée).
Tests Vitest, RLS et migrations sont rejouables localement ; les compteurs exacts sont fournis par
`npm run manifest`, `npm run schema` et les sorties de test.
Build PWA OK ; **déployé** (Vercel + Supabase cloud, **données fictives**).

**Instantané du schéma vérifié le 24 août 2026** : `docs/schema-etat-final.md` recense les
132 migrations, 43 tables, 269 fonctions, 63 politiques RLS et 66 triggers du schéma `public` ;
le dépôt contient 8 Edge Functions. Les validations d'une livraison donnée restent à lire dans
son journal d'exécution : un état de schéma local ne vaut pas preuve de déploiement cloud.

> Besoin d'un backend Supabase pour le login réel ? Voir
> [docs/configurer-supabase.md](docs/configurer-supabase.md) (voie cloud, sans Docker).

---

## 0. Rôles, permissions et zones

**Rôle global** (`profiles.global_role`) — 4 valeurs :

| Rôle | Description | Accès aux données patient |
|---|---|---|
| `system_admin` | Gère les gabarits globaux et les comptes | **Aucun** |
| `medecin` | Crée/possède des bases, saisit, exporte | Ses bases + bases partagées |
| `curateur` | Structure **et finalise** les cas du pool | Documents réservés ; **jamais l'identité** |
| `saisisseur` | **Compte de mission** : saisit sur **une seule** base, pour une durée bornée | Saisie seule ; jamais d'export, jamais de documents bruts |

> Le rôle `saisisseur` (lot L10, migration `20260729104500_mission_accounts.sql`) répond au
> besoin « un thésard saisit pour son directeur ». Il est volontairement **distinct** de
> `medecin` : un `medecin` peut créer ses propres bases et gabarits hors de tout contrôle,
> ce qu'aucune permission de base ne saurait restreindre. Toute policy écrite `is_medecin() and …`
> exclut donc le saisisseur **par défaut** — le défaut échoue fermé. Spécification complète :
> [docs/spec-comptes-mission.md](docs/spec-comptes-mission.md).

**Accès par base** : le propriétaire (owner) crée la base ; il invite des collaborateurs
médecins avec un **rôle d'accès** (`viewer`/`editor`) et **6 permissions granulaires**
booléennes. La base applique les invariants par contrainte CHECK et par trigger.

Défauts proposés par rôle (chaque permission reste **indépendamment** activable
par le propriétaire — `✓` = coché par défaut, `option` = décoché mais activable,
`✗` = **refusé par la base**, pas seulement masqué par l'interface) :

| Permission \ Rôle | owner | viewer | editor | saisisseur |
|---|:--:|:--:|:--:|:--:|
| `can_view_identity` | ✓ | – | ✓ | option¹ |
| `can_view_raw_documents` | ✓ | – | ✓ | ✗ |
| `can_create_structured_data` | ✓ | – | –² | **✓ (obligatoire)** |
| `can_edit_structured_data` | ✓ | – | ✓ | ✗ |
| `can_export_data` | ✓ | – | option | ✗ |
| `can_manage_access` | ✓ | – | option | ✗ |

¹ Ouvrir l'identité à un compte de mission exige une **justification écrite** conservée en base
(`identity_justification`), sinon l'écriture est refusée.

² Le drapeau vaut `false` par défaut pour un `editor`, **sans rien lui retirer** : les RPC de
création acceptent `can_create_structured_data` **ou** `can_edit_structured_data`. La permission a
été ajoutée pour séparer « créer » de « modifier » sans backfill ni changement de comportement pour
les collaborateurs existants. Les RPC de **modification**, elles, exigent `can_edit` seul.

Un accès `saisisseur` porte en outre une **échéance obligatoire** (`base_access.expires_at`,
24 mois maximum) vérifiée par RLS **à chaque requête** — révoquer ne dépend pas de l'expiration
du jeton de session. Les invariants ci-dessus sont portés par le trigger
`guard_base_access_medecin`, donc valables **quelle que soit la voie d'écriture**.

**Trois zones cloisonnées côté base (RLS) :**
- **Identité** (`patient_identity`, `clinical_attachment`) — `can_view_identity` ; jamais exportée.
- **Analytique** (`patient`, `encounter`) — données structurées ; l'âge remplace la DOB.
- **Documents bruts** (`raw_submission`, `raw_document`) — `can_view_raw_documents` ou curateur affecté ; jamais exportée.

## 0.1 Workflow de curation

Le curateur ne voit **jamais** l'identité du patient. Il structure des documents bruts
dé-identifiés, puis **finalise seul** (le rôle `validateur` a été supprimé).

```
 preparing ──submit(≥1 doc)──► open ──réservation──► in_progress ──finalize_curation_task()──►
                                          │   ▲                          │
                        clarification_requested ─┘ (question/réponse)      ▼
                                                            patient/encounter en `curated`
                                                            (âge calculé, DOB jamais exposée,
                                                             field_change_log + audit_log)
```

Un cas **n'entre dans le pool** que lorsqu'il est soumis avec **au moins un document**.
La finalisation vérifie la **validité** (`assert_data_valid`) et la **complétude des champs
requis** (`assert_required_complete`) avant d'écrire en zone analytique. Seules les données
en `curated` entrent dans les cohortes et exports. Le médecin peut supprimer une demande
(confirmation), au choix : la demande seule, ou le patient **et** la demande.

---

## 1. Pile technique

| Domaine | Choix | Note |
|---|---|---|
| Base de données | **PostgreSQL 18 + RLS** | Schéma portable vers Supabase tel quel |
| Backend cible | **Supabase** (Postgres + Auth + RLS + Storage + Edge Functions) | `auth.users` + table `profiles` |
| Frontend | **React 19 + TypeScript 5 strict + Vite 8 (PWA)** + Tailwind v4 | auth + gating par rôle |
| Routage / i18n | react-router 8 + i18n maison (fr/en) | 41 routes (44 `<Route>`), `ProtectedRoute` par rôle |
| Code serveur | **Edge Functions Deno** (`supabase/functions/`) | 7 fonctions ; chemins non pilotables par le navigateur seul |
| Antivirus | **ClamAV** en service HTTP (`services/clamav-scanner`) | appelé par `inspect-upload` |
| Tests de sécurité | **Vitest + PostgreSQL embarqué** (`embedded-postgres`) | **sans Docker**, voir ci-dessous |
| Tests frontend | **Vitest + jsdom + Testing Library** | rendu + gating par rôle |
| Tests bout-en-bout | **Playwright** (`e2e/`) | parcours réels sur staging |

### Pourquoi un PostgreSQL embarqué pour les tests

Les **tests RLS automatisés** doivent être exécutables et reproductibles. La voie Supabase
classique (CLI) requiert **Docker**, absent de ce poste. Les tests démarrent donc un **vrai
PostgreSQL 18 embarqué** (binaire téléchargé par npm, aucun service externe) et appliquent
**exactement les mêmes migrations** que celles destinées à Supabase. Un mince *shim*
([test/harness/000_supabase_shim.sql](test/harness/000_supabase_shim.sql)) recrée ce que
Supabase fournit déjà (`auth.uid()`, rôles `anon`/`authenticated`/`service_role`) ; il
**n'est jamais appliqué** sur un vrai projet Supabase.

---

## 2. Structure des fichiers

```
.
├── supabase/
│   ├── migrations/                       # Source de vérité du schéma (à appliquer sur Supabase)
│   │   ├── 20260616090100_extensions.sql
│   │   ├── 20260616090200_tables.sql         # Modèle de données initial
│   │   ├── 20260616090300_functions.sql      # Fonctions d'aide RLS (SECURITY DEFINER)
│   │   ├── 20260616090400_rls.sql            # Activation RLS + politiques
│   │   ├── 20260616090500_integrity.sql      # Triggers : profils, immuabilité gabarit, anti-escalade
│   │   ├── 20260616090600_rpc.sql            # accept_invitation(), assert_export_columns_safe()
│   │   ├── 20260616090700_template_admin.sql # duplicate_template_version()
│   │   ├── 20260616090800_patients.sql       # création patient + RLS
│   │   ├── 20260616090900_encounters.sql     # rencontres : âge calculé sans exposer la DOB
│   │   ├── 20260616091000_corrections.sql    # field_change_log (corrections tracées)
│   │   ├── 20260616091100_cohorts.sql        # cohortes dynamiques / figées
│   │   ├── 20260616091200_access.sql         # invitations / accès (token_hash)
│   │   ├── 20260616091300_soft_delete.sql    # suppression logique
│   │   ├── 20260616091400_curation.sql       # pool, brouillon, finalize_curation_task(), clarifications
│   │   ├── 20260616091500_audit.sql          # audit_log (actions sensibles)
│   │   └── … migrations de durcissement      # édition de champs, règles
│   │                                          #   versionnées, import par lots + idempotence,
│   │                                          #   écritures par RPC seulement, intégrité inter-bases,
│   │                                          #   audit infalsifiable, hors-ligne, gouvernance des
│   │                                          #   accès, exports audités… (voir
│   │                                          #   docs/schema-etat-final.md pour l'état résultant)
│   ├── functions/                        # Edge Functions Deno (code SERVEUR, 7 fonctions)
│   │   ├── signed-read/                  # URL signée délivrée APRÈS écriture de l'audit
│   │   ├── inspect-upload/               # extension/magic-bytes + ClamAV → verdict
│   │   ├── finalize-upload/              # preuve hash/taille/MIME revérifiée après commit
│   │   ├── cleanup-upload/               # reprise des tickets d'upload abandonnés
│   │   ├── reconcile-quarantine/         # réconciliation des objets mis en quarantaine
│   │   ├── generate-export/              # export serveur (cohorte figée, lignes `curated`)
│   │   ├── create-mission-account/       # provisionnement d'un compte `saisisseur`
│   │   └── _shared/                      # contrats partagés + harnais de test
│   ├── security-definer-allowlist.json   # inventaire normatif des fonctions SECURITY DEFINER
│   ├── seed.sql                          # Données de démo FICTIVES
│   ├── storage.sql                       # Buckets privés + RLS
│   └── config.toml
├── src/
│   ├── auth/                             # AuthProvider, backend, logique de rôle (pure)
│   ├── data/                             # repositories injectables (RepositoryProvider) :
│   │                                     #   bases, patients, curation, cohorts, exports, access,
│   │                                     #   groups, mission, offline, inspection, terminology…
│   ├── domain/                           # purs : validation saisie, règles JSON, import/export,
│   │                                     #   tableur (+ worker), bibliothèques de gabarits
│   ├── i18n/                             # messages fr/en + provider
│   ├── lib/                              # client Supabase (clé ANON), env, écriture gardée, réseau
│   ├── pwa/                              # politique d'enregistrement du service worker
│   ├── routes/                           # routage (41 routes) + ProtectedRoute (gating par rôle)
│   ├── screens/                          # member/ (médecin, curateur, saisisseur) + staff/ (admin)
│   ├── components/                       # AppShell, ErrorBoundary, palette de commandes, UI
│   └── main.tsx · App.tsx
├── test/                                 # tests db (RLS + domaine + scripts) — projet "db"
│   └── harness/000_supabase_shim.sql     # recrée auth.uid() & rôles pour le Postgres embarqué
├── e2e/                                  # Playwright : parcours bout-en-bout (staging)
├── services/
│   └── clamav-scanner/                   # service HTTP de scan (Dockerfile + serveur Node)
├── scripts/                              # validations & opérations explicites (~40) :
│                                         #   db:verify, schema, manifest, sauvegarde coordonnée,
│                                         #   preuves de gouvernance/reprise, contrôles de release
├── docs/                                 # ⭐ voir docs/README.md (index de toute la doc)
├── .env.example                          # Variables (service_role = côté serveur uniquement)
├── vite.config.ts · vitest.config.ts     # build PWA + projets de test (db / web)
├── playwright.config.ts · deno.json      # e2e + import map des Edge Functions
├── vercel.json                           # en-têtes de sécurité (CSP stricte, HSTS) + routage
├── package.json · tsconfig.json
└── README.md
```

---

## 3. Prérequis

**Pour lancer tous les tests : uniquement Node.js `>=22.22.0 <23` et npm `>=10 <12`**
(champ `engines` de [package.json](package.json)). Aucun Docker, aucun projet Supabase, aucune
variable d'environnement. Le frontend se construit et se teste aussi sans backend
(`npm run build`, `npm test`).

**Pour une connexion RÉELLE (login bout-en-bout) :**
- un **projet Supabase** (cloud) **ou** la **CLI Supabase + Docker** en local ;
- les variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (exposables au navigateur) et
  `SUPABASE_SERVICE_ROLE_KEY` (**côté serveur uniquement**).

> **Règle de sécurité respectée :** seules les variables préfixées `VITE_` sont injectées
> dans le bundle frontend. `SUPABASE_SERVICE_ROLE_KEY` n'a pas ce préfixe et n'est lue que
> par des scripts serveur — **jamais** dans le frontend.

---

## 4. Lancer les tests

```bash
npm install
npm test            # tout : RLS (projet db) + frontend (projet web)
npm run test:rls    # uniquement la sécurité RLS
npm run test:web    # uniquement le frontend (rendu + gating par rôle)
```

Résultat attendu : toutes les suites passent — sécurité RLS (les scénarios
d'attaque + leurs contrôles positifs), logique de rôle, règles JSON, validation de saisie,
âge calculé sans exposer la DOB, corrections, images, cohortes, export immuable, accès,
suppression logique, curation, audit, et rendu des écrans. Le premier lancement télécharge
le binaire PostgreSQL (une fois).

Sur une requête `SELECT`, la RLS ne renvoie pas d'erreur : elle **masque les lignes**. Un
accès refusé se traduit donc par **0 ligne** ; chaque refus est doublé d'un **contrôle
positif** prouvant qu'un utilisateur légitime voit bien la donnée (pas de faux positif par
table vide).

---

## 5. Lancer le frontend

```bash
npm run dev      # http://localhost:5173
npm run build    # build de production + service worker PWA
```

Sans `.env`, l'app démarre quand même et affiche un écran **« Backend non configuré »**
(elle ne plante pas). Dès que `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont renseignés,
la connexion est active.

**Ce qui est implémenté :** connexion e-mail/mot de passe + réinitialisation, sélecteur de
langue (fr/en), routage par rôle global. Côté `system_admin` : admin des gabarits (versions
immuables, règles JSON validées, publication, duplication). Côté `medecin` : tableau de bord
des bases, création de base avec modèle d'observation (saisie unique, suivi répété ou registre
d'événements), gabarits personnels, table et fiche patient (identité si autorisée / permanent /
rencontres selon le modèle), saisie de rencontre (bornes/requis/listes, valeurs
manquantes codifiées, aperçu de l'âge calculé, règles de cohérence), correction journalisée
(motif obligatoire), images en zone restreinte (masquage obligatoire, URL signées),
constitution de cohortes (filtres en ET, effectifs, dynamique/figée), export CSV/XLSX
immuable (sans identité ni image), gestion des accès (invitation par lien à usage unique,
révocation), suppression logique. Côté `curateur` : pool de curation, structuration d'un cas
réservé, clarifications, **finalisation**. Côté `saisisseur` : saisie bornée sur la base de
mission, brouillons personnels, soumission sans droit de correction ultérieure.

**Sous-systèmes ajoutés depuis le MVP** (tous documentés dans
[docs/architecture.md](docs/architecture.md) §9) : **import** CSV/XLSX par lots (le client
propose le mappage, le serveur valide et déduplique), **mode hors-ligne** (lecture et corrections
dans le parcours historique ; création patient/rencontre *intake-only* idempotente dans une
démonstration explicitement activée), **groupes de recherche**, **comptes de mission**,
**référentiel de terminologie**, **corbeille, restauration et purge définitive** de base,
**modèles d'observation**
(transversal / longitudinal / registre d'événements), et la chaîne
**upload → inspection antivirus → quarantaine** côté serveur.

**Moteur de formulaires** (août 2026) : texte d'aide et valeur proposée par variable, raisons de
valeur manquante choisies variable par variable, affichage conditionnel (la valeur d'un champ
masqué est effacée, jamais en silence), sections personnalisables, aperçu du formulaire, et code
interne stable pour chaque option de liste. Les **variables calculées** sont évaluées à l'affichage
et à l'export par un contrat partagé, avec unités temporelles, sans stockage d'un résultat clinique.

**Variables à valeurs multiples** (août 2026) : une variable de type référentiel peut porter une
**liste ordonnée** de 1 à 50 diagnostics, sans doublon de code, l'ordre valant rang. Saisie,
export (colonne de libellés, colonne de codes, compteur, colonnes indicatrices, feuille dédiée),
cohortes (`contient l'un de` / `ne contient aucun de`) et hors-ligne sont couverts. Voir
[docs/spec-variables-multivaluees.md](docs/spec-variables-multivaluees.md).

> ⚠️ **L'inspection antivirus est en pause depuis le 2026-08-13** sur les environnements
> déployés : les fichiers déposés ne sont plus analysés côté serveur. La chaîne existe et se
> rejoue en mode `strict` ; elle n'est simplement pas active. Voir
> [docs/decision-pause-inspection-2026-08-12.md](docs/decision-pause-inspection-2026-08-12.md).

> **`service_role` jamais dans le frontend** : le client navigateur
> ([src/lib/supabase.ts](src/lib/supabase.ts)) n'utilise que la clé **ANON** (vérifiable par
> `npm run build` : aucune occurrence dans `dist/`).

---

## 6. Appliquer le schéma sur un vrai Supabase

### Option A — Supabase local (CLI + Docker)
```bash
supabase start
supabase db reset   # applique migrations/ puis seed.sql
supabase status     # récupère URL + clés (anon, service_role)
```

### Option B — Supabase cloud
```bash
supabase link --project-ref <votre-ref>
supabase db push                          # applique les migrations
# Seed : exécuter supabase/seed.sql via le SQL editor ou psql.
```

> **Note :** si `supabase db reset` échoue faute d'accès à docker.io (pull d'images), appliquer
> les deltas de schéma par **psql direct** sur le conteneur, sans reset. Après un reset, rejouer
> `npm run supabase:storage` : le reset ne rejoue que les migrations et le seed, pas les buckets.
> Pour un test manuel impliquant **plusieurs comptes**, suivre
> [docs/tests-multicomptes.md](docs/tests-multicomptes.md) (pièges de poste documentés).

### Comptes de démonstration (mot de passe commun : `Password123!`)

| Email | Rôle global | Accès |
|---|---|---|
| `admin@demo.test` | `system_admin` | Administration ; **aucune** donnée patient |
| `templates@demo.test` | `system_admin` | Gestion des gabarits globaux |
| `alice@demo.test` | `medecin` (propriétaire) | Accès complet à sa base (identité incluse) |
| `bob@demo.test` | `medecin` | 2ᵉ médecin, sans accès à la base d'Alice |
| `editor@demo.test` | `medecin` | Collaborateur `editor` sur la base d'Alice |
| `curator1@demo.test` | `curateur` | Pool de curation |
| `curator2@demo.test` | `curateur` | Pool de curation |
| `validator@demo.test` | `curateur` | Compte hérité (le rôle `validateur` est supprimé) |
| `anna.analyst@demo.test` | `medecin` | `viewer` + `can_export_data` (export **sans** identité) |

Le seed crée aussi : 1 gabarit « Neurochirurgie » publié v1, 10 patients fictifs (identité +
analytique, âge **calculé**, valeurs manquantes codifiées), 1 image masquée, 1 cohorte figée
d'exemple, et des cas de curation de démonstration.

---

## 7. Sécurité — décisions et limites honnêtes

- **Cloisonnement côté base.** RLS active sur **toutes** les tables ; une table sans
  politique = tout refusé. Le `system_admin` et le `curateur` n'ont structurellement aucun
  accès à l'identité.
- **Séparation identité / analytique.** `patient_identity` et `patient` sont deux tables
  **sans clé étrangère** entre elles ; seul lien : `(base_id, patient_code)`.
- **Âge calculé, jamais saisi.** La date de naissance exacte reste en zone restreinte ;
  l'âge est calculé **côté serveur** (SECURITY DEFINER). Un `editor` SANS accès identité
  peut saisir des rencontres avec âge calculé **sans jamais voir la date de naissance**.
- **Anti-fuite à l'export.** `assert_export_columns_safe()` refuse tout champ identifiant
  (liste blanche analytique). Fichier d'export conservé immuable + `file_hash`.
- **Validation non contournable.** Bornes, types, champs requis, clés inconnues **et règles de
  cohérence inter-champs** (`assert_validation_rules`, opérateurs en liste blanche) sont
  imposés **par trigger** au passage en `curated` : contourner l'interface ne contourne pas la
  validation. Les écritures cliniques passent par des RPC, pas par des `INSERT` directs.
- **Fichiers déposés : inspectés avant d'être lisibles.** Extension vs *magic bytes*, taille,
  hash, puis scan **ClamAV** côté serveur ; un verdict négatif copie l'objet dans un bucket
  privé de quarantaine (`service_role` seul) avant de le retirer du bucket documentaire. Aucune
  URL signée n'est délivrée tant que le statut n'est pas `accepted`.
- **Comptes de mission bornés.** Échéance obligatoire (24 mois max) revérifiée par RLS à chaque
  requête, permissions interdites imposées par trigger, justification écrite exigée pour ouvrir
  l'identité.
- **Audit des actions sensibles** (`audit_log`) : consultation d'identité, vue/téléchargement
  d'image, changement d'accès, invitation, figement de cohorte, export, suppression,
  publication de gabarit.
- **`service_role` jamais dans le frontend** — voir §3.
- **Limite à ne pas survendre** : la RLS empêche l'accès *applicatif* aux identités ;
  l'administrateur du serveur peut techniquement lire la base. Une garantie forte suppose un
  chiffrement côté client ou des identités hors serveur central (hors périmètre MVP).
  **Aucune donnée réelle** tant que le cadre juridique/éthique n'est pas en place.

---

## 8. Documentation & suite

> 📚 **[docs/README.md](docs/README.md) — index de toute la documentation.** Il distingue les
> documents **vivants** (qui décrivent le produit actuel) des **preuves datées** (audits,
> validations de staging, décisions), qu'il ne faut pas lire comme l'état courant.

Entrées principales :

- **[docs/guide-relecture-externe.md](docs/guide-relecture-externe.md)** — 🔍 pour un relecteur extérieur : parcours **développeur** et parcours **sécurité**.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — flux de travail Git (branches `main`/`develop`), releases, déploiement.
- **[docs/architecture.md](docs/architecture.md)** — vue d'ensemble (modèle, rôles, RLS, curation, Edge, carte du code).
- **[docs/cahier-des-charges-metier.md](docs/cahier-des-charges-metier.md)** — spécification **fonctionnelle** (EF / RG).
- **[docs/cahier-des-charges-technique.md](docs/cahier-des-charges-technique.md)** — spécification **technique** (ET).
- **[docs/edge-functions.md](docs/edge-functions.md)** — les 7 fonctions serveur (lecture signée auditée, inspection antivirus, export, comptes de mission).
- **[docs/schema-etat-final.md](docs/schema-etat-final.md)** — état du schéma **généré** par `npm run schema` (prévaut sur toute description manuelle).
- **[docs/deploiement.md](docs/deploiement.md)** — mettre le service en ligne (pilote à données fictives) + prérequis avant données réelles.
- **[docs/configurer-supabase.md](docs/configurer-supabase.md)** — créer un projet Supabase (cloud).
- **[docs/tester-en-local.md](docs/tester-en-local.md)** — lancer le projet en local.

**Fonctionnalités restant à intégrer** (au-delà du code livré) : intégration réelle de
**DocAssist** (aujourd'hui un simple encart facultatif après export), **simplification du schéma**
(fusion du sous-système de curation), et **cadre juridique/éthique** (condition préalable à toute
donnée réelle). Les chantiers ouverts sont suivis dans
[docs/idees-post-readiness.md](docs/idees-post-readiness.md) et
[docs/feuille-route-developpement-post-readiness.md](docs/feuille-route-developpement-post-readiness.md).

> Storage : pour activer réellement l'upload d'images/documents, appliquer
> [supabase/storage.sql](supabase/storage.sql) sur le projet Supabase (buckets privés + RLS).
> Depuis les tickets d'upload, ce fichier doit être réappliqué après la migration SQL qui crée
> `upload_ticket`, car les policies Storage exigent `has_pending_upload_ticket(bucket_id, name)`.
> Il crée aussi le bucket privé `quarantined-uploads`, utilisé par `inspect-upload` pour isoler
> physiquement les fichiers rejetés avant de supprimer l'objet du bucket documentaire normal.
