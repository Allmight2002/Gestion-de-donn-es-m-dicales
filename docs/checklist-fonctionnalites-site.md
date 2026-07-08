# Checklist fonctionnelle du site MedData

Ce document sert de reference pour tester le site deploye, soit manuellement, soit avec un agent QA.
Il complete `docs/qa-parcours-site.md` : le plan existant donne un parcours ordonne, celui-ci liste
l'ensemble des fonctionnalites a couvrir par domaine.

## 1. Regles generales

- N'utiliser que des donnees fictives.
- Prefixer tous les elements crees par `QA-`.
- Ne jamais saisir de donnees medicales reelles, de vrais noms, de vrais telephones ou de vraies adresses.
- Ne pas publier de token d'invitation dans un rapport partage. Si un token apparait dans un rapport, revoquer l'invitation.
- Ne supprimer que les elements QA crees pendant le test.
- Noter chaque resultat avec le statut `OK`, `KO`, `BLOQUE` ou `NON TESTE`.
- Joindre une capture pour chaque anomalie visuelle ou fonctionnelle.
- Garder la console navigateur et l'onglet reseau ouverts quand c'est possible.

## 2. Preambule obligatoire

Avant toute session :

1. Ouvrir une URL profonde de l'application, par exemple une fiche patient, une base, ou `/accept-invitation?token=...`.
2. Faire `Ctrl + Shift + R`.
3. Verifier qu'il n'y a pas de 404 Vercel.
4. Aller dans `/sync`.
5. Relever :
   - version ;
   - mode ;
   - commit ;
   - branche ;
   - date de build ;
   - etat connexion ;
   - erreurs techniques recentes.
6. Si le commit n'est pas celui attendu par le responsable du test, stopper et signaler un probleme de deploiement/cache.

Format minimal a noter :

```text
Version:
Mode:
Commit:
Branche:
Build:
URL testee:
Navigateur:
Compte utilise:
Console JS:
Requetes 4xx/5xx:
```

## 3. Decoupage conseille en sessions de 22 minutes

Quand l'agent a une limite de temps courte, reprendre au premier bloc non termine.

### Session A - Sanity deploy + navigation + saisie

- Preambule technique.
- Navigation generale.
- Theme clair/sombre.
- Tableau de bord et base.
- Creation patient.
- Doublon code patient.
- Doublon identite.
- Creation et edition de rencontre.
- Brouillon local de rencontre.

### Session B - Jeux de variables + imports

- Import d'un jeu de variables depuis fichier.
- Creation d'une base depuis fichier.
- Bibliotheque de modeles.
- Import patients.
- Reimport sans doublon.
- Creation dynamique d'une variable depuis une colonne inconnue.

### Session C - Groupes + cohortes + exports + acces

- Groupes de recherche.
- Cohortes.
- Generation export CSV/Excel.
- Telechargement depuis historique des exports.
- Profils d'acces.
- Invitations, revocation.
- Consultations d'identite.
- Journal.

### Session D - Parcours avances

- Cooperation a deux comptes.
- Role curateur.
- Documents et inspection.
- Mode hors ligne.
- Tests de securite negatifs.
- Performance ressentie et chronometree.
- Nettoyage final.

## 4. Deploiement, PWA et routes profondes

### A tester

- `Ctrl + Shift + R` sur `/`.
- `Ctrl + Shift + R` sur une route profonde :
  - `/bases/<id>` ;
  - `/bases/<id>/patients/<patientId>` ;
  - `/bases/<id>/patients/<patientId>/encounters/new` ;
  - `/accept-invitation?token=<token-test>`.
- `F5` simple sur les memes routes.
- Changement de version apres deploiement : `/sync` doit afficher le nouveau commit.
- PWA/cache : une ancienne version ne doit pas rester bloquee apres rechargement force.

### Attendu

- Aucune page Vercel `404: NOT_FOUND`.
- L'application React s'ouvre et reprend la route demandee.
- `/sync` affiche commit, branche et build.

## 5. Authentification et roles globaux

### A tester

- Connexion medecin proprietaire.
- Connexion deuxieme medecin.
- Connexion curateur.
- Deconnexion.
- Bouton precedent apres deconnexion.
- Route `/admin` avec un compte non admin.
- Acces direct a une base sans permission.

### Attendu

