-- 20260916100000_form_preparations.sql — E1
-- Préparation persistante d'évolution d'un formulaire, isolée des données cliniques.
--
-- Cette migration est additive. Les tables sont fermées aux clients ; les seules
-- écritures passent par les RPC SECURITY DEFINER qui revalident l'acteur, la base,
-- la version source, la taille, l'état et la clé d'opération à chaque appel.
-- =============================================================================

-- La révision est opaque et monotone pour la base. Le fingerprint reste la preuve
-- structurelle ; la révision détecte aussi un changement de rattachement de version.
alter table public.base
  add column if not exists form_revision bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.base'::regclass
       and conname = 'base_form_revision_positive'
  ) then
    alter table public.base
      add constraint base_form_revision_positive check (form_revision > 0);
  end if;
end
$$;

create or replace function public.bump_base_form_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.current_template_version_id is distinct from old.current_template_version_id then
    new.form_revision := greatest(coalesce(old.form_revision, 1) + 1, 1);
  end if;
  return new;
end
$$;

revoke all on function public.bump_base_form_revision() from public, anon, authenticated;
drop trigger if exists trg_base_form_revision on public.base;
create trigger trg_base_form_revision
  before update of current_template_version_id on public.base
  for each row execute function public.bump_base_form_revision();

-- -----------------------------------------------------------------------------
-- Stockage dédié : aucun champ patient, identité, rencontre ou réponse clinique.
-- Le payload est une définition structurelle candidate, jamais une fiche.
-- -----------------------------------------------------------------------------
create table public.form_preparation (
  id                           uuid primary key default gen_random_uuid(),
  base_id                      uuid not null references public.base(id) on delete cascade,
  owner_id                     uuid not null references public.profiles(id) on delete cascade,
  created_by                   uuid not null references public.profiles(id) on delete restrict,
  source_template_version_id   uuid not null references public.template_version(id) on delete restrict,
  source_revision              bigint not null check (source_revision > 0),
  source_fingerprint           text not null check (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  preparation_revision         bigint not null default 1 check (preparation_revision > 0),
  content_fingerprint          text not null check (content_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  payload                      jsonb not null default '{}'::jsonb,
  classification               text not null default 'additive'
    check (classification in ('additive', 'additive_required', 'semantic', 'unsupported')),
  state                        text not null default 'active'
    check (state in ('active', 'ready', 'applied', 'discarded', 'conflict', 'expired')),
  created_at                   timestamptz not null default clock_timestamp(),
  updated_at                   timestamptz not null default clock_timestamp(),
  expires_at                   timestamptz not null default (clock_timestamp() + interval '7 days'),
  constraint form_preparation_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint form_preparation_payload_size check (octet_length(payload::text) <= 262144)
);

create unique index uq_form_preparation_open_base
  on public.form_preparation (base_id)
  where state in ('active', 'ready', 'conflict');
create index ix_form_preparation_owner_state
  on public.form_preparation (owner_id, state, updated_at desc);
create index ix_form_preparation_expiry
  on public.form_preparation (expires_at)
  where state in ('active', 'ready', 'conflict');

create table public.form_preparation_operation (
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  operation_id   uuid not null,
  preparation_id uuid references public.form_preparation(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('save', 'preview', 'resume', 'discard')),
  request_hash   text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  receipt        jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at     timestamptz not null default clock_timestamp(),
  primary key (owner_id, operation_id)
);
create index ix_form_preparation_operation_preparation
  on public.form_preparation_operation (preparation_id, created_at desc);

alter table public.form_preparation enable row level security;
alter table public.form_preparation_operation enable row level security;
revoke all on table public.form_preparation from public, anon, authenticated;
revoke all on table public.form_preparation_operation from public, anon, authenticated;

comment on table public.form_preparation is
  'Préparation structurelle E1 uniquement : aucune identité, réponse patient, rencontre ou document brut.';
comment on column public.form_preparation.source_fingerprint is
  'Empreinte SHA-256 de la définition structurelle source, sans identifiants techniques.';
comment on column public.form_preparation.content_fingerprint is
  'Empreinte SHA-256 du payload structurel normalisé ; jamais un secret d autorisation.';

-- -----------------------------------------------------------------------------
-- Empreinte de définition. Les UUID techniques sont volontairement remplacés par
-- des clés structurelles afin que deux copies identiques aient la même empreinte.
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
        ) order by s.display_order, s.section_key
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

create or replace function public.form_preparation_fingerprint(p_value jsonb)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select 'sha256:' || encode(digest(convert_to(coalesce(p_value, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- Validation et normalisation du payload structurel.
-- -----------------------------------------------------------------------------
create or replace function public.form_preparation_assert_no_clinical_keys(p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pair record;
  v_item jsonb;
  v_key text;
begin
  if p_value is null then return; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_pair in select key, value from jsonb_each(p_value) loop
      v_key := lower(v_pair.key);
      if v_key = any (array[
        'patient', 'patients', 'encounter', 'encounters', 'identity', 'identities',
        'response', 'responses', 'answer', 'answers', 'clinical', 'clinicaldata',
        'clinical_data', 'values', 'document', 'documents', 'raw', 'rawdocument',
        'raw_documents', 'patient_code', 'full_name', 'date_of_birth', 'phone', 'address',
        'external_identifier', 'storage_path', 'storageobject'
      ]) then
        raise exception using
          errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
          detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'clinical_key')::text;
      end if;
      perform public.form_preparation_assert_no_clinical_keys(v_pair.value);
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      perform public.form_preparation_assert_no_clinical_keys(v_item);
    end loop;
  end if;
end
$$;

create or replace function public.form_preparation_order_array(p_value jsonb, p_key text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_type text;
begin
  v_type := jsonb_typeof(coalesce(p_value, '[]'::jsonb));
  if v_type <> 'array' then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'array_expected')::text;
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_value, '[]'::jsonb)) x(value)
    where jsonb_typeof(x.value) <> 'object'
  ) then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'object_array_expected')::text;
  end if;
  select coalesce(jsonb_agg(x.value order by coalesce(x.value ->> p_key, ''), x.value::text), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(coalesce(p_value, '[]'::jsonb)) x(value);
  return v_result;
end
$$;

create or replace function public.form_preparation_normalize(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_allowed constant text[] := array['sections','commonGroups','fields','rules','diagnosisConfiguration','provenance'];
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'object_expected')::text;
  end if;
  if octet_length(p_payload::text) > 262144 then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_TOO_LARGE',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_TOO_LARGE', 'maxBytes', 262144)::text;
  end if;
  for v_key in select key from jsonb_object_keys(p_payload) key loop
    if not (v_key = any(v_allowed)) then
      raise exception using
        errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
        detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'unknown_key')::text;
    end if;
  end loop;
  perform public.form_preparation_assert_no_clinical_keys(p_payload);
  v_result := jsonb_build_object(
    'sections', public.form_preparation_order_array(p_payload -> 'sections', 'sectionKey'),
    'commonGroups', public.form_preparation_order_array(p_payload -> 'commonGroups', 'groupKey'),
    'fields', public.form_preparation_order_array(p_payload -> 'fields', 'fieldKey'),
    'rules', public.form_preparation_order_array(p_payload -> 'rules', 'ruleKey'),
    'diagnosisConfiguration', coalesce(p_payload -> 'diagnosisConfiguration', '[]'::jsonb),
    'provenance', coalesce(p_payload -> 'provenance', '{}'::jsonb)
  );
  if octet_length(v_result::text) > 262144 then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_TOO_LARGE',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_TOO_LARGE', 'maxBytes', 262144)::text;
  end if;
  return v_result;
