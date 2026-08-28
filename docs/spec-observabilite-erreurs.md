# Spécification — Observabilité des erreurs et notification des bugs

- Statut : ✅ **implémentée** (lot L11, 2026-08-13) — migrations
  `20260813170000_client_error_observability.sql` et `20260813200000_client_error_pgcrypto_search_path.sql`,
  client `src/lib/reportError.ts` / `src/data/clientErrors.ts`, écran `SystemStatus.tsx`,
  tests `test/client-errors.test.ts`. L'**alerting** (notification sortante) reste rattaché à B5
- Date : 2026-07-22
- Demandeur : Dr Mbassi (besoin : être informé automatiquement des bugs en production et de leurs causes)
- Rattachement : chantier **monitoring (B5)** du rapport `docs/readiness-production-2026-07-19.md`
- Cadre de calendrier : développement local autorisé par
  `docs/feuille-route-developpement-post-readiness.md`, avec données fictives
  uniquement. B5 reste nécessaire pour déclarer la notification distante
  opérationnelle ; toute modification crée un nouveau SHA à revalider avant
  staging ou promotion.

## 1. Besoin et état actuel

Le porteur doit pouvoir être averti quand un bug survient en production, et en connaître la cause, sans jamais exposer de donnée patient. L'état vérifié du dépôt au 2026-07-22 :

| Élément existant | Ce qu'il fait | Sa limite |
|---|---|---|
| `src/lib/reportError.ts` | Capture une erreur (nom, message, pile technique, arbre de composants, `context`) dans un tampon mémoire borné à 20 entrées + `console.error` | **N'envoie rien** hors de l'appareil ; le tampon disparaît au rafraîchissement ; volontairement sans service externe (pas de Sentry) |
| `src/components/ErrorBoundary.tsx` | Intercepte les plantages de rendu React → `reportClientError(error, componentStack, 'react-render')` ; affiche un repli localisé | Ne capture **que** les erreurs de rendu React |
| `main.tsx` | — | **Aucun filet global** : les erreurs asynchrones/hors rendu (`window.onerror`, `unhandledrejection`) ne sont captées par rien |
| `operations-monitor.yml` + `docs/supervision.md` | Sonde de disponibilité toutes les 15 min ; alerte JSON expurgée vers `MONITOR_ALERT_WEBHOOK_URL` après deux échecs | Surveille la **disponibilité** des services, pas les bugs applicatifs ; destination d'alerte non configurée (B5) |

