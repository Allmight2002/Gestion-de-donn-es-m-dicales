# Chantiers ouverts — interactions entre comptes

> **Objet** : rassembler, pour qu'une instance qui n'a assisté à aucune des séances puisse
> reprendre le travail, **les problèmes découverts, les options envisagées, les options écartées
> et les décisions prises** lors de la campagne de vérification manuelle des flux multi-comptes.
> **Origine** : quatre séances de travail des **2026-08-09** et **2026-08-10** — « test des
> interactions entre comptes », « données en lecture seule », « fixer la redirection du mot de
> passe des comptes de mission », « corriger les écarts d'interface du compte de mission ».
> **Rédigé le** : 2026-08-10.
> **Portée** : ce document est un *registre de chantiers*. Il ne remplace pas
> [tests-multicomptes.md](tests-multicomptes.md) (le *comment tester* et les pièges de poste),
> ni [spec-comptes-mission.md](spec-comptes-mission.md) (la spécification du rôle), ni
> [idees-post-readiness.md](idees-post-readiness.md) (la file d'attente produit).

---

## 0. Tableau de bord

| # | Chantier | Nature | Décision | État | Où vit le travail |
|---|---|---|---|---|---|
| **A** | Justificatifs gérés par le propriétaire | Auth + base + Edge Function + interface | **Tranchée : identifiant choisi, mot de passe généré et chiffré, sans e-mail** (§2.2) | **Clos le 2026-08-11 : local, staging et production technique validés** | SHA `bb99ac72ba46541904d255f7bf129ecd2ad3ca4e` |
| **B** | Écarts d'interface du rôle `saisisseur` (6 points) | Frontend | Tranchée point par point (§3) | **Clos le 2026-08-11** — les six points sont livrés avec le lot L16 (§3.7, journal d'exécution) | L16 (`dc90392` ; SHA promu `fae091a3`) |
| **C** | Écriture de l'identité par le compte de mission | **Base + spec + UI** | **Tranchée : option A** (§4.4) | **Clos le 2026-08-11** — option A livrée : migration `20260811130000_mission_identity_write_correction.sql`, RPC `update_patient_identity`, interface | L16 (`dc90392` ; SHA promu `fae091a3`) |
| **D** | Messages d'erreur des Edge Functions inexploitables | Frontend transverse | **Tranchée : utilitaire partagé, phrase du serveur + code** (§5.4) | **Implémenté et vérifié localement le 2026-08-11** (§5.5) | branche `codex/edge-error-messages` |
| **E** | Cohortes : suppression, carte dynamique, figeage inexportable | Base + frontend | Recommandation posée, non tranchée | Documenté dans la file d'attente | [idees-post-readiness.md](idees-post-readiness.md) |

**Ordre conseillé.** C avant B, parce que la migration de C débloque la RPC que l'écran de B
propose ; sinon l'interface offrirait une saisie que la base refuse encore. A a été traité seul,
conformément au périmètre du lot. D est transverse et gagnerait à passer avant toute nouvelle séance de
test manuel, puisque c'est lui qui a coûté le plus de temps de diagnostic. E n'est pas urgent.

**Règle de conduite héritée des séances** : la base est la source de vérité. Aucun de ces chantiers
ne doit déplacer une garantie de sécurité vers l'interface. Les chantiers C et E exigent le skill
`meddata-db-safety`.

---

## 1. Ce qui a été vérifié et fonctionne — à ne pas re-tester

Le parcours bout-en-bout du compte de mission a été **réellement exécuté** le 2026-08-09 sur la
pile Supabase locale (base neuve `QA-base-mission`, compte `thesard.qa@example.test`) : création du
compte par le médecin, courriel reçu, activation, session ouverte sur une seule base, saisie d'un
patient en brouillon, cloisonnement de l'identité vérifié **en base**. Le détail est en
[tests-multicomptes.md §6](tests-multicomptes.md).

**Conclusion à retenir : la chaîne fonctionne et le cloisonnement tient en conditions réelles.**
Tous les chantiers ci-dessous sont des défauts d'interface, de configuration ou de modèle
fonctionnel — **aucun n'est une faille de sécurité**. Dans chaque cas la base refuse correctement ;
ce qui est en cause, c'est ce que l'interface propose, ce qu'elle explique, ou ce que le modèle
autorise trop peu.

Les cinq obstacles d'environnement rencontrés avant de pouvoir tester (`.env.local` qui pointe sur
la production, volume PostgreSQL 15 contre serveur 17, Vite en IPv6 seul, carte d'imports des Edge
Functions locales, UUID du seed non conformes) sont documentés en
[tests-multicomptes.md §5](tests-multicomptes.md) et **ne sont pas repris ici**. Les lire avant
toute reprise de test manuel : ils se represénteront à l'identique.

---

## 2. Chantier A — justificatifs gérés par le propriétaire, sans e-mail

### 2.1 Constat historique

Le lien reçu par courriel ouvre **une session valide directement sur le tableau de bord**. L'écran
de définition du mot de passe (`/reset-password`, `src/screens/ResetPassword.tsx`) n'est jamais
atteint. L'étudiant travaille pendant la durée de vie de cette session, puis **se retrouve bloqué
sans mot de passe**, avec pour seul recours « Mot de passe oublié ». Ce constat explique l'écart
observé le 2026-08-09, mais **n'est plus le correctif recherché**.

### 2.2 Décision produit — 2026-08-11

