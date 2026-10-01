# Transférer un jeu de variables par fichier 🟢

Un jeu de variables (gabarit) construit dans un compte peut être **exporté dans un fichier**
puis **réimporté** dans un autre compte ou une autre instance MedData, sans ressaisie.
Cas typique : un médecin construit le registre de neurochirurgie dans son compte, l'exporte,
et l'administrateur l'importe puis le promeut en **modèle global** proposé à tous.

## Parcours

| Étape | Où | Action |
|---|---|---|
| 1. Exporter | *Mes jeux de variables* (ou *Administration*) → menu `…` du jeu | **Exporter en fichier** : télécharge `jeu-<nom>-v<n>.meddata.json` (version en préparation si elle existe, sinon la version en service) |
| 2. Importer | *Mes jeux de variables* → **Nouveau** → **Importer un fichier MedData** (ou bouton du même nom en *Administration*) | Crée un jeu **personnel, en brouillon**, et ouvre son éditeur |
| 3. Publier (admin) | *Administration* → menu `…` du jeu importé | **Promouvoir en modèle global** : publie une copie globale |

Si les deux comptes sont sur **la même instance**, l'étape fichier est facultative :
l'administrateur voit déjà les jeux personnels en *Administration* et peut les promouvoir
directement.

## Contenu du fichier

Format `meddata.template-definition`, version `1`, JSON lisible. Il porte la **structure
seule** : sections (hiérarchie, blocs répétables et leurs libellés de saisie `addLabel` /
`itemLabel`), rubriques communes, variables avec tous leurs attributs (options, valeurs
proposées, unités, bornes, motifs d'absence, formules, types de rencontre), règles et
configuration diagnostique. Les libellés de saisie sont facultatifs : un fichier antérieur,
qui ne les porte pas, s'importe avec les libellés génériques.

Il ne porte **aucune donnée patient**, aucun identifiant interne, aucun propriétaire, aucune
base. Tout y est référencé par code (`fieldKey`, `section`, `commonGroup`). Seules les
nomenclatures (terminologies) sont désignées par un identifiant propre à l'instance :
le fichier joint leur `slug`, et l'import les retrouve localement par ce `slug`.

## Garanties serveur

- **Export** (`export_template_definition`, `security invoker`) : on n'exporte que ce que la
  RLS permet déjà de lire. L'ordre du fichier est déterministe : deux exports d'un même jeu
  sont identiques (hors date d'export).
- **Import** (`import_template_definition`, `security definer`, inventorié) :
  - réservé aux rôles médecin et administrateur ; crée toujours un jeu **personnel brouillon** ;
  - **atomique** : un refus n'écrit rien (ni gabarit, ni section, ni variable) ;
  - **idempotent** : une même clé d'opération rend le même résultat ; réutilisée pour un autre
    contenu, elle est refusée (`IDEMPOTENCY_KEY_REUSED`) ;
  - le contenu est validé par les **gardes existantes** de l'éditeur (formules, options,
    répétabilité, règles, configuration diagnostique) : un fichier ne peut rien créer que
    l'éditeur aurait refusé ;
  - refus structurés : `TEMPLATE_IMPORT_FORMAT_UNSUPPORTED`, `TEMPLATE_IMPORT_INVALID`,
    `TEMPLATE_IMPORT_TERMINOLOGY_MISSING` (nomenclature absente de l'instance cible),
    `TEMPLATE_IMPORT_FORBIDDEN` ;
  - `TEMPLATE_IMPORT_INVALID` dit **quoi corriger** : son détail JSON porte un `reason`
    (`section_key_invalid`, `too_many`, `field_section_unknown`, `content_incoherent`…) et,
    selon le cas, le code en cause (`key`, `parentKey`, `section`, `group`), son rang
    (`position`), la liste et sa borne (`list`, `limit`, `count`) ou l'étape (`stage`). Seuls
    des codes de structure et des compteurs sortent, jamais une valeur clinique ni l'erreur SQL
    brute. L'écran les traduit (`src/lib/errorMessage.ts`). Liste complète : migration
    `20260930120000_template_import_refusal_reasons.sql`.

## Ce que l'import accepte

L'import n'est pas plus strict que l'éditeur : tout fichier exporté par MedData se réimporte.

- **Codes de variable** : aucun format imposé (majuscules, accents, tirets acceptés, comme dans
  l'éditeur) ; non vides, sans espace autour, uniques.
- **Codes de bloc et de rubrique commune** : `^[a-z][a-z0-9_]{0,62}$`. C'est une contrainte des
  tables : l'éditeur ne peut pas produire d'autre code, seul un fichier retouché à la main peut
  être refusé ici.
- **Bornes** de protection du serveur, très au-dessus d'un registre réel : 500 blocs,
  200 rubriques, 2 000 variables, 5 000 règles.
- **Bloc piloté par le diagnostic** : mêmes gardes que l'éditeur. Une seule règle d'affichage
  sur le bloc (`DIAGNOSIS_BLOCK_NONCANONICAL`) ; au moins une variable saisissable, non
  calculée, de même portée que le diagnostic, dans le bloc ou un sous-bloc **non répétable**
  (`DIAGNOSIS_BLOCK_EMPTY`). L'écran explique ces deux contraintes, à l'import comme dans
  l'éditeur.

Tests : `test/template-definition-transfer.test.ts` (base) et
`src/screens/member/TemplateTransfer.test.tsx` (écran).
