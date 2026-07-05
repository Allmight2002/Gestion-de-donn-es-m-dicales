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

Quand le secret Edge `REQUIRE_SERVER_INSPECTION=true` est pose, `signed-read` refuse tout fichier
dont `inspection_status <> 'accepted'`.

---

## 10.2 - Inspection antivirus (`inspect-upload`)

Le flux serveur est implemente par
[`supabase/functions/inspect-upload/index.ts`](../supabase/functions/inspect-upload/index.ts).

1. Le frontend insere la ligne en `inspection_status='pending'` quand
   `VITE_REQUIRE_SERVER_INSPECTION=true`.
2. Le frontend appelle `supabase.functions.invoke('inspect-upload', { body: { entity, id } })`.
3. La fonction Edge autorise via RLS avec le JWT utilisateur, puis utilise `service_role` pour
   telecharger l'objet prive.
4. Elle recalcule `file_hash`, `file_size`, verifie la coherence extension / magic-bytes cote
   serveur, puis appelle le scanner ClamAV HTTP (`CLAMAV_SCAN_URL`).
5. Verdict propre : la ligne passe en `inspection_status='accepted'`.
6. Verdict infecte ou fichier incoherent : la ligne passe en `inspection_status='quarantined'`.
7. `signed-read` bloque la lecture tant que la ligne n'est pas `accepted`.

Le statut `accepted` / `quarantined` reste reserve au serveur par les triggers SQL existants :
un utilisateur authentifie ne peut pas se l'attribuer depuis le frontend.

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

Reponses attendues :

```json
{ "status": "clean", "engine": "clamav" }
```

ou :

```json
{ "status": "infected", "signature": "Eicar-Test-Signature", "engine": "clamav" }
```

### Deploy Edge + frontend

```bash
supabase functions deploy signed-read
supabase functions deploy inspect-upload
supabase secrets set SUPABASE_URL=https://VOTRE-REF.supabase.co \
                     SUPABASE_ANON_KEY=LA_CLE_ANON \
                     SUPABASE_SERVICE_ROLE_KEY=LA_CLE_SERVICE_ROLE \
                     CLAMAV_SCAN_URL=https://scanner.example.org/scan \
                     CLAMAV_SCAN_TOKEN=UN_SECRET_LONG \
                     REQUIRE_SERVER_INSPECTION=true
```

Cote frontend, posez :

```bash
VITE_USE_SIGNED_READ=true
VITE_REQUIRE_SERVER_INSPECTION=true
```

Puis rebuild. Le build refuse explicitement `VITE_REQUIRE_SERVER_INSPECTION=true` si
`VITE_USE_SIGNED_READ=true` n'est pas aussi pose.
