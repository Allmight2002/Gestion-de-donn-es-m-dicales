# Spécification — Comptes de mission (rôle `saisisseur`)

- Statut : **implémentée dans le code et validée sur la pile locale le 2026-08-11**
- Migrations : `20260729104500_mission_accounts.sql`,
  `20260729153000_mission_profile_reconcile.sql` et
  `20260811120000_managed_mission_credentials.sql`
- Surface serveur : Edge Function `create-mission-account`
- Surface web : connexion commune, écran global `/missions` et écran par base
- Périmètre autorisé : données fictives uniquement tant que les prérequis juridiques et cliniques
  ne sont pas levés

## 1. Besoin et propriété du compte

Un propriétaire de base doit pouvoir confier temporairement la saisie à un étudiant, un thésard
ou un assistant. Le **compte appartient fonctionnellement au propriétaire de la base** : il le
nomme, choisit son identifiant de connexion, relève ou révèle son mot de passe, le prolonge, en
régénère les justificatifs et le révoque.

Le compte ne requiert aucune adresse e-mail de l'étudiant. Le médecin remet directement les
justificatifs à la personne chargée de la saisie. L'étudiant ne choisit pas son mot de passe
initial et le circuit d'invitation/réinitialisation par e-mail n'existe plus pour le rôle
`saisisseur`.

## 2. Décisions de conception

| Décision | Conséquence |
|---|---|
| Rôle global distinct `saisisseur` | Le compte ne peut ni créer une base ou un gabarit, ni hériter des capacités globales du rôle `medecin`. |
| Une mission reste une ligne `base_access` bornée | `expires_at` et `revoked_at` sont vérifiés par la base à chaque requête. |
| Le propriétaire choisit l'identifiant | Format : 3 à 48 caractères, lettres, chiffres, points ou tirets ; unicité globale sans distinction de casse. |
| Le serveur génère le mot de passe | 24 caractères par défaut, source cryptographique, au moins une majuscule, une minuscule, un chiffre et un symbole. |
| Mot de passe révélable ultérieurement | Il est conservé uniquement sous forme chiffrée AES-256-GCM ; la clé n'est ni en base ni dans le navigateur. |
| Identité Auth technique cachée | Auth reçoit `<identifiant>@mission.meddata.invalid`; cette adresse n'apparaît jamais dans l'interface ou le contrat public. |
| Régénération séparée et confirmée | L'identifiant reste stable ; le mot de passe et la génération de session changent. |
| Propriétaire uniquement | Un collaborateur avec `can_manage_access` ne peut ni lister, ni créer, ni révéler, ni prolonger, ni régénérer, ni révoquer ces comptes. |

`base_invitation` reste réservé au partage entre médecins et n'est pas utilisé par les comptes de
mission.

## 3. Modèle de données

### 3.1 Mission et permissions

`base_access` porte la base, le bénéficiaire, l'échéance, la révocation et les permissions. Pour un
`saisisseur` :

- `expires_at` est obligatoire ;
- `can_create_structured_data = true` ;
- édition des données soumises, export, gestion des accès et documents bruts restent interdits ;
- l'accès ne concerne qu'une base.

### 3.2 Coffre chiffré

`mission_account_credential` associe au compte : propriétaire, base, nom d'usage, identifiant,
enveloppe chiffrée, nonce, génération et statut. La table :

- n'accorde aucun droit direct à `anon` ou `authenticated` ;
- ne contient jamais le mot de passe en clair ;
- impose l'unicité de l'identifiant ;
- n'est lue qu'au travers de RPC `SECURITY DEFINER` bornées au propriétaire.

`mission_credential_operation` enregistre les créations et régénérations idempotentes avec une
empreinte de demande, une génération résultante et un état `pending`/`completed`. Il ne contient
ni identifiant Auth secret, ni mot de passe, ni enveloppe.

## 4. Contrat Edge

L'Edge Function accepte uniquement `POST` authentifié et les actions suivantes :

- `create` : `operationId`, `baseId`, `accountLabel`, `loginIdentifier`, échéance et option identité ;
- `reveal` : `accessId` ;
- `regenerate` : `accessId` et `operationId` ;
- `revoke` : `accessId`.

Les actions `resend`, l'e-mail de l'étudiant et toute redirection de mot de passe sont supprimés.
La clé `service_role` reste exclusivement dans l'Edge Function.

`MISSION_CREDENTIALS_ENCRYPTION_KEY` est un secret Edge dédié contenant exactement 32 octets
encodés en base64url. Il est obligatoire sur chaque cible avant le déploiement de la fonction.
Une même clé doit rester stable sur une cible : sa perte rendrait les mots de passe déjà stockés
impossibles à révéler. Sa rotation nécessite une procédure de ré-enveloppement qui n'entre pas
dans ce lot.

## 5. Création et reprise

1. L'Edge vérifie que l'appelant est le propriétaire de la base.
2. Elle génère le mot de passe et chiffre l'enveloppe avant toute création Auth.
3. L'Edge appelle avec `service_role` la RPC interne `begin_mission_account_creation`, qui réserve
   atomiquement l'identifiant, l'UUID Auth et l'opération tout en enregistrant le propriétaire comme
   acteur. Cette RPC n'est pas exécutable directement par le navigateur.
4. L'Edge crée l'utilisateur Auth avec l'identité technique, le mot de passe et
   `app_metadata.global_role = saisisseur` plus `mission_credential_generation = 1`.
5. Elle réconcilie le profil, pose `base_access`, puis marque l'opération terminée.
6. Elle retourne au propriétaire l'identifiant public et le mot de passe.

