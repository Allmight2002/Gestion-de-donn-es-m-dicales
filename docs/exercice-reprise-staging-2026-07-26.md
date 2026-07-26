# Exercice de sauvegarde, restauration et reprise staging — 26 juillet 2026

## Verdict actuel

L'exercice technique sur cible locale éphémère et isolée est **réussi** pour le
SHA `ebee17910f6de005ab933ee08978d2e97686d19d` avec uniquement les fixtures du
staging. Ce SHA est le merge de la PR #51 dans `develop` et le candidat commun
de l'interphase B3 → B4 → B8 → B1 → B9. La base, Auth, les métadonnées Storage
et les octets ont été restaurés, puis les accès autorisés et interdits ont été
exercés.

Cet exercice est le rejeu, sur le SHA de merge définitif, de l'exercice décrit
dans `docs/exercice-reprise-staging-2026-07-23.md`, qui portait sur le SHA
préfinal `6f0c87daee6d15938f8cc0dd2f62203e21dcc15d`. La réserve « la preuve
finale doit porter sur le SHA de merge définitif » est donc levée pour le
staging fictif.

Ce que cette preuve ne fait pas :

- elle ne ferme B3, B4 et B8 que pour le staging fictif, pas pour la production ;
- elle ne couvre aucun parcours de fichier : B2 reste ouvert et l'inspection
  demeure fail-closed ;
- elle ne vaut pas installation du secret `RECOVERY_EVIDENCE_JSON` dans
  l'environnement GitHub `production`, qui exige une autorisation production
  distincte.

## Source et copie immuable

| Élément | Preuve |
|---|---|
| Sauvegarde GitHub | run `30196157372`, workflow continuité réussi |
| Contenu sauvegardé | 4 exports DB, 117 objets Storage, 16 969 octets |
| HMAC et extraction | vérifiés |
| Manifeste Storage | `sha256:5165598301022387588fe380d205b0f02509c48abb2bc00c87fea3893c157dbd` |
| Artefact Actions | `continuity-backup-staging-30196157372`, rétention jusqu'au 25 août 2026 |
| Copie hors Supabase | release privée `continuity-staging-30196157372-1`, ciblant `ebee179` |
| Archive immuable | `sha256:168c2359efff8af901b9359c8cd077d10c8f13144f56584cffa2c5aa3d398cd3` |

La clé de déchiffrement a été rouverte depuis l'enveloppe Windows DPAPI séparée
décrite dans `docs/continuite.md`, sans que sa valeur soit affichée, inscrite
dans le dépôt ou envoyée dans un log.

## Isolation

- source : projet `meddata-staging`, données contrôlées comme fixtures ;
- cible : projet local isolé `meddata-recovery-30196157372` ;
- aucune connexion de la cible à la production ;
- après l'exercice : conteneurs arrêtés, volumes isolés conservés, et dumps en
  clair envoyés dans la Corbeille Windows, donc encore récupérables tant qu'elle
  n'est pas vidée.

## Restauration et intégrité

| Contrôle | Résultat |
|---|---|
| Comptes Auth restaurés | 5 |
| Tables publiques | 36 |
| Tables publiques sans RLS | 0 |
| Buckets restaurés | 4 |
| Objets restaurés | 117/117 |
| Clés étrangères contrôlées | 111 |
| Orphelins référentiels | 0 |
| Divergences sur les 35 tables de données publiques | 0 |
| Divergences de hash Storage | 0 |
| Authentification de comptes fictifs restaurés | 2 comptes, PASS |
| Lecture de la base par son propriétaire | PASS |
| Lecture de la même base par un autre compte | refus RLS |

## Reprise et rollback

| Scénario | Résultat |
|---|---|
| Rollback de la migration `20260714215335` | PASS |
| Forward recovery par `supabase db push` | PASS |
| Réapplication de `supabase/storage.sql` | PASS |
| État final après rollback puis forward | identique à l'état initial |
| Frontend courant → précédent `b5a0369` → courant | HTTP 200/200/200 |
| Six Edge Functions, SHA courant | 70/70 tests |
| Six Edge Functions, SHA précédent | 70/70 tests |

Comme lors de l'exercice précédent, cette couverture Edge ne prétend pas qu'un
scanner ClamAV distant permanent a été déployé.

## Temps observés et objectifs

- RPO observé pour cet exercice : **77 secondes** ;
- RTO observé : **1 587 secondes** ;
- RPO approuvé pour la politique actuelle : **86 400 secondes (24 h)** ;
- RTO approuvé : **14 400 secondes (4 h)**.

Les deux valeurs observées restent sous les objectifs approuvés le 25 juillet
2026 dans `docs/decision-rpo-rto-staging-2026-07-25.md`. Le RTO est trois fois
supérieur à celui du 23 juillet ; il demeure très en dessous de la cible de 4 h,
mais il montre que la marge dépend de la taille de la sauvegarde et de la
machine utilisée, et non d'une capacité managée.

## Preuve publiée

La preuve JSON a été validée puis publiée dans la release immuable
`recovery-evidence-staging-ebee17910f6d`. Son empreinte est
`sha256:4ab7a20d858d36465ed4588fe798a2ca3770b826d911f891d8f903dc1c0ce228`.

Le contrôle appliqué est celui décrit dans `docs/continuite.md` :

```text
npm run recovery:evidence:verify -- --file=<preuve.json> --commit=<SHA40>
```

La preuve ne contient ni donnée patient, ni nom d'objet, ni secret : uniquement
des compteurs, empreintes, dates, résultats booléens et références de décisions
externes.

## Provenance de ce compte rendu

Les résultats ci-dessus sont ceux consignés dans
`docs/suivi-execution-feuille-route.md` pour le lot P0R et attachés aux releases
immuables citées. Les éléments que l'exercice du 23 juillet documentait et qui
n'ont pas été consignés pour ce rejeu — versions exactes des services de la
cible, fenêtre horodatée de la sauvegarde, empreinte synthétique de la cible —
ne sont volontairement pas reproduits ici plutôt que d'être reconstitués.
