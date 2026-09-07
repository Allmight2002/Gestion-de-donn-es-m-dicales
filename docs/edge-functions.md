# Fonctions Edge - durcissement donnees reelles

Ces fonctions tournent cote serveur dans le runtime Deno de Supabase. Elles servent aux chemins
qui ne doivent pas etre pilotables uniquement par le navigateur : lecture de fichiers prives,
journalisation non contournable, inspection antivirus et generation d'exports conserves.

Une modification locale sous `supabase/functions/` ne change pas le cloud : chaque fonction doit
etre redeployee explicitement, puis verifiee sur la cible. Les validations locales de ce document
ne constituent donc jamais une preuve de version Edge deployee.

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
supabase functions deploy signed-read --import-map deno.json
supabase functions deploy finalize-upload --import-map deno.json
supabase functions deploy cleanup-upload --import-map deno.json
supabase functions deploy generate-export --import-map deno.json
supabase functions deploy purge-deleted-base --import-map deno.json
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
1 bis. resout le **profil de donnees** `options.profile` : `analysis` (defaut) ou `complete`. Un
   appel qui n'envoie pas de profil reste accepte et recoit `analysis` ; une valeur inconnue est
   refusee en HTTP 400. Le profil ne change ni l'autorisation, ni la liste anti-identite, ni le
   figeage, ni le hash : il ne decide que de la FORME du fichier ;
2. relit la cohorte figee cote serveur par pages de 500, avec comptage exact et ordre stable ; les
   filtres de listes sont decoupes par groupes de 200 identifiants ;
2 bis. ecarte les fiches auxquelles il manque un champ obligatoire -- `export_incomplete_records`,
   qui applique la definition de la base (`missing_required_fields`), et non le statut de
   validation ; les exclusions sont comptees dans `export_options.excluded_records` ;
3. applique la liste blanche analytique et refuse toute colonne identifiante ;
4. genere le CSV ou le XLSX, calcule `file_hash`, stocke le fichier dans `scientific-exports` ;
5. insere `export_log` avec `generation_mode='server'`, le profil dans
   `export_options.profile` et le nom de telechargement dans
   `export_options.download_filename`.

### Les deux profils de donnees (L45 a L49)

| | `analysis` (defaut) | `complete` |
|---|---|---|
| Feuille principale XLSX | `Donnees` | `Export` |
| Autres feuilles XLSX | `Dictionnaire`, `Modalites`, `Metadonnees` | `Dictionnaire` + feuilles relationnelles multiselect |
| Liste controlee (`select`) | une colonne portant le **code stable** ; le libelle vit une seule fois dans `Modalites` | libelle en colonne principale + `option_code__<colonne>` |
| `multiselect` | uniquement des indicatrices `has__<colonne>__<modalite>` en `0`/`1` | libelles concatenes, `option_code__`, `nb__`, feuille relationnelle ET indicatrices |
| Dates et datetime XLSX | valeurs Excel natives (serie, heure UTC, formats `yyyy-mm-dd` et `yyyy-mm-dd hh:mm:ss`) | idem |
| Dictionnaire | reduit aux colonnes utiles a l'interpretation | detaille, forme historique |

En `analysis`, une cellule **vide** signifie « champ non applicable ou absent de la version de
gabarit » ; un `0` d'indicatrice signifie « champ applicable, modalite non selectionnee ». Une
raison explicite de valeur manquante met les indicatrices a `0` et n'est jamais lisible comme une
selection. Le CSV n'a qu'une feuille : il porte les memes colonnes que la feuille principale du
profil demande, et conserve les dates au format ISO sans conversion.

La feuille `Metadonnees` (profil `analysis`) rend le fichier autonome sans exposer d'identite :
`export_profile`, `generated_at`, `base_name`, `cohort_name`, `export_mode`, `selection_rule`,
`template_versions`, `row_count`, `excluded_patients_incomplete`,
`excluded_encounters_incomplete`. Aucun UUID, code patient ou date de naissance n'y figure.

