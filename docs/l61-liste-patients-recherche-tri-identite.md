# L61 à L65 — Liste des patients d'une base : colonnes, tri, recherche et identité

> **Document vivant — spécifié le 2026-09-11, état de source révisé le 2026-09-16.** Il organise
> la demande produit sur l'accueil d'une base : mémoriser les colonnes affichées, trier par
> variable, rechercher dans la base et, sous contrôle strict, rendre le nom sélectionnable. Il ne
> constitue ni une preuve de déploiement, ni une autorisation d'utiliser des données réelles.

## 1. État réel avant lancement

Le code et les migrations du checkout courant priment sur le diagnostic historique. Une partie du
socle est déjà présente ; elle ne doit donc pas être recréée sous un autre nom.

| Besoin | État observé dans le checkout courant | Ce qui reste à faire |
|---|---|---|
| Colonnes analytiques choisies par l'utilisateur | `BaseHome` les persiste dans `base_view_preference` par utilisateur et par base ; le cache `localStorage` ne sert que de repli/migration et les clés supprimées sont purgées | Prouver le comportement sur un navigateur et sur la cible |
| Recherche dans la base | Recherche par **code patient**, côté serveur avant pagination, séparée de `Ctrl/Cmd+K` | Recherche nominative contrôlée dans L64 |
| Tri | Ordre serveur par `created_at` ou `patient_code`, avec départage par `id` | Tri par une variable clinique autorisée dans L62/L63 |
| Nom complet dans la liste | Les lignes restent pseudonymisées. Une recherche nominative contrôlée existe localement et ne renvoie que des identifiants ; la colonne « Nom complet » n'est pas livrée | Décider et réaliser séparément l'affichage éventuel, sans élargir la fuite d'identité |

Le rapport de suivi UX postérieur consigne une exécution locale saine de `Patients.test.tsx` et des
tests de recherche identité. Cette preuve reste locale et ne couvre ni le tri clinique, ni un
parcours navigateur, ni une cible déployée ; consulter
[suivi-correctifs-ux.md](suivi-correctifs-ux.md) pour les commandes et limites exactes.

> **Écart de séquence assumé.** Le code local a réalisé la recherche nominative contrôlée avant le
> tri clinique L62/L63, avec un endpoint serveur qui vérifie les droits et journalise l'accès sans
> conserver le terme. Les sections L62 à L65 restent le contrat utile pour le travail non livré ;
> ne pas rejouer L64 comme si cette implémentation n'existait pas.

## 2. Décisions produit et limites non négociables

1. La recherche est un contrôle de la **liste d'une base**, pas une extension de la palette
   `Ctrl/Cmd+K`. Elle reste indisponible hors connexion, notamment en mode *intake-only*.
2. La préférence de colonnes est persistée côté serveur, indexée par utilisateur et base, afin de
   suivre le compte entre appareils. Le cache local ne sert qu'à la migration douce et au repli
   sans réseau ; la préférence ne contient que des clés techniques, jamais une valeur clinique,
   un nom, un terme de recherche ou une réponse serveur.
3. Le tri par variable ne concerne que des champs analytiques de portée patient que le serveur
   reconnaît dans la version active de la base. Le client ne transmet jamais un identifiant SQL,
   n'invente pas de conversion JSON et ne peut pas demander un champ identité.
4. Toute recherche, tout tri et tout comptage sont résolus **avant** la pagination, avec un ordre
   total stable. Les valeurs absentes sont placées après les valeurs renseignées dans les deux
   sens ; le contrat définit explicitement la sémantique de chaque type scalaire pris en charge.
   Les structures complexes (par exemple une liste multiple ou un objet) sont indisponibles tant
   qu'une sémantique clinique stable n'est pas spécifiée.
5. La demande du 2026-09-11 autorise une exception étroite à la pseudonymisation de la liste : un
   médecin qui possède `can_view_identity` sur **cette base** peut sélectionner « Nom complet » et
   chercher par nom. La vérification est faite par le serveur à chaque lecture ; le sélecteur
   d'interface ne vaut jamais autorisation.
