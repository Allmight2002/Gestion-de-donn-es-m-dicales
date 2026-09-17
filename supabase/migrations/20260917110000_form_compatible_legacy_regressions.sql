-- =============================================================================
-- E3 : preservation des contrats d'ecriture historiques
--
-- Cette migration corrective est additive. Elle ne modifie pas la migration E3
-- deja livree : elle retablit les deux comportements historiques observes par
-- les anciens tests/clients et garde les validations strictes sur les RPC de
-- complement E3.
-- =============================================================================

-- Les brouillons et fiches `complete` historiques peuvent contenir une valeur
-- qui n'est plus valide selon la configuration actuelle (par exemple une raison
-- manquante ajoutee plus tard). La voie de complement valide explicitement son
-- patch ; le trigger ne doit pas revalider retroactivement toutes les valeurs
-- historiques avant le passage en `curated`.
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

  if tg_op = 'INSERT' then
    -- Les controles historiques restent inchanges pour une nouvelle fiche et
    -- gardent les codes d'erreur attendus par les clients actuels.
    perform public.assert_block_hidden_values(v_historical_version, v_scope, new.data);
    perform public.assert_contains_any_hidden_values(v_historical_version, v_scope, new.data);
  else
    -- Une valeur historique masquee peut rester en place tant qu'elle n'est pas
    -- reecrite par le chemin de complement E3.
    perform public.form_record_assert_no_changed_hidden_values(
      v_active_version, v_scope, old.data, new.data
    );
  end if;

  perform public.form_record_assert_known_data(
    v_historical_version, v_active_version, v_scope, new.data
  );

  -- Les validations de valeur restent liees au statut clinique final. Les
  -- RPC de complement ont deja valide le patch et ne revalident pas une valeur
  -- historique absente de la definition active comme si elle etait nouvelle.
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(v_historical_version, v_scope, new.data);
    if v_active_version is distinct from v_historical_version then
      perform public.assert_data_valid(v_active_version, v_scope, new.data);
    end if;
  end if;

  -- Les obligations de la fiche restent celles de sa revision historique.
  -- Les nouveaux requis sont exposes dans le contexte comme obligations
  -- courantes, sans transformer retrospectivement complete/curated en erreur.
  if new.validation_status <> 'draft' then
    if v_scope = 'patient' then
      perform public.assert_required_complete(v_historical_version, 'patient', new.data);
    else
      perform public.assert_required_complete(
        v_historical_version, 'encounter', new.data, new.encounter_type
      );
    end if;
  end if;

  if new.validation_status = 'curated' then
    perform public.assert_validation_rules(v_historical_version, new.data);
    -- Pour une fiche nee dans la definition active, le filet historique reste
    -- strict. Pour une fiche ancienne, une valeur masquee preexistante ne doit
    -- pas etre effacee pour rendre la nouvelle definition lisible.
    if v_active_version is not distinct from v_historical_version then
      perform public.assert_no_hidden_values(v_historical_version, v_scope, new.data);
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.assert_curated_complete() from public, anon, authenticated;

-- Les signatures legacy envoient un objet complet. Elles conservent les champs
-- actifs nouvellement ajoutes, mais gardent aussi le refus historique lorsqu'un
-- payload contient une valeur sous un bloc actuellement masque. Le chemin E3
-- par patch continue d'autoriser la conservation d'une valeur historique non
-- modifiee et n'utilise pas ces deux gardes globales.
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
  if coalesce(p_validation_status, v_pat.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_pat.base_id) then
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
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type
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

revoke all on function public.update_encounter(uuid, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.update_encounter(uuid, jsonb, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
