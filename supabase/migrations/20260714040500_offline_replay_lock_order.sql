-- Serialize distinct offline operations on the encounter before inserting the
-- operation receipt. The insert's foreign-key check otherwise takes a KEY SHARE
-- lock first, so two concurrent operations can deadlock while both upgrade to
-- the encounter UPDATE lock.

create or replace function public.replay_encounter_update(
  p_operation_id text,
  p_encounter_id uuid,
  p_data jsonb,
  p_validation_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns table(id uuid, updated_at timestamptz, replayed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_operation public.offline_encounter_operation;
  v_encounter public.encounter;
  v_payload jsonb;
  v_fingerprint text;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_id is null
     or length(btrim(p_operation_id)) not between 1 and 200 then
    raise exception 'OFFLINE_OPERATION_INVALID' using errcode = 'P0001';
  end if;

  v_payload := jsonb_build_object(
    'encounter_id', p_encounter_id,
    'data', coalesce(p_data, '{}'::jsonb),
    'validation_status', p_validation_status,
    'reason', p_reason,
    'expected_updated_at', p_expected_updated_at
  );
  v_fingerprint := encode(
    digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || btrim(p_operation_id), 0)
  );

  select operation.* into v_operation
    from public.offline_encounter_operation operation
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id)
   for update;
  if found then
    if v_operation.request_fingerprint is distinct from v_fingerprint then
      raise exception 'OFFLINE_OPERATION_MISMATCH' using errcode = 'P0001';
    end if;
    if v_operation.completed_at is null then
      raise exception 'OFFLINE_OPERATION_INCOMPLETE' using errcode = 'P0001';
    end if;
    return query select v_operation.encounter_id, v_operation.result_updated_at, true;
    return;
  end if;

  -- Acquire the parent row lock before the operation receipt insert performs
  -- its foreign-key check. Distinct operations now wait here in the same order
  -- and the loser observes the updated optimistic token.
  select encounter.* into v_encounter
    from public.encounter encounter
   where encounter.id = p_encounter_id
     and encounter.deleted_at is null
   for update;
  if not found then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.offline_encounter_operation(
    user_id, operation_id, encounter_id, request_fingerprint
  ) values (
    v_uid, btrim(p_operation_id), p_encounter_id, v_fingerprint
  );

  select * into v_encounter
    from public.update_encounter(
      p_encounter_id,
      p_data,
      p_validation_status,
      p_reason,
      p_expected_updated_at
    );

  update public.offline_encounter_operation operation
     set result_updated_at = v_encounter.updated_at,
         completed_at = now()
   where operation.user_id = v_uid
     and operation.operation_id = btrim(p_operation_id);

  return query select v_encounter.id, v_encounter.updated_at, false;
end
$$;

revoke all on function public.replay_encounter_update(
  text, uuid, jsonb, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.replay_encounter_update(
  text, uuid, jsonb, text, text, timestamptz
) to authenticated;
