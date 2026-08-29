-- =============================================================================
-- 20260729153000_mission_profile_reconcile.sql
-- Correctif du lot L10, trouve en verifiant sur un projet Supabase REEL.
--
-- LE DEFAUT. `handle_new_user` lit le role dans `raw_app_meta_data` au moment de
-- l'INSERT dans `auth.users`. Sur un vrai projet Supabase, `createUser` avec
-- `app_metadata` n'ecrit PAS ces cles dans la meme instruction : l'utilisateur est
-- insere d'abord, les metadonnees applicatives sont posees ensuite. Le declencheur
-- ne voit donc rien, et le profil est cree `medecin`. Le `on conflict do nothing`
-- fait que la mise a jour suivante ne corrige rien.
--
-- CONSEQUENCE. Le compte de mission naissait MEDECIN, donc capable de creer ses
-- propres bases et gabarits — exactement l'escalade que le lot devait empecher.
-- L'infrastructure de test locale ecrit tout en une seule instruction : le defaut
-- ne pouvait apparaitre que sur un projet reel.
--
-- LE CORRECTIF. Une reconciliation explicite, appelee par l'Edge Function juste
-- apres la creation du compte. Elle relit `auth.users.raw_app_meta_data` — source
-- non falsifiable par l'utilisateur — et n'abaisse le profil au role de mission que
-- si le compte est ENCORE VIERGE : aucune base possedee, aucun acces. Un medecin
-- etabli ne peut donc jamais etre retrograde par cette voie, meme par erreur.
--
-- `handle_new_user` reste inchangee : elle demeure correcte pour tout chemin qui
-- pose bien `app_metadata` des l'insertion, et sert de premiere ligne.
-- =============================================================================

create or replace function public.reconcile_mission_profile(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_requested text;
  v_current   text;
begin
  if p_user_id is null then
    raise exception 'Utilisateur requis';
  end if;

  -- Source de verite : app_metadata, modifiable UNIQUEMENT cote admin.
  -- `not found` distingue le compte absent de la simple absence de la cle : sans cette
  -- distinction, un compte ordinaire (sans role demande) serait rejete comme introuvable.
  select coalesce(u.raw_app_meta_data, '{}'::jsonb) ->> 'global_role'
    into v_requested
  from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception 'Compte introuvable';
  end if;

  select p.global_role into v_current from public.profiles p where p.id = p_user_id;
  if v_current is null then
    raise exception 'Profil introuvable';
  end if;

  -- Rien a faire : soit ce n'est pas un compte de mission, soit le declencheur a
  -- deja fait le travail. Idempotent, donc rejouable sans effet de bord.
  if v_requested is distinct from 'saisisseur' or v_current = 'saisisseur' then
    return v_current;
  end if;

  -- Garde-fou : on ne retrograde JAMAIS un compte qui a deja servi. Seul un compte
  -- vierge — sans base possedee ni acces d'aucune sorte — peut basculer ici.
  if exists (select 1 from public.base b where b.owner_user_id = p_user_id)
     or exists (select 1 from public.base_access a where a.user_id = p_user_id) then
    raise exception 'Compte deja etabli : reconciliation refusee';
  end if;

  -- guard_profile_role interdit tout changement de role quand auth.uid() est non nul.
  -- Cette fonction n'est executable que par service_role (aucune session utilisateur),
  -- donc auth.uid() est null et la garde laisse passer.
  update public.profiles set global_role = 'saisisseur' where id = p_user_id;

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (null, 'mission_profile_reconciled', 'profiles', p_user_id, null,
          jsonb_build_object('from', v_current, 'to', 'saisisseur'));

  return 'saisisseur';
end $$;

-- Jamais exposee au client : c'est une operation d'administration de comptes.
revoke all on function public.reconcile_mission_profile(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_mission_profile(uuid) to service_role;
