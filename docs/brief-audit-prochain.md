# Brief pour le prochain audit MedData

## Objectif

Auditer la version actuellement stabilisee de MedData, en distinguant strictement :

1. les vulnerabilites et regressions reellement demonstrables ;
2. les prealables d'exploitation a mettre en place avant un usage clinique ;
3. les ameliorations utiles, mais non bloquantes.

L'audit doit porter sur le code, la configuration de deploiement et les parcours web
reproductibles. Il ne doit pas requalifier une remarque ancienne sans verifier le correctif
present dans le depot.

## Reference a auditer

- Branche : `main`
- Commit de reference : `b98a0e8cf06a` (`Fix Edge export bundling`)
- Application de production : deploiement Vercel associe a `main`
- Backend de production : projet Supabase `registre-clinique`
- Environnement de preproduction : projet Supabase `meddata-staging`

Avant de conclure, verifier dans `/sync` le commit, la branche et la date de build effectivement
affiches. Si le deploiement ne correspond pas a ce commit, le signaler comme un ecart de
deploiement et non comme une anomalie de code.

## Etat deja connu

Les sujets suivants ont ete implementes et doivent etre verifies dans le code avant toute nouvelle
remarque :

- inspection serveur des fichiers, quarantaine logique et physique, reprise des deplacements de
  quarantaine et limite des tentatives d'inspection ;
- URLs signees de lecture, traces d'audit et controle d'acces aux pieces jointes ;
- exports CSV/XLSX generes et conserves cote serveur ;
- idempotence des imports par ligne normalisee et provenance des valeurs importees ;
- validation stricte des dates, suppression logique, integrite inter-bases et garde-fous de roles ;
- pagination des ecrans lourds, file de completion et statistiques de completude historiques ;
- bundle Edge de `generate-export` : l'import SheetJS utilise `npm:xlsx@0.18.5`, pas un CDN.

### Inspection antivirus : statut operationnel a qualifier correctement

Le code et les fonctions Edge pour ClamAV sont livres. Le flux strict a ete teste en local : un
document de test passe de `pending` a `accepted` apres l'appel a `inspect-upload`.

En revanche, le scanner est actuellement expose par un tunnel temporaire depuis une machine locale.
La production ne force donc pas encore `require_server_inspection=true`. C'est un **prealable
d'exploitation** (hebergement durable du scanner + tunnel stable), pas une regression du code. Il
doit etre mentionne comme tel, avec le risque associe, mais pas duplique en plusieurs P0.

Ne jamais publier dans le rapport : token d'invitation, URL signee, secret Edge, cle API, adresse
e-mail de patient ou donnee de sante.

## Axes d'audit attendus

### 1. Securite et controle d'acces

- RLS Supabase : isolation par base, roles, droits identity/raw documents/export et revocation ;
- impossibilite de s'auto-octroyer un role ou un droit ;
- acces aux identites, documents, exports et URLs signees seulement apres autorisation et audit ;
- secret management, CORS, Edge Functions, routes profondes Vercel et absence de secrets dans le
  frontend ou les logs ;
- verification des migrations et du schema reel du projet cloud, pas seulement de l'historique des
  migrations ;
- audit des dependances runtime et de la surface Storage.

### 2. Integrite et confidentialite des donnees

- patients, rencontres, variables, gabarits versionnes et types de variables ;
- dates impossibles ou ambigues, champs obligatoires, doublons et finalisation ;
- imports CSV/XLSX : mapping, code patient requis, dates, doublons intra/inter-lots, reprise et
  provenance des valeurs ;
- suppression logique, restauration eventuelle, traces de modification et curation ;
- export : filtre de cohorte figee, droits, conservation, telechargement historique et audit.

### 3. Fichiers et curation

- upload ticket, stockage prive, magic bytes, reencodage image et validation de metadonnees ;
- etats `pending`, `scanning`, `accepted`, `quarantined` et impossibilite de les forcer depuis le
  client ;
- comportement en erreur du scanner, nombre limite de tentatives et reconciliation de quarantaine ;
- `signed-read` : refus d'un fichier non accepte et trace avant la remise d'une URL ;
- curation, documents bruts, reclamation de tache et cloisonnement par base.

Les tests EICAR ne doivent etre executes que dans `meddata-staging`, avec des donnees de test, puis
nettoyes. Voir `docs/e2e-staging.md`.

### 4. Robustesse, performance et deploiement

- chargement des listes, pagination, annulation des requetes et navigation rapide ;
- N+1, requetes sans index, chargement inutile de fichiers ou de tables completes ;
- gestion des reseaux lents, erreurs Edge, reprise d'import/export et messages utilisateur ;
- builds Vite, deploiement des cinq Edge Functions, migrations, variables d'environnement et
  compatibilite des rafraichissements profonds ;
- tests automatises pertinents pour chaque risque identifie.

### 5. Interface et accessibilite

- clair/sombre, contraste, textes lisibles, absence de chevauchement et responsive mobile ;
- erreurs au bon endroit, notamment apres un enregistrement en bas de page ;
- formulaires, doublons patients, import avec colonnes inconnues, etat vide, chargement et reprise ;
- clavier, focus visible, libelles de controles, alertes et lecteurs d'ecran si pertinent.

## Regles de qualification

| Niveau | Definition |
| --- | --- |
| P0 | Exposition de donnees, contournement de droits, corruption/perte de donnees ou blocage total reproductible. |
| P1 | Risque important ou fonctionnalite centrale incorrecte, avec impact concret et reproduction fiable. |
| P2 | Robustesse, performance, UX ou dette technique non bloquante. |
| P3 | Amelioration, documentation ou confort de maintenance. |

Une remarque sans scenario de reproduction, impact et preuve dans le code doit etre classee
"a confirmer", jamais P0/P1 par defaut.

## Format de restitution obligatoire

Pour chaque constat :

1. titre et severite ;
2. impact utilisateur ou securite ;
3. etapes exactes de reproduction ;
4. preuve : URL/commande non sensible, fichier et ligne, migration ou fonction concernee ;
5. comportement attendu et observe ;
6. correctif recommande et test de non-regression ;
7. statut : nouveau, deja corrige, doublon, prealable d'exploitation ou a confirmer.

Commencer le rapport par un tableau de synthese des P0/P1, puis les P2/P3. Terminer par :

- les tests executes et ceux qui n'ont pas pu l'etre ;
- les hypotheses et limites d'acces ;
- une liste dedupliquee des actions prioritaires.

## Livrables souhaites

- rapport Markdown ;
- tableau de priorisation ;
- capture ou preuve anonymisee pour les constats UI ;
- aucun changement de code sans validation explicite apres analyse du rapport.
