# Décision de continuité staging — 25 juillet 2026

## Décision

Pour l'environnement **staging** et uniquement avec des données fictives :

- la perte maximale de données acceptable (RPO) est fixée à **24 heures**,
  soit `86 400` secondes ;
- le délai maximal de retour en service (RTO) est fixé à **4 heures**,
  soit `14 400` secondes.

Le 25 juillet 2026, le porteur du projet a formulé l'approbation suivante dans
la tâche Codex consacrée à la fermeture B3/B4/B8 :

> J'approuve pour staging un maximum de 24 h de données perdues et un retour en
> service sous 4 h. Pour cet exercice, j'assume les rôles de responsable
> continuité et release manager.

## Responsabilités pour cet exercice

- référence responsable continuité : `MEDDATA-BCP-2026-07-25` ;
- référence release manager : `MEDDATA-CHANGE-2026-07-25-B3-B4-B8` ;
- décideur : porteur du dépôt MedData ;
- périmètre : sauvegarde, restauration, rollback et forward recovery staging.

## Conséquences techniques

Deux sauvegardes coordonnées par jour donnent une marge par rapport au RPO
approuvé de 24 heures. Le PITR Supabase n'est donc pas requis pour ce périmètre
staging. Un objectif futur inférieur à 24 heures devra déclencher une nouvelle
décision et une solution plus fréquente, par exemple le PITR ou des sauvegardes
additionnelles.

La preuve de fermeture doit néanmoins démontrer, sur le SHA final :

- une sauvegarde DB/Auth/Storage chiffrée et vérifiée ;
- une copie hors Supabase et immuable ;
- la récupération de la clé séparée de GitHub ;
- une restauration isolée sans objet manquant ni orphelin ;
- un RPO observé inférieur ou égal à 24 heures ;
- un RTO observé inférieur ou égal à 4 heures ;
- le rollback et le forward recovery intègres.

## Limites

Cette décision ne constitue pas :

- une autorisation de déploiement en production ;
- une autorisation d'utiliser des données médicales réelles ou pseudonymisées ;
- une approbation juridique, éthique ou institutionnelle ;
- une acceptation d'un coffre de clés limité à un seul poste Windows pour la
  production réelle.
