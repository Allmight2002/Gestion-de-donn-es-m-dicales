# Securite du mode hors-ligne

## Politique retenue

Pour les donnees medicales reelles, le mode hors-ligne est **desactive par defaut** (Option A).
Il ne peut etre active que dans une demonstration explicitement autorisee, avec
`VITE_OFFLINE_MODE=demo` et `VITE_OFFLINE_ADMIN_ACK=true`. Ces variables publiques ne sont pas
un mecanisme d'autorisation et ne doivent jamais activer l'usage de donnees reelles.

L'Option B seule reduit le volume mais laisse les donnees lisibles. L'Option C (chiffrement Web
Crypto) protege surtout une extraction au repos si la cle n'est plus disponible; elle ne protege
ni DevTools, ni XSS, ni un malware ou un utilisateur controlant une session active. Une cle
permanente ne doit pas etre embarquee dans le frontend. Une exception future devra combiner B+C,
une cle de session, TTL strict, revue RSSI/DPO et MDM.

## Cible technique : saisie hors-ligne seule (non livree)

La decision de cadrage du 2026-08-21 retient un mode **intake-only**. Hors-ligne, la base est
une base de lecture indisponible :

- aucune liste, recherche, fiche patient ou rencontre deja enregistree ne doit etre visible ;
- aucun `analytic_snapshot` de patients ne doit etre telecharge, lu ou reconstruit par l'interface ;
- seul un contexte de saisie prepare en ligne (gabarit, regles, options, version et droits)
  peut etre conserve localement ;
- un nouveau patient peut etre conserve dans une file locale de saisies en attente, sans etre
  ajoute a la liste de la base ;
- apres synchronisation, la lecture du patient se fait uniquement en ligne.

Cette cible necessite de conserver localement l'identite du nouveau patient en attente. C'est une
surface de donnees sensible, distincte du snapshot analytique et limitee a la file de creation.
Elle doit rester dans IndexedDB cloisonnee par compte, avec TTL et purge, et ne doit pas apparaitre
dans `localStorage`, le Cache Storage, les journaux ou des reponses API brutes. La cible n'est pas
livree : elle ne leve ni l'interdiction actuelle des donnees medicales reelles hors-ligne ni le
besoin de preuve navigateur, de revue de risque et d'autorisation explicite.

## Donnees et durees de vie

Dans l'implementation actuelle de demonstration autorisee, seules des donnees analytiques
minimales peuvent etre ecrites dans IndexedDB: snapshot type `analytic_snapshot` et outbox type
`analytic_outbox`, chacun avec proprietaire, date de creation et expiration. Le TTL maximum est
24 heures pour les snapshots et l'outbox. Identite directe, pieces jointes, documents bruts, jetons
et reponses API brutes sont exclus. Les entrees legacy ou sans enveloppe complete sont purgees et
ne sont jamais synchronisees.

Pour la cible intake-only, le contexte de saisie doit etre stocke dans un espace distinct du
snapshot de lecture, et la file doit distinguer au minimum `patient_create` et ses operations
dependantes. Le payload de `patient_create` contient l'identite necessaire a la creation ; il est
donc soumis aux memes controles de compte, TTL, purge et non-exposition que toute donnee sensible.
Un patient en attente n'est jamais ajoute au snapshot ni presente comme une ligne existante de la
base.

L'outbox suit `pending`, `syncing`, `succeeded`, `rejected`, `expired` ou `conflict`. Une entree
expiree ou d'un autre compte ne part jamais automatiquement. Les conflits restent a resoudre dans
l'interface. En production reelle, l'absence d'outbox est la strategie qui evite une perte ou une
exportation locale de donnees cliniques non synchronisees.

Chaque correction rejouee porte l'identifiant stable de son entree d'outbox. La RPC
`replay_encounter_update` lie cet identifiant a l'utilisateur et a l'empreinte exacte de la requete,
verrouille la rencontre, puis conserve seulement l'accuse minimal cote serveur. Si le commit a
reussi mais que la reponse reseau est perdue, un rejeu identique renvoie le meme accuse sans
seconde ecriture ni faux conflit. La meme cle avec un autre payload est refusee ; une tentative en
echec ne laisse ni accuse incomplet ni modification partielle.

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
