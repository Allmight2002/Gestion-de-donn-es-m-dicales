# Tester les flux entre comptes — comptes de mission et collaboration

> **Objet** : comment vérifier à la main ce qu'aucun test automatisé ne traverse — la chaîne
> complète Auth + Edge Function + courriel + deux sessions utilisateur vivantes.
> **Origine** : session de travail du **2026-08-09**, sur demande du porteur du besoin.
> **Portée** : ce document couvre le *comment tester*, les obstacles rencontrés et les décisions
> prises. Il ne remplace ni `spec-comptes-mission.md` (la spécification du rôle), ni
> `qa-parcours-site.md` (le plan de test du site déployé).

---

## 1. Le besoin exprimé

Les fonctionnalités du produit sont largement implémentées, mais **celles qui font intervenir
plusieurs comptes n'avaient jamais été essayées par un utilisateur** :

- les **comptes de mission** (rôle `saisisseur`) : un médecin confie la saisie d'une base à un
  étudiant pour une durée limitée, l'étudiant reçoit un courriel, active son compte, saisit, et
  son accès s'éteint à l'échéance ;
- la **collaboration entre médecins** : invitation, acceptation, permissions accordées puis
  retirées, édition simultanée.

La question posée était : *comment faire pour les tester ?*

Le besoin réel derrière la question n'est pas de re-tester les règles de sécurité — elles sont
déjà verrouillées (§2) — mais de vérifier que **les couches tiennent ensemble** : un compte créé
par une Edge Function, un courriel réellement expédié, un lien qui atterrit sur le bon écran, une
seconde personne qui se connecte et voit ce qu'elle doit voir. C'est précisément la zone qu'aucun
test unitaire, RLS ou Deno ne peut couvrir.

---

## 2. Ce qui est déjà prouvé automatiquement

À ne pas refaire à la main. Ces suites tournent sans Docker (PostgreSQL embarqué) :

| Fichier | Nombre de tests | Ce qu'il verrouille |
|---|---|---|
| `test/mission-accounts.test.ts` | 51 | Rôle posé par `app_metadata` seul ; saisie → brouillon → soumission → immuabilité ; identité refusée par défaut et option justifiée ; cloisonnement à une seule base ; échéance et révocation appliquées par la base ; prolongation ; révocation sur déclassement de rôle |
| `test/access.test.ts` | 8 | Invitations réservées au propriétaire ; invitation révoquée inacceptable ; anti-escalade d'un délégué `can_manage_access` |
| `supabase/functions/create-mission-account/handler_test.ts` | 22 | Appelant non autorisé ; adresse déjà prise ; bornes de durée ; rejeu idempotent ; réconciliation du rôle avant provisionnement |

```bash
npm run test:rls
```

**Ce que ces tests ne peuvent pas prouver**, et qui justifie le test manuel :

- la création réelle du compte Auth par l'Edge Function sur un vrai GoTrue ;
- le départ effectif du courriel et la validité du lien qu'il contient ;
- l'écran d'arrivée de la personne invitée ;
- ce que l'interface **propose** à un rôle (un bouton offert à tort n'est pas un défaut de
  sécurité — la base refuse — mais c'est un défaut d'usage, et c'est exactement ce qui a été
  trouvé, cf. §7.2) ;
