# Codage terminologique assisté (CIM-11)

> 🟢 Document vivant. Décrit l'état du code au 1er octobre 2026 : migration
> `20261001090000_terminology_assisted_coding.sql` (+ `20261001120000`, `20261001140000`),
> Edge Function `code-terminology`, champ
> `TerminologyInput`. Seuils calibrés le 1er octobre 2026 (§4). Rien n'est déployé ; la preuve
> navigateur et la mesure avec le vrai modèle restent à produire (§8).

**L'utilisateur écrit comme un médecin. MedData structure comme une base de données.**

Le champ de diagnostic accepte indifféremment une recherche (« méning… ») et un diagnostic
écrit en langage clinique (« HSD chronique spontané droit »). Dans le second cas, MedData
conserve le texte, l'interprète, le rapproche du référentiel CIM-11 actif et enregistre le
concept retenu — sans bouton « Analyser », sans que l'utilisateur voie le LLM ni les requêtes.

## 1. Principe : le LLM comprend, la CIM-11 fait foi

```
Texte clinique ──► interprétation (LLM, sinon repli lexical)
                     │  termes normalisés, jamais de code
                     ▼
               candidats du référentiel actif (RPC match_terminology_candidates)
                     │
                     ▼
               score déterministe + décision ──► valeur stockée {code, label, raw, coding}
                                                   (code revérifié par la base)
```

- Le LLM ne produit **aucun code**. Il développe les abréviations, distingue plusieurs
  diagnostics dans une même saisie et reformule chacun en termes proches des intitulés CIM-11
  (« Hémorragie sousdurale non traumatique » pour un HSD spontané).
- Les concepts viennent **uniquement** du référentiel importé (`terminology_concept`).
- La base revérifie chaque couple code/libellé à l'enregistrement, comme avant : un code inventé
  est refusé quelle que soit sa provenance.

## 2. Expérience utilisateur

| Moment | Comportement |
|---|---|
| Frappe courte | Recherche classique inchangée (copie locale ou serveur), choix dans la liste. |
| Pause de frappe sur plusieurs mots | Le codage est **préparé** en arrière-plan, rien n'est enregistré. |
| Départ du champ ou Entrée sans choix | Le texte est **enregistré immédiatement, non codé**, puis remplacé par le résultat du codage s'il est toujours là. Entrée ne soumet jamais le formulaire. |
| Clic sur une proposition de la liste | Choix classique ; le texte tapé n'est pas codé. |

Résultats affichés discrètement dans l'étiquette du diagnostic :

| Décision serveur | Affichage | Valeur stockée |
|---|---|---|
| `automatic` | `✓ Hémorragie sousdurale non traumatique` + code en gris | code, statut `automatic` |
| `suggested` | libellé « à confirmer » + bouton **Confirmer** | code, statut `suggested` → `confirmed` |
| `ambiguous` | « Plusieurs correspondances possibles : ○ … ○ … » | **aucun code** tant que l'utilisateur n'a pas choisi ; le choix donne `confirmed` |
| `unmatched` | « Aucune correspondance CIM-11 fiable trouvée. » | texte seul, statut `unmatched` |

Une saisie issue du codage reste affichée tant qu'aucun remplacement n'est choisi : « Changer »
(ou ✎ en liste) ouvre la recherche pré-remplie avec le texte d'origine, et un choix manuel donne
le statut `manually_modified` en conservant ce texte. Hors connexion, ou si le service est en
panne, le texte est conservé non codé et l'écran le dit ; **le codage n'empêche jamais
d'enregistrer**. En liste (L21), chaque diagnostic reconnu devient une entrée numérotée ; un code
déjà présent n'est pas doublé. En champ unitaire, plusieurs diagnostics reconnus sont proposés au
choix plutôt que tronqués.

**Réouverture d'une fiche.** Les propositions au choix ne sont pas stockées. Pour une entrée non
codée issue du codage assisté (méthode `ai_assisted`, terme normalisé présent), le texte conservé
est analysé à nouveau, une fois, et les propositions sont réaffichées. La valeur enregistrée
n'est **jamais** modifiée à cette occasion : seul un choix du médecin l'écrit. Une saisie conservée
hors connexion ou pendant une panne (méthode `lexical`) n'est pas réanalysée en silence.

Les critères de cohorte (`CohortBuilder`) utilisent le même composant avec `freeText={false}` :
un critère ne peut être qu'un concept du référentiel.

## 3. Données stockées

La valeur d'un champ `terminology` reste le couple historique, avec deux clés **facultatives** :

```json
{
  "code": "8B02",
  "label": "Hémorragie sousdurale non traumatique",
  "raw": "HSD chronique spontané droit",
  "coding": {
    "method": "ai_assisted",
    "status": "automatic",
    "normalized": "Hématome sous-dural chronique spontané droit",
    "release": "2026-01",
    "uri": "http://id.who.int/icd/release/11/mms/…",
    "language": "fr",
    "score": 0.95
  }
}
```

