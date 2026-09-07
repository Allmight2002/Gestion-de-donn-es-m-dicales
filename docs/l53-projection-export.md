# L53 — projection d’export par blocs

Implémentation locale du contrat de [la spécification, §6](spec-blocs-pathologies.md#6-l53--projection-dexport-par-blocs), issue de [la décision D6](decision-blocs-pathologies-2026-09-03.md) et amendée par [la collecte diagnostique, §2](spec-collecte-diagnostique.md#2-l51l54--amendements-nécessaires).

L’export rendait l’union de toutes les variables de la population. Avec douze blocs cliniques dans une même base, le fichier devenait large et clairsemé, et rien ne permettait d’extraire « le tronc commun plus une pathologie ». Ce lot ajoute une **projection de colonnes**. Il ne fusionne aucune base, ne crée aucune identité inter-bases et **ne filtre jamais la population**.

## Contrat

`export_options` accepte une option facultative :

```json
{
  "sectionProjection": {
    "mode": "selected",
    "blockKeys": ["tuberculose", "malnutrition"]
  }
}
```

`mode: "all"` est le défaut ; l’absence de `sectionProjection` lui équivaut et reproduit exactement le fichier produit avant le lot. Les clés désignent des **blocs racines**, jamais des sous-sections. En mode `all`, des clés éventuellement transmises sont ignorées : la projection résolue dit alors la vérité du fichier.

`ExportField` porte désormais les deux niveaux. `section` et `sectionLabel` gardent leur sens : la **feuille**, donc la sous-section quand il y en a une. Deux champs s’y ajoutent pour la racine :

```text
section       // feuille : sous-section si elle existe, sinon le bloc  (inchangé)
sectionLabel  //                                                        (inchangé)
blockKey      // bloc racine ; égal à `section` quand la section est plate
blockLabel    // libellé du bloc racine
```

`blockKey` est nul pour une variable du **tronc commun** (`template_field.section` nul depuis L54) et pour un **rattachement ancien non résolu** — un code de section absent de `template_section`. Dans les deux cas la variable est toujours exportée, quelle que soit la projection, et ne se liste jamais dans `blockKeys`. `ExportField.section` accepte donc `null`, ce que L54 a rendu possible en base.

## Sémantique normative

Le filtre porte sur `blockKey`, jamais sur la feuille : sélectionner `tuberculose` ramène les variables de la sous-section `tb_biologie`. Il s’applique en **un seul point**, juste après la fusion des versions.

Le handler conserve deux tableaux. `allFields`, fusionné mais non projeté, sert aux validations et aux **index d’opérandes de formule**, par portée. `projectedFields` sert aux colonnes, au dictionnaire, à `Modalités`, aux feuilles multivaluées, aux limites et à la garde anti-identité. Une formule projetée reste donc calculable avec des opérandes hors projection, sans que les colonnes de ces opérandes soient restituées.

La population n’est jamais filtrée : c’est la cohorte qui définit les lignes. Un patient ne relevant d’aucun bloc sélectionné ressort avec ses seules colonnes communes renseignées. Les variables partagées (D8) vivent dans le tronc commun : leur colonne est présente dans toutes les projections, et c’est leur règle de champ qui garantit qu’aucune valeur ne subsiste hors de leurs cas d’application.

La projection résolue est journalisée dans `export_log.export_options`, y compris `{ "mode": "all" }`. C’est un ajout au **journal**, jamais au fichier.

## Dictionnaire et métadonnées

Le dictionnaire XLSX gagne les colonnes `block` et `block_label`, placées juste après `section_label`, lorsqu’une projection est demandée **ou** qu’au moins une sous-section est présente. Sur une base historique à sections plates, sans `sectionProjection`, ces colonnes ne sont pas ajoutées : la structure de sortie reste strictement identique à celle d’avant L53, CSV comme XLSX.

La feuille `Métadonnées` (profil Analyse) gagne une ligne `section_projection_blocks` **uniquement** en mode `selected`. `row_count` y reste celui de la cohorte entière, la population n’ayant pas bougé.

## Refus

En mode `selected`, l’export est refusé **avant génération**, sans qu’aucun fichier soit produit :

| Cas | Réponse |
| --- | --- |
| `blockKeys` absent, vide, mal formé, ou `mode` inconnu | `400` — `sectionProjection invalide` |
| Clé inconnue de toutes les versions de la cohorte | `400` — `EXPORT_PROJECTION_UNKNOWN_BLOCK` |
| Clé désignant une sous-section dans au moins une version, ou dont le rôle racine/feuille diverge selon les versions | `400` — `EXPORT_PROJECTION_NOT_A_BLOCK` |

Une clé absente de certaines versions reste valide si elle est racine partout où elle existe : un bloc retiré du gabarit courant reste projetable tant que des fiches en portent les variables.

Un refus supplémentaire s’applique lorsque la projection est `selected` **ou** qu’une sous-section ajoute les colonnes de bloc au dictionnaire :

| Cas | Réponse |
| --- | --- |
| Une même variable analytique `(scope, field_key)` rattachée à des blocs différents selon les versions, passage tronc commun ↔ bloc compris | `409` — `EXPORT_BLOCK_AMBIGUOUS` |

`mergeExportFields` fusionne par `(scope, field_key)` et retient la section de la **première version rencontrée** : une variable ayant changé de bloc serait classée au hasard de l’ordre de lecture. Le refus transforme ce résultat faux et silencieux en erreur visible. Le contrôle porte sur le **bloc**, pas sur la feuille : déplacer une variable d’une sous-section à une autre **à l’intérieur du même bloc** ne provoque aucun refus.

Sur une base historique plate, sans `sectionProjection`, ce contrôle n’est pas activé : aucun bloc n’influence alors la sélection ni les colonnes, et l’export continue de réussir même si une variable a changé de section au fil des versions. Un traitement complet par version reste une suite possible, hors du périmètre de ce lot.

## Interface

L’écran d’export propose les **sections racines de la version courante de la base**, sélectionnables. Les sous-sections ne sont pas proposées séparément : elles suivent leur bloc. Les variables du tronc commun sont annoncées comme toujours incluses et ne sont pas décochables. Le bouton d’export est retenu tant que le mode `selected` n’a aucun bloc coché. Traductions française et anglaise.

**Limite assumée du choix retenu.** La liste vient de la seule version courante, parce que le parcours principal fige la cohorte au moment de l’export : au moment où les cases sont dessinées, aucune cohorte n’existe encore. Un bloc retiré du gabarit courant n’est donc pas proposé, bien que le serveur l’accepte s’il est racine dans une version présente. La mention des libellés historiques prévue au §6.6 de la spécification est sans objet tant que l’écran ne lit qu’une version.

## Compatibilité et activation

Aucun changement de schéma, aucune migration. L’extension serveur est **additive et dormante** : un client antérieur n’envoie pas l’option, le serveur résout `all`, et le fichier produit est identique à celui d’avant le lot — dictionnaire compris.

Ordre d’activation obligatoire :

1. Déployer le support serveur, `all` par défaut, sans qu’aucun client ne propose `selected`.
2. Rendre disponible le frontend compatible portant le sélecteur.

Une release coordonnée peut regrouper les deux étapes, à condition que l’Edge Function soit déployée avant le frontend : un client proposant `selected` face à un serveur antérieur verrait son option ignorée en silence et recevrait un export complet. Aucun déploiement ni changement distant n’est exécuté par ce lot local.

## Vérification

Contrôles exécutés localement le 2026-09-05 : `deno fmt --check`, `deno lint`, `deno check`, `deno test` (211 tests Edge), `npm run test:web` (567 tests), les tests de domaine `export`, `export-completeness`, `edge-inventory`, `formula`, `template-formula` et `deployment`, `npm run typecheck`, `npm run lint`, `npm run db:verify`, `npm run release:edge:check` et `npm run build`.

La couverture propre au lot vit dans `supabase/functions/generate-export/sectionProjection_test.ts` (contrat), dans `handler_test.ts` (bout en bout : refus, journal, hash, CSV et XLSX), dans `_shared/contracts_test.ts` (normalisation de l’option) et dans `src/screens/member/ExportPanel.test.tsx` (sélecteur).

Deux réserves de méthode. La garde anti-identité reçoit bien le jeu de colonnes filtré, et le test fige la liste exacte des colonnes qui l’atteignent ; elle ne peut pas être amenée à refuser, les colonnes de variables étant préfixées par leur portée et ne pouvant donc égaler une clé de `FORBIDDEN_EXPORT_KEYS`. Sur cette machine, la suite web complète exige `--maxWorkers=2` : au-delà, V8 tue ses workers et produit des échecs qui ne sont pas des échecs d’assertion.
