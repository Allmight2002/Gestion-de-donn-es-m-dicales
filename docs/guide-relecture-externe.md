# Guide de relecture externe

> Pour un ingénieur qui découvre MedData et accepte de donner un avis. Deux parcours d'environ
> 15 minutes chacun : **développeur** (§3) et **sécurité** (§4). Lisez le §1 et le §2 dans tous
> les cas, puis allez directement à votre parcours.
>
> Ce guide dit aussi **ce qui est déjà connu** (§5) : inutile d'y passer du temps.

---

## 1. Ce qu'est le produit, en cinq lignes

MedData est un **registre clinique orienté recherche**, conçu pour des contextes à ressources
limitées. Le modèle est **registre-centré** : l'objet central est le **patient**, pas l'étude. La
chaîne couverte va de la **collecte** à la **curation** puis à la **structuration** des données.

La propriété de sécurité qui structure tout le produit est le **cloisonnement de trois zones** —
identité, données analytiques, documents bruts — **appliqué par la base de données** (Row-Level
Security), pas par l'interface.

**Contrainte permanente : le produit ne contient que des données fictives.** Aucun cadre juridique
ni éthique n'est encore validé, donc aucune donnée réelle de patient n'a jamais été saisie et ne
doit l'être. Les comptes de démonstration et leur mot de passe sont volontairement publics dans
[`supabase/seed.sql`](../supabase/seed.sql) : ce sont des comptes de démonstration sur des données
inventées, pas une fuite.

**État vérifié le 19 août 2026** : `npm run db:verify` → **129 migrations rejouées proprement
depuis zéro** (~10 s) ; schéma `public` : 42 tables, 261 fonctions, 63 politiques RLS,
63 triggers (décomptes du fichier **généré** [schema-etat-final.md](schema-etat-final.md), qui
fait foi) ; `npm run test:web` → **467/467 tests verts** (65 fichiers, 108 s) ; 7 Edge Functions.
Environ 21 200 lignes de TypeScript applicatif (hors tests) et 19 400 lignes de SQL de migration.

> La suite RLS (`npm run test:rls`, projet `db`) n'a **pas** été rejouée pour établir cet
> instantané — comptez plusieurs dizaines de minutes. Le dernier décompte connu est celui de
> l'audit du 9 août : 581/581.

## 2. Le modèle mental, en trois minutes

| Zone | Tables | Contenu | Exportable ? |
|---|---|---|---|
| **Identité** (restreinte) | `patient_identity`, `clinical_attachment` | Nom, date de naissance exacte, images cliniques | **Jamais** |
| **Analytique** | `patient`, `encounter`, `field_change_log` | Données structurées, **âge calculé** (pas la date de naissance) | Oui, sans identité |
| **Documents bruts** (restreinte) | `raw_submission`, `raw_document` + curation | Documents source à structurer | **Jamais** |

Trois invariants portent le reste :

1. **`patient_identity` et `patient` n'ont aucune clé étrangère entre elles.** Le seul lien est la
   paire `(base_id, patient_code)`. Le rapprochement est donc une opération autorisée, pas une
   jointure implicite.
2. **La date de naissance ne quitte jamais la zone identité.** L'âge est calculé côté serveur
   (`compute_age`, `SECURITY DEFINER`). Un collaborateur `editor` sans accès identité saisit des
   rencontres avec un âge correct **sans jamais voir la date de naissance**.
3. **La base est la source de vérité de l'autorisation.** L'interface ne fait que refléter ce que
   la base autorise déjà. Un écran masqué n'est jamais la protection.

Quatre rôles globaux : `system_admin` (aucune donnée patient), `medecin` (possède des bases),
`curateur` (structure et finalise, sans jamais voir l'identité), `saisisseur` (compte de mission
borné dans le temps, saisie seule).

---

## 3. Parcours développeur

### 3.1 Mettre en route (5 minutes, sans Docker ni compte Supabase)

```bash
npm install
npm run db:verify
```

`db:verify` monte un **vrai PostgreSQL 18 embarqué** (binaire téléchargé par npm, aucun service
externe), y rejoue les 112 migrations depuis zéro, applique le seed et résume le schéma obtenu.
C'est la façon la plus rapide de voir que le schéma tient debout. Comptez ~13 s après le premier
téléchargement.

```bash
npm test          # suite complète : projet "db" (RLS/SQL) + projet "web" (rendu React)
npm run test:rls  # uniquement la sécurité
npm run test:web  # uniquement le rendu (rapide)
npm run dev       # frontend seul ; sans .env il affiche « Backend non configuré » au lieu de planter
```