Diagnostic non codé : `{"raw": "…", "coding": {"method": "…", "status": "unmatched", …}}`, sans
`code` ni `label`.

| Clé | Règle serveur (`terminology_entry_problem`) |
|---|---|
| `raw` | texte non vide, 500 caractères au plus ; **jamais remplacé** |
| `coding.method` | `ai_assisted` (LLM) ou `lexical` (repli, ou texte conservé sans analyse) |
| `coding.status` | `automatic`, `suggested`, `confirmed`, `manually_modified` avec code ; `unmatched` **sans** code |
| `coding.normalized` | 300 caractères au plus |
| `coding.release` | version de la publication terminologique utilisée, 64 caractères au plus |
| `coding.uri` | URI http(s) ; doit être **celle du concept** quand elle est déclarée |
| `coding.language` | code de langue (`fr`) |
| `coding.score` | nombre entre 0 et 1 |

Toute autre clé est refusée. Les messages d'erreur ne recopient jamais la valeur. Les valeurs
`{code, label}` existantes restent valides sans migration de données. La provenance est
**déclarative** : la base garantit sa forme et sa cohérence avec le concept, pas qu'elle a bien
été produite par le serveur de codage.

Effets sur les autres surfaces :

- **Règles `contains_any` et couverture diagnostique** : une entrée non codée est ignorée (ni
  déclencheur ni invalidation du reste de la liste). Parité SQL/TS couverte par
  `test/fixtures/containsAny.ts`.
- **Export** : le libellé (ou le texte d'origine pour une entrée non codée) part dans la colonne
  principale ; la colonne de code et les indicatrices `has__…` ne contiennent que les codes ; la
  feuille longue garde le rang de saisie avec un code vide pour le texte non codé.
- **Provenance exportée en colonnes**, dans les deux profils (`analysis` et `complete`), dès
  qu'au moins une fiche exportée en porte. Sinon, la structure de l'export reste celle d'avant.
  - **Champ unitaire** : sept colonnes suivent la colonne de code. Le motif est
    `terminology_<élément>__<portée>__<variable>`, et les éléments sont `text` (texte saisi),
    `status`, `method`, `score`, `normalized`, `release` et `uri`.
  - **Liste** (L21) : la feuille dédiée gagne les mêmes colonnes `text` … `uri`, entrée par
    entrée et dans l'ordre de saisie ; la feuille principale n'en porte pas.
  - **Valeur sans provenance** (choix direct, valeur antérieure) : les cases restent vides,
    rien n'est inventé.
  - **Dictionnaire** : il documente chaque colonne, avec les valeurs admises de `status` et de
    `method`.
  - **Neutralisation** : le texte saisi passe par la même neutralisation que le reste
    (formules CSV/XLSX).
- **Fusion de conflit hors ligne** (`mergeKeepBoth`) : une liste contenant un texte non codé n'est
  pas unie ; « garder les deux » conserve alors la version locale, sans perte.

## 4. Confiance

Le score ne vient **pas** du LLM. Il est calculé dans
`supabase/functions/code-terminology/scoring.ts`, pour chaque candidat : c'est une similarité
F1 entre les racines des mots du terme et celles du libellé. Ce calcul neutralise :
- les accents, les tirets, les pluriels et les féminins ;
- la latéralité ;
- les précisions entre parenthèses du libellé et les clauses « sans mention de … ».

Il traite aussi :
- **la négation**, soudée au mot qu'elle porte (« non traumatique » ≠ « traumatique ») ;
- **une courte table de synonymes** :
  - hématome/hémorragie, spontané/non traumatique, épidural/extradural, atriale/auriculaire ;
  - VIH/HIV ↔ « virus de l'immunodéficience humaine » ;
  - atlas/C1 et axis/C2 ↔ 1re et 2e vertèbres cervicales ;
- **les sigles de trois lettres** (VIH, AVC…) : ils comptent dans la recherche de candidats
  (migration `20261001140000`), hors mots-outils ;
- **les catégories résiduelles** : « X », « X, sans précision » et « Autres X » forment un même
  concept pour l'écart et les propositions, classés principal < « sans précision » < « Autres ».

Décision, avec les seuils **calibrés le 1er octobre 2026** (`THRESHOLDS`) :

| Décision | Condition |
|---|---|
| `ambiguous` | l'interprétation signale plusieurs entités : une proposition par entité ≥ 0,55, sinon les candidats plausibles |
| `unmatched` | aucun candidat ≥ 0,55 |
| `ambiguous` | ex æquo : écart < 0,025 entre deux concepts distincts au-dessus de 0,65 |
| `automatic` | similarité ≥ 0,95, écart ≥ 0,05 avec le deuxième concept, accord avec le terme préféré seul, **et libellé couvert par le texte du médecin** |
| `suggested` | similarité ≥ 0,65, ou un seul candidat plausible |
| `ambiguous` | sinon |

**Couverture : aucun code automatique n'ajoute d'information.** Chaque mot porteur de l'intitulé
retenu doit se retrouver soit dans le texte du médecin, soit dans le terme développé (abréviations
et synonymes compris). Sinon, la proposition reste « à confirmer ». Exemple : un LLM qui déduit le
pneumocoque d'une « pneumonie franche lobaire aiguë » propose « Pneumonie due à *Streptococcus
pneumoniae* », sans la poser seul.

Sont tolérés :
- les mots qui situent sans préciser (cerveau, cérébral, intracrânien, artère, processus,
  lobe…) ;
- un intitulé disjonctif (« … du fœtus ou du nouveau-né ») dont un côté est écrit.

Le texte du médecin est ajouté par l'Edge Function, jamais par le LLM. Le prompt interdit par
ailleurs au LLM d'ajouter un germe, un stade, une cause ou une évolution dans le terme développé.

Le calibrage a été fait sur 92 diagnostics fictifs annotés, dont 20 inédits, dans deux
scénarios : LLM simulé et repli lexical. Il n'a produit **aucune erreur critique** (code faux
posé seul), y compris pour des seuils un peu plus permissifs. Méthode, résultats et limites :
[calibration-codage-terminologique-2026-10-01.md](calibration-codage-terminologique-2026-10-01.md).
Le test `test/terminology-calibration.test.ts` garde ces résultats sur le référentiel versionné.
La règle de couverture a été mesurée ensuite sur 97 cas (addendum du rapport) : aucune erreur
critique, et quelques codes qui ajoutaient une information repassent « à confirmer ».

