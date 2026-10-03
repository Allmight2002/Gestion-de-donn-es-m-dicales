-- 20261003220000_form_preparation_storage_bound.sql — lot P1
-- Sépare la borne de requête de la borne de stockage des préparations et rend
-- linéaires (ou n log n) les comparaisons source/candidat.
--
-- * Borne de requête : `save_form_preparation` refuse une charge complète de plus
--   de 1 048 576 octets (1 Mio). Mesure provisoire jusqu'au lot P3.
-- * Borne de stockage : 4 194 304 octets (4 Mio) pour la contrainte de table et
--   pour `form_preparation_normalize(jsonb)`, donc pour l'aperçu et l'application.
--   C'est un garde-fou contre les abus, pas une limite d'usage.
-- * Classification : dans `form_preparation_classify` et
--   `form_preparation_apply_assert_definition`, les recherches linéaires répétées
--   dans la source sont remplacées par des index clé -> objet ou par des
--   regroupements par valeur. Les sorties, compteurs, codes et ordres d'exception
--   restent identiques. `form_preparation_apply_classify` et
--   `form_preparation_apply_impact` ne sont pas redéfinies : leurs comparaisons
--   sont des requêtes uniques déjà exécutées en jointure par hachage.
--
-- Migration additive : aucune donnée n'est modifiée. Toutes les lignes existantes
-- respectent l'ancienne borne de 262 144 octets, donc la nouvelle contrainte.
-- Retour arrière : une migration ultérieure peut restaurer la borne précédente
-- tant qu'aucune préparation ne la dépasse ; les fonctions ne changent pas de
-- signature publique.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Borne de stockage
-- -----------------------------------------------------------------------------
alter table public.form_preparation
  drop constraint form_preparation_payload_size,
  add constraint form_preparation_payload_size check (octet_length(payload::text) <= 4194304);

-- Reprise à l'identique de la définition de 20260916110000 ; seule la borne
-- devient un paramètre, y compris dans `maxBytes`.
create or replace function public.form_preparation_normalize(p_payload jsonb, p_max_bytes integer)
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
  if octet_length(p_payload::text) > p_max_bytes then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_TOO_LARGE',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_TOO_LARGE', 'maxBytes', p_max_bytes)::text;
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
  if octet_length(v_result::text) > p_max_bytes then
    raise exception using
      errcode = 'P0001', message = 'FORM_PREPARATION_TOO_LARGE',
      detail = jsonb_build_object('code', 'FORM_PREPARATION_TOO_LARGE', 'maxBytes', p_max_bytes)::text;
  end if;
  return v_result;
end
$$;
revoke all on function public.form_preparation_normalize(jsonb, integer) from public, anon, authenticated;

