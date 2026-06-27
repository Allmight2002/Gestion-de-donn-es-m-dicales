# Déploiement — pilote à données fictives

Ce guide met le service **en ligne** pour une **démo / un pilote contrôlé** avec des
**données entièrement fictives**. La section §7 liste ce qu'il reste à faire **avant** toute
donnée réelle (cadre juridique + durcissement serveur).

> Backend = **Supabase cloud** (Postgres + Auth + Storage). Frontend = build **Vite/PWA**
> statique, hébergé séparément. Les migrations s'appliquent **de zéro** (les tests les
> rejouent à chaque exécution) : un projet vierge se déploie proprement.

---

## 1. Prérequis
- Un compte **Supabase** (cloud) + la **CLI** : `npm i -g supabase` (ou `npx supabase`).
- Un compte d'**hébergement statique** pour le frontend (Vercel, Netlify, Cloudflare Pages…).
- Node ≥ 20 et ce dépôt cloné.

---

## 2. Backend Supabase (projet cloud)
1. **Créer le projet** sur le tableau de bord Supabase (notez la *référence* du projet et le
   mot de passe de la base).
2. **Lier + pousser le schéma** (toutes les migrations) :
   ```bash
   supabase link --project-ref VOTRE-REF
   supabase db push
   ```
3. **Appliquer le Storage** (buckets privés + RLS — non couverts par les migrations) :
   ```bash
   SUPABASE_DB_URL="postgresql://postgres:MDP@db.VOTRE-REF.supabase.co:5432/postgres" \
     npm run supabase:storage
   ```
4. **Récupérer les clés** : *Project Settings → API* → `URL`, `anon`, `service_role`.
   Renseignez `.env.production` (voir [.env.production.example](../.env.production.example)).

> ⚠️ Ne chargez **pas** `supabase/seed.sql` en production : il crée des comptes et des
> patients **fictifs** de démonstration. Pour un pilote de démonstration, il peut servir,
> mais pour tout le reste, créez les comptes réels (étape 4).

---

## 3. Authentification
*Project Settings → Authentication* :
- **Site URL** + **Redirect URLs** = l'URL publique du frontend (ex. `https://registre.exemple.org`).
- **SMTP** : configurez un fournisseur d'e-mail. **Sans SMTP, la confirmation de compte et la
  réinitialisation de mot de passe ne fonctionnent pas.** (Le script de l'étape 4 crée des
  comptes déjà confirmés, mais le *reset* mot de passe utilisateur reste tributaire du SMTP.)
- Conservez la **politique de mot de passe** par défaut ou renforcez-la ; activez le rate
  limiting fourni par Supabase.

---

## 4. Comptes (sans le seed de démo)
Créez chaque compte via l'Admin API (clé `service_role`, **côté serveur**) :
```bash
SUPABASE_URL="https://VOTRE-REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  npm run create-account -- medecin@exemple.org "MotDePasseFort" medecin "Dr Exemple"
```
`role ∈ medecin | curateur | system_admin` (défaut `medecin`). Créez au moins un
`system_admin` (gestion des gabarits) et les médecins/curateurs voulus.

---

## 5. Frontend
1. **Variables** : `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` = celles du projet cloud
   (les seules injectées dans le bundle ; `service_role` n'y est **jamais**).
2. **Build** :
   ```bash
   npm ci && npm run build      # genere dist/ (PWA)
   ```
3. **Héberger `dist/`** sur votre host statique, en y déclarant les deux variables `VITE_*`.
   - Vérification : `npm run build` puis recherchez la clé service_role dans `dist/` — elle
     ne doit **jamais** y apparaître (elle n'a pas le préfixe `VITE_`).

---

## 6. Vérification de mise en ligne (smoke test)
- [ ] Connexion d'un compte créé (e-mail/mot de passe).
- [ ] `system_admin` : créer/publier un gabarit ; **aucun** accès aux données patient.
- [ ] `medecin` : créer une base, un patient, une rencontre ; **importer** un fichier d'exemple
      ([docs/exemple-import-neurochirurgie.csv](exemple-import-neurochirurgie.csv)).
- [ ] Séparation des zones : un collaborateur **sans** accès identité ne voit pas les noms.
- [ ] Export : aucune identité ni image dans le fichier.
- [ ] `curateur` : voir le pool, réserver, finaliser un cas.
- [ ] Réinitialisation de mot de passe (vérifie le SMTP).

---

## 7. Avant de passer à des DONNÉES RÉELLES (pas seulement fictives)

Ce pilote est sûr **uniquement avec des données fictives**. Pour des données patients réelles
(même pseudonymisées), il faut **en plus** :

- **Cadre juridique/éthique** 🚩 : base légale, consentement, approbation éthique, **résidence
  des données** (région d'hébergement Supabase), accord de traitement (DPA).
- **Durcissement serveur** (déplacer côté serveur, via Edge Functions, les opérations encore
  pilotées par le client) : audit des lectures + URL signées, inspection/antivirus des fichiers
  à l'upload, génération/figement des exports ; évaluation des **règles de cohérence** côté
  serveur.
- **Limite d'anonymat** : la RLS protège l'accès *applicatif*, mais l'administrateur du serveur
  peut techniquement lire la base. Une garantie forte suppose un chiffrement côté client ou des
  identités hors serveur central.
- **Exploitation** : sauvegardes **testées**, monitoring/alerting, suivi des erreurs, MFA.

> Tant que ces points ne sont pas traités : **données entièrement fictives uniquement**.
