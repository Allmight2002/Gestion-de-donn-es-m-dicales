-- Garde de reprise pour les lots crees avant les recus par ligne et
-- reconciliation autoritative des compteurs des lots modernes.

create or replace function public.import_records(
  p_base_id uuid, p_rows jsonb, p_dry_run boolean default true,
  p_status text default 'draft', p_conflict text default 'fill',
  p_file_hash text default null, p_template_version_id uuid default null,
  p_batch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch public.import_batch;
  v_rows jsonb := '[]'::jsonb;
  v_clean_rows jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_report jsonb;
  v_errors jsonb;
  r jsonb;
  v_source integer;
  v_hash text;
  v_existing public.import_batch_row;
  v_error jsonb;
  v_new integer := 0;
  v_rejected integer := 0;
  v_already integer := 0;
  v_row_count integer := 0;
  v_error_count integer := 0;
  v_position integer := 0;
begin
  if p_batch_id is null or p_dry_run then
    return public.import_records_legacy(p_base_id, p_rows, p_dry_run, p_status, p_conflict, p_file_hash, p_template_version_id, p_batch_id);
  end if;
  -- Les appelants historiques sans provenance conservent leur chemin etabli.
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    where nullif(x.value ->> 'source_row_number', '') is not null
      and nullif(btrim(x.value ->> 'normalized_row_hash'), '') is not null
  ) then
    return public.import_records_legacy(p_base_id, p_rows, false, p_status, p_conflict, p_file_hash, p_template_version_id, p_batch_id);
  end if;

  select * into v_batch from public.import_batch where id = p_batch_id for update;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if v_batch.base_id <> p_base_id then raise exception 'Lot d''import rattache a une autre base'; end if;
  if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
  if v_batch.status <> 'processing' then raise exception 'Lot d''import deja cloture (statut=%)', v_batch.status; end if;
  if v_batch.row_count > 0 and not exists (
    select 1 from public.import_batch_row where batch_id = p_batch_id
  ) then
    raise exception 'Ancien lot sans recus non reprenable : annulez-le puis creez un nouveau lot';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_source := nullif(r ->> 'source_row_number', '')::integer;
    v_hash := nullif(btrim(r ->> 'normalized_row_hash'), '');
    if v_source is null or v_hash is null then
      raise exception 'Chaque ligne d''un lot doit fournir source_row_number et normalized_row_hash';
    end if;
    select * into v_existing from public.import_batch_row
      where batch_id = p_batch_id and source_row_number = v_source;
    if found then
      if v_existing.normalized_row_hash <> v_hash then
        raise exception 'Ligne source % incoherente avec le lot', v_source;
      end if;
      if v_existing.outcome = 'succeeded' then
        v_already := v_already + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('source_row_number', v_source, 'outcome', 'already_processed'));
      else
        v_rejected := v_rejected + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('source_row_number', v_source, 'outcome', 'rejected', 'error', v_existing.result));
      end if;
    else
      v_rows := v_rows || jsonb_build_array(r);
      v_clean_rows := v_clean_rows || jsonb_build_array(r - 'source_row_number' - 'normalized_row_hash');
    end if;
  end loop;

  if jsonb_array_length(v_clean_rows) > 0 then
    v_report := public.import_records_legacy(p_base_id, v_clean_rows, false, p_status, p_conflict, p_file_hash, p_template_version_id, p_batch_id);
    v_errors := coalesce(v_report -> 'errors', '[]'::jsonb);
    for r in select value from jsonb_array_elements(v_rows) loop
      v_position := v_position + 1;
      v_source := (r ->> 'source_row_number')::integer;
      v_hash := r ->> 'normalized_row_hash';
      select value into v_error from jsonb_array_elements(v_errors)
       where (value ->> 'row')::integer = v_position
       limit 1;
      if v_error is null then
        insert into public.import_batch_row(batch_id, source_row_number, normalized_row_hash, outcome, result)
        values (p_batch_id, v_source, v_hash, 'succeeded', '{}'::jsonb);
        v_new := v_new + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('source_row_number', v_source, 'outcome', 'newly_imported'));
      else
        insert into public.import_batch_row(batch_id, source_row_number, normalized_row_hash, outcome, result)
        values (p_batch_id, v_source, v_hash, 'rejected', v_error);
        v_rejected := v_rejected + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('source_row_number', v_source, 'outcome', 'rejected', 'error', v_error));
      end if;
      v_error := null;
    end loop;
  else
    v_report := jsonb_build_object('patients_new', 0, 'patients_updated', 0, 'encounters', 0, 'errors', '[]'::jsonb);
  end if;

  -- Les recus sont la source de verite. Le verrou du lot couvre leur lecture et
  -- la mise a jour des compteurs, y compris lors de retries concurrents.
  select count(*)::integer,
         count(*) filter (where outcome = 'rejected')::integer
    into v_row_count, v_error_count
    from public.import_batch_row where batch_id = p_batch_id;
  update public.import_batch
     set row_count = v_row_count,
         error_count = v_error_count,
         updated_at = now()
   where id = p_batch_id;

  return jsonb_build_object(
    'dry_run', false, 'status', p_status, 'conflict', p_conflict,
    'patients_new', coalesce((v_report ->> 'patients_new')::integer, 0),
    'patients_updated', coalesce((v_report ->> 'patients_updated')::integer, 0),
    'encounters', coalesce((v_report ->> 'encounters')::integer, 0),
    'error_count', v_error_count, 'errors', coalesce(v_report -> 'errors', '[]'::jsonb),
    'newly_imported', v_new, 'already_processed', v_already,
    'rejected', v_rejected, 'line_results', v_results,
    'batch', public.get_import_batch_state(p_batch_id)
  );
