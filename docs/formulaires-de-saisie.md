# Formulaires de saisie (formulaires courts)

🟢 Document vivant — décrit le comportement implémenté par la migration
`20261001100000_base_entry_forms.sql` et les écrans associés.

## Besoin

Un registre volumineux (cas d'usage initial : neurochirurgie, ~448 variables, 68 sections,
plus de 284 règles conditionnelles) se saisit difficilement au quotidien quand on veut
seulement enregistrer quelques informations (démographie, motif d'admission, diagnostic, issue
du séjour). Les formulaires de saisie donnent plusieurs **chemins de saisie** vers **le même
dossier**, sans dupliquer la base ni synchroniser deux enregistrements.

## Principe

- Un **formulaire de saisie** appartient à une base : un nom (« Saisie rapide », « Admission »,
  « Sortie »…), une sélection de variables de fiche existantes et les quelques variables
  **indispensables** à l'enregistrement depuis ce formulaire.
- À la saisie, un formulaire court est **le formulaire complet réduit à ses variables** : chaque
  variable garde son bloc, sa section, sa sous-section et son rang. L'ordre dans lequel les
  variables ont été cochées n'a aucun effet.
- Il ne crée aucune variable et ne porte aucune donnée patient. Toutes les saisies alimentent
  `patient.data` par les RPC habituelles (`create_patient`, `update_patient_compatible` /
  `update_patient`).
- Le **formulaire complet** reste toujours disponible. La **fiche patient** garde son affichage,
  ses sections et ses règles habituels : le choix du formulaire ne change que les champs proposés
  pendant la saisie.
- Portée : variables de **fiche** (portée `patient`). Les variables d'un bloc répétable
  (occurrences) et les rencontres ne sont pas proposées dans un formulaire court ; elles restent
  saisies depuis la fiche ou le formulaire complet.

## Comportements garantis

| # | Exigence | Mise en œuvre |
|---|---|---|
| 1 | Une saisie rapide crée le dossier et permet de le reprendre | `NewPatient` appelle `create_patient` ; la fiche est créée en brouillon et s'ouvre aussitôt |
| 2 | Une donnée saisie dans un formulaire est retrouvée dans les autres | Une seule fiche : tous les formulaires lisent et écrivent `patient.data` |
| 3 | Un formulaire court préserve les champs qu'il ne contient pas | Écriture par **patch** (`v_old || p_patch` côté serveur) ; sur le chemin historique, la fiche entière chargée est renvoyée |
| 4 | Les requis du formulaire complet ne bloquent pas un enregistrement partiel | Seuls les indispensables du formulaire court sont exigés à l'écran ; le serveur n'impose la complétude qu'au-delà du brouillon, pour tout compte (comptes de mission compris depuis `20261001140000`) |
| 5 | Règles conditionnelles cohérentes | Visibilité calculée sur **toutes** les variables et valeurs de la fiche ; les variables qui conditionnent l'affichage (y compris d'un bloc) ou le calcul d'une variable choisie sont **ajoutées automatiquement** à leur place, et signalées |
| 6 | Les données non renseignées restent vides | Une valeur proposée par le jeu de variables n'est envoyée que si sa variable est affichée dans le formulaire courant |
| 7 | Complétude sur les variables applicables | L'indicateur de progression ne compte que les variables visibles du formulaire courant et ses indispensables |
| 8 | Modifier ou supprimer un formulaire ne supprime ni variable ni donnée | Table de configuration séparée, sans lien d'écriture vers le gabarit ni les fiches |

Un formulaire court garde le **statut** du dossier (le passer « complet » exigerait la fiche
entière). Le passage à « complet » ou « vérifié » se fait depuis le formulaire complet.

## Qui fait quoi

- **Propriétaire de la base** : crée, nomme, compose, modifie et supprime les
  formulaires (Paramètres → Saisies, route `/bases/:id/formulaires`).
- **Membres de la base** : choisissent un formulaire à la création (« Nouveau dossier avec… » ou
  le sélecteur en haut du formulaire) ou pour compléter une fiche (« Compléter avec… »).
- **Comptes de mission** : utilisent les formulaires courts et enregistrent une fiche partielle
  en brouillon (migration `20261001140000_mission_partial_patient_drafts.sql`), de même qu'une
  rencontre ou une occurrence de bloc répétable (`20261001150000_mission_partial_encounter_drafts.sql`).
  Ils complètent leur propre brouillon depuis la fiche, et la complétude reste exigée à la
  soumission.

## Sécurité et intégrité (table `base_entry_form`)

- RLS : lecture pour tout membre de la base active (`has_base_access`), écriture réservée au
  propriétaire (`is_base_owner`).
- Trigger `guard_base_entry_form` (SECURITY DEFINER, non exécutable comme RPC) : clés uniques,
  connues de la version courante et de portée `patient` ; indispensables inclus dans le
  formulaire ; 50 formulaires au plus par base ; auteur, date de création et version non
  forgeables.
- Verrou optimiste : `row_version` incrémentée par trigger ; le client modifie et supprime avec
  `row_version = <attendue>`. Un écart ne modifie rien et l'écran conserve les réglages saisis
  en demandant un rechargement.
- Nom unique par base (insensible à la casse).
- Une variable retirée du gabarit par une version ultérieure est ignorée à la saisie et signalée
  dans l'éditeur ; elle est retirée du formulaire à son prochain enregistrement.

## Code

| Élément | Emplacement |
|---|---|
| Migration | `supabase/migrations/20261001100000_base_entry_forms.sql` |
| Dépôt | `src/data/entryForms.ts` |
| Projection d'un formulaire (ordre, dépendances, requis) | `src/domain/entryForms.ts` |
| Gestion | `src/screens/member/BaseEntryForms.tsx` |
| Choix du formulaire | `src/screens/member/EntryFormPicker.tsx`, `NewPatient.tsx`, `EditPatient.tsx`, `BaseHome.tsx`, `PatientDetail.tsx` |
| Tests | `test/base-entry-forms.test.ts`, `src/domain/entryForms.test.tsx`, `src/screens/member/EntryForms.test.tsx` |
