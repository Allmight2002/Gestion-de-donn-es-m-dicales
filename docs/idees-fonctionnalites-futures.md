# Idées de fonctionnalités futures — expérience utilisateur

> Brainstorming du 2 juillet 2026 (Dr Mbassi + Claude). Ce document est une **réserve d'idées**
> centrée sur l'expérience des médecins-chercheurs : rien ici n'est engagé.
>
> **Règle du projet : aucune nouvelle fonctionnalité ne démarre tant que les remarques
> d'audit (v12 + audit interne) ne sont pas soldées.** Les idées marquées `⛔ après audit`
> touchent directement à un point d'audit encore ouvert.
>
> Légende effort : **S** = ~1 jour · **M** = 2-4 jours · **L** = ~1 semaine et plus.

---

## A. Saisie quotidienne — le geste répété 100 fois

C'est là que se joue l'adoption : chaque seconde gagnée est multipliée par le nombre de patients.

### A1. Duplication de rencontre (« nouvelle rencontre à partir de la précédente ») — **M**
Pré-remplir la nouvelle rencontre avec les valeurs de la dernière, l'utilisateur ne corrige que ce qui a changé.
**Pourquoi** : dans un suivi chronique, 80 % des valeurs sont identiques d'une visite à l'autre ; c'est LE gain de temps le plus demandé dans les registres.

### A2. Saisie rapide au clavier — **S** — ✅ LIVRÉ (2026-07-02)
Focus automatique sur le premier champ, navigation Tab fluide, Entrée pour enregistrer, raccourci « rencontre suivante ». Livré : Ctrl/⌘+Entrée enregistre depuis n'importe quel champ (rencontre + patient, création + édition) via `requestSubmit`, focus auto sur la date de rencontre, indice près du bouton. (Raccourci « rencontre suivante » : non fait, à voir plus tard.)
**Pourquoi** : un médecin qui saisit 15 dossiers d'affilée ne veut pas toucher la souris ; la fluidité perçue fait la réputation de l'outil.

### A3. Champs calculés (scores automatiques) — **M**
IMC, Glasgow total à partir des composantes, clairance de la créatinine… définis dans le gabarit comme « champ calculé ».
**Pourquoi** : élimine les erreurs de calcul manuel (fréquentes) et standardise les scores entre les saisisseurs — argument de qualité pour la publication.