- Les donnees ne reapparaissent pas apres deconnexion.
- Un medecin non admin ne voit pas l'administration.
- Un curateur ne voit pas le tableau de bord medecin.
- Un utilisateur sans acces ne voit pas la base ni les fiches patients.

## 6. Tableau de bord et bases

### A tester

- Liste des bases disponibles.
- Bases recentes dans la barre laterale.
- Creation d'une base depuis un jeu de variables existant.
- Creation d'une base depuis un fichier CSV/Excel.
- Ouverture d'une base.
- Onglets visibles :
  - Patients ;
  - Importer ;
  - Cohortes ;
  - A completer ;
  - Statistiques ;
  - Journal ;
  - Acces ;
  - Variables ;
  - Curation.

### Attendu

- Les bases s'ouvrent sans erreur.
- Les onglets correspondent aux permissions de l'utilisateur.
- Les utilisateurs sans permission ne voient pas les onglets sensibles.

## 7. Recherche et navigation rapide

### A tester

- `Ctrl + K` ouvre la palette.
- Rechercher une base.
- Rechercher un patient par code.
- Valider avec `Entree`.
- Fermer avec `Echap`.

### Attendu

- La palette s'ouvre vite.
- La navigation aboutit vers la bonne page.
- Aucun freeze ou ecran blanc.

## 8. Patients

### A tester

- Creation manuelle d'un patient `QA-PAT-001`.
- Creation d'un patient avec code deja utilise.
- Creation d'un patient avec meme nom + meme date de naissance.
- Creation apres confirmation explicite de doublon.
- Edition des donnees permanentes.
- Finalisation d'un patient.
- Suppression soft delete avec motif.
- Consultation d'une fiche patient.

### Attendu

- Code patient obligatoire et unique.
- Message clair si code deja utilise, sans message SQL brut.
- Alerte doublon identite visible quand nom + date correspondent.
- Au clic sur `Enregistrer`, si doublon non confirme, notification temporaire + message inline.
- Soft delete demande un motif.
- Les patients supprimes disparaissent des listes standards.

## 9. Rencontres

### A tester

- Creation d'une rencontre.
- Focus initial sur la date.
- Date affichee apres sauvegarde.
- Raccourci `Ctrl + Entree`.
- Brouillon local : saisir, quitter/fermer, revenir.
- Effacer le brouillon.
- Edition d'une rencontre.
- Motif obligatoire en correction.
- Historique des corrections.
- Changement de statut : Brouillon, Complete, Finalise.
- Tentative de sortie sans sauvegarder depuis l'edition.

### Attendu

- La date affichee est exactement la date saisie, sans decalage d'un jour.
- Le brouillon est recupere et peut etre efface.
- Le motif est obligatoire en edition.
- L'historique affiche ancienne valeur, nouvelle valeur et motif.
- Une sortie sans sauvegarde doit avertir l'utilisateur ou conserver le brouillon. Si rien ne se passe, noter `KO`.

## 10. Jeux de variables

### A tester

- Creer un jeu de variables vide.
- Renommer un jeu de variables.
- Supprimer un jeu `QA-*`.
- Importer depuis CSV/Excel.
- Verifier la detection de types :
  - `Age` -> entier ;
  - `Sexe` avec M/F -> liste ;
  - `Date visite` -> date ;
  - `Poids (kg)` -> nombre ;
  - `Commentaire` -> texte.
- Modifier un libelle avant creation.
- Decocher une colonne.
- Creer une nouvelle version.
- Ajouter un champ.
- Modifier un champ autorise.
- Verifier les champs verrouilles si deja utilises.
- Cloner un modele officiel depuis la bibliotheque.

### Attendu

- Les types proposes sont coherents.
- Le nom du jeu n'est pas redondant.
- Le jeu apparait dans `Mes jeux de variables`.
- Le clone depuis bibliotheque cree un jeu personnel.

CSV conseille :

```csv
Age,Sexe,Date visite,Poids (kg),Commentaire
42,M,2026-07-07,72.5,RAS
55,F,2026-07-08,80,Controle
30,M,2026-07-09,65.2,Suivi
31,F,2026-07-10,66,OK
```

## 11. Creation base depuis fichier

### A tester