end
$$;

-- Le serveur ne déduit pas l'autorisation d'une empreinte. Cette fonction sert
-- uniquement à comparer la structure et à retourner un diagnostic borné.
create or replace function public.form_preparation_classify(p_source jsonb, p_candidate jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source jsonb := coalesce(p_source, '{}'::jsonb);
  v_candidate jsonb := coalesce(p_candidate, '{}'::jsonb);
  v_source_item jsonb;
  v_candidate_item jsonb;
  v_source_key text;
  v_candidate_key text;
  v_added int := 0;
  v_removed int := 0;
  v_changed int := 0;
  v_required_added int := 0;
  v_classification text := 'additive';
begin
  for v_candidate_item in select value from jsonb_array_elements(v_candidate -> 'fields') loop
    v_candidate_key := coalesce(v_candidate_item ->> 'fieldKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', 0, 'removed', 0, 'changed', 0);
    end if;
    select value into v_source_item
      from jsonb_array_elements(v_source -> 'fields')
     where value ->> 'fieldKey' = v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
      if coalesce((v_candidate_item ->> 'required')::boolean, false) then
        v_required_added := v_required_added + 1;
      end if;
    elsif (v_source_item - 'displayOrder') <> (v_candidate_item - 'displayOrder') then
      v_changed := v_changed + 1;
    end if;
  end loop;

  for v_source_item in select value from jsonb_array_elements(v_source -> 'fields') loop
    v_source_key := coalesce(v_source_item ->> 'fieldKey', '');
    if not exists (
      select 1 from jsonb_array_elements(v_candidate -> 'fields') x(value)
       where value ->> 'fieldKey' = v_source_key
    ) then
      v_removed := v_removed + 1;
    end if;
  end loop;

  -- Même règle pour les sections et rubriques : suppression ou modification
  -- structurelle est conservée mais explicitement non applicable en E1.
  for v_candidate_item in
    select value from jsonb_array_elements(v_candidate -> 'sections')
  loop
    v_candidate_key := coalesce(v_candidate_item ->> 'sectionKey', '');
    select value into v_source_item
      from jsonb_array_elements(v_source -> 'sections')
     where value ->> 'sectionKey' = v_candidate_key;
    if v_source_item is null then v_added := v_added + 1;
    elsif v_source_item <> v_candidate_item then v_changed := v_changed + 1;
    end if;
  end loop;
  for v_source_item in select value from jsonb_array_elements(v_source -> 'sections') loop
    v_source_key := coalesce(v_source_item ->> 'sectionKey', '');
    if not exists (
      select 1 from jsonb_array_elements(v_candidate -> 'sections') x(value)
       where value ->> 'sectionKey' = v_source_key
    ) then v_removed := v_removed + 1; end if;
  end loop;

  if v_removed > 0 or v_changed > 0 then
    v_classification := 'semantic';
  elsif v_required_added > 0 then
    v_classification := 'additive_required';
  else
    v_classification := 'additive';
  end if;
  return jsonb_build_object(
    'classification', v_classification,
    'code', case when v_classification = 'semantic' then 'FORM_SEMANTIC_MIGRATION_REQUIRED' else null end,
    'added', v_added,
    'removed', v_removed,
    'changed', v_changed,
    'requiredAdded', v_required_added
  );
end
$$;

-- -----------------------------------------------------------------------------
-- Helpers privés des RPC.
-- -----------------------------------------------------------------------------
create or replace function public.form_preparation_assert_owner(p_base_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base public.base;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  select * into v_base from public.base where id = p_base_id and deleted_at is null;
  if not found or v_base.owner_user_id is distinct from auth.uid() or not public.is_medecin() then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
  end if;
  if v_base.current_template_version_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID';
  end if;
end
$$;

create or replace function public.form_preparation_operation_result(
  p_operation_id uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.form_preparation_operation;
begin
  if p_operation_id is null or p_request_hash is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;
  select * into v_row
    from public.form_preparation_operation
   where owner_id = auth.uid() and operation_id = p_operation_id
   for update;
  if not found then return null; end if;
  if v_row.request_hash <> p_request_hash then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_CONFLICT',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_OPERATION_CONFLICT', 'operationId', p_operation_id)::text;
  end if;
  return v_row.receipt;
end
$$;

create or replace function public.form_preparation_json(p_row public.form_preparation)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'baseId', p_row.base_id,
    'sourceTemplateVersionId', p_row.source_template_version_id,
    'sourceRevision', p_row.source_revision,
    'sourceFingerprint', p_row.source_fingerprint,
    'preparationRevision', p_row.preparation_revision,
    'contentFingerprint', p_row.content_fingerprint,
    'classification', p_row.classification,
    'state', p_row.state,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'expiresAt', p_row.expires_at,
    'payload', case when p_row.state in ('active', 'ready', 'conflict') then p_row.payload else '{}'::jsonb end
  )
$$;

create or replace function public.form_preparation_receipt(
  p_row public.form_preparation,
  p_operation_id uuid,
  p_operation_kind text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'preparation', public.form_preparation_json(p_row),
    'operationId', p_operation_id,
    'operationKind', p_operation_kind,
    'audit', jsonb_build_object(
      'sourceRevision', p_row.source_revision,
      'sourceFingerprint', p_row.source_fingerprint,
      'contentFingerprint', p_row.content_fingerprint,
      'preparationRevision', p_row.preparation_revision,
      'state', p_row.state,
      'classification', p_row.classification
    )
  )
$$;

create or replace function public.form_preparation_error_json(
  p_code text,
  p_preparation_id uuid,
  p_operation_id uuid,
  p_retryable boolean default false
)
returns jsonb
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'error', p_code,
    'preparationId', p_preparation_id,
    'operationId', p_operation_id,
    'retryable', p_retryable
  )
