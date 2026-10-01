-- Un modele OFFICIEL (template.is_global) ne peut servir de source a une nouvelle base ou a
-- une copie de jeu de variables que par une version PUBLIEE. `listTemplateModels` ne
-- propose deja que la derniere version publiee, mais ce filtre est client : un appel
-- direct pouvait copier un brouillon ou une version archivee d'un modele officiel.
--
-- Les jeux personnels (non globaux, possedes par l'appelant) restent copiables quel que
-- soit leur statut. Les trois fonctions sont redefinies a l'identique de leur derniere
-- definition (20260814090000 pour les deux creations de base, 20260905143319 pour
-- create_template_bundle) avec le seul refus supplementaire. `create or replace` conserve
-- proprietaire, grants et revokes existants.

create or replace function public.create_base_from_model(p_name text, p_specialty text, p_source_version_id uuid)
returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src_v   public.template_version;
  src_t   public.template;
  v_tpl   uuid;
  v_ver   uuid;
  v_base  public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Seul un medecin peut creer une base'; end if;

  select * into src_v from public.template_version where id = p_source_version_id;
  if not found then raise exception 'Modele source introuvable'; end if;
  select * into src_t from public.template where id = src_v.template_id;
  if not (src_t.is_global or src_t.owner_user_id = auth.uid()) then
    raise exception 'Modele non accessible';
  end if;
  if src_t.is_global and src_v.status <> 'published' then
    raise exception 'Modele non publie';
  end if;

  -- Gabarit personnel (copie) : statut 'draft' => editable librement par le medecin.
  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src_t.name, src_t.specialty, auth.uid(), false)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid())
  returning id into v_ver;

  perform public.copy_template_fields(p_source_version_id, v_ver);

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = p_source_version_id;

  insert into public.base (name, specialty, owner_user_id, current_template_version_id)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver)
  returning * into v_base;

  return v_base;
end $$;

create or replace function public.create_base_from_model_observation(
  p_name text, p_specialty text, p_source_version_id uuid, p_observation_model text
) returns public.base
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src_v public.template_version;
  src_t public.template;
  v_tpl uuid;
  v_ver uuid;
  v_base public.base;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_medecin() then raise exception 'Seul un medecin peut creer une base'; end if;
  if p_observation_model not in ('cross_sectional', 'longitudinal', 'event_registry') then
    raise exception 'Modele d''observation invalide';
  end if;
  select * into src_v from public.template_version where id = p_source_version_id;
  if not found then raise exception 'Modele source introuvable'; end if;
  select * into src_t from public.template where id = src_v.template_id;
  if not (src_t.is_global or src_t.owner_user_id = auth.uid()) then raise exception 'Modele non accessible'; end if;
  if src_t.is_global and src_v.status <> 'published' then raise exception 'Modele non publie'; end if;
  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src_t.name, src_t.specialty, auth.uid(), false) returning id into v_tpl;
  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid()) returning id into v_ver;
  perform public.copy_template_fields(p_source_version_id, v_ver, p_observation_model = 'cross_sectional');
  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity from public.validation_rule where template_version_id = p_source_version_id;
  insert into public.base (name, specialty, owner_user_id, current_template_version_id, observation_model)
  values (p_name, nullif(p_specialty, ''), auth.uid(), v_ver, p_observation_model) returning * into v_base;
  return v_base;
end $$;

