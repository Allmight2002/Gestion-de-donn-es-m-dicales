-- =============================================================================
-- 20260616097900_inspection_attempt_limits.sql
-- P1 audit v17 :
--   - memorise les tentatives d'inspection documentaire ;
--   - conserve le dernier echec technique ;
--   - empeche un client authentifie de manipuler ces compteurs ;
--   - nettoie l'erreur a la finalisation transactionnelle.
-- =============================================================================

alter table public.clinical_attachment
  add column if not exists inspection_attempt_count integer not null default 0
    check (inspection_attempt_count >= 0),
  add column if not exists last_inspection_attempt_at timestamptz,
  add column if not exists last_inspection_error text;

alter table public.raw_document
  add column if not exists inspection_attempt_count integer not null default 0
    check (inspection_attempt_count >= 0),
  add column if not exists last_inspection_attempt_at timestamptz,
  add column if not exists last_inspection_error text;

create index if not exists ix_clinical_attachment_last_inspection_attempt
  on public.clinical_attachment (last_inspection_attempt_at)
  where inspection_status in ('pending', 'scanning', 'accepted_client');

create index if not exists ix_raw_document_last_inspection_attempt
  on public.raw_document (last_inspection_attempt_at)
  where inspection_status in ('pending', 'scanning', 'accepted_client');

create or replace function public.guard_inspection_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  col text;
  protected constant text[] := array[
    'inspection_status','inspection_run_id','inspection_started_at',
    'inspection_attempt_count','last_inspection_attempt_at','last_inspection_error',
    'storage_path','file_hash','file_size','mime_type','detected_mime_type',
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

  if TG_OP = 'INSERT' and auth.uid() is not null then
    new.inspection_attempt_count := 0;
    new.last_inspection_attempt_at := null;
    new.last_inspection_error := null;
  end if;

  if TG_OP = 'UPDATE' and auth.uid() is not null then
    foreach col in array protected loop
      if (old.inspection_status = 'accepted'
          or col in ('inspection_run_id','inspection_started_at','inspection_attempt_count','last_inspection_attempt_at','last_inspection_error'))
         and (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
        raise exception 'Fichier deja inspecte ou verrouille : la colonne « % » est immuable cote utilisateur', col;
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

create or replace function public.complete_file_inspection(
  p_entity text,
  p_id uuid,
  p_run_id uuid,
  p_user_id uuid,
  p_status text,
  p_inspected_at timestamptz default now(),
  p_file_hash text default null,
  p_file_size bigint default null,
  p_detected_mime_type text default null,
  p_mime_type text default null,
  p_engine text default 'clamav',
  p_signature text default null,
  p_extra jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_id uuid;
  v_metadata jsonb;
begin
  if p_entity not in ('clinical_attachment', 'raw_document') then
    raise exception 'Entite inspection invalide: %', p_entity;
  end if;
  if p_status not in ('accepted', 'quarantined') then
    raise exception 'Verdict inspection invalide: %', p_status;
  end if;
  if p_run_id is null then
    raise exception 'inspection_run_id requis';
  end if;
  if p_user_id is null then
    raise exception 'Utilisateur inspecteur requis';
  end if;
  if p_status = 'accepted' and (p_file_hash is null or p_file_size is null or p_detected_mime_type is null) then
    raise exception 'Hash, taille et MIME detecte requis pour accepter un fichier';
  end if;

  if p_entity = 'raw_document' then
    update public.raw_document
       set inspection_status = p_status,
           inspected_at = coalesce(p_inspected_at, now()),
           inspection_run_id = p_run_id,
           inspection_started_at = null,
           last_inspection_error = null,
           file_hash = coalesce(p_file_hash, file_hash),
           file_size = coalesce(p_file_size, file_size),
           detected_mime_type = coalesce(p_detected_mime_type, detected_mime_type),
           mime_type = coalesce(p_mime_type, mime_type)
     where id = p_id
       and deleted_at is null
       and inspection_status = 'scanning'
       and inspection_run_id = p_run_id
     returning base_id into v_base_id;
  else
    update public.clinical_attachment
       set inspection_status = p_status,
           inspected_at = coalesce(p_inspected_at, now()),
           inspection_run_id = p_run_id,
           inspection_started_at = null,
           last_inspection_error = null,
           file_hash = coalesce(p_file_hash, file_hash),
           file_size = coalesce(p_file_size, file_size),
           detected_mime_type = coalesce(p_detected_mime_type, detected_mime_type),
           mime_type = coalesce(p_mime_type, mime_type)
     where id = p_id
       and deleted_at is null
       and inspection_status = 'scanning'
       and inspection_run_id = p_run_id
     returning public.base_of_patient(patient_id) into v_base_id;
  end if;

  if v_base_id is null then
    return false;
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'status', p_status,
    'engine', p_engine,
    'inspection_run_id', p_run_id,
    'file_hash', p_file_hash,
    'file_size', p_file_size,
    'detected_mime_type', p_detected_mime_type,
    'signature', p_signature
  )) || coalesce(p_extra, '{}'::jsonb);

  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (p_user_id, 'file_inspected', p_entity, p_id, v_base_id, v_metadata);

  return true;
end $$;

revoke all on function public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_file_inspection(
  text, uuid, uuid, uuid, text, timestamptz, text, bigint, text, text, text, text, jsonb
) to service_role;
