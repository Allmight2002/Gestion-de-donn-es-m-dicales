# Déploiement on-premise — installation dans une institution (réseau local + WiFi)

> 🟢 **Document vivant.** Décrit comment installer **l'ensemble du projet** sur un serveur
> situé dans l'institution, accessible aux utilisateurs qui se connectent au **WiFi local**.
> Écrit pour un lecteur qui n'est **pas** ingénieur réseau : chaque notion est expliquée au
> fil de l'eau, et chaque étape se termine par une vérification.
>
> **Rappel non négociable : données entièrement fictives uniquement** tant que le cadre
> juridique et éthique n'est pas validé (`docs/juridique/`). Cette procédure ne change rien
> à cette règle.

---

## 1. Ce que cette procédure installe

```
                       ┌────────────────────────────────────────────────┐
                       │            SERVEUR DE L'INSTITUTION            │
                       │        (une machine, dans un local fermé)      │
                       │                                                │
                       │  ┌──────────────────────────────────────────┐  │
                       │  │  Docker : la « stack » Supabase           │  │
                       │  │  (PostgreSQL + Auth + Storage +           │  │
                       │  │   Edge Functions)                         │  │
                       │  └──────────────────────────────────────────┘  │
                       │  ┌──────────────────────────────────────────┐  │
                       │  │  nginx : sert le site web (le frontend)  │  │
                       │  └──────────────────────────────────────────┘  │
                       │  ┌──────────────────────────────────────────┐  │
                       │  │  ClamAV : scanner antivirus des fichiers │  │
                       │  └──────────────────────────────────────────┘  │
                       └────────────────────────────────────────────────┘
                                      ▲
                                      │ réseau local (câble ou WiFi)
                       ┌───────────────┴────────────────┐
                       │  Routeur / point d'accès WiFi   │
                       └───────────────┬────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              Poste 1 (WiFi)     Poste 2 (WiFi)     Poste 3 (câble)
              navigateur         navigateur         navigateur
```

**En clair :** les utilisateurs ouvrent un navigateur (Chrome, Firefox, Edge…) sur leur
poste connecté au WiFi de l'institution, tapent une adresse comme `http://registre.local`,
et l'application s'affiche. Les données restent **sur le serveur de l'institution** — elles
ne sortent jamais du réseau local.

**Petit glossaire pour la suite :**

