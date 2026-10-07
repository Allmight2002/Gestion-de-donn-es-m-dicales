-- =============================================================================
-- 20261006120000_occurrence_patient_context.sql
-- L74a : les variables permanentes, contexte d'AFFICHAGE des occurrences de groupe
-- répétable (docs/l74-contexte-patient-occurrences.md, §3, §3.1, §5.1 ; arbitrages
-- D1 à D3).
--
-- 1. `occurrence_evaluation_data(version, patient.data, occurrence)` : l'occurrence
--    complétée par les clés de la fiche dont la variable est de portée `patient`
--    dans CETTE version. `field_key` est unique par version, toutes portées
--    confondues : la fusion ne crée aucune collision.
-- 2. Le contexte ne sert qu'à la visibilité (§3.1). Les données fusionnées vont au
--    calcul de l'ensemble masqué, aux contrôles de complétude et aux contrôles de
--    valeurs masquées, tous filtrés par portée. Les règles bloquantes s'évaluent
--    sur l'occurrence SEULE, avec l'ensemble masqué calculé sur les données
--    fusionnées : nouvelle surcharge `assert_validation_rules(version, data,
--    hidden)`. Une règle `required` permanent → groupe reste donc inerte (D3), et
--    une règle purement patient ne bloque jamais une occurrence.
-- 3. Sites branchés (§5.1, sauf le retrait qui relève de L74b) : déclencheur
--    `assert_curated_complete` (branche occurrence), contrôles anticipés de
--    `create_encounter`, `update_encounter`, `update_encounter_compatible` (corps
--    de 20261001150000, brouillons de mission compris) et `commit_work_draft`,
--    contexte E3 `form_record_context_json`, `export_incomplete_records`,
--    `base_completion_queue_page` et `my_todo_counts`. Les rencontres ordinaires
--    (`group_section_key` nul) gardent exactement leur évaluation (D1).
-- 4. `assert_rule_structure` accepte `visible` d'une variable permanente vers une
--    variable d'un groupe répétable. Rien d'autre n'est durci (D5 : L74e).
-- 5. Concurrence : toute écriture d'occurrence lit la fiche sous `for share`
--    (déclencheurs, et RPC avant le verrou de la ligne, dans l'ordre fiche puis
--    occurrence déjà suivi par le retrait L72e). La mise à jour de la fiche attend
--    donc l'écriture de l'occurrence, ou l'inverse : aucune occurrence n'est
--    validée contre un contexte périmé.
--
-- Le contexte n'est jamais écrit dans une occurrence : seules des variables locales
-- portent les données fusionnées. Aucun message ne nomme une valeur clinique.
--
-- Retour arrière : réappliquer les définitions précédentes des fonctions redéfinies
-- ici (sources indiquées au-dessus de chacune), puis supprimer
-- `occurrence_evaluation_data` et la surcharge `assert_validation_rules(uuid, jsonb,
-- text[])`. Aucune donnée n'est à reprendre : rien n'est écrit par cette migration.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Fusion du contexte
-- -----------------------------------------------------------------------------

-- Une seule définition de la fusion. Seules les clés de portée `patient` dans la
-- version d'évaluation entrent : une valeur de visite, ou une clé inconnue de la
-- version, ne pilote jamais une occurrence.
create or replace function public.occurrence_evaluation_data(
  p_version uuid,
  p_patient_data jsonb,
  p_data jsonb
) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_data, '{}'::jsonb) || coalesce((
    select jsonb_object_agg(k.key, k.value)
      from jsonb_each(case when jsonb_typeof(p_patient_data) = 'object'
                           then p_patient_data else '{}'::jsonb end) k
     where exists (
       select 1 from public.template_field tf
        where tf.template_version_id = p_version
          and tf.field_key = k.key
          and tf.scope = 'patient'
     )
  ), '{}'::jsonb);