create or replace function public.create_template_bundle(p_payload jsonb, p_operation_key uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_existing public.template_operation;
  v_name text;
  v_specialty text;
  v_is_global boolean;
  v_source_version_id uuid;
  v_source_template public.template;
  v_source_version public.template_version;
  v_with_base boolean;
  v_base_name text;
  v_template_id uuid;
  v_version_id uuid;
  v_base public.base;
  v_fields jsonb;
  v_sections jsonb;
  v_count int;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = '{"code":"UNAUTHENTICATED"}';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_operation_key is null then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_REQUEST"}';
  end if;

  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_specialty := nullif(btrim(coalesce(p_payload ->> 'specialty', '')), '');
  v_is_global := coalesce((p_payload ->> 'isGlobal')::boolean, false);
  v_with_base := coalesce((p_payload ->> 'withBase')::boolean, false);
  v_base_name := btrim(coalesce(p_payload ->> 'baseName', ''));
  v_fields := coalesce(p_payload -> 'fields', '[]'::jsonb);
  v_sections := coalesce(p_payload -> 'sections', '[]'::jsonb);
  v_source_version_id := nullif(p_payload ->> 'sourceVersionId', '')::uuid;

  -- Validation complete avant toute ecriture persistante.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_TEMPLATE_NAME","field":"name"}';
  end if;
  if v_specialty is not null and char_length(v_specialty) > 120 then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SPECIALTY","field":"specialty"}';
  end if;
  if jsonb_typeof(v_fields) <> 'array' then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELDS","field":"fields"}';
  end if;
  if jsonb_typeof(v_sections) <> 'array' then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SECTIONS","field":"sections"}';
  end if;
  v_count := jsonb_array_length(v_fields);
  if v_count > 500 then
    raise exception using errcode = 'P0001', message = '{"code":"FIELD_LIMIT_EXCEEDED","field":"fields"}';
  end if;
  if jsonb_array_length(v_sections) > 60 then
    raise exception using errcode = 'P0001', message = '{"code":"SECTION_LIMIT_EXCEEDED","field":"sections"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    where jsonb_typeof(s) <> 'object'
       or btrim(coalesce(s ->> 'key', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(s ->> 'label', '')) = ''
       or char_length(btrim(coalesce(s ->> 'label', ''))) > 160
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_SECTION","field":"sections"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    group by btrim(s ->> 'key') having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_SECTION_KEY","field":"sections"}';
  end if;
  if v_source_version_id is not null and jsonb_array_length(v_sections) <> 0 then
    raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_SECTIONS_CONFLICT"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where jsonb_typeof(f) <> 'object'
       or btrim(coalesce(f ->> 'fieldKey', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(f ->> 'label', '')) = '' or char_length(btrim(coalesce(f ->> 'label', ''))) > 160
       or coalesce(f ->> 'scope', '') not in ('patient', 'encounter')
       -- L31 : la section n'est plus l'une des trois, c'est un CODE. Sa forme est
       -- verifiee ici ; son existence l'est par la creation ci-dessous.
       or not (f ? 'section') or (f -> 'section' <> 'null'::jsonb and btrim(coalesce(f ->> 'section', '')) !~ '^[a-z][a-z0-9_]{0,62}$')
       or coalesce(f ->> 'type', '') not in ('number','integer','text','date','datetime','boolean','select','multiselect')
       or (f ? 'defaultValue' and f -> 'defaultValue' <> 'null'::jsonb)
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'fieldKey')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_KEY","field":"fields"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_fields) f group by lower(btrim(f ->> 'label')) having count(*) > 1) then
    raise exception using errcode = 'P0001', message = '{"code":"DUPLICATE_FIELD_LABEL","field":"fields"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where ((f ->> 'type') in ('select', 'multiselect') and (not (f ? 'allowedValues') or jsonb_typeof(f -> 'allowedValues') <> 'array'))
       or ((f ->> 'type') not in ('select', 'multiselect') and f ? 'allowedValues' and f -> 'allowedValues' <> 'null'::jsonb)
       or (f ? 'minValue' and f -> 'minValue' <> 'null'::jsonb and jsonb_typeof(f -> 'minValue') <> 'number')
       or (f ? 'maxValue' and f -> 'maxValue' <> 'null'::jsonb and jsonb_typeof(f -> 'maxValue') <> 'number')
       or (f ? 'minValue' and f ? 'maxValue' and (f ->> 'minValue')::numeric > (f ->> 'maxValue')::numeric)
       or ((f ->> 'scope') = 'patient' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb)
       or ((f ->> 'scope') = 'encounter' and f ? 'encounterTypes' and f -> 'encounterTypes' <> 'null'::jsonb
           and (jsonb_typeof(f -> 'encounterTypes') <> 'array' or exists (
             select 1 from jsonb_array_elements_text(f -> 'encounterTypes') et
             where et not in ('consultation', 'hospitalisation', 'suivi', 'autre')
           )))
  ) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_FIELD_CONSTRAINT","field":"fields"}';
  end if;

  -- Hash apres validation : une meme cle ne peut jamais etre reutilisee avec un autre payload.
  v_hash := encode(digest(p_payload::text, 'sha256'), 'hex');
  insert into public.template_operation(owner_user_id, operation_key, payload_hash, result)
  values (v_uid, p_operation_key, v_hash, '{}'::jsonb)
  on conflict do nothing;
  select * into v_existing from public.template_operation
   where owner_user_id = v_uid and operation_key = p_operation_key for update;
  if v_existing.result <> '{}'::jsonb then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = '{"code":"IDEMPOTENCY_KEY_REUSED"}';
    end if;
    return v_existing.result;
  end if;

  if v_source_version_id is not null then
    select * into v_source_version from public.template_version where id = v_source_version_id for share;
    if not found then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_NOT_FOUND"}'; end if;
    select * into v_source_template from public.template where id = v_source_version.template_id for share;
    if not (v_source_template.is_global or v_source_template.owner_user_id = v_uid or public.is_system_admin()) then
      raise exception using errcode = 'P0001', message = '{"code":"SOURCE_FORBIDDEN"}';
    end if;
    if v_source_template.is_global and v_source_version.status <> 'published' then
      raise exception using errcode = 'P0001', message = '{"code":"SOURCE_NOT_PUBLISHED"}';
    end if;
    if v_count <> 0 then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_FIELDS_CONFLICT"}'; end if;
  end if;

  insert into public.template(name, specialty, owner_user_id, is_global)
  values (v_name, v_specialty, case when v_is_global then null else v_uid end, v_is_global)
  returning id into v_template_id;
  insert into public.template_version(template_id, version_number, status, created_by)
  values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

  if v_source_version_id is not null then
    -- FOR SHARE ci-dessus garantit un snapshot coherent des attributs copies.
    -- `copy_template_fields` recopie les sections AVANT les champs.
    perform public.copy_template_fields(v_source_version_id, v_version_id);
    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id, rule, message, severity from public.validation_rule where template_version_id = v_source_version_id order by id;
  else
    -- Sections EXPLICITES si le payload en porte, sinon DEDUITES des codes employes
    -- par les champs, dans l'ordre de leur premiere apparition. Un jeu de variables
    -- sans champ ni section demarre sur les trois sections historiques : une base
    -- neuve n'ouvre jamais un constructeur sans aucun regroupement.
    if jsonb_array_length(v_sections) > 0 then
      insert into public.template_section(template_version_id, section_key, label, display_order)
      select v_version_id, btrim(s.value ->> 'key'), btrim(s.value ->> 'label'), s.ordinality - 1
      from jsonb_array_elements(v_sections) with ordinality as s(value, ordinality)
      order by s.ordinality;
      if exists (select 1 from jsonb_array_elements(v_sections) s
        where s ->> 'parentKey' is not null and not exists (
          select 1 from jsonb_array_elements(v_sections) p
          where btrim(p ->> 'key') = s ->> 'parentKey' and p ->> 'parentKey' is null
            and btrim(s ->> 'key') <> btrim(p ->> 'key'))) then
        raise exception 'Parent de section invalide';
      end if;
      update public.template_section child set parent_section_id = parent.id
      from jsonb_array_elements(v_sections) s, public.template_section parent
      where child.template_version_id = v_version_id and child.section_key = btrim(s ->> 'key')
        and parent.template_version_id = v_version_id and parent.section_key = s ->> 'parentKey';
      perform public.normalize_template_section_order(v_version_id);
    elsif v_count > 0 then
      insert into public.template_section(template_version_id, section_key, label, display_order)
      select v_version_id, k.section_key, initcap(replace(k.section_key, '_', ' ')), k.ord - 1
      from (
        select btrim(f.value ->> 'section') as section_key,
               row_number() over (order by min(f.ordinality)) as ord
        from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
        where f.value ->> 'section' is not null
        group by btrim(f.value ->> 'section')
      ) k
      order by k.ord;
    else
      insert into public.template_section(template_version_id, section_key, label, display_order)
      values (v_version_id, 'clinique', 'Clinique', 0),
             (v_version_id, 'biologie', 'Biologie', 1),
             (v_version_id, 'paraclinique', 'Paraclinique', 2);
    end if;

    -- `section_id` est resolu par le declencheur de miroir depuis le code : les
    -- sections existent deja a cet instant.
    insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
    select v_version_id, btrim(f.value ->> 'fieldKey'), btrim(f.value ->> 'label'), f.value ->> 'scope', btrim(f.value ->> 'section'), f.value ->> 'type',
      nullif(btrim(coalesce(f.value ->> 'unit', '')), ''), f.value -> 'allowedValues', coalesce((f.value ->> 'required')::boolean, false),
      nullif(f.value ->> 'minValue', '')::numeric, nullif(f.value ->> 'maxValue', '')::numeric, coalesce((f.value ->> 'allowMissingCodes')::boolean, false), f.ordinality - 1,
      case when f.value ->> 'scope' = 'encounter' then array(select jsonb_array_elements_text(coalesce(f.value -> 'encounterTypes', '[]'::jsonb))) else null end
    from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
    order by f.ordinality;
  end if;
  if v_with_base then
    insert into public.base(name, specialty, owner_user_id, current_template_version_id)
    values (v_base_name, v_specialty, v_uid, v_version_id) returning * into v_base;
  end if;
  v_result := jsonb_build_object('templateId', v_template_id, 'versionId', v_version_id, 'baseId', case when v_with_base then v_base.id else null end);
  update public.template_operation set result = v_result where owner_user_id = v_uid and operation_key = p_operation_key;
  return v_result;
end $$;