-- La version à un argument applique la borne de stockage : l'aperçu et
-- l'application relisent un candidat déjà stocké.
create or replace function public.form_preparation_normalize(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.form_preparation_normalize(p_payload, 4194304);
end
$$;
revoke all on function public.form_preparation_normalize(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Borne de requête : `save_form_preparation` reçoit encore la définition
-- complète. Définition reprise à l'identique de 20260916100000, sauf l'appel de
-- normalisation borné à 1 Mio.
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
  v_norm := public.form_preparation_normalize(p_payload, 1048576);
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
-- 3. Classification ensembliste
-- -----------------------------------------------------------------------------

-- Index clé -> premier objet portant cette clé, dans l'ordre du tableau. Il
-- reproduit `select value into ... where value ->> clé = ...` (premier élément
-- trouvé) avec une recherche par clé jsonb au lieu d'un parcours du tableau.
-- Les clés absentes ou nulles ne sont jamais indexées : elles ne pouvaient pas
-- satisfaire l'égalité d'origine.
create or replace function public.form_preparation_index_by_key(p_items jsonb, p_key text)
returns jsonb
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(t.item_key, t.value), '{}'::jsonb)
    from (
      select distinct on (x.value ->> p_key) x.value ->> p_key as item_key, x.value
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(value, ord)
       where x.value ->> p_key is not null
       order by x.value ->> p_key, x.ord
    ) t
$$;
revoke all on function public.form_preparation_index_by_key(jsonb, text) from public, anon, authenticated;

-- Même contrat que 20260916110000. Les boucles sur le candidat restent dans
-- l'ordre du tableau pour conserver les sorties anticipées `unsupported` et
-- l'ordre des erreurs ; seules les recherches dans la source deviennent des
-- accès par clé. L'index source est construit au premier besoin, comme la
-- première lecture de la source dans la version d'origine.
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
  v_candidate_key text;
  v_source_signature jsonb;
  v_candidate_signature jsonb;
  v_source_index jsonb;
  v_candidate_index jsonb;
  v_only_candidate int;
  v_only_source int;
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
    if v_source_index is null then
      v_source_index := public.form_preparation_index_by_key(v_source -> 'fields', 'fieldKey');
    end if;
    v_source_item := v_source_index -> v_candidate_key;
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

  -- Un élément source est retiré si aucune clé candidate ne lui est égale ;
  -- une clé source absente vaut '' comme dans la boucle d'origine.
  v_candidate_index := public.form_preparation_index_by_key(v_candidate -> 'fields', 'fieldKey');
  select count(*)::int into v_only_source
    from jsonb_array_elements(coalesce(v_source -> 'fields', '[]'::jsonb)) s(value)
   where not (v_candidate_index ? coalesce(s.value ->> 'fieldKey', ''));
  v_removed := v_removed + v_only_source;

  v_source_index := null;
  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'sections', '[]'::jsonb)) loop
    v_candidate_key := coalesce(v_candidate_item ->> 'sectionKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', v_added, 'removed', v_removed, 'changed', v_changed);
    end if;
    if v_source_index is null then
      v_source_index := public.form_preparation_index_by_key(v_source -> 'sections', 'sectionKey');
    end if;
    v_source_item := v_source_index -> v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
    elsif (v_source_item - array['displayOrder','label']) <> (v_candidate_item - array['displayOrder','label']) then
      v_changed := v_changed + 1;
    end if;
  end loop;
  v_candidate_index := public.form_preparation_index_by_key(v_candidate -> 'sections', 'sectionKey');
  select count(*)::int into v_only_source
    from jsonb_array_elements(coalesce(v_source -> 'sections', '[]'::jsonb)) s(value)
   where not (v_candidate_index ? coalesce(s.value ->> 'sectionKey', ''));
  v_removed := v_removed + v_only_source;

  -- Un nouveau groupe commun est additif ; un changement/suppression de groupe
  -- ou de ses propriétés structurelles reste sémantique.
  v_source_index := null;
  for v_candidate_item in select value from jsonb_array_elements(coalesce(v_candidate -> 'commonGroups', '[]'::jsonb)) loop
    v_candidate_key := coalesce(v_candidate_item ->> 'groupKey', '');
    if v_candidate_key = '' then
      return jsonb_build_object('classification', 'unsupported', 'code', 'FORM_CHANGE_UNSUPPORTED', 'added', v_added, 'removed', v_removed, 'changed', v_changed);
    end if;
    if v_source_index is null then
      v_source_index := public.form_preparation_index_by_key(v_source -> 'commonGroups', 'groupKey');
    end if;
    v_source_item := v_source_index -> v_candidate_key;
    if v_source_item is null then
      v_added := v_added + 1;
    elsif (v_source_item - array['displayOrder','anchorOrder','label']) <> (v_candidate_item - array['displayOrder','anchorOrder','label']) then
      v_changed := v_changed + 1;
    end if;
  end loop;
  v_candidate_index := public.form_preparation_index_by_key(v_candidate -> 'commonGroups', 'groupKey');
  select count(*)::int into v_only_source
    from jsonb_array_elements(coalesce(v_source -> 'commonGroups', '[]'::jsonb)) s(value)
   where not (v_candidate_index ? coalesce(s.value ->> 'groupKey', ''));
  v_removed := v_removed + v_only_source;

  -- Les règles et associations diagnostiques sont comparées par objet canonique.
  -- Une insertion pure est additive ; une modification ou suppression d'un objet
  -- existant produit simultanément un retrait et un ajout, donc semantic.
  -- Comme la version d'origine, chaque occurrence candidate absente de la source
  -- compte un ajout et chaque occurrence source absente du candidat un retrait :
  -- un doublon d'une valeur déjà présente de l'autre côté ne compte pas. Le
  -- regroupement utilise l'égalité jsonb, celle de la comparaison d'origine. La
  -- branche candidate est lue en premier, comme la boucle externe d'origine.
  select coalesce(sum(g.candidate_count) filter (where g.source_count = 0), 0)::int,
         coalesce(sum(g.source_count) filter (where g.candidate_count = 0), 0)::int
    into v_only_candidate, v_only_source
    from (
      select count(*) filter (where u.side = 'c') as candidate_count,
             count(*) filter (where u.side = 's') as source_count
        from (
          select 'c' as side, c.value
            from jsonb_array_elements(coalesce(v_candidate -> 'rules', '[]'::jsonb)) c(value)
          union all
          select 's' as side, s.value
            from jsonb_array_elements(coalesce(v_source -> 'rules', '[]'::jsonb)) s(value)
        ) u
       group by u.value
    ) g;
  v_added := v_added + v_only_candidate;
  v_removed := v_removed + v_only_source;
  if jsonb_typeof(coalesce(v_source -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) <> 'array' then
    v_changed := v_changed + 1;
  else
    select coalesce(sum(g.candidate_count) filter (where g.source_count = 0), 0)::int,
           coalesce(sum(g.source_count) filter (where g.candidate_count = 0), 0)::int
      into v_only_candidate, v_only_source
      from (
        select count(*) filter (where u.side = 'c') as candidate_count,
               count(*) filter (where u.side = 's') as source_count
          from (
            select 'c' as side, c.value
              from jsonb_array_elements(coalesce(v_candidate -> 'diagnosisConfiguration', '[]'::jsonb)) c(value)
            union all
            select 's' as side, s.value
              from jsonb_array_elements(coalesce(v_source -> 'diagnosisConfiguration', '[]'::jsonb)) s(value)
          ) u
         group by u.value
      ) g;
    v_added := v_added + v_only_candidate;
    v_removed := v_removed + v_only_source;
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
revoke all on function public.form_preparation_classify(jsonb, jsonb) from public, anon, authenticated;

-- Même contrat que 20260916130000. Les contrôles et leur ordre sont inchangés ;
-- les recherches de section parente, de section, de groupe commun et de
-- variable source passent par des index clé -> objet construits une fois.
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

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_candidate -> 'fields', '[]'::jsonb)) x(value)
     where coalesce(x.value ->> 'fieldKey', '') !~ '^[a-z][a-z0-9_]{0,62}$'
        or btrim(coalesce(x.value ->> 'label', '')) = ''
        or coalesce(x.value ->> 'scope', '') not in ('patient', 'encounter')
        or coalesce(x.value ->> 'type', '') not in
           ('number','integer','text','date','datetime','boolean','select','multiselect','terminology')
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
revoke all on function public.form_preparation_apply_assert_definition(jsonb, jsonb) from public, anon, authenticated;
