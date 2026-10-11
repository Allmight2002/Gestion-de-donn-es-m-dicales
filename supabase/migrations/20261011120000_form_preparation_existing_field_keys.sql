-- =============================================================================
-- 20261011120000_form_preparation_existing_field_keys.sql
--
-- POURQUOI. La preparation de formulaire (« Evolution du formulaire ») refusait TOUTE
-- evolution, meme l'ajout d'une option a une liste, des qu'UNE variable du formulaire
-- portait une cle technique hors du format `^[a-z][a-z0-9_]{0,62}$` (par exemple `IMC`,
-- `Age` ou `date_IRM`). Ce format n'est impose ni par la table ni par les RPC d'ajout et
-- de modification d'une variable : de telles cles existent donc legitimement. Le
-- controle de forme du candidat (`field_shape`) les rejetait pourtant, et le responsable
-- ne voyait que « Cette evolution n'est pas prise en charge par la preparation ».
--
-- CORRECTION. Une variable dont la cle existe deja dans la definition source est reprise
-- telle quelle : la cle n'est ni renommee ni reinterpretee, et ses valeurs restent
-- attachees. Une variable NOUVELLE garde le format strict, comme a l'import et a la
-- creation d'un jeu de variables complet. Tous les autres controles sont inchanges.
--
-- ADDITIVE. Seule `form_preparation_apply_assert_definition` est redefinie, copiee de
-- 20261004090000 ; `create or replace` conserve proprietaire, grants et revokes. Aucune
-- donnee n'est lue ni ecrite.
--
-- RETOUR ARRIERE. Reappliquer la definition de 20261004090000 : les preparations
-- concernees seraient de nouveau refusees, sans perte de donnees.
-- =============================================================================

