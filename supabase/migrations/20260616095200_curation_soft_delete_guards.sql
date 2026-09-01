-- =============================================================================
-- 20260616095200_curation_soft_delete_guards.sql
-- Audit P1 : une tache de curation soft-deleted ne doit plus satisfaire les
-- predicates d'affectation ni pouvoir etre reservee/liberee par RPC.
-- Migration additive : redefinit les helpers et RPC concernes.
-- =============================================================================

create or replace function public.is_assigned_curator(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.curation_task t
     where t.id = p_task_id
       and t.assigned_to = auth.uid()
       and t.deleted_at is null
  )
$$;

create or replace function public.is_assigned_to_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.curation_task t
     where t.submission_id = p_submission_id
       and t.assigned_to = auth.uid()
       and t.status in ('in_progress','clarification_requested')
       and t.deleted_at is null
  )
$$;

create or replace function public.is_active_assigned_curator(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.curation_task t
     where t.id = p_task_id
       and t.assigned_to = auth.uid()
       and t.status in ('in_progress','clarification_requested')
       and t.deleted_at is null
  )
$$;

create or replace function public.claim_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.curation_task;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_curateur() then raise exception 'Reserve aux curateurs'; end if;

  update public.curation_task
     set assigned_to = auth.uid(), status = 'in_progress', updated_at = now()
   where id = p_task_id
     and status = 'open'
     and assigned_to is null
     and deleted_at is null
  returning * into v_task;

  if not found then raise exception 'Cas deja reserve ou indisponible'; end if;
  return v_task;
end $$;

create or replace function public.release_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.curation_task;
begin
  if not public.is_assigned_curator(p_task_id) then raise exception 'Vous n''avez pas reserve ce cas'; end if;

  update public.curation_task
     set assigned_to = null, status = 'open', updated_at = now()
   where id = p_task_id
     and status = 'in_progress'
     and deleted_at is null
  returning * into v_task;

  if not found then raise exception 'Cas non liberable (statut)'; end if;
  return v_task;
end $$;
