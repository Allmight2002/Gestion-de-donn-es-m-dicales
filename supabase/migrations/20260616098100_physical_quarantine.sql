-- =============================================================================
-- 20260616098100_physical_quarantine.sql
-- P1 audit: quarantined files must leave the normal documentary buckets. The
-- Edge function moves bytes to a private quarantine bucket before completing
-- the SQL verdict; these columns keep the forensic pointer server-side.
-- =============================================================================

alter table public.clinical_attachment
  add column if not exists quarantine_bucket text
    check (quarantine_bucket is null or quarantine_bucket = 'quarantined-uploads'),
  add column if not exists quarantine_path text,
  add column if not exists quarantined_at timestamptz;

alter table public.raw_document
  add column if not exists quarantine_bucket text
    check (quarantine_bucket is null or quarantine_bucket = 'quarantined-uploads'),
  add column if not exists quarantine_path text,
  add column if not exists quarantined_at timestamptz;

create index if not exists ix_clinical_attachment_quarantine_path
  on public.clinical_attachment (quarantine_path)
  where quarantine_path is not null;

create index if not exists ix_raw_document_quarantine_path
  on public.raw_document (quarantine_path)
  where quarantine_path is not null;

create or replace function public.guard_inspection_status()
returns trigger language plpgsql as $$
declare
  protected_cols text[] := array[
    'inspection_status','inspection_run_id','inspection_started_at',
    'inspection_attempt_count','last_inspection_attempt_at','last_inspection_error',
    'storage_path','file_hash','file_size','mime_type','detected_mime_type',
    'inspected_at','quarantine_bucket','quarantine_path','quarantined_at'
  ];
  col text;
  oldv jsonb;
  newv jsonb;
begin
  -- Server contexts (Edge/service_role/RPC without auth.uid()) may set scanner fields.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.inspection_status in ('scanning','accepted','quarantined') then
      raise exception 'Statut d''inspection % reserve au serveur (scanner) ; cote client : pending / accepted_client', new.inspection_status;
    end if;
    new.inspection_run_id := null;
    new.inspection_started_at := null;
    new.inspection_attempt_count := 0;
    new.last_inspection_attempt_at := null;
    new.last_inspection_error := null;
    new.quarantine_bucket := null;
    new.quarantine_path := null;
    new.quarantined_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    oldv := to_jsonb(old);
    newv := to_jsonb(new);
    foreach col in array protected_cols loop
      if (old.inspection_status = 'accepted'
          or old.inspection_status in ('scanning','quarantined')
          or col in ('inspection_run_id','inspection_started_at','inspection_attempt_count',
                     'last_inspection_attempt_at','last_inspection_error',
                     'quarantine_bucket','quarantine_path','quarantined_at'))
         and oldv -> col is distinct from newv -> col then
        raise exception 'Champ fichier inspecte % immuable ou reserve au serveur', col;
      end if;
    end loop;
  end if;

  if TG_OP = 'UPDATE'
     and new.inspection_status in ('scanning','accepted','quarantined')
     and new.inspection_status is distinct from old.inspection_status then
    raise exception 'Statut d''inspection % reserve au serveur (scanner) ; cote client : pending / accepted_client', new.inspection_status;
  end if;

  if TG_OP = 'UPDATE'
     and old.inspection_status in ('scanning','quarantined')
     and new.inspection_status is distinct from old.inspection_status then
    raise exception 'Statut d''inspection % terminal cote utilisateur : reinspection serveur requise', old.inspection_status;
  end if;

  return new;
end $$;
revoke all on function public.guard_inspection_status() from public, anon, authenticated;

drop function if exists public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb
);

create or replace function public.complete_file_inspection(
  p_entity text,
  p_id uuid,
  p_run_id uuid,
  p_user_id uuid,
  p_status text,
  p_inspected_at timestamptz,
  p_file_hash text,
  p_file_size bigint,
  p_detected_mime_type text,
  p_mime_type text,
  p_engine text default 'clamav',
  p_signature text default null,
  p_extra jsonb default '{}'::jsonb,
  p_quarantine_bucket text default null,
  p_quarantine_path text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_updated int;
  v_quarantined_at timestamptz;
begin
  if p_entity not in ('clinical_attachment', 'raw_document') then
    raise exception 'Entite inspection invalide';
  end if;
  if p_status not in ('accepted', 'quarantined') then
    raise exception 'Statut inspection invalide';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Utilisateur inspection invalide';
  end if;
  if p_run_id is null then
    raise exception 'inspection_run_id requis';
  end if;
  if p_status = 'quarantined' then
    if (p_quarantine_bucket is null) <> (p_quarantine_path is null) then
      raise exception 'Quarantaine physique incomplete';
    end if;
    if p_quarantine_bucket is not null and p_quarantine_bucket <> 'quarantined-uploads' then
      raise exception 'Bucket de quarantaine invalide';
    end if;
    v_quarantined_at := p_inspected_at;
  end if;

  if p_entity = 'raw_document' then
    update public.raw_document
       set inspection_status = p_status,
           inspected_at = p_inspected_at,
           inspection_started_at = null,
           file_hash = p_file_hash,
           file_size = p_file_size,
           detected_mime_type = p_detected_mime_type,
           mime_type = coalesce(p_mime_type, mime_type),
           inspection_run_id = p_run_id,
           last_inspection_error = null,
           quarantine_bucket = case when p_status = 'quarantined' then p_quarantine_bucket else null end,
           quarantine_path = case when p_status = 'quarantined' then p_quarantine_path else null end,
           quarantined_at = case when p_status = 'quarantined' then v_quarantined_at else null end
     where id = p_id
       and inspection_status = 'scanning'
       and inspection_run_id = p_run_id
     returning base_id into v_base;
    get diagnostics v_updated = row_count;
  else
    update public.clinical_attachment ca
       set inspection_status = p_status,
           inspected_at = p_inspected_at,
           inspection_started_at = null,
           file_hash = p_file_hash,
           file_size = p_file_size,
           detected_mime_type = p_detected_mime_type,
           mime_type = coalesce(p_mime_type, mime_type),
           inspection_run_id = p_run_id,
           last_inspection_error = null,
           quarantine_bucket = case when p_status = 'quarantined' then p_quarantine_bucket else null end,
           quarantine_path = case when p_status = 'quarantined' then p_quarantine_path else null end,
           quarantined_at = case when p_status = 'quarantined' then v_quarantined_at else null end
      from public.patient p
     where ca.id = p_id
       and ca.patient_id = p.id
       and ca.inspection_status = 'scanning'
       and ca.inspection_run_id = p_run_id
     returning p.base_id into v_base;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated <> 1 then
    return false;
  end if;

  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (
    p_user_id,
    'file_inspected',
    p_entity,
    p_id,
    v_base,
    jsonb_build_object(
      'status', p_status,
      'engine', p_engine,
      'signature', p_signature,
      'file_hash', p_file_hash,
      'file_size', p_file_size,
      'detected_mime_type', p_detected_mime_type,
      'inspection_run_id', p_run_id,
      'quarantine_bucket', p_quarantine_bucket,
      'quarantine_path', p_quarantine_path,
      'extra', coalesce(p_extra, '{}'::jsonb)
    )
  );

  return true;
end $$;

revoke all on function public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb, text, text
) to service_role;
grant execute on function public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb, text, text
) to postgres;
