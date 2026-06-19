-- =============================================================================
-- 20260616090900_encounters.sql  (v3.0)
-- Saisie d'une rencontre + AGE CALCULE (§5.2, critere 10). L'age est calcule par le
-- systeme depuis la date de naissance (zone restreinte) et stocke dans les COLONNES
-- age_value + age_unit ; la date de naissance ne sort jamais.
--
-- SECURITY DEFINER : un editor SANS acces identite peut creer une rencontre avec age
-- calcule sans jamais voir la DOB. Controle d'acces explicite : can_edit_structured_data.
-- =============================================================================

create or replace function public.patient_age_at(p_patient_id uuid, p_at date, p_unit text default 'years')
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid; v_code text; v_dob date;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then return null; end if;
  if not public.has_base_access(v_base) then raise exception 'Acces refuse'; end if;
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  return public.compute_age(v_dob, p_at, coalesce(p_unit, 'years'));
end $$;

grant execute on function public.patient_age_at(uuid, date, text) to authenticated;

create or replace function public.create_encounter(
  p_patient_id        uuid,
  p_encounter_type    text,
  p_encounter_date    date,
  p_validation_status text,
  p_data              jsonb,
  p_age_unit          text default 'years'
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid; v_code text; v_tv uuid; v_dob date; v_age numeric; v_unit text; v_enc public.encounter;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  select current_template_version_id into v_tv from public.base where id = v_base;

  v_unit := coalesce(p_age_unit, 'years');
  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, p_encounter_date, v_unit);

  insert into public.encounter
    (patient_id, template_version_id, encounter_type, encounter_date, age_value, age_unit,
     data, collection_mode, validation_status, created_by)
  values
    (p_patient_id, v_tv, p_encounter_type, p_encounter_date, v_age, case when v_age is not null then v_unit else null end,
     coalesce(p_data, '{}'::jsonb) - 'age_at_encounter', 'direct', coalesce(p_validation_status, 'draft'), auth.uid())
  returning * into v_enc;

  return v_enc;
end $$;

grant execute on function public.create_encounter(uuid, text, date, text, jsonb, text) to authenticated;
