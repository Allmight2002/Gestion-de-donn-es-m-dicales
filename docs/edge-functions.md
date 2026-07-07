# Fonctions Edge - durcissement donnees reelles

Ces fonctions tournent cote serveur dans le runtime Deno de Supabase. Elles servent aux chemins
qui ne doivent pas etre pilotables uniquement par le navigateur : lecture de fichiers prives,
journalisation non contournable et inspection antivirus.

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
supabase functions deploy cleanup-upload
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
3. La fonction Edge autorise via RLS avec le JWT utilisateur, pose atomiquement le verrou serveur
   `inspection_status='scanning'`, puis utilise `service_role` pour telecharger l'objet prive.
4. Elle refuse les objets trop volumineux avant `arrayBuffer()` (`MAX_INSPECT_UPLOAD_BYTES`) et
   journalise la quarantaine via `file_inspected`.
5. Elle recalcule `file_hash`, `file_size`, verifie la coherence extension / magic-bytes cote
   serveur, controle les marqueurs OOXML pour `docx`/`xlsx`, puis appelle le scanner ClamAV HTTP
   (`CLAMAV_SCAN_URL`).
6. Verdict propre : la ligne passe en `inspection_status='accepted'`.
7. Verdict infecte ou fichier incoherent : la ligne passe en `inspection_status='quarantined'`.
8. `signed-read` bloque la lecture tant que la ligne n'est pas `accepted`.

Les statuts `scanning` / `accepted` / `quarantined` restent reserves au serveur par les triggers SQL :
un utilisateur authentifie ne peut pas se les attribuer depuis le frontend, ni sortir un fichier
`scanning` ou `quarantined` vers un statut lisible.

### Nettoyage des uploads orphelins

Les buckets prives n'exposent pas de policy `DELETE`. Si un upload Storage reussit mais que
l'insertion de la ligne metier echoue, le frontend appelle
[`cleanup-upload`](../supabase/functions/cleanup-upload/index.ts). La fonction verifie le JWT, le
prefixe de base, le droit d'ecriture correspondant au bucket, puis refuse de supprimer l'objet si
une ligne metier le reference deja.

### Deploy ClamAV

Le depot fournit un pont HTTP minimal vers `clamd` :

```bash
docker compose -f docker-compose.clamav.yml up -d --build
curl http://127.0.0.1:8088/health
```

Le compose utilise l'image officielle `clamav/clamav:stable` et le service
`services/clamav-scanner`, qui expose :

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
supabase functions deploy cleanup-upload
supabase secrets set SUPABASE_URL=https://VOTRE-REF.supabase.co \
                     SUPABASE_ANON_KEY=LA_CLE_ANON \
                     SUPABASE_SERVICE_ROLE_KEY=LA_CLE_SERVICE_ROLE \
                     CLAMAV_SCAN_URL=https://scanner.example.org/scan \
                     CLAMAV_SCAN_TOKEN=UN_SECRET_LONG \
                     REQUIRE_SERVER_INSPECTION=true \
                     MAX_INSPECT_UPLOAD_BYTES=20971520 \
                     INSPECTION_SCANNING_STALE_MS=900000
```

Controlez la coherence des drapeaux avant un deploiement clinique :

```bash
npm run env:check
```

Cote frontend, posez :

```bash
VITE_USE_SIGNED_READ=true
VITE_REQUIRE_SERVER_INSPECTION=true
```

Puis rebuild. Le build refuse explicitement `VITE_REQUIRE_SERVER_INSPECTION=true` si
`VITE_USE_SIGNED_READ=true` n'est pas aussi pose.
