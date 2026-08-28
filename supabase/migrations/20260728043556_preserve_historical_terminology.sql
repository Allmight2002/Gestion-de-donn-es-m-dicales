-- Preserve la revalidation des fiches historiques apres activation d'une nouvelle
-- publication du referentiel. La recherche et le cache restent bornes a la publication
-- active ; la validation accepte un couple code/libelle selectionnable provenant de toute
-- publication encore conservee. Le libelle reste ainsi verifiable sans rendre une ancienne
-- fiche impossible a enregistrer lors d'une correction sans rapport avec le diagnostic.
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

    if f.type = 'terminology' then
      if jsonb_typeof(v) <> 'object' then
        raise exception 'Code et libelle attendus pour "%"', f.label;
      end if;
      if exists (select 1 from jsonb_object_keys(v) k where k not in ('code','label')) then
        raise exception 'Contenu inattendu pour "%"', f.label;
      end if;
      if jsonb_typeof(v -> 'code') <> 'string' or jsonb_typeof(v -> 'label') <> 'string'
         or btrim(coalesce(v ->> 'code', '')) = '' or btrim(coalesce(v ->> 'label', '')) = '' then
        raise exception 'Code et libelle requis pour "%"', f.label;
      end if;
      if not exists (
        select 1
        from public.terminology_concept c
        where c.code = (v ->> 'code')
          and c.is_selectable
          and c.label = (v ->> 'label')
      ) then
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
    end if;
  end loop;
end $$;

comment on function public.assert_data_valid(uuid, text, jsonb) is
  'Valide types, bornes et terminologies. Les couples historiques restent valides tant que leur publication est conservee.';
