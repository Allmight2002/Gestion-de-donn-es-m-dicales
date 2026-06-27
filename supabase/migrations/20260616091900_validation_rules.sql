-- =============================================================================
-- 20260616091900_validation_rules.sql  (audit 2 §5.2)
-- Evaluation COTE SERVEUR des regles de coherence JSON (validation_rule), avec EXACTEMENT
-- les memes operateurs en liste blanche que le moteur React (src/domain/validation.ts) :
-- comparaison (equals / not_equals / >, >=, <, <=) et conditionnelle ({if:{field,operator,
-- value}, then:{field, operator:'required'}}, operateur `in` autorise dans le `if`).
-- Les regles de severite `block` EMPECHENT desormais le passage en `curated` (appelees par
-- le trigger assert_curated_complete) — fermant le contournement "sortie < admission" ou
-- "deces sans date de deces" par appel API direct. Aucun code dynamique n'est execute.
--
-- Defini ici (migration posterieure) plutot qu'en editant une ancienne migration : le
-- trigger (cree en 090500) appelle la fonction PAR SON NOM ; on re-cree juste la fonction.
-- =============================================================================

-- Presence d'une VRAIE valeur (ni vide, ni code manquant {"__missing__"}).
create or replace function public.rule_value_present(v jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select v is not null
     and jsonb_typeof(v) <> 'null'
     and not (jsonb_typeof(v) = 'object' and (v ? '__missing__'))
     and not (jsonb_typeof(v) = 'string' and (v #>> '{}') = '')
     and not (jsonb_typeof(v) = 'array'  and jsonb_array_length(v) = 0)
$$;

-- Comparaison ordonnee : dates ISO (AAAA-MM-JJ) comparees en chaine, sinon numerique,
-- sinon incomparable (null). Renvoie -1 / 0 / 1 / null. (cf. order() cote React).
create or replace function public.rule_cmp(a jsonb, b jsonb)
returns int language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; tb text := b #>> '{}'; na numeric; nb numeric;
begin
  if ta is null or tb is null then return null; end if;
  if ta ~ '^\d{4}-\d{2}-\d{2}' and tb ~ '^\d{4}-\d{2}-\d{2}' then
    return case when ta < tb then -1 when ta > tb then 1 else 0 end;
  end if;
  begin na := ta::numeric; nb := tb::numeric;
  exception when others then return null; end;
  return case when na < nb then -1 when na > nb then 1 else 0 end;
end $$;

-- Applique un operateur (liste blanche) entre deux valeurs jsonb.
create or replace function public.rule_apply_op(op text, a jsonb, b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; c int;
begin
  if op = 'equals' then
    return coalesce(ta,'') = coalesce(b #>> '{}','');
  elsif op = 'not_equals' then
    return coalesce(ta,'') <> coalesce(b #>> '{}','');
  elsif op = 'in' then
    return jsonb_typeof(b) = 'array'
       and exists (select 1 from jsonb_array_elements_text(b) e where e = ta);
  else
    c := public.rule_cmp(a, b);
    if c is null then return false; end if;
    return case op
             when 'greater_than'     then c > 0
             when 'greater_or_equal' then c >= 0
             when 'less_than'        then c < 0
             when 'less_or_equal'    then c <= 0
             else false
           end;
  end if;
end $$;

-- Une regle est-elle RESPECTEE (pas de violation) pour ces donnees ? (= ruleHolds React).
create or replace function public.rule_holds(rule jsonb, data jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare cond jsonb; thn jsonb; op text; cf text; tf text; lf text; rf text;
  comparison text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  conditionop text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in'];
begin
  if rule is null or jsonb_typeof(rule) <> 'object' then return true; end if;

  -- Conditionnelle : { if:{field,operator,value}, then:{field, operator:'required'} }
  if (rule ? 'if') and (rule ? 'then') then
    cond := rule -> 'if'; thn := rule -> 'then';
    op := cond ->> 'operator'; cf := cond ->> 'field';
    if op is null or not (op = any(conditionop)) then return true; end if;          -- operateur non whitelist -> ignoree
    if cf is null or not public.rule_value_present(data -> cf) then return true; end if; -- condition inapplicable
    if not public.rule_apply_op(op, data -> cf, cond -> 'value') then return true; end if; -- condition fausse -> respectee
    tf := thn ->> 'field';
    if (thn ->> 'operator') = 'required' then
      return public.rule_value_present(data -> tf);
    end if;
    return true;
  end if;

  -- Comparaison : { operator, left_field, right_field }
  if rule ? 'operator' then
    op := rule ->> 'operator';
    if not (op = any(comparison)) then return true; end if;
    lf := rule ->> 'left_field'; rf := rule ->> 'right_field';
    if lf is null or rf is null then return true; end if;
    if not public.rule_value_present(data -> lf) or not public.rule_value_present(data -> rf) then
      return true; -- regle inapplicable si un operande absent
    end if;
    return public.rule_apply_op(op, data -> lf, data -> rf);
  end if;

  return true;
end $$;

-- Impose les regles de severite `block` d'une version sur un jeu de donnees.
create or replace function public.assert_validation_rules(p_version uuid, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare r record;
begin
  if p_data is null then return; end if;
  for r in
    select rule, coalesce(message, 'Regle de coherence non respectee') as message
    from public.validation_rule
    where template_version_id = p_version and severity = 'block'
  loop
    if not public.rule_holds(r.rule, p_data) then
      raise exception '%', r.message;
    end if;
  end loop;
end $$;

-- Trigger curated ENRICHI : ajoute l'evaluation des regles `block` aux controles
-- bornes/types (assert_data_valid) + cles inconnues + completude.
create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.validation_status = 'curated' then
    if tg_table_name = 'patient' then
      perform public.assert_data_valid(new.template_version_id, 'patient', new.data);
      perform public.assert_no_unknown_fields(new.template_version_id, 'patient', new.data);
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
      perform public.assert_validation_rules(new.template_version_id, new.data);
    else
      perform public.assert_data_valid(new.template_version_id, 'encounter', new.data);
      perform public.assert_no_unknown_fields(new.template_version_id, 'encounter', new.data);
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
      perform public.assert_validation_rules(new.template_version_id, new.data);
    end if;
  end if;
  return new;
end $$;

grant execute on function public.assert_validation_rules(uuid, jsonb) to authenticated;
