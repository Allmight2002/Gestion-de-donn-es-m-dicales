-- =============================================================================
-- 20261012090000_record_widened_option_lists.sql
--
-- POURQUOI. Apres une evolution de formulaire qui AJOUTE une option a une liste (choix
-- unique ou multiple), un dossier rattache a la version precedente ne pouvait plus etre
-- modifie sur cette variable, meme pour choisir une option deja existante :
--   * `form_record_field_compatible` exigeait des listes IDENTIQUES entre la definition
--     historique du dossier et la definition active : refus FORM_VALUE_CONVERSION_REQUIRED
--     (`definition_changed`, action « recharger »), qui revenait a chaque rechargement ;
--   * chaque enregistrement valide aussi les donnees contre la version HISTORIQUE, qui ne
--     connait pas la nouvelle option.
-- La lecture (`form_record_context_json`) traitait deja la variable comme modifiable et
-- l'ecran proposait la nouvelle option : seule l'ecriture refusait.
--
-- CORRECTION.
--   1. `form_record_field_compatible` : la liste active peut CONTENIR strictement la liste
--      historique (options ajoutees). Les libelles et l'etat actif des options sont de la
--      presentation. Tout autre ecart reste une conversion refusee.
--   2. `form_record_historical_data` (nouvelle) : pour la validation HISTORIQUE, retire des
--      donnees les variables dont la version active a seulement elargi la liste. Ces
--      variables restent entierement validees contre la version ACTIVE, qui est toujours
--      controlee juste apres par les memes fonctions.
--   3. Les cinq chemins d'ecriture d'un dossier existant (`update_patient`,
--      `update_patient_compatible`, `update_encounter`, `update_encounter_compatible`,
--      declencheur `assert_curated_complete`) sont recopies de leur derniere definition ;
--      seule la ligne de validation historique change.
-- Un retrait d'option, un changement de type, de bornes, d'unite ou de raisons de valeur
-- manquante restent refuses comme avant. La creation d'un dossier n'est pas concernee :
-- elle valide contre la version courante seule.
--
-- ADDITIVE. `create or replace` conserve proprietaires, grants et revokes ; aucune ligne
-- n'est lue pour etre reecrite. Retour arriere : reappliquer les definitions de
-- 20260916140000 (compatibilite), 20261001140000, 20261006120000 et 20261007120000, puis
-- supprimer `form_record_historical_data`.
-- =============================================================================

