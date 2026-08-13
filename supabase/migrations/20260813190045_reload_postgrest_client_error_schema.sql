-- L11 -- PostgREST conserve un cache de schéma. La migration précédente ajoute
-- des RPC publiques ; cette notification additive les rend immédiatement
-- découvrables par l'API sans toucher aux données, aux rôles ou aux ACL.
notify pgrst, 'reload schema';
