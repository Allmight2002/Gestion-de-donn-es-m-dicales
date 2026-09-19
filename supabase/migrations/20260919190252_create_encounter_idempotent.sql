-- L69 — creation idempotente d'une occurrence repetable.
--
-- Chaque appel correspond a UNE ligne du tampon. L'accuse et l'occurrence sont
-- ecrits dans la meme transaction ; une reponse perdue peut donc etre rejouee
-- avec la meme cle sans inserer de seconde rencontre. Ce n'est pas une
-- transaction globale patient + occurrences : le client cree la fiche, puis
-- appelle cette RPC une fois par occurrence, dans l'ordre de saisie.
--
-- Le recu reutilise la table server-only offline_encounter_create_operation :
-- meme ownership, verrou consultatif, empreinte serveur et identifiant cree.
-- L'empreinte L69 ajoute le bloc et la date nulle, absents du rejeu hors-ligne
-- actuel. Le purge vide ces recus et ceux des patients hors-ligne avant de
-- supprimer les donnees qu'ils referencent (FK historiques ON DELETE RESTRICT).

create or replace function public.create_encounter_idempotent(
  p_operation_id       text,
  p_patient_id         uuid,
  p_encounter_type     text,
  p_encounter_date     date,
  p_validation_status  text,
  p_data               jsonb,
  p_age_unit           text,
  p_group_section_key  text
)
returns table(id uuid, patient_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_operation public.offline_encounter_create_operation;
  v_payload jsonb;
  v_fingerprint text;
  v_base uuid;
  v_encounter public.encounter;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_id is null
     or length(btrim(p_operation_id)) not between 1 and 200
     or left(btrim(p_operation_id), length('l69-occurrence:')) <> 'l69-occurrence:' then
    raise exception 'L69_OPERATION_INVALID' using errcode = 'P0001';
  end if;
  if p_patient_id is null or p_group_section_key is null
     or btrim(p_group_section_key) = '' then
    raise exception 'L69_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  -- La cle est liee a l'acteur, jamais fournie comme identite d'autorisation.
  -- Les droits sont reevalues aussi lors d'un rejeu d'un accuse deja cree.
  select patient.base_id into v_base
    from public.patient
   where patient.id = p_patient_id
     and patient.deleted_at is null;
  if v_base is null then
    raise exception 'L69_OCCURRENCE_PATIENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.can_create_structured_data(v_base) then
    raise exception 'WRITE_FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(p_validation_status, 'draft') = 'curated'
     and not public.can_edit_structured_data(v_base) then
    raise exception 'WRITE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- L'empreinte est calculee serveur-side et couvre chaque parametre qui change
  -- l'occurrence, dont le bloc repetable et encounter_date=null.
  v_payload := jsonb_build_object(
    'kind', 'l69_repeatable_encounter_create',
    'patient_id', p_patient_id,
    'encounter_type', p_encounter_type,
    'encounter_date', p_encounter_date,
    'validation_status', coalesce(p_validation_status, 'draft'),
    'data', coalesce(p_data, '{}'::jsonb),
    'age_unit', coalesce(p_age_unit, 'years'),
    'group_section_key', p_group_section_key
  );
  v_fingerprint := encode(
    digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':e:' || btrim(p_operation_id), 0)
  );

  select operation.* into v_operation
    from public.offline_encounter_create_operation operation
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id)
   for update;
  if found then
    if v_operation.request_fingerprint is distinct from v_fingerprint then
      raise exception 'L69_OPERATION_MISMATCH' using errcode = 'P0001';
    end if;
    if v_operation.completed_at is null or v_operation.encounter_id is null then
      raise exception 'L69_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return query select v_operation.encounter_id, v_operation.patient_id, true;
    return;
  end if;

  insert into public.offline_encounter_create_operation(
    user_id, operation_id, parent_operation_id, request_fingerprint, patient_id
  ) values (
    v_uid, btrim(p_operation_id), null, v_fingerprint, p_patient_id
  );

  -- La RPC L66 reste l'unique chemin d'ecriture clinique et refait tous les
  -- controles de version, de bloc, de validation et de permission.
  select * into v_encounter
    from public.create_encounter(
      p_patient_id,
      p_encounter_type,
      p_encounter_date,
      p_validation_status,
      p_data,
      coalesce(p_age_unit, 'years'),
      p_group_section_key
    );

  update public.offline_encounter_create_operation operation
     set encounter_id = v_encounter.id,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_encounter.id, v_encounter.patient_id, false;
