-- =============================================================================
-- 20260616096300_storage_path_scope_guards.sql
-- Audit v14: a business row must never point to a Storage object outside its
-- own base prefix. Clinical attachments must also reference an encounter of the
-- same patient when encounter_id is present.
-- =============================================================================

create or replace function public.guard_storage_path_scope()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base uuid;
  v_submission_deleted_at timestamptz;
  v_enc_patient uuid;
  v_patient_deleted_at timestamptz;
  v_encounter_deleted_at timestamptz;
begin
  if tg_table_name = 'raw_document' then
    select base_id, deleted_at into v_base, v_submission_deleted_at
    from public.raw_submission
    where id = new.submission_id;

    if v_base is null or v_base is distinct from new.base_id then
      raise exception 'Coherence inter-bases : le document et sa soumission ne sont pas de la meme base';
    end if;
    if v_submission_deleted_at is not null
       and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.submission_id is distinct from old.submission_id)) then
      raise exception 'Soumission supprimee : impossible d y rattacher un document';
    end if;
    if new.storage_path is null or not new.storage_path like (v_base::text || '/%') then
      raise exception 'Chemin Storage incoherent : le document doit rester sous le prefixe de sa base';
    end if;
    return new;
  end if;

  if tg_table_name = 'clinical_attachment' then
    select base_id, deleted_at into v_base, v_patient_deleted_at
    from public.patient
    where id = new.patient_id;

    if v_base is null then
      raise exception 'Patient introuvable pour la piece jointe';
    end if;
    if v_patient_deleted_at is not null
       and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id)) then
      raise exception 'Patient supprime : impossible d y rattacher une piece jointe';
    end if;
    if new.encounter_id is not null then
      select patient_id, deleted_at into v_enc_patient, v_encounter_deleted_at
      from public.encounter
      where id = new.encounter_id;

      if v_enc_patient is null or v_enc_patient is distinct from new.patient_id then
        raise exception 'La rencontre jointe doit appartenir au patient de la piece jointe';
      end if;
      if v_encounter_deleted_at is not null
         and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.encounter_id is distinct from old.encounter_id)) then
        raise exception 'Rencontre supprimee : impossible d y rattacher une piece jointe';
      end if;
    end if;
    if new.storage_path is null or not new.storage_path like (v_base::text || '/%') then
      raise exception 'Chemin Storage incoherent : la piece jointe doit rester sous le prefixe de sa base';
    end if;
    return new;
  end if;

  return new;
end $$;

revoke all on function public.guard_storage_path_scope() from public, anon, authenticated;

drop trigger if exists trg_raw_document_storage_path_scope on public.raw_document;
create trigger trg_raw_document_storage_path_scope
  before insert or update on public.raw_document
  for each row execute function public.guard_storage_path_scope();

drop trigger if exists trg_clinical_attachment_storage_path_scope on public.clinical_attachment;
create trigger trg_clinical_attachment_storage_path_scope
  before insert or update on public.clinical_attachment
  for each row execute function public.guard_storage_path_scope();
