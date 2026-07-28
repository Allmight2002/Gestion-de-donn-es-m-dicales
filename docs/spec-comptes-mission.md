# Spécification — Comptes de mission (rôle `saisisseur`)

- Statut : **proposition — non implémentée** (aucune migration créée, étude de conception seulement)
- Date : 2026-07-19
- Demandeur : Dr Mbassi (besoin : étudiants en thèse saisissant des données pour un directeur)
- Cadre de calendrier : développement local autorisé par
  `docs/feuille-route-developpement-post-readiness.md`, avec données fictives
  uniquement. B2, B6, B7 et B10 restent ouverts pour le pilote clinique et la
  production. Toute modification crée un nouveau SHA qui devra être revalidé
  avant staging ou promotion.

## 1. Besoin

Un médecin doit pouvoir confier la saisie de données d'une seule base à un étudiant (thésard, assistant de recherche) pour une durée qu'il choisit, puis récupérer un registre propre à l'échéance : l'étudiant saisit sans modifier ce qui est soumis, ne voit pas l'identité nominative, ne peut rien exporter, et son accès s'éteint automatiquement.

Le modèle actuel ne le permet pas :

- tout nouveau compte devient `medecin` (`handle_new_user`, `20260616090500_integrity.sql:13`) et peut créer ses propres bases et gabarits ;
- `base_access` porte `revoked_at` mais **pas d'expiration** (`20260616090200_tables.sql:109`) ;
- `can_edit_structured_data` couvre indistinctement création et modification ;
- l'expiration existante (`base_invitation.expires_at`) ne limite que l'invitation, pas l'accès accepté.

## 2. Décisions de conception

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Nouveau rôle global `saisisseur` | « Compte médecin limité à la création » | Le rôle `medecin` porte des droits hors de toute base — créer des bases (`20260616090400_rls.sql:68`), des gabarits (`rls.sql:27`), accepter des invitations — que `base_access` ne peut pas restreindre. Un étudiant-médecin pourrait créer sa propre base et y recopier des données hors du contrôle du directeur. De plus, toute policy future écrite `is_medecin() and …` exclut le saisisseur automatiquement : le défaut échoue fermé. |
| La « mission » est la ligne `base_access` étendue | Table `data_entry_mission` dédiée | `granted_by` (médecin responsable), `created_at`, `revoked_at` existent déjà ; il ne manque que `expires_at` et la permission de création. Moins de surface, mêmes garanties, audit déjà en place. |
| Nouvelle permission `can_create_structured_data` | Réutiliser `can_edit_structured_data` | Sépare « créer » de « modifier ». Compatibilité : les RPC de création accepteront `can_create` **ou** `can_edit` (aucun backfill, aucun changement pour les éditeurs actuels) ; les RPC de modification resteront sur `can_edit` seul. |
| Création du compte par invitation admin (Edge Function + `inviteUserByEmail`) | Le médecin choisit le mot de passe | Imputabilité : seul l'étudiant détient son secret, sinon toute saisie devient contestable. Le médecin déclenche, l'étudiant active et définit son mot de passe. |
| Rôle transporté par `app_metadata` | `user_metadata` | `user_metadata` est modifiable par l'utilisateur lui-même : y lire un rôle serait une escalade de privilège triviale. `app_metadata` n'est modifiable que côté admin. |
| Brouillon/soumission via `validation_status` existant | Immuabilité dès la première sauvegarde ; ou nouveau statut dédié | Les rencontres portent déjà `'draft'`/`'complete'`/`'curated'` (`20260616090900_encounters.sql`). L'interdiction absolue de corriger rendrait une faute de frappe irréparable par l'étudiant. |
| Expiration et révocation vérifiées par RLS à chaque requête | Révocation de la session Auth seule | Un jeton déjà émis reste valide jusqu'à son expiration ; seule la vérification en base garantit l'effet immédiat. C'est déjà le modèle du produit (base et autorisation serveur = source de vérité). |
| Terminologie : rôle logiciel ≠ titre professionnel | — | Les thésards de médecine sont médecins au sens du titre ; `medecin` dans MedData signifie « peut créer/posséder des bases » (`20260616090300_functions.sql:15`). Un interne peut être `saisisseur` le temps d'une mission puis être promu. |

## 3. Modèle de données (migration additive unique)

Aucune migration existante n'est modifiée. Une nouvelle migration horodatée ajoute :

