-- Refus d'import lisibles. `TEMPLATE_IMPORT_INVALID` ne disait pas QUOI corriger : un fichier
-- refuse laissait l'utilisateur sans piste. Le detail JSON porte desormais un motif structure :
--   {"code":"TEMPLATE_IMPORT_INVALID","reason":"section_key_invalid","key":"Mon-bloc","position":4}
-- Motifs : payload_malformed, list_not_array, too_many, section_malformed, section_key_invalid,
-- section_label_missing, section_parent_invalid, section_duplicate, group_malformed,
-- group_key_invalid, group_label_missing, group_duplicate, field_malformed, field_key_invalid,
-- field_label_missing, field_section_unknown, field_group_unknown, field_duplicate,
-- rule_malformed, terminology_release_malformed, diagnosis_configuration_malformed,
-- terminology_reference_unknown,
-- content_incoherent (avec `stage`). Accompagnements possibles : `key`, `parentKey`, `section`, `group`,
-- `list`, `limit`, `count`, `position` (rang 1-based dans sa liste), `stage`.
-- Seuls des CODES de structure (bloc, rubrique, variable) et des compteurs sortent : aucune
-- valeur clinique, aucun libelle, jamais l'erreur SQL brute. Les codes sont tronques a 80
-- caracteres.
--
-- Le controle du bloc parent passe dans la validation de forme (il ne lisait que le fichier) :
-- le refus reste identique et n'ecrit toujours rien. Tout le reste est inchange : memes gardes,
-- memes plafonds, meme hash d'idempotence, meme signature, memes droits. La migration
-- 20260928230000 n'est pas modifiee, elle a pu etre appliquee.

