# Fonctions Edge — durcissement « données réelles » (audit §10)

> ⚠️ **Prérequis DONNÉES RÉELLES, pas la démo fictive.** Ces éléments tournent côté serveur
> (runtime **Deno** de Supabase) et/ou exigent un **antivirus** : ils ne s'activent qu'**au
> déploiement cloud** et **ne sont pas testables** avec le PostgreSQL embarqué local. Le code
> de `supabase/functions/` est livré **prêt à déployer** (validé par revue), à **tester sur le
> projet cloud** avant tout usage avec des données sensibles.

---

## §10.1 — URL signée AUDITÉE et non contournable (`signed-read`)

**Problème.** Aujourd'hui le frontend signe lui‑même l'URL d'un document/image
(`storage.createSignedUrl`) puis appelle la journalisation « best effort ». Un client peut donc
**ouvrir un fichier sans laisser de trace**.

**Solution** ([`supabase/functions/signed-read/index.ts`](../supabase/functions/signed-read/index.ts)) :
l'URL n'est obtenable **que** par cette fonction, qui en une transaction :
1. **autorise** en réutilisant la **RLS** (lecture de la ligne avec le JWT de l'utilisateur :
   si la RLS la masque → 403, mêmes règles que l'app, zéro duplication) ;
2. **journalise** (`audit_log`) **avant** de livrer l'URL → trace garantie ;
3. **signe** avec la clé `service_role` (que seul le serveur détient ; buckets privés).

### Déployer
```bash
supabase functions deploy signed-read
# Variables (Project Settings → Edge Functions → Secrets) :
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   # si non injectée automatiquement
```

### Durcissements appliqués (revue §9.3 / §9.4)
- **§9.3** : la fonction écrit `audit_log` **avant** de signer et **vérifie l'erreur d'insertion**
  → si la journalisation échoue, l'URL n'est **pas** délivrée (un document ne peut donc pas être
  lu sans trace).
- **§9.4** : si le secret `REQUIRE_SERVER_INSPECTION=true`, la fonction **refuse** de signer un
  fichier dont `inspection_status <> 'accepted'` (à activer quand l'inspection serveur, §10.2,
  promeut les fichiers). Laissé inactif pour le pilote fictif.

### Entités couvertes (audit v12 §7.9 : exports inclus)
| `entity` | Table d'autorisation (RLS) | Bucket signé | Action `audit_log` |
|---|---|---|---|
| `attachment` | `clinical_attachment` | `clinical-attachments` | `attachment_read` |
| `raw_document` | `raw_document` | `raw-documents` | `raw_document_read` |
| `export` | `export_log` (accès base via cohorte) | `scientific-exports` | `export_read` |

Depuis §7.9, le bucket `scientific-exports` n'a **plus de policy SELECT directe** (storage.sql) :
le re-téléchargement d'un export conservé passe par cette fonction (bouton « Télécharger » de
l'historique d'exports) → journalisé avant signature, non contournable.

### Bascule du frontend — FAITE (derrière un drapeau)
Le frontend appelle déjà la fonction via le helper [`src/data/signedRead.ts`](../src/data/signedRead.ts)
(utilisé par `attachments.ts`, `curation.ts` et `exports.ts`). Comportement piloté par `VITE_USE_SIGNED_READ` :
```ts
// VITE_USE_SIGNED_READ=true  -> invoke('signed-read')  (autorise+journalise+signe côté serveur)
// sinon (démo locale)        -> storage.createSignedUrl (signature client directe)
```
Au déploiement cloud : déployer la fonction puis poser `VITE_USE_SIGNED_READ=true` et rebuild
→ la consultation **ne peut plus** se faire sans trace.

---

## §10.2 — Inspection / antivirus / quarantaine des fichiers (à intégrer au déploiement)

Aujourd'hui l'inspection (magic‑bytes, hash) est **côté navigateur** : statut `accepted_client`
honnête mais insuffisant pour des données réelles (un vrai PDF peut porter une charge active).

**Approche cible** (deploy‑time, nécessite un moteur d'analyse) :
1. **Bucket de quarantaine** : l'upload arrive d'abord dans un bucket `quarantine` (jamais lisible).
2. **Fonction Edge `inspect-upload`** déclenchée par un *webhook Storage* (ou appelée après
   l'upload) qui, avec la clé `service_role` : retélécharge l'objet, **recalcule le hash**,
   re‑vérifie le **vrai type MIME** (magic‑bytes côté serveur), puis lance un **antivirus**
   (ex. ClamAV/`clamd`, ou un service externe de scan).
3. **Verdict** : si propre → déplacer vers le bucket définitif + marquer la ligne
   (`raw_document` / `clinical_attachment`) `status='clean'` ; sinon → laisser en quarantaine,
   `status='quarantined'`, alerter.
4. **Lecture bloquée** tant que `status <> 'clean'` (à ajouter à la RLS / à `signed-read`).

> L'**antivirus réel** (ClamAV ou service tiers) doit être provisionné au déploiement — il
> n'est ni embarquable ni testable dans cet environnement. Cette section décrit l'intégration
> à réaliser le moment venu ; elle n'est volontairement **pas** livrée en code non testé.
