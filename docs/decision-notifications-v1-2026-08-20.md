# Décision — périmètre v1 des notifications in-app (20 août 2026)

> **Preuve datée 🗄️.** Ce document consigne des décisions de conception prises le
> 2026-08-20. **Aucun changement de code n'a été effectué à la date de ce document** :
> c'est un registre de décisions, pas une description de l'état courant.

## Constat de départ

Le Journal d'activité par base (C3, livré le 2026-07-04 — voir
[idees-fonctionnalites-futures.md §C3](idees-fonctionnalites-futures.md)) donne déjà une vue
lisible sur `audit_log`, mais c'est un modèle **pull** : il faut ouvrir la base concernée pour le
voir. Les notifications (C5 dans le même document) restaient à l'état d'idée.

Le cas d'usage le plus net pour une notification **push** (un destinataire précis attend une
information précise, sans autre moyen actuel de le savoir) est déjà câblé au niveau des actions
existantes de la curation : `curation_clarification_requested` (le curateur assigné interroge le
médecin propriétaire, RPC `request_clarification`) et `curation_clarification_answered` (le
médecin répond, RPC `answer_clarification`) — voir
[`20260616091400_curation.sql`](../supabase/migrations/20260616091400_curation.sql).

## Ce qui est décidé

1. **Événements couverts en v1 : la clarification de curation, et rien d'autre.**
   `curation_clarification_requested` notifie le médecin propriétaire de la base ;
   `curation_clarification_answered` notifie le curateur assigné à la tâche. Aucun autre
   événement (accès accordé/révoqué, import terminé, invitation reçue, tâche libérée/reprise
   dans le pool) n'entre dans ce premier lot.
2. **Destinataires : médecin propriétaire et curateur assigné, les deux.** La clarification
   circule dans les deux sens ; restreindre au seul rôle `medecin` casserait la moitié du cas
   d'usage (le curateur ne serait jamais informé qu'on lui a répondu).
3. **Livraison : in-app uniquement.** Cloche + badge de compteur nouveau, visible à la prochaine
   visite de l'application ou au prochain rechargement. Pas de notification push navigateur pour
   ce lot (pas de service worker push, pas de clés VAPID, pas de flux de permission navigateur à
   gérer maintenant).
4. **Stockage : table dédiée `notification`**, une ligne par destinataire et par événement, avec
   un champ de date de lecture (`read_at`). Pas de dérivation dynamique depuis `audit_log` :
   `audit_log` est centré sur l'auteur d'une action, pas sur son destinataire, et ne porte aucune
   notion d'état lu/non-lu propre à chaque utilisateur.
5. **Clic sur une notification = navigation directe + marquage lu en un seul geste.** Le clic
   ouvre l'écran de la tâche de curation (ou du fil de clarification) concernée et marque la
   notification comme lue dans le même geste, sans étape intermédiaire.
6. **Rétention : les notifications non lues sont conservées indéfiniment ; les notifications lues
   sont purgées après un délai (proposé : 30 jours).** Une fois lue, une notification n'a plus
   d'utilité opérationnelle au-delà d'un délai raisonnable ; ce qui n'est pas encore traité ne
   s'efface jamais silencieusement.

## Pourquoi

- Restreindre à la seule clarification de curation évite de modéliser, tester et maintenir
  plusieurs types d'événements avant même d'avoir validé l'utilité du système de notification
  lui-même. C'est aussi le cas où l'absence de notification fait le plus mal aujourd'hui : un
  médecin qui n'ouvre pas la tâche concernée n'a **aucun** moyen de savoir qu'un curateur attend
  sa réponse, et le curateur assigné n'a aucun moyen de savoir que la réponse est arrivée sans
  revisiter la tâche manuellement.
- Le choix des deux rôles destinataires découle directement du sens de circulation de la
  clarification dans le code existant (`request_clarification` s'adresse implicitement au
  propriétaire, `answer_clarification` implicitement au curateur affecté) : ce n'est pas un choix
  de confidentialité comparable à la décision de visibilité prise pour la recherche patient (voir
  [decision-recherche-patient-2026-08-20.md](decision-recherche-patient-2026-08-20.md)), qui
  concernait l'accès à une donnée sensible, pas la circulation d'un événement métier.
- L'in-app seul suffit à couvrir le besoin exprimé (« ne plus dépendre de retomber dessus par
  hasard ») sans ouvrir un chantier d'infrastructure de push. Peut être reconsidéré plus tard si
  l'usage montre que les utilisateurs n'ouvrent pas l'app assez souvent pour que la cloche suffise.
- Une table dédiée est nécessaire dès qu'on veut un état lu/non-lu **par personne** : deux
  utilisateurs ayant accès à la même base ne doivent jamais partager le même état de lecture d'un
  événement qui les concerne chacun individuellement.

## Garantie héritée du domaine (pas une décision nouvelle)

Le contenu d'une clarification (question et réponse) reste, comme aujourd'hui, strictement
analytique : un curateur n'a jamais accès à l'identité d'un patient, donc rien dans le texte
d'une notification ne peut faire fuiter une donnée d'identité. Cette garantie existe déjà dans le
modèle de permissions du sous-système de curation et n'est pas modifiée par cette décision.

## Points ouverts

Aucun décidé à ce stade ; à trancher avant implémentation :

- Le délai de purge des notifications lues (30 jours proposé ici, pas confirmé) — à aligner le
  cas échéant sur une politique de rétention existante si le produit en a une.
- Détail d'implémentation (RLS de la table `notification`, RPC de création/marquage, respect du
  principe RPC-only pour les écritures cliniques) : non abordé ici, à traiter au moment de
  l'implémentation en respectant
  [`meddata-db-safety`](../.claude/skills/meddata-db-safety).
- Extension future du périmètre (accès accordé/révoqué, import terminé, invitation reçue, tâche
  de pool libérée/reprise) : explicitement hors de ce lot, mais pas écartée pour plus tard.
- Rapport hebdomadaire par e-mail (C4, idée voisine dans
  [idees-fonctionnalites-futures.md](idees-fonctionnalites-futures.md)) : non traité par cette
  décision, qui ne couvre que les notifications in-app (C5). C4 introduirait le premier envoi
  d'e-mail sortant du produit et mérite sa propre décision.

## Ce qui reste inchangé (hors périmètre de cette décision)

- Le Journal d'activité par base (C3) reste tel quel, en complément pull des notifications push.
- Le modèle de permissions de la curation (`is_assigned_curator`, `is_base_owner`,
  `curation_clarification`) n'est pas modifié.
- Aucun envoi d'e-mail n'est introduit par cette décision.
