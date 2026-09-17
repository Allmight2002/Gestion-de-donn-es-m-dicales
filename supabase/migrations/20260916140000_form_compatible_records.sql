-- =============================================================================
-- E3 : lecture et ecriture compatibles des dossiers existants
--
-- Cette migration est additive. Une fiche garde sa template_version_id
-- historique ; la version courante de la base ne sert qu'a projeter les ajouts
-- compatibles. Les valeurs ne sont jamais remplacees par un defaut de gabarit.
-- Les tables de recu/provenance sont serveur-only. Les seuls chemins publics
-- sont les deux lectures de contexte et les deux mutations de complement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Revision propre aux rencontres et tables techniques serveur-only
-- -----------------------------------------------------------------------------

alter table public.encounter
  add column if not exists record_revision bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.encounter'::regclass
       and conname = 'encounter_record_revision_positive'
  ) then
    alter table public.encounter
      add constraint encounter_record_revision_positive check (record_revision > 0);
  end if;
end
$$;

create or replace function public.bump_encounter_record_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.record_revision := greatest(coalesce(old.record_revision, 1) + 1, 1);
  end if;
  return new;
end
$$;

revoke all on function public.bump_encounter_record_revision() from public, anon, authenticated;
drop trigger if exists trg_encounter_record_revision on public.encounter;
create trigger trg_encounter_record_revision
  before update on public.encounter
  for each row execute function public.bump_encounter_record_revision();

create table if not exists public.record_form_operation (
  actor_id          uuid not null references public.profiles(id) on delete restrict,
  operation_id      uuid not null,
  record_kind       text not null check (record_kind in ('patient', 'encounter')),
  record_id         uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  receipt           jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at        timestamptz not null default clock_timestamp(),
  primary key (actor_id, operation_id)
);

alter table public.record_form_operation enable row level security;
revoke all on table public.record_form_operation from public, anon, authenticated;

