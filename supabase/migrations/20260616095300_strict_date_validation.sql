-- =============================================================================
-- 20260616095300_strict_date_validation.sql
-- Audit P1 : les champs date/datetime ne doivent plus s'appuyer sur les casts
-- PostgreSQL seuls, trop permissifs. On impose un format ISO strict et une date
-- calendaire reelle avant acceptation.
-- =============================================================================

create or replace function public.is_strict_date_text(p_value text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare d date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;

  begin
    d := p_value::date;
  exception when others then
    return false;
  end;

  return to_char(d, 'YYYY-MM-DD') = p_value;
end $$;

create or replace function public.is_strict_datetime_text(p_value text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  m text[];
  h int;
  mi int;
  s int;
  oh int;
  omi int;
begin
  m := regexp_match(
    p_value,
    '^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2})(:([0-9]{2}))?(Z|([+-])([0-9]{2}):([0-9]{2}))?$'
  );
  if m is null then return false; end if;
  if not public.is_strict_date_text(m[1]) then return false; end if;

  h := m[2]::int;
  mi := m[3]::int;
  s := coalesce(m[5], '0')::int;
  if h > 23 or mi > 59 or s > 59 then return false; end if;

  if m[8] is not null then
    oh := m[8]::int;
    omi := m[9]::int;
    if oh > 14 or omi > 59 or (oh = 14 and omi <> 0) then return false; end if;
  end if;

  return true;
end $$;

create or replace function public.assert_data_valid(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  f   record;
  v   jsonb;
  n   numeric;
  txt text;
begin
  if p_data is null then return; end if;
  for f in
    select field_key, label, type, unit, allowed_values, min_value, max_value, allow_missing_codes
    from public.template_field
    where template_version_id = p_version and scope = p_scope
  loop
    if not (p_data ? f.field_key) then continue; end if;
    v := p_data -> f.field_key;
    if v is null or jsonb_typeof(v) = 'null' then continue; end if;

    if jsonb_typeof(v) = 'object' and (v ? '__missing__') then
      if not f.allow_missing_codes then
        raise exception 'Valeur manquante non autorisee pour "%"', f.label;
      end if;
      if (v ->> '__missing__') is null or (v ->> '__missing__') not in ('non_fait','inconnu','non_applicable') then
        raise exception 'Code de donnee manquante invalide pour "%"', f.label;
      end if;
      continue;
    end if;

    if f.type = 'multiselect' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Liste (tableau) attendue pour "%"', f.label;
      end if;
      if f.allowed_values is not null
         and exists (select 1 from jsonb_array_elements_text(v) el where not (f.allowed_values @> jsonb_build_array(el))) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
      continue;
    end if;

    txt := v #>> '{}';
    if txt is null or txt = '' then continue; end if;

    if f.type in ('number','integer') then
      begin
        n := txt::numeric;
      exception when others then
        raise exception 'Valeur non numerique pour "%"', f.label;
      end;
      if f.type = 'integer' and n <> trunc(n) then
        raise exception 'Entier attendu pour "%"', f.label;
      end if;
      if f.min_value is not null and n < f.min_value then
        raise exception '"%" en dessous du minimum autorise (%)', f.label, f.min_value;
      end if;
      if f.max_value is not null and n > f.max_value then
        raise exception '"%" au dessus du maximum autorise (%)', f.label, f.max_value;
      end if;
    elsif f.type = 'select' then
      if f.allowed_values is not null and not (f.allowed_values @> jsonb_build_array(txt)) then
        raise exception 'Valeur non autorisee pour "%"', f.label;
      end if;
    elsif f.type = 'boolean' then
      if txt not in ('true','false') then
        raise exception 'Booleen attendu pour "%"', f.label;
      end if;
    elsif f.type = 'date' then
      if not public.is_strict_date_text(txt) then
        raise exception 'Date invalide pour "%" (format AAAA-MM-JJ attendu)', f.label;
      end if;
    elsif f.type = 'datetime' then
      if not public.is_strict_datetime_text(txt) then
        raise exception 'Date/heure invalide pour "%" (format ISO AAAA-MM-JJTHH:MM attendu)', f.label;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.rule_cmp(a jsonb, b jsonb)
returns int language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; tb text := b #>> '{}'; na numeric; nb numeric;
begin
  if ta is null or tb is null then return null; end if;
  if public.is_strict_date_text(ta) and public.is_strict_date_text(tb) then
    return case when ta < tb then -1 when ta > tb then 1 else 0 end;
  end if;
  begin na := ta::numeric; nb := tb::numeric;
  exception when others then return null; end;
  return case when na < nb then -1 when na > nb then 1 else 0 end;
end $$;
