-- =============================================================================
-- 20261004170000_form_preparation_group_attributes.sql
-- Application d'une preparation de formulaire sur un jeu de variables qui porte
-- un groupe repetable.
--
-- `apply_form_preparation` (20260916130000) precede les groupes repetables
-- (20260918191752, 20260923120000, 20261001101500) : elle recreait chaque
-- section sans `is_repeatable`, `add_label` ni `item_label`. Consequences :
--   * avec des occurrences vivantes, le changement de version de la base etait
--     refuse par `trg_base_version_group_withdrawal`, et l'utilisateur ne voyait
--     que FORM_PREPARATION_APPLY_FAILED, par exemple pour un simple ajout de
--     variable ;
--   * sans occurrence, la nouvelle version perdait silencieusement le caractere
--     repetable du bloc et ses libelles.
--
-- Correction :
--   1. `form_preparation_source_definition` expose `isRepeatable`, `addLabel` et
--      `itemLabel` d'une section, uniquement quand ils sont renseignes. L'empreinte
--      d'un formulaire sans groupe repetable est donc inchangee ; celle d'un
--      formulaire qui en porte change, et une preparation ouverte dessus passe en
--      conflit avec son contenu preserve (reprise explicite).
--   2. Une preparation creee avant cette migration ne porte pas ces cles. La
--      classification considere une cle absente du candidat comme inchangee pour
--      une section existante : sa reprise reste additive. Toute valeur differente
--      reste semantique, comme toute autre propriete de section.
--   3. `apply_form_preparation` reprend ces attributs de la section source de
--      meme cle ; une nouvelle section reste non repetable, comme avant. Une
--      variable placee dans un groupe repetable doit etre de portee rencontre : le
--      refus devient FORM_CHANGE_UNSUPPORTED au lieu de l'echec generique.
--
-- Retour arriere : reprendre les definitions de 20260916100000 (definition
-- source), 20260916130000 (application), supprimer le nouvel enveloppant de
-- classification et renommer `form_preparation_classify_core` en
-- `form_preparation_classify`.
--
-- `apply_form_preparation` est reprise a l'identique de 20260916130000 hors le
-- point 3 ; ses droits sont reposes a l'identique.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Definition source : attributs de groupe repetable, seulement s'ils existent
-- -----------------------------------------------------------------------------
create or replace function public.form_preparation_source_definition(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sectionKey', s.section_key,
          'label', s.label,
          'displayOrder', s.display_order,
          'parentSectionKey', p.section_key,
          'sourceSectionKey', s.source_section_key
        )
        || case when s.is_repeatable then jsonb_build_object('isRepeatable', true) else '{}'::jsonb end
        || case when s.add_label is not null then jsonb_build_object('addLabel', s.add_label) else '{}'::jsonb end
        || case when s.item_label is not null then jsonb_build_object('itemLabel', s.item_label) else '{}'::jsonb end
        order by s.display_order, s.section_key
      )
      from public.template_section s
      left join public.template_section p on p.id = s.parent_section_id
      where s.template_version_id = p_version_id
    ), '[]'::jsonb),
    'commonGroups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'groupKey', g.group_key,
          'label', g.label,
          'displayOrder', g.display_order,
          'anchorOrder', g.anchor_order,
          'isDefault', g.is_default
        ) order by g.display_order, g.anchor_order, g.group_key
      )
      from public.template_common_group g
      where g.template_version_id = p_version_id
    ), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fieldKey', f.field_key,
          'label', f.label,
          'scope', f.scope,
          'sectionKey', coalesce(s.section_key, f.section),
          'type', f.type,
          'unit', f.unit,
          'allowedValues', f.allowed_values,
          'required', f.required,
          'minValue', f.min_value,
          'maxValue', f.max_value,
          'allowMissingCodes', f.allow_missing_codes,
          'displayOrder', f.display_order,
          'encounterTypes', f.encounter_types,
          'description', f.description,
          'defaultValue', f.default_value,
          'missingReasons', f.missing_reasons,
          'allowedOptions', f.allowed_options,
          'isMultiple', f.is_multiple,
          'formula', f.formula,
          'commonGroupKey', g.group_key
        ) order by f.display_order, f.field_key
      )
      from public.template_field f
      left join public.template_section s on s.id = f.section_id
      left join public.template_common_group g on g.id = f.common_group_id
      where f.template_version_id = p_version_id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(
        jsonb_build_object('rule', r.rule, 'message', r.message, 'severity', r.severity)
        order by r.rule::text, coalesce(r.message, ''), r.severity
      )
      from public.validation_rule r
      where r.template_version_id = p_version_id
    ), '[]'::jsonb),
    'diagnosisConfiguration', coalesce(tv.diagnosis_configuration, '[]'::jsonb)
  )
  from public.template_version tv
  where tv.id = p_version_id
