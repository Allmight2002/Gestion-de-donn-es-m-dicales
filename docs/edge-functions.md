# Fonctions Edge - durcissement donnees reelles

Ces fonctions tournent cote serveur dans le runtime Deno de Supabase. Elles servent aux chemins
qui ne doivent pas etre pilotables uniquement par le navigateur : lecture de fichiers prives,
journalisation non contournable, inspection antivirus et generation d'exports conserves.

Le mode demo reste possible sans antivirus, mais tout deploiement avec donnees reelles doit
activer `signed-read` et, pour les uploads, `inspect-upload`.

---

## 10.1 - URL signee auditee (`signed-read`)

Probleme traite : le frontend ne doit pas pouvoir signer directement un document prive puis
journaliser la lecture en "best effort". La fonction
[`supabase/functions/signed-read/index.ts`](../supabase/functions/signed-read/index.ts) fournit
l'URL uniquement apres :

1. autorisation via RLS avec le JWT utilisateur ;
2. insertion de la trace `audit_log` avant livraison de l'URL ;
3. signature Storage avec la cle `service_role`.

### Deploy

```bash
supabase functions deploy signed-read
supabase functions deploy finalize-upload
supabase functions deploy cleanup-upload
supabase functions deploy generate-export
supabase secrets set SUPABASE_URL=https://VOTRE-REF.supabase.co \
                     SUPABASE_ANON_KEY=LA_CLE_ANON \
                     SUPABASE_SERVICE_ROLE_KEY=LA_CLE_SERVICE_ROLE
```

Le frontend passe par cette fonction quand `VITE_USE_SIGNED_READ=true`. En production, le build
refuse le repli de signature client.

### Entites couvertes

| `entity` | Table d'autorisation | Bucket | Action `audit_log` |
|---|---|---|---|
| `attachment` | `clinical_attachment` | `clinical-attachments` | `attachment_read` |
| `raw_document` | `raw_document` | `raw-documents` | `raw_document_read` |
| `export` | `export_log` | `scientific-exports` | `export_read` |

`signed-read` refuse toujours les statuts `pending`, `scanning` et `quarantined`. Quand le secret
Edge `REQUIRE_SERVER_INSPECTION=true` est pose, il refuse aussi le repli demo `accepted_client` et
n'autorise que `accepted`.

---

## 10.2 - Inspection antivirus (`inspect-upload`)

Le flux serveur est implemente par
[`supabase/functions/inspect-upload/index.ts`](../supabase/functions/inspect-upload/index.ts).

1. Le frontend insere la ligne en `inspection_status='pending'` quand
   `VITE_REQUIRE_SERVER_INSPECTION=true`.
2. Le frontend appelle `supabase.functions.invoke('inspect-upload', { body: { entity, id } })`.
3. La fonction Edge autorise via RLS avec le JWT utilisateur, pose le verrou serveur
   `inspection_status='scanning'` avec un `inspection_run_id`, puis utilise `service_role` pour
   telecharger l'objet prive.
4. Elle telecharge l'objet, recalcule `file_hash` / `file_size`, puis refuse les objets au-dela de
   `MAX_INSPECT_UPLOAD_BYTES`.
5. Elle verifie la coherence extension / magic-bytes cote
   serveur, controle les marqueurs OOXML pour `docx`/`xlsx`, puis appelle le scanner ClamAV HTTP
   (`CLAMAV_SCAN_URL`).
6. La finalisation passe par la RPC `complete_file_inspection` : verdict, metadonnees et audit
   `file_inspected` sont ecrits dans une seule transaction.
7. Verdict propre : la ligne passe en `inspection_status='accepted'`.
8. Verdict infecte, trop volumineux ou incoherent : l'objet est d'abord copie dans le bucket prive
   `quarantined-uploads` (`QUARANTINE_BUCKET`), puis supprime du bucket documentaire normal. La
   ligne passe ensuite en `inspection_status='quarantined'` avec `quarantine_bucket`,
   `quarantine_path` et `quarantined_at`.
9. `signed-read` bloque la lecture tant que la ligne n'est pas `accepted`.