-- 1. Compatibilite d'une variable entre definition historique et active -------------------
create or replace function public.form_record_field_compatible(
  p_historical public.template_field,
  p_active public.template_field
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select p_historical.id is not null
     and p_active.id is not null
     and p_historical.field_key = p_active.field_key
     and p_historical.scope = p_active.scope
     and p_historical.type = p_active.type
     and p_historical.unit is not distinct from p_active.unit
     and coalesce(p_historical.is_multiple, false) = coalesce(p_active.is_multiple, false)
     -- Options ajoutees : chaque code historique reste un code de la liste active.
     and (p_historical.allowed_values is not distinct from p_active.allowed_values
          or (jsonb_typeof(p_historical.allowed_values) = 'array'
              and jsonb_typeof(p_active.allowed_values) = 'array'
              and p_active.allowed_values @> p_historical.allowed_values))
     and p_historical.required = p_active.required
     and p_historical.min_value is not distinct from p_active.min_value
     and p_historical.max_value is not distinct from p_active.max_value
     and p_historical.allow_missing_codes = p_active.allow_missing_codes
     and coalesce(p_historical.missing_reasons, '{}'::text[])
           = coalesce(p_active.missing_reasons, '{}'::text[])
     and p_historical.formula is not distinct from p_active.formula
     and coalesce(p_historical.encounter_types, '{}'::text[])
           = coalesce(p_active.encounter_types, '{}'::text[])
$$;

-- 2. Donnees soumises a la validation historique ---------------------------------------------
create function public.form_record_historical_data(
  p_historical_version uuid,
  p_active_version uuid,
  p_scope text,
  p_data jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_data is null or jsonb_typeof(p_data) <> 'object'
      or p_active_version is null or p_active_version = p_historical_version then p_data
    else p_data - coalesce((
      select array_agg(h.field_key)
        from public.template_field h
        join public.template_field a
          on a.template_version_id = p_active_version
         and a.field_key = h.field_key
         and a.scope = h.scope
       where h.template_version_id = p_historical_version
         and h.scope = p_scope
         and h.type in ('select', 'multiselect')
         and a.type = h.type
         and jsonb_typeof(h.allowed_values) = 'array'
         and jsonb_typeof(a.allowed_values) = 'array'
         and a.allowed_values @> h.allowed_values
         and not (h.allowed_values @> a.allowed_values)
    ), '{}'::text[])
  end
$$;
revoke all on function public.form_record_historical_data(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- 3. Chemins d'ecriture d'un dossier existant -------------------------------------------------
-- update_patient (copie de 20261001140000_mission_partial_patient_drafts.sql)
create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint
)
returns public.patient
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pat public.patient;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_operation_id uuid := gen_random_uuid();
begin
  select * into v_pat
    from public.patient
   where id = p_patient_id and deleted_at is null
   for update;
  if not found then raise exception 'Patient introuvable'; end if;

  if not public.can_edit_structured_data(v_pat.base_id) then
    if not (
      public.can_create_structured_data(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
      and coalesce(p_validation_status, v_pat.validation_status) in ('draft', 'complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;

  v_justification_status := public.form_justification_status(v_pat.base_id, v_reason);
  if p_expected_version is null then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : version patient requise',
      detail = jsonb_build_object(
        'code', 'conflict_version', 'entity', 'patient', 'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : le patient a ete modifie entre-temps',
      detail = jsonb_build_object(
        'code', 'conflict_version', 'entity', 'patient', 'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;

  select b.current_template_version_id into v_active_version
    from public.base b
   where b.id = v_pat.base_id and b.deleted_at is null;
  v_active_version := coalesce(v_active_version, v_pat.template_version_id);
  v_old := coalesce(v_pat.data, '{}'::jsonb);
  v_new := public.form_record_merge_legacy_payload(
    v_pat.template_version_id, v_active_version, 'patient', v_old,
    coalesce(p_data, '{}'::jsonb)
  );

  perform public.assert_block_hidden_values(v_active_version, 'patient', v_new);
  perform public.assert_contains_any_hidden_values(v_active_version, 'patient', v_new);
  perform public.form_record_assert_known_data(
    v_pat.template_version_id, v_active_version, 'patient', v_new
  );
  perform public.assert_data_valid(v_pat.template_version_id, 'patient',
    public.form_record_historical_data(v_pat.template_version_id, v_active_version, 'patient', v_new));
  if v_active_version is distinct from v_pat.template_version_id then
    perform public.assert_data_valid(v_active_version, 'patient', v_new);
  end if;
  if coalesce(p_validation_status, v_pat.validation_status) <> 'draft' then
    perform public.assert_required_complete(
      v_pat.template_version_id, 'patient', v_new
    );
  end if;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  update public.patient
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_pat.validation_status),
         updated_at = clock_timestamp()
   where id = p_patient_id
   returning * into v_pat;

  -- Même un ancien client laisse une provenance exploitable pour la valeur
  -- courante. L'operation_id interne n'est pas exposé à ce client.
  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('patient', p_patient_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_pat.template_version_id
              and h.scope = 'patient' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_pat.template_version_id
              and h.scope = 'patient' and h.field_key = v_key
         ) then v_pat.template_version_id else v_active_version end,
         v_operation_id,
         public.form_record_value_fingerprint(v_pat.data -> v_key));
    end if;
  end loop;
  return v_pat;
end
$$;

-- update_patient_compatible (copie de 20261001140000_mission_partial_patient_drafts.sql)
create or replace function public.update_patient_compatible(
  p_base_id uuid,
  p_patient_id uuid,
  p_patch jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_record_revision bigint,
  p_record_definition_revision uuid,
  p_operation_id uuid,
  p_context_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.base;
  v_pat public.patient;
  v_operation public.record_form_operation;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_new_status text;
  v_current_fingerprint text;
  v_request_fingerprint text;
  v_receipt jsonb;
begin
  perform public.form_record_assert_read_access(p_base_id);

  if p_patient_id is null or p_operation_id is null then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'identifiers_required');
  end if;

  select * into v_pat
    from public.patient
   where id = p_patient_id
     and base_id = p_base_id
     and deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'patient_unavailable');
  end if;

  perform public.form_record_assert_write_access(
    p_base_id, v_pat.created_by, v_pat.validation_status, p_validation_status
  );

  v_request_fingerprint := public.form_preparation_fingerprint(jsonb_build_object(
    'recordKind', 'patient',
    'baseId', p_base_id,
    'recordId', p_patient_id,
    'patch', p_patch,
    'validationStatus', p_validation_status,
    'reason', p_reason,
    'expectedRecordRevision', p_expected_record_revision,
    'recordDefinitionRevision', p_record_definition_revision,
    'contextFingerprint', p_context_fingerprint
  ));

  -- Une meme operation ne peut pas etre executee deux fois en parallele, meme
  -- si les deux appels arrivent avant la creation du recu.
  perform pg_advisory_xact_lock(hashtextextended(
    'record-form:' || auth.uid()::text || ':' || p_operation_id::text, 0
  ));

  select * into v_operation
    from public.record_form_operation
   where actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_operation.request_fingerprint is distinct from v_request_fingerprint then
      perform public.form_record_error('FORM_RECORD_CONFLICT', 'operation_reused');
    end if;
    return v_operation.receipt;
  end if;

  -- Le verrou de base rend atomique la lecture de la revision de definition et
  -- le verrou de la ligne. Les deux ecritures concurrentes sur une fiche ne
  -- peuvent donc pas partager la meme expected_record_revision.
  select * into v_base
    from public.base
   where id = p_base_id and deleted_at is null
   for share;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'base_unavailable');
  end if;

  select * into v_pat
    from public.patient
   where id = p_patient_id and base_id = p_base_id and deleted_at is null
   for update;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'patient_unavailable');
  end if;
  perform public.form_record_assert_write_access(
    p_base_id, v_pat.created_by, v_pat.validation_status, p_validation_status
  );

  if p_expected_record_revision is null
     or v_pat.row_version is distinct from p_expected_record_revision then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'record_revision');
  end if;

  if p_record_definition_revision is null
     or v_pat.template_version_id is distinct from p_record_definition_revision then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'definition_revision');
  end if;

  v_active_version := coalesce(v_base.current_template_version_id, v_pat.template_version_id);
  v_current_fingerprint := public.form_record_context_fingerprint(
    'patient', v_pat.id, v_pat.row_version, v_pat.base_id,
    v_base.form_revision, v_pat.template_version_id, v_pat.data
  );
  if p_context_fingerprint is null
     or p_context_fingerprint is distinct from v_current_fingerprint then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'context_fingerprint');
  end if;

  perform public.form_record_assert_patch(
    v_pat.template_version_id, v_active_version, 'patient', p_patch, null
  );
  v_old := coalesce(v_pat.data, '{}'::jsonb);
  v_new := v_old || p_patch;
  perform public.form_record_assert_known_data(
    v_pat.template_version_id, v_active_version, 'patient', v_new
  );
  perform public.assert_data_valid(v_pat.template_version_id, 'patient',
    public.form_record_historical_data(v_pat.template_version_id, v_active_version, 'patient', v_new));
  if v_active_version is distinct from v_pat.template_version_id then
    perform public.assert_data_valid(v_active_version, 'patient', v_new);
  end if;

  v_new_status := coalesce(p_validation_status, v_pat.validation_status);
  if v_new_status <> 'draft' then
    perform public.assert_required_complete(v_pat.template_version_id, 'patient', v_new);
  end if;
  perform public.form_record_assert_no_changed_hidden_values(
    v_active_version, 'patient', v_pat.data, v_new
  );
  v_justification_status := public.form_justification_status(p_base_id, v_reason);

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (p_base_id, 'patient', p_patient_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  update public.patient
     set data = v_new,
         validation_status = v_new_status,
         updated_at = clock_timestamp()
   where id = p_patient_id
   returning * into v_pat;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(coalesce(v_new, '{}'::jsonb)) as key
    ) keys
  loop
    -- La boucle est volontairement filtree sur les valeurs changees de la
    -- mutation courante : les origines precedentes restent immuables.
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('patient', p_patient_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'patient' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'patient' and h.field_key = v_key
         ) then p_record_definition_revision else v_active_version end,
         p_operation_id,
         public.form_record_value_fingerprint(v_pat.data -> v_key));
    end if;
  end loop;

  v_receipt := jsonb_build_object(
    'recordKind', 'patient',
    'recordId', p_patient_id,
    'recordRevision', v_pat.row_version,
    'validationStatus', v_pat.validation_status,
    'operationId', p_operation_id,
    'activeRevision', v_base.form_revision,
    'recordDefinitionRevision', v_pat.template_version_id,
    'contextFingerprint', public.form_record_context_fingerprint(
      'patient', v_pat.id, v_pat.row_version, v_pat.base_id,
      v_base.form_revision, v_pat.template_version_id, v_pat.data
    )
  );
  insert into public.record_form_operation(
    actor_id, operation_id, record_kind, record_id, request_fingerprint, receipt
  ) values (
    auth.uid(), p_operation_id, 'patient', p_patient_id, v_request_fingerprint, v_receipt
  );
  return v_receipt;
