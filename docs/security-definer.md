# Inventaire des fonctions `SECURITY DEFINER`

La liste normative se trouve dans
[`supabase/security-definer-allowlist.json`](../supabase/security-definer-allowlist.json). Elle
rattache chacune des **94** signatures exécutables par le rôle `authenticated` à une justification
bornée, en sept catégories (état vérifié le 2026-08-10) :

| Catégorie | Signatures | Objet |
|---|---:|---|
| `authorization-policy-helper` | 29 | Évaluer l'appelant sans récursion de policy (RLS, Storage, RPC gardées) |
| `clinical-curation-rpc` | 19 | Commandes cliniques et de curation |
| `access-and-base-administration-rpc` | 14 | Administration des accès et des bases |
| `template-administration-rpc` | 11 | Administration des gabarits |
| `audited-sensitive-read` | 10 | Lectures sensibles tracées |
| `import-idempotence-concurrency-rpc` | 7 | Import, idempotence, concurrence |
| `file-inspection-rpc` | 4 | Inspection des fichiers déposés |

Les fonctions réservées à `service_role` (par exemple `mission_account_lookup`,
`reconcile_mission_profile`) sont **volontairement absentes** de l'inventaire : n'y figurent que
les signatures exécutables par un utilisateur authentifié.

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
