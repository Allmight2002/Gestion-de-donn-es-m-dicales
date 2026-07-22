# Inventaire des fonctions `SECURITY DEFINER`

La liste normative se trouve dans
`supabase/security-definer-allowlist.json`. Elle rattache chacune des 85
signatures exécutables par le rôle `authenticated` à une justification bornée :
helper d'autorisation/RLS, lecture sensible auditée, administration des accès,
commande clinique ou de curation, administration des modèles, import/concurrence
ou inspection des fichiers.

Ce nombre n'est pas une cible à conserver. Toute nouvelle fonction, surcharge,
suppression ou modification de signature fait échouer le contrôle jusqu'à une
revue explicite de son besoin, de ses gardes d'autorisation, de son propriétaire
et de son `search_path`. L'inventaire ne donne aucun droit : les `GRANT` restent
définis par les migrations additives.

Le contrôle suivant reconstruit la base depuis toutes les migrations puis vérifie
l'inventaire et les ACL :

```text
npm test -- test/security-definer-acl.test.ts
```

Sur une cible Supabase autorisée, le contrôle distant est strictement en lecture
seule :

```text
SUPABASE_DB_URL=<session-pooler> npm run db:function-acl:verify
```

Il échoue si `anon` peut exécuter une fonction `SECURITY DEFINER`, si l'ensemble
des signatures accordées à `authenticated` diverge de l'inventaire, si un
`search_path` n'est pas borné et terminé par `pg_temp`, ou si `anon` ou
`authenticated` peut créer un objet dans le schéma `public`. Le workflow de
release exécute ce contrôle après les migrations de staging et de production et
avant le déploiement des Edge Functions.

La réussite locale ne remplace pas la preuve staging rattachée au candidat exact.
La promotion reste interdite tant que le contrôle distant n'a pas réussi sur ce
SHA et que les tests d'autorisation RLS/RPC n'ont pas été revalidés.
