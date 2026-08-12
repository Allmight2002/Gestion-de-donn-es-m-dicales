# Dérogations de readiness actives

Ce document liste les contrôles de production **volontairement suspendus**, ce
qu'ils ne prouvent plus, et à quelle condition les rétablir. Il existe pour
qu'aucune dérogation ne se dissolve dans le temps : une dérogation oubliée est
pire qu'un contrôle absent, parce qu'elle donne l'illusion d'un contrôle.

Trois dérogations sont actives au 2026-08-12. Elles ne sont **pas de même
nature**, et cette distinction est le point important de ce document.

Le contexte qui autorise temporairement ces dérogations est consigné dans la
[`décision d'utilisation de l'environnement production pour les tests`](decision-environnement-production-tests-2026-07-29.md).
Le nom technique `production` ne vaut pas readiness clinique : l'environnement
reste réservé au développement interne et aux données entièrement fictives.

## 1. Contrôles GitHub en mode mono-personne

**Variable** : `CONTROLS_SOLO_MODE=true` · détail dans
[`controles-github.md`](controles-github.md).

**Nature : impossibilité.** Trois exigences supposent une seconde personne, et
GitHub interdit d'approuver sa propre pull request. Sur un dépôt à une personne,
les activer n'aurait rien renforcé — elles auraient rendu toute fusion
impossible. La dérogation ne renonce à aucune protection réalisable.

Le gate B7 est désormais **fermé pour la barrière technique** : les branches,
checks, règles administrateur, interdictions de force-push/suppression,
résolution des conversations et bornage des environnements sont vérifiés en
live. Cette section reste active uniquement pour la revue par un tiers et
l'auto-approbation d'environnement, suspendues tant que le dépôt reste
mono-personne.

## 2. Preuves de readiness en mode pilote

**Variable** : `PILOT_EVIDENCE_WAIVER=true`.

**Nature : travail non fait.** Contrairement à la précédente, **rien n'empêchait
techniquement** de produire ces preuves. Elles sont suspendues parce qu'elles
n'ont pas encore été constituées, pas parce qu'elles étaient hors d'atteinte.
C'est une dette assumée, pas une adaptation à une contrainte de plate-forme.

### Ce qui n'est plus prouvé

| Preuve | Ce que la production ne démontre plus |
|---|---|
| Gouvernance | Aucune décision de gouvernance signée, aucune validation par un tiers pour le SHA déployé. |
| Reprise | La capacité à **remonter la production après sinistre** n'est pas démontrée pour ce SHA. |
| Exploitation | Aucune personne nommée n'est désignée pour surveiller la production, et aucune relecture clinique n'atteste que les données saisies ont un sens. |

La deuxième est la plus coûteuse — et la plus facile à lever, puisque le pipeline
sait déjà exécuter un exercice de restauration.

### La dérogation ne s'applique qu'à l'absence

Chaque garde-fou teste d'abord si la preuve existe :

- **preuve fournie** → elle est vérifiée intégralement, exactement comme avant,
  y compris la correspondance au SHA exact. La dérogation ne l'affaiblit pas ;
- **preuve absente et dérogation active** → la release continue, après avoir
  écrit dans le journal ce qui n'est pas prouvé ;
- **preuve absente et dérogation inactive** → la release échoue, comme avant.

Conséquence utile : produire **une seule** des trois preuves la remet
immédiatement sous contrôle, sans rien reconfigurer. La dette se rembourse par
tiers.

### Ce qui reste bloquant, et le restera

La dérogation ne touche **pas** :

- la **sauvegarde chiffrée, vérifiée et conservée** avant toute écriture en
  production (`STORAGE_BACKUP_ENCRYPTION_KEY`) — c'est le filet qui rend une
  erreur réparable, il n'a rien d'une formalité ;
- la preuve de staging réussi **pour le même SHA** ;
- la vérification de la cible, la dérive de schéma, les ACL de fonctions et
  l'inventaire des Edge Functions.

### Condition de levée

Retirer la variable `PILOT_EVIDENCE_WAIVER`. Le contrôle complet reprend sans
autre modification.

**À déclarer telle quelle dans le dossier ANSICE.** Cette dérogation est
acceptable pour une production ne contenant que des **données fictives**, sans
utilisateur tiers. Elle ne l'est plus dès la première donnée réelle, dès le
premier patient, et dès le premier utilisateur qui n'est pas le porteur.

## 3. Inspection antivirus suspendue

**Variable** : `INSPECTION_MODE=paused` (input `inspection` du workflow de
release, valeur par défaut) · décision détaillée dans
[`decision-pause-inspection-2026-08-12.md`](decision-pause-inspection-2026-08-12.md).

**Nature : dette assumée, motivée par le coût d'exploitation.** Rien n'empêche
techniquement d'héberger ClamAV. Ce qui a été jugé insoutenable, c'est la
procédure : un conteneur Docker et un tunnel `trycloudflare` éphémère à relancer,
avec une nouvelle URL à reporter dans les secrets, **à chaque release** — pour un
environnement qui ne contient que des données fictives.

### Ce qui n'est plus prouvé

| Preuve | Ce que la release ne démontre plus |
|---|---|
| Détection virale | Un fichier infecté déposé est conservé et relu tel quel. |
| Quarantaine physique | Le déplacement inter-buckets et le pointeur forensique ne sont pas exercés. |
| Préflight E2E | Les familles EICAR et la reprise `accepted_client` sont déclarées `NON EXECUTE` — jamais comptées comme vertes. |

### Ce que la dérogation ne touche pas

La lecture auditée (`VITE_USE_SIGNED_READ=true`, fonction `signed-read`), le
contrôle magic-bytes, les limites de taille des buckets, la policy qui refuse un
objet sans ticket, la sauvegarde chiffrée vérifiée et les gardes de cible restent
**intégralement** en vigueur.

### La suspension est déclarée, jamais déduite

`INSPECTION_MODE` non renseignée vaut `strict` : une variable oubliée ne peut pas
désactiver l'antivirus. Les trois drapeaux (frontend, Edge, base) doivent valoir
`false` **ensemble** et explicitement, sans quoi la release échoue — un frontend
permissif devant une base stricte bloquerait les documents en `pending`, l'inverse
ouvrirait une lecture sans verdict. Chaque exécution écrit la dérogation dans son
journal.

### Condition de levée

Lancer la release avec `inspection: strict`. Le scanner est reprouvé (`/health`,
fichier sain, EICAR) avant que la base ne repasse en strict, et le préflight rejoue
ses six familles. Aucune autre modification n'est requise.

**À déclarer telle quelle dans le dossier ANSICE**, et à lever avant toute donnée
réelle.
