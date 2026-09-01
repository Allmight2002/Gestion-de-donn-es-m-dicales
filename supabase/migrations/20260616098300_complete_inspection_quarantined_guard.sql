-- =============================================================================
-- 20260616098300_complete_inspection_quarantined_guard.sql
-- Audit v20 §7.3 : valeur FORENSIQUE de la quarantaine — un fichier quarantined a
-- toujours ete LU par l'Edge (le telechargement precede tout verdict), donc la base
-- exige aussi hash, taille (> 0) et moteur pour ce statut. Un fichier illisible ne
-- doit pas devenir quarantined : il reste pending avec last_inspection_error.
-- NB : le MIME detecte n'est PAS exige ici — un fichier hostile peut n'avoir aucun
-- conteneur reconnaissable (detected_mime_type legitimement null).
-- Fonction re-creee a l'identique de la 098200, seul ce garde est ajoute.
-- =============================================================================

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
  -- Garde 097700 restaure (audit v19 §5.2) : jamais d'`accepted` incomplet.
  if p_status = 'accepted' and (
    p_file_hash is null or p_file_size is null or p_file_size <= 0 or p_detected_mime_type is null
  ) then
    raise exception 'Hash, taille et MIME detecte requis pour accepter un fichier';
  end if;
  if p_status = 'quarantined' then
    -- Audit v20 §7.3 : trace forensique minimale exigee aussi pour la quarantaine.
    if p_file_hash is null or p_file_size is null or p_file_size <= 0
       or p_engine is null or btrim(p_engine) = '' then
      raise exception 'Hash, taille et moteur requis pour une mise en quarantaine';
    end if;
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
