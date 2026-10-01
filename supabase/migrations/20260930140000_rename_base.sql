-- Renommer une base.
--
-- Le nom d'une base se fixait a la creation et ne pouvait plus changer depuis l'application.
-- `rename_base` le modifie, pour le proprietaire seul, comme les autres reglages de la base
-- (modele d'observation, objectif d'inclusion).
--
-- Garanties :
--   * proprietaire seul, base non supprimee ; sinon refus structure, rien n'est ecrit ;
--   * nom : espaces de bord retires, 1 a 120 caracteres (meme borne qu'a la creation) ;
--   * concurrence : l'appelant envoie le nom qu'il a lu (`p_expected_name`). Si la base a ete
--     renommee entre-temps vers un AUTRE nom, refus BASE_RENAME_CONFLICT (rechargement requis),
--     jamais d'ecrasement silencieux. Un rejeu de la meme demande (nom deja applique) rend la
--     base sans rien reecrire ;
--   * seul `name` change : ni le formulaire (`form_revision`), ni les donnees, ni les acces.
--     Les exports deja produits gardent le nom qu'ils portaient.

create function public.rename_base(p_base_id uuid, p_name text, p_expected_name text)
returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base public.base;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED', detail = '{"code":"UNAUTHENTICATED"}';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_BASE_NAME',
      detail = '{"code":"INVALID_BASE_NAME","field":"name"}';
  end if;

  select * into v_base from public.base where id = p_base_id and deleted_at is null for update;
  -- Base absente ou non proprietaire : meme refus, on ne revele pas l'existence d'une base.
  if not found or v_base.owner_user_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'BASE_RENAME_FORBIDDEN',
      detail = '{"code":"BASE_RENAME_FORBIDDEN"}';
  end if;

  if v_base.name = v_name then return v_base; end if;
  if v_base.name is distinct from p_expected_name then
    raise exception using errcode = 'P0001', message = 'BASE_RENAME_CONFLICT',
      detail = '{"code":"BASE_RENAME_CONFLICT","action":"refresh_required"}',
      hint = 'refresh_required';
  end if;

  update public.base set name = v_name where id = p_base_id returning * into v_base;
  return v_base;
end $$;

revoke all on function public.rename_base(uuid, text, text) from public, anon;
grant execute on function public.rename_base(uuid, text, text) to authenticated;