> `npm test` est **long** : chaque fichier de test SQL peut démarrer sa propre instance
> PostgreSQL, et le projet `db` est volontairement **sérialisé** (`fileParallelism: false`,
> `maxWorkers: 1` dans [vitest.config.ts](../vitest.config.ts)) pour ne jamais saturer la machine
> ni partager un état implicite entre fichiers. C'est un compromis assumé : isolation totale
> contre temps d'exécution. Pour une première exploration, `npm run db:verify` puis
> `npm run test:web` donnent l'essentiel en quelques minutes ; lancez `npm run test:rls` en tâche
> de fond.

Pour lancer le produit **bout-en-bout** avec une vraie pile Supabase locale, suivre
[tester-en-local.md](tester-en-local.md).

> Prérequis : Node.js `>=22.22.0 <23`. Aucune variable d'environnement n'est nécessaire pour les
> tests.

### 3.2 Où regarder, dans l'ordre

| # | Fichier | Pourquoi il vaut le détour |
|---|---|---|
| 1 | [architecture.md](architecture.md) | La vue d'ensemble. Tout le reste en découle |
| 2 | [`supabase/migrations/20260616090200_tables.sql`](../supabase/migrations/20260616090200_tables.sql) | Le modèle de données initial, commenté |
| 3 | [`supabase/migrations/20260616090400_rls.sql`](../supabase/migrations/20260616090400_rls.sql) | Les politiques RLS d'origine : le cœur du produit |
| 4 | [`src/data/`](../src/data/) | Les repositories : toute la surface d'accès aux données, injectables |
| 5 | [`src/domain/`](../src/domain/) | La logique pure (validation, règles, import/export) — testable sans React |
| 6 | [`supabase/functions/`](../supabase/functions/) | Les 7 fonctions serveur Deno |
| 7 | [schema-etat-final.md](schema-etat-final.md) | L'état **résultant** de toutes les migrations, généré — évite de les rejouer de tête |

### 3.3 Conventions du dépôt (utiles pour juger le code)

- **Migrations forward-only.** Une migration déjà appliquée n'est **jamais** modifiée. Tout
  changement passe par une nouvelle migration horodatée, additive, compatible avec les données
  existantes. D'où les 112 fichiers : c'est un choix, pas une dérive.
- **Écritures cliniques par RPC uniquement.** Les `INSERT`/`UPDATE` directs sur les tables
  cliniques sont fermés. L'autorisation, la validation et la journalisation vivent dans la
  fonction, pas dans l'appelant.
- **TypeScript strict, `eslint --max-warnings 0`.** `npm run typecheck` et `npm run lint` doivent
  être verts.
- **Injection de dépendances côté données** (`RepositoryProvider`) : les écrans reçoivent leurs
  repositories, ce qui rend les tests de rendu possibles sans backend.
- **Domaine pur séparé de React** : `src/domain/` ne connaît ni le DOM ni Supabase.
- **i18n maison** (fr/en) plutôt qu'une dépendance lourde.

### 3.4 Questions sur lesquelles un avis extérieur nous aiderait

1. **Le découpage `data` / `domain` / `screens` tient-il** à 169 fichiers TypeScript, ou faut-il
   déjà une couche intermédiaire ?
2. **112 migrations forward-only** : à partir de quel volume faut-il consolider un socle, et
   comment le faire sans casser la reproductibilité que garantit `db:verify` ?
3. **Le couplage à Supabase** est-il raisonnablement isolé (`src/lib/supabase.ts`,
   `src/data/*`), ou une migration vers un autre backend serait-elle un chantier majeur ?
4. **La logique métier vit majoritairement en SQL** (RPC, triggers, fonctions). C'est un choix
   assumé pour la sécurité — quel en est le coût de maintenance à vos yeux ?
5. **Testabilité** : le harnais PostgreSQL embarqué vous paraît-il une bonne réponse à l'absence
   de Docker, ou un piège à moyen terme ?

---

## 4. Parcours sécurité

### 4.1 Le modèle de menace assumé

Ce qui est **dans** le périmètre défendu :

