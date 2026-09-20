-- Valide les invariants une fois par instruction DML et par version, plutôt qu'après
-- chaque ligne. Les écritures restent validées avant la fin de l'instruction et le
-- validateur conserve le verrou de version qui sérialise les modifications concurrentes.
-- Cela évite de revalider toutes les règles pour chacun des champs/règles copiés ou
-- réordonnés dans une même instruction.

create or replace function public.run_template_version_invariants_insert_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  for v_version_id in
    select distinct n.template_version_id
      from new_rows as n
     where n.template_version_id is not null
     order by n.template_version_id
  loop
    perform public.validate_template_version_invariants(v_version_id);
  end loop;
  return null;
end
$$;

create or replace function public.run_template_version_invariants_update_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  -- Une ligne peut être déplacée entre deux versions : les deux doivent rester valides.
  -- Le seul changement de display_order n'affecte aucun invariant de règle. Le comparer
  -- via les lignes de transition écarte un réordonnancement massif sans ignorer les autres
  -- différences; LEFT JOIN couvre aussi un changement de clé primaire.
  for v_version_id in
    select distinct changed.template_version_id
      from (
        select o.template_version_id
          from old_rows as o
          left join new_rows as n on n.id = o.id
         where n.id is null
            or (to_jsonb(o) - 'display_order') is distinct from (to_jsonb(n) - 'display_order')
        union all
        select n.template_version_id
          from new_rows as n
          left join old_rows as o on o.id = n.id
         where o.id is null
            or (to_jsonb(o) - 'display_order') is distinct from (to_jsonb(n) - 'display_order')
      ) as changed
     where changed.template_version_id is not null
     order by changed.template_version_id
  loop
    perform public.validate_template_version_invariants(v_version_id);
  end loop;
  return null;
end
$$;

create or replace function public.run_template_version_invariants_delete_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  for v_version_id in
    select distinct o.template_version_id
      from old_rows as o
     where o.template_version_id is not null
     order by o.template_version_id
  loop
    perform public.validate_template_version_invariants(v_version_id);
  end loop;
  return null;
end
$$;

revoke all on function public.run_template_version_invariants_insert_statement() from public, anon, authenticated;
revoke all on function public.run_template_version_invariants_update_statement() from public, anon, authenticated;
revoke all on function public.run_template_version_invariants_delete_statement() from public, anon, authenticated;

-- Keep the existing single-row helper available for compatibility, but replace its
-- three row-level triggers with statement-level triggers over the complete change set.
drop trigger if exists trg_template_version_invariants_rule on public.validation_rule;
drop trigger if exists trg_template_version_invariants_field on public.template_field;
drop trigger if exists trg_template_version_invariants_section on public.template_section;

create trigger trg_template_version_invariants_rule_insert
  after insert on public.validation_rule
  referencing new table as new_rows
  for each statement execute function public.run_template_version_invariants_insert_statement();
create trigger trg_template_version_invariants_rule_update
  after update on public.validation_rule
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.run_template_version_invariants_update_statement();
create trigger trg_template_version_invariants_rule_delete
  after delete on public.validation_rule
  referencing old table as old_rows
  for each statement execute function public.run_template_version_invariants_delete_statement();

create trigger trg_template_version_invariants_field_insert
  after insert on public.template_field
  referencing new table as new_rows
  for each statement execute function public.run_template_version_invariants_insert_statement();
create trigger trg_template_version_invariants_field_update
  after update on public.template_field
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.run_template_version_invariants_update_statement();
create trigger trg_template_version_invariants_field_delete
  after delete on public.template_field
  referencing old table as old_rows
  for each statement execute function public.run_template_version_invariants_delete_statement();

create trigger trg_template_version_invariants_section_insert
  after insert on public.template_section
  referencing new table as new_rows
  for each statement execute function public.run_template_version_invariants_insert_statement();
create trigger trg_template_version_invariants_section_update
  after update on public.template_section
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.run_template_version_invariants_update_statement();
create trigger trg_template_version_invariants_section_delete
  after delete on public.template_section
  referencing old table as old_rows
  for each statement execute function public.run_template_version_invariants_delete_statement();

-- `contains_any` depends on the driver's identity, scope, type, section and option codes;
-- display_order does not affect those rules. Avoid rechecking the whole ruleset once per
-- reordered field while retaining the row-level guard for every relevant edit.
drop trigger if exists trg_contains_any_revalidate on public.template_field;
create trigger trg_contains_any_revalidate
  after update of template_version_id, field_key, type, scope, section, section_id,
                  allowed_values, allowed_options
  on public.template_field
  for each row execute function public.revalidate_contains_any_rules();

-- A repeated-group field guard only depends on version, section membership and scope. Run
-- it once for a bulk statement, after the canonical section link has been set, and lock all
-- touched versions in a stable order.
create or replace function public.guard_repeatable_fields_insert_statement()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  for v_version_id in
    select distinct n.template_version_id
      from new_rows as n
     where n.template_version_id is not null
     order by n.template_version_id
  loop
    perform 1 from public.template_version where id = v_version_id for update;
  end loop;

  if exists (
    select 1
      from new_rows as n
      join public.template_section as s
        on s.template_version_id = n.template_version_id
       and s.is_repeatable
       and (s.id = n.section_id or s.section_key = n.section)
     where n.scope <> 'encounter'
  ) then
    raise exception 'Un groupe répétable ne contient que des variables de rencontre';
  end if;
  return null;
end
$$;

create or replace function public.guard_repeatable_fields_update_statement()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  for v_version_id in
    select distinct changed.template_version_id
      from (
        select o.template_version_id from old_rows as o
        union all
        select n.template_version_id from new_rows as n
      ) as changed
     where changed.template_version_id is not null
     order by changed.template_version_id
  loop
    perform 1 from public.template_version where id = v_version_id for update;
  end loop;

  if exists (
    select 1
      from new_rows as n
      join public.template_section as s
        on s.template_version_id = n.template_version_id
       and s.is_repeatable
       and (s.id = n.section_id or s.section_key = n.section)
     where n.scope <> 'encounter'
  ) then
    raise exception 'Un groupe répétable ne contient que des variables de rencontre';
  end if;
  return null;
end
$$;

revoke all on function public.guard_repeatable_fields_insert_statement() from public, anon, authenticated;
revoke all on function public.guard_repeatable_fields_update_statement() from public, anon, authenticated;

drop trigger if exists trg_repeatable_field on public.template_field;
create trigger trg_repeatable_field_insert
  after insert on public.template_field
  referencing new table as new_rows
  for each statement execute function public.guard_repeatable_fields_insert_statement();
create trigger trg_repeatable_field_update
  after update on public.template_field
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.guard_repeatable_fields_update_statement();

-- These are the leading columns used by the validator's per-version rule scans and by
-- the observation-model guard invoked once for every copied field.
create index if not exists ix_validation_rule_version_id_id
  on public.validation_rule (template_version_id, id);
create index if not exists ix_base_active_current_template_version
  on public.base (current_template_version_id)
  where deleted_at is null;
