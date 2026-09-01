-- =============================================================================
-- 20260616097600_strict_inspection_policy.sql
-- Mode clinique strict : `accepted_client` reste utile pour le pilote fictif, mais
-- ne doit pas permettre d'envoyer un cas de curation au staff quand l'inspection
-- serveur est requise.
--
-- Activation cloud, via SQL Editor/service_role :
--   update public.app_security_setting
--      set value = 'true', updated_at = now()
--    where key = 'require_server_inspection';
-- =============================================================================

create table if not exists public.app_security_setting (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  check (key in ('require_server_inspection')),
  check (value in ('true', 'false'))
);

alter table public.app_security_setting enable row level security;
revoke all on public.app_security_setting from anon, authenticated, public;

insert into public.app_security_setting(key, value)
values ('require_server_inspection', 'false')
on conflict (key) do nothing;

create or replace function public.require_server_inspection()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select value = 'true'
       from public.app_security_setting
      where key = 'require_server_inspection'),
    false
  );
$$;

grant execute on function public.require_server_inspection() to authenticated;

create or replace function public.submit_curation_request(p_task_id uuid)
returns public.curation_task
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t      public.curation_task;
  v_task public.curation_task;
  v_docs int;
  v_blocked_docs int;
  v_require_server_inspection boolean;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into t from public.curation_task where id = p_task_id for update;
  if not found then raise exception 'Cas introuvable'; end if;
  if not public.is_base_owner(t.base_id) then raise exception 'Reserve au proprietaire de la base'; end if;
  if t.status <> 'preparing' then raise exception 'La demande est deja envoyee (statut=%)', t.status; end if;

  v_require_server_inspection := public.require_server_inspection();

  select count(*) into v_docs
    from public.raw_document
   where submission_id = t.submission_id
     and deleted_at is null;
  if v_docs = 0 then raise exception 'Au moins un document est requis avant de soumettre au staff'; end if;

  select count(*) into v_blocked_docs
    from public.raw_document
   where submission_id = t.submission_id
     and deleted_at is null
     and (
       (v_require_server_inspection and inspection_status <> 'accepted')
       or (not v_require_server_inspection and inspection_status not in ('accepted', 'accepted_client'))
     );
  if v_blocked_docs > 0 then
    raise exception 'Tous les documents doivent etre acceptes par inspection serveur avant soumission au staff';
  end if;

  update public.curation_task  set status = 'open', updated_at = now() where id = p_task_id returning * into v_task;
  update public.raw_submission set status = 'in_curation' where id = t.submission_id;
  return v_task;
end $$;

grant execute on function public.submit_curation_request(uuid) to authenticated;