$$;
revoke all on function public.occurrence_evaluation_data(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.occurrence_evaluation_data(uuid, jsonb, jsonb) to authenticated;

-- Règles bloquantes avec un ensemble masqué fourni : les règles lisent `p_data`
-- (l'occurrence seule), le masquage vient des données fusionnées. Même corps que
-- `assert_validation_rules(uuid, jsonb)` (20260815090000), conservée inchangée.
create or replace function public.assert_validation_rules(p_version uuid, p_data jsonb, p_hidden text[])
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare r record;
begin
  if p_data is null then return; end if;
  for r in
    select rule, coalesce(message, 'Regle de coherence non respectee') as message
    from public.validation_rule
    where template_version_id = p_version and severity = 'block'
  loop
    if not public.rule_holds(r.rule, p_data, coalesce(p_hidden, '{}'::text[])) then
      raise exception '%', r.message;
    end if;
  end loop;
end $$;
revoke all on function public.assert_validation_rules(uuid, jsonb, text[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Contrôles anticipés des RPC d'écriture d'occurrence
-- -----------------------------------------------------------------------------

-- create_encounter : corps de 20261001150000. La fiche est déjà verrouillée
-- (`for update`) ; seule la complétude anticipée lit le contexte.
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
  v_patient_data jsonb;
  v_data jsonb := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';
begin
  select base_id, patient_code, data into v_base, v_code, v_patient_data
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
  -- L74a : une occurrence est complète au regard de `contexte ⊕ occurrence`.
  if v_status <> 'draft' then
    perform public.assert_required_complete(v_tv, 'encounter',
      case when p_group_section_key is null then v_data
           else public.occurrence_evaluation_data(v_tv, v_patient_data, v_data) end,
      p_encounter_type, p_group_section_key);
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

-- update_encounter : corps de 20261001150000 (brouillons de mission). Pour une
-- occurrence, la fiche est verrouillée `for share` AVANT la ligne, dans l'ordre suivi
-- par le retrait L72e (fiche puis occurrences) : aucun interblocage entre les deux.
-- Les contrôles anticipés de valeurs masquées et de complétude lisent le contexte ;
-- leurs codes d'erreur sont inchangés.
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
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
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
-- update_encounter_compatible : corps de 20261001150000. Pour une occurrence, la
-- fiche est verrouillée `for share` entre la base et la ligne ; la complétude
-- anticipée et le contrôle E3 des valeurs masquées modifiées lisent le contexte
-- (ancienne et nouvelle valeur fusionnées avec la MÊME fiche : une clé du contexte
-- n'apparaît jamais comme modifiée).
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
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
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
-- commit_work_draft : corps de 20260922010919. La projection serveur retire les
-- réponses masquées ; pour la correction d'une occurrence, le masquage se calcule sur
-- `contexte ⊕ brouillon` (sinon une variable révélée par la fiche serait retirée en
-- silence). Seules les valeurs du brouillon sont transmises : le contexte n'est
-- jamais écrit.
create or replace function public.commit_work_draft(p_id uuid, p_expected_revision bigint, p_operation_id uuid, p_identity jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_d public.work_draft; v_op public.work_draft_operation; v_hash text; v_receipt jsonb;
  v_values jsonb; v_patient public.patient; v_encounter public.encounter; v_status text;
  v_type text; v_inactive text[];
  v_patient_id uuid; v_group_section_key text; v_patient_data jsonb; v_eval jsonb;
begin
  if auth.uid() is null then perform public.work_draft_error('DRAFT_FORBIDDEN'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 81726));
  select * into v_d from public.work_draft where id = p_id for update;
  if not found or v_d.owner_id is distinct from auth.uid()
     or not public.can_create_structured_data(v_d.base_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if p_operation_id is null or p_expected_revision is null
     or (p_identity is not null and (v_d.kind <> 'patient_create' or jsonb_typeof(p_identity) <> 'object'
       or octet_length(p_identity::text) > 16384
       or exists (select 1 from jsonb_object_keys(p_identity) k where k not in ('fullName','dateOfBirth','phone','address','externalIdentifier')))) then
    perform public.work_draft_error('DRAFT_INVALID');
  end if;
  v_hash := encode(digest(jsonb_build_array('commit', p_id, p_expected_revision, p_identity)::text, 'sha256'), 'hex');
  select * into v_op from public.work_draft_operation where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.work_draft_error('DRAFT_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;
  if not public.work_draft_allowed(v_d.owner_id, v_d.base_id, v_d.kind, v_d.target_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if v_d.state <> 'active' or v_d.expires_at <= clock_timestamp() then perform public.work_draft_error('DRAFT_CLOSED'); end if;
  if v_d.revision <> p_expected_revision then perform public.work_draft_error('DRAFT_CONFLICT'); end if;
  -- Fiche puis occurrence : `assert_work_draft_context` verrouille la ligne, la fiche
  -- d'une occurrence est donc verrouillée `for share` avant lui.
  if v_d.kind = 'encounter_update' then
    select e.patient_id, e.group_section_key into v_patient_id, v_group_section_key
      from public.encounter e where e.id = v_d.target_id;
    if v_group_section_key is not null then
      select p.data into v_patient_data from public.patient p where p.id = v_patient_id for share;
    end if;
  end if;
  perform public.assert_work_draft_context(v_d.base_id, v_d.kind, v_d.target_id, v_d.template_version_id, v_d.entity_revision);
  -- Recompute the actual projection on the server; retained inapplicable answers never
  -- reach clinical calculations, completeness, history or exports.
  v_values := v_d.payload -> 'values';
  if v_d.kind in ('encounter_create', 'encounter_update') then
    if v_d.kind = 'encounter_create' then v_type := v_d.payload ->> 'encounterType';
    else select encounter_type into v_type from public.encounter where id = v_d.target_id; end if;
    select coalesce(array_agg(field_key), '{}'::text[]) into v_inactive from public.template_field
      where template_version_id = v_d.template_version_id and scope = 'encounter'
        and cardinality(encounter_types) > 0 and not (v_type = any(encounter_types));
    v_values := v_values - v_inactive;
  end if;
  v_eval := v_values;
  if v_group_section_key is not null then
    v_eval := public.occurrence_evaluation_data(v_d.template_version_id, v_patient_data, v_values);
  end if;
  v_values := v_values - public.visibility_hidden_fields(v_d.template_version_id, v_eval);
  v_status := coalesce(v_d.payload ->> 'status', 'draft');
  if v_d.kind = 'patient_create' then
    select * into v_patient from public.create_patient(v_d.base_id, null,
      p_identity ->> 'fullName', nullif(p_identity ->> 'dateOfBirth','')::date, p_identity ->> 'phone',
      p_identity ->> 'address', p_identity ->> 'externalIdentifier', v_values);
    v_receipt := jsonb_build_object('id', v_patient.id, 'code', v_patient.patient_code, 'version', v_patient.row_version, 'updatedAt', v_patient.updated_at);
  elsif v_d.kind = 'patient_update' then
    select * into v_patient from public.patient where id = v_d.target_id;
    if v_patient.validation_status = 'curated' and v_status <> 'curated' then perform public.work_draft_error('DRAFT_INVALID'); end if;
    select * into v_patient from public.update_patient(v_d.target_id, v_values, v_status,
      v_d.payload ->> 'reason', v_d.entity_revision::bigint);
    v_receipt := jsonb_build_object('id', v_patient.id, 'version', v_patient.row_version, 'updatedAt', v_patient.updated_at);
  elsif v_d.kind = 'encounter_create' then
    select * into v_encounter from public.create_encounter(v_d.target_id, v_d.payload ->> 'encounterType',
      (v_d.payload ->> 'encounterDate')::date, v_status, v_values, coalesce(v_d.payload ->> 'ageUnit', 'years'));
    v_receipt := jsonb_build_object('id', v_encounter.id, 'updatedAt', v_encounter.updated_at);
  else
    select * into v_encounter from public.encounter where id = v_d.target_id;
    if v_encounter.validation_status = 'curated' and v_status <> 'curated' then perform public.work_draft_error('DRAFT_INVALID'); end if;
    select * into v_encounter from public.update_encounter(v_d.target_id, v_values, v_status,
      v_d.payload ->> 'reason', to_timestamp(v_d.entity_revision::numeric / 1000));
    v_receipt := jsonb_build_object('id', v_encounter.id, 'updatedAt', v_encounter.updated_at);
  end if;
  update public.work_draft set payload = '{}', result = v_receipt, state = 'consumed', revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  insert into public.work_draft_operation values (auth.uid(), p_operation_id, p_id, v_hash, v_receipt);
  return v_receipt;
exception when others then
  if sqlerrm like 'DRAFT_%' then raise; end if;
  perform public.work_draft_error('DRAFT_VALIDATION');
end $$;
-- -----------------------------------------------------------------------------
-- 3. Déclencheurs d'écriture d'occurrence
-- -----------------------------------------------------------------------------

-- assert_curated_complete : corps de 20260918191752. Branche occurrence
-- (`group_section_key` renseigné) : la fiche est lue `for share`, et chaque contrôle
-- reçoit `contexte ⊕ occurrence` dans SA version d'évaluation, sauf :
--   * les valeurs connues et leur validation, qui portent sur l'occurrence seule ;
--   * les règles bloquantes, évaluées sur l'occurrence seule avec l'ensemble masqué
--     calculé sur les données fusionnées (§3.1 : `required` permanent → groupe reste
--     inerte, une règle purement patient ne bloque pas une occurrence).
-- La suppression douce pure d'une occurrence (données et statut inchangés) n'est pas
-- une écriture de contenu : elle ne rejoue pas ces contrôles, qui dépendent désormais
-- d'une fiche que l'écriture ne modifie pas (sinon un changement de contexte rendrait
-- une occurrence impossible à supprimer, y compris par le retrait L72e).
-- Fiche patient et rencontres ordinaires : évaluation inchangée.
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
-- guard_group_occurrence_block_visible : corps de 20260924090000. La fiche était
-- lue sans verrou : elle l'est désormais `for share`, comme dans le reste de la
-- branche occurrence. Une mise à jour concurrente de la fiche attend l'écriture.
create or replace function public.guard_group_occurrence_block_visible()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_id uuid;
  v_data jsonb;
  v_version_id uuid;
begin
  if new.group_section_key is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then return new; end if;
    if new.data is not distinct from old.data
       and new.validation_status is not distinct from old.validation_status
       and new.encounter_date is not distinct from old.encounter_date then
      return new;
    end if;
  end if;

  select p.base_id, p.data into v_base_id, v_data
    from public.patient p where p.id = new.patient_id for share;
  select b.current_template_version_id into v_version_id
    from public.base b where b.id = v_base_id for share;
  v_version_id := coalesce(v_version_id, new.template_version_id);

  if not public.repeatable_group_root_visible(v_version_id, new.group_section_key, v_data) then
    perform public.group_withdrawal_error('GROUP_BLOCK_HIDDEN',
      jsonb_build_object('sectionKey', new.group_section_key,
        'blockKey', public.repeatable_group_block_key(v_version_id, new.group_section_key)));
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Lecture et complétude
-- -----------------------------------------------------------------------------

-- form_record_context_json : corps de 20260919110000. Pour une occurrence, le
-- contexte E3 (variables masquées, obligations, complétude) est calculé sur
-- `contexte ⊕ occurrence`, avec les clés permanentes de la version historique et de
-- la version active. Les valeurs rendues restent celles des variables de rencontre :
-- aucune valeur de la fiche n'entre dans `values` ni dans les variables projetées.
create or replace function public.form_record_context_json(
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
  v_patient_data jsonb;
  v_eval jsonb := p_data;
begin
  if p_record_kind = 'encounter' then
    select e.group_section_key, p.data
      into v_group_section_key, v_patient_data
      from public.encounter e
      join public.patient p on p.id = e.patient_id
     where e.id = p_record_id
       and p.base_id = p_base_id
       and p.deleted_at is null
       and e.deleted_at is null;
    if not found then
      perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
    end if;
    if v_group_section_key is not null then
      v_eval := public.occurrence_evaluation_data(p_active_version, v_patient_data,
        public.occurrence_evaluation_data(p_historical_version, v_patient_data, p_data));
    end if;
  end if;

  v_context := public.form_record_context_json_group_context_base(
    p_record_kind,
    p_record_id,
    p_base_id,
    p_record_revision,
    p_active_revision,
    p_historical_version,
    p_active_version,
    v_eval,
    p_validation_status,
    p_created_by,
    p_created_at,
    p_encounter_type
  );

  if p_record_kind <> 'encounter' then
    return v_context;
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
-- export_incomplete_records : corps de 20260918191752. Une occurrence est
-- incomplète au regard de la fiche patient COURANTE.
create or replace function public.export_incomplete_records(p_cohort_id uuid)
returns table (record_kind text, record_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select 'patient'::text, p.id
    from public.cohort_member cm
    join public.patient p on p.id = cm.patient_id
   where cm.cohort_id = p_cohort_id
     and p.deleted_at is null
     and exists (
       select 1 from public.missing_required_fields(p.template_version_id, 'patient', p.data)
     )
  union
  select 'encounter'::text, e.id
    from public.encounter e
    join public.patient p on p.id = e.patient_id
   where e.deleted_at is null
     and (
       e.id in (
         select cem.encounter_id from public.cohort_encounter_member cem
          where cem.cohort_id = p_cohort_id
       )
       or e.patient_id in (
         select cm.patient_id from public.cohort_member cm where cm.cohort_id = p_cohort_id
       )
     )
     and exists (
       select 1 from public.missing_required_fields(
         e.template_version_id, 'encounter',
         case when e.group_section_key is null then e.data
              else public.occurrence_evaluation_data(e.template_version_id, p.data, e.data) end,
         e.encounter_type, e.group_section_key
       )
     );
$$;
-- base_completion_queue_page : corps de 20261005090000. Le résumé d'une
-- occurrence reçoit `contexte ⊕ occurrence` ; patients et rencontres ordinaires
-- inchangés.
create or replace function public.base_completion_queue_page(
  p_base_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select greatest(1, least(coalesce(p_limit, 50), 500))::int as lim,
           greatest(0, coalesce(p_offset, 0))::int as off
  ),
  patients as materialized (
    select p.id, p.patient_code, p.validation_status, p.template_version_id, p.data, p.created_at
      from public.patient p
     where p.base_id = p_base_id and p.deleted_at is null
  ),
  encounters as materialized (
    select e.id, e.patient_id, p.patient_code, e.encounter_type, e.encounter_date, e.group_section_key,
           e.validation_status, e.template_version_id, e.data, e.created_at,
           p.data as patient_data
      from public.encounter e
      join patients p on p.id = e.patient_id
     where e.deleted_at is null and e.validation_status <> 'curated'
  ),
  versions as materialized (
    select v.id, public.completion_version_context(v.id) as ctx
      from (select template_version_id as id from patients where validation_status <> 'curated'
            union
            select template_version_id from encounters) v
  ),
  -- Materialise : sinon l'appel est recopie dans chaque expression qui lit le resume, et
  -- le resume de chaque dossier est calcule plusieurs fois.
  pat_summaries as materialized (
    select p.id, p.patient_code, p.validation_status, p.created_at,
           public.record_completion_summary_in_context(v.ctx, 'patient', p.data) as v
      from patients p
      left join versions v on v.id = p.template_version_id
     where p.validation_status <> 'curated'
  ),
  enc_summaries as materialized (
    select e.id, e.patient_id, e.patient_code, e.encounter_type, e.encounter_date,
           e.validation_status, e.created_at,
           public.record_completion_summary_in_context(
             v.ctx, 'encounter',
             case when e.group_section_key is null then e.data
                  else public.occurrence_evaluation_data(e.template_version_id, e.patient_data, e.data) end,
             e.encounter_type, e.group_section_key) as v
      from encounters e
      left join versions v on v.id = e.template_version_id
  ),
  pat_items as (
    select jsonb_build_object(
        'kind', 'patient', 'patientId', p.id, 'code', p.patient_code, 'status', p.validation_status,
        'missing', p.v -> 'missing', 'filledFields', p.v -> 'filled', 'displayedFields', p.v -> 'displayed'
      ) as item,
      p.patient_code as code, 0 as rank, p.created_at
    from pat_summaries p
    where (p.v ->> 'needsCompletion')::boolean
  ),
  enc_items as (
    select jsonb_build_object(
        'kind', 'encounter', 'patientId', e.patient_id, 'encounterId', e.id, 'code', e.patient_code,
        'encounterType', e.encounter_type, 'encounterDate', e.encounter_date, 'status', e.validation_status,
        'missing', e.v -> 'missing', 'filledFields', e.v -> 'filled', 'displayedFields', e.v -> 'displayed'
      ) as item,
      e.patient_code as code, 1 as rank, e.created_at
    from enc_summaries e
    where (e.v ->> 'needsCompletion')::boolean
  ),
  all_items as materialized (
    select * from pat_items
    union all
    select * from enc_items
  ),
  page_items as (
    select a.*
      from all_items a, params
     order by a.code, a.rank, a.created_at
     limit (select lim from params)
     offset (select off from params)
  ),
  total_count as (
    select count(*)::int as n from all_items
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(p.item order by p.code, p.rank, p.created_at) from page_items p), '[]'::jsonb),
    'total', (select n from total_count),
    'limit', (select lim from params),
    'offset', (select off from params),
    'hasMore', ((select off from params) + (select lim from params) < (select n from total_count))
  );
$$;
-- my_todo_counts : corps de 20261005090000, même branchement que la file.
create or replace function public.my_todo_counts()
returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with editable as (
    select b.id as base_id, b.owner_user_id = auth.uid() as is_owner
    from public.base b
    where b.deleted_at is null
      and public.can_edit_structured_data(b.id)
  ),
  versions as materialized (
    select v.id, public.completion_version_context(v.id) as ctx
      from (
        select p.template_version_id as id
          from public.patient p
          join editable ed on ed.base_id = p.base_id
         where p.deleted_at is null and p.validation_status <> 'curated'
        union
        select e.template_version_id
          from public.encounter e
          join public.patient p on p.id = e.patient_id
          join editable ed on ed.base_id = p.base_id
         where p.deleted_at is null and e.deleted_at is null and e.validation_status <> 'curated'
      ) v
  ),
  counts as (
    select ed.base_id,
           least(incomplete_patients.n + incomplete_encounters.n, 100) as incomplete,
           clarifications.n as clarifications,
           least(pending_patients.n + pending_encounters.n, 100) as pending_codings
    from editable ed
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.patient p
        left join versions v on v.id = p.template_version_id
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and p.validation_status <> 'curated'
          and (public.record_completion_summary_in_context(v.ctx, 'patient', p.data)
                 ->> 'needsCompletion')::boolean
        limit 100
      ) found
    ) incomplete_patients
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        left join versions v on v.id = e.template_version_id
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and e.deleted_at is null
          and e.validation_status <> 'curated'
          and (public.record_completion_summary_in_context(
                 v.ctx, 'encounter',
                 case when e.group_section_key is null then e.data
                      else public.occurrence_evaluation_data(e.template_version_id, p.data, e.data) end,
                 e.encounter_type, e.group_section_key)
                 ->> 'needsCompletion')::boolean
        limit 100
      ) found
    ) incomplete_encounters
    cross join lateral (
      select count(*)::int as n
      from public.curation_task t
      where ed.is_owner
        and t.base_id = ed.base_id
        and t.deleted_at is null
        and t.status = 'clarification_requested'
    ) clarifications
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.patient p
        join public.template_field tf
          on tf.template_version_id = p.template_version_id
         and tf.scope = 'patient' and tf.type = 'terminology'
        cross join lateral jsonb_array_elements(
          case jsonb_typeof(p.data -> tf.field_key)
            when 'array' then p.data -> tf.field_key
            when 'object' then jsonb_build_array(p.data -> tf.field_key)
            else '[]'::jsonb
          end) el(entry)
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and p.validation_status <> 'curated'
          and p.data ? tf.field_key
          and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
        limit 100
      ) found
    ) pending_patients
    cross join lateral (
      select count(*)::int as n from (
        select 1
        from public.encounter e
        join public.patient p on p.id = e.patient_id
        join public.template_field tf
          on tf.template_version_id = e.template_version_id
         and tf.scope = 'encounter' and tf.type = 'terminology'
         and (tf.encounter_types is null or cardinality(tf.encounter_types) = 0
              or e.encounter_type = any(tf.encounter_types))
        cross join lateral jsonb_array_elements(
          case jsonb_typeof(e.data -> tf.field_key)
            when 'array' then e.data -> tf.field_key
            when 'object' then jsonb_build_array(e.data -> tf.field_key)
            else '[]'::jsonb
          end) el(entry)
        where p.base_id = ed.base_id
          and p.deleted_at is null
          and e.deleted_at is null
          and e.validation_status <> 'curated'
          and e.data ? tf.field_key
          and (el.entry -> 'coding' ->> 'status') in ('unmatched', 'suggested')
        limit 100
      ) found
    ) pending_encounters
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'baseId', base_id,
      'incomplete', incomplete,
      'clarifications', clarifications,
      'pendingCodings', pending_codings
    ) order by base_id), '[]'::jsonb)
  from counts
  where incomplete > 0 or clarifications > 0 or pending_codings > 0;
