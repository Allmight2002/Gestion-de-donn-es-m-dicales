-- 20260916110000_form_preparation_hardening.sql — E1
-- Durcissement additif du contrat E1 : classification complète, conflit audité
-- et challenge de purge préparé avec un code reçu puis haché côté serveur.
-- =============================================================================

create or replace function public.form_preparation_jsonb_array_subset(
  p_subset jsonb,
  p_superset jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(coalesce(p_subset, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_superset, '[]'::jsonb)) <> 'array' then
    return false;
  end if;
  return not exists (
    select 1
      from jsonb_array_elements(coalesce(p_subset, '[]'::jsonb)) a(value)
     where not exists (
       select 1
         from jsonb_array_elements(coalesce(p_superset, '[]'::jsonb)) b(value)
        where b.value = a.value
     )
  );
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
  if p_payload ? 'diagnosisConfiguration'
     and jsonb_typeof(p_payload -> 'diagnosisConfiguration') <> 'array' then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'diagnosis_array_expected')::text;
  end if;
  if p_payload ? 'provenance'
     and jsonb_typeof(p_payload -> 'provenance') <> 'object' then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_INVALID',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_INVALID', 'reason', 'provenance_object_expected')::text;
  end if;
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
  v_source_signature jsonb;
  v_candidate_signature jsonb;
  v_added int := 0;
  v_removed int := 0;
  v_changed int := 0;
  v_required_added int := 0;
  v_classification text := 'additive';
begin
  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'fields', '[]'::jsonb)) loop
    v_candidate_key := coalesce(v_candidate_item ->> 'fieldKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', 0, 'removed', 0, 'changed', 0);
    end if;
    v_source_item := null;
    select value into v_source_item
      from jsonb_array_elements(coalesce(v_source -> 'fields', '[]'::jsonb))
     where value ->> 'fieldKey' = v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
      if coalesce((v_candidate_item ->> 'required')::boolean, false) then
        v_required_added := v_required_added + 1;
      end if;
    else
      -- Libellé, description, ordre, section et groupe commun sont de la
      -- présentation. Les attributs de portée, type, applicabilité et valeur
      -- par défaut restent sémantiques.
      v_source_signature := v_source_item - array['displayOrder','label','description','sectionKey','commonGroupKey','allowedValues','allowedOptions'];
      v_candidate_signature := v_candidate_item - array['displayOrder','label','description','sectionKey','commonGroupKey','allowedValues','allowedOptions'];
      if v_source_signature <> v_candidate_signature then
        v_changed := v_changed + 1;
      elsif (v_source_item -> 'allowedValues') is distinct from (v_candidate_item -> 'allowedValues')
        and not public.form_preparation_jsonb_array_subset(v_source_item -> 'allowedValues', v_candidate_item -> 'allowedValues') then
        v_changed := v_changed + 1;
      elsif (v_source_item -> 'allowedOptions') is distinct from (v_candidate_item -> 'allowedOptions')
        and (
          jsonb_typeof(v_source_item -> 'allowedOptions') <> 'array'
          or jsonb_typeof(v_candidate_item -> 'allowedOptions') <> 'array'
          or not public.form_preparation_jsonb_array_subset(v_source_item -> 'allowedOptions', v_candidate_item -> 'allowedOptions')
        ) then
        v_changed := v_changed + 1;
      end if;
    end if;
  end loop;

  for v_source_item in select value from jsonb_array_elements(coalesce(v_source -> 'fields', '[]'::jsonb)) loop
    v_source_key := coalesce(v_source_item ->> 'fieldKey', '');
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_candidate -> 'fields', '[]'::jsonb)) x(value)
       where value ->> 'fieldKey' = v_source_key
    ) then
      v_removed := v_removed + 1;
    end if;
  end loop;

  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'sections', '[]'::jsonb)) loop
    v_candidate_key := coalesce(v_candidate_item ->> 'sectionKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', v_added, 'removed', v_removed, 'changed', v_changed);
    end if;
    v_source_item := null;
    select value into v_source_item
      from jsonb_array_elements(coalesce(v_source -> 'sections', '[]'::jsonb))
     where value ->> 'sectionKey' = v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
    elsif (v_source_item - array['displayOrder','label']) <> (v_candidate_item - array['displayOrder','label']) then
      v_changed := v_changed + 1;
    end if;
  end loop;
  for v_source_item in select value from jsonb_array_elements(coalesce(v_source -> 'sections', '[]'::jsonb)) loop
    v_source_key := coalesce(v_source_item ->> 'sectionKey', '');
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_candidate -> 'sections', '[]'::jsonb)) x(value)
       where value ->> 'sectionKey' = v_source_key
    ) then
      v_removed := v_removed + 1;
    end if;
  end loop;

  -- Un nouveau groupe commun est additif ; un changement/suppression de groupe
  -- ou de ses propriétés structurelles reste sémantique.
  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'commonGroups', '[]'::jsonb)) loop
    v_candidate_key := coalesce(v_candidate_item ->> 'groupKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', v_added, 'removed', v_removed, 'changed', v_changed);
    end if;
    v_source_item := null;
    select value into v_source_item
      from jsonb_array_elements(coalesce(v_source -> 'commonGroups', '[]'::jsonb))
     where value ->> 'groupKey' = v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
    elsif (v_source_item - array['displayOrder','anchorOrder','label']) <> (v_candidate_item - array['displayOrder','anchorOrder','label']) then
      v_changed := v_changed + 1;
    end if;
  end loop;
  for v_source_item in select value from jsonb_array_elements(coalesce(v_source -> 'commonGroups', '[]'::jsonb)) loop
    v_source_key := coalesce(v_source_item ->> 'groupKey', '');
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_candidate -> 'commonGroups', '[]'::jsonb)) x(value)
       where value ->> 'groupKey' = v_source_key
    ) then
      v_removed := v_removed + 1;
    end if;
  end loop;

  -- Les règles et associations diagnostiques sont comparées par objet canonique.
  -- Une insertion pure est additive ; une modification ou suppression d'un objet
  -- existant produit simultanément un retrait et un ajout, donc semantic.
  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'rules', '[]'::jsonb)) loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_source -> 'rules', '[]'::jsonb)) x(value)
       where x.value = v_candidate_item
    ) then v_added := v_added + 1; end if;
  end loop;
  for v_source_item in select value from jsonb_array_elements(coalesce(v_source -> 'rules', '[]'::jsonb)) loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(v_candidate -> 'rules', '[]'::jsonb)) x(value)
       where x.value = v_source_item
    ) then v_removed := v_removed + 1; end if;
  end loop;
  if jsonb_typeof(coalesce(v_source -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array' then
    v_changed := v_changed + 1;
  else
    for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) loop
      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_source -> 'diagnosisConfiguration', '[]'::jsonb)) x(value)
         where x.value = v_candidate_item
      ) then v_added := v_added + 1; end if;
    end loop;
    for v_source_item in select value from jsonb_array_elements(coalesce(v_source -> 'diagnosisConfiguration', '[]'::jsonb)) loop
      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) x(value)
         where x.value = v_source_item
      ) then v_removed := v_removed + 1; end if;
    end loop;
  end if;

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