create or replace function public.form_preparation_apply_assert_definition(
  p_source jsonb,
  p_candidate jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_section text;
  v_group text;
  v_source_field jsonb;
  v_root_sections jsonb;
  v_sections jsonb;
  v_groups jsonb;
  v_source_fields jsonb;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"definition_object_expected"}';
  end if;

  if jsonb_typeof(coalesce(p_candidate -> 'sections', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'fields', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'rules', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = '{"code":"FORM_PREPARATION_INVALID","reason":"definition_arrays_expected"}';
  end if;

  -- `form_preparation_normalize` a déjà vérifié les tableaux et les objets.
  -- Ces contrôles empêchent qu'une erreur de cast ou une contrainte interne
  -- devienne une réponse SQL brute pendant l'application.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'sectionKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or (x.value ? 'displayOrder' and jsonb_typeof(x.value -> 'displayOrder') <> 'number')
        or (x.value ? 'parentSectionKey'
            and jsonb_typeof(x.value -> 'parentSectionKey') not in ('string', 'null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"section_shape"}';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     group by x.value ->> 'sectionKey' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_section_key"}';
  end if;
  -- Une section enfant doit désigner une section racine du candidat.
  select coalesce(jsonb_object_agg(r.root_key, true), '{}'::jsonb)
    into v_root_sections
    from (
      select distinct p.value ->> 'sectionKey' as root_key
        from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) p(value)
       where p.value ->> 'parentSectionKey' is null
         and p.value ->> 'sectionKey' is not null
    ) r;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_candidate -> 'sections', '[]'::jsonb)) x(value)
     where x.value ->> 'parentSectionKey' is not null
       and not (v_root_sections ? (x.value ->> 'parentSectionKey'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"section_parent_shape"}';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'groupKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or (x.value ? 'displayOrder' and jsonb_typeof(x.value -> 'displayOrder') <> 'number')
        or (x.value ? 'anchorOrder' and jsonb_typeof(x.value -> 'anchorOrder') <> 'number')
        or (x.value ? 'isDefault' and jsonb_typeof(x.value -> 'isDefault') <> 'boolean')
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"common_group_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     group by x.value ->> 'groupKey' having count(*) > 1
  ) or (
    select count(*) from jsonb_array_elements(coalesce(p_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
     where coalesce((x.value ->> 'isDefault')::boolean, false)
  ) > 1 then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_common_group"}';
  end if;

  -- Cle d'une variable EXISTANTE : reprise telle quelle, quel que soit son format. Le
  -- format strict ne s'impose qu'a une variable nouvelle (voir l'en-tete).
  v_source_fields := public.form_preparation_index_by_key(p_source -> 'fields', 'fieldKey');
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) x(value)
     where (coalesce(x.value ->> 'fieldKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
            and not (v_source_fields ? coalesce(x.value ->> 'fieldKey', '')))
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or coalesce(x.value ->> 'scope', '') not in ('patient', 'encounter')
        or coalesce(x.value ->> 'type', '') not in
           ('number','integer','text','date','datetime','time','boolean','select','multiselect','terminology')
        or (x.value ? 'required' and jsonb_typeof(x.value -> 'required') <> 'boolean')
        or (x.value ? 'allowMissingCodes' and jsonb_typeof(x.value -> 'allowMissingCodes') <> 'boolean')
        or (x.value ? 'isMultiple' and jsonb_typeof(x.value -> 'isMultiple') <> 'boolean')
        or (x.value ? 'encounterTypes' and jsonb_typeof(x.value -> 'encounterTypes') not in ('array','null'))
        or (x.value ? 'missingReasons' and jsonb_typeof(x.value -> 'missingReasons') not in ('array','null'))
        or (x.value ? 'allowedValues' and jsonb_typeof(x.value -> 'allowedValues') not in ('array','null'))
        or (x.value ? 'allowedOptions' and jsonb_typeof(x.value -> 'allowedOptions') not in ('array','null'))
        or (x.value ? 'minValue' and jsonb_typeof(x.value -> 'minValue') not in ('number','null'))
        or (x.value ? 'maxValue' and jsonb_typeof(x.value -> 'maxValue') not in ('number','null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"field_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) x(value)
     group by x.value ->> 'fieldKey' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
      detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"duplicate_field_key"}';
  end if;

  v_sections := public.form_preparation_index_by_key(p_candidate -> 'sections', 'sectionKey');
  v_groups := public.form_preparation_index_by_key(p_candidate -> 'commonGroups', 'groupKey');
  for item in select value from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) loop
    v_section := nullif(item ->> 'sectionKey', '');
    v_group := nullif(item ->> 'commonGroupKey', '');
    if v_section is not null and not (v_sections ? v_section) then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','unknown_section','sectionKey',v_section)::text;
    end if;
    if v_section is not null and v_group is not null then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = '{"code":"FORM_CHANGE_UNSUPPORTED","reason":"field_has_two_locations"}';
    end if;
    -- Code d'erreur conservé tel quel depuis 20260916130000 (équivalence stricte).
    if v_group is not null and not (v_groups ? v_group) then
      raise exception using errcode = 'FORM_CHANGE_UNSUPPORTED', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','unknown_common_group','groupKey',v_group)::text;
    end if;
    -- Sans section ni groupe, le trigger UX-16 affectera le groupe par défaut :
    -- c'est une organisation de présentation, pas une valeur. La version
    -- d'origine évaluait ici une condition sans effet ; elle n'est plus évaluée.

    if v_source_fields is null then
      v_source_fields := public.form_preparation_index_by_key(p_source -> 'fields', 'fieldKey');
    end if;
    v_source_field := v_source_fields -> (item ->> 'fieldKey');
    if v_source_field is null
       and item ? 'defaultValue'
       and item -> 'defaultValue' <> 'null'::jsonb
       and btrim(coalesce(item ->> 'defaultValue', '')) <> '' then
      raise exception using errcode = 'P0001', message = 'FORM_CHANGE_UNSUPPORTED',
        detail = jsonb_build_object('code','FORM_CHANGE_UNSUPPORTED','reason','new_field_default_forbidden','fieldKey',item ->> 'fieldKey')::text;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'rules', '[]'::jsonb)) x(value)
     where jsonb_typeof(x.value) <> 'object'
        or jsonb_typeof(x.value -> 'rule') <> 'object'
        or coalesce(x.value ->> 'severity', '') not in ('block','warn')
        or (x.value ? 'message' and jsonb_typeof(x.value -> 'message') not in ('string','null'))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_RULE_INVALID',
      detail = '{"code":"FORM_RULE_INVALID","reason":"rule_shape"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) x(value)
     where jsonb_typeof(x.value) <> 'object'
        or coalesce(x.value ->> 'scope', '') not in ('patient', 'encounter')
        or jsonb_typeof(x.value -> 'diagnosisFieldKey') <> 'string'
        or (x.value ? 'commonOnlyCodes'
            and jsonb_typeof(x.value -> 'commonOnlyCodes') not in ('array','null'))
        or (x.value ? 'commonOnlyCodes'
            and jsonb_typeof(x.value -> 'commonOnlyCodes') = 'array'
            and exists (
              select 1 from jsonb_array_elements(x.value -> 'commonOnlyCodes') code(value)
               where jsonb_typeof(code.value) <> 'string'
            ))
  ) then
    raise exception using errcode = 'P0001', message = 'FORM_RULE_INVALID',
      detail = '{"code":"FORM_RULE_INVALID","reason":"diagnosis_shape"}';
  end if;
end
$$;
