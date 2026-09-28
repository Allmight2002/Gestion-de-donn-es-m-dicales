-- Transfert d'un jeu de variables par FICHIER : exporter la definition d'une version, puis la
-- recreer a l'identique dans un autre compte (ou une autre instance).
--
-- Besoin : un medecin construit un registre (ex. neurochirurgie) dans son compte ; il doit
-- pouvoir le reprendre dans un autre compte -- typiquement celui de l'administrateur, qui le
-- promeut ensuite en modele global -- sans tout ressaisir. La copie par `sourceVersionId`
-- ne suffit pas : elle suppose que la source soit lisible par l'appelant sur la MEME base.
--
-- Ce que porte le fichier : la STRUCTURE seule -- sections (hierarchie, repetabilite),
-- rubriques communes, variables avec tous leurs attributs, regles, configuration diagnostique.
-- Aucun identifiant interne, aucun proprietaire, aucune base, aucune donnee patient. Tout y
-- est reference par code (`field_key`, `section_key`, `group_key`), qui est stable d'une
-- instance a l'autre. Seul l'identifiant d'une nomenclature (terminologie) est propre a une
-- instance : le fichier l'accompagne de son `slug`, et l'import le re-resout localement.
--
-- Aucune table n'est creee ni modifiee. L'import reutilise `template_operation` pour
-- l'idempotence (meme contrat que `create_template_bundle`) et laisse les gardes EXISTANTES
-- (declencheurs de variables, sections, regles, configuration diagnostique) valider le
-- contenu : un fichier ne peut rien creer que l'editeur n'aurait pas accepte.

-- ---------------------------------------------------------------------------------------
-- 1. Export : lecture seule, filtree par la RLS
-- ---------------------------------------------------------------------------------------
-- `security invoker` : l'appelant n'exporte que ce qu'il peut deja lire (`can_read_template`
-- sur les versions, sections, variables, regles et rubriques). `template` est joint en LEFT
-- JOIN pour la meme raison que le catalogue L59 : sa policy de lecture est plus etroite, et
-- le nom n'est qu'un confort (l'import permet de le fixer).
create function public.export_template_definition(p_version_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_version public.template_version;
  v_template public.template;
  v_rules jsonb;
  v_config jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED',
      detail = '{"code":"UNAUTHENTICATED"}';
  end if;
  select * into v_version from public.template_version where id = p_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_EXPORT_NOT_FOUND',
      detail = '{"code":"TEMPLATE_EXPORT_NOT_FOUND"}';
  end if;
  select * into v_template from public.template where id = v_version.template_id;

  -- Ordre DETERMINISTE (l'identifiant est aleatoire) : un meme gabarit donne toujours le
  -- meme fichier, que l'on peut comparer d'un export a l'autre.
  select coalesce(jsonb_agg(jsonb_build_object(
           'rule', vr.rule, 'message', vr.message, 'severity', vr.severity)
           order by vr.rule::text, vr.message, vr.severity), '[]'::jsonb)
    into v_rules
    from public.validation_rule vr where vr.template_version_id = p_version_id;
  v_config := coalesce(v_version.diagnosis_configuration, '[]'::jsonb);

  return jsonb_build_object(
    'format', 'meddata.template-definition',
    'formatVersion', 1,
    'exportedAt', now(),
    'template', jsonb_build_object(
      'name', v_template.name,
      'specialty', v_template.specialty,
      'versionNumber', v_version.version_number,
      'status', v_version.status),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', s.section_key, 'label', s.label, 'parentKey', p.section_key,
               'displayOrder', s.display_order, 'isRepeatable', s.is_repeatable)
             order by s.display_order, s.section_key)
        from public.template_section s
        left join public.template_section p on p.id = s.parent_section_id
       where s.template_version_id = p_version_id), '[]'::jsonb),
    'commonGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.group_key, 'label', g.label, 'displayOrder', g.display_order,
               'anchorOrder', g.anchor_order, 'isDefault', g.is_default)
             order by g.display_order, g.group_key)
        from public.template_common_group g
       where g.template_version_id = p_version_id), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fieldKey', f.field_key, 'label', f.label, 'description', f.description,
               'defaultValue', f.default_value, 'scope', f.scope, 'section', f.section,
               'type', f.type, 'isMultiple', f.is_multiple, 'unit', f.unit,
               'allowedValues', f.allowed_values, 'allowedOptions', f.allowed_options,
               'required', f.required, 'minValue', f.min_value, 'maxValue', f.max_value,
               'allowMissingCodes', f.allow_missing_codes, 'missingReasons', to_jsonb(f.missing_reasons),
               'formula', f.formula, 'displayOrder', f.display_order,
               'encounterTypes', to_jsonb(f.encounter_types), 'commonGroup', g.group_key)
             order by f.display_order, f.field_key)
        from public.template_field f
        left join public.template_common_group g on g.id = f.common_group_id
       where f.template_version_id = p_version_id), '[]'::jsonb),
    'rules', v_rules,
    'diagnosisConfiguration', v_config,
    -- Nomenclatures referencees par les regles et la configuration diagnostique : l'import
    -- les retrouve par `slug`, jamais par l'identifiant de l'instance d'origine.
    'terminologyReleases', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'slug', r.slug, 'version', r.version) order by r.slug)
        from public.terminology_release r
       where r.id::text in (
         select x.value ->> 'terminologyReleaseId' from jsonb_array_elements(v_config) x
         union
         select x.value -> 'rule' -> 'if' ->> 'terminologyReleaseId' from jsonb_array_elements(v_rules) x)), '[]'::jsonb)
  );
