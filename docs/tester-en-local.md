# Tester le produit en local (Supabase + Docker)

Guide pour lancer le registre **bout-en-bout** sur votre poste : un vrai Supabase
(Postgres + Auth + RLS + Storage) tourne dans Docker, le frontend se connecte dessus,
et vous vous connectez avec les comptes de démonstration (données **fictives**).

> Pas besoin de Docker pour les **tests automatisés** : `npm test` (292 tests) démarre
> un PostgreSQL embarqué. Docker ne sert qu'au test **manuel** ci-dessous.

## Prérequis
- **Docker Desktop** lancé (vous l'avez installé ✅).
- **Node.js** (déjà utilisé pour `npm test`).
- Dépendances installées : `npm install`.

## Étapes

### 1. Créer le fichier `.env`
Copiez l'exemple :
```bash
cp .env.example .env        # PowerShell : Copy-Item .env.example .env
```

### 2. Démarrer Supabase en local
```bash
npm run supabase:start
```
Le **premier** démarrage télécharge les images Docker (quelques minutes). À la fin, la
CLI affiche un récapitulatif — notez :
- **API URL** : `http://127.0.0.1:54321`
- **anon key** : `eyJ...` (clé publique, pour le frontend)
- **service_role key** : `eyJ...` (clé serveur — **jamais** dans le frontend)
- **Studio URL** : `http://127.0.0.1:54323` (interface web pour inspecter la base)

Les **migrations** et le **seed** (comptes + données fictives) sont appliqués
automatiquement au démarrage.

### 3. Renseigner la clé anon dans `.env`
Collez la valeur **anon key** affichée :
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJ...
```
(`VITE_SUPABASE_URL` est déjà la bonne valeur par défaut.)

### 4. Créer les buckets de stockage (images / documents bruts / exports)
```bash
npm run supabase:storage
```
> À refaire après chaque `supabase:reset` (le reset ne rejoue que migrations + seed).
> Sans cette étape, l'app marche, mais l'upload d'images/documents et la conservation
> des fichiers d'export échouent.

### 5. Lancer le frontend
```bash
npm run dev
```
Ouvrez **http://127.0.0.1:5173**.

## Se connecter (comptes de démonstration)
Mot de passe commun : **`Password123!`**

| Email | Rôle | À tester |
|---|---|---|
| `admin@demo.test` | system_admin | Administration des **gabarits** (aucun accès patient) |
| `alice@demo.test` | propriétaire de la base | Tout : patients, rencontres, cohortes, export, accès, **curation** |
| `editor@demo.test` | éditeur (identité) | Saisie patients/rencontres + images |
| `curator1@demo.test` | curateur | **Structurer puis finaliser** une tâche de curation (affectée, NCH-002) |
| `validator@demo.test` | curateur | Compte hérité (le rôle `validateur` est supprimé) |
| `anna.analyst@demo.test` | médecin (partage `viewer` + export) | Cohortes + **export** ; ne voit **jamais** identité/documents bruts |

### Parcours suggéré pour voir la curation (cœur v3.0)
1. `alice@demo.test` → base → **Curation** : une tâche existe (patient NCH-002, curateur Carl).
2. `curator1@demo.test` → base → **Curation** → ouvrir la tâche → remplir le brouillon
   (données permanentes + une rencontre), demander éventuellement une **clarification**,
   puis **Finaliser la curation**.
3. La rencontre apparaît alors au statut **`curated`** sur la fiche patient (et entre
   dans les cohortes/exports). L'accès aux documents bruts de la tâche se referme.
4. `anna.analyst@demo.test` → la donnée finalisée est visible en analytique, mais les
   **documents bruts** et l'**identité** restent invisibles.

## Réinitialiser / arrêter
```bash
npm run supabase:reset     # remet les données de démo à zéro (migrations + seed)
npm run supabase:storage   # ré-appliquer les buckets après un reset
npm run supabase:stop      # arrêter les conteneurs
```

## Inspecter la base (optionnel)
Ouvrez **Studio** (`http://127.0.0.1:54323`) : tables `patient`, `encounter`,
`audit_log`, `curation_*`… et l'éditeur SQL pour vérifier le cloisonnement.

## Sécurité (rappel)
- Seules les variables préfixées `VITE_` arrivent dans le navigateur.
- La clé **service_role** reste hors du frontend (elle n'est lue par aucun code `src/`).
- Données **entièrement fictives** : ne saisissez jamais de données réelles.

> Pour un déploiement **cloud** (Supabase hébergé), voir
> [configurer-supabase.md](configurer-supabase.md).