1. **`profiles.global_role`** : étendre la contrainte `check` à `('system_admin','medecin','curateur','saisisseur')` (drop/add de la contrainte, données existantes inchangées).
2. **`base_access.expires_at timestamptz null`** : `null` = accès permanent (comportement actuel préservé pour toutes les lignes existantes) ; non-null = accès de mission.
3. **`base_access.can_create_structured_data boolean not null default false`** : `false` pour l'existant — sans effet puisque les RPC de création accepteront aussi `can_edit_structured_data`.
4. **Contrainte de cohérence** : pour un profil `saisisseur`, `expires_at` obligatoire, `can_edit_structured_data`, `can_export_data`, `can_manage_access`, `can_view_raw_documents` forcés à `false` (trigger de garde, même approche que `20260616094200`).
5. La contrainte `unique (base_id, user_id)` est conservée : une nouvelle mission du même étudiant sur la même base = mise à jour de la ligne (nouvel `expires_at`, `revoked_at` remis à `null`), tracée dans `audit_log`.

`base_invitation` n'est pas touchée : le flux collaborateur-médecin existant reste inchangé ; le flux mission ne passe pas par elle.

## 4. Droits du rôle `saisisseur`

| Capacité | Autorisé | Mécanisme |
|---|---|---|
| Voir la base attribuée et son dictionnaire/gabarit | Oui | `has_base_access`, `can_read_template` étendues |
| Créer un patient **minimal** (code, sans identité nominative) | Oui (recommandé, à confirmer §13) | RPC de création sous `can_create_structured_data` |
| Créer des rencontres et valeurs, sauvegarder ses brouillons | Oui | `validation_status='draft'`, auteur = lui |
| Corriger **son propre** brouillon | Oui | RLS : `created_by = auth.uid()` et statut `draft` |
| Soumettre (passage `draft` → `complete`) | Oui | Après soumission, immuable pour lui |
| Modifier/supprimer une saisie soumise, la sienne ou celle d'autrui | **Non** | Modification réservée `can_edit_structured_data` (médecin), motivée et journalisée dans `field_change_log` |
| Voir l'identité nominative (`full_name`, téléphone, adresse) | **Non par défaut** | Option `can_view_identity` activable par le médecin, justifiée (§13) |
| Écrire l'identité nominative | **Non** | `can_write_identity` jamais accordée |
| Voir/téléverser des documents bruts | **Non** (v1) | `can_view_raw_documents=false` ; pas d'upload |
| Exporter, curer, gérer les accès, inviter | **Non** | Permissions forcées à `false` (§3.4) |
| Créer une base ou un gabarit | **Non** | Policies inchangées : `is_medecin()` seul |
| Accéder à une autre base | **Non** | Une seule ligne `base_access` |
| Mode hors-ligne | **Non** (v1) | Exclu du rôle même si le mode est réactivé un jour ; si levé plus tard : les replays d'outbox postérieurs à l'expiration doivent être refusés par RLS avec un rejet propre côté UI, sans perte silencieuse |

## 5. Cycle de vie du compte

1. **Création** — le médecin (propriétaire ou `can_manage_access` sur la base) saisit : e-mail, date de fin, option identité. L'Edge Function (§6) crée le compte par invitation et pose l'accès.
2. **Activation** — l'étudiant reçoit l'e-mail Supabase, définit son mot de passe, arrive sur sa seule base.
3. **Mission** — chaque requête est autorisée par RLS : rôle valide **et** accès actif (`revoked_at is null` et (`expires_at is null` ou `now() < expires_at`)).
4. **Prolongation** — le médecin peut repousser `expires_at` (RPC dédiée, auditée) : une thèse déborde souvent.
5. **Échéance** — refus automatique de toute requête, aucune action requise. L'UI du saisisseur affiche l'échéance à l'avance.
6. **Révocation anticipée** — le médecin pose `revoked_at` (mécanisme existant) ; effet immédiat via RLS.
7. **Entretien** — le compte Auth échu reste inerte (aucun accès) ; une opération d'entretien le désactive (ban) puis le purge selon un délai à fixer avec le volet juridique (l'e-mail de l'étudiant est une donnée personnelle). L'auteur des saisies reste conservé dans `audit_log` et les tables métier après purge du compte.

## 6. Edge Function `create-mission-account`

Septième fonction, à côté des six existantes, seule détentrice du droit admin — jamais de `service_role` au navigateur.

Contrôles dans l'ordre :

1. authentifier l'appelant par son JWT ; exiger `is_medecin()` et (propriétaire ou `can_manage_access`) sur la base cible ;
2. valider l'e-mail et la durée (bornes min/max, proposition §13) ;
3. **refuser si l'e-mail correspond à un compte existant** (aucune rétrogradation silencieuse d'un médecin ; message générique côté client, détail côté logs serveur uniquement) ;
4. `auth.admin.inviteUserByEmail(email)` avec `app_metadata = { global_role: 'saisisseur' }` ;
5. insérer la ligne `base_access` (base, utilisateur, `expires_at`, `can_create_structured_data=true`, tout le reste `false`, `granted_by` = appelant) ;
6. journaliser dans `audit_log`.

