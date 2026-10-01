-- =============================================================================
-- Saisie partielle des rencontres pour les comptes de mission
--
-- Suite de 20261001140000 (fiche patient) : un compte de mission peut aussi
-- enregistrer une rencontre — y compris une occurrence de bloc répétable —
-- INCOMPLÈTE tant qu'elle reste en brouillon. La complétude reste exigée dès la
-- soumission (`complete`) et la finalisation, pour tout compte.
--
-- Seule la condition de complétude change ; corps recopiés des définitions en
-- vigueur (create_encounter : 20260923120000 ; update_encounter et
-- update_encounter_compatible : 20260919110000), identiques au catalogue avant
-- modification. Signatures, droits d'exécution (conservés par CREATE OR REPLACE),
-- autorisations (brouillon propre, mission active), verrous et journalisation
-- sont inchangés.
-- =============================================================================

begin;

create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years',
  p_group_section_key text default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
  v_status text;
  v_section public.template_section;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null for update;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_create_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  v_status := coalesce(p_validation_status, 'draft');
  -- Promouvoir directement en 'curated' est un acte de curation, pas de saisie :
  -- reserve a can_edit_structured_data (le medecin).
  if v_status = 'curated' and not public.can_edit_structured_data(v_base) then
    raise exception 'Acces refuse';
  end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  if p_group_section_key is not null then
    select * into v_section from public.template_section
      where template_version_id = v_tv and section_key = p_group_section_key;
    if not found then raise exception 'Groupe inconnu pour cette version'; end if;
    if not v_section.is_repeatable then
      raise exception 'Ce bloc n''est pas un groupe répétable';
    end if;
    p_encounter_type := 'autre';
    if (select count(*) from public.encounter where patient_id = p_patient_id
        and group_section_key = p_group_section_key and deleted_at is null) >= 50 then
      raise exception 'Nombre maximal d''occurrences atteint pour ce groupe';
    end if;
  end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : memes bornes/listes/type que le moteur React.
  perform public.assert_data_valid(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter');
  -- Regle A : completude exigee des la sortie du brouillon ('complete'), pour tous
  -- les comptes. Regle B : compte de mission -> exigee a chaque enregistrement.
  if v_status <> 'draft' then
    perform public.assert_required_complete(v_tv, 'encounter', coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', p_encounter_type, p_group_section_key);
  end if;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by, group_section_key)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', v_status, auth.uid(), p_group_section_key)
  returning * into v_enc;

  return v_enc;
end $$;

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
begin
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

  perform public.assert_block_hidden_values(v_active_version, 'encounter', v_new);
  perform public.assert_contains_any_hidden_values(v_active_version, 'encounter', v_new);
  perform public.form_record_assert_known_data(
    v_enc.template_version_id, v_active_version, 'encounter', v_new
  );
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft' then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type, v_enc.group_section_key
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
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if v_active_version is distinct from v_enc.template_version_id then
    perform public.assert_data_valid(v_active_version, 'encounter', v_new);
  end if;

  v_new_status := coalesce(p_validation_status, v_enc.validation_status);
  if v_new_status <> 'draft' then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type, v_enc.group_section_key
    );
  end if;
  perform public.form_record_assert_no_changed_hidden_values(
    v_active_version, 'encounter', v_old, v_new
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

commit;
