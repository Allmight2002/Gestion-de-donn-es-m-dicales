# État courant vérifié — 1er août 2026

Ce document est la référence de lecture de l'état **actuel** de MedData. Les audits, décisions
et comptes rendus datés conservent leurs constats à leur date ; ils ne doivent pas être lus comme
une description de l'environnement courant sans cette mise en contexte.

> ## ⚠️ Ce qui a changé depuis le 1er août — à lire avant le reste
>
> Relu le 2026-08-19. Le corps de ce document reste valable **sauf sur les points suivants** :
>
> - **L'inspection antivirus est en pause depuis le 2026-08-13**, sur staging comme sur la cible
>   technique `production`. Il n'y a plus de tunnel ClamAV à relancer : les fichiers déposés ne
>   sont **pas analysés** et restent au statut `accepted_client`, sur le seul contrôle navigateur.
>   La section « Dernière release technique prouvée » ci-dessous décrit l'état du 1er août, quand
>   le scanner était encore exigé. Voir
>   [decision-pause-inspection-2026-08-12.md](decision-pause-inspection-2026-08-12.md).
> - **La release technique prouvée n'est plus celle citée ci-dessous** : le SHA et les identifiants
>   de run datent du 1er août. Le journal d'exécution
>   ([suivi-execution-feuille-route.md](suivi-execution-feuille-route.md)) porte l'état courant.
> - **Deux familles de lots ont été livrées depuis** : « moteur de formulaires » (L27 à L33,
>   close le 2026-08-15) et « listes de diagnostics » (L20 à L25, closes le 2026-08-18 ; L26 clos
>   sans exécution le 2026-08-19).
> - **Le périmètre autorisé n'a pas changé** : données fictives uniquement, aucun usage clinique,
>   aucun utilisateur tiers.

## Périmètre autorisé

La cible technique nommée `production` reste un environnement persistant de tests internes. Elle
accepte uniquement des comptes et données fictifs. Cette situation n'autorise ni usage clinique,
ni utilisateur tiers, ni donnée réelle ou pseudonymisée.

Les dérogations de gouvernance, de reprise et d'exploitation restent documentées dans
[`derogations-readiness.md`](derogations-readiness.md). Une release technique réussie ne les ferme
pas et ne constitue pas une readiness clinique.

## Dernière release technique prouvée

- SHA applicatif : `f0bf2af5910f5b4ebf985adf1724b9dcc69745ce`.
- Staging : release coordonnée GitHub `30718950416`, réussie.
- Cible technique `production` : release coordonnée GitHub `30720194028`, réussie après preuve
  staging du même SHA.
- Le workflow a vérifié la CI, la sauvegarde chiffrée pré-release, les migrations, Storage,
  l'inventaire des Edge Functions, le frontend, l'activation stricte de l'inspection et la dérive
  cloud.

~~Le scanner ClamAV strict est actuellement joignable via un tunnel Cloudflare temporaire. Il est
valide pour les tests internes fictifs menés le 1er août, mais **ne remplace pas** un hébergement
pérenne et supervisé requis avant toute donnée réelle.~~

> **Périmé depuis le 2026-08-13.** Le tunnel n'est plus monté et l'inspection est en pause : plus
> aucun fichier déposé n'est analysé. L'exigence de fond est inchangée — un hébergement pérenne et
> supervisé reste requis avant toute donnée réelle.

## Modèle d'observation des bases (L9)

La migration additive `20260801185149_observation_model_base.sql` est appliquée. Chaque base porte
`observation_model` :

- `cross_sectional` — une seule saisie par participant ;
- `longitudinal` — suivi répété ;
- `event_registry` — registre d'événements.

Les bases existantes ont conservé le défaut `longitudinal`. Le propriétaire peut modifier le modèle
tant que la base est vide ; la première saisie verrouille ce choix. En transversal, la base interdit
les rencontres et les soumissions de portée rencontre par toutes les voies, masque la portée dans
l'éditeur de variables et ouvre directement le formulaire patient sectionné.

Vérification manuelle sur l'application déployée : une base transverse fictive a été créée puis
ouverte dans le formulaire unique ; une base longitudinale existante a conservé le parcours
« Ajouter une rencontre ».

## Lecture des autres documents

- Les spécifications, architecture, checklists QA, feuilles de route et procédures sont des
  documents vivants et sont alignés avec cette référence.
- Les documents dont le titre porte une date, notamment `audit-*`, `validation-*`,
  `readiness-production-2026-07-19.md` et les exercices de reprise, sont des preuves historiques.
  Ils conservent leurs conclusions datées ; lorsqu'elles sont dépassées, une note en tête renvoie
  ici.
- Le schéma courant est généré dans [`schema-etat-final.md`](schema-etat-final.md) par
  `npm run schema` ; il prévaut sur toute description manuelle en cas d'écart.
