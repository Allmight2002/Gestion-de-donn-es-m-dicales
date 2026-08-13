-- L11 -- Journal d'incidents web, volontairement separe des donnees metier.
-- Le contenu entrant est reduit deux fois (client puis serveur) : ne jamais y stocker
-- de valeur de formulaire, d'identifiant, de secret ou de message d'erreur brut.

create table public.client_error_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  last_occurred_at timestamptz not null,
  user_id uuid null references public.profiles(id) on delete set null,
  error_name text not null check (length(error_name) between 1 and 80),
  error_message text not null check (length(error_message) between 1 and 160),
  stack text null check (length(stack) <= 3000),
  component_stack text null check (length(component_stack) <= 1600),
  context text not null check (context in ('react-render', 'unhandled-rejection', 'window-error', 'data-save', 'import', 'upload', 'export', 'auth')),
  app_version text null check (length(app_version) <= 120),
  severity text not null check (severity in ('error', 'fatal')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  occurrence_count integer not null default 1 check (occurrence_count between 1 and 1000000),
  source text not null default 'web' check (source = 'web'),
  notified_at timestamptz null
);

create index client_error_log_fingerprint_received_idx on public.client_error_log (fingerprint, received_at desc);
create index client_error_log_received_idx on public.client_error_log (received_at desc);

alter table public.client_error_log enable row level security;
create policy client_error_log_select_system_admin on public.client_error_log
  for select to authenticated using (public.is_system_admin());

-- Helper interne, non executable via Data API. Il remplace tout contenu libre connu
-- et impose une taille : il constitue une seconde barriere si un ancien navigateur appelle
-- directement la RPC avec un payload non minimise.
create function public.scrub_client_error_text(p_value text, p_max_length integer)
returns text
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
declare v_value text := coalesce(p_value, '');
begin
  v_value := regexp_replace(v_value, '[^[:space:]@]+@[^[:space:]@]+', '[redacted-email]', 'g');
  v_value := regexp_replace(v_value, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[redacted-id]', 'gi');
  v_value := regexp_replace(v_value, '[0-9]{6,}', '[redacted-number]', 'g');
  v_value := regexp_replace(v_value, '(?i)bearer[[:space:]]+[A-Za-z0-9._-]+', 'Bearer [redacted-token]', 'g');
  v_value := regexp_replace(v_value, $re$["'][^"']*["']$re$, '[redacted-text]', 'g');
  v_value := regexp_replace(v_value, '[?][^[:space:])]+', '?[redacted-query]', 'g');
  return left(v_value, greatest(1, least(coalesce(p_max_length, 160), 3000)));
end;
$$;
revoke all on function public.scrub_client_error_text(text, integer) from public, anon, authenticated;

create function public.record_client_error(
  p_occurred_at timestamptz,
  p_name text,
  p_message text,
  p_stack text,
  p_component_stack text,
  p_context text,
  p_app_version text,
  p_severity text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_occurred_at timestamptz;
  v_name text;
  v_message text;
  v_stack text;
  v_component_stack text;
  v_fingerprint text;
  v_recent_count integer;
begin
  if v_uid is null then raise exception 'Authentification requise'; end if;
  if p_context not in ('react-render', 'unhandled-rejection', 'window-error', 'data-save', 'import', 'upload', 'export', 'auth') then
    raise exception 'Contexte incident invalide';
  end if;
  if p_severity not in ('error', 'fatal') then raise exception 'Severite incident invalide'; end if;
  if p_occurred_at is null or p_occurred_at < now() - interval '1 day' or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'Horodatage incident invalide';
  end if;

  -- Serialise uniquement le plafond par compte, jamais les ecritures de tous les comptes.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select coalesce(sum(occurrence_count), 0)::integer into v_recent_count
    from public.client_error_log where user_id = v_uid and last_occurred_at > now() - interval '1 minute';
  if v_recent_count >= 10 then return; end if;

  v_name := left(case when coalesce(p_name, '') ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$' then p_name else 'ClientError' end, 80);
  v_message := 'Erreur technique cote client'; -- jamais le message brut, meme apres scrubbing.
  v_stack := nullif(public.scrub_client_error_text(p_stack, 3000), '');
  v_component_stack := nullif(public.scrub_client_error_text(p_component_stack, 1600), '');
  v_occurred_at := p_occurred_at;
  v_fingerprint := encode(digest(v_name || '|' || p_context || '|' || coalesce(v_stack, ''), 'sha256'), 'hex');

  update public.client_error_log
     set occurrence_count = occurrence_count + 1,
         last_occurred_at = v_occurred_at,
         received_at = now(),
         severity = case when severity = 'fatal' or p_severity = 'fatal' then 'fatal' else 'error' end
   where user_id = v_uid and fingerprint = v_fingerprint and last_occurred_at > now() - interval '1 minute';
  if found then return; end if;

  insert into public.client_error_log (
    occurred_at, last_occurred_at, user_id, error_name, error_message, stack, component_stack,
    context, app_version, severity, fingerprint
  ) values (
    v_occurred_at, v_occurred_at, v_uid, v_name, v_message, v_stack, v_component_stack,
    p_context, nullif(public.scrub_client_error_text(p_app_version, 120), ''), p_severity, v_fingerprint
  );
end $$;

create function public.list_recent_client_errors(
  p_limit integer default 50,
  p_since timestamptz default null,
  p_context text default null
) returns table (
  id uuid, occurred_at timestamptz, last_occurred_at timestamptz, received_at timestamptz,
  error_name text, error_message text, stack text, component_stack text, context text,
  app_version text, severity text, fingerprint text, occurrence_count integer
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_system_admin() then raise exception 'Reserve a l administrateur systeme'; end if;
  if p_context is not null and p_context not in ('react-render', 'unhandled-rejection', 'window-error', 'data-save', 'import', 'upload', 'export', 'auth') then
    raise exception 'Contexte incident invalide';
  end if;
  return query
    select e.id, e.occurred_at, e.last_occurred_at, e.received_at, e.error_name, e.error_message,
      e.stack, e.component_stack, e.context, e.app_version, e.severity, e.fingerprint, e.occurrence_count
    from public.client_error_log e
    where e.received_at >= greatest(coalesce(p_since, now() - interval '24 hours'), now() - interval '30 days')
      and (p_context is null or e.context = p_context)
    order by e.last_occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100));
end $$;

-- Retention 30 jours : l'orchestrateur B5 devra appeler cette fonction quotidiennement.
-- Elle est volontairement reservee au role de service, sans acces depuis le navigateur.
create function public.purge_client_error_log()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  if current_user not in ('postgres', 'service_role') then raise exception 'Purge reservee au service'; end if;
  delete from public.client_error_log where received_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.record_client_error(timestamptz,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.record_client_error(timestamptz,text,text,text,text,text,text,text) to authenticated;
revoke all on function public.list_recent_client_errors(integer,timestamptz,text) from public, anon;
grant execute on function public.list_recent_client_errors(integer,timestamptz,text) to authenticated;
revoke all on function public.purge_client_error_log() from public, anon, authenticated;