Un **mode unique** s'applique à tous les comptes de mission : le propriétaire de la base choisit un
**identifiant de connexion unique** et le serveur génère un **mot de passe robuste**. Le compte
reste sous la responsabilité du propriétaire, qui remet ces justificatifs à l'étudiant. L'étudiant
ne choisit pas son mot de passe initial et l'e-mail n'est ni une condition de création, ni un canal
d'activation ou de récupération.

Seul le propriétaire peut consulter le mot de passe, masqué par défaut, depuis la liste globale des
comptes de mission ou depuis la base concernée. Le secret reste disponible parce qu'il est chiffré
côté serveur avec une clé dédiée ; il n'est jamais conservé en clair. Le propriétaire peut
explicitement régénérer le mot de passe. Cette action conserve l'identifiant, invalide l'ancien mot
de passe et les sessions antérieures, et laisse une trace d'audit sans jamais contenir le secret.
L'ancien mécanisme d'invitation et de renvoi de courriel est donc remplacé, pas réparé.

### 2.3 Invariants de sécurité et de fiabilité

- L'identifiant est choisi par le propriétaire, validé et réservé côté serveur sans distinction de
  casse. Le mot de passe est produit côté serveur avec une source aléatoire sûre.
- Le mot de passe n'est stocké qu'en enveloppe AES-256-GCM ; la clé dédiée reste dans le secret Edge
  `MISSION_CREDENTIALS_ENCRYPTION_KEY`. Le clair n'apparaît ni en base, ni dans l'audit, ni dans les
  journaux, notifications ou erreurs.
- Seul le propriétaire de la base peut demander le déchiffrement. L'interface le masque par défaut
  et ne le persiste pas dans le navigateur ; chaque révélation est auditée sans le secret.
- L'identifiant visible peut être différent de l'identité technique d'Auth ; ce mappage reste côté
  serveur. Aucun secret d'administration Auth ne passe dans le navigateur.
- Une création réessayée avec le même identifiant d'opération restitue le même résultat sans créer
  de deuxième compte ni changer silencieusement le mot de passe. Toute régénération possède son
  propre identifiant d'opération, exige une confirmation et est auditée.
- Les règles métier restent inchangées : accès limité à la mission, échéance et révocation contrôlés
  côté base/RLS à chaque accès ; la révocation d'un mot de passe ne remplace pas ces contrôles.

### 2.4 Réalisation du 2026-08-11

1. L'Edge Function expose désormais quatre opérations explicites : `create`, `reveal`,
   `regenerate` et `revoke`. Elle réserve les opérations en base avant tout changement Auth afin de
   rendre les reprises idempotentes.
2. Auth reçoit une adresse technique interne dérivée de l'identifiant ; elle n'est jamais affichée.
   Le navigateur ne reçoit aucun secret d'administration. La génération courante est portée dans
   `app_metadata` et contrôlée par la base à chaque accès du rôle `saisisseur`.
3. L'écran global **Comptes de mission** résume les comptes de toutes les bases appartenant au
   médecin. L'écran par base reste disponible. Le mot de passe est masqué, révélable ou copiable par
   le seul propriétaire, et n'est conservé que dans l'état mémoire de la page.
4. La connexion accepte un « Identifiant » de mission ou l'e-mail d'un compte ordinaire. Les actions
   d'invitation, de renvoi et de récupération par e-mail ont disparu du parcours mission.
5. Les anciens comptes de mission dépourvus d'enveloppe de justificatifs sont inertes : leurs
   identités Auth sont bannies, leurs sessions existantes sont supprimées par la migration et les
   gardes RLS refusent leurs jetons.

### 2.5 Cause historique, vérifiée dans le code

[`supabase/functions/create-mission-account/index.ts:39`](../supabase/functions/create-mission-account/index.ts:39) :

```ts
const redirectTo = Deno.env.get('MISSION_PASSWORD_REDIRECT_URL') ?? undefined;
const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
```

Sans la variable, `resetPasswordForEmail` est appelée **sans** `redirectTo` ; GoTrue retombe alors
sur `site_url`, c'est-à-dire l'accueil. Le commentaire du code présente cette redirection comme
« facultative » — elle ne l'est pas : sans elle le compte produit est inutilisable.

La variable **n'est documentée nulle part** dans [edge-functions.md](edge-functions.md). Elle
n'apparaît aujourd'hui que dans `docs/audits/audit-technique-complet-2026-08-09.md:75` (liste des
secrets de production non vérifiables localement) et dans [tests-multicomptes.md §7.1](tests-multicomptes.md).

### 2.6 État et preuves

Le lot a été repris le 2026-08-11 sur `codex/mission-credentials`. Sur la pile Supabase locale, un
propriétaire a créé un compte sans e-mail depuis l'écran global, puis le compte s'est connecté avec
l'identifiant choisi. Après une régénération réalisée pendant que sa session était encore ouverte :

- l'ancienne session n'a plus pu lire le profil ni les données ;
- l'ancien mot de passe a été refusé et le nouveau accepté ;
- l'identifiant est resté inchangé ;
- les opérations création, révélation et régénération ont été auditées sans champ de secret ;
- les journaux Edge, Vite et navigateur ne contenaient aucun des mots de passe fictifs utilisés.

Le vérificateur automatisé du vrai contrat Edge a en outre passé **29/29 contrôles** : reprise
exacte, doublon refusé, connexion réelle, refus inter-comptes et inter-bases, expiration,
régénération, anciens jetons et mots de passe, révocation, chiffrement et absence de clair dans
les tables et l'audit.

