-- =============================================================================
-- 20260616096400_remaining_p0_p1_guards.sql
-- Audit v14: close the remaining DB-enforceable P0/P1 gaps before the larger
-- server-side document inspection/export pipeline.
-- =============================================================================

-- 1) Internal permission helpers are implementation details, not public RPCs.
revoke execute on function public.assert_access_change_allowed(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean
) from public, anon, authenticated;
revoke execute on function public.invitation_permissions_still_valid(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean
) from public, anon, authenticated;

-- 2) Identity audit is sensitive: keep it owner-only until a dedicated audit
-- permission exists.
create or replace function public.base_identity_audit(p_base_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.is_base_owner(p_base_id) then
    raise exception 'Acces refuse';
  end if;

  select jsonb_build_object(
    'byReader', coalesce((
      select jsonb_agg(jsonb_build_object(
        'readerName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(x.user_id::text, 8)),
        'count', x.n,
        'lastAt', x.last_at
      ) order by x.n desc)
      from (
        select user_id, count(*)::int as n, max(created_at) as last_at
        from public.audit_log
        where base_id = p_base_id and action = 'identity_read'
          and created_at > now() - interval '30 days'
        group by user_id
      ) x
      left join public.profiles pr on pr.id = x.user_id
    ), '[]'::jsonb),
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', a.created_at,
        'readerName', coalesce(nullif(pr.full_name, ''), 'Compte ' || left(a.user_id::text, 8)),
        'patientCode', p.patient_code
      ) order by a.created_at desc)
      from (
        select user_id, entity_id, created_at
        from public.audit_log
        where base_id = p_base_id and action = 'identity_read'
          and created_at > now() - interval '30 days'
        order by created_at desc
        limit 50
      ) a
      left join public.profiles pr on pr.id = a.user_id
      left join public.patient p on p.id = a.entity_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;
revoke all on function public.base_identity_audit(uuid) from public, anon, authenticated;
grant execute on function public.base_identity_audit(uuid) to authenticated;

-- 3) Documents: the authenticated actor never chooses the author. Service-role
-- and seed/migrations (auth.uid() is null) keep explicit fixture values.
create or replace function public.guard_document_created_by()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'created_by est une colonne serveur immuable';
  end if;
  return new;
end $$;
revoke all on function public.guard_document_created_by() from public, anon, authenticated;

drop trigger if exists trg_clinical_attachment_created_by on public.clinical_attachment;
create trigger trg_clinical_attachment_created_by
  before insert or update on public.clinical_attachment
  for each row execute function public.guard_document_created_by();

drop trigger if exists trg_raw_document_created_by on public.raw_document;
create trigger trg_raw_document_created_by
  before insert or update on public.raw_document
  for each row execute function public.guard_document_created_by();

-- 4) Import row idempotence: make the inter-batch row hash guarantee atomic.
delete from public.import_row_hash h
using (
  select ctid, row_number() over (partition by base_id, row_hash order by batch_id::text) as rn
  from public.import_row_hash
) d
where h.ctid = d.ctid and d.rn > 1;

create unique index if not exists uq_import_row_hash_base_row
  on public.import_row_hash (base_id, row_hash);

-- 5) Published/archived template versions are scientific records. Authenticated
-- users can only mutate draft versions; status transitions go through RPCs.
create or replace function public.template_version_locked(p_version_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.template_version tv
    where tv.id = p_version_id and tv.status in ('published', 'archived')
  )
$$;
revoke all on function public.template_version_locked(uuid) from public, anon, authenticated;

create table if not exists public.template_version_status_authorization (
  txid bigint not null,
  version_id uuid not null references public.template_version(id) on delete cascade,
  from_status text not null check (from_status in ('draft', 'published', 'archived')),
  to_status text not null check (to_status in ('draft', 'published', 'archived')),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (txid, version_id, from_status, to_status)
);
alter table public.template_version_status_authorization enable row level security;
revoke all on table public.template_version_status_authorization from public, anon, authenticated;

create or replace function public.guard_template_version_state()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_authorized boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.status <> 'draft' then
      raise exception 'Une nouvelle version doit etre creee en draft puis publiee par RPC';
    end if;
    return new;
  end if;

  if new.template_id is distinct from old.template_id
     or new.version_number is distinct from old.version_number
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Colonnes structurelles de template_version immuables';
  end if;

  if new.status is distinct from old.status then
    update public.template_version_status_authorization
       set used_at = now()
     where txid = txid_current()
       and version_id = old.id
       and from_status = old.status
       and to_status = new.status
       and used_at is null
     returning true into v_authorized;

    if not coalesce(v_authorized, false) then
      raise exception 'Transition de version reservee aux RPC publish/archive';
    end if;
  end if;

  if old.status = 'draft' then
    if new.status not in ('draft', 'published') then
      raise exception 'Transition de gabarit invalide';
    end if;
    if new.status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if old.status = 'published' then
    if new.status = 'archived'
       and new.template_id is not distinct from old.template_id
       and new.version_number is not distinct from old.version_number
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.published_at is not distinct from old.published_at then
      return new;
    end if;
    raise exception 'Version publiee immuable : creez une nouvelle version';
  end if;

  if old.status = 'archived' and new is distinct from old then
    raise exception 'Version archivee immuable';
  end if;

  return new;
end $$;
revoke all on function public.guard_template_version_state() from public, anon, authenticated;

