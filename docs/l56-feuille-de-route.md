# L56 — feuille de route et preuves locales

Périmètre : `spec-collecte-diagnostique.md` §4. L55 est présent dans le code ; L53 est présent dans l'export. Cela ne prouve aucun déploiement.

## Organisation

Le découpage en agents frontend et serveur envisagé au cadrage **n'a pas été retenu** : le lot a été
réalisé par un seul agent, conformément à la politique de ressources du dépôt (`AGENTS.md`), la
migration et les écrans partageant de toute façon le calcul de couverture L55.

Les changements voisins ont été préservés. `docs/securite-mode-hors-ligne.md` (dérogation hors-ligne)
et le scénario d'export ajouté à `supabase/functions/generate-export/handler_test.ts` étaient modifiés
avant le début de cette mission et le restent.

## Étapes

1. Vérifier L55/L53 et les intersections des formulaires avec L41/L42 et offline avant édition.
2. Conserver la validation commune et des blocs applicables, les droits et contraintes de mission ; afficher la couverture sans nouveau statut de complétude.
3. Ajouter une RPC paginée par base/scope/version/code réservée au propriétaire médecin, avec calcul L55 sur la version source, sans identité, document ni texte libre dans les agrégats.
4. Relier le suivi au parcours autorisé et distinguer version source/version courante sans reprise automatique.
5. Valider §4.3 avec données fictives : couvert, non couvert, proposition, mixte, plusieurs blocs, même patient/autre diagnostic, transversal, mission expirée/révoquée, autre base, retrait annulé/confirmé/conflit, historique.
6. Vérifier les refus serveur directs, l'export L53 conservant les cas non couverts éligibles et le parcours navigateur.
7. Exécuter contrôles ciblés, typecheck/lint et vérification de migration/snapshot ; consigner résultats et limites réels.

## Contraintes

Pas d'élargissement d'accès, de statut complet forcé, de capacité import/hors-ligne, de notification ni de reprise implicite d'une ancienne version. Aucun commit, push, déploiement ou changement cloud autorisé.

## État des preuves

Implémentation terminée. Le détail du lot, les résultats de validation et les limites réelles sont
consignés dans [l56-parcours-et-suivi.md](l56-parcours-et-suivi.md) — ce fichier-ci ne les duplique pas.

Étapes 1 à 5 et 7 exécutées. Étape 6 partiellement : les refus serveur directs et l'export L53
conservant les cas non couverts éligibles sont vérifiés (`test/diagnosis-followup.test.ts`,
`supabase/functions/generate-export/handler_test.ts`) ; **le parcours navigateur ne l'est pas**, faute
d'un serveur portant la migration sur cette machine. La preuve du lot reste donc incomplète au sens
du §4.3, et le restera jusqu'à un essai sur un environnement déployé avec des données fictives.

Aucun commit, aucune poussée, aucune migration distante et aucun changement cloud n'a été effectué.