La CI est ensuite restée verte sur les passages branche → `develop` → `main`. Le workflow manuel
**Coordinated release** a validé le même SHA
`bb99ac72ba46541904d255f7bf129ecd2ad3ca4e` sur staging (`31475841694`), puis en production
technique (`31476792936`) avec l'identifiant de ce staging. Le staging a notamment confirmé :

- 113 migrations et l'empreinte Storage attendue ;
- 154 fonctions `SECURITY DEFINER` conformes ;
- les sept Edge Functions déployées, dont `create-mission-account` ;
- le parcours distant des justificatifs de mission, **29/29 vérifications** ;
- le frontend, le scanner strict et les tests navigateur E2E.

Cette promotion est une preuve technique avec données fictives. Elle n'autorise ni usage clinique
ni traitement de données réelles.

---

## 3. Chantier B — écarts d'interface du rôle `saisisseur`

Six écarts relevés en test manuel entre ce que l'interface propose et ce que
[spec-comptes-mission.md §4](spec-comptes-mission.md) accorde. **Aucun n'est une faille** — la base
refuse dans tous les cas — mais le premier rendait le rôle inutilisable depuis l'interface.

Chaque point a été soumis au porteur et tranché individuellement.

### 3.1 Point 1 — pas de bouton « Nouveau patient » · **décidé : corriger**

L'état vide affichait « Aucun patient. Cliquez sur "Nouveau patient". » alors qu'aucun bouton
n'était rendu. La route `/bases/:id/patients/new` fonctionnait pourtant.

**Cause** : `BaseHome.tsx` calculait un unique `canEdit` à partir de `canEditStructuredData`.
Or **créer n'est pas modifier** : le compte de mission a `can_create_structured_data` et se voit
refuser `can_edit_structured_data` par le trigger de garde
([`20260729104500_mission_accounts.sql:95`](../supabase/migrations/20260729104500_mission_accounts.sql:95)).
La création étant la raison d'être du rôle, le compte était dans une impasse.