| Mot | Ce que c'est |
|---|---|
| **Serveur** | La machine (tour ou mini-PC) qui va héberger tout le logiciel. Elle reste allumée en permanence. |
| **Docker** | Un logiciel qui fait tourner des « conteneurs » : des petits paquets autonomes contenant chacun un service (la base de données, l'authentification…). C'est la façon standard d'installer Supabase. |
| **Stack Supabase** | L'ensemble des conteneurs qui reconstituent le service Supabase (le même que celui utilisé dans le cloud, mais chez vous). |
| **nginx** | Un petit logiciel qui sert les pages web du site à tous les navigateurs qui le demandent. |
| **IP fixe** | L'adresse permanente du serveur sur le réseau (ex. `192.168.1.50`), qui ne change pas. Sans elle, le serveur serait introuvable après un redémarrage. |
| **CLI Supabase** | Un outil en ligne de commande (déjà dans le projet) utilisé pour appliquer le schéma de base de données. |

---

## 2. Prérequis

### 2.1 Matériel

| Élément | Recommandation | Pourquoi |
|---|---|---|
| **Serveur** | Un PC récent : processeur 4 cœurs ou plus, **8 Go de RAM minimum (16 Go conseillés)**, SSD 100 Go minimum | La stack Supabase fait tourner ~10 conteneurs (base de données, API, etc.). |
| **Système d'exploitation** | **Ubuntu Server 24.04 LTS** (gratuit, bien documenté) | Linux est la cible standard de Docker et de toute la procédure. |
| **Alimentation** | Onduleur (UPS) branché sur le serveur | Une coupure de courant au mauvais moment peut corrompre la base. |
| **Routeur / point d'accès WiFi** | Celui de l'institution, qui doit couvrir les postes | Aucune configuration spéciale : le serveur est juste une machine du réseau. |
| **Postes utilisateurs** | PC ou portables avec un navigateur à jour | Aucune installation sur les postes : tout se passe dans le navigateur. |

### 2.2 Réseau : préparer l'IP fixe (à faire avec la personne qui gère le réseau)

1. Repérez l'**adresse IP actuelle** du serveur (avant installation) : sur le poste qui
   servira de serveur, commande `ip a` sous Linux ou `ipconfig` sous Windows.
2. Dans l'interface d'administration du routeur, réservez cette adresse pour le serveur
   (fonction « DHCP reservation » ou « Adresse IP statique »), en repérant son adresse MAC.
   → Le but : le serveur garde **toujours la même adresse**, même après redémarrage.
3. Donnez au serveur un **nom simple**, par exemple `registre` (dans le routeur, champ
   « Hostname »). Notez la combinaison : `registre` + adresse IP.
4. Vérifiez que les **postes du WiFi** et le serveur sont bien dans **le même réseau**
   (même plage d'adresses, ex. tout en `192.168.1.x`).

> ⚠️ **À ne pas faire :** n'exposez **jamais** ce serveur à Internet (pas de « port
> forwarding », pas de DMZ). Ce déploiement est conçu pour rester **dans le réseau local**.

### 2.3 Logiciels à télécharger à l'avance (sur le serveur ou un poste)

- **Ubuntu Server 24.04 LTS** — image ISO officielle : `https://ubuntu.com/download/server`
- **Node.js 22 LTS** (≥ 22.22) et **npm** (≥ 10) — installés via le gestionnaire de paquets
  d'Ubuntu (voir §4).
- **Git** — gestionnaire de versions (pour récupérer le code du projet).
- **Docker Engine + Docker Compose** — le moteur des conteneurs (voir §4).
- Le **code du projet** MedData (dépôt Git) — c'est le dossier qui contient `src/`,
  `supabase/`, `scripts/`, `services/`.

---

## 3. Plan d'ensemble — les 9 étapes

| Étape | Contenu | Durée indicative |
|---|---|---|
| 4 | Installer Ubuntu, Docker, Node, Git sur le serveur | 1–2 h |
| 5 | Installer et démarrer la stack Supabase self-hosted | 1 h (téléchargements) |
| 6 | Appliquer le schéma MedData (migrations + storage) | 30 min |
| 7 | Déployer les Edge Functions + scanner ClamAV | 1 h |
| 8 | Créer les comptes utilisateurs | 30 min |
| 9 | Construire et servir le frontend (nginx) | 1 h |
| 10 | Vérifier le bon fonctionnement de bout en bout | 1 h |
| 11 | Former les utilisateurs et ouvrir l'accès WiFi | 30 min |

---

## 4. Étape 1 — Installer le serveur

### 4.1 Ubuntu

1. Installez Ubuntu Server sur le serveur (suivez l'assistant : langue, clavier,
   utilisateur **administrateur** avec mot de passe fort, partitionnement automatique).
2. Au premier démarrage, mettez à jour le système :
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

### 4.2 Docker

```bash
# Installation officielle (script officiel Docker) :
curl -fsSL https://get.docker.com | sudo sh
# Autoriser votre utilisateur à piloter Docker sans "sudo" à chaque fois :
sudo usermod -aG docker $USER
# Redémarrer la session (ou se déconnecter / se reconnecter), puis vérifier :
docker --version
docker compose version
```
✅ **Vérification :** les deux commandes affichent une version sans erreur.

### 4.3 Node.js 22, npm et Git

```bash
sudo apt install -y git
# Node 22 via le dépôt officiel NodeSource :
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # doit afficher v22.x.x (≥ 22.22)
npm --version    # doit afficher 10.x ou 11.x
```
✅ **Vérification :** les deux numéros de version correspondent aux exigences du projet
(`package.json`, champ `engines`).

### 4.4 Récupérer le code du projet

Sur le serveur, placez le projet dans un dossier dédié, par exemple `/opt/meddata` :

```bash
sudo mkdir -p /opt/meddata
sudo chown $USER:$USER /opt/meddata
git clone <adresse-du-depot> /opt/meddata
cd /opt/meddata
npm ci          # installe exactement les dépendances déclarées
```
✅ **Vérification :** `npm run typecheck` se termine sans erreur.

---

## 5. Étape 2 — Installer la stack Supabase self-hosted

> La stack officielle « self-hosted » est fournie par Supabase dans un dépôt dédié :
> `https://github.com/supabase/docker`. La procédure officielle de référence :
> `https://supabase.com/docs/guides/self-hosting/docker`. Si une étape diffère entre ce
> document et la doc officielle, **suivez la doc officielle** (les versions évoluent).

### 5.1 Récupérer la stack

```bash
cd /opt
git clone --depth 1 https://github.com/supabase/docker supabase-docker
cd supabase-docker
cp .env.example .env
```

### 5.2 Renseigner le fichier `.env` (c'est le cœur de la configuration)

Ouvrez `.env` avec un éditeur (ex. `nano .env`) et renseignez **au minimum** :

| Variable | Valeur à mettre | Explication |
|---|---|---|
| `POSTGRES_PASSWORD` | Mot de passe long et aléatoire | Mot de passe de la base de données. **À garder précieusement** (nécessaire pour les sauvegardes). |
| `JWT_SECRET` | Chaîne aléatoire de 64 caractères | Clé qui signe les sessions des utilisateurs. Génération : `openssl rand -base64 48` |
| `ANON_KEY` | Chaîne aléatoire (JWT signé avec `JWT_SECRET`) | Clé **publique** que le navigateur utilise (ce n'est pas un secret). |
| `SERVICE_ROLE_KEY` | Chaîne aléatoire (JWT signé avec `JWT_SECRET`) | Clé **secrète serveur** : ne doit **jamais** apparaître dans le frontend ni les navigateurs. |
| `SITE_URL` | `http://registre` (ou l'IP fixe, ex. `http://192.168.1.50`) | L'adresse du site telle que les utilisateurs la voient. |
| `SMTP_*` | Paramètres du serveur mail de l'institution | Nécessaire pour la **confirmation de compte** et la **réinitialisation de mot de passe** (voir §5.3). |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Identifiants de l'outil d'administration (Studio) | À donner **uniquement** aux administrateurs. |

> Les clés `ANON_KEY` / `SERVICE_ROLE_KEY` doivent être des **JWT signés** avec le même
> `JWT_SECRET` (la stack fournit un petit script pour les générer, voir son README). Pour
> une installation simple, les valeurs générées par le script de la stack conviennent.

### 5.3 SMTP — pourquoi c'est indispensable

Sans serveur mail (SMTP), deux fonctions sont cassées : la **confirmation de compte** et la
**réinitialisation de mot de passe**. Deux options :
- Le **serveur mail de l'institution** (le plus propre) : demandez à la personne qui gère
  l'informatique les paramètres SMTP (adresse, port, utilisateur, mot de passe, expéditeur).
- À défaut, une **boîte mail dédiée** (Gmail/Outlook avec mot de passe d'application).

Renseignez les variables `SMTP_*` du `.env` en conséquence.

### 5.4 Démarrer la stack

```bash
cd /opt/supabase-docker
docker compose up -d
# La première fois, téléchargement des images : patientez (plusieurs minutes).
docker compose ps    # vérifie l'état des conteneurs
```
✅ **Vérification :** tous les services sont `running` ou `healthy`, aucun `exited`.
Répétez `docker compose ps` après 2–3 minutes si certains démarrent lentement.

**Ports ouverts sur le serveur** (par défaut de la stack) :

| Port | Service | Utilité |
|---|---|---|
| `8000` | API Supabase (Kong) | C'est **l'adresse que le frontend utilisera** comme `VITE_SUPABASE_URL`. |
| `5432` | PostgreSQL | Connexions des scripts d'administration/sauvegarde. |
| `3000` | Studio (administration web) | Interface pour inspecter la base (réservée aux admins). |

> Si vous avez déjà un service sur l'un de ces ports, changez-le dans le `.env` de la stack
> (variables `*_PORT`), puis `docker compose up -d` à nouveau.

---

## 6. Étape 3 — Appliquer le schéma MedData

Le projet contient **toutes les migrations SQL** (le « plan de construction » de la base),
plus `supabase/storage.sql` (les espaces de stockage des fichiers). On les applique au
PostgreSQL de la stack.

### 6.1 Appliquer les migrations

Depuis `/opt/meddata` (le projet), avec la CLI Supabase du projet :

```bash
cd /opt/meddata
# Chaîne de connexion au Postgres de la stack (adapter le mot de passe) :
export SUPABASE_DB_URL="postgresql://postgres:LE_MOT_DE_PASSE@127.0.0.1:5432/postgres"
npx supabase db push --db-url "$SUPABASE_DB_URL"
```
✅ **Vérification :** la commande liste les migrations appliquées sans erreur. En cas de
doute, `npm run db:verify` rejoue toutes les migrations sur un PostgreSQL jetable — il
prouve que le schéma se construit proprement depuis zéro.

### 6.2 Appliquer le stockage (buckets + politiques)

```bash
npm run supabase:storage
```
✅ **Vérification :** le message `✓ storage.sql applique et verifie (4 buckets, ...)`
apparaît. Les 4 espaces de stockage (`raw-documents`, `clinical-attachments`,
`scientific-exports`, `quarantined-uploads`) sont alors créés.

### 6.3 Ne PAS charger le seed de démonstration

Le fichier `supabase/seed.sql` crée des **comptes et patients fictifs de démonstration**.
Dans une institution, on crée de **vrais comptes** (étape 8) — le seed n'est pas exécuté.

---

## 7. Étape 4 — Edge Functions + scanner ClamAV

Les Edge Functions sont les « programmes serveur » du projet (lecture de fichiers
journalisée, génération d'exports, comptes de mission…). Dans la stack self-hosted, elles
sont servies en **montant le dossier `supabase/functions` du projet** dans le conteneur
`edge-runtime` de la stack (voir le README de la stack pour le chemin exact du volume et la
carte d'imports `deno.json` du dépôt — le nom des variables varie selon les versions).

Elles ont besoin de variables d'environnement **secrètes** (à poser dans la configuration
du conteneur `edge-runtime` de la stack, jamais dans le frontend) :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | `http://registre:8000` (l'API de la stack) |
| `SUPABASE_ANON_KEY` | La clé `ANON_KEY` du §5.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | La clé `SERVICE_ROLE_KEY` du §5.2 (**secret**) |
| `REQUIRE_SERVER_INSPECTION` | `false` tant que le mode inspection est en pause (défaut actuel) |

Et si l'inspection antivirus stricte est activée un jour (`INSPECTION_MODE=strict`, voir
`docs/deploiement.md` §6) : `CLAMAV_SCAN_URL`, `CLAMAV_SCAN_TOKEN`,
`CLAMAV_SCAN_TIMEOUT_MS`, `MAX_INSPECT_UPLOAD_BYTES`, `INSPECTION_SCANNING_STALE_MS`,
`MAX_INSPECTION_ATTEMPTS`, `INSPECTION_RETRY_COOLDOWN_MS`, `QUARANTINE_BUCKET`.

### 7.1 Scanner ClamAV (recommandé, même en pause de politique)

Le scanner fourni dans le dépôt se lance avec la commande prévue :

```bash
cd /opt/meddata
CLAMAV_SCAN_TOKEN="un-secret-long-d-au-moins-32-caracteres" \
  docker compose -f docker-compose.clamav.yml up -d --build
docker compose -f docker-compose.clamav.yml ps
```
✅ **Vérification :** les deux conteneurs (`clamav` et `clamav-scanner`) sont `running` et
`healthy`. Le scanner écoute sur `127.0.0.1:8088` — il n'est joignable que depuis le
serveur, ce qui est voulu.

---

## 8. Étape 5 — Créer les comptes utilisateurs

Depuis `/opt/meddata`, créez chaque compte avec le script du projet (il utilise la clé
`service_role` **côté serveur** — c'est le seul moyen sûr de créer des comptes sans seed) :

```bash
cd /opt/meddata
export SUPABASE_URL="http://registre:8000"
export SUPABASE_SERVICE_ROLE_KEY="LA_CLE_SERVICE_ROLE"
npm run create-account -- medecin@institution.org "UnMotDePasseFort!" medecin "Dr Exemple"
npm run create-account -- admin@institution.org "UnMotDePasseFort!" system_admin "Admin Système"
npm run create-account -- curateur@institution.org "UnMotDePasseFort!" curateur "Curateur Exemple"
```

Rôles possibles : `medecin` (saisit, exporte), `curateur` (structure les documents bruts,
**jamais** l'identité), `system_admin` (gabarits et comptes, **aucune** donnée patient).

✅ **Vérification :** chaque commande affiche `✓ compte cree`. Ces comptes sont
**confirmés d'emblée** (pas d'e-mail à cliquer), mais la **réinitialisation de mot de passe**
restera possible grâce au SMTP du §5.3.

---

## 9. Étape 6 — Construire et servir le frontend (nginx)

### 9.1 Construire le site

```bash
cd /opt/meddata
cp .env.production.example .env.production
```

Renseignez dans `.env.production` :

| Variable | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | `http://registre:8000` (l'API de la stack, comme vu par les navigateurs) |
| `VITE_SUPABASE_ANON_KEY` | La clé `ANON_KEY` du §5.2 |
| `VITE_USE_SIGNED_READ` | `true` (lectures de fichiers journalisées via Edge) |
| `VITE_REQUIRE_SERVER_INSPECTION` | vide ou `false` (mode inspection en pause) |
| `VITE_OFFLINE_MODE` | `disabled` (défaut des releases — pas de cache clinique hors-ligne) |
| `VITE_OFFLINE_ADMIN_ACK` | `false` |
| `VITE_OFFLINE_INTAKE` | `disabled` (la création patient hors-ligne reste réservée aux previews fictifs) |
| `SUPABASE_SERVICE_ROLE_KEY` | La clé secrète (utilisée par les scripts serveur, jamais par le frontend) |

Puis :

```bash
npm run build      # génère le dossier dist/ (le site final)
```
✅ **Vérification :** le build se termine sans erreur, et la clé `service_role` n'apparaît
**pas** dans `dist/` (recherchez-la : `grep -r "service_role" dist/` ne doit rien trouver).

### 9.2 Installer et configurer nginx

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/meddata > /dev/null <<'EOF'
server {
    listen 80;
    server_name registre 192.168.1.50;   # nom + IP fixe du serveur

    root /opt/meddata/dist;
    index index.html;

    # Le site est une SPA : toute route inconnue renvoie vers index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # En-têtes de sécurité (repris de vercel.json du projet)
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' http://registre:8000; frame-ancestors 'none'" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
}
EOF
sudo ln -s /etc/nginx/sites-available/meddata /etc/nginx/sites-enabled/meddata
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
✅ **Vérification :** depuis un poste du réseau, ouvrez `http://registre` (ou
`http://192.168.1.50`) : la page de connexion MedData s'affiche.

> **Cas particulier du CSP :** la valeur `connect-src` ci-dessus autorise le navigateur à
> appeler l'API Supabase sur `http://registre:8000`. Adaptez-la si vous avez changé le nom
> ou l'IP. Pour vérifier que la sécurité n'a pas été cassée, utilisez
> `npm run env:check` dans un contexte qui contient les variables du §9.1.

---

## 10. Étape 7 — Vérifier l'installation (test de bout en bout)

Depuis un **poste utilisateur connecté au WiFi**, contrôlez une par une :

- [ ] La page de connexion s'affiche à `http://registre`.
- [ ] Un `system_admin` se connecte, crée un gabarit et le **publie** ; il ne voit **aucune**
      donnée patient.
- [ ] Un `medecin` se connecte, crée une base, un patient, une rencontre ; il **importe** un
      fichier d'exemple (`docs/exemple-import-neurochirurgie.csv`).
- [ ] Un collaborateur **sans** accès identité ne voit pas les noms des patients.
- [ ] Un `curateur` voit le pool de curation, réserve, structure puis finalise un cas.
- [ ] L'export d'une cohorte figée ne contient **aucune identité ni image**.
- [ ] Un fichier image déposé sur un patient se lit correctement (via `signed-read`).
- [ ] La réinitialisation de mot de passe envoie bien un e-mail (test du SMTP).
- [ ] Deux postes du WiFi utilisent l'application **en même temps** sans ralentissement.

Si un point échoue, notez l'écran et le message d'erreur : c'est le moyen le plus rapide de
diagnostiquer (base, réseau ou configuration).

---

## 11. Étape 8 — Ouvrir l'accès aux utilisateurs

1. **Affichez l'adresse** dans les locaux : les utilisateurs se connectent au WiFi de
   l'institution puis ouvrent `http://registre` dans leur navigateur.
2. **Comptes** : chaque utilisateur a son propre compte (étape 8). **Jamais** de compte
   partagé : le cloisonnement des rôles et les journaux d'audit en dépendent.
3. **Ordinateurs des postes** : aucune installation requise ; évitez seulement les
   navigateurs trop anciens.
4. **Téléphones/tablettes** : fonctionnent aussi sur le WiFi, mais la saisie de données est
   conçue pour des écrans de poste.

---

## 12. Exploitation courante (à prévoir dès le premier jour)

> Le déploiement on-premise rend **l'institution responsable de l'exploitation**. Les trois
> piliers : sauvegardes testées, mises à jour, supervision.

### 12.1 Sauvegardes (le plus important)

Le projet fournit des scripts de sauvegarde coordonnée (base + fichiers) — ils fonctionnent
avec n'importe quelle base PostgreSQL/Storage, donc avec la stack locale :

```bash
cd /opt/meddata
export SUPABASE_URL="http://registre:8000"
export SUPABASE_SERVICE_ROLE_KEY="LA_CLE_SERVICE_ROLE"
export SUPABASE_DB_URL="postgresql://postgres:LE_MOT_DE_PASSE@127.0.0.1:5432/postgres"
export STORAGE_BACKUP_ENCRYPTION_KEY="une-cle-base64-de-32-octets"   # générer : openssl rand -base64 32
npm run backup:coordinated       # sauvegarde chiffrée base + Storage
npm run backup:coordinated:verify
```

Planifiez cette sauvegarde **tous les soirs** (cron ou planificateur) et copiez le dossier
de sauvegarde sur un **support séparé** (disque externe, autre machine) — une sauvegarde sur
le même serveur ne protège pas d'un vol ou d'un incendie. **Une fois par trimestre, testez
une restauration réelle** sur une machine d'essai (procédure détaillée :
`docs/continuite.md`).

### 12.2 Mises à jour

- **Mises à jour système** : `sudo apt update && sudo apt upgrade -y` (mensuel).
- **Mises à jour du projet** : `cd /opt/meddata && git pull && npm ci && npm run build`,
  puis appliquer les éventuelles nouvelles migrations (`npx supabase db push --db-url
  "$SUPABASE_DB_URL"` + `npm run supabase:storage`). **Toujours** après une sauvegarde.
- **Mises à jour de la stack** : suivre les instructions du dépôt `supabase/docker`.

### 12.3 Supervision

- **Quotidien** : `docker compose ps` dans `/opt/supabase-docker` (tout doit être
  `running`/`healthy`) et `systemctl status nginx`.
- **Espace disque** : surveillez qu'il reste de la marge (`df -h`). La base et les fichiers
  déposés grossissent avec l'usage.
- **Relance automatique** : les conteneurs de la stack sont configurés pour se relancer
  après une coupure (`restart: unless-stopped`). Après une coupure de courant, vérifiez
  quand même l'état au retour.
- Pour aller plus loin (alertes, monitoring) : voir `docs/supervision.md`.

---

## 13. Limites et garde-fous — à lire avant de se lancer

1. **Données fictives uniquement.** Tant que le cadre juridique et éthique n'est pas validé
   (`docs/juridique/`), aucune donnée réelle ne doit être saisie — même en réseau local.
2. **L'administrateur du serveur peut techniquement lire la base.** La sécurité RLS protège
   l'accès *applicatif* (ce que voit chaque utilisateur dans l'interface) ; elle ne protège
   pas des personnes qui ont accès au serveur lui-même. En on-premise, **l'institution est
   cet administrateur** : c'est un choix de responsabilité, à acter explicitement.
3. **HTTPS / PWA.** Sur un simple `http://registre`, l'application fonctionne (connexion,
   saisie, export…), mais les fonctionnalités « PWA » (installation de l'app, mise à jour
   automatique, mode hors-ligne) sont désactivées par le navigateur, faute de certificat.
   Le mode hors-ligne est de toute façon désactivé dans les releases du projet
   (`VITE_OFFLINE_MODE=disabled`). Si l'institution veut un jour la PWA complète, il faudra
   un certificat interne (ex. mkcert) — documenter alors cette procédure ici.
4. **Pas de sortie Internet requise.** L'application n'a besoin que du réseau local. Le
   serveur peut être physiquement déconnecté d'Internet sans rien casser (sauf les mises à
   jour et le SMTP s'il est externe).
5. **Les contrôles de release du dépôt** (`env:check:cloud`, drift, e2e staging) sont
   pensés pour Supabase cloud : en on-premise, **l'exploitation documentée dans ce fichier
   tient lieu de preuve** (sauvegardes testées, supervision, mises à jour).

---

## 14. Liste de contrôle finale (avant de brancher les utilisateurs)

- [ ] Serveur installé, IP fixe, nom `registre` résolvable depuis le WiFi.
- [ ] Docker + stack Supabase démarrés, tous conteneurs `healthy`.
- [ ] Migrations + `storage.sql` appliqués et vérifiés.
- [ ] SMTP configuré et testé (e-mail de réinitialisation reçu).
- [ ] Edge Functions montées dans la stack, avec leurs secrets.
- [ ] ClamAV lancé et `healthy` (prêt pour le mode strict futur).
- [ ] Frontend construit, servi par nginx, accessible à `http://registre`.
- [ ] Comptes créés (au moins un `system_admin`, des `medecin`, des `curateur`).
- [ ] Smoke test complet du §10 réussi depuis un poste WiFi.
- [ ] Sauvegarde programmée + première sauvegarde exécutée et vérifiée.
- [ ] Cadre juridique validé avant toute donnée réelle.