end
$$;

-- update_encounter (copie de 20261006120000_occurrence_patient_context.sql)
create or replace function public.update_encounter(
  p_encounter_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns public.encounter
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enc public.encounter;
  v_base uuid;
  v_code text;
  v_dob date;
  v_age numeric;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_group_patch jsonb := '{}'::jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_operation_id uuid := gen_random_uuid();
  v_patient_id uuid;
  v_group_section_key text;
  v_patient_data jsonb;
  v_active_eval jsonb;
  v_historical_eval jsonb;
begin
  select e.patient_id, e.group_section_key into v_patient_id, v_group_section_key
    from public.encounter e
   where e.id = p_encounter_id and e.deleted_at is null;
  if v_group_section_key is not null then
    perform 1 from public.patient p where p.id = v_patient_id for share;
  end if;

  select * into v_enc
    from public.encounter
   where id = p_encounter_id and deleted_at is null
   for update;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code
    from public.patient where id = v_enc.patient_id;
  if not public.can_edit_structured_data(v_base) then
    if not (
      public.can_create_structured_data(v_base)
      and v_enc.created_by = auth.uid()
      and v_enc.validation_status = 'draft'
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft', 'complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);

  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at)
       is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using
      errcode = 'P0001',
      message = 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps',
      detail = jsonb_build_object(
        'code', 'conflict_version', 'entity', 'encounter', 'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end if;

  select b.current_template_version_id into v_active_version
    from public.base b where b.id = v_base and b.deleted_at is null;
  v_active_version := coalesce(v_active_version, v_enc.template_version_id);
  v_old := coalesce(v_enc.data, '{}'::jsonb);
  v_new := public.form_record_merge_legacy_payload(
    v_enc.template_version_id, v_active_version, 'encounter', v_old,
    coalesce(p_data, '{}'::jsonb) - 'age_at_encounter'
  );

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_group_patch := v_group_patch || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;
  perform public.form_record_assert_encounter_group_patch(
    v_base, p_encounter_id, v_enc.template_version_id, v_active_version,
    v_group_patch, v_enc.encounter_type
  );

  v_active_eval := v_new;
  v_historical_eval := v_new;
  if v_enc.group_section_key is not null then
    select p.data into v_patient_data from public.patient p where p.id = v_enc.patient_id;
    v_active_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, v_new);
    v_historical_eval := public.occurrence_evaluation_data(v_enc.template_version_id, v_patient_data, v_new);
  end if;

  perform public.assert_block_hidden_values(v_active_version, 'encounter', v_active_eval);
  perform public.assert_contains_any_hidden_values(v_active_version, 'encounter', v_active_eval);
  perform public.form_record_assert_known_data(
    v_enc.template_version_id, v_active_version, 'encounter', v_new
  );
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter',
    public.form_record_historical_data(v_enc.template_version_id, v_active_version, 'encounter', v_new));
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft' then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_historical_eval, v_enc.encounter_type, v_enc.group_section_key
    );
  end if;

  select pi.date_of_birth into v_dob
    from public.patient_identity pi
   where pi.base_id = v_base
     and pi.patient_code = v_code
     and pi.deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  update public.encounter
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_enc.validation_status),
         age_value = v_age,
         updated_at = clock_timestamp()
   where id = p_encounter_id
   returning * into v_enc;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('encounter', p_encounter_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_enc.template_version_id
              and h.scope = 'encounter' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = v_enc.template_version_id
              and h.scope = 'encounter' and h.field_key = v_key
         ) then v_enc.template_version_id else v_active_version end,
         v_operation_id,
         public.form_record_value_fingerprint(v_enc.data -> v_key));
    end if;
  end loop;
  return v_enc;