1. Aller dans `Mes jeux de variables` puis `Depuis un fichier`.
2. Importer un CSV contenant une colonne `Code patient`.
3. Decocher `Code patient` dans la proposition de variables.
4. Cocher `Creer aussi une base avec ce jeu de variables`.
5. Nommer la base `QA-base-fichier`.
6. Creer.
7. Verifier la redirection directe vers `Importer`.
8. Re-televerser le meme CSV.
9. Verifier l'auto-mapping.
10. Importer.
11. Verifier que les patients apparaissent.

CSV conseille :

```csv
Code patient,Age,Sexe,Date de rencontre,Poids (kg),Commentaire
QA-F1-1,42,M,2026-07-07,72.5,RAS
QA-F1-2,55,F,2026-07-08,80,Controle
QA-F1-3,30,M,2026-07-09,65.2,Suivi
```

### Attendu

- `Code patient` sert a l'import, mais n'est pas cree comme variable analytique.
- La base est creee.
- Les colonnes sont mappees automatiquement.
- Les patients `QA-F1-*` sont crees.

## 12. Import de donnees

### A tester

- Import simple avec `Code patient`.
- Absence de `Code patient`.
- Mapping automatique des colonnes.
- Mapping manuel.
- Valeur invalide pour une liste.
- Message d'erreur avec valeurs autorisees.
- Apercu avant import.
- Import final.
- Reimport du meme contenu sous un autre nom.
- Reimport d'un fichier corrige.
- Colonne inconnue -> creation dynamique d'une variable.
- Conflit de mapping : deux colonnes vers la meme cible.

### Attendu

- Sans `Code patient`, l'import patient est bloque avec un message clair.
- Les lignes deja importees sont ignorees, sans doublon.
- Une colonne inconnue peut devenir variable si l'utilisateur a la permission.
- Les erreurs sont comprehensibles, sans SQL brut.

CSV conseille pour import :

```csv
Code patient,Age,Sexe,Date de rencontre,Poids (kg)
QA-IMP-1,42,M,2026-07-07,72.5
QA-IMP-2,55,F,2026-07-08,80
```

CSV conseille pour colonne inconnue :

```csv
Code patient,Date de rencontre,Taille (cm)
QA-UNK-1,2026-07-07,170
QA-UNK-2,2026-07-08,165
```

## 13. Groupes de recherche

### A tester

- Creer `QA-groupe`.
- Rattacher une base.
- Ouvrir le groupe.
- Retirer la base.
- Supprimer le groupe.
- Verifier la modale de confirmation.

### Attendu

- La base n'est pas supprimee avec le groupe.
- La suppression utilise une modale integree, pas un `window.confirm`.
- Les actions apparaissent dans le journal si prevu.

## 14. Cohortes

### A tester

- Creer une cohorte `QA-cohorte`.
- Ajouter un filtre patient.
- Ajouter un filtre rencontre.
- Tester les operateurs : egal, different, superieur, inferieur, entre, dans.
- Calculer les effectifs.
- Creer une cohorte figee.
- Reouvrir la cohorte.
- Verifier le nombre de patients et rencontres.

### Attendu

- Les effectifs sont coherents.
- Les patients brouillon/finalises sont inclus selon l'option choisie.
- Les filtres ne provoquent pas d'erreur SQL visible.

## 15. Exports

### A tester

- Generer un export CSV.
- Generer un export Excel si disponible.
- Generer et conserver.
- Verifier le bandeau de succes.
- Cliquer `Telecharger` dans l'historique des exports conserves.
- Verifier le fichier dans le dossier de telechargements.
- Ouvrir le fichier et verifier son contenu.
- Re-telecharger depuis l'historique.

### Attendu

- Le fichier se telecharge vraiment.
- Les donnees identifiantes ne sont pas presentes.
- Les documents bruts ne sont pas presents.
- Le telechargement depuis historique passe par l'Edge Function signee.
- Si le navigateur bloque les telechargements multiples, marquer `BLOQUE / non verifie`, pas `OK`.

## 16. Acces et invitations

### A tester

- Onglet Acces visible pour le proprietaire.
- Profils :
  - Investigateur principal ;
  - Co-investigateur ;
  - Saisie ;
  - Moniteur ;
  - Personnalise.