create table if not exists public.record_field_provenance (
  id                 uuid primary key default gen_random_uuid(),
  record_kind        text not null check (record_kind in ('patient', 'encounter')),
  record_id          uuid not null,
  field_key          text not null,
  origin             text not null check (origin in ('initial', 'completion', 'correction', 'import', 'offline_replay')),
  captured_by        uuid references public.profiles(id) on delete set null,
  captured_at        timestamptz not null default clock_timestamp(),
  definition_revision uuid not null references public.template_version(id) on delete restrict,
  operation_id       uuid,
  value_fingerprint  text not null check (value_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

alter table public.record_field_provenance enable row level security;
revoke all on table public.record_field_provenance from public, anon, authenticated;

create index if not exists ix_record_field_provenance_current
  on public.record_field_provenance(record_kind, record_id, field_key, captured_at desc);

-- -----------------------------------------------------------------------------
-- 2. Helpers internes : erreurs, droits, empreintes et compatibilite
-- -----------------------------------------------------------------------------

create or replace function public.form_record_error(p_code text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hint text;
begin
  v_hint := case
    when p_code in (
      'FORM_CONTEXT_CHANGED', 'FORM_RECORD_CONFLICT', 'FORM_VALUE_CONVERSION_REQUIRED'
    ) then 'refresh_required'
    else null
  end;
  if v_hint is null then
    raise exception using
      errcode = 'P0001',
      message = coalesce(nullif(p_code, ''), 'FORM_RECORD_INVALID'),
      detail = jsonb_build_object(
        'code', coalesce(nullif(p_code, ''), 'FORM_RECORD_INVALID'),
        'reason', coalesce(nullif(p_reason, ''), 'invalid_request'),
        'action', 'reject'
      )::text;
  else
    raise exception using
      errcode = 'P0001',
      message = coalesce(nullif(p_code, ''), 'FORM_RECORD_INVALID'),
      detail = jsonb_build_object(
        'code', coalesce(nullif(p_code, ''), 'FORM_RECORD_INVALID'),
        'reason', coalesce(nullif(p_reason, ''), 'invalid_request'),
        'action', 'refresh_required'
      )::text,
      hint = v_hint;
  end if;
end
$$;

revoke all on function public.form_record_error(text, text) from public, anon, authenticated;

create or replace function public.form_record_assert_read_access(p_base_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    perform public.form_record_error('AUTHENTICATION_REQUIRED', 'missing_actor');
  end if;
  if not exists (
    select 1 from public.base b where b.id = p_base_id and b.deleted_at is null
  ) then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'base_unavailable');
  end if;
  if not public.has_base_access(p_base_id) then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'base_access');
  end if;
end
$$;

revoke all on function public.form_record_assert_read_access(uuid) from public, anon, authenticated;

create or replace function public.form_record_assert_write_access(
  p_base_id uuid,
  p_created_by uuid,
  p_existing_status text,
  p_requested_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.form_record_assert_read_access(p_base_id);
  if public.can_edit_structured_data(p_base_id) then return; end if;

  -- Meme exception etendue que les RPC historiques : un saisisseur ne peut
  -- corriger que son propre brouillon, sans le promouvoir hors de draft/complete.
  if public.can_create_structured_data(p_base_id)
     and p_created_by = auth.uid()
     and p_existing_status = 'draft'
     and coalesce(p_requested_status, p_existing_status) in ('draft', 'complete') then
    return;
  end if;
  perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'structured_write');
end
$$;

revoke all on function public.form_record_assert_write_access(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.form_record_value_fingerprint(p_value jsonb)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select 'sha256:' || encode(
    digest(convert_to(coalesce(p_value, 'null'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

revoke all on function public.form_record_value_fingerprint(jsonb) from public, anon, authenticated;

create or replace function public.form_record_context_fingerprint(
  p_record_kind text,
  p_record_id uuid,
  p_record_revision bigint,
  p_base_id uuid,
  p_active_revision bigint,
  p_definition_revision uuid,
  p_data jsonb
)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.form_preparation_fingerprint(jsonb_build_object(
    'recordKind', p_record_kind,
    'recordId', p_record_id,
    'recordRevision', p_record_revision,
    'baseId', p_base_id,
    'activeRevision', p_active_revision,
    'definitionRevision', p_definition_revision,
    'dataFingerprint', public.form_record_value_fingerprint(coalesce(p_data, '{}'::jsonb))
  ))
$$;

revoke all on function public.form_record_context_fingerprint(text, uuid, bigint, uuid, bigint, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.form_record_field_compatible(
  p_historical public.template_field,
  p_active public.template_field
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select p_historical.id is not null
     and p_active.id is not null
     and p_historical.field_key = p_active.field_key
     and p_historical.scope = p_active.scope
     and p_historical.type = p_active.type
     and p_historical.unit is not distinct from p_active.unit
     and coalesce(p_historical.is_multiple, false) = coalesce(p_active.is_multiple, false)
     and p_historical.allowed_values is not distinct from p_active.allowed_values
     and p_historical.allowed_options is not distinct from p_active.allowed_options
     and p_historical.required = p_active.required
     and p_historical.min_value is not distinct from p_active.min_value
     and p_historical.max_value is not distinct from p_active.max_value
     and p_historical.allow_missing_codes = p_active.allow_missing_codes
     and coalesce(p_historical.missing_reasons, '{}'::text[])
           = coalesce(p_active.missing_reasons, '{}'::text[])
     and p_historical.formula is not distinct from p_active.formula
     and coalesce(p_historical.encounter_types, '{}'::text[])
           = coalesce(p_active.encounter_types, '{}'::text[])
$$;

revoke all on function public.form_record_field_compatible(public.template_field, public.template_field)
  from public, anon, authenticated;

create or replace function public.form_record_assert_known_data(
  p_historical_version uuid,
  p_active_version uuid,
  p_scope text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_historical public.template_field;
  v_active public.template_field;
begin
  if p_data is null then return; end if;
  for v_key in select jsonb_object_keys(p_data) loop
    v_historical := null;
    v_active := null;
    select * into v_historical
      from public.template_field
     where template_version_id = p_historical_version and field_key = v_key;
    select * into v_active
      from public.template_field
     where template_version_id = p_active_version and field_key = v_key;

    if v_historical.id is not null and v_historical.scope <> p_scope then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'historical_scope');
    end if;
    if v_active.id is not null and v_active.scope <> p_scope then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'active_scope');
    end if;
    if v_historical.id is null and v_active.id is null then
      -- Le mot "inconnu" conserve la forme attendue par les anciens clients,
      -- sans renvoyer la cle ou une valeur clinique dans le detail.
      raise exception using
        errcode = 'P0001',
        message = 'FORM_FIELD_UNKNOWN : champ inconnu',
        detail = jsonb_build_object('code', 'FORM_FIELD_UNKNOWN', 'reason', 'field_not_in_definition')::text;
    end if;
  end loop;
end
$$;

revoke all on function public.form_record_assert_known_data(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.form_record_assert_json_type(
  p_field public.template_field,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return; end if;
  if jsonb_typeof(p_value) = 'object' and p_value ? '__missing__' then return; end if;
  v_type := jsonb_typeof(p_value);

  if p_field.type in ('number', 'integer') and v_type <> 'number' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_number_expected');
  elsif p_field.type = 'boolean' and v_type <> 'boolean' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_boolean_expected');
  elsif p_field.type = 'multiselect' and v_type <> 'array' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_array_expected');
  elsif p_field.type = 'terminology' and coalesce(p_field.is_multiple, false)
        and v_type <> 'array' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_array_expected');
  elsif p_field.type = 'terminology' and not coalesce(p_field.is_multiple, false)
        and v_type <> 'object' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_object_expected');
  elsif p_field.type in ('text', 'select', 'date', 'datetime') and v_type <> 'string' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_string_expected');
  end if;
end
$$;

revoke all on function public.form_record_assert_json_type(public.template_field, jsonb)
  from public, anon, authenticated;

create or replace function public.form_record_assert_patch(
  p_historical_version uuid,
  p_active_version uuid,
  p_scope text,
  p_patch jsonb,
  p_encounter_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_historical public.template_field;
  v_active public.template_field;
  v_field public.template_field;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.form_record_error('FORM_FIELD_UNKNOWN', 'patch_object_expected');
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    v_historical := null;
    v_active := null;
    select * into v_historical from public.template_field
     where template_version_id = p_historical_version and field_key = v_key;
    select * into v_active from public.template_field
     where template_version_id = p_active_version and field_key = v_key;

    if v_historical.id is not null and v_historical.scope <> p_scope then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'historical_scope');
    end if;
    if v_active.id is not null and v_active.scope <> p_scope then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'active_scope');
    end if;
    if v_historical.id is null and v_active.id is null then
      perform public.form_record_error('FORM_FIELD_UNKNOWN', 'field_not_in_definition');
    end if;

    if v_historical.id is not null and v_active.id is not null then
      if not public.form_record_field_compatible(v_historical, v_active) then
        perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'definition_changed');
      end if;
    end if;
    v_field := case when v_active.id is not null then v_active else v_historical end;
    if v_field.formula is not null then
      perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'calculated_field');
    end if;
    if p_scope = 'encounter'
       and p_encounter_type is not null
       and v_field.encounter_types is not null
       and cardinality(v_field.encounter_types) > 0
       and not (p_encounter_type = any(v_field.encounter_types)) then
      perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'encounter_type');
    end if;
    perform public.form_record_assert_json_type(v_field, p_patch -> v_key);
  end loop;
end
$$;

revoke all on function public.form_record_assert_patch(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;

create or replace function public.form_record_merge_legacy_payload(
  p_historical_version uuid,
  p_active_version uuid,
  p_scope text,
  p_existing jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb := coalesce(p_payload, '{}'::jsonb);
  v_field record;
begin
  -- Compatibilite des anciens bundles : ils envoient un objet complet base sur
  -- la definition historique. Les champs apparus depuis sont conserves, mais
  -- les omissions historiques gardent le comportement de remplacement existant
  -- (notamment le retrait explicite d'une valeur masquee par l'ancien ecran).
  for v_field in
    select f.field_key
      from public.template_field f
     where f.template_version_id = p_active_version
       and f.scope = p_scope
       and not exists (
         select 1 from public.template_field h
          where h.template_version_id = p_historical_version
            and h.field_key = f.field_key
       )
       and coalesce(p_existing, '{}'::jsonb) ? f.field_key
       and not (v_result ? f.field_key)
  loop
    v_result := v_result || jsonb_build_object(v_field.field_key, p_existing -> v_field.field_key);
  end loop;
  return v_result;
end
$$;

revoke all on function public.form_record_merge_legacy_payload(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.form_record_assert_no_changed_hidden_values(
  p_active_version uuid,
  p_scope text,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hidden text[] := coalesce(public.visibility_hidden_fields(p_active_version, p_new), '{}');
  v_key text;
  v_code text := 'block_hidden_value';
begin
  if p_new is null or coalesce(array_length(v_hidden, 1), 0) = 0 then return; end if;

  for v_key in
    select jsonb_object_keys(p_new)
  loop
    continue when not (v_key = any(v_hidden));
    continue when not (p_new ? v_key);
    continue when (p_new -> v_key) = 'null'::jsonb;
    continue when (coalesce(p_old, '{}'::jsonb) -> v_key) is not distinct from (p_new -> v_key);

    if exists (
      select 1
        from public.validation_rule r
       where r.template_version_id = p_active_version
         and r.rule -> 'if' ->> 'operator' = 'contains_any'
         and r.rule -> 'then' ->> 'operator' = 'visible'
         and r.rule -> 'then' ->> 'field' = v_key
    ) then
      v_code := 'contains_any_hidden_value';
    else
      v_code := 'block_hidden_value';
    end if;

    raise exception using
      errcode = 'P0001',
      message = case when v_code = 'contains_any_hidden_value'
        then 'Variable masquee : actualisez l’application avant de reprendre l’enregistrement.'
        else 'Une valeur appartient a un bloc masque : actualisez l’application avant de reprendre l’enregistrement.'
      end,
      detail = jsonb_build_object(
        'code', v_code,
        'action', 'refresh_required'
      )::text,
      hint = 'refresh_required';
  end loop;
end
$$;

revoke all on function public.form_record_assert_no_changed_hidden_values(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

-- Definition structurelle enrichie : les UUID de version sont des revisions,
-- jamais des valeurs de fiche. Les donnees d'identite ne sont pas jointes.
create or replace function public.form_record_definition(p_version uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.form_preparation_source_definition(p_version) || jsonb_build_object(
    'definitionRevision', tv.id,
    'version', jsonb_build_object(
      'id', tv.id,
      'templateId', tv.template_id,
      'versionNumber', tv.version_number,
      'status', tv.status,
      'createdAt', tv.created_at,
      'derivedFromTemplateVersionId', tv.derived_from_template_version_id,
      'derivedFromPreparationId', tv.derived_from_preparation_id,
      'derivedFromContentFingerprint', tv.derived_from_content_fingerprint,
      'appliedOperationId', tv.applied_operation_id,
      'appliedAt', tv.applied_at
    ),
    'diagnosisContext', public.get_diagnosis_context(tv.id)
  )
  from public.template_version tv
  where tv.id = p_version
$$;

revoke all on function public.form_record_definition(uuid) from public, anon, authenticated;

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
  v_scope text := p_record_kind;
  v_historical_definition jsonb := public.form_record_definition(p_historical_version);
  v_active_definition jsonb := public.form_record_definition(p_active_version);
  v_hidden text[] := coalesce(public.visibility_hidden_fields(p_active_version, p_data), '{}');
  v_fields jsonb := '[]'::jsonb;
  v_values jsonb := '{}'::jsonb;
  v_obligations jsonb := '[]'::jsonb;
  v_current_missing jsonb := '[]'::jsonb;
  v_historical_missing jsonb := '[]'::jsonb;
  v_diagnosis jsonb;
  v_field jsonb;
  v_active_field jsonb;
  v_item jsonb;
  v_provenance jsonb;
  v_value jsonb;
  v_key text;
  v_value_state text;
  v_definition_state text;
  v_applicable boolean;
  v_applicability_reason text;
  v_is_historical boolean;
  v_is_required boolean;
  v_encounter_applies boolean;
  v_f record;
begin
  if p_record_kind not in ('patient', 'encounter') then
    perform public.form_record_error('FORM_SCOPE_INCOMPATIBLE', 'record_kind');
  end if;

  -- Les champs historiques sont toujours projetes, meme si la version active
  -- les masque ou ne les porte plus. La valeur d'un champ non applicable n'est
  -- pas renvoyee : sa presence historique reste protegees par le serveur.
  for v_field in
    select x.value
      from jsonb_array_elements(coalesce(v_historical_definition -> 'fields', '[]'::jsonb)) x(value)
     where x.value ->> 'scope' = v_scope
     order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'fieldKey'
  loop
    v_key := v_field ->> 'fieldKey';
    v_active_field := null;
    select x.value into v_active_field
      from jsonb_array_elements(coalesce(v_active_definition -> 'fields', '[]'::jsonb)) x(value)
     where x.value ->> 'fieldKey' = v_key
       and x.value ->> 'scope' = v_scope
     limit 1;
    v_is_historical := true;
    v_encounter_applies := p_record_kind <> 'encounter'
      or p_encounter_type is null
      or v_active_field is null
      or jsonb_typeof(v_active_field -> 'encounterTypes') is distinct from 'array'
      or jsonb_array_length(v_active_field -> 'encounterTypes') = 0
      or (v_active_field -> 'encounterTypes') @> jsonb_build_array(p_encounter_type);
    v_applicable := v_active_field is not null
      and not (v_key = any(v_hidden))
      and v_encounter_applies;
    v_applicability_reason := case
      when v_active_field is null then 'not_in_active_definition'
      when v_key = any(v_hidden) then 'rule_hidden'
      when not v_encounter_applies then 'encounter_type'
      else 'applicable'
    end;
    if v_active_field is not null and (
      v_field ->> 'type' is distinct from v_active_field ->> 'type'
      or v_field ->> 'scope' is distinct from v_active_field ->> 'scope'
      or coalesce(v_field ->> 'formula', '') is distinct from coalesce(v_active_field ->> 'formula', '')
      or coalesce(v_field -> 'isMultiple', 'false'::jsonb) is distinct from coalesce(v_active_field -> 'isMultiple', 'false'::jsonb)
      or coalesce(v_field -> 'encounterTypes', '[]'::jsonb) is distinct from coalesce(v_active_field -> 'encounterTypes', '[]'::jsonb)
    ) then
      v_applicable := false;
      v_applicability_reason := 'definition_incompatible';
    end if;

    v_value := p_data -> v_key;
    v_value_state := case
      when not v_applicable then 'not_applicable'
      when not (p_data ? v_key) or v_value is null or jsonb_typeof(v_value) = 'null' then 'empty'
      when jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '' then 'empty'
      when jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0 then 'empty'
      when jsonb_typeof(v_value) = 'object' and v_value ? '__missing__' then 'explicit_missing'
      else 'present'
    end;
    v_provenance := null;
    if v_applicable and v_value_state in ('present', 'explicit_missing') then
      select jsonb_build_object(
        'origin', rp.origin,
        'captured_by', rp.captured_by,
        'captured_at', rp.captured_at,
        'definition_revision', rp.definition_revision,
        'operation_id', rp.operation_id
      ) into v_provenance
        from public.record_field_provenance rp
       where rp.record_kind = p_record_kind
         and rp.record_id = p_record_id
         and rp.field_key = v_key
         and rp.value_fingerprint = public.form_record_value_fingerprint(v_value)
       order by rp.captured_at desc, rp.id desc
       limit 1;
      if v_provenance is null then
        v_provenance := jsonb_build_object(
          'origin', 'initial',
          'captured_by', p_created_by,
          'captured_at', p_created_at,
          'definition_revision', p_historical_version,
          'operation_id', null
        );
      end if;
    end if;
    v_item := jsonb_build_object(
      'field_key', v_key,
      'definition_revision', p_historical_version,
      'active_definition_revision', p_active_version,
      'scope', v_scope,
      'definition_state', 'defined',
      'applicability', case when v_applicable then 'applicable' else 'not_applicable' end,
      'applicability_reason', v_applicability_reason,
      'value_state', v_value_state,
      'provenance', v_provenance,
      'definition', v_field,
      'active_definition', v_active_field
    );
    if v_applicable and v_value_state in ('present', 'explicit_missing') then
      v_item := v_item || jsonb_build_object('value', v_value);
      v_values := v_values || jsonb_build_object(v_key, v_value);
    end if;
    if v_value_state = 'explicit_missing' then
      v_item := v_item || jsonb_build_object('missing_code', v_value ->> '__missing__');
    end if;
    v_fields := v_fields || jsonb_build_array(v_item);
  end loop;

  -- Un champ actif absent de la definition historique est expose sans valeur,
  -- y compris si le gabarit porte un defaultValue : ce default n'est jamais
  -- materialise dans la fiche existante.
  for v_field in
    select x.value
      from jsonb_array_elements(coalesce(v_active_definition -> 'fields', '[]'::jsonb)) x(value)
     where x.value ->> 'scope' = v_scope
       and not exists (
         select 1
           from jsonb_array_elements(coalesce(v_historical_definition -> 'fields', '[]'::jsonb)) h(value)
          where h.value ->> 'fieldKey' = x.value ->> 'fieldKey'
            and h.value ->> 'scope' = v_scope
       )
     order by coalesce((x.value ->> 'displayOrder')::int, 0), x.value ->> 'fieldKey'
  loop
    v_key := v_field ->> 'fieldKey';
    v_encounter_applies := p_record_kind <> 'encounter'
      or p_encounter_type is null
      or jsonb_typeof(v_field -> 'encounterTypes') is distinct from 'array'
      or jsonb_array_length(v_field -> 'encounterTypes') = 0
      or (v_field -> 'encounterTypes') @> jsonb_build_array(p_encounter_type);
    v_applicable := not (v_key = any(v_hidden)) and v_encounter_applies;
    v_value := p_data -> v_key;
    v_value_state := case
      when not v_applicable then 'not_applicable'
      when not (p_data ? v_key) or v_value is null or jsonb_typeof(v_value) = 'null' then 'empty'
      when jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '' then 'empty'
      when jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0 then 'empty'
      when jsonb_typeof(v_value) = 'object' and v_value ? '__missing__' then 'explicit_missing'
      else 'present'
    end;
    v_provenance := null;
    if v_applicable and v_value_state in ('present', 'explicit_missing') then
      select jsonb_build_object(
        'origin', rp.origin,
        'captured_by', rp.captured_by,
        'captured_at', rp.captured_at,
        'definition_revision', rp.definition_revision,
        'operation_id', rp.operation_id
      ) into v_provenance
        from public.record_field_provenance rp
       where rp.record_kind = p_record_kind
         and rp.record_id = p_record_id
         and rp.field_key = v_key
         and rp.value_fingerprint = public.form_record_value_fingerprint(v_value)
       order by rp.captured_at desc, rp.id desc
       limit 1;
      if v_provenance is null then
        v_provenance := jsonb_build_object(
          'origin', 'initial',
          'captured_by', p_created_by,
          'captured_at', p_created_at,
          'definition_revision', p_active_version,
          'operation_id', null
        );
      end if;
    end if;
    v_item := jsonb_build_object(
      'field_key', v_key,
      'definition_revision', p_active_version,
      'active_definition_revision', p_active_version,
      'scope', v_scope,
      'definition_state', 'not_defined',
      'applicability', case when v_applicable then 'applicable' else 'not_applicable' end,
      'applicability_reason', case
        when v_key = any(v_hidden) then 'rule_hidden'
        when not v_encounter_applies then 'encounter_type'
        else 'new_addition'
      end,
      'value_state', v_value_state,
      'provenance', v_provenance,
      'definition', v_field,
      'active_definition', v_field
    );
    if v_applicable and v_value_state in ('present', 'explicit_missing') then
      v_item := v_item || jsonb_build_object('value', v_value);
      v_values := v_values || jsonb_build_object(v_key, v_value);
    end if;
    if v_value_state = 'explicit_missing' then
      v_item := v_item || jsonb_build_object('missing_code', v_value ->> '__missing__');
    end if;
    v_fields := v_fields || jsonb_build_array(v_item);
  end loop;

  -- Les obligations sont calculees sur la definition active mais restent un
  -- resultat distinct de la couverture diagnostique et du statut clinique.
  for v_f in
    select f.*
      from public.template_field f
     where f.template_version_id = p_active_version
       and f.scope = v_scope
       and f.required
     order by f.display_order, f.field_key
  loop
    v_encounter_applies := v_scope <> 'encounter'
      or p_encounter_type is null
      or v_f.encounter_types is null
      or cardinality(v_f.encounter_types) = 0
      or p_encounter_type = any(v_f.encounter_types);
    v_value := p_data -> v_f.field_key;
    if v_encounter_applies and not (v_f.field_key = any(v_hidden))
       and (not (p_data ? v_f.field_key)
            or v_value is null
            or jsonb_typeof(v_value) = 'null'
            or (jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '')) then
      v_is_historical := exists (
        select 1 from public.template_field h
         where h.template_version_id = p_historical_version
           and h.scope = v_scope
           and h.field_key = v_f.field_key
      );
      v_obligations := v_obligations || jsonb_build_array(jsonb_build_object(
        'field_key', v_f.field_key,
        'label', v_f.label,
        'definition_revision', case when v_is_historical then p_historical_version else p_active_version end,
        'reason', case when v_is_historical then 'missing_value' else 'not_defined' end
      ));
      v_current_missing := v_current_missing || jsonb_build_array(v_f.field_key);
    end if;
  end loop;

  for v_f in
    select f.*
      from public.template_field f
     where f.template_version_id = p_historical_version
       and f.scope = v_scope
       and f.required
     order by f.display_order, f.field_key
  loop
    v_encounter_applies := v_scope <> 'encounter'
      or p_encounter_type is null
      or v_f.encounter_types is null
      or cardinality(v_f.encounter_types) = 0
      or p_encounter_type = any(v_f.encounter_types);
    v_value := p_data -> v_f.field_key;
    if v_encounter_applies
       and not (v_f.field_key = any(coalesce(public.visibility_hidden_fields(p_historical_version, p_data), '{}')))
       and (not (p_data ? v_f.field_key)
            or v_value is null
            or jsonb_typeof(v_value) = 'null'
            or (jsonb_typeof(v_value) = 'string' and v_value #>> '{}' = '')) then
      v_historical_missing := v_historical_missing || jsonb_build_array(v_f.field_key);
    end if;
  end loop;

  v_diagnosis := public.diagnosis_coverage_in_context(
    p_active_version, v_scope, coalesce(p_data, '{}'::jsonb),
    coalesce(v_active_definition -> 'diagnosisContext', '[]'::jsonb)
  );

  return jsonb_build_object(
    'record_kind', p_record_kind,
    'record_id', p_record_id,
    'record_revision', p_record_revision,
    'base_id', p_base_id,
    'active_revision', p_active_revision,
    'record_definition_revision', p_historical_version,
    'historical_definition', v_historical_definition,
    'active_definition', v_active_definition,
    'fields', v_fields,
    'values', v_values,
    'current_obligations', v_obligations,
    'completeness', jsonb_build_object(
      'current_missing_field_keys', v_current_missing,
      'current_missing_count', jsonb_array_length(v_current_missing),
      'current_complete', jsonb_array_length(v_current_missing) = 0,
      'historical_missing_field_keys', v_historical_missing,
      'historical_missing_count', jsonb_array_length(v_historical_missing),
      'historical_complete', jsonb_array_length(v_historical_missing) = 0
    ),
    'diagnosis_coverage', v_diagnosis,
    'validation_status', p_validation_status,
    'encounter_type', p_encounter_type
  );
end
$$;

revoke all on function public.form_record_context_json(text, uuid, uuid, bigint, bigint, uuid, uuid, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Facades de lecture : le contexte est calcule sous les droits serveur
-- -----------------------------------------------------------------------------

create or replace function public.read_patient_form_context(
  p_base_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_active_version uuid;
  v_context jsonb;
begin
  perform public.form_record_assert_read_access(p_base_id);

  select p.*,
         b.form_revision as base_form_revision,
         b.current_template_version_id as active_version
    into v_row
    from public.patient p
    join public.base b on b.id = p.base_id and b.deleted_at is null
   where p.id = p_patient_id
     and p.base_id = p_base_id
     and p.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'patient_unavailable');
  end if;

  v_active_version := coalesce(v_row.active_version, v_row.template_version_id);
  v_context := public.form_record_context_json(
    'patient',
    v_row.id,
    v_row.base_id,
    v_row.row_version,
    v_row.base_form_revision,
    v_row.template_version_id,
    v_active_version,
    v_row.data,
    v_row.validation_status,
    v_row.created_by,
    v_row.created_at,
    null
  );

  return v_context || jsonb_build_object(
    'context_fingerprint', public.form_record_context_fingerprint(
      'patient', v_row.id, v_row.row_version, v_row.base_id,
      v_row.base_form_revision, v_row.template_version_id, v_row.data
    )
  );
end
$$;

revoke all on function public.read_patient_form_context(uuid, uuid) from public, anon;
grant execute on function public.read_patient_form_context(uuid, uuid) to authenticated;

create or replace function public.read_encounter_form_context(
  p_base_id uuid,
  p_encounter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_active_version uuid;
  v_context jsonb;
begin
  perform public.form_record_assert_read_access(p_base_id);

  select e.*,
         p.base_id as record_base_id,
         b.form_revision as base_form_revision,
         b.current_template_version_id as active_version
    into v_row
    from public.encounter e
    join public.patient p on p.id = e.patient_id and p.deleted_at is null
    join public.base b on b.id = p.base_id and b.deleted_at is null
   where e.id = p_encounter_id
     and p.base_id = p_base_id
     and e.deleted_at is null;
  if not found then
    perform public.form_record_error('FORM_RECORD_FORBIDDEN', 'encounter_unavailable');
  end if;

  v_active_version := coalesce(v_row.active_version, v_row.template_version_id);
  v_context := public.form_record_context_json(
    'encounter',
    v_row.id,
    v_row.record_base_id,
    v_row.record_revision,
    v_row.base_form_revision,
    v_row.template_version_id,
    v_active_version,
    v_row.data,
    v_row.validation_status,
    v_row.created_by,
    v_row.created_at,
    v_row.encounter_type
  );

  return v_context || jsonb_build_object(
    'context_fingerprint', public.form_record_context_fingerprint(
      'encounter', v_row.id, v_row.record_revision, v_row.record_base_id,
      v_row.base_form_revision, v_row.template_version_id, v_row.data
    )
  );
end
$$;

revoke all on function public.read_encounter_form_context(uuid, uuid) from public, anon;
grant execute on function public.read_encounter_form_context(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ecritures de complement : patch fusionne, revision et operation idempotente
-- -----------------------------------------------------------------------------

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
  if v_new_status <> 'draft' or not public.can_edit_structured_data(p_base_id) then
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

  perform public.form_record_assert_patch(
    v_enc.template_version_id, v_active_version, 'encounter', p_patch,
    v_enc.encounter_type
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

  v_new_status := coalesce(p_validation_status, v_enc.validation_status);
  if v_new_status <> 'draft' or not public.can_edit_structured_data(p_base_id) then
    perform public.assert_required_complete(
      v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type
    );
  end if;
  perform public.form_record_assert_no_changed_hidden_values(
    v_active_version, 'encounter', v_old, v_new
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

revoke all on function public.update_encounter_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text)
  from public, anon;
grant execute on function public.update_encounter_compatible(uuid, uuid, jsonb, text, text, bigint, uuid, uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Filet commun des voies d'ecriture
-- -----------------------------------------------------------------------------
-- Une fiche garde sa definition historique. La definition active ne sert qu'a
-- reconnaitre les ajouts compatibles ; elle ne rend pas obligatoires ses nouveaux
-- champs pour un statut clinique deja persistant.
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
    -- Une valeur historique masquee peut rester en place tant qu'elle n'est
    -- pas reecrite par l'ecran courant. Une valeur nouvellement changee sous
    -- une regle active reste interdite.
    perform public.form_record_assert_no_changed_hidden_values(
      v_active_version, v_scope, old.data, new.data
    );
  end if;

  perform public.form_record_assert_known_data(
    v_historical_version, v_active_version, v_scope, new.data
  );
  perform public.assert_data_valid(v_historical_version, v_scope, new.data);
  if v_active_version is distinct from v_historical_version then
    perform public.assert_data_valid(v_active_version, v_scope, new.data);
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

-- -----------------------------------------------------------------------------
-- 6. Anciennes signatures : remplacement complet preserve sans perte des ajouts
-- -----------------------------------------------------------------------------
-- Les clients non rafraichis continuent a envoyer un JSON complet historique.
-- Cette facade conserve uniquement les champs actifs apparus depuis, puis laisse
-- les validations et le trigger appliquer le meme filet que le nouveau patch.
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
