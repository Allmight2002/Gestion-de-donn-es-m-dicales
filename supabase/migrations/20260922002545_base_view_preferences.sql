-- =============================================================================
-- Préférences de présentation de la liste patients
--
-- Cette table ne contient que des clés techniques de variables analytiques.
-- Elle ne contient ni valeur patient, ni identité, ni contenu de formulaire.
-- La préférence est personnelle à l'utilisateur et à la base afin de suivre le
-- compte lors d'un changement d'appareil, sans devenir une configuration
-- partagée entre les membres de la base.
-- =============================================================================

begin;

create table public.base_view_preference (
  base_id                     uuid not null references public.base(id) on delete cascade,
  user_id                     uuid not null references public.profiles(id) on delete cascade,
  visible_patient_field_keys  text[] not null default '{}'::text[],
  updated_at                  timestamptz not null default now(),
  primary key (base_id, user_id),
  constraint base_view_preference_keys_bounded
    check (cardinality(visible_patient_field_keys) <= 1024),
  constraint base_view_preference_keys_no_null
    check (array_position(visible_patient_field_keys, null::text) is null)
);

create or replace function public.guard_base_view_preference_keys()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_version uuid;
  v_key text;
begin
  if (select count(*) from unnest(new.visible_patient_field_keys))
     <> (select count(distinct key) from unnest(new.visible_patient_field_keys) as keys(key)) then
    raise exception 'Préférence de colonnes invalide';
  end if;

  select b.current_template_version_id
    into v_active_version
    from public.base b
   where b.id = new.base_id
     and b.deleted_at is null;
  if v_active_version is null then
    raise exception 'Base indisponible';
  end if;

  foreach v_key in array new.visible_patient_field_keys loop
    if btrim(v_key) = '' or v_key <> btrim(v_key) or length(v_key) > 128 then
      raise exception 'Préférence de colonnes invalide';
    end if;
    if not exists (
      select 1
        from public.template_field f
       where f.template_version_id = v_active_version
         and f.scope = 'patient'
         and f.field_key = v_key
    ) then
      raise exception 'Préférence de colonnes invalide';
    end if;
  end loop;
  return new;
end
$$;

revoke all on function public.guard_base_view_preference_keys() from public, anon, authenticated;

create trigger trg_base_view_preference_keys
  before insert or update on public.base_view_preference
  for each row execute function public.guard_base_view_preference_keys();

create or replace function public.touch_base_view_preference_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.touch_base_view_preference_updated_at() from public, anon, authenticated;

create trigger trg_base_view_preference_updated_at
  before insert or update on public.base_view_preference
  for each row execute function public.touch_base_view_preference_updated_at();

alter table public.base_view_preference enable row level security;

-- La table est exposée uniquement à authenticated. Les quatre opérations sont
-- volontairement explicites : une préférence d'un compte révoqué devient
-- immédiatement illisible et inutilisable, et un identifiant user_id forgé ne
-- peut pas être écrit.
revoke all on table public.base_view_preference from public, anon, authenticated;
grant select, insert, update, delete on table public.base_view_preference to authenticated;
grant select, insert, update, delete on table public.base_view_preference to service_role;

create policy base_view_preference_select
  on public.base_view_preference for select to authenticated
  using (
    user_id = auth.uid()
    and public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

create policy base_view_preference_insert
  on public.base_view_preference for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

create policy base_view_preference_update
  on public.base_view_preference for update to authenticated
  using (
    user_id = auth.uid()
    and public.is_base_active(base_id)
    and public.has_base_access(base_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

create policy base_view_preference_delete
  on public.base_view_preference for delete to authenticated
  using (
    user_id = auth.uid()
    and public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

commit;
