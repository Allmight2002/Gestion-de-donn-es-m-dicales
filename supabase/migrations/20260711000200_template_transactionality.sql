-- Creation/clonage transactionnels des jeux de variables.
-- Les anciennes primitives restent disponibles pour l'edition des brouillons ; les
-- nouveaux flux de creation passent par create_template_bundle().

create table public.template_operation (
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  operation_key uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, operation_key)
);
alter table public.template_operation enable row level security;
revoke all on table public.template_operation from public, anon, authenticated;

create or replace function public.create_template_bundle(p_payload jsonb, p_operation_key uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
  v_count := jsonb_array_length(v_fields);
  if v_count > 500 then
    raise exception using errcode = 'P0001', message = '{"code":"FIELD_LIMIT_EXCEEDED","field":"fields"}';
  end if;
  if v_with_base and (v_base_name = '' or char_length(v_base_name) > 120) then
    raise exception using errcode = 'P0001', message = '{"code":"INVALID_BASE_NAME","field":"baseName"}';
  end if;
  if v_is_global and not public.is_system_admin() then
    raise exception using errcode = 'P0001', message = '{"code":"FORBIDDEN"}';
  end if;
  if not v_is_global and not public.is_medecin() then
    raise exception using errcode = 'P0001', message = '{"code":"FORBIDDEN"}';
  end if;
  if v_with_base and (v_is_global or not public.is_medecin()) then
    raise exception using errcode = 'P0001', message = '{"code":"BASE_NOT_ALLOWED"}';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_fields) f
    where jsonb_typeof(f) <> 'object'
       or btrim(coalesce(f ->> 'fieldKey', '')) !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(coalesce(f ->> 'label', '')) = '' or char_length(btrim(coalesce(f ->> 'label', ''))) > 160
       or coalesce(f ->> 'scope', '') not in ('patient', 'encounter')
       or coalesce(f ->> 'section', '') not in ('clinique', 'biologie', 'paraclinique')
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
    if v_count <> 0 then raise exception using errcode = 'P0001', message = '{"code":"SOURCE_AND_FIELDS_CONFLICT"}'; end if;
  end if;

  insert into public.template(name, specialty, owner_user_id, is_global)
  values (v_name, v_specialty, case when v_is_global then null else v_uid end, v_is_global)
  returning id into v_template_id;
  insert into public.template_version(template_id, version_number, status, created_by)
  values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

  if v_source_version_id is not null then
    -- FOR SHARE ci-dessus garantit un snapshot coherent des attributs copies.
    insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
    select v_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types
    from public.template_field where template_version_id = v_source_version_id order by display_order, id;
    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id, rule, message, severity from public.validation_rule where template_version_id = v_source_version_id order by id;
  else
    insert into public.template_field(template_version_id, field_key, label, scope, section, type, unit, allowed_values, required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
    select v_version_id, btrim(f.value ->> 'fieldKey'), btrim(f.value ->> 'label'), f.value ->> 'scope', f.value ->> 'section', f.value ->> 'type',
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
revoke all on function public.create_template_bundle(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_template_bundle(jsonb, uuid) to authenticated;
