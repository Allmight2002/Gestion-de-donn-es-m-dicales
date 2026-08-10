# Plan de test du site déployé — instructions pour l'agent QA

> **Cible** : https://gestion-de-donn-es-m-dicales.vercel.app (production, branche `main`).
> **But** : vérifier que les fonctionnalités récentes marchent en ligne, détecter les écarts de
> déploiement (migrations/Edge/storage pas encore appliqués), et produire un rapport structuré.
> **Contexte** : registre clinique de recherche. Toutes les données du site sont **FICTIVES**.

## 0. Règles impératives
- **N'utiliser que des données fictives.** Ne jamais saisir de vrai nom/téléphone/adresse.
- Préfixer **tout ce que tu crées** par `QA-` (patients `QA-001`, groupes `QA-groupe`, jeux de variables `QA-…`).
- **Ne supprimer que ce que tu as créé toi-même** (préfixe `QA-`). Ne pas toucher aux données de démo existantes.
- Ne pas tester la charge/performance (pas de boucles d'actions).
- Ne pas tenter de contourner l'authentification autrement que par les tests négatifs listés en §7.

## 1. Comptes de test
Les identifiants (emails + mots de passe) sont fournis **dans le prompt de l'agent, jamais dans
ce fichier** (dépôt public). Comptes attendus : un médecin « propriétaire », un curateur, et si
possible un 2ᵉ médecin sans accès (tests de cloisonnement §7).

### 1bis. Amorçage si le compte médecin est NEUF (aucune base)
Avant le diagnostic §3, préparer un terrain de jeu :
1. Mes jeux de variables → **Bibliothèque de modèles** → « Utiliser ce modèle » (n'importe lequel).
2. Tableau de bord → créer la base **`QA-base`** à partir de ce jeu de variables (le sélecteur
   sépare « Modèles officiels » et « Mes jeux de variables »).
3. Créer 3 patients `QA-001/002/003` (noms fictifs) avec 1-2 rencontres chacun, en laissant
   volontairement des champs requis vides sur l'un d'eux (alimente « À compléter » et la
   complétude), et **finaliser** un des patients (alimente les statuts).
4. Continuer le plan sur cette base.

## 2. Préambule technique (avant tout test)
1. Le site est une **PWA avec cache** : commencer par un **rechargement forcé** (Ctrl+Shift+R).
2. Garder la **console navigateur ouverte** pendant TOUTE la session ; noter chaque erreur rouge
   (page + message) et chaque requête réseau en échec (4xx/5xx hors 401 attendus).
3. Après connexion, aller sur **Synchronisation** (barre latérale) et noter le panneau « État du
   système » : **Version** affichée (ex. `0.1.0 · production`) → à mettre en tête du rapport.

## 3. Diagnostic de déploiement (à faire EN PREMIER — oriente tout le reste)
Connecté en **médecin propriétaire**, ouvrir une base existante puis :
| Vérification | Si OK | Si KO → cause probable |
|---|---|---|
| Onglet **Statistiques** affiche la courbe + « Complétude par variable » | migrations ≥ 097000 appliquées | `db push` manquant (le reste des stats sera vide) |
| Onglet **À compléter** liste des dossiers (ou message « Rien à compléter ») sans erreur | migration 097100 OK | `db push` manquant |
| Onglet **Journal** affiche des événements + filtre par action | migrations journal OK | `db push` manquant |
| Fiche patient → une **image s'ouvre** au clic | Edge `signed-read` déployée | Edge pas déployée ou `storage.sql` pas rejoué |
| Onglet **Accès** → section « Consultations d'identité (30 j) » visible | migration 095400 OK | `db push` manquant (section masquée = normal alors) |
> Reporter ce tableau tel quel dans le rapport : il dit **quoi corriger côté cloud** avant de juger les fonctionnalités.

## 4. Parcours principal (médecin propriétaire) — dans cet ordre
Chaque étape : noter **OK / KO / BLOQUÉ** + détail si KO + capture d'écran si anomalie visuelle.

### 4.1 Coquille & navigation (UI-1)
1. Barre latérale visible (desktop) : Tableau de bord, Groupes, Mes jeux de variables, Synchronisation, bases récentes.
2. **Ctrl+K** ouvre la palette ; taper le nom d'une base → Entrée → la base s'ouvre.
3. **Thème** (bas de la barre latérale) : passer en **Sombre** → vérifier que la barre latérale devient sombre (pas blanche !), textes lisibles ; passer sur 3-4 écrans en sombre et noter tout élément illisible ; revenir en Clair.
4. Réduire la fenêtre en largeur mobile (~375 px) : barre haute + menu tiroir fonctionnels.

### 4.2 Page d'une base (onglets)
5. Ouvrir une base : fil d'Ariane + onglets (Patients, Importer, Cohortes, À compléter, Statistiques, Journal, Accès, Variables, Curation).
6. **Statistiques** : cartes (Patients inclus/Objectif/Progression) ; fixer un **objectif** (ex. 150 + une date) → toast « Objectif enregistré » → la ligne pointillée apparaît sur la courbe et la progression se met à jour.
7. **Complétude par variable** : les barres s'affichent, les moins complètes en premier, couleurs (rouge/ambre/vert).
8. **À compléter** : cliquer « Compléter » sur une rencontre → le formulaire d'édition s'ouvre avec les bons champs.

### 4.3 Saisie (A2, A4, B5, UI-2)
9. Créer un patient (manuel) `QA-001` avec nom fictif « Test Qa » + date de naissance : vérifier le **toast** « Patient enregistré ».
10. Créer un **second** patient avec le MÊME nom fictif + même date de naissance : l'avertissement de doublon apparaît, la création est **bloquée** tant que la case « Je confirme qu'il s'agit bien d'un patient différent » n'est pas cochée ; cocher → création passe (patient `QA-002`).
11. Nouvelle rencontre sur `QA-001` : le focus est déjà sur la date ; remplir ; enregistrer avec **Ctrl+Entrée** → toast « Rencontre enregistrée ».
12. Rouvrir une nouvelle rencontre, saisir 2-3 champs, **fermer l'onglet** du navigateur, revenir sur la même page : bandeau « **Brouillon récupéré** » avec les valeurs restaurées ; cliquer « Effacer le brouillon » → formulaire vide.
13. Éditer la rencontre créée : le **motif est requis** (essayer sans motif → blocage) ; avec motif → toast ; l'historique de correction s'affiche.
14. Fiche patient : pastilles de statut **colorées** (ambre/bleu/vert), dates lisibles (« 7 juil. 2026 »), « Finaliser » passe le patient en Finalisé (vert).

### 4.3 bis Modèle d'observation (L9)
15. Tableau de bord → créer une base fictive en choisissant **« Une seule saisie par participant »**.
16. Vérifier que, base vide, le choix peut encore être changé ; ouvrir ensuite « Nouveau patient » :
    le formulaire unique est sectionné et aucune action « Ajouter une rencontre » n'est proposée.
17. Ouvrir une base longitudinale existante : l'action « Ajouter une rencontre » doit rester
    présente et ouvrir le choix de saisie de rencontre.
18. Après une première saisie transverse, vérifier que le modèle est verrouillé.

### 4.4 Jeux de variables (F1, F3)
15. Mes jeux de variables → « **Depuis un fichier Excel** » : téléverser un petit CSV créé par toi (colonnes : `Age,Sexe,Date visite,Poids (kg),Commentaire` + 3-4 lignes) → vérifier les **types détectés** (entier/liste M-F/date/nombre/texte), modifier un libellé, décocher une colonne, créer → le jeu de variables `QA-…` apparaît dans Mes jeux de variables.
15bis. **Créer une base depuis le fichier (V3)** : refaire « Depuis un fichier Excel » avec un CSV
   contenant cette fois une colonne `Code patient` (valeurs `QA-F1-1/2`) + 2-3 colonnes de données ;
   **décocher** la colonne `Code patient` dans la proposition (identifiant, pas une variable) ;
   cocher « **Créer aussi une base avec ce jeu de variables** » (nom `QA-base-fichier`) → le bouton
   devient « Créer le jeu de variables + la base » → après création, atterrissage **direct sur
   l'écran Importer** de la nouvelle base (toast). Re-téléverser le même CSV → colonnes
   **auto-mappées** (Code patient → identifiant, les autres → variables) → aperçu → importer →
   les patients `QA-F1-*` apparaissent dans l'onglet Patients.
16. Mes jeux de variables → « **Bibliothèque de modèles** » : les modèles s'affichent (globaux, ou les 4 par défaut avec le bandeau explicatif) ; « Utiliser ce modèle » → clone dans Mes jeux de variables.
17. Supprimer les jeux de variables `QA-` créés.

### 4.5 Groupes (C2)
18. Groupes de recherche : créer `QA-groupe`, y **rattacher** une base, ouvrir le groupe, **retirer** la base, **supprimer** le groupe → la **modale** de confirmation (pas un popup navigateur) apparaît ; la base n'est PAS supprimée.

### 4.6 Import (rappel + §7.8 + import fluide V2)
19. Importer un petit CSV (2 lignes patients fictifs `QA-IMP-1/2`) : aperçu → import → bilan (patients/rencontres/erreurs).
20. **Réimporter le même contenu** (fichier renommé) : l'aperçu affiche « **Déjà importées (ignorées)** » et le commit ne crée **pas de doublon**.
20bis. **Colonne non reconnue → créer la variable sur place** : importer un CSV avec une colonne
   inconnue du jeu de variables (ex. `QA Poids (kg)` avec des valeurs numériques). La colonne reste
   sur « Ignorer » et un bouton « **Créer la variable** » apparaît (propriétaire uniquement) →
   cliquer : mini-formulaire pré-rempli (libellé = en-tête, **type détecté** depuis les valeurs) →
   « Créer la variable » → toast de confirmation, la colonne est **mappée automatiquement** sur la
   nouvelle variable → relancer l'aperçu → importer → la valeur apparaît sur la fiche patient.

### 4.7 Cohortes & exports
21. Créer une cohorte figée simple, générer un **export CSV** → le fichier se télécharge + bandeau de succès.
22. Dans l'historique des exports : « **Télécharger** » un export conservé → le fichier arrive (teste l'Edge `kind=export`).

### 4.8 Accès (C1, E1)
23. Onglet Accès : le sélecteur **« Profil »** propose Investigateur principal / Co-investigateur / Saisie / Moniteur / Personnalisé ; choisir « Saisie » → les cases se cochent toutes seules (saisie uniquement) ; modifier une case → passe en « Personnalisé ». Créer une invitation (email fictif `qa@example.test`) → lien généré ; puis **révoquer** l'invitation.
24. Section « **Consultations d'identité (30 j)** » : présente, listant qui a consulté quels codes patients (après avoir ouvert 1-2 fiches, recharger : tes consultations apparaissent).

### 4.9 Journal (C3)
25. Onglet Journal : les actions récentes du parcours apparaissent (imports, accès, suppressions…) avec dates lisibles ; le **filtre par action** fonctionne ; « Charger plus » si > 50.

## 5. Parcours curateur (compte curateur)
26. Connexion curateur : la barre latérale montre **Pool de curation + Synchronisation** seulement (pas de Tableau de bord médecin, pas de Groupes/Jeux de variables).
27. Ouvrir une tâche du pool si disponible : les documents sont accessibles, mais **AUCUN nom/date de naissance de patient n'est visible nulle part**. Chercher activement : fiche, titres, URLs.

## 6. Hors-ligne (rapide)
28. Sur une base : « Rendre disponible hors-ligne » → passer le navigateur **hors-ligne** (DevTools → Network → Offline) → recharger : bandeau hors-ligne, liste des patients consultable (codes, PAS d'identité), fiche patient lisible ; « À compléter »/actions d'écriture absentes ou en file. Repasser en ligne.

## 6bis. Coopération à deux comptes (médecin propriétaire + 2ᵉ médecin)
> L'invitation n'envoie PAS d'email : elle génère un **lien à partager** ; l'adresse saisie sert de
> **verrou** (seul un compte connecté avec cette adresse peut accepter). Utiliser 2 fenêtres :
> normale (propriétaire) + **navigation privée** (2ᵉ médecin).

- **C1.** Propriétaire : base → Accès → profil **« Saisie »** → email du 2ᵉ médecin → « Créer
  l'invitation » → copier le lien affiché.
- **C2.** Fenêtre privée, connecté en 2ᵉ médecin : coller le lien → invitation acceptée → la base
  apparaît sur son tableau de bord.
- **C3.** Profil appliqué (2ᵉ médecin) : patients visibles (codes) + création de rencontre OK,
  mais **AUCUNE identité** sur les fiches, pas d'onglet Accès, pas d'export.
- **C4.** Propriétaire : l'accès listé avec le profil « Saisie » ; Journal → « Accès accordé » ;
  cocher la permission **Identités** → après rechargement, le 2ᵉ médecin voit l'identité, et ses
  consultations apparaissent dans « Consultations d'identité (30 j) » côté propriétaire.
- **C5.** **Édition simultanée** : les 2 fenêtres ouvrent LA MÊME rencontre en édition ;
  le propriétaire enregistre une correction ; le 2ᵉ médecin enregistre ensuite la sienne →
  il doit être **refusé (conflit de version)**, pas d'écrasement silencieux.
- **C6.** Lien à usage unique : recoller le lien déjà accepté → refus (statut non valable).
- **C7.** Mauvais compte : créer une 2ᵉ invitation pour un email FICTIF différent, coller le lien
  en étant connecté en 2ᵉ médecin → refus (« ne correspond pas à votre compte »).
- **C8.** Révocation (propriétaire) : révoquer l'accès → chez le 2ᵉ médecin, la base disparaît du
  tableau de bord et son URL directe ne renvoie plus rien.

## 7. Tests de sécurité négatifs (comportement ATTENDU = refus silencieux ou blocage)
29. En **médecin**, taper l'URL `/admin` → redirection/blocage (pas d'écran admin).
30. En **curateur**, taper l'URL `/bases/<id-d-une-base>` (récupérer un id depuis la session médecin) → pas de données (RLS).
31. Avec le **2ᵉ médecin sans accès** (si fourni) : la base du propriétaire n'apparaît pas ; l'URL directe de la base → vide/refus ; l'URL directe d'une fiche patient → vide/refus.
32. Déconnexion depuis chaque compte → retour à l'écran de connexion ; bouton Précédent du navigateur → ne réaffiche pas de données.

## 8. Format du rapport attendu
```
# Rapport QA — <date> — version affichée : <…> — commit main attendu : ac7c17f
## 1. Synthèse : X OK / Y KO / Z BLOQUÉ — verdict en 2 phrases
## 2. Diagnostic de déploiement (tableau du §3 rempli)
## 3. Résultats détaillés (par numéro d'étape : OK/KO/BLOQUÉ + observation)
## 4. Anomalies (par gravité) :
   - BLOQUANT (empêche un usage) / MAJEUR (contournable) / MINEUR (cosmétique)
   - pour chaque : étapes de reproduction, attendu vs obtenu, capture
## 5. Console & réseau : erreurs JS relevées + requêtes en échec (URL, code, page)
## 6. Remarques UX libres (confusions, lenteurs ressenties, textes ambigus)
## 7. Nettoyage effectué : liste des éléments QA-* supprimés / restants
```

## 9. Nettoyage final
Supprimer patients `QA-*` (avec motif « test QA »), groupes/jeux de variables/cohortes `QA-*`, révoquer les invitations `qa@example.test`. Noter ce qui n'a pas pu être supprimé.
