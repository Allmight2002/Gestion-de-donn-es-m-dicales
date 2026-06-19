# Créer un projet Supabase (pour le login réel)

> **Pas nécessaire pour développer ni pour lancer les tests.** Tout le code se
> construit et se teste sans Supabase. Ce guide sert uniquement quand vous voudrez
> une **connexion réelle** dans le navigateur. La voie « cloud » ci-dessous ne
> demande **aucun Docker**.

## En bref

Un « projet Supabase » = une base PostgreSQL hébergée + un service d'authentification,
créés en quelques clics sur leur site. Vous récupérez ensuite 2 valeurs (une URL et
une clé publique) à coller dans un fichier `.env`, et l'application se connecte.

## Étapes (≈ 10 minutes)

1. **Compte.** Aller sur https://supabase.com → *Start your project* → se connecter
   (GitHub ou e-mail). Gratuit.
2. **Nouveau projet.** *New project* → donner un nom (ex. `registre-clinique`),
   choisir un **mot de passe de base de données** (à conserver), une **région**
   proche, puis *Create*. Attendre ~2 minutes l'initialisation.
3. **Récupérer les clés.** Dans le projet : *Project Settings* (roue dentée) →
   *API*. Noter :
   - **Project URL** (ex. `https://xxxx.supabase.co`)
   - **anon public** (clé publique, pour le navigateur)
   - **service_role** (clé secrète — **ne JAMAIS** la mettre dans le frontend ni la
     committer ; utile seulement pour des scripts serveur)
4. **Appliquer le schéma.** Menu *SQL Editor* → *New query*. Coller le contenu des
   fichiers de [`supabase/migrations/`](../supabase/migrations) **dans l'ordre des
   numéros** (090100, 090200, … 090700), exécuter (*Run*) à chaque fois.
   *(Variante experte : la CLI Supabase + `supabase db push`.)*
5. **Configurer l'app.** Copier `.env.example` en `.env`, puis renseigner :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=la_cle_anon
   ```
   (Laisser `SUPABASE_SERVICE_ROLE_KEY` de côté tant qu'on n'a pas de script serveur.)
6. **Créer un utilisateur de test.** Menu *Authentication* → *Users* → *Add user* →
   e-mail + mot de passe + cocher la confirmation. Le profil applicatif est créé
   automatiquement (déclencheur). Pour en faire un compte **staff**, exécuter ensuite
   dans le SQL Editor :
   ```sql
   update public.profiles set global_role = 'staff' where id = (
     select id from auth.users where email = 'votre@email'
   );
   ```
7. **Lancer.** `npm run dev` → http://localhost:5173 → se connecter.

## Données de démonstration (optionnel)

Le fichier [`supabase/seed.sql`](../supabase/seed.sql) crée 4 comptes + un jeu de
données fictif. Il est surtout prévu pour le **local/CLI** et les tests. En cloud, le
plus simple est de créer les comptes via *Authentication → Add user* (étape 6) ; les
patients de démo restent facultatifs à ce stade.

## Quand vous aurez fait l'étape 5

Donnez-moi simplement l'**URL** et la clé **anon** (ce ne sont pas des secrets
sensibles — la clé anon est conçue pour le navigateur et protégée par la RLS), et je
branche l'application + vous montre la connexion réelle (staff vs médecin).
