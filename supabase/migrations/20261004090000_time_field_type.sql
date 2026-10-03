-- =============================================================================
-- 20261004090000_time_field_type.sql  (type de variable « heure »)
--
-- POURQUOI. Une heure d'incision, de fermeture ou d'admission etait saisie comme une
-- « date et heure » : la date y etait redondante avec celle de la consultation, et
-- l'imposer fabriquait une donnee. Ce lot ajoute le type `time`, distinct de `datetime`.
--
-- CE QUI EST STOCKE. Une chaine `HH:MM` (ou `HH:MM:SS`), heure LOCALE de la saisie, sans
-- date ni fuseau -- exactement ce que rend `<input type="time">`.
--
-- ADDITIVE. Aucune donnee existante n'est touchee : la contrainte de type est ELARGIE, et
-- aucun champ existant ne peut etre de ce type. Les fonctions redefinies sont copiees de
-- leur version la plus recente, seule la branche `time` etant ajoutee :
--   * assert_data_valid                         (20261001090000)
--   * enforce_template_field_default_value      (20260814090000)
--   * rule_cmp                                  (20260616095300)
--   * form_record_assert_json_type              (20260916140000)
--   * create_template_bundle                    (20261001170000)
--   * form_preparation_apply_assert_definition  (20261003220000)
-- `create or replace` conserve proprietaire, grants et revokes existants.
-- Hors perimetre, volontairement : les formules (une heure seule n'a pas de duree
-- calculable sans date) et le tri de la liste patients, qui refusent ce type comme tout
-- type qu'ils ne gerent pas.
--
-- RETOUR ARRIERE. Correction en avant de preference : retablir la contrainte et les
-- fonctions anterieures rendrait invalides, a la prochaine ecriture, les fiches portant
-- deja une heure.
-- =============================================================================

