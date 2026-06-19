-- =============================================================================
-- 20260616091300_soft_delete.sql  (v3.0)
-- Suppression LOGIQUE (§15, critere métier). deleted_at/deleted_by/deletion_reason.
-- Les lignes disparaissent de l'usage normal (RLS) mais restent en base.
-- =============================================================================

create or replace function public.soft_delete_patient(p_patient_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid; v_code text;
begin
  select base_id, patient_code into v_base, v_code
  from public.patient where id = p_patient_id and deleted_at is null;
  if v_base is null then raise exception 'Patient introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;

  update public.patient set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where id = p_patient_id;
  update public.patient_identity set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where base_id = v_base and patient_code = v_code and deleted_at is null;
  update public.encounter set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where patient_id = p_patient_id and deleted_at is null;
  update public.clinical_attachment set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where patient_id = p_patient_id and deleted_at is null;
  perform public.log_audit('patient_deleted', 'patient', p_patient_id, v_base, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.soft_delete_encounter(p_encounter_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  select public.base_of_patient(e.patient_id) into v_base
  from public.encounter e where e.id = p_encounter_id and e.deleted_at is null;
  if v_base is null then raise exception 'Rencontre introuvable'; end if;
  if not public.can_edit_structured_data(v_base) then raise exception 'Acces refuse'; end if;
  update public.encounter set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where id = p_encounter_id;
  perform public.log_audit('encounter_deleted', 'encounter', p_encounter_id, v_base, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.soft_delete_attachment(p_attachment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  select public.base_of_patient(a.patient_id) into v_base
  from public.clinical_attachment a where a.id = p_attachment_id and a.deleted_at is null;
  if v_base is null then raise exception 'Image introuvable'; end if;
  if not public.can_write_identity(v_base) then raise exception 'Acces refuse'; end if;
  update public.clinical_attachment set deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason
    where id = p_attachment_id;
end $$;

grant execute on function public.soft_delete_patient(uuid, text) to authenticated;
grant execute on function public.soft_delete_encounter(uuid, text) to authenticated;
grant execute on function public.soft_delete_attachment(uuid, text) to authenticated;