- deux sessions simultanées (conflit de version, révocation vue par l'autre).

---

## 3. Décision : tester sur la pile locale, pas sur le cloud

**Décision du 2026-08-09 : la cible du test manuel multi-comptes est la pile Supabase locale
(Docker).** Le site en ligne n'est pas la bonne cible pour ce flux précis.

| Critère | Pile locale | Cloud (site déployé) |
|---|---|---|
| Courriel d'invitation | **Capté par Mailpit** (`http://127.0.0.1:54324`) | SMTP par défaut Supabase fortement bridé et souvent limité aux adresses de l'équipe du projet : le courriel risque de ne jamais arriver, et on conclurait à tort à un défaut applicatif |
| Forcer une échéance | **Oui**, en SQL (§8) — la garde n'impose qu'un maximum de 24 mois, pas de minimum | Non : il faudrait attendre |
| Remise à zéro | **Oui**, une commande | Non : les traces d'export sont volontairement immuables |
| Risque | Aucun : données fictives, poste isolé | Écriture dans l'environnement en ligne |

**Nuance importante** : le flux **collaboration entre médecins** n'envoie *pas* de courriel — il
génère un lien à copier (cf. `qa-parcours-site.md` §6bis). Ce flux-là est donc testable en ligne
sans difficulté. C'est le flux **compte de mission** qui exige le local.

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

## 6. Résultat du parcours bout-en-bout

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

**Conclusion : la chaîne fonctionne.** Le mécanisme de cloisonnement tient en conditions réelles,
comme les tests le laissaient attendre.

---

## 7. Écarts constatés sur le produit

Ce sont les découvertes que seul le test manuel pouvait produire.

### 7.1 La personne invitée ne définit jamais son mot de passe — fonctionnel, sérieux

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
> cause vérifiée, travail à faire et point encore à trancher. Rien n'est implémenté à ce jour.

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

### 7.4 Courriel d'invitation générique

En local, la personne invitée reçoit un message intitulé « Reset your password », expédié par
« Admin <admin@email.com> ». Pour quelqu'un qui n'a jamais utilisé le produit et à qui l'on
demande de rejoindre un registre clinique, c'est déroutant — et le vocabulaire (« réinitialiser »)
ne correspond pas à la situation (« activer »). Les modèles de courriel se personnalisent côté
Supabase ; **il reste à vérifier ce que reçoit réellement une personne invitée sur le projet en
ligne.**

---

## 8. Feuille de route de test — interactions entre comptes

Cette feuille de route est le point de départ d'une nouvelle campagne manuelle. Elle se joue avec
des données **fictives uniquement**. Noter pour chaque étape `OK`, `KO` ou `BLOQUÉ`, l'observation,
la version/commit testé et, en cas de défaut, le compte concerné et les étapes exactes de
reproduction. Ne jamais copier d'identité réelle dans un rapport ni une capture.

> **Ne pas mélanger les états.** Tant que L15, L16 et L17 ne sont pas livrés, leurs scénarios sont
> des vérifications de régression à préparer, pas des critères de succès du produit actuel. Les
> signaler « à rejouer après le lot », plutôt que de conclure à une panne nouvelle.

### Phase 0 — préparation sûre

1. Utiliser la pile locale (§3 et §4) : Docker, `npm run supabase:start`, puis
   `npm run supabase:storage`.
2. Lancer le frontend avec les variables locales et `--host 127.0.0.1` (§4) ; ne pas utiliser
   `npm run dev` seul, car `.env.local` cible la production sur ce poste (§5.1).
3. Préparer deux sessions réellement distinctes : navigateur normal pour le médecin propriétaire,
   navigation privée ou second profil pour le deuxième compte. Garder Mailpit ouvert seulement pour
   les scénarios historiques par courriel, pas pour le mode L15.
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

1. Médecin : créer un compte de mission sur la base `QA-*`, sans option identité.
2. Après L15 : relever une seule fois l'identifiant et le mot de passe générés, sans e-mail ni
   Mailpit, puis les remettre au saisisseur fictif.
3. Saisisseur : dans un second profil, se connecter avec ces éléments ; vérifier une seule base
   visible, le bandeau d'échéance, les zones médecin absentes,
   puis créer un patient et une rencontre en brouillon.
4. Vérifier les refus attendus : autre base, export, gestion des accès, documents bruts, hors-ligne,
   identité non autorisée, suppression et fiche d'autrui.
5. Saisisseur : corriger son propre brouillon, puis le soumettre ; vérifier qu'il ne peut plus le
   modifier après soumission.

**Après L15 :** aucune invitation ou réinitialisation par e-mail n'est requise. La régénération
confirmée par le médecin rend l'ancien mot de passe inutilisable et invalide les sessions associées;
le nouvel identifiant et mot de passe permettent une connexion dans un profil neuf.

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

1. Depuis le médecin, tester **Prolonger** puis **Renvoyer l'invitation** ; vérifier côté
   saisisseur l'effet utile, pas seulement le toast côté médecin.
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
