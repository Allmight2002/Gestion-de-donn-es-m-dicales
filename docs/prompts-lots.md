# Prompts prêts à l'emploi, un par lot

- Établi le 2026-07-28, en complément de [`lots-paralleles.md`](lots-paralleles.md)
- **Révisé le 2026-08-10** : état des lots remis à jour, et cinq prompts ajoutés (L15 à L19)
- **Révisé le 2026-08-11** : sept prompts ajoutés (L20 à L26), issus de
  [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md)
- **Révisé le 2026-08-13** : sept prompts ajoutés (L27 à L33), le reste des améliorations du
  moteur de formulaires
- **Révisé le 2026-08-18** : trois prompts ajoutés (L35 à L37) — variables calculées, parité
  d'export des listes à choix multiples, feuille de fréquences
- **Révisé le 2026-08-20** : sept prompts ajoutés (L38 à L44), issus de
  [`audits/audit-technique-complet-2026-08-18.md`](audits/audit-technique-complet-2026-08-18.md).
  Menés sur un thread dédié, en parallèle de L35.
- **Révisé le 2026-08-24** : six prompts ajoutés (L45 à L50), issus de
  [`chantiers-export-analyse.md`](chantiers-export-analyse.md). L45 à L49 forment une file
  séquentielle ; L50 est différé.
- Objet : pouvoir lancer chaque chantier dans une session distincte sans le
  réexpliquer

**Avant de lancer deux lots en même temps**, vérifier le tableau de
[`lots-paralleles.md`](lots-paralleles.md) : deux lots qui touchent le même
fichier produiront un conflit de fusion, même si leurs sujets n'ont aucun
rapport. **L14, L16, L20 et L31 doivent tourner seuls.** (L26 est clos ; voir plus bas.)

> **Collisions à connaître avant d'ouvrir un thread L20 à L26** : **L21** touche les deux fichiers
> de **L4** et l'un de ceux de **L13** ; **L23** touche les deux fichiers de **L18** et **L19**.
> Solder ces quatre lots d'abord, ou commencer par **L20, L22, L24 et L25**, qui ne partagent
> aucun fichier avec le reste du plan.

> **L27 à L33 forment une file d'attente, pas un ensemble parallélisable.** `FieldForm.tsx` est
> touché par L27, L28, L30, L31 et L33 ; `exportContract.ts` par L27, L30, L31, L32 et L33. Une
> seule session à la fois sur le moteur de formulaires. **Seul L29 échappe à la règle** : il
> n'ouvre que son propre écran et tourne en parallèle de n'importe quoi.

> **L35, L36 et L37 écrivent tous dans `exportContract.ts`**, comme L22 : c'est une seconde file
> d'attente. Les prendre dans l'ordre — L35, puis L36, puis L37 — et jamais deux ensemble.

