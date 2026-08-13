-- Suppression reelle d'une cohorte sans effacer ses exports historiques.
-- Le journal devient autonome : base et nom de cohorte sont figes a l'export,
-- puis cohort_id est detache lors de la suppression.

alter table public.export_log
  add column base_id uuid references public.base(id) on delete restrict,
  add column cohort_name text;

update public.export_log e
   set base_id = c.base_id,
       cohort_name = c.name
  from public.cohort c
 where c.id = e.cohort_id;

alter table public.export_log
  alter column base_id set not null,
  alter column cohort_name set not null,
  alter column cohort_id drop not null;

alter table public.export_log
  drop constraint if exists export_log_cohort_id_fkey,
  add constraint export_log_cohort_id_fkey
    foreign key (cohort_id) references public.cohort(id) on delete set null;

create index if not exists ix_export_log_base_id on public.export_log(base_id);

-- Aucun DELETE direct : la RPC verrouille la cohorte, autorise le curateur cote
-- serveur et ecrit la trace de suppression dans la meme transaction.
drop policy if exists c_delete on public.cohort;

create or replace function public.delete_cohort(p_cohort_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cohort public.cohort;
  v_export_count integer;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into v_cohort
   from public.cohort
   where id = p_cohort_id
   for update;
  -- Rejeu apres une reponse perdue : l'etat deja atteint est un succes, sans
  -- seconde trace d'audit ni effet de bord.
  if not found then return; end if;
  if not public.can_curate(v_cohort.base_id) then raise exception 'Acces refuse'; end if;

  select count(*)::integer into v_export_count
    from public.export_log
   where cohort_id = v_cohort.id;

  delete from public.cohort where id = v_cohort.id;

  perform public.log_audit(
    'cohort_deleted', 'cohort', v_cohort.id, v_cohort.base_id,
    jsonb_build_object('cohort_name', v_cohort.name, 'preserved_export_count', v_export_count)
  );
end $$;

revoke all on function public.delete_cohort(uuid) from public, anon;
grant execute on function public.delete_cohort(uuid) to authenticated;

drop policy if exists el_select on public.export_log;
create policy el_select on public.export_log
  for select to authenticated using (public.can_export_data(base_id));

create or replace function public.trg_audit_export_fn()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (coalesce(auth.uid(), new.exported_by), 'export_created', 'export_log', new.id, new.base_id,
    jsonb_build_object('cohort_id', new.cohort_id, 'cohort_name', new.cohort_name,
                       'format', new.format, 'patient_count', new.patient_count,
                       'encounter_count', new.encounter_count));
  return new;
end $$;

-- Les helpers historiques d'audit et de controle de ticket doivent eux aussi
-- continuer a resoudre la base sans dependre d'une cohorte encore presente.
create or replace function public.log_export_read(p_export_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base uuid;
begin
  if auth.uid() is null then return; end if;
  select base_id into v_base from public.export_log where id = p_export_id;
  if v_base is null or not public.can_export_data(v_base) then return; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'export_read', 'export', p_export_id, v_base, '{}'::jsonb);
end $$;

create or replace function public.guard_upload_ticket_attachment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bucket text;
  v_path text;
  v_old_path text;
  v_base uuid;
  v_ticket public.upload_ticket%rowtype;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'clinical_attachment' then
    v_bucket := 'clinical-attachments'; v_path := new.storage_path;
    v_old_path := case when tg_op = 'UPDATE' then old.storage_path else null end;
    v_base := public.base_of_patient(new.patient_id);
  elsif tg_table_name = 'raw_document' then
    v_bucket := 'raw-documents'; v_path := new.storage_path;
    v_old_path := case when tg_op = 'UPDATE' then old.storage_path else null end;
    v_base := new.base_id;
  elsif tg_table_name = 'export_log' then
    v_bucket := 'scientific-exports'; v_path := new.stored_file_path;
    v_old_path := case when tg_op = 'UPDATE' then old.stored_file_path else null end;
    v_base := new.base_id;
  else return new;
  end if;
  if v_path is null then return new; end if;
  if tg_op = 'UPDATE' and v_path is not distinct from v_old_path then return new; end if;
  perform public.assert_upload_path_scope(v_base, v_bucket, v_path);
  select * into v_ticket from public.upload_ticket
   where bucket = v_bucket and path = v_path
   for update;
  if v_ticket.id is null
     or v_ticket.owner_user_id is distinct from auth.uid()
     or v_ticket.base_id is distinct from v_base
     or v_ticket.status <> 'pending'
     or v_ticket.expires_at <= now() then
    raise exception 'Ticket d upload invalide ou expire';
  end if;
  update public.upload_ticket
     set status = 'attached', attached_at = now(), last_error = null
   where id = v_ticket.id;
  return new;
end $$;
