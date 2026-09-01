# 07 — Procédure d'exercice des droits des personnes concernées

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (référent protection des données) |
| Personnes concernées | Patients inclus dans un registre ; utilisateurs professionnels (pour leurs données de compte) |
| Fondement | Loi n° 2024/017 (droits d'accès, rectification, effacement, opposition, retrait, portabilité) |

---

## 1. Principes

- Exercice **gratuit**, sans justification exigée (sauf demande manifestement abusive,
  à motiver par écrit).
- Réponse dans un délai maximal de **`[30 jours]`** à compter de la réception d'une
  demande complète ; prolongation motivée possible de `[30 jours]` pour les demandes
  complexes, notifiée avant l'échéance.
- Toute demande, réponse et action est consignée au **registre des demandes** (§6).
- Le patient s'adresse en priorité à **son médecin investigateur** (qui le connaît et
  détient l'accès identité) ; le référent PD `[coordonnées]` reste toujours joignable
  directement (coordonnées dans la [notice (03)](03-notice-information.md) et la
  [politique (05)](05-politique-confidentialite.md)).

## 2. Réception et vérification d'identité

1. **Canaux** : en consultation (oral consigné par écrit), courrier à
   `[adresse]`, e-mail à `[adresse dédiée, ex. donnees@…]`.
2. **Vérification d'identité** : présentation d'une pièce d'identité (ou vérification
   directe par le médecin traitant qui connaît le patient). Pour un représentant légal :
   justificatif du lien. Aucune donnée n'est communiquée tant que l'identité du
   demandeur n'est pas raisonnablement établie ; ne **jamais** envoyer de données de
   santé à une adresse non vérifiée.
3. **Localisation du dossier** : le patient ne connaît pas son code pseudonyme. La
   correspondance se fait **par la zone identité** : le médecin investigateur (ou un
   compte disposant de `can_view_identity`) recherche le patient par nom/date de
   naissance dans la base concernée et note la paire `(base, code patient)`. Cette
   consultation est journalisée automatiquement (`audit_log`) — indiquer « exercice de
   droits » en motif dans le registre des demandes.

## 3. Traitement par droit

### 3.1 Droit d'accès

- Constituer la copie : données d'identité (`patient_identity`), variables analytiques
  du patient et de ses rencontres, liste de ses images/documents, historique des
  corrections le concernant, et les informations sur le traitement (finalités,
  destinataires, durées — réutiliser la notice 03).
- L'extraction est réalisée par le médecin investigateur **écran par écran ou via une
  copie établie manuellement** ; ne pas utiliser la fonction d'export scientifique
  (elle est conçue pour exclure l'identité et exporte des cohortes, pas un dossier
  individuel).
- Remise en main propre ou par courrier/courriel sécurisé `[modalité à fixer]`.

### 3.2 Droit de rectification

- Corriger en zone identité (saisie directe) ou en zone analytique via l'édition
  contrôlée : chaque correction est tracée dans `field_change_log` (ancienne/nouvelle
  valeur, auteur, **motif : « rectification à la demande de la personne »**).
- Confirmer par écrit la rectification effectuée.

### 3.3 Retrait du consentement (arrêt de la collecte)

- Enregistrer le [volet de retrait (04)](04-consentement.md) au registre des
  consentements.
- Effet immédiat : **aucune nouvelle donnée** n'est saisie, importée ni soumise à
  curation pour ce patient ; les demandes de curation en préparation le concernant sont
  supprimées.
- Les données déjà collectées **restent** dans le registre (sous code) sauf demande
  d'effacement (§3.4) — le patient en est informé clairement.

### 3.4 Droit à l'effacement

- Portée par défaut : suppression du patient **et** de ses données via la fonction de
  suppression de l'application (soft delete puis purge selon la
  [politique de conservation (09)](09-conservation.md) : purge définitive sous
  `[90 jours]`, sauvegardes expirant naturellement selon leur rétention).
- **Limites légitimes, à motiver par écrit dans la réponse** :
  - données déjà intégrées à des **analyses ou publications** : les jeux d'export figés
    (reproductibilité scientifique) ne sont pas modifiés rétroactivement — le patient
    n'y figure que sous code, sans identité ;
  - journaux d'audit et de traçabilité conservés pour obligations légales (ils ne
    contiennent pas de données cliniques) ;
  - conservation exigée par une obligation légale ou contentieuse.
  Option intermédiaire à proposer : **suppression de la zone identité seule**
  (le dossier devient définitivement non ré-identifiable) avec maintien des données
  analytiques codées `[à valider par le comité d'éthique]`.
- Confirmer par écrit ce qui a été effacé, ce qui a été conservé et pourquoi.

### 3.5 Droit d'opposition

- Opposition à un usage particulier (ex. réutilisation pour une étude future) : retirer
  le patient des cohortes de l'étude visée avant figement ; consigner le refus (case B
  du consentement) pour qu'il soit respecté dans les sélections ultérieures.

### 3.6 Droit à la portabilité

- Fournir, sur demande, les données fournies par le patient dans un format structuré
  lisible par machine (CSV/JSON établi à partir de son dossier). En pratique rare pour
  un registre de recherche ; traiter comme un droit d'accès au format structuré.

### 3.7 Droits des utilisateurs professionnels

- Accès/rectification des données de compte : via l'administrateur système.
- Les journaux d'audit ne sont ni rectifiables ni effaçables (intégrité probante) ;
  l'utilisateur en est informé par la charte (11).

## 4. Refus et réclamations

Un refus (total ou partiel) est toujours **écrit, motivé en droit**, et mentionne la
possibilité de saisir l'autorité de protection des données personnelles du Cameroun.
Copie de tout refus au référent PD.

## 5. Modèles de réponse

**Accusé de réception** — « Nous avons bien reçu le `[date]` votre demande de `[droit]`
concernant le registre `[nom]`. Après vérification de votre identité, une réponse vous
sera apportée au plus tard le `[date + 30 j]`. Contact : `[référent]`. »

**Réponse d'exécution** — « À la suite de votre demande du `[date]`, nous avons procédé
à `[description exacte : rectification du champ X / suppression de vos données
d'identité et cliniques / arrêt de toute nouvelle collecte]` en date du `[date]`.
`[Le cas échéant :]` Les éléments suivants ont été conservés : `[liste]`, pour les
motifs suivants : `[motifs légaux/scientifiques]`. Vous pouvez saisir l'autorité de
protection des données si vous contestez cette réponse. »

## 6. Registre des demandes (tenu par le référent PD)

| N° | Date réception | Demandeur (réf. consentement) | Droit exercé | Base/code patient | Vérif. identité | Actions réalisées | Date réponse | Clôture |
|---|---|---|---|---|---|---|---|---|
| 2026-001 | | CONS-… | | | ☐ | | | ☐ |

Conservation du registre et des justificatifs : `[5 ans]`. Revue annuelle : volumes,
délais tenus, difficultés → alimente la révision de l'AIPD et des procédures.
