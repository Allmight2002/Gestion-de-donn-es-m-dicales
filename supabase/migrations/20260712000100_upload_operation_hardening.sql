-- =============================================================================
-- 20260712000100_upload_operation_hardening.sql
-- Durcissement de l'operation d'upload idempotente (additif, create-or-replace) :
--   * concurrence : deux PREMIERS appels vraiment simultanes avec la meme cle ne
--     doivent plus faire remonter un unique_violation PostgreSQL brut ; le perdant
--     relit la ligne du gagnant et renvoie le meme ticket/chemin/document.
--   * soft-delete : une ligne metier supprimee logiquement ne doit JAMAIS etre
--     renvoyee comme un succes silencieux ; l'operation rejouee est refusee.
-- Aucune modification de schema : seules les deux fonctions sont remplacees.
-- =============================================================================

create or replace function public.create_upload_operation(
  p_base_id uuid,
  p_bucket text,
  p_path text,
  p_idempotency_key uuid,
  p_file_hash text,
  p_file_size bigint,
  p_mime_type text,
  p_ttl_seconds int default 1800
)
returns table(ticket_id uuid, path text, ticket_status text, document_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.upload_ticket%rowtype;
  v_ttl int;
  v_doc_deleted boolean;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_idempotency_key is null or p_file_hash is null or length(p_file_hash) <> 64
     or p_file_size is null or p_file_size < 0 or p_mime_type is null or length(p_mime_type) > 200 then
    raise exception 'Operation upload invalide';
  end if;
  perform public.assert_upload_path_scope(p_base_id, p_bucket, p_path);
  if not public.upload_ticket_authorized(p_base_id, p_bucket) then raise exception 'Acces upload refuse'; end if;
  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 1800), 3600));

  -- Voie rapide : une operation avec cette cle existe deja pour l'appelant.
  select * into v_ticket from public.upload_ticket
   where owner_user_id = auth.uid() and idempotency_key = p_idempotency_key for update;
  if not found then
    -- Deux PREMIERS appels vraiment concurrents avec la meme cle manquent tous deux la
    -- ligne ci-dessus (aucune n'est encore committee) puis entrent en course sur l'index
    -- unique ux_upload_ticket_owner_operation. Le perdant capture l'unique_violation et
    -- relit la ligne du gagnant, plutot que de faire remonter un 23505 brut au frontend.
    begin
      insert into public.upload_ticket(owner_user_id, base_id, bucket, path, idempotency_key, file_hash, file_size, mime_type, expires_at)
      values (auth.uid(), p_base_id, p_bucket, p_path, p_idempotency_key, p_file_hash, p_file_size, p_mime_type, now() + make_interval(secs => v_ttl))
      returning * into v_ticket;
    exception when unique_violation then
      select * into v_ticket from public.upload_ticket
       where owner_user_id = auth.uid() and idempotency_key = p_idempotency_key for update;
      if not found then raise; end if;
    end;
  end if;

  -- Que la ligne ait preexiste ou qu'elle vienne d'un gagnant concurrent, la meme cle doit
  -- decrire le meme fichier et le meme contexte, sinon la reutilisation est contradictoire.
  if v_ticket.base_id <> p_base_id or v_ticket.bucket <> p_bucket
     or v_ticket.file_hash <> p_file_hash or v_ticket.file_size <> p_file_size or v_ticket.mime_type <> p_mime_type then
    raise exception 'Cle d idempotence reutilisee avec un fichier ou contexte different';
  end if;

  ticket_id := v_ticket.id; path := v_ticket.path; ticket_status := v_ticket.status;
  -- Une ligne metier soft-deletee ne doit jamais etre renvoyee comme un succes : l'operation
  -- rejouee est refusee explicitement et le document reste supprime (pas de resurrection
  -- silencieuse). Meme mecanisme partage par les pieces jointes et les documents bruts.
  if p_bucket = 'clinical-attachments' then
    select id, (deleted_at is not null) into document_id, v_doc_deleted
      from public.clinical_attachment where upload_ticket_id = v_ticket.id;
  elsif p_bucket = 'raw-documents' then
    select id, (deleted_at is not null) into document_id, v_doc_deleted
      from public.raw_document where upload_ticket_id = v_ticket.id;
  end if;
  if v_doc_deleted then
    raise exception 'Document supprime : operation d upload non rejouable';
  end if;
  return next;
end $$;
revoke all on function public.create_upload_operation(uuid,text,text,uuid,text,bigint,text,int) from public, anon;
grant execute on function public.create_upload_operation(uuid,text,text,uuid,text,bigint,text,int) to authenticated;

create or replace function public.finalize_upload_operation(
  p_ticket_id uuid,
  p_entity text,
  p_metadata jsonb
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket public.upload_ticket%rowtype;
  v_id uuid;
  v_attached_id uuid;
  v_patient uuid;
  v_submission uuid;
  v_base uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_ticket from public.upload_ticket where id = p_ticket_id for update;
  if not found or v_ticket.owner_user_id <> auth.uid() then raise exception 'Ticket upload invalide'; end if;
  if v_ticket.status = 'attached' then
    -- Rejeu apres reponse perdue : on renvoie la ligne durable DEJA rattachee, mais jamais
    -- une ligne soft-deletee (sinon un ajout serait annonce reussi alors que le document
    -- reste supprime). On distingue le cas supprime du cas reellement incoherent.
    if p_entity = 'attachment' then
      select id into v_id from public.clinical_attachment where upload_ticket_id = v_ticket.id and deleted_at is null;
      select id into v_attached_id from public.clinical_attachment where upload_ticket_id = v_ticket.id;
    elsif p_entity = 'raw_document' then
      select id into v_id from public.raw_document where upload_ticket_id = v_ticket.id and deleted_at is null;
      select id into v_attached_id from public.raw_document where upload_ticket_id = v_ticket.id;
    else raise exception 'Entite upload invalide'; end if;
    if v_id is not null then return v_id; end if;
    if v_attached_id is not null then raise exception 'Document supprime : operation d upload non rejouable'; end if;
    raise exception 'Ticket rattache incoherent';
  end if;
  if v_ticket.status <> 'pending' or v_ticket.expires_at <= now() then raise exception 'Ticket upload expire ou indisponible'; end if;

  if p_entity = 'attachment' and v_ticket.bucket = 'clinical-attachments' then
    v_patient := nullif(p_metadata->>'patient_id','')::uuid;
    select base_id into v_base from public.patient where id = v_patient;
    if v_base is distinct from v_ticket.base_id or not public.can_write_identity(v_ticket.base_id) then raise exception 'Piece jointe hors perimetre'; end if;
    insert into public.clinical_attachment(patient_id, encounter_id, kind, label, storage_path, mime_type, detected_mime_type, file_size, file_hash, inspection_status, inspected_at, deidentification_confirmed, upload_ticket_id)
    values (v_patient, nullif(p_metadata->>'encounter_id','')::uuid, nullif(p_metadata->>'kind',''), nullif(p_metadata->>'label',''), v_ticket.path,
      v_ticket.mime_type, v_ticket.mime_type, v_ticket.file_size, v_ticket.file_hash,
      case when public.require_server_inspection() then 'pending' else 'accepted_client' end,
      case when public.require_server_inspection() then null else now() end, true, v_ticket.id)
    returning id into v_id;
  elsif p_entity = 'raw_document' and v_ticket.bucket = 'raw-documents' then
    v_submission := nullif(p_metadata->>'submission_id','')::uuid;
    select base_id into v_base from public.raw_submission where id = v_submission;
    if v_base is distinct from v_ticket.base_id or not public.is_base_owner(v_ticket.base_id) then raise exception 'Document brut hors perimetre'; end if;
    insert into public.raw_document(submission_id, base_id, label, storage_path, mime_type, detected_mime_type, file_size, file_hash, inspection_status, inspected_at, upload_ticket_id)
    values (v_submission, v_ticket.base_id, nullif(p_metadata->>'label',''), v_ticket.path, v_ticket.mime_type, v_ticket.mime_type,
      v_ticket.file_size, v_ticket.file_hash, case when public.require_server_inspection() then 'pending' else 'accepted_client' end,
      case when public.require_server_inspection() then null else now() end, v_ticket.id)
    returning id into v_id;
  else
    raise exception 'Entite ou bucket upload invalide';
  end if;
  return v_id;
end $$;
revoke all on function public.finalize_upload_operation(uuid,text,jsonb) from public, anon;
grant execute on function public.finalize_upload_operation(uuid,text,jsonb) to authenticated;