## 5. Confidentialité

- Seul le texte du diagnostic part vers le LLM : ni patient, ni base, ni fiche. Avant l'envoi,
  `scrubIdentifiers` retire adresses électroniques, numéros longs et dates complètes.
- La fonction n'écrit rien et n'utilise pas `service_role` : elle lit le référentiel sous
  l'identité de l'appelant (`getUser` + RLS).
- Aucun texte clinique ni erreur du fournisseur dans les journaux ; le client ne reçoit que des
  messages choisis (`CODING_UNAVAILABLE`).
- **Prérequis avant données réelles** : l'envoi d'un texte clinique à un fournisseur externe
  (Anthropic) doit être couvert par le cadre juridique et éthique (contrat de sous-traitance,
  localisation, conservation). Sans `ANTHROPIC_API_KEY`, la fonction n'appelle aucun service
  externe et répond par le seul repli lexical.

## 6. Configuration et déploiement

Secrets de l'Edge Function `code-terminology` :

| Secret | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | client sous l'identité de l'appelant |
| `ANTHROPIC_API_KEY` | facultatif ; active l'interprétation par Claude |
| `TERMINOLOGY_LLM_MODEL` | facultatif ; modèle utilisé (défaut `claude-opus-5-5`, effort `low`, délai 8 s) |

Le repli serveur sur refus (`fallbacks: "default"`) est activé ; un refus résiduel, une sortie
inexploitable ou un délai dépassé basculent sur le repli lexical. Pour que l'URI CIM-11 soit
renseignée, importer un export qui porte une colonne `Linearization URI` (ou `URI`) :
`scripts/import-terminology.mjs` la reprend ; l'export actuel `diagnostics-fr.tsv.gz` n'en a pas.

## 7. Architecture générique

Rien n'est propre aux diagnostics hors du vocabulaire du prompt : la chaîne « langage naturel →
extraction de concepts → rapprochement terminologique → concept structuré » s'appuie sur la
publication terminologique active et sur le type de champ `terminology`. Un futur fournisseur
(médicaments, actes, anatomie, LOINC) demandera une publication par terminologie, un prompt et
des termes adaptés au domaine, et le choix de la publication par champ — aujourd'hui une seule
publication est active à la fois (`terminology_release_single_active`).

## 8. Limites connues et suites

- Seuils calibrés avec des interprétations **simulées** : refaire le calibrage avec les sorties
  du vrai modèle, enregistrées telles quelles dans le jeu annoté, avant tout usage réel.
- Pas de post-coordination CIM-11 : la latéralité et le contexte restent dans `normalized`.
- Les entrées non codées ne remontent pas encore comme cas « non classés » dans le suivi
  diagnostique (L56).
- Preuve navigateur du parcours et appel réel du LLM non exécutés dans ce lot.
- Pas de limitation de débit propre à la fonction au-delà de celles de la plateforme.
