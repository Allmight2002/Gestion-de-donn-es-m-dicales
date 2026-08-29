-- =============================================================================
-- 20260616093200_field_attrs_and_patient_edit.sql  (corrections UX pilote)
--   1) update_template_field : pouvoir definir/modifier aussi les VALEURS AUTORISEES (select),
--      les BORNES (min/max), l'UNITE et allow_missing_codes — pas seulement nom/type/portee.
--      Ces attributs (sauf unite) sont SEMANTIQUES -> verrouilles si la variable est utilisee.
--   2) update_patient : corriger / completer les DONNEES PERMANENTES d'un patient (journalise,
--      re-validees), comme update_encounter pour une rencontre. Sans cette RPC, un patient cree
--      avec des donnees incompletes restait bloque en brouillon, non modifiable (la §5.3 a retire
--      l'UPDATE direct sur patient).
-- Migration ADDITIVE.
-- =============================================================================

drop function if exists public.update_template_field(uuid, text, text, text, text, text, boolean, text[]);

create or replace function public.update_template_field(
  p_field_id  uuid,
  p_field_key text,
  p_label     text,
  p_scope     text,
  p_section   text,
  p_type      text,
  p_required  boolean,
  p_encounter_types     text[]  default null,
  p_allowed_values      jsonb   default null,
  p_min_value           numeric default null,
  p_max_value           numeric default null,
  p_unit                text    default null,
  p_allow_missing_codes boolean default true
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;

  -- Changement SEMANTIQUE (audit §8.2/§8.3) = qui altere le SENS / la validation : nom interne,
  -- type, portee, requis, types de rencontre, valeurs autorisees, bornes, codes manquants.
  -- Interdit si la variable est deja utilisee. Le libelle, la section et l'unite restent libres.
  semantic := (p_field_key       is distinct from cur.field_key)
           or (p_type            is distinct from cur.type)
           or (p_scope           is distinct from cur.scope)
           or (p_required        is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (coalesce(p_allowed_values, 'null'::jsonb) is distinct from coalesce(cur.allowed_values, 'null'::jsonb))
           or (p_min_value           is distinct from cur.min_value)
           or (p_max_value           is distinct from cur.max_value)
           or (p_allow_missing_codes is distinct from cur.allow_missing_codes);

  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement (nom, type, requis, valeurs, bornes...), creez une nouvelle version du gabarit.';
  end if;

  update public.template_field
     set field_key = p_field_key,
         label     = p_label,
         scope     = p_scope,
         section   = p_section,
         type      = p_type,
         required  = p_required,
         encounter_types     = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_values      = p_allowed_values,
         min_value           = p_min_value,
         max_value           = p_max_value,
         unit                = p_unit,
         allow_missing_codes = p_allow_missing_codes
   where id = p_field_id
   returning * into res;
  return res;
end $$;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, boolean, text[], jsonb, numeric, numeric, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- update_patient : correction / completion des DONNEES PERMANENTES (journalisee, re-validee).
-- ----------------------------------------------------------------------------
create or replace function public.update_patient(
  p_patient_id uuid, p_data jsonb, p_validation_status text, p_reason text
) returns public.patient
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pat public.patient; v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_pat from public.patient where id = p_patient_id and deleted_at is null;
  if not found then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_pat.base_id) then raise exception 'Acces refuse'; end if;

  -- Re-validation SERVEUR (bornes / listes / type) sur les donnees permanentes.
  perform public.assert_data_valid(v_pat.template_version_id, 'patient', coalesce(p_data, '{}'::jsonb));

  v_old := v_pat.data;
  v_new := coalesce(p_data, '{}'::jsonb);
  for v_key in
    select key from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new) as key) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values (v_pat.base_id, 'patient', p_patient_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  -- Le statut suit les memes garde-fous que les triggers (pas de retrogradation curated ;
  -- completude/validite imposees si curated).
  update public.patient
     set data = v_new, validation_status = coalesce(p_validation_status, v_pat.validation_status), updated_at = now()
   where id = p_patient_id
   returning * into v_pat;
  return v_pat;
end $$;
grant execute on function public.update_patient(uuid, jsonb, text, text) to authenticated;
