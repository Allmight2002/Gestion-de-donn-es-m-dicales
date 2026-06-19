# Registre clinique oriente recherche — MVP

Plateforme de bases de donnees cliniques structurees pour la recherche, en contexte
a ressources limitees. Modele **registre-centre** : le patient est l'objet central
(pas l'etude). En **v3.0**, le produit couvre la chaine **collecte → curation →
structuration**. Coeur du produit : **separation des zones** (identite / analytique /
documents bruts) et **cloisonnement applique cote base (Row-Level Security), teste
automatiquement**.

> Etat d'avancement : **migration v3.0 livree** (cahier technique v3.0), en 3 temps :
> - **Temps 1 — Fondation** : role global `system_admin`/`member`, **6 permissions
>   granulaires** par base, roles d'acces viewer/editor/curator/validator/analyst,
>   age en colonnes (`age_value`/`age_unit`), `validation_status` (draft/complete/
>   verified), `clinical_attachment` (deidentification), invitations par `token_hash`,
>   cohortes `validated_only`, 3 buckets de stockage.
> - **Temps 2 — Curation** : collecte de **documents bruts** (zone restreinte), taches
>   de curation affectees a un curateur, **brouillon** structure, **validation atomique**
>   par un validateur -> donnees **verifiees** en zone analytique (age calcule sans
>   exposer la DOB ; journalisation `field_change_log` + `audit_log`).
> - **Temps 3 — Finitions** : **audit renforce** (§14, trace automatique des actions
>   sensibles), export verrouille aux **donnees verifiees uniquement**, upload de
>   document brut depuis l'UI, documentation.
>
> Fonctionnalites de base (v2.2, conservees) : admin gabarits (versions immuables,
> regles JSON), bases (possedees/partagees), patient (identite/analytique liees par le
> seul code), saisie dynamique (valeurs manquantes codifiees, regles block/warn),
> corrections journalisees, images en zone restreinte, filtres + cohortes, export
> CSV/XLSX immuable, invitations/acces, suppression logique.
>
> **Tests : 138 verts** (Vitest ; RLS + securite cote base + rendu UI). Build PWA OK.
>
> Besoin d'un backend Supabase pour le login reel ? Voir
> [docs/configurer-supabase.md](docs/configurer-supabase.md) (voie cloud, sans Docker).

---

## 0. Roles, permissions et zones (v3.0)

**Role global** (`profiles.global_role`) : `system_admin` (gere les gabarits, **aucun
acces aux donnees patient**) ou `member` (medecin/collaborateur).

**Acces par base** : le proprietaire (owner) cree la base ; il invite des collaborateurs
avec un **role d'acces** et **6 permissions granulaires** booleennes. La base applique
les invariants par contrainte CHECK (l'analyste n'a jamais identite/documents ; le
curateur n'exporte pas et ne gere pas les acces).

| Permission \ Role | owner | viewer | editor | curator | validator | analyst |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `can_view_identity` | ✓ | – | option | – | option | **jamais** |
| `can_view_raw_documents` | ✓ | – | option | ✓ | ✓ | **jamais** |
| `can_edit_structured_data` | ✓ | – | ✓ | ✓ | ✓ | – |
| `can_validate_data` | ✓ | – | – | – | ✓ | – |
| `can_export_data` | ✓ | – | – | **jamais** | – | ✓ |
| `can_manage_access` | ✓ | – | – | **jamais** | – | – |

**Trois zones cloisonnees cote base (RLS) :**
- **Identite** (`patient_identity`, `clinical_attachment`) — `can_view_identity` ; jamais exportee.
- **Analytique** (`patient`, `encounter`) — donnees structurees ; l'age remplace la DOB.
- **Documents bruts** (`raw_document`) — `can_view_raw_documents` ; jamais exportee, jamais visible a l'analyste.

## 0.1 Workflow de curation (v3.0)

```
 Collecte                Structuration              Validation
 (can_view_raw_documents) (curateur affecte)        (can_validate_data)
 ┌───────────────┐  doc   ┌───────────────┐  submit ┌───────────────┐
 │ raw_submission│──────► │ curation_task │───────► │ curation_draft│
 │ + raw_document│        │ (assigned_to) │        │  (submitted)  │
 └───────────────┘        └───────────────┘         └──────┬────────┘
        zone documents bruts (restreinte)                  │ validate_curation_draft()
                                                           ▼  (ATOMIQUE, privilegie)
                                          ┌──────────────────────────────────┐
                                          │ patient/encounter VERIFIES        │
                                          │ age calcule (DOB jamais exposee)  │
                                          │ field_change_log + audit_log      │
                                          └──────────────────────────────────┘
```

Un rejet (`validate_curation_draft(..., 'rejected')`) trace la decision sans rien ecrire
en zone analytique. Seules les **donnees verifiees** entrent dans les cohortes et exports.

---

## 1. Pile technique

| Domaine | Choix | Note |
|---|---|---|
| Base de donnees | **PostgreSQL + RLS** | Schema portable vers Supabase tel quel |
| Backend cible | **Supabase** (Postgres + Auth + RLS) | `auth.users` + table `profiles` (pas de table utilisateur recreee) |
| Frontend | **React + TypeScript + Vite (PWA)** + Tailwind v4 | auth + role gating (etape 3) |
| Routage / i18n | react-router + i18n maison (fr/en) | structure prete pour les ecrans 4+ |
| Tests de securite | **Vitest + PostgreSQL embarque** (`embedded-postgres`) | **sans Docker**, voir ci-dessous |
| Tests frontend | **Vitest + jsdom + Testing Library** | rendu + gating par role |

### Pourquoi un PostgreSQL embarque pour les tests (ecart justifie)

Le cahier exige des **tests RLS automatises** (§16) executables et reproductibles.
La voie Supabase classique (CLI) requiert **Docker**, absent de ce poste. Pour ne
rien vous imposer et garder une preuve rejouable, les tests demarrent un **vrai
PostgreSQL 18 embarque** (binaire telecharge par npm, aucun service externe) et
appliquent **exactement les memes migrations** que celles destinees a Supabase.

Un mince *shim* de test ([test/harness/000_supabase_shim.sql](test/harness/000_supabase_shim.sql))
recree ce que Supabase fournit deja (roles `anon`/`authenticated`/`service_role`,
schema `auth`, `auth.uid()`). Il **n'est jamais applique** sur un vrai projet Supabase.

---

## 2. Structure des fichiers

```
.
├── supabase/
│   ├── migrations/                      # Migrations reelles (a appliquer sur Supabase)
│   │   ├── 20260616090100_extensions.sql
│   │   ├── 20260616090200_tables.sql        # Modele de donnees (§6)
│   │   ├── 20260616090300_functions.sql     # Fonctions d'aide RLS (SECURITY DEFINER)
│   │   ├── 20260616090400_rls.sql           # Activation RLS + politiques (§7, §12)
│   │   ├── 20260616090500_integrity.sql     # Triggers : profils, immuabilite gabarit, anti-escalade
│   │   ├── 20260616090600_rpc.sql           # accept_invitation(), assert_export_columns_safe()
│   │   └── 20260616090700_template_admin.sql # duplicate_template_version() (staff-only)
│   ├── seed.sql                          # Donnees de demo FICTIVES (§15)
│   ├── storage.sql                       # Bucket images prive + RLS (a appliquer sur Supabase)
│   └── config.toml                       # Config Supabase CLI (chemin du seed)
├── src/                                  # Frontend (etapes 3-5)
│   ├── auth/                             # AuthProvider, backend, logique de role (pure)
│   ├── data/                             # repositories gabarits + bases (injectables)
│   ├── domain/                           # regles JSON + validation saisie + validation images (purs)
│   ├── i18n/                             # messages fr/en + provider
│   ├── lib/                              # client Supabase (cle ANON) + env
│   ├── routes/                           # routage + ProtectedRoute (gating par role)
│   ├── screens/                          # Login, dashboard+base (membre), admin gabarits (staff)
│   ├── components/                       # AppShell, LanguageSwitcher
│   └── main.tsx · App.tsx
├── test/
│   ├── harness/                          # shim Supabase (test-only) + boot Postgres embarque
│   ├── rls.security.test.ts             # Les 7 scenarios du §16 (+ controles positifs)
│   ├── auth-logic.test.ts               # Logique de gating par role (pure)
│   ├── template-rules.test.ts           # Regles JSON controlees (§10)
│   ├── templates.admin.test.ts          # Admin gabarits : immuabilite, staff-only, duplication
│   ├── bases.test.ts                    # Bases : creation, propriete, visibilite/partage
│   ├── patients.test.ts                 # Patient : separation, code unique, version, RLS
│   ├── validation.test.ts               # Controles + valeurs manquantes + regles (§10)
│   ├── encounters.test.ts               # Age calcule sans exposer la DOB (§4.1) + RLS saisie
│   ├── corrections.test.ts              # field_change_log : corrections tracees (critere 12)
│   ├── attachments.test.ts              # Images = zone restreinte (RLS) + masquage obligatoire
│   ├── image-upload.test.ts             # Validation format/taille des images (§14)
│   ├── cohorts.test.ts                  # Filtres + cohorte figee (critere 8) + RLS
│   ├── export.test.ts                   # Construction export (agregation, dictionnaire, zero identite)
│   ├── exports.test.ts                  # export_log : trace immuable + RLS (critere 9)
│   ├── access.test.ts                   # Invitations/acces : owner-only, revocation, profils collab.
│   └── soft-delete.test.ts             # Suppression logique : cascade, reste en base (critere 12)
├── docs/configurer-supabase.md           # Guide : creer un projet Supabase (cloud)
├── .env.example                          # Variables (service_role = cote serveur uniquement)
├── vite.config.ts · vitest.workspace.ts  # build PWA + projets de test (db / web)
├── package.json · tsconfig.json
└── README.md
```

---

## 3. Prerequis

**Pour lancer tous les tests (etapes 2 et 3) : uniquement Node.js >= 20.**
Aucun Docker, aucun projet Supabase, aucune variable d'environnement. Le frontend
se construit et se teste aussi sans backend (`npm run build`, `npm test`).

**Pour une connexion REELLE (login bout-en-bout) et la suite (etape 4+) :**
- un **projet Supabase** (cloud) **ou** la **CLI Supabase + Docker** en local ;
- les variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (exposables au
  navigateur) et `SUPABASE_SERVICE_ROLE_KEY` (**cote serveur uniquement**) ;
- une decision d'hebergement (cloud centralise vs identites hors serveur central,
  cf. cahier metier §10/§15) — n'impacte pas le code livre.

> **Regle de securite respectee :** seules les variables prefixees `VITE_` sont
> injectees dans le bundle frontend. `SUPABASE_SERVICE_ROLE_KEY` n'a pas ce prefixe
> et n'est lue que par des scripts serveur — **jamais** dans le frontend (§12).

---

## 4. Lancer les tests (etapes 2 et 3)

```bash
npm install
npm test            # tout : RLS (db) + frontend (web)
npm run test:rls    # uniquement la securite RLS (§16)
npm run test:web    # uniquement le frontend (rendu + gating par role)
```

Resultat attendu : **123 tests passants** :
- **db** (PostgreSQL embarque, 97) : 19 RLS (§16 + controles positifs), 8 logique de
  role, 9 regles JSON (§10), 10 validation de saisie, 3 validation images, 8 admin
  gabarits, 3 bases, 5 patients, 5 rencontres (age sans exposer la DOB, §4.1),
  3 corrections, 4 images, 4 cohortes (critere 8), 5 export + 4 export_log (critere 9),
  3 acces, **4 suppression logique** (cascade, reste en base, critere 12) ;
- **web** (jsdom, 26) : 4 gating par role, 5 admin gabarits, 3 tableau de bord/base,
  2 patient, 3 saisie de rencontre, **3 fiche patient (correction + suppression)**,
  2 ajout d'image, 1 constructeur de cohorte, 1 export, 2 gestion des acces.

Le premier lancement telecharge le binaire PostgreSQL (une fois).

Sur une requete `SELECT`, la RLS ne renvoie pas d'erreur : elle **masque les lignes**.
Un acces refuse se traduit donc par **0 ligne** ; chaque refus est double d'un
**controle positif** prouvant qu'un utilisateur legitime voit bien la donnee (pas
de faux positif par table vide).