Pour un champ de terminologie, l'export produit deux colonnes distinctes **dans les deux
profils** : la colonne principale contient le libelle lisible et `terminology_code__<colonne>`
contient le code stable utilise pour l'analyse. Le dictionnaire XLSX decrit egalement cette
colonne comme `terminology_code`. Les deux colonnes comptent dans les limites de largeur de
l'export. Le traitement analytique des concepts diagnostiques releve du lot L50, **differe**.

Le nom presente a l'utilisateur suit le contrat :
`meddata_<base>_<cohorte>_<patients|rencontres>_<analyse|complet>_<AAAA-MM-JJ_HH-mm-ssZ>.<csv|xlsx>`.
Le segment de profil rend le fichier identifiable hors de l'application. Les noms de base
et de cohorte sont normalises (accents, caracteres de chemin et ponctuation retires, segments
bornes) avant usage. Exemple :
`meddata_urgences-pediatriques_traumatismes-craniens_rencontres_analyse_2026-07-28_06-15-09Z.xlsx`.
Ce nom metier n'est pas utilise comme cle Storage : `stored_file_path` reste pseudonymise avec les
identifiants techniques de la base et de la cohorte.

L'export est borne avant materialisation : 10 000 patients, 50 000 rencontres, 25 000 champs de
dictionnaire, 1 000 000 cellules, 1 000 colonnes CSV ou 256 colonnes XLSX. Un depassement renvoie
HTTP 413 avec `EXPORT_LIMIT_EXCEEDED`. Un compte ou une pagination incoherente, une page
intermediaire incomplete ou un doublon entre pages ferme le chemin avec HTTP 409
`EXPORT_INCOMPLETE`; une lecture serveur en echec renvoie HTTP 500 `EXPORT_READ_FAILED`. Aucune de
ces situations ne peut produire un export HTTP 200 partiel. En profil `analysis`, un multiselect
de plus de **100 codes** ferme aussi le chemin en HTTP 413 `EXPORT_INDICATOR_CARDINALITY` plutot
que de produire un fichier tronque ; le profil `complete`, qui concatene les codes au lieu d'ouvrir
une colonne par modalite, n'a pas ce seuil.

Le telechargement reste separe : l'historique passe par `signed-read`, qui journalise
`export_read` avant de delivrer l'URL signee avec le nom lisible en `Content-Disposition`. Pour les
exports anciens qui ne possedent pas `download_filename`, la fonction conserve le comportement de
telechargement historique et le frontend utilise le nom de la cle Storage en repli.

### Deploy

```bash
supabase functions deploy generate-export --import-map deno.json
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
supabase functions deploy reconcile-quarantine --import-map deno.json
```

Elle utilise les memes secrets Supabase que les autres fonctions Edge.

### Deploy ClamAV

> Toute cette section ne concerne que `INSPECTION_MODE=strict`. Depuis la
> [decision du 12 aout 2026](decision-pause-inspection-2026-08-12.md), le parcours antivirus
> est **suspendu par defaut** : ni conteneur, ni tunnel, ni secrets `CLAMAV_*` ne sont requis
> pour deployer — et aucun fichier depose n'est alors analyse.

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

`CLAMAV_SCAN_TOKEN` est obligatoire : le service refuse de demarrer avec un secret de moins de
32 caracteres, vide ou de demonstration (`change-me` / `changeme`). La limite scanner locale par defaut est
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
$env:CLAMAV_SCAN_TOKEN = 'un-secret-aleatoire-de-32-caracteres-minimum'
docker compose -f docker-compose.clamav.yml up -d --build
cloudflared tunnel --url http://127.0.0.1:8088
```

Le tunnel affiche une URL `https://...trycloudflare.com`. Configurez alors seulement pour la
session de test :

```powershell
npx supabase projects list --output json
$projectRef = '<reference-du-projet-verifiee>'
npx supabase secrets set `
  "CLAMAV_SCAN_URL=https://...trycloudflare.com/scan" `
  "CLAMAV_SCAN_TOKEN=$env:CLAMAV_SCAN_TOKEN" `
  --project-ref $projectRef `
  --yes
```

