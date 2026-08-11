-- =============================================================================
-- 000_supabase_shim.sql  —  *** TEST UNIQUEMENT — NE PAS APPLIQUER SUR SUPABASE ***
--
-- Recree, sur un PostgreSQL nu (embarque), le minimum que nos migrations
-- supposent deja present sur Supabase :
--   * les roles anon / authenticated / service_role ;
--   * le schema auth + une table auth.users (sous-ensemble portable de colonnes) ;
--   * auth.uid() / auth.role() / auth.jwt() lisant le claim JWT depuis un GUC,
--     EXACTEMENT comme Supabase.
--
-- Sur un vrai projet Supabase, tous ces objets existent deja : ce fichier n'est
-- jamais joue en production (il vit hors de supabase/migrations).
-- =============================================================================

-- Roles PostgREST/Supabase.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create extension if not exists pgcrypto;

-- Schema auth + table users (colonnes utilisees par le trigger et le seed).
create schema if not exists auth;

create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default gen_random_uuid(),
  aud                varchar(255) default 'authenticated',
  role               varchar(255) default 'authenticated',
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until      timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Sous-ensemble de auth.sessions utilise par la rotation/revocation des comptes de
-- mission. Sur Supabase reel, cette table appartient au service Auth et contient
-- davantage de colonnes ; les migrations applicatives n'utilisent ici que id/user_id.
create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  not_after  timestamptz
);

-- auth.uid() / role() / jwt() : lisent request.jwt.claims (defensif si absent/vide).
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role',
    'anon'
  )
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
