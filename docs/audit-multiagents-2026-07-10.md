# Audit approfondi MedData — Rapport consolidé (multi-agents)

**Date :** 10 juillet 2026
**Branche demandée :** `develop` (d5f8813) — auditée relativement à `main` (29030bc)
**Méthode :** 7 sous-agents indépendants en lecture seule (sécurité, architecture/qualité, fonctionnel, base de données, tests, performance, production), puis consolidation.
**Décision finale :** non prêt pour la production avec de vraies données patients ; fusionnable avec réserves en pilote à données fictives ; une fusion `develop → main` serait inutile et régressive (voir §0).

> Note : un autre rapport d'audit du même jour existe dans le dépôt (`docs/audit-complet-2026-07-10.md`, non suivi, référence `main`). Le présent document est le rapport consolidé issu des 7 sous-agents et ne le remplace pas.

---

## 0. Cadrage de branche (préalable déterminant)

Le mandat demandait d'auditer « la branche actuelle » (`develop`) par rapport à `main`. Fait vérifié, contre-intuitif, qui conditionne toute la lecture des « régressions » :

- `develop` (d5f8813) est **0 commit en avance / 2 commits en retard** sur `main` (29030bc).
- Les 2 commits que `main` a en plus : `b98a0e8` (correctif de bundling Edge `generate-export`, import `npm:xlsx@0.18.5` au lieu du CDN SheetJS) + `29030bc` (documentation seule).
- L'arbre de travail réel était sur `main` — les exécutions de tests portent donc sur `main`, transposables à `develop` à une ligne près.

**Conséquence :** `develop` n'introduit **aucune modification** par rapport à `main` ; il est strictement **en retard**. Presque tous les constats ci-dessous sont des **défauts préexistants, présents dans les deux branches** (dette historique), et non des régressions introduites par `develop`. La seule chose que `develop` fait « en moins bien » que `main` est l'import CDN dans `generate-export` (voir Moyens). Il n'y a **aucune régression introduite par `develop` vis-à-vis de `main`** — l'inverse est vrai : `develop` ne contient pas le correctif de `main`.

La question utile n'est donc pas « fusionner `develop → main` » (ce serait une régression), mais **la préparation de l'état `main` à un usage clinique réel**. C'est sous cet angle que conclut ce rapport.

**Tests exécutés (sur `main`, arbre propre) :** `typecheck` OK, `lint --max-warnings 0` OK, `test:web` 110/110, `test:rls` 319/319 (PostgreSQL 18 embarqué, 5 min 43 s), `build` OK (avec `VITE_USE_SIGNED_READ=true`). **Total : 429 tests, 0 échec.** `git status` final propre.

---

## 1. Synthèse par criticité (constats consolidés et dédupliqués)

### Critique — bloquant avant toute donnée patient réelle

| # | Constat | Preuve | Statut |
|---|---------|--------|--------|
| **C-1** | **Inspection antivirus non forcée en production** + scanner ClamAV exposé par un tunnel éphémère depuis un poste local. Par défaut, un fichier passe la seule validation *client* (magic bytes), est marqué `accepted_client`, et `signed-read` le sert sans scan serveur. | `signed-read/index.ts:60`, `src/data/attachments.ts:145`, `20260616097600_strict_inspection_policy.sql:24-26`, `.env.production.example:17,33,36` | Préalable d'exploitation connu et assumé (données actuellement fictives). Signalé une seule fois. |

### Élevé

