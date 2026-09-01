-- =============================================================================
-- 20260616090100_extensions.sql
-- Extensions requises.
-- =============================================================================
-- gen_random_uuid() fait partie du coeur de PostgreSQL (>= 13).
-- pgcrypto fournit crypt()/gen_salt() utilises par le seed (mots de passe demo).
-- Sur Supabase, les extensions vivent dans le schema "extensions" (deja installe) ;
-- "create extension if not exists" est idempotent et sans effet de bord.
create extension if not exists pgcrypto;
