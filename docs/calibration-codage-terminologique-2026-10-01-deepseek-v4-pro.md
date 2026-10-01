# Calibrage du codage terminologique assisté avec DeepSeek V4 Pro — 1er octobre 2026

> 🗄️ **Preuve datée.** Mesures faites le 1er octobre 2026 avec les sorties **réelles** de
> `deepseek-v4-pro` (API DeepSeek), le modèle configuré en production
> (`TERMINOLOGY_LLM_MODEL`). Même jeu fictif (`test/fixtures/terminologyCalibration.ts`, 97 cas),
> même référentiel, même RPC et même score que le rapport
> [calibration-codage-terminologique-2026-10-01-deepseek.md](calibration-codage-terminologique-2026-10-01-deepseek.md),
> qui avait mesuré `deepseek-flash` par erreur (modèle par défaut).

**Conclusion.** Avec les seuils en vigueur, V4 Pro pose **un code faux sans confirmation dans
1 passage sur 3** (a05 « Diabète »). Il fait mieux que Flash (1 erreur critique au lieu de 3,
utilité 51 à 60 au lieu de 46 à 56), mais il n'est **pas qualifié**. Il est aussi **trop lent
pour le délai de production de 8 s** : 54 % des appels le dépassent, et l'Edge Function
basculerait alors sur le repli lexical. Les seuils **ne changent pas**.

## 1. Méthode

Identique au rapport Flash (§1), seul le modèle change :

```
TERMINOLOGY_LLM_PROVIDER=deepseek TERMINOLOGY_LLM_MODEL=deepseek-v4-pro \
  node scripts/record-terminology-interpretations.mjs --runs 3 \
  --out test/fixtures/terminologyCalibration.recorded.deepseek-v4-pro-2026-10-01.json

TERMINOLOGY_RECORDING=test/fixtures/terminologyCalibration.recorded.deepseek-v4-pro-2026-10-01.json \
TERMINOLOGY_CALIBRATION_REPORT=/tmp/calib/report.json \
  npx vitest run --project db test/terminology-calibration.test.ts
```

- Le nom de modèle a d'abord été vérifié : `deepseek-v4-pro` figure dans `GET /models` de l'API
  et répond à un appel d'essai.
- 97 cas × 3 passages = 291 appels, enregistrés sans retouche. Le fichier ne contient aucune
  clé ni aucun corps de réponse d'erreur.
- Délai de 30 s à l'enregistrement, pour mesurer la qualité.
- **Variante délai de production (8 s).** Une copie de l'enregistrement, non versionnée, remplace
  les réponses réussies de plus de 8 s par le repli lexical, comme le ferait l'Edge Function.
  Le rejeu est ensuite le même.

Le fichier reste **hors du chemin par défaut** (`test/fixtures/terminologyCalibration.recorded.json`,
réservé à un fournisseur qualifié). Rejoué avec `TERMINOLOGY_RECORDING`, il échoue sur la garde
« aucun code faux imposé, à chaque passage » (a05, passage 1). L'exigence n'est pas abaissée.

## 2. Résultats

### Comparaison, seuils en vigueur (0,95 / 0,05 / 0,65 / 0,55 / 4)

| Scénario | Critiques | Auto justes | Suggestions justes / fausses | Choix justes / sans le bon code | Manqués | Rien imposé / choix à tort | Utilité |
|---|---|---|---|---|---|---|---|
| V4 Pro, passage 1 | **1** (a05) | 40 | 20 / 12 | 10 / 3 | 4 | 6 / 1 | 51,0 |
| V4 Pro, passage 2 | 0 | 43 | 18 / 10 | 14 / 2 | 3 | 7 / 0 | 59,7 |
| V4 Pro, passage 3 | 0 | 44 | 19 / 12 | 10 / 2 | 3 | 7 / 0 | 58,2 |
| V4 Pro 8 s, passage 1 | 0 | 31 | 26 / 9 | 7 / 3 | 14 | 6 / 1 | 49,5 |
| V4 Pro 8 s, passage 2 | 0 | 33 | 25 / 8 | 11 / 2 | 11 | 7 / 0 | 54,3 |
| V4 Pro 8 s, passage 3 | 0 | 34 | 22 / 9 | 9 / 2 | 14 | 7 / 0 | 51,6 |
| Flash, passages 1 / 2 / 3 | **2 / 1 / 0** | 41 / 46 / 43 | — | — | — | — | 46,2 / 52,6 / 55,6 |
| LLM simulé | 0 | 58 | 13 / 3 | 13 / 1 | 1 | 8 / 0 | 75,6 |
| Repli lexical | 0 | 28 | 26 / 7 | 8 / 1 | 19 | 8 / 0 | 49,8 |