| # | Constat | Preuve | Origine |
|---|---------|--------|---------|
| **É-1** | **Export serveur : valeurs manquantes codifiées écrites `[object Object]`** dans les CSV/XLSX. Confirmé : la forme persistée est `{"__missing__":"non_fait"}`, mais l'Edge teste `'missing' in v` (mauvaise clé) et lit `v.code` (propriété inexistante) → chute sur `String(v)`. Le générateur *client* est correct mais n'est plus appelé en prod. | `generate-export/index.ts:33` vs `src/domain/validation.ts:12-16`, `src/domain/export.ts:50-51` | Régression du lot « export serveur » (d5f8813) |
| **É-2** | **Fuite inter-bases possible via cohortes.** Confirmé : `cm_insert`/`cem_insert` ne vérifient que `can_curate(base_of_cohort)`, jamais que le patient appartient à la base de la cohorte ; aucun `guard_xbase` pour les cohortes ; l'export lit `patient … in (patientIds)` **sans filtre `base_id`** sous service_role. Un curateur de la base A connaissant l'UUID d'un patient de B peut l'insérer dans une cohorte A puis l'exporter. | `20260616090400_rls.sql:123,128`, `generate-export/index.ts:156-161` | Préexistant (durcissement « même base » a oublié les cohortes) |
| **É-3** | **Export tronqué silencieusement** au-delà du plafond PostgREST (~1000 lignes par défaut) : `.select()` sans pagination + `.in()` sur listes non bornées → export incomplet **avec code 200**, sans erreur. | `generate-export/index.ts:156-199`, `src/data/exports.ts:59-101` | Régression du lot « export serveur » |
| **É-4** | **Écritures hors-ligne en échec permanent** (rencontre supprimée / règle ajoutée / accès révoqué entre-temps) : entrée bloquée `pending` à vie, motif jamais affiché (`report.errors` non rendu), aucune action « abandonner ». | `src/data/offline.ts:334-356`, `SyncCenter.tsx:130-134`, `AppShell.tsx:47-55` | Préexistant (hors-ligne Phase 2/3) |
| **É-5** | **Reprise d'un import interrompu (>300 lignes) rend le lot inclôturable** : les lignes déjà traitées sont recomptées en erreurs, `row_count` gonfle, `complete_import_batch` refuse pour toujours ; rapport perdu alors que des données sont écrites. Aggravé par **`cancel_import_batch` non câblé dans l'UI** → impasse sans accès SQL. | `ImportData.tsx:167-183`, `20260616098600_...:111-135`, `20260616093900_...:26-30`, `patients.ts:446-449` (repo non appelé) | Préexistant (import par lots) |
| **É-6** | **Échecs de suppression (patient/rencontre/pièce jointe) totalement silencieux** : `DeleteWithReason` ferme le panneau immédiatement, la promesse rejette dans le vide → l'utilisateur croit avoir supprimé un dossier qui reste en base. | `DeleteWithReason.tsx:38-42`, `PatientDetail.tsx:183-189,279,333` | Préexistant |
| **É-7** | **Impossible d'enregistrer une rencontre incomplète en brouillon** : le client exige la complétude quel que soit le statut, alors que le serveur, l'édition patient et la file de complétion ne l'exigent qu'en `curated`. Bloque la saisie clinique partielle quotidienne. | `EncounterForm.tsx:134`, `EditEncounter.tsx:120` vs `EditPatient.tsx:71`, `20260616093800_...:19-27` | Préexistant (incohérence) |
| **É-8** | **Edge Functions (1 163 l.) hors de tout filet** : `@ts-nocheck` + exclues d'ESLint (`eslint.config.js:19`) **et** aucun test d'exécution (seule couverture : ~117 assertions textuelles). C'est ce qui a laissé passer É-1 et le bug de bundling déjà corrigé. | 5× `supabase/functions/*/index.ts:1`, `test/deployment.test.ts` | Préexistant (systémique) |
| **É-9** | **Écritures « 0 ligne » silencieuses** (brouillon de curation, objectif d'inclusion) : `update … eq('id',…)` sans contrôle des lignes affectées → toast « enregistré » alors que la RLS a bloqué (tâche libérée/réattribuée). Perte silencieuse de travail de curation. | `src/data/curation.ts:377-383`, `bases.ts:231-237`, `CurationTask.tsx:399-403` | Préexistant |

### Moyen (regroupés par thème, dédupliqués)

- **Sécurité/durcissement** : régression `search_path` absent sur le trigger de sécurité `guard_inspection_status` (`20260616098100_physical_quarantine.sql:28-29`, présent dans les 2 versions antérieures) ; version `xlsx@0.18.5` (CVE connues, exploitabilité faible car l'Edge n'analyse pas de fichier hostile — `generate-export/index.ts:5`) ; **secrets staging en clair** sur le poste (`.env.staging`, bien gitignorés) ; **injection de formules** non neutralisée dans les CSV/XLSX (`generate-export/index.ts:20-23`, `export.ts:129-131`).
- **Intégrité données** : **valeurs des versions de gabarit historiques invisibles** en ligne et à l'export (seule la version courante sert de dictionnaire, alors que le hors-ligne fait l'union) — `PatientDetail.tsx:133-139`, `generate-export/index.ts:140-154` ; **aperçu d'import trompeur >300 lignes** (dry-run par chunks indépendants, doublons inter-chunks non vus) — `ImportData.tsx:162-183`.
- **Hors-ligne/concurrence** : rejeu d'outbox après réponse perdue → **faux conflit** contre sa propre écriture ; **flush concurrent** (auto-sync vs manuel) sans mutex global → conflit fantôme ré-inséré ; résolution `keepServer` laisse un `updatedAt` périmé → conflit fantôme suivant — `offline.ts:334-375`, `AppShell.tsx:47-55`, `SyncCenter.tsx:38-49`.
- **Robustesse client** : **aucun timeout/AbortController** sur les appels réseau (produit visant les réseaux instables) — `src/lib/supabase.ts:7-9` ; upload de pièce jointe dont l'échec d'inspection produit une **erreur trompeuse + doublons** au retry — `attachments.ts:126-160` ; erreurs `signed-read` **aplaties** (`null` → « — »), export non téléchargé silencieux — `signedRead.ts:21-24`, `ExportPanel.tsx:71-74`.
- **Performance/scalabilité** (sans impact aux volumes actuels, convergent vers le timeout à 5–10 k patients) : RLS par ligne via fonctions `SECURITY DEFINER` non inlinables ; snapshot hors-ligne non borné côté serveur ; `base_completeness_stats` et la file de complétion recalculés O(N) à chaque visite ; **index manquants** sur `field_change_log(entity,entity_id)`, `export_log(cohort_id)`, `clinical_attachment(encounter_id)`.
- **Base de données** : non-atomicité de l'import inter-chunks ; `curation_draft` sans `unique(task_id)` ; **migrations éditées après coup** dans l'historique (dérive cloud possible, non vérifiable ici) ; `storage.sql` + politique de sécurité appliqués hors `db push` (dérive possible).
- **Architecture/dette** : moteur d'export **dupliqué** client/serveur, la version client (testée) étant devenue **du code mort** ; enums SQL redéclarés en littéraux TS dispersés + statuts typés `string` ; **122 casts `as`** faute de types DB générés ; moteur de règles TS/SQL **sans test de parité** ; `inspect-upload` monolithique (~370 l., 6 closures) non testable ; gestion d'erreurs « best-effort » incohérente (des échecs réels avalés) ; boilerplate `load/busy` + **25 `eslint-disable exhaustive-deps`** sur la règle que le projet qualifie lui-même de plus importante.
- **Production** : **aucun monitoring/alerting** (ring buffer de 20 entrées en mémoire) ; **rollback non coordonné** front/DB/Edge (migrations forward-only, pas de procédure) ; **PWA `autoUpdate`** sans gestion applicative (fenêtre de désync jusqu'à ~24 h après un rollback Vercel) ; dépendance `xlsx` depuis un tarball CDN dans `package.json` (build indisponible si le CDN tombe ; intégrité couverte par le lockfile).

### Faible (échantillon représentatif)

CORS `*` sur les Edge (compensé par JWT) ; `verify_jwt=false` (compensé, dépend de la discipline) ; IndexedDB non chiffré (mais aucune identité/image persistée) ; sous-type OLE `.doc/.xls` non vérifié ; politique de mot de passe du script (≥8) ; `compute_age` `IMMUTABLE` au lieu de `STABLE` ; course sur `version_number` (rattrapée par la contrainte unique) ; membres de cohorte non purgés au soft-delete (aucune fuite, tout est filtré `deleted_at`) ; orphelins Storage possibles (mitigés par tickets) ; suggestion de code patient `P-{count+1}` en collision ; lien d'invitation déjà accepté → erreur technique ; i18n sans interpolation + messages FR en dur ; `listPool` avec sentinelles `''` ; pas de mesure de couverture ; couche adaptateurs Supabase et policies Storage non exécutées en test ; RLS testée par échantillon (pas de matrice table×rôle) ; `answer` partagé entre clarifications de curation ; profil de rôle mis en cache pour la session (sécurité portée par RLS, seul l'habillage UI est périmé).