6. Le nom, la date de naissance, les termes de recherche nominative et les résultats d'identité ne
   sont jamais écrits dans l'URL, le cache hors-ligne, les exports, `localStorage`, les messages
   d'erreur ou les métadonnées d'audit. Une révocation de droit masque les valeurs déjà affichées
   au prochain chargement et purge la préférence devenue interdite.

Cette décision prospective révise précisément la règle RG-9 : la liste reste pseudonymisée par
défaut, avec la seule exception ci-dessus. La décision archivée du 2026-08-20 est conservée comme
preuve datée ; elle ne décrit pas à elle seule l'état ni le périmètre final.

## 3. Séquence des lots

Les lots sont volontairement séquentiels. Ils partagent `BaseHome`, les contrats de repository et,
pour L62/L64, le même territoire d'autorisation serveur. Ne pas ouvrir deux implémentations
concurrentes de la liste ou de la RPC.

| Ordre | Lot | Objet | Charge indicative | Dépendance et collision |
|---|---|---|---|---|
| 1 | L61 | Stabiliser et prouver le socle déjà présent | 0,5 à 1,5 j | Avant tout changement de contrat ; `BaseHome` et `Patients.test.tsx` réservés |
| 2 | L62 | Contrat serveur du tri par variable analytique | 2,5 à 4,5 j | Après L61 ; jamais en parallèle avec L42, L56 ou un autre lot modifiant `patients.ts`/les RPC |
| 3 | L63 | Sélecteur accessible de variable et deux sens de tri | 1 à 2 j | Après L62 ; seul propriétaire de `BaseHome` pour ce chantier |
| 4 | L64 | Colonne nom complet et recherche nominative auditée | 3 à 5 j | Après L63 ; migration, RPC, repository, `BaseHome`, ACL et tests sous un responsable unique |
| 5 | L65 | Preuves intégrées, performance et documentation de livraison | 1 à 2 j | Après L61 à L64 ; lecture/validation, sans élargir le produit |

Charge totale séquentielle : **8 à 13 jours**. Elle exclut une correction imprévue révélée par les
tests, l'attente de CI et toute validation ou promotion cloud.

### L61 — Stabiliser et prouver le socle actuel

- **Périmètre :** persistance serveur par utilisateur/base, repli local, purge des clés obsolètes,
  conservation d'un choix vide, réinitialisation de contexte, recherche par code, pagination et
  tri technique existant.
- **Sortie :** les scénarios web ciblés passent avec une sortie de processus saine ; les limites
  explicites sont consignées : pas de tri clinique générique, pas de nom, pas de recherche
  nominative, pas d'accès hors ligne.
- **Risque :** qualifier « livré » un comportement dont les assertions passent mais dont le runner
  ou le navigateur n'a pas terminé correctement ; effacer une préférence d'un autre compte/base.

#### Preuves du 2026-09-20 (locales, hors cible)

Le socle a ete verifie avant toute modification, puis un seul ecart a ete corrige. Etat par
capacite, au sens de la section L65 :

| Capacite | Etat |
|---|---|
| Cle de preference `meddata:columns:<utilisateur>:<base>`, ecriture et relecture | **validee localement** |
| Preference d’un autre compte ou d’une autre base laissee intacte | **validee localement** |
| Purge des cles absentes de la version courante | **validee localement** |
| Recherche par code resolue par le serveur avant la pagination | **validee localement** |
| Tris techniques `created_at` / `patient_code`, departage par `id` | **validee localement** |
| Retour page 1 apres recherche, apres tri et au changement de base | **validee localement** |
| Parcours navigateur (rechargement, changement de compte/base, code hors premiere page, deux sens de tri) | **non verifie** |

**Ecart corrige.** Quand le navigateur refuse d’ecrire (navigation privee, quota), le choix de
colonnes etait perdu au changement de page suivant, alors que `BaseHome.tsx` annonce une
preference « valable pour la session seulement ». Un repli de session en memoire, attache a la
paire compte/base qui l’a produit et jamais repris sans cle, retablit le comportement annonce
sans rien persister de plus. Regression couverte par un test dedie.