**Décision : corriger.** Introduction d'un `canCreate` distinct (`owner || canCreateStructuredData
|| canEditStructuredData`), bouton ajouté aussi dans l'état vide, et **libellé de l'état vide rendu
conditionnel** — ne pas dire « cliquez sur Nouveau patient » à qui n'a pas le bouton (nouvelle clé
`patient.no_patients_readonly`).

### 3.2 Point 2 — section « Identité (zone restreinte) » proposée · **renversé → chantier C**

Le point était formulé comme « masquer la section pour ce rôle ». Le porteur a objecté qu'un
saisisseur qui ne peut pas écrire l'identité n'a pas de sens dans son usage réel. L'analyse a
donné raison à l'objection et le point est devenu un **changement de modèle**, traité au §4.

À noter pour qui reprend : ce n'est pas un problème d'affichage. La RPC `create_patient`
**refuse la création** — elle n'ignore pas les champs — si un appelant sans `can_write_identity`
envoie un nom, une date de naissance, un téléphone, une adresse **ou un numéro de dossier externe**
([`20260729104500_mission_accounts.sql`](../supabase/migrations/20260729104500_mission_accounts.sql), RPC `create_patient`).
Aujourd'hui, si le saisisseur remplit cette section, l'enregistrement échoue.

### 3.3 Point 3 — bouton « Supprimer ce patient » · **décidé : corriger, portée plus large que prévu**

**Découverte au passage** : le bouton n'était pas seulement offert au compte de mission, il était
offert à **tout le monde**, y compris à un simple lecteur. Le point d'audit visait le rôle
`saisisseur` ; le défaut était général.

**Décision : corriger.** Le bouton passe sous `canEdit`
([`src/screens/member/PatientDetail.tsx:188`](../src/screens/member/PatientDetail.tsx:188)) — la
suppression relève de `can_edit_structured_data`. La base refusait déjà ; l'interface ne doit pas
conduire à ce refus.

### 3.4 Point 4 — « Rendre disponible hors-ligne » · **décidé : corriger, avec une nuance**

[spec §4](spec-comptes-mission.md) exclut le mode hors-ligne du rôle en v1. Le bouton était
proposé.

**Décision : masquer**, pour un accès à échéance (`expiresAt != null`). **Nuance retenue** : une
copie résiduelle déjà présente sur le poste reste **retirable** — seule sa *mise à jour* est
fermée. Retirer le bouton de suppression aurait enfermé une copie locale sur la machine de
l'étudiant, ce qui est l'inverse de l'intention.

### 3.5 Point 5 — barre latérale · **décidé : corriger**

« Groupes de recherche » (`/groups`) et « Mes jeux de variables » (`/templates`) restaient proposés
au compte de mission. Ce sont des zones médecin : les routes sont déjà fermées et la RLS refuse les
données, mais la navigation ne devrait pas y conduire.

**Décision : corriger.** Branche `saisisseur` explicite dans
[`src/components/AppShell.tsx:102`](../src/components/AppShell.tsx:102) — tableau de bord et
synchronisation seulement.

### 3.6 Point 6 — « Modèle : — » dans l'en-tête de base · **clos, aucune action**

**Cause réelle, et elle n'est pas dans l'interface** : la policy `template_read`
([`20260616090400_rls.sql:24`](../supabase/migrations/20260616090400_rls.sql:24)) n'autorise la
lecture d'une ligne de `template` que si le gabarit est global, s'il vous appartient, ou si vous
êtes admin. Le gabarit d'une base est le **jeu de variables personnel du médecin** : le compte de
mission n'est aucun des trois, la requête revient vide, l'interface affiche « — ». En revanche les
**champs** du gabarit passent par `can_read_template()`, qui inclut « le gabarit de la base à
laquelle j'ai accès » : c'est pourquoi le formulaire de saisie fonctionne alors que le nom manque.

**Le même angle mort touche un médecin collaborateur non-propriétaire** : il travaille sur une base
partagée sans jamais voir le nom du gabarit qu'il utilise.

**Décision du porteur : ne rien faire.** Le nom du gabarit est une information de propriétaire ; ni
le collaborateur ni le saisisseur ne peuvent agir dessus. Corriger aurait demandé une migration sur
cette policy pour un gain purement informatif.

> Conséquence à assumer : [spec §4](spec-comptes-mission.md) annonce « voir la base attribuée et
> son dictionnaire/gabarit ». Le dictionnaire est bien lisible, **le nom du gabarit ne l'est pas**,
> et l'en-tête affichera « Modèle : — » pour ces deux profils. C'est un choix, pas un oubli : ne
> pas rouvrir le point sans raison nouvelle.

### 3.7 État du chantier B — première tentative effacée

Une première implémentation des points 1, 3, 4 et 5 avait été écrite dans le worktree
`.claude/worktrees/mystifying-shirley-9cf201`, sans test et sans vérification. **Elle a été
effacée le 2026-08-10, délibérément.**

Deux raisons :

- ce code a été écrit **avant** que les points 2 et 6 ne soient tranchés — il ne tient donc aucun
  compte du renversement du §4, qui change ce que l'écran de création doit proposer ;
- le découpage en lots étant fait, le travail est confié à une instance fraîche munie du prompt
  **L16** de [prompts-lots.md](prompts-lots.md), qui couvre les deux phases dans le bon ordre et
  exige les tests. Finir un demi-travail antérieur à la décision aurait coûté plus que le
  réécrire.

**Rien de tout cela n'est perdu** : les §3.1 à §3.6 ci-dessus décrivent chaque correction, sa
cause et sa décision. C'est la spécification du lot.

**Tout est à écrire** : les cinq corrections d'écran (points 1, 3, 4, 5 et le point 2 issu du
chantier C), leurs tests web dans `src/screens/member/*.test.tsx`, puis la batterie de
validation.

**Clôture (2026-08-11)** : les six points ont été livrés avec le lot L16, en même temps que le
chantier C — migration `20260811130000_mission_identity_write_correction.sql`, RPC
`update_patient_identity` et interface. Preuves locales, CI, staging et production technique dans
[suivi-execution-feuille-route.md](suivi-execution-feuille-route.md).

---

## 4. Chantier C — le compte de mission doit pouvoir écrire l'identité

C'est la décision la plus lourde de la campagne : **elle renverse une décision de spécification**.
Elle est documentée en détail parce qu'elle ne se déduit d'aucune lecture du code.

### 4.1 Ce que la spécification dit aujourd'hui

[spec §4](spec-comptes-mission.md) : « Écrire l'identité nominative — **Non** — `can_write_identity`
jamais accordée ». [spec §12](spec-comptes-mission.md), décision du **2026-07-28** : « Création
minimale, **identité nominative exclue**. […] c'est cette exclusion qui rend la permission
acceptable. »

### 4.2 Pourquoi cette décision doit être renversée

**La spécification a été écrite sur une hypothèse de terrain qui n'est pas celle du porteur.**
Le §12 raisonnait sur « le médecin crée les patients, l'étudiant remplit les données analytiques » :
dans ce cadre, exclure l'identité ne coûte rien, puisque quelqu'un d'autre l'a déjà saisie.

Le scénario réel est l'inverse : **l'étudiant est le seul point de contact avec le patient au moment
de l'inclusion**, il n'existe **pas de support papier stable** (questionnaire, fiche d'inclusion,
cahier) susceptible de porter la correspondance numéro ↔ identité, et les études visées sont
transversales. La base est donc **le seul enregistrement**. L'exclusion ne protège alors plus rien :
elle détruit l'information.

Ce n'est pas un revirement du porteur, c'est une décision qui avait été prise sur une prémisse
fausse — et prise dans le cadre de la *curation*, avant que les comptes de mission n'existent.

### 4.3 Option écartée en cours de route — le code dérivé

Le porteur avait envisagé une zone de saisie « fictive » générant un code à partir du nom et de la
date de naissance, la base ne stockant que le code.

**Écartée**, pour deux raisons : dériver un code d'un identifiant nominatif suppose un **secret
partagé par tous les postes qui le calculent** ; sur une population de quelques centaines de
patients dans une région donnée, un tel code se ré-identifie par force brute dès que le secret
fuit. Et une **faute de frappe** dans le nom produit un code différent : le doublon que le mécanisme
devait éviter réapparaît. C'est l'illusion de la pseudonymisation sans la garantie.

### 4.4 Le fait technique qui a décidé — `can_write_identity` est une formule, pas une permission

Vérifié dans
[`20260729104500_mission_accounts.sql`](../supabase/migrations/20260729104500_mission_accounts.sql) :

```sql
create or replace function public.can_write_identity(p_base uuid) ... as $$
  select public.is_medecin()
     and exists (... base non supprimée ...)
     and ( ... propriétaire ...
        or exists (select 1 from public.base_access a
                   where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                     and (a.expires_at is null or a.expires_at > now())
                     and a.can_view_identity and a.can_edit_structured_data) )
$$;
```

Autrement dit, « écrire l'identité » est aujourd'hui **défini** comme « pouvoir la lire **et**
pouvoir modifier ». Deux conséquences :

- **L'écriture sans lecture n'est pas exprimable dans le modèle actuel.** Il faudrait la créer.
- Le rôle `saisisseur` bute sur une condition qu'il **ne pourra jamais remplir** : le trigger de
  garde lui interdit structurellement `can_edit_structured_data`
  ([ligne 95](../supabase/migrations/20260729104500_mission_accounts.sql:95)). Ce n'est donc pas une
  décision de sécurité délibérée, c'est un **effet de bord de la formule**.

À l'inverse, **l'option de lecture existe déjà pour ce rôle et elle est bien faite** :
`can_view_identity` se règle à la création de la mission, avec **justification obligatoire**
([ligne 104](../supabase/migrations/20260729104500_mission_accounts.sql:104)), consignée dans
`base_access.identity_justification` et dans `audit_log`, et déjà présente dans l'écran
« Comptes de mission ».

### 4.5 Les deux chemins et la décision

| | **Option A — étendre la formule** | **Option B — créer l'écriture sans lecture** |
|---|---|---|
| Base | Une migration redéfinissant `can_write_identity()` | Colonne `can_write_identity` sur `base_access`, garde étendue, `provision_mission_account` et `list_mission_accounts` modifiées |
| Edge / UI médecin | Rien | Paramètre supplémentaire dans la fonction, option supplémentaire dans l'écran |
| Anti-doublon | Fonctionne (il repose sur la lecture de l'identité) | **Cassé** : il faudrait une variante ne renvoyant que le code, sinon l'étudiant crée des doublons à l'aveugle |
| Faute de frappe dans un nom | Corrigeable par le médecin | **Irréparable côté étudiant** : il ne peut ni relire ni modifier |
| Conséquence assumée | L'étudiant peut **aussi relire** les identités de sa base — celles qu'il a lui-même saisies | Le compte ne devient jamais un annuaire consultable |

**Décision du porteur (2026-08-10) : option A.** Motifs : c'est le mécanisme que la spécification a
déjà construit, le médecin garde le contrôle mission par mission avec justification obligatoire, et
aucune surface nouvelle n'est ajoutée.

### 4.6 Plan d'exécution arrêté

Skill `meddata-db-safety` obligatoire pour les points 1 et 2.

1. **Nouvelle migration horodatée** redéfinissant `can_write_identity()` : branche médecin **reprise
   à l'identique**, branche saisisseur **ajoutée** — accès actif, non révoqué, non expiré,
   `can_view_identity` accordée et `can_create_structured_data`. Additive, aucune migration
   existante modifiée, aucune donnée touchée. La RPC `create_patient` se débloque d'elle-même
   puisqu'elle appelle déjà cette fonction.

   > **Piège** : `is_medecin()` exige `profiles.global_role = 'medecin'`
   > ([`20260616090300_functions.sql:16`](../supabase/migrations/20260616090300_functions.sql:16)) —
   > un `saisisseur` ne le satisfera **jamais**. La branche saisisseur doit donc être ajoutée **au
   > niveau supérieur**, hors de la conjonction `is_medecin() and …`, et surtout **pas** en
   > relâchant `is_medecin()` pour la branche médecin.

2. **Correction de toute l'identité après création** : `update_patient` ne porte que les données
   analytiques ; il ne peut pas corriger `full_name`, `date_of_birth`, `phone`, `address` ni
   `external_identifier`. Ajouter une RPC dédiée, auditée et protégée par verrou de version, jamais
   une écriture directe depuis le navigateur. Le médecin propriétaire (ou le médecin collaborateur
   ayant les droits d'identité et d'édition) peut corriger cette zone pour les patients de sa base.
   Le saisisseur ne peut la corriger que pour **son propre patient encore en brouillon**, pendant une
   mission active avec l'option identité accordée ; ni les fiches soumises, ni celles d'autrui. La
   correction doit conserver un motif, une trace, et la protection contre les doublons déjà appliquée
   à la création.

3. **Contrôle de l'allowlist `SECURITY DEFINER`** : la nouvelle RPC de correction doit recevoir une
   autorisation `EXECUTE` minimale, être ajoutée à l'inventaire si nécessaire, et être vérifiée par
   `npm run db:function-acl:verify` — ne rien supposer.

4. **`test/mission-accounts.test.ts`** : le cas « il ne peut JAMAIS écrire l'identité » (≈ l.241)
   devient « il ne peut écrire que si l'option lui a été accordée ». **Conserver** le cas négatif
   sans option et le cas après échéance. Les assertions de nullité des champs nominatifs après
   création (≈ l.138-148) et l'assertion `can_write_identity = false` avec option (≈ l.253) sont à
   revoir dans le même mouvement. Couvrir aussi la correction de chacun des cinq champs de la zone
   restreinte par le saisisseur sur son brouillon, puis les refus après soumission, expiration,
   révocation, sur le patient d'autrui et par écriture directe. C'est un **retournement délibéré et
   documenté**, pas une régression — l'écrire dans le commit.

5. **`docs/spec-comptes-mission.md` §4, §9 et §12 réécrits**, en consignant la raison du renversement
   (pas de support papier stable, l'étudiant est la seule source de l'identité au moment de
   l'inclusion, études transversales). Ne pas se contenter de retourner la ligne du tableau §4 : la
   phrase du §12 « c'est cette exclusion qui rend la permission acceptable » doit être remplacée par
   ce qui rend désormais la permission acceptable (option décochée par défaut, justification
   obligatoire, journalisation, périmètre d'une seule base, échéance).

6. **UI** : dans `NewPatient`, la section « Identité (zone restreinte) » devient conditionnée à
   `canViewIdentity` — masquée sans l'option, visible avec. Ajouter aussi un parcours de correction
   de la zone complète sur une fiche déjà créée, avec les mêmes règles de droit et d'état que la RPC ;
   un clic « Modifier » ne doit plus donner l'illusion qu'il corrige une identité alors qu'il ne
   modifie que les données analytiques. C'est le point 2 du chantier B, complété par le retour de
   test du 2026-08-11.

7. **Tests web** pour les points 1, 3, 4, 5 du chantier B et pour la création/correction de la zone
   d'identité complète.

8. **Validation** : `npm run typecheck` · `npm run lint` · `npm run test:web` · `npm run test:rls`.

**L'ordre a son importance** : la migration d'abord, sinon l'écran proposerait une saisie que la
base refuse encore.

### 4.7 À porter au volet juridique

Le renversement élargit ce qu'un compte de mission peut connaître d'un patient. Il doit être
répercuté au registre des traitements (`docs/juridique/`, volet Tchad) et à la charte utilisateurs,
puisque [readiness-production-2026-07-19.md §9](readiness-production-2026-07-19.md) prévoit qu'une
modification de cette nature déclenche une réévaluation.

---

## 5. Chantier D — un refus légitime est indiscernable d'une panne

### 5.1 Constat

Quand une Edge Function refuse une demande, l'interface affiche
`Edge Function returned a non-2xx status code` — le message de **transport** de la bibliothèque
cliente — au lieu du message court et générique renvoyé par la fonction (`Base invalide`,
`Authentification requise`, `Seule une cohorte figée est exportable`…).

### 5.2 Cause, vérifiée pour le chemin export

`functions.invoke` lève un `FunctionsHttpError` dont le `.message` est littéralement cette phrase ;
le vrai corps (`{ code, error, resource }`) se trouve dans `error.context`, que
[`src/data/exports.ts:59`](../src/data/exports.ts:59) **ne lit pas** — `errorMessage()` ne voit donc
que le message générique.

`src/data/mission.ts` tente, lui, de lire le message de la fonction et retombe malgré tout sur le
message de transport : **la cause exacte du repli reste à confirmer** sur ce chemin-là.

### 5.3 Pourquoi ce n'est pas cosmétique

Ce défaut a coûté deux diagnostics complets pendant la campagne, chaque fois en obligeant à sortir
de l'application :

- un `400 — Base invalide` sur les données de démonstration, dont la cause réelle était que les
  identifiants du seed ne sont pas conformes RFC-4122 ([tests-multicomptes.md §5.5](tests-multicomptes.md)) —
  il a fallu rejouer l'appel hors interface pour lire la vraie réponse ;
- un `409 — EXPORT_INCOMPLETE` sur un export, dont la cause réelle était un patient encore en
  brouillon dans une cohorte figée — il a fallu ouvrir les outils de développement du navigateur
  puis interroger la base.

Dans les deux cas l'utilisateur voyait la même phrase, qui ne dit rien.

### 5.4 Ce que la correction devrait viser

**Une fois, dans un utilitaire partagé**, pas appelant par appelant : tous les chemins qui passent
par `functions.invoke` sont concernés (exports, comptes de mission, `signed-read`, `inspect-upload`,
`finalize-upload`, `cleanup-upload`, `reconcile-quarantine`). Lire `error.context`, en extraire le
message court et le code, retomber sur le message de transport seulement en dernier recours.

**Contrainte à ne pas perdre de vue** : les Edge Functions renvoient volontairement des messages
courts et génériques, et ne doivent **jamais** exposer d'erreur interne brute au frontend. Le but
n'est pas d'afficher davantage, c'est d'afficher **ce que le serveur a déjà choisi de dire**.

Une leçon de la campagne à conserver : lors d'un lot antérieur, un correctif de ce type appliqué à
un seul appelant avait laissé les autres afficher `[object Object]`. Le corriger partout ou nulle
part.

### 5.5 État — corrigé le 2026-08-11

Signalé le 2026-08-09 dans deux séances distinctes, puis **corrigé** sur `codex/edge-error-messages`.

**Cause du repli de `mission.ts`, désormais confirmée** (le §5.2 la laissait ouverte) :
`FunctionsHttpError.context` **est l'objet `Response`**, pas un objet `{ body }`. `mission.ts` lisait
`context.body`, c'est-à-dire un `ReadableStream` — ni chaîne, ni objet portant `.error` — de sorte que
ses deux branches échouaient et qu'il retombait toujours sur `error.message`. Le corps ne se lit
qu'**en asynchrone** (`await context.clone().text()`), ce que seul `inspection.ts` faisait.

**Correction.** Un utilitaire unique, [`src/lib/edgeFunctionError.ts`](../src/lib/edgeFunctionError.ts),
lit le corps du refus, n'en retient que la phrase choisie par la fonction (champ `error`) et son code
technique (champ `code`, uniquement s'il ressemble à un jeton en majuscules), et compose
« phrase (CODE) ». Le message de transport n'est utilisé qu'en dernier recours. La phrase est mise sur
une seule ligne et bornée à 300 caractères ; aucun autre champ du corps n'est affiché, ce qui rend
structurellement impossibles à la fois la fuite d'une erreur interne et le retour du `[object Object]`.

Les cinq appels frontend passent par cet utilitaire. `signed-read` **cesse d'avaler l'erreur** : son
motif remonte jusqu'à la vignette (`useSignedFile` porte désormais le message, rendu par
`PatientDetail` et `CurationTask`). Une **garde d'inventaire** dans
[`src/data/edgeFunctionCallers.test.tsx`](../src/data/edgeFunctionCallers.test.tsx) échoue si un
nouvel appel direct à `functions.invoke` apparaît hors de l'utilitaire : c'est ce qui empêche la
répétition du lot antérieur corrigé « appelant par appelant ».

**Refus réels provoqués sur la pile locale, message lu à l'écran** (un par chemin) :

| Chemin | Geste | Ce que l'écran affiche |
|---|---|---|
| `generate-export` | export d'une cohorte du seed | `cohortId invalide` (400) |
| `create-mission-account` | création sur la base du seed | `Base invalide` (400) |
| `create-mission-account` | identifiant déjà pris | `Cet identifiant est deja utilise` (409) |
| `inspect-upload` | « Relancer l'inspection » | `Inspection antivirus impossible : Acces refuse.` (403) |
| `signed-read` | « Afficher l'image » | `Acces refuse` (403) — ce chemin ne disait **rien** avant |
| `finalize-upload` | envoi d'un document, objet Storage divergent | `Objet Storage incoherent` (409) |

Les deux premiers sont exactement les incidents du 2026-08-09 : chacun affichait auparavant
`Edge Function returned a non-2xx status code`.

> **Sixième piège de poste, découvert à cette occasion** : sur la pile **locale**, `service_role`
> n'a aucun privilège `select/insert/update/delete` sur les tables de `public`, alors qu'un projet
> Supabase **hébergé** les accorde par défaut. Toute Edge Function qui lit une table avec le client
> d'administration échoue donc localement par un refus trompeur (`Cohorte introuvable`,
> `Acces refuse`) sans que rien ne soit cassé côté code. À rapprocher de la note déjà portée par
> `scripts/verify-function-privileges.mjs` sur l'héritage implicite des `EXECUTE` en hébergé.

---

## 6. Chantier E — cohortes

Trois constats issus de la séance « données en lecture seule », qui portait au départ sur un export
impossible depuis un compte médecin.

### 6.1 L'export bloqué — résolu, mécanisme à connaître

Le refus était un `409 EXPORT_INCOMPLETE`. Mécanisme d'alors : l'export ne lisait que les lignes
`validation_status = 'curated'`, puis comparait les ensembles et refusait en bloc si un seul membre
manquait à l'appel.

**Depuis la migration `20260819103000` (décision du 2026-08-17), le statut de validation n'est plus
la porte de l'export** : une fiche `draft` ou `complete` s'exporte dès lors qu'elle porte ses champs
obligatoires. Les fiches incomplètes sont écartées et comptées
(`export_options.excluded_records`), sans jamais faire échouer l'export.

**Ce qui reste délibéré :** la comparaison stricte des ensembles. Un membre de cohorte introuvable
(supprimé, illisible, mutation concurrente) reste un `409 EXPORT_INCOMPLETE` — un export peut être
partiel *par décision*, jamais *par accident*.

### 6.2 Suppression d'une cohorte — livrée le 2026-08-13

Décision du porteur : **suppression réelle, sans archivage**, tout en conservant le journal et les
fichiers d'exports. La migration remplace la cascade dangereuse : `export_log` conserve le `base_id`
et le nom de cohorte historiques, et `cohort_id` devient nul quand la cohorte est supprimée. L'accès
aux exports signés se fonde sur cette base conservée, jamais sur une cohorte qui n'existe plus. La
RPC `delete_cohort` est réservée à `can_curate`, verrouille la cohorte, supprime ses membres par
cascade et crée une trace d'audit ; le DELETE direct est fermé.

### 6.3 Carte d'une cohorte dynamique sans compteur ni action

Déjà consigné : **défaut D6** de [idees-post-readiness.md](idees-post-readiness.md). Le refus
d'export d'une cohorte dynamique est **délibéré et doit le rester** (l'export inscrit une empreinte
et des décomptes figés dans `export_log` ; sur une population qui bouge, le fichier ne serait
rattachable à rien de reproductible). Le défaut est que l'interface **subit** cette règle sans
jamais l'énoncer ni proposer la suite. Correction attendue : compte vivant via `cohort_preview`, et
bouton « Figer maintenant ».

### 6.4 On peut figer une cohorte qui ne sera jamais exportable — **non consigné ailleurs**

Le figeage **accepte les brouillons** quand la case « patients validés uniquement » est décochée
([`20260616091100_cohorts.sql:100`](../supabase/migrations/20260616091100_cohorts.sql:100)), alors
que l'export les refuse en bloc (§6.1). **Rien n'avertit au moment du figeage.** L'utilisateur
découvre le blocage au moment d'exporter, sur une cohorte qu'il ne peut plus réparer autrement
qu'en validant les fiches ou en en figeant une nouvelle.

Deux issues possibles, non tranchées : avertir au figeage (« cette cohorte contient N fiches non
validées et ne sera pas exportable en l'état »), ou proposer la réparation depuis l'écran d'export.

---

## 7. Points ouverts — décisions qui reviennent au porteur

Rassemblés ici pour qu'aucun ne se perde. Aucun n'est une correction technique évidente : ce sont
des arbitrages d'usage.

| # | Question | Options | Renvoi |
|---|---|---|---|
| 1 | `.env.local` fait pointer `npm run dev` sur la **production** | (a) renommer en `.env.production.local` ; (b) bandeau visible quand l'origine Supabase n'est pas locale ; (c) statu quo + discipline | [tests-multicomptes.md §5.1](tests-multicomptes.md) |
| 2 | Identifiants du seed non conformes RFC-4122 → **aucun flux Edge testable sur les données de démonstration** | (a) vrais UUID v4 dans le seed ; (b) assouplir `UUID_RE` ; (c) statu quo documenté — **option en vigueur** | [tests-multicomptes.md §5.5](tests-multicomptes.md) |
| 3 | Mode d'activation des comptes de mission | **Tranché le 2026-08-11 : identifiant choisi par le propriétaire et mot de passe généré, sans e-mail** | §2.2 |
| 4 | Conservation et régénération du mot de passe | Secret disponible au seul propriétaire, masqué et stocké chiffré ; régénération confirmée et auditée, ancien secret et anciennes sessions invalidés | §2.3 |
| 5 | Cohortes : archivage ou suppression dure conditionnelle ? | **Tranché le 2026-08-13 : suppression réelle avec conservation du journal et des fichiers d'exports** | §6.2 |

---

## 8. État historique du dépôt au 2026-08-10 — où vivait chaque chose

Instantané daté, à relire plutôt qu'à croire une fois ce document fusionné.

**Cette documentation est committée** sur la branche `docs/chantiers-multicomptes`, quatre commits
posés directement sur `main` (`9cd3e04`), **non poussée**. Elle emporte : ce registre,
`tests-multicomptes.md`, les renvois dans `tester-en-local.md` et `spec-comptes-mission.md`, les
défauts D7 et D8 de `idees-post-readiness.md`, la remise à jour de `lots-paralleles.md` et
`prompts-lots.md`, les deux rapports d'audit, et `supabase/config.toml`
(`import_map = "../deno.json"` sur les 7 Edge Functions — additif, sans effet sur le déploiement).

**Restent non committés dans l'arbre principal**, et sans rapport avec ces chantiers : des travaux
Codex sur `docs/edge-functions.md` (procédure de tunnel ClamAV), `vercel.json` et
`test/deployment.test.ts` (le repli SPA avalait `/_vercel/…`, la télémétrie ne démarrait jamais).
Ne pas les mélanger à un commit de documentation. S'y ajoutent `stdout` et `tsc_output.txt`,
fichiers parasites signalés par l'audit `AUD-2026-08-HYG-01`, qui gagneraient à passer au
`.gitignore`.

**Aucun code applicatif n'est en attente nulle part.** Les deux worktrees
(`mystifying-shirley-9cf201`, `vigilant-curran-fe8b58`) sont **propres** : le chantier A n'a jamais
rien écrit, et la première tentative du chantier B a été effacée (§3.7). Tout part donc des prompts
**L15** à **L19** de [prompts-lots.md](prompts-lots.md).

Aucune migration, aucune donnée en ligne, aucun paramètre cloud n'a été touché par ces séances.

---

## 9. Ce qui reste à tester

Repris de [tests-multicomptes.md §8](tests-multicomptes.md), avec l'ajout des chantiers.

- **Collaboration entre médecins** : procédure prête à l'emploi, [qa-parcours-site.md §6bis](qa-parcours-site.md)
  étapes **C1 à C8** (invitation, acceptation, profil appliqué, ajout de la permission Identités,
  **édition simultanée avec conflit de version**, lien à usage unique, mauvais compte, révocation).
  Ce flux n'envoie **pas** de courriel — il est donc testable en ligne aussi bien qu'en local.
- **Échéance et révocation d'une mission vues depuis la session de l'étudiant.** La garde n'impose
  qu'un maximum de 24 mois, pas de minimum : forcer l'échéance en base plutôt que l'attendre.

  ```sql
  update base_access set expires_at = now() - interval '1 minute' where user_id = '<id du compte de mission>';
  ```

- **Deux sessions réellement simultanées** : la même origine partage le stockage du navigateur —
  fenêtre de navigation privée ou second profil.
- **Promotion distante du chantier A** : CI verte, vérification synthétique sur staging, puis
  production technique pour le même commit via **Coordinated release**. Confirmer que le secret Edge
  dédié est présent sur chaque cible sans jamais en afficher la valeur.
- **Après le chantier C** : rejouer la saisie d'une identité autorisée par le compte de mission ; ce
  scénario est distinct de la création, de la révélation et de la régénération des justificatifs,
  déjà validées localement pour le chantier A.

---

## 10. Références

- [tests-multicomptes.md](tests-multicomptes.md) — comment tester, les cinq pièges de poste, le
  parcours réellement exécuté et son résultat
- [spec-comptes-mission.md](spec-comptes-mission.md) — spécification du rôle `saisisseur` (§4 droits,
  §8 interface, §12 décisions du demandeur) — **§4, §9 et §12 à réécrire par le chantier C**
- [idees-post-readiness.md](idees-post-readiness.md) — file d'attente produit (idée 11, défauts D1-D6)
- [qa-parcours-site.md](qa-parcours-site.md) §6bis — collaboration entre médecins, étapes C1-C8
- [edge-functions.md](edge-functions.md) — déploiement et variables d'environnement des Edge
  Functions — **à compléter par le chantier A**
- [tester-en-local.md](tester-en-local.md) — mise en route de la pile locale
- `docs/audits/audit-technique-complet-2026-08-09.md` — audit du même jour (constats de dépendances,
  test web en échec, hygiène du dépôt)
- [readiness-production-2026-07-19.md](readiness-production-2026-07-19.md) §9 — toute modification
  de cette nature déclenche une réévaluation
