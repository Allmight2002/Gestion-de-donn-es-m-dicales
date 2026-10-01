-- =============================================================================
-- Formulaires de saisie d'une base (« Saisie rapide », « Admission », « Sortie »…)
--
-- Un formulaire de saisie est une VUE de saisie sur les variables de fiche d'une
-- base : un nom, une liste ordonnée de clés de variables et les quelques clés
-- indispensables à l'enregistrement depuis ce formulaire. Il ne porte aucune
-- valeur patient, aucune identité et aucune variable propre : toutes les saisies
-- alimentent le même enregistrement `patient.data`, par les RPC existantes.
--
-- Conséquences voulues :
--  - supprimer ou modifier un formulaire ne touche ni au gabarit ni aux données ;
--  - aucune clé étrangère vers `template_field` : une clé retirée du gabarit par
--    une version ultérieure est simplement ignorée à la lecture ;
--  - la lecture suit l'accès à la base, l'écriture est réservée au propriétaire ;
--  - `row_version` est incrémentée par trigger pour un verrou optimiste côté client.
-- =============================================================================

begin;

create table public.base_entry_form (
  id             uuid primary key default gen_random_uuid(),
  base_id        uuid not null references public.base(id) on delete cascade,
  name           text not null,
  field_keys     text[] not null,
  required_keys  text[] not null default '{}'::text[],
  row_version    bigint not null default 1,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint base_entry_form_name_valid
    check (name = btrim(name) and length(name) between 1 and 80),
  constraint base_entry_form_keys_bounded
    check (cardinality(field_keys) between 1 and 1024),
  constraint base_entry_form_keys_no_null
    check (array_position(field_keys, null::text) is null),
  constraint base_entry_form_required_no_null
    check (array_position(required_keys, null::text) is null),
  constraint base_entry_form_required_subset
    check (required_keys <@ field_keys)
);

create unique index base_entry_form_name_unique
  on public.base_entry_form (base_id, lower(name));

create index base_entry_form_base_idx on public.base_entry_form (base_id);

-- Garde de cohérence : clés uniques, connues de la version courante, en portée
-- fiche ; nombre de formulaires borné ; auteur et version non forgeables.
create or replace function public.guard_base_entry_form()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_version uuid;
  v_key text;
begin
  if tg_op = 'UPDATE' then
    if new.base_id is distinct from old.base_id then
      raise exception 'Formulaire de saisie invalide';
    end if;
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.row_version := old.row_version + 1;
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.row_version := 1;
    if (select count(*) from public.base_entry_form f where f.base_id = new.base_id) >= 50 then
      raise exception 'Nombre maximal de formulaires de saisie atteint';
    end if;
  end if;
  new.updated_at := now();

  if (select count(*) from unnest(new.field_keys))
     <> (select count(distinct key) from unnest(new.field_keys) as keys(key))
     or (select count(*) from unnest(new.required_keys))
     <> (select count(distinct key) from unnest(new.required_keys) as keys(key)) then
    raise exception 'Formulaire de saisie invalide';
  end if;

  select b.current_template_version_id
    into v_active_version
    from public.base b
   where b.id = new.base_id
     and b.deleted_at is null;
  if v_active_version is null then
    raise exception 'Base indisponible';
  end if;

  foreach v_key in array new.field_keys loop
    if btrim(v_key) = '' or v_key <> btrim(v_key) or length(v_key) > 128 then
      raise exception 'Formulaire de saisie invalide';
    end if;
    if not exists (
      select 1
        from public.template_field f
       where f.template_version_id = v_active_version
         and f.scope = 'patient'
         and f.field_key = v_key
    ) then
      raise exception 'Formulaire de saisie invalide : variable inconnue';
    end if;
  end loop;
  return new;
end
$$;

revoke all on function public.guard_base_entry_form() from public, anon, authenticated;

create trigger trg_base_entry_form_guard
  before insert or update on public.base_entry_form
  for each row execute function public.guard_base_entry_form();

alter table public.base_entry_form enable row level security;

revoke all on table public.base_entry_form from public, anon, authenticated;
grant select, insert, update, delete on table public.base_entry_form to authenticated;
grant select, insert, update, delete on table public.base_entry_form to service_role;

create policy base_entry_form_select
  on public.base_entry_form for select to authenticated
  using (
    public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

create policy base_entry_form_insert
  on public.base_entry_form for insert to authenticated
  with check (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

create policy base_entry_form_update
  on public.base_entry_form for update to authenticated
  using (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  )
  with check (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

create policy base_entry_form_delete
  on public.base_entry_form for delete to authenticated
  using (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

commit;
