-- =============================================================================
-- L20 — socle PostgreSQL des variables terminologiques multivaluees
--
-- Migration additive. Les champs existants restent unitaires par defaut. Aucune table ni
-- policy RLS n'est ajoutee. Les fonctions recopiees ci-dessous partent de leurs definitions
-- les plus recentes (L30/L31/L33), afin de conserver options codees, sections, raisons de
-- valeur manquante et historique terminologique.
-- =============================================================================

alter table public.template_field
  add column is_multiple boolean not null default false;

alter table public.template_field
  add constraint template_field_multiple_terminology_only
  check (not is_multiple or type = 'terminology');

comment on column public.template_field.is_multiple is
  'Vrai pour une liste ordonnee de 1 a 50 couples terminologiques code/libelle. Reserve au type terminology.';

-- La cardinalite est structurelle : une variable deja utilisee ne peut pas basculer entre
-- valeur unitaire et liste. Les gardes speciales des options et raisons manquantes restent
-- independantes et inchangées.
create or replace function public.guard_template_field_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;

  semantic := (new.field_key is distinct from old.field_key)
           or (new.type is distinct from old.type)
           or (new.is_multiple is distinct from old.is_multiple)
           or (new.scope is distinct from old.scope)
           or (new.required is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du jeu de variables.';
  end if;
  return new;
end $$;
revoke all on function public.guard_template_field_update() from public, anon, authenticated;

-- La branche __missing__ reste volontairement AVANT la branche de type. Une raison manquante
-- remplace toute la liste. Les erreurs ne recopient jamais une valeur clinique.
create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f   record;
  v   jsonb;
  n   numeric;
  txt text;
begin
  if p_data is null then return; end if;
  for f in
    select field_key, label, type, is_multiple, unit, allowed_values, min_value, max_value,
           missing_reasons
    from public.template_field
    where template_version_id = p_version and scope = p_scope
  loop
    if not (p_data ? f.field_key) then continue; end if;
    v := p_data -> f.field_key;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;

    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if cardinality(f.missing_reasons) = 0 then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      if (v ->> '__missing__') is null
         or (v ->> '__missing__') not in ('non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente') then
        raise exception 'Code de donnee manquante invalide pour "%"', f.label;
      end if;
      if not (f.missing_reasons @> array[v ->> '__missing__']) then
        raise exception 'Raison de valeur manquante non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' and f.is_multiple then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste de diagnostics attendue pour "%"', f.label;
      end if;
      if jsonb_array_length(v) = 0 then
        raise exception 'Liste vide : retirez la variable ou indiquez une donnee manquante pour "%"', f.label;
      end if;
      if jsonb_array_length(v) > 50 then
        raise exception 'La liste de diagnostics depasse 50 valeurs pour "%"', f.label;
      end if;
      if exists (
        select 1 from jsonb_array_elements(v) el(value)
        where jsonb_typeof(el.value) <> 'object'
      ) then
        raise exception 'Code et libelle attendus dans la liste pour "%"', f.label;
      end if;
      if exists (
        select 1 from jsonb_array_elements(v) el(value),
             lateral jsonb_object_keys(el.value) k
        where k not in ('code', 'label')
      ) then
        raise exception 'Contenu inattendu dans la liste pour "%"', f.label;
      end if;
      if exists (
        select 1 from jsonb_array_elements(v) el(value)
        where jsonb_typeof(el.value -> 'code') <> 'string'
           or jsonb_typeof(el.value -> 'label') <> 'string'
           or btrim(coalesce(el.value ->> 'code', '')) = ''
           or btrim(coalesce(el.value ->> 'label', '')) = ''
      ) then
        raise exception 'Code et libelle requis dans la liste pour "%"', f.label;
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v) el(value)
        group by el.value ->> 'code'
        having count(*) > 1
      ) then
        raise exception 'Diagnostic en double dans la liste pour "%"', f.label;
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v) el(value)
        where not exists (
          select 1
          from public.terminology_concept c
          where c.code = (el.value ->> 'code')
            and c.is_selectable
            and c.label = (el.value ->> 'label')
        )
      ) then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' then
      if jsonb_typeof(v) <> 'object' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_object_keys(v) k where k not in ('code','label')) then
        raise exception 'Contenu inattendu pour "%"', f.label;
      end if;
      if jsonb_typeof(v -> 'code') <> 'string' or jsonb_typeof(v -> 'label') <> 'string'
         or btrim(coalesce(v ->> 'code', '')) = '' or btrim(coalesce(v ->> 'label', '')) = '' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      end if;
      if not exists (
        select 1
        from public.terminology_concept c
        where c.code = (v ->> 'code')
          and c.is_selectable
          and c.label = (v ->> 'label')
      ) then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'multiselect' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste (tableau) attendue pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_array_elements(v) el(value) where jsonb_typeof(el.value) <> 'string') then
        raise exception 'Liste de textes attendue pour "%"', f.label;
      end if;
      if f.allowed_values is not null
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type in ('number','integer') then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'Valeur numerique JSON attendue pour "%"', f.label;
      end if;
      n := (v #>> '{}')::numeric;
      if f.type = 'integer' and n <> trunc(n) then
        raise exception 'Entier attendu pour "%"', f.label;
      end if;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
      continue;
    end if;

    if f.type = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'Booleen JSON attendu pour "%"', f.label;
      end if;
      continue;
    end if;

    if jsonb_typeof(v) <> 'string' then
      raise exception 'Texte JSON attendu pour "%"', f.label;
    end if;
    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'date' then
      if not public.is_strict_date_text(txt) then
        raise exception 'Date invalide pour "%" (format AAAA-MM-JJ attendu)', f.label;
      end if;
    elsif f.type = 'datetime' then
      if not public.is_strict_datetime_text(txt) then
        raise exception 'Date/heure invalide pour "%" (format ISO AAAA-MM-JJTHH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;

comment on function public.assert_data_valid(uuid, text, jsonb) is
  'Valide types, bornes, terminologies unitaires ou multivaluees et raisons manquantes. Les couples historiques restent valides tant que leur publication est conservee.';

-- `rule_value_present`, utilise par la version courante de base_completeness_stats, refuse
-- deja tout tableau vide. Le redefinir ici ferait courir un risque de regression sans gain.

create or replace function public.jsonb_matches(p_data jsonb, p_conds jsonb) returns boolean
language plpgsql immutable as $$
declare
  c jsonb;
  v_field text;
  v_op text;
  v_value jsonb;
  a text;
  b text;
  c2 text;
  cm int;
  code_found boolean;
begin
  if p_conds is null then return true; end if;
  for c in select * from jsonb_array_elements(p_conds) loop
    v_field := c ->> 'field';
    v_op := c ->> 'op';
    v_value := p_data -> v_field;
    a := p_data ->> v_field;
    b := c ->> 'value';
    if v_op = 'eq' then
      if a is distinct from b then return false; end if;
    elsif v_op = 'neq' then
      if a is not distinct from b then return false; end if;
    elsif v_op = 'in' then
      if a is null or a not in (select jsonb_array_elements_text(c -> 'value')) then return false; end if;
    elsif v_op in ('has_any', 'has_none') then
      if jsonb_typeof(c -> 'value') is distinct from 'array' then return false; end if;
      code_found := case when jsonb_typeof(v_value) = 'array' then exists (
        select 1
        from jsonb_array_elements(v_value) el(value)
        where jsonb_typeof(el.value) = 'object'
          and jsonb_typeof(el.value -> 'code') = 'string'
          and (el.value ->> 'code') in (select jsonb_array_elements_text(c -> 'value'))
      ) else false end;
      if v_op = 'has_any' and not code_found then return false; end if;
      if v_op = 'has_none' and code_found then return false; end if;
    elsif v_op = 'between' then
      c2 := c ->> 'value2';
      if public.value_cmp(a, b) is null or public.value_cmp(a, b) < 0 or public.value_cmp(a, c2) > 0 then return false; end if;
    else
      cm := public.value_cmp(a, b);
      if cm is null then return false; end if;
      if v_op = 'gt'  and not (cm > 0)  then return false; end if;
      if v_op = 'gte' and not (cm >= 0) then return false; end if;
      if v_op = 'lt'  and not (cm < 0)  then return false; end if;
      if v_op = 'lte' and not (cm <= 0) then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- La duplication garde la cardinalite en plus des options, raisons manquantes et sections.
create or replace function public.copy_template_fields(
  p_source_version_id uuid,
  p_target_version_id uuid,
  p_force_patient_scope boolean default false
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.template_section
    (template_version_id, section_key, label, display_order)
  select p_target_version_id, ts.section_key, ts.label, ts.display_order
  from public.template_section ts
  where ts.template_version_id = p_source_version_id
  order by ts.display_order, ts.section_key
  on conflict (template_version_id, section_key) do nothing;

  insert into public.template_field
    (template_version_id, field_key, label, description, default_value, scope, section, section_id,
     type, is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
     allow_missing_codes, missing_reasons, display_order, encounter_types)
  select p_target_version_id, src.field_key, src.label, src.description, src.default_value,
         case when p_force_patient_scope then 'patient' else src.scope end,
         src.section, tgt.id, src.type, src.is_multiple, src.unit, src.allowed_values,
         src.allowed_options, src.required, src.min_value, src.max_value,
         src.allow_missing_codes, src.missing_reasons, src.display_order,
         case when p_force_patient_scope then null else src.encounter_types end
  from public.template_field src
  left join public.template_section src_s on src_s.id = src.section_id
  left join public.template_section tgt
         on tgt.template_version_id = p_target_version_id
        and tgt.section_key = src_s.section_key
  where src.template_version_id = p_source_version_id
  order by src.display_order, src.id;
$$;
revoke all on function public.copy_template_fields(uuid, uuid, boolean) from public, anon, authenticated;

-- Nouvelle surcharge pour le client L21. Les signatures anterieures restent disponibles aux
-- PWA non rafraichies ; la valeur par defaut de la colonne leur conserve le mode unitaire.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text, p_default_value text,
  p_scope text, p_section text, p_type text, p_required boolean, p_is_multiple boolean,
  p_missing_reasons text[], p_allowed_options jsonb,
  p_encounter_types text[] default null, p_allowed_values jsonb default null,
  p_min_value numeric default null, p_max_value numeric default null,
  p_unit text default null
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type)
           or (coalesce(p_is_multiple, false) is distinct from cur.is_multiple)
           or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (p_min_value is distinct from cur.min_value)
           or (p_max_value is distinct from cur.max_value);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la valeur proposee, la section, l''unite et les options sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         default_value = nullif(btrim(p_default_value), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         is_multiple = coalesce(p_is_multiple, false),
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_options = p_allowed_options,
         allowed_values = case when p_allowed_options is not null
                               then public.template_field_option_keys(p_allowed_options)
                               else p_allowed_values end,
         min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, missing_reasons = coalesce(p_missing_reasons, '{}'::text[])
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text[], jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, text, boolean, boolean, text[], jsonb, text[], jsonb, numeric, numeric, text) to authenticated;

-- L'instantane hors-ligne transporte la cardinalite pour la version courante et les versions
-- historiques, sans modifier les donnees patient/rencontre.
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
        'encounterTypes', to_jsonb(tf.encounter_types)
      ) order by tf.display_order, tf.field_key)
      from public.template_field tf
      where tf.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label, 'displayOrder', ts.display_order
      ) order by ts.display_order, ts.section_key)
      from public.template_section ts
      where ts.template_version_id = (select current_template_version_id from public.base where id = p_base_id)
    ), '[]'::jsonb),
    'sectionsByVersion', coalesce((
      select jsonb_object_agg(v.tvid::text, v.sections)
      from (
        select ts.template_version_id as tvid,
               jsonb_agg(jsonb_build_object(
                 'id', ts.id, 'sectionKey', ts.section_key, 'label', ts.label,
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
revoke all on function public.download_base_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.download_base_snapshot(uuid) to authenticated;