---

## 2. Contradictions et doublons résolus

- **Le même « faux conflit hors-ligne »** a été remonté par 3 agents (Performance, Fonctionnel, Tests) sous des angles complémentaires (réponse perdue / flush concurrent / absence de test) — fusionné en un seul constat Moyen.
- **L'index manquant `field_change_log`** apparaît en Performance et en Base de données — fusionné.
- **L'inspection non forcée** apparaît en Sécurité (Élevé), Production (Critique pour données réelles) et Fonctionnel (ergonomie) — fusionnée en C-1 (Critique conditionnel), l'ergonomie du flux d'upload restant un Moyen distinct.
- **Aucune contradiction de fond** entre les rapports. Seule nuance de sévérité sur l'inspection ; tranchée en **Critique conditionnel** (bloquant avant vraies données, acceptable en pilote fictif).

---

## 3. Régressions

Aucune régression **de `develop` vis-à-vis de `main`**. En revanche, le **lot de travail récent « audit v20 »** (qui constitue l'essentiel de l'état actuel) a introduit trois régressions par rapport à l'état antérieur, présentes dans `main` **et** `develop` :

1. **É-1** (`[object Object]` à l'export) — nouveau moteur d'export serveur mal recopié.
2. **É-3** (troncature d'export) — même origine.
3. **`search_path` perdu** sur `guard_inspection_status` (migration 098100).

Et une régression propre à `develop` seul : **import CDN SheetJS** dans `generate-export` (corrigé sur `main`).

---

## 4. Points forts (vérifiés)

- **Modèle « écritures cliniques par RPC uniquement » réellement complet** ; défense en profondeur RLS + RPC `SECURITY DEFINER` + triggers de table. Le point ouvert sur `assert_no_unknown_fields` se **résout favorablement** : la garde est portée au niveau trigger (`assert_curated_complete`, tous statuts), aucune régression.
- **Séparation identité/analytique auditée** (révélation via RPC qui journalisent *avant*), **anti-escalade à double couche**, journaux infalsifiables, `search_path` verrouillé quasi partout (une exception), **aucune SQL dynamique** dans 86 migrations.
- **Front sans secret** (aucun `service_role`, rien dans `dist/`), **CSP stricte + HSTS + XFO DENY**, **build de prod qui refuse une config dangereuse**.
- **Idempotence d'import de niveau professionnel** (triple empreinte, statuts honnêtes, reprise de lot), **verrou optimiste** de bout en bout, **quarantaine physique réconciliable**, **parsing XLSX dans un Web Worker** borné.
- **Infra de test remarquable sans Docker** : 429 tests verts, 86 migrations rejouées ~23×/run sur PostgreSQL embarqué, RLS testée avec contrôles positifs. **CI sérieuse** (lint 0 warning, grep anti-`service_role` dans le bundle, smoke-test de l'image scanner).
- **Préflights de release** complets (`verify-migrations`, `check-inspection-env --cloud`, `deploy-manifest`, `e2e-staging` 13/13).

---

## 5. Zones non vérifiées

- **État réel du schéma cloud** vs migrations (accès Supabase interdit) — la dérive « migrations éditées » reste une hypothèse opérationnelle.
- **Configuration Vercel/Supabase effective** : variables d'env de prod, secrets Edge posés, `storage.sql` rejoué, valeur réelle de `require_server_inspection()`, politique Auth.
- **Exécution runtime des 5 Edge Functions** (pas de runtime Deno) — É-1 établi par lecture croisée + vérification manuelle du code.
- **Plans d'exécution et latences réels** (aucun `EXPLAIN` en prod) — constats de performance = ordres de grandeur.
- **Comportement navigateur réel** (timings, IndexedDB, service worker) — analyse statique uniquement.
- **Stabilité/flakiness** des suites (un seul run) ; **aucune mesure de couverture**.

---

## 6. Ordre de correction recommandé

1. **É-1** (`[object Object]` à l'export) — correctif d'une ligne (`formatValue` aligné sur `isMissing`/`missingCodeOf`). Avant tout export exploité.
2. **É-3** (troncature d'export) — pagination en boucle ou agrégation SQL + assertion `rows.length === count`.
3. **É-2** (fuite inter-bases cohortes) — trigger `guard_xbase_cohort_member` + filtre `base_id` dans l'export. Avant toute exposition multi-bases réelle.
4. **C-1** (inspection antivirus) — héberger ClamAV en service permanent supervisé, dérouler l'ordre d'activation documenté, exiger `env:check:cloud` + `e2e:staging` verts. Bloquant vraies données.
5. **É-5 + É-4 + É-6 + É-9** (impasses/pertes silencieuses) — remonter/afficher les erreurs, câbler l'annulation, contrôler les lignes affectées.
6. **É-7** (brouillon de rencontre incomplet) — passer `status !== 'draft'` à `validateValues` (2 fichiers).
7. **É-8** (filet Edge) — job CI `deno check`/`deno lint` + extraction des helpers purs testables.
8. Puis les Moyens (search_path, xlsx→0.20.3, timeouts client, index manquants, monitoring, rollback documenté).

---

## 7. Notes par domaine (/10)

| Domaine | Note | Justification des points retirés (sans double compte) |
|---|---|---|
| **Sécurité** | **8,0** | −1 inspection non forcée (C-1) ; −0,7 cumulés (search_path perdu, xlsx CVE, secrets en clair, injection de formules) ; −0,3 faibles. Socle très au-dessus de la moyenne. |
| **Architecture** | **8,0** | Séparation en couches réellement tenue, domaine pur, injection mockable. −2 : export dupliqué ayant divergé (É-1), Edge hors filet (É-8), absence de source unique des contrats DB. |
| **Qualité du code** | **7,5** | 0 `any`, lint/typecheck stricts verts. −2,5 : 122 casts non vérifiés, 25 désactivations de la règle hooks clé, gestion d'erreurs best-effort incohérente, bug concret É-1. |
| **Fonctionnalité** | **6,5** | Cœur nominal solide, mais parcours hors-nominal réalistes dégradés : É-4, É-5, É-6, É-7, É-9. |
| **Base de données** | **8,0** | Défense en profondeur exemplaire, concurrence maîtrisée, idempotence aboutie, migrations additives. −2 : trou inter-bases cohortes (É-2), index FK manquants, `curation_draft` sans unicité, incertitude schéma cloud. |
| **Tests** | **7,5** | 429 verts sans Docker, RLS testée comme une fonctionnalité. −2,5 : Edge sans test d'exécution, couche adaptateurs non testée, policies Storage non exécutées, pas de couverture. |
| **Performance** | **7,0** | Bien discipliné aux volumes cibles. −3 : troncature d'export silencieuse (É-3), absence de timeouts client, dette de scalabilité convergente. |
| **Maintenabilité** | **7,0** | Testabilité et documentation d'intention au-dessus de la moyenne. −3 : trois duplications structurelles dont une déjà cassée, code mort entretenu par les tests, 1 163 lignes Deno non refactorables en confiance. |
| **Préparation production** | **6,5** | Outillage de release remarquable, récupération bien pensée. −3,5 : ni inspection stricte active, ni scanner pérenne, ni monitoring, ni rollback écrit ; écart `develop`/`main` sur le bundling Edge ; mise à jour PWA non maîtrisée. |

**Moyenne indicative : ~7,3/10.**

---

## 8. Conclusion

### Les 5 corrections prioritaires
1. **É-1** — aligner `formatValue` de l'Edge sur `isMissing`/`missingCodeOf` (corruption d'export).
2. **É-3** — paginer les lectures d'export + assertion `rows.length === count`.
3. **É-2** — trigger inter-bases sur `cohort_member`/`cohort_encounter_member` + filtre `base_id` à l'export.
4. **É-5/É-4/É-6/É-9** — supprimer les impasses et pertes silencieuses.
5. **É-8** — mettre les Edge Functions sous `deno check`/`deno lint` en CI + extraire des helpers purs testés.

### Risques bloquants (avant vraies données patients)
- C-1 : héberger ClamAV durablement puis armer l'inspection stricte (ordre documenté, `env:check:cloud` + `e2e:staging` verts).
- É-2 : refermer le trou inter-bases avant toute exposition multi-bases.
- É-1/É-3 : garantir l'intégrité des exports scientifiques.
- Ops : monitoring/alerting minimal + sauvegarde restaurée au moins une fois + procédure de rollback écrite ; cadre juridique/DPA/MFA (hors périmètre technique mais bloquant).

### Améliorations non bloquantes
`search_path` sur `guard_inspection_status`, `xlsx`→0.20.3 côté Edge, timeouts/AbortController client, index FK manquants, neutralisation d'injection de formules, gestion applicative de la mise à jour PWA, resserrement CORS/CSP, déduplication du moteur d'export, types DB générés, hook de chargement partagé.

### Tests indispensables avant fusion vers la production
- Export d'une valeur `{"__missing__":"non_fait"}` → cellule = `non_fait` (non-régression É-1) ; parité client/serveur.
- Export d'une cohorte >1 000 membres → complet ou échec explicite (É-3).
- Insert direct d'un patient étranger dans une cohorte → exception ; export → 0 ligne étrangère (É-2).
- `begin → chunks 1-2 → re-begin → tous les chunks → complete` se clôture proprement (É-5).
- `flushOutbox` avec erreur non-conflit → motif exposé + entrée abandonnable (É-4) ; double flush concurrent → une seule application.
- Suppression dont la RPC rejette → erreur visible, panneau conservé (É-6).
- Rencontre `draft` avec requis manquant → enregistrée ; `curated` → bloquée (É-7).
- Au moins un test d'exécution par Edge Function (signed-read par statut/entité ; generate-export sans `can_export_data`) (É-8).

### Décision finale
- **Fusion `develop → main`** : non — inutile et régressive (`develop` est en retard ; la fusionner réintroduirait l'import CDN). Le bon geste est l'inverse : aligner `develop` sur `main`, ou déployer exclusivement depuis `main`.
- **Passage de l'état `main` à la production avec de vraies données patients** : non prêt à fusionner, en raison de C-1, É-1/É-2/É-3 et des impasses fonctionnelles É-4→É-9.
- **Poursuite en pilote à données fictives** : fusionnable avec réserves — le socle de sécurité et de tests est sain ; É-1 (une ligne) et É-7 (deux lignes) à corriger sans délai.
