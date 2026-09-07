# Securite du mode hors-ligne

## Politique retenue

Pour les donnees medicales reelles, le mode hors-ligne est **desactive par defaut** (Option A).
Il ne peut etre active que dans une demonstration explicitement autorisee, avec
`VITE_OFFLINE_MODE=demo`, `VITE_OFFLINE_ADMIN_ACK=true` et, pour la saisie intake-only,
`VITE_OFFLINE_INTAKE=demo`. Ces variables publiques ne sont pas
un mecanisme d'autorisation et ne doivent jamais activer l'usage de donnees reelles.

L'Option B seule reduit le volume mais laisse les donnees lisibles. L'Option C (chiffrement Web
Crypto) protege surtout une extraction au repos si la cle n'est plus disponible; elle ne protege
ni DevTools, ni XSS, ni un malware ou un utilisateur controlant une session active. Une cle
permanente ne doit pas etre embarquee dans le frontend. Une exception future devra combiner B+C,
une cle de session, TTL strict, revue RSSI/DPO et MDM.

## Dérogation en cours : hors-ligne actif en production (décision du 2026-09-05)

Par dérogation explicite à la politique ci-dessus, la **production** est déployée depuis le
2026-09-05 avec le hors-ligne de démonstration actif, saisie comprise : `VITE_OFFLINE_MODE=demo`,
`VITE_OFFLINE_ADMIN_ACK=true`, `VITE_OFFLINE_INTAKE=demo` et `ALLOW_OFFLINE_DEMO_BUILD=true`.
Aucune date de fin n'est fixée à ce jour.

**Motif.** Éprouver la saisie hors-ligne livrée le 2026-08-23 dans ses conditions réelles d'usage —
PWA installée, coupure réseau franche, rejeu à la reconnexion — ce qu'aucun essai local ne reproduit :
le service worker n'est pas généré par `npm run dev`, faute de `devOptions` dans `vite.config.ts`.

**Condition qui rend la dérogation acceptable.** La base ne contient que des données fictives. Cette
dérogation n'est donc pas l'« exception future » évoquée plus haut, qui concerne les données réelles
et exigerait B+C, clé de session, revue RSSI/DPO et MDM. Elle devient caduque, et doit être levée
avant toute saisie, dès la première donnée réelle. Ni O6 ni O7 ne sont levés.

**Portée.** Les deux blocs d'environnement du job `production` de
`.github/workflows/coordinated-release.yml` — l'ancre `&production_env` et le step qui construit le
bundle expédié — plus les variables correspondantes dans le dashboard Vercel. Le build de validation,
jamais déployé, et le frontend staging restent à `disabled`/`false` : le staging conserve son rôle de
témoin « hors-ligne éteint ».

**Conséquence assumée.** Chaque appareil connecté conserve des données cliniques dans IndexedDB
pendant 24 heures au plus, et la session d'authentification est persistée pour l'usage hors-ligne.

**Levée de la dérogation, en une seule opération.** Remettre les deux blocs du workflow à
`disabled`/`'false'`, retirer `VITE_OFFLINE_INTAKE` et `ALLOW_OFFLINE_DEMO_BUILD`, **et** supprimer au
même moment les variables ajoutées dans le dashboard Vercel. Le retour arrière partiel est le piège
principal : si les variables du dashboard survivent à celles du workflow, la production peut rester en
hors-ligne sans que le dépôt ne le dise, et le build ne signalera rien — `demo` accompagné de son
acquittement et de son autorisation reste une combinaison valide pour
`scripts/offline-build-policy.mjs`. Le garde-fou `test/deployment.test.ts` ne couvre que le versant
workflow ; aucun test ne couvre le dashboard Vercel.

Suivi : PR #280.

## Implémentation actuelle : saisie hors-ligne seule (*intake-only*)

La decision de cadrage du 2026-08-21 retient un mode **intake-only**. Hors-ligne, la base est
une base de lecture indisponible :

- aucune liste, recherche, fiche patient ou rencontre deja enregistree ne doit etre visible ;
- aucun `analytic_snapshot` de patients ne doit etre telecharge, lu ou reconstruit par l'interface ;
- seul un contexte de saisie prepare en ligne (gabarit, regles, options, version et droits)
  peut etre conserve localement ;
