# Exception temporaire d'audit des dependances - staging

Date de decision : **26 juillet 2026**

Expiration automatique : **2 aout 2026 a 23:59:59, heure Africa/Douala**
(**22:59:59 UTC**)

Perimetre : **staging uniquement, donnees fictives uniquement**

## Decision

Le responsable continuite et release manager a autorise :

- les mises a jour transitives `brace-expansion` vers `5.0.8` et `ejs` vers `6.0.1` ;
- une exception CI temporaire limitee aux trois avis moderes ci-dessous ;
- aucune utilisation de cette exception pour autoriser une mise en production.

| Avis autorise | Paquet | Risque suivi |
|---|---|---|
| `GHSA-wrjc-x8rr-h8h6` | `react-router` | redirection ouverte par chemin avec antislash |
| `GHSA-337j-9hxr-rhxg` | `react-router` | injection lors de la deserialisation d'erreurs SSR |
| `GHSA-jjmj-jmhj-qwj2` | `react-router-dom` | redirection ouverte pouvant mener a une XSS |

Le validateur `scripts/validate-dependency-audit.mjs` echoue si :

- une vulnerabilite haute ou critique est presente ;
- un autre avis modere apparait ;
- le rapport npm est absent, mal forme ou incoherent ;
- l'horloge a depasse l'expiration ;
- le controle est execute en scope `production` avec un avis modere restant.

## Justification bornee

La version courante de MedData utilise React 18 et React Router 6.30.4. La mise a
jour corrigee disponible impose une migration majeure vers React Router 7, qui ne
doit pas etre introduite dans le lot de fermeture B3/B4/B8 sans validation
fonctionnelle dediee.

L'inspection du code au 26 juillet 2026 n'a trouve ni rendu SSR, ni hydratation
React Router, ni API de route statique. Les navigations applicatives proviennent
de routes internes, de constantes ou d'identifiants de ressources controles par
le modele de donnees. Ces constats reduisent l'exposition du candidat staging ;
ils ne suppriment pas les avis et ne valent pas correction.

## Barriere production

La CI generale execute le controle en scope `staging`, y compris lorsque le meme
SHA est synchronise sur `main`. Cette synchronisation de code ne deploie rien :
le deploiement Git automatique est desactive dans `vercel.json`.

Le job `production` de `.github/workflows/coordinated-release.yml` execute le meme
validateur en scope `production` avant les controles cloud et avant toute ecriture.
Tant que l'un des trois avis demeure, ce job echoue. La presente decision ne change
donc pas le statut global : **production readiness not demonstrated**.

## Sortie de l'exception

Avant le 2 aout 2026, il faut soit :

1. migrer vers une combinaison React / React Router corrigee et rejouer les tests
   de navigation, d'authentification et d'autorisation ;
2. prolonger explicitement l'exception par une nouvelle decision datee, apres
   reevaluation du risque.

Sans nouvelle decision, l'expiration est bloquante par code et la CI staging
repasse automatiquement au rouge si les avis sont encore publies.