#### Renouveler l'URL temporaire sans interrompre le scanner

Une URL `trycloudflare.com` change a chaque relance. Ne pas arreter l'ancien tunnel avant que le
nouveau soit joignable et que le secret Edge ait ete mis a jour. Ne jamais se fier implicitement au
projet Supabase lie au depot : relever le nom et la reference du projet cible, puis toujours passer
`--project-ref`.

1. Verifier le scanner local et relever les processus Cloudflare existants :

   ```powershell
   docker compose -f docker-compose.clamav.yml ps
   Invoke-RestMethod http://127.0.0.1:8088/health
   $oldTunnelIds = @(Get-Process cloudflared -ErrorAction SilentlyContinue).Id
   ```

2. Demarrer un nouveau tunnel en arriere-plan et conserver son journal hors du depot :

   ```powershell
   $tunnelDir = Join-Path $env:LOCALAPPDATA 'MedData\cloudflared-clamav'
   New-Item -ItemType Directory -Force -Path $tunnelDir | Out-Null
   $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
   $stdoutLog = Join-Path $tunnelDir "tunnel-$stamp.out.log"
   $stderrLog = Join-Path $tunnelDir "tunnel-$stamp.err.log"

   $newTunnel = Start-Process `
     -FilePath (Get-Command cloudflared).Source `
     -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8088', '--no-autoupdate') `
     -WindowStyle Hidden `
     -RedirectStandardOutput $stdoutLog `
     -RedirectStandardError $stderrLog `
     -PassThru

   $tunnelBase = $null
   for ($attempt = 0; $attempt -lt 40 -and -not $tunnelBase; $attempt++) {
     Start-Sleep -Milliseconds 500
     if ($newTunnel.HasExited) { throw 'cloudflared s''est arrete avant de fournir une URL.' }
     if (Test-Path -LiteralPath $stderrLog) {
       $logText = Get-Content -LiteralPath $stderrLog -Raw
       $tunnelBase = [regex]::Match(
         $logText,
         'https://[a-z0-9-]+\.trycloudflare\.com'
       ).Value
     }
   }
   if (-not $tunnelBase) { throw 'URL trycloudflare introuvable dans le journal.' }
   Invoke-RestMethod "$tunnelBase/health"
   ```

   Le resultat `/health` doit etre HTTP 200 avec `status: ok` et `engine: clamav`. En cas d'echec,
   arreter seulement `$newTunnel` et conserver l'ancien tunnel et le secret Edge inchanges.