- Choisir un profil et verifier les cases.
- Modifier une case et verifier le passage en `Personnalise`.
- Creer une invitation pour un email fictif ou un compte de test autorise.
- Copier le lien sans l'exposer publiquement.
- Revoquer l'invitation.
- Verifier qu'une invitation revoquee ne peut pas etre acceptee.
- Tester acceptation avec deuxieme compte.
- Tester mauvais compte.
- Tester lien deja utilise.

### Attendu

- Les profils appliquent les bonnes permissions.
- L'invitation apparait en attente.
- La revocation empeche l'acceptation.
- Le mauvais compte est refuse.
- Un lien accepte ne peut pas etre reutilise.
- Si l'erreur `digest(text, unknown) does not exist` apparait, la migration pgcrypto n'est pas appliquee en production.

## 17. Consultations d'identite

### A tester

- Ouvrir une fiche patient avec identite visible.
- Recharger l'onglet Acces.
- Verifier `Consultations d'identite (30 j)`.
- Tester avec deuxieme medecin sans permission identite.
- Ajouter permission identite.
- Recharger et verifier apparition des consultations.

### Attendu

- Une consultation d'identite est journalisee.
- Un profil sans permission ne voit pas l'identite.
- Apres permission, la consultation apparait dans le tableau.

## 18. Journal d'activite

### A tester

- Creation patient.
- Creation rencontre.
- Correction rencontre.
- Import.
- Export.
- Invitation creee.
- Acces accorde/revoque.
- Suppression patient/groupe/jeu QA.
- Filtre par action.
- Bouton `Charger plus` si disponible.

### Attendu

- Les actions apparaissent avec dates lisibles.
- Le filtre fonctionne.
- Le journal ne fuit pas de token, email sensible complet si minimisation attendue, ou contenu brut inutile.

## 19. Documents, images et inspection

### A tester

- Ajouter une image clinique fictive.
- Confirmer la de-identification.
- Ajouter un document brut fictif a une demande de curation.
- Verifier les statuts :
  - pending ;
  - scanning ;
  - accepted ;
  - quarantined/rejected.
- Ouvrir un fichier accepte.
- Tenter d'ouvrir un fichier pending/scanning/quarantined.
- Tester format interdit.
- Tester taille excessive si raisonnable.
- Relance d'inspection si disponible.

### Attendu

- Aucun lien signe avant acceptation serveur quand l'inspection stricte est active.
- Les formats interdits sont refuses.
- Les erreurs sont lisibles.
- Les lectures passent par `signed-read`.

## 20. Curation

### A tester

- Connexion curateur.
- Barre laterale limitee.
- Pool de curation visible.
- Ouvrir une tache.
- Verifier absence d'identite patient.
- Reserver une tache.
- Enregistrer un brouillon.
- Demander clarification.
- Finaliser si possible.
- Tester concurrence entre deux curateurs.
- Tester suppression soft delete d'une demande de curation avec motif.
- Tester acces direct a `/bases/<id>` depuis curateur.

### Attendu

- Le curateur ne voit jamais nom/date de naissance/telephone/adresse.
- Un curateur non affecte ne lit pas le brouillon d'un autre.
- Une tache finalisee n'est plus modifiable.
- Les URL directes sensibles sont refusees.

## 21. Hors ligne et synchronisation

### A tester

- Rendre une base disponible hors ligne.
- Verifier le nombre de patients caches.
- Passer DevTools Network en `Offline`.
- Recharger.
- Ouvrir la liste patients.
- Ouvrir une fiche patient.
- Verifier absence d'identite hors ligne.
- Editer une rencontre hors ligne si autorise.
- Verifier file d'attente dans `/sync`.
- Repasser en ligne.
- Synchroniser.
- Tester conflit de version si possible.

### Attendu

- Lecture hors ligne sans identite.
- Ecritures en file d'attente.
- Conflits visibles et resolubles.
- Pas de donnees d'une autre base dans le cache.

## 22. Cooperation a deux comptes

Utiliser deux sessions :

- fenetre normale : proprietaire ;
- navigation privee : deuxieme medecin.

### A tester

1. Proprietaire cree une invitation `Saisie`.
2. Deuxieme medecin accepte le lien.
3. La base apparait sur son tableau de bord.
4. Il voit les patients par code.
5. Il ne voit pas l'identite.
6. Il peut creer une rencontre si permission.
7. Il ne voit pas Acces/Export si non autorise.
8. Proprietaire ajoute permission identite.
9. Deuxieme medecin voit l'identite apres rechargement.
10. Proprietaire voit la consultation d'identite.
11. Edition simultanee de la meme rencontre.
12. Le deuxieme enregistrement doit etre refuse si version obsolete.
13. Proprietaire revoque l'acces.
14. La base disparait chez le deuxieme medecin.
15. URL directe refusee apres revocation.