### Correspondance §16 → tests

| §16 | Scenario | Verifie |
|---|---|---|
| 1 | `staff` lit `patient_identity` / donnees analytiques | refuse (0 ligne) |
| 2 | `analyst` lit une `attachment` (image) | refuse (0 ligne) |
| 3 | collaborateur **sans** `includes_identity` lit un nom | refuse (0 ligne) |
| 4 | utilisateur **sans** `base_access` lit une base | refuse (0 ligne) |
| 5 | export incluant un champ identifiant (`full_name`, `date_of_birth`) | bloque (exception) |
| 6 | le proprietaire revoque un acces | perte d'acces **immediate** |
| 7 | invitation expiree / revoquee / deja utilisee | acceptation refusee |

---

## 5. Lancer le frontend (etape 3)

```bash
npm run dev      # http://localhost:5173
npm run build    # build de production + service worker PWA
```

Sans `.env`, l'app demarre quand meme et affiche un ecran **« Backend non configure »**
(elle ne plante pas). Des que `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont
renseignes (voir §6), la connexion est active.

Ce qui est implemente : connexion e-mail/mot de passe + reinitialisation, selecteur de
langue (fr/en), chargement du `profile`, **routage par role global** (etape 3), et
l'**admin gabarits** cote `staff` (etape 4) : creer un gabarit, ajouter des champs
(scope/section/type), ecrire des regles JSON **validees** (operateurs autorises
uniquement), **publier** (la version devient en lecture seule) et **dupliquer**. Cote
`member` (etapes 5-6) : **tableau de bord** des bases, **creation d'une base** liee a
une version publiee de gabarit, **tableau des patients** d'une base, **creation d'un
patient** (identite en zone restreinte + donnees permanentes), et **saisie d'une
rencontre** (etape 7) : champs par section, controles bornes/requis/listes, **valeurs
manquantes codifiees**, statut, **apercu de l'age calcule** et **regles de coherence**
(bloquantes/avertissements). La date de naissance exacte ne quitte jamais la zone
restreinte ; dans la liste, le nom n'apparait que si l'utilisateur a l'acces identite.
Enfin, la **fiche patient** (etape 8) presente les sections (identite si autorisee /
permanent / rencontres) et permet de **corriger** une valeur de rencontre avec **motif
obligatoire** ; chaque correction est **journalisee** (ancienne/nouvelle valeur, auteur,
motif) et l'historique est affiche. Les **images** (etape 9) s'ajoutent depuis la fiche
avec **case de masquage obligatoire** et controle de format (jpg/png/webp) ; elles
s'affichent via **URL signees** et seulement pour un acces identite. Enfin (etape 10),
**« Constituer une cohorte »** : ajouter des filtres combines en ET (egalite, plage,
liste) sur des variables permanentes ou de rencontre, **calculer les effectifs**, puis
enregistrer une cohorte **dynamique** ou **figee**. Une cohorte figee s'**exporte**
(etape 11) en CSV/XLSX : choix explicites (1 ligne/patient ou /rencontre, agregation
1re/derniere, portee des rencontres), dictionnaire joint, et **fichier conserve
immuable** (`file_hash` + `export_log`) — sans jamais d'identite ni d'image. Le
proprietaire **gere les acces** (etape 12) : inviter par email (role + acces identite),
partager un **lien a usage unique**, et **revoquer** invitations et acces ; l'invite
accepte via `/accept-invitation?token=...`. Depuis la fiche (etape 13), on **supprime
logiquement** un patient (cascade identite/rencontres/images), une rencontre ou une
image, avec **motif obligatoire** : la donnee disparait de l'usage normal mais reste
en base.

> **`service_role` jamais dans le frontend** (§12) : le client navigateur
> ([src/lib/supabase.ts](src/lib/supabase.ts)) n'utilise que la cle **ANON**. La cle
> service_role n'est pas prefixee `VITE_` et est donc absente du bundle (verifiable
> par `npm run build` : aucune occurrence dans `dist/`).

---

## 6. Appliquer le schema sur un vrai Supabase (execution reelle / etape 4)

### Option A — Supabase local (CLI + Docker)
```bash
supabase init       # si pas deja fait (genere/maj config.toml)
supabase start
supabase db reset   # applique migrations/ puis seed.sql
supabase status     # recupere URL + cles (anon, service_role)
```

### Option B — Supabase cloud
```bash
supabase link --project-ref <votre-ref>
supabase db push                          # applique les migrations
# Seed : exécuter supabase/seed.sql via le SQL editor ou psql.
```

> **Comptes de demo et cloud :** `seed.sql` cree les utilisateurs par `INSERT auth.users`
> (pratique en local/CLI et dans les tests). En **cloud**, il est preferable de creer
> les 4 comptes via l'**Admin API** (`auth.admin.createUser`) ou le Dashboard, puis de
> rejouer la partie « donnees » du seed. La cle `service_role` reste **cote serveur**.

### Comptes de demonstration (mot de passe commun : `Password123!`)

| Email | Role | Acces |
|---|---|---|
| `staff@demo.test` | staff | gabarits/comptes ; **aucune** donnee patient |
| `alice@demo.test` | member (proprietaire) | acces complet a sa base (identite incluse) |
| `bob@demo.test` | member | medecin (collaborateur dans les tests) |
| `anna.analyst@demo.test` | member | **analyste** sur la base d'Alice (analytique, **sans** identite ni image) |

Le seed cree aussi : 1 gabarit « Neurochirurgie » publie v1, 10 patients fictifs
(identite + analytique, age **calcule**, valeurs manquantes codifiees), 1 image
masquee, 1 cohorte **figee** d'exemple (patients **et** rencontres).

---

## 7. Securite — decisions et limites honnetes

- **Cloisonnement cote base.** RLS active sur **toutes** les tables ; une table sans
  politique = tout refuse. Le staff et l'analyste n'ont structurellement aucun acces
  aux zones interdites (identite, images), y compris par contrainte `CHECK`
  (un analyste ne peut jamais porter `includes_identity`).
- **Separation identite / analytique.** `patient_identity` et `patient` sont deux
  tables **sans cle etrangere** entre elles ; seul lien : `(base_id, patient_code)`.
- **Age calcule, jamais saisi.** La date de naissance exacte reste en zone restreinte ;
  l'age est calcule **cote serveur** (`create_encounter`/`patient_age_at`, SECURITY
  DEFINER) et seul `age_at_encounter` entre dans la zone analytique. Un collaborateur
  `editor` SANS acces identite peut saisir des rencontres avec age calcule **sans jamais
  voir la date de naissance** (§4.1, teste).
- **Anti-fuite a l'export.** `assert_export_columns_safe()` refuse tout champ
  identifiant (liste blanche analytique). Le fichier d'export conserve immuable +
  `file_hash` arrive a l'etape 11.
- **`service_role` jamais dans le frontend** (§12) — voir §3.
- **Limite a ne pas survendre** (cahier §10/§12) : la RLS empeche l'acces *applicatif*
  aux identites ; l'administrateur du serveur peut techniquement lire la base. Une
  garantie forte suppose un chiffrement cote client ou des identites hors serveur
  central (hors perimetre MVP). **Aucune donnee reelle** tant que le cadre
  juridique/ethique (§12 « a documenter ») n'est pas en place.

---

## 8. Prochaine etape

**Etape 14 du §17** (audit renforce : tracer consultation d'identite, vue/telechargement
d'image, changement d'acces, invitation, figement de cohorte, export, suppression,
publication de gabarit — `audit_log`) — **en attente de votre validation** avant de
demarrer, conformement a la methode « une etape a la fois ».

> Storage : pour activer reellement l'upload d'images, appliquer
> [supabase/storage.sql](supabase/storage.sql) sur le projet Supabase (bucket prive
> `attachments` + RLS). La table `attachment` (cloisonnement) est deja dans les migrations.
