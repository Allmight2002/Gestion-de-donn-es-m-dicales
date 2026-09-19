-- E3/L66 : les ecritures rencontre respectent le groupe persiste de la ligne.
-- Les deux RPC de mise a jour gardent leurs signatures publiques et leurs controles E3.

create or replace function public.form_record_field_group_applicable(
  p_version_id uuid,
  p_field_key text,
  p_group_section_key text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_group_section_key is null then not exists (
      select 1
        from public.template_section s
        cross join lateral public.template_section_field_keys(p_version_id, s.section_key) k
       where s.template_version_id = p_version_id
         and s.parent_section_id is null
         and s.is_repeatable
         and k.field_key = p_field_key
    )
    else exists (
      select 1
        from public.template_section s
       where s.template_version_id = p_version_id
         and s.section_key = p_group_section_key
         and s.parent_section_id is null
         and s.is_repeatable
         and exists (
           select 1
             from public.template_section_field_keys(p_version_id, p_group_section_key) k
            where k.field_key = p_field_key
         )
    )
  end
$$;

revoke all on function public.form_record_field_group_applicable(uuid, text, text)
  from public, anon, authenticated;

create or replace function public.form_record_assert_encounter_group_patch(
  p_base_id uuid,
  p_encounter_id uuid,
  p_historical_version uuid,
  p_active_version uuid,
  p_patch jsonb,
  p_encounter_type text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_section_key text;
  v_key text;
  v_historical public.template_field;
  v_active public.template_field;
  v_field public.template_field;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.form_record_error('FORM_FIELD_UNKNOWN', 'patch_object_expected');
  end if;

  -- La portee provient toujours de la rencontre autorisee, jamais d'un champ RPC.
  select e.group_section_key
    into v_group_section_key
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    v_historical := null;
    v_active := null;
    select * into v_historical
      from public.template_field
     where template_version_id = p_historical_version
       and field_key = v_key;
    select * into v_active
      from public.template_field
     where template_version_id = p_active_version
       and field_key = v_key;

    -- Le garde s'occupe des champs definis. Le controle E3 de donnees connues
    -- conserve la responsabilite des cles inconnues sur les deux facades.
    continue when v_historical.id is null and v_active.id is null;

    if v_historical.id is not null
       and not public.form_record_field_group_applicable(
         p_historical_version, v_key, v_group_section_key
       ) then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'repeatable_group');
    end if;
    if v_active.id is not null
       and not public.form_record_field_group_applicable(
         p_active_version, v_key, v_group_section_key
       ) then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'repeatable_group');
    end if;

    -- Hors groupe, l'applicabilite du type de rencontre reste le filtre suivant.
    -- Dans une occurrence, le groupe remplace encounter_types.
    if v_group_section_key is null then
      v_field := case when v_active.id is not null then v_active else v_historical end;
      if p_encounter_type is not null
         and v_field.encounter_types is not null
         and cardinality(v_field.encounter_types) > 0
         and not (p_encounter_type = any(v_field.encounter_types)) then
        perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'encounter_type');
      end if;
    end if;
  end loop;
end
$$;

