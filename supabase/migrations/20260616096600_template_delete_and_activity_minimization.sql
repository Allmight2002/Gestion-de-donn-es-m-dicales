-- =============================================================================
-- 20260616096600_template_delete_and_activity_minimization.sql
-- Audit v15 P1:
--   1) no direct DELETE of published/archived template versions;
--   2) no direct DELETE on template, deletions go through delete_template();
--   3) base_activity_log returns minimized public metadata, never raw audit_log.metadata.
-- =============================================================================

-- Template deletion is business logic: ownership + "not in use" checks live in
-- public.delete_template(). With no DELETE policy, authenticated users cannot bypass it.
drop policy if exists template_delete on public.template;

-- Split the old ALL policy so DELETE can be narrower than INSERT/UPDATE.
drop policy if exists tv_write on public.template_version;
drop policy if exists tv_insert on public.template_version;
drop policy if exists tv_update on public.template_version;
drop policy if exists tv_delete on public.template_version;

create policy tv_insert on public.template_version for insert to authenticated
  with check (public.owns_template(template_id) and status = 'draft');

create policy tv_update on public.template_version for update to authenticated
  using (public.owns_template(template_id))
  with check (public.owns_template(template_id));

-- Published/archived versions are scientific records. A user may discard a local
-- draft version, but cannot remove a version that has been published or archived.
create policy tv_delete on public.template_version for delete to authenticated
  using (public.owns_template(template_id) and status = 'draft');

create or replace function public.activity_public_metadata(
  p_action text,
  p_metadata jsonb,
  p_is_owner boolean
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_action = 'data_imported' then jsonb_strip_nulls(jsonb_build_object(
      'patients_new', p_metadata -> 'patients_new',
      'patients_updated', p_metadata -> 'patients_updated',
      'encounters', p_metadata -> 'encounters',
      'errors', coalesce(p_metadata -> 'errors', p_metadata -> 'error_count')
    ))
    when p_action in ('access_granted', 'access_changed', 'invitation_created') then jsonb_strip_nulls(jsonb_build_object(
      'access_role', p_metadata -> 'access_role'
    ))
    when p_action = 'export_created' then jsonb_strip_nulls(jsonb_build_object(
      'format', p_metadata -> 'format',
      'patient_count', p_metadata -> 'patient_count',
      'encounter_count', p_metadata -> 'encounter_count'
    ))
    when p_action = 'template_published' then jsonb_strip_nulls(jsonb_build_object(
      'version_number', p_metadata -> 'version_number'
    ))
    when p_action in ('patient_deleted', 'encounter_deleted', 'base_deleted') and p_is_owner then
      jsonb_strip_nulls(jsonb_build_object('reason', p_metadata -> 'reason'))
    else '{}'::jsonb
  end
$$;
revoke all on function public.activity_public_metadata(text, jsonb, boolean) from public, anon, authenticated;

create or replace function public.base_activity_log(p_base_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
  v_is_owner boolean;
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
    order by created_at desc
    limit 50
  ) a
  left join public.profiles pr on pr.id = a.user_id;

  return result;
end $$;
grant execute on function public.base_activity_log(uuid) to authenticated;