**Commandes et resultats.** `npm.cmd run test:web -- src/screens/member/Patients.test.tsx` :
24 tests passes, code de sortie 0. Les trois autres fichiers web qui montent `BaseHome`
(`Dashboard`, `OfflineIntake`, `OfflineRead`) : 24 tests passes, code de sortie 0.
`npm run typecheck` et ESLint sur les deux fichiers touches : code de sortie 0.
L’execution du 2026-09-11 terminee en `-1073741819` **ne se reproduit pas** sur ce checkout.

**Mise a jour du 2026-09-22.** La migration additive `20260922002545_base_view_preferences.sql`,
le repository Supabase et la relecture/ecriture dans `BaseHome` sont implementes localement. Le
test PostgreSQL dedie couvre le proprietaire, le collaborateur, l'utilisateur sans acces et la
revocation ; le test web couvre la relecture sur un second montage et le choix vide. La migration
distante et le parcours navigateur restent a verifier sur une cible autorisee.

**Limite d’environnement, non contournee.** Aucune preuve navigateur n’a ete produite : ce poste
n’a pas Docker, donc pas de Supabase local, et la seule cible de developpement configuree
(`.env.local`, `.claude/launch.json`) pointe vers le projet cloud. Lancer l’ecran l’aurait
branche sur des donnees reelles, ce que le lot interdit. Cette preuve reste due, sur un preview
isole a donnees fictives (voir O6), et le tri clinique, le nom complet et la recherche
nominative demeurent hors de ce lot.

### L62 — Contrat serveur du tri par variable analytique

- **Périmètre :** concevoir puis implémenter un unique contrat de liste qui accepte un champ de
  tri explicitement autorisé. Le serveur résout la clé par rapport à la base et à sa version
  active, applique filtre, ordre, valeurs absentes, `id` de départage, total et page dans le bon
  ordre. Il conserve les deux tris techniques existants.
- **Types et performance :** avant de coder, dresser la table des types réellement utilisables et
  leur normalisation scalaire. Refuser explicitement les types complexes plutôt que les trier via
  une coercition texte silencieuse. Mesurer une base représentative ; n'ajouter un index que s'il
  sert un accès défini et si son coût d'écriture est accepté.
- **Sécurité :** aucune identité, aucune interpolation de clé dans du SQL dynamique non validé,
  aucune confiance dans le champ choisi par le navigateur. Préférer `SECURITY INVOKER` si cela
  suffit ; toute élévation doit être justifiée, avec `search_path`, authentification, validation,
  droits `EXECUTE` et ACL explicites.
- **Sortie :** migration additive si nécessaire, contrat repository typé, tests de pagination,
  valeurs manquantes, égalités, clé interdite et accès inter-base. Après migration : snapshot
  régénéré, inspecté, puis `npm run schema:check` réussi.
- **Risque :** trier après `range`, instabilité entre pages, fuite d'un champ ou coût non maîtrisé
  d'un tri JSONB.

### L63 — Commande de tri clinique accessible

- **Périmètre :** la liste propose les variables réellement supportées par L62 et deux actions
  explicites « croissant » / « décroissant ». Le changement repart à la première page, annule
  proprement une réponse devenue obsolète et rend l'ordre actif compréhensible au clavier et au
  lecteur d'écran.
- **Hors périmètre :** pas de persistance nouvelle du tri, pas de recherche nominative, pas de
  lecture directe d'identité, pas de nouvelle sémantique de données clinique dans l'interface.
- **Sortie :** les flèches, la variable active, les états vide/chargement/erreur et la pagination
  sont testés en français et anglais, desktop et largeur mobile ; le contrat L62 est utilisé tel
  quel.
- **Risque :** sélectionner une variable que le serveur refuse, conserver une page incompatible,
  ou annoncer un ordre contraire à l'ordre réellement renvoyé.

### L64 — Identité nominative contrôlée dans la liste

- **Périmètre :** proposer « Nom complet » dans le sélecteur uniquement quand la capacité de base
  le permet, afficher la valeur reçue par un endpoint contrôlé, et permettre une recherche par
  nom à l'intérieur de la base. La recherche par code continue de fonctionner sans droit identité.
