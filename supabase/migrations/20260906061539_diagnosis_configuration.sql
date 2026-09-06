-- L55. Configuration dormante sur la version : RLS du gabarit héritée, aucun statut clinique.
alter table public.template_version add column diagnosis_configuration jsonb not null default '[]'::jsonb;

create function public.assert_diagnosis_client()
returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-meddata-diagnosis-contract', '') <> '1' then
    raise exception using message = 'Actualisez l’application pour utiliser la configuration diagnostique.',
      detail = '{"code":"DIAGNOSIS_CLIENT_UNSUPPORTED","action":"refresh_required"}', hint = 'refresh_required';
  end if;
end $$;
revoke all on function public.assert_diagnosis_client() from public, anon;
grant execute on function public.assert_diagnosis_client() to authenticated;

create function public.assert_diagnosis_configuration(p_version uuid, p_config jsonb)
returns void language plpgsql set search_path = public, pg_temp as $$
declare c jsonb; f public.template_field; r record; v_code jsonb; v_release_id uuid;
begin
  if jsonb_typeof(p_config) is distinct from 'array' then raise exception 'DIAGNOSIS_CONFIG_INVALID'; end if;
  if jsonb_array_length(p_config) > 2 then raise exception 'DIAGNOSIS_SCOPE_DUPLICATE'; end if;
  if exists (select 1 from jsonb_array_elements(p_config) e group by e ->> 'scope' having count(*) > 1) then
    raise exception 'DIAGNOSIS_SCOPE_DUPLICATE';
  end if;
  for c in select value from jsonb_array_elements(p_config) loop
    if jsonb_typeof(c) <> 'object' then raise exception 'DIAGNOSIS_CONFIG_INVALID'; end if;
    if exists (select 1 from jsonb_object_keys(c) k where k not in
      ('scope','diagnosisFieldKey','terminologyReleaseId','commonOnlyCodes'))
      or coalesce(c ->> 'scope','') not in ('patient','encounter')
      or jsonb_typeof(c -> 'diagnosisFieldKey') is distinct from 'string'
      or not (c ? 'terminologyReleaseId')
      or jsonb_typeof(c -> 'commonOnlyCodes') is distinct from 'array' then
      raise exception 'DIAGNOSIS_CONFIG_INVALID';
    end if;
    select * into f from public.template_field where template_version_id = p_version
      and scope = c ->> 'scope' and field_key = c ->> 'diagnosisFieldKey';
    if not found then raise exception 'DIAGNOSIS_DRIVER_UNKNOWN'; end if;
    if f.type not in ('select','multiselect','terminology') or f.section_id is not null
      or f.section is not null or f.formula is not null then raise exception 'DIAGNOSIS_DRIVER_INVALID'; end if;
    if exists (select 1 from public.validation_rule where template_version_id = p_version
      and rule -> 'then' ->> 'operator' = 'visible' and rule -> 'then' ->> 'field' = f.field_key) then
      raise exception 'DIAGNOSIS_DRIVER_HIDDEN';
    end if;
    -- Soupape F5 : même clé, même scope, aucun champ texte concurrent inventé.
    if not exists (select 1 from public.template_field p where p.template_version_id = p_version
      and p.field_key = f.field_key || '_autre' and p.scope = f.scope and p.type = 'text'
      and p.formula is null and p.section_id is null and p.section is null and not p.required)
      or exists (select 1 from public.validation_rule where template_version_id = p_version
        and rule -> 'then' ->> 'field' = f.field_key || '_autre') then
      raise exception 'DIAGNOSIS_PROPOSAL_INVALID';
    end if;
    v_release_id := null;
    if f.type = 'terminology' then
      if jsonb_typeof(c -> 'terminologyReleaseId') is distinct from 'string'
        or (c ->> 'terminologyReleaseId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'DIAGNOSIS_RELEASE_REQUIRED';
      end if;
      v_release_id := (c ->> 'terminologyReleaseId')::uuid;
      perform 1 from public.terminology_release where id = v_release_id for share;
      if not found then raise exception 'DIAGNOSIS_RELEASE_UNKNOWN'; end if;
    elsif c -> 'terminologyReleaseId' <> 'null'::jsonb then raise exception 'DIAGNOSIS_RELEASE_FORBIDDEN';
    end if;
    if (select count(distinct e) from jsonb_array_elements(c -> 'commonOnlyCodes') e)
      <> jsonb_array_length(c -> 'commonOnlyCodes') then raise exception 'DIAGNOSIS_CODES_DUPLICATE'; end if;
    for v_code in select value from jsonb_array_elements(c -> 'commonOnlyCodes') loop
      if jsonb_typeof(v_code) <> 'string' or btrim(v_code #>> '{}') = '' then raise exception 'DIAGNOSIS_CODE_INVALID'; end if;
      if f.type = 'terminology' then
        if not exists (select 1 from public.terminology_concept where terminology_concept.release_id = v_release_id
          and terminology_concept.code = v_code #>> '{}' and terminology_concept.is_selectable) then raise exception 'DIAGNOSIS_CODE_UNKNOWN'; end if;
      elsif not coalesce(f.allowed_values @> jsonb_build_array(v_code), false) then raise exception 'DIAGNOSIS_CODE_UNKNOWN';
      end if;
    end loop;
    for r in select id, rule from public.validation_rule where template_version_id = p_version
      and rule -> 'if' ->> 'field' = f.field_key loop
      -- Toute règle terminologique de ce pilote garde la même release, champs inclus.
      if f.type = 'terminology' and r.rule -> 'if' ->> 'operator' = 'contains_any'
        and (r.rule -> 'if' ->> 'terminologyReleaseId')::uuid is distinct from v_release_id then
        raise exception 'DIAGNOSIS_RELEASE_MISMATCH';
      end if;
      if r.rule -> 'then' ? 'section' then
        if r.rule -> 'if' ->> 'operator' <> 'contains_any' or r.rule -> 'then' ->> 'operator' <> 'visible'
          or (select count(*) from public.validation_rule v where v.template_version_id = p_version
            and v.rule -> 'then' ->> 'section' = r.rule -> 'then' ->> 'section') <> 1 then
          raise exception 'DIAGNOSIS_BLOCK_NONCANONICAL';
        end if;
        if exists (select 1 from jsonb_array_elements(c -> 'commonOnlyCodes') e where r.rule -> 'if' -> 'value' @> jsonb_build_array(e)) then
          raise exception 'DIAGNOSIS_COMMON_BLOCK_OVERLAP';
        end if;
        if not exists (select 1 from public.template_section_field_keys(p_version, r.rule -> 'then' ->> 'section') k
          join public.template_field t on t.template_version_id = p_version and t.field_key = k.field_key
          where t.scope = f.scope and t.formula is null) then raise exception 'DIAGNOSIS_BLOCK_EMPTY'; end if;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.assert_diagnosis_configuration(uuid,jsonb) from public, anon, authenticated;

-- Le verrou L52 reste unique pour champs, sections, règles et configuration.
create or replace function public.validate_template_version_invariants(p_version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; config jsonb;
begin
  select diagnosis_configuration into config from public.template_version where id = p_version_id for update;
  if not found then return; end if;
  for r in select id, rule from public.validation_rule where template_version_id = p_version_id order by id loop
    perform public.assert_rule_structure(p_version_id, r.rule);
    perform public.assert_rule_calculated_operands(p_version_id, r.rule);
    perform public.assert_visibility_acyclic(p_version_id, r.rule, r.id);
  end loop;
  perform public.assert_diagnosis_configuration(p_version_id, config);
end $$;

create function public.guard_diagnosis_configuration()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.diagnosis_configuration is not distinct from old.diagnosis_configuration then return new; end if;
    if old.status <> 'draft' or public.template_version_in_use(old.id) then raise exception 'DIAGNOSIS_VERSION_FROZEN'; end if;
  end if;
  if new.diagnosis_configuration <> '[]'::jsonb then perform public.assert_diagnosis_client(); end if;
  perform public.assert_diagnosis_configuration(new.id, new.diagnosis_configuration);
  return new;
end $$;
revoke all on function public.guard_diagnosis_configuration() from public, anon, authenticated;
create trigger trg_diagnosis_configuration before insert or update on public.template_version
  for each row execute function public.guard_diagnosis_configuration();

create function public.set_diagnosis_configuration(p_version_id uuid, p_configuration jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found or not public.owns_template(v.template_id) then raise exception 'Modification du jeu de variables non autorisee'; end if;
  perform public.assert_diagnosis_client();
  update public.template_version set diagnosis_configuration = p_configuration where id = p_version_id;
  perform public.validate_template_version_invariants(p_version_id);
end $$;
revoke all on function public.set_diagnosis_configuration(uuid,jsonb) from public, anon;
grant execute on function public.set_diagnosis_configuration(uuid,jsonb) to authenticated;

-- Contexte complet, lu sous RLS de template_version ; aucun recours à la release courante.
create function public.get_diagnosis_context(p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(c || jsonb_build_object('proposalFieldKey', f.field_key || '_autre',
    'recognizedCodes', case when f.type = 'terminology' then
      (select coalesce(jsonb_agg(t.code order by t.code), '[]'::jsonb) from public.terminology_concept t
        where t.release_id = (c ->> 'terminologyReleaseId')::uuid and t.is_selectable)
      else coalesce(f.allowed_values, '[]'::jsonb) end) order by c ->> 'scope'), '[]'::jsonb)
  from public.template_version v cross join lateral jsonb_array_elements(v.diagnosis_configuration) c
  join public.template_field f on f.template_version_id = v.id and f.scope = c ->> 'scope'
    and f.field_key = c ->> 'diagnosisFieldKey'
  where v.id = p_version_id;
$$;
revoke all on function public.get_diagnosis_context(uuid) from public, anon;
grant execute on function public.get_diagnosis_context(uuid) to authenticated;

create function public.diagnosis_coverage(p_version_id uuid, p_scope text, p_data jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare c jsonb; f public.template_field; codes jsonb := '[]'; val jsonb; item jsonb; code text;
  seen text[] := '{}'; blocks jsonb; status text; items jsonb := '[]';
  counts jsonb := '{"covered":0,"common_only":0,"uncovered":0,"unclassified":0}';
begin
  select e into c from jsonb_array_elements(public.get_diagnosis_context(p_version_id)) e where e ->> 'scope' = p_scope;
  if c is not null then
    select * into f from public.template_field where template_version_id = p_version_id and scope = p_scope
      and field_key = c ->> 'diagnosisFieldKey';
    val := p_data -> f.field_key;
    if f.type = 'terminology' then
      if f.is_multiple then
        if jsonb_typeof(val) = 'array' and public.rule_apply_op('contains_any', val, c -> 'recognizedCodes') then
          select coalesce(jsonb_agg(e -> 'code'), '[]') into codes from jsonb_array_elements(val) e;
        end if;
      elsif jsonb_typeof(val) = 'object' and public.rule_apply_op('contains_any', val, c -> 'recognizedCodes') then codes := jsonb_build_array(val -> 'code'); end if;
    elsif f.type = 'multiselect' then
      if jsonb_typeof(val) = 'array' then
        if public.rule_apply_op('contains_any',val,c -> 'recognizedCodes') and jsonb_typeof(val -> 0) = 'string' then codes := val; end if;
      end if;
    elsif jsonb_typeof(val) = 'string' then codes := jsonb_build_array(val); end if;
    for item in select value from jsonb_array_elements(codes) loop
      code := item #>> '{}';
      continue when code = any(seen) or not (c -> 'recognizedCodes' @> jsonb_build_array(item));
      seen := array_append(seen, code);
      select coalesce(jsonb_agg(b.key order by b.key), '[]') into blocks from (
        select distinct rule -> 'then' ->> 'section' as key from public.validation_rule r
        where r.template_version_id = p_version_id and rule -> 'if' ->> 'field' = f.field_key
          and rule -> 'if' ->> 'operator' = 'contains_any' and rule -> 'then' ->> 'operator' = 'visible'
          and rule -> 'then' ? 'section' and rule -> 'if' -> 'value' @> jsonb_build_array(item)
          and coalesce(rule -> 'if' -> 'terminologyReleaseId','null'::jsonb) = c -> 'terminologyReleaseId'
          and exists (select 1 from public.template_section_field_keys(p_version_id,rule -> 'then' ->> 'section') k
            join public.template_field t on t.template_version_id = p_version_id and t.field_key = k.field_key
            where t.scope = p_scope and t.formula is null)
      ) b;
      status := case when jsonb_array_length(blocks) > 0 then 'covered'
        when c -> 'commonOnlyCodes' @> jsonb_build_array(item) then 'common_only' else 'uncovered' end;
      items := items || jsonb_build_array(jsonb_build_object('code',code,'status',status,'blockKeys',blocks));
      counts := jsonb_set(counts,array[status],to_jsonb((counts ->> status)::int + 1));
    end loop;
    val := p_data -> (c ->> 'proposalFieldKey');
    if jsonb_typeof(val) = 'string' and btrim(val #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '' then
      items := items || '[{"code":null,"status":"unclassified","blockKeys":[]}]'::jsonb;
      counts := jsonb_set(counts,'{unclassified}','1');
    end if;
  end if;
  return jsonb_build_object('versionId',p_version_id,'scope',p_scope,'diagnostics',items,'counts',counts);
end $$;
revoke all on function public.diagnosis_coverage(uuid,text,jsonb) from public, anon;
grant execute on function public.diagnosis_coverage(uuid,text,jsonb) to authenticated;

-- Aucune activation/soumission silencieuse par un client ignorant L55.
create function public.guard_diagnosis_submission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.template_version v cross join lateral jsonb_array_elements(v.diagnosis_configuration) c
    where v.id = new.template_version_id and c ->> 'scope' = tg_table_name) then
    perform public.assert_diagnosis_client();
  end if;
  return new;
end $$;
revoke all on function public.guard_diagnosis_submission() from public, anon, authenticated;
create trigger trg_diagnosis_client before insert or update on public.patient for each row execute function public.guard_diagnosis_submission();
create trigger trg_diagnosis_client before insert or update on public.encounter for each row execute function public.guard_diagnosis_submission();

-- Une release déjà référencée ne peut changer de signification. Les libellés et
-- l'indicateur de release active n'interviennent jamais dans la couverture.
create function public.guard_diagnosis_terminology()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare ids uuid[]; v record;
begin
  if tg_table_name = 'terminology_concept' then
    if tg_op = 'UPDATE' and new.release_id = old.release_id and new.code is not distinct from old.code
      and new.is_selectable = old.is_selectable then return new; end if;
    ids := case when tg_op = 'INSERT' then array[new.release_id] when tg_op = 'DELETE' then array[old.release_id]
      else array[old.release_id,new.release_id] end;
    perform 1 from public.terminology_release where id = any(ids) order by id for update;
  else
    if tg_op = 'UPDATE' and new.id = old.id and new.slug = old.slug and new.version = old.version
      and new.source = old.source then return new; end if;
    ids := array[old.id];
  end if;
  -- Le verrou de version ci-dessous fait attendre une configuration concurrente : elle a
  -- alors commité et sa référence est visible, plutôt que manquée par un instantané ancien.
  for v in select t.id from public.template_version t where exists (
    select 1 from jsonb_array_elements(t.diagnosis_configuration) c
      where (c ->> 'terminologyReleaseId')::uuid = any(ids)) order by t.id for update loop
    raise exception 'DIAGNOSIS_RELEASE_FROZEN';
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_diagnosis_terminology() from public, anon, authenticated;
create trigger trg_diagnosis_terminology before insert or update or delete on public.terminology_concept
  for each row execute function public.guard_diagnosis_terminology();
create trigger trg_diagnosis_terminology before update or delete on public.terminology_release
  for each row execute function public.guard_diagnosis_terminology();

-- Les six voies de copie partagent cette fonction. Le scope diagnostique reste fidèle.
create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
  p_force_patient_scope boolean default false
) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare config jsonb;
begin
  select diagnosis_configuration into config from public.template_version where id = p_source_version_id for update;
  if p_force_patient_scope and exists (select 1 from jsonb_array_elements(config) c where c ->> 'scope' = 'encounter') then
    raise exception 'DIAGNOSIS_SCOPE_COPY_CONFLICT';
  end if;
  insert into public.template_section
    (template_version_id, section_key, label, display_order)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  -- Second pass: resolve the source parent by its stable key in the target version.
  update public.template_section target set parent_section_id = parent_target.id
  from public.template_section source
  join public.template_section parent_source on parent_source.id = source.parent_section_id
  join public.template_section parent_target on parent_target.template_version_id = p_target_version_id
    and parent_target.section_key = parent_source.section_key
  where source.template_version_id = p_source_version_id
    and target.template_version_id = p_target_version_id and target.section_key = source.section_key;

  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, section_id,
     type, is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
     allow_missing_codes, missing_reasons, formula, display_order, encounter_types)
  select p_target_version_id, src.field_key, src.label, src.description, src.default_value,
         case when p_force_patient_scope then 'patient' else src.scope end,
         src.section, tgt.id, src.type, src.is_multiple, src.unit, src.allowed_values,
         src.allowed_options, src.required, src.min_value, src.max_value,
         src.allow_missing_codes, src.missing_reasons, src.formula, src.display_order,
         case when p_force_patient_scope then null else src.encounter_types end
  from public.template_field src
  left join public.template_section src_s on src_s.id = src.section_id
  left join public.template_section tgt
         on tgt.template_version_id = p_target_version_id
        and tgt.section_key = src_s.section_key
  where src.template_version_id = p_source_version_id
  order by src.display_order, src.id;
  update public.template_version set diagnosis_configuration = config where id = p_target_version_id;
end $$;


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
        'id', ts.id, 'parentSectionKey', (select p.section_key from public.template_section p where p.id = ts.parent_section_id), 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order
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
                 'displayOrder', ts.display_order
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
            'data', e.data, 'updatedAt', e.updated_at, 'templateVersionId', e.template_version_id
          ) order by e.encounter_date)
          from public.encounter e where e.patient_id = p.id and e.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.created_at)
      from public.patient p where p.base_id = p_base_id and p.deleted_at is null
    ), '[]'::jsonb)
  );
$$;
