-- =============================================================================
-- 20260616091000_corrections.sql  (v3.0)
-- Correction d'une rencontre + historique (§14, critere 30). Journalise chaque champ
-- de donnees modifie dans field_change_log (ancienne/nouvelle valeur, auteur, motif,
-- source='manual_correction'), atomiquement. L'age reste calcule par le systeme.
-- =============================================================================
create or replace function public.update_encounter(
  p_encounter_id      uuid,
  p_data              jsonb,
  p_validation_status text,
  p_reason            text
) returns public.encounter
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_enc public.encounter; v_base uuid; v_code text; v_dob date; v_age numeric;
  v_old jsonb; v_new jsonb; v_key text;
begin
  select * into v_enc from public.encounter where id = p_encounter_id and deleted_at is null;
  if not found then raise exception 'Rencontre introuvable'; end if;

  select base_id, patient_code into v_base, v_code from public.patient where id = v_enc.patient_id;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  select date_of_birth into v_dob
  from public.patient_identity where base_id = v_base and patient_code = v_code and deleted_at is null;
  v_age := public.compute_age(v_dob, v_enc.encounter_date, coalesce(v_enc.age_unit, 'years'));

  v_old := v_enc.data;
  v_new := coalesce(p_data, '{}'::jsonb) - 'age_at_encounter';

  for v_key in
    select key from (
      select jsonb_object_keys(v_old) as key
      union
      select jsonb_object_keys(v_new) as key
    ) keys
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into public.field_change_log
        (base_id, entity, entity_id, field_key, old_value, new_value, changed_by, reason, source)
      values
        (v_base, 'encounter', p_encounter_id, v_key, v_old -> v_key, v_new -> v_key, auth.uid(), p_reason, 'manual_correction');
    end if;
  end loop;

  update public.encounter
  set data = v_new,
      validation_status = coalesce(p_validation_status, v_enc.validation_status),
      age_value = v_age
  where id = p_encounter_id
  returning * into v_enc;

  return v_enc;
end $$;

grant execute on function public.update_encounter(uuid, jsonb, text, text) to authenticated;