drop trigger if exists trg_template_version_state on public.template_version;
create trigger trg_template_version_state
  before insert or update on public.template_version
  for each row execute function public.guard_template_version_state();

create or replace function public.guard_template_field_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  semantic boolean;
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du gabarit';
  end if;

  semantic := (new.field_key is distinct from old.field_key)
           or (new.type      is distinct from old.type)
           or (new.scope     is distinct from old.scope)
           or (new.required  is distinct from old.required)
           or (new.encounter_types is distinct from old.encounter_types)
           or (coalesce(new.allowed_values, 'null'::jsonb) is distinct from coalesce(old.allowed_values, 'null'::jsonb))
           or (new.min_value is distinct from old.min_value)
           or (new.max_value is distinct from old.max_value)
           or (new.allow_missing_codes is distinct from old.allow_missing_codes);
  if semantic and public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : seuls le libelle, la section et l''unite sont modifiables. Pour changer son comportement, creez une nouvelle version du gabarit.';
  end if;
  return new;
end $$;
revoke all on function public.guard_template_field_update() from public, anon, authenticated;

create or replace function public.guard_template_field_locked_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and public.template_version_locked(new.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du gabarit';
  end if;
  return new;
end $$;
revoke all on function public.guard_template_field_locked_insert() from public, anon, authenticated;

drop trigger if exists trg_tf_locked_insert on public.template_field;
create trigger trg_tf_locked_insert
  before insert on public.template_field
  for each row execute function public.guard_template_field_locked_insert();

create or replace function public.guard_template_field_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and public.template_version_locked(old.template_version_id) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du gabarit';
  end if;
  if public.template_field_in_use(old.id) then
    raise exception 'Variable deja utilisee : suppression impossible. Creez une nouvelle version du gabarit pour la retirer.';
  end if;
  return old;
end $$;
revoke all on function public.guard_template_field_delete() from public, anon, authenticated;

create or replace function public.guard_validation_rule_locked()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version uuid := coalesce(new.template_version_id, old.template_version_id);
begin
  if auth.uid() is not null and public.template_version_locked(v_version) then
    raise exception 'Version publiee/archivee immuable : creez une nouvelle version du gabarit';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_validation_rule_locked() from public, anon, authenticated;

drop trigger if exists trg_vr_locked on public.validation_rule;
create trigger trg_vr_locked
  before insert or update or delete on public.validation_rule
  for each row execute function public.guard_validation_rule_locked();

create or replace function public.publish_template_version(p_version_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then raise exception 'Modification du gabarit non autorisee'; end if;
  if v.status <> 'draft' then raise exception 'Seule une version draft peut etre publiee'; end if;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = coalesce(published_at, now())
   where id = p_version_id
   returning * into v;
  return v;
end $$;
revoke all on function public.publish_template_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_template_version(uuid) to authenticated;

create or replace function public.archive_template_version(p_version_id uuid)
returns public.template_version
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.template_version;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.template_version where id = p_version_id for update;
  if not found then raise exception 'Version introuvable'; end if;
  if not public.owns_template(v.template_id) then raise exception 'Modification du gabarit non autorisee'; end if;
  if v.status <> 'published' then raise exception 'Seule une version published peut etre archivee'; end if;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), p_version_id, 'published', 'archived')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'archived'
   where id = p_version_id
   returning * into v;
  return v;
end $$;
revoke all on function public.archive_template_version(uuid) from public, anon, authenticated;
grant execute on function public.archive_template_version(uuid) to authenticated;

create or replace function public.promote_template_to_global(p_template_id uuid)
returns public.template
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src       public.template;
  v_src_ver uuid;
  v_tpl     uuid;
  v_ver     uuid;
  result    public.template;
begin
  if not public.is_system_admin() then raise exception 'Reserve a l''administrateur systeme'; end if;
  select * into src from public.template where id = p_template_id;
  if not found then raise exception 'Gabarit introuvable'; end if;

  select id into v_src_ver from public.template_version
   where template_id = p_template_id order by version_number desc limit 1;

  insert into public.template (name, specialty, owner_user_id, is_global)
  values (src.name, src.specialty, null, true)
  returning id into v_tpl;

  insert into public.template_version (template_id, version_number, status, created_by)
  values (v_tpl, 1, 'draft', auth.uid())
  returning id into v_ver;

  insert into public.template_field
    (template_version_id, field_key, label, scope, section, type, unit, allowed_values,
     required, min_value, max_value, allow_missing_codes, display_order, encounter_types)
  select v_ver, field_key, label, scope, section, type, unit, allowed_values,
         required, min_value, max_value, allow_missing_codes, display_order, encounter_types
  from public.template_field where template_version_id = v_src_ver;

  insert into public.validation_rule (template_version_id, rule, message, severity)
  select v_ver, rule, message, severity
  from public.validation_rule where template_version_id = v_src_ver;

  delete from public.template_version_status_authorization
   where created_at < now() - interval '1 day';

  insert into public.template_version_status_authorization (txid, version_id, from_status, to_status)
  values (txid_current(), v_ver, 'draft', 'published')
  on conflict (txid, version_id, from_status, to_status)
  do update set used_at = null, created_at = now();

  update public.template_version
     set status = 'published', published_at = now()
   where id = v_ver;

  select * into result from public.template where id = v_tpl;
  return result;
end $$;
revoke all on function public.promote_template_to_global(uuid) from public, anon, authenticated;
grant execute on function public.promote_template_to_global(uuid) to authenticated;
