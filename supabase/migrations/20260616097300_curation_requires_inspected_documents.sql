-- =============================================================================
-- 20260616097300_curation_requires_inspected_documents.sql
-- Audit v16 P1: une demande de curation ne doit pas etre envoyee au staff si ses
-- documents ne sont pas lisibles via signed-read (pending/scanning/quarantined).
-- =============================================================================

create or replace function public.submit_curation_request(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t      public.curation_task;
  v_task public.curation_task;
  v_docs int;
  v_blocked_docs int;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into t from public.curation_task where id = p_task_id for update;
  if not found then raise exception 'Cas introuvable'; end if;
  if not public.is_base_owner(t.base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if t.status <> 'preparing' then raise exception 'La demande est deja envoyee (statut=%)', t.status; end if;

  select count(*) into v_docs
    from public.raw_document
   where submission_id = t.submission_id
     and deleted_at is null;
  if v_docs = 0 then raise exception 'Au moins un document est requis avant de soumettre au staff'; end if;

  select count(*) into v_blocked_docs
    from public.raw_document
   where submission_id = t.submission_id
     and deleted_at is null
     and inspection_status not in ('accepted', 'accepted_client');
  if v_blocked_docs > 0 then
    raise exception 'Tous les documents doivent etre acceptes par inspection avant soumission au staff';
  end if;

  update public.curation_task  set status = 'open', updated_at = now() where id = p_task_id returning * into v_task;
  update public.raw_submission set status = 'in_curation' where id = t.submission_id;
  return v_task;
end $$;

grant execute on function public.submit_curation_request(uuid) to authenticated;
