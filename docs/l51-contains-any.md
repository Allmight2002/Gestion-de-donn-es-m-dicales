# L51 — appartenance exacte entre valeurs d’un même pilote

Implémentation locale du contrat de [la spécification, §3](spec-blocs-pathologies.md#3-l51--opérateur-dappartenance-dans-le-moteur-de-règles), complété par [la collecte diagnostique, §2](spec-collecte-diagnostique.md#2-l51l54--amendements-nécessaires).

`contains_any` est réservé à `if`. Il exprime un OR entre les codes d’un même pilote `select`, `multiselect` ou `terminology`, sans groupe booléen ni OR entre champs. `in` et les comparaisons entre champs conservent leur comportement historique. Ce lot ne fusionne aucune base et ne crée aucune identité inter-bases.

```json
{
  "if": {
    "field": "diagnostic",
    "operator": "contains_any",
    "value": ["CODE_A", "CODE_B"],
    "terminologyReleaseId": "aaaaaaaa-0000-0000-0000-000000000001"
  },
  "then": { "field": "variable_partagee", "operator": "visible" }
}
```

Les codes et l’identifiant ci-dessus sont fictifs. La définition exige une publication locale existante et des codes sélectionnables de cette publication. `terminologyReleaseId` est obligatoire pour un pilote terminologique et interdit pour les listes d’options. Le formulaire demande explicitement l’identifiant de publication : il ne choisit jamais la publication active par défaut. L55 vérifiera ensuite son égalité avec la release du pilote diagnostique.

L’évaluation SQL et TypeScript compare les chaînes de codes exactement, sans conversion JSON, normalisation, préfixe CIM ou recherche externe. Les objets terminologiques portent uniquement deux chaînes non blanches, `code` et `label`. Les listes diagnostiques sont homogènes, sans doublon de code et limitées à 50 éléments ; une forme invalide rend toute la condition fausse. Les libellés ne participent jamais à l’appartenance. L’évaluation ne réécrit ni les valeurs ni leur ordre diagnostique. L’absence, `null`, une liste vide et un objet de valeur manquante ne déclenchent rien.

La liste configurée est non vide, sans doublon et composée de codes non blancs. Le serveur valide les codes contre les options de la version ou la publication explicitement liée. Les changements de champ relancent cette validation après synchronisation des options et de leur miroir historique. Les écritures de champs et de règles prennent le verrou de version avant les gardes existantes ; la publication revalide toutes les règles sous ce même verrou. La recopie de version conserve intégralement le JSON, dont `terminologyReleaseId` ; activer un autre référentiel ne modifie pas les associations antérieures.

Pour une cible gouvernée par une règle `contains_any`, toute valeur explicitement présente et non `null` est refusée si la cible est masquée, y compris une valeur manquante codifiée. Le trigger commun aux patients et rencontres impose ce refus en `draft`, `complete` et `curated`. Les règles historiques conservent leurs contrôles et leurs statuts d’application. Aucun effacement serveur implicite n’est ajouté.

## Compatibilité et activation

Un client antérieur à L51 rejette l’opérateur inconnu dans `validateRule`. Il ignore donc la règle d’affichage et **montre sa cible**, tandis que le serveur compatible peut la masquer. Une valeur masquée envoyée par ce client est refusée transactionnellement : SQLSTATE `P0001`, détail JSON `{ "code": "contains_any_hidden_value", "field": "…", "action": "refresh_required" }`, hint `refresh_required` et message demandant une actualisation. L’erreur ne contient aucune valeur clinique ; aucune donnée n’est effacée en silence.

Ordre d’activation obligatoire :

1. Déployer le support serveur additif **sans créer de règle `contains_any`**.
2. Rendre disponible le frontend compatible.
3. Seulement ensuite, publier les versions contenant ces règles.

Une release coordonnée peut regrouper les deux premières étapes ; l’activation reste dernière. Aucun déploiement ni changement distant n’est exécuté par ce lot local.

## Migration et vérification

La migration `20260905133549_rule_contains_any.sql` remplace les fonctions existantes sans modifier leurs signatures ni leurs ACL, ajoute des fonctions `SECURITY INVOKER` et des triggers sur les définitions, et ne réécrit aucune donnée. Aucune nouvelle fonction `SECURITY DEFINER`, table ou politique RLS n’est ajoutée. Le contrôle d’ACL existant reste applicable.

Les vecteurs de `test/fixtures/containsAny.ts` servent aux évaluateurs SQL et web. `test/contains-any.test.ts` couvre aussi les refus de définition, la recopie, la publication, les retraits de codes directs et concurrents, ainsi que les écritures de fiches. Les tests historiques de visibilité vérifient le maintien de leur comportement.

**État de vérification locale au 5 septembre 2026 :** avant la demande d’arrêt des tests locaux, 40 tests de domaine web et 11 tests du formulaire ont réussi, ainsi qu’un contrôle TypeScript. L’essai PostgreSQL a rencontré des difficultés de runtime Windows puis une erreur de syntaxe de la nouvelle migration, corrigée depuis par lecture. Les dernières modifications n’ont pas été réexécutées. À la demande du responsable, la validation finale, dont migration, parité SQL et ACL, est laissée à la CI GitHub existante (`db:verify` et `npm test`). Ce document ne constitue pas une preuve de validation serveur ni de déploiement.

Avant activation, le retrait du frontend compatible est possible tant qu’aucune version utilisant l’opérateur n’est publiée. Après activation, conserver le support serveur et corriger en avant par une nouvelle migration ; ne pas retirer le contrôle de persistance ni réécrire des règles de versions utilisées. Une modification fonctionnelle se fait dans une nouvelle version de gabarit.
