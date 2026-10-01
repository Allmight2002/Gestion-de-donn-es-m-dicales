# Calibrage des seuils du codage terminologique assisté — 1er octobre 2026

> 🗄️ **Preuve datée.** Mesures faites le 1er octobre 2026 sur le référentiel versionné
> `supabase/terminology/diagnostics-fr.tsv.gz`, avec la RPC `match_terminology_candidates` et le
> score de `supabase/functions/code-terminology/scoring.ts` à cette date. L'état courant du
> codage est décrit dans [codage-terminologique-assiste.md](codage-terminologique-assiste.md) ;
> le test `test/terminology-calibration.test.ts` garde ces résultats.

## 1. Méthode

**Jeu annoté** (`test/fixtures/terminologyCalibration.ts`) : 92 diagnostics **fictifs**, surtout
en neurochirurgie, répartis en cinq familles. Chaque code attendu existe dans le référentiel.

| Famille | Contenu | Cas |
|---|---|---|
| clear | interprétation proche des intitulés CIM-11 | 45 |
| imperfect | interprétation dégradée : termes cliniques, terme trop général, coquilles | 18 |
| ambiguous | le texte ne permet pas de choisir (« Hémorragie intracrânienne spontanée », « AVC ») | 11 |
| absent | rien ne convient dans le référentiel (« Épendymome », « Syndrome de Zorglub ») | 8 |
| trap | entités voisines (aigu/chronique, traumatique/non, nouveau-né) | 10 |

**Découpage.** `dev` (36 cas) et `test` (36) servent au calibrage. `holdout` (20) a été écrit
**après** les corrections du score, n'a servi à aucun ajustement et a été consulté une seule
fois.

**Deux scénarios, mêmes seuils.**
- **LLM simulé** : l'interprétation est écrite à la main. Aucune clé API n'était disponible pendant
  le calibrage. Une partie de ces interprétations est volontairement imparfaite.
- **Repli lexical** : code réel, à partir du seul texte.

**Issues d'un cas.**

| Issue | Sens | Utilité |
|---|---|---|
| `auto_ok` | code juste posé automatiquement | +1 |
| `suggest_ok` | bon code proposé à confirmer | +0,7 |
| `choice_ok` | bon code parmi les propositions | +0,5 |
| `unmatched_ok` | rien d'imposé quand rien ne convenait | +0,5 |
| `missed` | non codé alors qu'un code convenait | 0 |
| `choice_miss` | propositions sans le bon code | −0,2 |
| `false_choice` | propositions alors que rien ne convenait | −0,2 |
| `suggest_wrong` | mauvais code proposé à confirmer | −0,6 |
| **`auto_wrong`** | **CRITIQUE** : code faux posé seul, ou ambiguïté tranchée en silence | −3 |

Un code **générique fidèle** (« Hydrocéphalie » → 8D64 « Hydrocéphalie ») n'est pas une
ambiguïté tranchée : il n'invente aucun détail.

**Sélection des seuils.** La grille compte 1 674 combinaisons :

| Seuil | Bornes | Pas |
|---|---|---|
| automatique | 0,80 à 1 | 0,05 |
| écart | 0,05 à 0,30 | 0,05 |
| suggestion | 0,50 à 0,90 | 0,05 |
| plausibilité | 0,30 à 0,60 | 0,05 |

Règles de choix :
1. aucune erreur critique dans les deux scénarios ;
2. aucune erreur critique non plus pour le **voisin plus permissif** (automatique et écart
   abaissés de 0,05) : c'est la marge de robustesse ;
3. puis utilité maximale (LLM + ½ repli lexical) ;
4. à égalité, le jeu le plus prudent.

## 2. Ce que le calibrage a corrigé, au-delà des seuils

Les premiers passages ont montré qu'aucun jeu de seuils n'évitait toutes les erreurs critiques :
la cause était dans le score lui-même.

| Constat | Correction |
|---|---|
| « Œ » majuscule perdu à la normalisation : « Autres œdème… » battait « Œdème… » | minuscules avant le pliage œ→oe (TS) ; pliage « oe »/« œ » côté SQL (migration `20261001120000`) |
| « Autres X » et « X, sans précision » à égalité avec X | même concept pour l'écart et les propositions ; ordre principal < « sans précision » < « Autres » |
| « extradurale **non** traumatique » à 0,86 pour un hématome traumatique | négation soudée au mot (`nontraumatiqu` ≠ `traumatiqu`) |
| hématome/hémorragie, spontané/non traumatique, épidural/extradural, atriale/auriculaire | table courte de synonymes, aussi appliquée aux termes de recherche |
| latéralité et précisions entre parenthèses pénalisaient le score | latéralité ignorée, parenthèses facultatives |
| repli lexical : « HSA traumatique » → intitulé générique | le qualificatif écrit reste dans le terme préféré ; abréviations courantes ajoutées |
| ambiguïté signalée mais terme général sans correspondance → « non codé » | les propositions par entité priment (constaté sur `holdout`, voir §3) |