create or replace function public.import_template_definition(p_payload jsonb, p_operation_key uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_def jsonb;
  v_name text;
  v_specialty text;
  v_sections jsonb;
  v_groups jsonb;
  v_fields jsonb;
  v_rules jsonb;
  v_config jsonb;
  v_releases jsonb;
  v_release_map jsonb := '{}'::jsonb;
  v_release record;
  v_local_release uuid;
  v_hash text;
  v_existing public.template_operation;
  v_template_id uuid;
  v_version_id uuid;
  v_result jsonb;
  v_invalid jsonb;
  v_stage text;
  v_key_re constant text := '^[a-z][a-z0-9_]{0,62}$';
  v_default_reasons constant text[] := array['non_fait', 'inconnu', 'non_applicable'];
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED', detail = '{"code":"UNAUTHENTICATED"}';
  end if;
  if not (public.is_medecin() or public.is_system_admin()) then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_FORBIDDEN',
      detail = '{"code":"TEMPLATE_IMPORT_FORBIDDEN"}';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_operation_key is null
     or jsonb_typeof(p_payload -> 'definition') is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = '{"code":"TEMPLATE_IMPORT_INVALID","reason":"payload_malformed"}';
  end if;
  v_def := p_payload -> 'definition';
  if v_def ->> 'format' is distinct from 'meddata.template-definition'
     or v_def -> 'formatVersion' is distinct from '1'::jsonb then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_FORMAT_UNSUPPORTED',
      detail = '{"code":"TEMPLATE_IMPORT_FORMAT_UNSUPPORTED"}';
  end if;

  -- Le nom choisi a l'import prime sur celui du fichier (un meme fichier peut etre importe
  -- deux fois sous deux noms).
  v_name := btrim(coalesce(nullif(btrim(p_payload ->> 'name'), ''), v_def -> 'template' ->> 'name', ''));
  v_specialty := nullif(btrim(coalesce(
    case when p_payload ? 'specialty' then p_payload ->> 'specialty' else v_def -> 'template' ->> 'specialty' end, '')), '');
  v_sections := coalesce(v_def -> 'sections', '[]'::jsonb);
  v_groups := coalesce(v_def -> 'commonGroups', '[]'::jsonb);
  v_fields := coalesce(v_def -> 'fields', '[]'::jsonb);
  v_rules := coalesce(v_def -> 'rules', '[]'::jsonb);
  v_config := coalesce(v_def -> 'diagnosisConfiguration', '[]'::jsonb);
  v_releases := coalesce(v_def -> 'terminologyReleases', '[]'::jsonb);

  -- Validation de FORME complete avant toute ecriture. Le fond (types, options, formules,
  -- regles, repetabilite...) est tranche par les gardes existantes pendant l'insertion.
  -- Chaque controle ne tourne que si les precedents sont passes : le PREMIER defaut, dans
  -- l'ordre du fichier, est rapporte.
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_TEMPLATE_NAME',
      detail = '{"code":"INVALID_TEMPLATE_NAME","field":"name"}';
  end if;
  if v_specialty is not null and char_length(v_specialty) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_SPECIALTY',
      detail = '{"code":"INVALID_SPECIALTY","field":"specialty"}';
  end if;

  select jsonb_build_object('reason', 'list_not_array', 'list', l.name) into v_invalid
    from (values (1, 'sections', v_sections), (2, 'commonGroups', v_groups), (3, 'fields', v_fields),
                 (4, 'rules', v_rules), (5, 'diagnosisConfiguration', v_config),
                 (6, 'terminologyReleases', v_releases)) l(rank, name, value)
   where jsonb_typeof(l.value) <> 'array' order by l.rank limit 1;
  if v_invalid is null then
    -- Bornes de protection du serveur, largement au-dessus d'un registre reel.
    select jsonb_build_object('reason', 'too_many', 'list', l.name, 'limit', l.max,
                              'count', jsonb_array_length(l.value)) into v_invalid
      from (values (1, 'sections', v_sections, 500), (2, 'commonGroups', v_groups, 200),
                   (3, 'fields', v_fields, 2000), (4, 'rules', v_rules, 5000)) l(rank, name, value, max)
     where jsonb_array_length(l.value) > l.max order by l.rank limit 1;
  end if;

  if v_invalid is null then
    select x.problem into v_invalid from (
      select o, case
          when jsonb_typeof(s) <> 'object' then jsonb_build_object('reason', 'section_malformed')
          when coalesce(s ->> 'key', '') !~ v_key_re then jsonb_build_object('reason', 'section_key_invalid')
          when btrim(coalesce(s ->> 'label', '')) = '' then jsonb_build_object('reason', 'section_label_missing')
          -- Un seul niveau d'imbrication : le parent existe, est de premier niveau, n'est pas soi.
          when s -> 'parentKey' is not null and s -> 'parentKey' <> 'null'::jsonb
               and (coalesce(s ->> 'parentKey', '') !~ v_key_re
                    or not exists (select 1 from jsonb_array_elements(v_sections) p
                                    where p ->> 'key' = s ->> 'parentKey' and p ->> 'parentKey' is null
                                      and p ->> 'key' <> s ->> 'key'))
            then jsonb_build_object('reason', 'section_parent_invalid', 'parentKey', left(s ->> 'parentKey', 80))
        end || jsonb_build_object('key', left(s ->> 'key', 80), 'position', o) as problem
        from jsonb_array_elements(v_sections) with ordinality e(s, o)) x
     where x.problem ? 'reason' order by x.o limit 1;
  end if;
  if v_invalid is null then
    select jsonb_build_object('reason', 'section_duplicate', 'key', left(s ->> 'key', 80)) into v_invalid
      from jsonb_array_elements(v_sections) with ordinality e(s, o)
     group by s ->> 'key' having count(*) > 1 order by min(o) limit 1;
  end if;

  if v_invalid is null then
    select x.problem into v_invalid from (
      select o, case
          when jsonb_typeof(g) <> 'object' then jsonb_build_object('reason', 'group_malformed')
          when coalesce(g ->> 'key', '') !~ v_key_re then jsonb_build_object('reason', 'group_key_invalid')
          when btrim(coalesce(g ->> 'label', '')) = '' then jsonb_build_object('reason', 'group_label_missing')
        end || jsonb_build_object('key', left(g ->> 'key', 80), 'position', o) as problem
        from jsonb_array_elements(v_groups) with ordinality e(g, o)) x
     where x.problem ? 'reason' order by x.o limit 1;
  end if;
  if v_invalid is null then
    select jsonb_build_object('reason', 'group_duplicate', 'key', left(g ->> 'key', 80)) into v_invalid
      from jsonb_array_elements(v_groups) with ordinality e(g, o)
     group by g ->> 'key' having count(*) > 1 order by min(o) limit 1;
  end if;

  if v_invalid is null then
    select x.problem into v_invalid from (
      select o, case
          when jsonb_typeof(f) <> 'object' then jsonb_build_object('reason', 'field_malformed')
          -- Aucun format impose au code d'une variable : la table n'en porte pas, et
          -- l'editeur accepte majuscules et accents. Non vide, sans espace autour, unique.
          when jsonb_typeof(f -> 'fieldKey') is distinct from 'string'
               or btrim(f ->> 'fieldKey') = '' or f ->> 'fieldKey' <> btrim(f ->> 'fieldKey')
            then jsonb_build_object('reason', 'field_key_invalid')
          when btrim(coalesce(f ->> 'label', '')) = '' then jsonb_build_object('reason', 'field_label_missing')
          when f -> 'section' is not null and f -> 'section' <> 'null'::jsonb
               and not exists (select 1 from jsonb_array_elements(v_sections) s where s ->> 'key' = f ->> 'section')
            then jsonb_build_object('reason', 'field_section_unknown', 'section', left(f ->> 'section', 80))
          when f -> 'commonGroup' is not null and f -> 'commonGroup' <> 'null'::jsonb
               and not exists (select 1 from jsonb_array_elements(v_groups) g where g ->> 'key' = f ->> 'commonGroup')
            then jsonb_build_object('reason', 'field_group_unknown', 'group', left(f ->> 'commonGroup', 80))
        end || jsonb_build_object('key', left(f ->> 'fieldKey', 80), 'position', o) as problem
        from jsonb_array_elements(v_fields) with ordinality e(f, o)) x
     where x.problem ? 'reason' order by x.o limit 1;
  end if;
  if v_invalid is null then
    select jsonb_build_object('reason', 'field_duplicate', 'key', left(f ->> 'fieldKey', 80)) into v_invalid
      from jsonb_array_elements(v_fields) with ordinality e(f, o)
     group by f ->> 'fieldKey' having count(*) > 1 order by min(o) limit 1;
  end if;

  if v_invalid is null then
    select jsonb_build_object('reason', 'rule_malformed', 'position', o) into v_invalid
      from jsonb_array_elements(v_rules) with ordinality e(r, o)
     where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'rule') is distinct from 'object'
     order by o limit 1;
  end if;
  if v_invalid is null then
    select jsonb_build_object('reason', 'terminology_release_malformed', 'position', o) into v_invalid
      from jsonb_array_elements(v_releases) with ordinality e(r, o)
     where jsonb_typeof(r) <> 'object' or coalesce(r ->> 'id', '') = '' or coalesce(r ->> 'slug', '') = ''
     order by o limit 1;
  end if;

  if v_invalid is not null then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = jsonb_strip_nulls(jsonb_build_object('code', 'TEMPLATE_IMPORT_INVALID') || v_invalid)::text;
  end if;

  -- Nomenclatures : identifiant d'origine -> identifiant LOCAL, par slug. Une nomenclature
  -- absente de cette instance est un refus explicite, jamais une regle silencieusement faussee.
  for v_release in select r.value as item from jsonb_array_elements(v_releases) r loop
    select id into v_local_release from public.terminology_release where slug = v_release.item ->> 'slug';
    if not found then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_TERMINOLOGY_MISSING',
        detail = jsonb_build_object('code', 'TEMPLATE_IMPORT_TERMINOLOGY_MISSING',
                                    'slug', v_release.item ->> 'slug')::text;
    end if;
    v_release_map := v_release_map || jsonb_build_object(v_release.item ->> 'id', v_local_release);
  end loop;
  if exists (select 1 from jsonb_array_elements(v_config) c where jsonb_typeof(c) <> 'object') then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = '{"code":"TEMPLATE_IMPORT_INVALID","reason":"diagnosis_configuration_malformed"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_config) c
              where c ->> 'terminologyReleaseId' is not null and not v_release_map ? (c ->> 'terminologyReleaseId'))
     or exists (select 1 from jsonb_array_elements(v_rules) r
                 where r -> 'rule' -> 'if' ->> 'terminologyReleaseId' is not null
                   and not v_release_map ? (r -> 'rule' -> 'if' ->> 'terminologyReleaseId')) then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = '{"code":"TEMPLATE_IMPORT_INVALID","reason":"terminology_reference_unknown"}';
  end if;

  -- Idempotence : meme contrat que `create_template_bundle` (hash apres validation, une cle
  -- ne se reutilise jamais pour un autre contenu). Le prefixe separe les deux commandes.
  v_hash := encode(digest('import_template_definition:' || p_payload::text, 'sha256'), 'hex');
  insert into public.template_operation(owner_user_id, operation_key, payload_hash, result)
  values (v_uid, p_operation_key, v_hash, '{}'::jsonb)
  on conflict do nothing;
  select * into v_existing from public.template_operation
   where owner_user_id = v_uid and operation_key = p_operation_key for update;
  if v_existing.result <> '{}'::jsonb then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED',
        detail = '{"code":"IDEMPOTENCY_KEY_REUSED"}';
    end if;
    return v_existing.result;
  end if;

  begin
    v_stage := 'template';
    insert into public.template(name, specialty, owner_user_id, is_global)
    values (v_name, v_specialty, v_uid, false) returning id into v_template_id;
    insert into public.template_version(template_id, version_number, status, created_by)
    values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

    -- Meme ordre que `copy_template_fields` : sections, parents, rubriques, variables,
    -- rattachements, puis regles et configuration diagnostique qui les referencent.
    v_stage := 'sections';
    insert into public.template_section(template_version_id, section_key, label, display_order, is_repeatable)
    select v_version_id, s.value ->> 'key', btrim(s.value ->> 'label'),
           coalesce((s.value ->> 'displayOrder')::int, s.ordinality::int - 1),
           coalesce((s.value ->> 'isRepeatable')::boolean, false)
      from jsonb_array_elements(v_sections) with ordinality as s(value, ordinality)
     order by s.ordinality;
    update public.template_section child set parent_section_id = parent.id
      from jsonb_array_elements(v_sections) s, public.template_section parent
     where child.template_version_id = v_version_id and child.section_key = s ->> 'key'
       and parent.template_version_id = v_version_id and parent.section_key = s ->> 'parentKey';
    perform public.normalize_template_section_order(v_version_id);

    v_stage := 'commonGroups';
    insert into public.template_common_group(template_version_id, group_key, label, display_order, anchor_order, is_default)
    select v_version_id, g.value ->> 'key', btrim(g.value ->> 'label'),
           coalesce((g.value ->> 'displayOrder')::int, g.ordinality::int - 1),
           coalesce((g.value ->> 'anchorOrder')::int, 0),
           coalesce((g.value ->> 'isDefault')::boolean, false)
      from jsonb_array_elements(v_groups) with ordinality as g(value, ordinality)
     order by g.ordinality;

    -- Le marqueur autorise le rattachement explicite aux rubriques, comme la recopie.
    -- Les variables calculees passent APRES les autres : leur garde exige que les
    -- operandes existent deja dans la version.
    v_stage := 'fields';
    perform set_config('app.setting_common_layout', 'on', true);
    insert into public.template_field
      (template_version_id, field_key, label, description, default_value, scope, section,
       type, is_multiple, unit, allowed_values, allowed_options, required, min_value, max_value,
       allow_missing_codes, missing_reasons, formula, display_order, encounter_types, common_group_id)
    select v_version_id, f.value ->> 'fieldKey', btrim(f.value ->> 'label'),
           f.value ->> 'description', f.value ->> 'defaultValue', f.value ->> 'scope',
           nullif(f.value ->> 'section', ''), f.value ->> 'type',
           coalesce((f.value ->> 'isMultiple')::boolean, false), f.value ->> 'unit',
           nullif(f.value -> 'allowedValues', 'null'::jsonb), nullif(f.value -> 'allowedOptions', 'null'::jsonb),
           coalesce((f.value ->> 'required')::boolean, false),
           (f.value ->> 'minValue')::numeric, (f.value ->> 'maxValue')::numeric,
           coalesce((f.value ->> 'allowMissingCodes')::boolean, true),
           case when jsonb_typeof(f.value -> 'missingReasons') = 'array'
                then array(select jsonb_array_elements_text(f.value -> 'missingReasons'))
                else v_default_reasons end,
           nullif(btrim(f.value ->> 'formula'), ''),
           coalesce((f.value ->> 'displayOrder')::int, f.ordinality::int - 1),
           case when jsonb_typeof(f.value -> 'encounterTypes') = 'array'
                then array(select jsonb_array_elements_text(f.value -> 'encounterTypes')) end,
           case when f.value ->> 'section' is null then g.id end
      from jsonb_array_elements(v_fields) with ordinality as f(value, ordinality)
      left join public.template_common_group g
             on g.template_version_id = v_version_id and g.group_key = f.value ->> 'commonGroup'
     order by (nullif(btrim(f.value ->> 'formula'), '') is not null), f.ordinality;
    perform set_config('app.setting_common_layout', '', true);

    v_stage := 'rules';
    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id,
           case when r.value -> 'rule' -> 'if' ->> 'terminologyReleaseId' is not null
                then jsonb_set(r.value -> 'rule', '{if,terminologyReleaseId}',
                               v_release_map -> (r.value -> 'rule' -> 'if' ->> 'terminologyReleaseId'))
                else r.value -> 'rule' end,
           r.value ->> 'message', coalesce(r.value ->> 'severity', 'block')
      from jsonb_array_elements(v_rules) with ordinality as r(value, ordinality)
     order by r.ordinality;

    v_stage := 'diagnosisConfiguration';
    if jsonb_array_length(v_config) > 0 then
      update public.template_version
         set diagnosis_configuration = (
           select jsonb_agg(case when c.value ->> 'terminologyReleaseId' is not null
                                 then jsonb_set(c.value, '{terminologyReleaseId}',
                                                v_release_map -> (c.value ->> 'terminologyReleaseId'))
                                 else c.value end order by c.ordinality)
             from jsonb_array_elements(v_config) with ordinality as c(value, ordinality))
       where id = v_version_id;
    end if;
  exception
    -- Les gardes metier levent P0001 avec un motif destine a l'utilisateur : il remonte tel
    -- quel. Toute autre erreur (conversion, contrainte...) est un fichier incoherent : un code
    -- fonctionnel et l'ETAPE en cause, jamais l'erreur SQL brute. Le bloc annule toutes les
    -- ecritures ci-dessus.
    when sqlstate 'P0001' then raise;
    when others then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
        detail = jsonb_build_object('code', 'TEMPLATE_IMPORT_INVALID', 'reason', 'content_incoherent',
                                    'stage', v_stage)::text;
  end;

  v_result := jsonb_build_object(
    'templateId', v_template_id, 'versionId', v_version_id,
    'fieldCount', jsonb_array_length(v_fields), 'sectionCount', jsonb_array_length(v_sections),
    'ruleCount', jsonb_array_length(v_rules));
  update public.template_operation set result = v_result
   where owner_user_id = v_uid and operation_key = p_operation_key;
  return v_result;
end $$;

revoke all on function public.import_template_definition(jsonb, uuid) from public, anon;
grant execute on function public.import_template_definition(jsonb, uuid) to authenticated;