revoke all on function public.form_record_assert_encounter_group_patch(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;

-- Ajoute un indicateur d'applicabilite distinct de la raison de presentation.
-- La raison d'origine (par exemple rule_hidden) reste intacte.
alter function public.form_record_context_json(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  rename to form_record_context_json_group_context_base;

revoke all on function public.form_record_context_json_group_context_base(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;

create function public.form_record_context_json(
  p_record_kind text,
  p_record_id uuid,
  p_base_id uuid,
  p_record_revision bigint,
  p_active_revision bigint,
  p_historical_version uuid,
  p_active_version uuid,
  p_data jsonb,
  p_validation_status text,
  p_created_by uuid,
  p_created_at timestamptz,
  p_encounter_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_group_section_key text;
  v_out_of_group boolean;
begin
  v_context := public.form_record_context_json_group_context_base(
    p_record_kind,
    p_record_id,
    p_base_id,
    p_record_revision,
    p_active_revision,
    p_historical_version,
    p_active_version,
    p_data,
    p_validation_status,
    p_created_by,
    p_created_at,
    p_encounter_type
  );

  if p_record_kind <> 'encounter' then
    return v_context;
  end if;

  select e.group_section_key
    into v_group_section_key
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.id = p_record_id
     and p.base_id = p_base_id
     and p.deleted_at is null
     and e.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;

  for v_item in
    select x.value
      from jsonb_array_elements(coalesce(v_context -> 'fields', '[]'::jsonb)) x(value)
  loop
    v_key := v_item ->> 'field_key';
    v_out_of_group := false;

    if jsonb_typeof(v_item -> 'active_definition') = 'object' then
      v_out_of_group := not public.form_record_field_group_applicable(
        p_active_version, v_key, v_group_section_key
      );
    end if;
    if v_item ->> 'definition_state' = 'defined' then
      v_out_of_group := v_out_of_group or not public.form_record_field_group_applicable(
        p_historical_version, v_key, v_group_section_key
      );
    end if;

    if v_out_of_group then
      v_item := v_item || jsonb_build_object('repeatable_group_applicable', false);
    else
      v_item := v_item - 'repeatable_group_applicable';
    end if;
    v_fields := v_fields || jsonb_build_array(v_item);
  end loop;

  return v_context || jsonb_build_object('fields', v_fields);
end
$$;

revoke all on function public.form_record_context_json(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;

-- Le client historique transmet un payload complet. Seules les differences reelles
-- sont des cles de patch; une omission qui retirerait une cle hors groupe est refusee.
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
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_base) then
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

-- La facade compatible garde revision, fingerprint, droits, provenance et replay E3.
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
  if v_new_status <> 'draft' or not public.can_edit_structured_data(p_base_id) then
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

-- Le snapshot hors ligne transporte aussi la portee persistante de chaque rencontre.
-- CREATE OR REPLACE conserve la signature, le proprietaire et l'ACL de la RPC existante.
create or replace function public.download_base_snapshot(p_base_id uuid)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'base', (
      select jsonb_build_object('id', b.id, 'name', b.name, 'templateVersionId', b.current_template_version_id)
      from public.base b where b.id = p_base_id
    ),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
        'description', tf.description, 'defaultValue', tf.default_value,
        'scope', tf.scope, 'type', tf.type, 'isMultiple', tf.is_multiple,
        'displayOrder', tf.display_order,
        'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
        'allowedOptions', tf.allowed_options,
        'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
        'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
        'formula', tf.formula,
        'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ts.id, 'parentSectionKey', (select p.section_key from public.template_section p where p.id = ts.parent_section_id), 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order,
        'isRepeatable', ts.is_repeatable
      ) order by ts.display_order, ts.section_key)
      from public.template_section ts
      where ts.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sectionsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.sections)
      from (
        select ts.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', ts.id, 'parentSectionKey', (select p.section_key from public.template_section p where p.id = ts.parent_section_id), 'sectionKey', ts.section_key, 'label', ts.label,
                 'displayOrder', ts.display_order, 'isRepeatable', ts.is_repeatable
               ) order by ts.display_order, ts.section_key) as sections
        from public.template_section ts
        where ts.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by ts.template_version_id
      ) v
    ), '{}'::jsonb),
    'fieldsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.fields)
      from (
        select tf.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', tf.id, 'fieldKey', tf.field_key, 'label', tf.label,
                 'description', tf.description, 'defaultValue', tf.default_value,
                 'scope', tf.scope, 'type', tf.type, 'isMultiple', tf.is_multiple,
                 'displayOrder', tf.display_order,
                 'section', tf.section, 'unit', tf.unit, 'allowedValues', tf.allowed_values,
                 'allowedOptions', tf.allowed_options,
                 'required', tf.required, 'minValue', tf.min_value, 'maxValue', tf.max_value,
                 'allowMissingCodes', tf.allow_missing_codes, 'missingReasons', to_jsonb(tf.missing_reasons),
                 'formula', tf.formula,
                 'encounterTypes', to_jsonb(tf.encounter_types)
               ) order by tf.display_order, tf.field_key) as fields
        from public.template_field tf
        where tf.template_version_id in (
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by tf.template_version_id
      ) v
    ), '{}'::jsonb),
    'diagnosisContextByVersion', coalesce((
      select jsonb_object_agg(v.id::text, public.get_diagnosis_context(v.id))
      from public.template_version v where v.id in (
        select b.current_template_version_id from public.base b where b.id = p_base_id
        union select p.template_version_id from public.patient p where p.base_id = p_base_id and p.deleted_at is null
        union select e.template_version_id from public.encounter e join public.patient p on p.id = e.patient_id
          where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
      )
    ), '{}'::jsonb),
    'rulesByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.rules)
      from (
        select vr.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', vr.id, 'rule', vr.rule, 'message', vr.message, 'severity', vr.severity
               ) order by vr.id) as rules
        from public.validation_rule vr
        where vr.template_version_id in (
          select b.current_template_version_id from public.base b
            where b.id = p_base_id and b.current_template_version_id is not null
          union
          select p.template_version_id from public.patient p
            where p.base_id = p_base_id and p.deleted_at is null
          union
          select e.template_version_id from public.encounter e
            join public.patient p on p.id = e.patient_id
            where p.base_id = p_base_id and p.deleted_at is null and e.deleted_at is null
        )
        group by vr.template_version_id
      ) v
    ), '{}'::jsonb),
    'patients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.patient_code, 'templateVersionId', p.template_version_id,
        'data', p.data, 'validationStatus', p.validation_status,
        'encounters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'encounterType', e.encounter_type, 'encounterDate', e.encounter_date,
            'validationStatus', e.validation_status, 'ageValue', e.age_value, 'ageUnit', e.age_unit,
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id,
            'group_section_key', e.group_section_key
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;

