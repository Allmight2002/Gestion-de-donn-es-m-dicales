-- UX-2: private analytical work, never a clinical row or an identity store.
-- RPC-only writes allow a single transaction to consume a revision and write the record.
create table public.work_draft (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  base_id uuid not null references public.base(id) on delete cascade,
  kind text not null check (kind in ('patient_create', 'patient_update', 'encounter_create', 'encounter_update')),
  target_id uuid,
  template_version_id uuid not null references public.template_version(id),
  entity_revision text,
  revision bigint not null check (revision > 0),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  state text not null default 'active' check (state in ('active', 'consumed', 'deleted', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144)
);
create index work_draft_owner_context on public.work_draft(owner_id, base_id, kind, target_id)
  where state = 'active';
create index work_draft_expiry on public.work_draft(expires_at) where state = 'active';
alter table public.work_draft enable row level security;
revoke all on public.work_draft from public, anon, authenticated;

-- Receipts contain no answers or identity. Tombstones are deliberately retained so an old
-- expected_revision=0 request cannot recreate a consumed/deleted draft after a purge.
create table public.work_draft_operation (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  draft_id uuid not null references public.work_draft(id) on delete cascade,
  request_hash text not null,
  receipt jsonb not null,
  primary key (owner_id, operation_id)
);
alter table public.work_draft_operation enable row level security;
revoke all on public.work_draft_operation from public, anon, authenticated;

create function public.work_draft_error(p_code text) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = p_code,
    detail = jsonb_build_object('code', lower(p_code), 'action',
      case when p_code in ('DRAFT_CONFLICT', 'DRAFT_CONTEXT_CHANGED') then 'refresh_required' else 'resolve_required' end)::text;
end $$;
revoke all on function public.work_draft_error(text) from public, anon, authenticated;

-- The same current authorization predicate is used for read, save, delete and commit.
-- A base owner cannot read another author's work. Mission accounts may only correct
-- their own still-draft records, exactly as the existing clinical RPCs require.
create function public.work_draft_allowed(p_owner uuid, p_base uuid, p_kind text, p_target uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_pat public.patient; v_enc public.encounter;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()
     or not exists (select 1 from public.base where id = p_base and deleted_at is null)
     or not public.can_create_structured_data(p_base) then return false; end if;
  if p_kind = 'patient_create' then return p_target is null; end if;
  if p_kind in ('patient_update', 'encounter_create') then
    select * into v_pat from public.patient where id = p_target and base_id = p_base and deleted_at is null;
    if not found then return false; end if;
    if p_kind = 'encounter_create' then
      return exists (select 1 from public.base where id = p_base and observation_model <> 'cross_sectional');
    end if;
    return public.can_edit_structured_data(p_base)
      or (v_pat.created_by = auth.uid() and v_pat.validation_status = 'draft');
  end if;
  if p_kind = 'encounter_update' then
    select e.* into v_enc from public.encounter e join public.patient p on p.id = e.patient_id
      where e.id = p_target and p.base_id = p_base and e.deleted_at is null and p.deleted_at is null;
    return found and (public.can_edit_structured_data(p_base)
      or (v_enc.created_by = auth.uid() and v_enc.validation_status = 'draft'));
  end if;
  return false;
end $$;
revoke all on function public.work_draft_allowed(uuid, uuid, text, uuid) from public, anon, authenticated;

create function public.assert_work_draft_context(p_base uuid, p_kind text, p_target uuid, p_version uuid, p_entity_revision text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version uuid; v_revision text;
begin
  if p_kind in ('patient_create', 'encounter_create') then
    select current_template_version_id into v_version from public.base where id = p_base for share;
  elsif p_kind = 'patient_update' then
    select template_version_id, row_version::text into v_version, v_revision
      from public.patient where id = p_target and base_id = p_base and deleted_at is null for update;
  elsif p_kind = 'encounter_update' then
    select template_version_id, (extract(epoch from date_trunc('milliseconds', updated_at)) * 1000)::bigint::text
      into v_version, v_revision from public.encounter where id = p_target and deleted_at is null for update;
  end if;
  if v_version is distinct from p_version
     or (p_kind in ('patient_update', 'encounter_update') and v_revision is distinct from p_entity_revision) then
    perform public.work_draft_error('DRAFT_CONTEXT_CHANGED');
  end if;
end $$;
revoke all on function public.assert_work_draft_context(uuid, text, uuid, uuid, text) from public, anon, authenticated;

create function public.purge_work_drafts() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count bigint;
begin
  update public.work_draft set payload = '{}', state = 'expired', updated_at = clock_timestamp()
    where state = 'active' and expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.purge_work_drafts() from public, anon, authenticated;

create function public.list_work_drafts(p_base_id uuid, p_kind text, p_target_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.work_draft_allowed(auth.uid(), p_base_id, p_kind, p_target_id) then
    -- No payload is delivered after a role/revocation/deletion. Security purge is not
    -- postponed to allow recovery. Return the same error for absent and forbidden targets.
    update public.work_draft set payload = '{}', state = 'deleted', updated_at = clock_timestamp()
      where owner_id = auth.uid() and base_id = p_base_id and kind = p_kind
        and target_id is not distinct from p_target_id and state = 'active';
    return jsonb_build_object('error', 'DRAFT_FORBIDDEN');
  end if;
  perform public.purge_work_drafts();
  return coalesce((select jsonb_agg(to_jsonb(d) - 'owner_id' order by d.updated_at desc, d.id)
    from public.work_draft d where d.owner_id = auth.uid() and d.base_id = p_base_id
      and d.kind = p_kind and d.target_id is not distinct from p_target_id
      and d.state in ('active', 'consumed') and d.expires_at > clock_timestamp()), '[]'::jsonb);
end $$;
revoke all on function public.list_work_drafts(uuid, text, uuid) from public, anon;
grant execute on function public.list_work_drafts(uuid, text, uuid) to authenticated;

create function public.save_work_draft(
  p_id uuid, p_base_id uuid, p_kind text, p_target_id uuid, p_template_version_id uuid,
  p_entity_revision text, p_expected_revision bigint, p_operation_id uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_d public.work_draft; v_op public.work_draft_operation; v_hash text; v_receipt jsonb; v_scope text;
begin
  if not public.work_draft_allowed(auth.uid(), p_base_id, p_kind, p_target_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision < 0
     or p_template_version_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 262144 or jsonb_typeof(p_payload -> 'values') is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('values','code','encounterType','encounterDate','status','ageUnit','reason'))
     or exists (select 1 from jsonb_each(p_payload - 'values') v where jsonb_typeof(v.value) not in ('string','null')) then
    perform public.work_draft_error('DRAFT_INVALID');
  end if;
  v_scope := case when p_kind like 'patient_%' then 'patient' else 'encounter' end;
  if exists (select 1 from jsonb_object_keys(p_payload -> 'values') k
    where not exists (select 1 from public.template_field f where f.template_version_id = p_template_version_id
      and f.scope = v_scope and f.field_key = k)) then perform public.work_draft_error('DRAFT_INVALID'); end if;
  -- Serialize an author's creation quota and operation keys before locking individual drafts.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 81726));
  v_hash := encode(digest(jsonb_build_array('save', p_id, p_base_id, p_kind, p_target_id,
    p_template_version_id, p_entity_revision, p_expected_revision, p_payload)::text, 'sha256'), 'hex');
  select * into v_op from public.work_draft_operation where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.work_draft_error('DRAFT_OPERATION_CONFLICT'); end if;
    if not exists (select 1 from public.work_draft where id = p_id and state = 'active' and expires_at > clock_timestamp()) then
      perform public.work_draft_error('DRAFT_CLOSED');
    end if;
    return v_op.receipt;
  end if;
  select * into v_d from public.work_draft where id = p_id for update;
  if found then
    if v_d.owner_id is distinct from auth.uid() then perform public.work_draft_error('DRAFT_FORBIDDEN'); end if;
    if v_d.state <> 'active' or v_d.expires_at <= clock_timestamp() then perform public.work_draft_error('DRAFT_CLOSED'); end if;
    if v_d.revision <> p_expected_revision then perform public.work_draft_error('DRAFT_CONFLICT'); end if;
    if v_d.base_id <> p_base_id or v_d.kind <> p_kind or v_d.target_id is distinct from p_target_id
       or v_d.template_version_id <> p_template_version_id or v_d.entity_revision is distinct from p_entity_revision then
      perform public.work_draft_error('DRAFT_CONTEXT_CHANGED');
    end if;
  elsif p_expected_revision <> 0 then perform public.work_draft_error('DRAFT_CONFLICT');
  end if;
  perform public.assert_work_draft_context(p_base_id, p_kind, p_target_id, p_template_version_id, p_entity_revision);
  if v_d.id is null then
    if (select count(*) from public.work_draft where owner_id = auth.uid() and state = 'active' and expires_at > clock_timestamp()) >= 50 then
      perform public.work_draft_error('DRAFT_QUOTA');
    end if;
    insert into public.work_draft(id, owner_id, base_id, kind, target_id, template_version_id, entity_revision, revision, payload)
      values (p_id, auth.uid(), p_base_id, p_kind, p_target_id, p_template_version_id, p_entity_revision, 1, p_payload)
      returning * into v_d;
  else
    update public.work_draft set payload = p_payload, revision = revision + 1, updated_at = clock_timestamp()
      where id = p_id returning * into v_d;
  end if;
  v_receipt := jsonb_build_object('id', v_d.id, 'revision', v_d.revision, 'updated_at', v_d.updated_at, 'expires_at', v_d.expires_at);
  insert into public.work_draft_operation values (auth.uid(), p_operation_id, p_id, v_hash, v_receipt);
  return v_receipt;
exception when others then
  if sqlerrm like 'DRAFT_%' then raise; end if;
  perform public.work_draft_error('DRAFT_INVALID');
end $$;
revoke all on function public.save_work_draft(uuid, uuid, text, uuid, uuid, text, bigint, uuid, jsonb) from public, anon;
grant execute on function public.save_work_draft(uuid, uuid, text, uuid, uuid, text, bigint, uuid, jsonb) to authenticated;

create function public.delete_work_draft(p_id uuid, p_expected_revision bigint, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_d public.work_draft; v_op public.work_draft_operation; v_hash text; v_receipt jsonb;
begin
  if auth.uid() is null then perform public.work_draft_error('DRAFT_FORBIDDEN'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 81726));
  select * into v_d from public.work_draft where id = p_id for update;
  if not found or not public.work_draft_allowed(v_d.owner_id, v_d.base_id, v_d.kind, v_d.target_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if p_operation_id is null or p_expected_revision is null then perform public.work_draft_error('DRAFT_INVALID'); end if;
  v_hash := encode(digest(jsonb_build_array('delete', p_id, p_expected_revision)::text, 'sha256'), 'hex');
  select * into v_op from public.work_draft_operation where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.work_draft_error('DRAFT_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;
  if v_d.state <> 'active' then perform public.work_draft_error('DRAFT_CLOSED'); end if;
  if v_d.revision <> p_expected_revision then perform public.work_draft_error('DRAFT_CONFLICT'); end if;
  update public.work_draft set payload = '{}', state = 'deleted', revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  v_receipt := jsonb_build_object('id', p_id, 'deleted', true);
  insert into public.work_draft_operation values (auth.uid(), p_operation_id, p_id, v_hash, v_receipt);
  return v_receipt;
end $$;
revoke all on function public.delete_work_draft(uuid, bigint, uuid) from public, anon;
grant execute on function public.delete_work_draft(uuid, bigint, uuid) to authenticated;

create function public.commit_work_draft(p_id uuid, p_expected_revision bigint, p_operation_id uuid, p_identity jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_d public.work_draft; v_op public.work_draft_operation; v_hash text; v_receipt jsonb;
  v_values jsonb; v_patient public.patient; v_encounter public.encounter; v_status text;
  v_type text; v_inactive text[];
begin
  if auth.uid() is null then perform public.work_draft_error('DRAFT_FORBIDDEN'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 81726));
  select * into v_d from public.work_draft where id = p_id for update;
  if not found or v_d.owner_id is distinct from auth.uid()
     or not public.can_create_structured_data(v_d.base_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if p_operation_id is null or p_expected_revision is null
     or (p_identity is not null and (v_d.kind <> 'patient_create' or jsonb_typeof(p_identity) <> 'object'
       or octet_length(p_identity::text) > 16384
       or exists (select 1 from jsonb_object_keys(p_identity) k where k not in ('fullName','dateOfBirth','phone','address','externalIdentifier')))) then
    perform public.work_draft_error('DRAFT_INVALID');
  end if;
  v_hash := encode(digest(jsonb_build_array('commit', p_id, p_expected_revision, p_identity)::text, 'sha256'), 'hex');
  select * into v_op from public.work_draft_operation where owner_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_op.request_hash <> v_hash then perform public.work_draft_error('DRAFT_OPERATION_CONFLICT'); end if;
    return v_op.receipt;
  end if;
  if not public.work_draft_allowed(v_d.owner_id, v_d.base_id, v_d.kind, v_d.target_id) then
    perform public.work_draft_error('DRAFT_FORBIDDEN');
  end if;
  if v_d.state <> 'active' or v_d.expires_at <= clock_timestamp() then perform public.work_draft_error('DRAFT_CLOSED'); end if;
  if v_d.revision <> p_expected_revision then perform public.work_draft_error('DRAFT_CONFLICT'); end if;
  perform public.assert_work_draft_context(v_d.base_id, v_d.kind, v_d.target_id, v_d.template_version_id, v_d.entity_revision);
  -- Recompute the actual projection on the server; retained inapplicable answers never
  -- reach clinical calculations, completeness, history or exports.
  v_values := v_d.payload -> 'values';
  if v_d.kind in ('encounter_create', 'encounter_update') then
    if v_d.kind = 'encounter_create' then v_type := v_d.payload ->> 'encounterType';
    else select encounter_type into v_type from public.encounter where id = v_d.target_id; end if;
    select coalesce(array_agg(field_key), '{}'::text[]) into v_inactive from public.template_field
      where template_version_id = v_d.template_version_id and scope = 'encounter'
        and cardinality(encounter_types) > 0 and not (v_type = any(encounter_types));
    v_values := v_values - v_inactive;
  end if;
  v_values := v_values - public.visibility_hidden_fields(v_d.template_version_id, v_values);
  v_status := coalesce(v_d.payload ->> 'status', 'draft');
  if v_d.kind = 'patient_create' then
    select * into v_patient from public.create_patient(v_d.base_id, v_d.payload ->> 'code',
      p_identity ->> 'fullName', nullif(p_identity ->> 'dateOfBirth','')::date, p_identity ->> 'phone',
      p_identity ->> 'address', p_identity ->> 'externalIdentifier', v_values);
    v_receipt := jsonb_build_object('id', v_patient.id, 'code', v_patient.patient_code, 'version', v_patient.row_version, 'updatedAt', v_patient.updated_at);
  elsif v_d.kind = 'patient_update' then
    select * into v_patient from public.patient where id = v_d.target_id;
    if v_patient.validation_status = 'curated' and v_status <> 'curated' then perform public.work_draft_error('DRAFT_INVALID'); end if;
    select * into v_patient from public.update_patient(v_d.target_id, v_values, v_status,
      v_d.payload ->> 'reason', v_d.entity_revision::bigint);
    v_receipt := jsonb_build_object('id', v_patient.id, 'version', v_patient.row_version, 'updatedAt', v_patient.updated_at);
  elsif v_d.kind = 'encounter_create' then
    select * into v_encounter from public.create_encounter(v_d.target_id, v_d.payload ->> 'encounterType',
      (v_d.payload ->> 'encounterDate')::date, v_status, v_values, coalesce(v_d.payload ->> 'ageUnit', 'years'));
    v_receipt := jsonb_build_object('id', v_encounter.id, 'updatedAt', v_encounter.updated_at);
  else
    select * into v_encounter from public.encounter where id = v_d.target_id;
    if v_encounter.validation_status = 'curated' and v_status <> 'curated' then perform public.work_draft_error('DRAFT_INVALID'); end if;
    select * into v_encounter from public.update_encounter(v_d.target_id, v_values, v_status,
      v_d.payload ->> 'reason', to_timestamp(v_d.entity_revision::numeric / 1000));
    v_receipt := jsonb_build_object('id', v_encounter.id, 'updatedAt', v_encounter.updated_at);
  end if;
  update public.work_draft set payload = '{}', result = v_receipt, state = 'consumed', revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  insert into public.work_draft_operation values (auth.uid(), p_operation_id, p_id, v_hash, v_receipt);
  return v_receipt;
exception when others then
  if sqlerrm like 'DRAFT_%' then raise; end if;
  perform public.work_draft_error('DRAFT_VALIDATION');
end $$;
revoke all on function public.commit_work_draft(uuid, bigint, uuid, jsonb) from public, anon;
grant execute on function public.commit_work_draft(uuid, bigint, uuid, jsonb) to authenticated;

-- Local test databases do not have pg_cron. Hosted databases with the extension purge
-- expired payloads every fifteen minutes; all read paths also enforce expiration immediately.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-work-drafts', '*/15 * * * *', 'select public.purge_work_drafts()');
  end if;
end $$;
