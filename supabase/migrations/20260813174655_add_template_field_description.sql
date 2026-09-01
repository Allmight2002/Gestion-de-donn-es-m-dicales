-- L27 : definition de saisie d'une variable. Nullable et sans valeur par defaut :
-- les variables historiques gardent leur sens actuel sans reecriture de table.
alter table public.template_field add column description text;

-- La consigne de saisie est volontairement non structurelle : elle reste corrigeable
-- apres la premiere donnee, comme le libelle. L'ancienne signature reste disponible
-- pour les clients encore en transition ; le frontend utilise celle-ci avec description.
create function public.update_template_field(
  p_field_id uuid, p_field_key text, p_label text, p_description text,
  p_scope text, p_section text, p_type text, p_required boolean,
  p_encounter_types text[] default null, p_allowed_values jsonb default null,
  p_min_value numeric default null, p_max_value numeric default null,
  p_unit text default null, p_allow_missing_codes boolean default true
) returns public.template_field
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.template_field; semantic boolean; res public.template_field;
begin
  select * into cur from public.template_field where id = p_field_id;
  if not found then raise exception 'Champ introuvable'; end if;
  if not public.owns_template(public.template_of_version(cur.template_version_id)) then
    raise exception 'Modification du gabarit non autorisee';
  end if;
  semantic := (p_field_key is distinct from cur.field_key)
           or (p_type is distinct from cur.type) or (p_scope is distinct from cur.scope)
           or (p_required is distinct from cur.required)
           or ((case when p_scope = 'encounter' then p_encounter_types else null end) is distinct from cur.encounter_types)
           or (coalesce(p_allowed_values, 'null'::jsonb) is distinct from coalesce(cur.allowed_values, 'null'::jsonb))
           or (p_min_value is distinct from cur.min_value) or (p_max_value is distinct from cur.max_value)
           or (p_allow_missing_codes is distinct from cur.allow_missing_codes);
  if semantic and public.template_field_in_use(p_field_id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la consigne de saisie, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  update public.template_field
     set field_key = p_field_key, label = p_label, description = nullif(btrim(p_description), ''),
         scope = p_scope, section = p_section, type = p_type, required = p_required,
         encounter_types = case when p_scope = 'encounter' then p_encounter_types else null end,
         allowed_values = p_allowed_values, min_value = p_min_value, max_value = p_max_value,
         unit = p_unit, allow_missing_codes = p_allow_missing_codes
   where id = p_field_id returning * into res;
  return res;
end $$;
revoke all on function public.update_template_field(uuid, text, text, text, text, text, text, boolean, text[], jsonb, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.update_template_field(uuid, text, text, text, text, text, text, boolean, text[], jsonb, numeric, numeric, text, boolean) to authenticated;
