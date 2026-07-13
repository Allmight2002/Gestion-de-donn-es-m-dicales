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

## Donnees et durees de vie

En demonstration autorisee, seules des donnees analytiques minimales peuvent etre ecrites dans
IndexedDB: snapshot type `analytic_snapshot` et outbox type `analytic_outbox`, chacun avec
proprietaire, date de creation et expiration. Le TTL maximum est 24 heures pour les snapshots et
l'outbox. Identite directe, pieces jointes, documents bruts, jetons et reponses API brutes sont
exclus. Les entrees legacy ou sans enveloppe complete sont purgees et ne sont jamais synchronisees.

L'outbox suit `pending`, `syncing`, `succeeded`, `rejected`, `expired` ou `conflict`. Une entree
expiree ou d'un autre compte ne part jamais automatiquement. Les conflits restent a resoudre dans
l'interface. En production reelle, l'absence d'outbox est la strategie qui evite une perte ou une
exportation locale de donnees cliniques non synchronisees.

## Purge et exploitation

Au logout, a l'expiration de session et au changement de compte, l'application attend la purge
d'IndexedDB, des cles localStorage applicatives, Cache Storage et des registrations service worker.
Le rapport contient un resultat par surface et les erreurs sont affichees au lieu d'etre ignorees.
Les anciens schemas IndexedDB sont revalides a l'ouverture; les enregistrements non conformes sont
supprimes. Une purge bloquee par un autre onglet doit etre resolue avant de reutiliser le poste.

Les appareils qui manipuleraient des donnees reelles doivent etre geres par MDM: chiffrement disque,
verrouillage court, profil navigateur dedie, extensions controlees, effacement distant et interdiction
des postes partages. Ces controles ne remplacent pas la politique de non-persistance. Risques
residuels: memoire d'une session active, capture d'ecran, navigateur/OS compromis et caches HTTP
hors controle applicatif.
