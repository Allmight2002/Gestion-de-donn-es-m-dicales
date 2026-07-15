# 05 — Politique de confidentialité et de protection des données (plateforme MedData)

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider**, puis à publier sur la plateforme (lien depuis l'écran de connexion) |
| Audience | Utilisateurs professionnels de la plateforme et toute personne souhaitant comprendre les traitements ; l'information **des patients** est assurée par la [notice (03)](03-notice-information.md) |

---

## 1. Qui sommes-nous ?

La plateforme **MedData** (`[URL de production]`) est un registre clinique
pseudonymisé destiné à la recherche en santé. Le responsable du traitement est
**`[établissement / Dr Raymond Mbassi]`**, `[adresse complète]`, joignable à
`[e-mail de contact]`. Le référent à la protection des données est
**`[nom, e-mail, téléphone]`**.

La plateforme est régie par la loi camerounaise n° 2024/017 du 23 décembre 2024
relative à la protection des données à caractère personnel et par la loi n° 2022/008 du
27 avril 2022 relative à la recherche médicale impliquant la personne humaine.

## 2. Quelles données traitons-nous, et pourquoi ?

### 2.1 Données des patients inclus dans un registre

| Catégorie | Contenu | Finalité |
|---|---|---|
| Zone identité (accès restreint) | Nom, date de naissance, téléphone, adresse, images cliniques | Permettre au médecin traitant de relier et suivre les dossiers ; jamais exportée |
| Zone analytique (pseudonymisée) | Code patient, âge calculé, variables cliniques structurées | Recherche scientifique (études descriptives et analytiques approuvées) |
| Documents bruts (accès restreint) | Documents médicaux dé-identifiés à structurer | Curation : transformation en données structurées |

Base de licéité : **consentement éclairé écrit** du patient (ou décision expresse du
comité d'éthique pour les données rétrospectives), dans le cadre d'une recherche ayant
reçu une clairance éthique et une autorisation administrative. Détail complet :
[registre des traitements (01)](01-registre-traitements.md).

### 2.2 Données des utilisateurs professionnels

| Catégorie | Contenu | Finalité |
|---|---|---|
| Compte | Nom d'affichage, e-mail professionnel, rôle, permissions par base | Authentification, habilitations, invitations |
| Journaux d'audit | Actions sensibles horodatées (consultations d'identité, exports, changements d'accès, suppressions…) | Sécurité, imputabilité, obligations légales |
| Journaux techniques | Adresses IP, événements de connexion (Supabase Auth), journaux d'hébergement (Vercel/Supabase) | Fonctionnement, sécurité, détection d'abus |

Base de licéité : gestion de la relation d'habilitation et obligation légale de
sécurité. L'utilisation de la plateforme vaut acceptation de la
[charte utilisateurs (11)](11-charte-utilisateurs.md).

## 3. Qui accède aux données ?

- **Personne n'accède à tout.** Les accès sont cloisonnés techniquement (contrôle en
  base de données) : l'identité n'est visible que des comptes expressément autorisés
  par le médecin propriétaire de la base ; les curateurs ne voient jamais l'identité ;
  l'administrateur système n'a accès à aucune donnée patient.
- Les **exports** ne contiennent jamais d'identité ni d'images : une liste blanche
  serveur bloque tout champ identifiant.
- Aucune donnée n'est vendue, louée ni transmise à des tiers non autorisés. Une
  communication ne peut intervenir que sur obligation légale (réquisition), après
  vérification de sa validité.

## 4. Sous-traitants et hébergement

Les données sont hébergées auprès de **Supabase** (base de données, authentification,
stockage de fichiers, fonctions serveur), dans la région **`[eu-west-3 — Paris,
France]`**, avec chiffrement en transit et au repos. Le frontend statique est servi par
**Vercel**. Les e-mails de service (confirmation, réinitialisation) sont acheminés par
`[fournisseur SMTP]`. Les fichiers téléversés sont analysés par un service antiviral
opéré par `[hébergeur ClamAV]`. Chaque sous-traitant est lié par un accord de
traitement des données ; liste tenue à jour dans
[10-sous-traitants-transferts.md](10-sous-traitants-transferts.md).

**Transfert hors du Cameroun.** L'hébergement en Union européenne constitue un
transfert international encadré par l'art. 32 de la loi n° 2024/017 : il est couvert
par l'autorisation de l'autorité de protection des données `[référence à compléter]`,
le consentement explicite des patients et des garanties contractuelles.

## 5. Durées de conservation

Les durées détaillées figurent dans la [politique de conservation (09)](09-conservation.md).
Repères : données des registres — durée de vie du registre approuvée par le comité
d'éthique (`[15 ans après dernière inclusion]`) ; comptes — durée d'activité +
`[3 ans]` ; journaux d'audit — `[5 ans]` ; sauvegardes — `[7 à 30 jours]` glissants.

## 6. Vos droits

Toute personne concernée (patient ou utilisateur professionnel) dispose des droits
d'**accès**, de **rectification**, d'**effacement**, d'**opposition**, de **retrait du
consentement** et de **portabilité**, dans les conditions prévues par la loi
n° 2024/017. Les modalités pratiques (canaux, vérification d'identité, délais de
réponse — `[30 jours]` maximum) sont décrites dans la
[procédure des droits (07)](07-droits-personnes.md).

Contact : `[référent protection des données — e-mail, adresse postale, téléphone]`.
Vous disposez également du droit d'introduire une réclamation auprès de l'autorité de
protection des données personnelles du Cameroun.

## 7. Stockage local sur votre appareil (application web / PWA)

MedData est une application web installable (PWA). Sur l'appareil de l'utilisateur
professionnel, elle utilise uniquement des stockages **techniques** :

- jeton de session d'authentification (nécessaire à la connexion) ;
- fichiers applicatifs mis en cache par le navigateur (code de l'application, pas de
  données patients) ;
- préférences d'interface.

**Aucune donnée clinique réelle n'est conservée sur l'appareil** : le mode hors-ligne
est désactivé pour les données réelles, et l'intégralité des stockages locaux
(IndexedDB, localStorage, caches, service worker) est **purgée à la déconnexion**, à
l'expiration de session et au changement de compte. La plateforme n'utilise aucun
traceur publicitaire ni outil de mesure d'audience tiers `[à mettre à jour si un outil
de supervision est ajouté]`.

## 8. Sécurité

Les mesures techniques et organisationnelles (cloisonnement des zones par contrôle
d'accès en base, journalisation d'audit infalsifiable, authentification renforcée,
analyse antivirale des fichiers, sauvegardes, chiffrement) sont décrites dans la
[politique de sécurité (06)](06-politique-securite.md). Tout utilisateur constatant une
anomalie doit la signaler sans délai à `[contact incident]` — voir
[procédure de violation (08)](08-violations-donnees.md).

## 9. Mises à jour de la présente politique

Cette politique est revue au minimum une fois par an et à chaque évolution des
traitements. La version en vigueur, datée et numérotée, est publiée sur la plateforme ;
les modifications substantielles sont notifiées aux utilisateurs et, si elles
concernent les patients, répercutées dans la notice d'information soumise au comité
d'éthique.

| Version | Date | Modification |
|---|---|---|
| 1.0 | `[date de publication]` | Version initiale |