| Menace | Contre-mesure | Où la lire |
|---|---|---|
| Un utilisateur authentifié lit des données d'une base à laquelle il n'a pas accès | RLS sur **toutes** les tables ; une table sans policy = tout refusé | `20260616090400_rls.sql` |
| Un curateur ou un admin remonte à l'identité du patient | Aucune clé étrangère entre `patient_identity` et `patient` ; policies distinctes | `architecture.md` §1 |
| Une date de naissance fuit via l'âge | Âge calculé côté serveur, DOB jamais renvoyée | `compute_age`, `20260616090900_encounters.sql` |
| Un champ identifiant part dans un export | `assert_export_columns_safe()` — **liste blanche** analytique | `20260616090600_rpc.sql` |
| Le client contourne l'interface et écrit n'importe quoi | Écritures par RPC seulement ; validation imposée **par trigger** au passage en `curated` | `assert_curated_complete` |
| Une règle de cohérence est contournée en désactivant JavaScript | `assert_validation_rules` évalue les règles `block` côté serveur, opérateurs en **liste blanche** | `20260616091900_validation_rules.sql` |
| Un fichier malveillant est déposé puis servi | Extension vs *magic bytes*, taille, hash, **ClamAV**, puis quarantaine physique | `inspect-upload`, [edge-functions.md](edge-functions.md) |
| Une lecture de document privé n'est pas tracée | L'`audit_log` est écrit **avant** que l'URL signée soit produite | `signed-read` |
| Un compte de mission survit à sa mission | Échéance obligatoire (≤ 24 mois) revérifiée **par RLS à chaque requête** | `guard_base_access_medecin` |
| Une escalade de privilège par `user_metadata` | Le rôle est porté par `app_metadata` (non modifiable par l'utilisateur) | [spec-comptes-mission.md](spec-comptes-mission.md) |
| Une fonction privilégiée est ajoutée en douce | Inventaire normatif de 94 signatures ; toute divergence **casse la CI** | [security-definer.md](security-definer.md) |

Ce qui est **hors** du périmètre, explicitement :

- **L'administrateur du serveur peut techniquement lire la base.** La RLS empêche l'accès
  *applicatif*, pas l'accès physique. Une garantie forte supposerait un chiffrement côté client ou
  des identités hors du serveur central — hors périmètre MVP, et assumé comme tel.
- **Aucune donnée réelle** n'est protégée aujourd'hui, puisqu'il n'y en a aucune.
- Les **dérogations volontaires** en cours sont listées dans
  [derogations-readiness.md](derogations-readiness.md) : ce sont des contrôles suspendus
  sciemment, pas des oublis.

### 4.2 Les sept endroits à regarder en priorité

1. [`supabase/migrations/20260616090400_rls.sql`](../supabase/migrations/20260616090400_rls.sql) —
   les policies d'origine.
2. [`supabase/migrations/20260616090300_functions.sql`](../supabase/migrations/20260616090300_functions.sql) —
   les helpers `SECURITY DEFINER` (`is_medecin`, `can_view_identity`, …). Ils lisent
   `base`/`base_access` **sans** déclencher leur propre RLS, pour éviter la récursion. C'est le
   point le plus délicat du design : ils ne renvoient qu'un booléen sur `auth.uid()`.
3. [`supabase/security-definer-allowlist.json`](../supabase/security-definer-allowlist.json) — les
   94 fonctions privilégiées, classées et justifiées une à une.
4. [`supabase/functions/signed-read/index.ts`](../supabase/functions/signed-read/index.ts) —
   autorisation par RLS avec le JWT de l'utilisateur, **audit bloquant avant signature**, contrôle
   `path.startsWith(baseId + '/')`.
5. [`supabase/functions/inspect-upload/index.ts`](../supabase/functions/inspect-upload/index.ts) —
   la chaîne d'inspection et le passage en quarantaine.
6. [`supabase/migrations/20260729104500_mission_accounts.sql`](../supabase/migrations/20260729104500_mission_accounts.sql) —
   le rôle `saisisseur` et ses invariants portés par trigger.
7. [`supabase/storage.sql`](../supabase/storage.sql) — buckets privés et policies Storage.

### 4.3 Écrire soi-même un test d'attaque (le plus utile)

Le harnais monte un **vrai PostgreSQL** avec les vraies migrations et permet d'exécuter des
requêtes **en tant qu'un utilisateur donné**, RLS appliquée, exactement comme Supabase le ferait.
Écrire un scénario d'attaque prend quelques lignes — créez un fichier `test/mon-attaque.test.ts` :

```ts
import { beforeAll, afterAll, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let curatorId: string;

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const users = await db.admin.query('select email, id from auth.users');
  curatorId = users.rows.find((r) => r.email === 'curator1@demo.test').id;
});

afterAll(async () => { await db?.stop(); });

test("un curateur ne voit jamais l'identite d'un patient", async () => {
  const rows = await db.asUser(curatorId, async (c) =>
    (await c.query('select * from public.patient_identity')).rows,
  );
  expect(rows).toHaveLength(0); // la RLS masque les lignes, elle ne leve pas d'erreur
});
```

Puis `npx vitest run --project db test/mon-attaque.test.ts`.

> **Deux pièges de lecture.**
> **(a)** Sur un `SELECT`, la RLS **masque les lignes** au lieu de lever une erreur : un refus se
> traduit par **0 ligne**. C'est pourquoi chaque test négatif du dépôt est doublé d'un **contrôle
> positif** prouvant qu'un utilisateur légitime voit bien la donnée — sans quoi une table vide
> ferait passer n'importe quel test de sécurité.
> **(b)** Les lignes `ERROR:` dans la sortie d'un run RLS sont **attendues** : ce sont les
> écritures interdites qui lèvent correctement une exception. Seul le décompte final de Vitest
> fait foi.

### 4.4 Questions sur lesquelles un avis extérieur nous aiderait

1. **Les helpers `SECURITY DEFINER` sont-ils correctement bornés ?** Ils contournent la RLS par
   construction ; leur `search_path` est fixé à `public, pg_temp`. Voyez-vous un chemin
   d'abus ?
2. **La séparation identité/analytique par simple absence de clé étrangère** est-elle une garantie
   suffisante, ou faut-il un cloisonnement plus fort (schémas séparés, rôles PostgreSQL distincts,
   chiffrement) ?
3. **La chaîne d'inspection de fichiers** a-t-elle une fenêtre exploitable entre le dépôt, la
   finalisation et le verdict ?
4. **Le modèle des comptes de mission** : voyez-vous une façon pour un `saisisseur` d'obtenir plus
   que sa base, ou de survivre à son échéance ?
5. **L'audit est-il réellement infalsifiable** du point de vue d'un utilisateur authentifié ?
6. **Que feriez-vous différemment** avant d'accepter la moindre donnée réelle ?

---

## 5. Ce qui est déjà connu (ne perdez pas de temps dessus)

Le dernier audit technique interne
([audits/audit-technique-complet-2026-08-09.md](audits/audit-technique-complet-2026-08-09.md),
≈8,8/10, aucun constat critique ou élevé) a laissé ouverts :

| Point connu | Statut |
|---|---|
| `npm audit` signale des vulnérabilités **transitives d'outillage de build** (aucune en runtime de production) | Suivi ; l'`override` `brace-expansion` a depuis été porté à 5.0.9 |
| ~~1 test web en échec (`CreateFlows.test.tsx`)~~ | **Corrigé depuis.** Revérifié le 2026-08-19 : `npm run test:web` → **467/467 tests, 65/65 fichiers**, en 108 s |
| ~~Fichiers parasites `stdout` et `tsc_output.txt` à la racine~~ | **Absents** le 2026-08-19 : ni suivis par git, ni présents dans un checkout neuf |
| Une base restaurée depuis la corbeille **perd son rattachement au groupe de recherche** | Comportement acté, à documenter dans la spec |
| `handle_new_user` lit le rôle dans `raw_app_meta_data` alors que Supabase écrit `app_metadata` ensuite | Défaut réel **documenté dans la migration**, compensé par `reconcile_mission_profile` |
| L'administrateur du serveur peut lire la base | Limite assumée du MVP (§4.1) |
| Cadre juridique et éthique non établi | Bloquant volontaire : aucune donnée réelle |

En revanche, **tout ce que vous trouverez en dehors de cette liste nous intéresse**, y compris
« ce choix est défendable mais voici ce qu'il vous coûtera ».

## 6. Nous faire un retour

Le plus utile, par ordre décroissant :

1. **Un scénario d'attaque qui passe** — idéalement sous forme de test dans `test/` (§4.3). C'est
   irréfutable et directement corrigeable.
2. **Un endroit où la documentation ment** sur le code. Le dépôt est volumineux ; si un document
   vous a induit en erreur, c'est un défaut à part entière.
3. **Un jugement d'architecture argumenté**, même sans correctif proposé.
4. **Ce qui vous a fait perdre du temps** en arrivant : ce guide existe pour ça et doit s'améliorer.

Merci du temps que vous y consacrez.

---

*Guide rédigé le 10 août 2026. Les chiffres proviennent de `npm run db:verify` exécuté ce jour ;
la commande les régénère.*
