# Délais de l’éditeur : graphe de visibilité

## Constat du 27 septembre 2026

Sur le site de production `https://gestion-de-donn-es-m-dicales.vercel.app`,
l’utilisateur signale des échecs de modification des sections et de création de
règles sur un formulaire de 402 variables, 62 sections et 238 règles.

Lecture seule du projet Supabase de production `registre-clinique` :

- six erreurs PostgreSQL `57014` entre 10:13:25 et 10:17:36 UTC ;
- trois piles contiennent `assert_visibility_acyclic` et `move_template_section` ;
- trois contiennent `assert_visibility_acyclic`,
  `validate_template_version_invariants` et
  `run_template_version_invariants_insert_statement` ;
- `authenticated` et `authenticator` ont `statement_timeout=8s` ;
- les migrations `20260920192000` et `20260921213429` sont déjà appliquées,
  et les triggers de validation des sections/règles sont bien par instruction.

Ces observations portent sur les métadonnées et les noms de fonctions dans les
journaux. Aucun contenu de fiche patient ni identifiant de compte utilisateur
n’a été lu. La topologie précise des 238 règles n’a pas été extraite.

## Cause et objectif de la correction

Le regroupement des validations par instruction ne supprime pas le coût interne
du validateur : il appelle encore `assert_visibility_acyclic` pour chaque règle.
Chaque appel reconstruit les dépendances des règles existantes et développe les
cibles de bloc en variables, sous-sections comprises. Le déplacement d’une
section ajoute une autre boucle de contrôle après la validation du trigger.

La correction doit construire le graphe une fois pour sa validation globale,
conserver le contrôle des candidats utilisé par les aperçus de lot,
et supprimer le contrôle redondant du déplacement. Les règles de structure,
opérandes calculés, diagnostic, autorisation et verrouillage restent applicables.
Augmenter le délai global ne corrigerait pas ce coût répétitif.

## Second goulot : la garde par ligne sous RLS

La reproduction locale (402 variables, 62 sections dont 31 sous-sections, 238
règles dont 30 blocs chaînés) a montré un second coût, invisible dans les piles
de production parce qu'il précède le validateur. L'éditeur crée et modifie les
règles par écriture directe : la garde `guard_validation_rule_structure`
(BEFORE ROW, droits de la personne, donc RLS) rejouait `assert_visibility_acyclic`.
Sous RLS, la jointure `OR` de `template_section_field_keys` évaluait la politique
de lecture pour chaque couple variable × section : 3 s par bloc, plus de 80 s
pour un contrôle de cycle complet sur la machine de test.

La migration `20260927121847_batch_visibility_graph_validation.sql` :

- calcule la fermeture transitive sur des paires dédupliquées (`union`), comme
  l'aperçu d'import de bloc ; une énumération de chemins serait exponentielle
  sur des règles en losange ;
- retire le contrôle de cycle de la garde par ligne : le trigger AFTER STATEMENT
  de la même instruction appelle le validateur (security definer), qui refuse
  tout cycle sur le graphe complet et annule l'instruction ;
- réécrit `template_section_field_keys` pour lire chaque table une seule fois,
  à ensemble de variables identique.

Mesures locales après correction, en tant qu'utilisateur sous RLS : règle de
champ 0,7 s, règle de bloc 0,65 s, modification de règle 1 s ; validateur
complet 0,2 à 0,4 s. Test : `test/visibility-graph-validation.test.ts`.

`test/template-version-invariant-batching.test.ts` est épinglé sur
`beforeMigration: 20260920192000` : il n'exécute pas cette migration et ne
constitue pas une preuve de cette correction.

## Vérification et livraison

La reproduction doit utiliser une base PostgreSQL locale jetable et des données
fictives à l’échelle signalée, comprenant des dépendances de champs et de blocs.
Elle doit vérifier le temps sous une limite serveur de huit secondes, le rejet
des cycles, l’annulation des opérations invalides et les accès non autorisés.

La migration est additive. Elle ne réécrit pas les données métier. La validation
locale et la validation en production sont deux preuves distinctes : la seconde
nécessite une livraison explicitement autorisée, puis un essai du parcours réel.
Ne pas considérer la production corrigée sur la seule base des tests locaux.