-- Les operations hors ligne precedemment en file ne peuvent plus ecrire sur une
-- occurrence repetable. L'authentification et l'acces sont verifies avant le refus.
create or replace function public.replay_encounter_update(
  p_operation_id text,
  p_encounter_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns table(id uuid, updated_at timestamptz, replayed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_operation public.offline_encounter_operation;
  v_encounter public.encounter;
  v_base_id uuid;
  v_payload jsonb;
  v_fingerprint text;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_id is null
     or length(btrim(p_operation_id)) not between 1 and 200 then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  v_payload := jsonb_build_object(
    'encounter_id', p_encounter_id,
    'data', coalesce(p_data, '{}'::jsonb),
    'validation_status', p_validation_status,
    'reason', p_reason,
    'expected_updated_at', p_expected_updated_at
  );
  v_fingerprint := encode(
    digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || btrim(p_operation_id), 0)
  );

  select operation.* into v_operation
    from public.offline_encounter_operation operation
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id)
   for update;
  if found then
    if v_operation.request_fingerprint is distinct from v_fingerprint then
      raise exception 'OFFLINE_OPERATION_MISMATCH' using errcode = 'P0001';
    end if;
    if v_operation.completed_at is null then
      raise exception 'OFFLINE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return query select v_operation.encounter_id, v_operation.result_updated_at, true;
    return;
  end if;

  -- Preserve the serialization order: lock the encounter before inserting the receipt.
  select encounter.* into v_encounter
    from public.encounter encounter
   where encounter.id = p_encounter_id
     and encounter.deleted_at is null
   for update;
  if not found then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select patient.base_id into v_base_id
    from public.patient patient
   where patient.id = v_encounter.patient_id;
  perform public.form_record_assert_write_access(
    v_base_id, v_encounter.created_by, v_encounter.validation_status, p_validation_status
  );
  if v_encounter.group_section_key is not null then
    perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'repeatable_group');
  end if;

  insert into public.offline_encounter_operation(
    user_id, operation_id, encounter_id, request_fingerprint
  ) values (
    v_uid, btrim(p_operation_id), p_encounter_id, v_fingerprint
  );

  select * into v_encounter
    from public.update_encounter(
      p_encounter_id,
      p_data,
      p_validation_status,
      p_reason,
      p_expected_updated_at
    );

  update public.offline_encounter_operation operation
     set result_updated_at = v_encounter.updated_at,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_encounter.id, v_encounter.updated_at, false;
end
$$;