> **L38 à L44 (issus de l'audit du 18 août) tournent sur un thread séparé, en parallèle de L35.**
> Deux collisions à connaître : **L41** touche `CohortBuilder.tsx`, un des cinq fichiers de L35 —
> ne pas commencer L41 avant que L35 soit fusionné. **L41 et L42** touchent tous deux le même
> `useCallback` de `NewPatient.tsx` — ne jamais les lancer ensemble. **L40 et L44** touchent tous
> deux `src/domain/imageUpload.ts` — ne jamais les lancer ensemble non plus. Le reste (L38, L39,
> L43) est isolé et parallélisable avec tout.

> **L45 à L49 ne sont pas parallélisables entre eux** : ils écrivent dans le contrat et le
> générateur d'export. L47 requalifie L36 et L37 n'est pas à lancer pour le profil Analyse. **L50**
> est différé et ne doit pas retarder le jalon MVP L49.

Chaque prompt est autonome : le copier tel quel, dans une session ouverte sur le
dépôt. Trois clauses y reviennent volontairement à l'identique — poser les
questions avant de commencer, l'autorisation d'aller jusqu'au bout du circuit, et
la définition de « terminé ».

## État au 2026-08-10

**Vérifier cette liste avant de lancer un thread**, pour ne pas faire refaire du
travail déjà fait :

| Lot | État |
|---|---|
| L1 | **Livré** le 2026-07-28 (PR #88). Prompt conservé pour mémoire, barré ci-dessous. |
| L2 | **Livré** le 2026-07-28 (PR #89). Prompt conservé pour mémoire. |
| L3 | **Livré** le 2026-07-28 (PR #86). Aucun prompt. |
| L5 | **Livré** le 2026-07-28 (PR #91). Prompt conservé pour mémoire. |
| L6 | **Livré** le 2026-08-09 (PR #122 puis #125). Prompt conservé — c'est celui qui a produit le lot. |
| L7 | **Livré** le 2026-08-01. Prompt conservé pour mémoire. |
| L8 | **Livré** le 2026-08-01 (PR #116). Prompt conservé pour mémoire. |
| L9 | **Livré** le 2026-08-01 (migration, UI, staging et cible technique production). Prompt conservé pour mémoire. |
| L10 | **Livré** le 2026-07-29. Prompt conservé pour mémoire. |

> ⚠️ **Le tableau ci-dessus est daté du 2026-08-10 et a été dépassé.** L'état qui fait foi est la
> section « Ordre suggéré » de [`lots-paralleles.md`](lots-paralleles.md), tenue à jour : L4, L12,
> L13 et L15 à L19 y sont également marqués intégrés, et L11 est en travail. **Les lots restant à
> lancer sont L14, L20 à L26 (listes de diagnostics) et L27 à L33 (moteur de formulaires).**
> Vérifier là-bas avant d'ouvrir un thread.

**La liste ci-dessous date de la révision du 2026-08-10** : L4, L11, L12, L13, L14, les cinq
**L15, L16, L17, L18 et L19** (campagne de vérification des flux multi-comptes, cf.
[`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md)), et les sept nouveaux
**L20 à L26** (listes de diagnostics, cf.
[`spec-variables-multivaluees.md`](spec-variables-multivaluees.md)).

> **L16 est prioritaire parmi les nouveaux** : il porte une décision produit déjà tranchée par le
> porteur, que rien ne traduit encore en base. Tant que la migration n'existe pas, la
> spécification et le code se contredisent.

## Le déploiement n'est pas automatique

`vercel.json` porte `git.deploymentEnabled: false` — un contrôle de readiness
volontaire. **Fusionner vers `main` ne déploie rien.** Le seul chemin vers
l'application déployée est le workflow manuel « Coordinated release » : d'abord
`staging`, puis `production` en lui fournissant l'identifiant du run staging
réussi **pour le même commit**.

Deux conséquences pour la parallélisation :

1. **Une release déploie tout ce qui est sur `main`**, pas le lot qui la déclenche.
   Plusieurs threads qui lanceraient chacun une release de production se
   marcheraient dessus et déploieraient le travail des autres sans l'avoir
   vérifié.
2. **Un seul acteur doit déclencher la production.** Les prompts demandent donc
   à chaque lot d'aller jusqu'à `main` et de le signaler, puis de demander avant
   de déclencher une release de production si d'autres lots sont en cours.

**Au 2026-08-10 : tous les lots livrés sont en ligne.** La dernière release technique prouvée
porte le SHA `9cd3e04` du 2026-08-09 — staging (run GitHub `31289463078`) puis cible technique
`production` (run `31289908319`), le second consommant la preuve du premier sur le même SHA. Elle
a mis en ligne L1, L2, L3, L5, **L6**, L7, L8, L9 et L10.

> Attention en lisant [`etat-actuel-2026-08-01.md`](etat-actuel-2026-08-01.md) : ce document
> nomme `f0bf2af` comme dernière release prouvée. C'était vrai à sa date, ça ne l'est plus.
>
> Et surtout, **ne pas conclure d'un échec de « Coordinated release » que rien n'est parti.** La
> release du 2026-08-09 a échoué **deux fois** avant de passer (runs `31288508289` et
> `31289034926`, à 01h33 et 01h48), sur l'activation stricte : « Scanner strict injoignable ».
> Le tunnel Cloudflare a été renouvelé et les deux exécutions suivantes ont réussi. Chercher les
> exécutions **réussies** du workflow, pas seulement les rouges :
>
> ```bash
> gh run list --workflow="Coordinated release" --limit 30
> ```

**Le point de fragilité réel n'est pas la publication, c'est le scanner.** Il est exposé par un
tunnel `trycloudflare` **temporaire**, monté à la main pour faire passer cette release. Son nom
de domaine cesse de résoudre alors que le processus vit encore — c'est ce qui a provoqué les deux
échecs ci-dessus. Toute release future butera dessus tant qu'un tunnel nommé ou un petit VPS n'aura
pas remplacé le montage éphémère. Procédure de renouvellement d'urgence dans
[`edge-functions.md`](edge-functions.md).

---

## ~~L1 — Liste d'une base : affichage et bandeau~~ — livré

Livré le 2026-07-28 : `String(v)` remplacé par `displayFieldValue` dans
`BaseHome.tsx` et `EditEncounter.tsx`, bandeau hors-ligne resserré, tests ajoutés
dans `Patients.test.tsx`. **Ne pas relancer ce prompt** — conservé uniquement
comme modèle pour les lots suivants.

```
Tu reprends un correctif sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L1) et docs/idees-post-readiness.md (défauts D5 et D3).

PÉRIMÈTRE — deux corrections dans src/screens/member/BaseHome.tsx :

1. D5. À la ligne 358, la fonction d'affichage des valeurs se termine par
   `return String(v)`. Les variables de type `terminology` sont stockées sous
   forme d'objet {code, label} : elles s'affichent donc « [object Object] »
   dans la liste des patients d'une base. La fonction `displayFieldValue` existe
   déjà dans src/data/types.ts et est employée correctement par la fiche patient
   (PatientDetail) — il s'agit de l'utiliser ici aussi.
   Vérifie au passage src/screens/member/EditEncounter.tsx ligne 45, qui termine
   par le même `String(v)` : même défaut, même correction.

2. D3. Le bandeau « Rendre disponible hors-ligne » (autour de la ligne 216)
   occupe toute la largeur en permanence, pour une action occasionnelle. Réduis
   son emprise sans supprimer la fonctionnalité ni la rendre difficile à trouver.

Ajoute au moins un test web qui échoue avant ta correction : une valeur de
terminologie doit apparaître par son libellé dans la liste des patients.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin —
comportement attendu, cas limites, forme visuelle du bandeau. Ne code rien tant
que tu n'as pas mes réponses. Si une question ne se pose qu'en cours de route,
fais d'abord tout ce qui n'en dépend pas, puis demande.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le correctif est sur main, puis DÉPLOYÉ et vérifié sur
l'application déployée — pas seulement un build vert. Tu ne t'arrêtes pas avant.
Avant de déclencher la release de production, demande-moi si d'autres lots sont
en cours : une release déploie tout ce qui est sur main, pas seulement ton lot.
Si une commande t'est refusée par ton environnement, donne-la-moi telle quelle
plutôt que de chercher un contournement.

Ne touche à aucun fichier hors de ce périmètre. Si tu ajoutes du texte dans
src/i18n/messages.ts, ajoute tes clés à la FIN de chaque section : ce fichier est
modifié par d'autres chantiers en parallèle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L45 — Contrat des profils Export Analyse / Export complet

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord les instructions du dépôt, puis la
fiche L45 de docs/lots-paralleles.md et la spécification
docs/chantiers-export-analyse.md.

AVANT DE CODER : vérifie le contrat actuel de generate-export, le payload de
l'Edge Function, le repository frontend et la journalisation export_log. Pose
les questions nécessaires si le nom du profil ou le point d'entrée utilisateur
n'est pas déterminable. Ne modifie pas encore le format des colonnes : ce lot
fixe le profil et son acheminement ; les lots L46 à L49 portent les formes de
données.

OBJECTIF.

1. Ajouter deux profils explicites : `analysis` et `complete`.
2. Faire de `analysis` le profil par défaut pour un appel sans profil.
3. Conserver le comportement actuel sous `complete` pendant la transition.
4. Enregistrer le profil dans `export_log.export_options` et le rendre
   identifiable dans le nom du fichier ou ses métadonnées.
5. Conserver strictement les contrôles d'accès, la liste anti-identité, le
   figeage, le hash, l'upload privé et la journalisation existants.

PÉRIMÈTRE INTERDIT : ne supprime pas encore les colonnes actuelles, ne change
pas la sémantique des multiselect, ne modifie pas les migrations déjà appliquées
et ne déplace aucune garantie de sécurité vers l'interface.

COUVERTURE EXIGÉE : payload absent, `analysis`, `complete`, format CSV et XLSX,
profil inscrit dans le journal, refus d'un profil inconnu, absence d'identité
dans les deux profils, compatibilité d'un ancien appel.

TERMINÉ SIGNIFIE : contrat et acheminement testés localement, documentation du
lot mise à jour, tests ciblés verts. Ne committe, ne pousse et ne déploie rien
sans demande explicite.
```

---

## L46 — Identifiants analytiques, colonnes et feuille `Modalités`

```
Tu reprends un chantier sur MedData. Lis les instructions du dépôt, puis L46 dans
docs/lots-paralleles.md et docs/chantiers-export-analyse.md. L45 doit être livré
ou son contrat doit être présent avant de commencer. Ne lance pas ce lot en
parallèle de L35, L36, L37 ou L47-L49 : tous touchent le contrat d'export.

OBJECTIF.

1. Définir pour chaque variable un identifiant analytique court, ASCII, unique
   et stable, distinct du libellé humain et des UUID techniques.
2. Dans le profil `analysis`, écrire le code stable d'un `select` dans
   `Données`, sans répéter son libellé sur chaque ligne.
3. Produire une feuille `Modalités` documentant variable, code, libellé, ordre
   et état actif.
4. Conserver dans `complete` les colonnes techniques nécessaires à la
   réimportation et à la traçabilité.
5. Préserver l'interprétation des anciens gabarits et refuser explicitement les
   collisions d'identifiants.

DÉCISION DE STOCKAGE : si un identifiant analytique est ajouté au gabarit, la
   migration doit être additive, compatible avec les versions historiques et
   non appliquée à distance. Si un repli déterministe suffit, documente-le et
   n'ajoute pas de colonne inutile.

COUVERTURE EXIGÉE : changement de libellé sans changement de code, option
 inactive, modalités de deux versions, collision, CSV/XLSX, export sans UUID
 ni identité, dictionnaire cohérent avec `Modalités`.

TERMINÉ SIGNIFIE : tests ciblés verts et exemple d'Export Analyse lisible sans
connaître les identifiants internes. Ne committe, ne pousse et ne déploie rien
sans demande explicite.
```

---

## L47 — Multiselect en indicatrices binaires dans le profil Analyse

```
Tu reprends un chantier sur MedData. Lis les instructions du dépôt, la fiche L47
et la section Export Analyse de docs/chantiers-export-analyse.md. L45 doit être
livré. Ce lot requalifie L36 : ne lance pas les deux ensemble, ni avec L22 ou
L35. Ne touche ni à la validation serveur, ni au stockage hors-ligne, ni au
constructeur de formulaire sauf preuve qu'un contrat existant l'exige.

OBJECTIF DU PROFIL `analysis`.

1. Retirer de la feuille principale les libellés concaténés, codes concaténés,
   compteurs et feuilles relationnelles multiselect.
2. Produire une colonne indicatrice par code effectivement exporté.
3. Initialiser chaque indicatrice à `0` pour un champ applicable.
4. Passer l'indicatrice à `1` si le code est sélectionné ; une liste vide et
   toute modalité non sélectionnée restent donc à `0`.
5. Réserver une cellule vide à un champ non applicable ou absent de la version
   de gabarit. Une raison explicite de valeur manquante suit le codage prévu
   par le dictionnaire et ne doit jamais devenir une sélection.
6. Conserver toutes les formes sans perte dans `complete`.
7. Au-delà du seuil de cardinalité, échouer explicitement ou demander une
   sélection ; ne jamais tronquer silencieusement.

Ne transforme pas un `0` en valeur manquante et ne supprime pas une variable
conditionnelle. Vérifie le plafond de cellules XLSX et la neutralisation des
formules.

COUVERTURE EXIGÉE : liste vide, valeur absente sur un champ applicable,
modalité sélectionnée/non sélectionnée, champ non applicable, raison de manque,
codes inconnus historiques, collision de suffixes, zéro et un numériques,
plus de 100 codes, CSV/XLSX, profil `complete` inchangé.

TERMINÉ SIGNIFIE : les indicatrices non sélectionnées sont bien `0` dans le
fichier lu par le test, sans perte dans `complete`, et tous les tests ciblés
sont verts. Ne committe, ne pousse et ne déploie rien sans demande explicite.
```

---

## L48 — Dates XLSX natives, CSV ISO et unités des durées

```
Tu reprends un chantier sur MedData. Lis les instructions du dépôt, la fiche L48
et docs/chantiers-export-analyse.md. L45 doit être livré. Ne lance pas ce lot en
parallèle de L35 ni d'un autre lot qui modifie exportContract.ts.

OBJECTIF.

1. Dans XLSX, écrire les dates et datetime comme valeurs Excel natives, avec un
   format d'affichage lisible mais sans les convertir en texte.
2. Dans CSV, conserver une représentation ISO documentée et déterministe.
3. Garder les nombres, compteurs et indicatrices comme valeurs numériques.
4. Documenter l'unité de chaque durée calculée dans le dictionnaire et, si
   nécessaire, dans l'identifiant analytique.
5. Fixer explicitement le traitement des fuseaux et secondes pour les datetime.

PÉRIMÈTRE INTERDIT : ne change pas la formule métier d'une variable sans
spécification ; ne masque pas une valeur invalide par zéro ; ne neutralise pas
la protection anti-formule des textes.

COUVERTURE EXIGÉE : date, datetime, date invalide, durée entière, durée
fractionnaire, valeur vide, CSV, XLSX relu par SheetJS, type de cellule Excel,
tri et soustraction possibles dans un classeur.

TERMINÉ SIGNIFIE : le test prouve le type natif XLSX et l'unité de la durée,
avec tests ciblés verts. Ne committe, ne pousse et ne déploie rien sans demande
explicite.
```

---

## L49 — Dictionnaire simplifié et feuille `Métadonnées`

```
Tu reprends un chantier sur MedData. Lis les instructions du dépôt, la fiche L49
et docs/chantiers-export-analyse.md. L45 à L48 doivent être livrés dans l'ordre.
Ne lance pas ce lot en parallèle d'un autre lot qui modifie exportContract.ts ou
handler.ts.

OBJECTIF DU PROFIL `analysis`.

1. Produire les quatre feuilles : `Données`, `Dictionnaire`, `Modalités`,
   `Métadonnées`.
2. Garder dans le dictionnaire uniquement variable, libellé, description,
   section, type, unité, formule, valeurs autorisées et valeurs manquantes,
   plus les informations nécessaires à l'interprétation.
3. Déplacer les informations globales dans `Métadonnées` : profil, date,
   modèle d'observation, population, versions de gabarit, nombre de lignes,
   exclusions et règle de sélection.
4. Documenter chaque colonne de `Données`, y compris les indicatrices et les
   colonnes calculées.
5. Conserver les variables conditionnelles même si elles sont vides et
   conserver le dictionnaire détaillé dans `complete`.

VÉRIFICATIONS : aucune identité, date de naissance exacte, image, document,
UUID technique ou secret dans les feuilles ; les exclusions restent
explicables ; les versions historiques restent documentées ; les limites XLSX
restent appliquées.

COUVERTURE EXIGÉE : export vide, variable conditionnelle vide, plusieurs
versions de gabarit, formule, indicatrice, modalité inactive, CSV et XLSX,
cohérence entre colonnes, dictionnaire et métadonnées.

TERMINÉ SIGNIFIE : le classeur Analyse est autonome pour un analyste et les
tests ciblés sont verts. Ne committe, ne pousse et ne déploie rien sans demande
explicite.
```

---

## L50 — Concepts diagnostiques et référentiel terminologique

```
Ce lot est différé. Ne le lance que lorsque L45 à L49 sont livrés et après
confirmation explicite du besoin de référentiel diagnostique.

Lis les instructions du dépôt, L50 dans docs/lots-paralleles.md et la section
L50 de docs/chantiers-export-analyse.md. Le lot touche à la fois le référentiel,
la saisie et l'export ; il ne s'agit pas d'un simple renommage de colonnes.

OBJECTIF.

1. Définir un concept diagnostique stable, distinct du libellé et des synonymes.
2. Conserver le libellé préféré, les synonymes explicitement validés, le système
   terminologique, le code et l'historique des versions.
3. Utiliser l'identifiant canonique dans l'Export Analyse et documenter le
   libellé dans une feuille `Terminologie` si elle est nécessaire.
4. Ne jamais fusionner deux diagnostics sur simple ressemblance lexicale.

SÉCURITÉ DES DONNÉES : toute évolution de schéma est additive et nécessite une
nouvelle migration ; ne modifie pas une migration appliquée et ne fais pas
reposer l'intégrité sur l'interface. Les anciennes valeurs doivent rester
interprétables.

COUVERTURE EXIGÉE : synonyme vers un même concept, concepts proches mais
distincts, changement de libellé, code terminologique absent, historique de
version, CSV/XLSX, règles RLS/RPC si elles sont touchées.

TERMINÉ SIGNIFIE : référentiel gouverné, contrat d'export documenté, tests
ciblés verts et aucune fusion automatique non justifiée. Ne committe, ne pousse
et ne déploie rien sans demande explicite.
```

---

## ~~L2 — Formulaires patient : sections~~ — livré

> **Livré** le 2026-07-28 (PR #89). **Ne pas relancer ce prompt.**

```
Tu reprends un correctif sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L2) et docs/idees-post-readiness.md (défaut D4).

PÉRIMÈTRE — src/screens/member/NewPatient.tsx et src/screens/member/EditPatient.tsx.

Les variables d'une rencontre sont regroupées par section (clinique, biologie,
paraclinique) ; les variables permanentes du patient ne le sont pas — elles
arrivent en liste plate. L'incohérence se voit dès qu'une base a plus de quelques
variables, et elle gêne particulièrement les études transversales, où presque
tout est porté par la fiche patient.

Le regroupement existe déjà, écrit dans src/screens/member/EncounterFields.tsx :
reprends-le plutôt que d'en écrire un second. N'affiche que les sections non
vides.

Ajoute un test web qui vérifie le regroupement et l'absence des sections vides.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — ordre des
sections, sort des variables sans section, faut-il factoriser le regroupement
dans un composant commun. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le correctif est en production et tu l'as vérifié en
regardant l'application déployée. Tu ne t'arrêtes pas avant. Si une commande
t'est refusée par ton environnement, donne-la-moi telle quelle plutôt que de
chercher un contournement.

Ne touche à aucun fichier hors de ce périmètre — en particulier PAS
EncounterFields.tsx, que le lot L4 modifie en parallèle. Si tu dois y toucher,
demande-moi d'abord. Clés i18n : à la FIN de chaque section de messages.ts.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L4 — Soupape sur le champ de terminologie

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L4) et docs/idees-post-readiness.md (idée 6).

CONTEXTE. Une « soupape » existe déjà pour les listes contrôlées : quand la
valeur voulue n'est pas dans la liste, l'utilisateur peut la proposer. Le point
essentiel, décidé par le porteur : la proposition n'est JAMAIS écrite dans le
champ lui-même — elle part dans un champ compagnon, pour que la variable
contrôlée reste exploitable en analyse. Implémentation actuelle :
- src/screens/member/ChoiceWithProposal.tsx (le composant)
- src/domain/proposalField.ts (PROPOSAL_SUFFIX = '_autre', makeProposalField,
  qui ne rend jamais le champ compagnon obligatoire)
- src/screens/staff/FieldForm.tsx (activation à la création d'une variable)

PÉRIMÈTRE. Étendre cette soupape au type `terminology`, aujourd'hui non couvert :
un diagnostic absent du référentiel ne peut pas être signalé. La saisie de
terminologie se fait dans src/screens/member/TerminologyInput.tsx.

Contrainte non négociable : la proposition ne doit rien écrire dans le champ de
terminologie. Le serveur refuserait de toute façon — assert_data_valid n'accepte
qu'un couple {code, label} sélectionnable — mais l'interface ne doit même pas
l'essayer.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : la fonctionnalité est en production et tu l'as essayée sur
l'application déployée. Tu ne t'arrêtes pas avant. Si une commande t'est refusée
par ton environnement, donne-la-moi telle quelle plutôt que de chercher un
contournement.

Ne touche pas à src/data/terminologyCache.ts (lot L13) ni à BaseHome.tsx (L1).
Clés i18n : à la FIN de chaque section de messages.ts.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L5 — Constructeur de règles de cohérence~~ — livré

> **Livré** le 2026-07-28 (PR #91). **Ne pas relancer ce prompt.**

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L5) et docs/idees-post-readiness.md (idée 7).

PROBLÈME. Pour poser une règle de cohérence sur une base, l'utilisateur doit
taper du JSON à la main. src/screens/staff/RuleForm.tsx ligne 6 donne le ton :

  {"operator":"greater_or_equal","left_field":"discharge_date",
   "right_field":"admission_date"}

Le produit s'adresse à des médecins-chercheurs. Cette zone est illisible pour
eux, et c'est pourtant là que se joue la qualité des données.

PÉRIMÈTRE. Remplacer la saisie libre par un assemblage guidé — choisir un
opérateur, puis les variables concernées, dans des listes. Les opérateurs
autorisés sont définis dans src/domain/templateRules.ts.

Deux contraintes :
- la sortie doit rester exactement le même JSON qu'aujourd'hui, pour ne rien
  casser des règles déjà enregistrées ;
- `parseRule` reste la validation côté client ; le serveur demeure la source de
  vérité. Ne déplace aucun contrôle vers l'interface seule.

Prévois une porte de sortie pour les cas non couverts par l'assemblage guidé.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — notamment
la formulation des opérateurs en langage clinique, et s'il faut garder l'accès au
JSON brut. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : la fonctionnalité est en production et tu as créé une vraie
règle depuis l'application déployée pour le vérifier. Tu ne t'arrêtes pas avant.
Si une commande t'est refusée par ton environnement, donne-la-moi telle quelle
plutôt que de chercher un contournement.

Clés i18n : à la FIN de chaque section de messages.ts.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L6 — Finition de l'interface : présence, rythme et densité~~ — livré le 2026-08-09

Livré en deux temps : « Améliore et harmonise tous les écrans » (PR #122) puis « Finalise
l'accessibilité mobile » (PR #125). Composant `Checkbox` commun créé, zone de profil refondue,
squelettes généralisés, densité et gabarits repris sur une trentaine d'écrans. **Ne pas
relancer ce prompt** — il est conservé parce que c'est lui qui a produit le lot, et qu'il sert
de modèle pour un chantier d'interface transversal.

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L6) et docs/idees-post-readiness.md (idée 10).

MISSION. La base fonctionnelle est bonne, mais l'interface manque de présence et
reste trop chargée, sur mobile comme sur ordinateur. L'objectif n'est pas de
« refaire le design » : rends les informations importantes immédiatement lisibles,
allège les écrans les plus denses et installe des règles visuelles cohérentes.
Préserve les parcours, les droits, les données, les libellés métier et les
comportements existants.

ATTENTION : ce lot est transversal et touche des composants partagés ainsi que
plusieurs écrans. Il doit tourner SEUL. Avant toute écriture, inspecte `git
status`, les worktrees et les fichiers déjà modifiés ; vérifie avec moi qu'aucun
autre chantier ne risque de toucher les mêmes surfaces.

PÉRIMÈTRE — quatre axes cohérents, à vérifier dans le code courant avant de les
modifier.

1. PROFIL ET HIÉRARCHIE DANS LE MENU

   Dans `src/components/AppShell.tsx`, autour de la ligne 170, le bloc nom + rôle
   n'a ni fond ni bordure, alors que le bloc thème/langue juste au-dessus porte
   une séparation. En thème clair, le rôle gris se perd. C'est pourtant la
   réponse à « qui suis-je, avec quels droits ? », essentielle dans une
   application où le rôle détermine ce qui est visible.

   Donne à ce bloc une assise visuelle légère et cohérente avec les primitives
   existantes : fond discret, séparation ou bordure, contraste suffisant et rôle
   lisible comme une information portante. Le résultat doit rester sobre en
   clair comme en sombre, sans faire croire à une action cliquable s'il n'en est
   pas une.

2. CASES À COCHER COHÉRENTES ET ACCESSIBLES

   Les cases à cocher natives du système sont aujourd'hui disséminées dans les
   écrans. Recense leur nombre et leurs contextes dans l'état courant — les
   comptes historiques ne remplacent pas cet inventaire — puis crée un composant
   réutilisable et remplace les occurrences dans le périmètre vérifié.

   Le composant doit préserver les labels associés, la sémantique native, le
   clavier, lecteur d'écran, états coché/non coché/indéterminé si un appelant en
   a besoin, état désactivé et validation existante. Il doit fournir une cible
   tactile confortable (au moins 44 × 44 px pour la zone interactive ou son
   label), un focus visible et un rendu cohérent en clair et sombre. Ne simule
   pas une case par un `div` et ne déplace pas la logique métier ou les droits
   dans ce composant de présentation.

3. RETOURS D'ÉTAT UTILES, SANS DÉCORATION

   L'application utilise peu ses composants de chargement : `Skeleton` et
   `SkeletonList` existent déjà dans `src/components/Skeleton.tsx`. Repère les
   écrans du périmètre qui affichent encore un texte de chargement ou une zone
   vide, puis applique les squelettes là où ils expliquent réellement l'attente,
   en particulier dans un pilote représentatif avant généralisation.

   Ajoute seulement les transitions CSS qui confirment une action ou expliquent
   un changement d'état : retour pressé/focus d'un bouton, apparition discrète
   d'une liste une fois chargée, confirmation brève après un enregistrement,
   ouverture et fermeture d'un panneau. Réutilise les mécanismes de notification
   et les classes existants avant d'en créer de nouveaux. Aucune bibliothèque
   d'animation, aucune animation d'entrée systématique des cartes, aucun effet
   permanent, aucune animation qui ralentit la saisie. Toutes les animations
   ajoutées doivent être neutralisées par `prefers-reduced-motion`.

4. DENSITÉ, GABARITS ET COHÉRENCE DES ÉCRANS

   Les écrans paraissent surchargés et leurs éléments n'ont pas de gabarit
   homogène : tailles de cartes et de statistiques du tableau de bord, boutons,
   tableaux de bases, blocs d'actions, espacements et titres varient sans règle
   visible. Examine les composants et écrans réellement concernés, en vue mobile
   et bureau, puis établis un petit système de règles réutilisables à partir des
   primitives déjà présentes (`card`, `surface-muted`, boutons, échelles Tailwind
   ou CSS du projet). N'introduis pas un nouveau design system ni une couche de
   composants abstraits sans besoin démontré.

   Applique ce système seulement aux surfaces représentatives et chargées du
   périmètre L6, notamment le tableau de bord et les vues de base si elles sont
   confirmées par l'inspection. Les priorités sont :
   - une hiérarchie claire entre information principale, informations secondaires
     et actions ;
   - des tailles, hauteurs, alignements et espacements cohérents pour les cartes,
     statistiques, boutons, tableaux et en-têtes comparables ;
   - moins de bruit permanent : actions secondaires regroupées ou visuellement
     reculées, sans les cacher ni en dégrader la découvrabilité ;
   - des tableaux utilisables sur petit écran (lecture, défilement et actions
     accessibles) sans réduire le texte à une taille illisible ;
   - aucun contenu clinique important masqué, tronqué sans moyen de le lire, ni
     action critique reléguée hors du flux.

   Ne fais pas une correction cosmétique écran par écran. Corrige d'abord les
   primitives ou règles communes qui causent les incohérences, puis applique-les
   aux écrans pilotes. Si une uniformisation exige de modifier un écran hors du
   périmètre inspecté ou de changer un parcours métier, arrête-toi et demande mon
   accord avant de l'élargir.

MÉTHODE ET PREUVE ATTENDUE.

1. Commence par un diagnostic bref et concret : inventaire des cases à cocher,
   écrans denses, chargements, primitives réutilisables et éventuels conflits de
   travail. Ne présume pas que les décomptes ou lignes documentés sont encore à
   jour.
2. Propose un pilote visuel limité mais représentatif (profil/menu, un écran de
   permissions avec cases actives et désactivées, un chargement, et un écran
   dense tel que le tableau de bord ou une base). Montre précisément les fichiers
   et règles que tu comptes modifier, ainsi que ce qui restera explicitement hors
   périmètre.
3. AVANT DE COMMENCER À CODER, pose-moi toutes les questions réellement
   bloquantes et attends mes réponses. Ne crée ni branche, ni fichier, ni
   modification, ni commit avant cet accord. Après accord sur le pilote, réalise
   le pilote, démontre-le, puis demande l'accord avant toute généralisation aux
   autres écrans.
4. Ajoute des tests web ciblés là où le comportement est automatisable :
   association label/case, navigation clavier et état désactivé ; présence des
   structures de chargement ; états ou classes qui garantissent la réduction des
   animations. Les appréciations de densité et de rendu ne se déduisent pas de
   jsdom : vérifie-les visuellement sur les largeurs mobile et bureau, dans les
   thèmes clair et sombre, avec des données fictives représentatives.

CRITÈRES D'ACCEPTATION.

- Le profil est repérable, contrasté et sobre dans les deux thèmes ; son rôle est
  lisible et ne ressemble pas à une action.
- Toutes les cases natives recensées dans le périmètre utilisent le composant
  partagé, sans régression de formulaire, de clavier, d'accessibilité ou d'état
  désactivé.
- Les chargements et changements d'état importants donnent un retour perceptible
  mais non décoratif ; `prefers-reduced-motion` est couvert et aucune dépendance
  d'animation n'est ajoutée.
- Les écrans pilotes sont sensiblement moins denses et plus cohérents à 320–375
  px comme sur bureau : gabarits comparables, actions hiérarchisées, tableaux
  lisibles et aucune information ou action clinique critique perdue.
- Les captures ou observations de vérification montrent chaque état pertinent :
  clair/sombre, mobile/bureau, focus clavier, case désactivée, chargement et
  panneau ouvert si modifié.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : les changements sont en production et tu les as regardés sur
l'application déployée, dans les deux thèmes (clair et sombre). Tu ne t'arrêtes
pas avant. Si une commande t'est refusée par ton environnement, donne-la-moi
telle quelle plutôt que de chercher un contournement.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L7 — Protections de branche (B7)~~ — livré le 2026-08-01

Prompt conservé pour mémoire. **Ne pas le relancer.**

```
Tu reprends le dernier bloquant de gouvernance du projet MedData
(registre-clinique). Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L7) et cherche B7 dans le dossier de readiness sous docs/.

CONTEXTE. B7 était en pause parce que les règles de protection de branche étaient
payantes sur dépôt privé. Le dépôt est passé public le 2026-07-28 : elles sont
désormais gratuites. Depuis le 26 juillet, la discipline « CI verte avant
fusion » est tenue à la main ; il s'agit de la remplacer par un mécanisme
technique.

PÉRIMÈTRE. Aucun fichier de code n'est modifié. Ce lot peut donc tourner en
parallèle de n'importe quel autre.

À faire :
- activer les protections sur main ET develop (pull request obligatoire, checks
  de CI exigés, pas de force-push) ;
- vérifier avec `npm run github:controls:verify`, qui existe déjà, et corriger si
  le script attend autre chose que ce que tu as posé ;
- consigner la preuve dans le dossier de readiness, au format des preuves
  existantes (B1, B3, B4, B8, B9) ;
- marquer B7 fermé.

Attention : une fois les protections actives, tu ne pourras plus fusionner sans
CI verte. C'est le but. Vérifie que le circuit branche -> develop -> main
fonctionne encore après activation, en conditions réelles.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — quels
checks rendre obligatoires, faut-il exiger une revue, faut-il inclure les
administrateurs. Ne modifie rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à modifier la configuration GitHub du dépôt, à
committer et pousser la preuve, et à mener le circuit jusqu'à main, sans me
redemander à chaque étape.

TERMINÉ SIGNIFIE : les protections sont actives, vérifiées par le script, la
preuve est consignée, B7 est fermé, et tu as confirmé qu'une pull request ne peut
plus être fusionnée avec une CI rouge. Tu ne t'arrêtes pas avant. Si une commande
t'est refusée par ton environnement, donne-la-moi telle quelle plutôt que de
chercher un contournement.
```

---

## ~~L8 — Suppression et restauration de bases (P2)~~ — livré le 2026-08-01

Livré par la PR #116 : RPC de restauration (`20260801140238_restore_deleted_base.sql`),
corbeille et geste de restauration dans `Dashboard.tsx` et `BaseHome.tsx`, entrée ajoutée à
`security-definer-allowlist.json`, tests base et web. Prompt conservé pour mémoire. **Ne pas le
relancer.**

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L8) et la fiche P2 dans docs/suivi-execution-feuille-route.md.

Ce lot touche la base de données : charge la Skill meddata-db-safety et
applique-la.

CONTEXTE. La fonction serveur `soft_delete_base` existe déjà, complète et
sécurisée — voir supabase/migrations/20260616096000_soft_delete_base.sql. Il
manque la fonction de restauration et toute l'interface. Aujourd'hui, une base
créée par erreur ne peut pas être retirée par son propriétaire.

PÉRIMÈTRE :
- une RPC de restauration, symétrique de la suppression, avec les mêmes
  contrôles d'autorisation ;
- l'interface : suppression depuis src/screens/member/BaseHome.tsx, et un endroit
  où retrouver et restaurer une base supprimée ;
- les tests RLS correspondants dans test/.

RÈGLES ABSOLUES :
- ne modifie JAMAIS une migration existante : crée une nouvelle migration
  horodatée, additive, compatible avec les données en place ;
- la base et l'autorisation serveur sont la source de vérité. Ne déplace ni RLS,
  ni idempotence, ni contrôle de concurrence vers l'interface ;
- un lot qui ajoute une migration doit lancer `npm run schema`, `npm run build`
  et `npm run manifest` avant de fusionner — sans quoi la release coordonnée
  échouera sur un instantané de schéma périmé. C'est déjà arrivé.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — qui a le
droit de supprimer, qui a le droit de restaurer, délai avant purge définitive,
que devient une base supprimée pour ceux à qui elle était partagée. Ne code rien
tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner, promouvoir jusqu'à main, ET à appliquer la
migration sur le cloud — staging d'abord, production ensuite, via la release
coordonnée du projet. Tu n'as pas besoin de me redemander à chaque étape.

CONDITIONS :
- la CI doit être verte. Si elle est rouge, tu corriges la cause — tu ne
  fusionnes pas, et tu ne désactives pas le contrôle ;
- la production passe APRÈS un staging réussi. Ne court-circuite pas cet ordre :
  c'est ce qui a rattrapé une erreur de séquence par le passé.

TERMINÉ SIGNIFIE : la migration est appliquée en production, l'interface est
déployée, et tu as supprimé puis restauré une base de test sur l'application
déployée pour le vérifier. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée par ton environnement — c'est fréquent sur les opérations destructrices —
donne-moi le SQL et la commande exacts plutôt que de chercher un contournement.

Rappel : uniquement des données fictives. Ne touche pas à BaseHome.tsx si le lot
L1 est en cours ; demande-moi.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L9 — Modèle d'observation d'une base~~ — livré le 2026-08-01

Le prompt ci-dessous est conservé pour mémoire. L9 a été validé en staging et sur la cible
technique production avec une base transverse fictive et une base longitudinale existante.
**Ne pas le relancer.**

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L9) et docs/idees-post-readiness.md (idée 8), qui contient le cadrage.

ATTENTION : ce lot touche une migration et trois écrans. Il doit tourner SEUL, et
APRÈS le lot L2 (sections dans les formulaires patient), qui lui sert de
préalable. Vérifie avec moi que L2 est fusionné avant de commencer.

Ce lot touche la base de données : charge la Skill meddata-db-safety.

PROBLÈME, tel que le porteur l'a formulé. Chaque base impose aujourd'hui un suivi
longitudinal : un patient, puis des rencontres. Or la plupart des études sont
transversales — une observation, une fois. L'utilisateur doit alors créer une
rencontre unique et factice, ce qui est un contournement, pas un usage.

PÉRIMÈTRE. Rendre le modèle d'observation explicite au niveau de la base :
étude transversale, suivi répété, ou registre d'événements. En mode transversal,
masquer la notion de portée et l'ajout de rencontre, et présenter un formulaire
unique correctement sectionné.

Fichiers concernés : une migration additive, src/screens/member/NewPatient.tsx,
src/screens/staff/FieldForm.tsx, src/screens/member/BaseHome.tsx.

RÈGLES ABSOLUES :
- ne modifie JAMAIS une migration existante : nouvelle migration horodatée,
  additive, compatible avec les bases DÉJÀ créées — elles doivent continuer de
  fonctionner exactement comme avant ;
- lance `npm run schema`, `npm run build` et `npm run manifest` avant de
  fusionner ;
- ne casse aucune interface existante.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — le modèle
est-il choisi à la création et figé ensuite, ou modifiable ; que devient une base
existante ; les trois modes suffisent-ils. Ne code rien tant que tu n'as pas mes
réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner, promouvoir jusqu'à main, ET à appliquer la
migration sur le cloud — staging d'abord, production ensuite, via la release
coordonnée. Tu n'as pas besoin de me redemander à chaque étape.

CONDITIONS :
- la CI doit être verte. Si elle est rouge, tu corriges la cause ;
- la production passe APRÈS un staging réussi.

TERMINÉ SIGNIFIE : la migration est en production, l'interface est déployée, et
tu as créé une base transversale ET vérifié qu'une base longitudinale existante
fonctionne toujours, sur l'application déployée. Tu ne t'arrêtes pas avant. Si
une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L10 — Comptes de mission (P4)~~ — livré le 2026-07-29

Prompt conservé pour mémoire. **Ne pas le relancer.** Le rôle a depuis été vérifié à la main de
bout en bout (2026-08-09) : la chaîne fonctionne, mais quatre écarts ont été trouvés et sont
traités par **L15** et **L16** ci-dessous — cf.
[`chantiers-interactions-comptes.md`](chantiers-interactions-comptes.md).

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/spec-comptes-mission.md
IN EXTENSO — la conception est déjà faite, ne la refais pas — et
docs/lots-paralleles.md (section L10).

Ce lot touche la base de données et une Edge Function : charge la Skill
meddata-db-safety.

BESOIN. Un médecin confie la saisie d'UNE base à un étudiant, pour une durée
limitée, révocable.

DÉCISION DÉJÀ PRISE, ne la rouvre pas : l'étudiant CRÉE des patients, en création
minimale, et n'accède JAMAIS à l'identité nominative. Il écrit donc dans
`patient` et `encounter`, jamais dans `patient_identity`. C'est cette exclusion
qui rend la permission acceptable — le saisisseur alimente le registre sans
savoir de qui il s'agit. Toute proposition qui affaiblit ce point est à écarter.

CE QUI EXISTE DÉJÀ : `base_access`, les invitations expirables, la révocation,
l'audit. Ne les réinvente pas.

CE QUI MANQUE : un rôle global dédié, une permission de création séparée, une
expiration d'accès, et une Edge Function d'invitation idempotente.

CINQ DÉCISIONS SECONDAIRES restent ouvertes en section 12 de la spec (durée
maximale, lecture d'identité sur option, upload de documents, délai de purge, nom
du rôle). Chacune a une recommandation. Pose-les-moi au début — elles ne bloquent
pas le démarrage, mais je veux trancher avant que tu écrives la migration.

RÈGLES ABSOLUES :
- nouvelle migration horodatée, additive ; ne modifie JAMAIS une migration
  existante ;
- les tests RLS de la section 10 de la spec sont exigés, pas optionnels : un
  compte de mission qui accède à l'identité, ou à une base qui n'est pas la
  sienne, doit être refusé PAR LA BASE, pas par l'interface ;
- lance `npm run schema`, `npm run build`, `npm run manifest` et
  `npm run release:edge:check` avant de fusionner ;
- aucun secret, aucune clé service_role côté frontend ou dans les logs.

AVANT DE COMMENCER : pose-moi les cinq décisions ouvertes, plus toutes les
questions dont tu as besoin. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner, promouvoir jusqu'à main, à déployer l'Edge
Function, ET à appliquer la migration sur le cloud — staging d'abord, production
ensuite, via la release coordonnée. Tu n'as pas besoin de me redemander à chaque
étape.

CONDITIONS :
- la CI doit être verte. Si elle est rouge, tu corriges la cause ;
- la production passe APRÈS un staging réussi.

TERMINÉ SIGNIFIE : la migration et l'Edge Function sont en production,
l'interface est déployée, et tu as créé un compte de mission de test, vérifié
qu'il peut saisir sur sa base, qu'il ne voit aucune identité, qu'il ne voit pas
les autres bases, et que la révocation fonctionne. Tu ne t'arrêtes pas avant. Si
une commande t'est refusée, donne-la-moi telle quelle.

Rappel : uniquement des données fictives.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L11 — Observabilité des erreurs (P3)

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-observabilite-erreurs.md IN EXTENSO — la conception est déjà faite — et
docs/lots-paralleles.md (section L11).

Ce lot touche la base de données : charge la Skill meddata-db-safety.

PROBLÈME. Les plantages d'écran sont captés localement par
src/components/ErrorBoundary.tsx, mais RIEN ne remonte au porteur : si un
utilisateur rencontre une erreur, personne ne l'apprend. Les erreurs
d'arrière-plan ne sont pas captées du tout.

PÉRIMÈTRE, dans l'ordre : un filet global, un puits interne respectueux de la vie
privée, puis un écran « État du système » réservé à l'administration.

CONTRAINTE CENTRALE, non négociable : aucune donnée médicale, aucune donnée
identifiante, aucun secret et aucune erreur interne brute ne doit se retrouver
dans le journal d'erreurs. C'est un journal d'incidents, pas un journal de
contenu. Traite cette contrainte comme la partie difficile du lot, pas comme une
formalité — c'est elle qui décide si la fonctionnalité est acceptable.

SEPT DÉCISIONS restent ouvertes dans la spec. Pose-les-moi au début.

DÉPENDANCE : l'alerte distante dépend du bloquant B5, encore ouvert. Les étapes
locales sont réalisables sans lui — fais-les, et arrête-toi proprement à la
frontière plutôt que d'anticiper.

RÈGLES ABSOLUES :
- nouvelle migration horodatée, additive ; ne modifie JAMAIS une migration
  existante ;
- lance `npm run schema`, `npm run build` et `npm run manifest` avant de
  fusionner.

AVANT DE COMMENCER : pose-moi les sept décisions ouvertes, plus toutes tes
questions. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner, promouvoir jusqu'à main, ET à appliquer la
migration sur le cloud — staging d'abord, production ensuite, via la release
coordonnée. Tu n'as pas besoin de me redemander à chaque étape.

CONDITIONS :
- la CI doit être verte. Si elle est rouge, tu corriges la cause ;
- la production passe APRÈS un staging réussi.

TERMINÉ SIGNIFIE : la migration est en production, l'écran est déployé, et tu as
provoqué une erreur de test pour vérifier qu'elle remonte — ET vérifié, en
lisant l'enregistrement produit, qu'il ne contient aucune donnée sensible. Tu ne
t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L12 — Traitement des propositions

```
Tu reprends une dette du projet MedData (registre-clinique), déjà cloné dans le
répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L12).

CONTEXTE. Quand une valeur manque dans une liste contrôlée, l'utilisateur peut la
proposer : la soupape écrit sa proposition dans un champ compagnon, suffixé
`_autre` (voir src/domain/proposalField.ts et
src/screens/member/ChoiceWithProposal.tsx).

LA DETTE. Rien ne liste ces propositions à l'échelle d'une base. Elles dorment
dans les fiches individuelles, et personne ne peut décider de les promouvoir en
valeurs de la liste. La boucle d'amélioration annoncée quand la soupape a été
livrée n'existe donc pas.

PÉRIMÈTRE. Un écran qui parcourt les propositions non vides d'une base, les
regroupe par variable, et permet d'ouvrir la fiche correspondante. Lot de lecture
seule : la promotion d'une proposition en valeur de liste passe par l'éditeur de
variables existant, ne la duplique pas ici.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — où placer
l'écran, qui y a accès, faut-il pouvoir marquer une proposition comme traitée. Ne
code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : l'écran est en production et tu l'as ouvert sur une base
contenant au moins une proposition, sur l'application déployée. Tu ne t'arrêtes
pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Clés i18n : à la FIN de chaque section de messages.ts.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L13 — Rafraîchissement de la copie locale

```
Tu reprends une dette du projet MedData (registre-clinique), déjà cloné dans le
répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L13).

CONTEXTE. Le référentiel de terminologie peut être copié localement pour que la
recherche de diagnostic fonctionne sans réseau. La détection d'une copie périmée
existe déjà — `cacheIsCurrent` dans src/data/terminologyCache.ts, ligne 171 — et
une copie périmée est correctement IGNORÉE au profit du serveur : il n'y a donc
aucun risque de données fausses.

LA DETTE. Rien ne propose à l'utilisateur de mettre sa copie à jour. Il doit
deviner qu'il faut la retélécharger, et jusque-là il perd le bénéfice du hors
réseau sans savoir pourquoi.

PÉRIMÈTRE : src/data/terminologyCache.ts et
src/screens/member/TerminologyInput.tsx. Signaler la copie périmée et permettre
de la rafraîchir.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — faut-il
proposer, ou rafraîchir automatiquement ; où afficher le signal. Ne code rien
tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le correctif est en production et tu l'as vérifié sur
l'application déployée. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Ne touche pas à TerminologyInput.tsx si le lot L4 est en cours : demande-moi
d'abord.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L14 — Chargement de la seule langue active (à lancer SEUL)

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L14) et la section « Lot L3 » de docs/suivi-execution-feuille-route.md,
qui explique pourquoi ce reliquat a été isolé.

ATTENTION : ce lot touche src/i18n/messages.ts, le fichier le plus conflictuel du
dépôt — presque tous les autres chantiers y ajoutent des lignes. Il doit tourner
SEUL. Vérifie avec moi qu'aucun autre lot n'est en cours avant de commencer.

PÉRIMÈTRE. Les traductions française et anglaise voyagent ensemble dans un
fichier de 98 Ko, téléchargé en entier quelle que soit la langue choisie. Ne
charger que la langue active. Fichiers : src/i18n/messages.ts et
src/i18n/useI18n.ts.

Contrainte : la bascule de langue doit continuer de fonctionner sans rechargement
de page, et sans écran vide pendant le chargement de la seconde langue.

Mesure attendue : donne le poids avant et après, et le nombre d'entrées du
précache avant et après, comme l'a fait le lot L3.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : `vercel.json` porte
`git.deploymentEnabled: false`. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur `staging`, puis sur `production` en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as basculé la langue
sur l'application déployée pour vérifier qu'aucune traduction ne manque. Un
découpage de traductions casse silencieusement : vérifie plusieurs écrans, pas
seulement l'écran de connexion. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L15 — Comptes de mission : identifiant et mot de passe générés

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/chantiers-interactions-comptes.md (chantier A, §2) et docs/edge-functions.md.

CONTEXTE. Le flux actuel d'invitation par e-mail a produit un compte sans mot de
passe durable lors du test du 2026-08-09. La décision produit est désormais
TRANCHÉE : tous les comptes de mission, même sans e-mail, reçoivent un
identifiant de connexion et un mot de passe GÉNÉRÉS. Le médecin les remet à
l'étudiant ; l'étudiant ne choisit pas son mot de passe initial.

PÉRIMÈTRE.

1. Remplacer le contrat Edge fondé sur l'e-mail, l'invitation et « resend » par
   la création puis la régénération explicite de justificatifs. Ne répare pas la
   redirection e-mail : ce circuit est remplacé pour le rôle `saisisseur`.
2. Générer côté serveur un identifiant unique et un mot de passe robuste. Si Auth
   nécessite une identité technique distincte, elle ne doit jamais être exposée
   à l'utilisateur ; jamais de secret d'administration dans le navigateur.
3. Afficher les deux éléments au médecin une seule fois, après création ou
   régénération confirmée. Ne les stocke, journalise ou audite jamais en clair.
4. Adapter la connexion pour saisir « Identifiant » et mot de passe, sans e-mail
   requis ; retirer les actions d'invitation/réinitialisation par e-mail de
   l'interface mission.
5. La régénération est une opération séparée, autorisée et auditée : elle rend
   les anciens justificatifs et sessions inutilisables. Une reprise automatique
   après réponse perdue ne crée pas un doublon ni un nouveau secret silencieux.

SÉCURITÉ. L'accès aux données reste décidé côté base/RLS par le rôle, la mission,
l'échéance et la révocation. Les tests doivent inclure l'absence de fuite de
secrets, l'unicité, les doublons/reprises, la régénération, les sessions
antérieures, l'expiration, la révocation et les refus inter-comptes.

AVANT DE COMMENCER : ne rouvre pas la décision identifiant/mot de passe générés
ni la règle « sans e-mail ». Pose seulement les questions techniques réellement
bloquantes et ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main. En revanche tu ne modifies AUCUN secret ni paramètre cloud sans mon accord
explicite.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : sur la pile locale, le médecin crée un compte de mission sans
e-mail, relève une seule fois les deux justificatifs, puis l'étudiant se connecte
dans un second profil. Après régénération confirmée, l'ancien mot de passe et les
sessions antérieures sont refusés, le nouveau fonctionne, et aucune trace ne
contient le secret. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Ce lot touche l'interface de gestion des comptes et la connexion : traite-le
SEUL, pas en parallèle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L16 — Compte de mission : écriture de l'identité et écarts d'interface (à lancer SEUL)

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/chantiers-interactions-comptes.md §3 et §4 IN EXTENSO — l'analyse et la
décision sont déjà faites, ne les refais pas — et docs/spec-comptes-mission.md.

ATTENTION : ce lot touche une migration, des tests de base, la spécification et
cinq écrans. Il doit tourner SEUL. Vérifie avec moi qu'aucun autre chantier
n'est en cours avant de commencer.

RIEN N'EXISTE EN CODE. Une premiere implementation des points d'ecran avait ete
ecrite le 2026-08-09 puis EFFACEE le 2026-08-10 : elle datait d'avant que le
renversement ci-dessous ne soit tranche, et ne comportait aucun test. Ne va pas
la chercher. La specification de chaque correction est dans le registre, §3.1 a
§3.6 — c'est de la que tu pars.

DÉCISION DÉJÀ PRISE PAR LE PORTEUR, à mettre en oeuvre et non à rouvrir : le
compte de mission (rôle saisisseur) DOIT pouvoir écrire l'identité nominative
lorsque le médecin lui a accordé l'option can_view_identity à la création de la
mission. Motif : sans support papier stable, l'étudiant est la seule source de
l'identité au moment de l'inclusion ; l'exclusion détruit l'information au lieu
de la protéger. Cela couvre TOUTE la zone « Identité (zone restreinte) » : nom
complet, date de naissance, téléphone, adresse et identifiant externe — pas la
seule date de naissance. C'est un RENVERSEMENT assumé de la décision du 2026-07-28
consignée au §12 de la spec. L'option retenue est A (étendre la formule), pas B
(créer une écriture sans lecture) : les raisons sont au §4.5 du document.

PHASE 1 — BASE. Charge le skill meddata-db-safety, il est obligatoire ici.
Nouvelle migration horodatée, additive, qui redéfinit can_write_identity() :
branche médecin REPRISE À L'IDENTIQUE, branche saisisseur AJOUTÉE — accès actif,
non révoqué, non expiré, can_view_identity accordée et can_create_structured_data.
Ne modifie aucune migration existante. La RPC create_patient se débloque d'elle-
même puisqu'elle appelle déjà cette fonction.

CORRECTION APRÈS CRÉATION — exigence ajoutée le 2026-08-11. Écrire l'identité à
la création ne suffit pas : une erreur de nom, de date de naissance, de téléphone,
d'adresse ou d'identifiant externe doit pouvoir être corrigée. `update_patient`
ne porte que les données analytiques ; ne le détourne pas et ne rouvre pas les
policies d'écriture directe. Ajoute une RPC dédiée, auditée et avec verrou de
version, qui modifie la zone identité complète. Elle doit appliquer côté serveur
les règles exactes suivantes :
- médecin propriétaire : correction de l'identité des patients de sa base ;
- médecin collaborateur : seulement avec les droits identité ET édition ;
- saisisseur : seulement son propre patient, encore `draft`, mission active et
  option `can_view_identity` accordée ; jamais une fiche soumise ni celle d'autrui.

La correction garde un motif, une trace exploitable, et repasse par la protection
contre les doublons. Toute vérification d'autorisation, de statut, d'auteur et de
version est côté RPC : l'interface ne constitue jamais la barrière de sécurité.

PIÈGE À NE PAS MANQUER : is_medecin() exige profiles.global_role = 'medecin', ce
qu'un saisisseur ne satisfera JAMAIS. La branche saisisseur doit donc s'ajouter au
niveau supérieur, HORS de la conjonction « is_medecin() and ... ». Surtout, ne
relâche pas is_medecin() pour la branche médecin.

Puis : contrôle de l'allowlist SECURITY DEFINER. La nouvelle RPC de correction
doit recevoir une autorisation `EXECUTE` minimale et être ajoutée à l'inventaire
si nécessaire — CONFIRME-LE par npm run db:function-acl:verify, ne le suppose pas.

Puis : test/mission-accounts.test.ts. Le cas « il ne peut JAMAIS écrire l'identité »
devient « il ne peut écrire que si l'option lui a été accordée ». CONSERVE le cas
négatif sans option et le cas après échéance. Reprends aussi les assertions de
nullité des champs nominatifs après création et l'assertion can_write_identity =
false avec option. Ajoute les cas de correction des cinq champs d'identité par
le saisisseur sur son brouillon, puis les refus après soumission, expiration,
révocation, sur une fiche d'autrui et par écriture directe. Écris dans le commit
qu'il s'agit d'un retournement délibéré, pas d'une régression.

Puis : réécris §4, §9 et §12 de docs/spec-comptes-mission.md, en consignant la
raison du renversement. Ne te contente pas de retourner la ligne du tableau §4 :
la phrase du §12 « c'est cette exclusion qui rend la permission acceptable » doit
être remplacée par ce qui rend DÉSORMAIS la permission acceptable — option
décochée par défaut, justification obligatoire, journalisation, périmètre d'une
seule base, échéance. Retire l'encadré d'avertissement qui annonce le renversement,
il n'aura plus lieu d'être.

PHASE 2 — INTERFACE, seulement après la phase 1. L'ordre est impératif : sinon
l'écran proposerait une saisie que la base refuse encore.
- NewPatient.tsx : la section « Identité (zone restreinte) » devient conditionnée
  à canViewIdentity — masquée sans l'option, visible avec.
- PatientDetail.tsx et le parcours d'édition : proposer et enregistrer la
  correction de TOUTE la zone identité restreinte sur une fiche déjà créée. Ne pas
  faire croire qu'un bouton « Modifier » corrige une identité s'il ne modifie que
  les données analytiques. Le saisisseur ne voit cette action que sur son propre
  brouillon autorisé ; le médecin autorisé peut corriger les patients de la base.
- Applique les quatre corrections d'écran décidées (registre §3.1, §3.3, §3.4,
  §3.5) : bouton « Nouveau patient » piloté par la permission de CRÉATION et non
  de modification, suppression de patient réservée à canEdit — elle est
  aujourd'hui offerte à TOUT LE MONDE, y compris un simple lecteur —,
  « Rendre disponible hors-ligne » masqué pour un accès à échéance (mais la copie
  résiduelle reste RETIRABLE), et barre latérale réduite pour le rôle saisisseur.
- Tests web pour ces cinq points et la correction de l'identité complète dans
  src/screens/member/*.test.tsx.

HORS PÉRIMÈTRE, décidé et clos : le nom du gabarit qui s'affiche « Modèle : — ».
La cause est la policy template_read, le porteur a décidé de ne pas y toucher. Ne
le corrige pas, ne le rouvre pas.

À FAIRE SIGNALER, pas à faire toi-même : ce renversement élargit ce qu'un compte
de mission peut connaître d'un patient. Rappelle-moi à la fin qu'il doit être
répercuté au registre des traitements (docs/juridique/, volet Tchad) et à la
charte utilisateurs.

VALIDATION : npm run typecheck, npm run lint, npm run test:web, npm run test:rls.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as rejoué le parcours
complet du compte de mission sur la pile locale — création, activation, saisie
d'un patient AVEC toute son identité, correction de chacun des champs de cette
zone sur son brouillon, puis vérification en base que l'identité est bien
enregistrée. Vérifie aussi qu'après soumission le saisisseur est refusé, tandis
que le médecin autorisé peut corriger la même identité. Tu ne t'arrêtes pas avant.
Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L17 — Messages d'erreur des Edge Functions

```
Tu reprends une dette du projet MedData (registre-clinique), déjà cloné dans le
répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/chantiers-interactions-comptes.md §5.

CONTEXTE. Quand une Edge Function refuse une demande, l'interface affiche
« Edge Function returned a non-2xx status code » — le message de TRANSPORT de la
bibliothèque cliente — au lieu du message court et générique que la fonction a
elle-même renvoyé (« Base invalide », « Authentification requise », « Seule une
cohorte figée est exportable », EXPORT_INCOMPLETE...).

CAUSE, vérifiée sur le chemin export : functions.invoke lève un FunctionsHttpError
dont .message est littéralement cette phrase ; le vrai corps { code, error,
resource } se trouve dans error.context, que src/data/exports.ts ligne 59 ne lit
pas. src/data/mission.ts tente, lui, de lire le message de la fonction et retombe
malgré tout sur le message de transport : la cause exacte du repli reste à
confirmer sur ce chemin-là.

POURQUOI CE N'EST PAS COSMÉTIQUE. Un refus légitime est aujourd'hui indiscernable
d'une panne. Ce défaut a coûté deux diagnostics complets pendant la campagne de
test manuel du 2026-08-09, chaque fois en obligeant à sortir de l'application pour
lire la vraie réponse.

PÉRIMÈTRE. Corrige UNE FOIS, dans un utilitaire partagé, et non appelant par
appelant : tous les chemins qui passent par functions.invoke sont concernés —
exports, comptes de mission, signed-read, inspect-upload, finalize-upload,
cleanup-upload, reconcile-quarantine. Lis error.context, extrais-en le message
court et le code, et ne retombe sur le message de transport qu'en dernier recours.

DEUX CONTRAINTES À NE PAS PERDRE DE VUE :
- Les Edge Functions renvoient volontairement des messages COURTS et GÉNÉRIQUES et
  ne doivent JAMAIS exposer d'erreur interne brute au frontend. Le but n'est pas
  d'afficher davantage, c'est d'afficher ce que le serveur a déjà choisi de dire.
- Un correctif de ce type appliqué à un seul appelant, lors d'un lot antérieur,
  avait laissé les autres afficher « [object Object] ». Corrige partout ou nulle
  part, et couvre chaque appelant par un test.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le correctif est en production, et tu as provoqué au moins un
refus réel par chemin corrigé pour lire le message affiché. Tu ne t'arrêtes pas
avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L18 — Cohorte dynamique : compteur vivant et « Figer maintenant »

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/idees-post-readiness.md (défauts D6 et D8) et
docs/chantiers-interactions-comptes.md §6.

CONTEXTE, signalé par le porteur le 2026-08-09 : « j'ai juste un cadre qui est là
et qui ne sert à rien ». La carte d'une cohorte à mise à jour automatique
n'affiche ni compteur ni action.

CAUSE. listCohorts lit le compte depuis cohort_member(count)
(src/data/cohorts.ts:48), table VIDE PAR CONSTRUCTION pour une cohorte dynamique,
dont la population n'est jamais matérialisée ; et le bloc « compteur + bouton
Exporter » est conditionné à cohortType === 'snapshot'
(src/screens/member/CohortBuilder.tsx:430). La carte n'a littéralement rien à
rendre.

CE QUI EST DÉLIBÉRÉ ET DOIT LE RESTER : le refus d'exporter une cohorte dynamique
(409 « Seule une cohorte figée est exportable »). Un export inscrit dans export_log
une empreinte et des décomptes figés ; sur une population qui bouge, le fichier ne
serait rattachable à rien de reproductible. Ce lot donne à la carte ce qui lui
manque, il NE LÈVE PAS la règle.

PÉRIMÈTRE — deux points, front seul, aucune migration.

1. Donner à la carte dynamique le COMPTE VIVANT, via cohort_preview sur son filtre
   enregistré, comme le fait déjà l'aperçu du constructeur. Prérequis technique :
   listCohorts ne remonte aujourd'hui ni filter_definition ni validated_only — les
   ajouter au select. Et une action « FIGER MAINTENANT », qui crée une cohorte
   figée à partir du même filtre : c'est le geste manquant entre « je suis ma
   population » et « j'exporte ». À défaut de l'action, énoncer au moins sur la
   carte pourquoi l'export n'y est pas proposé.

2. Défaut D8 : on peut aujourd'hui figer une cohorte qui ne sera JAMAIS exportable.
   Le figeage accepte les brouillons quand « patients validés uniquement » est
   décochée (20260616091100_cohorts.sql:100), alors que l'export refuse en bloc dès
   qu'un membre n'est pas curated (generate-export/handler.ts:358). Rien n'avertit
   au moment du figeage. Avertir — « cette cohorte contient N fiches non validées
   et ne sera pas exportable en l'état » — ou proposer la réparation depuis l'écran
   d'export. Discute-en avec moi avant de choisir.

NE PAS LANCER EN MÊME TEMPS QUE L19 : mêmes fichiers.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as créé une cohorte
dynamique sur l'application déployée pour vérifier que sa carte porte un compte et
une action. Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi
telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L19 — Archivage d'une cohorte

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/idees-post-readiness.md (idée 11) et
docs/chantiers-interactions-comptes.md §6.2. Charge le skill meddata-db-safety,
il est obligatoire ici.

CONTEXTE, signalé par le porteur le 2026-08-09 : une cohorte créée ne peut plus
être retirée de la liste, quelle qu'en soit la raison — essai, doublon, erreur de
nom.

LA CAPACITÉ SERVEUR EXISTE DÉJÀ : les policies c_delete sur cohort, cm_delete et
cem_delete sur les membres sont en place (20260616090400_rls.sql:119), ouvertes à
can_curate. Ce qui manque est côté application : CohortRepository n'expose que
listCohorts, preview, createDynamic et createSnapshot (src/data/cohorts.ts:27).

LE PIÈGE QUI INTERDIT LE RACCOURCI « ajouter un bouton Supprimer » :
export_log.cohort_id référence cohort(id) ON DELETE CASCADE
(20260616090200_tables.sql:262). Un DELETE direct effacerait donc EN CASCADE le
journal des exports de la cohorte — qui a exporté, quand, avec quelle empreinte.
C'est la traçabilité sur laquelle repose le volet juridique. Un bouton naïf
transformerait « ranger ma liste » en effacement de preuve.

DEUX ISSUES PROPRES, à trancher avec moi avant de coder :
- ARCHIVAGE (recommandé) : deleted_at sur cohort, cohorte retirée de la liste,
  journal intact, restauration possible — même motif que la corbeille des bases
  déjà livrée par L8 ;
- SUPPRESSION DURE CONDITIONNELLE : une RPC qui ne supprime que si export_log est
  vide pour cette cohorte, et refuse explicitement sinon.

À DÉCIDER DANS LE MÊME MOUVEMENT : le sort des fichiers conservés dans le bucket
scientific-exports — maintenus lisibles, ou purgés explicitement.

PÉRIMÈTRE : migration additive, RPC, src/data/cohorts.ts, écran des cohortes,
tests base et web. Ne modifie aucune migration existante.

NE PAS LANCER EN MÊME TEMPS QUE L18 : mêmes fichiers. Traiter L18 d'abord.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as prouvé sur la pile
locale qu'une cohorte retirée laisse son journal d'exports INTACT. Tu ne t'arrêtes
pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L20 — Listes de diagnostics : surface base (à lancer SEUL)

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md — en entier, c'est la spécification du lot.

BESOIN. Aujourd'hui, un patient portant plusieurs diagnostics oblige à créer
diagnostic_1, diagnostic_2, diagnostic_3 : il faut deviner un maximum à l'avance,
les patients déjà saisis portent des colonnes vides indiscernables d'une absence
réelle, et compter un diagnostic oblige à balayer trois colonnes. La
spécification introduit une variable à VALEURS MULTIPLES. Ce lot en pose la seule
surface base.

CE LOT EST LE PRÉREQUIS DE L21 À L26. Tant que la base refuse un tableau, toute
interface qui en écrit un est inutilisable.

PÉRIMÈTRE — une seule migration additive, plus les tests. Aucun écran.

1. template_field (supabase/migrations/20260616090200_tables.sql:49) reçoit
   is_multiple boolean not null default false, plus une contrainte le réservant au
   type 'terminology'. La valeur par défaut reproduit exactement le comportement
   actuel : aucune donnée existante n'est touchée.

2. assert_data_valid — sa version COURANTE est dans
   20260728043556_preserve_historical_terminology.sql, pas dans la migration
   d'origine. Ajoute is_multiple à son select, et une branche multivaluée. Ordre
   d'évaluation à préserver : la branche __missing__ passe AVANT la branche de
   type, donc un code de donnée manquante continue de fonctionner sans traitement
   particulier. Règles : tableau, longueur 1 à 50, chaque élément objet aux seules
   clés code et label non vides, chaque couple vérifié contre terminology_concept
   avec is_selectable TOUTES PUBLICATIONS CONSERVÉES CONFONDUES (c'est la règle
   posée par 20260728043556, ne la restreins pas à la publication active), aucun
   code répété.

3. base_completeness_stats (20260616097000_completeness_stats.sql:31) teste
   nullif(data ->> field_key, '') is not null. Sur un tableau, ->> renvoie sa
   représentation textuelle : '[]' serait compté comme RENSEIGNÉ. Exige
   jsonb_array_length > 0 pour un champ multivalué.

4. jsonb_matches — l'évaluateur serveur des filtres de cohorte, appelé par
   cohort_preview (20260616092100_cohort_eligibility.sql:12) et
   create_cohort_snapshot. Ajoute has_any et has_none : au moins une / aucune
   valeur dont le code figure dans la liste fournie. L'interface arrive en L23 ;
   ce lot ne touche aucun écran.

POURQUOI TOUT DANS UNE SEULE MIGRATION : ces quatre points portent sur les mêmes
fonctions. Les séparer imposerait trois migrations successives les réécrivant, et
trois revues de sécurité au lieu d'une.

TESTS EXIGÉS, dans test/ : tableau vide refusé, code en double refusé, clé
surnuméraire refusée, couple code/libellé incohérent refusé, concept d'une
publication conservée mais non active ACCEPTÉ, code de donnée manquante toujours
accepté à la place du tableau, refusé si allow_missing_codes est faux,
is_multiple refusé sur un autre type que terminology, longueur bornée à 50,
complétude correcte sur liste vide et non vide, has_any et has_none sur des
listes de taille 0, 1 et N.

Aucune table nouvelle, donc aucune policy RLS à écrire — c'est précisément ce que
le choix de stockage cherchait à obtenir. Vérifie-le plutôt que de le supposer.

SURFACE BASE : applique la Skill meddata-db-safety.

À LANCER SEUL.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as prouvé sur la pile
locale qu'une base existante continue de s'écrire et de s'exporter exactement
comme avant. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Mets à jour le statut de docs/spec-variables-multivaluees.md et consigne le
résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L21 — Listes de diagnostics : saisie et constructeur

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §6.

PRÉREQUIS : le lot L20 doit être fusionné. Vérifie que template_field porte
is_multiple avant de commencer ; sinon la base refusera tout ce que cette
interface écrit. L20 est fusionné depuis le 2026-08-18 (cde3170).

NE FUSIONNE PAS CE LOT SANS L22. L22 avait été annulé après avoir été livré
trop tôt ; il est restauré depuis le 2026-08-18 (commit 2cf39f8, branche
codex/l22-restore-multivalue-export) mais pas encore fusionné. Tant qu'il ne
l'est pas, la base accepte les listes et l'export ne sait pas les lire : le jour
où cette interface permet d'en saisir une, chaque export sort « [object
Object] » dans la colonne concernée, code vide, sans erreur ni avertissement.
Les deux lots ne partagent aucun fichier et se développent en parallèle sans se
gêner ; c'est leur mise en ligne qui doit être commune.

PÉRIMÈTRE — front seul, aucune migration.

1. CONSTRUCTEUR, src/screens/staff/FieldForm.tsx : une case « Accepte plusieurs
   valeurs », rendue UNIQUEMENT pour type === 'terminology'. Elle est
   structurelle : soumets-la à lockStructural, comme le type et la portée. Elle
   n'est donc modifiable que tant que la version du gabarit est en draft.

2. SAISIE, src/screens/member/TerminologyInput.tsx : un mode multivalué. Le
   composant actuel remplace la zone de recherche par une étiquette dès qu'une
   valeur est choisie (branche if (selected)). En mode multivalué, les valeurs
   choisies s'affichent en étiquettes NUMÉROTÉES — le numéro est le rang, et c'est
   lui qui portera la convention « le premier est le diagnostic principal » — avec
   un bouton de retrait, et LA ZONE DE RECHERCHE RESTE VISIBLE en dessous. Un
   concept déjà choisi est écarté des résultats.

3. POINT À NE PAS RATER : retirer la dernière valeur doit SUPPRIMER LA CLÉ de
   data, pas écrire un tableau vide. La base refuse le tableau vide,
   délibérément — il n'existe qu'une seule représentation de « pas de valeur ». Un
   client qui écrit un tableau vide produit un refus serveur visible plutôt qu'une
   donnée douteuse ; c'est voulu, mais c'est au client de ne pas le déclencher.

4. src/domain/validation.ts:82 validateField — sa branche terminology (ligne 105)
   ne vérifie aujourd'hui que la FORME, le serveur restant seul juge de
   l'existence du concept. Garde ce partage : en multivalué, vérifie que c'est un
   tableau de couples bien formés, rien de plus.

5. ValueInput.tsx : le sélecteur de code manquant est conservé tel quel. Un code
   manquant REMPLACE le tableau, il ne s'y ajoute pas.

Le cache local de terminologie et la saisie hors connexion ne changent pas : ils
portent sur la recherche, pas sur la cardinalité du champ.

NE PAS LANCER EN MÊME TEMPS QUE L4 (mêmes deux fichiers) NI QUE L13
(TerminologyInput.tsx). L4 étend la soupape au type terminology, L21 en change la
cardinalité : mener les deux ensemble mélangerait deux raisonnements sur le même
composant.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as saisi sur
l'application déployée une rencontre portant quatre diagnostics, puis retiré le
deuxième, puis rouvert la fiche pour vérifier que les trois restants sont intacts
et correctement ordonnés. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L22 — Listes de diagnostics : export

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §7.

CE LOT EST LIVRÉ DEPUIS LE 2026-08-18 (commit 2cf39f8). Le prompt ci-dessous
est conservé pour mémoire, pas pour être rejoué. Histoire courte : 7e83a3f
(2026-08-17) avait livré L22 avant son prérequis L20, dans le même commit que
D13 et D14 ; 6775a91 (PR #221) a annulé la seule part L22 ; L20 est arrivé
ensuite (cde3170, PR #222) ; la restauration s'est faite par
« git revert 6775a91 », avec vérification que le contrat export est cohérent
avec les règles serveur de L20. NE RETOUCHE NI D13 NI D14 : livrés et
verrouillés par trois tests (exportContract_test.ts:299, :313, :328).

COMMENCE PAR LE TEST DE NON-RÉGRESSION, avant toute autre chose.
supabase/functions/generate-export/exportContract.ts:168 formatValue teste
isTerminologyValue AVANT Array.isArray (ligne 179). Une liste de diagnostics
tomberait donc dans v.join('; ') et rendrait « [object Object] » sur TOUTE la
colonne. Ce défaut a déjà frappé trois fois dans ce dépôt : sur les codes
manquants, sur la liste des patients (lot L1), et sur les messages des Edge
Functions (lot L17). Écris le test qui échoue d'abord, dans
exportContract_test.ts. Ensuite seulement, implémente.

PÉRIMÈTRE — surface Deno isolée, aucun fichier commun avec les lots front.

1. FEUILLE PRINCIPALE, pour un champ multivalué : la colonne principale porte les
   libellés joints par « ; », la colonne terminology_code__… (codeColumnId, ligne
   100) porte les codes joints par « ; », et une colonne nb__… porte le nombre de
   valeurs. Un code de donnée manquante remplit la colonne principale avec son
   code et laisse nb__… VIDE — jamais 0, qui signifierait « aucun diagnostic ».

2. COLONNES INDICATRICES has__…__<code>, valant 0 ou 1, une par code
   EFFECTIVEMENT PRÉSENT dans l'export. Suffixe = code normalisé en minuscules,
   tout caractère hors [a-z0-9] remplacé par un souligné. Collision après
   normalisation résolue par un indice numérique, correspondance portée au
   dictionnaire. AU-DELÀ DE 100 CODES DISTINCTS, ne les produis pas et porte la
   mention au dictionnaire : une base réelle peut porter des centaines de
   diagnostics distincts, et une feuille de mille colonnes n'aide personne.
   assertNoIdentity s'applique à ces colonnes comme aux autres.

3. FEUILLE DÉDIÉE, une par champ multivalué, nommée d'après son libellé, une
   ligne par valeur : patient_code, encounter_id (vide pour un champ de portée
   patient), rang à partir de 1, code, label. C'est la forme sans perte : elle
   survit au seuil de 100 et sert les analyses par diagnostic. handler.ts:586
   montre comment les feuilles sont assemblées aujourd'hui.

4. DICTIONNAIRE, buildDictionary ligne 381 : une colonne is_multiple, et une ligne
   par colonne dérivée (nb__…, has__…) documentant sa nature calculée et son code
   d'origine.

5. EXPORT MIXTE : mergeExportFields unionne déjà les versions de gabarit sur
   scope + field_key. Vérifie par un test qu'une rencontre saisie AVANT le passage
   en multivalué reste correctement rendue.

Parallélisable avec L21, L23, L24 et L25 : aucun fichier commun.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as OUVERT le fichier
xlsx produit par l'application déployée pour vérifier de tes yeux qu'aucune
cellule ne contient « [object Object] », que la feuille dédiée porte les bons
rangs, et que la somme d'une colonne indicatrice donne le nombre attendu de
patients. Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi
telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L23 — Listes de diagnostics : cohortes

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §8.

PRÉREQUIS : le lot L20 doit être fusionné — il apporte les opérateurs has_any et
has_none dans jsonb_matches, côté serveur. Ce lot est FRONT SEUL, sans migration.

PÉRIMÈTRE.

1. src/screens/member/CohortBuilder.tsx:31, operatorsFor : pour un champ
   multivalué, renvoie has_any et has_none, ET EUX SEULS. Retirer eq et neq de
   l'interface pour ce cas n'est pas cosmétique : une égalité sur une liste
   produirait un résultat faux SANS LE SIGNALER, et une cohorte fausse ne se voit
   pas — elle se publie.

2. Les libellés de ces deux opérateurs doivent se lire en clinicien, pas en
   informaticien : « porte au moins un de » et « ne porte aucun de ». Ajoute tes
   clés à la FIN de la section française puis anglaise de src/i18n/messages.ts,
   pour limiter les conflits.

3. La valeur saisie pour ces opérateurs est une LISTE DE CODES, choisis dans le
   référentiel — pas du texte libre. Réutilise le composant de recherche existant
   plutôt que d'en écrire un second.

4. VÉRIFIE l'aperçu ET le figeage : cohort_preview et create_cohort_snapshot
   appellent tous deux jsonb_matches. Un filtre qui marche à l'aperçu mais pas au
   figeage produirait une cohorte silencieusement différente de ce qui a été
   montré.

NE PAS LANCER EN MÊME TEMPS QUE L18 NI L19 : mêmes deux fichiers.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as construit sur
l'application déployée une cohorte « porte au moins un de [deux diagnostics] »,
vérifié son compte à l'aperçu, puis figé et vérifié que la population figée est
IDENTIQUE à celle annoncée. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L24 — Listes de diagnostics : refus au mappage d'import

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §9.

CE LOT N'AJOUTE PAS L'IMPORT DES DIAGNOSTICS. Il pose un refus honnête.

CONSTAT. L'import ne prend en charge AUCUN champ de type terminology, même à
valeur unique : src/domain/import.ts transmet les cellules sans résoudre de
concept, et la validation serveur rejette une chaîne là où un couple code/libellé
est attendu. Ce n'est pas une régression du lot L21 — c'est un manque antérieur,
que L21 rend simplement visible : dès qu'une variable multivaluée existe, elle
apparaît dans la liste des cibles de mappage.

PÉRIMÈTRE — petit lot, front seul, aucune migration.

1. autoMapColumns (src/domain/import.ts:123) ne doit pas proposer
   automatiquement une cible de type terminology, multivaluée ou non.

2. Le choix manuel de cette cible dans src/screens/member/ImportData.tsx est
   refusé, avec un message qui dit CE QUI SE PASSE et QUOI FAIRE : la variable se
   saisit à la main pour l'instant, l'import ne sait pas encore résoudre un
   diagnostic dans le référentiel. Pas de message technique, pas d'erreur brute.

3. Le rapport d'import mentionne explicitement les colonnes ignorées pour ce
   motif, plutôt que de les fondre dans les colonnes « ignorées » ordinaires. Un
   utilisateur qui importe un fichier contenant une colonne Diagnostic doit
   comprendre pourquoi elle n'est pas arrivée.

À NOTER POUR PLUS TARD, ne pas l'implémenter ici : le format d'entrée naturel
sera celui de la sortie — libellés séparés par « ; » dans une colonne unique — et
la route « plusieurs colonnes vers un même champ » est aujourd'hui bloquée par
duplicateTargets (import.ts:141), qui traite toute cible assignée deux fois comme
un conflit.

Parallélisable avec L21, L22, L23 et L25.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as tenté sur
l'application déployée d'importer un fichier contenant une colonne Diagnostic,
pour vérifier que le refus arrive AU MAPPAGE avec un message compréhensible, et
non en fin d'import sous forme d'erreur serveur. Tu ne t'arrêtes pas avant. Si
une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L25 — Conflit hors-ligne : issue « garder les deux »

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §10 et docs/securite-mode-hors-ligne.md.

CE LOT EST SÉPARABLE. Rien n'en dépend, et son absence ne produit AUCUNE perte
silencieuse : le conflit est déjà correctement détecté par le jeton optimiste.
Il améliore une résolution, il ne répare pas un trou.

SITUATION. Deux appareils hors ligne ajoutent chacun un diagnostic à la même
rencontre. Le premier synchronise, le second voit son jeton baseUpdatedAt périmé
et le conflit remonte — jusque-là tout fonctionne. Mais la résolution est binaire
(src/data/offline.ts:545, resolveKeepMine et resolveKeepServer) : garder la
sienne écrase le diagnostic ajouté par l'autre.

PÉRIMÈTRE — front seul, aucune migration.

1. Une troisième issue « garder les deux » : union des deux listes par CODE,
   ordre local d'abord puis nouveautés serveur, sans doublon. Elle n'est possible
   que parce que chaque valeur porte un identifiant stable — son code.

2. Écris-la comme une FONCTION DE DOMAINE PURE, testable sans base et sans
   navigateur, appelée par la couche offline. Ne la disperse pas dans le
   composant.

3. Elle ne s'affiche que lorsqu'elle a un sens : une rencontre dont le conflit ne
   porte que sur des champs à valeur unique n'a rien à fusionner, et proposer une
   fusion impossible serait pire que ne rien proposer. Détermine le cas et
   justifie ton choix.

4. L'OutboxEntry (offline.ts:274) transporte l'objet data COMPLET, sous garde de
   baseUpdatedAt et d'un operationId d'idempotence. Ne change pas cette forme :
   c'est elle qui fait que les listes de diagnostics n'ont demandé aucun travail
   hors-ligne. Vérifie qu'un rejeu de l'entrée fusionnée reste idempotent.

5. L'écran de résolution est dans SyncCenter.tsx.

Parallélisable avec L21, L22, L23 et L24.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as REJOUÉ le scénario
à deux appareils — deux navigateurs, chacun hors ligne, chacun ajoutant un
diagnostic différent — pour vérifier que « garder les deux » conserve
effectivement les deux. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## ~~L26 — Regroupement des variables diagnostic_1/2/3~~ — **clos sans exécution le 2026-08-19**

> ⚠️ **Ce prompt ne doit plus être lancé.** La base d'essai qui portait `diagnostic_1/2/3` a été
> supprimée : la conversion n'a plus d'objet, et le regroupement de la variable est déjà faisable
> à la main depuis L21. Décision et justification au §12 de
> [`spec-variables-multivaluees.md`](spec-variables-multivaluees.md). Le texte est conservé tel
> quel : il redeviendrait le point de départ correct si un médecin arrivait un jour avec des
> fiches saisies sous ce contournement.


```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §12 EN ENTIER.

PRÉREQUIS ABSOLU : L20 à L22 fusionnés et en service. Ce lot est le SEUL de la
famille qui touche des données DÉJÀ ENREGISTRÉES. Ne le commence pas avant que
tout le reste fonctionne, ni sans une sauvegarde vérifiée.

SITUATION. Le porteur a saisi ses diagnostics multiples sous forme de variables
diagnostic_1, diagnostic_2, diagnostic_3. Une fois la variable multivaluée
disponible, ces variables doivent pouvoir être regroupées — sinon les anciennes
rencontres et les nouvelles se lisent dans deux formes différentes et l'export
est coupé en deux.

PÉRIMÈTRE — DEUX OPÉRATIONS QUI NE DOIVENT JAMAIS ÊTRE FUSIONNÉES.

A. REGROUPER LA VARIABLE. Crée une version de gabarit en draft où diagnostic_1,
   diagnostic_2 et diagnostic_3 sont remplacées par un diagnostic multivalué.
   N'affecte QUE les saisies futures. Une version publiée est immuable — c'est
   déjà garanti côté serveur, appuie-toi dessus.

B. CONVERTIR LES ENREGISTREMENTS EXISTANTS. Déplace les valeurs des trois clés
   vers le tableau, dans l'ordre des suffixes, et rattache l'enregistrement à la
   nouvelle version. FACULTATIVE, explicitement cochée par l'utilisateur, JAMAIS
   déclenchée par A.

CONTRAINTES SUR B, toutes obligatoires.

1. Une fonction d'APERÇU EN LECTURE SEULE précède l'exécution et rend : le nombre
   d'enregistrements concernés, les valeurs non résolubles en concept du
   référentiel, les doublons entre diagnostic_1 et diagnostic_2, et les
   enregistrements déjà convertis. Rien ne s'écrit avant que le porteur ait vu ça.

2. L'exécution est TRANSACTIONNELLE PAR ENREGISTREMENT et IDEMPOTENTE : une
   reprise après interruption ne doit ni dupliquer une valeur ni retraiter un
   enregistrement déjà converti.

3. Chaque conversion est tracée dans field_change_log avec l'ancienne et la
   nouvelle valeur. Sa contrainte source (20260616090200_tables.sql:198) doit
   accueillir une valeur supplémentaire dédiée : c'est une modification ADDITIVE
   d'une contrainte check sur une table PORTANT DES DONNÉES. Traite-la comme
   telle.

4. Une valeur non résoluble BLOQUE la conversion de l'enregistrement concerné et
   est rapportée. Jamais écartée en silence. Perdre un diagnostic sans le dire
   serait la pire issue possible de ce lot.

5. Aucune conversion automatique, aucune conversion à l'ouverture d'un écran,
   aucune conversion « pendant qu'on y est ». L'utilisateur déclenche, voit, puis
   confirme.

SURFACE BASE : applique la Skill meddata-db-safety. À LANCER SEUL.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as converti une base
de démonstration sur la pile locale puis COMPTÉ les diagnostics avant et après
pour prouver qu'aucun n'a été perdu, y compris sur un enregistrement portant un
doublon et sur un enregistrement portant une valeur non résoluble. Tu ne
t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Mets à jour docs/spec-variables-multivaluees.md et consigne le résultat à la fin
de docs/suivi-execution-feuille-route.md.
```

---

## L27 — Texte d'aide par variable

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la section L27 de
docs/lots-paralleles.md.

BESOIN. Une variable n'a aujourd'hui qu'un libellé. Rien ne dit COMMENT la
renseigner, alors que la réponse en dépend : « score de Glasgow à l'admission »
signifie-t-il le premier score documenté, ou celui pris après sédation ? Deux
personnes qui saisissent la même base répondent différemment, et l'écart ne se
voit jamais dans les données.

PÉRIMÈTRE — petit lot, mais il traverse la base, la saisie et l'export.

1. Une colonne description text sur template_field
   (supabase/migrations/20260616090200_tables.sql:49). Migration additive,
   nullable, sans valeur par défaut.

2. Un champ de saisie dans src/screens/staff/FieldForm.tsx. Ce n'est PAS une
   propriété structurelle : elle doit rester modifiable même sur une version
   publiée si le produit le permet — vérifie ce que fait lockStructural pour les
   autres champs non structurels comme le libellé, et aligne-toi dessus.

3. Une icône d'aide dans src/screens/member/EncounterFields.tsx, à côté du
   libellé. Discrète : elle ne doit pas allonger le formulaire, qui est déjà long
   sur mobile. Accessible au clavier et annoncée aux technologies d'assistance.

4. UNE COLONNE description AU DICTIONNAIRE D'EXPORT. buildDictionary
   (supabase/functions/generate-export/exportContract.ts:206) porte aujourd'hui
   column_id, field_key, label, scope, section, type, unit, allowed_values et
   template_versions — pas de description. C'est pourtant l'endroit exact où un
   relecteur extérieur ou un statisticien cherche la définition d'une variable.
   Sans ce point, le lot rate sa cible.

RÈGLE : le texte d'aide ne contient JAMAIS de donnée patient. C'est une
définition de variable, pas un commentaire de dossier.

Peut tourner en parallèle de L29 uniquement. Tous les autres lots de la famille
formulaires touchent FieldForm.tsx ou exportContract.ts.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as OUVERT le fichier
xlsx produit par l'application déployée pour vérifier que la feuille Dictionnaire
porte bien la description saisie. Tu ne t'arrêtes pas avant. Si une commande
t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L28 — Valeur par défaut et unicité

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la section L28 de
docs/lots-paralleles.md.

DEUX COLONNES SUR template_field, MAIS DEUX MÉCANISMES SANS RAPPORT. Ne les
traite pas comme une seule fonctionnalité.

1. default_value — un PRÉREMPLISSAGE À LA SAISIE, jamais une valeur écrite
   d'office. Une date de consultation proposée à aujourd'hui, un pays proposé à
   Tchad. Le serveur ne doit RIEN écrire de lui-même : si l'utilisateur efface la
   proposition, le champ est vide, pas rempli avec la valeur par défaut. Un champ
   prérempli non touché reste discernable d'un champ confirmé si le produit en a
   besoin — discute-en avec moi.

   RÈGLE À FAIRE RESPECTER PAR L'INTERFACE : ne jamais proposer de valeur par
   défaut sur une variable clinique dont la proposition orienterait la réponse.
   Une valeur par défaut sur « complication » ou sur « issue » fabrique des
   données. Avertis dans le constructeur plutôt que d'interdire.

2. is_unique — une CONTRAINTE SERVEUR, pas un contrôle d'interface. Numéro de
   dossier, identifiant institutionnel. Elle doit résister à l'import, au rejeu
   hors-ligne et à deux saisies simultanées : donc un index d'unicité PARTIEL sur
   la valeur extraite du jsonb, portée par base et ignorant les fiches
   supprimées — pas un select préalable suivi d'un insert, qui laisse passer deux
   écritures concurrentes.

   Regarde comment uq_patient_base_code et uq_identity_base_code sont écrits
   (tables.sql) : même forme, même raison.

   Le message d'erreur rendu à l'utilisateur doit être compréhensible et ne
   jamais laisser fuir l'erreur PostgreSQL brute.

Surface base : applique la Skill meddata-db-safety.

Touche FieldForm.tsx : ne pas lancer avec L4, L21, L27, L30, L31 ni L33.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as prouvé sur la pile
locale que DEUX écritures simultanées du même numéro de dossier n'en laissent
passer qu'une. Un test qui vérifie l'unicité en série ne prouve rien. Tu ne
t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L29 — Prévisualisation du formulaire

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la section L29 de
docs/lots-paralleles.md.

C'EST LE SEUL LOT DE LA FAMILLE FORMULAIRES QUI N'ENTRE EN COLLISION AVEC RIEN.
Il ouvre son propre écran et ne touche TemplateVersionEditor.tsx que pour y poser
un bouton. Il peut tourner en parallèle de n'importe quel autre lot.

BESOIN. Voir son formulaire tel que le verra la personne qui saisit, sans avoir à
créer un patient d'essai qu'il faudra ensuite supprimer.

PÉRIMÈTRE — front seul, aucune migration.

1. Un écran de prévisualisation qui rend le formulaire de la version en cours
   d'édition, en RÉUTILISANT les composants de saisie réels (EncounterFields,
   ValueInput, FieldInput). Ne réimplémente pas un rendu parallèle : une
   prévisualisation qui diverge du formulaire réel est pire qu'aucune
   prévisualisation.

2. Vue ordinateur et vue mobile. C'est en mobile que l'ordre des variables et la
   longueur des sections décident du confort réel, et c'est là que le porteur
   saisit.

3. Le choix du type de rencontre, puisqu'il pilote quelles variables
   s'affichent (encounter_types).

4. RIEN NE S'ÉCRIT. Aucun appel d'écriture, aucun brouillon local, aucune entrée
   dans l'outbox hors-ligne. Vérifie-le explicitement plutôt que de le supposer :
   les composants de saisie réels peuvent porter des effets de bord.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, tu as prévisualisé un
formulaire sur l'application déployée en vue mobile, et tu as VÉRIFIÉ QU'AUCUNE
ÉCRITURE n'a été produite — ni patient, ni rencontre, ni brouillon, ni entrée
d'outbox. Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi
telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L30 — Options de liste : code interne stable

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/idees-post-readiness.md §4
et la section L30 de docs/lots-paralleles.md.

DÉFAUT CONNU DEPUIS LE 2026-07-22, jamais corrigé pour les listes ordinaires. Une
option de select est stockée EN TEXTE : allowed_values est un tableau de chaînes,
et c'est la chaîne elle-même qui part dans patient.data / encounter.data. La
validation serveur teste allowed_values @> jsonb_build_array(txt).

CONSÉQUENCE. Corriger une option — hematome en hématome — rend les fiches déjà
saisies invalides à la prochaine écriture, et scinde une modalité en DEUX dans
les statistiques. Le porteur ne le verra pas : rien ne signale l'écart.

C'est exactement le problème que le référentiel de terminologie a résolu pour les
diagnostics (migration 20260726210000). Applique-lui la même solution.

PÉRIMÈTRE.

1. allowed_values devient une liste d'objets { value_key, label, is_active }. Le
   value_key part en base, le libellé reste modifiable, une option retirée est
   DÉSACTIVÉE et non supprimée — sinon l'historique devient illisible.

2. Éditeur d'options dans FieldForm.tsx : ajouter, renommer, réordonner,
   désactiver. Aujourd'hui c'est un textarea de valeurs libres.

3. Rendu dans FieldInput.tsx : les options inactives ne sont plus proposées à la
   saisie, mais une fiche qui en porte une reste lisible et modifiable sur ses
   autres champs.

4. Export : la colonne principale porte le libellé, comme pour la terminologie,
   et une colonne de code porte le value_key. Regarde comment codeColumnId est
   fait pour terminology (exportContract.ts:75) et suis la même convention.

5. CONVERSION DES DONNÉES EXISTANTES, avec les mêmes exigences que L26 : fonction
   d'aperçu en lecture seule, opt-in explicite, transactionnelle par
   enregistrement, idempotente, tracée dans field_change_log. Une valeur qui ne
   correspond à aucune option BLOQUE la conversion de son enregistrement et est
   rapportée — jamais écartée en silence.

Surface base : applique la Skill meddata-db-safety.

Touche FieldForm.tsx et exportContract.ts : ne pas lancer avec les autres lots de
la famille formulaires, ni avec L21 ou L22.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as RENOMMÉ une option
sur une base de démonstration portant déjà des fiches, puis vérifié que ces
fiches restent valides, restent modifiables, et comptent toujours pour UNE seule
modalité à l'export. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L31 — Sections personnalisables

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la section L31 de
docs/lots-paralleles.md.

LE PLUS LOURD DE LA FAMILLE. Ne le sous-estime pas : une source extérieure l'a
qualifié de « relativement localisé », c'est faux.

CONSTAT. section est un check (section in ('clinique','biologie','paraclinique')),
et ces trois valeurs sont RÉPLIQUÉES DANS NEUF FICHIERS : src/data/types.ts,
src/domain/templateLibrary.ts, src/screens/member/EncounterFields.tsx,
src/screens/member/ImportData.tsx, src/screens/member/TemplateFromFile.tsx,
src/screens/staff/FieldForm.tsx, supabase/seed.sql, la migration d'origine
20260616090200_tables.sql et 20260711000200_template_transactionality.sql.
Vérifie cette liste toi-même avant de commencer, elle a pu bouger.

BESOIN. Un registre de traumatisme crânien ne se structure pas en « clinique /
biologie / paraclinique » mais en « identification / circonstances / examen
initial / imagerie / prise en charge / évolution ». Les sections doivent être
créées, renommées et réordonnées par le propriétaire de la base.

PÉRIMÈTRE.

1. Une table template_section rattachée à TEMPLATE_VERSION — pas à la base. Une
   section est une structure de gabarit : elle suit le versionnement et
   l'immutabilité des versions publiées, comme les variables.

2. Migration de repli : toute base existante conserve ses trois sections
   actuelles, devenues des sections ordinaires. Aucune variable ne change de
   section, aucun formulaire ne change d'apparence au déploiement.

3. NE PAS CONFONDRE la section — regroupement visuel du formulaire, propre à
   chaque base — avec la catégorie de donnée. Les deux peuvent coexister, et
   c'est l'intérêt du lot. Si tu choisis de garder les deux notions, dis-le-moi
   avant.

4. EncounterFields.tsx porte aujourd'hui une section de secours pour qu'une
   variable dont la section est inconnue ne DISPARAISSE PAS du formulaire.
   Préserve ce comportement : c'est un filet, pas un détail.

5. Import, export et bibliothèque de gabarits doivent suivre. Une section
   personnalisée doit apparaître au dictionnaire d'export.

Surface base : applique la Skill meddata-db-safety. À traiter SEUL.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, une base existante ouvre son
formulaire EXACTEMENT comme avant, et une base neuve peut définir ses propres
sections et les réordonner. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L32 — Affichage conditionnel

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, src/domain/templateRules.ts
en entier, puis la section L32 de docs/lots-paralleles.md.

ÉTAT ACTUEL. Le moteur de règles sait rendre un champ OBLIGATOIRE sous condition
({ if:{field,operator,value}, then:{field, operator:'required'} } — 'required'
est le seul opérateur autorisé dans le then), comparer deux champs
({operator,left_field,right_field}), et distinguer blocage et avertissement
(severity block/warn). Il ne sait PAS montrer ou masquer.

BESOIN. Ne montrer les variables d'imagerie que si une imagerie a été faite.
C'est le plus gros gain ressenti sur un formulaire long.

DÉCISION À PRENDRE AVANT DE CODER, ET ELLE NE PEUT PAS ÊTRE REMISE À PLUS TARD :
que devient la valeur d'un champ DÉJÀ RENSEIGNÉ qui devient masqué ?

  - conservée et exportée — au risque qu'une analyse compte une valeur que
    l'utilisateur croit avoir retirée ;
  - effacée — au risque de perdre une saisie sur un simple changement d'avis.

Les deux se défendent. Le choix change la migration, l'export et les tests. C'est
le piège classique des systèmes de recueil clinique, et il ne se rattrape pas
après coup. POSE-MOI LA QUESTION et attends ma réponse.

PÉRIMÈTRE, une fois la décision prise.

1. Un type de règle 'visibility' à côté de l'existant, avec l'évaluation serveur
   correspondante. Le moteur reste une STRUCTURE JSON À LISTE BLANCHE
   D'OPÉRATEURS, jamais évaluée comme du code : c'est la ligne posée par
   templateRules.ts, ne la franchis pas.

2. src/screens/staff/RuleForm.tsx : construire une règle de visibilité sans
   écrire de JSON à la main, comme pour les deux formes existantes.

3. EncounterFields.tsx : appliquer la visibilité au rendu.

4. Un champ MASQUÉ ne peut pas être OBLIGATOIRE. Détermine l'ordre d'évaluation
   — visibilité d'abord, obligation ensuite — et impose-le côté serveur, pas
   seulement à l'écran. Sinon une fiche devient impossible à valider pour un
   champ que personne ne voit.

5. Interdis les cycles : A masqué par B, B masqué par A. Une validation du graphe
   de dépendances au moment de l'enregistrement de la règle, pas à la saisie.

Touche EncounterFields.tsx et exportContract.ts : ne pas lancer avec L27, L31 ni
L22.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as vérifié sur
l'application déployée qu'un champ masqué ne bloque pas la validation d'une
fiche, et que sa valeur se comporte comme décidé — conservée ou effacée, selon
ma réponse. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L33 — Raisons de valeur manquante par variable

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la section L33 de
docs/lots-paralleles.md.

ÉTAT ACTUEL. Trois codes — non_fait, inconnu, non_applicable — FIGÉS EN DUR côté
serveur dans assert_data_valid (version courante :
20260728043556_preserve_historical_terminology.sql), répétés dans
src/domain/validation.ts et dans le contrat d'export. Identiques pour toutes les
variables. Le seul réglage disponible est allow_missing_codes, un booléen qui les
autorise ou les refuse EN BLOC.

BESOIN. Toutes les raisons n'ont pas de sens pour toutes les variables. « Non
réalisé » convient à un examen, pas à un sexe. Et deux raisons manquent à un
registre clinique : le REFUS du patient, et NON DOCUMENTÉ — distinct d'inconnu,
qui laisse croire que l'information a été cherchée.

PÉRIMÈTRE.

1. Une colonne portant, par variable, la liste des raisons proposées. Décide avec
   moi si allow_missing_codes est conservé comme raccourci ou remplacé.

2. Deux codes ajoutés : refus et non_documente. LES TROIS CODES EXISTANTS NE
   CHANGENT NI DE NOM NI DE SENS — la migration est additive et les données déjà
   saisies restent lisibles telles quelles. Ne renomme rien.

3. Validation serveur : une raison non autorisée pour cette variable est refusée,
   avec un message nommant le libellé de la variable et jamais une valeur
   clinique.

4. ValueInput.tsx : le sélecteur ne propose que les raisons autorisées pour la
   variable en cours.

5. Export : les nouveaux codes apparaissent tels quels dans la colonne, et le
   dictionnaire documente les raisons autorisées par variable. Vérifie que
   MISSING_CODES dans exportContract.ts et dans src/domain/validation.ts restent
   la MÊME liste — deux listes qui divergent produiraient un export incohérent
   avec la saisie.

Surface base : applique la Skill meddata-db-safety.

Touche FieldForm.tsx, validation.ts et exportContract.ts : ne pas lancer avec les
autres lots de la famille formulaires, ni avec L21 ou L22.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, une fiche portant un ancien
code manquant reste lisible et modifiable, et une variable peut proposer « refus »
sans que « non réalisé » lui soit imposé. Tu ne t'arrêtes pas avant. Si une
commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L34 — Filtre d'une variable Diagnostic à valeur unique

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis
docs/spec-variables-multivaluees.md §8 et le compte rendu du lot L23 à la fin de
docs/suivi-execution-feuille-route.md.

CE LOT RÉPARE UN DÉFAUT ANTÉRIEUR à la famille L20-L26, pas une régression de
celle-ci. Il touche la base : il lui faut une migration, et la procédure
meddata-db-safety.

CONSTAT, vérifié dans le code. jsonb_matches — dernière définition dans
supabase/migrations/20260818045033_multivalue_terminology_foundation.sql, appelée
aussi bien par cohort_preview que par create_cohort_snapshot — compare
« p_data ->> field ». Or, pour une variable Diagnostic à VALEUR UNIQUE, ce qui est
enregistré n'est pas une chaîne mais un COUPLE {code, label} : « ->> » en rend la
représentation JSON complète, et la comparaison porte donc sur le couple entier
face au seul code fourni. Sur ce type de variable :

  - « est »            -> aucun patient, jamais ;
  - « figure dans »    -> aucun patient, jamais ;
  - « n'est pas »      -> TOUS les patients, y compris ceux qui portent le
                          diagnostic censé être exclu.

La troisième est la dangereuse, parce qu'elle ne se voit pas : le compte est
plausible, la cohorte se publie, et l'analyse est fausse.

L23 a posé un GARDE-FOU, pas une réparation : operatorsFor
(src/screens/member/CohortBuilder.tsx) n'offre plus aucun opérateur pour ce type
de variable, et l'écran affiche à la place la clé cohort.not_filterable. Ce lot
remplace le garde-fou par un filtre qui fonctionne.

LA DÉCISION À PRENDRE AVANT DE CODER — pose-la-moi, ne tranche pas seul. Les deux
voies ne se valent pas :

  A. Apprendre à « eq », « neq » et « in » à regarder À L'INTÉRIEUR du couple
     quand la valeur enregistrée est un objet portant une clé « code ». Aucune
     définition de filtre déjà enregistrée ne change de forme, et les cohortes
     fausses deviennent justes. MAIS une cohorte DYNAMIQUE existante voit sa
     population changer sans que personne n'ait touché son critère.

  B. Ajouter des opérateurs distincts et laisser « eq », « neq » et « in »
     inchangés. Rien ne bouge sous les pieds de l'existant, mais deux façons
     d'exprimer la même chose cohabitent, et les cohortes déjà fausses le restent.

PÉRIMÈTRE.

1. MIGRATION ADDITIVE redéfinissant jsonb_matches (create or replace). Ne modifie
   JAMAIS la migration L20 : elle est appliquée en production depuis le
   2026-08-18.

2. Un code de donnée manquante ({"__missing__": "..."}) ne doit correspondre à
   aucune comparaison de code. Une fiche « non fait » n'est pas une fiche qui
   porte un autre diagnostic.

3. Les variables MULTIVALUÉES ne changent pas : has_any et has_none restent leurs
   deux seuls opérateurs, à l'écran comme au serveur. Ne leur rouvre pas « eq ».

4. FRONT : operatorsFor rend à ce type de variable les opérateurs retenus, la
   valeur se choisit dans le référentiel — réutilise TerminologyInput, comme L23,
   n'écris pas un second sélecteur — et la clé cohort.not_filterable disparaît
   avec le message qu'elle portait.

5. INVENTAIRE, EN LECTURE SEULE : rends la liste des cohortes enregistrées dont
   un critère porte sur une variable Diagnostic. Leur population a été calculée
   avec le défaut, le porteur doit savoir lesquelles revoir. Ne les modifie pas,
   ne les supprime pas.

COUVERTURE DE TEST EXIGÉE.

  - base : « est », « n'est pas » et « figure dans » sur une variable à valeur
    unique — avec le diagnostic, sans lui, clé absente, et code de donnée
    manquante ;
  - une cohorte FIGÉE ne bouge pas après la migration : l'immuabilité se prouve,
    elle ne se suppose pas ;
  - l'aperçu et le figeage rendent la même population — test/cohort-multivalue.test.ts
    livré par L23 est le modèle à suivre ;
  - web : les opérateurs réapparaissent pour ce type de variable, et une variable
    multivaluée n'offre toujours que has_any et has_none.

Parallélisable avec L24 et L25, mais jamais avec un lot qui modifie
CohortBuilder.tsx. (L'exclusion avec L26 tombe : L26 est clos sans exécution.)

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin, à commencer
par la décision A/B ci-dessus. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as construit sur
l'application déployée une cohorte « Diagnostic n'est pas X » sur une variable à
valeur unique, puis vérifié qu'elle EXCLUT les patients portant X — exactement le
cas qui, avant ce lot, les incluait tous en silence. Tu ne t'arrêtes pas avant.
Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

## L35 — Variables calculées : arithmétique définie par l'utilisateur

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L35 » de
docs/lots-paralleles.md.

CE LOT AJOUTE UNE CALCULATRICE, PAS DES FORMULES. L'utilisateur écrit lui-même
le calcul dans son gabarit : duree_sejour = date_sortie − date_entree. Nous ne
livrons aucune formule clinique toute faite — ni IMC, ni Glasgow, ni clairance.
Si tu te surprends à coder un score, tu as quitté le lot.

LE CHOIX STRUCTURANT, déjà arrêté : le résultat n'est JAMAIS stocké. Il n'est
écrit ni dans encounter.data ni dans patient.data, et aucune RPC ne le calcule.
Il est recalculé à l'affichage et à l'export. La raison est vérifiable dans le
dépôt : src/domain/export.ts n'est qu'un ré-export de
supabase/functions/generate-export/exportContract.ts, donc le front et l'Edge
Function de production lisent le MÊME module TypeScript. Un évaluateur posé là
tourne à l'identique aux deux endroits, et le hors-ligne fonctionne sans travail
supplémentaire. Ne déplace pas ce calcul en PL/pgSQL : ce serait une seconde
implémentation de la même sémantique sur des valeurs cliniques.

LA DÉCISION À PRENDRE AVANT DE CODER — pose-la-moi, ne tranche pas seul. La
formule appartient-elle à la VERSION de gabarit, comme les autres attributs
d'une variable ?

  A. Oui. Une fiche saisie sous l'ancienne version garde le résultat de
     l'ancienne formule. Cohérent avec la complétude, qui évalue déjà chaque
     dossier contre sa propre version. MAIS corriger une formule fausse ne
     répare pas le passé.

  B. Non. La formule est unique et toute correction s'applique rétroactivement.
     Les résultats déjà lus et cités changent alors sans préavis.

Ma recommandation est A. Attends ma réponse.

PÉRIMÈTRE.

1. MIGRATION ADDITIVE : une colonne « formula » NULLABLE sur template_field. Ne
   modifie aucune migration existante. La formule est VALIDÉE au moment où la
   variable est enregistrée — opérandes existants, types compatibles, syntaxe
   acceptée — sur le modèle de default_value (L28, migration
   20260814090000_template_field_default_value.sql). Une formule invalide est
   refusée à l'enregistrement du gabarit, pas découverte à la saisie.

2. GRAMMAIRE FERMÉE, et rien de plus : + − × ÷ entre variables number/integer
   et constantes littérales, plus date − date qui rend un nombre de jours
   (durée de séjour, âge à l'inclusion). Pas de condition, pas d'imbrication,
   pas d'appel de fonction. Les opérandes sont des variables SAISIES du même
   gabarit : une variable calculée ne peut pas en référencer une autre. Cette
   interdiction SUPPRIME la détection de cycles au lieu de la coder — ne
   l'assouplis pas « pour rendre service ».

3. ÉVALUATEUR dans exportContract.ts, type de sortie DÉDUIT et non choisi :
   number en général, nombre entier de jours pour date − date.

4. VALEURS MANQUANTES. Si un opérande est absent, ou porte l'un des cinq codes
   (non_fait, inconnu, non_applicable, refus, non_documente), le résultat est
   ABSENT — jamais zéro. Une division par zéro donne également un résultat
   absent, ni erreur ni infini. Un zéro fabriqué serait lu comme une mesure.

5. CONSTRUCTEUR (src/screens/staff/FieldForm.tsx) : saisie de la formule, liste
   des opérandes admissibles, type de sortie affiché.

6. FORMULAIRE (src/screens/member/EncounterFields.tsx) : la variable calculée
   s'affiche en LECTURE SEULE et se met à jour quand un opérande change. Elle
   n'est jamais saisissable.

7. REFUS AU MAPPAGE D'IMPORT (src/domain/import.ts) : une variable calculée
   n'est pas proposée comme colonne cible. Refus explicite, sur le modèle de
   L24. Une colonne importée serait ignorée en silence, ou contredirait la
   formule.

8. CONSTRUCTEUR DE COHORTES (src/screens/member/CohortBuilder.tsx) : une
   variable calculée n'y figure pas, et l'écran dit pourquoi. jsonb_matches
   compare « p_data ->> field » ; la clé n'existant pas, le filtre serait muet
   et non faux. Ne cherche pas à le faire marcher : c'est hors périmètre, et
   c'est ce qui garderait le lot petit.

9. COMPLÉTUDE. base_completeness_stats et base_completion_queue doivent IGNORER
   les variables calculées. Rien n'étant stocké, elles apparaîtraient sinon à
   0 % chez tout le monde, dans une file « à compléter » où personne ne peut
   rien compléter. ATTENTION : PL/pgSQL doit savoir qu'une variable est
   calculée — un simple test « formula is not null » — mais ne doit JAMAIS
   évaluer la formule. Cette distinction est la propriété qui tient tout le lot.

COUVERTURE DE TEST EXIGÉE.

  - l'évaluateur : les quatre opérations, date − date en jours, division par
    zéro, opérande absent, et chacun des cinq codes de valeur manquante ;
  - le MÊME jeu de cas donne le MÊME résultat côté web et côté Deno : c'est la
    garantie centrale du lot, elle se prouve, elle ne se suppose pas ;
  - refus d'une formule invalide à l'enregistrement du gabarit — opérande
    inconnu, type incompatible, référence à une autre variable calculée ;
  - base : une variable calculée ne compte ni dans la complétude ni dans la
    file « à compléter » ;
  - web : lecture seule au formulaire, absence au mappage d'import, absence au
    constructeur de cohortes.

Ce lot touche FieldForm.tsx, exportContract.ts, import.ts et CohortBuilder.tsx.
JAMAIS en parallèle de L21, L22, L23, L24 ni L34.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin, à
commencer par la décision A/B ci-dessus. Ne code rien tant que tu n'as pas mes
réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as créé sur
l'application déployée une variable calculée « durée de séjour = date de sortie
− date d'entrée », puis saisi deux dossiers — l'un complet, l'autre portant
« non documenté » sur la date de sortie. Tu as vérifié que le premier affiche le
bon nombre de jours au formulaire ET dans l'export, et que le second laisse la
valeur VIDE et non zéro, aux deux endroits. Tu ne t'arrêtes pas avant. Si une
commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

## L36 — Parité d'export des listes à choix multiples

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L36 » de
docs/lots-paralleles.md.

LE BUT EST L'ANALYSE, PAS LA SYMÉTRIE DU CODE. Celui qui exploite les données
est le médecin lui-même, occasionnellement un statisticien. Aujourd'hui, un
champ multiselect sort en DEUX colonnes — libellés et codes joints par « ; »
(optionCells, supabase/functions/generate-export/exportContract.ts:155). Pour
compter les dossiers portant un signe, il faut découper la cellule à la main.
La terminologie multivaluée, elle, sort déjà avec une colonne nb__, des
colonnes indicatrices has__ en 1/0, et une feuille dédiée au format long.

Les colonnes indicatrices 1/0 sont LE livrable : elles s'analysent directement
dans Excel, SPSS, Stata ou R, sans jamais toucher au texte. La feuille au format
long est un confort pour le statisticien. Si l'effort doit être réduit, c'est
elle qu'on coupe, jamais les indicatrices.

CONSTAT, vérifié dans le code. Cinq portes se ferment successivement, dans
supabase/functions/generate-export/exportContract.ts sauf mention contraire :

  - columnsForFields (:219) teste « type === 'terminology' » AVANT isMultiple :
    un multiselect n'atteint jamais la branche multivaluée, il tombe dans
    isOptionList et repart avec ses deux colonnes ;
  - assignField (:326) sort par « if (field.type !== 'terminology') return; »
    avant d'écrire nb__ ;
  - extractMultivalueCodes (:362) filtre sur isMultiple ;
  - handler.ts (:576) filtre lui aussi sur isMultiple pour bâtir les feuilles ;
  - buildMultivalueTable (:542) ne sait lire que isTerminologyList et
    isTerminologyValue, alors qu'un multiselect stocke un string[] de codes
    d'option — une forme de valeur qu'elle ne reconnaît pas.

LA DOUBLE GARDE DE columnsForFields EST LE PIÈGE : relâcher isMultiple ne suffit
pas, puisque le test de type se ferme en amont. Il faut AJOUTER UNE BRANCHE, pas
assouplir un filtre.

CE QUE TU NE DOIS PAS FAIRE. is_multiple reste réservé au type terminology : la
contrainte template_field_multiple_terminology_only
(supabase/migrations/20260818045033_multivalue_terminology_foundation.sql:13-15)
impose « check (not is_multiple or type = 'terminology') ». NE LA TOUCHE PAS.
C'est la couche export qui reconnaît le multiselect comme une liste
multivaluée. Ce lot ne comporte donc NI migration, NI validation serveur, NI
constructeur, NI instantané hors-ligne. Si tu écris une migration, tu as quitté
le lot — arrête-toi et dis-le-moi.

LA DERNIÈRE DÉCISION À PRENDRE — pose-la-moi : quand la variable porte un code
de valeur manquante, nb__ vaut-il 0 ou reste-t-il vide ? Les indicatrices sont
déjà tranchées à 0 (exportContract.ts:449-450). Le select à valeur unique, lui,
est HORS de ce lot : il est couvert par L37.

PÉRIMÈTRE.

1. nb__<champ> : le nombre d'éléments cochés.

2. has__<champ>__<code normalisé> en 1/0, sous le MÊME plafond
   MAX_INDICATOR_CODES (100 codes distincts, :342) et avec la MÊME
   normalisation normalizeIndicatorSuffix (:344) que la terminologie. Ne
   réinvente ni l'un ni l'autre.

3. FEUILLE DÉDIÉE au format long (patient_code, encounter_id, rang, code,
   label), par généralisation de buildMultivalueTable — à qui il faut apprendre
   la seconde forme de valeur, le string[] de codes d'option.

4. LIGNES DE DICTIONNAIRE pour les nouvelles colonnes.

5. Les libellés viennent de allowed_options via labelOfOption (livré par L30).
   UN CODE INCONNU RESTE RENDU TEL QUEL : c'est une règle verrouillée par le
   test exportContract_test.ts:200-205. Dans la feuille longue, il ressortira
   donc identique en code et en label.

6. Une valeur manquante codifiée met les indicatrices à 0, comme pour la
   terminologie (:449-450).

7. CORRECTION D'UNE LIGNE, incluse dans ce lot : buildDictionary nomme les
   indicatrices par leur CODE (label: `${f.label} — ${ind.code}`, :694) alors
   que IndicatorMeta porte déjà un champ label, renseigné en :399 par
   « labelByCode.get(code) ?? code ». Le libellé est calculé, transporté, puis
   ignoré : le médecin lit « Signes — fievre » au lieu de « Signes — Fièvre »,
   et « Diagnostics — S06.5 » sans son intitulé. Note que cette correction
   améliore aussi la sortie de la terminologie multivaluée, pas seulement celle
   du multiselect.

LE TEST À RÉÉCRIRE, PAS À SUPPRIMER. « liste multiple : libelles et codes
voyagent dans le meme ordre » (exportContract_test.ts:207-220) fige aujourd'hui
les deux colonnes. Ce qu'il garantit de précieux, c'est l'ORDRE partagé entre
libellés et codes ; seul le nombre de colonnes attendu change. Garde
l'assertion d'ordre.

COUVERTURE DE TEST EXIGÉE.

  - un multiselect à trois options : les trois colonnes has__ portent bien 1 et
    0 aux bons endroits, et nb__ compte juste ;
  - un code inconnu reste rendu tel quel, dans la feuille principale comme dans
    la feuille longue ;
  - une valeur manquante codifiée met les indicatrices à 0 ;
  - au-delà de 100 codes distincts, le champ part dans omittedFieldKeys et le
    dictionnaire le dit ;
  - le dictionnaire nomme les indicatrices par leur LIBELLÉ ;
  - la terminologie multivaluée livrée par L22 sort exactement comme avant —
    non-régression, ce lot ne doit rien lui changer sauf le libellé du
    dictionnaire.

EFFET DE BORD À SURVEILLER : le plafond de cellules XLSX. handler.ts compte
déjà les cellules des feuilles multivaluées (:594) ; généraliser au multiselect
multiplie les feuilles et rapproche donc le plafond sur les bases larges. Le
mécanisme existe, c'est son déclenchement qui devient plus probable : vérifie
qu'il refuse proprement et n'explose pas.

Ce lot écrit dans exportContract.ts. JAMAIS en parallèle de L22, L35 ni L37.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin, à
commencer par celle sur nb__ ci-dessus. Ne code rien tant que tu n'as pas mes
réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as exporté depuis
l'application déployée une base contenant une variable multiselect à trois
options cochées différemment sur trois dossiers. Tu as ouvert le fichier XLSX,
vérifié la présence des colonnes has__ et de la feuille dédiée, puis fait la
somme d'une colonne has__ et retrouvé le compte exact des dossiers concernés.
Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle
quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

## L37 — Feuille de fréquences prête à l'analyse

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis les fiches « L36 » et
« L37 » de docs/lots-paralleles.md. L36 doit être fusionné avant de commencer.

L36 donne au médecin des colonnes qu'il peut sommer ; CE LOT LUI DONNE LA SOMME.
Une feuille « Fréquences » dans le classeur, une ligne par valeur, avec les
colonnes : variable, code, libellé, n (dossiers portant la valeur),
dénominateur, %, n_manquants. C'est le tableau de fréquences d'un article,
prêt à recopier — le geste que l'analyste refait à la main à chaque étude.

LE DÉNOMINATEUR EST TRANCHÉ, n'y reviens pas. Un dossier où la variable ne
s'applique pas, ou qui porte l'un des cinq codes de valeur manquante (non_fait,
inconnu, non_applicable, refus, non_documente), SORT du dénominateur et est
compté dans n_manquants. Deux fièvres sur trois dossiers renseignés font 67 %,
avec « 1 non documenté » à côté — et non 2 sur 4 = 50 %, qui ferait baisser le
pourcentage à cause d'une donnée absente plutôt que d'un signe absent. Le
dénominateur et le nombre de manquants sont DES COLONNES, pas une note de bas de
page : le pourcentage doit être vérifiable sans quitter la feuille.

L'UNITÉ DE COMPTAGE EST LA LIGNE DE LA FEUILLE PRINCIPALE, et c'est le piège du
lot. En mode rencontre, une ligne égale une rencontre. En mode patient,
buildPatientExport ne retient QU'UNE SEULE rencontre par patient — pickEncounter
avec AggregationRule = 'first' | 'last', exportContract.ts:461 — alors que
extractMultivalueCodes (:477-478) et buildMultivalueTable (handler.ts:587)
reçoivent TOUTES les rencontres. Compter sur toutes les rencontres en mode
patient donnerait à un patient suivi cinq fois un poids de cinq dans un tableau
dont la feuille principale ne le montre qu'une fois. Les fréquences se calculent
sur les lignes EFFECTIVEMENT PRODUITES, jamais sur les données d'entrée.

PÉRIMÈTRE.

1. COUVERTURE UNIFORME : select, multiselect, terminologie à valeur unique et
   terminologie multivaluée. C'est ce qui distingue ce lot de L36 : un select
   n'a pas besoin d'indicatrices, mais il a autant besoin d'une table de
   fréquences que les autres.

2. LE PLAFOND DE 100 CODES NE S'APPLIQUE PAS ICI. MAX_INDICATOR_CODES (:342)
   existe parce qu'une colonne coûte cher ; une ligne ne coûte rien. Une
   variable écartée des indicatrices par omittedFieldKeys doit QUAND MÊME
   recevoir ses fréquences — ce lot rend analysables précisément les variables
   sur lesquelles L36 renonce, ce qui est souvent le cas des diagnostics.

3. VALEURS JAMAIS OBSERVÉES. Pour un select et un multiselect, l'espace des
   valeurs est connu du gabarit (allowed_options, L30) : une valeur jamais
   cochée figure avec n = 0, ce qui est une information (« aucun dossier ne
   porte X »). Pour la terminologie, l'espace est le référentiel entier : seules
   les valeurs observées sont listées.

4. SUR UNE VARIABLE MULTIVALUÉE, LA SOMME DES POURCENTAGES DÉPASSE 100 %. C'est
   normal — un dossier porte plusieurs valeurs — mais la feuille doit l'ÉCRIRE,
   faute de quoi un relecteur y verra une erreur de calcul.

5. XLSX SEULEMENT. Les feuilles annexes n'existent pas en CSV (handler.ts:593-594,
   et « dictionary_included: format === 'xlsx' » en :659). Un export CSV ne
   portera pas la feuille de fréquences, et c'est cohérent : le CSV s'adresse à
   qui sait programmer, précisément le lecteur qui n'a pas besoin de ce lot.

6. Pose le calcul dans un MODULE DÉDIÉ plutôt que dans exportContract.ts : la
   surface de conflit s'en trouve réduite, conformément au critère de découpage
   de docs/lots-paralleles.md. handler.ts et le décompte de cellules XLSX
   restent partagés de toute façon.

COUVERTURE DE TEST EXIGÉE.

  - le dénominateur exclut les cinq codes de valeur manquante ET les dossiers où
    la variable ne s'applique pas, et n_manquants les compte ;
  - MODE PATIENT : un patient à cinq rencontres pèse UNE unité, pas cinq —
    c'est le test qui protège de l'erreur la plus grave du lot ;
  - une variable multivaluée dont les pourcentages somment à plus de 100 % ;
  - une variable écartée des indicatrices (plus de 100 codes) reçoit quand même
    ses fréquences ;
  - un select figure bien dans la feuille ;
  - une option jamais cochée apparaît avec n = 0 ;
  - un export CSV ne porte pas la feuille et n'échoue pas pour autant.

Ce lot écrit dans exportContract.ts et handler.ts. JAMAIS en parallèle de L22,
L35 ni L36.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Le
dénominateur, lui, est déjà tranché — ne me le repose pas. Ne code rien tant
que tu n'as pas mes réponses au reste.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as exporté depuis
l'application déployée une base où au moins un dossier porte « non documenté »
sur la variable observée. Tu as ouvert la feuille « Fréquences », pris une
ligne au hasard, et refait son compte à la main sur la feuille de données : le
n, le dénominateur et le nombre de manquants doivent tomber juste, et le dossier
« non documenté » doit être HORS du dénominateur. Tu ne t'arrêtes pas avant. Si
une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L38 — Interdire `inspection=paused` en production

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L38 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 1 — c'est le SEUL constat coté critique de tout l'audit).

CONSTAT, vérifié dans le code. Le workflow .github/workflows/coordinated-release.yml
déclare l'entrée `inspection` en `type: choice` avec `default: paused` (lignes
24-27), et rien ne l'articule avec `target`. Le job `production` (`if:
inputs.target == 'production'`, ligne 530) s'exécute donc SANS AUCUN CONTRÔLE
qui refuserait `inspection=paused` : une release de production peut aujourd'hui
partir sans verdict antivirus serveur strict sur les fichiers déjà téléversés.
`paused` a été conçu pour le staging fictif — voir le journal B2 de
docs/suivi-execution-feuille-route.md, qui le documente déjà comme état
exceptionnel, jamais comme réglage de production.

CE QUI DOIT DEVENIR IMPOSSIBLE, littéralement :

  target=production ET inspection≠strict

PÉRIMÈTRE.

1. Un refus EXPLICITE et PRÉCOCE dans le workflow — avant tout job de
   déploiement, pas après coup — quand `inputs.target == 'production'` et
   `inputs.inspection != 'strict'`. Message d'erreur clair, pas un échec muet
   plus loin dans la chaîne.

2. `strict` devient la valeur par défaut de l'entrée `inspection` (remplace
   `paused` ligne 26). `paused` reste utilisable, mais seulement pour
   `target=staging`.

3. `.env.production.example` aligné sur `strict`, s'il ne l'est pas déjà.

4. Vérifie `scripts/release-env-check.mjs` et `scripts/check-inspection-env.mjs`
   : si l'un des deux porte déjà une logique proche, RÉUTILISE-la plutôt que
   d'écrire un second contrôle qui pourrait diverger.

CE QUE CE LOT NE FAIT PAS. L'audit suggère un mode « break-glass » séparé pour
les cas exceptionnels. NE L'AJOUTE PAS sans arbitrage explicite du porteur —
ce serait ouvrir volontairement une dérogation, exactement ce que ce lot doit
fermer. Si le sujet se pose, pose-le-moi, ne tranche pas seul.

COUVERTURE DE TEST EXIGÉE.

  - le workflow refuse `target=production` + `inspection=paused` (ou toute
    valeur autre que `strict`) avant le job de déploiement ;
  - `target=staging` + `inspection=paused` continue de fonctionner sans
    changement ;
  - `target=production` + `inspection=strict` continue de fonctionner sans
    changement ;
  - `test/inspection-mode.test.ts` et `test/deployment.test.ts` couvrent déjà
    des cas voisins : vérifie qu'ils passent toujours et étends-les plutôt que
    d'ouvrir un troisième fichier de test pour la même logique.

Ce lot touche uniquement CI/config (`.github/workflows/coordinated-release.yml`,
les scripts release-env-check/check-inspection-env, `.env.production.example`).
Aucun code applicatif React, aucune migration : isolé de tous les autres lots
de cette famille comme de L34 à L37.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — en
particulier si un mode « break-glass » doit exister malgré tout, et sous
quelle forme d'approbation. Ne code rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production (le workflow lui-même, sur
la branche main), ET tu as PROUVÉ le refus en lançant réellement le workflow
« Coordinated release » avec target=production et inspection=paused, en
montrant qu'il échoue AVANT tout déploiement — pas en le lisant, en le
déclenchant. Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la
moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L39 — Durcir la persistance des brouillons cliniques

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L39 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 2, sévérité élevée).

VÉRIFIE D'ABORD CE QUI EST DÉJÀ VRAI, avant de croire l'audit au pied de la
lettre. src/data/drafts.ts documente lui-même, en commentaire de tête : « ne
stocke QUE des données ANALYTIQUES (jamais d'identité) », partitionné par
`getOfflineUser()` (poste partagé : un autre compte ne retrouve pas le
brouillon d'un tiers), effacé à l'enregistrement réussi, TTL 72 heures
(`DRAFT_TTL_MS`). Une partie du risque décrit par l'audit (confusion avec
l'identité patient) NE S'APPLIQUE DONC PAS tel quel. Ce qui reste vrai : les
valeurs cliniques analytiques (résultats, dates, observations — voir
`EncounterDraft` dans src/screens/member/EncounterForm.tsx) restent lisibles
EN CLAIR dans `localStorage` du profil navigateur pendant 72 heures.

LA RECOMMANDATION PRINCIPALE DE L'AUDIT CONTREDIT UN CHOIX PRODUIT DÉLIBÉRÉ —
NE LA SUIS PAS TELLE QUELLE. « Brouillon → serveur » romprait le fonctionnement
hors-ligne du formulaire de rencontre, qui doit rester utilisable sans réseau.
Les pistes de repli que l'audit liste lui-même, en cas d'impossibilité du
premier choix, conviennent mieux ici.

LA DÉCISION À PRENDRE AVANT DE CODER — pose-la-moi, ne tranche pas seul :

  A. Réduire fortement le TTL (72 h est long pour une simple protection
     anti-perte de saisie en cours) ET migrer le stockage de `localStorage`
     brut vers un support déjà chiffré/partitionné du projet (la base locale
     utilisée pour la copie de terminologie ou l'outbox hors-ligne), plutôt
     que d'inventer un troisième mécanisme de stockage local.

  B. Garder `localStorage` mais réduire le TTL de façon plus drastique
     (quelques heures, pas 72) et purger plus agressivement — à la sortie
     réussie de l'écran, pas seulement au logout/changement de compte comme
     aujourd'hui (AuthProvider.tsx, `clearDraftsForCurrentUser`).

Ma recommandation est A, parce que le stockage clair reste le problème même
avec un TTL court. Attends ma réponse avant d'écrire du code.

PÉRIMÈTRE (une fois la décision prise) : src/data/drafts.ts,
src/data/drafts.test.tsx, src/screens/member/EncounterForm.tsx (et
EncounterForm.test.tsx pour les tests existants à faire évoluer, pas à casser).
Aucune surface base, aucune migration.

CONTRAINTES À PRÉSERVER, quelle que soit la voie choisie :
  - le brouillon reste analytique seulement, jamais d'identité — ne l'étends
    pas à `patient_identity` ;
  - le partitionnement par utilisateur courant reste intact ;
  - `saveDraft`/`loadDraft` restent best-effort : indisponibilité ou quota
    dépassé ne doit jamais bloquer la saisie (`try/catch` silencieux existant,
    à conserver) ;
  - la récupération après fermeture accidentelle de l'onglet doit continuer de
    fonctionner — c'est la fonction A4 du cahier, ne la supprime pas en
    corrigeant le risque.

COUVERTURE DE TEST EXIGÉE.

  - un brouillon sauvegardé n'est plus lisible en clair dans le support de
    stockage choisi (si voie A : absent de `localStorage`) ;
  - le nouveau TTL expire bien un brouillon trop ancien ;
  - la purge agressive s'exécute à la sortie réussie de l'écran, en plus du
    logout ;
  - non-régression : un brouillon sauvegardé est toujours rechargé après un
    rechargement de page simulé, sur le même patient et le même utilisateur.

AVANT DE COMMENCER : pose-moi la décision A/B ci-dessus, et toutes les
questions dont tu as besoin sur le nouveau TTL exact. Ne code rien tant que
tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as vérifié sur
l'application déployée qu'un brouillon de rencontre n'est plus lisible en clair
au-delà du support attendu, ET que la récupération après fermeture accidentelle
fonctionne toujours. Tu ne t'arrêtes pas avant. Si une commande t'est refusée,
donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L40 — Limites de dimensions/mégapixels sur les images

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L40 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 3, sévérité moyenne).

CONSTAT. src/domain/imageUpload.ts borne déjà `MAX_IMAGE_BYTES` (8 Mo,
réencodage EXIF) mais rien ne borne les DIMENSIONS décodées. Une image très
compressée (donc légère en octets) mais gigantesque en pixels — par exemple un
scan à très haute résolution — passe la validation par taille de fichier, puis
coûte cher en mémoire au moment du décodage/réencodage, avant même l'envoi.

PÉRIMÈTRE.

1. Ajoute une vérification des dimensions décodées AVANT le réencodage complet
   — `createImageBitmap` (ou équivalent) pour lire `width`/`height` sans
   nécessairement matérialiser tout le pipeline de réencodage si le fichier
   dépasse les plafonds.

2. Plafonds explicites : largeur maximale, hauteur maximale, et/ou nombre
   maximal de mégapixels (largeur × hauteur). Propose des valeurs raisonnables
   pour des photos de dossier médical (documents, plaies, radios scannées) —
   pose-moi la question si tu hésites entre deux ordres de grandeur.

3. Message d'erreur clair côté `validateImageFile`/`validateAttachmentFile`,
   sur le modèle des erreurs de taille existantes (`Image trop volumineuse
   (max X Mo)`).

4. Libère explicitement la ressource de décodage une fois la validation faite
   (`close()` sur l'`ImageBitmap` ou équivalent) : ne laisse pas le bitmap
   décodé vivre plus longtemps que nécessaire.

COUVERTURE DE TEST EXIGÉE.

  - une image sous les plafonds de dimensions passe la validation ;
  - une image au-delà d'un des plafonds (largeur, hauteur, ou mégapixels) est
    refusée AVANT le réencodage complet, avec un message clair ;
  - la ressource de décodage est libérée après validation, y compris en cas de
    refus.

Fichier principal : src/domain/imageUpload.ts — PARTAGÉ avec L44 (même
catalogue `ALLOWED_ATTACHMENT_FORMATS`/`ALLOWED_IMAGE_TYPES`). NE JAMAIS
lancer ce lot en même temps que L44.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — en
particulier les plafonds exacts de largeur/hauteur/mégapixels. Ne code rien
tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as essayé d'ajouter
une pièce jointe image dépassant les plafonds sur l'application déployée pour
vérifier le refus, PUIS une image conforme pour vérifier qu'elle passe. Tu ne
t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L41 — `react-hooks/exhaustive-deps` en erreur bloquante

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L41 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 4, sévérité moyenne).

ATTENTION AUX DEUX COLLISIONS DE FICHIER AVANT DE COMMENCER — vérifie avec moi
qu'elles sont soldées :

  1. `CohortBuilder.tsx` (lignes 121 et 133) est aussi un fichier de L35
     (variables calculées). NE COMMENCE PAS avant que L35 soit fusionné.
  2. `NewPatient.tsx` (ligne 121) est dans le MÊME `useCallback` que la ligne
     114 que L42 (génération du code patient côté serveur) modifie. NE LANCE
     PAS ce lot en parallèle de L42 : soit L42 est fusionné d'abord, soit tu
     traites `NewPatient.tsx` en dernier, une fois L42 réglé.

CONSTAT. eslint.config.js:33 porte `'react-hooks/exhaustive-deps': 'warn'`. 28
fichiers contiennent une suppression `// eslint-disable-next-line
react-hooks/exhaustive-deps` (liste complète disponible via `grep -rn
"eslint-disable.*exhaustive-deps" src/`). Une dépendance manquante peut créer
une fermeture périmée (stale closure) ou un comportement de synchronisation
faux, difficile à repérer en revue.

PÉRIMÈTRE, DANS CET ORDRE — NE PASSE PAS LA RÈGLE EN `error` GLOBALEMENT AVANT
D'AVOIR TRAITÉ CHAQUE SUPPRESSION :

1. Pour CHACUNE des 28 suppressions (hors CohortBuilder.tsx et NewPatient.tsx
   tant que les collisions ci-dessus ne sont pas résolues), lis le code
   environnant et détermine si la dépendance manquante est :
   (a) réellement sans effet — la fonction/valeur omise est stable ou n'a pas
       besoin d'être surveillée — auquel cas retire le commentaire et corrige
       le tableau de dépendances pour qu'il soit exact plutôt que supprimé ;
   (b) un vrai défaut — la dépendance manque et son ajout changerait le
       comportement (nouvel appel, re-render). Dans ce cas, corrige le fond
       (stabilise la référence avec useCallback/useMemo si c'est la fonction
       qui bouge sans raison, ou ajoute la dépendance si le comportement
       correct exige de réagir à son changement) — NE contourne PAS en
       ajoutant la dépendance sans vérifier que ça ne déclenche pas une boucle
       de rendu ou une requête réseau en trop.

2. Une fois les 26 fichiers hors collision traités et la CI verte, active
   `'react-hooks/exhaustive-deps': 'error'` dans eslint.config.js.

3. Traite ensuite `CohortBuilder.tsx` et `NewPatient.tsx` séparément, une fois
   L35 et L42 respectivement fusionnés — reviens me voir à ce moment plutôt
   que d'anticiper leur contenu.

COUVERTURE DE TEST EXIGÉE.

  - pour chaque correction de catégorie (b) ci-dessus, un test qui aurait
    échoué sans le correctif (par exemple : un effet qui aurait dû se
    redéclencher et ne le faisait pas) ;
  - `npm run lint` est vert avec la règle en `error`, sur l'ensemble du
    périmètre traité.

Ce lot est le plus long de la famille : ne bâcle pas la vérification par
fichier au profit de la vitesse.

AVANT DE COMMENCER : confirme-moi que L35 est fusionné (pour CohortBuilder.tsx)
et l'état de L42 (pour NewPatient.tsx) avant d'ouvrir ces deux fichiers en
particulier. Pose-moi aussi toute question sur un cas ambigu rencontré en
cours de route — tu n'as pas à tout deviner seul sur un projet médical où une
boucle de requête mal corrigée a un coût réel.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : la règle est en `error` en production (dans la config
publiée), les 28 suppressions sont résolues au fond ou retirées à bon droit, et
tu as vérifié sur l'application déployée qu'aucun des écrans corrigés n'a
régressé (boucle de rendu, requête en trop, donnée non rafraîchie). Tu ne
t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L42 — Génération du code patient côté serveur

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L42 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 5, sévérité moyenne-faible).

Ce lot touche la base de données : charge la Skill meddata-db-safety et
applique-la.

COLLISION DE FICHIER — vérifie avec moi que L41 (exhaustive-deps) n'est pas en
cours sur NewPatient.tsx avant de commencer : les deux lots modifient le même
`useCallback` (ligne 114 pour ce lot, ligne 121 pour L41).

CONSTAT, vérifié dans le code. src/screens/member/NewPatient.tsx:114 calcule
côté client :

  `P-${String(existing + 1).padStart(4, '0')}`

à partir du dernier compte connu (`existing`, obtenu plus haut dans le même
`useCallback`). Deux créations de patient simultanées sur la MÊME base peuvent
donc proposer le même code. La contrainte d'unicité en base
(`uq_patient_base_code`, déjà en place) empêche la corruption des données, mais
l'utilisateur reçoit une erreur au lieu d'un code correct du premier coup —
mauvaise expérience, pas un risque d'intégrité.

PÉRIMÈTRE.

1. MIGRATION ADDITIVE : une fonction/RPC transactionnelle d'allocation de code,
   `SECURITY DEFINER` comme les autres RPC d'écriture du projet, qui verrouille
   ou utilise une séquence PAR BASE pour garantir qu'aucun code n'est distribué
   deux fois même sous création concurrente. Ne modifie AUCUNE migration
   existante.

2. `src/data/patients.ts` : `createPatient` (ou une fonction dédiée
   `allocatePatientCode`) appelle cette RPC pour obtenir le prochain code,
   plutôt que de recevoir `input.code` calculé côté client.

3. `NewPatient.tsx` : perd le calcul local de la ligne 114. Le code proposé à
   l'écran vient de l'appel serveur. Décide avec moi si le code s'affiche
   AVANT la soumission (appel dédié « prévisualiser le prochain code ») ou
   SEULEMENT au moment de la création — la seconde option est plus simple et
   évite d'exposer un code qui pourrait être pris par une création concurrente
   entre-temps.

4. RLS/tests : la RPC d'allocation doit être testée pour la même autorisation
   que la création de patient elle-même — pas de fuite d'un compteur de base à
   un utilisateur qui n'y a pas accès.

RÈGLES ABSOLUES (rappel de meddata-db-safety) :
  - nouvelle migration horodatée, additive ;
  - `npm run schema`, `npm run build` et `npm run manifest` avant de fusionner ;
  - la base reste la source de vérité de l'unicité — ne retire pas
    `uq_patient_base_code` en pensant que l'allocation centralisée suffit,
    elle reste le filet de sécurité final.

COUVERTURE DE TEST EXIGÉE.

  - deux allocations concurrentes sur la même base ne produisent jamais le
    même code (test de concurrence réel, pas seulement séquentiel) ;
  - l'allocation est refusée à un utilisateur sans droit de création sur la
    base ;
  - une base existante avec des patients déjà créés continue de fonctionner :
    le prochain code alloué suit bien le dernier existant, pas de collision
    rétroactive.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — en
particulier le choix du point 3 (aperçu avant soumission ou non), et confirme
l'état de L41 sur NewPatient.tsx. Ne code rien tant que tu n'as pas mes
réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner, promouvoir jusqu'à main, ET à appliquer la
migration sur le cloud — staging d'abord, production ensuite, via la release
coordonnée. Tu n'as pas besoin de me redemander à chaque étape.

CONDITIONS :
- la CI doit être verte. Si elle est rouge, tu corriges la cause ;
- la production passe APRÈS un staging réussi.

TERMINÉ SIGNIFIE : la migration est en production, l'interface est déployée,
et tu as créé DEUX patients à la suite sur la même base depuis l'application
déployée pour vérifier que les codes sont distincts et corrects du premier
coup. Tu ne t'arrêtes pas avant. Si une commande t'est refusée, donne-la-moi
telle quelle.

Rappel : uniquement des données fictives.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L43 — Gestion explicite de l'échec de `getSession()`

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L43 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorité 6, sévérité moyenne-faible).

CONSTAT. src/auth/AuthProvider.tsx:224 initialise la session ainsi :

  `void backend.getSession().then(applyUser);`

Aucun `.catch` ni traitement explicite du rejet dans ce chemin. Un échec réseau
ou un rejet de la Promise au démarrage (`getSession()` qui échoue) peut laisser
l'application dans son état de chargement initial indéfiniment, ou produire un
rejet de Promise non géré selon l'environnement — plutôt que de retomber
proprement sur l'écran de connexion.

PÉRIMÈTRE. Ajoute un traitement explicite du rejet — `.catch` sur cette chaîne,
ou `try/catch` si tu préfères réécrire en `async/await` — qui bascule
l'application sur l'état déconnecté (`setStatus('unauthenticated')` ou
équivalent déjà utilisé ailleurs dans ce fichier pour un échec d'authentification).
Comportement fail-closed : en cas de doute sur l'état de la session, l'utilisateur
est traité comme non connecté, jamais comme connecté par défaut.

Vérifie aussi `onAuthChange` juste en dessous (ligne 225) : si son callback peut
lui aussi rejeter silencieusement, applique la même discipline.

COUVERTURE DE TEST EXIGÉE.

  - `getSession()` qui rejette fait basculer l'état sur déconnecté, pas sur un
    chargement infini ;
  - aucun rejet de Promise non géré n'est produit par ce chemin (le test doit
    le vérifier, pas seulement l'état final) ;
  - non-régression : `getSession()` qui réussit continue de fonctionner
    exactement comme avant.

Fichier principal : src/auth/AuthProvider.tsx. Petit lot isolé, aucune surface
base.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin. Ne code
rien tant que tu n'as pas mes réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as simulé un échec
de `getSession()` (mock ou coupure réseau contrôlée) pour vérifier que
l'application retombe proprement sur l'écran de connexion plutôt que de rester
bloquée en chargement. Tu ne t'arrêtes pas avant. Si une commande t'est
refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L44 — Validation DOCX/XLSX et nettoyage des métadonnées d'upload locales

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis la fiche « L44 » de
docs/lots-paralleles.md et docs/audits/audit-technique-complet-2026-08-18.md
(priorités 7a et 7b, sévérité faible chacune, regroupées ici car toutes deux
dans le périmètre Storage/upload — sur le modèle de L24, petit lot isolé).

COLLISION DE FICHIER — ne lance pas ce lot en même temps que L40 : les deux
modifient src/domain/imageUpload.ts (catalogue `ALLOWED_ATTACHMENT_FORMATS`).

PARTIE A — VALIDATION DOCX/XLSX.

CE QUI EXISTE DÉJÀ, ne le refais pas : src/domain/imageUpload.ts porte une
détection par MAGIC BYTES (`detectContainer`, lignes 87-97) qui confirme déjà
le CONTENEUR réel (ZIP pour docx/xlsx, OLE pour doc/xls) contre l'extension
déclarée — c'est plus robuste qu'une simple vérification d'extension, et le
commentaire du fichier (lignes 72-79) documente déjà honnêtement sa limite :
« la signature confirme le CONTENEUR, pas le sous-type Office exact ». L'audit
sous-estime donc ce qui est en place ; la faiblesse réelle est précise, pas
générale : un fichier ZIP dont le CONTENU interne ne correspond pas à un docx/
xlsx valide (par exemple un ZIP quelconque renommé .docx) passe la vérification
actuelle, puisque « PK.. » suffit à la valider comme conteneur ZIP.

PÉRIMÈTRE.

1. Pousse la vérification un cran plus loin QUAND le conteneur détecté est
   `zip` et l'extension déclarée `docx`/`xlsx` : ouvre l'archive ZIP côté
   client (une bibliothèque de lecture ZIP légère, ou une lecture manuelle de
   l'en-tête central) et vérifie la présence de `[Content_Types].xml` à la
   racine, PLUS le dossier `word/` pour docx ou `xl/` pour xlsx. Ne va pas
   plus loin qu'une vérification de présence de ces entrées — ce lot ne
   parse pas le XML interne.

2. Documente EXPLICITEMENT, dans le commentaire du fichier, que cette
   vérification reste une défense en profondeur CÔTÉ CLIENT et ne remplace
   PAS l'inspection serveur (ClamAV / scanner strict, cf. L38) qui reste la
   vraie ligne de défense contre un contenu malveillant. Ne fais pas croire,
   dans un message d'erreur ou un commentaire, que ce contrôle client suffit
   à garantir un fichier sûr.

3. Si une bibliothèque tierce est nécessaire pour lire l'en-tête ZIP, vérifie
   qu'elle est LÉGÈRE, sans dépendance transitive lourde, et documente-la dans
   package.json comme les autres dépendances vendored du projet — voir
   comment SheetJS a été traité (licence, empreinte verrouillée, test
   d'inventaire) pour le niveau de rigueur attendu.

PARTIE B — MÉTADONNÉES D'UPLOAD EN CLAIR.

CONSTAT, vérifié dans le code. src/data/inspection.ts:121-127,
`stableUploadOperationKey(scope, fileHash, label)`, construit une clé
`localStorage` de la forme :

  `${OPERATION_PREFIX}${scope}:${fileHash}:${label ?? ''}`

Le `scope`, le hash du fichier et le `label` voyagent EN CLAIR dans le NOM de
la clé elle-même, lisible par quiconque inspecte le stockage local du
navigateur — même si aucune donnée médicale n'y est écrite en valeur, le nom
de la clé peut déjà renseigner sur ce qui a été téléversé.

PÉRIMÈTRE.

1. Remplace la clé lisible par une clé OPAQUE — par exemple un hash de
   `scope:fileHash:label` plutôt que leur concaténation en clair — tout en
   conservant l'idempotence actuelle (même triplet → même clé → même
   opération retrouvée).

2. Vérifie l'appelant en ligne 82 (`p_idempotency_key: input.idempotencyKey`)
   : la clé envoyée AU SERVEUR peut rester ce qu'elle est aujourd'hui si le
   serveur ne fait qu'un test d'égalité — seule la PORTION STOCKÉE EN LOCAL
   doit devenir opaque. Vérifie ce point avant de tout changer : ne casse pas
   l'idempotence serveur en modifiant la forme de la clé transmise sans
   nécessité.

3. Nettoie la métadonnée locale APRÈS finalisation de l'upload — si ce
   nettoyage n'existe pas déjà, ajoute-le (clé retirée de `localStorage` une
   fois l'opération confirmée côté serveur), pour ne pas laisser s'accumuler
   des clés d'opérations terminées.

COUVERTURE DE TEST EXIGÉE.

  - PARTIE A : un vrai .docx passe, un vrai .xlsx passe, un ZIP quelconque
    renommé .docx est refusé, un .doc/.xls (OLE, non concerné par cette
    vérification) continue de passer comme avant ;
  - PARTIE B : `stableUploadOperationKey` ne contient plus `scope`, `fileHash`
    ni `label` en clair dans la clé stockée ; deux appels avec le même triplet
    retrouvent la MÊME opération (idempotence non cassée) ; la clé est retirée
    après finalisation.

Fichiers principaux : src/domain/imageUpload.ts (partagé avec L40, cf.
ci-dessus), src/data/attachments.ts, src/data/inspection.ts.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin — en
particulier si une bibliothèque de lecture ZIP existe déjà dans le projet ou
doit être ajoutée pour la partie A. Ne code rien tant que tu n'as pas mes
réponses.

AUTORISATIONS : tu es autorisé à créer une branche, committer, pousser, ouvrir
une pull request, la fusionner et promouvoir jusqu'à la production, sans me
redemander à chaque étape. Le circuit est : branche de travail -> develop ->
main.

DÉPLOIEMENT — lis ceci avant de promettre quoi que ce soit : vercel.json porte
git.deploymentEnabled: false. Fusionner vers main NE DÉPLOIE RIEN. Le seul
chemin vers le déployé est le workflow manuel « Coordinated release », lancé
d'abord sur staging, puis sur production en lui donnant l'identifiant du run
staging réussi pour le MÊME commit.

CONDITION UNIQUE : la CI doit être verte. Si elle est rouge, tu corriges la
cause — tu ne fusionnes pas, et tu ne désactives pas le contrôle.

TERMINÉ SIGNIFIE : le changement est en production, et tu as vérifié sur
l'application déployée : (1) qu'un ZIP renommé .docx est refusé au dépôt d'une
pièce jointe, tandis qu'un vrai .docx passe ; (2) en inspectant le
`localStorage` du navigateur après un téléversement, qu'aucune clé ne révèle
plus le scope, le hash ou le label en clair. Tu ne t'arrêtes pas avant. Si une
commande t'est refusée, donne-la-moi telle quelle.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```
