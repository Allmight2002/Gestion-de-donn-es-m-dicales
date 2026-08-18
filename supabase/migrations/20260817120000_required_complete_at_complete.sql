-- =============================================================================
-- 20260817120000_required_complete_at_complete.sql
-- Un dossier dont le statut est 'complete' est une SAISIE TERMINEE (soumise) :
-- pour un compte de mission, 'complete' est l'etat terminal de sa saisie. Il ne
-- peut donc pas manquer de donnees obligatoires. Jusqu'ici la completude des
-- champs requis n'etait exigee qu'au passage en 'curated', ce qui permettait
-- d'enregistrer (meme pour un compte de mission) une rencontre ou un patient
-- VIDEO en 'complete'.
--
-- Regle A (tous les comptes) : la completude des champs requis est exigee des la
--   sortie du brouillon (validation_status <> 'draft'), cote serveur, cote client
--   et dans l'import. La validation complete (bornes/types), les regles de
--   coherence `block` et la finalisation restent exigees uniquement en 'curated'.
-- Regle B (comptes de mission / saisisseur) : aucun brouillon partiel -- chaque
--   enregistrement (meme en 'draft') doit porter les champs requis du gabarit.
--   Les brouillons incomplets restent possibles pour le medecin (qui complete,
--   corrige ou confie a la curation).
-- Migration ADDITIVE : redefinit des fonctions ; aucune donnee modifiee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger assert_curated_complete : completude des la sortie du brouillon.
--    La verification des cles inconnues reste appliquee a tous les statuts ; la
--    validation complete (bornes/types) et les regles `block` restent en 'curated'.
-- -----------------------------------------------------------------------------
create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
begin
  -- Aucune cle inconnue du gabarit, QUEL QUE SOIT le statut (draft / complete / curated).
  perform public.assert_no_unknown_fields(new.template_version_id, v_scope, new.data);

  -- Completude des champs requis : exigee des la sortie du brouillon. Un dossier
  -- 'complete' est soumis (statut terminal pour un compte de mission) : il ne peut
  -- pas manquer de donnees obligatoires.
  if new.validation_status <> 'draft' then
    if v_scope = 'patient' then
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
  end if;

  -- Validation complete (bornes/types deja portees par les RPC ; ici en defense) +
  -- regles de coherence + valeurs sous champ masque : uniquement a la FINALISATION (curated).
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(new.template_version_id, v_scope, new.data);
    perform public.assert_validation_rules(new.template_version_id, new.data);
    perform public.assert_no_hidden_values(new.template_version_id, v_scope, new.data);
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 2. create_patient : regle B -- le compte de mission ne peut pas ouvrir de
--    brouillon partiel. (La creation ecrit toujours en 'draft' : la regle A ne
--    s'y applique donc pas.)
-- -----------------------------------------------------------------------------
create or replace function public.create_patient(
  p_base_id             uuid,
  p_patient_code        text,
  p_full_name           text,
  p_date_of_birth       date,
  p_phone               text,
  p_address             text,
  p_external_identifier text,
  p_permanent_data      jsonb
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tv uuid;
  v_patient public.patient;
  v_can_write_identity boolean;
begin
  if p_patient_code is null or btrim(p_patient_code) = '' then raise exception 'Code patient requis'; end if;
  -- Autorisation EXPLICITE (la fonction est DEFINER : elle ne s'appuie pas sur la RLS).
  if not public.can_create_structured_data(p_base_id) then raise exception 'Acces refuse'; end if;

  v_can_write_identity := public.can_write_identity(p_base_id);

  -- Sans droit d'ecriture sur l'identite, AUCUN champ nominatif ne peut etre soumis :
  -- refus explicite plutot qu'ignorance silencieuse (une donnee tue ne doit pas laisser
  -- croire a l'appelant qu'elle a ete enregistree).
  if not v_can_write_identity then
    if coalesce(btrim(p_full_name), '') <> ''
       or p_date_of_birth is not null
       or coalesce(btrim(p_phone), '') <> ''
       or coalesce(btrim(p_address), '') <> ''
       or coalesce(btrim(p_external_identifier), '') <> '' then
      raise exception 'Acces identite requis pour renseigner l''identite nominative';
    end if;
  end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  -- Regle B : un compte de mission ne peut pas enregistrer de brouillon partiel --
  -- chaque saisie exige les champs requis du gabarit (les brouillons incomplets
  -- sont reserves au medecin, qui complete, corrige ou confie a la curation).
  if not public.can_edit_structured_data(p_base_id) then
    perform public.assert_required_complete(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));
  end if;

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values (
    p_base_id, btrim(p_patient_code),
    case when v_can_write_identity then p_full_name end,
    case when v_can_write_identity then p_date_of_birth end,
    case when v_can_write_identity then p_phone end,
    case when v_can_write_identity then p_address end,
    case when v_can_write_identity then p_external_identifier end,
    auth.uid()
  );

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, btrim(p_patient_code), v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

-- -----------------------------------------------------------------------------
-- 3. create_encounter : regle A (completude des la sortie du brouillon) + regle B
--    (compte de mission : meme un 'draft' doit etre complet).
-- -----------------------------------------------------------------------------
create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years'
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
  v_status text;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_create_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  v_status := coalesce(p_validation_status, 'draft');
  -- Promouvoir directement en 'curated' est un acte de curation, pas de saisie :
  -- reserve a can_edit_structured_data (le medecin).
  if v_status = 'curated' and not public.can_edit_structured_data(v_base) then
    raise exception 'Acces refuse';
  end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  -- Re-validation SERVEUR (§5.4/§5.5) : memes bornes/listes/type que le moteur React.
  perform public.assert_data_valid(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  -- Regle A : completude exigee des la sortie du brouillon ('complete'), pour tous
  -- les comptes. Regle B : compte de mission -> exigee a chaque enregistrement.
  if v_status <> 'draft' or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', p_encounter_type);
  end if;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', v_status, auth.uid())
  returning * into v_enc;

  return v_enc;
end $$;

-- -----------------------------------------------------------------------------
-- 4. update_encounter : regles A et B sur le statut FINAL (celui qui sera ecrit).
-- -----------------------------------------------------------------------------
create or replace function public.update_encounter(
  p_encounter_id      uuid,
  p_data              jsonb,
  p_validation_status text,
  p_reason            text,
  p_expected_updated_at timestamptz default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter; v_base uuid; v_code text; v_dob date; v_age numeric;
  v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_enc from public.encounter where id = p_encounter_id and deleted_at is null;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code from public.patient where id = v_enc.patient_id;

  if not public.can_edit_structured_data(v_base) then
    -- Voie « saisisseur » : son propre brouillon, vers brouillon ou soumission.
    if not (
      public.can_create_structured_data(v_base)
      and v_enc.created_by = auth.uid()
      and v_enc.validation_status = 'draft'
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  -- §13 : verrou optimiste (voir 20260616092200).
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps' using errcode = 'P0001';
  end if;

  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  -- Regle A : completude exigee si le statut final est <> 'draft' (reouverture en
  -- brouillon possible sans completude). Regle B : compte de mission -> a chaque fois.
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(v_enc.template_version_id, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', v_enc.encounter_type);
  end if;

  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.encounter
  set data = v_new,
      validation_status = coalesce(p_validation_status, v_enc.validation_status),
      age_value = v_age,
      updated_at = now()
  where id = p_encounter_id
  returning * into v_enc;

  return v_enc;
end $$;

-- -----------------------------------------------------------------------------
-- 5. update_patient : regles A et B sur le statut FINAL.
-- -----------------------------------------------------------------------------
create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pat public.patient; v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_pat from public.patient
   where id = p_patient_id and deleted_at is null for update;
  if not found then raise exception 'Patient introuvable'; end if;

  if not public.can_edit_structured_data(v_pat.base_id) then
    if not (
      public.can_create_structured_data(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
      and coalesce(p_validation_status, v_pat.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  if p_expected_version is null then
    raise exception 'CONFLIT_VERSION : version patient requise' using errcode = 'P0001';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception 'CONFLIT_VERSION : le patient a ete modifie entre-temps' using errcode = 'P0001';
  end if;

  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  -- Regle A : completude exigee si le statut final est <> 'draft'. Regle B : compte
  -- de mission -> a chaque enregistrement (aucun brouillon partiel).
  if coalesce(p_validation_status, v_pat.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_pat.base_id) then
    perform public.assert_required_complete(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  end if;

  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.patient set data = v_new,
    validation_status = coalesce(p_validation_status, v_pat.validation_status), updated_at = now()
    where id = p_patient_id returning * into v_pat;
  return v_pat;
end $$;

-- -----------------------------------------------------------------------------
-- 6. import_records_legacy : meme regle A que partout ailleurs. Le dry-run ne
--    passe pas par les triggers : la completude y est donc verifiee explicitement
--    pour que l'apercu annonce exactement ce que l'import reel appliquera (et le
--    trigger refuse aussi l'ecriture reelle). Copie de 20260616098600 avec la
--    condition portee de `p_status = 'curated'` a `p_status <> 'draft'`.
-- -----------------------------------------------------------------------------
create or replace function public.import_records_legacy(
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
      -- Regle A : completude exigee des la sortie du brouillon (dry-run inclus, pour
      -- que l'apercu annonce exactement ce que l'import reel appliquera).
      if p_status <> 'draft' then
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