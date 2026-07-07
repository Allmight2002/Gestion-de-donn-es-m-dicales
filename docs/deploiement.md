# Déploiement — pilote à données fictives

Ce guide met le service **en ligne** pour une **démo / un pilote contrôlé** avec des
**données entièrement fictives**. La section §8 liste ce qu'il reste à faire **avant** toute
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

> **Pré-vol (recommandé)** : `npm run db:verify` applique le shim + **toutes les migrations
> (dans l'ordre) + le seed** sur un PostgreSQL jetable et affiche un résumé — confirme que le
> schéma **se déploie proprement depuis zéro** avant de pousser vers le cloud.

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

## 6. Lectures de fichiers auditées — Edge `signed-read` (recommandé)

Par défaut le frontend signe lui‑même l'URL d'un document/image (suffisant pour la démo). Pour
que **toute consultation d'un fichier soit tracée côté serveur** et non contournable (audit
§9.2/§9.3), déployez la fonction Edge puis activez le drapeau :

```bash
supabase functions deploy signed-read
supabase functions deploy inspect-upload
supabase functions deploy cleanup-upload
# Secrets (Project Settings → Edge Functions → Secrets) :
supabase secrets set SUPABASE_URL=https://VOTRE-REF.supabase.co \
                     SUPABASE_ANON_KEY=LA_CLE_ANON \
                     SUPABASE_SERVICE_ROLE_KEY=LA_CLE_SERVICE_ROLE \
                     CLAMAV_SCAN_URL=https://scanner.example.org/scan \
                     CLAMAV_SCAN_TOKEN=UN_SECRET_LONG \
                     REQUIRE_SERVER_INSPECTION=true \
                     MAX_INSPECT_UPLOAD_BYTES=20971520 \
                     INSPECTION_SCANNING_STALE_MS=900000
```
Avant un deploiement clinique, lancez aussi `npm run env:check` dans un contexte qui contient les
variables frontend et les secrets Edge : le script refuse une divergence entre
`VITE_REQUIRE_SERVER_INSPECTION` et `REQUIRE_SERVER_INSPECTION`.

Puis, côté frontend, `VITE_USE_SIGNED_READ=true` (rebuild) : images et documents passent par
`signed-read`, qui **autorise** (RLS) → **journalise** (`audit_log`) → **signe**. Si la
journalisation échoue, l'URL n'est **pas** délivrée (§9.3).

> **Données réelles uniquement** : pour exiger une inspection serveur des fichiers *avant* toute
> lecture, ajoutez l'inspection/antivirus (`inspect-upload`, voir
> [docs/edge-functions.md](edge-functions.md)) qui promeut `inspection_status` → `accepted`, puis
> posez le secret `REQUIRE_SERVER_INSPECTION=true` sur la fonction (§9.4). **Inutile pour le
> pilote fictif** (les fichiers restent `accepted_client`).

`cleanup-upload` est le nettoyage serveur des uploads orphelins : si un objet Storage est envoye
mais que l'insertion metier echoue, le frontend demande a cette fonction de supprimer l'objet avec
`service_role`, apres verification du JWT, du prefixe de base et de l'absence de ligne metier.

Le scanner ClamAV fourni dans ce depot se lance avec :

```bash
docker compose -f docker-compose.clamav.yml up -d --build
```

Le compose refuse un `CLAMAV_SCAN_TOKEN` absent ou laisse par defaut, et les images Docker sont
epinglees par digest (`clamav/clamav` + base Node du scanner). Pour les mettre a jour, relevez les
nouveaux digests avec `docker buildx imagetools inspect`, puis validez
`docker compose -f docker-compose.clamav.yml config`. La limite Storage declaree dans
`supabase/storage.sql` est de 20 Mio, inferieure a la limite scanner locale de 25 Mio.

Quand ce mode est actif, posez aussi `VITE_REQUIRE_SERVER_INSPECTION=true` cote frontend. Le build
refuse cette option si `VITE_USE_SIGNED_READ=true` n'est pas pose.

---

## 7. Vérification de mise en ligne (smoke test)
- [ ] Connexion d'un compte créé (e-mail/mot de passe).
- [ ] `system_admin` : créer/publier un gabarit ; **aucun** accès aux données patient.
- [ ] `medecin` : créer une base, un patient, une rencontre ; **importer** un fichier d'exemple
      ([docs/exemple-import-neurochirurgie.csv](exemple-import-neurochirurgie.csv)).
- [ ] Séparation des zones : un collaborateur **sans** accès identité ne voit pas les noms.
- [ ] Export : aucune identité ni image dans le fichier.
- [ ] `curateur` : voir le pool, réserver, finaliser un cas.
- [ ] Réinitialisation de mot de passe (vérifie le SMTP).

---

## 8. Avant de passer à des DONNÉES RÉELLES (pas seulement fictives)

Ce pilote est sûr **uniquement avec des données fictives**. Pour des données patients réelles
(même pseudonymisées), il faut **en plus** :

- **Cadre juridique/éthique** 🚩 : base légale, consentement, approbation éthique, **résidence
  des données** (région d'hébergement Supabase), accord de traitement (DPA).
- **Durcissement serveur** (déplacer côté serveur, via Edge Functions, les opérations encore
  pilotées par le client) : audit des lectures + URL signées, inspection/antivirus des fichiers
  à l'upload, génération/figement des exports. Voir **[docs/edge-functions.md](edge-functions.md)**
  (la fonction `signed-read` §10.1 est livrée prête à déployer). *(Les règles de cohérence sont
  désormais évaluées côté serveur.)*
- **Limite d'anonymat** : la RLS protège l'accès *applicatif*, mais l'administrateur du serveur
  peut techniquement lire la base. Une garantie forte suppose un chiffrement côté client ou des
  identités hors serveur central.
- **Exploitation** : sauvegardes **testées**, monitoring/alerting, suivi des erreurs, MFA.

> Tant que ces points ne sont pas traités : **données entièrement fictives uniquement**.