Par découpage, V4 Pro, seuils en vigueur (critiques / utilité / auto justes) :

| Passage | `dev` (39) | `test` (38) | `holdout` (20) |
|---|---|---|---|
| 1 | **1** / 18,8 / 20 | 0 / 25,8 / 18 | 0 / 6,4 / 2 |
| 2 | 0 / 28,6 / 20 | 0 / 24,1 / 20 | 0 / 7,0 / 3 |
| 3 | 0 / 26,5 / 19 | 0 / 25,3 / 21 | 0 / 6,4 / 4 |

L'utilité réelle de V4 Pro dépasse celle de Flash et celle du repli lexical (49,8). Elle reste
loin du LLM simulé (75,6). Les suggestions fausses passent de 3 (simulé) à 10–12.

### L'erreur critique

| Cas | Texte | Passage | Code posé seul | Attendu | Cause |
|---|---|---|---|---|---|
| a05 | « Diabète » | 1 (12,2 s) | 5A14 Diabète sucré, type non précisé (score 1) | ambiguïté 5A10 / 5A11 | ambiguïté **non signalée** à ce passage |

Au passage 2, l'appel a échoué (repli lexical, choix sans le bon code). Au passage 3,
l'ambiguïté est signalée et le choix est juste. C'est la même instabilité que chez Flash (§4.3
du rapport Flash). Elle relève du prompt et d'une décision clinique non prise : 5A14 doit-il
compter comme code générique fidèle ?

Les deux autres erreurs de Flash ne se reproduisent pas :
- **c03** (« HSD aigu post-traumatique ») : le terme spécifique « aigu » est en tête aux 3
  passages, et le code est posé juste.
- **i12** (« Radiculopathie L5 sur conflit discal ») : suggestion fausse au passage 1, échec
  du fournisseur aux passages 2 et 3. Le repli lexical ne pose alors rien.

La cause de score décrite pour Flash (terme général pondéré 0,95, perte de précision non
détectée) **reste présente**. V4 Pro ne la déclenche simplement pas ici.

### Seuils choisis sur ces sorties

- **Sorties brutes.** 558 jeux sur 1 674 sont admissibles. Le meilleur, 0,95 / **0,25** /
  **0,90** / 0,55, n'évite a05 qu'en supprimant presque tout automatisme : 12 à 14 auto justes
  au lieu de 40 à 44, utilité 43,3 à 50,5 au lieu de 51,0 à 59,7. L'utilité baisse, ce jeu
  n'est donc **pas retenu**. C'est le même jeu, et la même conclusion, que pour Flash avec le
  délai de 8 s.
- **Variante 8 s.** Les 1 674 jeux sont admissibles. Le meilleur, **0,80** / 0,05 / 0,65 /
  0,55, relève l'utilité (52,2 à 57,3), mais il **abaisse le seuil automatique** de 0,95 à
  0,80. Il est **refusé** :
  - l'exigence n'est jamais abaissée ;
  - cette variante n'a 0 erreur critique que parce que la réponse fautive de a05 (12,2 s)
    y est coupée par le délai ;
  - 54 % des appels y passent par le repli lexical : elle mesure surtout le repli, pas le
    modèle.

### Stabilité entre passages

**35 cas sur 97** changent d'issue d'un passage à l'autre (Flash : 38). La variante 8 s en
compte 23, parce que le repli lexical est déterministe. L'unique erreur critique ne survient
qu'à un passage sur trois. Aucun plancher d'utilité n'est donc ajouté.

