# L56 — socle enregistrable et suivi des diagnostics non couverts

Implémentation locale du contrat de [la collecte diagnostique, §4](spec-collecte-diagnostique.md#4-l56--enregistrement-du-socle-et-suivi-des-cas-non-couverts).
Le lot s'appuie sur [L55](l55-configuration-diagnostique.md) — configuration et couverture
versionnées — et sur la visibilité au niveau bloc L52. Il n'ajoute ni table, ni statut clinique,
ni droit : le mode de collecte reste préparé par le responsable, jamais créé à la volée par l'agent.

## Enregistrement : ce que le lot n'a pas eu à changer

Un socle valide accompagné d'un diagnostic **non couvert** s'enregistrait déjà, et c'est le point
important : la condition du bloc associé est fausse, le bloc est donc masqué, et
`missing_required_fields` n'a jamais réclamé une variable masquée (L32, étendu aux blocs par L52).
Un diagnostic non couvert n'invente donc aucune variable requise — sans qu'aucune autorisation de
mission n'ait à être élargie, ce que le §4.1 demandait explicitement de ne pas faire.

Les conséquences suivantes sont vérifiées côté base plutôt que supposées :

- un compte de mission enregistre un socle complet avec un diagnostic non couvert, en `draft`
  comme en `complete` ; il n'y gagne ni identité, ni curation, ni correction après soumission ;
- un **cas mixte** reste tenu par le bloc qu'il déclenche : `{A, C}` où seul `A` porte un bloc
  exige toujours les variables de ce bloc ; l'absence de bloc pour `C` ne dispense de rien ;
- le socle lui-même reste exigé : le mode ne rend aucune variable commune facultative ;
- une proposition hors liste s'enregistre dans le champ compagnon existant, jamais comme un code ;
- un client qui n'annonce pas le contrat L55 est refusé à la soumission (garde L55), jamais toléré ;
- le retrait d'un diagnostic qui masque un bloc déjà rempli reste refusé tant que les valeurs de ce
  bloc partent avec lui — annuler conserve tout, confirmer retire les deux ensemble, et un jeton de
  version périmé échoue en `CONFLIT_VERSION` sans rien écraser.

À l'écran, la seule nouveauté est une **information non bloquante** : `DiagnosisCoverageNotice`
annonce les codes sans bloc dans cette version, et une proposition non encore rattachée. Elle
n'affiche que des **codes** — jamais un libellé de bloc, jamais le texte d'une proposition —, ne
conditionne aucune validation, n'est jamais enregistrée, et disparaît quand le responsable a déclaré
que le socle suffit (`common_only` est une décision, pas un manque). Le calcul est celui de L55,
appliqué à la version du dossier ; une configuration absente ou irrésoluble ne produit rien du tout.

Surfaces touchées : `NewPatient`, `EncounterForm`, `EditPatient`, `EditEncounter` et la fiche
patient (données permanentes et chaque rencontre, chacune dans **sa** version). La recherche de
diagnostics n'est jamais filtrée sur les seules associations. Le contexte hors-ligne transportait
déjà le contrat depuis L55 : l'information s'y affiche à l'identique, sans lever O6/O7 ni ouvrir la
moindre capacité nouvelle.

## Suivi : `diagnosis_followup`

RPC paginée, `SECURITY INVOKER`, filtrable par base, portée, version et code.

```sql
select public.diagnosis_followup(p_base_id, p_scope, p_version_id, p_code, p_limit, p_offset);
```

Elle retourne les dossiers dont la couverture — **calculée dans la version du dossier** — contient
au moins un `uncovered` ou un `unclassified`, avec `total`, `byCode` (un code, un compte) et
`unclassifiedRecords`. Un item porte la portée, les identifiants techniques, le code patient, le
statut de validation, la version source et les codes non couverts. Il ne porte **ni identité, ni
document, ni texte libre**, agrégats compris : une proposition est comptée, jamais citée, et reste
consultable dans son parcours autorisé existant.

**L'accès est vérifié dans la RPC**, pas seulement par la RLS : `owner_user_id = auth.uid()` sur une
base non supprimée, **et** `is_medecin()`. Un collaborateur disposant de toutes les permissions
d'édition, un compte de mission — actif, expiré ou révoqué —, un administrateur système et un
médecin d'une autre base sont refusés, y compris en appelant PostgreSQL en direct. Le saisisseur
continue de voir le résultat du cas qu'il est autorisé à saisir, dans son formulaire ; il ne reçoit
aucune file de patients supplémentaire. Les lignes et bases supprimées sont exclues.

La file **distingue la version source de la version courante**. Publier un bloc ne retire aucun
dossier historique de la file et n'annonce pas qu'il serait désormais complétable :
`codesCoveredInCurrentVersion` signale seulement qu'un bloc existe maintenant, et l'écran le dit
sous cette forme — « aucune reprise automatique ». La reprise appartient à L57 ; L56 n'envoie
aucune notification et n'écrit rien.

L'écran `DiagnosisFollowup` (`/bases/:id/diagnostics`, onglet « À compléter ») reprend le rendu et
la pagination de `BaseProposals`. Son filtre de route et son garde-fou d'affichage ne sont qu'un
confort : la base refuse de toute façon la lecture à qui n'est pas le médecin propriétaire.

## Une extraction pour ne pas payer le référentiel par dossier

L55 signalait une conséquence de charge : `get_diagnosis_context` transporte `recognizedCodes`,
c'est-à-dire la **publication terminologique entière** pour un pilote terminologique. Résoudre ce
contexte par dossier aurait multiplié ce volume par le nombre de fiches de la base.

Le corps de `diagnosis_coverage` est donc extrait, **sans changement de sémantique**, dans
`diagnosis_coverage_in_context(version, scope, data, context)` ; `diagnosis_coverage` devient l'appel
qui résout le contexte lui-même. La file résout un contexte par **version présente**, jamais par
dossier, et une version sans configuration n'entre pas dans le calcul. Il n'existe toujours qu'une
seule implémentation du calcul, donc aucune dérive possible entre la file, le formulaire et le
serveur. La fonction extraite est `SECURITY INVOKER` : un contexte forgé ne rend qu'un résultat faux
à son auteur, et les lectures restent celles de l'appelant.

Cela ne dispense pas de la mesure demandée par L55 avant d'activer un pilote terminologique sur un
référentiel réel : la file paie le contexte une fois par version, mais le paie toujours.

## Migration et vérification

`20260906143000_diagnosis_followup.sql` est additive : elle ajoute `diagnosis_coverage_in_context`
et `diagnosis_followup`, redéfinit `diagnosis_coverage` en délégation, et ne touche à aucune donnée.
Aucune fonction `SECURITY DEFINER` n'est ajoutée — l'inventaire
`supabase/security-definer-allowlist.json` est inchangé.

`test/diagnosis-followup.test.ts` couvre les scénarios §4.3 avec des données fictives : diagnostic
couvert, non couvert, socle suffisant, proposition hors liste, cas mixte, plusieurs blocs pour un
même code, retour du même patient avec un autre diagnostic, transversal, mission expirée et
révoquée, collaborateur, administrateur système, médecin d'une autre base, retrait de diagnostic
avec annulation / confirmation / conflit, dossier historique, base sans configuration, filtres,
pagination et exclusion des lignes et bases supprimées. Il vérifie aussi qu'aucune valeur clinique
ni aucun texte de proposition n'apparaît dans la réponse. Un garde-fou de conception a été mis à
jour sciemment : `test/template-formula.test.ts` nomme désormais `diagnosis_coverage_in_context`
là où il nommait `diagnosis_coverage`, la lecture de la colonne `formula` ayant suivi le corps
extrait.

Côté web, `DiagnosisCoverageNotice.test.tsx` et `DiagnosisFollowup.test.tsx` couvrent le silence
quand tout est couvert, l'annonce des codes sans bloc, la proposition signalée sans être citée, la
configuration absente, les filtres transmis à la RPC et le refus d'afficher la file à un non
propriétaire. `supabase/functions/generate-export/handler_test.ts` porte le scénario d'export L53 :
une rencontre au diagnostic non couvert reste exportée avec le socle, et la complétude n'est pas
contournée pour autant.

### Contrôles réellement exécutés les 2026-09-06 et 2026-09-07, en local

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npm run test:web` | ✅ 71 fichiers, 583 tests, dont `DiagnosisCoverageNotice` (5) et `DiagnosisFollowup` (3) — voir la note de saturation ci-dessous |
| `test/diagnosis-followup.test.ts` | ✅ 10 tests |
| `test/template-formula.test.ts` · `diagnosis-configuration` · `security-definer-acl` | ✅ 3 fichiers, 52 tests |
| `npm run test:rls` (suite DB complète) | ⚠️ **non rejouée intégralement** — voir « limites » |
| `npm run edge:test` | ✅ 212 tests, dont le scénario d'export L56/L53 |
| `npm run db:verify` | ✅ 141 migrations appliquées depuis zéro (45 tables, 299 fonctions, 63 policies, 79 triggers) |
| `npm run schema` · `npm run schema:check` | ✅ snapshot régénéré jusqu'à `20260906143000_diagnosis_followup.sql` |
| `VITE_USE_SIGNED_READ=true npm run build` | ✅ 1 min 15 s ; sans cette variable, le build **refuse** volontairement (garde de `vite.config.ts`) |
| Scénario navigateur | ❌ **non exécuté** — voir « limites » |

### Limites réelles de cette campagne

- **Le scénario navigateur du parcours complet n'a pas été exécuté.** Il exige un serveur portant la
  migration : Docker est absent de cette machine, donc `supabase start` est indisponible, et les
  fichiers `.env` locaux pointent vers le projet cloud, qui n'a reçu ni L55 ni L56 et qu'aucun
  changement de ce lot n'est autorisé à toucher. Le §4.3 n'est donc **pas** entièrement satisfait :
  il le sera après déploiement sur un environnement d'essai, avec des données fictives.
- La suite DB complète (`npm run test:rls`) n'a pas été rejouée intégralement. Les
  fichiers qui partagent la surface modifiée l'ont été : `diagnosis-followup`,
  `diagnosis-configuration`, `template-formula` et `security-definer-acl`. Rappel de L55, toujours
  valable : sur cette machine, un `out of memory`, un `ECONNRESET` ou un « Failed to start forks
  worker » vient des PostgreSQL embarqués laissés par le harnais — nettoyer les processus orphelins
  puis rejouer le fichier avant de conclure à une régression.
- **La même saturation touche la suite web.** Sur une passe complète, `Dashboard.test.tsx` est tombé
  sur un dépassement de `waitFor`, pas sur une assertion de fond : rejoué seul, il repasse 9/9. La
  ligne `test:web` ci-dessus additionne donc la passe complète et cette relance ciblée. Même
  consigne qu'au-dessus : ne pas conclure à une régression sur un délai dépassé sans avoir rejoué le
  fichier isolément.
- La mesure de charge demandée par L55 avant d'activer un pilote **terminologique** sur un
  référentiel réel reste à faire. Elle n'est pas levée par ce lot : la file paie le contexte une
  fois par version, mais elle le paie toujours.

**Ce document ne constitue une preuve ni de validation serveur distante, ni de déploiement.** Aucun
commit, aucune poussée, aucune migration distante et aucun changement cloud n'a été effectué.
