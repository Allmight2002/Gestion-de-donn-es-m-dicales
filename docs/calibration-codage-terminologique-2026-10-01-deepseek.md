# Calibrage du codage terminologique assisté avec DeepSeek — 1er octobre 2026

> 🗄️ **Preuve datée.** Mesures faites le 1er octobre 2026 avec les sorties **réelles** de
> `deepseek-flash` (API DeepSeek), sur le jeu fictif `test/fixtures/terminologyCalibration.ts`
> (97 cas), le référentiel versionné `supabase/terminology/diagnostics-fr.tsv.gz`, la RPC
> `match_terminology_candidates` et le score de `supabase/functions/code-terminology/scoring.ts` à
> cette date. Suite du rapport [calibration-codage-terminologique-2026-10-01.md](calibration-codage-terminologique-2026-10-01.md),
> qui ne disposait que d'interprétations simulées.
>
> **Modèle mesuré par erreur.** `deepseek-flash` est le modèle par défaut ; la production utilise
> `deepseek-v4-pro`. Voir [calibration-codage-terminologique-2026-10-01-deepseek-v4-pro.md](calibration-codage-terminologique-2026-10-01-deepseek-v4-pro.md)
> (non qualifié non plus : 1 erreur critique sur 3 passages, latence médiane 8,7 s).

**Conclusion.** Avec les seuils en vigueur, DeepSeek pose **un code faux sans confirmation dans
2 passages sur 3** (3 erreurs critiques au total). Aucun jeu de seuils de la grille ne les évite
toutes. Les seuils **ne changent pas**. `deepseek-flash` n'est **pas qualifié** comme fournisseur
d'interprétation tant que les causes décrites au §4 ne sont pas corrigées et remesurées.

## 1. Méthode

