-- =============================================================================
-- 20260821130000_template_field_formula_units.sql
--
-- L35 : une soustraction entre dates/date-heures peut etre restituee dans une unite
-- choisie par le concepteur du gabarit. La colonne `unit` existait deja et reste la
-- source canonique ; cette migration ajoute seulement sa validation et la deduction
-- du type de sortie cote base.
--
-- Convention partagee avec exportContract.ts : une annee de rendu vaut 365,25 jours.
-- Les anciennes formules sans unite restent donc des durees en jours.
-- =============================================================================

create or replace function public.enforce_template_field_formula()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_formula       text := nullif(btrim(new.formula), '');
  v_tokens        text[];
  v_operator      text;
  v_operand       text;
  v_type          text;
  v_peer_formula  text;
  v_temporals     int := 0;
  v_has_datetime  boolean := false;
  v_named         int := 0;
  v_result_unit   text;
  v_output        text;
begin
  new.formula := v_formula;
  if v_formula is null then return new; end if;

  if new.required then
    raise exception 'Une variable calculee ne peut pas etre obligatoire ("%") : rien n''y est saisi, personne ne pourrait la completer', new.label;
  end if;
  if nullif(btrim(new.default_value), '') is not null then
    raise exception 'Une variable calculee ne peut pas avoir de valeur proposee ("%") : sa valeur vient de la formule', new.label;
  end if;
  if new.is_multiple then
    raise exception 'Une variable calculee ne peut pas etre multivaluee ("%")', new.label;
  end if;

  new.missing_reasons := '{}'::text[];
  new.allow_missing_codes := false;

  v_tokens := regexp_split_to_array(v_formula, '\s+');
  if array_length(v_tokens, 1) is distinct from 3 then
    raise exception 'Formule invalide pour "%" : une seule operation entre deux elements est acceptee, par exemple « date_sortie - date_entree »', new.label;
  end if;
  v_operator := v_tokens[2];
  if v_operator not in ('+', '-', '*', '/') then
    raise exception 'Formule invalide pour "%" : seules les operations + - * / sont acceptees', new.label;
  end if;

  foreach v_operand in array array[v_tokens[1], v_tokens[3]] loop
    if v_operand ~ '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then
      continue;
    end if;
    if v_operand !~ '^[A-Za-z_][A-Za-z0-9_]*$' then
      raise exception 'Formule invalide pour "%" : « % » n''est ni un nombre ni un nom de variable', new.label, v_operand;
    end if;
    v_named := v_named + 1;
    if v_operand = new.field_key then
      raise exception 'Formule invalide pour "%" : une variable ne peut pas se referencer elle-meme', new.label;
    end if;

    select f.type, f.formula into v_type, v_peer_formula
      from public.template_field f
     where f.template_version_id = new.template_version_id
       and f.scope = new.scope
       and f.field_key = v_operand
     limit 1;
    if not found then
      raise exception 'Formule invalide pour "%" : la variable « % » n''existe pas dans cette version, ou n''a pas la meme portee', new.label, v_operand;
    end if;
    if v_peer_formula is not null then
      raise exception 'Formule invalide pour "%" : « % » est elle-meme une variable calculee', new.label, v_operand;
    end if;
    if v_type not in ('number', 'integer', 'date', 'datetime') then
      raise exception 'Formule invalide pour "%" : « % » n''est ni un nombre ni une date/date-heure', new.label, v_operand;
    end if;
    if v_type in ('date', 'datetime') then v_temporals := v_temporals + 1; end if;
    if v_type = 'datetime' then v_has_datetime := true; end if;
  end loop;

  if v_named = 0 then
    raise exception 'Formule invalide pour "%" : au moins un element doit etre une variable du gabarit', new.label;
  end if;

  if v_temporals = 2 then
    if v_operator <> '-' then
      raise exception 'Formule invalide pour "%" : entre deux dates/date-heures, seule la soustraction a un sens (elle rend une duree dans l''unite choisie)', new.label;
    end if;
    v_result_unit := lower(coalesce(nullif(btrim(new.unit), ''), 'days'));
    if v_result_unit not in ('seconds', 'minutes', 'hours', 'days', 'weeks', 'years') then
      raise exception 'Unite de rendu invalide pour "%" : choisissez secondes, minutes, heures, jours, semaines ou annees', new.label;
    end if;
    new.unit := v_result_unit;
    v_output := case
      when v_has_datetime or v_result_unit in ('weeks', 'years') then 'number'
      else 'integer'
    end;
  elsif v_temporals = 1 then
    raise exception 'Formule invalide pour "%" : une date/date-heure ne se combine qu''avec une autre date/date-heure, par soustraction', new.label;
  else
    v_output := 'number';
  end if;

  new.type := v_output;
  new.formula := v_tokens[1] || ' ' || v_operator || ' ' || v_tokens[3];
  return new;
end $$;

revoke all on function public.enforce_template_field_formula() from public, anon, authenticated;

-- `unit` devient une partie de la validation : une modification de l'unite doit donc
-- repasser par le meme declencheur que la formule.
drop trigger if exists trg_template_field_formula on public.template_field;
create trigger trg_template_field_formula
  before insert or update of formula, type, scope, required, default_value, missing_reasons, is_multiple, unit
  on public.template_field
  for each row execute function public.enforce_template_field_formula();
