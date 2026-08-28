# Plan de test — preuves de fonctionnement des lots livrés (19 août 2026)

> **Cible** : site déployé (production technique) — https://gestion-de-donn-es-m-dicales.vercel.app
> **Version attendue** : `0.1.0 · production`, commit `5182a530d7d0b6ea000d967f322500dd3e17f275`
> (release coordonnée `32195929060`, réussie le 18 août 2026 sur `main`).
> **But** : produire les preuves de fonctionnement des lots implémentés mais non encore
> éprouvés sur l'application déployée, pour pouvoir les consigner dans
> `suivi-execution-feuille-route.md`.
>
> Ce plan complète `qa-parcours-site.md` et `checklist-fonctionnalites-site.md` (mis à jour
> le 19 août pour couvrir L20-L25 et L27-L33) : il cible **uniquement** les lots dont la
> preuve terrain n'existe pas encore, dans l'ordre logique du produit.

## 0. Règles impératives

- **N'utiliser que des données fictives** (noms, téléphones, adresses inventés).
- Préfixer par `QA-` tout ce qui est créé : patients `QA-P1…`, bases `QA-base-…`, jeux de
  variables `QA-…`, cohortes `QA-…`.
- Ne supprimer **que** ce qui a été créé pour le test (préfixe `QA-`).
- Garder la **console navigateur et l'onglet Réseau ouverts** ; noter chaque erreur rouge
  et chaque requête 4xx/5xx (hors 401 attendus).
- Ne pas tester la charge ni boucler les actions.
- Pour chaque étape : statut **OK / KO / BLOQUÉ / NON TESTÉ** + observation. Une capture
  d'écran est exigée pour toute anomalie visuelle ou fonctionnelle.

## 1. Préambule technique (avant toute session)

1. **Rechargement forcé** (`Ctrl+Shift+R`) sur `/`.
2. Aller dans **Synchronisation** (barre latérale) et relever le panneau « État du
   système » : version, mode, commit affiché.
3. Vérifier que le commit affiché est bien `5182a53…` (sinon : problème de déploiement ou
   de cache — le signaler sans continuer).
4. Se connecter avec le compte **médecin** fictif.
5. Relever l'heure de début de session ; découper en sessions de 20-30 minutes si besoin.

---

## 2. Lot L14 — Chargement de la seule langue active

Fonction : seuls les dictionnaires français et anglais sont des modules dynamiques ; au
premier affichage, seul le dictionnaire de `registre.lang` est demandé ; une bascule
change l'écran courant et la préférence ensemble.

