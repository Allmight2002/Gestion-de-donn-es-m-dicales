-- =============================================================================
-- 20260616095600_base_template_version_rpc_guard.sql
-- P1 audit: close the NULL template-version bypass and expose a narrow RPC for
-- legitimate base template-version switches.
-- =============================================================================

create or replace function public.guard_base_template_version()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_new_tpl uuid;
  v_old_tpl uuid;
  v_new_owner uuid;
  v_new_global boolean;
begin
  if new.current_template_version_id is not distinct from old.current_template_version_id then
    return new;
  end if;
  if new.current_template_version_id is null then
    raise exception 'Une base doit toujours pointer vers une version de gabarit';
  end if;

  select tv.template_id, t.owner_user_id, t.is_global
    into v_new_tpl, v_new_owner, v_new_global
  from public.template_version tv
  join public.template t on t.id = tv.template_id
  where tv.id = new.current_template_version_id;
  if v_new_tpl is null then
    raise exception 'Version de gabarit introuvable';
  end if;

  if old.current_template_version_id is null then
    if not (coalesce(v_new_global, false) or v_new_owner = new.owner_user_id) then
      raise exception 'Une base ne peut pointer que vers un gabarit lisible et autorise';
    end if;
    return new;
  end if;

  select template_id into v_old_tpl from public.template_version where id = old.current_template_version_id;
  if v_old_tpl is null or v_new_tpl is distinct from v_old_tpl then
    raise exception 'Une base ne peut pointer que vers une version de SON propre gabarit (rattachement a un gabarit etranger interdit)';
  end if;
  return new;
end $$;

drop trigger if exists trg_base_template_version on public.base;
create trigger trg_base_template_version before update on public.base
  for each row execute function public.guard_base_template_version();

create or replace function public.set_base_template_version(p_base_id uuid, p_version_id uuid)
returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_old_tpl uuid;
  v_new_tpl uuid;
  v_new_owner uuid;
  v_new_global boolean;
  result public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_version_id is null then raise exception 'Version de gabarit requise'; end if;

  select * into b from public.base where id = p_base_id and deleted_at is null for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;

  select tv.template_id, t.owner_user_id, t.is_global
    into v_new_tpl, v_new_owner, v_new_global
  from public.template_version tv
  join public.template t on t.id = tv.template_id
  where tv.id = p_version_id;
  if v_new_tpl is null then raise exception 'Version de gabarit introuvable'; end if;

  if b.current_template_version_id is null then
    if not (coalesce(v_new_global, false) or v_new_owner = b.owner_user_id) then
      raise exception 'Une base ne peut pointer que vers un gabarit lisible et autorise';
    end if;
  else
    select template_id into v_old_tpl from public.template_version where id = b.current_template_version_id;
    if v_old_tpl is null or v_new_tpl is distinct from v_old_tpl then
      raise exception 'Une base ne peut pointer que vers une version de SON propre gabarit (rattachement a un gabarit etranger interdit)';
    end if;
  end if;

  update public.base set current_template_version_id = p_version_id where id = p_base_id returning * into result;
  return result;
end $$;

grant execute on function public.set_base_template_version(uuid, uuid) to authenticated;