$$;
revoke all on function public.form_preparation_source_definition(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Classification : une cle de groupe absente d'une section candidate existante
--    vaut celle de la source (preparation anterieure a cette migration)
-- -----------------------------------------------------------------------------
-- Les appelants resolvent `form_preparation_classify` par son nom a l'execution :
-- la fonction existante est renommee, inchangee, et l'enveloppant prend son nom.
alter function public.form_preparation_classify(jsonb, jsonb) rename to form_preparation_classify_core;
revoke all on function public.form_preparation_classify_core(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.form_preparation_classify(p_source jsonb, p_candidate jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_sections jsonb;
  v_candidate jsonb := p_candidate;
begin
  if jsonb_typeof(p_candidate) = 'object'
     and jsonb_typeof(p_candidate -> 'sections') = 'array'
     and jsonb_typeof(p_source -> 'sections') = 'array' then
    v_source_sections := public.form_preparation_index_by_key(p_source -> 'sections', 'sectionKey');
    v_candidate := jsonb_set(p_candidate, '{sections}', coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(c.value) = 'object' and v_source_sections ? (c.value ->> 'sectionKey') then
            (select coalesce(jsonb_object_agg(k.key, v_source_sections -> (c.value ->> 'sectionKey') -> k.key), '{}'::jsonb)
               from unnest(array['isRepeatable','addLabel','itemLabel']) k(key)
              where not (c.value ? k.key)
                and (v_source_sections -> (c.value ->> 'sectionKey')) ? k.key)
            || c.value
          else c.value
        end
        order by c.ordinality
      )
      from jsonb_array_elements(p_candidate -> 'sections') with ordinality c(value, ordinality)
    ), '[]'::jsonb));
  end if;
  return public.form_preparation_classify_core(p_source, v_candidate);
