-- =============================================================================
-- 20260616091200_access.sql
-- Gestion des acces (cahier §8.10) : permettre au PROPRIETAIRE de lire le profil
-- (nom) de ses collaborateurs, pour afficher la liste des acces.
--
-- Les tables base_invitation / base_access et leurs politiques existent deja, ainsi
-- que accept_invitation() (teste §16.7) et la revocation = suppression de base_access
-- (testee §16.6). Cette migration ajoute uniquement la lecture ciblee des profils
-- collaborateurs (sinon le proprietaire ne verrait que des UUID).
-- =============================================================================

-- SECURITY DEFINER : lit base_access/base sans declencher leur RLS (pas de recursion).
create or replace function public.owns_base_with_member(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.base_access a
    join public.base b on b.id = a.base_id
    where a.user_id = p_user and b.owner_user_id = auth.uid()
  )
$$;

grant execute on function public.owns_base_with_member(uuid) to authenticated;

-- Le proprietaire peut lire le profil des personnes ayant un acces a l'une de ses bases.
create policy profiles_select_collaborators on public.profiles for select to authenticated
  using (public.owns_base_with_member(id));