end
$$;

-- update_encounter_compatible (copie de 20261006120000_occurrence_patient_context.sql)
create or replace function public.update_encounter_compatible(
  p_base_id uuid,
  p_encounter_id uuid,
  p_patch jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_record_revision bigint,
  p_record_definition_revision uuid,
  p_operation_id uuid,
  p_context_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.base;
  v_enc public.encounter;
  v_operation public.record_form_operation;
  v_active_version uuid;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_code text;
  v_dob date;
  v_age numeric;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_new_status text;
  v_current_fingerprint text;
  v_request_fingerprint text;
  v_receipt jsonb;
  v_patient_data jsonb;
  v_old_eval jsonb;
  v_new_eval jsonb;
  v_historical_eval jsonb;
begin
  perform public.form_record_assert_read_access(p_base_id);

  if p_encounter_id is null or p_operation_id is null then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'identifiers_required');
  end if;

  select e.* into v_enc
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;

  perform public.form_record_assert_write_access(
    p_base_id, v_enc.created_by, v_enc.validation_status, p_validation_status
  );

  v_request_fingerprint := public.form_preparation_fingerprint(jsonb_build_object(
    'recordKind', 'encounter',
    'baseId', p_base_id,
    'recordId', p_encounter_id,
    'patch', p_patch,
    'validationStatus', p_validation_status,
    'reason', p_reason,
    'expectedRecordRevision', p_expected_record_revision,
    'recordDefinitionRevision', p_record_definition_revision,
    'contextFingerprint', p_context_fingerprint
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'record-form:' || auth.uid()::text || ':' || p_operation_id::text, 0
  ));

  select * into v_operation
    from public.record_form_operation
   where actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_operation.request_fingerprint is distinct from v_request_fingerprint then
      perform public.form_record_error('FORM_RECORD_CONFLICT', 'operation_reused');
    end if;
    return v_operation.receipt;
  end if;

  select * into v_base
    from public.base
   where id = p_base_id and deleted_at is null
   for share;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'base_unavailable');
  end if;

  if v_enc.group_section_key is not null then
    perform 1 from public.patient p where p.id = v_enc.patient_id for share;
  end if;

  select e.* into v_enc
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null
   for update;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;
  perform public.form_record_assert_write_access(
    p_base_id, v_enc.created_by, v_enc.validation_status, p_validation_status
  );

  if p_expected_record_revision is null
     or v_enc.record_revision is distinct from p_expected_record_revision then
    perform public.form_record_error('FORM_RECORD_CONFLICT', 'record_revision');
  end if;

  if p_record_definition_revision is null
     or v_enc.template_version_id is distinct from p_record_definition_revision then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'definition_revision');
  end if;

  v_active_version := coalesce(v_base.current_template_version_id, v_enc.template_version_id);
  v_current_fingerprint := public.form_record_context_fingerprint(
    'encounter', v_enc.id, v_enc.record_revision,
    p_base_id, v_base.form_revision, v_enc.template_version_id, v_enc.data
  );
  if p_context_fingerprint is null
     or p_context_fingerprint is distinct from v_current_fingerprint then
    perform public.form_record_error('FORM_CONTEXT_CHANGED', 'context_fingerprint');
  end if;

  perform public.form_record_assert_encounter_group_patch(
    p_base_id, p_encounter_id, v_enc.template_version_id, v_active_version,
    p_patch, v_enc.encounter_type
  );
  perform public.form_record_assert_patch(
    v_enc.template_version_id, v_active_version, 'encounter', p_patch,
    case when v_enc.group_section_key is null then v_enc.encounter_type else null end
  );
  v_old := coalesce(v_enc.data, '{}'::jsonb);
  v_new := v_old || p_patch;
  perform public.form_record_assert_known_data(
    v_enc.template_version_id, v_active_version, 'encounter', v_new
  );
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter',
    public.form_record_historical_data(v_enc.template_version_id, v_active_version, 'encounter', v_new));
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;

  v_old_eval := v_old;
  v_new_eval := v_new;
  v_historical_eval := v_new;
  if v_enc.group_section_key is not null then
    select p.data into v_patient_data from public.patient p where p.id = v_enc.patient_id;
    v_old_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, v_old);
    v_new_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, v_new);
    v_historical_eval := public.occurrence_evaluation_data(v_enc.template_version_id, v_patient_data, v_new);
  end if;

  v_new_status := coalesce(p_validation_status, v_enc.validation_status);
  if v_new_status <> 'draft' then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_historical_eval, v_enc.encounter_type, v_enc.group_section_key
    );
  end if;
  perform public.form_record_assert_no_changed_hidden_values(
    v_active_version, 'encounter', v_old_eval, v_new_eval
  );
  v_justification_status := public.form_justification_status(p_base_id, v_reason);

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value,
         changed_by, reason, justification_status, source)
      values
        (p_base_id, 'encounter', p_encounter_id, v_key, v_old -> v_key,
         v_new -> v_key, auth.uid(), v_reason, v_justification_status,
         'manual_correction');
    end if;
  end loop;

  select p.patient_code into v_code
    from public.patient p
   where p.id = v_enc.patient_id
     and p.base_id = p_base_id
     and p.deleted_at is null;
  select pi.date_of_birth into v_dob
    from public.patient_identity pi
   where pi.base_id = p_base_id
     and pi.patient_code = v_code
     and pi.deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  update public.encounter
     set data = v_new,
         validation_status = v_new_status,
         age_value = v_age,
         updated_at = clock_timestamp()
   where id = p_encounter_id
   returning * into v_enc;

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.record_field_provenance
        (record_kind, record_id, field_key, origin, captured_by, definition_revision,
         operation_id, value_fingerprint)
      values
        ('encounter', p_encounter_id, v_key,
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'encounter' and h.field_key = v_key
         ) then 'correction' else 'completion' end,
         auth.uid(),
         case when exists (
           select 1 from public.template_field h
            where h.template_version_id = p_record_definition_revision
              and h.scope = 'encounter' and h.field_key = v_key
         ) then p_record_definition_revision else v_active_version end,
         p_operation_id,
         public.form_record_value_fingerprint(v_enc.data -> v_key));
    end if;
  end loop;

  v_receipt := jsonb_build_object(
    'recordKind', 'encounter',
    'recordId', p_encounter_id,
    'recordRevision', v_enc.record_revision,
    'validationStatus', v_enc.validation_status,
    'operationId', p_operation_id,
    'activeRevision', v_base.form_revision,
    'recordDefinitionRevision', v_enc.template_version_id,
    'contextFingerprint', public.form_record_context_fingerprint(
      'encounter', v_enc.id, v_enc.record_revision, p_base_id,
      v_base.form_revision, v_enc.template_version_id, v_enc.data
    )
  );
  insert into public.record_form_operation(
    actor_id, operation_id, record_kind, record_id, request_fingerprint, receipt
  ) values (
    auth.uid(), p_operation_id, 'encounter', p_encounter_id,
    v_request_fingerprint, v_receipt
  );
  return v_receipt;