- un nouveau patient peut etre conserve dans une file locale de saisies en attente, sans etre
  ajoute a la liste de la base ;
- apres synchronisation, la lecture du patient se fait uniquement en ligne.

Cette implémentation, livrée dans le code O0 à O5 le 2026-08-23, conserve localement l'identité du
nouveau patient en attente. C'est une surface de données sensible, distincte du snapshot analytique
et limitée à la file de création. Elle reste dans IndexedDB, cloisonnée par compte, avec TTL et
purge ; elle n'apparaît pas dans `localStorage`, le Cache Storage, les journaux ou des réponses API
brutes. La livraison ne lève ni l'interdiction actuelle des données médicales réelles hors-ligne ni
le besoin de preuve navigateur, de revue de risque et d'autorisation explicite : O6 et O7 restent
ouverts.

## Donnees et durees de vie

Dans le mode de démonstration historique, des données analytiques minimales peuvent être écrites
dans IndexedDB : snapshot type `analytic_snapshot` et opérations de correction de l'outbox, chacun
avec propriétaire, date de création et expiration. Le TTL maximum est 24 heures. Identité directe,
pièces jointes, documents bruts, jetons et réponses API brutes sont exclus de ce mode.

Pour l'intake-only livré, le contexte de saisie est stocké dans le store IndexedDB
`intake_context`, distinct du snapshot de lecture, et la file `outbox` distingue `patient_create`
et `encounter_create`. Le payload de `patient_create` contient l'identité nécessaire à la création ;
il est donc soumis aux mêmes contrôles de compte, TTL, purge et non-exposition que toute donnée
sensible. Un patient en attente n'est jamais ajouté au snapshot ni présenté comme une ligne
existante de la base. Les contextes et opérations expirent au bout de 24 heures.

L'outbox suit `pending`, `syncing`, `succeeded`, `rejected`, `expired` ou `conflict`. Une entree
expiree ou d'un autre compte ne part jamais automatiquement. Les conflits restent a resoudre dans
l'interface. En production reelle, l'absence d'outbox est la strategie qui evite une perte ou une
exportation locale de donnees cliniques non synchronisees.

Chaque opération rejouée porte l'identifiant stable de son entrée d'outbox. Les RPC
`replay_encounter_update`, `replay_patient_create` et `replay_encounter_create` lient cet identifiant
à l'utilisateur et à l'empreinte exacte de la requête, puis conservent seulement l'accusé minimal
côté serveur. Si le commit a réussi mais que la réponse réseau est perdue, un rejeu identique renvoie
le même accusé sans seconde écriture ni faux conflit. La même clé avec un autre payload est refusée ;
une tentative en échec ne laisse ni accusé incomplet ni modification partielle.

## Purge et exploitation

Au logout, a l'expiration de session et au changement de compte, l'application attend la purge
d'IndexedDB, y compris le contexte de saisie et les patients en attente, des cles localStorage
applicatives, Cache Storage et des registrations service worker.
Le rapport contient un resultat par surface et les erreurs sont affichees au lieu d'etre ignorees.
Les anciens schemas IndexedDB sont revalides a l'ouverture; les enregistrements non conformes sont
supprimes. Une purge bloquee par un autre onglet doit etre resolue avant de reutiliser le poste.

Pour le mode intake-only, un echec de purge doit bloquer l'activation du parcours hors-ligne et
laisser l'operateur sur un message explicite. Une expiration ou une permission retiree ne doit pas
effacer silencieusement une saisie : elle doit produire un etat bloque ou rejete, sans synchronisation
automatique.

Les appareils qui manipuleraient des donnees reelles doivent etre geres par MDM: chiffrement disque,
verrouillage court, profil navigateur dedie, extensions controlees, effacement distant et interdiction
des postes partages. Ces controles ne remplacent pas la politique de non-persistance. Risques
residuels: memoire d'une session active, capture d'ecran, navigateur/OS compromis et caches HTTP
hors controle applicatif.
