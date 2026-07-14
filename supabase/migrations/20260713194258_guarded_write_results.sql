-- Guard the two user-facing writes that previously treated an RLS-filtered
-- UPDATE affecting zero rows as a success. The RPCs return stable outcomes;
-- callers never need to expose raw SQL errors.

alter table public.curation_draft
  add column if not exists revision bigint not null default 0 check (revision >= 0);

alter table public.base
  add column if not exists inclusion_target_revision bigint not null default 0
    check (inclusion_target_revision >= 0);

create or replace function public.bump_curation_draft_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.revision := old.revision + 1;
  return new;
end
$$;
revoke all on function public.bump_curation_draft_revision() from public, anon, authenticated;

drop trigger if exists trg_bump_curation_draft_revision on public.curation_draft;
create trigger trg_bump_curation_draft_revision
  before update on public.curation_draft
  for each row execute function public.bump_curation_draft_revision();

create or replace function public.guard_base_inclusion_target_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.inclusion_target is distinct from old.inclusion_target
     or new.inclusion_target_date is distinct from old.inclusion_target_date
     or new.inclusion_target_revision is distinct from old.inclusion_target_revision then
    new.inclusion_target_revision := old.inclusion_target_revision + 1;
  else
    new.inclusion_target_revision := old.inclusion_target_revision;
  end if;
  return new;
end
$$;
revoke all on function public.guard_base_inclusion_target_revision() from public, anon, authenticated;

drop trigger if exists trg_guard_base_inclusion_target_revision on public.base;
create trigger trg_guard_base_inclusion_target_revision
  before update on public.base
  for each row execute function public.guard_base_inclusion_target_revision();

create or replace function public.save_curation_draft(
  p_draft_id uuid,
  p_patient_data jsonb,
  p_encounters jsonb,
  p_expected_revision bigint
)
returns table(outcome text, revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_task_id uuid;
  v_task public.curation_task;
  v_draft public.curation_draft;
  v_scope text;
begin
  if v_uid is null then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  -- Discover the lock parent, then lock task -> draft, the same order as finalization.
  select d.task_id into v_task_id
    from public.curation_draft d
   where d.id = p_draft_id;
  if not found then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
    return;
  end if;

  select t.* into v_task
    from public.curation_task t
   where t.id = v_task_id
   for update;
  if not found then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
    return;
  end if;

  select d.* into v_draft
    from public.curation_draft d
   where d.id = p_draft_id
   for update;
  if not found then
    return query select 'not_found'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if not public.is_base_owner(v_task.base_id)
     and not (public.is_curateur() and v_task.assigned_to = v_uid) then
    return query select 'forbidden'::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_task.deleted_at is not null
     or v_task.status <> 'in_progress'
     or v_draft.status <> 'draft'
     or v_draft.superseded_at is not null then
    return query select 'invalid_state'::text, v_draft.revision, v_draft.updated_at;
    return;
  end if;

  if p_expected_revision is null or v_draft.revision <> p_expected_revision then
    return query select 'stale'::text, v_draft.revision, v_draft.updated_at;
    return;
  end if;

  if jsonb_typeof(coalesce(p_patient_data, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_encounters, '[]'::jsonb)) <> 'array' then
    return query select 'invalid_input'::text, v_draft.revision, v_draft.updated_at;
    return;
  end if;

  select s.scope into v_scope
    from public.raw_submission s
   where s.id = v_task.submission_id;
  if v_scope = 'encounter'
     and coalesce(p_patient_data, '{}'::jsonb) is distinct from '{}'::jsonb then
    return query select 'invalid_input'::text, v_draft.revision, v_draft.updated_at;
    return;
  end if;

  update public.curation_draft d
     set patient_data = coalesce(p_patient_data, '{}'::jsonb),
         encounters = coalesce(p_encounters, '[]'::jsonb)
   where d.id = v_draft.id
  returning d.* into v_draft;

  return query select 'updated'::text, v_draft.revision, v_draft.updated_at;
end
$$;
revoke all on function public.save_curation_draft(uuid, jsonb, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.save_curation_draft(uuid, jsonb, jsonb, bigint)
  to authenticated;

create or replace function public.set_base_inclusion_target(
  p_base_id uuid,
  p_target integer,
  p_target_date date,
  p_expected_revision bigint
)
returns table(
  outcome text,
  inclusion_target integer,
  inclusion_target_date date,
  revision bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.base;
begin
  if auth.uid() is null then
    return query select 'forbidden'::text, null::integer, null::date, null::bigint;
    return;
  end if;

  select b.* into v_base
    from public.base b
   where b.id = p_base_id
   for update;
  if not found then
    return query select 'not_found'::text, null::integer, null::date, null::bigint;
    return;
  end if;

  if not public.is_base_owner(v_base.id) then
    return query select 'forbidden'::text, null::integer, null::date, null::bigint;
    return;
  end if;

  if p_expected_revision is null
     or v_base.inclusion_target_revision <> p_expected_revision then
    return query select 'stale'::text, v_base.inclusion_target,
      v_base.inclusion_target_date, v_base.inclusion_target_revision;
    return;
  end if;

  if p_target is not null and p_target <= 0 then
    return query select 'invalid_input'::text, v_base.inclusion_target,
      v_base.inclusion_target_date, v_base.inclusion_target_revision;
    return;
  end if;

  update public.base b
     set inclusion_target = p_target,
         inclusion_target_date = p_target_date,
         -- Une commande acceptee avance toujours le jeton, meme si les valeurs metier
         -- sont identiques. La ligne est donc reellement modifiee et un rejeu du meme
         -- expected_revision devient explicitement stale.
         inclusion_target_revision = v_base.inclusion_target_revision + 1
   where b.id = v_base.id
  returning b.* into v_base;

  return query select 'updated'::text, v_base.inclusion_target,
    v_base.inclusion_target_date, v_base.inclusion_target_revision;
end
$$;
revoke all on function public.set_base_inclusion_target(uuid, integer, date, bigint)
  from public, anon, authenticated;
grant execute on function public.set_base_inclusion_target(uuid, integer, date, bigint)
  to authenticated;

-- Expose the optimistic token through the existing RLS-protected stats RPC.
create or replace function public.base_inclusion_stats(p_base_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'total', (select count(*)::int from public.patient p where p.base_id = p_base_id and p.deleted_at is null),
    'target', (select b.inclusion_target from public.base b where b.id = p_base_id),
    'targetDate', (select b.inclusion_target_date from public.base b where b.id = p_base_id),
    'targetRevision', coalesce((select b.inclusion_target_revision from public.base b where b.id = p_base_id), 0),
    'dateField', 'patient.inclusion_date',
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n) order by m.month)
      from (
        select to_char(date_trunc('month', p.inclusion_date::timestamp), 'YYYY-MM') as month,
               count(*)::int as n
          from public.patient p
         where p.base_id = p_base_id
           and p.deleted_at is null
           and p.inclusion_date is not null
         group by 1
      ) m
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.base_inclusion_stats(uuid) from public, anon;
grant execute on function public.base_inclusion_stats(uuid) to authenticated;
