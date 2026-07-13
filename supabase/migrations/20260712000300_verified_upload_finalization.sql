-- Browser clients may create an upload operation, but only a service component
-- that has downloaded and verified the exact Storage object may attach it.

create or replace function public.finalize_upload_operation(
  p_ticket_id uuid, p_entity text, p_metadata jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'UPLOAD_FINALIZATION_SERVER_REQUIRED: rechargez l application pour verifier le fichier cote serveur'
    using errcode = 'P0001';
end $$;
revoke all on function public.finalize_upload_operation(uuid, text, jsonb) from public, anon, authenticated;

-- Direct JWT inserts cannot carry a trusted physical-object proof. Existing
-- read/update/delete policies remain unchanged; creation is server-only.
revoke insert on table public.clinical_attachment from authenticated;
revoke insert on table public.raw_document from authenticated;

-- A browser must never repoint an already verified business row to different
-- bytes while its inspection is still pending. Labels and soft deletion remain
-- writable through their existing controlled paths; physical identity and
-- ownership columns are immutable for every JWT-backed UPDATE.
create or replace function public.guard_inspection_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  protected_cols constant text[] := array[
    'inspection_status','inspection_run_id','inspection_started_at',
    'inspection_attempt_count','last_inspection_attempt_at','last_inspection_error',
    'storage_path','file_hash','file_size','mime_type','detected_mime_type',
    'inspected_at','quarantine_bucket','quarantine_path','quarantined_at',
    'patient_id','encounter_id','submission_id','base_id','created_by','upload_ticket_id'
  ];
  col text;
  oldv jsonb;
  newv jsonb;
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.inspection_status in ('scanning','accepted','quarantined') then
      raise exception 'Statut d inspection reserve au serveur';
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

  oldv := to_jsonb(old);
  newv := to_jsonb(new);
  foreach col in array protected_cols loop
    if oldv -> col is distinct from newv -> col then
      raise exception 'Champ fichier reserve au serveur ou immuable : %', col;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_inspection_status() from public, anon, authenticated;

create or replace function public.complete_verified_upload_operation(
  p_ticket_id uuid,
  p_user_id uuid,
  p_entity text,
  p_metadata jsonb,
  p_verified_file_hash text,
  p_verified_file_size bigint,
  p_verified_mime_type text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.upload_ticket%rowtype;
  v_id uuid;
  v_patient uuid;
  v_encounter uuid;
  v_submission uuid;
  v_base uuid;
  v_authorized boolean := false;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Finalisation upload reservee au service';
  end if;
  if p_user_id is null then raise exception 'Utilisateur verifie requis'; end if;
  select * into v_ticket from public.upload_ticket where id = p_ticket_id for update;
  if not found or v_ticket.owner_user_id is distinct from p_user_id then
    raise exception 'Ticket upload invalide';
  end if;

  if v_ticket.status = 'attached' then
    if p_entity = 'attachment' then
      select id into v_id from public.clinical_attachment
       where upload_ticket_id = v_ticket.id and deleted_at is null;
    elsif p_entity = 'raw_document' then
      select id into v_id from public.raw_document
       where upload_ticket_id = v_ticket.id and deleted_at is null;
    end if;
    if v_id is null then raise exception 'Ticket rattache incoherent'; end if;
    return v_id;
  end if;
  if v_ticket.status <> 'pending' or v_ticket.expires_at <= now() then
    raise exception 'Ticket upload expire ou indisponible';
  end if;
  if p_verified_file_hash is distinct from v_ticket.file_hash
     or p_verified_file_size is distinct from v_ticket.file_size
     or lower(p_verified_mime_type) is distinct from lower(v_ticket.mime_type) then
    raise exception 'Preuve Storage incoherente';
  end if;

  select exists (
    select 1 from public.profiles pr
     where pr.id = p_user_id and pr.global_role = 'medecin'
  ) and exists (
    select 1 from public.base b where b.id = v_ticket.base_id and b.deleted_at is null
  ) and case v_ticket.bucket
    when 'clinical-attachments' then exists (
      select 1 from public.base b
       where b.id = v_ticket.base_id and b.owner_user_id = p_user_id
      union all
      select 1 from public.base_access a
       where a.base_id = v_ticket.base_id and a.user_id = p_user_id and a.revoked_at is null
         and a.can_view_identity and a.can_edit_structured_data
    )
    when 'raw-documents' then exists (
      select 1 from public.base b
       where b.id = v_ticket.base_id and b.owner_user_id = p_user_id
    )
    else false
  end into v_authorized;
  if not v_authorized then raise exception 'Acces upload refuse'; end if;

  if p_entity = 'attachment' and v_ticket.bucket = 'clinical-attachments' then
    v_patient := nullif(p_metadata->>'patient_id', '')::uuid;
    v_encounter := nullif(p_metadata->>'encounter_id', '')::uuid;
    select base_id into v_base from public.patient where id = v_patient and deleted_at is null;
    if v_base is distinct from v_ticket.base_id then raise exception 'Piece jointe hors perimetre'; end if;
    if v_encounter is not null and not exists (
      select 1 from public.encounter e
       where e.id = v_encounter and e.patient_id = v_patient and e.deleted_at is null
    ) then raise exception 'Rencontre de piece jointe incoherente'; end if;
    insert into public.clinical_attachment(
      patient_id, encounter_id, kind, label, storage_path, mime_type, detected_mime_type,
      file_size, file_hash, inspection_status, deidentification_confirmed, upload_ticket_id, created_by
    ) values (
      v_patient, v_encounter, nullif(p_metadata->>'kind',''), nullif(p_metadata->>'label',''),
      v_ticket.path, v_ticket.mime_type, p_verified_mime_type, p_verified_file_size,
      p_verified_file_hash, 'pending', true, v_ticket.id, p_user_id
    ) returning id into v_id;
  elsif p_entity = 'raw_document' and v_ticket.bucket = 'raw-documents' then
    v_submission := nullif(p_metadata->>'submission_id','')::uuid;
    select base_id into v_base from public.raw_submission where id = v_submission and deleted_at is null;
    if v_base is distinct from v_ticket.base_id then raise exception 'Document brut hors perimetre'; end if;
    insert into public.raw_document(
      submission_id, base_id, label, storage_path, mime_type, detected_mime_type,
      file_size, file_hash, inspection_status, upload_ticket_id, created_by
    ) values (
      v_submission, v_ticket.base_id, nullif(p_metadata->>'label',''), v_ticket.path,
      v_ticket.mime_type, p_verified_mime_type, p_verified_file_size, p_verified_file_hash,
      'pending', v_ticket.id, p_user_id
    ) returning id into v_id;
  else
    raise exception 'Entite ou bucket upload invalide';
  end if;

  update public.upload_ticket
     set status = 'attached', attached_at = now(), last_error = null
   where id = v_ticket.id;
  return v_id;
end $$;
revoke all on function public.complete_verified_upload_operation(uuid,uuid,text,jsonb,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.complete_verified_upload_operation(uuid,uuid,text,jsonb,text,bigint,text)
  to service_role;

create or replace function public.rollback_verified_upload_operation(
  p_ticket_id uuid, p_user_id uuid, p_document_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket public.upload_ticket%rowtype; v_deleted integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Rollback upload reserve au service';
  end if;
  select * into v_ticket from public.upload_ticket where id = p_ticket_id for update;
  if not found or v_ticket.owner_user_id is distinct from p_user_id or v_ticket.status <> 'attached' then
    return false;
  end if;
  if v_ticket.bucket = 'clinical-attachments' then
    delete from public.clinical_attachment where id = p_document_id and upload_ticket_id = p_ticket_id;
  elsif v_ticket.bucket = 'raw-documents' then
    delete from public.raw_document where id = p_document_id and upload_ticket_id = p_ticket_id;
  end if;
  get diagnostics v_deleted = row_count;
  if v_deleted = 1 then
    update public.upload_ticket set status = 'pending', attached_at = null,
      last_error = 'Objet Storage absent lors du controle post-finalisation'
     where id = p_ticket_id;
    return true;
  end if;
  return false;
end $$;
revoke all on function public.rollback_verified_upload_operation(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_verified_upload_operation(uuid,uuid,uuid) to service_role;
