-- =============================================================================
-- 20260616096800_inspection_activity_template_hardening.sql
-- Audit v16 follow-up:
--   1) inspection uses a server-only `scanning` lock state;
--   2) delete_template() cannot remove published/archived scientific records;
--   3) base_activity_log uses a composite cursor (created_at, id);
--   4) public activity metadata includes a minimized antivirus verdict.
-- =============================================================================

alter table public.clinical_attachment
  drop constraint if exists clinical_attachment_inspection_status_check;
alter table public.clinical_attachment
  add constraint clinical_attachment_inspection_status_check
  check (inspection_status in ('pending','scanning','accepted_client','accepted','quarantined'));

alter table public.raw_document
  drop constraint if exists raw_document_inspection_status_check;
alter table public.raw_document
  add constraint raw_document_inspection_status_check
  check (inspection_status in ('pending','scanning','accepted_client','accepted','quarantined'));

create or replace function public.guard_inspection_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  col text;
  protected constant text[] := array[
    'inspection_status','storage_path','file_hash','file_size','mime_type','detected_mime_type',
    'patient_id','encounter_id','submission_id','base_id','created_by'
  ];
begin
  -- Server verdicts and the scanning lock are reserved to service-role/Edge
  -- contexts. Browser clients may only create pending/accepted_client rows.
  if auth.uid() is not null
     and new.inspection_status in ('scanning','accepted','quarantined')
     and (TG_OP = 'INSERT' or new.inspection_status is distinct from old.inspection_status) then
    raise exception 'Statut d''inspection « % » reserve au serveur (scanner) ; cote client : pending / accepted_client', new.inspection_status;
  end if;

  if TG_OP = 'UPDATE' and old.inspection_status = 'accepted' and auth.uid() is not null then
    foreach col in array protected loop
      if (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
        raise exception 'Fichier deja inspecte (accepted) : la colonne « % » est immuable', col;
      end if;
    end loop;
  end if;

  if TG_OP = 'UPDATE'
     and auth.uid() is not null
     and old.inspection_status in ('scanning','quarantined')
     and new.inspection_status is distinct from old.inspection_status then
    raise exception 'Statut d''inspection « % » terminal cote utilisateur : reinspection serveur requise', old.inspection_status;
  end if;

  return new;
end $$;
revoke all on function public.guard_inspection_status() from public, anon, authenticated;

create index if not exists ix_audit_log_base_created_id
  on public.audit_log (base_id, created_at desc, id desc);

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
    when p_action = 'file_inspected' then jsonb_strip_nulls(jsonb_build_object(
      'status', p_metadata -> 'status',
      'engine', p_metadata -> 'engine',
      'file_size', p_metadata -> 'file_size',
      'detected_mime_type', p_metadata -> 'detected_mime_type',
      'signature', case when p_is_owner then p_metadata -> 'signature' else null end
    ))
    when p_action in ('patient_deleted', 'encounter_deleted', 'base_deleted') and p_is_owner then
      jsonb_strip_nulls(jsonb_build_object('reason', p_metadata -> 'reason'))
    else '{}'::jsonb
  end
$$;
revoke all on function public.activity_public_metadata(text, jsonb, boolean) from public, anon, authenticated;

drop function if exists public.base_activity_log(uuid, timestamptz, integer, text);
drop function if exists public.base_activity_log(uuid, timestamptz, integer, text, uuid);

create or replace function public.base_activity_log(
  p_base_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_action_filter text default null,
  p_before_id uuid default null
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
    'id', a.id,
    'at', a.created_at,
    'action', a.action,
    'actorName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8), 'Systeme'),
    'metadata', public.activity_public_metadata(a.action, coalesce(a.metadata, '{}'::jsonb), v_is_owner)
  ) order by a.created_at desc, a.id desc), '[]'::jsonb) into result
  from (
    select id, user_id, action, metadata, created_at
    from public.audit_log
    where base_id = p_base_id
      and action not in ('identity_read', 'attachment_read', 'raw_document_read', 'export_read')
      and (
        p_before is null
        or (p_before_id is null and created_at < p_before)
        or (p_before_id is not null and (created_at < p_before or (created_at = p_before and id < p_before_id)))
      )
      and (v_action_filter is null or action = v_action_filter)
    order by created_at desc, id desc
    limit v_limit
  ) a
  left join public.profiles pr on pr.id = a.user_id;

  return result;
end $$;

grant execute on function public.base_activity_log(uuid, timestamptz, integer, text, uuid) to authenticated;

create or replace function public.delete_template(p_template_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.owns_template(p_template_id) then raise exception 'Reserve au proprietaire du gabarit'; end if;

  if exists (
    select 1
    from public.template_version tv
    where tv.template_id = p_template_id
      and tv.status in ('published', 'archived')
  ) then
    raise exception 'Gabarit publie ou archive : suppression impossible, creez une nouvelle version ou archivez-le';
  end if;

  if exists (
    select 1 from public.template_version tv where tv.template_id = p_template_id and (
         exists (select 1 from public.base b           where b.current_template_version_id = tv.id)
      or exists (select 1 from public.patient p         where p.template_version_id = tv.id)
      or exists (select 1 from public.encounter e       where e.template_version_id = tv.id)
      or exists (select 1 from public.raw_submission rs where rs.template_version_id = tv.id)
    )
  ) then
    raise exception 'Gabarit utilise (base ou donnees) : suppression impossible';
  end if;

  delete from public.template where id = p_template_id;
end $$;
revoke all on function public.delete_template(uuid) from public, anon, authenticated;
grant execute on function public.delete_template(uuid) to authenticated;
