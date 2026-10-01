-- Regles et formules suivent le renommage de la variable qu'elles citent.
--
-- Avant : renommer le code d'une variable etait refuse des qu'une regle la citait (revalidation
-- de fin d'instruction : `Champ inconnu dans la regle : <ancien code>`) ou qu'une formule
-- l'utilisait (`Variable utilisee par la formule de ...`). L'utilisateur devait supprimer la
-- regle ou la formule, renommer, puis la recreer -- et la perdait en chemin.
--
-- Desormais, dans la MEME instruction que le renommage, et dans la meme version :
--   * chaque regle qui cite l'ancien code est reecrite, aux quatre emplacements possibles :
--     `left_field`, `right_field`, `if.field`, `then.field` ; rien d'autre ne change ;
--   * chaque formule qui l'utilise comme operande est reecrite (« a - b » garde sa forme).
--
-- Garanties :
--   * AFTER ROW : la variable porte deja son nouveau code quand regles et formules sont
--     reecrites ; toutes leurs gardes (structure, version verrouillee ou utilisee, cycles,
--     types d'operandes) jouent sur le resultat. La revalidation de fin d'instruction passe
--     ensuite sur toute la version. Tout refus annule le renommage ET les reecritures.
--   * `security invoker` : aucune elevation ; la reecriture passe par les memes droits que
--     n'importe quelle modification de regle ou de formule.
--   * Un changement de TYPE ou de PORTEE d'un operande reste refuse, comme sa suppression :
--     seul le renommage est desormais suivi.
--   * Une formule n'admet que des codes `[A-Za-z_][A-Za-z0-9_]*`. Renommer un operande vers un
--     code accentue ou avec tiret est refuse explicitement (FIELD_KEY_FORMULA_INCOMPATIBLE,
--     avec le libelle de la variable calculee), plutot qu'avec le motif interne de la formule.
--   * Le pilote d'une configuration diagnostique et son compagnon `<pilote>_autre` restent non
--     renommables : la configuration impose que les deux codes changent ensemble, ce qu'aucune
--     suite de modifications individuelles ne permet sans contourner ses gardes. Le refus est
--     explicite (FIELD_KEY_DIAGNOSIS_BOUND).

create function public.rule_with_renamed_field(p_rule jsonb, p_old text, p_new text)
returns jsonb language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare v jsonb := p_rule;
begin
  if jsonb_typeof(v) is distinct from 'object' then return v; end if;
  if v ->> 'left_field' = p_old then v := jsonb_set(v, '{left_field}', to_jsonb(p_new)); end if;
  if v ->> 'right_field' = p_old then v := jsonb_set(v, '{right_field}', to_jsonb(p_new)); end if;
  if jsonb_typeof(v -> 'if') = 'object' and v -> 'if' ->> 'field' = p_old then
    v := jsonb_set(v, '{if,field}', to_jsonb(p_new));
  end if;
  if jsonb_typeof(v -> 'then') = 'object' and v -> 'then' ->> 'field' = p_old then
    v := jsonb_set(v, '{then,field}', to_jsonb(p_new));
  end if;
  return v;
end $$;

-- La formule est deja normalisee par `enforce_template_field_formula` (elements separes par
-- une espace) : on remplace les elements EGAUX a l'ancien code, jamais une sous-chaine.
create function public.formula_with_renamed_field(formula text, p_old text, p_new text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select string_agg(case when t.token = p_old then p_new else t.token end, ' ' order by t.n)
    from unnest(regexp_split_to_array(btrim(formula_with_renamed_field.formula), '\s+')) with ordinality as t(token, n)
$$;

-- Fonctions pures, sans lecture : le declencheur `security invoker` les appelle avec les
-- droits de l'auteur du renommage, qui doit donc pouvoir les executer.
revoke all on function public.rule_with_renamed_field(jsonb, text, text) from public, anon;
grant execute on function public.rule_with_renamed_field(jsonb, text, text) to authenticated;
revoke all on function public.formula_with_renamed_field(text, text, text) from public, anon;
grant execute on function public.formula_with_renamed_field(text, text, text) to authenticated;

-- Garde des operandes : reprise a l'identique de 20260820120000, sauf qu'un RENOMMAGE seul
-- (meme type, meme portee) passe desormais -- la formule suit, ci-dessous. Suppression,
-- changement de type ou de portee restent refuses.
create or replace function public.enforce_template_field_formula_operand()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_dependent text;
begin
  if tg_op = 'UPDATE'
     and new.type is not distinct from old.type
     and new.scope is not distinct from old.scope then
    return new;
  end if;

  select f.label into v_dependent
    from public.template_field f
   where f.template_version_id = old.template_version_id
     and f.id <> old.id
     and f.formula is not null
     and f.scope = old.scope
     and old.field_key = any(regexp_split_to_array(f.formula, '\s+'))
   limit 1;

  if v_dependent is not null then
    raise exception 'Variable utilisee par la formule de "%" : corrigez ou supprimez d''abord la variable calculee', v_dependent;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.enforce_template_field_formula_operand() from public, anon, authenticated;

create function public.follow_template_field_key_rename()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_dependent text;
begin
  if new.field_key is not distinct from old.field_key
     or new.template_version_id is distinct from old.template_version_id then
    return null;
  end if;

  if exists (select 1 from public.template_version v, jsonb_array_elements(
                 case when jsonb_typeof(v.diagnosis_configuration) = 'array'
                      then v.diagnosis_configuration else '[]'::jsonb end) c
              where v.id = old.template_version_id and c ->> 'scope' = old.scope
                and old.field_key in (c ->> 'diagnosisFieldKey', (c ->> 'diagnosisFieldKey') || '_autre')) then
    raise exception using errcode = 'P0001', message = 'FIELD_KEY_DIAGNOSIS_BOUND',
      detail = '{"code":"FIELD_KEY_DIAGNOSIS_BOUND"}';
  end if;

  -- Formules d'abord : meme perimetre que la garde des operandes (meme version, meme portee).
  if new.field_key !~ '^[A-Za-z_][A-Za-z0-9_]*$' then
    select f.label into v_dependent
      from public.template_field f
     where f.template_version_id = new.template_version_id and f.id <> new.id
       and f.formula is not null and f.scope = new.scope
       and old.field_key = any(regexp_split_to_array(f.formula, '\s+'))
     order by f.display_order, f.field_key limit 1;
    if v_dependent is not null then
      raise exception using errcode = 'P0001', message = 'FIELD_KEY_FORMULA_INCOMPATIBLE',
        detail = jsonb_build_object('code', 'FIELD_KEY_FORMULA_INCOMPATIBLE', 'formulaField', v_dependent)::text;
    end if;
  end if;
  update public.template_field f
     set formula = public.formula_with_renamed_field(f.formula, old.field_key, new.field_key)
   where f.template_version_id = new.template_version_id and f.id <> new.id
     and f.formula is not null and f.scope = new.scope
     and old.field_key = any(regexp_split_to_array(f.formula, '\s+'));

  update public.validation_rule r
     set rule = public.rule_with_renamed_field(r.rule, old.field_key, new.field_key)
   where r.template_version_id = new.template_version_id
     and public.rule_with_renamed_field(r.rule, old.field_key, new.field_key) is distinct from r.rule;
  return null;
end $$;
revoke all on function public.follow_template_field_key_rename() from public, anon, authenticated;

create trigger trg_template_field_key_rename_follows
  after update of field_key on public.template_field
  for each row execute function public.follow_template_field_key_rename();