Le `inspection_run_id` empeche un scan perime d'ecrire son verdict si un autre run a repris le
verrou entre-temps. Chaque prise de verrou incremente aussi `inspection_attempt_count`, conserve
`last_inspection_attempt_at` et remet `last_inspection_error` a zero. Si le telechargement Storage
ou le scanner echoue, la ligne redevient relancable (`pending` ou `accepted_client`) avec le dernier
message d'erreur technique. Les relances sont bornees par `MAX_INSPECTION_ATTEMPTS` et freinees par
`INSPECTION_RETRY_COOLDOWN_MS`.

Les statuts `scanning` / `accepted` / `quarantined` restent reserves au serveur par les triggers SQL :
un utilisateur authentifie ne peut pas se les attribuer depuis le frontend, ni sortir un fichier
`scanning` ou `quarantined` vers un statut lisible.

### Nettoyage des uploads orphelins

Les buckets prives n'exposent pas de policy `DELETE`. Si un upload Storage reussit mais que
l'insertion de la ligne metier echoue, le frontend appelle
[`cleanup-upload`](../supabase/functions/cleanup-upload/index.ts). La fonction verifie le JWT, le
prefixe de base, le droit d'ecriture correspondant au bucket et surtout le `upload_ticket`
court-vivant cree avant l'upload. Ce ticket appartient a l'utilisateur, porte le bucket/path exact,
et passe a `attached` dans la meme transaction SQL que la ligne metier. `cleanup-upload` ne peut
donc supprimer qu'un objet dont le ticket est encore `pending`; il refuse aussi l'objet si une ligne
metier le reference deja.

Apres la migration SQL qui cree `upload_ticket`, reappliquez aussi
[`supabase/storage.sql`](../supabase/storage.sql) dans le SQL Editor : les policies d'insert Storage
exigent `has_pending_upload_ticket(bucket_id, name)`.

---

## 10.3 - Exports scientifiques generes cote serveur (`generate-export`)

Probleme traite : un export conserve ne doit plus etre assemble, hashe puis uploade par le
navigateur. Le frontend appelle
[`generate-export`](../supabase/functions/generate-export/index.ts), qui :

1. verifie le JWT utilisateur et l'autorisation `can_export_data(base_id)` ;
2. relit la cohorte figee et les donnees curees cote serveur ;
3. applique la liste blanche analytique et refuse toute colonne identifiante ;
4. genere le CSV ou le XLSX, calcule `file_hash`, stocke le fichier dans `scientific-exports` ;
5. insere `export_log` avec `generation_mode='server'`.

Le telechargement reste separe : l'historique passe par `signed-read`, qui journalise
`export_read` avant de delivrer l'URL signee.

### Deploy

```bash
supabase functions deploy generate-export
```

La fonction utilise les memes secrets que `signed-read` : `SUPABASE_URL`, `SUPABASE_ANON_KEY` et
`SUPABASE_SERVICE_ROLE_KEY`.

---

## 10.4 - Reconciliation de quarantaine (`reconcile-quarantine`)

Probleme traite : le deplacement Storage vers `quarantined-uploads` et la finalisation SQL ne sont
pas atomiques. `inspect-upload` ecrit chaque etape dans `quarantine_move_log`; en cas de coupure,
[`reconcile-quarantine`](../supabase/functions/reconcile-quarantine/index.ts) reprend les mouvements
incomplets.

Cette fonction est reservee aux profils `system_admin`. Elle marque les mouvements non recuperables
en `reconcile_failed` et finalise ceux dont l'objet de quarantaine est deja copie et dont la ligne
documentaire est encore sur le meme `inspection_run_id`.

### Deploy

```bash
supabase functions deploy reconcile-quarantine
```

Elle utilise les memes secrets Supabase que les autres fonctions Edge.

### Deploy ClamAV

Le depot fournit un pont HTTP minimal vers `clamd` :

```bash
docker compose -f docker-compose.clamav.yml up -d --build
curl http://127.0.0.1:8088/health
```

Le compose utilise l'image officielle `clamav/clamav:stable` epinglee par digest et le service
`services/clamav-scanner`, construit depuis une base `node:22-alpine` elle aussi epinglee. Pour
mettre a jour ces images, relevez le nouveau digest avec `docker buildx imagetools inspect`, puis
validez `docker compose -f docker-compose.clamav.yml config` avant de redeployer. Le scanner expose :

```text
POST /scan
Authorization: Bearer <CLAMAV_SCAN_TOKEN>
Content-Type: application/octet-stream
```

