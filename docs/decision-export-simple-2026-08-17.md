# Décision — simplification de l'export (17 août 2026)

> **Preuve datée 🗄️.** Ce document consigne des décisions de conception prises le
> 2026-08-17. **Aucun changement de code n'a été effectué à la date de ce document** :
> c'est un registre de décisions, pas une description de l'état courant.

## Ce qui est décidé

1. **Le statut de validation cesse d'être la porte de l'export.** L'export accepte les
   fiches `draft`, `complete` et `curated`. Les trois statuts restent en vigueur pour le
   workflow de saisie (droits d'édition des comptes de mission, immuabilité des fiches
   soumises), mais ne gâtent plus l'export.
2. **Le filtre de l'export devient la complétude des données.** Sont exclues les fiches
   dont un champ obligatoire est manquant (absent, `null` ou chaîne vide — la définition
   d'`assert_required_complete`). Une valeur manquante **codifiée** (`refus`, `inconnu`,
   `non_applicable`, `non_fait`, `non_documente`) compte comme **renseignée** : la fiche
   reste exportable.
3. **L'exclusion ne bloque jamais l'export.** Les fiches incomplètes sont écartées,
   comptées et tracées (côté serveur), sans message d'avertissement dans l'UI — ni avant
   génération, ni après.
4. **Garanties conservées (verrous) :**
   - **présence stricte des membres** : un membre de cohorte introuvable reste un refus
     `409 EXPORT_INCOMPLETE` — un export peut être partiel *par décision* (exclusions
     tracées), jamais *par accident* (échec de lecture, mutation concurrente) ;
   - validation serveur à l'écriture (inchangée) ;
   - limites d'export inchangées (patients, rencontres, colonnes, cellules).
5. **L'export principal est simplifié.** Un bouton « Exporter les données » + choix du
   format (CSV/XLSX). Le mode de lignes est **imposé par le modèle d'observation** de la
   base :
   - `cross_sectional` → 1 ligne / participant ;
   - `event_registry` → 1 ligne / événement ;
   - `longitudinal` → choix 1 ligne/patient (avec règle première/dernière rencontre) ou
     1 ligne/rencontre.
6. **La chaîne cohorte + figeage devient une option avancée.** Conservée pour ceux qui en
   ont réellement besoin (sélection de population, reproductibilité longitudinale), mais
   retirée de la fenêtre principale. La population stable « à deux dates » n'a d'intérêt
   que pour le suivi longitudinal ; en transversal (une saisie par participant) et en
   registre d'événements (événements indépendants), elle n'apporte rien. La sélection de
   population peut être faite côté analyste (`patient_code` stable pour réconcilier deux
   exports).
7. **Traçabilité :** les exclusions de l'export sont enregistrées dans `export_log`
   (compteurs + motif), sans aucun affichage à l'utilisateur.
8. **Mode patient sans rencontre complète** : le choix est proposé à l'utilisateur, avec
   **exclusion par défaut** (les patients sans rencontre complète sont exclus sauf si
   l'utilisateur coche leur inclusion).
9. **`validated_only` est retiré** de la création d'un snapshot : la cohorte fige toute la
   population (tous statuts), le filtre de complétude s'applique à l'export. L'avertissement
   de figeage « cette cohorte ne peut pas être exportée telle quelle » disparaît.
10. **Les cohortes dynamiques sont conservées**, mais uniquement dans l'option avancée
    (hors fenêtre principale), pour ceux qui en ont réellement besoin.

## Pourquoi

Le workflow principal est la collecte terrain par **comptes de mission** : le médecin fait
confiance aux données collectées, mais ne peut pas les vérifier fiche par fiche. L'exigence
actuelle (`validation_status = 'curated'` à l'export, curation fiche par fiche) imposait un
rituel vide (100 clics « Finaliser » sans rien vérifier) ou bloquait l'export.

Par ailleurs, la chaîne d'export complète (cohorte → filtre → figeage → écran d'export →
choix mode/règle/portée/format) était disproportionnée pour l'usage quotidien « je veux mes
données ». La simplification adapte l'écran au modèle d'observation de la base, qui est déjà
un choix de produit verrouillé à la première saisie.

## Constats établis au fil de la discussion (faits, pas décisions)

- Un compte de mission ne peut jamais modifier une fiche `complete` ou `curated`.
- Un compte de mission **peut** corriger ses propres brouillons (`draft`) — données
  permanentes (RPC `update_patient`/`update_encounter`, droits serveur) comme identité
  (bouton UI, si `can_view_identity` accordé). L'UI masque le bouton de modification des
  données permanentes pour un saisisseur (`PatientDetail`), mais le droit serveur existe.
- Conséquence assumée : un export acceptant les `draft` exporte des fiches encore
  modifiables par leur auteur. Le figeage fige la **population**, pas les **valeurs**
  (relues en direct à l'export).
- « Donnée manquante » = deux notions distinctes dans le code :
  - **valeur manquante codifiée** `{"__missing__": ...}` : réponse documentée, compte
    comme renseignée ;
  - **champ requis manquant** (définition `assert_required_complete`) : absent, `null` ou
    chaîne vide — c'est le seul motif d'exclusion de l'export.

## Points tranchés après révision

Aucun point ouvert à la date de ce document. Les trois points initialement ouverts sont
tranchés (décisions 8, 9 et 10) : choix utilisateur avec exclusion par défaut pour le
mode patient, retrait de `validated_only`, cohortes dynamiques conservées en option avancée.

## Ce qui reste inchangé (hors périmètre de cette décision)

- Cloisonnement identité / données analytiques : l'export reste pseudonymisé
  (`assertNoIdentity`), sans champ nominatif.
- Dictionnaire, colonnes de code stables, neutralisation des formules de tableur,
  feuilles multivaluées : inchangés.
- Droits d'accès (`can_export_data`), journalisation de lecture, hash et conservation des
  fichiers dans le bucket `scientific-exports` : inchangés.