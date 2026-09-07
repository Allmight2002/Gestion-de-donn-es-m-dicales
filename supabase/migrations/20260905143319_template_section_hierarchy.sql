-- L54: additive hierarchy. Existing parents and mirrors are left untouched.
alter table public.template_section add column parent_section_id uuid;
alter table public.template_section add constraint template_section_id_version_key unique (id, template_version_id);
alter table public.template_section add constraint template_section_parent_fk
  foreign key (parent_section_id, template_version_id)
  references public.template_section(id, template_version_id)
  on delete no action deferrable initially deferred;
alter table public.template_section add constraint template_section_not_self check (id <> parent_section_id);
create index template_section_parent_order_idx
  on public.template_section(template_version_id, parent_section_id, display_order, section_key);
alter table public.template_field alter column section drop not null;

create or replace function public.guard_template_section_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  -- The parent row is absent only during an explicit version/template cascade.
  perform 1 from public.template_version where id = v_version for update;
  if not found and tg_op = 'DELETE' then return old; end if;
  if auth.uid() is not null and public.template_version_locked(v_version) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
  if tg_op = 'UPDATE' then
    if new.section_key is distinct from old.section_key then
      raise exception 'Le code interne d''une section ne se modifie pas : renommez son libelle.';
    end if;
    if new.template_version_id is distinct from old.template_version_id then
      raise exception 'Une section ne change pas de version de jeu de variables';
    end if;
    if new.parent_section_id is distinct from old.parent_section_id
       and public.template_version_in_use(v_version) then
      raise exception 'Version deja utilisee : creez une nouvelle version';
    end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.parent_section_id is null and new.parent_section_id is not null) then
    if exists (select 1 from public.validation_rule r where r.template_version_id = v_version
               and r.rule #>> '{then,section}' = old.section_key) then
      raise exception 'Bloc % cible d''une regle : retirez d''abord la regle.', old.section_key;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.template_field where section_id = old.id) then
      raise exception 'Section non vide : deplacez d''abord ses variables.';
    end if;
    return old;
  end if;
  if new.parent_section_id is not null then
    if new.parent_section_id = new.id then raise exception 'Auto-parente interdite'; end if;
    if not exists (select 1 from public.template_section p where p.id = new.parent_section_id
                   and p.template_version_id = v_version and p.parent_section_id is null) then
      raise exception 'Le parent doit etre un bloc de la meme version';
    end if;
    if exists (select 1 from public.template_section where parent_section_id = new.id) then
      raise exception 'Un bloc portant des sous-sections ne peut devenir une sous-section';
    end if;
  end if;
  return new;
end $$;

-- Internal helper: the caller holds the version lock. Flat versions retain their order.
create function public.normalize_template_section_order(p_version_id uuid)
returns void language sql security invoker set search_path = public, pg_temp as $$
  with ordered as (
    select s.id, (row_number() over (order by
      coalesce(p.display_order, s.display_order), coalesce(p.section_key, s.section_key),
      case when s.parent_section_id is null then 0 else 1 end,
      s.display_order, s.section_key) - 1)::int as ord
    from public.template_section s left join public.template_section p on p.id = s.parent_section_id
    where s.template_version_id = p_version_id
  )
  update public.template_section s set display_order = o.ord from ordered o
  where s.id = o.id and s.display_order is distinct from o.ord;
$$;
revoke all on function public.normalize_template_section_order(uuid) from public, anon, authenticated;

