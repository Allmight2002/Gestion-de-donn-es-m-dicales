# Exception d'audit React Router — décision clôturée

- Date d'ouverture : **26 juillet 2026**
- Date de clôture technique : **26 juillet 2026**
- Statut : **exception retirée ; validation locale complète, CI du lot à produire**
- Périmètre historique : staging fictif uniquement

## Décision historique

Le responsable continuité et release manager avait autorisé jusqu'au 2 août
2026 :

- les mises à jour transitives `brace-expansion` vers `5.0.8` et `ejs` vers
  `6.0.1` ;
- une exception CI staging limitée à `GHSA-wrjc-x8rr-h8h6`,
  `GHSA-337j-9hxr-rhxg` et `GHSA-jjmj-jmhj-qwj2` ;
- aucune utilisation de cette exception pour la production.

Cette section reste conservée pour la traçabilité. Elle ne décrit plus la
politique active.

## Motif de la migration finale

React Router 7.18.1 élimine les trois avis initiaux. Le contrôle du registre au
moment de l'installation a toutefois révélé
[`GHSA-qwww-vcr4-c8h2`](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2),
publié le 22 juillet 2026 pour `react-router >=7.12.0 <8.3.0`. L'éditeur précise
que le défaut ne touche que les API RSC instables, que MedData n'utilise pas,
mais aucune version 7 ne permet alors un audit sans avis.

Le mandat interdit d'ajouter une exception temporaire pour rendre la CI verte.
Le lot migre donc vers la première combinaison corrigée publiée :

- `react-router` 8.3.0 ;
- `react` et `react-dom` 19.2.8 ;
- Node `>=22.22.0 <23` ;
- imports applicatifs depuis `react-router`, conformément à la suppression de
  `react-router-dom` en v8 ;
- Testing Library et types React compatibles React 19.

Le mode déclaratif client de MedData est conservé. Aucune API RSC, aucun SSR et
aucune hydratation React Router ne sont introduits.

## Politique active

`scripts/validate-dependency-audit.mjs` applique désormais la même politique en
staging et en production :

- aucune allowlist d'avis ;
- aucune date d'expiration ;
- refus de toute vulnérabilité modérée, haute ou critique ;
- échec fermé si `npm audit` est indisponible, mal formé ou incohérent ;
- conservation du seuil historique qui tolère les niveaux info et bas.

Après une installation propre sous Node 22.23.1, `npm audit --json` compte zéro
vulnérabilité et les deux scopes du validateur passent. Le commit final, les PR,
les runs CI et les SHA de promotion seront consignés dans
[`suivi-execution-feuille-route.md`](suivi-execution-feuille-route.md) après leur
réalisation.

Cette clôture ne change pas le statut de production : **production readiness
not demonstrated**. Elle retire seulement la dette de dépendance et l'ancienne
exception CI.