end $$;

create or replace function public.begin_import_batch(
  p_base_id uuid, p_file_hash text, p_template_version_id uuid default null,
  p_conflict text default 'fill', p_status text default 'draft', p_expected_rows integer default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tv uuid; v_id uuid; v_batch public.import_batch;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_file_hash is null then raise exception 'Empreinte de fichier requise pour un import par lots'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_base_id::text || '|' || p_file_hash, 0));
  select current_template_version_id into v_tv from public.base where id = p_base_id and deleted_at is null;
  if v_tv is null then raise exception 'Base introuvable'; end if;
  if p_template_version_id is not null and p_template_version_id <> v_tv then raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.'; end if;
  if exists (select 1 from public.import_batch where base_id=p_base_id and file_hash=p_file_hash and status='completed') then raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).'; end if;
  select * into v_batch from public.import_batch where base_id=p_base_id and file_hash=p_file_hash and status='processing' order by created_at limit 1;
  if found then
    if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import en cours par un autre utilisateur'; end if;
    if v_batch.conflict_mode <> p_conflict or v_batch.template_version_id <> v_tv or v_batch.target_validation_status is distinct from p_status then raise exception 'Parametres incoherents avec le lot existant'; end if;
    if v_batch.row_count > 0 and not exists (
      select 1 from public.import_batch_row where batch_id = v_batch.id
    ) then
      raise exception 'Ancien lot sans recus non reprenable : annulez-le puis creez un nouveau lot';
    end if;
    return v_batch.id;
  end if;
  insert into public.import_batch(base_id,file_hash,template_version_id,conflict_mode,target_validation_status,expected_rows,imported_by,status)
  values(p_base_id,p_file_hash,v_tv,p_conflict,p_status,p_expected_rows,auth.uid(),'processing') returning id into v_id;
  return v_id;
end $$;

-- Les signatures et privileges restent inchanges; ces GRANT explicites
-- documentent le contrat attendu apres remplacement des fonctions.
grant execute on function public.import_records(uuid, jsonb, boolean, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.begin_import_batch(uuid, text, uuid, text, text, integer) to authenticated;