**Enregistrement.** `TERMINOLOGY_LLM_PROVIDER=deepseek node scripts/record-terminology-interpretations.mjs --runs 3`.
Même chemin que l'Edge Function : texte nettoyé (`scrubIdentifiers`), même prompt, même
validation (`parseInterpretation`). Le délai est porté à 30 s pour mesurer la qualité ; les
dépassements des 8 s de production sont comptés à part. Un échec du fournisseur vaut repli
lexical, comme dans l'Edge Function. 97 cas × 3 passages = 291 appels, enregistrés sans retouche
dans `test/fixtures/terminologyCalibration.recorded.deepseek-flash-2026-10-01.json` (aucune clé,
aucun corps de réponse d'erreur).

**Rejeu.**
```
TERMINOLOGY_RECORDING=test/fixtures/terminologyCalibration.recorded.deepseek-flash-2026-10-01.json \
TERMINOLOGY_CALIBRATION_REPORT=/tmp/calib/report.json \
  npx vitest run --project db test/terminology-calibration.test.ts
```
Les issues, l'utilité, la grille (1 674 combinaisons) et les règles de choix sont celles du
rapport précédent (§1). Le choix porte sur `dev` + `test`, enregistrés et repli lexical, avec la
marge de robustesse.

**Fichier non chargé par défaut.** Le chemin par défaut
`test/fixtures/terminologyCalibration.recorded.json` est réservé à l'enregistrement d'un
fournisseur **qualifié** : le test l'exige sans erreur critique à chaque exécution. Celui de
DeepSeek ne l'est pas. Il se rejoue avec `TERMINOLOGY_RECORDING` et échoue alors sur la garde
« aucun code faux imposé, à chaque passage ». L'exigence n'est pas abaissée.

## 2. Résultats

### Erreurs critiques et utilité, seuils en vigueur (0,95 / 0,05 / 0,65 / 0,55 / 4)

| Scénario | Critiques | Auto justes | Suggestions justes / fausses | Choix justes / sans le bon code | Manqués | Rien imposé / choix à tort | Utilité |
|---|---|---|---|---|---|---|---|
| DeepSeek, passage 1 | **2** (c03, i12) | 41 | 18 / 14 | 11 / 4 | 1 | 5 / 1 | 46,2 |
| DeepSeek, passage 2 | **1** (a05) | 46 | 12 / 14 | 14 / 1 | 2 | 6 / 1 | 52,6 |
| DeepSeek, passage 3 | **0** | 43 | 18 / 12 | 12 / 1 | 4 | 4 / 3 | 55,6 |
| LLM simulé | 0 | 58 | 13 / 3 | 13 / 1 | 1 | 8 / 0 | 75,6 |
| Repli lexical | 0 | 28 | 26 / 7 | 8 / 1 | 19 | 8 / 0 | 49,8 |

Par découpage (critiques / utilité / auto justes) :

| Passage | `dev` (39) | `test` (38) | `holdout` (20) |
|---|---|---|---|
| 1 | **1** / 18,9 / 17 | **1** / 19,8 / 20 | 0 / 7,5 / 4 |
| 2 | **1** / 24,3 / 23 | 0 / 20,6 / 19 | 0 / 7,7 / 4 |
| 3 | 0 / 24,4 / 18 | 0 / 22,8 / 20 | 0 / 8,4 / 5 |

L'utilité réelle (46 à 56) est nettement **inférieure** à celle du LLM simulé (75,6), à peine
supérieure au repli lexical (49,8). Les suggestions fausses passent de 3 à 12–14.

### Les trois erreurs critiques

| Cas | Texte | Passage | Code posé seul | Attendu | Cause |
|---|---|---|---|---|---|
| c03 | « HSD aigu post-traumatique » | 1 | NA07.6 Hémorragie sousdurale traumatique (score 1) | NA07.60 … aigüe | terme **général** placé en tête, « aigu » perdu |
| i12 | « Radiculopathie L5 sur conflit discal » | 1 | 8B93 Radiculopathie (0,95) | 8B93.6 … atteinte des disques | terme général « Radiculopathie » en dernier, pondéré 0,95 = seuil automatique |
| a05 | « Diabète » | 2 | 5A14 Diabète sucré, type non précisé (1) | ambiguïté 5A10 / 5A11 | ambiguïté **non signalée** à ce passage (signalée au passage 3) |

### Seuils choisis sur ces sorties

**Aucun** des 1 674 jeux de seuils n'est admissible : aucun n'évite à la fois les trois erreurs
critiques, voisin plus permissif compris. Le balayage ne propose donc rien.

**Variante délai de production (8 s).** Les 4 réponses réussies en plus de 8 s sont remplacées par
le repli lexical, comme le ferait l'Edge Function. i12 disparaît (sa réponse avait pris 8,5 s),
c03 et a05 restent. Le balayage trouve alors 558 jeux admissibles, le meilleur étant
0,95 / **0,25** / **0,90** / 0,55. Il n'élimine les erreurs qu'en supprimant presque tout
automatisme : 10 à 12 auto justes au lieu de 41 à 46, utilité 46,9 à 47,5 au lieu de 49,0 à 55,6.
L'utilité baisse au lieu de s'améliorer, ce jeu n'est donc **pas retenu**.

### Stabilité entre passages

Sur 97 cas, **38 changent d'issue** d'un passage à l'autre. Les trois erreurs critiques ne
surviennent chacune qu'une fois sur trois. Un seul passage sans erreur, ici le passage 3, ne
prouve donc rien. Aucun plancher d'utilité n'est ajouté pour ce fournisseur : le résultat n'est
pas stable.

### Échecs et latences

| Mesure | Valeur |
|---|---|
| Appels | 291 |
| Échecs (repli lexical) | 13 (3 / 3 / 7 par passage) |
| Latence p50 / p90 / max | 2,5 s / 6,5 s / 10,4 s |
| Appels de plus de 8 s | 17, dont les 13 échecs et 4 réussites |

**Cause des échecs.** `deepseek-flash` raisonne avant de répondre, et ses jetons de raisonnement
comptent dans `max_tokens` (2 048). Le diagnostic, rejoué sur les cas en échec sans afficher de
corps de réponse, montre parfois 2 048 jetons de raisonnement, aucun contenu et
`finish_reason=length`. Le même cas réussit au rejeu suivant avec 300 à 1 800 jetons de
raisonnement. Ces échecs prennent toujours 9 à 10 s : en production, le délai de 8 s les couperait
avant. Le résultat est le même (repli lexical), mais l'attente est plus longue pour le médecin.

## 3. Décision

- **`THRESHOLDS` inchangés** (0,95 / 0,05 / 0,65 / 0,55 / 4). Aucun jeu de seuils n'atteint 0 erreur
  critique sur les trois passages. Le seul jeu admissible, avec le délai de 8 s, dégrade l'utilité.
- **DeepSeek (`deepseek-flash`) non qualifié.** Sur ce jeu, il impose un code faux dans 2 passages
  sur 3. Il ne doit pas être activé (`TERMINOLOGY_LLM_PROVIDER=deepseek`) pour des données réelles
  avant correction et nouvelle mesure.
- **Aucune correction du score ni du prompt dans ce lot.** Les pistes ci-dessous changent le
  comportement des trois scénarios et demandent leur propre calibrage.

## 4. Causes et pistes (non appliquées)

1. **Perte de précision non détectée (score ; c03, i12).** La règle de couverture vérifie qu'un
   intitulé n'**ajoute** rien au texte. Elle ne vérifie pas qu'il n'en **retire** rien : le code
   parent « Hémorragie sousdurale traumatique » couvre le texte, mais perd « aigu ». Un terme de
   recherche secondaire est pondéré 0,95, exactement le seuil automatique. Un terme général
   donné « en dernier », comme le demande le prompt, suffit donc à poser le code parent.
   - Piste : ne pas poser automatiquement un code quand un code **descendant** figure parmi les
     candidats plausibles (NA07.60 sous NA07.6, 8B93.6 sous 8B93).
   - Autre piste : exiger que le score automatique vienne du terme **préféré**.
   - Les deux ne font que retirer de l'automatisme, sans risque d'erreur critique nouvelle, mais
     elles baissent l'utilité des scénarios simulé et lexical. À mesurer.
2. **Ordre des termes non respecté (prompt ; c03 passage 1).** DeepSeek a placé le terme général
   en tête malgré la consigne « du plus spécifique au plus général ». La consigne pourrait être
   renforcée, avec un exemple où le qualificatif (aigu/chronique) reste dans le premier terme. Le
   score doit rester sûr même si le modèle ne suit pas le prompt : la piste 1 prime.
3. **Ambiguïté signalée de façon instable (prompt ; a05).** « Diabète » est signalé ambigu à un
   passage sur deux réussis. Sans ce signal, « Diabète sucré, type non précisé » couvre le texte
   et est posé seul.
   - L'annotation (ambiguïté 5A10 / 5A11, sans code générique accepté) est plus stricte que la
     convention du score, pour qui la catégorie « non précisée » est la bonne quand rien n'est
     précisé.
   - Accepter 5A14 comme code générique fidèle est une **décision clinique** : elle n'a pas été
     prise ici et l'annotation n'a pas été modifiée.
4. **Échecs par épuisement du budget (fournisseur).** Relever `max_tokens` allongerait encore
   des réponses déjà au-delà de 8 s. Un modèle ou un mode sans raisonnement serait plus adapté
   à une saisie interactive. Rien n'a été changé.

## 5. Limites

- **Holdout déjà consulté.** Le `holdout` (20 cas) avait été consulté une fois au calibrage
  précédent. Les mesures `holdout` ci-dessus ne sont donc pas inédites. Aucune décision ne s'y
  appuie : aucun seuil n'a été changé.
- **Petit jeu fictif, un seul annotateur, trois passages.** Avec 38 cas instables sur 97,
  trois passages donnent un ordre de grandeur, pas une fréquence d'erreur fiable.
- **Un modèle, une date.** Les sorties de `deepseek-flash` au 1er octobre 2026 ; une autre
  version du modèle ou un autre fournisseur demande un nouvel enregistrement.
- **Latences mesurées depuis un conteneur de développement**, pas depuis l'Edge Function
  Supabase : l'ordre de grandeur vaut, pas la valeur exacte.