3. Identifier explicitement la cible puis mettre a jour l'URL dans l'environnement GitHub Actions
   et dans les secrets Edge du meme staging. Ne faire tourner `CLAMAV_SCAN_TOKEN` que lors d'une
   rotation planifiee :

   ```powershell
   $repository = 'Allmight2002/Gestion-de-donn-es-m-dicales'
   $githubEnvironment = 'staging'
   gh secret set CLAMAV_SCAN_URL `
     --repo $repository `
     --env $githubEnvironment `
     --app actions `
     --body "$tunnelBase/scan"

   npx supabase projects list --output json
   $projectRef = '<reference-du-projet-verifiee>'

   npx supabase secrets set `
     "CLAMAV_SCAN_URL=$tunnelBase/scan" `
     --project-ref $projectRef `
     --yes

   npx supabase secrets list --project-ref $projectRef --output json
   ```

   Un job qui declare `environment: staging` lit d'abord les secrets de cet environnement : ceux-ci
   remplacent les secrets de niveau depot portant le meme nom. Mettre a jour seulement le secret du
   depot ne suffit donc pas. `gh secret list --env staging` et la liste Supabase doivent tous deux
   montrer un `updated_at` recent pour `CLAMAV_SCAN_URL`. La valeur retournee par la CLI Supabase est
   une empreinte : elle ne permet pas de relire l'URL en clair. Ne jamais afficher le jeton ClamAV ni
   le copier dans l'historique du terminal.

4. Effectuer un scan synthetique authentifie, sans fichier utilisateur ni donnee medicale :

   ```powershell
   $containerEnv = docker inspect claudemeddata-clamav-scanner-1 `
     --format '{{range .Config.Env}}{{println .}}{{end}}'
   $tokenLine = $containerEnv |
     Where-Object { $_ -like 'SCAN_TOKEN=*' } |
     Select-Object -First 1
   if (-not $tokenLine) { throw 'Jeton scanner introuvable.' }
   $scanToken = $tokenLine.Substring('SCAN_TOKEN='.Length)
   $body = [Text.Encoding]::UTF8.GetBytes('MedData synthetic scanner connectivity check')

   Invoke-RestMethod `
     -Uri "$tunnelBase/scan" `
     -Method Post `
     -Headers @{ Authorization = "Bearer $scanToken" } `
     -ContentType 'application/octet-stream' `
     -Body $body
   ```

   Le verdict attendu est `status: clean` et `engine: clamav`.

5. Seulement apres ces controles, arreter les anciens processus sans toucher au nouveau, puis
   verifier une derniere fois la sante publique :

   ```powershell
   $oldTunnelIds | ForEach-Object { Stop-Process -Id $_ -Force }
   Get-Process -Id $newTunnel.Id
   Invoke-RestMethod "$tunnelBase/health"
   ```

Cette procedure actualise le tunnel et les secrets GitHub/Edge ; elle ne prouve pas a elle seule le
parcours `inspect-upload` complet, la quarantaine, le mode strict ni l'aptitude a la production.

Apres une extinction, une veille prolongee ou une perte reseau, un processus `cloudflared` peut
rester visible alors que son hostname ne se resout plus. Un PID actif n'est donc jamais une preuve
de disponibilite : exiger une nouvelle reponse publique `/health` et, si elle echoue, creer une
nouvelle URL avant de relancer la CI.

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
supabase functions deploy signed-read --import-map deno.json
supabase functions deploy inspect-upload --import-map deno.json
supabase functions deploy finalize-upload --import-map deno.json
supabase functions deploy cleanup-upload --import-map deno.json
supabase functions deploy generate-export --import-map deno.json
supabase functions deploy reconcile-quarantine --import-map deno.json
supabase functions deploy purge-deleted-base --import-map deno.json
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

---

## 10.5 - Justificatifs des comptes de mission (`create-mission-account`)

Cette fonction remplace entièrement l'ancien circuit d'invitation par e-mail du rôle
`saisisseur`. Elle accepte quatre actions authentifiées :

| Action | Effet |
|---|---|
| `create` | réserve une opération idempotente, crée l'identité Auth technique, l'accès borné et l'enveloppe chiffrée du mot de passe |
| `reveal` | vérifie que l'appelant est le propriétaire de la base, déchiffre le mot de passe en mémoire et audite la consultation sans le secret |
| `regenerate` | génère un nouveau mot de passe, incrémente la génération du justificatif, met à jour Auth et supprime les sessions antérieures |
| `revoke` | révoque l'accès et le justificatif, supprime les sessions et bannit l'identité Auth de mission |

L'identifiant visible est choisi par le propriétaire et reste stable lors d'une régénération.
Auth utilise en interne une adresse technique de la forme `<identifiant>@mission.meddata.invalid` ;
elle n'est jamais présentée à l'utilisateur et n'est pas un canal de récupération. Le frontend ne
reçoit jamais la clé `service_role`.

### Chiffrement et reprise

Le mot de passe est généré avec `crypto.getRandomValues`, puis stocké uniquement sous forme
d'enveloppe AES-256-GCM dans `mission_account_credential`. La clé de chiffrement est un secret Edge
dédié de 32 octets, encodé en base64url :

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$value = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
npx supabase secrets set "MISSION_CREDENTIALS_ENCRYPTION_KEY=$value" `
  --project-ref '<reference-explicitement-verifiee>' `
  --yes
Remove-Variable value, bytes
```

