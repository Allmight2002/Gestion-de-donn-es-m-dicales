-- =============================================================================
-- 20260616090800_patients.sql  (v3.0)
-- Creation d'un patient en SAISIE DIRECTE (parcours A). Deux lignes liees par le
-- seul (base_id, patient_code) : identite (zone restreinte) + analytique. Atomique.
-- SECURITY INVOKER => la RLS s'applique aux deux insertions (can_write_identity pour
-- l'identite, can_edit_structured_data pour l'analytique).
-- =============================================================================
create or replace function public.create_patient(
  p_base_id            uuid,
  p_patient_code       text,
  p_full_name          text,
  p_date_of_birth      date,
  p_phone              text,
  p_address            text,
  p_external_identifier text,
  p_auth_status        text,
  p_auth_date          date,
  p_permanent_data     jsonb
) returns public.patient
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tv      uuid;
  v_patient public.patient;
begin
  if p_patient_code is null or btrim(p_patient_code) = '' then
    raise exception 'Code patient requis';
  end if;

  select current_template_version_id into v_tv from public.base where id = p_base_id;
  if v_tv is null then raise exception 'La base n''a pas de version de gabarit courante'; end if;

  insert into public.patient_identity
    (base_id, patient_code, full_name, date_of_birth, phone, address, external_identifier,
     data_use_authorization_status, data_use_authorization_date, created_by)
  values
    (p_base_id, btrim(p_patient_code), p_full_name, p_date_of_birth, p_phone, p_address, p_external_identifier,
     coalesce(p_auth_status, 'not_requested'), p_auth_date, auth.uid());

  insert into public.patient
    (base_id, patient_code, template_version_id, data, collection_mode, validation_status, created_by)
  values
    (p_base_id, btrim(p_patient_code), v_tv, coalesce(p_permanent_data, '{}'::jsonb), 'direct', 'draft', auth.uid())
  returning * into v_patient;

  return v_patient;
end $$;

grant execute on function public.create_patient(uuid, text, text, date, text, text, text, text, date, jsonb) to authenticated;