- **Autorisation et audit :** `patient_identity` n'est jamais lu directement par le client. Une
  opération serveur dédiée vérifie authentification, rôle `medecin`, appartenance à la base et
  `can_view_identity` avant tout résultat ; elle journalise l'accès sans le terme saisi ni la
  donnée révélée. Les privilèges et `EXECUTE` sont minimaux, et toute nouvelle fonction privilégiée
  rejoint l'inventaire/les tests ACL du projet.
- **Non-divulgation :** sans droit, aucun nom, compteur, ordre, message, temps de réponse conçu
  comme indicateur ou résultat partiel ne révèle l'identité. Une révocation, un changement de base
  ou un passage hors ligne retire la colonne et la valeur en mémoire. Les exports et snapshots
  restent analytiques.
- **Sortie :** tests DB/RLS/ACL des lecteurs autorisés et refusés, inter-base, accès direct,
  révocation et audit ; tests web de masquage et purge ; test navigateur avec données fictives.
- **Risque :** utiliser le contrôle visuel comme sécurité, lire 20 identités par requêtes client,
  conserver un nom en cache ou affaiblir une policy existante pour faire passer l'écran.

### L65 — Preuves intégrées et clôture documentaire

- **Périmètre :** exécuter et consigner les vérifications des lots précédents sans écrire une
  fonctionnalité nouvelle : tests web, DB/RLS/ACL, snapshot de schéma si migration, mesure de
  recherche/tri sur données fictives, et parcours navigateur d'un médecin autorisé/non autorisé.
- **Sortie :** chaque capacité est marquée séparément **spécifiée**, **implémentée**,
  **validée localement** ou **validée sur la cible**. Une CI verte ou la présence du code ne vaut
  pas preuve navigateur ni cloud ; aucun déploiement n'est implicite.
- **Risque :** confondre un test mocké avec l'autorisation RLS réelle, ou documenter le nom comme
  « pseudonymisé » alors que la permission l'a rendu visible.

## 4. Matrice minimale d'acceptation

| Réf. | Scénario | Résultat attendu |
|---|---|---|
| P01 | Un médecin choisit des colonnes, recharge puis ouvre une autre base ou un autre compte | La préférence de la bonne paire utilisateur/base revient ; aucune clé périmée ou étrangère ne survit |
| P02 | Recherche par code d'un patient absent de la première page | Le serveur filtre avant pagination, total cohérent, retour page 1 |
| P03 | Tri par variable prise en charge avec valeurs égales et absentes | Ordre de type documenté, absents en fin, `id` stable, aucune ligne répétée/oubliée entre pages |
| P04 | Clé de variable forgée, supprimée, interdite ou d'une autre base | Refus sûr sans SQL dynamique, fuite ni mélange de base |
| P05 | Médecin autorisé sélectionne le nom et cherche un nom | Résultats limités à la base, nom affiché seulement par l'opération auditée |
| P06 | Médecin sans `can_view_identity`, curateur, saisisseur ou administrateur | Recherche code seulement selon le contrat ; aucun indice d'identité dans ligne, total, ordre ou erreur |
| P07 | Droit identité révoqué après affichage, puis rechargement/changement de base/hors ligne | Nom masqué, préférence purgée, aucune identité dans snapshot ou stockage local |
| P08 | Export et inspection du cache après une consultation nominative | Aucun nom, date de naissance ou terme de recherche dans export, cache, URL ou journal métier non nécessaire |

## 5. Documents et prompts liés

- [Décision de recherche patient du 2026-08-20](decision-recherche-patient-2026-08-20.md) —
  preuve datée conservée ;
- [spécification d'expérience utilisateur](spec-experience-utilisateur.md#ux-12--navigation-et-listes-de-patients) —
  chantier UX parent ;
- [lots parallélisables](lots-paralleles.md) — index L61 à L65 et collisions ;
- [prompts d'exécution](prompts-lots.md#l61--stabiliser-et-prouver-le-socle-actuel-de-la-liste-patient) —
  un prompt borné par lot.
