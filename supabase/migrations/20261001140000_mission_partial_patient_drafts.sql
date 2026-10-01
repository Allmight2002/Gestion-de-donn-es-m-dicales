-- =============================================================================
-- Saisie partielle de la fiche pour les comptes de mission
--
-- Décision produit (formulaires de saisie courts) : un compte de mission peut, comme
-- un médecin, enregistrer une fiche patient INCOMPLÈTE tant qu'elle reste en
-- brouillon. La complétude des champs requis reste exigée dès la soumission
-- (`complete`) puis la finalisation (`curated`), pour tout compte.
--
-- Seule la condition de complétude change ; corps recopiés des définitions en
-- vigueur (create_patient : 20260922010919 ; update_patient 5 arguments :
-- 20260917110000 ; update_patient_compatible 9 arguments : 20260916140000).
-- Signatures, droits d'exécution, autorisations (brouillon propre, mission active),
-- verrous et journalisation sont inchangés. Les rencontres gardent leur règle.
-- =============================================================================

begin;

create or replace function public.create_patient(
  p_base_id            uuid,
  p_patient_code       text,
  p_full_name          text,
  p_date_of_birth      date,
  p_phone              text,
  p_address            text,
  p_external_identifier text,
  p_permanent_data     jsonb
) returns public.patient
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_tv      uuid;
  v_patient public.patient;
  v_code    text;
  v_can_write_identity boolean;
begin
  if auth.uid() is null or not public.can_create_structured_data(p_base_id) then
    raise exception 'Acces refuse';
  end if;

  v_can_write_identity := public.can_write_identity(p_base_id);
  if not v_can_write_identity then
    if coalesce(btrim(p_full_name), '') <> ''
       or p_date_of_birth is not null
       or coalesce(btrim(p_phone), '') <> ''
       or coalesce(btrim(p_address), '') <> ''
       or coalesce(btrim(p_external_identifier), '') <> '' then
      raise exception 'Acces identite requis pour renseigner l''identite nominative';
    end if;
  end if;

  select current_template_version_id
    into v_tv
    from public.base
   where id = p_base_id and deleted_at is null
   for update;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  -- Re-validation SERVEUR (§5.4/§5.5) : bornes / listes / type des donnees permanentes.
  perform public.assert_data_valid(v_tv, 'patient', coalesce(p_permanent_data, '{}'::jsonb));

  -- Une fiche est toujours creee en brouillon : la completude n'est exigee qu'a la
  -- soumission, pour tout compte, y compris un compte de mission (saisie partielle).

  v_code := nullif(btrim(coalesce(p_patient_code, '')), '');
  if v_code is null then
    v_code := public.allocate_patient_code(p_base_id);
  end if;

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier, created_by)
  values
    (p_base_id, v_code,
     case when v_can_write_identity then p_full_name end,
     case when v_can_write_identity then p_date_of_birth end,
     case when v_can_write_identity then p_phone end,
     case when v_can_write_identity then p_address end,
     case when v_can_write_identity then p_external_identifier end,
     auth.uid());

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, v_code, v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

revoke all on function public.create_patient(uuid, text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.create_patient(uuid, text, text, date, text, text, text, jsonb) to authenticated;

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
  perform public.assert_data_valid(v_pat.template_version_id, 'patient', v_new);
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

revoke all on function public.update_patient(uuid, jsonb, text, text, bigint) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text, bigint) to authenticated;

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
  perform public.assert_data_valid(v_pat.template_version_id, 'patient', v_new);
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

revoke all on function public.update_patient_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text)
  from public, anon;
grant execute on function public.update_patient_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text)
  to authenticated;

commit;