### Échecs et latences

| Mesure | V4 Pro | Flash |
|---|---|---|
| Appels | 291 | 291 |
| Échecs (repli lexical) | **38** (14 / 10 / 14 par passage) | 13 (3 / 3 / 7) |
| Latence p50 / p90 / max | **8,7 s / 20,1 s / 22,8 s** | 2,5 s / 6,5 s / 10,4 s |
| Appels de plus de 8 s | **156** (38 échecs + 118 réussites) | 17 (13 échecs + 4 réussites) |

**Cas en échec** : 25 cas.
- 5 échouent aux 3 passages : i07, a02, a07, t02, h15.
- 3 échouent à 2 passages : i12, a01, t13.

Liste complète : c04, c11, c13, c26, i03, i06, i07, i11, i12, a01, a02, a03, a04, a05,
a07, a08, t02, t11, t12, t13, h02, h07, h15, h16, h20.

**Cause des échecs.** Même cause que pour Flash, en plus fréquent :
- `deepseek-v4-pro` raisonne avant de répondre, et ses jetons de raisonnement comptent dans
  `max_tokens` (2 048).
- Six cas en échec ont été rejoués, sans afficher de corps de réponse (seuls `finish_reason` et
  le décompte de jetons sont lus). h15 a de nouveau épuisé le budget : 2 048 jetons de
  raisonnement, aucun contenu, `finish_reason=length`, 20,6 s.
- Les cinq autres ont réussi avec 590 à 1 930 jetons de raisonnement et 7,4 à 21,6 s.
- Tous les échecs enregistrés prennent 19 à 23 s : c'est le temps de produire 2 048 jetons.

**En production**, le délai de 8 s couperait ces échecs, ainsi que 118 réponses réussies. Au
total, environ la moitié des saisies attendrait 8 s pour recevoir le seul repli lexical.

## 3. Décision

- **`THRESHOLDS` inchangés** (0,95 / 0,05 / 0,65 / 0,55 / 4) :
  - sur les sorties brutes, aucun jeu de seuils n'évite a05 sans dégrader l'utilité ;
  - le jeu proposé par la variante 8 s abaisse l'exigence.
- **`deepseek-v4-pro` non qualifié.** Avec les seuils en vigueur, il impose un code faux dans
  1 passage sur 3. L'enregistrement reste hors du chemin par défaut, et aucun plancher
  d'utilité n'est ajouté.
- **Inadapté au délai de 8 s** tel que configuré. La latence médiane dépasse le délai de
  production.
- **Adaptateur de production non modifié dans ce lot.** Les pistes ci-dessous ne sont pas
  appliquées.

## 4. Pistes (non appliquées)

1. **Raisonnement et budget (fournisseur).**
   - Relever `max_tokens` éliminerait des échecs, mais allongerait des réponses déjà au-delà
     de 8 s.
   - Allonger le délai de production dégrade la saisie interactive.
   - Un mode ou un modèle sans raisonnement (ou à raisonnement borné, si l'API le permet) est
     la voie à mesurer en premier.
2. **Ambiguïté instable (prompt et décision clinique ; a05).** Même piste que le §4.3 du
   rapport Flash.
3. **Perte de précision non détectée (score).** Même piste que le §4.1 du rapport Flash. Elle
   protège aussi contre un futur modèle qui placerait le terme général en tête.

## 5. Limites

- **Holdout déjà consulté** (voir le rapport Flash) : aucune décision ne s'y appuie.
- **Petit jeu fictif, un seul annotateur, trois passages.** Avec 35 cas instables, une seule
  erreur observée ne mesure pas une fréquence. Elle suffit à refuser la qualification.
- **Un modèle, une date.** Les sorties de `deepseek-v4-pro` au 1er octobre 2026.
- **Latences mesurées depuis un conteneur de développement**, avec 4 appels concurrents, et non
  depuis l'Edge Function : l'ordre de grandeur vaut, pas la valeur exacte.
