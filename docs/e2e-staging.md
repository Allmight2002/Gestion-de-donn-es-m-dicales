# Preflight clinique E2E sur un environnement staging

La suite de tests officielle (`npm test`) tourne sur un PostgreSQL **embarqué** : elle prouve
la logique (RLS, RPC, migrations) mais **ne peut pas** voir le Storage réel, les Edge Functions
déployées, les URL signées ni le scanner ClamAV. Ce preflight comble ce trou en rejouant la
**chaîne documentaire complète** contre un vrai projet Supabase de *staging* (jumeau jetable de
la prod). C'est la validation réclamée par les audits externes (v18→v20) avant tout pilote avec
documents.

> **État vérifié le 1er août 2026.** La release coordonnée `30718950416` a exercé ce préflight
> sur le SHA `f0bf2af5910f5b4ebf985adf1724b9dcc69745ce` avec inspection stricte, fichier sain et
> EICAR. Le tunnel scanner reste temporaire : cette preuve ne vaut pas hébergement pérenne ni
> autorisation de données réelles.

> **Jamais sur la prod.** Le script `scripts/e2e-staging.mjs` refuse de démarrer si
> `STAGING_SUPABASE_URL` ne pointe pas vers le projet staging. On ne relinke jamais le CLI :
> on cible toujours via `--db-url` / `--project-ref` explicites.

## Pré-requis (une fois)

1. **Projet Supabase staging** (palier gratuit, données jetables). Renseigner `.env.staging`
   (fichier LOCAL, gitignoré : `STAGING_SUPABASE_URL`, `_ANON_KEY`, `_SERVICE_ROLE_KEY`,
   `_DB_URL` (Session pooler, mot de passe **percent-encodé**), comptes de test).
2. Provisionner le staging : `db push` (toutes les migrations), `apply-storage.mjs`
   (buckets + policies), deployer les Edge Functions (`signed-read`, `inspect-upload`,
   `finalize-upload`, `cleanup-upload`, `generate-export`, `reconcile-quarantine`), creer un compte `medecin`.
3. **Scanner ClamAV joignable par l'Edge.** `inspect-upload` s'exécute dans le cloud : il ne
   peut pas joindre `localhost`. En local :
   ```bash
   CLAMAV_SCAN_TOKEN=<jeton> docker compose -f docker-compose.clamav.yml up -d
   cloudflared tunnel --url http://127.0.0.1:8088   # expose /scan, URL éphémère
   ```
   ⚠️ Les tunnels `trycloudflare` gratuits sont **instables** (l'URL change à chaque relance) :
   reposer `CLAMAV_SCAN_URL` à chaque nouvelle URL. Un tunnel nommé (compte Cloudflare) ou un
   petit VPS est préférable pour un usage régulier.

## Ordre d'activation du mode strict (À RESPECTER)

Le drapeau base `require_server_inspection` est le **DERNIER** interrupteur, pas le premier.
L'activer avant que le scanner existe **bloque** les uploads (tout reste `pending`) et la
soumission de curation avec documents. Ordre correct :

1. Héberger/joindre ClamAV (voir ci-dessus).
2. Secrets Edge : `CLAMAV_SCAN_URL`, `CLAMAV_SCAN_TOKEN` (non-défaut), `REQUIRE_SERVER_INSPECTION=true`,
   `QUARANTINE_BUCKET=quarantined-uploads`
   (`npx supabase secrets set --project-ref <ref> …`).
3. Frontend : `VITE_REQUIRE_SERVER_INSPECTION=true` + `VITE_USE_SIGNED_READ=true`, puis rebuild.
4. **Alors seulement**, activer transactionnellement la base apres avoir prouve `/health`, un
   fichier synthetique sain et EICAR sur le scanner isole :
   ```bash
   npm run inspection:activate -- --target=staging
   ```
   La commande execute de facon idempotente l'equivalent de :
   ```sql
   update public.app_security_setting
      set value = 'true', updated_at = now()
    where key = 'require_server_inspection';
   ```
5. `npm run env:check:cloud` (avec `SUPABASE_DB_URL` + les variables strictes) → doit être vert.

## Lancer le preflight

```bash
npm run e2e:staging
```

Scénarios (13 assertions), tous doivent être verts :

| Famille | Ce qui est prouvé |
|---|---|
| **Fichier sain** | `inspect-upload` → `accepted` (hash/taille/MIME serveur) → `signed-read` délivre une URL → octets relus |
| **EICAR dans un .docx** | verdict **ClamAV** `Eicar-Test-Signature` → `quarantined` ; déplacement **physique** vers `quarantined-uploads` ; original supprimé du bucket normal ; pointeur forensique en base ; `signed-read` refusé ; bucket quarantaine illisible par un utilisateur |
| **EICAR déguisé (.pdf)** | contrôle magic-bytes de l'Edge → `quarantined` avant même ClamAV |
| **Upload sans ticket** | policy `storage.objects` → insertion refusée |
| **Objet > 20 Mio** | limite du bucket → refus avant inspection |
| **`accepted_client` (héritage)** | `signed-read` refusé en strict, puis réinspection → `accepted` |

> **Note EICAR + PDF** : un EICAR placé en *commentaire* d'un PDF est jugé *clean* par ClamAV
> (la signature EICAR ne se déclenche qu'en tête de fichier). Le script place donc EICAR dans une
> **archive** (un `.docx` est un ZIP, que ClamAV inspecte récursivement) pour exercer le vrai
> verdict antivirus de bout en bout.

## Résultat de référence (2026-07-09)

Première exécution complète : **13/13 verts** contre le staging `gmsxrniiclrheehhoakn`, mode strict
actif, scanner ClamAV 3.6 M signatures via tunnel. Détection EICAR confirmée côté serveur
(`signature: Eicar-Test-Signature`), quarantaine physique et refus de signature vérifiés.

## Après la session

Couper le tunnel et la pile Docker (`docker compose -f docker-compose.clamav.yml down`).
Remettre éventuellement le staging en non-strict (`value = 'false'`) si on veut y refaire des
tests sans scanner. Le projet staging peut rester : il resservira à chaque preflight de release.