Autrement dit, les deux moitiés utiles existent séparément — une **notification automatique** (pour les pannes de service) et une **capture de cause** (pour les plantages d'écran) — mais elles ne sont ni connectées, ni complètes, et rien ne persiste ni ne remonte au porteur.

Le module `reportError.ts` est conçu comme **point de branchement unique** d'un futur puits interne (commentaire du fichier). Cette spécification décrit ce puits.

## 2. Principe directeur : privacy-safe par construction

La règle projet (CLAUDE.md) interdit d'exposer une erreur interne brute ou une donnée médicale au frontend **ou dans les logs**. Un traceur externe classique est donc exclu : le payload d'erreur pourrait contenir des données patient (valeurs de formulaire, contenu de variables). Trois lignes de défense, cumulatives :

1. **Minimisation à la source** : seuls sont transmis nom, message, pile technique, arbre de composants et un `context` **énuméré** (jamais l'état applicatif, jamais une valeur de champ). C'est déjà le contrat de `ClientErrorRecord` ; la spec le fige.
2. **Épuration (`scrubbing`)** avant persistance : un passage retire les motifs ressemblant à des données (e-mails, longues suites de chiffres, jetons, chaînes entre guillemets dans les messages) et tronque message/pile à une taille bornée. Imperfection assumée — d'où la 3ᵉ ligne.
3. **Confinement** : la table d'erreurs est en **accès administrateur strict**, à **rétention courte**, et jamais exportable. Si une valeur échappe malgré tout aux deux premières lignes, son exposition reste bornée dans le temps et les personnes.

Le `context` doit rester une **liste blanche** (`react-render`, `unhandled-rejection`, `window-error`, `data-save`, `import`, `upload`, `export`, `auth`, …), jamais une chaîne libre susceptible de véhiculer un contenu saisi.

## 3. Décisions de conception

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Réutiliser `reportError.ts` comme point d'entrée unique | Instrumenter partout | Le module est déjà l'unique porte ; on y branche le puits sans toucher au reste |
| Puits interne = table Supabase dédiée `client_error_log` | Service externe (Sentry, Datadog) | Aucune donnée ne doit sortir ; cf. §2 |
| Écriture via RPC `record_client_error` (`SECURITY DEFINER`) | `insert` direct sous RLS | Cohérent avec le principe « écritures par RPC » ; permet épuration/plafonnement/anti-abus côté serveur |
| **v1 : persistance seulement si session authentifiée** | Accepter les erreurs anonymes | Évite une surface d'écriture non authentifiée (risque de flood/DoS). Les erreurs pré-connexion restent locales (console + tampon) |
| Ajouter le filet global manquant (`window.onerror`, `unhandledrejection`) | Garder la seule `ErrorBoundary` | Sans lui, un enregistrement échoué ou une promesse rejetée ne produit **rien** — c'est le trou principal |
| Alerte via le **webhook expurgé du monitor** existant | Nouveau canal d'e-mail dédié | Réutilise la plomberie B5 déjà expurgée et testable (`alert_test=true`) |
| L'alerte ne transporte que des **agrégats + type + `context` + identifiant de référence** | Envoyer le message/la pile | Défense en profondeur : même « niveau code », une pile peut incidemment contenir une valeur. Le détail (épuré) reste dans la table, consulté via écran admin |
| Écran « État du système » réservé `system_admin` | Ouvrir au rôle `medecin` | Diagnostic technique, pas donnée métier ; `medecin` en option explicite (§11) |
| Migration **additive**, table neuve | Réutiliser `audit_log` | `audit_log` trace des actions métier ; mélanger diagnostic technique et piste d'audit nuirait aux deux |

## 4. Modèle de données (migration additive unique)

Aucune migration existante modifiée. Nouvelle migration horodatée ajoutant :

**Table `public.client_error_log`** (zone diagnostic/technique — **jamais** de donnée patient) :

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `occurred_at` | timestamptz | horodatage client, borné (rejet si trop dérivé) |
| `received_at` | timestamptz default now() | horodatage serveur |
| `user_id` | uuid null → `profiles(id)` | auteur si authentifié |
| `error_name` | text | ex. `TypeError` (tronqué) |
| `error_message` | text | **épuré + tronqué** (§2) |
| `stack` | text null | **épuré + tronqué** |
| `component_stack` | text null | arbre React, tronqué |
| `context` | text | **contraint à la liste blanche** (`check`) |
| `app_version` | text null | SHA/version de build, pour corréler au déploiement |
| `severity` | text | `error`/`fatal`, `check` |
| `fingerprint` | text | hachage (nom+context+pile normalisée) pour regrouper les occurrences |
| `source` | text | `web` (v1) ; `edge` en phase 2, `check` |
| `notified_at` | timestamptz null | posé quand l'agrégat a été envoyé en alerte |

Index sur `(fingerprint, received_at)` et `received_at`. RLS activée. **Aucune** politique de `select` pour `authenticated` ordinaire ; lecture réservée `system_admin` (§7). Écriture uniquement via la RPC.

## 5. Chaîne de capture (frontend)

1. **Filet global** ajouté dans `main.tsx` : `window.addEventListener('error', …)` et `('unhandledrejection', …)` appellent `reportClientError(err, undefined, 'window-error' | 'unhandled-rejection')`. L'`ErrorBoundary` reste inchangée (`context='react-render'`).
2. **Points métier ciblés** : les chemins critiques (échec d'enregistrement, import, upload, export, auth) appellent `reportClientError(err, …, '<context énuméré>')` pour capter aussi les erreurs rattrapées silencieusement.
3. `reportClientError` conserve son comportement local (tampon + console) **et** — si session authentifiée — pousse le enregistrement épuré vers la RPC `record_client_error`, en **best-effort** : l'échec de remontée ne doit jamais casser l'UI ni reboucler (pas d'« erreur de report d'erreur » persistée).
4. **Anti-boucle / anti-flood côté client** : dédoublonnage par `fingerprint`, plafond d'envois par minute, réutilisation du tampon borné à 20. Un bug en boucle ne doit pas inonder le réseau.

## 6. RPC `record_client_error`

- Signature : `record_client_error(p_occurred_at, p_name, p_message, p_stack, p_component_stack, p_context, p_app_version, p_severity)`.
- `SECURITY DEFINER`, `search_path` borné, `grant execute … to authenticated` — **à ajouter à `supabase/security-definer-allowlist.json` avec justification** (discipline B9, sinon `db:function-acl:verify` échoue, volontairement).
- Contrôles serveur : exiger `auth.uid()` ; valider `context` ∈ liste blanche et `severity` ∈ liste ; **tronquer** message/stack/component_stack à des tailles maximales ; **épurer** (§2) ; **limiter le débit** par utilisateur (fenêtre glissante) et fusionner par `fingerprint` si une occurrence identique est très récente (compteur plutôt que nouvelle ligne, à arbitrer §11).
- Ne renvoie rien d'exploitable au client (pas d'écho du contenu stocké).

## 7. Accès et écran « État du système »

- **RLS** : `select` sur `client_error_log` réservé à `is_system_admin()` ; aucune autre lecture. Pas d'`update`/`delete` applicatifs (purge par tâche, §9).
- **Lecture** via RPC `list_recent_client_errors(p_limit, p_since, p_context?)`, `SECURITY DEFINER`, réservée `system_admin` (allowlist).
- **Écran admin** (frontend) : liste des dernières erreurs regroupées par `fingerprint` (occurrences, première/dernière vue, `context`, version), détail épuré au clic. Filtres par période/`context`/sévérité. Aucun export.

## 8. Alerting (réutilise B5)

- **Agrégation planifiée** (workflow GitHub, cadence à définir, ex. horaire) : compte les nouvelles erreurs depuis la dernière notification, par `fingerprint`/`context`/sévérité ; marque `notified_at`.
- **Déclenchement** : envoi au `MONITOR_ALERT_WEBHOOK_URL` **expurgé** si un seuil est franchi (nouveau `fingerprint`, ou volume > seuil, ou une `severity=fatal`). Charge utile : environnement, période, **compteurs**, `error_name`, `context`, `fingerprint`, `severity`, identifiant de référence — **jamais** message ni pile.
- Le détail (épuré) se consulte dans l'écran admin (§7), pas dans l'alerte.
- Testable sans panne réelle via un mode analogue à `alert_test=true` ; l'accusé du destinataire est conservé.

## 9. Rétention et conservation

- Purge automatique des enregistrements au-delà d'un délai court (proposition : **30 jours**), par tâche planifiée idempotente. Aligner la durée sur `docs/juridique/tchad/09-conservation.md`.
- La table n'est jamais sauvegardée hors site ni exportée : c'est un journal opérationnel volatil, pas une donnée métier.

## 10. Sécurité et vie privée — menaces

| Menace | Réponse |
|---|---|
| Donnée patient dans un message/pile | Minimisation à la source + épuration + troncature + accès admin strict + rétention courte (§2) |
| `context` détourné pour véhiculer du contenu saisi | Liste blanche contrainte par `check` |
| Flood d'erreurs (boucle) saturant la base ou les alertes | Anti-flood client, plafond de débit serveur, fusion par `fingerprint`, agrégation avant alerte |
| Surface d'écriture non authentifiée | v1 : persistance seulement si `auth.uid()` ; erreurs anonymes restent locales |
| Lecture des erreurs par un rôle non habilité | RLS `system_admin` seul ; lecture via RPC dédiée ; jamais exposée à `authenticated` |
| Fuite via l'alerte externe | L'alerte ne porte que des agrégats/codes bornés, jamais message/pile |
| Nouvelle RPC `SECURITY DEFINER` non maîtrisée | Ajout justifié à l'allowlist B9 ; tests d'ACL et de refus |

## 11. Décisions restant à valider par le demandeur

| Question | Recommandation |
|---|---|
| L'écran d'état est-il réservé à l'admin système, ou aussi ouvert aux médecins ? | **Admin seul** en v1 |
| Persister les erreurs pré-connexion (anonymes) ? | **Non en v1** (surface d'abus) ; réévaluer avec un plafond strict |
| Capturer aussi les erreurs des Edge Functions (`source='edge'`) ? | **Oui, phase 2** : écriture serveur (`service_role`) dans la même table, même épuration |
| Capturer les erreurs profondes PostgreSQL ? | **Plus tard** : coût/complexité supérieurs ; les journaux Supabase couvrent l'intérim |
| Cadence et seuils d'alerte | Horaire + alerte immédiate sur `fatal` ; à ajuster au vécu |
| Délai de rétention | 30 jours, aligné sur la conservation |
| Fusion par `fingerprint` (compteur) vs ligne par occurrence | **Compteur** pour borner le volume, en gardant première/dernière occurrence |

## 12. Découpage en lots

1. **Lot A — capture frontend** : filet global (`main.tsx`), points métier ciblés, anti-flood, branchement best-effort dans `reportError.ts` ; tests web (dont capture des erreurs asynchrones, non-régression de l'`ErrorBoundary`).
2. **Lot B — puits DB** : migration additive (table, RLS, index), RPC `record_client_error` + `list_recent_client_errors`, épuration/troncature/plafond, allowlist B9 ; tests RLS/RPC (admin seul lit, `context` contraint, anti-flood, refus d'accès, aucune donnée patient stockable par construction). Skill `meddata-db-safety` obligatoire.
3. **Lot C — écran admin** : « État du système », i18n, tests web.
4. **Lot D — alerting** : agrégation planifiée + webhook expurgé, mode test, purge de rétention ; mise à jour de `docs/supervision.md`.
5. **Lot E — phase 2** : capture Edge Functions (`source='edge'`).

## 13. Références

- Code : `src/lib/reportError.ts` (point d'entrée unique, `ClientErrorRecord`, tampon borné) ; `src/components/ErrorBoundary.tsx:34` (`reportClientError(..., 'react-render')`) ; `src/main.tsx` (absence de filet global à corriger).
- Monitoring : `.github/workflows/operations-monitor.yml`, `docs/supervision.md` (webhook `MONITOR_ALERT_WEBHOOK_URL`, expurgation, `alert_test`).
- Conventions : `supabase/migrations/20260616097600_strict_inspection_policy.sql` (motif table de config + RLS `app_security_setting`) ; `supabase/migrations/20260616090600_rpc.sql` (grants RPC `to authenticated`) ; `is_system_admin()` dans `20260616090300_functions.sql:10`.
- Contrôle des privilèges : `supabase/security-definer-allowlist.json`, `scripts/verify-function-privileges.mjs`.
- Règles : `CLAUDE.md` (aucune erreur interne brute ni donnée sensible dans le frontend/les logs ; écritures par RPC ; migrations additives).
- Contexte : `docs/readiness-production-2026-07-19.md` (B5 monitoring, §9 réévaluation) ; `docs/juridique/tchad/09-conservation.md` (rétention).