`CLAMAV_SCAN_TOKEN` est obligatoire : le service refuse de demarrer avec un secret vide ou un
secret de demonstration (`change-me` / `changeme`). La limite scanner locale par defaut est
`MAX_SCAN_BYTES=26214400`; l'Edge doit rester inferieure ou egale a cette valeur.

Reponses attendues :

```json
{ "status": "clean", "engine": "clamav" }
```

ou :

```json
{ "status": "infected", "signature": "Eicar-Test-Signature", "engine": "clamav" }
```

### Test temporaire depuis un PC

Pour un test de bout en bout, le scanner peut tourner localement avec Docker et etre rendu
joignable par Supabase au moyen d'un tunnel Cloudflare temporaire :

```powershell
$env:CLAMAV_SCAN_TOKEN = 'un-secret-aleatoire-long'
docker compose -f docker-compose.clamav.yml up -d --build
cloudflared tunnel --url http://127.0.0.1:8088
```

Le tunnel affiche une URL `https://...trycloudflare.com`. Configurez alors seulement pour la
session de test :

```powershell
npx supabase secrets set `
  "CLAMAV_SCAN_URL=https://...trycloudflare.com/scan" `
  "CLAMAV_SCAN_TOKEN=$env:CLAMAV_SCAN_TOKEN"
```

Cette URL est ephemere : elle cesse de fonctionner quand le processus `cloudflared`, Docker ou le
PC s'arrete. Ne pas activer `REQUIRE_SERVER_INSPECTION=true`, la politique SQL stricte ou le build
Vercel strict avec ce montage. Pour un environnement clinique, utiliser un tunnel Cloudflare nomme
vers un serveur/VPS disponible en continu, puis seulement activer les drapeaux stricts.

### Maintenance ClamAV

En production, le service antivirus doit etre traite comme une dependance de securite active :

- surveiller `GET /health` et alerter si le ping `clamd` ne repond pas ;
- verifier que les signatures sont mises a jour par l'image ClamAV (`freshclam`) et redemarrer le
  service si l'image signale une base de signatures obsolete ;
- faire tourner periodiquement un scan de controle avec le fichier de test EICAR sur un
  environnement de staging, puis confirmer que `signed-read` refuse toute URL pour le fichier
  mis en quarantaine ;
- faire une rotation de `CLAMAV_SCAN_TOKEN` comme les autres secrets Edge, puis relancer
  `npm run env:check` avant de redeployer ;
- garder `MAX_INSPECT_UPLOAD_BYTES <= MAX_SCAN_BYTES` pour eviter qu'une Edge Function accepte un
  fichier que le scanner refusera ensuite.

### Deploy Edge + frontend

```bash
supabase functions deploy signed-read
supabase functions deploy inspect-upload
supabase functions deploy finalize-upload
supabase functions deploy cleanup-upload
supabase functions deploy generate-export
supabase functions deploy reconcile-quarantine
supabase secrets set SUPABASE_URL=https://VOTRE-REF.supabase.co \
                     SUPABASE_ANON_KEY=LA_CLE_ANON \
                     SUPABASE_SERVICE_ROLE_KEY=LA_CLE_SERVICE_ROLE \
                     CLAMAV_SCAN_URL=https://scanner.example.org/scan \
                     CLAMAV_SCAN_TOKEN=UN_SECRET_LONG \
                     REQUIRE_SERVER_INSPECTION=true \
                     MAX_INSPECT_UPLOAD_BYTES=20971520 \
                     INSPECTION_SCANNING_STALE_MS=900000 \
                     MAX_INSPECTION_ATTEMPTS=5 \
                     INSPECTION_RETRY_COOLDOWN_MS=60000 \
                     QUARANTINE_BUCKET=quarantined-uploads
```

Controlez la coherence des drapeaux avant un deploiement clinique :

```bash
DB_REQUIRE_SERVER_INSPECTION=true \
npm run env:check
```

Cote frontend, posez :

```bash
VITE_USE_SIGNED_READ=true
VITE_REQUIRE_SERVER_INSPECTION=true
```

Et cote base cloud, activez la politique stricte qui empeche `accepted_client` d'entrer dans le
pool de curation :

```sql
update public.app_security_setting
   set value = 'true', updated_at = now()
 where key = 'require_server_inspection';
```

Puis rebuild. Le build refuse explicitement `VITE_REQUIRE_SERVER_INSPECTION=true` si
`VITE_USE_SIGNED_READ=true` n'est pas aussi pose.