$$;

create or replace function public.expire_form_preparations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_count integer := 0;
begin
  for v_row in
    update public.form_preparation
       set state = 'expired', payload = '{}'::jsonb, updated_at = clock_timestamp()
     where state in ('active', 'ready', 'conflict') and expires_at <= clock_timestamp()
     returning *
  loop
    insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_expired', 'form_preparation', v_row.id, v_row.base_id,
            jsonb_build_object('state', 'expired', 'source_revision', v_row.source_revision,
              'source_fingerprint', v_row.source_fingerprint, 'preparation_revision', v_row.preparation_revision));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function public.expire_form_preparations() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC : ouvrir/reprendre et lire. L'ouverture sans modification ne persiste pas
-- de ligne ; la définition renvoyée est structurelle uniquement.
-- -----------------------------------------------------------------------------
create or replace function public.open_or_resume_form_preparation(p_base_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base public.base;
  v_row public.form_preparation;
  v_source jsonb;
  v_fingerprint text;
begin
  perform public.form_preparation_assert_owner(p_base_id);
  perform public.expire_form_preparations();
  select * into v_base from public.base where id = p_base_id and deleted_at is null for update;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_fingerprint := public.form_preparation_fingerprint(v_source);
  select * into v_row
    from public.form_preparation
   where base_id = p_base_id and owner_id = auth.uid()
     and state in ('active', 'ready', 'conflict')
   order by updated_at desc
   limit 1;
  return jsonb_build_object(
    'preparation', case when v_row.id is null then null else public.form_preparation_json(v_row) end,
    'context', jsonb_build_object(
      'baseId', v_base.id,
      'sourceTemplateVersionId', v_base.current_template_version_id,
      'sourceRevision', v_base.form_revision,
      'sourceFingerprint', v_fingerprint,
      'definition', v_source
    ),
    'persisted', v_row.id is not null
  );
end
$$;
revoke all on function public.open_or_resume_form_preparation(uuid) from public, anon;
grant execute on function public.open_or_resume_form_preparation(uuid) to authenticated;

create or replace function public.read_form_preparation(p_preparation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.form_preparation;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND';
  end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  select * into v_row from public.form_preparation where id = p_preparation_id;
  if v_row.state in ('applied', 'discarded', 'expired') then
    return public.form_preparation_json(v_row);
  end if;
  return public.form_preparation_json(v_row);
end
$$;
revoke all on function public.read_form_preparation(uuid) from public, anon;
grant execute on function public.read_form_preparation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC : sauvegarde idempotente. Le client fournit un UUID de préparation stable
-- pendant une reprise locale et un UUID d'opération stable pour chaque mutation.
-- -----------------------------------------------------------------------------
create or replace function public.save_form_preparation(
  p_preparation_id uuid,
  p_base_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base public.base;
  v_row public.form_preparation;
  v_norm jsonb;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
  v_source jsonb;
  v_source_fp text;
  v_classification jsonb;
  v_content_fp text;
begin
  perform public.form_preparation_assert_owner(p_base_id);
  if p_preparation_id is null or p_operation_id is null or p_expected_preparation_revision is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;
  perform public.expire_form_preparations();
  v_norm := public.form_preparation_normalize(p_payload);
  v_hash := encode(digest(convert_to(jsonb_build_object('save', p_preparation_id, 'base', p_base_id,
    'revision', p_expected_preparation_revision, 'sourceRevision', p_expected_source_revision,
    'sourceFingerprint', p_expected_source_fingerprint, 'payload', v_norm)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;

  select * into v_base from public.base where id = p_base_id and deleted_at is null for update;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  v_content_fp := public.form_preparation_fingerprint(v_norm);

  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if found then
    if v_row.base_id <> p_base_id or v_row.owner_id <> auth.uid() then
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN';
    end if;
    if v_row.state in ('applied', 'discarded', 'expired') then
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
    end if;
    if v_row.state = 'conflict' then
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
    end if;
    if p_expected_preparation_revision <> v_row.preparation_revision
       or p_expected_source_revision is distinct from v_base.form_revision
       or p_expected_source_fingerprint is distinct from v_source_fp then
      update public.form_preparation
         set state = 'conflict', updated_at = clock_timestamp()
       where id = v_row.id
       returning * into v_row;
      v_receipt := public.form_preparation_error_json('FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true);
      insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
      values (auth.uid(), p_operation_id, v_row.id, 'save', v_hash, v_receipt);
      return v_receipt;
    end if;
    v_classification := public.form_preparation_classify(v_source, v_norm);
    update public.form_preparation
       set source_template_version_id = v_base.current_template_version_id,
           source_revision = v_base.form_revision,
           source_fingerprint = v_source_fp,
           preparation_revision = v_row.preparation_revision + 1,
           content_fingerprint = v_content_fp,
           payload = v_norm,
           classification = coalesce(v_classification ->> 'classification', 'unsupported'),
           state = 'active',
           updated_at = clock_timestamp(),
           expires_at = greatest(v_row.expires_at, clock_timestamp() + interval '7 days')
     where id = v_row.id
     returning * into v_row;
  else
    if p_expected_preparation_revision <> 0
       or p_expected_source_revision is distinct from v_base.form_revision
       or p_expected_source_fingerprint is distinct from v_source_fp then
      raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
    end if;
    v_classification := public.form_preparation_classify(v_source, v_norm);
    insert into public.form_preparation(
      id, base_id, owner_id, created_by, source_template_version_id, source_revision,
      source_fingerprint, preparation_revision, content_fingerprint, payload, classification
    ) values (
      p_preparation_id, p_base_id, auth.uid(), auth.uid(), v_base.current_template_version_id,
      v_base.form_revision, v_source_fp, 1, v_content_fp, v_norm,
      coalesce(v_classification ->> 'classification', 'unsupported')
    ) returning * into v_row;
  end if;

  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'save');
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'save', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_saved', 'form_preparation', v_row.id, p_base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'classification', v_row.classification, 'source_revision', v_row.source_revision,
      'source_fingerprint', v_row.source_fingerprint, 'content_fingerprint', v_row.content_fingerprint,
      'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.save_form_preparation(uuid, uuid, bigint, bigint, text, uuid, jsonb) from public, anon;
grant execute on function public.save_form_preparation(uuid, uuid, bigint, bigint, text, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC : prévisualisation. Elle ne modifie jamais template_version, base, patient,
-- rencontre, identité, document ou réponse clinique.
-- -----------------------------------------------------------------------------
create or replace function public.preview_form_preparation(
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
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_classification jsonb;
  v_receipt jsonb;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND'; end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  v_hash := encode(digest(convert_to(jsonb_build_array('preview', p_preparation_id,
    p_expected_preparation_revision, p_expected_source_revision, p_expected_source_fingerprint)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;
  select * into v_base from public.base where id = v_row.base_id and deleted_at is null for update;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision <> v_row.preparation_revision
     or p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp then
    update public.form_preparation set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id returning * into v_row;
    v_receipt := public.form_preparation_error_json('FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true);
  else
    v_classification := public.form_preparation_classify(v_source, v_row.payload);
    update public.form_preparation
       set state = case when v_classification ->> 'classification' in ('semantic','unsupported') then 'active' else 'ready' end,
           classification = coalesce(v_classification ->> 'classification', 'unsupported'),
           updated_at = clock_timestamp()
     where id = v_row.id returning * into v_row;
    if v_row.classification in ('semantic', 'unsupported') then
      v_receipt := public.form_preparation_error_json(
        case when v_row.classification = 'semantic' then 'FORM_SEMANTIC_MIGRATION_REQUIRED' else 'FORM_CHANGE_UNSUPPORTED' end,
        v_row.id, p_operation_id, false
      ) || jsonb_build_object('classification', v_row.classification);
    else
      v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'preview');
    end if;
  end if;
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'preview', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_previewed', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'classification', v_row.classification, 'source_revision', v_row.source_revision,
      'source_fingerprint', v_row.source_fingerprint, 'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.preview_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.preview_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;

create or replace function public.resume_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
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
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND'; end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  v_hash := encode(digest(convert_to(jsonb_build_array('resume', p_preparation_id, p_expected_preparation_revision)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;
  if p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  if v_row.state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID';
  end if;
  select * into v_base from public.base where id = v_row.base_id and deleted_at is null for update;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  update public.form_preparation
     set source_template_version_id = v_base.current_template_version_id,
         source_revision = v_base.form_revision,
         source_fingerprint = v_source_fp,
         preparation_revision = preparation_revision + 1,
         state = 'active',
         updated_at = clock_timestamp(),
         expires_at = clock_timestamp() + interval '7 days'
   where id = v_row.id
   returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'resume');
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'resume', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_resumed', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'source_revision', v_row.source_revision, 'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.resume_form_preparation(uuid, bigint, uuid) from public, anon;
grant execute on function public.resume_form_preparation(uuid, bigint, uuid) to authenticated;

create or replace function public.discard_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND'; end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  v_hash := encode(digest(convert_to(jsonb_build_array('discard', p_preparation_id, p_expected_preparation_revision)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  update public.form_preparation
     set state = 'discarded', payload = '{}'::jsonb, updated_at = clock_timestamp()
   where id = v_row.id returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'discard');
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'discard', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_discarded', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'source_revision', v_row.source_revision, 'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.discard_form_preparation(uuid, bigint, uuid) from public, anon;
grant execute on function public.discard_form_preparation(uuid, bigint, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Contrat de confirmation de purge : le code est aléatoire, court et séparé du
-- nom de base. Le texte clair n'est jamais persistant ni journalisé.
-- -----------------------------------------------------------------------------
create table public.base_purge_challenge (
  challenge_id uuid primary key default gen_random_uuid(),
  base_id uuid not null references public.base(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index ix_base_purge_challenge_active
  on public.base_purge_challenge (base_id, requested_by, expires_at)
  where consumed_at is null;
alter table public.base_purge_challenge enable row level security;
revoke all on table public.base_purge_challenge from public, anon, authenticated;

create table public.base_purge_challenge_operation (
  requested_by uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  base_id uuid not null references public.base(id) on delete cascade,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (requested_by, operation_id)
);
alter table public.base_purge_challenge_operation enable row level security;
revoke all on table public.base_purge_challenge_operation from public, anon, authenticated;

create or replace function public.issue_base_purge_challenge(p_base_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base public.base;
  v_existing public.base_purge_challenge_operation;
  v_challenge uuid;
  v_code text := '';
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i integer;
  v_hash text;
  v_receipt jsonb;
  v_public_receipt jsonb;
begin
  if auth.uid() is null or p_base_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_INVALID';
  end if;
  select * into v_base from public.base where id = p_base_id for update;
  if not found or v_base.owner_user_id <> auth.uid() or not public.is_medecin() then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_FORBIDDEN';
  end if;
  if v_base.deleted_at is null then
    raise exception using errcode = 'P0001', message = 'BASE_ACTIVE';
  end if;
  v_hash := encode(digest(convert_to(jsonb_build_array('issue', p_base_id)::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing from public.base_purge_challenge_operation
   where requested_by = auth.uid() and operation_id = p_operation_id for update;
  if found then
    if v_existing.request_hash <> v_hash or v_existing.base_id <> p_base_id then
      raise exception using errcode = 'P0001', message = 'PURGE_OPERATION_CONFLICT';
    end if;
    return v_existing.receipt;
  end if;
  v_challenge := gen_random_uuid();
  for v_i in 1..5 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)), 1);
  end loop;
  insert into public.base_purge_challenge(challenge_id, base_id, requested_by, code_hash)
  values (v_challenge, p_base_id, auth.uid(), encode(digest(convert_to(v_code || ':' || v_challenge::text || ':' || p_base_id::text, 'UTF8'), 'sha256'), 'hex'));
  -- Le code clair n'entre jamais dans la ligne d'idempotence ni dans l'audit.
  v_receipt := jsonb_build_object('challengeId', v_challenge, 'baseId', p_base_id,
    'expiresAt', (select expires_at from public.base_purge_challenge where challenge_id = v_challenge));
  v_public_receipt := v_receipt || jsonb_build_object('code', v_code);
  insert into public.base_purge_challenge_operation(requested_by, operation_id, base_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_base_id, v_hash, v_receipt);
  return v_public_receipt;
end
$$;
revoke all on function public.issue_base_purge_challenge(uuid, uuid) from public, anon;
grant execute on function public.issue_base_purge_challenge(uuid, uuid) to authenticated;

create or replace function public.confirm_base_purge_challenge(
  p_base_id uuid,
  p_challenge_id uuid,
  p_code text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base public.base;
  v_challenge public.base_purge_challenge;
  v_hash text;
begin
  if auth.uid() is null or p_base_id is null or p_challenge_id is null or p_operation_id is null
     or p_code is null or char_length(btrim(p_code)) <> 5 then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_INVALID';
  end if;
  select * into v_base from public.base where id = p_base_id for update;
  if not found or v_base.owner_user_id <> auth.uid() or not public.is_medecin() then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_FORBIDDEN';
  end if;
  if v_base.deleted_at is null then
    raise exception using errcode = 'P0001', message = 'BASE_ACTIVE';
  end if;
  select * into v_challenge from public.base_purge_challenge
   where challenge_id = p_challenge_id and base_id = p_base_id and requested_by = auth.uid()
   for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.expires_at <= clock_timestamp()
     or v_challenge.code_hash <> encode(digest(convert_to(upper(btrim(p_code)) || ':' || p_challenge_id::text || ':' || p_base_id::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_MISMATCH';
  end if;
  update public.base_purge_challenge set consumed_at = clock_timestamp() where challenge_id = p_challenge_id;
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'base_purge_challenge_confirmed', 'base', p_base_id, p_base_id,
    jsonb_build_object('challenge_id', p_challenge_id, 'operation_id', p_operation_id));
  return jsonb_build_object('confirmed', true, 'baseId', p_base_id, 'challengeId', p_challenge_id, 'operationId', p_operation_id);
end
$$;
revoke all on function public.confirm_base_purge_challenge(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.confirm_base_purge_challenge(uuid, uuid, text, uuid) to authenticated;

-- Les fonctions ci-dessus sont des helpers internes. PostgreSQL donne EXECUTE à
-- PUBLIC par défaut : le retirer explicitement évite qu'un client contourne le
-- contrat RPC ou lise une structure hors du contrôle d'accès de la façade.
revoke all on function public.form_preparation_source_definition(uuid) from public, anon, authenticated;
revoke all on function public.form_preparation_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_assert_no_clinical_keys(jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_order_array(jsonb, text) from public, anon, authenticated;
revoke all on function public.form_preparation_normalize(jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_classify(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.form_preparation_assert_owner(uuid) from public, anon, authenticated;
revoke all on function public.form_preparation_operation_result(uuid, text) from public, anon, authenticated;
revoke all on function public.form_preparation_json(public.form_preparation) from public, anon, authenticated;
revoke all on function public.form_preparation_receipt(public.form_preparation, uuid, text) from public, anon, authenticated;
revoke all on function public.form_preparation_error_json(text, uuid, uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Dispense de motif du propriétaire : le contrôle d'autorisation du domaine est
-- exécuté avant ce helper. Une absence de motif n'est donc jamais un bypass de
-- l'accès à l'identité, de l'édition, des transitions ou de la suppression de base.
-- -----------------------------------------------------------------------------
alter table public.field_change_log
  add column if not exists justification_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.field_change_log'::regclass
       and conname = 'field_change_justification_status_check'
  ) then
    alter table public.field_change_log
      add constraint field_change_justification_status_check
      check (justification_status is null or justification_status in ('provided', 'owner_exempt'));
  end if;
end
$$;

create or replace function public.form_justification_status(p_base_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_reason), '') is not null then return 'provided'; end if;
  if public.is_base_owner(p_base_id) and public.is_medecin() then return 'owner_exempt'; end if;
  raise exception using errcode = 'P0001', message = 'JUSTIFICATION_REQUIRED : Motif de correction requis';
end
$$;
revoke all on function public.form_justification_status(uuid, text) from public, anon, authenticated;

-- update_encounter / update_patient gardent les signatures et les contrôles E0
-- existants ; seule la validation du motif et son statut d'audit sont ajoutés.
create or replace function public.update_encounter(
  p_encounter_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter;
  v_base uuid;
  v_code text;
  v_dob date;
  v_age numeric;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
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
      and coalesce(p_validation_status, v_enc.validation_status) in ('draft','complete')
    ) then
      raise exception 'Acces refuse';
    end if;
  end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);

  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_enc.updated_at)
       is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception using errcode = 'P0001',
      message = 'CONFLIT_VERSION : la rencontre a ete modifiee entre-temps',
      detail = jsonb_build_object('code', 'conflict_version', 'entity', 'encounter', 'action', 'refresh_required')::text,
      hint = 'refresh_required';
  end if;

  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';
  perform public.assert_data_valid(v_enc.template_version_id, 'encounter', v_new);
  if coalesce(p_validation_status, v_enc.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_base) then
    perform public.assert_required_complete(v_enc.template_version_id, 'encounter', v_new, v_enc.encounter_type);
  end if;
  select date_of_birth into v_dob
    from public.patient_identity
   where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, justification_status, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key,
         auth.uid(), v_reason, v_justification_status, 'manual_correction');
    end if;
  end loop;
  update public.encounter
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_enc.validation_status),
         age_value = v_age,
         updated_at = now()
   where id = p_encounter_id
   returning * into v_enc;
  return v_enc;
end $$;
revoke all on function public.update_encounter(uuid, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.update_encounter(uuid, jsonb, text, text, timestamptz) to authenticated;

create or replace function public.update_patient(
  p_patient_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
begin
  select * into v_pat from public.patient where id = p_patient_id and deleted_at is null for update;
  if not found then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_pat.base_id) then
    if not (
      public.can_create_structured_data(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
      and coalesce(p_validation_status, v_pat.validation_status) in ('draft','complete')
    ) then raise exception 'Acces refuse'; end if;
  end if;
  v_justification_status := public.form_justification_status(v_pat.base_id, v_reason);
  if p_expected_version is null then
    raise exception using errcode = 'P0001', message = 'CONFLIT_VERSION : version patient requise',
      detail = jsonb_build_object('code', 'conflict_version', 'entity', 'patient', 'action', 'refresh_required')::text,
      hint = 'refresh_required';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception using errcode = 'P0001', message = 'CONFLIT_VERSION : le patient a ete modifie entre-temps',
      detail = jsonb_build_object('code', 'conflict_version', 'entity', 'patient', 'action', 'refresh_required')::text,
      hint = 'refresh_required';
  end if;
  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  if coalesce(p_validation_status, v_pat.validation_status) <> 'draft'
     or not public.can_edit_structured_data(v_pat.base_id) then
    perform public.assert_required_complete(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));
  end if;
  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, justification_status, source)
      values
        (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key,
         auth.uid(), v_reason, v_justification_status, 'manual_correction');
    end if;
  end loop;
  update public.patient
     set data = v_new,
         validation_status = coalesce(p_validation_status, v_pat.validation_status),
         updated_at = now()
   where id = p_patient_id
   returning * into v_pat;
  return v_pat;
end $$;
revoke all on function public.update_patient(uuid, jsonb, text, text, bigint) from public, anon;
grant execute on function public.update_patient(uuid, jsonb, text, text, bigint) to authenticated;

create or replace function public.update_patient_identity(
  p_patient_id uuid,
  p_full_name text,
  p_date_of_birth date,
  p_phone text,
  p_address text,
  p_external_identifier text,
  p_reason text,
  p_expected_version bigint
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pat public.patient;
  v_identity public.patient_identity;
  v_full_name text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_address text := nullif(btrim(p_address), '');
  v_external_identifier text := nullif(btrim(p_external_identifier), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
  v_changed_fields text[] := array[]::text[];
  v_from_version bigint;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v_pat from public.patient where id = p_patient_id and deleted_at is null for update;
  if not found then raise exception 'Patient introuvable'; end if;

  -- L'autorisation d'identité reste inchangée. La dispense intervient seulement
  -- après ce test et uniquement pour le propriétaire médecin de la base.
  if not (
    (public.is_medecin() and public.can_write_identity(v_pat.base_id))
    or (
      public.is_saisisseur()
      and public.can_write_identity(v_pat.base_id)
      and v_pat.created_by = auth.uid()
      and v_pat.validation_status = 'draft'
    )
  ) then raise exception 'Acces refuse'; end if;
  v_justification_status := public.form_justification_status(v_pat.base_id, v_reason);

  if p_expected_version is null then
    raise exception 'CONFLIT_VERSION : version patient requise' using errcode = 'P0001';
  end if;
  if v_pat.row_version is distinct from p_expected_version then
    raise exception 'CONFLIT_VERSION : le patient a ete modifie entre-temps' using errcode = 'P0001';
  end if;
  select * into v_identity
    from public.patient_identity
   where base_id = v_pat.base_id and patient_code = v_pat.patient_code and deleted_at is null
   for update;
  if not found then raise exception 'Identite patient introuvable'; end if;

  if v_identity.full_name is distinct from v_full_name then v_changed_fields := array_append(v_changed_fields, 'full_name'); end if;
  if v_identity.date_of_birth is distinct from p_date_of_birth then v_changed_fields := array_append(v_changed_fields, 'date_of_birth'); end if;
  if v_identity.phone is distinct from v_phone then v_changed_fields := array_append(v_changed_fields, 'phone'); end if;
  if v_identity.address is distinct from v_address then v_changed_fields := array_append(v_changed_fields, 'address'); end if;
  if v_identity.external_identifier is distinct from v_external_identifier then v_changed_fields := array_append(v_changed_fields, 'external_identifier'); end if;
  if cardinality(v_changed_fields) = 0 then return v_pat; end if;

  update public.patient_identity
     set full_name = v_full_name, date_of_birth = p_date_of_birth, phone = v_phone,
         address = v_address, external_identifier = v_external_identifier
   where id = v_identity.id;
  v_from_version := v_pat.row_version;
  update public.patient set updated_at = now() where id = v_pat.id returning * into v_pat;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (
    auth.uid(), 'patient_identity_corrected', 'patient', v_pat.id, v_pat.base_id,
    jsonb_strip_nulls(jsonb_build_object(
      'justification_status', v_justification_status,
      'reason', case when v_justification_status = 'provided' then v_reason else null end,
      'changed_fields', to_jsonb(v_changed_fields), 'from_version', v_from_version,
      'to_version', v_pat.row_version
    ))
  );
  return v_pat;
end $$;
revoke all on function public.update_patient_identity(uuid, text, date, text, text, text, text, bigint) from public, anon;
grant execute on function public.update_patient_identity(uuid, text, date, text, text, text, text, bigint) to authenticated;

create or replace function public.soft_delete_patient(p_patient_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_code text;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
begin
  select base_id, patient_code into v_base, v_code
    from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);
  update public.patient set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason where id = p_patient_id;
  update public.patient_identity set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = v_base and patient_code = v_code and deleted_at is null;
  update public.encounter set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
   where patient_id = p_patient_id and deleted_at is null;
  update public.clinical_attachment set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
   where patient_id = p_patient_id and deleted_at is null;
  perform public.log_audit('patient_deleted', 'patient', p_patient_id, v_base,
    jsonb_strip_nulls(jsonb_build_object('justification_status', v_justification_status,
      'reason', case when v_justification_status = 'provided' then v_reason else null end)));
end $$;
revoke all on function public.soft_delete_patient(uuid, text) from public, anon;
grant execute on function public.soft_delete_patient(uuid, text) to authenticated;

create or replace function public.soft_delete_encounter(p_encounter_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
begin
  select public.base_of_patient(e.patient_id) into v_base
    from public.encounter e where e.id = p_encounter_id and e.deleted_at is null;
  if v_base is null then raise exception 'Rencontre introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);
  update public.encounter set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason where id = p_encounter_id;
  perform public.log_audit('encounter_deleted', 'encounter', p_encounter_id, v_base,
    jsonb_strip_nulls(jsonb_build_object('justification_status', v_justification_status,
      'reason', case when v_justification_status = 'provided' then v_reason else null end)));
end $$;
revoke all on function public.soft_delete_encounter(uuid, text) from public, anon;
grant execute on function public.soft_delete_encounter(uuid, text) to authenticated;

create or replace function public.soft_delete_attachment(p_attachment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_justification_status text;
begin
  select public.base_of_patient(a.patient_id) into v_base
    from public.clinical_attachment a where a.id = p_attachment_id and a.deleted_at is null;
  if v_base is null then raise exception 'Image introuvable'; end if;
  if not (public.is_medecin() and public.can_write_identity(v_base)) then raise exception 'Acces refuse'; end if;
  v_justification_status := public.form_justification_status(v_base, v_reason);
  update public.clinical_attachment
     set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
   where id = p_attachment_id;
  perform public.log_audit('attachment_deleted', 'clinical_attachment', p_attachment_id, v_base,
    jsonb_strip_nulls(jsonb_build_object('justification_status', v_justification_status,
      'reason', case when v_justification_status = 'provided' then v_reason else null end)));
end $$;
revoke all on function public.soft_delete_attachment(uuid, text) from public, anon;
grant execute on function public.soft_delete_attachment(uuid, text) to authenticated;

create or replace function public.delete_curation_request(
  p_task_id uuid,
  p_reason text default null,
  p_delete_patient boolean default false
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.curation_task;
  v_pat uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_status text := case when v_reason is null then 'owner_exempt' else 'provided' end;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into t from public.curation_task where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if not public.is_base_owner(t.base_id) or not public.is_medecin() then raise exception 'Reserve au proprietaire de la base'; end if;
  if t.status = 'completed' then
    raise exception 'Une demande finalisee ne peut pas etre supprimee (les donnees sont deja publiees)';
  end if;
  update public.curation_task set deleted_at = now(), updated_at = now() where id = p_task_id;
  update public.raw_document set deleted_at = now(), deletion_reason = v_reason
   where submission_id = t.submission_id and deleted_at is null;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'curation_request_deleted', 'curation_task', p_task_id, t.base_id,
    jsonb_strip_nulls(jsonb_build_object('submission_id', t.submission_id,
      'justification_status', v_status, 'reason', case when v_status = 'provided' then v_reason else null end,
      'previous_status', t.status, 'patient_deleted', p_delete_patient)));
  if p_delete_patient then
    select target_patient_id into v_pat from public.raw_submission where id = t.submission_id;
    if v_pat is not null and exists (select 1 from public.patient where id = v_pat and deleted_at is null) then
      perform public.soft_delete_patient(v_pat, v_reason);
    end if;
  end if;
end $$;
revoke all on function public.delete_curation_request(uuid, text, boolean) from public, anon;
grant execute on function public.delete_curation_request(uuid, text, boolean) to authenticated;
