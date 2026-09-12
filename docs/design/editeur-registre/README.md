# Transmission — éditeur des jeux de variables

Date : 11 septembre 2026. Statut : **proposition d’interface et dossier de transmission**. Ce dossier ne signifie pas que la refonte est implémentée ou validée dans MedData.

## Démarrage dans une nouvelle session

1. Ouvrir le dépôt MedData dans l’agent de développement et lire son [AGENTS.md](../../../AGENTS.md).
2. Lire ce document et le [prompt de reconstruction](prompt-reconstruction.md).
3. Ouvrir [maquette.html](maquette.html) dans un navigateur pour parcourir la proposition. Son [code source lisible](maquette.source.html) permet d’examiner les composants visuels et les interactions.
4. Inspecter l’état réel du dépôt avant d’implémenter. La nouvelle session ne doit dépendre ni de l’historique de conversation ni d’un chemin privé vers une visualisation Codex.

Si l’agent n’a pas accès au dépôt, lui transmettre ce dossier et lui donner accès au code du projet. La maquette seule permet de reproduire une démonstration, pas d’intégrer et de valider les fonctions réelles de MedData.

## Besoin utilisateur

Le responsable veut utiliser une même base comme registre de plusieurs pathologies. Son essai comporte **216 variables, deux pathologies, plus de 20 sections et plus de 25 règles**. L’éditeur est difficile à parcourir entre les sections, les variables, les règles et la configuration diagnostique optionnelle.

L’objectif est de travailler sur une partie identifiable du registre sans perdre sa vue d’ensemble : **bloc → sous-section → variables**, avec accès aux règles pertinentes. Le formulaire peut comporter plusieurs blocs applicables à un même patient. Un diagnostic sans bloc spécialisé reste distinct d’un diagnostic pour lequel le socle commun suffit.

AVC et diabète dans la maquette sont des exemples fictifs ; ils ne désignent pas nécessairement les pathologies du modèle de l’utilisateur. Les nombres de l’en-tête rappellent le cas dimensionnant : le jeu d’exemple embarqué ne contient pas 216 variables.

## Rôle de chaque fichier et priorité des sources

| Source | Rôle |
|---|---|
| Ce README | Organisation cible, comportements attendus, périmètre, critères de sortie |
| `maquette.html` | Référence visuelle interactive à ouvrir ; fichier exporté, pas application de production |
| `maquette.source.html` | Copie exacte du fragment montré dans la conversation ; référence de composition |
| `prompt-reconstruction.md` | Instruction prête à donner à un agent ayant accès au projet |
| `provenance.json` | Empreinte du fragment original et repère Git au moment de la transmission |
| Code, migrations et documentation métier du dépôt | Contrats réels, sécurité, permissions, versions et comportements à conserver |

Cette proposition précise l’orientation de navigation d’UX-14 : ses trois espaces Variables / Sections / Règles évoluent vers les quatre espaces ci-dessous ; la liste globale des variables devient une sous-vue de Structure. Cette évolution de présentation ne remplace pas les contrats métier d’UX-14, UX-16, L52 ou L55.

Ne pas porter le JavaScript de démonstration tel quel dans React. Il contient des données fictives, des règles textuelles simplifiées et une modification en mémoire d’un libellé. La persistance, les erreurs, les permissions, la navigation clavier complète, les imports, la création/suppression et les protections de saisie n’y sont pas démontrés.

## Organisation cible

### 1. Structure du formulaire — espace principal

- Un sommaire latéral repliable présente les rubriques communes, les blocs racines et leurs sous-sections. Une section sélectionnée reste explicitement identifiable.
- La zone principale montre uniquement les variables de la section active. Sélectionner un bloc racine donne son résumé, sa condition éventuelle et ses sous-sections ; conserver l’accès à ses éventuelles variables directement rattachées.
- Afficher le chemin et des comptes calculés depuis les données réelles. Ne pas recopier les nombres d’exemple de la maquette.
- Une ligne de variable donne un libellé, son type et l’accès à ses règles ; les clés techniques et détails secondaires vivent dans le détail.
- Ouvrir une variable affiche son éditeur. Conserver les informations de contexte et un retour vers la même liste ; sur grand écran, un panneau de détail est possible s’il ne surcharge pas la page.
- Une sous-vue **Toutes les variables** conserve la recherche globale par libellé/clé/description, les filtres et le tri de consultation existants. La recherche ne doit pas se limiter au bloc ouvert et doit donner le chemin des résultats.
- Rendre les actions existantes accessibles au bon niveau : ajouter/modifier une variable, gérer un bloc ou une sous-section, réordonner, importer un bloc. Préserver les garde-fous, la provenance et les restrictions des versions publiées/utilisées.
- Un tri de consultation ne change jamais l’ordre enregistré du formulaire. Les déplacements métier restent des actions explicites.

### 2. Règles — vue générale et accès contextuel

