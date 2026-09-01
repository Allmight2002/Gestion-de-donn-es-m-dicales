-- =============================================================================
-- 20260616093400_import_p1_hardening.sql  (audit v9 P1 §7.1 / §7.2 / §7.3 / §7.4 / §7.5)
-- Durcissement de l'import par lots :
--   §7.1 : le mode `skip` ne doit RIEN modifier d'existant -> il ne touche plus l'identite d'un
--          patient deja present (avant, l'identite etait ecrite avant l'application du skip).
--   §7.2 : le STATUT CIBLE devient une propriete IMMUABLE du lot (target_validation_status) ;
--          chaque chunk doit l'utiliser -> plus de lot mi-draft mi-complete.
--   §7.3 : la REPRISE d'un lot `processing` (meme fichier) exige que TOUS les parametres
--          correspondent (utilisateur / base / version / conflit / statut) -> sinon refus net.
--   §7.4 : `complete_import_batch` refuse un lot INCOMPLET (moins de lignes recues qu'annonce).
--   §7.5 : les compteurs (patients/rencontres) ne sont incrementes qu'APRES la reussite COMPLETE
--          de la ligne (ecriture comprise) -> le rapport ne sur-annonce plus.
-- Migration ADDITIVE.
-- =============================================================================

-- §7.2 / §7.4 : nouvelles proprietes du lot.
alter table public.import_batch add column if not exists target_validation_status text;
alter table public.import_batch add column if not exists expected_rows int;
alter table public.import_batch add column if not exists error_count int not null default 0;

-- ----------------------------------------------------------------------------
-- import_records : §7.1 (skip n'altere pas l'identite), §7.2 (statut cible verrouille),
-- §7.5 (compteurs apres reussite de la ligne) + error_count du lot.
-- ----------------------------------------------------------------------------
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
  r            jsonb;
  idx          int := 0;
  v_code       text;
  v_id         jsonb;
  v_pdata      jsonb;
  v_enc        jsonb;
  v_dob        date;
  v_pid        uuid;
  v_iid        uuid;
  v_existing   uuid;
  v_exdata     jsonb;
  v_exstatus   text;
  v_age        numeric;
  v_rowkey     text;
  k            text;
  has_identity boolean;
  n_pat_new    int := 0;
  n_pat_upd    int := 0;
  n_enc        int := 0;
  errors       jsonb := '[]'::jsonb;
  seen_codes   text[] := array[]::text[];
  seen_rows    text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;
  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'Base introuvable'; end if;

  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  -- §6.1 : coherence du chunk avec son lot (verrou de ligne pour serialiser les chunks).
  if p_batch_id is not null then
    select * into v_batch from public.import_batch where id = p_batch_id for update;
    if not found then raise exception 'Lot d''import introuvable'; end if;
    if v_batch.base_id <> p_base_id then raise exception 'Lot d''import rattache a une autre base'; end if;
    if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
    if v_batch.status <> 'processing' then raise exception 'Lot d''import deja cloture (statut=%)', v_batch.status; end if;
    if v_batch.conflict_mode is distinct from p_conflict then raise exception 'Mode de conflit incoherent avec le lot'; end if;
    if v_batch.template_version_id is distinct from v_tv then raise exception 'Version de gabarit incoherente avec le lot'; end if;
    -- §7.2 : le statut cible est verrouille au niveau du lot.
    if v_batch.target_validation_status is not null and v_batch.target_validation_status <> p_status then
      raise exception 'Statut cible incoherent avec le lot (lot=%, chunk=%)', v_batch.target_validation_status, p_status;
    end if;
  end if;

  -- §6.2 : idempotence -> seul un lot COMPLETED bloque la reimportation (appel autonome).
  if not p_dry_run and p_batch_id is null and p_file_hash is not null
     and exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash and status = 'completed') then
    raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    idx := idx + 1;
    begin
      v_code := nullif(btrim(r ->> 'patient_code'), '');
      if v_code is null then raise exception 'Code patient manquant'; end if;

      v_id := r -> 'identity';
      has_identity := v_id is not null and jsonb_typeof(v_id) = 'object'
                      and (coalesce(v_id ->> 'full_name', '') <> '' or coalesce(v_id ->> 'date_of_birth', '') <> '');
      if has_identity and not public.can_write_identity(p_base_id) then
        raise exception 'Identite presente mais permission manquante (nom / date de naissance)';
      end if;

      v_pdata := coalesce(r -> 'patient_data', '{}'::jsonb);
      v_enc   := r -> 'encounter';

      perform public.assert_data_valid(v_tv, 'patient', v_pdata);
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        perform public.assert_data_valid(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb));
      end if;
      if p_status = 'curated' then
        perform public.assert_required_complete(v_tv, 'patient', v_pdata);
        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
          perform public.assert_required_complete(v_tv, 'encounter', coalesce(v_enc -> 'data', '{}'::jsonb), v_enc ->> 'encounter_type');
        end if;
      end if;

      -- §6.3 : doublon de rencontre DANS le fichier (meme patient / date / type / donnees).
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
        v_rowkey := v_code || '|' || coalesce(v_enc ->> 'encounter_date', '') || '|'
                    || coalesce(v_enc ->> 'encounter_type', '') || '|' || md5(coalesce(v_enc -> 'data', '{}'::jsonb)::text);
        if p_batch_id is not null then
          if not p_dry_run then
            insert into public.import_row_hash(batch_id, row_hash) values (p_batch_id, v_rowkey) on conflict do nothing;
            if not found then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          end if;
        else
          if v_rowkey = any(seen_rows) then raise exception 'Rencontre en double dans le fichier (meme patient, date, type et donnees)'; end if;
          seen_rows := seen_rows || v_rowkey;
        end if;
      end if;

      select id, data, validation_status into v_existing, v_exdata, v_exstatus
      from public.patient where base_id = p_base_id and patient_code = v_code and deleted_at is null;

      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> '' then
        v_dob := (v_id ->> 'date_of_birth')::date;
      else
        select date_of_birth into v_dob from public.patient_identity
         where base_id = p_base_id and patient_code = v_code and deleted_at is null;
      end if;

      if not p_dry_run then
        -- §7.1 : `skip` ne modifie RIEN d'existant -> on n'ecrit l'identite que pour un patient
        -- NOUVEAU, ou quand le mode n'est pas `skip`. (Avant, l'identite etait ecrasee meme en skip.)
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

        if v_enc is not null and jsonb_typeof(v_enc) = 'object' then
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

      -- §7.5 : on ne compte la ligne qu'ICI, une fois qu'elle a TOTALEMENT reussi (validation +
      -- ecriture). Si une exception est levee plus haut, on tombe dans le handler -> non comptee.
      if not (v_code = any(seen_codes)) then
        seen_codes := seen_codes || v_code;
        if v_existing is null then n_pat_new := n_pat_new + 1; else n_pat_upd := n_pat_upd + 1; end if;
      end if;
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then n_enc := n_enc + 1; end if;

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
      -- Appel autonome : le lot est cree DEJA COMPLETED (l'import tient en un appel).
      insert into public.import_batch (base_id, file_hash, template_version_id, row_count, patients_new, patients_updated, encounters, conflict_mode, target_validation_status, expected_rows, error_count, imported_by, status, completed_at)
      values (p_base_id, p_file_hash, v_tv, idx, n_pat_new, n_pat_upd, n_enc, p_conflict, p_status, idx, jsonb_array_length(errors), auth.uid(), 'completed', now());
      perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
        jsonb_build_object('patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
                           'status', p_status, 'conflict', p_conflict, 'errors', jsonb_array_length(errors)));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'status', p_status, 'conflict', p_conflict,
    'patients_new', n_pat_new, 'patients_updated', n_pat_upd, 'encounters', n_enc,
    'error_count', jsonb_array_length(errors), 'errors', errors
  );
