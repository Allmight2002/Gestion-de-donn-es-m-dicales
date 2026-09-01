-- =============================================================================
-- 20260801140238_restore_deleted_base.sql
-- P2 : corbeille et restauration transactionnelle des bases. Les acces partages
-- et invitations revoques ne sont jamais retablis automatiquement.
-- =============================================================================

-- Conserve uniquement les etats modifies par la suppression de base. La colonne
-- est nullable afin de rester compatible avec les suppressions anterieures.
alter table public.base
  add column if not exists deletion_snapshot jsonb;

-- La suppression devient rejouable : un retry apres commit ne cree pas un second
-- audit. L'instantane permet a la restauration de remettre les workflows dans
-- leur etat exact, sans ressusciter les acces partages.
create or replace function public.soft_delete_base(p_base_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_reason text;
  v_now timestamptz := now();
  v_snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into b from public.base where id = p_base_id for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;
  if b.deleted_at is not null then return; end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then raise exception 'Motif de suppression requis'; end if;
  if char_length(v_reason) > 500 then raise exception 'Motif de suppression trop long'; end if;

  select jsonb_build_object(
    'raw_submission_statuses', coalesce((
      select jsonb_object_agg(s.id::text, to_jsonb(s.status))
      from public.raw_submission s
      where s.base_id = p_base_id and s.deleted_at is null
    ), '{}'::jsonb),
    'curation_task_statuses', coalesce((
      select jsonb_object_agg(t.id::text, to_jsonb(t.status))
      from public.curation_task t
      where t.base_id = p_base_id and t.deleted_at is null and t.status <> 'completed'
    ), '{}'::jsonb)
  ) into v_snapshot;

  -- Etiquette d'organisation privee : la suppression conserve le comportement
  -- existant et detache la base du groupe, sans effet sur les droits d'acces.
  delete from public.research_group_base
   where base_id = p_base_id;

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
     set deleted_at = v_now,
         deleted_by = auth.uid(),
         deletion_reason = v_reason,
         deletion_snapshot = v_snapshot
   where id = p_base_id;

  perform public.log_audit('base_deleted', 'base', p_base_id, p_base_id, jsonb_build_object('reason', v_reason));
end $$;

create or replace function public.restore_deleted_base(p_base_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_deleted_at timestamptz;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into b from public.base where id = p_base_id for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;
  if b.deleted_at is null then return; end if;

  v_deleted_at := b.deleted_at;
  v_snapshot := coalesce(b.deletion_snapshot, '{}'::jsonb);

  update public.patient
     set deleted_at = null, deleted_by = null, deletion_reason = null
   where base_id = p_base_id and deleted_at = v_deleted_at;
  update public.patient_identity
     set deleted_at = null, deleted_by = null, deletion_reason = null
   where base_id = p_base_id and deleted_at = v_deleted_at;
  update public.encounter e
     set deleted_at = null, deleted_by = null, deletion_reason = null
    from public.patient p
   where e.patient_id = p.id and p.base_id = p_base_id and e.deleted_at = v_deleted_at;
  update public.clinical_attachment a
     set deleted_at = null, deleted_by = null, deletion_reason = null
    from public.patient p
   where a.patient_id = p.id and p.base_id = p_base_id and a.deleted_at = v_deleted_at;

  update public.raw_submission s
     set deleted_at = null,
         deleted_by = null,
         deletion_reason = null,
         status = coalesce(v_snapshot -> 'raw_submission_statuses' ->> s.id::text, s.status)
   where s.base_id = p_base_id and s.deleted_at = v_deleted_at;
  update public.raw_document
     set deleted_at = null, deletion_reason = null
   where base_id = p_base_id and deleted_at = v_deleted_at;
  update public.curation_task t
     set deleted_at = null,
         status = coalesce(v_snapshot -> 'curation_task_statuses' ->> t.id::text, t.status),
         updated_at = v_now
   where t.base_id = p_base_id and t.deleted_at = v_deleted_at;

  update public.base
     set deleted_at = null,
         deleted_by = null,
         deletion_reason = null,
         deletion_snapshot = null
   where id = p_base_id;

  perform public.log_audit('base_restored', 'base', p_base_id, p_base_id, jsonb_build_object('retention_days', 365));
end $$;

create or replace function public.list_deleted_bases()
returns table (
  id uuid,
  name text,
  deleted_at timestamptz,
  deletion_reason text,
  purge_eligible_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  return query
    select b.id, b.name, b.deleted_at, b.deletion_reason, b.deleted_at + interval '1 year'
      from public.base b
     where b.owner_user_id = auth.uid()
       and b.deleted_at is not null
     order by b.deleted_at desc;
end $$;

revoke all on function public.restore_deleted_base(uuid) from public, anon;
revoke all on function public.list_deleted_bases() from public, anon;
grant execute on function public.restore_deleted_base(uuid) to authenticated;
grant execute on function public.list_deleted_bases() to authenticated;
