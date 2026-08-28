-- The business workflow and finalize_curation_task consume one current draft
-- per task. Preserve historical duplicates, supersede older rows, and enforce
-- uniqueness only for the current row.

alter table public.curation_draft
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid references public.curation_draft(id) on delete set null;

-- The historical cleanup is server-owned. Disable user triggers only for this
-- bounded backfill so finalized duplicates can be preserved and updated_at is
-- not rewritten by set_updated_at; all triggers are restored immediately.
alter table public.curation_draft disable trigger user;
with ranked as (
  select id, task_id,
         first_value(id) over (
           partition by task_id
           order by updated_at desc, created_at desc, id desc
         ) as keeper,
         row_number() over (
           partition by task_id
           order by updated_at desc, created_at desc, id desc
         ) as rn
    from public.curation_draft
   where superseded_at is null
)
update public.curation_draft d
   set superseded_at = now(), superseded_by = r.keeper
  from ranked r
 where d.id = r.id and r.rn > 1;
alter table public.curation_draft enable trigger user;

create unique index if not exists ux_curation_draft_one_current_per_task
  on public.curation_draft(task_id) where superseded_at is null;

create or replace function public.guard_curation_draft_supersession()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null
     and (new.superseded_at is not null or new.superseded_by is not null) then
    raise exception 'Supersession de brouillon reservee au serveur';
  end if;
  if tg_op = 'UPDATE' and old.superseded_at is not null then
    raise exception 'Brouillon historique non modifiable';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null
     and (new.superseded_at is distinct from old.superseded_at
          or new.superseded_by is distinct from old.superseded_by) then
    raise exception 'Supersession de brouillon reservee au serveur';
  end if;
  return new;
end $$;
revoke all on function public.guard_curation_draft_supersession() from public, anon, authenticated;
create trigger trg_curation_draft_supersession
  before insert or update on public.curation_draft
  for each row execute function public.guard_curation_draft_supersession();

create or replace function public.ensure_curation_draft(p_task_id uuid, p_base_id uuid)
returns public.curation_draft
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_draft public.curation_draft;
begin
  perform pg_advisory_xact_lock(hashtextextended('curation-draft:' || p_task_id::text, 0));
  select * into v_draft from public.curation_draft
   where task_id = p_task_id and superseded_at is null for update;
  if not found then
    insert into public.curation_draft(task_id, base_id, created_by)
    values (p_task_id, p_base_id, auth.uid()) returning * into v_draft;
  end if;
  return v_draft;
end $$;
revoke all on function public.ensure_curation_draft(uuid, uuid) from public, anon;
grant execute on function public.ensure_curation_draft(uuid, uuid) to authenticated;

-- The business transaction must never consume a superseded historical row,
-- even if its legacy updated_at is newer than the active draft.
create or replace function public.finalize_curation_task(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.curation_task;
  d public.curation_draft;
  s public.raw_submission;
  v_pat public.patient;
  v_base uuid;
  v_dob date;
  k text;
  v_old jsonb;
  v_new jsonb;
  enc jsonb;
  v_age numeric;
  v_unit text;
  v_tv uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into t from public.curation_task
   where id=p_task_id and deleted_at is null for update;
  if not found then raise exception 'Cas introuvable'; end if;
  v_base := t.base_id;
  if not (public.is_assigned_curator(t.id) or public.is_base_owner(v_base)) then
    raise exception 'Reserve au curateur affecte (ou au proprietaire)';
  end if;
  if t.status <> 'in_progress' then
    raise exception 'Le cas doit etre en cours (statut=%)', t.status;
  end if;

  select * into d from public.curation_draft
   where task_id=t.id and superseded_at is null
   order by updated_at desc, id desc limit 1 for update;
  if not found then raise exception 'Aucun brouillon actif a finaliser'; end if;

  select * into s from public.raw_submission where id=t.submission_id for update;
  select * into v_pat from public.patient where id=s.target_patient_id for update;
  if not found then raise exception 'Patient cible introuvable'; end if;
  v_tv := coalesce(s.template_version_id, v_pat.template_version_id);
  select date_of_birth into v_dob from public.patient_identity
   where base_id=v_base and patient_code=v_pat.patient_code and deleted_at is null;

  perform public.assert_data_valid(v_tv, 'patient', d.patient_data);
  if d.patient_data <> '{}'::jsonb then
    perform public.assert_required_complete(v_tv, 'patient', v_pat.data || d.patient_data);
    for k in select jsonb_object_keys(d.patient_data) loop
      v_old := v_pat.data -> k;
      v_new := d.patient_data -> k;
      if v_old is distinct from v_new then
        insert into public.field_change_log(
          entity,entity_id,base_id,field_key,old_value,new_value,reason,changed_by,source
        ) values (
          'patient',v_pat.id,v_base,k,v_old,v_new,'Finalisation curation',auth.uid(),'curation_finalization'
        );
      end if;
    end loop;
    update public.patient set
      data=data || d.patient_data, validation_status='curated',
      collection_mode='assisted', updated_at=now()
     where id=v_pat.id;
  else
    update public.patient set updated_at=now() where id=v_pat.id;
  end if;

  for enc in select * from jsonb_array_elements(d.encounters) loop
    perform public.assert_data_valid(v_tv, 'encounter', coalesce(enc->'data','{}'::jsonb));
    perform public.assert_required_complete(
      v_tv,'encounter',coalesce(enc->'data','{}'::jsonb),coalesce(enc->>'encounter_type','autre')
    );
    v_unit := coalesce(enc->>'age_unit','years');
    v_age := case
      when v_dob is not null and enc->>'encounter_date' is not null
      then public.compute_age(v_dob,(enc->>'encounter_date')::date,v_unit)
      else null
    end;
    insert into public.encounter(
      patient_id,template_version_id,encounter_type,encounter_date,
      age_value,age_unit,data,collection_mode,validation_status,created_by
    ) values (
      v_pat.id,v_tv,coalesce(enc->>'encounter_type','autre'),
      (enc->>'encounter_date')::date,v_age,v_unit,
      coalesce(enc->'data','{}'::jsonb)-'age_at_encounter',
      'assisted','curated',auth.uid()
    );
  end loop;

  update public.curation_draft set status='finalized',updated_at=now() where id=d.id;
  update public.curation_task set status='completed',updated_at=now()
   where id=t.id returning * into t;
  update public.raw_submission set status='completed' where id=s.id;
  insert into public.audit_log(user_id,action,entity,entity_id,base_id,metadata)
  values(auth.uid(),'curation_finalized','curation_task',t.id,v_base,
    jsonb_build_object('submission_id',s.id,'patient_id',v_pat.id,'draft_id',d.id));
  return t;
end $$;
revoke all on function public.finalize_curation_task(uuid) from public, anon;
grant execute on function public.finalize_curation_task(uuid) to authenticated;