- Conserver un index global recherchable avec portée explicite et filtres utiles : bloc, variable source/cible, type d’effet.
- Résumer chaque règle avec sa source, sa condition, sa cible et son effet, à partir du moteur réel. Une même règle reste un seul objet, même si elle est accessible depuis plusieurs écrans.
- Depuis une section ou un bloc, ouvrir les règles pertinentes ; depuis une variable, distinguer les règles qu’elle déclenche, celles qui la ciblent et la condition de bloc héritée.
- Depuis une règle, revenir à la section ou à la variable concernée. Préserver le contexte de recherche lors des allers-retours.
- Ouvrir le formulaire de création/modification à la demande ; éviter de laisser en permanence le formulaire complet sous toute la liste.
- Conserver les sélecteurs recherchables et rendre visible le contexte bloc/section, type et portée. Garder les exclusions de type, scope, formule et terminologie.
- Une condition commune à tout un bloc utilise la règle de bloc existante. Ne pas la recopier sur toutes ses variables.
- La création multicible d’UX-14(c) n’est pas ajoutée implicitement par cette refonte visuelle. Si elle est traitée dans un lot distinct, appliquer son contrat serveur atomique et idempotent ; aucune boucle d’écritures partielles depuis le navigateur.

### 3. Collecte diagnostique — configuration dédiée

- Sortir `DiagnosisConfigurationEditor` de la vue de gestion des sections et lui donner un espace dédié.
- Conserver l’activation optionnelle, le pilote diagnostique, les codes pour lesquels le socle suffit et les associations aux blocs.
- Les associations diagnostic → blocs et l’index des règles éditent les **mêmes règles existantes**, sans seconde configuration concurrente.
- Le champ Diagnostic saisi dans le formulaire reste une variable du tronc commun sémantique ; déplacer son écran de configuration ne déplace pas cette variable.
- La position et les rubriques de présentation communes relèvent d’UX-16. Ne jamais convertir des champs communs en champs de bloc pour imiter visuellement la maquette.

### 4. Aperçu — comprendre le formulaire obtenu

- Réutiliser le rendu réel de `FormPreview`, les composants de saisie et le moteur d’applicabilité. Les cases simplifiées de la maquette illustrent des scénarios, pas un nouveau moteur à implémenter.
- Permettre de vérifier un diagnostic couvert, plusieurs diagnostics avec plusieurs blocs, un diagnostic sans bloc, un cas mixte et une absence de diagnostic selon le contrat existant.
- L’aperçu et la simulation ne créent ni patient, ni rencontre, ni brouillon de travail réel.
- Ne pas confondre couverture spécialisée et complétude. L’absence de bloc n’invente aucune variable requise et n’annule pas les obligations des blocs applicables.

## États et protections à implémenter dans la véritable interface

- Préserver l’onglet, la section active, les groupes ouverts, les recherches/filtres et la position utile lors d’un aller-retour.
- Préserver les modifications non enregistrées dans l’éditeur ; utiliser les protections existantes avant une navigation qui les ferait perdre. Un changement d’espace ne sauvegarde pas implicitement une modification métier.
- Distinguer absence de modification, modification non enregistrée, enregistrement en cours, succès accusé et échec. Un conflit ou refus conserve tous les inputs locaux.
- Prévoir modèle vide, bloc sans variables, absence de résultat, sélection devenue indisponible et version non modifiable. Ne jamais supprimer une règle ou détacher des variables implicitement pour débloquer une action.
- Navigation au clavier, focus visible et retour de focus cohérent ; à largeur étroite, sommaire adapté et retour explicite vers le contexte précédent, sans colonnes illisibles.
- Garder les composants, styles sobres et traductions fr/en du projet. Les proportions, la hiérarchie et la présentation progressive de la maquette sont la référence ; adapter la finition au design existant sans supprimer les fonctions non dessinées.

## État observé et points d’entrée

Repère du 11 septembre 2026 : branche `codex/ux-correctifs`, HEAD `170207fb6652bb66360c1e19c58434f70e6ee6f3`, avec de nombreuses modifications locales, dont l’éditeur et les formulaires. **Le HEAD seul ne reproduit pas cet état.** Relire `git status`, les diffs et les fichiers avant tout travail ; ne rien réinitialiser pour repartir artificiellement d’un arbre propre.

Les trois espaces Variables / Sections / Règles et l’appel à `DiagnosisConfigurationEditor` dans Sections ont été retrouvés dans le code local. Des recherches, filtres, groupes repliables et liens variable/règle existent déjà. Leur présence ne vaut pas validation de la refonte cible ni preuve de déploiement.

| Zone | Fichiers à examiner |
|---|---|
| Éditeur et tests | [TemplateVersionEditor.tsx](../../../src/screens/staff/TemplateVersionEditor.tsx), [tests](../../../src/screens/staff/TemplateVersionEditor.test.tsx) |
| Structure | [SectionsEditor.tsx](../../../src/screens/staff/SectionsEditor.tsx), [templateSections.ts](../../../src/domain/templateSections.ts) |
| Règles | [RuleForm.tsx](../../../src/screens/staff/RuleForm.tsx), [tests](../../../src/screens/staff/RuleForm.test.tsx), [templateRules.ts](../../../src/domain/templateRules.ts) |
| Diagnostic | [DiagnosisConfigurationEditor.tsx](../../../src/screens/staff/DiagnosisConfigurationEditor.tsx), [diagnosisCoverage.ts](../../../src/domain/diagnosisCoverage.ts) |
| Aperçu | [FormPreview.tsx](../../../src/screens/staff/FormPreview.tsx), [tests](../../../src/screens/staff/FormPreview.test.tsx) |
| Contrat et suivi | [Spécification UX, §5.3 et §6.3](../../spec-experience-utilisateur.md), [suivi local](../../suivi-correctifs-ux.md), [collecte diagnostique](../../spec-collecte-diagnostique.md), [architecture](../../architecture.md) |

