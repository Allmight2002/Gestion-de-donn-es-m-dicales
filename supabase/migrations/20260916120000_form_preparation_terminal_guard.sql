-- 20260916120000_form_preparation_terminal_guard.sql — E1
-- Le contexte source attendu est obligatoire pour abandonner ; les états
-- terminaux ne peuvent jamais être rouverts par une RPC périmée.
-- =============================================================================

create or replace function public.guard_form_preparation_terminal_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.state in ('applied', 'discarded', 'expired')
     and (
       new.state is distinct from old.state
       or new.payload is distinct from old.payload
       or new.base_id is distinct from old.base_id
       or new.owner_id is distinct from old.owner_id
       or new.created_by is distinct from old.created_by
       or new.source_template_version_id is distinct from old.source_template_version_id
       or new.source_revision is distinct from old.source_revision
       or new.source_fingerprint is distinct from old.source_fingerprint
       or new.preparation_revision is distinct from old.preparation_revision
       or new.content_fingerprint is distinct from old.content_fingerprint
       or new.classification is distinct from old.classification
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
     ) then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  return new;
end
$$;
revoke all on function public.guard_form_preparation_terminal_state() from public, anon, authenticated;
drop trigger if exists trg_form_preparation_terminal_state on public.form_preparation;
create trigger trg_form_preparation_terminal_state
  before update on public.form_preparation
  for each row execute function public.guard_form_preparation_terminal_state();

-- Reprise : expiration est évaluée avant le contrôle d'état afin qu'une ligne
-- devenue expired pendant l'appel ne soit pas traitée comme conflict/active.
create or replace function public.resume_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND'; end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  v_hash := encode(digest(convert_to(jsonb_build_array('resume', p_preparation_id, p_expected_preparation_revision)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision is null or p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  if v_row.state <> 'conflict' then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_INVALID';
  end if;
  select * into v_base from public.base where id = v_row.base_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN'; end if;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  update public.form_preparation
     set source_template_version_id = v_base.current_template_version_id,
         source_revision = v_base.form_revision,
         source_fingerprint = v_source_fp,
         preparation_revision = preparation_revision + 1,
         state = 'active',
         updated_at = clock_timestamp(),
         expires_at = clock_timestamp() + interval '7 days'
   where id = v_row.id
   returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'resume');
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'resume', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_resumed', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'source_revision', v_row.source_revision, 'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.resume_form_preparation(uuid, bigint, uuid) from public, anon;
grant execute on function public.resume_form_preparation(uuid, bigint, uuid) to authenticated;

-- Abandonner exige le contexte source lu par le client. Un changement de base
-- est retourné comme conflit et conserve le payload jusqu'à l'abandon explicite
-- rejoué avec le contexte courant.
revoke all on function public.discard_form_preparation(uuid, bigint, uuid) from public, anon, authenticated;
create or replace function public.discard_form_preparation(
  p_preparation_id uuid,
  p_expected_preparation_revision bigint,
  p_expected_source_revision bigint,
  p_expected_source_fingerprint text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.form_preparation;
  v_base public.base;
  v_source jsonb;
  v_source_fp text;
  v_hash text;
  v_existing jsonb;
  v_receipt jsonb;
begin
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_NOT_FOUND'; end if;
  perform public.form_preparation_assert_owner(v_row.base_id);
  perform public.expire_form_preparations();
  select * into v_row from public.form_preparation where id = p_preparation_id for update;
  if p_expected_preparation_revision is null or p_expected_source_revision is null
     or p_expected_source_fingerprint is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_OPERATION_INVALID';
  end if;
  v_hash := encode(digest(convert_to(jsonb_build_array('discard', p_preparation_id,
    p_expected_preparation_revision, p_expected_source_revision,
    p_expected_source_fingerprint)::text, 'UTF8'), 'sha256'), 'hex');
  v_existing := public.form_preparation_operation_result(p_operation_id, v_hash);
  if v_existing is not null then return v_existing; end if;
  if v_row.state in ('applied', 'discarded', 'expired') then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CLOSED';
  end if;
  if p_expected_preparation_revision <> v_row.preparation_revision then
    raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_CONFLICT';
  end if;
  select * into v_base from public.base where id = v_row.base_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORM_PREPARATION_FORBIDDEN'; end if;
  v_source := public.form_preparation_source_definition(v_base.current_template_version_id);
  v_source_fp := public.form_preparation_fingerprint(v_source);
  if p_expected_source_revision is distinct from v_base.form_revision
     or p_expected_source_fingerprint is distinct from v_source_fp then
    update public.form_preparation
       set state = 'conflict', updated_at = clock_timestamp()
     where id = v_row.id
     returning * into v_row;
    v_receipt := public.form_preparation_error_json('FORM_PREPARATION_CONFLICT', v_row.id, p_operation_id, true);
    insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
    values (auth.uid(), p_operation_id, v_row.id, 'discard', v_hash, v_receipt);
    insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata)
    values (auth.uid(), 'form_preparation_conflict', 'form_preparation', v_row.id, v_row.base_id,
      jsonb_build_object('operation_id', p_operation_id, 'operation_kind', 'discard', 'retryable', true));
    return v_receipt;
  end if;
  update public.form_preparation
     set state = 'discarded', payload = '{}'::jsonb, updated_at = clock_timestamp()
   where id = v_row.id
   returning * into v_row;
  v_receipt := public.form_preparation_receipt(v_row, p_operation_id, 'discard');
  insert into public.form_preparation_operation(owner_id, operation_id, preparation_id, operation_kind, request_hash, receipt)
  values (auth.uid(), p_operation_id, v_row.id, 'discard', v_hash, v_receipt);
  insert into public.audit_log (user_id, action, entity, entity_id, base_id, metadata)
  values (auth.uid(), 'form_preparation_discarded', 'form_preparation', v_row.id, v_row.base_id,
    jsonb_build_object('operation_id', p_operation_id, 'state', v_row.state,
      'source_revision', v_row.source_revision, 'source_fingerprint', v_row.source_fingerprint,
      'preparation_revision', v_row.preparation_revision));
  return v_receipt;
end
$$;
revoke all on function public.discard_form_preparation(uuid, bigint, bigint, text, uuid) from public, anon;
grant execute on function public.discard_form_preparation(uuid, bigint, bigint, text, uuid) to authenticated;
