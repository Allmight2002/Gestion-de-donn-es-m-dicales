-- =============================================================================
-- 20260616092000_import_hardening.sql  (audit 2 §6)
-- Durcissement de l'import : idempotence (un meme fichier n'est pas importable deux fois),
-- tracabilite par LOT (import_batch), NON-retrogradation du statut d'un patient, MODE de
-- conflit explicite (fill / overwrite journalise / skip) au lieu d'un ecrasement silencieux,
-- et verrou de version de gabarit entre l'apercu et l'import.
-- =============================================================================

-- field_change_log : autoriser la source 'import' (journal des ecrasements a l'import).
alter table public.field_change_log drop constraint if exists field_change_log_source_check;
alter table public.field_change_log add constraint field_change_log_source_check
  check (source in ('direct_entry','curation_validation','curation_finalization','manual_correction','import'));

-- Rang d'un statut de validation (pour ne JAMAIS retrograder).
create or replace function public.validation_rank(p_status text)
returns int language sql immutable set search_path = public, pg_temp as $$
  select case p_status when 'curated' then 2 when 'complete' then 1 else 0 end
$$;

-- LOT d'import : trace + dedup. Un meme fichier (hash) ne peut etre importe qu'une fois par base.
create table if not exists public.import_batch (
  id                  uuid primary key default gen_random_uuid(),
  base_id             uuid not null references public.base(id) on delete cascade,
  file_hash           text,
  template_version_id uuid references public.template_version(id),
  row_count           int not null default 0,
  patients_new        int not null default 0,
  patients_updated    int not null default 0,
  encounters          int not null default 0,
  conflict_mode       text,
  imported_by         uuid references public.profiles(id),
  created_at          timestamptz not null default now()
);
create index if not exists ix_import_batch_base on public.import_batch(base_id);
create unique index if not exists uq_import_batch_file on public.import_batch(base_id, file_hash) where file_hash is not null;

alter table public.import_batch enable row level security;
grant select on public.import_batch to authenticated;
-- Lecture par les membres de la base ; ecriture UNIQUEMENT via la RPC (SECURITY DEFINER).
drop policy if exists ib_select on public.import_batch;
create policy ib_select on public.import_batch for select to authenticated
  using (public.has_base_access(base_id));

-- Anciennes signatures remplacees : on les supprime pour eviter toute ambiguite.
drop function if exists public.import_records(uuid, jsonb, boolean, text);
drop function if exists public.import_records(uuid, jsonb, boolean, text, text, text, uuid);

create or replace function public.import_records(
  p_base_id  uuid,
  p_rows     jsonb,
  p_dry_run  boolean default true,
  p_status   text default 'draft',
  p_conflict text default 'fill',          -- fill (defaut) | overwrite | skip
  p_file_hash text default null,           -- empreinte du fichier (idempotence)
  p_template_version_id uuid default null, -- version vue a l'apercu (verrou anti-changement)
  p_batch_id uuid default null             -- lot d'import en cours (import par chunks) ; null = appel autonome
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv         uuid;
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
  k            text;
  has_identity boolean;
  n_pat_new    int := 0;
  n_pat_upd    int := 0;
  n_enc        int := 0;
  errors       jsonb := '[]'::jsonb;
  seen_codes   text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.can_edit_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;
  if p_status not in ('draft','complete','curated') then raise exception 'Statut invalide'; end if;
  if p_conflict not in ('fill','overwrite','skip') then raise exception 'Mode de conflit invalide'; end if;
  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'Base introuvable'; end if;

  -- Verrou de version : si le gabarit a change depuis l'apercu, on refuse (mapping perime).
  if p_template_version_id is not null and p_template_version_id <> v_tv then
    raise exception 'Le gabarit de la base a change depuis l''apercu ; relancez l''apercu.';
  end if;

  -- Idempotence : meme fichier deja importe sur cette base -> refus (hors apercu, et UNIQUEMENT
  -- pour un appel autonome : en import par lots, ce controle est fait une fois par begin_import_batch).
  if not p_dry_run and p_batch_id is null and p_file_hash is not null
     and exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash) then
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

      select id, data, validation_status into v_existing, v_exdata, v_exstatus
      from public.patient where base_id = p_base_id and patient_code = v_code and deleted_at is null;

      if not (v_code = any(seen_codes)) then
        seen_codes := seen_codes || v_code;
        if v_existing is null then n_pat_new := n_pat_new + 1; else n_pat_upd := n_pat_upd + 1; end if;
      end if;
      if v_enc is not null and jsonb_typeof(v_enc) = 'object' then n_enc := n_enc + 1; end if;

      if has_identity and coalesce(v_id ->> 'date_of_birth', '') <> '' then
        v_dob := (v_id ->> 'date_of_birth')::date;
      else
        select date_of_birth into v_dob from public.patient_identity
         where base_id = p_base_id and patient_code = v_code and deleted_at is null;
      end if;

      if not p_dry_run then
        -- IDENTITE (zone restreinte) : upsert manuel.
        if has_identity then
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
            null; -- on n'ecrase NI les donnees permanentes NI le statut
          elsif p_conflict = 'overwrite' then
            -- journalise chaque cle reellement modifiee (provenance), puis ecrase.
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
          else -- 'fill' : ne complete QUE les cles absentes (l'existant gagne) ; jamais de retrogradation.
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

    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'patient_code', coalesce(v_code, ''), 'message', sqlerrm);
    end;
  end loop;

  if not p_dry_run then
    if p_batch_id is not null then
      -- Import par LOTS : on ACCUMULE les totaux du chunk dans le lot existant (cree par begin_import_batch).
      update public.import_batch
         set row_count = row_count + idx, patients_new = patients_new + n_pat_new,
             patients_updated = patients_updated + n_pat_upd, encounters = encounters + n_enc
       where id = p_batch_id;
    else
      -- Appel autonome : on cree le lot + on journalise.
      insert into public.import_batch (base_id, file_hash, template_version_id, row_count, patients_new, patients_updated, encounters, conflict_mode, imported_by)
      values (p_base_id, p_file_hash, v_tv, idx, n_pat_new, n_pat_upd, n_enc, p_conflict, auth.uid());
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
grant execute on function public.validation_rank(text) to authenticated;

-- §6.5 : OUVRIR un lot d'import (pour un import par CHUNKS cote client). Fait UNE fois les
-- controles globaux (permission, statut/conflit, verrou de version, idempotence par file_hash)
-- puis cree la ligne import_batch (totaux a 0). Les chunks suivants appellent import_records avec
-- ce p_batch_id (qui accumule les totaux). Renvoie l'id du lot.
create or replace function public.begin_import_batch(
  p_base_id uuid, p_file_hash text, p_template_version_id uuid default null,
  p_conflict text default 'fill', p_status text default 'draft'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tv uuid; v_id uuid;
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
  if p_file_hash is not null
     and exists (select 1 from public.import_batch where base_id = p_base_id and file_hash = p_file_hash) then
    raise exception 'Ce fichier a deja ete importe sur cette base (doublon evite).';
  end if;

  insert into public.import_batch (base_id, file_hash, template_version_id, conflict_mode, imported_by)
  values (p_base_id, p_file_hash, v_tv, p_conflict, auth.uid())
  returning id into v_id;
  perform public.log_audit('data_imported', 'base', p_base_id, p_base_id,
    jsonb_build_object('batch_id', v_id, 'status', p_status, 'conflict', p_conflict, 'chunked', true));
  return v_id;
end $$;

grant execute on function public.begin_import_batch(uuid, text, uuid, text, text) to authenticated;