### Attendu

- Pas d'ecrasement silencieux en edition simultanee.
- Revocation effective apres rechargement.
- Permissions appliquees cote UI et cote RLS.

## 23. Tests de securite negatifs

### A tester

- `/admin` avec medecin.
- `/bases/<id>` sans acces.
- `/bases/<id>/patients/<id>` sans acces.
- `/curation/<id>` avec medecin non curateur.
- Export sans permission.
- Acces document sans permission.
- Invitation avec mauvais compte.
- Invitation expiree/revoquee/deja acceptee.
- Bouton precedent apres deconnexion.

### Attendu

- Refus silencieux, page vide, redirection ou message clair.
- Pas de fuite de donnees.
- Pas de SQL brut.

## 24. UI, theme sombre, mobile

### A tester

- Theme clair sur :
  - dashboard ;
  - base ;
  - patient ;
  - rencontre ;
  - import ;
  - cohortes ;
  - acces ;
  - curation ;
  - sync.
- Theme sombre sur les memes pages.
- Contraste des cartes, formulaires, fieldsets, selects, tableaux, modales, toasts.
- Largeur mobile environ 375 px.
- Menu tiroir mobile.
- Tables larges en mobile.
- Longs textes dans boutons/toasts/cartes.

### Attendu

- Aucun texte illisible.
- Aucun bloc clair agressif en theme sombre.
- Pas de chevauchement.
- Les actions principales restent accessibles en mobile.

## 25. Performance et latence ressentie

Chronometrer a froid et apres cache :

- chargement dashboard ;
- ouverture base ;
- liste patients ;
- fiche patient ;
- import ;
- statistiques ;
- journal ;
- curation ;
- export ;
- `/sync`.

Noter :

- temps jusqu'au premier affichage ;
- temps jusqu'a donnees utiles ;
- requetes lentes ;
- erreurs reseau ;
- freezes UI ;
- chargements repetes inutiles.

## 26. Nettoyage final

Supprimer ou revoquer :

- patients `QA-*` ;
- rencontres `QA-*` si separables ;
- bases `QA-*` ;
- groupes `QA-*` ;
- cohortes `QA-*` ;
- jeux de variables `QA-*` ;
- invitations de test ;
- acces accordes au deuxieme compte ;
- exports conserves si l'interface le permet ;
- demandes de curation `QA-*`.

Pour chaque element non supprimable, noter :

```text
Element:
Raison:
URL:
Compte:
Action tentee:
Message observe:
```

## 27. Format de rapport recommande

```text
# Rapport QA MedData

Date:
Testeur:
Compte(s):
Navigateur:
URL:
Version:
Commit:
Branche:
Build:

## Synthese
OK:
KO:
BLOQUE:
NON TESTE:
Verdict:

## Points bloquants
- ...

## Resultats par domaine
1. Deploiement/PWA:
2. Auth/roles:
3. Bases:
4. Patients:
5. Rencontres:
6. Jeux de variables:
7. Import:
8. Cohortes/exports:
9. Groupes:
10. Acces/invitations:
11. Identite/audit:
12. Journal:
13. Curation:
14. Documents/inspection:
15. Hors ligne:
16. Securite:
17. UI/theme/mobile:
18. Performance:

## Anomalies
Pour chaque anomalie :
- Gravite:
- URL:
- Compte/role:
- Etapes:
- Attendu:
- Obtenu:
- Reproductible:
- Capture/logs:

## Console et reseau
- Erreurs JS:
- Requetes 4xx/5xx:
- Requetes lentes:

## Nettoyage
- Supprime:
- Restant:
```

## 28. Statuts utiles

- `OK` : comportement attendu observe et preuve suffisante.
- `KO` : bug confirme ou ecart reproductible.
- `BLOQUE` : test empeche par environnement, droits, navigateur, agent, temps ou dependance cloud.
- `NON TESTE` : pas encore execute.
- `A REVALIDER` : observation ambigue ou version testee obsolete.