| # | Action | Attendu |
|---|---|---|
| L14-1 | Ouvrir l'appli, rester en français, naviguer sur 3 écrans (Tableau de bord, une base, une fiche) | Aucune erreur console ; les libellés restent en français |
| L14-2 | Basculer la langue en anglais (sélecteur de langue) | L'écran courant bascule sans page blanche ; langue, contenu et préférence changent ensemble ; le libellé du sélecteur reflète l'anglais |
| L14-3 | Recharger la page (`F5`) | La langue reste l'anglais (préférence persistée) |
| L14-4 | Basculer en français sur un écran lourd (ex. base avec formulaire de rencontre) | Même bascule atomique, aucune erreur console |
| L14-5 | Sur l'onglet Réseau, après un `Ctrl+Shift+R`, vérifier qu'un **seul** dictionnaire est chargé (le fichier de l'autre langue absent du trafic) | Un seul chunk de langue chargé |

## 3. Corbeille des bases dans la barre latérale

Fonction : entrée « Corbeille » dans la barre latérale du médecin, avec badge du nombre
de bases supprimées ; page `/trash` : liste avec motif et dates, restauration via modale
de confirmation ; la corbeille reste vide hors-ligne.

| # | Action | Attendu |
|---|---|---|
| COR-1 | Créer une base `QA-base-1`, puis la supprimer (avec motif) | La base disparaît du Tableau de bord |
| COR-2 | Regarder la barre latérale | L'entrée « Corbeille » porte un **badge ≥ 1** |
| COR-3 | Ouvrir la page Corbeille | `QA-base-1` listée avec motif et dates de suppression |
| COR-4 | Restaurer `QA-base-1` via la modale de confirmation | Base de nouveau visible au Tableau de bord ; le badge décroît ; la corbeille est vide |
| COR-5 | En tant que **curateur** (autre compte) | Aucune entrée « Corbeille » dans sa barre latérale |
| COR-6 | (Si possible) en mode hors-ligne, ouvrir la Corbeille | État vide ou message hors-ligne, **aucune** erreur |

## 4. D9/D12 — Menus flottants et retour visuel des boutons

Fonction : les menus flottants se ferment au clic extérieur, à Échap et à la sélection ;
un seul menu ouvert à la fois ; les boutons ont un état `active:` au clic et un état
`pending` (anneau) pendant les actions longues.

| # | Action | Attendu |
|---|---|---|
| D9-1 | Ouvrir le menu « … » d'un gabarit (Mes jeux de variables) puis cliquer **ailleurs** | Le menu se ferme |
| D9-2 | Rouvrir, appuyer sur **Échap** | Le menu se ferme, le focus revient au bouton déclencheur |
| D9-3 | Choisir une entrée du menu | Le menu se ferme et l'action s'exécute |
| D9-4 | Ouvrir deux menus différents sans fermer le premier | Le second s'ouvre seulement après fermeture du premier (un seul ouvert à la fois) |
| D9-5 | Même vérification sur le sélecteur de colonnes de la liste des patients et sur l'écran Gabarits (admin) | Fermeture correcte des trois menus concernés |
| D12-1 | Sur les boutons principaux (Enregistrer, Créer, confirmer une suppression), maintenir le clic | L'état visuel « enfoncé » apparaît (`active:`) |
| D12-2 | Déclencher une action longue (ex. création d'un jeu de variables, confirmation de suppression) | Le bouton passe en état « en attente » (anneau) tant que l'action tourne |

## 5. L20-L21 — Variable « Accepte plusieurs valeurs » et saisie de listes de diagnostics

Fonction : un champ de type `terminology` peut accepter plusieurs valeurs ; à la saisie,
étiquettes numérotées (le 1er = diagnostic principal), retrait d'une valeur, un concept
déjà choisi sort des résultats ; retirer la dernière valeur supprime la clé (jamais une
liste vide).

| # | Action | Attendu |
|---|---|---|
| L21-1 | Jeux de variables → éditer `QA-…` → ajouter une variable de type « diagnostic (référentiel) » | La case **« Accepte plusieurs valeurs »** est visible **seulement** pour ce type |
| L21-2 | Cocher « Accepte plusieurs valeurs », enregistrer | La variable est enregistrée |
| L21-3 | Vérifier la même case sur un type `select` ou `multiselect` | La case **n'apparaît pas** |
| L21-4 | Nouveau patient (ou rencontre) : saisir la variable multivaluée, chercher « palud » puis choisir 3 diagnostics | 3 étiquettes **numérotées** (1, 2, 3) ; un concept choisi n'est plus proposé dans la recherche |
| L21-5 | Retirer la valeur du milieu | L'ordre des autres ne bouge pas (le rang reflète l'ordre de saisie) |
| L21-6 | Retirer la **dernière** valeur | La variable redevient vide (pas de liste vide affichée) |
| L21-7 | Enregistrer la fiche puis la rouvrir | Les diagnostics affichés par leur libellé, dans l'ordre de saisie |
| L21-8 | Choisir une raison de valeur manquante sur la même variable | La raison **remplace** la liste (elle ne s'y ajoute pas) |
| L21-9 | Retirer la case « Accepte plusieurs valeurs » sur une variable **déjà utilisée** (si le serveur l'autorise) | Soit la modification passe, soit un refus explicite est affiché — jamais un échec muet. (Le verrou structurel s'applique aux versions publiées) |

## 6. L22 — Export des listes de diagnostics

Fonction : une variable multivaluée sort en libellés séparés par `; ` dans la colonne
principale, les codes dans une colonne dédiée ; un compteur de valeurs (`nbOf`) ; une
raison de valeur manquante rend la colonne vide (jamais `0`).

| # | Action | Attendu |
|---|---|---|
| L22-1 | Sur la base `QA-…` ayant des fiches avec diagnostics multivalués, générer un export CSV/XLSX | Le fichier se télécharge, bandeau de succès |
| L22-2 | Ouvrir le fichier : colonne de la variable | Libellés séparés par `; ` dans l'ordre de saisie |
| L22-3 | Colonne des codes (le cas échéant) | Codes correspondants dans le même ordre |
| L22-4 | Colonne du nombre de valeurs | Nombre de diagnostics de la fiche (vide si raison de valeur manquante) |
| L22-5 | Fiche avec raison de valeur manquante | Cellule de la liste **vide**, pas `0` |
| L22-6 | (Régression D13/D14) Colonnes du fichier | Ordre conforme à l'affichage du formulaire ; valeurs numériques en **nombre natif** dans le fichier XLSX |
| L22-7 | (D15, limite connue) Variable numérique avec raison de valeur manquante saisie | Noter le type de cellule dans le fichier : le mélange `t='n'`/`t='s'` est **connu et documenté** (D15) — le signaler seulement s'il apparaît sur une variable **sans** raison |

## 7. L23 — Cohortes : filtres sur listes de diagnostics

Fonction : sur une variable multivaluée, seuls « porte au moins un de » et « ne porte
aucun de » sont proposés ; la valeur du critère est une liste de concepts du référentiel ;
les **codes** partent dans le filtre ; un diagnostic **unitaire** n'est proposé à aucun
opérateur (l'écran l'explique).

| # | Action | Attendu |
|---|---|---|
| L23-1 | Base → Analyse → Cohortes → Nouvelle cohorte → ajouter un critère sur la variable multivaluée | Comparaison : **« porte au moins un de »** et **« ne porte aucun de »** uniquement (pas d'égalité) |
| L23-2 | Choisir « porte au moins un de », sélectionner 2 diagnostics dans le référentiel | La valeur du critère est une liste de concepts (pas un texte libre) |
| L23-3 | Voir le résultat (aperçu) | Effectif calculé ; l'aperçu et le figeage donnent le **même** effectif |
| L23-4 | Ajouter un critère sur une variable de terminologie **unitaire** | Aucun opérateur proposé + explication à l'écran (pas d'opérateur faux proposable) |
| L23-5 | Figer la cohorte | Effectif du figeage identique à l'aperçu |
| L23-6 | (Première variable de la base = diagnostic multivalué) | L'opérateur affiché est bien « porte au moins un de » (piège du `eq` par défaut) |

## 8. L24 — Refus au mappage d'import

Fonction : une variable de type `terminology` n'est jamais proposée automatiquement
comme cible ; la tenter à la main est refusée **sans** écraser le mappage existant ; le
rapport nomme les colonnes écartées pour ce motif, distinctement des colonnes ignorées.

| # | Action | Attendu |
|---|---|---|
| L24-1 | Préparer un CSV avec une colonne « Diagnostic » (texte) + 2 colonnes valides | À l'étape de correspondance, la colonne « Diagnostic » n'est **pas** proposée comme cible (auto) |
| L24-2 | Tenter de mapper manuellement la colonne sur la variable de terminologie | Le choix **ne prend pas** ; un message explique que l'import ne sait pas retrouver un diagnostic du référentiel et qu'il faut les saisir à la main |
| L24-3 | Si la colonne avait un mappage valide avant la tentative | Elle **garde** son mappage (pas d'écrasement) |
| L24-4 | Lancer l'aperçu puis l'import | La carte de résultat liste les colonnes écartées « parce qu'elles visent une variable de diagnostic », séparément des colonnes ignorées |
| L24-5 | Vérifier que le bouton « Créer la variable » **disparaît** sur une colonne dont l'en-tête désigne déjà une variable de terminologie | Bouton absent (pas de doublon encouragé) ; reste présent sur une colonne inconnue |

## 9. L25 — Conflit hors-ligne : issue « garder les deux »

Fonction : sur un conflit de synchronisation, si la fusion sauve au moins une valeur de
liste, l'écran propose « **Garder les deux** » avec un **aperçu du résultat fusionné** et
le nombre de valeurs récupérées ; le bouton n'apparaît que si la fusion change quelque
chose.

Prérequis (deux appareils ou deux navigateurs) :
1. Sur le 1ᵉʳ navigateur : base `QA-horsligne` rendue disponible hors-ligne, saisir une
   rencontre avec 1 diagnostic, se **déconnecter du réseau** (DevTools → Network → Offline).
2. Même base en ligne sur le 2ᵉ navigateur : ajouter un diagnostic **différent** à la
   même rencontre, enregistrer.
3. Repasser le 1ᵉʳ navigateur en ligne et lancer la synchronisation.

| # | Action | Attendu |
|---|---|---|
| L25-1 | Après le conflit, ouvrir la carte de conflit (Synchronisation) | Les deux versions (mienne / serveur) affichées |
| L25-2 | Si les deux listes diffèrent | Bouton « **Garder les deux** » présent, avec **aperçu fusionné** et nombre de valeurs récupérées |
| L25-3 | Cliquer « Garder les deux » | La rencontre synchronisée porte l'union des deux listes (ordre local puis nouveautés) |
| L25-4 | Rejouer le même scénario mais avec un conflit sur des champs **sans** liste | Le bouton « Garder les deux » est **absent** (rien à fusionner) |

## 10. L27 — Texte d'aide par variable

| # | Action | Attendu |
|---|---|---|
| L27-1 | Éditeur de variables : saisir une consigne de saisie (ex. « Unité : cm ») sur une variable | Enregistrée, modifiable après première saisie |
| L27-2 | Formulaire de saisie (patient ou rencontre) : ouvrir l'aide de la variable | La consigne s'affiche (aide clavier + lecteur d'écran) |
| L27-3 | Générer un export XLSX | Le **Dictionnaire** contient une colonne `description` avec la consigne |

## 11. L28 — Valeur proposée à la saisie

| # | Action | Attendu |
|---|---|---|
| L28-1 | Éditeur de variables : définir une valeur proposée (ex. pays = « Tchad », date = `__today__`) | Enregistrée sans réécrire les variables existantes |
| L28-2 | Créer une **nouvelle** fiche | Le champ est prérempli et marqué « **proposé** » |
| L28-3 | Enregistrer sans toucher au champ | La valeur proposée est enregistrée comme valeur ordinaire |
| L28-4 | **Corriger** une fiche existante | **Aucun** préremplissage (la proposition ne s'applique qu'à la création) |
| L28-5 | Supprimer la valeur proposée avant enregistrement | La fiche reste sans cette clé (le serveur ne la réécrit pas) |
| L28-6 | Variable oui/non ou à liste avec valeur proposée | Avertissement **non bloquant** affiché au moment de la définition |
| L28-7 | (Régression) Brouillon restauré | Le brouillon n'est pas recouvert par la proposition |

## 12. L29 — Aperçu du formulaire

| # | Action | Attendu |
|---|---|---|
| L29-1 | Éditeur de version d'un gabarit → bouton « **Aperçu du formulaire** » | L'aperçu s'ouvre, bandeau « rien n'est enregistré » |
| L29-2 | Saisir des valeurs dans l'aperçu, fermer l'aperçu | **Aucune** fiche, brouillon ni donnée créée |
| L29-3 | Vérifier la recherche de diagnostics dans l'aperçu | Inactive (champ présent, aucune requête réseau de terminologie) |

## 13. L30 — Options de liste : code interne stable

| # | Action | Attendu |
|---|---|---|
| L30-1 | Éditeur de variables → « **Options de la liste** » sur un `select` | Éditeur structuré (ajouter / renommer / réordonner / désactiver), plus de zone de texte libre |
| L30-2 | Créer une option | Un **code interne** s'affiche en lecture seule à côté du libellé |
| L30-3 | Saisir une fiche sur cette variable | Le **libellé** s'affiche (jamais le code) |
| L30-4 | Désactiver une option | Elle n'est plus proposée à la saisie ; une fiche la portant déjà reste lisible et modifiable |
| L30-5 | Sur une variable **déjà utilisée**, tenter de **retirer** une option | Refus explicite (seule la désactivation est possible) |
| L30-6 | Renommer une option déjà utilisée | Autorisation explicite si le libellé seul change ; le code ne bouge pas |
| L30-7 | Exporter la base | Colonne principale = libellé ; colonne `option_code__…` = code |
| L30-8 | Paramètres → réparer les codes d'options : analyser puis convertir | Aperçu avant conversion ; une valeur non rapprochable est **bloquée et nommée**, jamais devinée |
| L30-9 | Liste des patients et fiche patient avec cette variable | Affichage du **libellé** de l'option (pas du code) |

## 14. L31 — Sections personnalisables

| # | Action | Attendu |
|---|---|---|
| L31-1 | Éditeur de version → « **Sections du formulaire** » | Gestionnaire : créer, renommer, réordonner |
| L31-2 | Créer une section `QA-Imagerie` et y ranger une variable | Le formulaire regroupe la variable sous cette section |
| L31-3 | Puis `Ctrl+Shift+R` et rouvrir le formulaire | La section personnalisée apparaît ; les 3 sections historiques (Clinique, Biologie, Paraclinique) gardent leur traduction |
| L31-4 | Tenter de supprimer une section encore peuplée | Refus expliqué avant le clic (déplacer les variables d'abord) |
| L31-5 | Publier la version | Les sections sont **gelées** (plus de modification possible dans la version publiée) |
| L31-6 | Exporter XLSX | Le Dictionnaire contient `section` (code) et `section_label` |
| L31-7 | Importer un jeu de variables depuis un fichier CSV | Les sections proposées sont celles de la version (et non les 3 figées) |

## 15. L32 — Affichage conditionnel

| # | Action | Attendu |
|---|---|---|
| L32-1 | Constructeur de règles → « **N'afficher une variable que sous condition** » | Nouveau type de règle disponible, sans choix de sévérité |
| L32-2 | Poser : si `imagerie_faite = oui` alors afficher `imagerie_type` | Règle enregistrée |
| L32-3 | Nouvelle fiche : la variable conditionnelle est **masquée** ; cocher la condition | La variable apparaît ; décocher → elle disparaît |
| L32-4 | Saisir une valeur dans `imagerie_type`, puis décocher la condition et **enregistrer** | Bandeau annonçant « N valeur(s) seront retirées à l'enregistrement » ; après enregistrement, la valeur est **effacée** |
| L32-5 | Abandonner la saisie après le bandeau (ne pas enregistrer) | Rien n'est perdu (l'effacement n'a lieu qu'à l'enregistrement) |
| L32-6 | Poser une règle en cycle (A masquée par B et B par A) | Le constructeur **refuse le cycle** en nommant les variables |
| L32-7 | Poser une règle dont la condition porte sur l'autre fiche (patient → rencontre) | Refus explicite |
| L32-8 | Une fiche déjà `curated` portant une valeur d'un champ masqué | Refus à la finalisation (message avec libellé de variable, jamais le contenu) |

## 16. L33 — Raisons de valeur manquante par variable

| # | Action | Attendu |
|---|---|---|
| L33-1 | Éditeur de variables → « Accepter une valeur manquante » | Case décochée par défaut ; cochée → pré-coche les 3 raisons historiques ; les 5 raisons proposées (non fait / inconnu / non applicable / **refus** / **non documenté**) |
| L33-2 | Choisir uniquement `refus` et `non documenté` sur une variable neuve | La saisie ne propose que ces deux raisons |
| L33-3 | Saisir une fiche avec une raison, réouvrir | La raison déjà enregistrée reste affichée |
| L33-4 | Sur une variable **déjà utilisée**, tenter de retirer une raison en service | Refus explicite (l'ajout reste libre) |
| L33-5 | Export | Le Dictionnaire documente l'union des raisons de la colonne ; les codes sont rendus tels quels |
| L33-6 | (Régression) La mention de la case est « Accepter une valeur manquante » (plus « Codes manquants (non fait / inconnu) ») | Libellé à jour |

## 17. L11 — Observabilité des erreurs

Fonction : les erreurs navigateur (plantages React, erreurs globales, promesses rejetées)
sont journalisées côté serveur de façon **expurgée** ; lecture par RPC réservée à
`system_admin` ; écran « État du système » (admin).

| # | Action | Attendu |
|---|---|---|
| L11-1 | En médecin, taper l'URL `/admin/system-status` | Accès refusé (rôle) |
| L11-2 | En **system_admin** : ouvrir « État du système » | L'écran affiche les erreurs récentes (nom technique, résumé, contexte, occurrences, dates) ou un état vide |
| L11-3 | Provoquer une erreur (ex. interruption réseau pendant une action) | Une occurrence apparaît après rafraîchissement |
| L11-4 | Ouvrir les détails d'une entrée | Pile expurgée : **aucun** email, numéro long, jeton ou URL de paramètre |
| L11-5 | Vérifier qu'aucun bouton d'export n'existe sur cet écran | Pas d'export offert |

## 18. Rappels — lots déjà prouvés (non re-testés sauf besoin)

Les lots suivants disposent déjà d'une preuve terrain consignée ; ne les re-tester que si
un lot ci-dessus les croise (régression) :

- **L4** (soupape « diagnostic absent du référentiel ») — clôturé 2026-08-13.
- **L12** (propositions hors liste, « À compléter → Propositions ») — clôturé 2026-08-13.
- **D6/D8** (cohortes dynamiques, « Figer maintenant ») — clôturé 2026-08-13.
- **Idée 11** (suppression d'une cohorte avec preuve d'export conservée) — clôturé 2026-08-13.
- **Comptes de mission** (saisisseur) — déployé 2026-08-11, preuves consignées.

---

## 19. Format du retour attendu (pour consignation dans la docu)

Pour chaque lot, renvoyer :

```text
Lot : L21 — Variable « Accepte plusieurs valeurs » et saisie
Date : 2026-08-19 · Environnement : production technique · Commit : 5182a53
L21-1 : OK   (case visible uniquement sur type terminologie)
L21-2 : OK
L21-3 : KO   (la case apparaissait aussi sur multiselect — capture jointe)
   → Observation : ...
L21-4 : BLOQUÉ (la recherche ne répondait pas — détail : ...)
...
Synthèse : n OK / n KO / n BLOQUÉ / n NON TESTÉ
Verdict en 2 phrases.
```

Chaque résultat sera consigné dans `docs/suivi-execution-feuille-route.md` sous forme de
section « Validation terrain — 2026-08-19 » par lot, avec statut et observations. Les KO
et BLOQUÉ seront reproductibles (étapes, capture) avant d'être traités.