Ne jamais afficher, journaliser ni conserver cette valeur dans le dépôt. Utiliser une valeur
distincte par environnement et ne pas la faire tourner sans procédure de rechiffrement : les mots
de passe déjà conservés deviendraient sinon illisibles. La présence du nom de secret se vérifie avec
`supabase secrets list`; sa valeur n'est pas récupérable par cette commande.

Chaque création ou régénération possède un `operationId` fourni par le navigateur. La réservation
SQL précède la création ou la mise à jour Auth. Un rejeu strict du même `operationId` restitue donc
le même justificatif, tandis qu'une demande différente avec le même identifiant est refusée. Une
régénération n'est jamais déclenchée implicitement par la reprise d'une création.

Les RPC de réservation et de finalisation sont exécutables par `service_role` seulement. L'Edge y
transmet l'UUID de l'appelant déjà authentifié ; la base revalide que cet acteur possède la base et
l'inscrit comme auteur de l'audit. Un navigateur muni d'un JWT de propriétaire ne peut donc pas
injecter sa propre enveloppe chiffrée ni finaliser une opération hors de l'Edge.

La base ne fait pas confiance à la seule validité du JWT : pour le rôle `saisisseur`, la génération
inscrite dans `app_metadata.mission_credential_generation` doit correspondre à la génération active
en base. L'échéance et la révocation de `base_access` restent également vérifiées par RLS.

### Déploiement et vérification

```bash
supabase functions deploy create-mission-account --import-map deno.json
node scripts/verify-mission-account.mjs --env-file=.env.staging --prefix=STAGING_
```

Le secret doit être posé sur la cible Supabase avant de déployer la fonction. La vérification
distante utilise uniquement des données fictives et ne doit imprimer aucun identifiant de connexion
ni mot de passe de mission. Une fusion Git ne déploie pas cette fonction : MedData exige le workflow
manuel **Coordinated release**, d'abord sur staging puis sur production pour le même commit et avec
l'identifiant du run staging réussi.

---

## 10.6 - Purge définitive d'une base de la corbeille (`purge-deleted-base`)

La purge D10 est une action immédiate du propriétaire, y compris pour une base non vide. Le
frontend n'utilise jamais `service_role` : il appelle l'Edge avec son JWT, et l'Edge sépare les
étapes suivantes :

1. `prepare_base_purge` authentifie l'appelant, vérifie le propriétaire, refuse une base active,
   verrouille la ligne de base et persiste une opération `pending` avec le manifeste et son hash ;
2. l'Edge relit les quatre buckets privés (`raw-documents`, `clinical-attachments`,
   `scientific-exports`, `quarantined-uploads`), supprime les chemins connus et les objets
   orphelins sous le préfixe de la base, puis vérifie que le préfixe est vide ;
3. la RPC `finalize_base_purge`, exécutable par `service_role` seulement, verrouille l'opération
   et la base, détache `export_log.base_id`, conserve `base_reference_id` et l'audit, puis
   supprime explicitement les dépendances PostgreSQL dans une seule transaction.

Une panne de listing, de suppression ou de vérification Storage ne déclenche jamais la
finalisation SQL ; l'opération reste rejouable. Une réponse perdue est idempotente : une
opération déjà terminée renvoie `ALREADY_PURGED` sans second effet de bord. Les erreurs internes
ne sont pas transmises au navigateur, qui ne reçoit que des codes et messages choisis.

La table `export_log` est compatible avec les anciens chemins d'insertion : un trigger complète
`base_reference_id` depuis `base_id` à la création et interdit ensuite de modifier cette référence.
Après purge, les octets Storage sont supprimés mais le journal des exports et `audit_log` restent
lisibles comme preuves détachées. Avant toute cible réelle, la sauvegarde doit être vérifiée et la
validation finale du circuit de release doit être acquise ; le lot local D10 ne touche aucune
cible distante.