end $$;

revoke all on function public.export_template_definition(uuid) from public, anon;
grant execute on function public.export_template_definition(uuid) to authenticated;
comment on function public.export_template_definition(uuid) is
  'Definition portable (structure seule, sans identifiant interne ni donnee patient) d''une '
  'version lisible par l''appelant. Relue par import_template_definition.';

-- ---------------------------------------------------------------------------------------
-- 2. Import : creation atomique et idempotente d'un gabarit PERSONNEL brouillon
-- ---------------------------------------------------------------------------------------
-- `security definer` pour ecrire les rubriques communes (table sans policy d'ecriture) et
-- positionner le marqueur de rattachement, exactement comme `copy_template_fields`. Les
-- droits sont donc verifies ICI : medecin ou administrateur, comme la policy
-- `template_insert`. Le resultat est toujours un gabarit personnel brouillon ; un
-- administrateur le rend global par `promote_template_to_global`, qui publie une copie.
create function public.import_template_definition(p_payload jsonb, p_operation_key uuid)
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
      detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
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
  if v_name = '' or char_length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_TEMPLATE_NAME',
      detail = '{"code":"INVALID_TEMPLATE_NAME","field":"name"}';
  end if;
  if v_specialty is not null and char_length(v_specialty) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_SPECIALTY',
      detail = '{"code":"INVALID_SPECIALTY","field":"specialty"}';
  end if;
  if jsonb_typeof(v_sections) <> 'array' or jsonb_typeof(v_groups) <> 'array'
     or jsonb_typeof(v_fields) <> 'array' or jsonb_typeof(v_rules) <> 'array'
     or jsonb_typeof(v_config) <> 'array' or jsonb_typeof(v_releases) <> 'array'
     or jsonb_array_length(v_sections) > 60 or jsonb_array_length(v_groups) > 60
     or jsonb_array_length(v_fields) > 500 or jsonb_array_length(v_rules) > 1000
     or exists (select 1 from jsonb_array_elements(v_sections) s
                 where jsonb_typeof(s) <> 'object'
                    or coalesce(s ->> 'key', '') !~ v_key_re
                    or btrim(coalesce(s ->> 'label', '')) = ''
                    or (s -> 'parentKey' is not null and s -> 'parentKey' <> 'null'::jsonb
                        and coalesce(s ->> 'parentKey', '') !~ v_key_re))
     or exists (select 1 from jsonb_array_elements(v_sections) s group by s ->> 'key' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(v_groups) g
                 where jsonb_typeof(g) <> 'object'
                    or coalesce(g ->> 'key', '') !~ v_key_re
                    or btrim(coalesce(g ->> 'label', '')) = '')
     or exists (select 1 from jsonb_array_elements(v_groups) g group by g ->> 'key' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(v_fields) f
                 where jsonb_typeof(f) <> 'object'
                    or coalesce(f ->> 'fieldKey', '') !~ v_key_re
                    or btrim(coalesce(f ->> 'label', '')) = ''
                    or (f -> 'section' is not null and f -> 'section' <> 'null'::jsonb
                        and not exists (select 1 from jsonb_array_elements(v_sections) s
                                         where s ->> 'key' = f ->> 'section'))
                    or (f -> 'commonGroup' is not null and f -> 'commonGroup' <> 'null'::jsonb
                        and not exists (select 1 from jsonb_array_elements(v_groups) g
                                         where g ->> 'key' = f ->> 'commonGroup')))
     or exists (select 1 from jsonb_array_elements(v_fields) f group by f ->> 'fieldKey' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(v_rules) r
                 where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'rule') is distinct from 'object')
  then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
  end if;

  -- Nomenclatures : identifiant d'origine -> identifiant LOCAL, par slug. Une nomenclature
  -- absente de cette instance est un refus explicite, jamais une regle silencieusement faussee.
  for v_release in select r.value as item from jsonb_array_elements(v_releases) r loop
    if jsonb_typeof(v_release.item) <> 'object' or coalesce(v_release.item ->> 'id', '') = ''
       or coalesce(v_release.item ->> 'slug', '') = '' then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
        detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
    end if;
    select id into v_local_release from public.terminology_release where slug = v_release.item ->> 'slug';
    if not found then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_TERMINOLOGY_MISSING',
        detail = jsonb_build_object('code', 'TEMPLATE_IMPORT_TERMINOLOGY_MISSING',
                                    'slug', v_release.item ->> 'slug')::text;
    end if;
    v_release_map := v_release_map || jsonb_build_object(v_release.item ->> 'id', v_local_release);
  end loop;
  if exists (select 1 from jsonb_array_elements(v_config) c
              where jsonb_typeof(c) <> 'object'
                 or (c ->> 'terminologyReleaseId' is not null and not v_release_map ? (c ->> 'terminologyReleaseId')))
     or exists (select 1 from jsonb_array_elements(v_rules) r
                 where r -> 'rule' -> 'if' ->> 'terminologyReleaseId' is not null
                   and not v_release_map ? (r -> 'rule' -> 'if' ->> 'terminologyReleaseId')) then
    raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
      detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
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
    insert into public.template(name, specialty, owner_user_id, is_global)
    values (v_name, v_specialty, v_uid, false) returning id into v_template_id;
    insert into public.template_version(template_id, version_number, status, created_by)
    values (v_template_id, 1, 'draft', v_uid) returning id into v_version_id;

    -- Meme ordre que `copy_template_fields` : sections, parents, rubriques, variables,
    -- rattachements, puis regles et configuration diagnostique qui les referencent.
    insert into public.template_section(template_version_id, section_key, label, display_order, is_repeatable)
    select v_version_id, s.value ->> 'key', btrim(s.value ->> 'label'),
           coalesce((s.value ->> 'displayOrder')::int, s.ordinality::int - 1),
           coalesce((s.value ->> 'isRepeatable')::boolean, false)
      from jsonb_array_elements(v_sections) with ordinality as s(value, ordinality)
     order by s.ordinality;
    if exists (select 1 from jsonb_array_elements(v_sections) s
                where s ->> 'parentKey' is not null and not exists (
                  select 1 from jsonb_array_elements(v_sections) p
                   where p ->> 'key' = s ->> 'parentKey' and p ->> 'parentKey' is null
                     and p ->> 'key' <> s ->> 'key')) then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
        detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
    end if;
    update public.template_section child set parent_section_id = parent.id
      from jsonb_array_elements(v_sections) s, public.template_section parent
     where child.template_version_id = v_version_id and child.section_key = s ->> 'key'
       and parent.template_version_id = v_version_id and parent.section_key = s ->> 'parentKey';
    perform public.normalize_template_section_order(v_version_id);

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

    insert into public.validation_rule(template_version_id, rule, message, severity)
    select v_version_id,
           case when r.value -> 'rule' -> 'if' ->> 'terminologyReleaseId' is not null
                then jsonb_set(r.value -> 'rule', '{if,terminologyReleaseId}',
                               v_release_map -> (r.value -> 'rule' -> 'if' ->> 'terminologyReleaseId'))
                else r.value -> 'rule' end,
           r.value ->> 'message', coalesce(r.value ->> 'severity', 'block')
      from jsonb_array_elements(v_rules) with ordinality as r(value, ordinality)
     order by r.ordinality;

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
    -- fonctionnel, jamais l'erreur SQL brute. Le bloc annule toutes les ecritures ci-dessus.
    when sqlstate 'P0001' then raise;
    when others then
      raise exception using errcode = 'P0001', message = 'TEMPLATE_IMPORT_INVALID',
        detail = '{"code":"TEMPLATE_IMPORT_INVALID"}';
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
comment on function public.import_template_definition(jsonb, uuid) is
  'Recree, en une transaction idempotente, un gabarit personnel brouillon a partir d''une '
  'definition produite par export_template_definition. Les gardes existantes valident le contenu.';