Trois annotations se sont révélées fausses et ont été corrigées, chacune justifiée dans le jeu :

| Saisie | Annotation initiale | Correction |
|---|---|---|
| HED traumatique | aucune correspondance | « Hémorragie épidurale traumatique », NA07.5 |
| hernie discale lombaire | aucune correspondance | FA80.9 |
| céphalées | aucune correspondance | 8A8Z |

Ces corrections du score ont été tirées de `dev` et `test` : sur ces deux jeux, les résultats sont
donc optimistes. Seul `holdout` mesure sans biais.

## 3. Résultats

**Seuils retenus :**

| Seuil | Ancienne valeur (non calibrée) | Valeur calibrée |
|---|---|---|
| automatique | 0,90 | **0,95** |
| écart | 0,10 | **0,05** |
| suggestion | 0,70 | **0,65** |
| plausibilité | 0,45 | **0,55** |

1 197 combinaisons sur 1 674 respectent les deux contraintes de sécurité.

**Témoin de généralisation.** Choisis sur `dev` seul, les seuils auraient été : automatique
0,80, écart 0,10, suggestion 0,80, plausibilité 0,55. Sans erreur sur `dev`, ils produisent **une
erreur critique sur `test`** : « AVC » codé seul en « AVC ischémique » à 0,86, par le repli
lexical. Un seuil automatique bas ne se généralise pas, d'où le choix sur `dev` + `test` et la
marge de robustesse.

**Contrôle inédit (`holdout`, 20 cas)**, mesuré une seule fois avant le dernier correctif :

| Scénario | Critiques | Auto justes | Suggestion juste | Choix juste | Rien imposé (à raison) | Suggestion fausse | Manqué |
|---|---|---|---|---|---|---|---|
| LLM simulé | **0** | 11 | 1 | 2 | 3 | 2 | 1 |
| Repli lexical | **0** | 3 | 4 | 2 | 3 | 4 | 4 |

Le cas LLM manqué, h14 « Cancer du poumon », a révélé le bug d'ordre des tests pour les
ambiguïtés (§2). Une fois corrigé, ce cas devient « choix juste ». Ce chiffre a été mesuré **après**
consultation du jeu, il n'est donc plus inédit.

**Jeu complet (92 cas), seuils retenus :**

| Scénario | Critiques | Auto justes | Suggestions justes / fausses | Choix justes / sans le bon code | Manqués | Rien imposé (à raison) |
|---|---|---|---|---|---|---|
| LLM simulé | **0** | 62 | 4 / 3 | 13 / 1 | 1 | 8 |
| Repli lexical | **0** | 27 | 25 / 5 | 7 / 1 | 19 | 8 |

Erreurs résiduelles notables, aucune n'impose un code :

- **LLM simulé**, suggestions fausses venant d'une interprétation trop générale :
  - « Hématome sous-dural chronique » sans « spontané » → « HSD traumatique chronique » ;
  - « Insuffisance rénale chronique » → « Insuffisance rénale, sans précision » ;
  - « Hydrocéphalie obstructive » → la variante néonatale.

  Le prompt demande déjà des intitulés CIM-11 ; ces cas resteront à vérifier sur le vrai modèle.
- **Repli lexical** : 19 cas manqués. Sans LLM, les formulations cliniques (« rocher », « C1 »,
  « thrombophlébite ») ne rejoignent pas les intitulés. Le repli conserve le texte, ce qui est son
  rôle, mais ne remplace pas l'interprétation.

## 4. Limites

- **Interprétations simulées.** Les chiffres « LLM » mesurent le score et les seuils, pas le
  modèle. À refaire avec le vrai modèle (`ANTHROPIC_API_KEY`) en enregistrant ses sorties dans le
  jeu, sans les retoucher.
- **Petit jeu, un seul annotateur.** Ce sont 92 cas fictifs, surtout neurochirurgicaux, sans
  double annotation. Les seuils sont un point de départ prudent, pas une validation clinique.
- **Référentiel versionné uniquement.** Une autre publication (URI, libellés différents) demande
  de refaire le calibrage.
- **Refaire le calibrage :**
  `TERMINOLOGY_CALIBRATION_REPORT=<chemin.json> npx vitest run --project db test/terminology-calibration.test.ts`.
  Sans la variable, le test vérifie seulement l'absence d'erreur critique et les planchers
  d'utilité.