create function public.lock_template_section_version(p_version_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.owns_template(public.template_of_version(p_version_id)) then
    raise exception 'Modification du jeu de variables non autorisee';
  end if;
  perform 1 from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if public.template_version_locked(p_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du jeu de variables';
  end if;
end $$;
revoke all on function public.lock_template_section_version(uuid) from public, anon, authenticated;

create or replace function public.reorder_template_sections(p_version_id uuid, p_section_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.lock_template_section_version(p_version_id);
  if p_section_ids is null or cardinality(p_section_ids) <> (select count(distinct x) from unnest(p_section_ids) x)
     or cardinality(p_section_ids) <> (select count(*) from public.template_section where template_version_id = p_version_id)
     or exists (select 1 from unnest(p_section_ids) x where not exists
                (select 1 from public.template_section where id = x and template_version_id = p_version_id)) then
    raise exception 'Liste de reordonnancement invalide';
  end if;
  update public.template_section s set display_order = u.ord - 1
    from unnest(p_section_ids) with ordinality u(id, ord) where s.id = u.id;
  perform public.normalize_template_section_order(p_version_id);
end $$;

create function public.reorder_template_section_siblings(p_version_id uuid, p_parent_key text, p_section_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent uuid;
begin
  perform public.lock_template_section_version(p_version_id);
  if p_parent_key is not null then
    select id into v_parent from public.template_section where template_version_id = p_version_id
      and section_key = p_parent_key and parent_section_id is null;
    if not found then raise exception 'Bloc parent introuvable'; end if;
  end if;
  if p_section_ids is null or cardinality(p_section_ids) <> (select count(distinct x) from unnest(p_section_ids) x)
     or cardinality(p_section_ids) <> (select count(*) from public.template_section where template_version_id = p_version_id and parent_section_id is not distinct from v_parent)
     or exists (select 1 from unnest(p_section_ids) x where not exists (select 1 from public.template_section
       where id = x and template_version_id = p_version_id and parent_section_id is not distinct from v_parent)) then
    raise exception 'Liste de freres invalide';
  end if;
  update public.template_section s set display_order = u.ord - 1
    from unnest(p_section_ids) with ordinality u(id, ord) where s.id = u.id;
  perform public.normalize_template_section_order(p_version_id);
end $$;
revoke all on function public.reorder_template_section_siblings(uuid, text, uuid[]) from public, anon;
grant execute on function public.reorder_template_section_siblings(uuid, text, uuid[]) to authenticated;

create function public.move_template_section(p_version_id uuid, p_section_id uuid, p_parent_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent uuid; r record;
begin
  perform public.lock_template_section_version(p_version_id);
  if public.template_version_in_use(p_version_id) then raise exception 'Version deja utilisee : creez une nouvelle version'; end if;
  if p_parent_key is not null then
    select id into v_parent from public.template_section where template_version_id = p_version_id
      and section_key = p_parent_key and parent_section_id is null;
    if not found then raise exception 'Bloc parent introuvable'; end if;
  end if;
  update public.template_section set parent_section_id = v_parent,
    display_order = (select coalesce(max(display_order), -1) + 1 from public.template_section where template_version_id = p_version_id)
    where id = p_section_id and template_version_id = p_version_id;
  if not found then raise exception 'Section introuvable'; end if;
  perform public.normalize_template_section_order(p_version_id);
  for r in select id, rule from public.validation_rule where template_version_id = p_version_id loop
    perform public.assert_visibility_acyclic(p_version_id, r.rule, r.id);
  end loop;
end $$;
revoke all on function public.move_template_section(uuid, uuid, text) from public, anon;
grant execute on function public.move_template_section(uuid, uuid, text) to authenticated;

create function public.add_template_section(p_version_id uuid, p_key text, p_label text, p_parent_key text default null)
returns public.template_section language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent uuid; v_id uuid; result public.template_section;
begin
  perform public.lock_template_section_version(p_version_id);
  if p_parent_key is not null then
    select id into v_parent from public.template_section where template_version_id = p_version_id
      and section_key = p_parent_key and parent_section_id is null;
    if not found then raise exception 'Bloc parent introuvable'; end if;
  end if;
  insert into public.template_section(template_version_id, section_key, label, parent_section_id, display_order)
    select p_version_id, p_key, p_label, v_parent, coalesce(max(display_order), -1) + 1
    from public.template_section where template_version_id = p_version_id returning id into v_id;
  perform public.normalize_template_section_order(p_version_id);
  select * into result from public.template_section where id = v_id;
  return result;
end $$;
revoke all on function public.add_template_section(uuid, text, text, text) from public, anon;
grant execute on function public.add_template_section(uuid, text, text, text) to authenticated;

create or replace function public.sync_template_field_section()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key   text;
  v_id    uuid;
  v_by_id boolean;
begin
  if tg_op = 'INSERT' then
    v_by_id := new.section_id is not null;
  else
    v_by_id := new.section_id is distinct from old.section_id;
    -- Ni le lien ni le code n'ont bouge : il n'y a rien a arbitrer, et surtout rien a
    -- reecrire (une variable detachee doit le rester).
    if not v_by_id and new.section is not distinct from old.section then
      return new;
    end if;
  end if;

  if v_by_id then
    -- Detachement intentionnel : les deux colonnes deviennent nulles.
    if new.section_id is null then
      new.section := null;
      return new;
    end if;
    select ts.section_key into v_key
      from public.template_section ts
     where ts.id = new.section_id
       and ts.template_version_id = new.template_version_id;
    if v_key is null then
      raise exception 'Section inconnue pour cette version du jeu de variables';
    end if;
    new.section := v_key;
    return new;
  end if;

  -- Voie ancienne : seul le code texte a ete fourni.
  select ts.id into v_id
    from public.template_section ts
   where ts.template_version_id = new.template_version_id
     and ts.section_key = new.section;
  new.section_id := v_id;
  return new;
end $$;

create or replace function public.copy_template_fields(
  p_source_version_id  uuid,
  p_target_version_id  uuid,
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
$$;

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
