-- =============================================================================
-- Formulaire de saisie par défaut d'une base
--
-- Le propriétaire choisit le formulaire ouvert par « Nouveau patient » : un formulaire
-- court de la base, ou le formulaire complet (absence de ligne). Une saisisseuse peu
-- familière de l'application tombe ainsi directement sur le bon formulaire.
--
-- Choix de conception :
--  - une table à une ligne par base plutôt qu'un drapeau sur `base_entry_form` : changer le
--    défaut est une écriture unique (pas de bascule en deux temps entre deux formulaires) et
--    n'incrémente pas la `row_version` des formulaires, donc ne crée aucun faux conflit avec
--    un formulaire en cours d'édition ;
--  - clé étrangère composite (base_id, form_id) : le défaut appartient forcément à la base ;
--    supprimer le formulaire supprime le défaut, et « Nouveau patient » retombe sur le
--    formulaire complet ;
--  - lecture selon l'accès à la base, écriture réservée au propriétaire, comme les formulaires ;
--  - migration additive : aucune donnée existante n'est touchée.
-- =============================================================================

begin;

alter table public.base_entry_form
  add constraint base_entry_form_base_id_id_key unique (base_id, id);

create table public.base_entry_form_default (
  base_id     uuid primary key references public.base(id) on delete cascade,
  form_id     uuid not null,
  updated_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  constraint base_entry_form_default_form_fk
    foreign key (base_id, form_id)
    references public.base_entry_form (base_id, id)
    on delete cascade
);

-- Auteur et horodatage non forgeables.
create or replace function public.guard_base_entry_form_default()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.base_id is distinct from old.base_id then
    raise exception 'Formulaire par défaut invalide';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.guard_base_entry_form_default() from public, anon, authenticated;

create trigger trg_base_entry_form_default_guard
  before insert or update on public.base_entry_form_default
  for each row execute function public.guard_base_entry_form_default();

alter table public.base_entry_form_default enable row level security;

revoke all on table public.base_entry_form_default from public, anon, authenticated;
grant select, insert, update, delete on table public.base_entry_form_default to authenticated;
grant select, insert, update, delete on table public.base_entry_form_default to service_role;

create policy base_entry_form_default_select
  on public.base_entry_form_default for select to authenticated
  using (
    public.is_base_active(base_id)
    and public.has_base_access(base_id)
  );

create policy base_entry_form_default_insert
  on public.base_entry_form_default for insert to authenticated
  with check (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

create policy base_entry_form_default_update
  on public.base_entry_form_default for update to authenticated
  using (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  )
  with check (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

create policy base_entry_form_default_delete
  on public.base_entry_form_default for delete to authenticated
  using (
    public.is_base_active(base_id)
    and public.is_base_owner(base_id)
  );

commit;
