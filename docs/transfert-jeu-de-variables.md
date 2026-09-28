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
seule** : sections (hiérarchie, blocs répétables), rubriques communes, variables avec tous
leurs attributs (options, valeurs proposées, unités, bornes, motifs d'absence, formules,
types de rencontre), règles et configuration diagnostique.

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
    `TEMPLATE_IMPORT_FORBIDDEN`.

Tests : `test/template-definition-transfer.test.ts` (base) et
`src/screens/member/TemplateTransfer.test.tsx` (écran).
