-- =============================================================================
-- 20260616098400_quarantine_reconciliation.sql
-- Audit v20 §7.2 : le deplacement Storage -> quarantaine puis la finalisation SQL
-- ne peuvent pas etre atomiques entre Storage et PostgreSQL. On rend donc chaque
-- mouvement durable et reconciliable : inspect-upload journalise les etapes, puis
-- une Edge Function d'operation peut reprendre les mouvements incomplets.
-- =============================================================================

create table if not exists public.quarantine_move_log (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('clinical_attachment', 'raw_document')),
  entity_id uuid not null,
  base_id uuid not null references public.base(id) on delete cascade,
  run_id uuid not null,
  inspected_by uuid references public.profiles(id),
  source_bucket text not null check (source_bucket in ('clinical-attachments', 'raw-documents')),
  source_path text not null,
  quarantine_bucket text not null default 'quarantined-uploads'
    check (quarantine_bucket = 'quarantined-uploads'),
  quarantine_path text not null,
  status text not null default 'started'
    check (status in (
      'started',
      'copied',
      'original_deleted',
      'finalized',
      'restored',
      'reconcile_failed'
    )),
  engine text not null,
  signature text,
  file_hash text not null,
  file_size bigint not null check (file_size > 0),
  detected_mime_type text,
  mime_type text,
  extra jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (entity, entity_id, run_id)
);

create index if not exists ix_quarantine_move_log_status
  on public.quarantine_move_log (status, updated_at);
create index if not exists ix_quarantine_move_log_entity
  on public.quarantine_move_log (entity, entity_id, run_id);

alter table public.quarantine_move_log enable row level security;

create or replace function public.record_quarantine_move(
  p_entity text,
  p_entity_id uuid,
  p_run_id uuid,
  p_user_id uuid,
  p_base_id uuid,
  p_source_bucket text,
  p_source_path text,
  p_quarantine_bucket text,
  p_quarantine_path text,
  p_engine text,
  p_signature text,
  p_file_hash text,
  p_file_size bigint,
  p_detected_mime_type text,
  p_mime_type text,
  p_extra jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_entity not in ('clinical_attachment', 'raw_document') then
    raise exception 'Entite quarantaine invalide';
  end if;
  if p_source_bucket not in ('clinical-attachments', 'raw-documents') then
    raise exception 'Bucket source invalide';
  end if;
  if p_quarantine_bucket <> 'quarantined-uploads' then
    raise exception 'Bucket de quarantaine invalide';
  end if;
  if p_base_id is null or p_run_id is null or p_entity_id is null then
    raise exception 'Mouvement de quarantaine incomplet';
  end if;
  if p_file_hash is null or p_file_size is null or p_file_size <= 0
     or p_engine is null or btrim(p_engine) = '' then
    raise exception 'Trace forensique de quarantaine incomplete';
  end if;
  if p_source_path is null or p_source_path not like (p_base_id::text || '/%')
     or p_quarantine_path is null or p_quarantine_path not like (p_base_id::text || '/%') then
    raise exception 'Chemin de quarantaine hors base';
  end if;

  insert into public.quarantine_move_log(
    entity, entity_id, base_id, run_id, inspected_by,
    source_bucket, source_path, quarantine_bucket, quarantine_path,
    engine, signature, file_hash, file_size, detected_mime_type, mime_type, extra
  )
  values (
    p_entity, p_entity_id, p_base_id, p_run_id, p_user_id,
    p_source_bucket, p_source_path, p_quarantine_bucket, p_quarantine_path,
    p_engine, p_signature, p_file_hash, p_file_size, p_detected_mime_type, p_mime_type,
    coalesce(p_extra, '{}'::jsonb)
  )
  on conflict (entity, entity_id, run_id) do update
     set inspected_by = excluded.inspected_by,
         source_bucket = excluded.source_bucket,
         source_path = excluded.source_path,
         quarantine_bucket = excluded.quarantine_bucket,
         quarantine_path = excluded.quarantine_path,
         engine = excluded.engine,
         signature = excluded.signature,
         file_hash = excluded.file_hash,
         file_size = excluded.file_size,
         detected_mime_type = excluded.detected_mime_type,
         mime_type = excluded.mime_type,
         extra = excluded.extra,
         status = case
           when public.quarantine_move_log.status in ('finalized', 'restored') then public.quarantine_move_log.status
           else 'started'
         end,
         last_error = null,
         updated_at = now()
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.update_quarantine_move(
  p_move_id uuid,
  p_status text,
  p_last_error text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('started','copied','original_deleted','finalized','restored','reconcile_failed') then
    raise exception 'Statut de mouvement invalide';
  end if;

  update public.quarantine_move_log
     set status = p_status,
         last_error = p_last_error,
         updated_at = now(),
         finalized_at = case when p_status in ('finalized','restored') then now() else finalized_at end
   where id = p_move_id;

  if not found then
    raise exception 'Mouvement de quarantaine introuvable';
  end if;
end $$;

create or replace function public.quarantine_reconciliation_candidates(p_limit int default 50)
returns setof public.quarantine_move_log
language sql security definer set search_path = public, pg_temp as $$
  select *
    from public.quarantine_move_log
   where status in ('copied', 'original_deleted', 'reconcile_failed')
      or (status = 'started' and updated_at < now() - interval '5 minutes')
   order by updated_at asc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on table public.quarantine_move_log from public, anon, authenticated;
revoke all on function public.record_quarantine_move(
  text, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, bigint, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_quarantine_move(uuid, text, text) from public, anon, authenticated;
revoke all on function public.quarantine_reconciliation_candidates(int) from public, anon, authenticated;

grant execute on function public.record_quarantine_move(
  text, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, bigint, text, text, jsonb
) to service_role, postgres;
grant execute on function public.update_quarantine_move(uuid, text, text) to service_role, postgres;
grant execute on function public.quarantine_reconciliation_candidates(int) to service_role, postgres;
