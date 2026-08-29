# Tester les flux entre comptes — comptes de mission et collaboration

> **Objet** : comment vérifier à la main ce qu'aucun test automatisé ne traverse — la chaîne
> complète Auth + Edge Function + deux sessions utilisateur vivantes.
> **Origine** : session de travail du **2026-08-09**, sur demande du porteur du besoin.
> **Portée** : ce document couvre le *comment tester*, les obstacles rencontrés et les décisions
> prises. Il ne remplace ni `spec-comptes-mission.md` (la spécification du rôle), ni
> `qa-parcours-site.md` (le plan de test du site déployé).

> **État courant au 2026-08-11** : le circuit de mission par courriel décrit comme preuve historique
> dans les §1, §3, §6.1 et §7.1/7.4 a été **remplacé**. Le propriétaire choisit l'identifiant, le
> serveur génère le mot de passe et le conserve chiffré ; le propriétaire peut le révéler,
> régénérer ou révoquer depuis l'écran global `/missions`. La procédure actuelle est au §8.

---

## 1. Le besoin exprimé

Les fonctionnalités du produit sont largement implémentées, mais **celles qui font intervenir
plusieurs comptes n'avaient jamais été essayées par un utilisateur** :

- les **comptes de mission** (rôle `saisisseur`) : historiquement, le test portait sur un courriel
  d'activation ; depuis le 2026-08-11, le propriétaire remet directement l'identifiant choisi et le
  mot de passe généré pour une durée limitée ;
- la **collaboration entre médecins** : invitation, acceptation, permissions accordées puis
  retirées, édition simultanée.

La question posée était : *comment faire pour les tester ?*

Le besoin réel derrière la question n'est pas de re-tester les règles de sécurité — elles sont
déjà verrouillées (§2) — mais de vérifier que **les couches tiennent ensemble** : un compte créé
par une Edge Function, un secret réellement utilisable sans fuite, une seconde personne qui se
connecte et voit ce qu'elle doit voir, puis une régénération qui invalide sa session vivante. C'est
précisément la zone qu'aucun test unitaire, RLS ou Deno ne peut couvrir seul.

---

## 2. Ce qui est déjà prouvé automatiquement

À ne pas refaire à la main. Ces suites tournent sans Docker (PostgreSQL embarqué) :

| Fichier | Nombre de tests | Ce qu'il verrouille |
|---|---|---|
| `test/mission-accounts.test.ts` | 51 | Rôle posé par `app_metadata` seul ; saisie → brouillon → soumission → immuabilité ; identité refusée par défaut et option justifiée ; cloisonnement à une seule base ; échéance et révocation appliquées par la base ; prolongation ; révocation sur déclassement de rôle |
| `test/mission-credentials.test.ts` | 9 | Unicité sans distinction de casse ; refus inter-comptes ; reprise idempotente ; génération courante ; expiration, révocation et anciennes sessions refusées ; absence de clair dans les tables et l'audit |
| `test/access.test.ts` | 8 | Invitations réservées au propriétaire ; invitation révoquée inacceptable ; anti-escalade d'un délégué `can_manage_access` |
| `supabase/functions/create-mission-account/*_test.ts` | 15 | Génération robuste, chiffrement authentifié, contrat create/reveal/regenerate/revoke, refus propriétaire et absence de fuite dans les réponses d'erreur |

```bash
npm run test:rls
```

**Ce que ces tests ne peuvent pas prouver**, et qui justifie le test manuel :

- la création réelle du compte Auth par l'Edge Function sur un vrai GoTrue ;
- la connexion réelle avec l'identifiant visible alors qu'Auth utilise une identité technique ;
- l'invalidation d'une session GoTrue déjà ouverte après régénération ;
- ce que l'interface **propose** à un rôle (un bouton offert à tort n'est pas un défaut de
  sécurité — la base refuse — mais c'est un défaut d'usage, et c'est exactement ce qui a été
  trouvé, cf. §7.2) ;