### A4. Brouillon automatique local — **S** — ✅ LIVRÉ (2026-07-02)
Sauvegarde continue de la saisie en cours ; si l'onglet se ferme ou le réseau tombe, rien n'est perdu. Livré sur le formulaire de RENCONTRE (analytique uniquement, jamais d'identité) : autosave débouncé dans localStorage partitionné par utilisateur, restauration au retour + bandeau « brouillon récupéré / effacer », effacé à l'enregistrement. (Création patient exclue : contient l'identité — choix de sécurité.)
**Pourquoi** : perdre une saisie de 10 minutes détruit la confiance ; la couche hors-ligne existante fournit déjà 90 % de la tuyauterie.

### A5. Recherche globale (Ctrl+K) — **M** — ✅ LIVRÉ (2026-07-04, 1re version)
Palette de recherche omniprésente : code patient, base, écran (« importer », « nouvelle rencontre »).
**Pourquoi** : au-delà de ~50 patients, la navigation par listes devient le principal irritant. Livré : palette Ctrl/⌘+K (+ bouton d'en-tête) qui liste/filtre les BASES et les ÉCRANS (tableau de bord, gabarits, synchro, pool) avec navigation clavier. (Recherche de PATIENTS par code : non encore incluse — nécessiterait une requête dédiée ; à ajouter ensuite.)

### A6. Mode « tournée » mobile — **L**
Vue compacte pour téléphone : mes patients du jour, saisie une main au lit du malade (la PWA est déjà installable).
**Pourquoi** : la donnée saisie au moment du soin est plus fiable que celle re-saisie le soir de mémoire.

---

## B. Qualité des données — le cœur scientifique

### B1. Tableau de complétude (heatmap variables × patients) — **M**
Vue colorée : quelles variables manquent, chez quels patients ; clic = aller compléter.
**Pourquoi** : avant une analyse, le chercheur passe des heures à chercher « où sont les trous » ; cette vue transforme des heures en minutes.

### B2. File de travail « à compléter » — **M**
Liste automatique des patients/rencontres `draft` avec champs requis manquants, triable, assignable à un membre.
**Pourquoi** : la complétion devient un flux d'équipe mesurable, plus une chasse individuelle.

### B3. Détection d'aberrations (outliers) — **M**
Signal visuel à la saisie ET vue de revue (valeurs hors bornes « molles », z-score par variable).
**Pourquoi** : une créatinine à 900 au lieu de 90 passe inaperçue à la saisie mais ruine une moyenne ; la détection précoce coûte 10× moins cher que le nettoyage tardif.

### B4. Rappels de suivi — **M**
« Rencontre de suivi attendue à J+90 non saisie » → badge sur le patient + liste des suivis en retard.
**Pourquoi** : les perdus de vue sont le talon d'Achille des cohortes prospectives ; un simple rappel améliore mécaniquement l'exhaustivité.

### B5. Doublons mieux exposés — **S** — ✅ LIVRÉ (2026-07-02)
La détection existe déjà (`find_identity_matches`) ; l'afficher plus tôt et plus clairement dans le parcours de création. Livré : confirmation explicite (case « patient différent ») exigée avant de créer un dossier quand un doublon d'identité est détecté.
**Pourquoi** : un doublon découvert après 6 mois de saisie est un cauchemar de fusion ; découvert à la création, c'est un clic.

---

## C. Collaboration & équipe

### C1. Profils de rôle nommés — **S** — ✅ LIVRÉ (2026-07-02, commit 48469df)
« Investigateur principal / Co-investigateur / Saisie / Moniteur » comme presets qui cochent les permissions techniques.
**Pourquoi** : un chercheur pense en rôles d'étude, pas en booléens ; réduit aussi les erreurs d'attribution de droits (défense en profondeur côté humain).

### C2. Groupes de recherche — **L** — 🟡 v1 LIVRÉE (2026-07-04, « étiquette d'organisation »)
Inviter dans un *groupe* (équipe nommée), rattacher des bases au groupe, le rôle s'applique partout.
**Pourquoi** : évite de ré-inviter chaque personne base par base ; reflète la réalité (une unité de recherche gère plusieurs registres). Couche d'ergonomie au-dessus de `base_access` — le modèle de sécurité ne change pas.
**v1 livrée** : table `research_group` + rattachement de bases (privé au propriétaire, RLS), écran `/groups` (créer, lister) + détail (renommer, supprimer, rattacher/détacher ses bases). **PAS ENCORE** : l'octroi d'accès au niveau groupe (ajouter un membre → accès à toutes les bases), ni la vue « membres » agrégée — prochaine itération (choix : commencer par l'organisation, sans toucher à l'accès).

### C3. Journal d'activité lisible par base — **M** — ✅ LIVRÉ (2026-07-04)
Timeline humaine (« Dr A a importé 250 lignes — 2 erreurs », « 12 rencontres validées ») construite sur `audit_log` + `field_change_log`. Livré : écran `/bases/:id/activity` (lien depuis la base) avec libellés lisibles par action (import, accès, suppressions, exports, publications) + nom de l'auteur, via RPC `base_activity_log` (les lectures sensibles d'identité restent dans leur vue E1).
**Pourquoi** : les données existent déjà ; la vue donne au propriétaire le sentiment (fondé) de contrôle, et rend visible le travail de chacun.

### C4. Rapport hebdomadaire par e-mail — **M** (+ déploiement)
Résumé automatique envoyé à l'équipe : inclusions, complétude, imports, qui a fait quoi.
**Pourquoi** : l'IP n'ouvre pas l'app tous les jours ; le rapport vient à lui et entretient la dynamique d'équipe.

### C5. Notifications in-app — **M**
Cloche : invitation reçue, tâche de curation assignée, clarification demandée, import terminé, conflit hors-ligne à arbitrer.
**Pourquoi** : aujourd'hui ces événements sont invisibles tant qu'on ne tombe pas dessus ; les surfacer réduit les délais de réaction de jours à heures.

### C6. Notes d'équipe pseudonymisées sur un patient — **M**
Fil de commentaires interne (jamais d'identité dans le texte, garde-fou à la saisie).
**Pourquoi** : la coordination (« à re-convoquer », « dossier source incomplet ») se fait aujourd'hui hors outil (WhatsApp/papier), où elle se perd — et où elle fuite.

### C7. Transfert de propriété d'une base — **M**
Passer la main (départ, mutation) avec trace d'audit.
**Pourquoi** : sans cela, une base devient orpheline au premier départ. ⛔ après audit (directement lié à §7.1 — changement de rôle).

---

## D. Exploitation scientifique — de la base à l'article

### D1. Tableau de bord descriptif automatique — **M**
Par base : pyramide âges/sexe, distribution de chaque variable, effectifs par statut.
**Pourquoi** : répond à « combien de patients avec X ? » sans export ni statisticien ; c'est aussi un outil de détection d'anomalies.

### D2. Courbe d'inclusion + objectif — **S**
Inclusions cumulées vs objectif daté (« 150 patients d'ici décembre »).
**Pourquoi** : LE graphique de toute réunion d'étude ; motive l'équipe et alerte tôt si le recrutement décroche.

### D3. Codebook exportable versionné — **M**
Dictionnaire des variables (clé, libellé, unité, valeurs, bornes, **date d'introduction**, version de gabarit) en CSV/PDF.
**Pourquoi** : exigé par les revues et les statisticiens ; transforme le choix « édition libre » (audit §8) en atout traçable au lieu d'un point faible méthodologique.

### D4. Gel de données (« data freeze ») — **M**
Étiqueter un instant T (« release v1 — article gliomes ») ; l'export référence ce gel.
**Pourquoi** : reproductibilité — répondre au reviewer 6 mois plus tard sur exactement les mêmes données. S'appuie sur les cohortes figées existantes.

### D5. Exports prêts pour l'analyse (R / SPSS / Stata) — **M**
CSV + script d'import généré (labels, facteurs, types) pour chaque outil.
**Pourquoi** : fait gagner une demi-journée de préparation au statisticien à chaque export — et évite les erreurs de typage. ⛔ après audit (§7.9 : les exports doivent d'abord passer par `signed-read`).

### D6. Flowchart d'étude auto (squelette STROBE) — **L**
Diagramme inclus/exclus/analysés généré depuis les cohortes.
**Pourquoi** : la « figure 1 » de l'article produite en un clic — très différenciant pour un outil de recherche.

---

## E. Confiance & sécurité perçue

### E1. Page « Qui accède à mes bases » — **S** — ✅ LIVRÉ (2026-07-02)
Pour le propriétaire : liste des accès, dernier usage, lectures d'identité récentes (vue sur `audit_log`). Livré : section « Consultations d'identité (30 j) » dans la gestion des accès (compteurs par lecteur + journal), RPC `base_identity_audit`.
**Pourquoi** : la sécurité n'existe pour l'utilisateur que si elle est **visible** ; répond aussi au F-4 de l'audit interne (détection de sur-consultation).

### E2. Verrouillage d'inactivité + step-up identité — **M**
Session verrouillée après N minutes ; re-saisie du mot de passe pour révéler une identité.
**Pourquoi** : postes partagés à l'hôpital = risque n°1 en pratique ; le step-up rend le « qui a vu quoi » individuellement opposable.

### E3. Écran « état du système » — **S** — ✅ LIVRÉ (2026-07-02)
Synchro hors-ligne en attente, dernier instantané, version de l'app, état du serveur. Livré : panneau en haut du centre de synchronisation (`/sync`) — connexion en ligne/hors-ligne, écritures en attente + conflits, bases disponibles hors-ligne (avec fraîcheur), version applicative (injectée depuis package.json), dernières anomalies techniques (via `reportError`).
**Pourquoi** : sur le terrain (réseau instable), l'utilisateur doit savoir en un regard si « c'est parti » ou pas — réduit l'anxiété et les double-saisies.

---

## F. Démarrage & import — la barrière d'adoption

### F1. Assistant « créer un gabarit depuis mon Excel » — **L** — ✅ LIVRÉ (2026-07-04)
Lire le fichier existant du médecin, proposer les variables détectées (types, valeurs), il ajuste et valide. Livré : écran `/templates/from-file` (lien depuis Mes gabarits) — upload .xlsx/.csv → colonnes détectées avec type inféré (entier/nombre/date/booléen/liste à choix/texte) + valeurs distinctes pour les listes → tableau éditable (inclure, libellé, type, portée, section) → crée un gabarit personnel (réutilise createPersonalTemplate + addField, aucune migration). Détection = fonction pure testée.
**Pourquoi** : TOUT médecin a déjà son Excel ; transformer « recréer mon dictionnaire à la main » (1 h, décourageant) en « vérifier une proposition » (10 min) est probablement le levier d'adoption n°1.

### F2. Rapport d'erreurs d'import téléchargeable + reprise sélective — **M**
CSV des lignes rejetées avec motif ; bouton « réimporter uniquement les lignes corrigées ».
**Pourquoi** : aujourd'hui les erreurs se lisent à l'écran et la reprise réimporte tout. ⛔ après audit (c'est exactement §7.8 — idempotence inter-lots — à régler d'abord).

### F3. Bibliothèque de gabarits par spécialité — **M**
Gabarits de départ (neuro, cardio, onco…) à dupliquer puis adapter.
**Pourquoi** : démarrer d'une page blanche est intimidant ; un modèle crédible à 80 % lance l'utilisateur en minutes et diffuse de bonnes pratiques de dictionnaire.

---

## Lecture d'ensemble — par où commencer (quand l'audit sera soldé)

| Rang | Candidat | Raison |
|---|---|---|
| 1 | **F1** Assistant Excel → gabarit | Lève la barrière d'adoption ; effet immédiat sur le recrutement d'utilisateurs |
| 2 | **A1 + A2** Duplication + clavier | Gain quotidien pour ceux qui saisissent déjà |
| 3 | **C1 → C3** Rôles nommés puis journal | Améliore le partage existant sans nouveau modèle |
| 4 | **B1 + D2** Complétude + courbe d'inclusion | Premiers « tableaux de bord » à forte valeur, faible coût |
| 5 | **D3** Codebook versionné | Consolide la crédibilité scientifique avant le premier article |

*(Ordre indicatif — à réévaluer ensemble une fois les remarques d'audit terminées.)*
