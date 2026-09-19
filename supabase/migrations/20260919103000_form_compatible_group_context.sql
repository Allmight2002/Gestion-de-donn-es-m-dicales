-- E3/L66 : applique la portée des groupes répétables au contexte des fiches compatibles.
-- La migration conserve les deux façades publiques et remplace le helper interne par un
-- filtre versionné. L'ancien calcul reste un composant interne, inaccessible aux rôles clients.

alter function public.form_record_context_json(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  rename to form_record_context_json_base;

revoke all on function public.form_record_context_json_base(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
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
  v_values jsonb;
  v_item jsonb;
  v_key text;
  v_scope text := p_record_kind;
  v_group_section_key text;
  v_effective_encounter_type text := p_encounter_type;
  v_out_of_group boolean := false;
  v_historical_out_of_group boolean := false;
  v_group_applies boolean := true;
  v_encounter_type_applies boolean := true;
  v_active_hidden text[] := coalesce(public.visibility_hidden_fields(p_active_version, p_data), '{}');
  v_historical_hidden text[] := coalesce(public.visibility_hidden_fields(p_historical_version, p_data), '{}');
  v_current_missing jsonb := '[]'::jsonb;
  v_historical_missing jsonb := '[]'::jsonb;
  v_obligations jsonb := '[]'::jsonb;
  v_value jsonb;
  v_is_historical boolean;
  v_field record;
begin
  if p_record_kind not in ('patient', 'encounter') then
    perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'record_kind');
  end if;

  if p_record_kind = 'encounter' then
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
    -- Dans une occurrence, le groupe remplace encounter_types. Le filtre de groupe ci-dessous
    -- retirera les autres champs après le calcul de base, sans perdre les valeurs du groupe.
    if v_group_section_key is not null then
      v_effective_encounter_type := null;
    end if;
  end if;

  v_context := public.form_record_context_json_base(
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
    v_effective_encounter_type
  );

  v_values := coalesce(v_context -> 'values', '{}'::jsonb);

  -- Applicabilité et exposition des valeurs suivent la définition active pour les champs
  -- présentés. Les définitions inactives restent décrites, mais ne deviennent pas saisissables.
  for v_item in
    select x.value
      from jsonb_array_elements(coalesce(v_context -> 'fields', '[]'::jsonb)) x(value)
  loop
    v_key := v_item ->> 'field_key';
    v_out_of_group := false;

    if p_record_kind = 'encounter'
       and jsonb_typeof(v_item -> 'active_definition') = 'object' then
      if v_group_section_key is not null then
        select not exists (
          select 1
            from public.template_section s
           where s.template_version_id = p_active_version
             and s.section_key = v_group_section_key
             and s.parent_section_id is null
             and s.is_repeatable
             and exists (
               select 1
                 from public.template_section_field_keys(p_active_version, v_group_section_key) k
                where k.field_key = v_key
             )
        ) into v_out_of_group;
      else
        select exists (
          select 1
            from public.template_section s
            cross join lateral public.template_section_field_keys(p_active_version, s.section_key) k
           where s.template_version_id = p_active_version
             and s.parent_section_id is null
             and s.is_repeatable
             and k.field_key = v_key
        ) into v_out_of_group;
      end if;

      -- Une valeur d'un champ historique ne peut pas changer silencieusement de portée entre
      -- versions. Les champs définis dans les deux versions doivent appartenir au groupe dans
      -- chacune d'elles; les additions actives ne sont, elles, évaluées que dans la version active.
      if v_item ->> 'definition_state' = 'defined' then
        if v_group_section_key is not null then
          select not exists (
            select 1
              from public.template_section s
             where s.template_version_id = p_historical_version
               and s.section_key = v_group_section_key
               and s.parent_section_id is null
               and s.is_repeatable
               and exists (
                 select 1
                   from public.template_section_field_keys(p_historical_version, v_group_section_key) k
                  where k.field_key = v_key
               )
          ) into v_historical_out_of_group;
        else
          select exists (
            select 1
              from public.template_section s
              cross join lateral public.template_section_field_keys(p_historical_version, s.section_key) k
             where s.template_version_id = p_historical_version
               and s.parent_section_id is null
               and s.is_repeatable
               and k.field_key = v_key
          ) into v_historical_out_of_group;
        end if;
        v_out_of_group := v_out_of_group or v_historical_out_of_group;
      end if;
    end if;

    if v_out_of_group then
      v_item := (v_item - 'value' - 'missing_code') || jsonb_build_object(
        'applicability', 'not_applicable',
        'applicability_reason', case
          when v_item ->> 'applicability_reason' in ('rule_hidden', 'definition_incompatible', 'not_in_active_definition')
            then v_item ->> 'applicability_reason'
          else 'repeatable_group'
        end,
        'value_state', 'not_applicable',
        'provenance', null
      );
      v_values := v_values - v_key;
    end if;

    v_fields := v_fields || jsonb_build_array(v_item);
  end loop;

  -- Les obligations courantes sont calculées uniquement sur la définition active. Les formules
  -- sont lues pour les exclure des champs à saisir; leur contenu n'est jamais interprété ici.
  for v_field in
    select f.*
      from public.template_field f
     where f.template_version_id = p_active_version
       and f.scope = v_scope
       and f.required
       and f.formula is null
     order by f.display_order, f.field_key
  loop
    v_group_applies := true;
    v_encounter_type_applies := true;
    if p_record_kind = 'encounter' then
      if v_group_section_key is not null then
        select exists (
          select 1
            from public.template_section s
           where s.template_version_id = p_active_version
             and s.section_key = v_group_section_key
             and s.parent_section_id is null
             and s.is_repeatable
             and exists (
               select 1
                 from public.template_section_field_keys(p_active_version, v_group_section_key) k
                where k.field_key = v_field.field_key
             )
        ) into v_group_applies;
      else
        select not exists (
          select 1
            from public.template_section s
            cross join lateral public.template_section_field_keys(p_active_version, s.section_key) k
           where s.template_version_id = p_active_version
             and s.parent_section_id is null
             and s.is_repeatable
             and k.field_key = v_field.field_key
        ) into v_group_applies;
        v_encounter_type_applies := p_encounter_type is null
          or v_field.encounter_types is null
          or cardinality(v_field.encounter_types) = 0
          or p_encounter_type = any(v_field.encounter_types);
      end if;
    end if;

    v_value := p_data -> v_field.field_key;
    if v_group_applies
       and v_encounter_type_applies
       and not (v_field.field_key = any(v_active_hidden))
       and (p_data is null
            or not (p_data ? v_field.field_key)
            or v_value is null
            or jsonb_typeof(v_value) = 'null'
            or (jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '')) then
      v_is_historical := exists (
        select 1
          from public.template_field h
         where h.template_version_id = p_historical_version
           and h.scope = v_scope
           and h.field_key = v_field.field_key
           and (p_record_kind <> 'encounter' or (
             (v_group_section_key is not null and exists (
               select 1
                 from public.template_section s
                where s.template_version_id = p_historical_version
                  and s.section_key = v_group_section_key
                  and s.parent_section_id is null
                  and s.is_repeatable
                  and exists (
                    select 1
                      from public.template_section_field_keys(p_historical_version, v_group_section_key) k
                     where k.field_key = h.field_key
                  )
             ))
             or (v_group_section_key is null and not exists (
               select 1
                 from public.template_section s
                 cross join lateral public.template_section_field_keys(p_historical_version, s.section_key) k
                where s.template_version_id = p_historical_version
                  and s.parent_section_id is null
                  and s.is_repeatable
                  and k.field_key = h.field_key
             ))
           ))
      );
      v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
        'field_key', v_field.field_key,
        'label', v_field.label,
        'definition_revision', case when v_is_historical then p_historical_version else p_active_version end,
        'reason', case when v_is_historical then 'missing_value' else 'not_defined' end
      ));
      v_current_missing := v_current_missing || jsonb_build_array(v_field.field_key);
    end if;
  end loop;

  -- L'historique garde sa propre version de champs, de groupes répétables et de filtres.
  for v_field in
    select f.*
      from public.template_field f
     where f.template_version_id = p_historical_version
       and f.scope = v_scope
       and f.required
       and f.formula is null
     order by f.display_order, f.field_key
  loop
    v_group_applies := true;
    v_encounter_type_applies := true;
    if p_record_kind = 'encounter' then
      if v_group_section_key is not null then
        select exists (
          select 1
            from public.template_section s
           where s.template_version_id = p_historical_version
             and s.section_key = v_group_section_key
             and s.parent_section_id is null
             and s.is_repeatable
             and exists (
               select 1
                 from public.template_section_field_keys(p_historical_version, v_group_section_key) k
                where k.field_key = v_field.field_key
             )
        ) into v_group_applies;
      else
        select not exists (
          select 1
            from public.template_section s
            cross join lateral public.template_section_field_keys(p_historical_version, s.section_key) k
           where s.template_version_id = p_historical_version
             and s.parent_section_id is null
             and s.is_repeatable
             and k.field_key = v_field.field_key
        ) into v_group_applies;
        v_encounter_type_applies := p_encounter_type is null
          or v_field.encounter_types is null
          or cardinality(v_field.encounter_types) = 0
          or p_encounter_type = any(v_field.encounter_types);
      end if;
    end if;

    v_value := p_data -> v_field.field_key;
    if v_group_applies
       and v_encounter_type_applies
       and not (v_field.field_key = any(v_historical_hidden))
       and (p_data is null
            or not (p_data ? v_field.field_key)
            or v_value is null
            or jsonb_typeof(v_value) = 'null'
            or (jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '')) then
      v_historical_missing := v_historical_missing || jsonb_build_array(v_field.field_key);
    end if;
  end loop;

  return v_context || jsonb_build_object(
    'fields', v_fields,
    'values', v_values,
    'current_obligations', v_obligations,
    'completeness', coalesce(v_context -> 'completeness', '{}'::jsonb) || jsonb_build_object(
      'current_missing_field_keys', v_current_missing,
      'current_missing_count', jsonb_array_length(v_current_missing),
      'current_complete', jsonb_array_length(v_current_missing) = 0,
      'historical_missing_field_keys', v_historical_missing,
      'historical_missing_count', jsonb_array_length(v_historical_missing),
      'historical_complete', jsonb_array_length(v_historical_missing) = 0
    ),
    'encounter_type', p_encounter_type
  );
end
$$;

revoke all on function public.form_record_context_json(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;