-- 1. Format strict -------------------------------------------------------------------------
create or replace function public.is_strict_time_text(p_value text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$', false)
$$;
comment on function public.is_strict_time_text(text) is
  'Heure locale stricte HH:MM ou HH:MM:SS (00:00 a 23:59:59), sans date ni fuseau.';

-- 2. Elargir les types de champ autorises --------------------------------------------------
-- Meme methode qu'en 20260726210000 : le nom de la contrainte est recherche, pas suppose.
do $$
declare c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.template_field'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%multiselect%';
  if c_name is null then
    raise exception 'Contrainte de type de champ introuvable sur template_field';
  end if;
  execute format('alter table public.template_field drop constraint %I', c_name);
end $$;

alter table public.template_field
  add constraint template_field_type_check
  check (type in ('number','integer','text','date','datetime','time','boolean','select','multiselect','terminology'));

-- 3. Valeur proposee -----------------------------------------------------------------------
create or replace function public.enforce_template_field_default_value()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_default text := nullif(btrim(new.default_value), '');
  v_num     numeric;
begin
  new.default_value := v_default;
  if v_default is null then return new; end if;

  if new.type in ('multiselect', 'terminology') then
    raise exception 'Aucune valeur proposee n''est possible sur "%" : proposer une reponse a une variable de ce type oriente la saisie', new.label;
  end if;

  if new.type = 'boolean' then
    if v_default not in ('true', 'false') then
      raise exception 'Valeur proposee invalide pour "%" : oui ou non attendu', new.label;
    end if;
    return new;
  end if;

  if new.type in ('number', 'integer') then
    if new.type = 'integer' and v_default !~ '^-?[0-9]+$' then
      raise exception 'Valeur proposee invalide pour "%" : un nombre entier est attendu', new.label;
    end if;
    begin
      v_num := v_default::numeric;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : un nombre est attendu', new.label;
    end;
    if new.min_value is not null and v_num < new.min_value then
      raise exception 'Valeur proposee hors bornes pour "%" : minimum %', new.label, new.min_value;
    end if;
    if new.max_value is not null and v_num > new.max_value then
      raise exception 'Valeur proposee hors bornes pour "%" : maximum %', new.label, new.max_value;
    end if;
    return new;
  end if;

  -- Une date de consultation proposee a aujourd'hui doit rester « aujourd'hui » le mois
  -- prochain : le jeton est resolu A LA SAISIE, jamais fige ici.
  if new.type = 'date' then
    if v_default = '__today__' then return new; end if;
    begin
      perform v_default::date;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : une date est attendue', new.label;
    end;
    return new;
  end if;

  if new.type = 'datetime' then
    if v_default = '__now__' then return new; end if;
    begin
      perform v_default::timestamp;
    exception when others then
      raise exception 'Valeur proposee invalide pour "%" : une date et une heure sont attendues', new.label;
    end;
    return new;
  end if;

  -- Une heure proposee a « maintenant » reste l'heure de la saisie, comme `__now__` pour
  -- une date et heure ; une heure fixe doit avoir la forme stricte stockee ensuite.
  if new.type = 'time' then
    if v_default = '__now__' then return new; end if;
    if not public.is_strict_time_text(v_default) then
      raise exception 'Valeur proposee invalide pour "%" : une heure HH:MM est attendue', new.label;
    end if;
    return new;
  end if;

  if new.type = 'select' then
    if new.allowed_values is null
       or not (new.allowed_values @> jsonb_build_array(v_default)) then
      raise exception 'Valeur proposee absente de la liste de "%"', new.label;
    end if;
    return new;
  end if;

  return new;
end $$;

-- 4. Validation des valeurs saisies --------------------------------------------------------
create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f       record;
  v       jsonb;
  n       numeric;
  txt     text;
  problem text;
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
      -- Le motif le plus structurel l'emporte, dans l'ordre historique des controles.
      select p into problem
      from (select public.terminology_entry_problem(el.value) as p from jsonb_array_elements(v) el(value)) x
      where p is not null
      order by array_position(array['shape', 'unexpected', 'required', 'provenance', 'unknown'], p)
      limit 1;
      if problem = 'shape' then
        raise exception 'Code et libelle attendus dans la liste pour "%"', f.label;
      elsif problem = 'unexpected' then
        raise exception 'Contenu inattendu dans la liste pour "%"', f.label;
      elsif problem = 'required' then
        raise exception 'Code et libelle requis dans la liste pour "%"', f.label;
      elsif problem = 'provenance' then
        raise exception 'Provenance du codage invalide dans la liste pour "%"', f.label;
      end if;
      -- Les doublons portent sur les CODES : deux textes non codes identiques ne sont pas
      -- un meme diagnostic certifie, ils restent a coder.
      if exists (
        select 1
        from jsonb_array_elements(v) el(value)
        where el.value ? 'code'
        group by el.value ->> 'code'
        having count(*) > 1
      ) then
        raise exception 'Diagnostic en double dans la liste pour "%"', f.label;
      end if;
      if problem = 'unknown' then
        raise exception 'Diagnostic inconnu ou libelle non conforme pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'terminology' then
      problem := public.terminology_entry_problem(v);
      if problem = 'shape' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      elsif problem = 'unexpected' then
        raise exception 'Contenu inattendu pour "%"', f.label;
      elsif problem = 'required' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      elsif problem = 'provenance' then
        raise exception 'Provenance du codage invalide pour "%"', f.label;
      elsif problem = 'unknown' then
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
    elsif f.type = 'time' then
      if not public.is_strict_time_text(txt) then
        raise exception 'Heure invalide pour "%" (format HH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;

comment on function public.assert_data_valid(uuid, text, jsonb) is
  'Valide types (dont heure HH:MM), bornes, terminologies unitaires ou multivaluees (avec texte d''origine et provenance du codage facultatifs, ou texte non code) et raisons manquantes.';

-- 5. Comparaison des regles de coherence ---------------------------------------------------
-- Deux heures se comparent sur leur forme normalisee HH:MM:SS : « 08:30 » < « 14:00 ».
-- Sans cette branche, la conversion numerique echouait et la regle ne se declenchait pas.
create or replace function public.rule_cmp(a jsonb, b jsonb)
returns int language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; tb text := b #>> '{}'; na numeric; nb numeric;
begin
  if ta is null or tb is null then return null; end if;
  if public.is_strict_date_text(ta) and public.is_strict_date_text(tb) then
    return case when ta < tb then -1 when ta > tb then 1 else 0 end;
  end if;
  if public.is_strict_time_text(ta) and public.is_strict_time_text(tb) then
    if length(ta) = 5 then ta := ta || ':00'; end if;
    if length(tb) = 5 then tb := tb || ':00'; end if;
    return case when ta < tb then -1 when ta > tb then 1 else 0 end;
  end if;
  begin na := ta::numeric; nb := tb::numeric;
  exception when others then return null; end;
  return case when na < nb then -1 when na > nb then 1 else 0 end;
end $$;

-- 6. Fiches compatibles avec le formulaire -------------------------------------------------
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
  elsif p_field.type in ('text', 'select', 'date', 'datetime', 'time') and v_type <> 'string' then
    perform public.form_record_error('FORM_VALUE_CONVERSION_REQUIRED', 'json_string_expected');
  end if;
end
$$;

-- 7. Creation d'un gabarit (import de fichier) ---------------------------------------------
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
       or coalesce(f ->> 'type', '') not in ('number','integer','text','date','datetime','time','boolean','select','multiselect')
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

-- 8. Preparation de formulaire -------------------------------------------------------------
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
           ('number','integer','text','date','datetime','time','boolean','select','multiselect','terminology')
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
