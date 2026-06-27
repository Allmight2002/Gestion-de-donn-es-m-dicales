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

### Basculer le frontend (à faire au déploiement)
Remplacer les appels directs `storage.from(bucket).createSignedUrl(...)` (dans
`src/data/attachments.ts` et la lecture des `raw_document`) par :
```ts
const { data, error } = await supabase.functions.invoke('signed-read', {
  body: { entity: 'attachment' /* | 'raw_document' */, id },
});
// data.url = URL signée (l'audit a déjà été écrit côté serveur)
```
…et **retirer** le `createSignedUrl` client + l'appel séparé `log_sensitive_read` (devenus
inutiles). Ainsi la consultation **ne peut plus** se faire sans trace.

> Tant que le frontend n'est pas basculé, le flux local actuel (signature client + audit best
> effort) reste en place — il fonctionne pour la **démo fictive**, mais pas pour des données
> réelles.

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