## Ordre de réalisation recommandé

| Lot | Travail et charge relative | Dépendances | Critère de sortie / risque principal |
|---|---|---|---|
| A | Navigation à quatre espaces, arbre et section active — moyenne | Inventaire des composants et protections existants | Accès direct bloc → section → variable ; aucune fonction existante perdue ni saisie écrasée |
| B | Accès contextuel aux règles, formulaires à la demande — moyenne | A ; moteur de règles inchangé | Aller-retour section/variable/règle avec contexte conservé ; aucun objet de règle dupliqué |
| C | Configuration diagnostique isolée et aperçu réel — moyenne | A ; composants diagnostiques et aperçu existants | Cas simples, multiples et non couverts cohérents avec le moteur réel, sans écriture en aperçu |
| D | Rubriques communes UX-16 si le contrat est absent — élevée, conditionnelle | Contrat UX-16 actuel et contrôle du schéma/copies | Présentation libre sans altération d’appartenance clinique ; pas de contournement par un faux bloc |
| E | Vérification intégrée et ajustement de densité — moyenne | Lots concernés terminés | Preuves ciblées, comportement au volume demandé et revue visuelle de l’application réelle |

Le lot D est une dépendance métier explicite si plusieurs rubriques communes doivent être persistées et que le dépôt ne les prend pas encore en charge. Examiner l’implémentation et la spécification existantes, traiter ce contrat séparément, et ne pas annoncer toute la cible achevée avec cette partie seulement simulée. Le lot A peut progresser indépendamment. Toute nouvelle migration est additive et suit les instructions DB du dépôt ; aucune migration distante n’est autorisée par ce dossier.

## Critères d’acceptation pour la reconstruction

1. Ouvrir directement une sous-section d’un grand modèle sans traverser les variables des sections précédentes.
2. Rechercher une variable située dans un bloc fermé, voir son chemin, l’ouvrir et revenir au même résultat filtré.
3. Modifier une variable puis changer de contexte, annuler une fermeture ou recevoir un refus : conserver la saisie et rendre l’état explicite.
4. Retrouver depuis une section sa condition de bloc et ses règles de champ, puis revenir à la section.
5. Vérifier qu’une association diagnostique et sa présentation dans Règles désignent le même objet et produisent le même effet.
6. Retrouver toutes les actions existantes utiles, avec les mêmes permissions et restrictions de version.
7. Vérifier dans l’aperçu les combinaisons de diagnostics avec le moteur réel et constater l’absence d’écriture de données réelles.
8. Vérifier la présentation et les interactions sur une fixture fictive de **216 variables, au moins 21 sections et au moins 26 règles**, en complétant la fixture 216/24 existante si nécessaire.
9. Vérifier clavier, focus, libellés longs et affichage étroit. Mesurer recherche, filtrage, ouverture et navigation avant de décider une pagination ou virtualisation.
10. Présenter des captures de la véritable interface, les commandes exécutées avec leur résultat et les limites restantes. Des tests présents mais non lancés ne sont pas une preuve.

## Vérifications à exécuter lors de l’implémentation

Relire les scripts de `package.json` à l’ouverture de la session. Exemples correspondant au dépôt au moment de cette transmission, sous PowerShell, depuis la racine du projet :

```powershell
npm.cmd run test:web -- src/screens/staff/TemplateVersionEditor.test.tsx --maxWorkers=1 --no-file-parallelism
npm.cmd run test:web -- src/screens/staff/RuleForm.test.tsx --maxWorkers=1 --no-file-parallelism
npm.cmd run test:web -- src/screens/staff/FormPreview.test.tsx --maxWorkers=1 --no-file-parallelism
npm.cmd run typecheck
```

Exécuter le lint pertinent pour les fichiers effectivement touchés puis élargir selon le risque. Tester les nouveaux comportements plutôt que la structure exacte du JSX. Si un build de production est exécuté, utiliser le garde-fou `VITE_USE_SIGNED_READ=true`. En cas de migration, suivre `AGENTS.md` et les skills DB : cible locale/jetable, tests ciblés, génération et inspection du snapshot, puis `schema:check`.

Les vérifications ci-dessus sont des consignes pour la future implémentation ; elles n’ont pas été exécutées pour produire ce dossier documentaire. Aucun test navigateur de la refonte MedData n’est revendiqué ici.

## Restitution attendue de la future session

Donner les fichiers modifiés, les comportements réellement implémentés, les preuves de test et de revue visuelle, les écarts restants et les limites de validation. Préserver les modifications utilisateur hors périmètre. Aucun commit, push, merge, déploiement ou changement cloud sans demande explicite.
