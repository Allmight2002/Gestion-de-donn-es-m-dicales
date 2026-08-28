-- =============================================================================
-- 20260616095000_revoke_base_access_on_role_downgrade.sql  (audit interne Fable 5 P1)
-- Un acces base_access actif etait seulement neutralise par `is_medecin()` lorsqu'un compte
-- passait medecin -> curateur. Si l'admin remettait ensuite ce compte medecin, les anciennes
-- lignes base_access redevenaient actives silencieusement. On coupe ce cycle : quitter le role
-- medecin revoque les acces actifs et invalide les invitations encore utilisables.
-- =============================================================================
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
begin
  if auth.uid() is not null and new.global_role is distinct from old.global_role then
    if new.id = auth.uid() then
      raise exception 'Modification de son propre global_role non autorisee';
    end if;
    if not public.is_system_admin() then
      raise exception 'Modification de global_role non autorisee';
    end if;
  end if;

  if old.global_role = 'medecin' and new.global_role <> 'medecin' then
    update public.base_access
       set revoked_at = now()
     where user_id = new.id
       and revoked_at is null;

    select email into v_email from auth.users where id = new.id;
    if v_email is not null then
      update public.base_invitation
         set status = 'revoked'
       where status = 'pending'
         and lower(invited_email) = lower(v_email);
    end if;
  end if;

  return new;
end $$;
