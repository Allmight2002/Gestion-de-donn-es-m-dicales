# Décision — recherche patient dans une base (20 août 2026)

> **Preuve datée 🗄️.** Ce document consigne des décisions de conception prises le
> 2026-08-20. **Aucun changement de code n'a été effectué à la date de ce document** :
> c'est un registre de décisions, pas une description de l'état courant.

## Constat de départ

Le champ de recherche existant (palette `Ctrl/Cmd+K`, `search.placeholder` = « Rechercher
une base, un écran… ») ne cherche que dans le **nom des bases** et une poignée d'actions de
navigation statiques (accueil, gabarits, sync, pool de curation) — voir
[`CommandPalette.tsx`](../src/components/CommandPalette.tsx). Il ne cherche **jamais** de
patient. L'écran d'une base ([`BaseHome.tsx`](../src/screens/member/BaseHome.tsx)) affiche la
liste des patients paginée (20 par page) sans aucun filtre de recherche.

Besoin exprimé : retrouver facilement un patient **à l'intérieur d'une base**, en plus (et
non à la place) de la palette existante.

## Ce qui est décidé

1. **Champ séparé, propre à l'écran d'une base.** Ce n'est pas une extension de la palette
   `Ctrl/Cmd+K` (qui reste un outil de navigation entre bases/écrans) mais un nouveau champ,
   local à la liste des patients d'une base donnée.
2. **Visibilité réservée au rôle applicatif `medecin`.** Le champ n'apparaît que pour les
   comptes dont `profiles.global_role = 'medecin'`. Un compte `curateur` ou `system_admin` ne
   le voit pas.
3. **Portée de la recherche :**
   - **par code patient** : toujours actif dès que le champ est visible (donnée de la zone
     analytique, sans risque de confidentialité) ;
   - **par nom / identité** : actif seulement si ce médecin a la permission
     `can_view_identity` sur **cette base précise** (`base_access.can_view_identity` ou
     propriétaire). Si cette permission manque, le nom ne remonte **jamais** dans les
     résultats, même si le champ de recherche est affiché.
4. **Recherche côté serveur, sur toute la base.** Elle ne se limite pas aux 20 lignes de la
   page actuellement chargée — sinon le champ reproduirait le défaut actuel (présent mais
   peu utile dès que le patient cherché n'est pas sur la page affichée).

## Pourquoi

- Le rôle `global_role = 'medecin'` a été choisi comme critère de visibilité **par préférence
  explicite**, malgré une alternative recommandée en discussion (caler la visibilité sur la
  permission `can_view_identity` elle-même, plus cohérente avec le modèle d'accès granulaire
  existant où un éditeur ou un compte de mission peut recevoir cette permission sur une base
  précise). Le choix retenu est plus simple à expliquer et suffit pour l'usage visé.
- Ce choix de visibilité ne dispense toutefois pas de revérifier `can_view_identity` au niveau
  des **résultats de recherche par nom** (décision 3) : un médecin peut être éditeur d'une base
  d'un confrère sans avoir cette permission sur cette base-là. Le rôle gouverne l'affichage du
  champ ; la permission gouverne les données qu'il peut faire remonter. Cette distinction évite
  qu'un médecin sans droit d'identité sur une base retrouve un patient par son nom via la
  recherche alors qu'il ne devrait pas voir cette donnée.
- La recherche doit porter sur toute la base (et non la page affichée) parce que la pagination
  à 20 lignes rend un filtre purement local inutile dès que la base dépasse une page — ce qui
  est le cas courant.

## Points ouverts

Aucun décidé à ce stade ; à trancher avant implémentation :

- Interaction avec la palette `Ctrl/Cmd+K` : rester deux outils bien distincts (décision 1) ou,
  plus tard, faire remonter aussi des résultats patients dans la palette globale ? Non tranché.
- Détail d'implémentation (RPC dédiée vs paramètre de filtre sur `listPatientsPage`, respect de
  la RLS côté serveur pour l'identité) : non abordé ici, à traiter au moment de l'implémentation
  en respectant [`meddata-db-safety`](../.claude/skills/meddata-db-safety) si une RPC est créée
  ou modifiée.

## Ce qui reste inchangé (hors périmètre de cette décision)

- La palette `Ctrl/Cmd+K` existante (recherche bases/écrans) reste telle quelle.
- Le modèle de permissions (`can_view_identity`, `can_edit_structured_data`, etc.) et la RLS
  associée ne sont pas modifiés par cette décision.
