-- =============================================================================
-- 20260616098000_upload_tickets.sql
-- P1 audit: tie orphan Storage cleanup to a short-lived upload ticket owned by
-- the uploader. Business rows consume the ticket in SQL before they can point to
-- the uploaded object; cleanup-upload can only remove a still-pending ticket.
-- =============================================================================

create table if not exists public.upload_ticket (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.profiles(id) on delete cascade,
  base_id        uuid not null references public.base(id) on delete cascade,
  bucket         text not null check (bucket in ('clinical-attachments','raw-documents','scientific-exports')),
  path           text not null,
  status         text not null default 'pending' check (status in ('pending','attached','cleaning','cleaned','expired')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 minutes'),
  attached_at    timestamptz,
  cleaned_at     timestamptz,
  last_error     text,
  unique (bucket, path)
);

create index if not exists ix_upload_ticket_owner_status
  on public.upload_ticket (owner_user_id, status, expires_at);
create index if not exists ix_upload_ticket_base_status
  on public.upload_ticket (base_id, status, expires_at);

alter table public.upload_ticket enable row level security;

drop policy if exists upload_ticket_select_own on public.upload_ticket;
create policy upload_ticket_select_own on public.upload_ticket for select to authenticated
  using (owner_user_id = auth.uid());

grant select on public.upload_ticket to authenticated;

create or replace function public.assert_upload_path_scope(p_base_id uuid, p_bucket text, p_path text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_base_id is null then
    raise exception 'Base requise pour le ticket d upload';
  end if;
  if p_bucket not in ('clinical-attachments','raw-documents','scientific-exports') then
    raise exception 'Bucket upload invalide';
  end if;
  if p_path is null
     or length(p_path) < 38
     or length(p_path) > 600
     or p_path like '/%'
     or p_path like '%//%'
     or p_path like '%..%' then
    raise exception 'Chemin upload invalide';
  end if;
  if p_path not like (p_base_id::text || '/%') then
    raise exception 'Chemin upload hors du prefixe de la base';
  end if;
end $$;
revoke all on function public.assert_upload_path_scope(uuid, text, text) from public, anon, authenticated;

create or replace function public.upload_ticket_authorized(p_base_id uuid, p_bucket text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_bucket
    when 'clinical-attachments' then public.can_write_identity(p_base_id)
    when 'raw-documents' then public.is_base_owner(p_base_id)
    when 'scientific-exports' then public.can_export_data(p_base_id)
    else false
  end
$$;
revoke all on function public.upload_ticket_authorized(uuid, text) from public, anon, authenticated;

create or replace function public.create_upload_ticket(
  p_base_id uuid,
  p_bucket text,
  p_path text,
  p_ttl_seconds int default 1800
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ticket uuid;
  v_ttl int;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  perform public.assert_upload_path_scope(p_base_id, p_bucket, p_path);
  if not public.upload_ticket_authorized(p_base_id, p_bucket) then
    raise exception 'Acces upload refuse';
  end if;

  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 1800), 3600));

  insert into public.upload_ticket(owner_user_id, base_id, bucket, path, expires_at)
  values (auth.uid(), p_base_id, p_bucket, p_path, now() + make_interval(secs => v_ttl))
  returning id into v_ticket;

  return v_ticket;
end $$;
revoke all on function public.create_upload_ticket(uuid, text, text, int) from public, anon;
grant execute on function public.create_upload_ticket(uuid, text, text, int) to authenticated;

create or replace function public.has_pending_upload_ticket(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.upload_ticket t
     where t.owner_user_id = auth.uid()
       and t.bucket = p_bucket
       and t.path = p_path
       and t.status = 'pending'
       and t.expires_at > now()
  )
$$;
revoke all on function public.has_pending_upload_ticket(text, text) from public, anon;
grant execute on function public.has_pending_upload_ticket(text, text) to authenticated;

create or replace function public.guard_upload_ticket_attachment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bucket text;
  v_path text;
  v_old_path text;
  v_base uuid;
  v_ticket public.upload_ticket%rowtype;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'clinical_attachment' then
    v_bucket := 'clinical-attachments';
    v_path := new.storage_path;
    v_old_path := case when tg_op = 'UPDATE' then old.storage_path else null end;
    v_base := public.base_of_patient(new.patient_id);
  elsif tg_table_name = 'raw_document' then
    v_bucket := 'raw-documents';
    v_path := new.storage_path;
    v_old_path := case when tg_op = 'UPDATE' then old.storage_path else null end;
    v_base := new.base_id;
  elsif tg_table_name = 'export_log' then
    v_bucket := 'scientific-exports';
    v_path := new.stored_file_path;
    v_old_path := case when tg_op = 'UPDATE' then old.stored_file_path else null end;
    v_base := public.base_of_cohort(new.cohort_id);
  else
    return new;
  end if;

  if v_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_path is not distinct from v_old_path then
    return new;
  end if;

  perform public.assert_upload_path_scope(v_base, v_bucket, v_path);

  select *
    into v_ticket
    from public.upload_ticket
   where bucket = v_bucket
     and path = v_path
   for update;

  if v_ticket.id is null
     or v_ticket.owner_user_id is distinct from auth.uid()
     or v_ticket.base_id is distinct from v_base
     or v_ticket.status <> 'pending'
     or v_ticket.expires_at <= now() then
    raise exception 'Ticket d upload invalide ou expire';
  end if;

  update public.upload_ticket
     set status = 'attached',
         attached_at = now(),
         last_error = null
   where id = v_ticket.id;

  return new;
end $$;
revoke all on function public.guard_upload_ticket_attachment() from public, anon, authenticated;

drop trigger if exists trg_clinical_attachment_upload_ticket on public.clinical_attachment;
create trigger trg_clinical_attachment_upload_ticket
  before insert or update of storage_path on public.clinical_attachment
  for each row execute function public.guard_upload_ticket_attachment();

drop trigger if exists trg_raw_document_upload_ticket on public.raw_document;
create trigger trg_raw_document_upload_ticket
  before insert or update of storage_path on public.raw_document
  for each row execute function public.guard_upload_ticket_attachment();

drop trigger if exists trg_export_log_upload_ticket on public.export_log;
create trigger trg_export_log_upload_ticket
  before insert or update of stored_file_path on public.export_log
  for each row execute function public.guard_upload_ticket_attachment();
