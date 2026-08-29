-- =============================================================================
-- 20260616096000_soft_delete_base.sql
-- P1 audit: no direct physical DELETE on base. Owners use an audited soft-delete
-- RPC; deleted bases no longer satisfy access helpers or curation visibility.
-- =============================================================================

alter table public.base
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists deletion_reason text;

alter table public.raw_submission
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists deletion_reason text;

drop policy if exists base_delete on public.base;

create or replace function public.is_base_active(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
$$;

create or replace function public.is_base_owner(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (
       select 1 from public.base b
       where b.id = p_base and b.owner_user_id = auth.uid() and b.deleted_at is null
     )
$$;

create or replace function public.has_base_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null)
     )
$$;

create or replace function public.can_view_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_identity)
     )
$$;

create or replace function public.can_view_raw_documents(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_view_raw_documents)
     )
$$;

create or replace function public.can_edit_structured_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_edit_structured_data)
     )
$$;

create or replace function public.can_export_data(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_export_data)
     )
$$;

create or replace function public.can_manage_access(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null and a.can_manage_access)
     )
$$;

create or replace function public.can_write_identity(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and a.can_view_identity and a.can_edit_structured_data)
     )
$$;

create or replace function public.can_curate(p_base uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_medecin()
     and exists (select 1 from public.base b where b.id = p_base and b.deleted_at is null)
     and (
       exists (select 1 from public.base b where b.id = p_base and b.owner_user_id = auth.uid())
       or exists (select 1 from public.base_access a
                  where a.base_id = p_base and a.user_id = auth.uid() and a.revoked_at is null
                    and (a.can_edit_structured_data or a.can_export_data))
     )
$$;

drop policy if exists bi_select on public.base_invitation;
create policy bi_select on public.base_invitation for select to authenticated
  using (
    public.is_base_active(base_id)
    and (
      public.is_base_owner(base_id)
      or public.can_manage_access(base_id)
      or invited_by = auth.uid()
    )
  );

drop policy if exists rs_select on public.raw_submission;
create policy rs_select on public.raw_submission for select to authenticated
  using (
    deleted_at is null
    and public.is_base_active(base_id)
    and (public.is_base_owner(base_id) or public.is_assigned_to_submission(id))
  );
drop policy if exists rs_insert on public.raw_submission;
drop policy if exists rs_update on public.raw_submission;

drop policy if exists rd_select on public.raw_document;
create policy rd_select on public.raw_document for select to authenticated
  using (
    public.is_base_active(base_id)
    and (public.is_base_owner(base_id) or public.is_assigned_to_submission(submission_id))
    and deleted_at is null
  );
drop policy if exists rd_insert on public.raw_document;
create policy rd_insert on public.raw_document for insert to authenticated
  with check (public.is_base_owner(base_id));
drop policy if exists rd_update on public.raw_document;
create policy rd_update on public.raw_document for update to authenticated
  using (deleted_at is null and public.is_base_owner(base_id))
  with check (deleted_at is null and public.is_base_owner(base_id));

drop policy if exists ct_select on public.curation_task;
create policy ct_select on public.curation_task for select to authenticated
  using (
    deleted_at is null
    and public.is_base_active(base_id)
    and (public.is_base_owner(base_id) or public.is_assigned_curator(id))
  );
drop policy if exists ct_insert on public.curation_task;
drop policy if exists ct_update on public.curation_task;

create or replace function public.soft_delete_base(p_base_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Base supprimee');
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into b from public.base where id = p_base_id and deleted_at is null for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;

  update public.base_access
     set revoked_at = coalesce(revoked_at, v_now)
   where base_id = p_base_id and revoked_at is null;

  update public.base_invitation
     set status = 'revoked'
   where base_id = p_base_id and status = 'pending';

  update public.patient
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.patient_identity
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.encounter e
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where e.patient_id = p.id and p.base_id = p_base_id and e.deleted_at is null;
  update public.clinical_attachment a
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where a.patient_id = p.id and p.base_id = p_base_id and a.deleted_at is null;

  update public.raw_submission
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason, status = 'cancelled'
   where base_id = p_base_id and deleted_at is null;
  update public.raw_document
     set deleted_at = v_now, deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.curation_task
     set deleted_at = v_now, status = 'cancelled', updated_at = v_now
   where base_id = p_base_id and deleted_at is null and status <> 'completed';

  update public.base
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where id = p_base_id;

  perform public.log_audit('base_deleted', 'base', p_base_id, p_base_id, jsonb_build_object('reason', v_reason));
end $$;

grant execute on function public.soft_delete_base(uuid, text) to authenticated;
