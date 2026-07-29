# Décision — environnement `production` persistant de développement

**Date :** 29 juillet 2026

**Statut :** approuvée pour la phase de développement actuelle

**Décideur :** porteur du produit MedData

## Décision

L'environnement technique nommé `production` dans GitHub, Supabase et Vercel est
utilisé, pendant la phase actuelle, comme **environnement persistant de tests du
porteur et de l'équipe de développement**. Son URL Vercel principale et stable
permet de tester plusieurs versions successives sans dépendre des URL de preview
et sans recréer les comptes de test à chaque preview.

Cette décision autorise la préparation et l'utilisation de la release coordonnée
vers cette cible pour les tests internes. Elle ne déclare pas MedData prêt pour
une production clinique et n'autorise ni utilisateur tiers ni donnée réelle.

## Périmètre actuel

- produit encore en développement, sans lancement officiel ;
- accès limité au porteur et aux personnes qui développent ou testent avec lui ;
- données entièrement fictives, y compris les comptes, patients et documents ;
- URL principale Vercel utilisée comme adresse de test persistante ;
- backend Supabase et frontend Vercel déployés par le workflow de release
  coordonnée, à partir du même SHA déjà validé en staging ;
- déploiements Git/Vercel automatiques maintenus désactivés afin d'éviter un
  frontend publié indépendamment de son backend.

Le mot `production` désigne donc ici une **cible technique persistante**. Il ne
constitue pas une preuve de readiness, une autorisation clinique, juridique ou
éthique, ni une approbation d'utilisation de données patients.

## Motif

Les URL de preview Vercel sont temporaires et changent selon les déploiements.
Même lorsqu'elles contiennent une version à jour, elles compliquent les parcours
d'authentification et imposent de recréer des comptes de test. Une URL unique et
stable réduit ce coût de test et accélère les vérifications fonctionnelles.

## Garde-fous conservés

Le caractère interne et fictif du pilote ne supprime pas les contrôles techniques
qui rendent une erreur détectable ou réparable :

- staging réussi pour le SHA exact à promouvoir ;
- release manuelle et traçable, backend avant frontend ;
- validation explicite de la cible Supabase et Vercel ;
- sauvegarde pré-release chiffrée, vérifiée et conservée ;
- contrôles de migrations, dérive, RLS/ACL et inventaire des Edge Functions ;
- absence de secrets dans le dépôt, le frontend et les journaux ;
- utilisation exclusive de données fictives.

La dérogation `PILOT_EVIDENCE_WAIVER=true` peut suspendre temporairement les trois
preuves de gouvernance, de reprise et d'exploitation décrites dans
[`derogations-readiness.md`](derogations-readiness.md). Elle n'affaiblit aucun des
garde-fous ci-dessus et ne transforme pas ce pilote en production clinique.

## Ce que cette décision n'atteste pas

La configuration des secrets, le succès d'une première release coordonnée et
l'état effectif des services cloud doivent être vérifiés séparément. Le présent
document enregistre la décision et son périmètre ; il ne constitue pas une preuve
qu'un déploiement a déjà réussi.

## Fin automatique de la décision

Cette décision cesse d'être applicable **avant** le premier des événements
suivants :

- invitation ou accès d'un utilisateur extérieur à l'équipe de développement ;
- saisie, import ou stockage d'une donnée patient réelle, même pseudonymisée ;
- annonce ou préparation du lancement officiel de la plateforme ;
- ouverture d'un pilote auprès de professionnels ou d'un établissement tiers.

Le porteur a indiqué qu'il signalera explicitement cette transition. Elle devra
alors faire l'objet d'une nouvelle décision écrite et d'une revue dédiée, avant
toute ouverture ou donnée réelle.

## Conditions minimales avant lancement officiel

La transition exigera notamment :

1. retirer `PILOT_EVIDENCE_WAIVER` et rétablir les preuves complètes de
   gouvernance, reprise et exploitation ;
2. appliquer la checklist données réelles et obtenir les autorisations juridiques,
   éthiques, cliniques et organisationnelles nécessaires ;
3. achever le durcissement, la supervision, les alertes, la restauration testée,
   le scanner permanent et la gestion des incidents ;
4. revoir les comptes, secrets, accès, protections GitHub/Vercel/Supabase et la
   séparation des responsabilités ;
5. purger les comptes et données de démonstration avant l'ouverture réelle ;
6. produire une décision formelle `GO` liée au SHA et aux environnements exacts.

Jusqu'à cette nouvelle décision : **développement interne et données fictives
uniquement**.