Exigences transverses :

- **Idempotence/compensation** : Auth et PostgreSQL ne forment pas une transaction. L'opération doit être rejouable : si l'utilisateur Auth existe déjà avec l'`app_metadata` mission attendue mais sans `base_access`, reprendre à l'étape 5 ; tout autre état intermédiaire → erreur explicite sans demi-création. Même philosophie que `finalize-upload`.
- **Renvoi d'invitation** : opération séparée pour e-mail perdu, mêmes contrôles d'appelant.
- **Erreurs** : génériques côté frontend, jamais d'erreur interne brute (règle projet).
- Le trigger `handle_new_user` (étendu, §7) lit `raw_app_meta_data ->> 'global_role'` : `'saisisseur'` → profil saisisseur ; sinon `'medecin'` comme aujourd'hui (l'auto-inscription publique ne change pas).

## 7. Fonctions d'autorisation et gardes à modifier

Toutes `SECURITY DEFINER` : chaque signature nouvelle ou modifiée doit être ajoutée à `supabase/security-definer-allowlist.json` avec justification, sous peine d'échec (voulu) du contrôle `db:function-acl:verify`.

| Objet | Modification |
|---|---|
| `is_saisisseur()` | Nouvelle, miroir de `is_medecin()` |
| `handle_new_user()` | Lit le rôle depuis `raw_app_meta_data` uniquement (jamais `raw_user_meta_data`) |
| `has_base_access(p_base)` | `(is_medecin() or is_saisisseur())` + condition d'accès actif incluant `expires_at` |
| `can_read_template(p_template)` | Étendue au saisisseur pour la base attribuée |
| `can_create_structured_data(p_base)` | Nouvelle : `(is_medecin() or is_saisisseur())` et (propriétaire ou accès actif avec `can_create_structured_data` **ou** `can_edit_structured_data`) |
| `can_view_identity(p_base)` | `(is_medecin() or is_saisisseur())` + flag — le flag reste `false` par défaut pour les missions |
| `can_edit_structured_data`, `can_export_data`, `can_manage_access`, `can_view_raw_documents`, `can_write_identity`, `can_curate` | **Inchangées côté rôle** (`is_medecin()` seul) — l'exclusion du saisisseur est structurelle ; seule la condition `expires_at` s'y ajoute |
| Garde `20260616094200` (bénéficiaire d'un `base_access` = médecin) | Accepter aussi `saisisseur` |
| Garde `20260616095000` (déclassement de rôle → révocation des accès) | Étendre : perte du rôle `saisisseur` révoque aussi |
| `guard_profile_role` (anti-auto-escalade) | Inchangée ; promotion `saisisseur` → `medecin` réservée à l'admin système |
| RPC de création (patient minimal, rencontre, valeurs) | Autorisation élargie à `can_create_structured_data` ; RPC de modification/suppression inchangées |

Point à vérifier à l'implémentation : la RPC de création de patient minimal écrit `patient_code` dans `patient_identity` (« patient minimal §7.1 », `20260616090200_tables.sql:125`) — confirmer qu'elle peut le faire sous `can_create_structured_data` sans exiger `can_write_identity`, et que les champs nominatifs restent hors de sa portée.

## 8. Interface utilisateur

- **Côté médecin** : écran « Comptes de mission » par base — liste (étudiant, échéance, statut actif/expiré/révoqué), création, prolongation, révocation, renvoi d'invitation. Les corrections post-soumission passent par le flux de correction existant (motif + `field_change_log`).
- **Côté saisisseur** : parcours réduit à sa base — saisie, ses brouillons, soumission ; bandeau permanent « mission jusqu'au JJ/MM/AAAA » ; à l'échéance ou révocation, écran explicite « mission terminée » (pas d'erreur brute).
- i18n : libellés français d'abord, clés dans `src/i18n/messages.ts`.

## 9. Sécurité — menaces couvertes

| Menace | Réponse |
|---|---|
| L'étudiant crée sa propre base/gabarit et y recopie des données | Impossible : policies de création inchangées, `is_medecin()` seul |
| Export via appel API direct (hors UI) | Refus RLS/RPC : `can_export_data` jamais accordée au rôle |
| Requêtes après révocation avec un jeton encore valide | Refus RLS à chaque requête (`revoked_at`/`expires_at` en base) |
| Auto-promotion via métadonnées utilisateur | Rôle lu uniquement dans `app_metadata` ; `guard_profile_role` en défense en profondeur |
| Le médecin connaît le secret de l'étudiant | Impossible par conception (invitation, mot de passe défini par l'étudiant) |
| Compte existant réutilisé/rétrogradé silencieusement | Refus explicite à la création (§6.3) |
| Accès à une autre base, à l'identité, aux documents bruts | Une seule ligne d'accès ; flags à `false` ; zones cloisonnées |
| Demi-création (Auth sans accès, ou l'inverse) | Idempotence/compensation de l'Edge Function (§6) |

Conformité : l'e-mail de l'étudiant entre au registre des traitements (volet juridique Tchad, `docs/juridique/`) ; politique de purge des comptes échus à y adosser.

## 10. Tests exigés

- **DB/RLS** (infra PostgreSQL embarquée) : expiration effective en cours de session ; révocation immédiate ; refus de modification/suppression après soumission (siennes et celles d'autrui) ; modification de son propre brouillon acceptée ; refus export/curation/gestion d'accès/création de base/gabarit/écriture identité ; accès croisé entre bases refusé ; création patient minimal sans identité nominative ; prolongation ; réactivation sur la même base (contrainte unique) ; trigger de rôle (`app_metadata` saisisseur vs auto-inscription médecin) ; révocation sur déclassement ; **compatibilité : un éditeur existant (`can_edit`) crée toujours sans `can_create`** ; allowlist `SECURITY DEFINER` à jour (le test `test/security-definer-acl.test.ts` échouera sinon).
- **Edge** (handlers testables + injection, pattern lot 9) : appelant non autorisé, e-mail existant, durée hors bornes, idempotence des rejeux, compensation après échec partiel.
- **Web** : parcours saisisseur (saisie → brouillon → soumission → immuabilité), bandeau d'échéance, écran de fin de mission, écran médecin (création/prolongation/révocation).

## 11. Découpage en lots d'implémentation

1. **Lot A — base** : migration additive, fonctions d'autorisation, gardes, RPC, tests DB/RLS, allowlist. (Skill `meddata-db-safety` obligatoire.)
2. **Lot B — Edge** : `create-mission-account` + renvoi d'invitation, tests Deno.
3. **Lot C — UI** : écrans médecin et saisisseur, i18n, tests web.
4. **Lot D — validation** : E2E staging (création → saisie → expiration → révocation), revue `validate-audit-lots`, mise à jour de `docs/architecture.md` et du cahier technique.

## 12. Décisions restant à valider par le demandeur

| Question | Recommandation |
|---|---|
| ~~L'étudiant peut-il créer des patients minimaux, ou seulement remplir des rencontres de patients créés par le médecin ?~~ | **Tranché le 2026-07-28 : l'étudiant crée des patients.** La recommandation est retenue — création minimale, **identité nominative exclue**. Le compte de mission écrit donc dans `patient` et `encounter`, mais jamais dans `patient_identity` : c'est cette exclusion qui rend la permission acceptable, puisque le saisisseur alimente le registre sans jamais accéder à l'identité des personnes. |
| Durée maximale d'une mission | **24 mois**, prolongeable |
| Lecture de l'identité sur option | Maintenir l'option, **désactivée par défaut**, avec justification consignée à l'activation |
| Upload de documents par le saisisseur | **Non en v1** ; réévaluer avec le scanner pérenne |
| Délai de purge des comptes échus | À fixer avec le volet juridique (proposition : 12 mois après échéance) |
| Nom du rôle | `saisisseur` (slug technique) ; libellé UI « compte de mission » |

## 13. Références

- Schéma : `supabase/migrations/20260616090200_tables.sql` (`base_access:109`, `patient_identity:126`, `field_change_log:188`, `audit_log:275`) ; `20260616090300_functions.sql:15` (`is_medecin`) ; `20260616090400_rls.sql:27,68` (gabarits, bases) ; `20260616090500_integrity.sql:8` (`handle_new_user`, `guard_profile_role`) ; `20260616090900_encounters.sql` (`validation_status` `'draft'`) ; `20260616094200` et `20260616095000` (gardes d'accès).
- Contrôle des privilèges : `supabase/security-definer-allowlist.json`, `scripts/verify-function-privileges.mjs`, `docs/security-definer.md`.
- Contexte readiness : `docs/readiness-production-2026-07-19.md` (§9 : toute modification déclenche une réévaluation).
- Supabase : invitations administratives (`inviteUserByEmail`, opération serveur avec clé secrète), jetons et déconnexion — https://supabase.com/docs/guides/auth/users, https://supabase.com/docs/guides/auth/signout.