$$;

-- -----------------------------------------------------------------------------
-- 5. Contrat des règles (D2)
-- -----------------------------------------------------------------------------

-- assert_rule_structure : corps de 20260918191752. Une seule exception au refus des
-- portées mélangées : `visible` d'une variable permanente vers une variable d'un
-- groupe répétable, évaluée sur `contexte ⊕ occurrence`. Les autres cas inter-fiches
-- (variable de visite ordinaire, cible permanente) restent refusés avec le même
-- message ; aucun autre durcissement ici (D5 : L74e).
create or replace function public.assert_rule_structure(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  op                 text;
  lf                 text;
  rf                 text;
  cf                 text;
  tf                 text;
  ts                 text;
  thenop             text;
  cf_scope           text;
  tf_scope           text;
  target_parent      uuid;
  target_repeatable  boolean;
  target_has_field   boolean;
  target_has_section boolean;
  driver             public.template_field;
  configured         jsonb;
  v_release_id       uuid;
  item               jsonb;
  ok_ops             text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  ok_if_ops          text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in','contains_any'];
  ok_then            text[] := array['required','visible'];
begin
  if p_rule is null or jsonb_typeof(p_rule) is distinct from 'object' then
    raise exception 'Structure de regle invalide';
  end if;

  -- Le format contains_any ne peut pas être reinterpreté comme une comparaison ou une
  -- condition composite. La cible de visibilité peut toutefois être un champ OU un bloc.
  if p_rule ? 'if' and p_rule -> 'if' ->> 'operator' = 'contains_any' then
    if p_rule ?| array['operator', 'left_field', 'right_field']
       or jsonb_typeof(p_rule -> 'if' -> 'field') is distinct from 'string'
       or exists (
         select 1 from jsonb_object_keys(p_rule -> 'if') k
          where k not in ('field', 'operator', 'value', 'terminologyReleaseId')
       ) then
      raise exception 'contains_any : une seule condition de champ est autorisee pour "%"',
        coalesce(p_rule -> 'if' ->> 'field', '?');
    end if;
  end if;

  if p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field' then
    op := p_rule ->> 'operator';
    if op is null or not (op = any(ok_ops)) then
      raise exception 'Operateur de regle invalide : %', op;
    end if;
    lf := p_rule ->> 'left_field';
    rf := p_rule ->> 'right_field';
    if not exists (
      select 1 from public.template_field
       where template_version_id = p_version_id and field_key = lf
    ) then
      raise exception 'Champ inconnu dans la regle : %', lf;
    end if;
    if not exists (
      select 1 from public.template_field
       where template_version_id = p_version_id and field_key = rf
    ) then
      raise exception 'Champ inconnu dans la regle : %', rf;
    end if;
    return;
  end if;

  if not (p_rule ? 'if' and p_rule ? 'then')
     or jsonb_typeof(p_rule -> 'if') is distinct from 'object'
     or jsonb_typeof(p_rule -> 'then') is distinct from 'object' then
    raise exception 'Structure de regle invalide (attendu {operator,left_field,right_field} ou {if,then})';
  end if;

  op := p_rule -> 'if' ->> 'operator';
  cf := p_rule -> 'if' ->> 'field';
  thenop := p_rule -> 'then' ->> 'operator';
  target_has_field := p_rule -> 'then' ? 'field';
  target_has_section := p_rule -> 'then' ? 'section';

  if op is null or not (op = any(ok_if_ops)) then
    raise exception 'Operateur conditionnel invalide : %', op;
  end if;
  if thenop is null or not (thenop = any(ok_then)) then
    raise exception 'La clause then doit etre operator=required ou operator=visible';
  end if;
  if target_has_field and target_has_section then
    raise exception 'Une regle ne peut cibler a la fois un champ et un bloc';
  end if;
  if target_has_field and jsonb_typeof(p_rule -> 'then' -> 'field') is distinct from 'string' then
    raise exception 'La cible then.field doit etre une chaine';
  end if;
  if target_has_section and jsonb_typeof(p_rule -> 'then' -> 'section') is distinct from 'string' then
    raise exception 'La cible then.section doit etre une chaine';
  end if;
  if target_has_section and thenop <> 'visible' then
    raise exception 'Une cible de bloc n''accepte que l''operateur visible';
  end if;
  if (not target_has_field) and (not target_has_section) then
    raise exception 'La clause then doit cibler un champ ou un bloc';
  end if;
  if cf is null or not exists (
    select 1 from public.template_field
     where template_version_id = p_version_id and field_key = cf
  ) then
    raise exception 'Champ inconnu dans la regle (if) : %', coalesce(cf, '?');
  end if;
  select scope into cf_scope
    from public.template_field
   where template_version_id = p_version_id and field_key = cf;

  if p_rule -> 'if' ? 'terminologyReleaseId' and op <> 'contains_any' then
    raise exception 'Release terminologique interdite pour "%"', cf;
  end if;

  -- Validation versionnée de contains_any, inchangée pour les cibles champ et bloc.
  if op = 'contains_any' then
    select * into driver
      from public.template_field
     where template_version_id = p_version_id and field_key = cf;
    if driver.type not in ('select', 'multiselect', 'terminology') then
      raise exception 'contains_any : type de pilote non autorise pour "%"', driver.label;
    end if;
    configured := p_rule -> 'if' -> 'value';
    if jsonb_typeof(configured) is distinct from 'array' then
      raise exception 'contains_any : liste de codes requise pour "%"', driver.label;
    end if;
    if jsonb_array_length(configured) = 0 then
      raise exception 'contains_any : liste vide pour "%"', driver.label;
    end if;
    if exists (
      select 1 from jsonb_array_elements(configured) e
       where jsonb_typeof(e) <> 'string'
          or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = ''
    ) then
      raise exception 'contains_any : code invalide pour "%"', driver.label;
    end if;
    if (select count(distinct e) from jsonb_array_elements(configured) e) <> jsonb_array_length(configured) then
      raise exception 'contains_any : codes dupliques pour "%"', driver.label;
    end if;
    if driver.type = 'terminology' then
      if jsonb_typeof(p_rule -> 'if' -> 'terminologyReleaseId') is distinct from 'string'
         or (p_rule -> 'if' ->> 'terminologyReleaseId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'contains_any : release terminologique explicite requise pour "%"', driver.label;
      end if;
      v_release_id := (p_rule -> 'if' ->> 'terminologyReleaseId')::uuid;
      if not exists (select 1 from public.terminology_release r where r.id = v_release_id) then
        raise exception 'contains_any : release terminologique inconnue pour "%"', driver.label;
      end if;
    elsif p_rule -> 'if' ? 'terminologyReleaseId' then
      raise exception 'contains_any : release terminologique interdite pour "%"', driver.label;
    end if;
    for item in select value from jsonb_array_elements(configured) loop
      if driver.type = 'terminology' then
        if not exists (
          select 1 from public.terminology_concept c
           where c.release_id = v_release_id and c.code = item #>> '{}' and c.is_selectable
        ) then
          raise exception 'contains_any : code absent de la release pour "%"', driver.label;
        end if;
      elsif not coalesce(driver.allowed_values @> jsonb_build_array(item), false) then
        raise exception 'contains_any : code absent des options pour "%"', driver.label;
      end if;
    end loop;
  end if;

  if target_has_field then
    tf := p_rule -> 'then' ->> 'field';
    select scope into tf_scope
      from public.template_field
     where template_version_id = p_version_id and field_key = tf;
    if tf is null or tf_scope is null then
      raise exception 'Champ inconnu dans la regle (then) : %', coalesce(tf, '?');
    end if;

    if thenop = 'visible' then
      if cf = tf then
        raise exception 'Regle d''affichage : une variable ne peut pas commander son propre affichage';
      end if;
      if cf_scope <> tf_scope and not (
        cf_scope = 'patient' and tf_scope = 'encounter' and exists (
          select 1
            from public.template_section s
           cross join lateral public.template_section_field_keys(p_version_id, s.section_key) k
           where s.template_version_id = p_version_id
             and s.is_repeatable
             and k.field_key = tf
        )
      ) then
        raise exception 'Regle d''affichage : les deux variables doivent appartenir a la meme fiche (patient ou visite)';
      end if;
    end if;
  else
    ts := p_rule -> 'then' ->> 'section';
    select parent_section_id, is_repeatable into target_parent, target_repeatable
      from public.template_section
     where template_version_id = p_version_id and section_key = ts;
    if not found then
      raise exception 'Section cible inconnue dans la regle : %', coalesce(ts, '?');
    end if;
    if target_parent is not null then
      raise exception 'Une sous-section ne peut pas porter une regle : ciblez son bloc racine';
    end if;
    -- L66 §6.5 : un groupe repetable n'est jamais la cible d'une regle de visibilite.
    -- Un groupe vide se lit de lui-meme : zero ligne. Les regles INTERNES au groupe,
    -- entre variables d'une meme occurrence, restent inchangees.
    if target_repeatable then
      raise exception 'Regle d''affichage : un groupe repetable ne peut pas etre la cible d''une regle';
    end if;
    -- Refus atomique : un bloc ne peut jamais être partiellement évalué si ses variables
    -- appartiennent à l'autre fiche (patient/rencontre).
    if exists (
      select 1
        from public.template_section_field_keys(p_version_id, ts) sf
        join public.template_field f
          on f.template_version_id = p_version_id and f.field_key = sf.field_key
       where f.scope <> cf_scope
    ) then
      raise exception 'Regle d''affichage : le bloc et son pilote doivent appartenir a la meme fiche (patient ou visite)';
    end if;
    if exists (
      select 1 from public.template_section_field_keys(p_version_id, ts) sf
       where sf.field_key = cf
    ) then
      raise exception 'Regle d''affichage : le pilote ne peut pas appartenir au bloc qu''il commande';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