end
$$;

-- assert_curated_complete (copie de 20261007120000_occurrence_context_withdrawal.sql)
create or replace function public.assert_curated_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
  v_base_id uuid;
  v_active_version uuid;
  v_historical_version uuid := new.template_version_id;
  v_patient_data jsonb;
  v_historical_eval jsonb := new.data;
  v_active_eval jsonb := new.data;
  v_old_eval jsonb;
  v_context_erasure boolean := false;
begin
  if v_scope = 'patient' then
    v_base_id := new.base_id;
  else
    v_base_id := public.base_of_patient(new.patient_id);
  end if;

  select b.current_template_version_id into v_active_version
    from public.base b
   where b.id = v_base_id and b.deleted_at is null;
  v_active_version := coalesce(v_active_version, v_historical_version);

  if tg_op = 'UPDATE' then v_old_eval := old.data; end if;
  -- `new.group_section_key` n'existe que sur une rencontre : test imbriqué.
  if v_scope = 'encounter' then
    if new.group_section_key is not null then
      if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null
         and new.data is not distinct from old.data
         and new.validation_status is not distinct from old.validation_status then
        return new;
      end if;
      -- L74b : effacement déclaré d'une valeur masquée par la fiche. Reconnu seulement si
      -- l'écriture RETIRE des clés sans rien changer d'autre (données restantes, statut).
      v_context_erasure := tg_op = 'UPDATE'
        and coalesce(current_setting('app.context_erasure_encounter', true) = new.id::text, false)
        and old.deleted_at is null and new.deleted_at is null
        and new.validation_status is not distinct from old.validation_status
        and jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object'
        and new.data = old.data - array(
              select k from jsonb_object_keys(old.data) k where not (new.data ? k));
      v_context_erasure := coalesce(v_context_erasure, false);
      select p.data into v_patient_data
        from public.patient p where p.id = new.patient_id for share;
      v_historical_eval := public.occurrence_evaluation_data(v_historical_version, v_patient_data, new.data);
      v_active_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, new.data);
      if tg_op = 'UPDATE' then
        v_old_eval := public.occurrence_evaluation_data(v_active_version, v_patient_data, old.data);
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Les controles historiques restent inchanges pour une nouvelle fiche et
    -- gardent les codes d'erreur attendus par les clients actuels.
    perform public.assert_block_hidden_values(v_historical_version, v_scope, v_historical_eval);
    perform public.assert_contains_any_hidden_values(v_historical_version, v_scope, v_historical_eval);
  else
    -- Une valeur historique masquee peut rester en place tant qu'elle n'est pas
    -- reecrite par le chemin de complement E3.
    perform public.form_record_assert_no_changed_hidden_values(
      v_active_version, v_scope, v_old_eval, v_active_eval
    );
  end if;

  perform public.form_record_assert_known_data(
    v_historical_version, v_active_version, v_scope, new.data
  );

  -- Les validations de valeur restent liees au statut clinique final. Les
  -- RPC de complement ont deja valide le patch et ne revalident pas une valeur
  -- historique absente de la definition active comme si elle etait nouvelle.
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(v_historical_version, v_scope,
    public.form_record_historical_data(v_historical_version, v_active_version, v_scope, new.data));
    if v_active_version is distinct from v_historical_version then
      perform public.assert_data_valid(v_active_version, v_scope, new.data);
    end if;
  end if;

  -- Les obligations de la fiche restent celles de sa revision historique.
  -- Les nouveaux requis sont exposes dans le contexte comme obligations
  -- courantes, sans transformer retrospectivement complete/curated en erreur.
  -- L74b : un effacement déclaré ne rejoue pas les obligations de la version
  -- historique. Une occurrence née dans une version qui exigeait la variable, sans
  -- règle de contexte, ne peut sinon jamais perdre une valeur que la version active
  -- masque ; validée, elle ne peut pas non plus repasser en brouillon : la fiche
  -- patient resterait impossible à corriger. Tous les autres contrôles restent.
  if new.validation_status <> 'draft' and not v_context_erasure then
    if v_scope = 'patient' then
      perform public.assert_required_complete(v_historical_version, 'patient', new.data);
    else
      perform public.assert_required_complete(
        v_historical_version, 'encounter', v_historical_eval, new.encounter_type, new.group_section_key
      );
    end if;
  end if;

  if new.validation_status = 'curated' then
    perform public.assert_validation_rules(
      v_historical_version, new.data,
      public.visibility_hidden_fields(v_historical_version, v_historical_eval)
    );
    -- Pour une fiche nee dans la definition active, le filet historique reste
    -- strict. Pour une fiche ancienne, une valeur masquee preexistante ne doit
    -- pas etre effacee pour rendre la nouvelle definition lisible.
    if v_active_version is not distinct from v_historical_version then
      perform public.assert_no_hidden_values(v_historical_version, v_scope, v_historical_eval);
    end if;
  end if;
  return new;
end
$$;