end
$$;
revoke all on function public.form_preparation_classify(jsonb, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Application : attributs de groupe repris de la section source
-- -----------------------------------------------------------------------------
create or replace function public.apply_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source_version public.template_version;
  v_source_template public.template;
  v_source jsonb;
  v_candidate jsonb;
  v_source_fp text;
  v_content_fp text;
  v_hash text;
  v_existing jsonb;
  v_classification jsonb;
  v_impact jsonb;
  v_receipt jsonb;
  v_target_template_id uuid;
  v_target_version_id uuid;
  v_next_version int;
  v_target_base public.base;
  v_item jsonb;
  v_parent_key text;
  v_parent_id uuid;
  v_section_id uuid;
  v_group_id uuid;
  v_rule_id uuid;
  v_source_rule_id uuid;
  v_source_template_id uuid;
  v_source_field_exists boolean;
  v_source_section_exists boolean;
  v_source_section public.template_section;
  v_target_section_repeatable boolean;
  v_source_group_exists boolean;
  v_target_is_new_template boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  if p_preparation_id is null or p_expected_preparation_revision is null
     or p_expected_source_revision is null or p_expected_source_fingerprint is null
     or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;

  select * into v_row
    from public.form_preparation
   where id = p_preparation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  -- Les mutations de préparation prennent toutes le verrou de base avant celui
  -- de la ligne de préparation. La première lecture est volontairement sans
  -- verrou : elle ne fait qu'identifier la base après le contrôle de droit.
  perform public.expire_form_preparations();

  v_hash := encode(digest(convert_to(jsonb_build_array(
    'apply', p_preparation_id, p_expected_preparation_revision,
    p_expected_source_revision, p_expected_source_fingerprint
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  -- Le verrou de base rend le test de révision et le rattachement indivisibles.
  select * into v_base
    from public.base
   where id = v_row.base_id and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  if v_base.owner_user_id is distinct from auth.uid() or not public.is_medecin()
     or v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_row
    from public.form_preparation
   where id = p_preparation_id
   for update;
  if not found or v_row.base_id is distinct from v_base.id then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;

  if v_row.expires_at <= clock_timestamp()
     and v_row.state in ('active', 'ready', 'conflict') then
    update public.form_preparation
       set state = 'expired', payload = '{}'::jsonb, updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if v_row.state = 'applied' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object('reason','already_applied','preparationState',v_row.state)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','already_applied'));
    return v_receipt;
  end if;
  if v_row.state in ('discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if v_row.state = 'conflict' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object('reason','preparation_conflict','preparationState',v_row.state,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','preparation_conflict'));
    return v_receipt;
  end if;

  -- La source est verrouillee avant le fingerprint et avant toute copie. Les
  -- voies normales d'edition verrouillent aussi la version avant modification.
  select tv.* into v_source_version
    from public.template_version tv
   where tv.id = v_base.current_template_version_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  select * into v_source_template
    from public.template t
   where t.id = v_source_version.template_id
   for update;
  if not found or (not v_source_template.is_global
                   and v_source_template.owner_user_id is distinct from auth.uid()) then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;

  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if v_row.source_template_version_id is distinct from v_base.current_template_version_id
     or v_row.source_revision is distinct from v_base.form_revision
     or v_row.source_fingerprint is distinct from v_source_fp
     or p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp
     or p_expected_preparation_revision is distinct from v_row.preparation_revision then
    update public.form_preparation
       set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true,
      jsonb_build_object(
        'reason','revision_or_source_changed',
        'payloadPreserved',true,
        'currentSourceTemplateVersionId',v_base.current_template_version_id,
        'currentSourceRevision',v_base.form_revision,
        'currentSourceFingerprint',v_source_fp,
        'currentPreparationRevision',v_row.preparation_revision
      )
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply',
        'source_revision',v_base.form_revision,'source_fingerprint',v_source_fp,'payload_preserved',true));
    return v_receipt;
  end if;

  v_candidate := public.form_preparation_normalize(v_row.payload);
  v_content_fp := public.form_preparation_fingerprint(v_candidate);
  if v_row.content_fingerprint is distinct from v_content_fp then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"content_fingerprint_mismatch"}';
  end if;
  perform public.form_preparation_apply_assert_definition(v_source, v_candidate);
  v_classification := public.form_preparation_apply_classify(v_source, v_candidate);
  v_impact := public.form_preparation_apply_impact(v_row.base_id, v_source, v_candidate, v_classification);

  if v_classification ->> 'classification' in ('semantic', 'unsupported') then
    update public.form_preparation
       set classification = coalesce(v_classification ->> 'classification', 'unsupported'),
           state = 'active', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_apply_error_json(
      case when v_row.classification = 'semantic'
        then 'FORM_SEMANTIC_MIGRATION_REQUIRED' else 'FORM_CHANGE_UNSUPPORTED' end,
      v_row.id, p_operation_id, false,
      jsonb_build_object('classification',v_row.classification,'impact',v_impact,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_apply_refused', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply',
        'classification',v_row.classification,'payload_preserved',true));
    return v_receipt;
  end if;
  if v_row.state <> 'ready' then
    v_receipt := public.form_preparation_apply_error_json(
      'FORM_PREPARATION_NOT_READY', v_row.id, p_operation_id, false,
      jsonb_build_object('classification',v_classification ->> 'classification','impact',v_impact,'payloadPreserved',true)
    );
    insert into public.form_preparation_operation
      (owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_apply_refused', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id',p_operation_id,'operation_kind','apply','reason','not_ready'));
    return v_receipt;
  end if;

  -- Tous les inserts ci-dessous appartiennent a la meme transaction que le
  -- changement de base. Toute exception remonte et annule l'ensemble.
  begin
    if v_source_template.is_global
       or v_source_template.owner_user_id is distinct from auth.uid() then
      v_target_is_new_template := true;
      insert into public.template(name, specialty, owner_user_id, is_global)
      values (v_source_template.name, v_source_template.specialty, auth.uid(), false)
      returning id into v_target_template_id;
      v_next_version := 1;
    else
      v_target_template_id := v_source_template.id;
      select coalesce(max(version_number), 0) + 1 into v_next_version
        from public.template_version
       where template_id = v_target_template_id;
    end if;

    insert into public.template_version(
      template_id, version_number, status, created_by,
      derived_from_template_version_id, derived_from_preparation_id,
      derived_from_content_fingerprint, applied_operation_id, applied_at
    ) values (
      v_target_template_id, v_next_version, 'draft', auth.uid(),
      v_source_version.id, v_row.id, v_content_fp, p_operation_id, clock_timestamp()
    ) returning id into v_target_version_id;

    -- Les racines puis les sous-sections rendent le parent resolvable. La
    -- hierarchie demeure locale a la version cible.
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'sections','[]'::jsonb)) x(value)
       where x.value ->> 'parentSectionKey' is null
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'sectionKey'
    loop
      -- Les attributs de groupe repetable ne figurent pas dans la definition
      -- de preparation : ils sont repris de la section source de meme cle.
      select * into v_source_section from public.template_section
       where template_version_id = v_source_version.id and section_key = v_item ->> 'sectionKey';
      v_source_section_exists := found;
      insert into public.template_section(
        template_version_id, section_key, label, display_order,
        is_repeatable, add_label, item_label,
        source_template_version_id, source_section_key
      ) values (
        v_target_version_id, v_item ->> 'sectionKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0),
        coalesce(v_source_section.is_repeatable, false), v_source_section.add_label, v_source_section.item_label,
        case when v_source_section_exists then v_source_version.id else null end,
        case when v_source_section_exists then v_item ->> 'sectionKey' else null end
      );
    end loop;
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'sections','[]'::jsonb)) x(value)
       where x.value ->> 'parentSectionKey' is not null
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'sectionKey'
    loop
      v_parent_key := v_item ->> 'parentSectionKey';
      select id into v_parent_id from public.template_section
       where template_version_id = v_target_version_id and section_key = v_parent_key;
      if v_parent_id is null then
        raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
          detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"parent_not_copied"}';
      end if;
      -- Les attributs de groupe repetable ne figurent pas dans la definition
      -- de preparation : ils sont repris de la section source de meme cle.
      select * into v_source_section from public.template_section
       where template_version_id = v_source_version.id and section_key = v_item ->> 'sectionKey';
      v_source_section_exists := found;
      insert into public.template_section(
        template_version_id, section_key, label, display_order, parent_section_id,
        is_repeatable, add_label, item_label,
        source_template_version_id, source_section_key
      ) values (
        v_target_version_id, v_item ->> 'sectionKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0), v_parent_id,
        coalesce(v_source_section.is_repeatable, false), v_source_section.add_label, v_source_section.item_label,
        case when v_source_section_exists then v_source_version.id else null end,
        case when v_source_section_exists then v_item ->> 'sectionKey' else null end
      );
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'commonGroups','[]'::jsonb)) x(value)
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'groupKey'
    loop
      select exists (select 1 from public.template_common_group where template_version_id = v_source_version.id and group_key = v_item ->> 'groupKey')
        into v_source_group_exists;
      insert into public.template_common_group(
        template_version_id, group_key, label, display_order, anchor_order, is_default,
        source_template_version_id, source_group_key
      ) values (
        v_target_version_id, v_item ->> 'groupKey', v_item ->> 'label',
        coalesce((v_item ->> 'displayOrder')::int, 0),
        coalesce((v_item ->> 'anchorOrder')::int, 0),
        coalesce((v_item ->> 'isDefault')::boolean, false),
        case when v_source_group_exists then v_source_version.id else null end,
        case when v_source_group_exists then v_item ->> 'groupKey' else null end
      );
    end loop;

    perform set_config('app.setting_common_layout', 'on', true);
    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'fields','[]'::jsonb)) x(value)
       order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'fieldKey'
    loop
      v_section_id := null;
      v_group_id := null;
      if nullif(v_item ->> 'sectionKey', '') is not null then
        select id, is_repeatable into v_section_id, v_target_section_repeatable from public.template_section
         where template_version_id = v_target_version_id
           and section_key = v_item ->> 'sectionKey';
        -- Refus explicite plutot que l'erreur generique du declencheur.
        if v_target_section_repeatable and v_item ->> 'scope' <> 'encounter' then
          raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
            detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"repeatable_group_scope"}';
        end if;
      elsif nullif(v_item ->> 'commonGroupKey', '') is not null then
        select id into v_group_id from public.template_common_group
         where template_version_id = v_target_version_id
           and group_key = v_item ->> 'commonGroupKey';
      else
        select id into v_group_id from public.template_common_group
         where template_version_id = v_target_version_id and is_default;
      end if;

      select exists (select 1 from public.template_field where template_version_id = v_source_version.id and field_key = v_item ->> 'fieldKey')
        into v_source_field_exists;
      insert into public.template_field(
        template_version_id, field_key, label, description, default_value,
        scope, section, section_id, type, is_multiple, unit, allowed_values,
        allowed_options, required, min_value, max_value, allow_missing_codes,
        missing_reasons, formula, display_order, encounter_types, common_group_id,
        source_template_version_id, source_field_key
      ) values (
        v_target_version_id,
        v_item ->> 'fieldKey',
        v_item ->> 'label',
        v_item ->> 'description',
        case when v_item -> 'defaultValue' is null or v_item -> 'defaultValue' = 'null'::jsonb then null else v_item ->> 'defaultValue' end,
        v_item ->> 'scope',
        case when v_section_id is null then null else v_item ->> 'sectionKey' end,
        v_section_id,
        v_item ->> 'type',
        coalesce((v_item ->> 'isMultiple')::boolean, false),
        v_item ->> 'unit',
        case when jsonb_typeof(v_item -> 'allowedValues') = 'null'
          then null else v_item -> 'allowedValues' end,
        case when jsonb_typeof(v_item -> 'allowedOptions') = 'null'
          then null else v_item -> 'allowedOptions' end,
        coalesce((v_item ->> 'required')::boolean, false),
        case when v_item -> 'minValue' is null or v_item -> 'minValue' = 'null'::jsonb then null else (v_item ->> 'minValue')::numeric end,
        case when v_item -> 'maxValue' is null or v_item -> 'maxValue' = 'null'::jsonb then null else (v_item ->> 'maxValue')::numeric end,
        coalesce((v_item ->> 'allowMissingCodes')::boolean, true),
        coalesce(public.form_preparation_apply_text_array(v_item -> 'missingReasons'), array['non_fait','inconnu','non_applicable']::text[]),
        nullif(v_item ->> 'formula', ''),
        coalesce((v_item ->> 'displayOrder')::int, 0),
        public.form_preparation_apply_text_array(v_item -> 'encounterTypes'),
        v_group_id,
        case when v_source_field_exists then v_source_version.id else null end,
        case when v_source_field_exists then v_item ->> 'fieldKey' else null end
      );
    end loop;

    for v_item in
      select value from jsonb_array_elements(coalesce(v_candidate -> 'rules','[]'::jsonb)) x(value)
       order by (x.value -> 'rule')::text, coalesce(x.value ->> 'message',''), x.value ->> 'severity'
    loop
      v_source_rule_id := null;
      select id into v_source_rule_id
        from public.validation_rule
       where template_version_id = v_source_version.id
         and jsonb_build_object('rule',rule,'message',message,'severity',severity) = v_item;
      insert into public.validation_rule(
        template_version_id, rule, message, severity,
        source_template_version_id, source_validation_rule_id
      ) values (
        v_target_version_id, v_item -> 'rule', v_item ->> 'message', v_item ->> 'severity',
        case when v_source_rule_id is null then null else v_source_version.id end,
        v_source_rule_id
      );
    end loop;

    update public.template_version
       set diagnosis_configuration = coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)
     where id = v_target_version_id;
    perform public.validate_template_version_invariants(v_target_version_id);

    -- Le contexte est cree juste avant la seule bascule de base. Il rend le
    -- rattachement cross-template possible pour un modele partage, mais ne
    -- donne aucun droit durable a une ecriture directe.
    insert into public.form_preparation_application(
      owner_id, operation_id, preparation_id, base_id,
      source_template_version_id, target_template_version_id,
      source_revision, source_fingerprint, content_fingerprint, impact,
      status, transaction_id
    ) values (
      auth.uid(), p_operation_id, v_row.id, v_row.base_id,
      v_source_version.id, v_target_version_id,
      v_base.form_revision, v_source_fp, v_content_fp, v_impact,
      'applying', txid_current()
    );
    perform set_config('app.form_preparation_operation', p_operation_id::text, true);
    update public.base
       set current_template_version_id = v_target_version_id
     where id = v_base.id;
    select * into v_target_base from public.base where id = v_base.id;
    update public.form_preparation_application
       set status = 'applied', completed_at = clock_timestamp()
     where owner_id = auth.uid() and operation_id = p_operation_id;

    update public.form_preparation
       set state = 'applied',
           classification = v_classification ->> 'classification',
           updated_at = clock_timestamp(),
           payload = '{}'::jsonb
     where id = v_row.id
     returning * into v_row;

    v_receipt := jsonb_build_object(
      'preparation', public.form_preparation_json(v_row),
      'operationId', p_operation_id,
      'operationKind', 'apply',
      'audit', jsonb_build_object(
        'sourceRevision', v_base.form_revision,
        'sourceFingerprint', v_source_fp,
        'contentFingerprint', v_content_fp,
        'preparationRevision', v_row.preparation_revision,
        'state', v_row.state,
        'classification', v_row.classification
      ),
      'impact', v_impact || jsonb_build_object('targetTemplateVersionId', v_target_version_id),
      'application', jsonb_build_object(
        'baseId', v_base.id,
        'sourceTemplateVersionId', v_source_version.id,
        'targetTemplateVersionId', v_target_version_id,
        'targetRevision', v_target_base.form_revision,
        'newTemplate', v_target_is_new_template
      )
    );
    insert into public.form_preparation_operation(
      owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt
    ) values (
      auth.uid(), p_operation_id, v_row.id, 'apply', v_hash, v_receipt
    );
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_applied', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object(
        'operation_id', p_operation_id,
        'source_template_version_id', v_source_version.id,
        'target_template_version_id', v_target_version_id,
        'source_revision', v_base.form_revision,
        'target_revision', v_target_base.form_revision,
        'classification', v_row.classification,
        'impact', v_impact
      ));
    return v_receipt;
  exception
    when others then
      -- Le sous-bloc et la fonction globale sont transactionnels : aucune
      -- application partielle ne peut atteindre le commit. Ne jamais renvoyer
      -- le texte d'une contrainte ou une donnée interne au navigateur.
      if sqlerrm in (
        'FORM_PREPARATION_FORBIDDEN', 'FORM_PREPARATION_NOT_FOUND',
        'FORM_PREPARATION_OPERATION_INVALID', 'FORM_PREPARATION_CLOSED',
        'FORM_PREPARATION_CONFLICT', 'FORM_PREPARATION_INVALID',
        'FORM_CHANGE_UNSUPPORTED', 'FORM_RULE_INVALID',
        'FORM_SEMANTIC_MIGRATION_REQUIRED'
      ) then
        raise;
      end if;
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_APPLY_FAILED',
        detail = '{"code":"FORM_PREPARATION_APPLY_FAILED","retryable":true}';
  end;
end
$$;

revoke all on function public.apply_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.apply_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;

commit;
