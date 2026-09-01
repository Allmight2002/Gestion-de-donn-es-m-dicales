# Reprise sûre d’un import historique

Un lot ancien peut avoir `row_count > 0` sans reçus `import_batch_row`. Dans ce cas, le
serveur le marque `historical_unsafe` et refuse tout nouveau chunk. L’écran d’import
conserve l’identifiant du lot et propose **Annuler ce lot**.

Après l’annulation, relancer le fichier complet avec les mêmes paramètres et le même nombre
de lignes. Le serveur ne crée un lot de remplacement que si les reçus de provenance
`import_row_hash` prouvent toutes les anciennes lignes réussies :

- même fichier, même numéro de ligne et même empreinte normalisée : ligne reconnue sans réécriture ;
- même numéro de ligne avec un contenu différent : conflit explicite, aucune écriture ;
- aucune preuve pour une ligne : traitement normal comme ligne non encore reçue ;
- preuves historiques incomplètes : remplacement automatique refusé et revue manuelle requise.

Ne jamais supprimer le lot historique ni ses empreintes. En cas de refus pour preuves
incomplètes, conserver le fichier source, comparer les lignes déjà présentes avec un export
fictif de contrôle, puis préparer une migration ou une correction opératoire dédiée. Ne pas
forcer les compteurs ni insérer de reçus à la main sur un environnement partagé.

La récupération est forward-only : le lot annulé reste lisible et le nouveau lot référence
`replaces_batch_id`. Aucun déploiement ou changement cloud n’est effectué par cette procédure.