-- Un conflit de révision pendant une sauvegarde est une sortie métier, pas une
-- exception non tracée : le reçu structuré est déjà conservé pour le rejeu.
create or replace function public.audit_form_preparation_save_conflict()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base_id uuid;
begin
  if new.operation_kind = 'save' and new.receipt ->> 'error' = 'FORM_PREPARATION_CONFLICT' then
    select base_id into v_base_id from public.form_preparation where id = new.preparation_id;
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', new.preparation_id, v_base_id,
      jsonb_build_object('operation_id', new.operation_id, 'operation_kind', new.operation_kind,
        'retryable', coalesce((new.receipt ->> 'retryable')::boolean, true)));
  end if;
  return new;
end
$$;
revoke all on function public.form_preparation_jsonb_array_subset(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.audit_form_preparation_save_conflict() from public, anon, authenticated;
drop trigger if exists trg_form_preparation_save_conflict_audit on public.form_preparation_operation;
create trigger trg_form_preparation_save_conflict_audit
  after insert on public.form_preparation_operation
  for each row execute function public.audit_form_preparation_save_conflict();

-- Variante explicite du challenge : l'interface fournit un code aléatoire de
-- cinq caractères. Le serveur revalide l'alphabet, le propriétaire et la base,
-- puis ne conserve que le hash lié au challenge et à la base.
create or replace function public.prepare_base_purge_challenge(
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
  v_existing public.base_purge_challenge_operation;
  v_challenge public.base_purge_challenge;
  v_code text;
  v_request_hash text;
  v_code_hash text;
  v_receipt jsonb;
begin
  v_code := upper(btrim(p_code));
  if auth.uid() is null or p_base_id is null or p_challenge_id is null or p_operation_id is null
     or char_length(v_code) <> 5
     or v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$' then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_INVALID';
  end if;
  select * into v_base from public.base where id = p_base_id for update;
  if not found or v_base.owner_user_id <> auth.uid() or not public.is_medecin() then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_FORBIDDEN';
  end if;
  if v_base.deleted_at is null then
    raise exception using errcode = 'P0001', message = 'BASE_ACTIVE';
  end if;

  v_request_hash := encode(digest(convert_to(jsonb_build_array('prepare', p_base_id, p_challenge_id, v_code)::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing
    from public.base_purge_challenge_operation
   where requested_by = auth.uid() and operation_id = p_operation_id
   for update;
  if found then
    if v_existing.request_hash <> v_request_hash or v_existing.base_id <> p_base_id then
      raise exception using errcode = 'P0001', message = 'PURGE_OPERATION_CONFLICT';
    end if;
    return v_existing.receipt;
  end if;

  select * into v_challenge from public.base_purge_challenge
   where challenge_id = p_challenge_id for update;
  if found then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_CONFLICT';
  end if;
  v_code_hash := encode(digest(convert_to(v_code || ':' || p_challenge_id::text || ':' || p_base_id::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.base_purge_challenge(challenge_id, base_id, requested_by, code_hash)
  values (p_challenge_id, p_base_id, auth.uid(), v_code_hash)
  returning * into v_challenge;
  v_receipt := jsonb_build_object('challengeId', p_challenge_id, 'baseId', p_base_id,
    'expiresAt', v_challenge.expires_at, 'operationId', p_operation_id);
  insert into public.base_purge_challenge_operation(requested_by, operation_id, base_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_base_id, v_request_hash, v_receipt);
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'base_purge_challenge_prepared', 'base', p_base_id, p_base_id,
    jsonb_build_object('challenge_id', p_challenge_id, 'operation_id', p_operation_id));
  return v_receipt;
end
$$;
revoke all on function public.prepare_base_purge_challenge(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.prepare_base_purge_challenge(uuid, uuid, text, uuid) to authenticated;

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
  v_existing public.base_purge_challenge_operation;
  v_code text;
  v_request_hash text;
  v_receipt jsonb;
begin
  v_code := upper(btrim(p_code));
  if auth.uid() is null or p_base_id is null or p_challenge_id is null or p_operation_id is null
     or char_length(v_code) <> 5 then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_INVALID';
  end if;
  select * into v_base from public.base where id = p_base_id for update;
  if not found or v_base.owner_user_id <> auth.uid() or not public.is_medecin() then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_FORBIDDEN';
  end if;
  if v_base.deleted_at is null then
    raise exception using errcode = 'P0001', message = 'BASE_ACTIVE';
  end if;
  v_request_hash := encode(digest(convert_to(jsonb_build_array('confirm', p_base_id, p_challenge_id, v_code)::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing
    from public.base_purge_challenge_operation
   where requested_by = auth.uid() and operation_id = p_operation_id
   for update;
  if found then
    if v_existing.request_hash <> v_request_hash or v_existing.base_id <> p_base_id then
      raise exception using errcode = 'P0001', message = 'PURGE_OPERATION_CONFLICT';
    end if;
    return v_existing.receipt;
  end if;

  select * into v_challenge from public.base_purge_challenge
   where challenge_id = p_challenge_id and base_id = p_base_id and requested_by = auth.uid()
   for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.expires_at <= clock_timestamp()
     or v_challenge.code_hash <> encode(digest(convert_to(v_code || ':' || p_challenge_id::text || ':' || p_base_id::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception using errcode = 'P0001', message = 'PURGE_CHALLENGE_MISMATCH';
  end if;
  update public.base_purge_challenge set consumed_at = clock_timestamp() where challenge_id = p_challenge_id;
  v_receipt := jsonb_build_object('confirmed', true, 'baseId', p_base_id,
    'challengeId', p_challenge_id, 'operationId', p_operation_id);
  insert into public.base_purge_challenge_operation(requested_by, operation_id, base_id, request_hash, receipt)
  values (auth.uid(), p_operation_id, p_base_id, v_request_hash, v_receipt);
  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'base_purge_challenge_confirmed', 'base', p_base_id, p_base_id,
    jsonb_build_object('challenge_id', p_challenge_id, 'operation_id', p_operation_id));
  return v_receipt;
end
$$;
revoke all on function public.confirm_base_purge_challenge(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.confirm_base_purge_challenge(uuid, uuid, text, uuid) to authenticated;
