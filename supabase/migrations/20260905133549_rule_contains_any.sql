-- L51: additive condition operator. No data rewrite, no change to legacy in/comparisons.
-- Existing function signatures/ACLs are preserved by CREATE OR REPLACE.
-- Rule JSON is copied intact by all version-copy RPCs, including terminologyReleaseId.

-- Version lock precedes existing field/rule guards, including direct authorized writes.
-- Invoker: the caller must already be allowed to edit the version by existing RLS.
create function public.lock_contains_any_configuration()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform id from public.template_version
    where id in (new.template_version_id, case when tg_op = 'UPDATE' then old.template_version_id end)
    order by id for update;
  return new;
end $$;
revoke all on function public.lock_contains_any_configuration() from public, anon, authenticated;

create trigger trg_00_contains_any_lock
before insert or update on public.template_field
for each row execute function public.lock_contains_any_configuration();
create trigger trg_00_contains_any_lock
before insert or update on public.validation_rule
for each row execute function public.lock_contains_any_configuration();

create or replace function public.rule_apply_op(op text, a jsonb, b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare ta text := a #>> '{}'; c int; vals jsonb; el jsonb; code text; codes text[] := '{}'; kind text; hit boolean := false;
begin
  if op = 'contains_any' then
    -- All shape checks precede set-returning functions. Never coerce a JSON value to a code.
    if jsonb_typeof(b) is distinct from 'array' then return false; end if;
    if jsonb_array_length(b) = 0 then return false; end if;
    if exists (select 1 from jsonb_array_elements(b) e
      where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') then return false; end if;
    if (select count(distinct e) from jsonb_array_elements(b) e) <> jsonb_array_length(b) then return false; end if;
    if a is null or jsonb_typeof(a) = 'null' then return false; end if;
    vals := case when jsonb_typeof(a) = 'array' then a else jsonb_build_array(a) end;
    if jsonb_array_length(vals) = 0 then return false; end if;
    kind := jsonb_typeof(vals -> 0);
    if kind not in ('string', 'object') then return false; end if;
    if kind = 'object' and jsonb_array_length(vals) > 50 then return false; end if;
    for el in select value from jsonb_array_elements(vals) loop
      if jsonb_typeof(el) is distinct from kind then return false; end if;
      if kind = 'object' then
        if jsonb_typeof(el -> 'code') is distinct from 'string'
          or jsonb_typeof(el -> 'label') is distinct from 'string' then return false; end if;
        if exists (select 1 from jsonb_object_keys(el) k where k not in ('code', 'label')) then return false; end if;
        if btrim(el ->> 'label', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then return false; end if;
        code := el ->> 'code';
        if code = any(codes) then return false; end if;
      else
        code := el #>> '{}';
      end if;
      if btrim(code, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then return false; end if;
      codes := array_append(codes, code);
      hit := hit or b @> jsonb_build_array(code);
    end loop;
    return hit;
  elsif op = 'equals' then
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

create or replace function public.rule_holds(rule jsonb, data jsonb, hidden text[])
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare cond jsonb; thn jsonb; op text; cf text; tf text; lf text; rf text;
  comparison text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  conditionop text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in','contains_any'];
  v_hidden text[] := coalesce(hidden, '{}');
begin
  if rule is null or jsonb_typeof(rule) <> 'object' then return true; end if;

  -- Conditionnelle : { if:{field,operator,value}, then:{field, operator:'required'|'visible'} }
  if (rule ? 'if') and (rule ? 'then') then
    cond := rule -> 'if'; thn := rule -> 'then';
    if (thn ->> 'operator') = 'visible' then return true; end if;   -- regle d'affichage : rien a exiger
    op := cond ->> 'operator'; cf := cond ->> 'field'; tf := thn ->> 'field';
    if op is null or not (op = any(conditionop)) then return true; end if;          -- operateur non whitelist -> ignoree
    -- VISIBILITE D'ABORD : ni la condition ni l'exigence ne portent sur un champ masque.
    if cf = any(v_hidden) or tf = any(v_hidden) then return true; end if;
    if cf is null or not public.rule_value_present(data -> cf) then return true; end if; -- condition inapplicable
    if not public.rule_apply_op(op, data -> cf, cond -> 'value') then return true; end if; -- condition fausse -> respectee
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
    if lf = any(v_hidden) or rf = any(v_hidden) then return true; end if;
    if not public.rule_value_present(data -> lf) or not public.rule_value_present(data -> rf) then
      return true; -- regle inapplicable si un operande absent
    end if;
    return public.rule_apply_op(op, data -> lf, data -> rf);
  end if;

  return true;
end $$;

create or replace function public.assert_rule_structure(p_version_id uuid, p_rule jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare
  op text; lf text; rf text; cf text; tf text; thenop text; cf_scope text; tf_scope text;
  driver public.template_field; configured jsonb; v_release_id uuid; item jsonb;
  ok_ops    text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal'];
  ok_if_ops text[] := array['equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','in','contains_any'];
  ok_then   text[] := array['required','visible'];
begin
  if p_rule -> 'if' ->> 'operator' = 'contains_any' then
    if p_rule ?| array['operator', 'left_field', 'right_field']
      or jsonb_typeof(p_rule -> 'if' -> 'field') is distinct from 'string'
      or jsonb_typeof(p_rule -> 'then' -> 'field') is distinct from 'string'
      or exists (select 1 from jsonb_object_keys(p_rule -> 'if') k
        where k not in ('field', 'operator', 'value', 'terminologyReleaseId')) then
      raise exception 'contains_any : une seule condition de champ est autorisee pour "%"',
        coalesce(p_rule -> 'if' ->> 'field', '?');
    end if;
  end if;
  if p_rule ? 'operator' and p_rule ? 'left_field' and p_rule ? 'right_field' then
    op := p_rule ->> 'operator';
    if not (op = any(ok_ops)) then raise exception 'Operateur de regle invalide : %', op; end if;
    lf := p_rule ->> 'left_field'; rf := p_rule ->> 'right_field';
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = lf) then
      raise exception 'Champ inconnu dans la regle : %', lf; end if;
    if not exists (select 1 from public.template_field where template_version_id = p_version_id and field_key = rf) then
      raise exception 'Champ inconnu dans la regle : %', rf; end if;
  elsif p_rule ? 'if' and p_rule ? 'then' then
    op := p_rule -> 'if' ->> 'operator'; cf := p_rule -> 'if' ->> 'field'; tf := p_rule -> 'then' ->> 'field';
    thenop := p_rule -> 'then' ->> 'operator';
    if not (op = any(ok_if_ops)) then raise exception 'Operateur conditionnel invalide : %', op; end if;
    if thenop is null or not (thenop = any(ok_then)) then
      raise exception 'La clause then doit etre operator=required ou operator=visible'; end if;
    select scope into cf_scope from public.template_field
     where template_version_id = p_version_id and field_key = cf;
    if cf is null or cf_scope is null then
      raise exception 'Champ inconnu dans la regle (if) : %', coalesce(cf, '?'); end if;
    select scope into tf_scope from public.template_field
     where template_version_id = p_version_id and field_key = tf;
    if tf is null or tf_scope is null then
      raise exception 'Champ inconnu dans la regle (then) : %', coalesce(tf, '?'); end if;

    if p_rule -> 'if' ? 'terminologyReleaseId' and op <> 'contains_any' then
      raise exception 'Release terminologique interdite pour "%"', cf;
    end if;
    if op = 'contains_any' then
      select * into driver from public.template_field where template_version_id = p_version_id and field_key = cf;
      if driver.type not in ('select', 'multiselect', 'terminology') then
        raise exception 'contains_any : type de pilote non autorise pour "%"', driver.label;
      end if;
      configured := p_rule -> 'if' -> 'value';
      if jsonb_typeof(configured) is distinct from 'array' then
        raise exception 'contains_any : liste de codes requise pour "%"', driver.label;
      end if;
      if jsonb_array_length(configured) = 0 then
        raise exception 'contains_any : liste vide pour "%"', driver.label;
      end if;
      if exists (select 1 from jsonb_array_elements(configured) e
        where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') then
        raise exception 'contains_any : code invalide pour "%"', driver.label;
      end if;
      if (select count(distinct e) from jsonb_array_elements(configured) e) <> jsonb_array_length(configured) then
        raise exception 'contains_any : codes dupliques pour "%"', driver.label;
      end if;
      if driver.type = 'terminology' then
        if jsonb_typeof(p_rule -> 'if' -> 'terminologyReleaseId') is distinct from 'string'
          or (p_rule -> 'if' ->> 'terminologyReleaseId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'contains_any : release terminologique explicite requise pour "%"', driver.label;
        end if;
        v_release_id := (p_rule -> 'if' ->> 'terminologyReleaseId')::uuid;
        if not exists (select 1 from public.terminology_release r where r.id = v_release_id) then
          raise exception 'contains_any : release terminologique inconnue pour "%"', driver.label;
        end if;
      elsif p_rule -> 'if' ? 'terminologyReleaseId' then
        raise exception 'contains_any : release terminologique interdite pour "%"', driver.label;
      end if;
      for item in select value from jsonb_array_elements(configured) loop
        if driver.type = 'terminology' then
          if not exists (select 1 from public.terminology_concept c
            where c.release_id = v_release_id and c.code = item #>> '{}' and c.is_selectable) then
            raise exception 'contains_any : code absent de la release pour "%"', driver.label;
          end if;
        elsif not coalesce(driver.allowed_values @> jsonb_build_array(item), false) then
          raise exception 'contains_any : code absent des options pour "%"', driver.label;
        end if;
      end loop;
    end if;

    if thenop = 'visible' then
      -- Une variable ne peut pas commander son propre affichage : elle ne s'afficherait jamais.
      if cf = tf then
        raise exception 'Regle d''affichage : une variable ne peut pas commander son propre affichage'; end if;
      -- Patient et rencontre sont deux fiches distinctes : une condition portee par l'autre
      -- fiche n'est jamais verifiable, donc masquerait la variable pour toujours.
      if cf_scope <> tf_scope then
        raise exception 'Regle d''affichage : les deux variables doivent appartenir a la meme fiche (patient ou visite)'; end if;
    end if;
  else
    raise exception 'Structure de regle invalide (attendu {operator,left_field,right_field} ou {if,then})';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.publish_template_version(p_version_id uuid)
 RETURNS template_version
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v public.template_version; r record;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then raise exception 'Modification du jeu de variables non autorisee'; end if;
  if v.status <> 'draft' then raise exception 'Seule une version draft peut etre publiee'; end if;

  -- Recheck the whole version under the same lock used by field/rule writes.
  for r in select id, rule from public.validation_rule where template_version_id = p_version_id loop
    perform public.assert_rule_structure(p_version_id, r.rule);
    perform public.assert_visibility_acyclic(p_version_id, r.rule, r.id);
  end loop;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = coalesce(published_at, now())
   where id = p_version_id
   returning * into v;
  return v;
end $function$;

-- AFTER sees both allowed_options and the final allowed_values mirror. Revalidate even
-- on direct writes; changing field key/type/scope or moving the driver cannot orphan rules.
create function public.revalidate_contains_any_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select template_version_id, rule from public.validation_rule
    where template_version_id in (new.template_version_id, old.template_version_id)
      and rule -> 'if' ->> 'operator' = 'contains_any'
  loop
    perform public.assert_rule_structure(r.template_version_id, r.rule);
  end loop;
  return new;
end $$;
revoke all on function public.revalidate_contains_any_rules() from public, anon, authenticated;
create trigger trg_contains_any_revalidate
  after update on public.template_field
  for each row execute function public.revalidate_contains_any_rules();

-- No new SECURITY DEFINER. Invoked inside the existing clinical write boundary.
create function public.assert_contains_any_hidden_values(p_version uuid, p_scope text, p_data jsonb)
returns void language plpgsql stable set search_path = public, pg_temp as $$
declare hidden text[]; f record;
begin
  if not exists (select 1 from public.validation_rule where template_version_id = p_version
    and rule -> 'if' ->> 'operator' = 'contains_any') then return; end if;
  hidden := public.visibility_hidden_fields(p_version, p_data);
  for f in select field_key from public.template_field tf
    where template_version_id = p_version and scope = p_scope and field_key = any(hidden)
      and exists (select 1 from public.validation_rule vr where vr.template_version_id = p_version
        and vr.rule -> 'if' ->> 'operator' = 'contains_any'
        and vr.rule -> 'then' ->> 'field' = tf.field_key)
      and p_data ? field_key and (p_data -> field_key) <> 'null'::jsonb
  loop
    raise exception using errcode = 'P0001',
      message = 'Variable masquee : actualisez l’application avant de reprendre l’enregistrement.',
      detail = jsonb_build_object('code', 'contains_any_hidden_value', 'field', f.field_key,
        'action', 'refresh_required')::text,
      hint = 'refresh_required';
  end loop;
end $$;
revoke all on function public.assert_contains_any_hidden_values(uuid, text, jsonb) from public, anon, authenticated;
-- Existing clinical triggers also run during authorized authenticated operations.
grant execute on function public.assert_contains_any_hidden_values(uuid, text, jsonb) to authenticated;

create or replace function public.assert_curated_complete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_scope text := case when tg_table_name = 'patient' then 'patient' else 'encounter' end;
begin
  perform public.assert_contains_any_hidden_values(new.template_version_id, v_scope, new.data);

  -- Aucune cle inconnue du gabarit, QUEL QUE SOIT le statut (draft / complete / curated).
  perform public.assert_no_unknown_fields(new.template_version_id, v_scope, new.data);

  -- Completude des champs requis : exigee des la sortie du brouillon. Un dossier
  -- 'complete' est soumis (statut terminal pour un compte de mission) : il ne peut
  -- pas manquer de donnees obligatoires.
  if new.validation_status <> 'draft' then
    if v_scope = 'patient' then
      perform public.assert_required_complete(new.template_version_id, 'patient', new.data);
    else
      perform public.assert_required_complete(new.template_version_id, 'encounter', new.data, new.encounter_type);
    end if;
  end if;

  -- Validation complete (bornes/types deja portees par les RPC ; ici en defense) +
  -- regles de coherence + valeurs sous champ masque : uniquement a la FINALISATION (curated).
  if new.validation_status = 'curated' then
    perform public.assert_data_valid(new.template_version_id, v_scope, new.data);
    perform public.assert_validation_rules(new.template_version_id, new.data);
    perform public.assert_no_hidden_values(new.template_version_id, v_scope, new.data);
  end if;
  return new;
end $$;
