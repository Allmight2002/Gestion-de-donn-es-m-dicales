# Instructions pour agent QA

Objectif : tester la navigation et les parcours metier principaux de MedData en conditions realistes, avec uniquement des donnees fictives.

URL a tester : `https://gestion-de-donn-es-m-dicales.vercel.app`

## Regles generales

- Ne jamais saisir de donnees medicales reelles.
- Prefixer toutes les donnees creees par `QA-`.
- Noter precisement l'URL, le role utilise, les etapes suivies, le resultat attendu et le resultat observe.
- Joindre une capture ou une description claire pour chaque anomalie.
- Distinguer : bug confirme, comportement ambigu, test incomplet.
- Si la console navigateur est accessible, relever les erreurs JavaScript et reseau.

## Tests prioritaires

### 1. Etat general

- Ouvrir `/sync`.
- Verifier la version, l'etat en ligne, les ecritures en attente et les bases hors ligne.
- Naviguer entre dashboard, base, patients, import, statistiques et journal.
- Signaler toute lenteur notable : page concernee, duree approximative, action declenchante.

### 2. Creation patient

- Creer un patient manuel `QA-001` avec identite complete.
- Verifier la fiche patient, l'identite, les donnees permanentes et le statut.
- Creer un second patient avec le meme nom et la meme date de naissance.
- Attendu : alerte doublon affichee, creation bloquee sans confirmation explicite.
- Tester aussi un code patient deja utilise.
- Attendu : message utilisateur clair, pas de message SQL brut.

### 3. Rencontres

- Ajouter une rencontre a `QA-001`.
- Tester `Ctrl + Entree`.
- Fermer ou quitter une creation non enregistree puis revenir.
- Attendu : brouillon restaure.
- Modifier une rencontre existante.
- Tester une sortie de page sans enregistrer apres modification.
- Attendu ideal : avertissement ou protection contre perte de saisie. Signaler si absent.
- Verifier le motif obligatoire et l'historique des corrections.

### 4. Finalisation

- Passer une rencontre en `Complete`, puis `Finalise`.
- Verifier les badges et statuts du patient et de la rencontre.
- Verifier qu'un dossier finalise garde un historique clair.

### 5. Gabarits

- Creer un gabarit depuis un fichier CSV/XLSX fictif.
- Modifier les noms, types et portees de colonnes.
- Desactiver une colonne.
- Creer le gabarit.
- Utiliser un modele de bibliotheque.
- Supprimer un gabarit personnel.
- Attendu : confirmation et notification ou retour visuel clair.

### 6. Import

- Importer un CSV fictif avec au moins :
  - un patient nouveau ;
  - une ligne invalide ;
  - une ligne deja importee ;
  - une valeur non autorisee.
- Verifier l'apercu, les erreurs lisibles, l'import partiel et l'absence de doublons au second import.
- Noter les messages incomprehensibles ou techniques.

### 7. Cohortes et exports

- Creer une cohorte simple.
- Tester les filtres sur variables patient et rencontre.
- Creer un export CSV et Excel.
- Verifier que l'export ne contient aucune identite ni document.
- Pour chaque champ de terminologie, verifier la presence du libelle lisible et d'une colonne de
  code stable distincte dans le CSV et dans le dictionnaire Excel.
- Verifier que le fichier telecharge suit le format
  `meddata_<base>_<cohorte>_<patients|rencontres>_<AAAA-MM-JJ_HH-mm-ssZ>.<csv|xlsx>`, sans accent ni
  caractere de chemin.
- Verifier l'historique des exports et le telechargement.
- Verifier qu'un export cree avant l'ajout du nom lisible reste telechargeable depuis l'historique.

### 8. Groupes

- Creer un groupe `QA-groupe`.
- Rattacher une base.
- Retirer la base.
- Supprimer le groupe.
- Verifier les confirmations et la coherence des compteurs.

### 9. Acces et invitations

- Depuis un compte proprietaire, inviter un second medecin.
- Tester les permissions : lecture seule, edition, export, gestion des acces.
- Accepter l'invitation avec le second compte.
- Verifier que les permissions UI correspondent aux permissions reelles.
- Revoquer l'acces et verifier la disparition effective.

### 10. Identite et audit

- Depuis un compte autorise, consulter l'identite patient.
- Verifier si l'activite est journalisee dans la section identite/audit.
- Depuis un compte non autorise, verifier que l'identite est masquee ou inaccessible.

### 11. Role curateur

- Se connecter comme curateur.
- Verifier l'acces au pool de curation.
- Verifier l'absence d'acces aux identites non necessaires.
- Reserver une tache, la liberer, puis la reprendre si possible.
- Verifier qu'un autre curateur ne peut pas modifier une tache reservee.

### 12. Documents et inspection

- Ajouter un document fictif autorise.
- Verifier que le statut d'inspection est visible.
- Tester l'ouverture uniquement apres acceptation.
- Si un document reste `pending` ou `scanning`, verifier le bouton de relance.
- Tester un format interdit si possible.
- Attendu : message clair, pas d'acces signe si le fichier n'est pas accepte.

### 13. Mode hors ligne

- Activer la disponibilite hors ligne d'une base.
- Couper le reseau.
- Verifier la consultation en lecture seule.
- Tenter une correction hors ligne si l'application le permet.
- Reconnecter et verifier la synchronisation.
- Noter les conflits ou messages peu clairs.

### 14. Performance

Pour chaque page importante, noter si le chargement depasse environ 2 secondes :

- dashboard ;
- liste patients ;
- fiche patient ;
- import ;
- statistiques ;
- journal ;
- curation ;
- exports.

Indiquer si le probleme arrive au premier chargement seulement ou a chaque navigation.

## Format de rapport attendu

Pour chaque anomalie, utiliser le format suivant :

```text
Titre :
Gravite : Bloquant / Important / Mineur / Suggestion
Role utilise :
URL :
Etapes :
Resultat attendu :
Resultat observe :
Capture / logs :
Reproductible : Oui / Non / A confirmer
```

## Priorites de re-test

Verifier en priorite les points incomplets ou ambigus du precedent rapport :

- exports et cohortes ;
- acces et invitations ;
- audit des consultations d'identite ;
- mode hors ligne ;
- role curateur et restrictions RLS ;
- perte de saisie en edition ;
- messages d'erreur encore trop techniques.