Si la réponse est perdue, le même `operationId` et la même demande rendent exactement le même
compte et la même enveloppe ; aucun doublon et aucun nouveau secret silencieux ne sont créés. Une
même clé d'opération réutilisée pour une autre demande est refusée. Changer explicitement un champ
du formulaire crée une nouvelle opération.

## 6. Révélation, régénération et révocation

### Révélation

Le propriétaire peut révéler ou copier le mot de passe d'un compte actif. La RPC vérifie la
propriété, l'échéance et la révocation, journalise `mission_credentials_revealed`, puis rend
l'enveloppe chiffrée à l'Edge qui seule la déchiffre. Le navigateur ne conserve le clair que dans
l'état mémoire de l'écran ; rechargement, masquage, déconnexion ou révocation le retirent.

### Régénération

Après confirmation visible :

1. la base incrémente `credential_generation`, remplace l'enveloppe et supprime les sessions Auth ;
2. l'Edge remplace le mot de passe Auth et la génération placée dans `app_metadata` ;
3. l'opération est marquée terminée et auditée ;
4. l'identifiant public reste inchangé.

Un JWT antérieur porte l'ancienne génération. `is_saisisseur()` compare ce claim au coffre à
chaque requête : l'ancien jeton est refusé immédiatement, même avant son expiration. Un échec Auth
intermédiaire laisse donc le compte fermé ; le rejeu avec le même `operationId` reprend le même
secret au lieu d'en produire un autre.

### Révocation

`revoke_mission_access` pose `base_access.revoked_at`, marque le coffre `revoked`, supprime les
sessions et audite l'opération. L'Edge bannit ensuite l'utilisateur Auth. La RLS coupe les données
dès la transaction base, y compris si le bannissement Auth doit être rejoué.

## 7. Connexion

L'écran demande « Identifiant » et mot de passe :

- une valeur sans `@` est normalisée puis traduite localement vers l'identité Auth technique ;
- une adresse e-mail reste acceptée pour les comptes ordinaires ;
- « Mot de passe oublié » n'est proposé que pour une adresse e-mail ordinaire ;
- aucune adresse e-mail n'est nécessaire ou affichée pour un compte de mission.

Les anciens comptes `saisisseur` fondés sur l'e-mail n'ont pas de ligne dans le coffre et échouent
donc fermés dans `is_saisisseur()`. La migration bannit leurs identités Auth et supprime leurs
sessions existantes. Les lignes historiques peuvent subsister pour la traçabilité, mais leurs
anciens justificatifs ne permettent plus de se connecter ni de lire une donnée MedData.

## 8. Interface propriétaire

Deux chemins partagent le même composant :

- `/missions` : vue générale de tous les comptes liés aux bases possédées, avec nom de la base et
  création sur une base sélectionnée ;
- `/bases/:id/missions` : vue filtrée sur une base.

Chaque ligne montre : nom du compte, base liée, identifiant, mot de passe masqué, échéance et jours
restants, état actif/expiré/révoqué, option identité et actions révéler/copier, prolonger,
régénérer et révoquer. La route, l'onglet de base et les RPC sont réservés au propriétaire.

## 9. Audit et absence de fuite

Les événements enregistrés sont : demande/création, demande/régénération, révélation,
prolongation et révocation. Les métadonnées contiennent uniquement les UUID utiles, l'échéance,
les flags et la génération. Elles ne contiennent jamais : mot de passe, enveloppe, nonce, clé de
chiffrement ou identité Auth technique.

Les erreurs HTTP et logs Edge sont génériques. Le frontend n'écrit les justificatifs ni dans
`localStorage`, ni dans IndexedDB, ni dans les notifications. Le presse-papiers n'est utilisé
qu'après une action explicite « Copier ».

## 10. Couverture exigée

- PostgreSQL/RLS : droits directs absents, unicité, reprise et conflit, refus inter-propriétaires,
  génération courante, anciennes sessions, expiration, révocation et audit sans secret ;
- Edge : validation du nouveau contrat, propriété avant Auth, identité technique, reprise exacte,
  régénération, révélation, révocation et erreurs/logs sans fuite ;
- Web : écran global et par base, propriétaire uniquement, identifiant choisi, masque/révélation,
  copie, confirmation de régénération/révocation et connexion identifiant ou e-mail ;
- parcours réel : création par le médecin, connexion du saisisseur, rotation pendant une session
  ouverte, refus de l'ancien jeton et des anciens mots de passe, acceptation du nouveau.

## 11. Preuve locale du 2026-08-11

Sur Supabase local remis à zéro et une base fictive à UUID v4 :

- le propriétaire a créé `qa-mission-20260811` depuis la vue générale, sans e-mail ;
- le mot de passe est apparu masqué et est resté révélable par le propriétaire ;
- le saisisseur s'est connecté avec l'identifiant public et n'a vu qu'une base ;
- une régénération par le vrai endpoint a rendu une session déjà ouverte inapte à charger le
  profil ; l'ancien mot de passe a été refusé et le nouveau accepté ;
- une seconde régénération confirmée dans l'interface a conservé l'identifiant, refusé le mot de
  passe précédent et accepté le nouveau ;
- aucun des trois secrets de test n'apparaît dans les logs Edge, Vite ou console ; l'audit ne
  contient aucune clé de secret et les trois opérations idempotentes sont `completed`.
- le vérificateur automatisé du contrat Edge complet a passé 29/29 contrôles, dont les reprises,
  doublons, refus inter-comptes/inter-bases, expiration, rotation, anciennes sessions et révocation.

Cette preuve locale n'est pas une preuve de déploiement. La validation staging puis production
doit porter le même SHA via le workflow manuel « Coordinated release ».