end $$;
grant execute on function public.import_records(uuid, jsonb, boolean, text, text, text, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- begin_import_batch : enregistre le statut cible (§7.2) + le nombre de lignes attendu (§7.4) ;
-- la REPRISE d'un lot `processing` exige la correspondance de TOUS les parametres (§7.3).
-- ----------------------------------------------------------------------------
drop function if exists public.begin_import_batch(uuid, text, uuid, text, text);
create or replace function public.begin_import_batch(
  p_base_id uuid, p_file_hash text, p_template_version_id uuid default null,
  p_conflict text default 'fill', p_status text default 'draft', p_expected_rows int default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tv uuid; v_id uuid; v_b public.import_batch;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;
  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'Base introuvable'; end if;
  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  if p_file_hash is not null then
    -- Deja IMPORTE (lot completed) -> refus.
    if exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash and status = 'completed') then
      raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
    end if;
    -- §7.3 : lot EN COURS pour ce fichier -> on le REPREND uniquement si TOUT correspond.
    select * into v_b from public.import_batch
     where base_id = p_base_id and file_hash = p_file_hash and status = 'processing' limit 1;
    if found then
      if v_b.imported_by is distinct from auth.uid()
         or v_b.conflict_mode is distinct from p_conflict
         or v_b.template_version_id is distinct from v_tv
         or v_b.target_validation_status is distinct from p_status then
        raise exception 'Un lot en cours existe pour ce fichier avec d''autres parametres ; annulez-le d''abord.';
      end if;
      return v_b.id;
    end if;
  end if;

  insert into public.import_batch (base_id, file_hash, template_version_id, conflict_mode, target_validation_status, expected_rows, imported_by, status)
  values (p_base_id, p_file_hash, v_tv, p_conflict, p_status, p_expected_rows, auth.uid(), 'processing')
  returning id into v_id;
  perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
    jsonb_build_object('batch_id', v_id, 'status', p_status, 'conflict', p_conflict, 'expected_rows', p_expected_rows, 'chunked', true));
  return v_id;
end $$;
grant execute on function public.begin_import_batch(uuid, text, uuid, text, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- complete_import_batch : §7.4 refuse un lot INCOMPLET (moins de lignes recues qu'annonce).
-- ----------------------------------------------------------------------------
create or replace function public.complete_import_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.import_batch;
begin
  select * into v_batch from public.import_batch where id = p_batch_id for update;
  if not found then raise exception 'Lot d''import introuvable'; end if;
  if not public.can_edit_structured_data(v_batch.base_id) then raise exception 'Acces refuse'; end if;
  if v_batch.imported_by is distinct from auth.uid() then raise exception 'Lot d''import d''un autre utilisateur'; end if;
  if v_batch.status <> 'processing' then raise exception 'Lot deja cloture (statut=%)', v_batch.status; end if;
  -- §7.4 : si un total etait annonce, toutes les lignes doivent avoir ete recues (pas de chunk manquant).
  if v_batch.expected_rows is not null and v_batch.row_count < v_batch.expected_rows then
    raise exception 'Lot incomplet : % ligne(s) recue(s) sur % attendue(s) ; clture refusee.', v_batch.row_count, v_batch.expected_rows;
  end if;
  update public.import_batch set status = 'completed', completed_at = now(), updated_at = now() where id = p_batch_id;
end $$;
grant execute on function public.complete_import_batch(uuid) to authenticated;