- deux sessions simultanées (conflit de version, révocation vue par l'autre).

---

## 3. Décision : tester sur la pile locale, pas sur le cloud

**La pile Supabase locale (Docker) reste la première cible du test manuel multi-comptes.** Elle
permet de forcer l'échéance, de réinitialiser les données fictives et d'inspecter les traces. Une
vérification synthétique distante est ensuite exécutée sur staging puis sur production technique.

| Critère | Pile locale | Cloud (site déployé) |
|---|---|---|
| Justificatifs de mission | Création et régénération réelles sans SMTP ; journaux inspectables | Même contrat Edge, avec secret de chiffrement propre à la cible |
| Forcer une échéance | **Oui**, en SQL (§8) — la garde n'impose qu'un maximum de 24 mois, pas de minimum | Non : il faudrait attendre |
| Remise à zéro | **Oui**, une commande | Non : les traces d'export sont volontairement immuables |
| Risque | Aucun : données fictives, poste isolé | Écriture dans l'environnement en ligne |

**Nuance importante** : le flux **collaboration entre médecins** continue à générer un lien à
copier (cf. `qa-parcours-site.md` §6bis). Il est distinct du compte de mission et n'est pas modifié
par le présent lot.

---

## 4. Mise en route

Prérequis : Docker Desktop lancé, `npm install` fait. Vérifié le 2026-08-09 avec Docker 29.6.1 et
la CLI Supabase 2.109.1.

```bash
npm run supabase:start
```

```bash
npm run supabase:storage
```

Le récapitulatif de démarrage affiche les URL utiles : API (`:54321`), Studio (`:54323`) et
**Mailpit** (`:54324`). Les buckets Storage ne sont pas rejoués par `supabase db reset` : la
seconde commande comble ce trou.

Pour le frontend, **ne pas lancer `npm run dev` tel quel** — lire le §5.1 d'abord. La forme qui
vise réellement la pile locale :

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<clé publiable locale> npx vite --host 127.0.0.1
```

La clé publiable locale (`sb_publishable_…`) est affichée par `npm run supabase:start`. Ce sont
des valeurs partagées de développement local, pas des secrets.

Comptes de démonstration (mot de passe `Password123!`) : `alice@demo.test` (propriétaire),
`bob@demo.test` (2ᵉ médecin sans accès), `editor@demo.test`, `anna.analyst@demo.test`. Détail dans
`tester-en-local.md`. **Le seed ne contient aucun compte de mission** : ce compte se crée par
l'interface, c'est justement l'objet du test.

---

## 5. Obstacles rencontrés le 2026-08-09

Cinq obstacles ont empêché le test de démarrer. Aucun n'était visible depuis les tests
automatisés. Ils sont documentés ici parce qu'ils se represénteront à quiconque refera la
manipulation.

### 5.1 `.env.local` pointe sur la production — le plus sérieux

- **Symptôme** : connexion refusée (`Invalid login credentials`) avec les comptes de démonstration,
  alors que la base locale contenait bien ces comptes avec le bon mot de passe.
- **Cause** : le dépôt contient un fichier `.env.local` qui pointe sur le projet Supabase de
  production. Dans Vite, `.env.local` **écrase** `.env`. Le frontend lancé par `npm run dev`
  s'adressait donc au backend en ligne, et le mot de passe de démonstration y était évidemment
  invalide. Preuve : aucune requête vers `127.0.0.1:54321` n'apparaissait dans le panneau réseau.
- **Portée du problème** : elle dépasse largement le test. **Toute session de développement sur ce
  poste écrit potentiellement dans l'environnement en ligne** sans que rien ne le signale.
- **Décision prise** : *ne pas modifier `.env.local`* — c'est un fichier de l'utilisateur, dont
  l'intention (tester le backend déployé depuis le poste) est légitime. Contournement retenu :
  passer les variables en préfixe de commande, `process.env` l'emportant sur les fichiers `.env`
  dans Vite. Rien n'est écrit sur le disque, rien n'est cassé pour l'usage habituel.
- **Décisions envisagées, non tranchées** : (a) renommer `.env.local` en `.env.production.local`
  ou équivalent pour qu'il ne s'applique plus au mode développement ; (b) ajouter un bandeau
  visible dans l'interface quand l'origine Supabase n'est pas locale ; (c) laisser en l'état et
  s'appuyer sur la discipline. **À trancher par le porteur du besoin** — c'est un arbitrage
  d'usage, pas une correction technique.

### 5.2 Volume PostgreSQL 15 incompatible avec le serveur 17

- **Symptôme** : `supabase start` échoue, le conteneur de base boucle sur
  `database files are incompatible with server` puis est déclaré *unhealthy*.
- **Cause** : le volume Docker local avait été initialisé le 2026-06-26 par PostgreSQL 15, alors
  que `supabase/config.toml` cible désormais `major_version = 17`.
- **Piège de diagnostic** : la commande semblait réussir (code de sortie 0) parce qu'elle était
  branchée sur un `tail` — c'était le code du `tail`, pas celui de `supabase start`. **Ne pas
  brancher `supabase start` sur un pipe** si l'on veut connaître son issue.
- **Décision prise** : suppression des volumes du projet et redémarrage à neuf, après accord
  explicite. Les données perdues étaient des données fictives de démonstration, d'un schéma
  antérieur de six semaines à la migration des comptes de mission.

```bash
npm run supabase:stop -- --no-backup
```

> Cette commande **détruit** les volumes du projet `registre-clinique` (base + storage). Elle ne
> touche pas aux volumes des autres projets. À n'utiliser qu'en connaissance de cause.

### 5.3 Vite n'écoute que sur `localhost` (IPv6)

- **Symptôme** : `http://127.0.0.1:5173` injoignable alors que `http://localhost:5173` répond.
- **Cause** : sur ce poste, `localhost` se résout en `::1` et Vite ne s'attache qu'à cette adresse.
- **Pourquoi ce n'est pas cosmétique** : `site_url` vaut `http://127.0.0.1:5173` dans
  `supabase/config.toml`. **Tout lien de courriel** (activation d'un compte de mission,
  réinitialisation de mot de passe) redirige donc vers `127.0.0.1` — c'est-à-dire vers une page
  morte si Vite n'écoute pas en IPv4. Le flux à tester serait cassé pour une raison sans rapport
  avec le produit.
- **Décision prise** : lancer le serveur de développement avec `--host 127.0.0.1`.

### 5.4 Les Edge Functions ne démarrent pas sous la pile locale

- **Symptôme** : la création d'un compte de mission échoue ; les journaux du runtime Edge montrent
  `worker boot error: … Relative import path "@supabase/supabase-js" not prefixed with / or ./ or ../`.
- **Cause** : la carte d'imports des fonctions est le `deno.json` **de la racine du dépôt**. Le
  déploiement la passe explicitement (`--import-map deno.json`, cf. `edge-functions.md` et le
  workflow de release coordonnée) — **le cloud est donc correct** — mais le service local de
  `supabase start` ne la devine pas.
- **Décision prise** : déclarer `import_map = "../deno.json"` sur chacune des sept fonctions dans
  `supabase/config.toml` (le chemin est relatif au répertoire `supabase/`). **Modification
  additive, sans effet sur le déploiement**, qui continue de passer la carte en ligne de commande.
- **Alternative écartée** : créer un `supabase/functions/deno.json`. Un fichier de configuration
  Deno imbriqué aurait pris le pas sur celui de la racine pour les tâches `edge:check` et
  `edge:test`, qui reposent sur les imports figés et `deno.lock`.

### 5.5 Les identifiants du seed ne sont pas conformes RFC-4122

- **Symptôme** : l'Edge Function répond `400 — Base invalide` sur la base de démonstration.
- **Cause** : la validation d'identifiant (`UUID_RE`, `supabase/functions/_shared/contracts.ts`)
  exige un UUID **strictement** conforme — numéro de version 1-5 et variant 8/9/a/b. Or les
  identifiants décoratifs du seed, du type `20000000-0000-0000-0000-000000000001`, ne respectent
  ni l'un ni l'autre. Les bases réelles, créées par `gen_random_uuid()` (version 4), passent sans
  problème.
- **Conséquence pratique** : **aucun flux passant par une Edge Function n'est testable sur les
  données de démonstration.** Cela vaut pour les comptes de mission, mais aussi pour l'export,
  la lecture signée et l'inspection des téléversements.
- **Décision prise pour ce test** : créer une base neuve depuis l'interface, ce qui est de toute
  façon le geste d'un vrai utilisateur.
- **Décisions envisagées, non tranchées** : (a) corriger le seed pour qu'il utilise de vrais UUID
  v4 — le plus propre, mais tous les identifiants figés du seed et des tests qui s'y réfèrent
  changeraient ; (b) assouplir `UUID_RE` en une simple forme hexadécimale — réduit une validation
  défensive pour la commodité du jeu d'essai, à ne faire qu'en connaissance de cause ; (c) laisser
  en l'état et documenter le contournement — **c'est l'option en vigueur, portée par ce document**.

---

## 6. Résultats des parcours bout-en-bout

### 6.1 Preuve historique du circuit retiré — 2026-08-09

Parcours réellement exécuté le 2026-08-09 sur la pile locale, base neuve `QA-base-mission`,
compte de mission `thesard.qa@example.test`.

| Étape | Résultat observé |
|---|---|
| Création du compte de mission par le médecin | « Compte créé. La personne reçoit un courriel pour choisir son mot de passe. » ; mission listée avec échéance, et actions Prolonger / Renvoyer l'invitation / Révoquer |
| Courriel | Reçu dans Mailpit, lien d'activation fonctionnel |
| Rôle et permissions en base | `global_role = saisisseur` ; `base_access` avec échéance, `can_create_structured_data = true`, et `can_edit`, `can_export`, `can_manage_access`, `can_view_identity`, `can_view_raw_documents` **tous à `false`** |
| Arrivée de la personne invitée | Session ouverte, une seule base visible, étiquetée « Saisie » |
| Écran de la base côté saisisseur | Bandeau « Mission sur cette base jusqu'au 09/02/2027 » ; **un seul onglet** (Patients) — ni Statistiques, ni Journal, ni Accès, ni Cohortes, ni Comptes de mission |
| Choix de création de patient | Seule l'option « Entrer les données moi-même » est offerte ; le dépôt au pool de curation est correctement fermé au rôle |
| Saisie | Patient créé par le compte de mission, statut « Brouillon » |
| Cloisonnement de l'identité | Vérifié en base : la ligne d'identité ne contient **ni nom, ni date de naissance, ni téléphone, ni adresse** |

**Conclusion historique :** le cloisonnement tenait, mais le compte créé ne disposait pas d'un mot
de passe durable. Ce circuit par e-mail n'est plus dans le produit.

### 6.2 Circuit courant — 2026-08-11

Parcours réellement exécuté sur la pile locale, avec une base et des justificatifs entièrement
fictifs :

| Étape | Résultat observé |
|---|---|
| Création par le propriétaire | Compte créé depuis `/missions` avec un identifiant personnalisé et sans e-mail ; lien vers la base et échéance visibles |
| Conservation | Mot de passe masqué par défaut, révélable à nouveau par le propriétaire ; seules une enveloppe AES-256-GCM et son nonce existent dans la table applicative |
| Première connexion | Connexion par « Identifiant » réussie ; une seule base visible pour le `saisisseur` |
| Régénération avec session ouverte | Session antérieure incapable de relire le profil ou les données après rechargement ; ancien mot de passe refusé ; nouveau accepté |
| Régénération depuis l'interface | Confirmation native affichée ; identifiant inchangé ; nouveau secret fonctionnel et ancien refusé |
| Traces | Aucun des mots de passe fictifs retrouvé dans les journaux Edge, Vite ou navigateur ; audit création/révélation/régénération sans champ secret |

Le même parcours, rejoué par `scripts/verify-mission-account.mjs` contre la vraie Edge Function
locale et deux sessions Auth distinctes, a passé **29/29 vérifications**. Le script ne journalise
ni l'identifiant public généré pour le test, ni aucun mot de passe.

Le 2026-08-11, ce vérificateur a également passé **29/29** sur le staging déployé par le run
`31475841694`, pour le SHA `bb99ac72ba46541904d255f7bf129ecd2ad3ca4e`. La production technique
a ensuite été promue par le run `31476792936` avec cette preuve staging exacte.

---

## 7. Écarts constatés sur le produit

Ce sont les découvertes que seul le test manuel pouvait produire.

### 7.1 Ancien compte sans mot de passe durable — **résolu par remplacement**

Le lien du courriel ouvre une **session valide directement sur le tableau de bord**. L'écran de
définition du mot de passe (`/reset-password`) n'est jamais atteint.

Cause : `supabase/functions/create-mission-account/index.ts` lit
`MISSION_PASSWORD_REDIRECT_URL` et, si la variable est absente, appelle `resetPasswordForEmail`
**sans** `redirectTo` ; GoTrue retombe alors sur `site_url`, c'est-à-dire l'accueil. La variable
n'est documentée nulle part dans `edge-functions.md`.

Conséquence : l'étudiant travaille pendant la durée de vie de sa session, puis **se retrouve
bloqué** sans mot de passe, avec pour seul recours « Mot de passe oublié ».

Point à trancher au-delà de la documentation : **un repli silencieux qui produit un compte
inutilisable devrait-il rester silencieux ?** L'absence de la variable pourrait légitimement être
une erreur explicite au démarrage de la fonction.

> **Chantier A** de [chantiers-interactions-comptes.md](chantiers-interactions-comptes.md) §2 —
> le 2026-08-11, ce contrat a été supprimé au profit des justificatifs gérés par le propriétaire.

### 7.2 Écarts d'interface du rôle `saisisseur`

L'interface propose au compte de mission des actions que son rôle ne peut pas exécuter, et lui
cache celle dont il a besoin. **Aucun n'est une faille** — la base refuse dans tous les cas — mais
le premier rend le rôle inutilisable depuis l'interface :

1. **Pas de bouton « Nouveau patient »** sur la liste des patients, alors que l'état vide affiche
   « Aucun patient. Cliquez sur "Nouveau patient". ». La route fonctionne pourtant si on l'ouvre
   directement. **La création est la raison d'être du rôle** : depuis l'interface, le compte est
   dans une impasse.
2. **Section « Identité (zone restreinte) »** (nom complet, date de naissance, téléphone, adresse)
   présentée dans le formulaire de création, alors que `spec-comptes-mission.md` §4 interdit
   définitivement l'écriture d'identité à ce rôle.
3. **Bouton « Supprimer ce patient »** offert, contre §4.
4. **Bouton « Rendre disponible hors-ligne »** offert, alors que §4 exclut le mode hors-ligne du
   rôle en v1.
5. **Barre latérale** : « Groupes de recherche » et « Mes jeux de variables » restent proposés
   (zones réservées au médecin).
6. **En-tête de base** : « Modèle : — » au lieu du nom du gabarit, alors que §4 accorde au rôle la
   lecture du gabarit de sa base.

> **Chantier B** de [chantiers-interactions-comptes.md](chantiers-interactions-comptes.md) §3 —
> les six points y sont tranchés un par un. Deux issues méritent d'être connues d'ici : le point 2
> a été **renversé** (le rôle doit au contraire pouvoir écrire l'identité — chantier C, §4) et le
> point 6 a été **clos sans action** (le nom du gabarit restera « — », y compris pour un médecin
> collaborateur non-propriétaire).

### 7.3 Message d'erreur non exploitable

Lorsque l'Edge Function refuse une demande, l'interface affiche
`Edge Function returned a non-2xx status code` — le message de transport de la bibliothèque
cliente — au lieu du message court et générique renvoyé par la fonction (`Base invalide`,
`Authentification requise`…). `src/data/mission.ts` tente pourtant de lire ce message et retombe
sur le message de transport ; la cause exacte du repli reste à confirmer.

Conséquence pour le test : **un refus légitime est indiscernable d'une panne**. Le diagnostic du
§5.5 a exigé de rejouer l'appel hors interface pour lire la vraie réponse.

> **Chantier D** de [chantiers-interactions-comptes.md](chantiers-interactions-comptes.md) §5 —
> la cause est confirmée sur le chemin export (`error.context` non lu) ; le défaut est transverse à
> tous les appelants d'Edge Functions et doit se corriger une seule fois.

### 7.4 Courriel d'invitation générique — **sans objet pour les missions**

En local, la personne invitée reçoit un message intitulé « Reset your password », expédié par
« Admin <admin@email.com> ». Pour quelqu'un qui n'a jamais utilisé le produit et à qui l'on
demande de rejoindre un registre clinique, c'est déroutant — et le vocabulaire (« réinitialiser »)
ne correspond pas à la situation (« activer »). Les modèles de courriel se personnalisent côté
Supabase ; **il reste à vérifier ce que reçoit réellement une personne invitée sur le projet en
ligne. Ce constat reste une preuve du circuit historique ; aucun courriel n'est désormais envoyé
pour un compte de mission.

---

## 8. Feuille de route de test — interactions entre comptes

Cette feuille de route est le point de départ d'une nouvelle campagne manuelle. Elle se joue avec
des données **fictives uniquement**. Noter pour chaque étape `OK`, `KO` ou `BLOQUÉ`, l'observation,
la version/commit testé et, en cas de défaut, le compte concerné et les étapes exactes de
reproduction. Ne jamais copier d'identité réelle dans un rapport ni une capture.

> **Ne pas mélanger les flux.** Les invitations par lien du §Phase 1 concernent la collaboration
> entre médecins. Les comptes de mission des phases 2 et 4 n'utilisent jamais de courriel.

### Phase 0 — préparation sûre

1. Utiliser la pile locale (§3 et §4) : Docker, `npm run supabase:start`, puis
   `npm run supabase:storage`.
2. Lancer le frontend avec les variables locales et `--host 127.0.0.1` (§4) ; ne pas utiliser
   `npm run dev` seul, car `.env.local` cible la production sur ce poste (§5.1).
3. Préparer deux sessions réellement distinctes : navigateur normal pour le médecin propriétaire,
   navigation privée ou second profil pour le compte de mission. Mailpit n'intervient pas.
4. Créer une base neuve `QA-*` depuis l'interface ; ne pas utiliser les identifiants décoratifs du
   seed pour les appels Edge (§5.5). Noter la date, la version et les comptes fictifs employés.

### Phase 1 — collaboration entre médecins (C1 à C8)

Suivre intégralement [`qa-parcours-site.md` §6bis](qa-parcours-site.md) : invitation par lien,
acceptation par le bon compte, profil appliqué, ouverture contrôlée de l'identité, conflit de
version, lien à usage unique, mauvais compte et révocation.

**Critères essentiels :** le second médecin ne voit jamais l'identité avant l'autorisation ; sa
seconde sauvegarde concurrente est refusée sans écraser la première ; après révocation, la base et
son URL directe deviennent inaccessibles. Cette phase est testable localement ou sur le site
déployé, car elle n'envoie pas de courriel.

### Phase 2 — compte de mission : parcours de base

1. Propriétaire : depuis `/missions`, créer un compte sur la base `QA-*`, choisir un libellé et un
   identifiant fictifs, sans option identité.
2. Relever le mot de passe généré, vérifier qu'il se masque, puis le révéler à nouveau et le copier.
   Aucun e-mail ni Mailpit n'intervient.
3. Saisisseur : dans un second profil, se connecter avec ces éléments ; vérifier une seule base
   visible, le bandeau d'échéance, les zones médecin absentes,
   puis créer un patient et une rencontre en brouillon.
4. Vérifier les refus attendus : autre base, export, gestion des accès, documents bruts, hors-ligne,
   identité non autorisée, suppression et fiche d'autrui.
5. Saisisseur : corriger son propre brouillon, puis le soumettre ; vérifier qu'il ne peut plus le
   modifier après soumission.

**Critère :** aucune invitation ou réinitialisation par e-mail n'est proposée. La régénération
confirmée par le propriétaire rend l'ancien mot de passe inutilisable et invalide les sessions
associées ; l'identifiant reste identique et le nouveau mot de passe fonctionne dans un profil neuf.

### Phase 3 — identité restreinte après L16

Créer une seconde mission avec l'option identité et sa justification. Tester les cinq champs : nom
complet, date de naissance, téléphone, adresse et identifiant externe.

1. Le saisisseur crée un patient avec cette identité, puis corrige chacun de ces champs sur son
   propre brouillon.
2. Il tente la même correction après soumission, après expiration, après révocation et sur un
   patient d'autrui : chaque tentative doit être refusée, sans modification partielle.
3. Le médecin corrige ensuite cette même identité : la correction doit réussir et rester visible.
4. Créer volontairement un rapprochement nom/date avec un autre patient fictif : le mécanisme
   anti-doublon doit avertir avant l'enregistrement.

### Phase 4 — cycle de vie de la mission dans deux sessions

1. Depuis le propriétaire, tester **Prolonger**, **Révéler** puis **Régénérer** ; vérifier côté
   saisisseur l'effet réel, pas seulement le message côté propriétaire. Conserver la session du
   saisisseur ouverte pendant la régénération.
2. Forcer l'échéance sur la pile locale, puis recharger la session du saisisseur :

   ```sql
   update base_access set expires_at = now() - interval '1 minute' where user_id = '<id du compte de mission>';
   ```

3. Refaire avec **Révoquer** depuis la session médecin tandis que le saisisseur est encore ouvert :
   le prochain chargement ou enregistrement doit être refusé et ne rien écrire.

### Phase 5 — qualité des refus et clôture

Après L17, provoquer au moins un refus par parcours (base invalide, droit absent, cohorte non
exportable) : l'interface doit afficher le message court choisi par le serveur, jamais
`Edge Function returned a non-2xx status code`, `[object Object]`, une erreur SQL ou un secret.

Conclure avec le format de rapport de [`qa-parcours-site.md` §8](qa-parcours-site.md) : synthèse,
résultats, anomalies reproductibles, captures fictives et ressenti utilisateur. Enfin, supprimer ou
réinitialiser les données `QA-*` locales (§10) ; ne jamais réemployer ces comptes pour un test en
ligne.

---

## 9. Modifications apportées au dépôt

| Fichier | Nature |
|---|---|
| `supabase/config.toml` | Ajout de `import_map = "../deno.json"` sur les sept Edge Functions (§5.4). Additif, sans effet sur le déploiement. |
| `.claude/launch.json` | Nouveau. Configuration du serveur de développement pour l'outillage local, avec le bind IPv4 du §5.3. |

Aucune migration, aucun code applicatif, aucune donnée en ligne n'a été touché.

---

## 10. Données de test créées (pile locale uniquement)

Base `QA-base-mission`, compte `thesard.qa@example.test`, patient `QA-M-001`. Tout cela vit dans
la pile locale et disparaît à la remise à zéro :

```bash
npm run supabase:reset
```

> À refaire suivre de `npm run supabase:storage` : le reset ne rejoue que les migrations et le seed.

---

## 11. Références

- `chantiers-interactions-comptes.md` — **suite de ce document** : les écarts du §7 y deviennent des
  chantiers, avec les options envisagées, celles écartées, les décisions prises et l'état réel du
  dépôt
- `spec-comptes-mission.md` — spécification du rôle `saisisseur` (§4 droits, §8 interface, §12 décisions du demandeur)
- `qa-parcours-site.md` §6bis — procédure de test de la collaboration entre médecins (C1-C8)
- `tester-en-local.md` — mise en route de la pile locale et comptes de démonstration
- `edge-functions.md` — déploiement des Edge Functions et variables d'environnement
- `e2e-browser.md` — couverture navigateur automatisée, et ce qu'elle ne couvre pas
