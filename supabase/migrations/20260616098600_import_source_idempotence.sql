-- =============================================================================
-- 20260616098600_import_source_idempotence.sql
-- Audit v20 §7.7 : separer la reprise technique d'un fichier de la detection de
-- doublon clinique. Les lignes importees peuvent maintenant laisser une empreinte
-- de provenance : file_hash + source_row_number + normalized_row_hash.
-- L'empreinte clinique existante reste en place pour les doublons probables entre
-- fichiers differents.
-- =============================================================================

alter table public.import_row_hash
  add column if not exists hash_kind text not null default 'clinical'
    check (hash_kind in ('clinical', 'source')),
  add column if not exists source_file_hash text,
  add column if not exists source_row_number int check (source_row_number is null or source_row_number > 0),
  add column if not exists normalized_row_hash text;

create index if not exists ix_import_row_hash_source
  on public.import_row_hash (base_id, source_file_hash, source_row_number, normalized_row_hash)
  where hash_kind = 'source';

create or replace function public.import_records(
  p_base_id  uuid,
  p_rows     jsonb,
  p_dry_run  boolean default true,
  p_status   text default 'draft',
  p_conflict text default 'fill',
  p_file_hash text default null,
  p_template_version_id uuid default null,
  p_batch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv         uuid;
  v_batch      public.import_batch;
  v_bid        uuid;
  v_effective_file_hash text;
  r            jsonb;
  idx          int := 0;
  v_code       text;
  v_id         jsonb;
  v_pdata      jsonb;
  v_enc        jsonb;
  v_enc_already boolean;
  v_dob        date;
  v_pid        uuid;
  v_iid        uuid;
  v_existing   uuid;
  v_exdata     jsonb;
  v_exstatus   text;
  v_merged     jsonb;
  v_age        numeric;
  v_rowkey     text;
  v_source_row_number int;
  v_normalized_row_hash text;
  v_sourcekey  text;
  k            text;
  has_identity boolean;
  n_pat_new    int := 0;
  n_pat_upd    int := 0;
  n_enc        int := 0;
  n_already    int := 0;
  errors       jsonb := '[]'::jsonb;
  seen_codes   text[] := array[]::text[];
  seen_rows    text[] := array[]::text[];
  seen_source_rows text[] := array[]::text[];
  ok_rows      text[] := array[]::text[];
  ok_source_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id and deleted_at is null;
  if v_tv is null then raise exception 'Base introuvable'; end if;

  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  if p_batch_id is not null then
    select * into v_batch from public.import_batch where id = p_batch_id for update;
    if not found then raise exception 'Lot d''import introuvable'; end if;
    if v_batch.base_id <> p_base_id then raise exception 'Lot d''import rattache a une autre base'; end if;
    if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
    if v_batch.status <> 'processing' then raise exception 'Lot d''import deja cloture (statut=%)', v_batch.status; end if;
    if v_batch.conflict_mode is distinct from p_conflict then raise exception 'Mode de conflit incoherent avec le lot'; end if;
    if v_batch.template_version_id is distinct from v_tv then raise exception 'Version de gabarit incoherente avec le lot'; end if;
    if v_batch.target_validation_status is not null and v_batch.target_validation_status <> p_status then
      raise exception 'Statut cible incoherent avec le lot (lot=%, chunk=%)', v_batch.target_validation_status, p_status;
    end if;
  end if;
  v_effective_file_hash := coalesce(p_file_hash, v_batch.file_hash);

  if not p_dry_run and p_batch_id is null and p_file_hash is not null
     and exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash and status = 'completed') then
    raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    idx := idx + 1;
    begin
      v_rowkey := null;
      v_sourcekey := null;
      v_enc_already := false;
      v_code := nullif(btrim(r ->> 'patient_code'), '');
      if v_code is null then raise exception 'Code patient manquant'; end if;

      v_source_row_number := nullif(r ->> 'source_row_number', '')::int;
      v_normalized_row_hash := nullif(btrim(r ->> 'normalized_row_hash'), '');
      if v_effective_file_hash is not null and v_source_row_number is not null and v_normalized_row_hash is not null then
        v_sourcekey := 'source|' || v_effective_file_hash || '|' || v_source_row_number::text || '|' || v_normalized_row_hash;
        if exists (
          select 1 from public.import_row_hash h
          where h.base_id = p_base_id and h.row_hash = v_sourcekey
            and (p_batch_id is null or h.batch_id <> p_batch_id)
        ) then
          n_already := n_already + 1;
          continue;
        end if;
        if p_batch_id is not null and not p_dry_run then
          insert into public.import_row_hash(
            batch_id, base_id, row_hash, hash_kind,
            source_file_hash, source_row_number, normalized_row_hash
          )
          values (
            p_batch_id, p_base_id, v_sourcekey, 'source',
            v_effective_file_hash, v_source_row_number, v_normalized_row_hash
          )
          on conflict do nothing;
          if not found then raise exception 'Ligne source deja traitee dans ce fichier'; end if;
        else
          if v_sourcekey = any(seen_source_rows) then raise exception 'Ligne source en double dans le fichier'; end if;
          seen_source_rows := seen_source_rows || v_sourcekey;
        end if;
      end if;

      v_id := r -> 'identity';
      has_identity := v_id is not null and jsonb_typeof(v_id) = 'object'
                      and (coalesce(v_id ->> 'full_name', '') <> '' or coalesce(v_id ->> 'date_of_birth', '') <> '');
      if has_identity and not public.can_write_identity(p_base_id) then
        raise exception 'Identite presente mais permission manquante (nom / date de naissance)';
      end if;
      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> ''
         and not public.is_strict_date_text(v_id ->> 'date_of_birth') then
        raise exception 'Date de naissance invalide (format AAAA-MM-JJ attendu)';
      end if;

      v_pdata := coalesce(r -> 'patient_data', '{}'::jsonb);
      v_enc   := r -> 'encounter';
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        if coalesce(v_enc ->> 'encounter_date', '') = '' then
          raise exception 'Date de rencontre manquante';
        end if;
        if not public.is_strict_date_text(v_enc ->> 'encounter_date') then
          raise exception 'Date de rencontre invalide (format AAAA-MM-JJ attendu)';
        end if;
      end if;

      select id, data, validation_status into v_existing, v_exdata, v_exstatus
      from public.patient where base_id = p_base_id and patient_code = v_code and deleted_at is null;

      v_merged := case
        when v_existing is null        then v_pdata
        when p_conflict = 'overwrite'  then coalesce(v_exdata, '{}'::jsonb) || v_pdata
        when p_conflict = 'skip'       then coalesce(v_exdata, '{}'::jsonb)
        else                                v_pdata || coalesce(v_exdata, '{}'::jsonb)
      end;

      perform public.assert_data_valid(v_tv, 'patient', v_pdata);
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        perform public.assert_data_valid(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb));
      end if;
      if p_status = 'curated' then
        if v_existing is null or p_conflict <> 'skip' then
          perform public.assert_required_complete(v_tv, 'patient', v_merged);
        end if;
        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
          perform public.assert_required_complete(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb), v_enc ->> 'encounter_type');
        end if;
      end if;

      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        v_rowkey := v_code || '|' || coalesce(v_enc ->> 'encounter_date', '') || '|'
                    || coalesce(v_enc ->> 'encounter_type', '') || '|' || md5(coalesce(v_enc -> 'data', '{}'::jsonb)::text);
        if exists (
          select 1 from public.import_row_hash h
          where h.base_id = p_base_id and h.row_hash = v_rowkey
            and (p_batch_id is null or h.batch_id <> p_batch_id)
        ) then
          v_enc_already := true;
        elsif p_batch_id is not null then
          if not p_dry_run then
            insert into public.import_row_hash(batch_id, base_id, row_hash, hash_kind)
            values (p_batch_id, p_base_id, v_rowkey, 'clinical')
            on conflict do nothing;
            if not found then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          end if;
        else
          if v_rowkey = any(seen_rows) then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          seen_rows := seen_rows || v_rowkey;
        end if;
      end if;

      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> '' then
        v_dob := (v_id ->> 'date_of_birth')::date;
      else
        select date_of_birth into v_dob from public.patient_identity
         where base_id = p_base_id and patient_code = v_code and deleted_at is null;
      end if;

      if not p_dry_run then
        if has_identity and (v_existing is null or p_conflict <> 'skip') then
          select id into v_iid from public.patient_identity
           where base_id = p_base_id and patient_code = v_code and deleted_at is null;
          if v_iid is null then
            insert into public.patient_identity (base_id, patient_code, full_name, date_of_birth, created_by)
            values (p_base_id, v_code, nullif(v_id ->> 'full_name', ''), nullif(v_id ->> 'date_of_birth', '')::date, auth.uid());
          else
            update public.patient_identity
               set full_name     = coalesce(nullif(v_id ->> 'full_name', ''), full_name),
                   date_of_birth = coalesce(nullif(v_id ->> 'date_of_birth', '')::date, date_of_birth)
             where id = v_iid;
          end if;
        end if;

        if v_existing is null then
          insert into public.patient (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
          values (p_base_id, v_code, v_tv, v_pdata, 'direct', p_status, auth.uid())
          returning id into v_pid;
        else
          v_pid := v_existing;
          if p_conflict = 'skip' then
            null;
          elsif p_conflict = 'overwrite' then
            for k in select jsonb_object_keys(v_pdata) loop
              if (v_exdata -> k) is distinct from (v_pdata -> k) then
                insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
                values (p_base_id, 'patient', v_pid, k, v_exdata -> k, v_pdata -> k, auth.uid(), 'Import (ecrasement)', 'import');
              end if;
            end loop;
            update public.patient
               set data = data || v_pdata,
                   validation_status = case when public.validation_rank(p_status) > public.validation_rank(v_exstatus) then p_status else v_exstatus end,
                   updated_at = now()
             where id = v_pid;
          else
            update public.patient
               set data = v_pdata || data,
                   validation_status = case when public.validation_rank(p_status) > public.validation_rank(v_exstatus) then p_status else v_exstatus end,
                   updated_at = now()
             where id = v_pid;
          end if;
        end if;

        if v_enc is not null and jsonb_typeof(v_enc) = 'object' and not v_enc_already then
          v_age := case
                     when v_dob is not null and coalesce(v_enc ->> 'encounter_date', '') <> ''
                     then public.compute_age(v_dob, (v_enc ->> 'encounter_date')::date, 'years')
                     else null
                   end;
          insert into public.encounter
            (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit, data, collection_mode, validation_status, created_by)
          values
            (v_pid, v_tv, coalesce(v_enc ->> 'encounter_type', 'autre'),
             (v_enc ->> 'encounter_date')::date, v_age, case when v_age is not null then 'years' else null end,
             coalesce(v_enc -> 'data', '{}'::jsonb) - 'age_at_encounter', 'direct', p_status, auth.uid());
        end if;
      end if;

      if not (v_code = any(seen_codes)) then
        seen_codes := seen_codes || v_code;
        if v_existing is null then n_pat_new := n_pat_new + 1; else n_pat_upd := n_pat_upd + 1; end if;
      end if;
      if v_enc_already then
        n_already := n_already + 1;
      elsif v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        n_enc := n_enc + 1;
      end if;
      if v_rowkey is not null and not v_enc_already then ok_rows := ok_rows || v_rowkey; end if;
      if v_sourcekey is not null then
        ok_source_rows := ok_source_rows || jsonb_build_object(
          'row_hash', v_sourcekey,
          'source_file_hash', v_effective_file_hash,
          'source_row_number', v_source_row_number,
          'normalized_row_hash', v_normalized_row_hash
        );
      end if;

    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'patient_code', coalesce(v_code, ''), 'message', sqlerrm);
    end;
  end loop;

  if not p_dry_run then
    if p_batch_id is not null then
      update public.import_batch
         set row_count = row_count + idx, patients_new = patients_new + n_pat_new,
             patients_updated = patients_updated + n_pat_upd, encounters = encounters + n_enc,
             error_count = error_count + jsonb_array_length(errors), updated_at = now()
       where id = p_batch_id;
    else
      insert into public.import_batch (base_id, file_hash, template_version_id, row_count, patients_new, patients_updated, encounters, conflict_mode, target_validation_status, expected_rows, error_count, imported_by, status, completed_at)
      values (p_base_id, p_file_hash, v_tv, idx, n_pat_new, n_pat_upd, n_enc, p_conflict, p_status, idx, jsonb_array_length(errors), auth.uid(),
              case when jsonb_array_length(errors) > 0 then 'completed_with_errors' else 'completed' end, now())
      returning id into v_bid;
      insert into public.import_row_hash (batch_id, base_id, row_hash, hash_kind)
        select v_bid, p_base_id, unnest(ok_rows), 'clinical'
      on conflict do nothing;
      insert into public.import_row_hash (
        batch_id, base_id, row_hash, hash_kind,
        source_file_hash, source_row_number, normalized_row_hash
      )
      select
        v_bid,
        p_base_id,
        x.row_hash,
        'source',
        x.source_file_hash,
        x.source_row_number,
        x.normalized_row_hash
      from jsonb_to_recordset(ok_source_rows) as x(
        row_hash text,
        source_file_hash text,
        source_row_number int,
        normalized_row_hash text
      )
      on conflict do nothing;
      perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
        jsonb_build_object('patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
                           'status', p_status, 'conflict', p_conflict, 'errors', jsonb_array_length(errors),
                           'already_imported', n_already));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'status', p_status, 'conflict', p_conflict,
    'patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
    'error_count', jsonb_array_length(errors), 'errors', errors,
    'already_imported', n_already
  );
end $$;

grant execute on function public.import_records(uuid, jsonb, boolean, text, text, text, uuid, uuid) to authenticated;