end
$$;

revoke all on function public.create_encounter_idempotent(
  text, uuid, text, date, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_encounter_idempotent(
  text, uuid, text, date, text, jsonb, text, text
) to authenticated;

-- L'O1 avait ajoute des recus FK RESTRICT apres la migration initiale du purge.
-- L69 les utilise pour l'idempotence par occurrence ; il faut les effacer dans
-- la meme transaction que la purge physique de la base.
create or replace function public.finalize_base_purge(
  p_operation_id uuid,
  p_manifest_hash text,
  p_actor_id uuid
)
returns table(status text, code text, operation_id uuid, base_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.base_purge_operation;
  v_base public.base;
  v_export_count integer;
  v_deleted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    status := 'rejected'; code := 'SERVER_REQUIRED'; return next; return;
  end if;
  if p_operation_id is null or p_manifest_hash is null or p_actor_id is null then
    status := 'rejected'; code := 'PURGE_OPERATION_INVALID'; return next; return;
  end if;

  select * into v_operation
    from public.base_purge_operation o
   where o.operation_id = p_operation_id
   for update;
  if not found then
    status := 'rejected'; code := 'PURGE_OPERATION_NOT_FOUND'; operation_id := p_operation_id;
    return next; return;
  end if;
  if v_operation.status = 'completed' then
    status := 'completed'; code := 'ALREADY_PURGED'; operation_id := p_operation_id;
    base_id := v_operation.base_reference_id; return next; return;
  end if;
  if v_operation.requested_by is distinct from p_actor_id then
    status := 'rejected'; code := 'PURGE_ACTOR_MISMATCH'; operation_id := p_operation_id;
    return next; return;
  end if;
  if v_operation.manifest_hash is distinct from lower(btrim(p_manifest_hash)) then
    status := 'rejected'; code := 'MANIFEST_MISMATCH'; operation_id := p_operation_id;
    return next; return;
  end if;

  select * into v_base
    from public.base
   where id = v_operation.base_reference_id
   for update;
  if not found then
    status := 'rejected'; code := 'BASE_NOT_FOUND'; operation_id := p_operation_id;
    base_id := v_operation.base_reference_id; return next; return;
  end if;
  if v_base.deleted_at is null then
    status := 'rejected'; code := 'BASE_ACTIVE'; operation_id := p_operation_id; base_id := v_base.id;
    return next; return;
  end if;
  if v_base.purge_status <> 'pending' then
    status := 'rejected'; code := 'PURGE_STATE_INVALID'; operation_id := p_operation_id; base_id := v_base.id;
    return next; return;
  end if;

  update public.export_log e
     set base_id = null
   where e.base_id = v_base.id;
  get diagnostics v_export_count = row_count;

  insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
  values (
    p_actor_id, 'base_purged', 'base', v_base.id, v_base.id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'base_reference_id', v_base.id,
      'patient_count', v_operation.patient_count,
      'encounter_count', v_operation.encounter_count,
      'document_count', v_operation.document_count,
      'attachment_count', v_operation.attachment_count,
      'export_journal_count', v_export_count,
      'storage_object_count', v_operation.storage_object_count,
      'storage_strategy', 'objects_removed_journal_preserved'
    )
  );

  -- Ordre explicite : supprimer les recus O1 avant les lignes patient et
  -- rencontre (leurs FK historiques sont RESTRICT).
  delete from public.offline_encounter_operation o
   using public.encounter e, public.patient p
   where o.encounter_id = e.id and e.patient_id = p.id and p.base_id = v_base.id;

  delete from public.offline_encounter_create_operation o
   where exists (
           select 1 from public.patient p
            where p.id = o.patient_id and p.base_id = v_base.id
         )
      or exists (
           select 1 from public.encounter e join public.patient p on p.id = e.patient_id
            where e.id = o.encounter_id and p.base_id = v_base.id
         )
      or exists (
           select 1 from public.offline_patient_create_operation parent
            where parent.user_id = o.user_id
              and parent.operation_id = o.parent_operation_id
              and parent.base_id = v_base.id
         );
  delete from public.offline_patient_create_operation o where o.base_id = v_base.id;

  delete from public.patient_curation_idempotency i
   where exists (
           select 1 from public.patient p
            where p.id = i.patient_id and p.base_id = v_base.id
         )
      or exists (
           select 1 from public.raw_submission s
            where s.id = i.submission_id and s.base_id = v_base.id
         )
      or exists (
           select 1 from public.curation_task t
            where t.id = i.task_id and t.base_id = v_base.id
         );

  delete from public.cohort_encounter_member m
   using public.cohort c
   where m.cohort_id = c.id and c.base_id = v_base.id;
  delete from public.cohort_encounter_member m
   using public.encounter e, public.patient p
   where m.encounter_id = e.id and e.patient_id = p.id and p.base_id = v_base.id;
  delete from public.cohort_member m
   using public.cohort c
   where m.cohort_id = c.id and c.base_id = v_base.id;
  delete from public.cohort_member m
   using public.patient p
   where m.patient_id = p.id and p.base_id = v_base.id;

  delete from public.curation_clarification c where c.base_id = v_base.id;
  delete from public.curation_draft d where d.base_id = v_base.id;
  delete from public.raw_document d where d.base_id = v_base.id;
  delete from public.clinical_attachment a
   using public.patient p
   where a.patient_id = p.id and p.base_id = v_base.id;
  delete from public.encounter e
   using public.patient p
   where e.patient_id = p.id and p.base_id = v_base.id;
  delete from public.curation_task t where t.base_id = v_base.id;
  delete from public.raw_submission s where s.base_id = v_base.id;
  delete from public.raw_submission s
   using public.patient p
   where s.target_patient_id = p.id and p.base_id = v_base.id;
  delete from public.patient_identity i where i.base_id = v_base.id;
  delete from public.patient p where p.base_id = v_base.id;

  delete from public.import_row_hash h where h.base_id = v_base.id;
  delete from public.import_batch b where b.base_id = v_base.id;
  delete from public.mission_credential_operation o where o.base_id = v_base.id;
  delete from public.mission_account_credential c where c.base_id = v_base.id;
  delete from public.quarantine_move_log q where q.base_id = v_base.id;
  delete from public.field_change_log f where f.base_id = v_base.id;
  delete from public.cohort c where c.base_id = v_base.id;
  delete from public.base_access a where a.base_id = v_base.id;
  delete from public.base_invitation i where i.base_id = v_base.id;
  delete from public.research_group_base g where g.base_id = v_base.id;
  delete from public.upload_ticket t where t.base_id = v_base.id;

  delete from public.base where id = v_base.id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'D10_BASE_DELETE_INCOMPLETE' using errcode = 'P0001';
  end if;

  update public.base_purge_operation o
     set status = 'completed', completed_at = now(), base_id = null
   where o.operation_id = p_operation_id;

  status := 'completed'; code := 'PURGED'; operation_id := p_operation_id; base_id := v_base.id;
  return next;
end
$$;

revoke all on function public.finalize_base_purge(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_base_purge(uuid, text, uuid) to service_role, postgres;
