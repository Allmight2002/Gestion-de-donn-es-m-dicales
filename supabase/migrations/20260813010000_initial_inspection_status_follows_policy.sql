-- =============================================================================
-- Le statut d'inspection INITIAL doit suivre la politique serveur, pas une constante.
--
-- Regression constatee le 2026-08-13 par le preflight staging. Depuis
-- 20260712000300, `complete_verified_upload_operation` inserait la ligne metier
-- avec 'pending' EN DUR. Son predecesseur (20260712000100) portait pourtant deja
-- l'intention correcte :
--     case when public.require_server_inspection() then 'pending' else 'accepted_client' end
-- Cette condition a ete perdue lors de la reecriture de la fonction.
--
-- Consequence, invisible tant que le cloud tournait en mode strict : hors mode
-- strict, le client n'appelle pas `inspect-upload` (src/data/inspection.ts), donc
-- RIEN ne fait sortir la ligne de 'pending'. Le document restait indefiniment
-- illisible — `isInspectionReadable('pending')` est faux et `signed-read` refuse.
--
-- Correction ADDITIVE : on retablit la condition. Semantique inchangee et honnete.
--   mode strict  -> 'pending'         : aucun verdict serveur encore rendu.
--   mode suspendu-> 'accepted_client' : controle navigateur passe, AUCUN verdict
--                                       antivirus. Ce n'est PAS 'accepted', qui
--                                       reste reserve a un verdict serveur reel.
--
-- Le reste du corps est reproduit a l'identique (create or replace impose le corps
-- complet) : seules les deux valeurs litterales d'insertion changent.
--
-- Lignes existantes : NON modifiees. Aucune reprise automatique d'un historique
-- 'pending' — docs/upload-inspection-operations.md l'interdit explicitement et
-- exige une procedure d'inventaire avec compte de service.
-- =============================================================================

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
  -- Politique lue UNE fois, en debut de transaction : les deux branches d'insertion
  -- ne peuvent pas diverger si le drapeau bascule pendant l'operation.
  v_initial_status text := case when public.require_server_inspection() then 'pending' else 'accepted_client' end;
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
      p_verified_file_hash, v_initial_status, true, v_ticket.id, p_user_id
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
      v_initial_status, v_ticket.id, p_user_id
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
