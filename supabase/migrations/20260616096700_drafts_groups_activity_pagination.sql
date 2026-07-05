-- =============================================================================
-- 20260616096700_drafts_groups_activity_pagination.sql
-- P1 audit follow-up:
--   1) soft-deleting a base removes its private research-group labels;
--   2) base_activity_log supports cursor pagination and action filtering.
-- =============================================================================

create or replace function public.soft_delete_base(p_base_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Base supprimee');
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into b from public.base where id = p_base_id and deleted_at is null for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;

  update public.base_access
     set revoked_at = coalesce(revoked_at, v_now)
   where base_id = p_base_id and revoked_at is null;

  update public.base_invitation
     set status = 'revoked'
   where base_id = p_base_id and status = 'pending';

  delete from public.research_group_base
   where base_id = p_base_id;

  update public.patient
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.patient_identity
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.encounter e
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where e.patient_id = p.id and p.base_id = p_base_id and e.deleted_at is null;
  update public.clinical_attachment a
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where a.patient_id = p.id and p.base_id = p_base_id and a.deleted_at is null;

  update public.raw_submission
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason, status = 'cancelled'
   where base_id = p_base_id and deleted_at is null;
  update public.raw_document
     set deleted_at = v_now, deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.curation_task
     set deleted_at = v_now, status = 'cancelled', updated_at = v_now
   where base_id = p_base_id and deleted_at is null and status <> 'completed';

  update public.base
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where id = p_base_id;

  perform public.log_audit('base_deleted', 'base', p_base_id, p_base_id, jsonb_build_object('reason', v_reason));
end $$;

grant execute on function public.soft_delete_base(uuid, text) to authenticated;

drop function if exists public.base_activity_log(uuid);

create or replace function public.base_activity_log(
  p_base_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_action_filter text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
  v_is_owner boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_action_filter text := nullif(btrim(p_action_filter), '');
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.has_base_access(p_base_id) then raise exception 'Acces refuse'; end if;

  v_is_owner := public.is_base_owner(p_base_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'at', a.created_at,
    'action', a.action,
    'actorName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8), 'Systeme'),
    'metadata', public.activity_public_metadata(a.action, coalesce(a.metadata, '{}'::jsonb), v_is_owner)
  ) order by a.created_at desc), '[]'::jsonb) into result
  from (
    select user_id, action, metadata, created_at
    from public.audit_log
    where base_id = p_base_id
      and action not in ('identity_read', 'attachment_read', 'raw_document_read', 'export_read')
      and (p_before is null or created_at < p_before)
      and (v_action_filter is null or action = v_action_filter)
    order by created_at desc
    limit v_limit
  ) a
  left join public.profiles pr on pr.id = a.user_id;

  return result;
end $$;

grant execute on function public.base_activity_log(uuid, timestamptz, integer, text) to authenticated;
