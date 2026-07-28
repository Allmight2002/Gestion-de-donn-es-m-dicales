# Prompts prêts à l'emploi, un par lot

- Établi le 2026-07-28, en complément de [`lots-paralleles.md`](lots-paralleles.md)
- Objet : pouvoir lancer chaque chantier dans une session distincte sans le
  réexpliquer

**Avant de lancer deux lots en même temps**, vérifier le tableau de
[`lots-paralleles.md`](lots-paralleles.md) : deux lots qui touchent le même
fichier produiront un conflit de fusion, même si leurs sujets n'ont aucun
rapport. L6, L9 et L14 doivent tourner **seuls**.

Chaque prompt est autonome : le copier tel quel, dans une session ouverte sur le
dépôt. Trois clauses y reviennent volontairement à l'identique — poser les
questions avant de commencer, l'autorisation d'aller jusqu'au bout du circuit, et
la définition de « terminé ».

## État au 2026-07-28

**Vérifier cette liste avant de lancer un thread**, pour ne pas faire refaire du
travail déjà fait :

| Lot | État |
|---|---|
| L1 | **Livré** (PR #88). Prompt conservé pour mémoire, barré ci-dessous. |
| L2 | **Livré** (PR #89). Prompt conservé pour mémoire. |
| L3 | **Livré** (PR #86). Aucun prompt. |
| L5 | **Livré** (PR #91). Prompt conservé pour mémoire. |

**Les dix autres lots sont libres** : L4, L6, L7, L8, L9, L10, L11, L12, L13, L14.

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

Au 2026-07-28, `main` porte L1, L2, L3 et L5 **sans qu'aucun ne soit déployé** :
la production sert encore une version antérieure. Une release coordonnée les
mettra tous en ligne d'un coup.

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

## L6 — Finition de l'interface (à lancer SEUL)

```
Tu reprends un chantier sur le projet MedData (registre-clinique), déjà cloné
dans le répertoire de travail. Lis d'abord CLAUDE.md, puis docs/lots-paralleles.md
(section L6) et docs/idees-post-readiness.md (idée 10).

ATTENTION : ce lot touche neuf écrans. Il doit tourner SEUL. Vérifie avec moi
qu'aucun autre chantier n'est en cours avant de commencer.

PÉRIMÈTRE — trois points, tous constatés dans le code :

1. src/components/AppShell.tsx, autour de la ligne 170 : le bloc nom + rôle n'a
   ni fond ni bordure, alors que le bloc thème/langue juste au-dessus porte une
   séparation. Le rôle est rendu en gris moyen sur fond clair et passe inaperçu.
   C'est pourtant l'élément qui répond à « qui suis-je, avec quels droits » —
   une question qui compte dans un produit où le rôle détermine ce qu'on voit.

2. Les cases à cocher sont celles du système, disséminées dans neuf écrans.
   Remplace-les par un composant commun.

3. Manque de retour visuel sur les changements d'état. Le squelette de chargement
   existe (src/components/Skeleton.tsx) mais n'est presque pas employé : le
   généraliser donnerait déjà beaucoup sans ajouter la moindre animation.

Principe directeur : le dynamisme utile confirme une action ou explique un
changement. Le dynamisme décoratif fatigue et ralentit. Le porteur a demandé
« un peu de dynamisme, pas surcharger » — tiens-t'en là.

AVANT DE COMMENCER : pose-moi toutes les questions dont tu as besoin, et
montre-moi ce que tu comptes faire avant de le généraliser aux neuf écrans. Ne
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

TERMINÉ SIGNIFIE : les changements sont en production et tu les as regardés sur
l'application déployée, dans les deux thèmes (clair et sombre). Tu ne t'arrêtes
pas avant. Si une commande t'est refusée par ton environnement, donne-la-moi
telle quelle plutôt que de chercher un contournement.

Consigne le résultat à la fin de docs/suivi-execution-feuille-route.md.
```

---

## L7 — Protections de branche (B7)

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

## L8 — Suppression et restauration de bases (P2)

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

## L9 — Modèle d'observation d'une base (à lancer SEUL)

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

## L10 — Comptes de mission (P4)

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
